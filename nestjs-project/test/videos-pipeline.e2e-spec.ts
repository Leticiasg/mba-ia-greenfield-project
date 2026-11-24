import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  createAuthenticatedUser,
  createE2eApp,
  type AuthenticatedUser,
} from './helpers/e2e-app';
import { uploadVideo, waitForProcessing } from './helpers/video-upload';

const FIXTURES = join(__dirname, 'fixtures');
const SAMPLE = readFileSync(join(FIXTURES, 'sample.mp4'));
const NOT_A_VIDEO = readFileSync(join(FIXTURES, 'not-a-video.mp4'));
const STORAGE_HOST = new URL(process.env.S3_ENDPOINT ?? 'http://minio:9000')
  .host;

// Requires `minio`, `redis` and `video-worker` running (docker compose up -d).
jest.setTimeout(120000);

// Spec: nestjs-project/specs/videos-pipeline.plan.md (SI-03.11)
describe('videos-pipeline', () => {
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

  const followRedirect = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .redirects(0)
      .expect(302);
    return res.headers.location;
  };

  // 1.1 — Covers AC #1, #3
  it('valid-video-becomes-ready-with-thumbnail-and-streams', async () => {
    const upload = await uploadVideo(
      app,
      owner.accessToken,
      SAMPLE,
      'sample.mp4',
    );

    // Bytes went straight to storage; the API only signed URLs.
    expect(upload.partHosts.length).toBeGreaterThan(0);
    expect(upload.partHosts.every((h) => h === STORAGE_HOST)).toBe(true);
    expect(upload.completeStatus).toBe(202);

    const video = await waitForProcessing(
      app,
      owner.accessToken,
      upload.publicId,
    );
    expect(video.status).toBe('ready');
    expect(video.durationSeconds).toBeCloseTo(2, 0);
    expect(video.metadata).toMatchObject({ width: 320, height: 240 });

    const thumbnail = await fetch(
      await followRedirect(`/videos/${upload.publicId}/thumbnail`),
    );
    expect(thumbnail.status).toBe(200);
    const jpeg = Buffer.from(await thumbnail.arrayBuffer());
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    const stream = await fetch(
      await followRedirect(`/videos/${upload.publicId}/stream`),
      { headers: { Range: 'bytes=0-1023' } },
    );
    expect(stream.status).toBe(206);
    expect(stream.headers.get('content-range')).toBe(
      `bytes 0-1023/${SAMPLE.length}`,
    );
    expect((await stream.arrayBuffer()).byteLength).toBe(1024);
  });

  // 1.2 — Covers AC #2
  it('invalid-media-ends-in-error', async () => {
    const upload = await uploadVideo(
      app,
      owner.accessToken,
      NOT_A_VIDEO,
      'not-a-video.mp4',
    );
    expect(upload.completeStatus).toBe(202);

    const video = await waitForProcessing(
      app,
      owner.accessToken,
      upload.publicId,
    );
    expect(video.status).toBe('error');
    expect(video.errorReason).toBe('INVALID_MEDIA');

    const stream = await request(app.getHttpServer())
      .get(`/videos/${upload.publicId}/stream`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .redirects(0)
      .expect(409);
    expect((stream.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });
});
