import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import videoConfig from '../config/video.config';
import {
  VIDEO_PROCESS_JOB,
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessJobData,
} from '../queue/queue.constants';
import { StorageUploadIncompleteError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { CompletedPartDto } from './dto/complete-upload.dto';
import type { CreateVideoDto } from './dto/create-video.dto';
import type { UploadCompletedDto } from './dto/upload-completed.dto';
import type {
  PartUrlsDto,
  UploadedPartsDto,
} from './dto/upload-parts-response.dto';
import type { UploadPlanDto } from './dto/upload-plan.dto';
import type { VideoDto } from './dto/video.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { generatePublicId, PUBLIC_ID_PATTERN } from './public-id.util';
import {
  VIDEO_PUBLIC_ID_MAX_ATTEMPTS,
  VIDEO_STORAGE_KEYS,
} from './videos.constants';
import {
  FileTooLargeException,
  InvalidPartNumberException,
  InvalidVideoStatusException,
  UploadIncompleteException,
  UploadSizeMismatchException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './videos.exceptions';

export type PlaybackKind = 'stream' | 'download' | 'thumbnail';

const PG_UNIQUE_VIOLATION = '23505';

function isPublicIdCollision(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: unknown; detail?: unknown };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes('public_id')
  );
}

/**
 * RFC 6266 attachment header: an ASCII fallback in `filename` plus the
 * UTF-8 name in `filename*`, so non-ASCII names survive.
 */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** `holiday.trip.mov` → `holiday.trip`; names without an extension are kept as-is. */
