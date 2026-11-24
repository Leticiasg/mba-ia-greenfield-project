---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: nestjs-project/test/videos-pipeline.e2e-spec.ts
---

# Video Pipeline End-to-End Test Plan

## Application Overview

The full Phase 03 flow against the real Compose stack: the client starts an upload, sends the bytes straight to MinIO through presigned part URLs, completes the upload, and the separate `video-worker` container picks up the job, runs ffprobe/ffmpeg, stores the thumbnail and marks the video `ready` (or `error` for invalid media). The API never receives the video bytes.

## Test Scenarios

### 1. Upload → processing → streaming

**Setup:** requires `minio`, `redis` and `video-worker` running (`docker compose up -d`) with current code (the worker runs with `node --watch`). `beforeEach` truncates the test DB tables; bootstrap `AppModule` reproducing `main.ts` global config; create a confirmed user with channel and token. Fixtures: `test/fixtures/sample.mp4` (2 s, 320x240) and `test/fixtures/not-a-video.mp4` (text bytes). Helpers from `test/helpers/`: multipart upload through the returned URLs, and a status poller on `GET /videos/:publicId` with a bounded timeout (e.g., 60 s) that stops when the status leaves `processing`. Jest timeout raised for this file.

#### 1.1. valid-video-becomes-ready-with-thumbnail-and-streams

**Covers AC:** #1, #3
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos with `filename: "sample.mp4"`, `fileSize` = fixture size, `contentType: "video/mp4"`
    - expect: status `201` with `publicId` and `partCount`
  2. Request part URLs, `PUT` each part of the fixture to its URL (straight to MinIO), then POST /videos/:publicId/upload/complete with the collected `eTag`s
    - expect: every part `PUT` targets the storage host, not the API
    - expect: completion returns `202` with `status: "processing"`
  3. Poll GET /videos/:publicId until the status leaves `processing`
    - expect: final `status: "ready"` within the timeout
    - expect: `durationSeconds` is about 2 and `metadata.width = 320`, `metadata.height = 240`
  4. GET /videos/:publicId/thumbnail and follow `Location`
    - expect: `302`, then `200` with a JPEG body (starts with bytes `FF D8 FF`)
  5. GET /videos/:publicId/stream and follow `Location` with `Range: bytes=0-1023`
    - expect: `206` with `Content-Range: bytes 0-1023/<fixture size>` and 1024 bytes

#### 1.2. invalid-media-ends-in-error

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. Upload `not-a-video.mp4` through the same flow (declaring `contentType: "video/mp4"`) and complete it
    - expect: completion returns `202`
  2. Poll GET /videos/:publicId until the status leaves `processing`
    - expect: final `status: "error"` and `errorReason: "INVALID_MEDIA"`
  3. GET /videos/:publicId/stream
    - expect: `409` with `error: "VIDEO_NOT_READY"`
