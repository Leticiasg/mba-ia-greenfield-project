# phase-03-videos — Progress

**Status:** completed
**SIs:** 12/12 completed

### SI-03.1 — Infra: Dependências e namespaces de configuração
- **Status:** completed
- **Tests:** 10 passing (env.validation.integration-spec + storage.config.spec); e2e `GET /` passing; `tsc --noEmit` exit 0
- **Observations:**
  - `npm install` saved `fluent-ffmpeg` as `^2.1.3`; pinned to exact `2.1.3` in `package.json` as the plan requires (deprecated package).
  - New config namespaces also registered in `AppModule` `ConfigModule.forRoot({ load })`, so later SIs can inject them.
  - Local `.env` (untracked) received the same new keys as `.env.example`, so the app keeps booting with `S3_ACCESS_KEY`/`S3_SECRET_KEY` now required.
  - `npm install` reports 62 pre-existing audit vulnerabilities in the dependency tree; not addressed (out of scope).

### SI-03.2 — Infra: MinIO e Redis no Docker Compose
- **Status:** completed
- **Tests:** no tests (Infra) — ACs checked manually: `minio`/`redis` healthy; `maxmemory-policy` = `noeviction`; `curl http://minio:9000/minio/health/live` from `nestjs-api` = 200
- **Observations:**
  - TD-11 pending check resolved on first pull: the Chainguard image's entrypoint is `/usr/bin/minio` with no default command and user `65532`; Compose passes only the args (`server /data --console-address :9001`).
  - The image ships `sh` and `mc` but no `curl`/`wget`; the healthcheck uses `mc ready local` with an `MC_HOST_local` alias built from `S3_ACCESS_KEY`/`S3_SECRET_KEY`.
  - The running image reports `RELEASE.2026-11-23T00-10-37Z`.

### SI-03.3 — StorageModule: clientes S3 interno/público e operações de objeto
- **Status:** completed
- **Tests:** 7 passing (storage.service.integration-spec against real MinIO + storage.module.spec); `tsc --noEmit` exit 0; lint clean on SI files
- **Observations:**
  - `StorageModule` is not yet imported by `AppModule`; it becomes part of the app through `VideosModule` in SI-03.5. Bucket creation on boot (AC 1) is verified by the integration test calling `module.init()` (`onModuleInit` → `ensureBucket`).
  - Integration test objects live under the `test/` key prefix of the configured bucket and are deleted in `afterAll`.
  - Applied `eslint --fix` (Prettier line breaks only) to the new storage files.

### SI-03.4 — Entidade Video, migration e identificador público
- **Status:** completed
- **Tests:** 9 passing (video.entity.integration-spec, migrations.integration-spec, public-id.util.spec); regression 111 passing (src/channels, src/users, src/auth); e2e 52 passing; `tsc --noEmit` exit 0; lint 0 errors
- **Observations:**
  - Migration generated with the TypeORM CLI (`1795524222940-CreateVideos.ts`, per rule `nestjs-entities`) and formatted with `eslint --fix`; applied to the dev DB (`migration:run` → no pending).
  - Adding the inverse `Channel.videos` side required adding `Video` to the explicit entity lists of 11 existing test files and to `cleanAllTables`; only those lines changed.
  - Created a `VideosModule` skeleton with `TypeOrmModule.forFeature([Video])` registered in `AppModule` (planned for SI-03.5): without it, `autoLoadEntities` would not load `Video` and every e2e booting `AppModule` would fail on the `Channel.videos` relation. SI-03.5 adds controller and service to this module.
  - `data-source.ts` needed no change: it already loads `src/**/*.entity.ts` by glob.
  - The migrations test now reverts `CreateVideos` as the last migration (it previously reverted `CreateAuthTokens`).
  - Lint reports 23 pre-existing `no-unsafe-argument` warnings in `src/auth` specs (not touched by this SI).

