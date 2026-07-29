# Restrict Ryco workspace access to the startup directory

**Date:** 2026-07-29
**Status:** Approved direction; implementation pending

## Context

The final positional argument to `ryco`, `ryco start`, and `ryco serve` is currently a startup
working directory. It is not an access boundary. Filesystem browsing accepts absolute paths,
projects and clone destinations may be created elsewhere, and terminal validation checks only that
the initial working directory exists. Once a terminal or provider process starts, it may also use
absolute paths or traverse to parent directories.

Hosted operators need an opt-in mode that limits every Ryco-managed workspace selection to the
directory supplied at startup. The mode must not imply that application-level path checks can
confine an arbitrary child process.

## Decision

Add an optional `--restrict-to-cwd` boolean flag to the root server command, `start`, and `serve`.
When enabled, the resolved final positional working directory is the workspace access root.

```sh
ryco serve \
  --restrict-to-cwd \
  --base-dir /path/to/node-state \
  /path/to/allowed-workspace
```

If the positional directory is omitted, the resolved process working directory is the access root.
When the flag is omitted or explicitly disabled, current unrestricted behavior remains unchanged.
This first version is CLI-only; it does not add a second environment-variable configuration
surface.

The flag creates a Ryco application boundary:

- filesystem browsing cannot resolve or navigate above the access root;
- project roots must equal the access root or be descendants of it;
- missing project roots may be created only below the access root;
- repository clone destinations must be below the access root;
- workspace file operations continue to be relative to an allowed project and reject symlink
  escapes;
- terminal open and restart requests accept only allowed project/worktree directories;
- existing persisted projects or live worktree references outside the root make restricted startup
  fail closed with a bounded remediation error.

The server's `--base-dir` remains a separate trusted internal state directory. Logs, secrets,
attachments, databases, caches, and other server-owned state are not made browseable merely because
they are required by the process. New app-managed worktrees created while restriction is enabled
must be placed beneath the access root so they do not weaken the path invariant.

## Security boundary

`--restrict-to-cwd` is not an operating-system sandbox. It prevents a remote client from selecting
an out-of-root path through Ryco RPCs, but it cannot stop an interactive shell or coding-agent child
process from executing `cd ..`, opening an absolute path, or invoking another program.

Operators who do not trust terminal or agent users must run the Ryco node inside an OS-level
container or equivalent sandbox. That runtime should expose only:

- the allowed workspace as a read-write mount;
- the Ryco state directory as a separate read-write mount;
- the minimum runtime files and executables needed by enabled providers.

No host home directory or unrelated source directory should be mounted. The CLI flag remains useful
inside the container because it also constrains Ryco navigation and produces clear application
errors, while the container supplies the hard process boundary.

The help text and documentation must use “restrict Ryco-managed workspace paths” rather than
“sandbox” or “filesystem isolation.”

## Architecture

### Configuration

`apps/server/src/cli.ts` will expose `--restrict-to-cwd` through the shared server flags and resolve
it before constructing `ServerConfig`. `ServerConfigShape` will carry an optional canonical
`workspaceAccessRoot`. The root is resolved once at startup after the working directory is created
and validated.

Unrestricted test and runtime layers use `workspaceAccessRoot: undefined`.

### Central path policy

A new server service, `WorkspaceAccessPolicy`, will be the single owner of process-wide workspace
root enforcement. Callers must not duplicate `startsWith` checks.

The service will provide operations for:

- checking an existing directory or file path;
- checking a not-yet-created directory by resolving its nearest existing ancestor;
- checking project roots and clone destinations;
- checking terminal and app-worktree roots;
- determining whether a restricted root is configured.

Containment uses path-relative component checks, never string prefixes. For existing targets, the
policy compares canonical real paths. For missing targets, it:

1. performs the lexical component check;
2. resolves the nearest existing ancestor;
3. rejects an ancestor whose real path is outside the canonical root;
4. revalidates the created destination before it becomes a project or clone result.

This rejects direct traversal and ordinary symlink escapes. It does not claim protection against a
host-local adversary racing filesystem mutations; the container boundary is required for that
threat model.

Denials use one typed, bounded `WorkspaceAccessDeniedError`. Client-facing messages may identify the
configured root and rejected operation, but must not enumerate unrelated paths or directory
contents.

### Enforcement points

The policy is applied at the server-owned boundaries where untrusted paths enter:

1. `WorkspaceEntries.browse` validates the resolved parent before reading it. At the root, the
   returned navigation state has no usable parent above the root.
2. Orchestration project normalization validates existing and create-if-missing workspace roots
   before a `project.create` command is accepted.
3. `SourceControlRepositoryService.cloneRepository` validates the destination before creating its
   parent and revalidates the completed clone.
4. Terminal open and restart validate their initial directory through the policy in addition to the
   existing directory check.
5. Worktree creation selects a directory beneath the configured access root in restricted mode and
   validates the result before publishing it.
6. Startup checks persisted active project roots and live worktree references before readiness.
   Restricted startup fails instead of silently exposing, deleting, or rewriting incompatible
   persisted state.

Once project and worktree roots pass this boundary, existing project-relative file APIs retain their
stricter realpath and symlink protections. Source-control and provider operations that derive their
working directory from a validated project do not add independent path parsing.

### Hosted and direct clients

The policy is server-global and applies identically to direct, desktop, and hosted relay RPCs. The
Hub remains an opaque relay and requires no code or protocol change.

The server configuration snapshot may expose the optional access root so the web folder picker can
stop parent navigation at the boundary and choose a useful initial location. Server validation
remains authoritative; hiding a UI control is not enforcement.

## Existing state and failure behavior

Enabling the flag against a base directory containing an active out-of-root project or live
out-of-root worktree fails startup before mutation capability becomes available. The error explains
that the operator must either:

- restart without the restriction, remove or archive the incompatible project/worktree, and retry;
  or
- use a fresh `--base-dir` for the restricted node.

The check does not delete or rewrite persisted data. Disabling the flag restores existing
unrestricted behavior.

An out-of-root browse, project, clone, terminal, or worktree request fails deterministically and
does not create partial directories or persist orchestration events.

## Documentation

CLI help and the Hub connector guide will include:

- the exact `--restrict-to-cwd` invocation;
- the distinction between the workspace path and `--base-dir`;
- the application-boundary limitations;
- a container recommendation for untrusted terminal or agent access;
- a migration note for existing out-of-root projects and worktrees.

## Testing

Focused coverage will include:

- CLI parsing on the root, `start`, and `serve` commands;
- omitted, enabled, and explicitly disabled behavior;
- canonical roots, sibling prefix collisions, `..` traversal, and platform separators;
- existing symlinks and missing destinations beneath symlinked ancestors;
- browse-at-root and attempted parent/absolute navigation;
- project add/create inside and outside the root;
- clone inside and outside the root, including no partial outside directory;
- terminal open/restart inside and outside the root;
- restricted worktree placement and validation;
- fail-closed startup with incompatible persisted project/worktree state;
- unchanged unrestricted behavior;
- hosted browser coverage for folder navigation and project/clone error presentation.

The complete repository backstop and browser suite required by `AGENTS.md` must pass.

## Non-goals

- Building a cross-platform process sandbox into Ryco.
- Parsing or enforcing paths in the Hub.
- Restricting trusted server state beneath `--base-dir`.
- Per-user or per-Hub-account filesystem roots.
- Multiple allowed roots in one server process.
- Retrofitting an environment-variable equivalent in this first change.
