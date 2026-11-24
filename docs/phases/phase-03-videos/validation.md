---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 6
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-24T08:19:27-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-24T08:19:23-03:00"
issues:
  - id: IC-1
    status: open
    summary: "TD-10 and TD-14 defer e2e presigned-URL following to each other"
  - id: AMB-1
    status: open
    summary: "Scope has no Affected subprojects nor Out of scope boundary"
  - id: AMB-2
    status: open
    summary: "Which video metadata is extracted and how it is persisted"
  - id: AMB-3
    status: open
    summary: "Source of the video title when the draft is created"
  - id: AMB-4
    status: open
    summary: "Input validation at upload init (type, size) vs worker-only"
  - id: AMB-5
    status: open
    summary: "How the video-worker container starts and stays on current code"
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

- **IC-1** — `phase-03-videos/TD-10` says "The e2e test strategy for following URLs is settled in TD-14", while `phase-03-videos/TD-14` says the test follows "the redirect against the storage host (see TD-10)". Neither TD actually settles it, and the combination is not workable as written: under TD-10 (A) the URLs handed to clients are signed for `S3_PUBLIC_ENDPOINT` (the host-reachable address), but under TD-16 (B) the e2e runs inside the `nestjs-api` container, where that host address does not reach MinIO — and the host is part of the SigV4 signature, so the URL cannot be rewritten to `minio:9000` after signing. The Range/`206` assertion required by TD-14 therefore has no defined path. Explicit choice: append a revision to TD-10 or TD-14 fixing how the e2e verifies streaming/download — e.g., (a) make the public hostname also resolve to MinIO inside Compose (network alias), so the same signed URL works from the test; (b) in the test environment sign with the internal endpoint (public endpoint = internal endpoint for `NODE_ENV=test`); (c) assert the `302` + `Location` shape on the API and verify Range/`206` with a separately presigned internal URL.

### Ambiguities

- **AMB-1** — `## Scope` has **Affected subprojects:** "_None named_" and **Out of scope:** "_Not specified._" (the Fase 03 section of `project-plan.md` names no subproject and no exclusions), while every TD targets `nestjs-project/` and the neighbor Phase 04 owns "Edição das informações do vídeo", "Fluxo de rascunho → publicação" and visibility. Phase 02's context stated both fields explicitly. Explicit choice: record `nestjs-project/` as the affected subproject (with `next-frontend/` deferred) and the out-of-scope list (video UI/frontend; title/description/category editing, custom thumbnail, publication and visibility — Phase 04), so plan-build has a hard boundary.
- **AMB-2** — "Processamento automático do vídeo após upload (extração de duração e metadados)": duration is explicit, but which other metadata is extracted (resolution, codecs, bitrate, container format, file size, frame rate) and how it is persisted (dedicated columns vs. a single JSONB `metadata` column) is not defined by any TD. The Data Model cannot be written without it. Explicit choice: define the metadata field set and its storage shape.
- **AMB-3** — "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload": the persisted record needs a `título` (per the challenge's persistence requirement), but nothing says where it comes from at init — required in the init request body, or derived from the original filename — and Phase 04 owns "Edição das informações do vídeo: título…". Explicit choice: define the title source at draft creation (and whether it is mandatory), keeping later editing in Phase 04.
- **AMB-4** — "Upload de vídeos com suporte a arquivos de até 10GB": TD-03 validates the declared size (≤ 10GB) at init and the real size at complete, and TD-12 sends invalid media to `error` after ffprobe. It is undefined whether init also rejects non-video inputs up front (declared MIME type / extension allowlist, `fileSize` of 0) or whether every file is accepted and only the worker decides. This changes the init DTO, the Error Catalog and the e2e cases. Explicit choice: define the validation applied at init (or state explicitly that type validation is worker-only).
- **AMB-5** — `phase-03-videos/TD-16` (B) requires that "the `video-worker` container must run the current code before e2e runs (restart or watch mode)", leaving the choice open; the existing `nestjs-api` container idles (`tail -f /dev/null`) and its process is started by hand, so there is no established pattern for a long-running worker service. How the `video-worker` service starts in Compose (watch-mode dev command vs. compiled build + explicit restart before tests) determines Compose config, npm scripts and the e2e procedure. Explicit choice: define the worker's start command and the code-freshness procedure for tests.

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._ _(UI Inventory is deferred — check not applicable.)_

## Resolved Issues

_No issues resolved yet._
