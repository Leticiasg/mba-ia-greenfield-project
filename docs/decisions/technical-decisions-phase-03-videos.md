---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-24
scope_description: "Backend foundation for video upload and processing: queue technology, direct-to-storage 10GB upload, video worker with ffprobe/ffmpeg, storage layout and presigned URLs, unique public video id, streaming/download delivery and access, and the video status lifecycle with failure handling."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — receives the `videos` module, the `videos` table/migration, the S3-compatible storage integration, the queue producer, the video worker (FFmpeg) and the new Compose services (object storage, queue broker, worker). Every TD below targets this subproject.
- `next-frontend/` — no open decision. The challenge statement (`ENUNCIADO.md`) declares this phase backend-only ("a interface de vídeo não faz parte do escopo desta fase"). The upload/stream HTTP contract defined here is consumed by the frontend in a later phase.

_Inherited constraints (not reopened):_ `@nestjs/config` with namespaced `registerAs` + Joi env validation (phase-01-configuracao-base/TD-01..TD-04); custom JWT guard, global and `@Public()` opt-out (phase-02-auth/TD-02); `{ statusCode, error, message }` domain error envelope (phase-02-auth/TD-07); class-validator DTOs (phase-02-auth/TD-06); OpenAPI via `@nestjs/swagger` (openapi-docs-nestjs/TD-01). Object storage is **S3-compatible, MinIO locally** — given by the challenge, not a decision here; only *how* to use it is decided.

_Installed versions checked (`nestjs-project/package-lock.json`):_ `@nestjs/common|core|platform-express` 11.1.16, `@nestjs/config` 4.0.3, `typeorm` 0.3.28, `express` 5.2.1, Node image `node:25.6.0-slim`. **None of the candidate libraries for this phase is installed** (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `bullmq`, `@nestjs/bullmq`, `pg-boss`): documentation was read at the latest versions published on Context7 and exact versions are to be pinned by `plan-resolve` in `library-refs.md`.

_Documentation sources (Context7):_ `/aws/aws-sdk-js-v3`, `/minio/docs`, `/websites/bullmq_io`, `/timgit/pg-boss/12.38.2`, `/nestjs/docs.nestjs.com/__branch__11.0.0`, `/websites/ffmpeg_ffmpeg-all`.

---

## TD-01: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram (`docs/diagrams/software-arch.mermaid`) leaves the Message Queue as "TBD". The API publishes a "process video X" job after upload; a separate worker consumes it. Relevant criteria: what already exists in the stack (PostgreSQL only — no Redis today), delivery guarantees, retry/backoff, dead-letter handling, NestJS integration, cost of one more container, and testability with real infra in Compose. The acceptance criteria also require "Object storage, fila e worker subindo via `docker compose`".

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Redis-backed queue. Producer uses `@InjectQueue()`; consumer is a `@Processor()` class extending `WorkerHost`. Jobs support `attempts` + `backoff` (fixed/exponential), custom `jobId` (duplicate adds are ignored), and `UnrecoverableError` to fail without retrying.
- **Pros:** Official NestJS integration documented in the Nest 11 "Queues" technique. Retry/backoff and permanent-failure semantics built in. Adds a real, visible queue service to Compose (matches the acceptance criterion literally). Easy to test against a real Redis container.
- **Cons:** New infrastructure (Redis container). Redis **must** run with `maxmemory-policy noeviction` (BullMQ "Going to production"), otherwise jobs can be silently evicted. No native dead-letter queue — failed jobs stay in the `failed` set (inspectable) and the final failure is handled in code. Redis image licensing changed in recent releases (Valkey is a drop-in fork) — image choice to be pinned in `plan-resolve`.

### Option B: pg-boss (queue inside PostgreSQL)
- Job queue stored in a `pgboss` schema in the existing PostgreSQL. `createQueue(name, { retryLimit, retryDelay, retryBackoff, deadLetter })`, `send()`, `work()`. Uses `SKIP LOCKED` for exactly-once fetch.
- **Pros:** No new container — reuses PostgreSQL already in the stack. Native dead-letter queue and exponential backoff. Enqueue can share the same database as the `videos` row.
- **Cons:** No official NestJS module (must be wrapped in a custom provider). Queue load competes with the application database. **The queue would not appear as its own service in Compose**, which risks failing the acceptance criterion "storage, fila e worker reais subindo no Compose" as written. Smaller NestJS community footprint.

### Option C: RabbitMQ (`@nestjs/microservices` RMQ transport or `amqplib`)
- AMQP broker as a dedicated container. Durable queues, manual ack, dead-letter exchanges (DLX) and per-message TTL for delayed retries.
- **Pros:** Mature broker with native DLX. Real queue service in Compose. Language-agnostic if the worker is ever rewritten outside Node.
- **Cons:** Nest's RMQ transport is request/event-oriented, not a job queue: retries with backoff, attempt counting and job state must be hand-built (DLX + TTL topology). Heavier operational surface (exchanges, bindings, management UI). Most code for least benefit in a single-consumer job flow.

