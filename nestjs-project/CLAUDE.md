# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **MinIO:** `docker compose ps minio` — expect `healthy` (healthcheck runs `mc ready local`)
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`
- **Video worker:** `docker compose logs video-worker` — expect `Video worker started`

The `video-worker` service is infrastructure: it starts with `docker compose up -d` and processes jobs on its own (it is not the API dev server).

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP `1025`, web UI `8025`
- `minio` — S3-compatible object storage (Chainguard MinIO image pinned by digest), S3 API port `9000`, console `9001`, credentials from `S3_ACCESS_KEY`/`S3_SECRET_KEY`
- `redis` — Redis 8.2 (pinned by digest), port `6379`, runs with `maxmemory-policy noeviction` (required by BullMQ)
- `video-worker` — video processing worker (`Dockerfile.worker`, FFmpeg installed); runs `npm run start:worker:dev` (`node --watch` + `ts-node` on `src/worker.ts`) and restarts on source changes

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit + integration tests (always with --runInBand)
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** run with `--runInBand`; both scripts already pass it:

```bash
docker compose exec nestjs-api npm test            # already configured
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Videos (Phase 03)

Upload, processing and playback of videos. Decisions: `docs/decisions/technical-decisions-phase-03-videos.md`; plan: `docs/phases/phase-03-videos/phase-03-videos.md`.

### Modules and files

- `src/videos/` — `VideosModule` (controller, `VideosService`, DTOs, `Video` entity, domain exceptions). Migration: `src/database/migrations/1795524222940-CreateVideos.ts`.
- `src/storage/` — `StorageModule`: two `S3Client`s (`forcePathStyle`) — internal (`S3_ENDPOINT`) for server calls and public (`S3_PUBLIC_ENDPOINT`) only to sign URLs returned to HTTP clients. Ensures the bucket on boot.
- `src/queue/` — `QueueModule`: BullMQ connection and the `video-processing` queue (job `video.process`, payload `{ videoId }`, `jobId` = video id, 3 attempts, exponential backoff).
- `src/videos/processing/` — `VideoProcessingModule` (`VideoProcessor`, `MediaProbeService` over `fluent-ffmpeg`), loaded **only** by the worker.
- `src/worker.ts` + `src/worker.module.ts` — worker entrypoint (`NestFactory.createApplicationContext`, no HTTP).

### Endpoints (all require `Authorization: Bearer`, owner-only; another user's video → `404 VIDEO_NOT_FOUND`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/videos` | Pre-register a `draft` and open the multipart upload; returns `publicId`, `partSize`, `partCount` |
| POST | `/videos/:publicId/upload/parts` | Presigned `UploadPart` URLs for the requested part numbers |
| GET | `/videos/:publicId/upload/parts` | Parts already stored (resume) |
| POST | `/videos/:publicId/upload/complete` | Complete the upload, re-check size, `draft → processing`, enqueue job (`202`) |
| GET | `/videos/:publicId` | Status, duration and metadata |
| GET | `/videos/:publicId/stream` | `302` to a presigned URL; storage answers `Range` with `206` |
| GET | `/videos/:publicId/download` | `302` to a presigned URL with `Content-Disposition: attachment` |
| GET | `/videos/:publicId/thumbnail` | `302` to the presigned thumbnail URL |

The API never receives video bytes: clients `PUT` parts straight to storage through presigned URLs.

### Status lifecycle

`draft` (upload started) → `processing` (upload completed, job queued) → `ready` (worker stored metadata + `thumbnails/{id}.jpg`) or `error` (`error_reason`: `INVALID_MEDIA` immediately, `PROCESSING_FAILED` after the retries, `UPLOAD_SIZE_MISMATCH` at completion). Transitions are conditional updates, so duplicate job deliveries are no-ops.

### Rules

- **Presigned URL signing:** URLs consumed inside Compose (the worker's FFmpeg input) are signed with the internal client; URLs returned to HTTP clients with the public client. With `NODE_ENV=test` the public endpoint equals the internal one, so tests inside `nestjs-api` can follow them.
- **Storage keys** come from the internal video id (`videos/{id}/original`, `thumbnails/{id}.jpg`), never from the user's filename.
- **Dependencies** for the worker are installed through `nestjs-api` (`docker compose exec nestjs-api npm install …`) — both containers share the code volume and `node_modules`.
- `@nestjs/bullmq` is pinned to `^11.0.5` because 12.x is ES-module-only and breaks the CommonJS Jest setup; `ioredis` must stay installed (optional peer of BullMQ 6).

### Environment variables (names only — see `.env.example`)

`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `REDIS_HOST`, `REDIS_PORT`, `VIDEO_MAX_SIZE_BYTES`, `VIDEO_UPLOAD_PART_SIZE_BYTES`, `VIDEO_UPLOAD_URL_TTL_SECONDS`, `VIDEO_PLAYBACK_URL_TTL_SECONDS`.

### Testing

- Integration and e2e tests use the real `minio` and `redis` containers.
- `test/videos-pipeline.e2e-spec.ts` also needs `video-worker` running (`docker compose up -d`): it uploads `test/fixtures/sample.mp4` / `not-a-video.mp4` and polls until the worker finishes.
- The `nestjs-api` container has no FFmpeg; processor tests mock it, and the pipeline e2e covers the real FFmpeg run.
- Watch the worker with `docker compose logs -f video-worker`.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
