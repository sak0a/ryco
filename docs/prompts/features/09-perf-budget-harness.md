# 09 — Perf budget harness

| Field | Value |
|-------|-------|
| **Batch** | Perf / refactor |
| **Order in batch** | 3 of 6 |
| **Depends on (same batch)** | — |

## Prompt

Implement Phase 0.1 perf budget harness from `.plans/21-concrete-improvement-roadmap.md`.

### New files

- `apps/web/src/perf/budgets.ts` — named ms thresholds for tab switch, timeline mount, sidebar project expand
- `apps/web/test/perf/tabSwitch.budget.test.ts` — runs under `VITE_RYCO_PERF_PROFILE=1`

### Changes

- Add `markSidebarExpand` / `markSidebarExpandPaint` alongside existing `tabSwitchInstrumentation.ts` marks
- Document budgets in `docs/observability.md`

### Acceptance

- `VITE_RYCO_PERF_PROFILE=1 bun run test -- apps/web/test/perf` passes locally
- Tag test `@perf` for optional CI/nightly
- No production dependency on dev-only profiling hooks
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
