import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import {
  INCOMPLETE_UPLOAD_ERROR_NAMES,
  STORAGE_CLIENTS,
} from './storage.constants';
import { StorageUploadIncompleteError } from './storage.errors';

export interface UploadedPart {
  partNumber: number;
  eTag: string;
  size: number;
}

export interface CompletedPartInput {
  partNumber: number;
  eTag: string;
}

export type SignatureConsumer = 'internal' | 'public';

export interface PresignGetOptions {
  consumer: SignatureConsumer;
  disposition?: string;
  expiresIn?: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly bucket: string;

  constructor(
    @Inject(STORAGE_CLIENTS.INTERNAL) private readonly internal: S3Client,
    @Inject(STORAGE_CLIENTS.PUBLIC) private readonly publicClient: S3Client,
    @Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>,
    @Inject(videoConfig.KEY)
    private readonly video: ConfigType<typeof videoConfig>,
  ) {
    this.bucket = storage.bucket;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  /** Creates the bucket only when it does not exist yet (phase-03-videos/TD-09). */
  async ensureBucket(): Promise<void> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
      await this.internal.send(
        new CreateBucketCommand({ Bucket: this.bucket }),
      );
    }
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.internal.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) {
      throw new Error(`Storage returned no UploadId for ${key}`);
    }
    return result.UploadId;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: this.video.uploadUrlTtlSeconds },
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    do {
      const page = await this.internal.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber ?? 0,
          eTag: part.ETag ?? '',
          size: part.Size ?? 0,
        });
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPartInput[],
  ): Promise<void> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    try {
      await this.internal.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: sorted.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.eTag,
            })),
          },
        }),
      );
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (INCOMPLETE_UPLOAD_ERROR_NAMES as readonly string[]).includes(
          error.name,
        )
      ) {
        throw new StorageUploadIncompleteError(error.name);
      }
      throw error;
    }
  }

  /** Returns the stored object size in bytes. */
  async headObject(key: string): Promise<number> {
    const result = await this.internal.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return result.ContentLength ?? 0;
  }

  async deleteObject(key: string): Promise<void> {
    await this.internal.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Signs a GetObject URL with the client that matches who will consume it:
   * 'internal' for consumers inside Compose (e.g., the worker's FFmpeg input),
   * 'public' for URLs returned to HTTP clients (phase-03-videos/TD-10, revision 2026-11-24).
   */
  async presignGetObject(
    key: string,
    options: PresignGetOptions,
  ): Promise<string> {
    const client =
      options.consumer === 'internal' ? this.internal : this.publicClient;
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.disposition,
      }),
      { expiresIn: options.expiresIn ?? this.video.playbackUrlTtlSeconds },
    );
  }

  private isNotFound(error: unknown): boolean {
    return (
      error instanceof S3ServiceException &&
      (error.$metadata?.httpStatusCode === 404 ||
        error.name === 'NotFound' ||
        error.name === 'NoSuchBucket')
    );
  }
}
