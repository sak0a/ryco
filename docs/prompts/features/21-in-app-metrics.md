# 21 — In-app metrics snapshot

| Field | Value |
|-------|-------|
| **Batch** | Ops / trust |
| **Recommended model** | GPT 5.5 |
| **Subagent?** | Yes — parallel with 20 |
| **Dependencies** | None |
| **PR size** | Small–medium |

## Prompt

Expose rolling-window server metrics via RPC and show in Diagnostics panel (no OTLP required).

### Context

- `apps/server/src/observability/`
- `docs/observability.md`
- Statistics feature: `apps/server/src/statistics/StatisticsQuery.ts` (pattern reference)

### Metrics

- Avg turn quiescence ms
- Checkpoint duration p95
- WebSocket reconnect count (server-side or client-reported)

### Requirements

- Metrics reset on server restart (document behavior)
- Read-only RPC endpoint
- Diagnostics UI section with refresh

### Acceptance

- Metrics visible without OTLP configured
- Server unit test for metrics aggregation
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
