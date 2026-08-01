# Sidebar Inbox Control and Row Polish Implementation Plan

Implements
`docs/superpowers/specs/2026-07-31-sidebar-inbox-control-polish-design.md` on
`feat/sidebar-inbox-settlement`.

## Task 1: Relocate global Search into shared sidebar chrome

Files:

- `apps/web/src/components/sidebar/SidebarGlobalSearch.tsx`
- `apps/web/src/components/sidebar/SidebarProjectList.tsx`
- `apps/web/src/components/Sidebar.tsx`
- relevant browser component tests

Work:

- Extract the existing `CommandDialogTrigger` row into `SidebarGlobalSearch` without changing its
  command-palette behavior, accessible label, test identifier, or shortcut hint.
- Render it once below `SidebarChromeHeader` and above `SidebarViewToggle`.
- Remove the Workspace-owned copy and the no-longer-needed props and imports from
  `SidebarProjectsContent`.
- Verify that Search is present in Workspace, Inbox, and the existing mobile Workspace
  presentation without duplication.

## Task 2: Replace native Inbox selects with icon-led comboboxes

Files:

- `apps/web/src/components/sidebar/inbox/SidebarInboxFilters.tsx`
- `apps/web/src/components/sidebar/inbox/SidebarInbox.tsx`
- focused filter logic or component tests as needed

Work:

- Add a reusable, store-independent `InboxFilterCombobox` built on the repository's Base UI
  combobox primitives.
- Keep the scoped `Search threads` input above one compact three-column selector row.
- Give Environment, Project, and Worktree triggers fixed artwork slots, short closed-state labels,
  truncation, chevrons, and category-specific accessible names.
- Render `All` first, selected check state, option artwork, keyboard navigation, typeahead, and an
  empty-result state.
- Show an inline option-search field only when a selector has more than six concrete choices.
- Enrich local option presentation with environment glyphs, representative project favicon data,
  and worktree branch glyphs without changing contracts or server payloads.
- Preserve all existing filter dependency resets, invalid-selection cleanup, sorting, and thread
  selection clearing.

## Task 3: Stabilize Inbox row metadata and hover actions

Files:

- `apps/web/src/components/sidebar/inbox/SidebarInboxRow.tsx`
- `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`

Work:

- Remove the permanent right padding and absolutely positioned lifecycle action from active rows.
- Build the approved three-band active layout with a fixed top-right status/action slot and a
  bottom metadata rail.
- Keep provider, environment, and PR indicators anchored and content-sized while branch/worktree
  context takes the remaining width and truncates.
- Crossfade status/time and Settle using only opacity and transform, with no layout reflow and an
  instant reduced-motion fallback.
- Apply the same fixed slot principle to settlement time and Move to Active in compact settled
  rows.
- Preserve the rich hover card, context menu, disabled reasons, navigation target, and lifecycle
  actions.

## Task 4: Verify interaction, layout, and repository health

Files:

- browser tests adjacent to the changed components
- implementation files only where fixes are required

Work:

- Cover global Search in both desktop views and absence of duplicate Search controls.
- Cover selector icons, open/select/clear behavior, optional option search, keyboard navigation,
  and dependency resets.
- Assert row hover/focus does not move anchored provider metadata or the fixed action slot.
- Check long labels, narrow sidebar widths, light and dark themes, reduced motion, tooltip placement,
  Settle, Move to Active, and console errors in live browser QA.
- Run the required backstops from `AGENTS.md`:

  ```sh
  bun install --frozen-lockfile
  bun fmt
  bun run fmt:check
  bun lint
  bun typecheck
  bun run typecheck:effect
  bun run test
  bun run build
  bun run build --filter=@ryco/web
  bun run --cwd apps/web test:browser
  ```

- Install the pinned Playwright runtime first only if it is missing.
- Restart the development server after validation and leave the verified build available to the
  user.
