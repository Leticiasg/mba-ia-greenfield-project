---
libs:
  "bullmq":
    version: "^6.7.10"
    context7_id: "/websites/bullmq_io"
    fetched_at: "2026-11-24T08:48:58-03:00"
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/docs.nestjs.com/__branch__11.0.0"
    fetched_at: "2026-11-24T08:48:58-03:00"
  "ioredis":
    version: "^5.11.1"
    context7_id: "/websites/bullmq_io"
    fetched_at: "2026-11-24T08:48:58-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1176.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-24T08:48:58-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1176.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-24T08:48:58-03:00"
  "fluent-ffmpeg":
    version: "2.1.3"
    context7_id: "/fluent-ffmpeg/node-fluent-ffmpeg"
    fetched_at: "2026-11-24T08:48:58-03:00"
  "@types/fluent-ffmpeg":
    version: "^2.1.28"
    context7_id: "—"
    fetched_at: "2026-11-24T08:48:58-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-24T09:00:29-03:00"
---

# Library References — phase-03-videos

Versions are the latest published on npm on 2026-11-24 (`npm view <pkg> version`); none of these packages is installed yet in `nestjs-project/`. Peer compatibility checked: `@nestjs/bullmq@11.0.5` declares peers `@nestjs/common|core ^10 || ^11` and `bullmq ^3 || ^4 || ^5 || ^6` — compatible with the installed NestJS 11.1.16.

**Version change during implementation (SI-03.7, 2026-11-24):** `@nestjs/bullmq` was first pinned at `^12.0.2`, but 12.x (and its `@nestjs/bull-shared` 12.x) is published as an ES module only (`"type": "module"`), which the project's CommonJS Jest setup cannot load. Pinned to `^11.0.5` (last 11.x, CommonJS, same API) with the user's approval.

**Added during implementation (SI-03.7, 2026-11-24):** `ioredis@^5.11.1`. BullMQ 6 declares `ioredis` as an optional peer dependency (`>=5.0.0`) and does not install it; without it every `Queue`/`QueueEvents` fails with "BullMQ could not load the optional 'ioredis' package".

Infrastructure images pinned by the decisions (not npm libraries, listed for completeness):

- Object storage: `cgr.dev/chainguard/minio@sha256:f2e56aceb4d38ad9b05c901270946e2353b19f86ba4396f25cf75b15b455b38c` (TD-11). Bucket bootstrap client, if an init container is used: `cgr.dev/chainguard/minio-client@sha256:69e686e3bf20ed53d95c3eeab497f4ea89eddb3c3540000652c11b7a6fe8edb3`.
- Queue broker: `redis:8.2-alpine@sha256:da23c2478319ceb4903857d77a2fd7aa5137d9e9d4c8165dafbacedac6403e95`, with `maxmemory-policy noeviction` (TD-01 revision 2026-11-24).
- FFmpeg/ffprobe: Debian `ffmpeg` package installed via apt in the worker image (TD-05, TD-06).

### bullmq

Used by: `phase-03-videos/TD-01`, `TD-12`.

- Jobs are retried only when `attempts > 1`; default `attempts` is `1`. Set retry policy with `defaultJobOptions: { attempts, backoff: { type: 'exponential', delay } }` on the queue or per job. Exponential delay = `2^(attemptsMade-1) * delay`.
- Throwing `UnrecoverableError` from the processor moves the job straight to `failed`, ignoring remaining attempts — use it for invalid media (TD-12).
- `jobId` makes `add()` idempotent: adding a job whose id already exists is ignored. Avoid `:` and digit-only ids. Jobs removed via `removeOnComplete` / `removeOnFail` no longer count as existing (duplicates become possible again).
- Redis **must** run with `maxmemory-policy noeviction`; it is the only setting that guarantees correct queue behavior.
- `worker.close()` waits for active jobs to finish (graceful shutdown); jobs interrupted mid-run are recovered as stalled.

