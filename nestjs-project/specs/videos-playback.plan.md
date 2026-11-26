---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: nestjs-project/test/videos-playback.e2e-spec.ts
---

# Video Status, Streaming, Download and Thumbnail Test Plan

## Application Overview

`GET /videos/:publicId` returns the owner's view of a video and its processing status. `GET /videos/:publicId/stream`, `/download` and `/thumbnail` redirect (`302`) to short-lived presigned URLs, so MinIO serves the bytes and answers `Range` requests with `206 Partial Content`. All are owner-only; playback requires `status = 'ready'`.

## Test Scenarios

### 1. Status and playback

**Setup:** `beforeEach` truncates the test DB tables; bootstrap `AppModule` reproducing `main.ts` global config; create two confirmed users (owner and other) with channels and tokens. Seed directly (no worker): one `ready` video in the owner's channel with `original_filename: "clip.mp4"`, `duration_seconds`, `metadata`, and objects `videos/{id}/original` (1 KB of known bytes) and `thumbnails/{id}.jpg` put into MinIO via `StorageService`; one `processing` video in the same channel. `NODE_ENV=test` makes presigned URLs use `http://minio:9000`, so the test follows `Location` from inside the container.

#### 1.1. returns-ready-video-status

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. GET /videos/:publicId (ready video) as owner
    - expect: status `200`
    - expect: body has `status: "ready"`, numeric `durationSeconds` and `metadata` with the keys `width`, `height`, `videoCodec`, `audioCodec`, `formatName`, `bitRate`, `frameRate`, `sizeBytes`

#### 1.2. stream-redirect-serves-partial-content

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. GET /videos/:publicId/stream as owner (do not follow redirects)
    - expect: status `302` with a `Location` header
  2. GET the `Location` URL with header `Range: bytes=0-99`
    - expect: status `206`
    - expect: `Content-Range` starts with `bytes 0-99/`
    - expect: body length is 100 bytes and matches the first 100 seeded bytes

#### 1.3. download-redirect-sets-attachment

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. GET /videos/:publicId/download as owner (do not follow redirects)
    - expect: status `302`
  2. GET the `Location` URL
    - expect: status `200`
    - expect: `Content-Disposition` contains `attachment` and `filename="clip.mp4"`

#### 1.4. stream-rejected-while-processing

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. GET /videos/:publicId/stream for the `processing` video as owner
    - expect: status `409`
    - expect: body `error` is `"VIDEO_NOT_READY"`

#### 1.5. hides-video-from-others-and-anonymous

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. GET /videos/:publicId (ready video) as the other user
    - expect: status `404`
    - expect: body `error` is `"VIDEO_NOT_FOUND"`
  2. GET /videos/:publicId without `Authorization`
    - expect: status `401`

#### 1.6. status-polling-is-not-rate-limited

**Covers AC:** — (regression: the app-wide `ThrottlerGuard` allows 10 requests per minute)
**Source:** manual
**Last sync:** 2026-11-26T00:00:00Z

**Steps:**
  1. GET /videos/:publicId (ready video) as owner, 12 times in a row
    - expect: status `200` on every request (never `429`)
