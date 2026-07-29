# Sidebar Directory Identity Design

**Date:** 2026-07-29
**Status:** Approved for spec review

## Goal

Render at most one workspace row per physical directory inside a visible sidebar
project, including the project's original workspace directory. Changing the
checked-out branch in a directory must update that row's metadata rather than
create another row.

Threads remain attached to their orchestration project and optional worktree for
commands and persistence, but sidebar placement is primarily determined by the
directory in which the thread runs.

## Current State

The sidebar already attempts to merge equivalent worktree rows:

- projected and synthesized main rows share a special `project:main` key;
- non-main rows with a `worktreePath` are merged by a normalized path;
- a thread first matches a worktree by `worktreeId`, then by literal
  `worktreePath`, and finally by branch when both paths are `null`.

This is incomplete for the original project directory. Its directory is encoded
as `worktreePath: null`, so a thread that changes from `main` to another branch
no longer matches the synthesized main row. The tree builder can then synthesize
a second branch row even though both rows represent the same project `cwd`.

Branch changes also update thread metadata without consistently updating the
projected worktree row. Branch is therefore used as both mutable display
metadata and fallback identity, which can leave stale labels and split one
directory into multiple rows.

Path comparison is inconsistent as well. Project paths preserve case on Unix
and compare case-insensitively on Windows, while worktree normalization
lowercases every path. Worktree rows in a logical project also omit the source
environment and physical project identity needed to distinguish identical path
strings on different machines.

## Scope

This change covers sidebar tree composition and its adapters for web clients.
It also updates the branch metadata flow where needed so a renamed or switched
branch is reflected on the existing directory row.

The change does not:

- add a database migration or a unique database constraint;
- merge directories across different environments or nodes;
- change project grouping settings;
- change worktree creation, archive, restore, or deletion semantics;
- move threads between orchestration projects;
- remove `worktreeId`, `branch`, or `worktreePath` from contracts or
  persistence.

## Directory Identity

Introduce one pure sidebar directory-identity helper used by adapters, tree
composition, and tests.

For a thread or worktree candidate, resolve:

```ts
interface SidebarDirectoryRef {
  environmentId: EnvironmentId;
  sourceProjectId: ProjectId;
  directory: string;
}
```

The effective directory is:

- `worktreePath` when it is non-null;
- otherwise the source physical project's `cwd`.

The stable comparison key is:

```text
environmentId + normalized effective directory
```

`sourceProjectId` is retained on the reference so actions can resolve the
correct physical project, but it is not part of equality. Two project records
for the same normalized directory in one environment describe the same sidebar
directory. The same path string in two environments describes two different
directories.

Path normalization follows existing project-path semantics:

- trim surrounding whitespace and trailing separators;
- normalize Windows separators and compare Windows paths case-insensitively;
- preserve case for Unix paths;
- do not resolve symlinks or access the filesystem while building the sidebar.

This keeps tree composition deterministic and synchronous. Server-produced
paths are expected to be absolute and already canonical enough for lexical
comparison.

## Adapter Changes

Extend the internal `SidebarWorktree` model with enough source identity to
resolve its directory:

```ts
interface SidebarWorktree {
  environmentId: EnvironmentId;
  sourceProjectId: ProjectId;
  // existing fields...
}
```

The fields are internal web presentation metadata, not contract additions.

When adapting projected worktrees:

1. Resolve their physical project from `environmentId + projectId`.
2. Preserve that environment and physical project ID.
3. Resolve a directory key from `worktreePath ?? physicalProject.cwd`.

When synthesizing rows from threads:

1. Preserve the thread's environment and source project.
2. Use the same effective-directory resolution.
3. Synthesize no additional row when that directory key already exists.

Synthetic main candidates remain useful for physical project members without
threads or projected worktrees. Create one candidate per physical member, and
represent each candidate with that member's `environmentId`, project ID, and
`cwd` rather than one abstract `null` location for the logical group.

If a logical sidebar project groups multiple physical projects, each
environment-scoped directory remains a separate workspace row. Threads and
actions continue to use their source physical project.

## Tree Composition

Replace branch-based worktree grouping with directory-based grouping.

For every visible logical project:

1. Build candidates from projected worktrees, synthesized fallback rows, and
   thread directories.
