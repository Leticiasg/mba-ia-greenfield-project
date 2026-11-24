import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { StorageUploadIncompleteError } from './storage.errors';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration, real MinIO)', () => {
  let module: TestingModule;
  let storage: StorageService;
  const createdKeys: string[] = [];

  const newKey = (): string => {
    const key = `test/storage-${randomUUID()}/original`;
    createdKeys.push(key);
    return key;
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videoConfig],
        }),
        StorageModule,
      ],
    }).compile();
    await module.init(); // runs onModuleInit → ensureBucket
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    for (const key of createdKeys) {
      await storage.deleteObject(key);
    }
    await module.close();
  });

  it('should be idempotent when ensuring the bucket', async () => {
    await expect(storage.ensureBucket()).resolves.toBeUndefined();
  });

  describe('multipart upload through presigned part URLs', () => {
    it('should store the object after completing the upload', async () => {
      const key = newKey();
      const body = Buffer.alloc(1024, 'a');
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      const url = await storage.presignUploadPart(key, uploadId, 1);
      const put = await fetch(url, { method: 'PUT', body });
      expect(put.status).toBe(200);
      const eTag = put.headers.get('etag');
      expect(eTag).toBeTruthy();

      const listed = await storage.listParts(key, uploadId);
      expect(listed).toEqual([{ partNumber: 1, eTag, size: 1024 }]);

      await storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, eTag: eTag! },
      ]);
      await expect(storage.headObject(key)).resolves.toBe(1024);
    });

    it('should throw StorageUploadIncompleteError for a wrong ETag', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const url = await storage.presignUploadPart(key, uploadId, 1);
      await fetch(url, { method: 'PUT', body: Buffer.alloc(16, 'b') });

      await expect(
        storage.completeMultipartUpload(key, uploadId, [
          { partNumber: 1, eTag: '"00000000000000000000000000000000"' },
        ]),
      ).rejects.toBeInstanceOf(StorageUploadIncompleteError);
    });
  });

  describe('presigned GetObject URLs', () => {
    let key: string;
    const body = Buffer.from('0123456789'.repeat(20));

    beforeAll(async () => {
      key = newKey();
      await storage.putObject(key, body, 'video/mp4');
    });

    it('should answer a Range request with 206 Partial Content', async () => {
      const url = await storage.presignGetObject(key, { consumer: 'public' });
      const res = await fetch(url, { headers: { Range: 'bytes=0-9' } });

      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes 0-9/${body.length}`);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(
        body.subarray(0, 10),
      );
    });

    it('should set Content-Disposition attachment when a disposition is given', async () => {
      const url = await storage.presignGetObject(key, {
        consumer: 'public',
        disposition: 'attachment; filename="clip.mp4"',
      });
      const res = await fetch(url);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="clip.mp4"',
      );
    });

    it('should sign public and internal URLs for the same host in the test environment', async () => {
      const publicUrl = new URL(
        await storage.presignGetObject(key, { consumer: 'public' }),
      );
      const internalUrl = new URL(
        await storage.presignGetObject(key, { consumer: 'internal' }),
      );
      expect(publicUrl.host).toBe('minio:9000');
      expect(internalUrl.host).toBe('minio:9000');
    });
  });
});