### SI-03.5 — Endpoint POST /videos (iniciar upload e pré-cadastrar rascunho)
- **Status:** completed
- **Tests:** 15 passing (videos.service.spec 8, videos.service.integration-spec 1, channels.service.integration-spec incl. 2 new `findByUserId`, videos.module.spec 1); e2e `test/videos-create.e2e-spec.ts` 5 passing (from spec `videos-create.plan.md`); `tsc --noEmit` exit 0; lint clean on SI files
- **Observations:**
  - Added shared test helpers: `src/test/video-test-module.ts` (real `VideosModule` on Compose Postgres + MinIO) and `test/helpers/e2e-app.ts` (boots `AppModule` with `main.ts` pipes/filters; registers, confirms via DB and logs in a user, clearing the throttler between setups). Later video SIs reuse them.
  - A user without a channel makes `initUpload` throw a plain `Error` (→ 500): the 1:1 user–channel invariant from Phase 02 makes it unreachable, and no Error Catalog code covers it.
  - The multipart upload is opened before the row is inserted (the object key needs the id); if the insert fails for a non-collision reason, the multipart stays orphaned in storage. Same family as abandoned drafts — cleanup is a future task (TD-12).
  - `StorageModule` is now loaded by the app through `VideosModule`, so the bucket is ensured on every API boot.

### SI-03.6 — Endpoints de partes: URLs sob demanda e listagem para retomada
- **Status:** completed
- **Tests:** 15 passing (videos.service.spec 13 incl. 5 new, videos.service.integration-spec 2 incl. 1 new); e2e `test/videos-upload-parts.e2e-spec.ts` 4 passing (from spec `videos-upload-parts.plan.md`); `tsc --noEmit` exit 0; lint clean on SI files
- **Observations:**
  - Fix loop, attempt 1/3: the spec assumed `fileSize: 12582912` gives ≥ 2 parts, but at the default 100 MiB part size it is 1 part, so requesting part 2 correctly returned `400 INVALID_PART_NUMBER`. The e2e now declares `fileSize` = part size + 1024 and uploads only 1 KB to part 1 (S3 enforces the 5 MiB part minimum only at completion). The Setup and step text of scenarios 1.1/1.2 in `specs/videos-upload-parts.plan.md` were corrected to match.
  - `findOwnedByPublicId` filters by `channel.user_id` in the same query, so a video from another channel is indistinguishable from a missing one (`VIDEO_NOT_FOUND`); a malformed `publicId` is rejected before any query.

### SI-03.7 — Endpoint de conclusão do upload e publicação na fila
- **Status:** completed
- **Tests:** 23 passing (videos.service.spec incl. 5 new `completeUpload`, videos.service.integration-spec incl. 1 new, queue.module.spec, videos.module.spec); e2e `test/videos-upload-complete.e2e-spec.ts` 4 passing (from spec `videos-upload-complete.plan.md`); full e2e 65 passing; `tsc --noEmit` exit 0; lint clean on SI files
- **Observations:**
  - Fix loop, attempt 1/3: `@nestjs/bullmq@12.0.2` (pinned in `library-refs.md`) and its `@nestjs/bull-shared` 12.x are ES-module-only, so the CommonJS Jest setup could not load them (`SyntaxError: Unexpected token 'export'`); `tsc` passed. With the user's approval, pinned `@nestjs/bullmq@^11.0.5` (CommonJS, same API, peers `bullmq ^6` + Nest 11). `library-refs.md` updated.
  - Fix loop, attempt 2/3: BullMQ 6 treats `ioredis` as an optional peer dependency and does not install it; every `Queue`/`QueueEvents` failed. Installed `ioredis@^5.11.1`; recorded in `library-refs.md`.
  - Editing `library-refs.md` makes it newer than the `sources_mtime` recorded in `context.md` and the plan; this only matters if `/plan-context` or `/plan-build` run again (they would ask to regenerate).
  - Tests observe the queue through BullMQ `QueueEvents` `added` events (`src/test/queue-events-capture.ts`), not `getJob`, because the `video-worker` (SI-03.8) will consume jobs immediately and `removeOnComplete` deletes them.
  - If enqueueing fails after the `draft → processing` transition, the video stays `processing` without a job. Not covered by the plan; candidate follow-up together with stale-draft cleanup (TD-12).

