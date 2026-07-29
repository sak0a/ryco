# Restrict-to-cwd implementation plan

**Design:** `docs/superpowers/specs/2026-07-29-restrict-to-cwd-design.md`

**Goal:** Add an opt-in CLI mode that restricts every Ryco-managed workspace path to the resolved
startup directory while preserving current unrestricted behavior and explicitly avoiding a false
process-sandbox claim.

## Task 1: Add the typed CLI and runtime configuration

**Files:**

- Modify: `apps/server/src/cli.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/cli-config.test.ts`
- Modify: `apps/server/src/cli.test.ts`

1. Add failing parser/config tests for `--restrict-to-cwd` on the root, `start`, and `serve`
   commands, including the standard negative boolean form.
2. Add the optional boolean to the shared server CLI flags.
3. Resolve the canonical workspace access root from the final positional `cwd` only when enabled.
4. Carry `workspaceAccessRoot: string | undefined` in `ServerConfigShape` and every test/default
   layer.
5. Verify omission and explicit disablement preserve unrestricted behavior.

## Task 2: Introduce one canonical workspace access policy

**Files:**

- Add: `apps/server/src/workspace/Services/WorkspaceAccessPolicy.ts`
- Add: `apps/server/src/workspace/Layers/WorkspaceAccessPolicy.ts`
- Add: `apps/server/src/workspace/Layers/WorkspaceAccessPolicy.test.ts`
- Modify: `apps/server/src/server.ts`

1. Add failing tests for root equality, descendants, sibling-prefix collisions, parent traversal,
   existing symlink escapes, missing targets below symlinked ancestors, and unrestricted mode.
2. Define one typed `WorkspaceAccessDeniedError` with bounded operation metadata.
3. Implement component-aware lexical checks and canonical realpath checks.
4. For missing targets, find and validate the nearest existing ancestor.
5. Add a post-creation validation operation for project, clone, and worktree callers.
6. Wire one live policy layer from `ServerConfig`; provide an unrestricted test layer for focused
   tests.

## Task 3: Enforce and present the filesystem browse boundary

**Files:**

- Modify: `apps/server/src/workspace/Layers/WorkspaceEntries.ts`
- Modify: `apps/server/src/workspace/Layers/WorkspaceEntries.test.ts`
- Modify: `packages/contracts/src/filesystem.ts`
- Modify the web folder-browser hook/component that owns parent navigation
- Add or modify its focused browser test

1. Add failing server tests for browsing the root, a descendant, `..`, an absolute sibling, and a
   symlink resolving outside.
2. Validate the resolved browse parent before `readdir`.
3. Return an optional boundary root in the browse result so clients can stop parent navigation
   without weakening server authority.
4. Keep the boundary field optional for compatibility with independently upgraded peers.
5. Add browser coverage proving the root has no usable parent navigation and a server denial is
   presented as a stable browse error.

## Task 4: Restrict project creation and repository cloning

**Files:**

- Modify: `apps/server/src/orchestration/Normalizer.ts`
- Modify: focused orchestration normalizer tests
- Modify: `apps/server/src/sourceControl/SourceControlRepositoryService.ts`
- Modify: `apps/server/src/sourceControl/SourceControlRepositoryService.test.ts`

1. Add failing project tests for an existing in-root directory, create-if-missing below the root,
   parent/sibling paths, and symlink escapes.
2. Validate before filesystem creation and revalidate before dispatching the normalized
   `project.create`.
3. Add failing clone tests for in-root and out-of-root destinations, including a missing target
   beneath an escaping symlink.
4. Validate before parent creation, then revalidate the completed clone before returning it.
5. On denial or clone failure, avoid persisting a project and avoid creating an out-of-root partial
   directory.

## Task 5: Keep terminals and generated worktrees inside the application boundary

**Files:**

- Modify: `apps/server/src/terminal/Layers/Manager.ts`
- Modify: focused terminal manager tests
- Modify: `apps/server/src/ws/context/worktreeOperations.ts`
- Modify: `apps/server/src/ws/context.ts`
- Modify: focused worktree/server tests

1. Add failing terminal open/restart tests for allowed and denied initial directories.
2. Apply the central policy after the existing directory validation.
3. In restricted mode, derive new app worktrees beneath an internal directory inside the access
   root instead of the external `--base-dir`.
4. Validate prepared and completed worktree paths before publishing them.
5. Preserve current worktree placement in unrestricted mode.
6. Keep the documented limitation that an already-running shell or provider process requires OS
   isolation for hard confinement.

## Task 6: Fail closed on incompatible persisted state

**Files:**

- Modify the startup/runtime module that loads the first orchestration snapshot before readiness
- Add focused startup/server tests

1. Add failing tests with active persisted projects and live worktree references outside the
   configured root.
2. Validate the first authoritative snapshot through `WorkspaceAccessPolicy` before mutation
   readiness.
3. Fail startup with a bounded remediation message and no data mutation.
4. Verify a fresh base directory, fully in-root state, and unrestricted startup continue to work.

## Task 7: Document the operational contract

**Files:**

- Modify: `docs/hub-connector.md`
- Modify CLI help snapshots/tests if present

1. Add the exact `ryco serve --restrict-to-cwd ... /allowed/workspace` example.
2. Explain that `--base-dir` is trusted internal state and not the workspace root.
3. State plainly that terminals and coding-agent processes require a container or OS sandbox for
   hard isolation.
4. Add migration guidance for a base directory containing incompatible existing projects or
   worktrees.

## Task 8: Validate and publish

1. Install the pinned Bun version and frozen lockfile if needed:
   `bun install --frozen-lockfile`.
2. Run focused tests after each task.
3. Run the complete repository backstop:

   ```sh
   bun fmt
   bun run fmt:check
   bun lint
   bun typecheck
   bun run typecheck:effect
   bun run test
   bun run build
   bun run build --filter=@ryco/web
   bun run --cwd apps/web test:browser:install
   bun run --cwd apps/web test:browser
   ```

4. Review the final diff for generated files, public-repository safety, accidental Hub details, and
   unrelated user changes.
5. Commit the implementation separately from the design and plan, push the branch, and open a
   public PR.
6. After merge, update the private Hub vendor pin in a separate authorized PR; no Hub relay
   implementation change is expected.
