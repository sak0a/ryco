# 24 — Long-thread server pagination

| Field                       | Value       |
| --------------------------- | ----------- |
| **Batch**                   | Ops / trust |
| **Order in batch**          | 5 of 6      |
| **Depends on (same batch)** | —           |

## Prompt

Add server-side pagination for message history on threads with large event counts (>500 messages).

### Context

- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- Client already virtualizes via MessagesTimeline LegendList
- SQLite indexes: orchestration events by `(thread_id, sequence)`

### Requirements

- Cursor-based history fetch RPC (`beforeSequence` / `limit`)
- Client loads initial window + fetches older on scroll-up
- Index migration if missing
- Benchmark: 1k-event thread load under threshold without client OOM

### Acceptance

- Thread with 1000+ messages connects without loading full history
- Scroll-up loads older messages seamlessly
- Server test for pagination cursor
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
