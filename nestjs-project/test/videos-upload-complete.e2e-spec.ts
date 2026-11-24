import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  captureAddedJobs,
  waitFor,
  type QueueEventsCapture,
} from '../src/test/queue-events-capture';
import { Video } from '../src/videos/entities/video.entity';
import {
  createAuthenticatedUser,
  createE2eApp,
  type AuthenticatedUser,
} from './helpers/e2e-app';

interface UploadedDraft {
  publicId: string;
  eTag: string;
}

// Spec: nestjs-project/specs/videos-upload-complete.plan.md (SI-03.7)
describe('videos-upload-complete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: AuthenticatedUser;
  let capture: QueueEventsCapture;

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
    capture = await captureAddedJobs();
  });

  afterEach(async () => {
    await capture.close();
  });

  const auth = () => ({ Authorization: `Bearer ${owner.accessToken}` });

  /** POST /videos declaring `declaredSize`, then PUT `uploadedBytes` to part 1. */
  const createDraftWithPart = async (
    declaredSize: number,
    uploadedBytes: number,
  ): Promise<UploadedDraft> => {
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set(auth())
      .send({
        filename: 'clip.mp4',
        fileSize: declaredSize,
        contentType: 'video/mp4',
      })
      .expect(201);
    const { publicId } = created.body as { publicId: string };

    const urls = await request(app.getHttpServer())
      .post(`/videos/${publicId}/upload/parts`)
      .set(auth())
      .send({ partNumbers: [1] })
      .expect(200);
    const [{ url }] = (urls.body as { parts: { url: string }[] }).parts;

    const put = await fetch(url, {
      method: 'PUT',
      body: Buffer.alloc(uploadedBytes, 'u'),
    });
    expect(put.status).toBe(200);
    return { publicId, eTag: put.headers.get('etag')! };
  };

  const complete = (publicId: string, eTag: string) =>
    request(app.getHttpServer())
      .post(`/videos/${publicId}/upload/complete`)
      .set(auth())
      .send({ parts: [{ partNumber: 1, eTag }] });

  const findVideo = (publicId: string) =>
    dataSource.getRepository(Video).findOneByOrFail({ public_id: publicId });

  // 1.1 — Covers AC #1, #2
  it('completes-and-enqueues-processing', async () => {
    const draft = await createDraftWithPart(2048, 2048);

    const res = await complete(draft.publicId, draft.eTag).expect(202);
    expect(res.body).toEqual({
      publicId: draft.publicId,
      status: 'processing',
    });

    const video = await findVideo(draft.publicId);
    // The running video-worker may already have advanced the status.
    expect(['processing', 'ready', 'error']).toContain(video.status);
    expect(video.upload_id).toBeNull();

    await waitFor(() => capture.added.some((e) => e.jobId === video.id));
    const jobs = capture.added.filter((e) => e.jobId === video.id);
    expect(jobs).toEqual([{ jobId: video.id, name: 'video.process' }]);
  });

  // 1.2 — Covers AC #3
  it('rejects-second-completion', async () => {
    const draft = await createDraftWithPart(2048, 2048);
    await complete(draft.publicId, draft.eTag).expect(202);

    const res = await complete(draft.publicId, draft.eTag).expect(409);
    expect((res.body as { error: string }).error).toBe('INVALID_VIDEO_STATUS');

    const video = await findVideo(draft.publicId);
    await waitFor(() => capture.added.some((e) => e.jobId === video.id));
    expect(capture.added.filter((e) => e.jobId === video.id)).toHaveLength(1);
  });

  // 1.3 — Covers AC #4
  it('rejects-wrong-etag', async () => {
    const draft = await createDraftWithPart(2048, 2048);

    const res = await complete(
      draft.publicId,
      '"00000000000000000000000000000000"',
    ).expect(400);
    expect((res.body as { error: string }).error).toBe('UPLOAD_INCOMPLETE');

    const video = await findVideo(draft.publicId);
    expect(video.status).toBe('draft');
    expect(capture.added.some((e) => e.jobId === video.id)).toBe(false);
  });

  // 1.4 — Covers AC #5
  it('size-mismatch-moves-video-to-error', async () => {
    const draft = await createDraftWithPart(2048, 1024);

    const res = await complete(draft.publicId, draft.eTag).expect(400);
    expect((res.body as { error: string }).error).toBe('UPLOAD_SIZE_MISMATCH');

    const video = await findVideo(draft.publicId);
    expect(video.status).toBe('error');
    expect(video.error_reason).toBe('UPLOAD_SIZE_MISMATCH');
    await expect(
      app.get(StorageService).headObject(video.video_key),
    ).rejects.toThrow();
  });
});