**Recommendation:** **Option A (BullMQ + Redis)** — it is the only option with an official Nest 11 integration *and* built-in job semantics (attempts, backoff, `jobId` de-duplication, `UnrecoverableError`), and it puts a real queue service in Compose, which the challenge explicitly evaluates. The extra container is cheap locally; the `noeviction` requirement becomes a Compose setting. pg-boss is the better choice if avoiding new infrastructure mattered more than the evaluation criterion — it does not here.

**Decision:** A (BullMQ + Redis via `@nestjs/bullmq`)

**Note:** Decision follows the Recommendation — BullMQ is the only option that combines an official Nest 11 integration with built-in retry/backoff and permanent-failure semantics, and it adds a dedicated queue service to Compose, which the acceptance criteria evaluate.

---

## TD-02: Large-File Upload Protocol (up to 10GB)

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Passing 10GB through the API is an automatic fail ("Passar o arquivo de 10GB pela API de forma que trave o sistema"). `docs/project-plan.md` § Pontos de Atenção also asks that the upload "permita retomar em caso de falha de conexão". Limits that shape the choice: AWS S3 caps a single `PUT` at 5GB; S3/MinIO multipart allows up to 10,000 parts of 5 MiB–5 GiB each (MinIO "Thresholds and Limits"). This TD defines the HTTP handshake any client must follow.

**Options:**

### Option A: Presigned S3 multipart upload (client → storage directly)
- API calls `CreateMultipartUpload`, returns an `uploadId` and presigned `UploadPart` URLs (`getSignedUrl` from `@aws-sdk/s3-request-presigner`). Client `PUT`s each part directly to storage, keeps the returned `ETag`s, and asks the API to complete (`CompleteMultipartUpload`).
- **Pros:** API never touches the bytes. Works for 10GB on both MinIO and real S3. Resumable: failed parts are retried individually and `ListParts` reveals what is already stored. Parallel part uploads.
- **Cons:** Multi-step client protocol (init → parts → complete). Client must read the `ETag` header (CORS must expose it if a browser uploads). Presigned part URLs are signed with `UNSIGNED-PAYLOAD`, so per-part integrity relies on optional checksums. Abandoned uploads leave orphan parts (see TD-12).

### Option B: Single presigned `PUT`
- API returns one presigned `PutObject` URL; client sends the whole file in one request.
- **Pros:** Simplest protocol — one URL, one request. API never touches the bytes.
- **Cons:** AWS S3 rejects single `PUT`s above 5GB — the 10GB requirement would only work on MinIO, not in the production target. No resume: a dropped connection restarts from zero.

### Option C: tus resumable protocol (tusd container or `@tus/server`)
- Client speaks tus (`POST` + `PATCH` with offsets) to a tus server that writes to S3.
- **Pros:** Standard resumable protocol with client libraries.
- **Cons:** Embedded in the API (`@tus/server`), the bytes flow through Node — the exact pattern the challenge forbids. As a separate `tusd` container, it adds a fourth new service plus a hook back to the API to create/complete the draft. Duplicates what S3 multipart already provides.

**Recommendation:** **Option A (presigned multipart)** — the only option that meets 10GB on real S3, keeps the API out of the data path, and gives resume for free via per-part retry and `ListParts`, with no extra service. The handshake complexity lives in the API contract and is testable with small files (the 10GB limit is proven by the strategy plus the size validation of TD-03, not by uploading 10GB in tests).

**Decision:** A (Presigned S3 multipart upload)

**Note:** Decision follows the Recommendation — presigned multipart is the only option that handles 10GB on real S3, keeps the file bytes out of the API (avoiding the automatic-fail condition) and makes uploads resumable without an extra service.

---

## TD-03: Upload Session Policy (size limit, part size, URL issuance and expiry)

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Depends on TD-02 (A). The limits are a cross-component contract: they appear in the Joi env schema, `.env.example`, the init/complete DTOs and the client's chunking logic. 10GB at 5 MiB parts would exceed 10,000 parts, so the part size is not free.

**Options:**

### Option A: Server-defined part size, all part URLs returned at init
- Client declares `fileSize` (validated ≤ `VIDEO_MAX_SIZE_BYTES`, 10GB); server computes `partSize` (e.g., 100 MiB → ≤ 103 parts) and returns every presigned part URL in the init response.
- **Pros:** One round-trip to start; simple client.
- **Cons:** All URLs share one expiry — a slow 10GB upload outlives them, breaking resume. Large response body for big files.

