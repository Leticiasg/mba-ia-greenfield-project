import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import {
  createAuthenticatedUser,
  createE2eApp,
  type AuthenticatedUser,
} from './helpers/e2e-app';

interface UploadPlanBody {
  publicId: string;
  title: string;
  status: string;
  partSize: number;
  partCount: number;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

const PART_SIZE = Number(process.env.VIDEO_UPLOAD_PART_SIZE_BYTES ?? 104857600);
const MAX_SIZE = Number(process.env.VIDEO_MAX_SIZE_BYTES ?? 10737418240);

// Spec: nestjs-project/specs/videos-create.plan.md (SI-03.5)
describe('videos-create', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: AuthenticatedUser;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    owner = await createAuthenticatedUser(app);
  });

  const postVideo = (body: Record<string, unknown>, token?: string) => {
    const req = request(app.getHttpServer()).post('/videos');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  // 1.1 — Covers AC #1, #6
  it('creates-draft-and-returns-upload-plan', async () => {
    const res = await postVideo(
      {
        filename: 'clip.mp4',
        fileSize: 12582912,
        contentType: 'video/mp4',
        title: 'My clip',
      },
      owner.accessToken,
    ).expect(201);

    const body = res.body as UploadPlanBody;
    expect(body.publicId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(body.title).toBe('My clip');
    expect(body.status).toBe('draft');
    expect(body.partSize).toBe(PART_SIZE);
    expect(body.partCount).toBe(Math.ceil(12582912 / PART_SIZE));

    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: body.publicId });
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: owner.userId });
    expect(video.status).toBe('draft');
    expect(video.channel_id).toBe(channel.id);
    expect(video.upload_id).not.toBeNull();
    expect(video.video_key).toBe(`videos/${video.id}/original`);

    await expect(
      app.get(StorageService).listParts(video.video_key, video.upload_id!),
    ).resolves.toEqual([]);
  });

  // 1.2 — Covers AC #2
  it('defaults-title-to-filename-without-extension', async () => {
    const res = await postVideo(
      {
        filename: 'holiday.trip.mov',
        fileSize: 1048576,
        contentType: 'video/quicktime',
      },
      owner.accessToken,
    ).expect(201);

    expect((res.body as UploadPlanBody).title).toBe('holiday.trip');
  });

  // 1.3 — Covers AC #3
  it('rejects-file-above-max-size', async () => {
    const res = await postVideo(
      { filename: 'big.mp4', fileSize: MAX_SIZE + 1, contentType: 'video/mp4' },
      owner.accessToken,
    ).expect(400);

    expect(res.body as ErrorBody).toMatchObject({
      statusCode: 400,
      error: 'FILE_TOO_LARGE',
    });
    await expect(dataSource.getRepository(Video).count()).resolves.toBe(0);
  });

  // 1.4 — Covers AC #4
  it('rejects-non-video-content-type', async () => {
    const res = await postVideo(
      { filename: 'doc.pdf', fileSize: 1024, contentType: 'application/pdf' },
      owner.accessToken,
    ).expect(400);

    const body = res.body as ErrorBody;
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body.message)).toContain('contentType');
  });

  // 1.5 — Covers AC #5
  it('requires-authentication', async () => {
    await postVideo({
      filename: 'clip.mp4',
      fileSize: 1024,
      contentType: 'video/mp4',
    }).expect(401);
  });
});