### @nestjs/bullmq

Used by: `phase-03-videos/TD-01`, `TD-05`.

- `BullModule.forRootAsync({ useFactory: () => ({ connection: { host, port } }) })` configures the shared connection; `BullModule.registerQueue({ name })` registers a queue whose name is the injection token.
- Producer: `@InjectQueue('name') private queue: Queue` (type `Queue` from `bullmq`).
- Consumer: `@Processor('name') class X extends WorkerHost { async process(job: Job) {...} }`, registered as a provider. Lifecycle events via `@OnWorkerEvent('completed' | 'failed' | ...)`.
- Docs discrepancy found: the Nest 11 "Queues" page shows `registerQueueAsync` with a `redis:` key (legacy Bull shape) while `forRootAsync` uses `connection:` — follow `connection:` (BullMQ shape).
- Context7 serves the Nest docs branch 11.0.0; installed Nest is 11.1.16 — no API difference found for the surfaces above.

### @aws-sdk/client-s3

Used by: `phase-03-videos/TD-02`, `TD-03`, `TD-07`, `TD-09`, `TD-10`, `TD-14`.

- Client for S3-compatible storage: `new S3Client({ endpoint, region, forcePathStyle: true, credentials })` (`forcePathStyle` puts the bucket in the URL path, required for MinIO). Two clients per TD-10: internal endpoint for server calls, public endpoint only for presigning.
- Multipart flow: `CreateMultipartUploadCommand` → `UploadPartCommand` (presigned, client-side) → `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ ETag, PartNumber }] } })`. Parts must be sorted ascending by `PartNumber` (1–10,000). Also: `AbortMultipartUploadCommand`, `ListPartsCommand` (resume), `HeadObjectCommand` (`ContentLength` to re-check size at complete, TD-03).
- Browser clients need bucket CORS exposing the `ETag` response header (not needed for the backend-only scope of this phase).
- Limits (S3/MinIO): part size 5 MiB–5 GiB (last part may be smaller), max 10,000 parts; single `PUT` capped at 5 GB on AWS S3.
- `GetObjectCommand` supports `ResponseContentDisposition` (download as attachment, TD-14) — these overrides only work on signed requests (presigned URL).

### @aws-sdk/s3-request-presigner

Used by: `phase-03-videos/TD-02`, `TD-03`, `TD-07`, `TD-14`.

- `getSignedUrl(client, command, { expiresIn })`; `expiresIn` defaults to 900 s.
- Presigned requests are signed with `UNSIGNED-PAYLOAD` and `content-type` is unsignable, so part integrity is not enforced by the signature (checksums are optional).
- The URL host is part of the SigV4 signature: sign with the client whose endpoint the consumer will reach (TD-10; in `NODE_ENV=test` both endpoints are the internal one).

### fluent-ffmpeg

Used by: `phase-03-videos/TD-06` (chosen as a deliberate divergence; see its Note).

- **Deprecated on npm ("Package no longer supported") and repository archived.** Pin the exact version `2.1.3`; it still wraps the system `ffmpeg`/`ffprobe` binaries, which must be installed in the worker image.
- `ffmpeg.ffprobe(input, (err, data) => ...)` returns the same shape as `ffprobe -print_format json -show_streams -show_format` (`data.format.duration`, `data.streams[].codec_type/width/height/codec_name`). Callback-based — wrap in a Promise.
- Thumbnail: `.screenshots({ timestamps: [seconds | 'NN%'], filename, folder, size })` writes image files (default PNG; the extension in `filename` selects the format). Alternative for a single frame: `.seekInput(t).frames(1).output(path)`. Percent timemarks (`'10%'`) match TD-08 directly.
- `setFfmpegPath` / `setFfprobePath` set binary paths when not on `PATH`.

### @types/fluent-ffmpeg

Used by: `phase-03-videos/TD-06`. Type definitions only (DefinitelyTyped); no runtime docs. Dev dependency.