### SI-03.8 — Infra: container video-worker com FFmpeg
- **Status:** completed
- **Tests:** 1 passing (worker.module.spec); `tsc --noEmit` exit 0; lint clean. ACs checked manually: `video-worker` running with the stack; `ffprobe -version` = 5.1.9 (Debian 12); touching `src/worker.ts` logs `Restarting 'src/worker.ts'` and the worker starts again; `nestjs-api` has no `ffmpeg` and the API keeps working
- **Observations:**
  - `WorkerModule` lists its entities explicitly (`Video`, `Channel`, `User` — the closure of `Video`'s relations) instead of `autoLoadEntities`, because the worker loads no domain module that would register them via `forFeature`.
  - `Dockerfile.worker` has no `CMD`; Compose runs `npm run start:worker:dev` (`node --watch -r ts-node/register -r tsconfig-paths/register src/worker.ts`) with `TS_NODE_TRANSPILE_ONLY=true` so restarts skip type-checking (`tsc --noEmit` stays the type gate).
  - The worker shares the code volume and `node_modules` with `nestjs-api`; dependencies are still installed through `nestjs-api` (`npm install`).

### SI-03.9 — VideoProcessor: metadados, thumbnail e status
- **Status:** completed
- **Tests:** 17 passing (video.processor.spec 11, media-probe.service.spec 4, video-processing.module.spec 1, worker.module.spec 1); `tsc --noEmit` exit 0; lint clean on SI files
- **Observations:**
  - The running `video-worker` reloaded with the consumer and drained the jobs left by earlier test runs, logging `Skipping <id>: not in processing` for each (those videos were already deleted) — idempotent path confirmed live; queue `wait` and `failed` both 0 afterwards.
  - Invalid-media detection: no video stream, or an ffprobe error matching "Invalid data found when processing input" / "moov atom not found" / "could not find codec parameters" → `UnrecoverableError('INVALID_MEDIA')`. Any other ffprobe/ffmpeg error is treated as transient and retried (3 attempts, exponential backoff), ending in `PROCESSING_FAILED`.
  - The frame is extracted with `seekInput(t).frames(1)` to a temp `.jpg` (JPEG encoder), read into memory and deleted; `screenshots()` was not used because it defaults to PNG.
  - Real ffprobe/ffmpeg execution is not covered by these unit tests (the `nestjs-api` test container has no FFmpeg, per TD-16); it is covered by the SI-03.11 pipeline e2e through the `video-worker` container.
  - `WorkerModule` now imports `VideoProcessingModule`; the API never loads the consumer.

### SI-03.10 — Endpoints de status, streaming, download e thumbnail
- **Status:** completed
- **Tests:** 30 passing (videos.service.spec 26 incl. 9 new for `getPlaybackUrl`/`attachmentDisposition`, videos.service.integration-spec 4 incl. 1 new Range/206); e2e `test/videos-playback.e2e-spec.ts` 5 passing (from spec `videos-playback.plan.md`); `tsc --noEmit` exit 0; lint clean on SI files
- **Observations:**
  - Redirect endpoints use Nest's `@Redirect(undefined, 302)` with a returned `{ url }`, so the controller stays thin and the `Location` comes from the service.
  - The download `Content-Disposition` carries an ASCII-safe `filename="…"` plus the RFC 6266 `filename*=UTF-8''…` form, so names with quotes or accents do not break the header (not specified by the plan; the spec's `filename="clip.mp4"` expectation still holds).
  - The e2e seeds a `ready` video directly in the DB and MinIO (no worker), as the spec's Setup describes; objects are deleted in `afterAll`.

### SI-03.11 — Fluxo completo upload → processamento → streaming
- **Status:** completed
- **Tests:** e2e `test/videos-pipeline.e2e-spec.ts` 2 passing (from spec `videos-pipeline.plan.md`) against the real `minio`, `redis` and `video-worker` containers; `openapi-export.integration-spec` 9 passing; `tsc --noEmit` exit 0; lint clean
- **Observations:**
  - First run of real ffprobe/ffmpeg in a test: `sample.mp4` → `ready` (duration ≈ 2 s, 320x240, JPEG thumbnail starting `FF D8 FF`, `206` on `Range: bytes=0-1023`); `not-a-video.mp4` → `error` / `INVALID_MEDIA`, then `409 VIDEO_NOT_READY` on stream.
  - Fixtures generated inside `video-worker`: `test/fixtures/sample.mp4` (12.8 KB, h264 320x240, 2.0 s) and `test/fixtures/not-a-video.mp4` (text; ffprobe reports "moov atom not found" / "Invalid data found when processing input"). Neither is hidden by `.gitignore`.
  - "API never receives the bytes" (AC #3) is asserted by checking that every part URL the client PUTs to targets the storage host (`minio:9000`), not the API.
  - `openapi.json` regenerated: 8 video operations, all with `summary` and `access-token` security (AC #4 — reported as not covered by the spec in `/plan-test-specs`, checked here by inspecting the exported file).
  - Fixed a `tsc` error in the upload helper (`fetch` body typed `Buffer<ArrayBufferLike>`) by sending a `Uint8Array` copy of each slice.

### SI-03.12 — Documentação de IA: CLAUDE.md com a seção de vídeos
- **Status:** completed
- **Tests:** no tests (documentation) — checked item by item: every cited file/directory exists; the 7 cited classes exist; `start:worker:dev` script exists; all 12 env var names are in `.env.example`; readiness commands answer (`minio` healthy, Redis `PONG`, worker log `Video worker started`, Postgres accepting connections); the 8 endpoints match `openapi.json`; neither `CLAUDE.md` contains "TBD"
- **Observations:**
  - Root `CLAUDE.md`: Message Queue = BullMQ + Redis; Video Worker described as the `video-worker` container with its own entrypoint; API described as signing presigned URLs (never receiving bytes).
  - `nestjs-project/CLAUDE.md`: readiness checks for MinIO/Redis/worker, the new services, and a "Videos (Phase 03)" section (modules, endpoints, status lifecycle, signing rule, pinned-dependency notes, env var names only, testing notes).
  - Out of scope, noted as a follow-up: `docs/diagrams/software-arch.mermaid` still labels the Message Queue container "TBD"; the root `CLAUDE.md` line "`next-frontend/` — not yet initialized" is outdated since Phase 02.

## Final verification

- **Unit + integration** (`docker compose exec nestjs-api npm test -- --runInBand`): 215 passing, 36 suites.
- **E2E** (`docker compose exec nestjs-api npm run test:e2e`, with `minio`, `redis` and `video-worker` running): 72 passing, 8 suites.
- **Type-check** (`docker compose exec nestjs-api npx tsc --noEmit`): exit 0.
- **Lint** (`docker compose exec nestjs-api npm run lint`): 0 errors; 23 pre-existing `no-unsafe-argument` warnings in `src/auth` specs; `--fix` changed no file.
- **Fix during final verification (attempt 1/3):** the first full `npm run test:e2e` failed in every video suite (e.g., `POST /auth/login` → 500 in setup) because the script ran suites in parallel and they truncate the shared DB concurrently. `nestjs-project/CLAUDE.md` already required e2e to run with `--runInBand` and described `test:e2e` as "already configured", but the script lacked it (Phase 02 had a single DB-backed e2e suite, so it never showed). Added `--runInBand` to the `test:e2e` script; rerun green.

## Follow-ups (out of scope)

- Cleanup of abandoned uploads: stale `draft` videos and orphan multipart uploads (MinIO does not support the `AbortIncompleteMultipartUpload` lifecycle) — TD-12.
- A video can stay `processing` without a job if enqueueing fails right after the `draft → processing` transition (SI-03.7).
- ~~`docs/diagrams/software-arch.mermaid` still labels the Message Queue "TBD".~~ Resolved after the phase commit: the label now reads "BullMQ + Redis".
- ~~Root `CLAUDE.md` still says `next-frontend/` is "not yet initialized".~~ Resolved after the phase commit: the line now describes the Next.js 16 frontend.
- Resolved after the phase commit: the diagram said the API "Uploads" to storage and the frontend only "Streams"; per TD-02 the client sends the parts straight to storage and the API only signs URLs and manages the multipart upload. The diagram and the root `CLAUDE.md` now say so.
- `src/test/create-test-data-source.ts` reads `DB_DATABASE` while the app uses `DB_NAME` (pre-existing; falls back to `streamtube`).
- 62 `npm audit` vulnerabilities reported in the dependency tree (pre-existing).
