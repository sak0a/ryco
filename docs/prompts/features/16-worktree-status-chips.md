# 16 — Worktree status chips

| Field | Value |
|-------|-------|
| **Batch** | Git / workflow |
| **Order in batch** | 1 of 4 |
| **Depends on (same batch)** | — |

## Prompt

Implement state-aware worktree chips in the sidebar (idle, in_progress, review, done) per `docs/superpowers/plans/2026-05-16-sidebar-worktree-state-aware-chips.md`.

### Context

- `SidebarWorktreeList.tsx`, worktree operations in `apps/server/src/ws/context/worktreeOperations.ts`
- Worktree status may exist in contracts/persistence — grep before adding duplicate fields

### Requirements

- Visual chip/badge per worktree with status bucket
- User can change status (context menu or click cycle)
- Optional: derive `in_progress` automatically when thread on worktree has active turn
- Persist status server-side per worktree

### Acceptance

- Status visible in sidebar worktree list
- Manual status change persists across reload
- Browser test in `SidebarWorktreeList.browser.tsx` extended
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
