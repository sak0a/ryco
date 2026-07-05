# 06 — Diff panel cancel + LRU cache

| Field | Value |
|-------|-------|
| **Batch** | Perf / refactor |
| **Order in batch** | 2 of 6 |
| **Depends on (same batch)** | — |

## Prompt

Improve diff panel performance: cancel in-flight diff parse jobs on navigation and add LRU cache for parsed diffs.

### Context

- `DiffWorkerPoolProvider`: `apps/web/src/components/DiffWorkerPoolProvider.tsx`
- Diff panel used from thread workspace / ChatView

### Requirements

- Cancel worker jobs when `turnId` or `filePath` changes before starting new job
- LRU cache keyed by `(turnId, filePath, blobSha)` max ~50 entries in `apps/web/src/lib/diffParseCache.ts`
- Cache hit reopens file instantly
- Unit tests for cache eviction and cancel behavior

### Acceptance

- Rapid file switching does not stack worker queue
- Reopening same file is instant on cache hit
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
