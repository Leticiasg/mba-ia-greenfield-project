import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { generatePublicId } from '../src/videos/public-id.util';
import {
  createAuthenticatedUser,
  createE2eApp,
  type AuthenticatedUser,
} from './helpers/e2e-app';

const METADATA = {
  width: 320,
  height: 240,
  videoCodec: 'h264',
  audioCodec: null,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitRate: 118000,
  frameRate: 25,
  sizeBytes: 1024,
};

// Spec: nestjs-project/specs/videos-playback.plan.md (SI-03.10)
describe('videos-playback', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let owner: AuthenticatedUser;
  let other: AuthenticatedUser;
  let readyVideo: Video;
  let processingVideo: Video;
  const originalBytes = Buffer.from(
    Array.from({ length: 1024 }, (_, i) => i % 256),
  );
  const createdKeys: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    for (const key of createdKeys) await storage.deleteObject(key);
    await app.close();
  });

  const seedVideo = async (
    channelId: string,
    status: VideoStatus,
  ): Promise<Video> => {
    const id = randomUUID();
    const repo = dataSource.getRepository(Video);
    return repo.save(
      repo.create({
        id,
        public_id: generatePublicId(),
        channel_id: channelId,
        title: 'Clip',
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: String(originalBytes.length),
        status,
        video_key: `videos/${id}/original`,
        thumbnail_key:
          status === VideoStatus.READY ? `thumbnails/${id}.jpg` : null,
        part_size_bytes: 104857600,
        part_count: 1,
        duration_seconds: status === VideoStatus.READY ? '2.040' : null,
        metadata: status === VideoStatus.READY ? METADATA : null,
      }),
    );
  };

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    owner = await createAuthenticatedUser(app);
    other = await createAuthenticatedUser(app);
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: owner.userId });

    readyVideo = await seedVideo(channel.id, VideoStatus.READY);
    processingVideo = await seedVideo(channel.id, VideoStatus.PROCESSING);
    await storage.putObject(readyVideo.video_key, originalBytes, 'video/mp4');
    await storage.putObject(
      readyVideo.thumbnail_key!,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'image/jpeg',
    );
    createdKeys.push(readyVideo.video_key, readyVideo.thumbnail_key!);
  });

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path).redirects(0);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  // 1.1 — Covers AC #1
  it('returns-ready-video-status', async () => {
    const res = await get(
      `/videos/${readyVideo.public_id}`,
      owner.accessToken,
    ).expect(200);

    const body = res.body as {
      status: string;
      durationSeconds: number;
      metadata: Record<string, unknown>;
    };
    expect(body.status).toBe('ready');
    expect(body.durationSeconds).toBe(2.04);
    expect(Object.keys(body.metadata).sort()).toEqual(
      [
        'width',
        'height',
        'videoCodec',
        'audioCodec',
        'formatName',
        'bitRate',
        'frameRate',
        'sizeBytes',
      ].sort(),
    );
  });

  // 1.2 — Covers AC #2
  it('stream-redirect-serves-partial-content', async () => {
    const redirect = await get(
      `/videos/${readyVideo.public_id}/stream`,
      owner.accessToken,
    ).expect(302);
    const location = redirect.headers.location;
    expect(location).toEqual(expect.any(String));

    const res = await fetch(location, { headers: { Range: 'bytes=0-99' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-99\//);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(
      originalBytes.subarray(0, 100),
    );
  });

  // 1.3 — Covers AC #3
  it('download-redirect-sets-attachment', async () => {
    const redirect = await get(
      `/videos/${readyVideo.public_id}/download`,
      owner.accessToken,
    ).expect(302);

    const res = await fetch(redirect.headers.location);
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('filename="clip.mp4"');
  });

  // 1.4 — Covers AC #4
  it('stream-rejected-while-processing', async () => {
    const res = await get(
      `/videos/${processingVideo.public_id}/stream`,
      owner.accessToken,
    ).expect(409);
    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });

  // 1.5 — Covers AC #5
  it('hides-video-from-others-and-anonymous', async () => {
    const res = await get(
      `/videos/${readyVideo.public_id}`,
      other.accessToken,
    ).expect(404);
    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');

    await get(`/videos/${readyVideo.public_id}`).expect(401);
  });
});
