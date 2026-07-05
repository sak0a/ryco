# 05 — Sidebar thread list virtualization

| Field | Value |
|-------|-------|
| **Batch** | Perf / refactor |
| **Order in batch** | 1 of 6 |
| **Depends on (same batch)** | — |

## Prompt

Virtualize the sidebar thread list when a project has more than 20 threads, using `@legendapp/list` (same as MessagesTimeline).

### Context

- `apps/web/src/components/sidebar/SidebarProjectThreadList.tsx`
- `SidebarThreadRow.tsx` is the row renderer
- Drag-and-drop reorder may exist — document or disable reorder when virtualized

### Requirements

- Full list render when `threads.length <= 20`
- Virtualized list when `> 20`
- Preserve thread selection, context menu, archive actions
- `mod+1..mod+9` keybindings must still target the visible sorted thread list — document if limited to first 9 visible
- Add browser test with mocked 50+ threads if `SidebarWorktreeList.browser.tsx` pattern applies

### Acceptance

- 100+ thread project expands and scrolls without jank
- No regression for small projects
- Optional: `markSidebarExpand` marks if Phase 0 perf harness exists
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
