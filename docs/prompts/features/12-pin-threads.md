# 12 — Pin threads

| Field                       | Value        |
| --------------------------- | ------------ |
| **Batch**                   | Search & nav |
| **Order in batch**          | 2 of 2       |
| **Depends on (same batch)** | —            |

## Prompt

Add pinned threads per project that stay at the top of the sidebar thread list.

### Context

- `uiStateStore` or persisted settings (`apps/web/src/uiStateStore.ts`, `packages/contracts/src/settings.ts`)
- Sidebar sort in `Sidebar.logic.ts` / `SidebarProjectThreadList.tsx`

### Requirements

- Pin/unpin via context menu on `SidebarThreadRow`
- Pinned threads sort above unpinned; within each group sort by `updatedAt`
- Persist preference (client localStorage OK for v1, or server settings if project-scoped persistence exists)
- Visual pin indicator on row

### Acceptance

- Pin thread stays at top after reload
- Pin survives project resort by activity (pinned block always first)
- Unit test for sort comparator
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
