# Sidebar directory identity implementation plan

**Design:** `docs/superpowers/specs/2026-07-29-sidebar-directory-identity-design.md`

**Goal:** Render one sidebar workspace row per environment-scoped physical directory and keep
branch changes as mutable metadata rather than workspace identity.

## Task 1: Define and test sidebar directory identity

**Files:**

- Modify: `apps/web/src/lib/projectPaths.ts`
- Modify: `apps/web/src/lib/projectPaths.test.ts`
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarTree.ts`
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarTree.test.ts`

1. Reuse the project path comparison rules for worktree paths instead of lowercasing every path.
2. Add environment and source-project metadata to internal sidebar worktree candidates.
3. Resolve an effective directory from `worktreePath ?? sourceProject.cwd`.
4. Build the stable presentation key from environment plus normalized effective directory.
5. Pin Windows separator/case behavior, Unix case sensitivity, and per-environment isolation with
   unit tests.

## Task 2: Adapt projects, worktrees, and threads by physical directory

**Files:**

- Modify: `apps/web/src/components/sidebar/sidebarTreeAdapters.ts`
- Modify: `apps/web/src/components/sidebar/sidebarTreeAdapters.test.ts`
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarTree.ts`
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarTree.test.ts`

1. Preserve each projected worktree's environment and source physical project.
2. Synthesize an original-directory candidate for every physical member of a logical project.
3. Merge projected and synthesized candidates by directory key while preferring real worktree IDs
   and projected source-control metadata.
4. Bind threads to the directory where they run; use worktree ID only when it resolves to that same
   directory.
5. Select branch display metadata deterministically without using it as directory identity.
6. Add regressions for main-workspace branch changes, worktree branch changes, conflicting IDs,
   grouped physical projects, and projected/synthetic merges.

## Task 3: Propagate branch metadata to projected worktrees

**Files:**

- Modify: `packages/contracts/src/orchestration.ts`
- Modify: `apps/server/src/orchestration/decider.ts`
- Modify: `apps/server/src/orchestration/projector.ts`
- Modify: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- Modify: `packages/client-runtime/src/state/threads/store.ts`
- Modify: `apps/web/src/components/BranchToolbarBranchSelector.tsx`
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- Modify relevant focused tests beside each layer

1. Extend `worktree.meta.update` and `worktree.metaUpdated` with an optional branch.
2. Persist and stream the branch patch through the in-memory projector, SQL projection, and client
   runtime store.
3. When an attached thread changes branch, dispatch a matching worktree metadata update.
4. When the server automatically renames a temporary branch, update the attached projected
   worktree in the same command sequence.
5. Preserve legacy behavior for unattached threads.

## Task 4: Focused verification

1. Run the affected web sidebar/path tests.
2. Run the affected contracts, decider, projection, client-runtime, and provider-reactor tests.
3. Inspect the diff for unrelated changes and generated declarations.

## Task 5: Full validation

1. Confirm the repository uses the Bun version pinned in `package.json`.
2. Install dependencies with `bun install --frozen-lockfile`.
3. Run:

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

4. Inspect the final worktree and report any unrelated pre-existing files separately.
