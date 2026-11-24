---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-24T09:01:29-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-24T09:00:29-03:00"
issues:
  - id: IC-1
    status: resolved
    summary: "TD-10 and TD-14 defer e2e presigned-URL following to each other"
    resolved_by: phase-03-videos/TD-10
  - id: AMB-1
    status: resolved
    summary: "Scope has no Affected subprojects nor Out of scope boundary"
    resolved_by: phase-03-videos/TD-15
  - id: AMB-2
    status: resolved
    summary: "Which video metadata is extracted and how it is persisted"
    resolved_by: phase-03-videos/TD-06
  - id: AMB-3
    status: resolved
    summary: "Source of the video title when the draft is created"
    resolved_by: phase-03-videos/TD-03
  - id: AMB-4
    status: resolved
    summary: "Input validation at upload init (type, size) vs worker-only"
    resolved_by: phase-03-videos/TD-03
  - id: AMB-5
    status: resolved
    summary: "How the video-worker container starts and stays on current code"
    resolved_by: phase-03-videos/TD-16
  - id: IC-2
    status: resolved
    summary: "Worker FFmpeg presigned URL vs TD-10 'public endpoint for presigning'"
    resolved_by: phase-03-videos/TD-10
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

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

- **IC-1** _(resolved_by phase-03-videos/TD-10)_ — TD-10 and TD-14 deferred the e2e presigned-URL following to each other. Revision 2026-11-24 on TD-10: in `NODE_ENV=test`, `S3_PUBLIC_ENDPOINT` equals the internal endpoint, so the e2e follows the `302` `Location` and asserts `206`, `Content-Range` and body length.
- **AMB-1** _(resolved_by phase-03-videos/TD-15)_ — Scope boundary. Revision 2026-11-24 on TD-15: affects only `nestjs-project/` (`next-frontend/` deferred); out of scope: video screens/frontend, title/description/category editing, custom thumbnail, publication and visibility (Phase 04).
- **AMB-2** _(resolved_by phase-03-videos/TD-06)_ — Metadata set. Revision 2026-11-24 on TD-06: typed `duration_seconds` column + JSONB `metadata` with fixed keys (`width`, `height`, `videoCodec`, `audioCodec`, `formatName`, `bitRate`, `frameRate`, `sizeBytes`).
- **AMB-3** _(resolved_by phase-03-videos/TD-03)_ — Title source. Revision 2026-11-24 on TD-03: `title` optional at init, defaulting to the original filename without extension.
- **AMB-4** _(resolved_by phase-03-videos/TD-03)_ — Init validation. Revision 2026-11-24 on TD-03: reject with 400 when `fileSize` is 0 or above 10GB, or `contentType` does not start with `video/`; ffprobe in the worker stays authoritative.
- **AMB-5** _(resolved_by phase-03-videos/TD-16)_ — Worker runtime. Revision 2026-11-24 on TD-16: `video-worker` starts itself with `node --watch` + `ts-node` (no compile, nothing written to `dist/`).
- **IC-2** _(resolved_by phase-03-videos/TD-10)_ — Worker FFmpeg presigned URL vs TD-10 "public endpoint for presigning". Revision 2026-11-24 on TD-10: URLs consumed inside Compose (worker FFmpeg input) are signed with the internal client; only URLs returned to HTTP clients use the public client.
