# Batch 02 — Perf / Refactor

Copy everything below the line into your agent session in the **batch worktree**.

---

## Setup

| Item | Value |
|------|-------|
| **Branch** | `feat/batch-perf-refactor` |
| **Worktree** | One dedicated worktree for this batch |
| **PR** | Single PR containing all features below |
| **Agent** | One Cursor agent session (no subagents) |

Read [AGENTS.md](../../AGENTS.md) and `.plans/21-concrete-improvement-roadmap.md`.

## Your task

Implement **all six features** sequentially on this branch. Order matters — do not reorder.

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Implementation order

| Step | ID | Feature | Feature file |
|------|-----|---------|--------------|
| 1 | 05 | Sidebar thread virtualization | [features/05-sidebar-thread-virtualization.md](../features/05-sidebar-thread-virtualization.md) |
| 2 | 06 | Diff panel cancel + LRU cache | [features/06-diff-panel-cache.md](../features/06-diff-panel-cache.md) |
| 3 | 09 | Perf budget harness | [features/09-perf-budget-harness.md](../features/09-perf-budget-harness.md) |
| 4 | 04 | ChatView decomposition | [features/04-chatview-decomposition.md](../features/04-chatview-decomposition.md) |
| 5 | 08 | Finish AtomRpc migration | [features/08-finish-atomrpc-migration.md](../features/08-finish-atomrpc-migration.md) |
| 6 | 07 | Client push coalescing | [features/07-client-push-coalescing.md](../features/07-client-push-coalescing.md) |

**Why this order:** Low-risk perf wins first → ChatView split reduces merge surface → AtomRpc migration → coalescing last (streaming correctness is subtle).

## Feature summaries

### 05 — Sidebar virtualization

Virtualize thread list when `> 20` threads via `@legendapp/list`. Full list when `≤ 20`. Preserve context menu, archive, keybindings.

### 06 — Diff cache

Cancel diff workers on navigation. LRU ~50 entries in `diffParseCache.ts` keyed by `(turnId, filePath, blobSha)`.

### 09 — Perf budgets

`apps/web/src/perf/budgets.ts`, sidebar expand marks, `@perf` budget test, docs in `observability.md`.

### 04 — ChatView split

Extract `useChatSessionActions`, `ChatTerminalShell`, remaining overview wiring. Target `ChatView.tsx` < 1500 lines. Behavior-preserving. Run browser tests.

### 08 — AtomRpc

Remove all `@tanstack/react-query` from `apps/web`. Migrate to atom hooks. Delete `QueryClientProvider`.

### 07 — Store coalescing

Batch orchestration **shell** updates in rAF when rate is high. **Never** batch streaming deltas. Unit test with recorded event sequence.

## Batch acceptance

- [ ] All 6 features on one branch
- [ ] `ChatView.tsx` materially smaller
- [ ] Zero React Query imports in `apps/web`
- [ ] Streaming UX unchanged after coalescing
- [ ] Optional: `VITE_RYCO_PERF_PROFILE=1 bun run test -- apps/web/test/perf` passes
- [ ] Manual smoke: tab switch, diff file hopping, 50+ thread sidebar scroll

## PR title suggestion

`perf: sidebar virtualization, diff cache, ChatView split, AtomRpc, store coalescing`