2. Group candidates by the environment-scoped directory key.
3. Merge each group into one `SidebarTreeWorktree`.
4. Place every thread into the group with the same directory key.

`worktreeId` remains a preferred direct association when it resolves to a
candidate with the same directory. It must not override a conflicting
directory, because sidebar placement describes where the thread actually runs.
Legacy threads without a worktree ID use the directory key directly.

Branch names never participate in directory equality.

### Merge precedence

When several candidates describe one directory:

- prefer a real projected `worktreeId` over a synthesized ID;
- preserve projected title, origin, archive state, manual position, and linked
  work-item metadata;
- prefer branch metadata from the projected worktree after a branch-metadata
  event, otherwise use the most recently updated active thread in the
  directory, then fall back to the existing projected branch;
- use the non-null `worktreePath` for non-main worktrees and the source
  project's `cwd` only as the computed effective directory for main;
- never duplicate the thread list while merging candidates.

Archived projected worktrees remain in the archived section. An active and an
archived record for the same directory must not cause an active thread to
disappear: an active candidate or active thread makes the visible directory
group active, while archive metadata remains available only when every
authoritative candidate for that directory is archived.

## Branch Metadata

Branch is mutable metadata of a directory.

The branch selector continues updating the active thread optimistically. Extend
the existing worktree metadata command/event and its projection handling with
an optional branch field. Where the thread has a projected `worktreeId`, the
branch-change path dispatches the thread and worktree metadata updates so shell
snapshots and other threads observe the current branch.

Automatic temporary-branch renaming follows the same rule: update the thread
and its attached projected worktree in the same command sequence when a
worktree ID exists. Legacy threads without an attachment still render correctly
because the sidebar uses directory identity and can take the current thread's
branch as fallback display metadata.

The change must not bulk-rewrite historical thread branch fields. Those fields
remain denormalized snapshots used by existing runtime code; they no longer
control sidebar directory membership.

## Error Handling and Compatibility

- Missing physical-project metadata falls back to the current logical project
  representative only when environment and project resolution are impossible.
  This preserves current rendering rather than dropping the row.
- An empty or invalid effective directory falls back to the existing worktree
  ID grouping behavior, then to branch grouping as a last compatibility path.
  Valid projected projects and threads should not use this fallback.
- Existing persisted sidebar folder/order state is unchanged because project
  keys do not change.
- Existing worktree and thread records need no data migration.
- Worktree actions continue using the selected real projected worktree ID.
  Synthesized-only rows keep the existing restricted action behavior.

## Testing

Add focused unit coverage for the pure adapter and tree-composition layers:

1. A thread in the original project directory changes from `main` to a feature
   branch and remains under one row.
2. A worktree thread changes branch without changing `worktreePath` and remains
   under one row.
3. Multiple threads with different recorded branches but the same directory
   render under one row.
4. A projected row and a synthesized row for the same directory merge and keep
   the projected worktree ID.
5. The project `cwd` and a candidate representing the original folder merge.
6. Trailing separator and Windows separator/case variants merge correctly.
7. Unix paths that differ only by case remain distinct.
8. The same path string in two environments remains two rows.
9. Two physical project records for the same normalized directory in one
   environment produce one sidebar directory row.
10. A conflicting `worktreeId` does not place a thread under a different
    directory.
11. Branch metadata updates retain projected title, archive state, manual
    position, and work-item metadata.
12. Existing base-row deduplication, sorting, archived grouping, draft-thread
    rendering, and logical-project grouping tests continue to pass.

If branch metadata propagation changes server commands or events, add matching
contract, decider, projection pipeline, client-runtime store, and command
reactor tests.

Because this affects web interaction and sidebar rendering, validation includes
the full repository backstop plus the required web build and browser suite:

```sh
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

Install the pinned browser runtime first with
`bun run --cwd apps/web test:browser:install` if it is unavailable.

## Acceptance Criteria

- A physical directory appears at most once within a visible sidebar project
  for a given environment.
- The original project directory follows the same rule as managed worktrees.
- Changing or renaming a branch does not create another sidebar row.
- Every thread is displayed under the row for its effective directory.
- Branch remains visible as current metadata without determining row identity.
- Identical path strings on different environments remain distinct.
- Existing project grouping, worktree actions, archived rows, thread sorting,
  and draft behavior remain functional.
