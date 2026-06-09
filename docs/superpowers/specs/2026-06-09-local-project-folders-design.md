# Local Project Folders Design

**Date:** 2026-06-09
**Branch:** `feat-add-folders-to-projects__tuhok`
**Status:** Approved for spec review

## Goal

Add local sidebar folders for projects. A user can create a named folder such
as "WordPress", move multiple projects into it, and drag projects in, out, or
between folders.

Folders are sidebar organization only. They do not change project identity,
workspace paths, threads, worktrees, orchestration events, server settings, or
SQLite projections.

## Current State

The relevant pieces already exist in the web app:

- `apps/web/src/uiStateStore.ts` persists local sidebar state such as project
  expanded state and manual project order in `localStorage`.
- `apps/web/src/logicalProject.ts` defines physical project keys from
  environment id and project path. The sidebar already uses these keys for
  manual project ordering.
- `apps/web/src/sidebarProjectGrouping.ts` builds visible sidebar project
  snapshots from physical projects and repository grouping settings.
- `apps/web/src/components/Sidebar.tsx` already uses `@dnd-kit` for project
  drag-and-drop when manual project sorting is enabled.

This means v1 should extend the local sidebar state and tree-building layer
instead of adding new orchestration commands or persistence tables.

## Non-goals

- No nested folders.
- No shared/server-synced folder state.
- No folder commands in the CLI.
- No project metadata changes.
- No folder-level bulk operations on threads or projects.
- No change to existing repository/environment project grouping semantics.

## User Model

Folders appear as collapsible rows in the project section of the left sidebar.
Each folder has a name and a list of project rows.

Root layout:

```text
WordPress
  plugin-a
  plugin-b
  plugin-c

ryco
docs-site
```

A visible sidebar project row may represent one physical project or a grouped
set of physical projects, depending on the existing repository grouping mode.
Dragging that visible row into a folder moves all of its member physical project
keys together so grouped rows stay atomic.

Deleting a folder only removes the folder. Its projects move back to the root.
Deleting a project removes stale folder membership during the next sidebar
state sync.

## Data Model

Add a frontend-only project folder model to `uiStateStore`.

```ts
type UiProjectFolderId = string;
type UiProjectTreeItemId = `folder:${UiProjectFolderId}` | `project:${string}`;

interface UiProjectFolder {
  id: UiProjectFolderId;
  name: string;
  projectKeys: string[];
  expanded: boolean;
  createdAt: string;
  updatedAt: string;
}
```

The `projectKeys` entries are physical project keys from
`derivePhysicalProjectKey`, not project ids. This aligns folders with the
current manual project ordering behavior and makes folder membership independent
from orchestration project id replacement.

`UiState` should gain:

```ts
projectFoldersById: Record<string, UiProjectFolder>;
projectFolderOrder: string[];
projectTreeOrder: UiProjectTreeItemId[];
```

`projectOrder` remains as the existing flat order for backward compatibility
and for current consumers that only need a flat project list. The sidebar uses
`projectTreeOrder` when rendering folders. Existing persisted state without
folders decodes to no folders and a tree order derived from the flat project
order.

Persisted local storage gains matching optional fields under the existing
`ryco:ui-state:v1` key. Missing fields decode to empty folder state.

## Tree Building

Add a small pure helper module, for example
`apps/web/src/sidebarProjectFolders.ts`, that accepts:

- visible `SidebarProjectSnapshot[]`
- local folder state
- current project sort order

and returns a tree:

```ts
type SidebarProjectTreeRow =
  | { kind: "folder"; folder: UiProjectFolder; projects: SidebarProjectSnapshot[] }
  | { kind: "project"; project: SidebarProjectSnapshot };
```

Rules:

- A visible grouped project belongs to the folder containing any of its member
  physical project keys.
- If stale persisted state puts members of one visible grouped row in different
  folders, the first matching folder in current tree order wins and the row is
  rendered only once.
- Unknown project keys are pruned from folders during `syncProjects`.
- Empty folders are retained. Users can keep a folder ready for future projects.
- In non-manual sort modes, projects inside each folder are sorted by the active
  project sort mode. In manual mode, folder child order follows the folder's
  `projectKeys`.

Root ordering uses `projectTreeOrder` so folders and ungrouped projects can be
interleaved. If `projectTreeOrder` is missing or incomplete, the builder appends
missing folders and projects deterministically after retained entries.

## Mutations

Add pure state reducers in `uiStateStore`:

- `createProjectFolder(name, initialProjectKeys?)`
- `renameProjectFolder(folderId, name)`
- `deleteProjectFolder(folderId)`
- `setProjectFolderExpanded(folderId, expanded)`
- `moveProjectsToFolder(projectKeys, folderId, targetIndex?)`
- `moveProjectsToRoot(projectKeys, targetIndex?)`
- `moveProjectsBetweenFolders(projectKeys, sourceFolderId, targetFolderId, targetIndex?)`
- `reorderProjectTreeItem(activeItemId, overItemId)`

All mutations should:

- remove moved project keys from every other folder before inserting them;
- keep folder `projectKeys` unique;
- keep `projectFolderOrder`, `projectTreeOrder`, and `projectOrder`
  deterministic;
- persist through the existing debounced local-storage writer;
- treat unknown folder ids or project keys as no-ops.

## Sidebar UX

### Creating Folders

Add a folder action to the project section controls. The action opens a small
name dialog and creates an empty folder.

Project row menus should also include "New folder with project". That creates a
folder and moves the selected visible project row into it.

### Folder Rows

Folder rows show:

- folder icon
- folder name
- project count
- expand/collapse chevron
- overflow menu

Folder overflow menu:

- Rename
- Delete folder

Delete folder must use neutral wording that makes clear projects are not
deleted.

### Moving Projects

Drag-and-drop behavior:

- Drag a project onto a folder row to move it into that folder.
- Drag a project from a folder to the root drop area to move it out.
- Drag a project from one folder to another to move it.
- In manual sort mode, dragging within a folder also reorders that folder's
  projects.
- In manual sort mode, dragging folders or ungrouped project rows at root
  updates `projectTreeOrder`.

Membership drag can work in every project sort mode. Sibling reordering only has
an effect in manual sort mode because non-manual modes continue to sort by
created or updated timestamps.

The existing project drag handle should remain the primary drag affordance.
Folder rows can expose their own drag handle only in manual sort mode.

## Error Handling

Folder state is local and should never block core chat/project usage.

- Corrupt local-storage folder data decodes to empty folder state.
- Storage write failures are ignored, matching existing UI state persistence.
- Stale project keys are pruned during project sync.
- Drag events with missing active or target rows are no-ops.

## Testing

Add focused tests for pure logic first:

- folder creation, rename, delete, and expanded state;
- moving projects into, out of, and between folders;
- grouped project rows staying atomic when moved;
- stale project keys being pruned during `syncProjects`;
- root order preserving folders and ungrouped projects;
- manual child order versus timestamp sorting inside folders;
- persistence hydration with missing folder fields.

Add a small sidebar wiring test if practical for:

- folder row rendering;
- project row menu action for "New folder with project";
- drag intent mapping from project-to-folder and project-to-root.

Before implementation is considered complete, run:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Do not run `bun test`; use `bun run test` for any targeted test execution.
