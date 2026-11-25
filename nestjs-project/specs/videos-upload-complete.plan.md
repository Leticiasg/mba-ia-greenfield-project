---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: nestjs-project/test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/:publicId/upload/complete Test Plan

## Application Overview

`POST /videos/:publicId/upload/complete` closes the multipart upload, re-checks the stored object size, moves the video from `draft` to `processing` and enqueues the `video.process` job on the `video-processing` queue with `jobId` equal to the video id. It is the trigger of the automatic processing.

## Test Scenarios

### 1. Upload completion

**Setup:** `beforeEach` truncates the test DB tables; bootstrap `AppModule` reproducing `main.ts` global config; create a confirmed user with channel and access token. Helper: `POST /videos` with a small `fileSize` (single part), request the part URL and `PUT` exactly `fileSize` bytes, keeping the returned `ETag`. Before each completion request, start a BullMQ `QueueEvents` listener on `video-processing` to capture `added` events (the running `video-worker` may consume the job immediately, so the queue is observed through events, not `getJob`).

#### 1.1. completes-and-enqueues-processing

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos/:publicId/upload/complete with `{ "parts": [{ "partNumber": 1, "eTag": "<etag>" }] }`
    - expect: status `202`
    - expect: body `{ publicId, status: "processing" }`
  2. Read the `videos` row
    - expect: `status` is `processing` (or already advanced by the worker to `ready`/`error`), and `upload_id` is null
  3. Inspect the captured `added` events
    - expect: exactly one job named `video.process` with `jobId` equal to the video id and payload `{ "videoId": "<id>" }`

#### 1.2. rejects-second-completion

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. Complete the upload once (as in 1.1), then send the same request again
    - expect: second response status `409`
    - expect: body `error` is `"INVALID_VIDEO_STATUS"`
    - expect: no second `added` event for that `jobId`

#### 1.3. rejects-wrong-etag

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos/:publicId/upload/complete with `{ "parts": [{ "partNumber": 1, "eTag": "\"0000\"" }] }`
    - expect: status `400`
    - expect: body `error` is `"UPLOAD_INCOMPLETE"`
  2. Read the `videos` row
    - expect: `status` is still `draft`
    - expect: no `added` event was captured

#### 1.4. size-mismatch-moves-video-to-error

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. `POST /videos` declaring `fileSize: 2048`, then `PUT` only 1024 bytes to part 1 and complete with its `ETag`
    - expect: status `400`
    - expect: body `error` is `"UPLOAD_SIZE_MISMATCH"`
  2. Read the `videos` row and `HeadObject` on `video_key`
    - expect: `status = 'error'` and `error_reason = 'UPLOAD_SIZE_MISMATCH'`
    - expect: `HeadObject` fails with not found (object removed)
