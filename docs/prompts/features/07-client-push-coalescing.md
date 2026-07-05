# 07 — Client push coalescing (store layer)

| Field | Value |
|-------|-------|
| **Batch** | Perf / refactor |
| **Recommended model** | Opus 4.8 |
| **Subagent?** | No — streaming correctness is subtle |
| **Dependencies** | After 04 recommended |
| **PR size** | Medium |

## Prompt

Batch high-frequency orchestration shell updates in `apps/web/src/store.ts` within `requestAnimationFrame` when event rate exceeds threshold (~10 events/ms configurable constant).

### Requirements

- Coalesce shell/metadata updates only — NEVER batch turn content streaming deltas (tool output, assistant tokens must stay immediate)
- Final projected state after burst must match pre-change semantics (unit test with recorded event sequence)
- Stress scenario: many tool events during active turn should not freeze UI

### Acceptance

- Unit test proves identical final state with/without coalescing
- Streaming UX unchanged
- No dropped events
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
