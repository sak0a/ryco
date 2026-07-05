# 26 — Project dashboard

| Field | Value |
|-------|-------|
| **Batch** | Differentiation |
| **Recommended model** | Composer 2.5 |
| **Subagent?** | Yes — parallel with 27–30 |
| **Dependencies** | None |
| **PR size** | Medium–large |

## Prompt

Create a per-project dashboard view combining overview data: active worktrees, open PRs/MRs, CI status, recent agent activity, usage stats.

### Context

- `ChatOverviewPanel`, `overviewLayouts.tsx`, `overviewAtoms.ts`
- `StatisticsPanel` selectors
- `PlanSidebar`, project explorer tabs

### Requirements

- New route or panel: project home accessible from sidebar project header
- Read-only aggregation — no new provider calls beyond existing RPCs
- Cards: worktrees by status, open reviews, last 5 threads, token usage this week

### Acceptance

- Dashboard loads for project with git + threads
- Empty states for new projects
- No perf regression (lazy load queries)
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
