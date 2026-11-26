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

interface PartUrlsBody {
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

interface UploadedPartsBody {
  parts: { partNumber: number; eTag: string; size: number }[];
}

const PART_SIZE = Number(process.env.VIDEO_UPLOAD_PART_SIZE_BYTES ?? 104857600);
// Larger than one part, so the upload has at least 2 parts at any configured part size.
const FILE_SIZE = PART_SIZE + 1024;
// Part size limits (≥ 5 MiB) are only enforced when completing the upload.
const UPLOADED_BYTES = 1024;

// Spec: nestjs-project/specs/videos-upload-parts.plan.md (SI-03.6)
describe('videos-upload-parts', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: AuthenticatedUser;
  let other: AuthenticatedUser;
  let publicId: string;
  let partCount: number;

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
    other = await createAuthenticatedUser(app);

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        filename: 'clip.mp4',
        fileSize: FILE_SIZE,
        contentType: 'video/mp4',
      })
      .expect(201);
    ({ publicId, partCount } = res.body as {
      publicId: string;
      partCount: number;
    });
  });

  const requestPartUrls = (token: string, partNumbers: number[]) =>
    request(app.getHttpServer())
      .post(`/videos/${publicId}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partNumbers });

  // 1.1 — Covers AC #1
  it('issues-urls-for-requested-parts', async () => {
    const res = await requestPartUrls(owner.accessToken, [1, 2]).expect(200);

    const body = res.body as PartUrlsBody;
    expect(body.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    for (const part of body.parts) {
      expect(part.url).toEqual(expect.any(String));
      expect(part.url.length).toBeGreaterThan(0);
    }
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  // 1.2 — Covers AC #2, #3
  it('uploaded-part-is-accepted-and-listed', async () => {
    const urls = (await requestPartUrls(owner.accessToken, [1]).expect(200))
      .body as PartUrlsBody;

    const put = await fetch(urls.parts[0].url, {
      method: 'PUT',
      body: Buffer.alloc(UPLOADED_BYTES, 'p'),
    });
    expect(put.status).toBe(200);
    const eTag = put.headers.get('etag');
    expect(eTag).toBeTruthy();

    const listed = await request(app.getHttpServer())
      .get(`/videos/${publicId}/upload/parts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect((listed.body as UploadedPartsBody).parts).toContainEqual({
      partNumber: 1,
      eTag,
      size: UPLOADED_BYTES,
    });
  });

  // 1.3 — Covers AC #4
  it('rejects-part-number-above-part-count', async () => {
    const res = await requestPartUrls(owner.accessToken, [
      partCount + 1,
    ]).expect(400);
    expect((res.body as { error: string }).error).toBe('INVALID_PART_NUMBER');
  });

  // 1.4 — Covers AC #5
  it('hides-video-from-other-user', async () => {
    const post = await requestPartUrls(other.accessToken, [1]).expect(404);
    expect((post.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');

    const get = await request(app.getHttpServer())
      .get(`/videos/${publicId}/upload/parts`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    expect((get.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });
});