### Option B: Server-defined part size, part URLs issued on demand
- Init returns `uploadId`, `partSize` and `partCount`. Client requests URLs for specific part numbers (`POST /videos/:id/upload/parts` with `partNumbers`) whenever it needs them, including after a reconnect. Complete validates the assembled size with `HeadObject` against the declared size and the 10GB cap.
- **Pros:** Short-lived URLs (minutes) without breaking long uploads; resume after any pause. Server keeps control of the part size and enforces the limit at init *and* at complete.
- **Cons:** One extra endpoint and more round-trips (mitigated by batching part numbers).

**Recommendation:** **Option B** — URL expiry must be decoupled from total upload time for a 10GB file to be resumable; on-demand issuance does that with one small endpoint, and validating the real object size at complete closes the gap of a client lying about `fileSize`.

**Decision:** B (Server-defined part size, part URLs issued on demand, size re-checked at complete)

**Note:** Decision follows the Recommendation — issuing part URLs on demand keeps them short-lived without breaking long 10GB uploads, and re-checking the object size at completion enforces the 10GB limit even if the client misreports `fileSize`.

---

## TD-04: Upload Completion Signal (what triggers processing)

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The draft row is created at init (TD-02/TD-03). Something must move it to `processing` and enqueue the job once the object exists. This affects Compose (storage configuration), the API contract and the status lifecycle (TD-12).

**Options:**

