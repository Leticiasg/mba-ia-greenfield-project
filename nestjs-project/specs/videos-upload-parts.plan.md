---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/videos-upload-parts.e2e-spec.ts
---

# Upload Parts Endpoints Test Plan

## Application Overview

`POST /videos/:publicId/upload/parts` issues short-lived presigned `UploadPart` URLs for the requested part numbers, so the client sends each part straight to MinIO. `GET /videos/:publicId/upload/parts` lists the parts already stored, letting a client resume after a dropped connection. Both are owner-only and only valid while the video is `draft`.

## Test Scenarios

### 1. Part URLs and listing

**Setup:** `beforeEach` truncates the test DB tables; bootstrap `AppModule` reproducing `main.ts` global config; create two confirmed users (owner and other) with channels and obtain both access tokens; as the owner, `POST /videos` with `fileSize: 12582912` (≥ 2 parts at the default part size) and keep `publicId`/`partCount`. `NODE_ENV=test` makes presigned URLs use `http://minio:9000`.

#### 1.1. issues-urls-for-requested-parts

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos/:publicId/upload/parts as owner with `{ "partNumbers": [1, 2] }`
    - expect: status `200`
    - expect: body `parts` has 2 entries with `partNumber` 1 and 2 and a non-empty `url`
    - expect: body `expiresAt` is an ISO-8601 date in the future

#### 1.2. uploaded-part-is-accepted-and-listed

**Covers AC:** #2, #3
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. Request the URL for part 1, then `PUT` `partSize` bytes of filler data to it
    - expect: storage responds `200` with an `ETag` header
  2. GET /videos/:publicId/upload/parts as owner
    - expect: status `200`
    - expect: `parts` contains `{ partNumber: 1, eTag: <same ETag>, size: partSize }`

#### 1.3. rejects-part-number-above-part-count

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos/:publicId/upload/parts as owner with `{ "partNumbers": [partCount + 1] }`
    - expect: status `400`
    - expect: body `error` is `"INVALID_PART_NUMBER"`

#### 1.4. hides-video-from-other-user

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-24T12:31:39Z

**Steps:**
  1. POST /videos/:publicId/upload/parts as the other user with `{ "partNumbers": [1] }`
    - expect: status `404`
    - expect: body `error` is `"VIDEO_NOT_FOUND"`
  2. GET /videos/:publicId/upload/parts as the other user
    - expect: status `404`
    - expect: body `error` is `"VIDEO_NOT_FOUND"`
