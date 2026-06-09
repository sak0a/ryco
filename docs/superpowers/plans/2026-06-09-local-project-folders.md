# Local Project Folders Implementation Plan

> **For agentic workers:** implement task-by-task and keep the first pass scoped
> to local sidebar organization. Do not add orchestration commands, server
> settings, SQLite migrations, or contract changes for folders.

**Goal:** Add local project folders to the left sidebar so users can create
named groups, then drag projects into, out of, and between those folders.

**Spec:** `docs/superpowers/specs/2026-06-09-local-project-folders-design.md`

**Verification commands** (run all green before considering the implementation
complete):

```bash
bun fmt
bun lint
bun typecheck
```

Use `bun run test` for targeted Vitest runs. Never run `bun test`.

---

## Task 1: Add Local Folder State Reducers

**Purpose:** Extend `uiStateStore` with deterministic, tested folder state
without touching sidebar rendering yet.

**Files:**

- `apps/web/src/uiStateStore.ts`
- `apps/web/src/uiStateStore.test.ts`

**Steps:**

- [ ] Add `UiProjectFolderId`, `UiProjectTreeItemId`, and `UiProjectFolder`
      types.
- [ ] Add `projectFoldersById`, `projectFolderOrder`, and `projectTreeOrder` to
      `UiState`.
- [ ] Add optional persisted fields for folders under the existing
      `ryco:ui-state:v1` payload.
- [ ] Sanitize persisted folder state defensively: - invalid folder records are dropped; - duplicate folder ids are collapsed; - duplicate project keys inside a folder are removed; - invalid tree item ids are ignored.
- [ ] Add pure reducers: - `createProjectFolder` - `renameProjectFolder` - `deleteProjectFolder` - `setProjectFolderExpanded` - `moveProjectsToFolder` - `moveProjectsToRoot` - `moveProjectsBetweenFolders` - `reorderProjectTreeItem`
- [ ] Ensure every project move removes the moved keys from every other folder
      before inserting them.
- [ ] Keep existing `projectOrder` updates deterministic so current flat-order
      consumers keep working.
- [ ] Extend `syncProjects` to prune stale folder memberships and append missing
      root project tree items.

**Tests:**

- [ ] Hydrating old persisted state without folder fields yields empty folders.
- [ ] Corrupt persisted folder data decodes to empty or sanitized folder state.
- [ ] Creating, renaming, deleting, and expanding a folder updates state only.
- [ ] Deleting a folder moves its projects back to root ordering.
- [ ] Moving projects into, out of, and between folders keeps membership unique.
- [ ] `syncProjects` prunes missing project keys from folders.
- [ ] Existing project order and expanded-state tests still pass.

**Acceptance:**

- Folder state can be manipulated entirely through pure reducers.
- Existing sidebar behavior is unchanged because no rendering uses folders yet.

---

## Task 2: Build Project Folder Tree Helpers

**Purpose:** Isolate the transformation from visible project snapshots plus
local folder state into renderable sidebar rows.

**Files:**

- New: `apps/web/src/sidebarProjectFolders.ts`
- New: `apps/web/src/sidebarProjectFolders.test.ts`
- `apps/web/src/sidebarProjectGrouping.ts` only if a shared type export is
  needed

**Steps:**

- [ ] Define `SidebarProjectTreeRow`: - `{ kind: "folder"; folder; projects }` - `{ kind: "project"; project }`
- [ ] Add `buildSidebarProjectFolderTree(input)` that accepts visible
      `SidebarProjectSnapshot[]`, folder state, `projectTreeOrder`, and current
      project sort mode.
- [ ] Resolve folder membership by physical project key. A grouped visible row
      belongs to the first folder containing any of its member physical keys.
- [ ] Render a grouped row only once even if stale local state references its
      members across multiple folders.
- [ ] Preserve empty folders.
- [ ] Append missing folders and root projects deterministically when persisted
      `projectTreeOrder` is incomplete.
- [ ] In manual sort mode, order folder children by folder `projectKeys`.
- [ ] In non-manual sort modes, order folder children by the existing project
      sort comparator.

**Tests:**

- [ ] Ungrouped projects render at root when no folders exist.
- [ ] Empty folders render.
- [ ] Projects assigned to a folder render under that folder and not at root.
- [ ] Grouped project snapshots move as one row.
- [ ] Conflicting stale membership picks the first folder in tree order.
- [ ] Missing tree entries are appended predictably.
- [ ] Manual and timestamp sorting produce the expected child order.

**Acceptance:**

- Sidebar components can consume a single tree row array without duplicating
  folder membership logic.

---

## Task 3: Render Folder Rows in the Sidebar

**Purpose:** Add visible folder rows and context actions while keeping current
project rows reusable.