### Option A: Client calls the API to complete
- `POST /videos/:id/upload/complete` with the part `ETag`s. The API calls `CompleteMultipartUpload`, checks size, sets status `processing` and enqueues the job (job id = video id).
- **Pros:** Single, synchronous, testable flow owned by the API. Authorization (only the owner completes) uses the existing JWT guard. No storage-specific configuration.
- **Cons:** If the client never calls complete, the video stays `draft` (handled by TD-12's policy for stale drafts).

### Option B: Storage bucket notification
- MinIO publishes `s3:ObjectCreated:CompleteMultipartUpload` to a webhook (API) or to the queue; the client completes the multipart directly with storage.
- **Pros:** Processing starts even if the client disappears right after the last part.
- **Cons:** MinIO-specific setup (`mc event add` + target config) that differs from AWS (S3 → SNS/SQS/EventBridge), so dev and prod diverge. Webhook endpoint needs its own authentication. Harder to test deterministically. Client would need storage credentials or presigned `CompleteMultipartUpload`, spreading logic across two systems.

**Recommendation:** **Option A** — keeps one portable, guard-protected code path that is identical on MinIO and S3, and lets the API own the `draft → processing` transition in the same request that enqueues the job.

**Decision:** A (Client calls the API complete endpoint)

**Note:** Decision follows the Recommendation — a client-called complete endpoint keeps a single guard-protected, testable flow that behaves the same on MinIO and S3, and lets the API own the `draft → processing` transition together with the enqueue.

---

## TD-05: Worker Runtime and Code Location

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The architecture lists a separate "Video Worker (FFmpeg)" container. The worker needs FFmpeg installed, access to storage and the `videos` table. Today `Dockerfile.dev` ends in `tail -f /dev/null` and has no FFmpeg. The challenge leaves the location "conforme o seu plano".

**Options:**

### Option A: Same NestJS codebase, separate entrypoint and container
- `nestjs-project/src/worker.ts` boots `NestFactory.createApplicationContext(WorkerModule)` (no HTTP listener). A `video-worker` Compose service runs it from an image with `ffmpeg` installed. The worker module imports the shared entity, config namespaces and storage service.
- **Pros:** Reuses entities, TypeORM config, Joi env validation, storage service and test helpers — no duplication. Separate process/container, so CPU-heavy FFmpeg work never runs in the API process. One `package.json`, one lint/tsc/test pipeline (DoD stays a single command set).
- **Cons:** The worker image carries the whole API dependency tree. Module boundaries must be kept clean so the worker does not pull HTTP-only modules.

### Option B: Separate project (`video-worker/` at repo root)
- Independent Node/TS project with its own `package.json`, talking to Redis, MinIO and PostgreSQL.
- **Pros:** Smallest image; strongest isolation; could be rewritten in another language.
- **Cons:** Duplicates the `videos` entity/schema knowledge, config validation and storage client. Second lint/tsc/test pipeline that the DoD must cover. Schema drift risk between two codebases.

### Option C: Processor inside the API process
- Register the `@Processor()` in the API's own module.
- **Pros:** Zero new code location or container for the worker.
- **Cons:** FFmpeg CPU load competes with HTTP requests in the same process; contradicts the architecture's separate worker container and the challenge's "worker subindo via docker compose".

**Recommendation:** **Option A** — gives a real, separate worker container (as the architecture requires) while keeping a single source of truth for the `videos` entity, config and storage code, and a single DoD pipeline.

**Decision:** A (Same NestJS codebase, separate entrypoint and `video-worker` container)

**Note:** Decision follows the Recommendation — a separate container keeps FFmpeg CPU load out of the API (as the architecture requires), while a single codebase avoids duplicating the `videos` entity, config and storage code and keeps one DoD pipeline.

---

## TD-06: FFmpeg/ffprobe Invocation

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker extracts duration/metadata (`ffprobe -print_format json -show_format -show_streams`) and one frame as an image (`ffmpeg -ss <t> -i <input> -frames:v 1`). The choice affects the worker image (Compose/Dockerfile) and the `library-refs.md`.

**Options:**

### Option A: System binaries via `child_process.execFile`
- Install `ffmpeg` (includes `ffprobe`) from the Debian repository in the worker image; call both with `execFile` and argument arrays, parse ffprobe's JSON.
- **Pros:** No npm dependency. Arguments are passed as an array (no shell injection). Uses the official CLI exactly as documented. Version visible via `ffmpeg -version`.
- **Cons:** Thin typed wrapper (args builder, JSON typing, exit-code handling) must be written and unit-tested.

### Option B: `fluent-ffmpeg`
- Fluent Node API over the same binaries (`ffprobe()`, `screenshots()`).
- **Pros:** Familiar API, many examples.
- **Cons:** The package is **deprecated on npm and its repository is archived** (no longer maintained). Callback-based API. Adding an unmaintained dependency to a new phase is a liability.

### Option C: `ffmpeg-static` / `ffprobe-static` npm binaries
- Prebuilt binaries downloaded at `npm install`, paths exported by the packages.
- **Pros:** No apt step; same binary on every machine.
- **Cons:** Postinstall downloads large binaries into the API's `node_modules` too (single `package.json` under TD-05/A). Versions lag upstream. Still needs a wrapper like Option A.

**Recommendation:** **Option A** — the worker image needs a custom Dockerfile anyway (TD-05), so `apt install ffmpeg` is one line; `execFile` with argument arrays is safe and dependency-free, and avoids adopting a deprecated library.

**Decision:** B (`fluent-ffmpeg`)

**Note:** Decision deliberately diverged from the Recommendation — `fluent-ffmpeg` was chosen for familiarity and learning value in the context of this course project, accepting that the package is deprecated on npm and its repository is archived (no maintenance). `fluent-ffmpeg` still shells out to the system binaries, so the worker image must install `ffmpeg`/`ffprobe` via apt (same image requirement as Option A). Its use stays isolated behind a small worker service so it can be swapped for Option A later without touching callers.

---

## TD-07: Worker Input Access (how FFmpeg reads a 10GB object)

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Depends on TD-05 and TD-06. The source object can be 10GB. How the worker feeds it to ffprobe/ffmpeg drives the worker's disk needs (Compose volume) and processing time.

**Options:**

### Option A: Presigned GET URL as FFmpeg input
- Worker generates a short-lived presigned `GetObject` URL (internal endpoint) and passes it as `-i <url>`. FFmpeg's HTTP input issues range requests, so ffprobe reads only headers/index and `-ss` before `-i` seeks without reading the whole file.
- **Pros:** No local copy of 10GB; no large volume for the worker. Fast for metadata and a single frame.
- **Cons:** Some containers (e.g., MP4 with the `moov` atom at the end) need extra range requests; network errors surface as FFmpeg errors and must be treated as retryable.

### Option B: Download to a temporary file first
- Stream `GetObject` to a temp file in a worker volume, run FFmpeg on the local path, delete afterwards.
- **Pros:** FFmpeg works on a local seekable file — the most predictable input.
- **Cons:** Up to 10GB of disk per concurrent job and the full transfer time before any work starts; cleanup on crash must be handled.

**Recommendation:** **Option A** — the phase only needs metadata and one frame, both of which FFmpeg can obtain through range reads; downloading 10GB to read a few megabytes is wasted time and disk. Network failures map onto the retry policy of TD-12.

**Decision:** A (Presigned GET URL as FFmpeg input)

**Note:** Decision follows the Recommendation — the worker only needs metadata and one frame, which FFmpeg reads through range requests; copying up to 10GB to disk first would waste time and require a large worker volume.

---

## TD-08: Thumbnail Frame Selection

**Scope:** Backend

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The plan says "a partir de um frame do vídeo" without saying which one. The first frame is often black (fade-in). The policy determines the ffmpeg arguments and what tests assert.

**Options:**

### Option A: Fixed timestamp (e.g., 1s, clamped to duration)
- `-ss 1` (or `0` when the video is shorter).
- **Pros:** Trivial and deterministic.
- **Cons:** Still frequently lands on intros/black frames.

### Option B: Percentage of duration (e.g., 10%, clamped)
- Use the duration from ffprobe: `-ss = duration × 0.10`, clamped to `[0, duration − ε]`.
- **Pros:** Deterministic, cheap with input seeking, usually past intros. Reuses the ffprobe result already needed for metadata.
- **Cons:** Requires ffprobe to run first (it does anyway); not "content-aware".

### Option C: FFmpeg `thumbnail` filter
- Decode a window of frames and let the `thumbnail` filter pick the most representative one.
- **Pros:** Better visual choice.
- **Cons:** Decodes many frames — slower, especially over HTTP input (TD-07/A); output harder to assert in tests.

**Recommendation:** **Option B** — deterministic and cheap, avoids the black-first-frame problem, and needs no extra decoding. Custom thumbnails are a Phase 04 capability, so a sensible default is enough here.

**Decision:** B (10% of duration, clamped)

**Note:** Decision follows the Recommendation — a frame at 10% of the duration is deterministic, cheap and usually past black intro frames; custom thumbnails belong to Phase 04.

---

## TD-09: Storage Layout (buckets and object keys)

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Bucket names and key patterns are shared by the API (presigning), the worker (read/write), Compose (bucket bootstrap) and env validation. Keys are persisted in the `videos` table.

**Options:**

### Option A: One private bucket, prefixes per kind and video
- Bucket `S3_BUCKET` (e.g., `streamtube`) with `videos/{videoId}/original` and `thumbnails/{videoId}.jpg`. Keys derive from the internal UUID, never from the user's filename.
- **Pros:** One bucket to create, configure and secure. Deterministic keys make worker re-runs idempotent (overwrite the same thumbnail key). User filename kept only as metadata (avoids path/encoding issues).
- **Cons:** Different retention/lifecycle rules per kind must use prefix filters.

### Option B: Two buckets (`videos`, `thumbnails`)
- Separate buckets for originals and thumbnails, same key strategy.
- **Pros:** Independent policies (e.g., public-read thumbnails later).
- **Cons:** Two env vars, two bootstrap steps, two policies — for no requirement of this phase.

**Recommendation:** **Option A** — a single private bucket with UUID-based prefixes covers both file kinds with the least configuration, and deterministic keys support worker idempotency. Bucket creation at startup (init container with `mc` vs. idempotent `CreateBucket` on boot) is an implementation detail for `plan-build`.

**Decision:** A (One private bucket, UUID-based prefixes)

**Note:** Decision follows the Recommendation — one private bucket with UUID-based keys is the least configuration for both file kinds, and deterministic keys make worker re-runs idempotent.

---

## TD-10: Presigned URL Host (internal vs. public storage endpoint)

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Inside Compose the API must reach storage at the service name (`http://minio:9000`, per the `CLAUDE.md` Docker networking rule). But presigned URLs are handed to clients outside the Docker network, and the host is part of the SigV4 signature — a URL signed for `minio:9000` cannot be rewritten to `localhost:9000` afterwards. This touches Compose, the Joi schema, `.env.example` and the storage service.

**Options:**

### Option A: Two endpoints — internal for server calls, public for presigning
- `S3_ENDPOINT=http://minio:9000` for API/worker operations; `S3_PUBLIC_ENDPOINT` (the host-reachable address, e.g., the published port) used by a second `S3Client` that only signs URLs for clients. Both with `forcePathStyle: true`.
- **Pros:** Respects the "service name between containers" rule and still produces URLs that clients can use. Production maps naturally (internal VPC endpoint vs. public S3 endpoint/CDN).
- **Cons:** Two clients/config keys to keep consistent; e2e tests that follow presigned URLs from inside the API container must use the internal-signed variant (or a hostname both sides resolve).

### Option B: One endpoint resolvable from everywhere
- Use a single hostname for storage that resolves both inside Compose and on the host (e.g., add `minio` to the host's `/etc/hosts`, or run storage with `network_mode: host`).
- **Pros:** One client, one URL form.
- **Cons:** Requires manual host configuration on every developer machine, or breaks the Compose network isolation; neither is captured by the repository.

**Recommendation:** **Option A** — it keeps the repository self-contained (no host file edits) and honors the Docker networking rule, at the cost of one extra config key. The e2e test strategy for following URLs is settled in TD-14.

**Decision:** A (Internal endpoint for server calls + public endpoint for presigning)

**Note:** Decision follows the Recommendation — separate internal and public endpoints respect the Docker networking rule (service names between containers) while still producing presigned URLs that clients outside Docker can use, without editing host files.

---

## TD-11: Local S3-Compatible Image Distribution

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The challenge fixes MinIO as the local S3 implementation. However, the MinIO community edition entered maintenance mode in December 2025 and, per several reports, stopped publishing official Docker images in October 2025. The Compose `image:` must point to something that can actually be pulled and pinned.

Registry check on 2026-11-24 (`docker manifest inspect`, metadata only, `postgres:17` as control → available):

| Image | Result |
|---|---|
| `minio/minio:latest` (Docker Hub, official) | unavailable |
| `quay.io/minio/minio:latest` (official mirror) | unavailable (`no such manifest`) |
| `quay.io/minio/mc:latest` (official client) | unavailable (`no such manifest`) |
| `cgr.dev/chainguard/minio:latest` | available — `sha256:f2e56aceb4d38ad9b05c901270946e2353b19f86ba4396f25cf75b15b455b38c` |
| `cgr.dev/chainguard/minio-client:latest` | available — `sha256:69e686e3bf20ed53d95c3eeab497f4ea89eddb3c3540000652c11b7a6fe8edb3` |

**Options:**

### Option A: Pin the last community MinIO release from an official registry (`minio/minio` or `quay.io/minio/minio`)
- Pin an exact release tag (or digest) of the final community build.
- **Pros:** Exactly "MinIO", as the challenge states; identical S3 API behavior to what the docs describe.
- **Cons:** **Not viable** — neither official registry serves the image anymore (see the check above). Even if it did, it would receive no further security fixes.

### Option B: Chainguard-maintained MinIO image (`cgr.dev/chainguard/minio`), pinned by digest
- MinIO rebuilt from source and published by a third party; referenced as `cgr.dev/chainguard/minio@sha256:<digest>`.
- **Pros:** Still MinIO, with ongoing rebuilds; pullable today. Pinning by digest gives a reproducible version even though the free tier only publishes `latest`. A matching `minio-client` (`mc`) image is also available for bucket bootstrap.
- **Cons:** Third-party distribution. The digest must be bumped deliberately to receive fixes. Entrypoint, default command and runtime user may differ from the official image — to be confirmed on first pull, before writing the Compose service.

### Option C: Build the image from MinIO source in the repository
- A Dockerfile that `go install`s a pinned MinIO commit.
- **Pros:** Fully reproducible and pinned by commit.
- **Cons:** Slow first build, Go toolchain in the build, more repo surface for a dev-only dependency.

**Recommendation:** **Option B** — it is the only distribution of MinIO that can be pulled today without building it ourselves, so the challenge's "MinIO in Docker" stays literal. Storage is dev-only here (production target is S3), so depending on a third-party build is acceptable, and the digest pin keeps every environment on the same version. Option C remains the fallback if the Chainguard image becomes unavailable.

**Decision:** B (Chainguard MinIO image pinned by digest) — `cgr.dev/chainguard/minio@sha256:f2e56aceb4d38ad9b05c901270946e2353b19f86ba4396f25cf75b15b455b38c`. Entrypoint, command and runtime user to be confirmed on first pull; the digest is to be recorded in `library-refs.md` by `plan-resolve`.

**Note:** Decision follows the (updated) Recommendation — the official MinIO registries no longer serve the image (checked on 2026-11-24), and the Chainguard build is the only MinIO distribution that can be pulled today without building from source.

---

## TD-12: Video Status Lifecycle and Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The challenge requires `draft → processing → ready/error` reflected in the database. Queues deliver at least once, so the worker must be idempotent. Phase 04 introduces a *publication* flow ("rascunho → publicação") — a second meaning of "draft" that must not collide with this one. MinIO does not support the `AbortIncompleteMultipartUpload` lifecycle action, so abandoned uploads are not cleaned up by storage.

**Options:**

### Option A: Single `status` enum for the upload/processing pipeline; retries then terminal `error`
- `status ∈ {draft, processing, ready, error}` plus `error_reason`. Transitions are conditional updates (`UPDATE … WHERE id = ? AND status = 'processing'`), so duplicates are no-ops. Job uses `attempts` + exponential `backoff` for transient errors (storage/network); invalid media (ffprobe finds no video stream / non-zero exit on parse) throws `UnrecoverableError` and goes straight to `error`. The final failure handler marks `error`. Publication/visibility (Phase 04) will be a separate column, not new values of this enum. Abandoned drafts: an owner-only `DELETE` aborting the multipart is in scope; automatic expiry of stale drafts is recorded as a separate future task.
- **Pros:** Exactly the four states the challenge names. Idempotent by construction (conditional transition + deterministic keys from TD-09). Distinguishes transient vs. permanent failures. Keeps Phase 04 free to model publication independently.
- **Cons:** Stale drafts accumulate until the future cleanup task exists.

### Option B: Two columns — `upload_status` and `processing_status`
- Separate state machines for upload (`pending/uploaded/aborted`) and processing (`pending/running/done/failed`).
- **Pros:** Finer-grained diagnostics.
- **Cons:** Combinatorial states to validate; diverges from the four-state cycle the challenge evaluates; more API surface for clients.

### Option C: Single enum, fail fast (no retries)
- Any worker exception marks `error`; a manual "reprocess" endpoint re-enqueues.
- **Pros:** Simplest worker.
- **Cons:** A transient MinIO/Redis blip permanently fails a valid 10GB upload; needs an extra endpoint to recover.

**Recommendation:** **Option A** — matches the evaluated cycle one-to-one, survives transient failures automatically, gives an immediate `error` for invalid files, and avoids overloading "draft" with Phase 04's publication meaning.

**Decision:** A (Single 4-state enum; retries with backoff for transient errors, immediate `error` for invalid media)

**Note:** Decision follows the Recommendation — the four states match the cycle the challenge evaluates; retries absorb transient failures, invalid media fails fast, conditional transitions make duplicate deliveries harmless, and Phase 04 publication stays in a separate column.

---

## TD-13: Unique Public Video Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** `docs/project-plan.md` § Pontos de Atenção asks for "uma URL curta e única que nunca conflite com outro vídeo". The identifier appears in every public route (`/videos/:id/...`), in the `videos` table (unique index) and later in frontend URLs — a cross-component contract.

**Options:**

### Option A: Expose the UUID primary key
- Routes use the existing `uuid` PK (`PrimaryGeneratedColumn('uuid')`, as in `Channel`).
- **Pros:** Zero extra column; uniqueness guaranteed by the PK.
- **Cons:** 36 characters — not "short"; leaks the internal id.

### Option B: Random short id (base64url, ~11 chars) in a unique column
- Generate 8 random bytes with `node:crypto` → 11-char base64url string (64 bits), stored in a `public_id`/`slug` column with a unique index; on the (astronomically rare) unique-violation, regenerate and retry a bounded number of times.
- **Pros:** Short, URL-safe, non-sequential (not enumerable). Uniqueness enforced by the database, not by probability alone. No dependency (avoids ESM-only libraries such as `nanoid` v5 in this CommonJS build).
- **Cons:** Extra column and retry loop.

### Option C: Encoded sequential integer (Sqids/Hashids)
- Add a serial column and encode it into a short string.
- **Pros:** Short and collision-free by construction.
- **Cons:** Sequential ids are decodable/enumerable; adds a dependency and a second id column anyway.

**Recommendation:** **Option B** — the only option that is short, non-enumerable and guaranteed unique by a database constraint, with no new dependency.

**Decision:** B (Random base64url short id in a unique column)

**Note:** Decision follows the Recommendation — an 11-character random base64url id is short, non-enumerable and unique by database constraint, with no new dependency.

---

## TD-14: Streaming and Download Delivery

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Streaming needs HTTP `Range` → `206 Partial Content` with `Content-Range`. The architecture diagram already draws "Frontend → Object Storage: Streams". The trade-off is access control vs. load on the API.

**Options:**

### Option A: Redirect to a short-lived presigned GET URL
- `GET /videos/:publicId/stream` checks access, then `302` to a presigned `GetObject` URL (minutes of validity). `GET /videos/:publicId/download` does the same with `ResponseContentDisposition: attachment; filename="…"`. Storage answers `Range` requests with `206` natively.
- **Pros:** API stays out of the byte path (consistent with TD-02). Range/206, seeking and resume are handled by S3/MinIO. Access check still happens on every new URL. Matches the architecture diagram.
- **Cons:** URL is shareable until it expires; two hops for the client; tests must follow the redirect against the storage host (see TD-10).

### Option B: API proxies the range to storage
- API parses `Range`, calls `GetObject` with `Range`, pipes the body through `StreamableFile` and sets `206`, `Content-Range`, `Accept-Ranges`.
- **Pros:** Single origin; no URL leakage; full control of headers.
- **Cons:** Every byte of every viewer flows through Node — the load the upload strategy was designed to avoid. Range parsing/edge cases are hand-written.

### Option C: Public-read bucket, direct object URL
- Objects are publicly readable; API returns the plain URL.
- **Pros:** Simplest; cacheable by a CDN.
- **Cons:** No access control at all — drafts and failed uploads become reachable; conflicts with Phase 04 visibility (unlisted).

**Recommendation:** **Option A** — delegates Range/206 to the storage that already implements it, keeps the API light, and still gates every URL issuance on the access rule of TD-15. A test sends `Range` to the redirected URL and asserts `206`, `Content-Range` and body length.

**Decision:** A (Redirect to a short-lived presigned GET URL)

**Note:** Decision follows the Recommendation — redirecting to a short-lived presigned URL delegates Range/206 to the storage and keeps video bytes out of the API, while access is still checked on every URL issued.

---

## TD-15: Access Policy for Status, Streaming and Download in Phase 03

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The project says anonymous users watch freely, but publication and visibility (public/unlisted) only arrive in Phase 04. Every video in this phase is, by definition, unpublished. The rule must be explicit in the Authorization Matrix without inventing Phase 04 requirements.

**Options:**

### Option A: Owner-only in Phase 03
- Upload, status, stream and download require the authenticated owner (channel's user). Others get `404` (not `403`, to avoid revealing existence). Phase 04 opens stream/download according to visibility.
- **Pros:** No unpublished content is exposed. Uses the existing global JWT guard. Phase 04 only relaxes the rule — nothing to undo.
- **Cons:** Anonymous watching (a project principle) is only demonstrable after Phase 04.

### Option B: Anyone (including anonymous) for `ready` videos
- `@Public()` on stream/download, restricted to `status = ready`.
- **Pros:** Demonstrates the anonymous-watch principle now.
- **Cons:** Effectively publishes every processed video before a publication flow exists; Phase 04 would have to restrict access retroactively.

**Recommendation:** **Option A** — the safe default while publication does not exist; it relies on the existing guard and lets Phase 04 own the public/unlisted rules.

**Decision:** A (Owner-only in Phase 03; Phase 04 opens access by visibility)

**Note:** Decision follows the Recommendation — every video in this phase is unpublished, so owner-only access avoids exposing content before Phase 04 defines publication and visibility.

---

## TD-16: Testing the Asynchronous Pipeline with Real Infrastructure

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo", "Reprodução via streaming (sem necessidade de download completo)"

**Context:** The challenge requires integration/e2e tests against the real Compose services (no mocks for storage/queue) and an e2e that uploads, waits for processing and checks `ready`, the thumbnail and a `206`. Tests run inside the `nestjs-api` container (backend `CLAUDE.md`), which has no FFmpeg today. The choice affects Dockerfiles, Compose and the Jest setup.

**Options:**

### Option A: e2e boots the worker context in-process
- The e2e spec creates the HTTP app **and** a worker application context in the same Jest process, both connected to the real Redis/MinIO/PostgreSQL. The test fixture is a tiny video committed to the repo (a few KB), plus a corrupt file for the `error` path. Requires `ffmpeg` in the image where tests run.
- **Pros:** Deterministic: the test controls worker start/stop and does not depend on another container's code being up to date. Same pattern for integration tests of the worker.
- **Cons:** The API dev image also needs FFmpeg (or tests run in the worker image).

### Option B: e2e relies on the running `video-worker` container
- The test uploads via HTTP and polls the database/API until `ready` or a timeout; the Compose worker does the processing.
- **Pros:** Exercises the real deployment topology end to end.
- **Cons:** Flaky by nature (polling, timing); the worker container may run stale code (no watch mode) or compete with other test suites for jobs; harder to isolate in `--runInBand` runs.

**Recommendation:** **Option A** — the project already demands `--runInBand` and real infra; owning the worker lifecycle inside the test removes timing and stale-code flakiness. Both images are built from the same codebase (TD-05/A), so sharing an FFmpeg-enabled base image is a small cost.

**Decision:** B (e2e relies on the running `video-worker` container)

**Note:** Decision deliberately diverged from the Recommendation — exercising the real deployment topology end to end (API → queue → worker container → storage/DB) was preferred over running the worker in-process. Consequences to handle in the plan: the e2e polls the video status with a bounded timeout; the `video-worker` container must run the current code before e2e runs (restart or watch mode); and the e2e must not compete with other suites for jobs (`--runInBand` already applies). The API image does not need FFmpeg under this option.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Queue Technology | A (BullMQ + Redis via `@nestjs/bullmq`) | A (BullMQ + Redis) |
| TD-02 | Backend | Large-File Upload Protocol (up to 10GB) | A (Presigned S3 multipart) | A (Presigned multipart) |
| TD-03 | Backend | Upload Session Policy | B (Server part size, URLs on demand, size re-checked at complete) | B (URLs on demand) |
| TD-04 | Backend | Upload Completion Signal | A (Client calls API complete endpoint) | A (API complete endpoint) |
| TD-05 | Backend | Worker Runtime and Code Location | A (Same codebase, separate entrypoint + container) | A (Same codebase, own container) |
| TD-06 | Backend | FFmpeg/ffprobe Invocation | A (System binaries via `execFile`) | B (`fluent-ffmpeg`) |
| TD-07 | Backend | Worker Input Access | A (Presigned GET URL as FFmpeg input) | A (Presigned GET URL input) |
| TD-08 | Backend | Thumbnail Frame Selection | B (10% of duration, clamped) | B (10% of duration) |
| TD-09 | Backend | Storage Layout | A (One private bucket, UUID-based prefixes) | A (One bucket, prefixes) |
| TD-10 | Repo-wide | Presigned URL Host | A (Internal + public endpoints) | A (Internal + public endpoints) |
| TD-11 | Repo-wide | Local S3-Compatible Image Distribution | B (Chainguard MinIO image pinned by digest) | B (Chainguard MinIO, pinned by digest) |
| TD-12 | Backend | Video Status Lifecycle and Failure Handling | A (Single 4-state enum, retries then `error`) | A (4-state enum, retries then `error`) |
| TD-13 | Backend | Unique Public Video Identifier | B (Random base64url short id, unique column) | B (Random short id) |
| TD-14 | Backend | Streaming and Download Delivery | A (Redirect to short-lived presigned URL) | A (Redirect to presigned URL) |
| TD-15 | Backend | Access Policy in Phase 03 | A (Owner-only; Phase 04 opens by visibility) | A (Owner-only) |
| TD-16 | Repo-wide | Testing the Asynchronous Pipeline | A (Worker context in-process in e2e) | B (Running worker container) |
