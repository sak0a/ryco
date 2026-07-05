# Batch 02 — Perf / Refactor (Orchestration Prompt)

Copy everything below the line into a **Composer 2.5** lead session.

---

## Role

You are the **lead orchestrator** for Ryco batch **Perf / Refactor** (features **04–09**). This batch has **strict ordering** for some items and **safe parallelism** for others.

Read [AGENTS.md](../../AGENTS.md). Validation on every PR:

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Reference: `.plans/21-concrete-improvement-roadmap.md`

Do not commit unless explicitly asked.

## Batch summary

| ID | Feature | Model | Subagent? | Order |
|----|---------|-------|-----------|-------|
| 05 | Sidebar virtualization | Composer 2.5 | **Yes** | Wave 1 (parallel) |
| 06 | Diff LRU + cancel | Composer 2.5 | **Yes** | Wave 1 (parallel) |
| 09 | Perf budget harness | GPT 5.5 | **Yes** | Wave 1 (parallel) |
| 04 | ChatView decomposition | Composer 2.5 | No | Wave 2 (sequential) |
| 08 | AtomRpc migration | Opus 4.8 | No | Wave 3 (after 04) |
| 07 | Store coalescing | Opus 4.8 | No | Wave 4 (after 04) |

## Execution waves

```text
Wave 1 (parallel — 3 subagents)
  ├── 05 sidebar virtualization
  ├── 06 diff cache
  └── 09 perf budgets

Wave 2 (solo)
  └── 04 ChatView split

Wave 3 (solo — Opus recommended)
  └── 08 remove React Query

Wave 4 (solo — Opus required)
  └── 07 push coalescing
```

**Never parallelize:** 04 + 08, 07 + streaming-heavy work without Opus review.

## Wave 1 — Parallel subagents

Spawn **3 subagents** with this preamble:

```text
Ryco perf subagent. Implement ONLY your assigned feature.
Allowed to touch only paths listed below.
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
Do not commit. No drive-by refactors. Read AGENTS.md.
```

| Subagent | Model | Prompt file | Allowed paths |
|----------|-------|-------------|---------------|
| P1 | Composer 2.5 | [features/05-sidebar-thread-virtualization.md](../features/05-sidebar-thread-virtualization.md) | `SidebarProjectThreadList.tsx`, `SidebarThreadRow.tsx`, browser tests |
| P2 | Composer 2.5 | [features/06-diff-panel-cache.md](../features/06-diff-panel-cache.md) | `DiffWorkerPoolProvider.tsx`, `lib/diffParseCache.ts`, tests |
| P3 | GPT 5.5 | [features/09-perf-budget-harness.md](../features/09-perf-budget-harness.md) | `apps/web/src/perf/`, `apps/web/test/perf/`, `docs/observability.md` |

After Wave 1: merge, run full tests, record perf baseline with `VITE_RYCO_PERF_PROFILE=1` if harness exists.

## Wave 2 — ChatView decomposition (solo)

| Agent | Model | Prompt |
|-------|-------|--------|
| Lead | Composer 2.5 | [features/04-chatview-decomposition.md](../features/04-chatview-decomposition.md) |

Extract `useChatSessionActions`, `ChatTerminalShell`, remaining overview wiring. Target ChatView < 1500 lines. Run `ChatView.browser.tsx`.

## Wave 3 — AtomRpc migration (solo)

| Agent | Model | Prompt |
|-------|-------|--------|
| Lead | **Opus 4.8** | [features/08-finish-atomrpc-migration.md](../features/08-finish-atomrpc-migration.md) |

Remove all `@tanstack/react-query` from `apps/web`. Migrate to atom hooks. Delete QueryClientProvider.

## Wave 4 — Store coalescing (solo)

| Agent | Model | Prompt |
|-------|-------|--------|
| Lead | **Opus 4.8** | [features/07-client-push-coalescing.md](../features/07-client-push-coalescing.md) |

Batch shell updates in rAF; **never** batch streaming deltas. Unit test recorded event sequences.

## Orchestrator checklist

- [ ] Wave 1: 3 PRs merged or 1 PR with 3 commits
- [ ] Wave 2: ChatView line count reduced; browser tests green
- [ ] Wave 3: zero React Query imports in apps/web
- [ ] Wave 4: streaming UX unchanged; coalescing test passes
- [ ] Perf budgets pass (if 09 landed): `VITE_RYCO_PERF_PROFILE=1 bun run test -- apps/web/test/perf`
- [ ] Manual smoke: tab switch, diff file hopping, 50+ thread sidebar scroll

## Inline prompts (abbreviated)

**05:** Virtualize sidebar threads >20 with `@legendapp/list`. Full list ≤20.

**06:** Cancel diff workers on navigation; LRU cache ~50 entries keyed by turnId/filePath/blobSha.

**09:** `perf/budgets.ts`, sidebar expand marks, `@perf` budget test, docs update.

**04:** Extract session hook + terminal shell from ChatView; behavior-preserving.

**08:** Complete AtomRpc migration; remove react-query package.

**07:** rAF coalesce orchestration shell updates only; streaming immediate.

## Success metrics (from roadmap)

| Metric | Target |
|--------|--------|
| ChatView.tsx | < 1,500 lines after Wave 2 |
| React Query imports | 0 after Wave 3 |
| Tab switch p95 | No regression vs Wave 1 baseline |
