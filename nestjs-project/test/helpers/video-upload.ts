import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

export interface UploadedVideo {
  publicId: string;
  /** Hosts the client PUT the parts to (must be storage, never the API). */
  partHosts: string[];
  completeStatus: number;
}

/**
 * Runs the client side of the upload: POST /videos, request part URLs,
 * PUT each slice straight to storage, then complete (phase-03-videos/TD-02).
 */
export async function uploadVideo(
  app: INestApplication<App>,
  accessToken: string,
  file: Buffer,
  filename: string,
  contentType = 'video/mp4',
): Promise<UploadedVideo> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const created = await request(app.getHttpServer())
    .post('/videos')
    .set(auth)
    .send({ filename, fileSize: file.length, contentType })
    .expect(201);
  const { publicId, partSize, partCount } = created.body as {
    publicId: string;
    partSize: number;
    partCount: number;
  };

  const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
  const urls = await request(app.getHttpServer())
    .post(`/videos/${publicId}/upload/parts`)
    .set(auth)
    .send({ partNumbers })
    .expect(200);
  const parts = (urls.body as { parts: { partNumber: number; url: string }[] })
    .parts;

  const partHosts: string[] = [];
  const completed: { partNumber: number; eTag: string }[] = [];
  for (const { partNumber, url } of parts) {
    partHosts.push(new URL(url).host);
    const slice = file.subarray(
      (partNumber - 1) * partSize,
      Math.min(partNumber * partSize, file.length),
    );
    const put = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(slice),
    });
    if (put.status !== 200) {
      throw new Error(`Part ${partNumber} upload failed: ${put.status}`);
    }
    completed.push({ partNumber, eTag: put.headers.get('etag')! });
  }

  const complete = await request(app.getHttpServer())
    .post(`/videos/${publicId}/upload/complete`)
    .set(auth)
    .send({ parts: completed });

  return { publicId, partHosts, completeStatus: complete.status };
}

export interface VideoStatusBody {
  status: string;
  errorReason: string | null;
  durationSeconds: number | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Polls GET /videos/:publicId until the status leaves `processing` or the
 * timeout expires (phase-03-videos/TD-16 — e2e waits for the real worker).
 */
export async function waitForProcessing(
  app: INestApplication<App>,
  accessToken: string,
  publicId: string,
  timeoutMs = 60000,
): Promise<VideoStatusBody> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = res.body as VideoStatusBody;
    if (body.status !== 'processing' || Date.now() > deadline) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
