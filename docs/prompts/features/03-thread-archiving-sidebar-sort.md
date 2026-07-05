# 03 — Thread archiving polish (sidebar limits + sorting)

| Field | Value |
|-------|-------|
| **Batch** | Daily UX |
| **Order in batch** | 2 of 5 |
| **Depends on (same batch)** | — |

## Prompt

Improve sidebar thread/project organization per `TODO.md`:

1. Only show the last 10 threads per project in the sidebar (with a "Show all" or navigate-to-full-list affordance if one exists)
2. New projects should appear at the top of the project list
3. Projects should sort by latest thread update (most recently active project first)
4. Thread archiving already exists (`ArchivedThreadsPanel` in `SettingsPanels.tsx`) — ensure archived threads never appear in the main sidebar list

### Context

- Sidebar: `apps/web/src/components/Sidebar.tsx`, `SidebarProjectThreadList.tsx`, `SidebarThreadRow.tsx`
- Thread/project state: `apps/web/src/store.ts`, server persistence under `apps/server/src/persistence/`
- Sort logic may live in `Sidebar.logic.ts`

### Requirements

- Sorting should use server-authoritative `updatedAt` where available, not client guess
- Changing sort order must not break thread jump keybindings (`mod+1..9`) — document behavior if limited to visible 10
- Add unit tests in `Sidebar.logic.test.ts` for sort/limit rules

### Acceptance

- Project with 15 threads shows 10 + expand/show-all
- Newly created project appears at top
- Project with recent thread activity rises in order
- Archived threads only in Settings → Archived
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
