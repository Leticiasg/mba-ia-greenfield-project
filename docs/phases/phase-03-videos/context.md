---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-11-22T23:52:23-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-24T09:00:29-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-24T09:01:29-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-22T23:52:32-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-11-22T23:52:32-03:00"
  docs/phases/phase-02-auth/context.md: "2026-11-22T23:52:32-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-11-22T23:52:32-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-11-22T23:52:23-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** _None named. The phase section in project-plan.md does not mention `nestjs-project`, `nextjs-project` or any other subproject path._

**Deferred subprojects:** _None._

**Sequencing notes:** "> Depende de: Fase 01, Fase 02". Phase summary (verbatim): "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única."

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta. "Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha." (Depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal. "Edição das informações do vídeo, fluxo de rascunho e publicação, painel de administração do canal e página pública." (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue Technology | decided | A (BullMQ + Redis via `@nestjs/bullmq`) | bullmq, @nestjs/bullmq |
|     └─ Last revision: 2026-11-24 — Queue broker image pinned to the official `redis:8.2-alpine@sha256:da23c2478319… | | | | | | |
| phase-03-videos/TD-02 | phase | Backend | Large-File Upload Protocol (up to 10GB) | decided | A (Presigned S3 multipart upload) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-03 | phase | Backend | Upload Session Policy (size limit, part size, URL issuance… | decided | B (Server-defined part size, on-demand part URLs, size re-checked at complete) | — |
|     └─ Last revision: 2026-11-24 — Init request contract and validation: `title` is optional at init and defaults… | | | | | | |
| phase-03-videos/TD-04 | phase | Backend | Upload Completion Signal (what triggers processing) | decided | A (Client calls the API complete endpoint) | — |
| phase-03-videos/TD-05 | phase | Backend | Worker Runtime and Code Location | decided | A (Same NestJS codebase, separate entrypoint + `video-worker` container) | — |
| phase-03-videos/TD-06 | phase | Backend | FFmpeg/ffprobe Invocation | decided | B (`fluent-ffmpeg`) | fluent-ffmpeg, @types/fluent-ffmpeg |
|     └─ Last revision: 2026-11-24 — Metadata set and storage: `duration_seconds` is a typed column; the remaining… | | | | | | |
| phase-03-videos/TD-07 | phase | Backend | Worker Input Access (how FFmpeg reads a 10GB object) | decided | A (Presigned GET URL as FFmpeg input) | — |
| phase-03-videos/TD-08 | phase | Backend | Thumbnail Frame Selection | decided | B (10% of duration, clamped) | — |
| phase-03-videos/TD-09 | phase | Backend | Storage Layout (buckets and object keys) | decided | A (One private bucket, UUID-based prefixes) | — |
| phase-03-videos/TD-10 | phase | Repo-wide | Presigned URL Host (internal vs. public storage endpoint) | decided | A (Internal endpoint for server calls + public endpoint for presigning) | — |
|     └─ Last revision: 2026-11-24 — Signing client per consumer: presigned URLs consumed inside the Compose network… | | | | | | |
| phase-03-videos/TD-11 | phase | Repo-wide | Local S3-Compatible Image Distribution | decided | B (Chainguard MinIO image pinned by digest) | — |
| phase-03-videos/TD-12 | phase | Backend | Video Status Lifecycle and Failure Handling | decided | A (Single 4-state enum; retries w/ backoff, immediate `error` for invalid media) | — |
| phase-03-videos/TD-13 | phase | Backend | Unique Public Video Identifier | decided | B (Random base64url short id in a unique column) | — |
| phase-03-videos/TD-14 | phase | Backend | Streaming and Download Delivery | decided | A (Redirect to a short-lived presigned GET URL) | — |
| phase-03-videos/TD-15 | phase | Backend | Access Policy for Status, Streaming and Download in Phase 03 | decided | A (Owner-only in Phase 03; Phase 04 opens access by visibility) | — |
|     └─ Last revision: 2026-11-24 — Phase boundary: the phase affects only `nestjs-project/` (`next-frontend/`… | | | | | | |
| phase-03-videos/TD-16 | phase | Repo-wide | Testing the Asynchronous Pipeline with Real Infrastructure | decided | B (e2e relies on the running `video-worker` container) | — |
|     └─ Last revision: 2026-11-24 — Worker runtime in development: the `video-worker` Compose service starts the… | | | | | | |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-09, phase-03-videos/TD-11 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-05, phase-03-videos/TD-16 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-03, phase-03-videos/TD-10 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-04, phase-03-videos/TD-12 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-06, phase-03-videos/TD-07, phase-03-videos/TD-12, phase-03-videos/TD-16 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-05, phase-03-videos/TD-06, phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-12, phase-03-videos/TD-16 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-13 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-10, phase-03-videos/TD-14, phase-03-videos/TD-15, phase-03-videos/TD-16 |
| Download do vídeo pelo usuário | phase-03-videos/TD-10, phase-03-videos/TD-14, phase-03-videos/TD-15 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** it is the only option with an official Nest 11 integration *and* built-in job semantics (attempts, backoff, `jobId` de-duplication, `UnrecoverableError`), and it puts a dedicated queue service in Compose, matching the separate "Message Queue" container in `docs/diagrams/software-arch.mermaid`. The extra container is cheap locally; the `noeviction` requirement becomes a Compose setting. pg-boss is the better choice if avoiding new infrastructure mattered more than having that dedicated queue service — it does not here.

**Note:** Decision follows the Recommendation — BullMQ is the only option that combines an official Nest 11 integration with built-in retry/backoff and permanent-failure semantics, and it adds to Compose the dedicated queue service the architecture expects.

**Libraries:** bullmq, @nestjs/bullmq

**Revisions:**

- 2026-11-24 — Queue broker image pinned to the official `redis:8.2-alpine@sha256:da23c2478319ceb4903857d77a2fd7aa5137d9e9d4c8165dafbacedac6403e95`, run with `maxmemory-policy noeviction` (BullMQ production requirement). Rationale: TD-01 left the broker image to be pinned in plan-resolve; official Redis keeps the TD's "BullMQ + Redis" wording and docs consistent (Valkey considered and not chosen).

### phase-03-videos/TD-02

**Recommendation:** the only option that meets 10GB on real S3, keeps the API out of the data path, and gives resume for free via per-part retry and `ListParts`, with no extra service. The handshake complexity lives in the API contract and is testable with small files (the 10GB limit is proven by the strategy plus the size validation of TD-03, not by uploading 10GB in tests).

**Note:** Decision follows the Recommendation — presigned multipart is the only option that handles 10GB on real S3, keeps the file bytes out of the API (avoiding the automatic-fail condition) and makes uploads resumable without an extra service.

**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-03

**Recommendation:** URL expiry must be decoupled from total upload time for a 10GB file to be resumable; on-demand issuance does that with one small endpoint, and validating the real object size at complete closes the gap of a client lying about `fileSize`.

**Note:** Decision follows the Recommendation — issuing part URLs on demand keeps them short-lived without breaking long 10GB uploads, and re-checking the object size at completion enforces the 10GB limit even if the client misreports `fileSize`.

**Libraries:** —

**Revisions:**

- 2026-11-24 — Init request contract and validation: `title` is optional at init and defaults to the original filename without extension (title editing stays in Phase 04); init rejects with 400 when `fileSize` is 0 or above the 10GB cap, or when the declared `contentType` does not start with `video/`. The worker's ffprobe remains the authoritative media check (invalid media → `error`, per TD-12). Rationale: resolves validation AMB-3 (title source at draft creation) and AMB-4 (validation applied at init).

### phase-03-videos/TD-04

**Recommendation:** keeps one portable, guard-protected code path that is identical on MinIO and S3, and lets the API own the `draft → processing` transition in the same request that enqueues the job.

**Note:** Decision follows the Recommendation — a client-called complete endpoint keeps a single guard-protected, testable flow that behaves the same on MinIO and S3, and lets the API own the `draft → processing` transition together with the enqueue.

**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** gives a real, separate worker container (as the architecture requires) while keeping a single source of truth for the `videos` entity, config and storage code, and a single DoD pipeline.

**Note:** Decision follows the Recommendation — a separate container keeps FFmpeg CPU load out of the API (as the architecture requires), while a single codebase avoids duplicating the `videos` entity, config and storage code and keeps one DoD pipeline.

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** the worker image needs a custom Dockerfile anyway (TD-05), so `apt install ffmpeg` is one line; `execFile` with argument arrays is safe and dependency-free, and avoids adopting a deprecated library.

**Note:** Decision deliberately diverged from the Recommendation — `fluent-ffmpeg` was chosen for familiarity and learning value in the context of this course project, accepting that the package is deprecated on npm and its repository is archived (no maintenance). `fluent-ffmpeg` still shells out to the system binaries, so the worker image must install `ffmpeg`/`ffprobe` via apt (same image requirement as Option A). Its use stays isolated behind a small worker service so it can be swapped for Option A later without touching callers.

**Libraries:** fluent-ffmpeg, @types/fluent-ffmpeg

**Revisions:**

- 2026-11-24 — Metadata set and storage: `duration_seconds` is a typed column; the remaining extracted metadata is stored in a single JSONB `metadata` column with a fixed key set — `width`, `height`, `videoCodec`, `audioCodec`, `formatName`, `bitRate`, `frameRate`, `sizeBytes` (keys may be null, e.g., no audio stream). The raw ffprobe output is not persisted. Rationale: resolves validation AMB-2 (which metadata and how it is persisted).

### phase-03-videos/TD-07

**Recommendation:** the phase only needs metadata and one frame, both of which FFmpeg can obtain through range reads; downloading 10GB to read a few megabytes is wasted time and disk. Network failures map onto the retry policy of TD-12.

**Note:** Decision follows the Recommendation — the worker only needs metadata and one frame, which FFmpeg reads through range requests; copying up to 10GB to disk first would waste time and require a large worker volume.

**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** deterministic and cheap, avoids the black-first-frame problem, and needs no extra decoding. Custom thumbnails are a Phase 04 capability, so a sensible default is enough here.

**Note:** Decision follows the Recommendation — a frame at 10% of the duration is deterministic, cheap and usually past black intro frames; custom thumbnails belong to Phase 04.

**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** a single private bucket with UUID-based prefixes covers both file kinds with the least configuration, and deterministic keys support worker idempotency. Bucket creation at startup (init container with `mc` vs. idempotent `CreateBucket` on boot) is an implementation detail for `plan-build`.

**Note:** Decision follows the Recommendation — one private bucket with UUID-based keys is the least configuration for both file kinds, and deterministic keys make worker re-runs idempotent.

**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** it keeps the repository self-contained (no host file edits) and honors the Docker networking rule, at the cost of one extra config key. The e2e test strategy for following URLs is settled in TD-14.

**Note:** Decision follows the Recommendation — separate internal and public endpoints respect the Docker networking rule (service names between containers) while still producing presigned URLs that clients outside Docker can use, without editing host files.

**Libraries:** —

**Revisions:**

- 2026-11-24 — Test environment: when `NODE_ENV=test`, `S3_PUBLIC_ENDPOINT` equals the internal endpoint (`http://minio:9000`), so the e2e running inside the `nestjs-api` container follows the `302` `Location` of the stream/download endpoints and asserts `206`, `Content-Range` and body length against MinIO. Rationale: resolves validation IC-1 (TD-10 and TD-14 deferred the e2e URL-following strategy to each other).
- 2026-11-24 — Signing client per consumer: presigned URLs consumed inside the Compose network (the worker's FFmpeg input, TD-07) are signed with the internal client (`S3_ENDPOINT`); only URLs returned to HTTP clients (upload part URLs, stream and download redirects) are signed with the public client (`S3_PUBLIC_ENDPOINT`). Rationale: resolves validation IC-2 (the indexed wording "public endpoint for presigning" would sign the worker's URL with a host unreachable from the `video-worker` container, a failure hidden in tests where both endpoints are equal).

### phase-03-videos/TD-11

**Recommendation:** it is the only distribution of MinIO that can be pulled today without building it ourselves, so "MinIO in Docker" stays literal. Storage is dev-only here (production target is S3), so depending on a third-party build is acceptable, and the digest pin keeps every environment on the same version. Option C remains the fallback if the Chainguard image becomes unavailable.

**Note:** Decision follows the (updated) Recommendation — the official MinIO registries no longer serve the image (checked on 2026-11-24), and the Chainguard build is the only MinIO distribution that can be pulled today without building from source.

**Libraries:** —

### phase-03-videos/TD-12

**Recommendation:** matches the four-state cycle one-to-one, survives transient failures automatically, gives an immediate `error` for invalid files, and avoids overloading "draft" with Phase 04's publication meaning.

**Note:** Decision follows the Recommendation — the four states match the status cycle one-to-one; retries absorb transient failures, invalid media fails fast, conditional transitions make duplicate deliveries harmless, and Phase 04 publication stays in a separate column.

**Libraries:** —

### phase-03-videos/TD-13

**Recommendation:** the only option that is short, non-enumerable and guaranteed unique by a database constraint, with no new dependency.

**Note:** Decision follows the Recommendation — an 11-character random base64url id is short, non-enumerable and unique by database constraint, with no new dependency.

**Libraries:** —

### phase-03-videos/TD-14

**Recommendation:** delegates Range/206 to the storage that already implements it, keeps the API light, and still gates every URL issuance on the access rule of TD-15. A test sends `Range` to the redirected URL and asserts `206`, `Content-Range` and body length.

**Note:** Decision follows the Recommendation — redirecting to a short-lived presigned URL delegates Range/206 to the storage and keeps video bytes out of the API, while access is still checked on every URL issued.

**Libraries:** —

### phase-03-videos/TD-15

**Recommendation:** the safe default while publication does not exist; it relies on the existing guard and lets Phase 04 own the public/unlisted rules.

**Note:** Decision follows the Recommendation — every video in this phase is unpublished, so owner-only access avoids exposing content before Phase 04 defines publication and visibility.

**Libraries:** —

**Revisions:**

- 2026-11-24 — Phase boundary: the phase affects only `nestjs-project/` (`next-frontend/` deferred). Out of scope: video screens/frontend; title, description and category editing; custom thumbnail; publication and visibility (all Phase 04). Rationale: resolves validation AMB-1 (`project-plan.md` names no subproject and no exclusions for Fase 03).

### phase-03-videos/TD-16

**Recommendation:** the project already demands `--runInBand` and real infra; owning the worker lifecycle inside the test removes timing and stale-code flakiness. Both images are built from the same codebase (TD-05/A), so sharing an FFmpeg-enabled base image is a small cost.

**Note:** Decision deliberately diverged from the Recommendation — exercising the real deployment topology end to end (API → queue → worker container → storage/DB) was preferred over running the worker in-process. Consequences to handle in the plan: the e2e polls the video status with a bounded timeout; the `video-worker` container must run the current code before e2e runs (restart or watch mode); and the e2e must not compete with other suites for jobs (`--runInBand` already applies). The API image does not need FFmpeg under this option.

**Libraries:** —

**Revisions:**

- 2026-11-24 — Worker runtime in development: the `video-worker` Compose service starts the worker itself in watch mode with `node --watch` + `ts-node` (no compile step, nothing written to `dist/`), so it never races the API's `dist/` on the shared volume and always runs current code when the e2e starts. Rationale: resolves validation AMB-5 (TD-16 note left "restart or watch mode" open).

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger

**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions... _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and... _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning... _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## UI Inventory

_No screen inventory — UI↔API sync deferred. Run /screen-inventory phase-03-videos and then rerun /plan-context phase-03-videos to activate UI checks._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

_(from `testing-guide-nestjs-project` — Feature Implementation Checklist)_

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
