---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: nestjs-project/test/videos-create.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

`POST /videos` starts a video upload without receiving the file: it pre-registers the video as `draft` in the caller's channel, opens an S3 multipart upload in MinIO and returns the upload plan (`publicId`, `partSize`, `partCount`). It is the entry point of the 10GB direct-to-storage upload flow.

## Test Scenarios

### 1. POST /videos

**Setup:** `beforeEach` truncates the test DB tables; bootstrap the full `AppModule` via `Test.createTestingModule(...).compile()` reproducing `main.ts` global config (ValidationPipe + exception filters); create a confirmed user with its channel and obtain an access token via `POST /auth/login`. MinIO and Redis from Compose are real.

#### 1.1. creates-draft-and-returns-upload-plan

**Covers AC:** #1, #6
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos with `Authorization: Bearer <token>` and body `{ "filename": "clip.mp4", "fileSize": 12582912, "contentType": "video/mp4", "title": "My clip" }`
    - expect: status `201`
    - expect: body has `publicId` matching `^[A-Za-z0-9_-]{11}$`, `title: "My clip"`, `status: "draft"`, `partSize` equal to `VIDEO_UPLOAD_PART_SIZE_BYTES` and `partCount` equal to `ceil(12582912 / partSize)`
  2. Query the `videos` row by `public_id`
    - expect: `status = 'draft'`, `channel_id` equals the user's channel id, `upload_id` is not null, `video_key = 'videos/{id}/original'`
  3. Call S3 `ListParts` on `video_key` with the stored `upload_id`
    - expect: the call succeeds (multipart upload is open) with zero parts

#### 1.2. defaults-title-to-filename-without-extension

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos with body `{ "filename": "holiday.trip.mov", "fileSize": 1048576, "contentType": "video/quicktime" }` (no `title`)
    - expect: status `201`
    - expect: body `title` is `"holiday.trip"`

#### 1.3. rejects-file-above-max-size

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos with `fileSize` equal to `VIDEO_MAX_SIZE_BYTES + 1`, `filename: "big.mp4"`, `contentType: "video/mp4"`
    - expect: status `400`
    - expect: body `{ statusCode: 400, error: "FILE_TOO_LARGE" }`
  2. Count rows in `videos`
    - expect: `0`

#### 1.4. rejects-non-video-content-type

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos with `{ "filename": "doc.pdf", "fileSize": 1024, "contentType": "application/pdf" }`
    - expect: status `400`
    - expect: body `error` is `"VALIDATION_ERROR"` and `message` mentions `contentType`

#### 1.5. requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos with a valid body and no `Authorization` header
    - expect: status `401`