export function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @Inject(videoConfig.KEY)
    private readonly video: ConfigType<typeof videoConfig>,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly processingQueue: Queue<VideoProcessJobData>,
  ) {}

  /**
   * Pre-registers the video as draft and opens the multipart upload; the API
   * never receives the file bytes (phase-03-videos/TD-02, TD-03, TD-13).
   */
  async initUpload(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<UploadPlanDto> {
    if (dto.fileSize > this.video.maxSizeBytes) {
      throw new FileTooLargeException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error(`User ${userId} has no channel`);
    }

    const partSize = this.video.uploadPartSizeBytes;
    const partCount = Math.ceil(dto.fileSize / partSize);
    const id = randomUUID();
    const videoKey = VIDEO_STORAGE_KEYS.original(id);
    const uploadId = await this.storageService.createMultipartUpload(
      videoKey,
      dto.contentType,
    );

    const saved = await this.insertWithUniquePublicId({
      id,
      channel_id: channel.id,
      title: dto.title ?? titleFromFilename(dto.filename),
      original_filename: dto.filename,
      content_type: dto.contentType,
      size_bytes: String(dto.fileSize),
      status: VideoStatus.DRAFT,
      video_key: videoKey,
      upload_id: uploadId,
      part_size_bytes: partSize,
      part_count: partCount,
    });

    return {
      publicId: saved.public_id,
      title: saved.title,
      status: saved.status,
      partSize,
      partCount,
    };
  }

  /**
   * Malformed, unknown or another channel's publicId all report
   * VIDEO_NOT_FOUND so the video's existence is not revealed (phase-03-videos/TD-15).
   */
  async findOwnedByPublicId(publicId: string, userId: string): Promise<Video> {
    if (!PUBLIC_ID_PATTERN.test(publicId)) {
      throw new VideoNotFoundException();
    }
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId, channel: { user_id: userId } },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  /** Short-lived presigned UploadPart URLs, issued on demand (phase-03-videos/TD-03). */
  async issuePartUrls(
    publicId: string,
    userId: string,
    partNumbers: number[],
  ): Promise<PartUrlsDto> {
    const video = await this.findOwnedDraft(publicId, userId);
    if (partNumbers.some((n) => n > video.part_count)) {
      throw new InvalidPartNumberException();
    }

    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.presignUploadPart(
          video.video_key,
          video.upload_id!,
          partNumber,
        ),
      })),
    );
    const expiresAt = new Date(
      Date.now() + this.video.uploadUrlTtlSeconds * 1000,
    ).toISOString();
    return { parts, expiresAt };
  }

  /** Parts already stored, so a client can resume (phase-03-videos/TD-02). */
  async listUploadedParts(
    publicId: string,
    userId: string,
  ): Promise<UploadedPartsDto> {
    const video = await this.findOwnedDraft(publicId, userId);
    const parts = await this.storageService.listParts(
      video.video_key,
      video.upload_id!,
    );
    return { parts };
  }

  /**
   * Completes the multipart upload, re-checks the stored size, moves the
   * video to processing and enqueues its job in the same request
   * (phase-03-videos/TD-03, TD-04, TD-12).
   */
  async completeUpload(
    publicId: string,
    userId: string,
    parts: CompletedPartDto[],
  ): Promise<UploadCompletedDto> {
    const video = await this.findOwnedDraft(publicId, userId);
    const uploadId = video.upload_id!;

    try {
      await this.storageService.completeMultipartUpload(
        video.video_key,
        uploadId,
        parts,
      );
    } catch (err) {
      if (err instanceof StorageUploadIncompleteError) {
        throw new UploadIncompleteException();
      }
      throw err;
    }

    const storedSize = await this.storageService.headObject(video.video_key);
    if (
      storedSize !== Number(video.size_bytes) ||
      storedSize > this.video.maxSizeBytes
    ) {
      await this.storageService.deleteObject(video.video_key);
      await this.transition(video.id, VideoStatus.DRAFT, {
        status: VideoStatus.ERROR,
        error_reason: 'UPLOAD_SIZE_MISMATCH',
        upload_id: null,
      });
      throw new UploadSizeMismatchException();
    }

    const moved = await this.transition(video.id, VideoStatus.DRAFT, {
      status: VideoStatus.PROCESSING,
      upload_id: null,
    });
    if (!moved) {
      throw new InvalidVideoStatusException();
    }

    // jobId = videoId: adding the same job twice is ignored (phase-03-videos/TD-01).
    await this.processingQueue.add(
      VIDEO_PROCESS_JOB,
      { videoId: video.id },
      { jobId: video.id },
    );

    return { publicId: video.public_id, status: VideoStatus.PROCESSING };
  }

  /** Owner view of a video and its processing status. */
  async getOwnedVideo(publicId: string, userId: string): Promise<VideoDto> {
    const video = await this.findOwnedByPublicId(publicId, userId);
    return {
      publicId: video.public_id,
      title: video.title,
      status: video.status,
      errorReason: video.error_reason,
      durationSeconds:
        video.duration_seconds === null ? null : Number(video.duration_seconds),
      metadata: video.metadata,
      createdAt: video.created_at.toISOString(),
    };
  }

  /**
   * Short-lived presigned URL for a ready video; storage serves Range/206
   * itself (phase-03-videos/TD-14). Signed with the public client because the
   * URL goes back to an HTTP client (TD-10 revision 2026-11-24).
   */
  async getPlaybackUrl(
    publicId: string,
    userId: string,
    kind: PlaybackKind,
  ): Promise<string> {
    const video = await this.findOwnedByPublicId(publicId, userId);
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    if (kind === 'thumbnail') {
      return this.storageService.presignGetObject(video.thumbnail_key!, {
        consumer: 'public',
      });
    }
    return this.storageService.presignGetObject(video.video_key, {
      consumer: 'public',
      disposition:
        kind === 'download'
          ? attachmentDisposition(video.original_filename)
          : undefined,
    });
  }

  /** Conditional status change; returns false when the video was no longer in `from`. */
  private async transition(
    videoId: string,
    from: VideoStatus,
    changes: Partial<Video>,
  ): Promise<boolean> {
    const result = await this.videoRepository.update(
      { id: videoId, status: from },
      changes,
    );
    return (result.affected ?? 0) > 0;
  }

  private async findOwnedDraft(
    publicId: string,
    userId: string,
  ): Promise<Video> {
    const video = await this.findOwnedByPublicId(publicId, userId);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidVideoStatusException();
    }
    return video;
  }

  private async insertWithUniquePublicId(
    fields: Omit<Partial<Video>, 'public_id'>,
  ): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      const video = this.videoRepository.create({
        ...fields,
        public_id: generatePublicId(),
      });
      try {
        return await this.videoRepository.save(video);
      } catch (err) {
        if (
          !isPublicIdCollision(err) ||
          attempt >= VIDEO_PUBLIC_ID_MAX_ATTEMPTS
        ) {
          throw err;
        }
      }
    }
  }
}