**Files:**

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/Sidebar.logic.ts` if small reusable helpers are
  needed
- Existing sidebar component tests if applicable

**Steps:**

- [ ] Read folder state and folder actions from `useUiStateStore`.
- [ ] Build the folder tree after `sidebarProjects` are built.
- [ ] Add a `SidebarProjectFolderRow` component with: - folder icon; - folder name; - project count; - expand/collapse chevron; - overflow menu.
- [ ] Add a project-section action to create an empty folder through a small
      name dialog.
- [ ] Add "New folder with project" to project row menus. It creates a folder
      and moves all member physical project keys into it.
- [ ] Add folder rename dialog.
- [ ] Add delete-folder confirmation copy that makes clear projects are not
      deleted.
- [ ] Render project rows inside expanded folder rows by reusing
      `SidebarProjectItem`.
- [ ] Keep active-project highlighting and thread lists working for foldered
      projects.

**Tests:**

- [ ] Folder rows render with project counts.
- [ ] Collapsing a folder hides its project rows.
- [ ] "New folder with project" creates a folder containing all member physical
      keys.
- [ ] Deleting a folder keeps projects visible at root.

**Acceptance:**

- Users can create, rename, expand/collapse, and delete local folders without
  drag-and-drop.
- Projects inside folders still behave like the existing project rows.

---

## Task 4: Wire Drag-and-Drop Membership

**Purpose:** Reuse the existing `@dnd-kit` sidebar project drag system for
folder membership and manual ordering.

**Files:**

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/uiStateStore.ts`
- `apps/web/src/uiStateStore.test.ts`
- `apps/web/src/sidebarProjectFolders.test.ts` if tree behavior needs more
  coverage

**Steps:**

- [ ] Give folder rows stable drag/drop ids distinct from project ids.
- [ ] Add a root project drop target for moving foldered projects back to root.
- [ ] Update `handleProjectDragEnd` to classify drag intents: - project over folder -> `moveProjectsToFolder`; - project over root -> `moveProjectsToRoot`; - project over project in same folder -> reorder folder children in manual
      mode; - project over project in another folder -> move to that folder near the
      target; - folder over folder or root project -> reorder root tree items in manual
      mode.
- [ ] Keep existing manual project reorder behavior for no-folder cases.
- [ ] Allow membership moves in every project sort mode.
- [ ] Restrict sibling reorder effects to manual project sort mode.
- [ ] Prevent click toggles immediately after drag, matching existing behavior.

**Tests:**

- [ ] Project-to-folder drag moves all member physical keys.
- [ ] Project-to-root drag removes folder membership.
- [ ] Project between folders updates membership once.
- [ ] Manual within-folder reorder changes child order.
- [ ] Non-manual within-folder drag does not persist sibling order.
- [ ] Root tree reorder handles folder rows and ungrouped project rows.

**Acceptance:**

- Drag-and-drop covers creating membership, removing membership, moving between
  folders, and manual ordering without introducing a second DnD library.

---

## Task 5: Polish Persistence and Recovery Behavior

**Purpose:** Make the local-only feature robust under project id replacement,
environment changes, and corrupted local storage.

**Files:**

- `apps/web/src/uiStateStore.ts`
- `apps/web/src/uiStateStore.test.ts`
- `apps/web/src/sidebarProjectFolders.test.ts`

**Steps:**

- [ ] Verify folder membership uses physical project keys from
      `derivePhysicalProjectKey`.
- [ ] Ensure persisted folder membership survives project id replacement for
      the same environment/path.
- [ ] Ensure removed environments prune their project keys from folders during
      sync.
- [ ] Ensure empty folders survive sync.
- [ ] Ensure storage write failures are ignored like existing UI state writes.
- [ ] Confirm old local-storage shapes still hydrate.

**Tests:**

- [ ] Same `environmentId + cwd` with a new project id remains foldered.
- [ ] Removed environment/project keys are pruned.
- [ ] Empty folders persist after all child projects disappear.
- [ ] Malformed folder storage does not throw during store creation.

**Acceptance:**

- Folder state behaves like durable local UI preference data, not fragile
  runtime state.

---

## Task 6: Final Verification

**Purpose:** Confirm the feature is ready to ship and the repo requirements are
satisfied.

**Steps:**

- [ ] Run targeted tests for changed logic, using `bun run test`.
- [ ] Run `bun fmt`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Manually exercise: - create empty folder; - create folder with project; - rename folder; - delete folder; - drag project into folder; - drag project out to root; - drag project between folders; - collapse and expand folder; - switch project sort modes.

**Acceptance:**

- All required checks pass.
- Manual sidebar behavior matches the approved spec.
