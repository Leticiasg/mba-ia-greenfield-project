import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { captureAddedJobs, waitFor } from '../test/queue-events-capture';
import { createVideosTestingModule } from '../test/video-test-module';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosService (integration, real Postgres + MinIO)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let storageService: StorageService;

  const createOwner = async (): Promise<{
    userId: string;
    channelId: string;
  }> => {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `videos_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await module
      .get(ChannelsService)
      .createChannel(user.id, user.email);
    return { userId: user.id, channelId: channel.id };
  };

  beforeAll(async () => {
    module = await createVideosTestingModule();
    await module.init();
    dataSource = module.get(DataSource);
    videosService = module.get(VideosService);
    storageService = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  describe('initUpload', () => {
    it("should persist a draft in the user's channel with an open multipart upload", async () => {
      const { userId, channelId } = await createOwner();

      const plan = await videosService.initUpload(userId, {
        filename: 'clip.mp4',
        fileSize: 12582912,
        contentType: 'video/mp4',
      });

      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: plan.publicId });
      expect(video.status).toBe(VideoStatus.DRAFT);
      expect(video.channel_id).toBe(channelId);
      expect(video.title).toBe('clip');
      expect(video.size_bytes).toBe('12582912');
      expect(video.video_key).toBe(`videos/${video.id}/original`);
      expect(video.upload_id).not.toBeNull();
      await expect(
        storageService.listParts(video.video_key, video.upload_id!),
      ).resolves.toEqual([]);
    });
  });
  describe('issuePartUrls / listUploadedParts', () => {
    it('should accept a PUT on the issued URL and list the stored part', async () => {
      const { userId } = await createOwner();
      const plan = await videosService.initUpload(userId, {
        filename: 'clip.mp4',
        fileSize: 2048,
        contentType: 'video/mp4',
      });

      const { parts } = await videosService.issuePartUrls(
        plan.publicId,
        userId,
        [1],
      );
      const put = await fetch(parts[0].url, {
        method: 'PUT',
        body: Buffer.alloc(2048, 'v'),
      });
      expect(put.status).toBe(200);

      const listed = await videosService.listUploadedParts(
        plan.publicId,
        userId,
      );
      expect(listed.parts).toEqual([
        { partNumber: 1, eTag: put.headers.get('etag'), size: 2048 },
      ]);
    });
  });
  describe('completeUpload', () => {
    it('should move the video to processing and publish the video.process job', async () => {
      const { userId } = await createOwner();
      const plan = await videosService.initUpload(userId, {
        filename: 'clip.mp4',
        fileSize: 2048,
        contentType: 'video/mp4',
      });
      const { parts } = await videosService.issuePartUrls(
        plan.publicId,
        userId,
        [1],
      );
      const put = await fetch(parts[0].url, {
        method: 'PUT',
        body: Buffer.alloc(2048, 'c'),
      });

      const capture = await captureAddedJobs();
      try {
        const result = await videosService.completeUpload(
          plan.publicId,
          userId,
          [{ partNumber: 1, eTag: put.headers.get('etag')! }],
        );
        expect(result.status).toBe('processing');

        const video = await dataSource
          .getRepository(Video)
          .findOneByOrFail({ public_id: plan.publicId });
        expect(video.upload_id).toBeNull();
        await expect(storageService.headObject(video.video_key)).resolves.toBe(
          2048,
        );

        await waitFor(() => capture.added.some((e) => e.jobId === video.id));
        expect(capture.added).toContainEqual({
          jobId: video.id,
          name: 'video.process',
        });
      } finally {
        await capture.close();
      }
    });
  });
  describe('getPlaybackUrl', () => {
    it('should return a stream URL that answers a Range request with 206', async () => {
      const { userId, channelId } = await createOwner();
      const id = randomUUID();
      const body = Buffer.from('0123456789'.repeat(30));
      const videoKey = `videos/${id}/original`;
      await storageService.putObject(videoKey, body, 'video/mp4');
      const video = await dataSource.getRepository(Video).save(
        dataSource.getRepository(Video).create({
          id,
          public_id: 'readyVideo1',
          channel_id: channelId,
          title: 'Ready',
          original_filename: 'ready.mp4',
          content_type: 'video/mp4',
          size_bytes: String(body.length),
          status: VideoStatus.READY,
          video_key: videoKey,
          part_size_bytes: 104857600,
          part_count: 1,
        }),
      );

      const url = await videosService.getPlaybackUrl(
        video.public_id,
        userId,
        'stream',
      );
      const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });

      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(
        `bytes 0-99/${body.length}`,
      );
      expect((await res.arrayBuffer()).byteLength).toBe(100);
      await storageService.deleteObject(videoKey);
    });
  });
});
