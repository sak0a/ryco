# Explorer File Editing Design

**Date:** 2026-08-10
**Status:** Approved for implementation planning

## Context

Ryco's file explorer can browse the workspace and render text files with syntax highlighting, but
it cannot edit those files. Two related implementations informed this design:

- [Synara 0.7.1](https://www.trysynara.com/changelog) added explicit, conflict-guarded saves for
  small edits made from Explorer.
- [T3Code](https://github.com/pingdotgg/t3code) uses `@pierre/diffs` as a rich, syntax-highlighted
  `contentEditable` surface in its file preview.

Ryco will combine the rich T3Code editing surface with Synara's safer explicit-save model. The
feature is intentionally for small, targeted code and text edits, not a replacement for a full IDE.

## Goals

- Let users edit supported workspace text files directly in the existing Explorer preview.
- Preserve syntax highlighting and line-number presentation while editing.
- Save only through an explicit Save action or Cmd/Ctrl+S.
- Never silently overwrite a file changed or deleted after it was opened.
- Preserve supported text encoding, line endings, and existing file permissions.
- Guard file switches and navigations that would discard an unsaved edit.
- Keep the implementation isolated, testable, and compatible with existing workspace-file writers.

## Non-goals

- Autosave.
- Multiple open edit buffers or tabs.
- A full IDE feature set such as language services, completion, diagnostics, search-and-replace, or
  multi-cursor editing.
- Editing binary files, images, oversized files, files outside the workspace, or files whose exact
  text format cannot be preserved safely.
- Extending the frozen `apps/web` phone presentation tier or adding native-mobile editing.
- Merging concurrent changes or offering a force-overwrite action.

## Product Decisions

### Editing surface

Supported files remain inside the existing syntax-highlighted preview and become editable through
`@pierre/diffs`' editor APIs. Editing is direct rather than hidden behind a separate plain-text
mode. The web app will move from `@pierre/diffs` 1.1.20 to stable 1.3.5 because 1.1.20 does not
export the editing API. The version change will be scoped to `apps/web`; server-side diff parsing
will remain on its existing version.

### Save model

Typing updates a local edit buffer only. The file is written when the user clicks Save or presses
Cmd/Ctrl+S. A successful save updates the buffer's clean baseline and server version. Save is
disabled when the buffer is clean or a save is already in flight.

### Dirty-file navigation

Selecting another file while the current file is dirty opens a compact confirmation dialog:

- **Save & Open** saves the current file and opens the requested file only after success.
- **Discard** drops the current draft and opens the requested file without writing.
- **Cancel** closes the dialog and keeps the current editor active.

The same guard should protect panel, thread, project, or route transitions where Ryco can block the
transition. Browser or desktop-window unload also receives the native unsaved-change warning. The
feature owns one active edit buffer; it does not keep background drafts for multiple files.

### Visible states

The selected-file toolbar shows the workspace-relative path and, when dirty, a compact dirty dot,
Discard, and a primary Save button with the Cmd/Ctrl+S hint. A successful save clears the dirty
state without a disruptive toast. Read-only files show a concise reason in the same area.

Save errors appear in an inline alert beneath the selected-file toolbar. A conflict never replaces
the user's draft. The alert explains that the file changed on disk and offers Reload from disk;
reloading is an explicit destructive action and is confirmed if the draft is still dirty.

## Architecture

### Web component boundaries

`PreviewPanel` remains responsible for workspace context, file-tree loading, selected-file loading,
and responsive panel layout. Editing behavior is split into focused units:

- `WorkspaceFileEditor` owns the `@pierre/diffs` `Editor`, `EditProvider`, editable `File`, caret and
  focus lifecycle, and propagation of edited contents.
- A small edit-session module owns the original document metadata, current contents, dirty/saving
  state, conflict state, and pending-navigation intent. Its state transitions are framework-free and
  unit tested.
- `PreviewPanel` coordinates Save, Discard, Reload, and guarded file selection using that session.
  It does not embed persistence logic into the tree-row click handler.

The editor instance is stable for a selected document and is cleaned up on unmount. Cache keys must
incorporate the live editor file revision so syntax highlighting updates without destroying focus or
resetting the caret. Refetched file data replaces the editor baseline only while the buffer is clean.
If a refetch reports a new version while the buffer is dirty, the draft remains intact and the
session becomes conflicted.

### Client data access

The existing project preview query remains the source for file contents. A focused write command or
hook calls the environment's existing `projects.writeFile` RPC and updates the keyed read-file cache
after a successful guarded save. File-tree invalidation remains server-owned.

No save request is sent for unsupported or incomplete documents. Switching environments, projects,
or workspaces cannot reuse an edit session because the session key includes environment, workspace
root, and resolved relative path.

### Contract changes

Add the following metadata to a complete text-file read:

- `version`: a content-derived identifier, represented as a SHA-256 value.
- `encoding`: `utf8` or `utf8-bom`.
- `lineEnding`: `lf`, `crlf`, `cr`, or `mixed`.

Extend write input with optional `expectedVersion`, `encoding`, and `lineEnding` fields. Existing
callers that create plans or attachments may continue using unguarded writes. Explorer editing always
supplies all guarded-write fields. A successful write returns the new `version` in addition to the
resolved relative path.

Write errors expose a typed reason sufficient for the client to distinguish conflict, deletion,
unsupported format, and general persistence failures without parsing message strings.

### Server behavior

Reads open a regular file through a handle, enforce the existing preview-size limit, reject binary
or invalid UTF-8 content, detect a UTF-8 BOM and line endings, and calculate the version from the
exact bytes read. The editable contents use normalized LF internally; format metadata preserves the
original bytes on save.

A guarded write:

1. Resolves the target within the authorized workspace and refuses a missing or replaced target.
2. Encodes the normalized editor contents using the original BOM and consistent line ending.
3. Writes and syncs a uniquely named, exclusive temporary regular file beside the target.
4. Re-reads and verifies the current target version and file identity immediately before replace.
5. Preserves the existing permission bits and atomically renames the validated temporary file over
   the target.
6. Removes only its own validated temporary file after a failure.
7. Invalidates workspace-entry caches and returns the new version after success.

Symlinks may only be followed when their resolved target remains inside the workspace. Existing
path-containment rules remain authoritative, and a guarded edit must never create a new file after
the original target was deleted.

## Supported and Read-only Files

A file is editable only when it is a complete regular UTF-8 workspace file at or below the preview
limit with a supported BOM and one consistent line-ending style. Empty files are valid editable
documents. The following remain read-only when they can be previewed, or retain their existing
unsupported-preview state when no safe preview can be produced:

- images, binary data, and invalid UTF-8;
- files outside the active workspace;
- files above the preview-size limit, which continue to show the existing too-large state;
- files with mixed line endings;
- files whose read metadata or current version is unavailable.

For files that can be previewed, read-only status must not prevent line wrapping, selection, or
existing open-in-editor actions.

## Error and Recovery Behavior

- **Conflict:** keep the draft, disable repeated saves until the user explicitly reloads or discards
  it, and explain that the disk version changed.
- **Deleted target:** keep the draft and explain that Explorer will not recreate the deleted file.
- **Write failure:** keep the draft and allow retry.
- **Disconnected environment:** keep the draft in component state, surface the write failure, and
  allow retry after reconnection while the panel remains mounted.
- **Save during file switch:** retain the pending target and switch only after success.
- **New external version while clean:** adopt it as the new baseline.
- **New external version while dirty:** preserve the draft and mark the session conflicted.

## Accessibility and Keyboard Behavior

- The editor has an accessible label containing the file path.
- Dirty and saving states are exposed through status text, not color alone.
- Save, Discard, Reload, and dialog actions are real buttons with visible focus states.
- Cmd/Ctrl+S prevents the browser's default save-page action only while the Explorer editor is
  focused and a file can be saved.
- The confirmation dialog traps focus, starts on Save & Open, closes on Escape as Cancel, and returns
  focus to the previously selected file row or editor.

## Testing and Validation

Validation stays focused on the affected contracts, server workspace service, and web Explorer.
Use the Bun version pinned in `package.json`, and install dependencies with
`bun install --frozen-lockfile` after the dependency and lockfile update is complete.

### Contract tests

- Decode read metadata, guarded write input, new write result, and typed failure reasons.
- Keep legacy unguarded write inputs valid.

### Server tests

- Read version generation and changes after content changes.
- UTF-8, UTF-8 BOM, LF, CRLF, and CR round trips.
- Mixed line endings and unsupported encodings remain non-editable.
- Successful atomic replacement preserves permissions.
- Version mismatch, deletion, concurrent target replacement, path escape, and symlink containment.
- Temporary-file cleanup after failures.

### Web unit tests

- Edit-session transitions for change, save start/success/failure, conflict, discard, reload, and
  pending navigation.
- Read-only eligibility and error presentation helpers.

### Web browser tests

- The highlighted file surface accepts edits without losing focus or the caret.
- Dirty status and Save/Discard controls appear after a change.
- Save button and Cmd/Ctrl+S send the guarded payload and clear dirty state after success.
- Save failure and conflict preserve the draft.
- Save & Open, Discard, and Cancel take their specified paths.
- Clean refetches update content; dirty refetches preserve content and mark a conflict.
- Unsupported files remain previewable but not editable.

Run formatting and typechecks only for affected files/packages plus these focused tests. Do not run
the full repository suite or build unless implementation changes expand beyond this design's
localized contract, workspace-service, and Explorer boundaries.

## Acceptance Criteria

1. A user can directly edit syntax-highlighted supported text in Explorer.
2. No file write occurs before explicit Save or Cmd/Ctrl+S.
3. A successful save preserves supported original text formatting and file permissions.
4. A stale edit cannot silently overwrite an agent or external change.
5. Dirty navigation always offers Save & Open, Discard, and Cancel where navigation can be blocked.
6. Save errors preserve the draft and offer an understandable recovery path.
7. Existing read-only previews and unguarded workspace-file creation flows continue working.
8. Focused contract, server, unit, and browser tests cover the feature's critical paths.
