# Source-Control Refresh and Status Motion Implementation Plan

Design: `docs/superpowers/specs/2026-08-16-source-control-refresh-and-status-motion-design.md`

## Objective

Implement the approved shared PR/workflow refresh policy and continuous semantic active-status
motion without regressing hidden-tab behavior, request deduplication, reduced motion, or the external
performance budgets.

## Task 1: Refresh-mode contract and policy

Files:

- `packages/contracts/src/settings.ts`
- relevant settings contract tests
- `apps/web/src/rpc/sourceControlRefreshPolicy.ts`
- `apps/web/src/rpc/sourceControlRefreshPolicy.test.ts`

Steps:

1. Add `SourceControlRefreshMode = "automatic" | "reduced" | "manual"` and default it to
   `automatic` in the client settings schema and patch.
2. Add a pure policy API that maps mode plus discovery/active/settled state to 10/30 seconds,
   30/60 seconds, or no timer.
3. Encode the 90-second discovery deadline, stale foreground-refresh eligibility, and retry/backoff
   bounds in pure helpers.
4. Cover default decoding, legacy decoding, each cadence, settlement, discovery expiry, and backoff.

Focused validation:

```sh
bun run --cwd packages/contracts test src/settings.test.ts
bun run --cwd apps/web test src/rpc/sourceControlRefreshPolicy.test.ts
```

## Task 2: Settings UI and persistence

Files:

- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/settingsSearchIndex.ts`
- settings browser/unit tests
- local settings persistence tests where required by the schema addition

Steps:

1. Rename the visible `Git status polling` row to `Remote Git status` without renaming its stored
   field.
2. Add `PR & workflow updates` with Automatic, Reduced, and Manual choices.
3. Add reset behavior, search metadata, accessible labels, and explanatory copy.
4. Verify old persisted settings decode with Automatic selected.

Focused validation:

```sh
bun run --cwd apps/web test src/components/settings/SettingsPanels.browser.tsx
bun run --cwd apps/web test src/localApi.test.ts
```

## Task 3: Canonical shared refresh ownership

Files:

- `packages/client-runtime/src/rpc/keyedQuery.ts`
- `packages/client-runtime/src/rpc/keyedQuery.test.ts`
- `apps/web/src/rpc/sourceControlAtoms.ts`
- `apps/web/src/rpc/sourceControlAtoms.test.ts`
- `apps/web/src/rpc/useSourceControl.ts`

Steps:

1. Extend keyed query polling so a controller can retain multiple subscriber interval resolvers and
   choose the shortest enabled cadence rather than allowing the last watcher to overwrite policy.
2. Inject lifecycle-aware scheduling into the source-control registry: clear timers on background
   and offline transitions, and perform one stale refresh on foreground/resume/online only for modes
   that permit it.
3. Preserve completion scheduling, in-flight joining, generation protection, bounded jitter, idle
   GC, and the 192-entry source-control cap.
4. Add branch to the workflow-run canonical input/key so default-branch Overview and Project
   Explorer requests can share the same binding.
5. Add refresh methods and batch observation needed by Overview, including per-run job subscriptions
   that reuse the canonical workflow-job binding.
6. Cover two watchers sharing one request/timer, independent release, policy changes, lifecycle
   pause/resume, stale foreground refresh, and no timer in Manual/settled modes.

Focused validation:

```sh
bun run --cwd packages/client-runtime test src/rpc/keyedQuery.test.ts
bun run --cwd apps/web test src/rpc/sourceControlAtoms.test.ts
```

## Task 4: Migrate Overview and Project Explorer

Files:

- `apps/web/src/rpc/useOverview.ts`
- `apps/web/src/rpc/overviewAtoms.ts`
- `apps/web/src/rpc/overviewAtoms.test.ts`
- `apps/web/src/components/chat/ChatOverviewPanel.tsx`
- `apps/web/src/components/projectExplorer/PullRequestsTab.tsx`
- `apps/web/src/components/projectExplorer/PullRequestDetail.tsx`
- `apps/web/src/components/projectExplorer/WorkflowRunsSection.tsx`
- related component logic tests

Steps:

1. Replace Overview's independent PR/workflow poll ownership with adapters over the canonical
   source-control bindings.
2. Feed the selected refresh mode into one shared policy resolver for post-push discovery, active
   checks, active jobs, and settled states.
3. Use the same resolver in Project Explorer instead of hard-coded 30-second intervals.
4. Keep invalidations after push, rerun, merge, review, and related mutations scoped and
   request-joined.
5. Retain or add explicit Refresh actions for Manual mode.
6. Remove superseded overview timers/controllers while preserving existing hook result shapes and
   cached-data behavior.
7. Test identical Overview/Project Explorer queries producing one RPC request and one active timer.

Focused validation:

```sh
bun run --cwd apps/web test src/rpc/overviewAtoms.test.ts src/components/chat/ChatOverviewPanel.test.ts
bun run --cwd apps/web test src/components/projectExplorer
```

## Task 5: Continuous semantic status motion

Files:

- `apps/web/src/index.css`
- `apps/web/src/components/ThreadStatusIndicators.tsx`
- `apps/web/src/components/sidebar/SidebarProjectHeader.tsx`
- `apps/web/src/components/sidebar/sidebarStatusText.ts`
- remaining `animate-status-pulse` call sites
- `apps/web/src/perf/statusAnimations.test.ts`
- targeted browser tests

Steps:

1. Add a semantic activity-signal primitive with a stable core and continuous 1.8-second
   transform/opacity halo.
2. Replace the six-second sidebar shimmer with a continuous 2.35-second wave whose semantic crest is
   always present in active text.
3. Apply blue flow to working/connecting/generating/monitoring and amber flow to active review.
4. Keep awaiting input, approval, plan ready, completed, failed, cancelled, interrupted, and stopped
   static.
5. Replace generic pulsing icons with a subtle continuous scale/opacity breathe where a halo is not
   structurally available.
6. Keep hidden-document pausing and both stored/OS reduced-motion static fallbacks.
7. Bound active text to its inline paint area and test several simultaneous active rows.

Focused validation:

```sh
bun run --cwd apps/web test src/perf/statusAnimations.test.ts
bun run --cwd apps/web test:browser -- src/components/sidebar/SidebarWorktreeList.browser.tsx src/components/chat/MessagesTimeline.browser.tsx
```

## Task 6: Active source-control performance scenario

Files:

- `scripts/perf/model.ts`
- `scripts/perf/browserProbe.ts`
- `scripts/perf/runner.ts`
- new or existing source-control fixture support
- `scripts/perf/*.test.ts`
- `docs/performance-testing.md`

Steps:

1. Add a deterministic active-source-control scenario that can observe Overview and Project Explorer
   against the same canonical query without storing credentials or private identifiers.
2. Record foreground discovery/active cadence, hidden requests, settled requests, task time, long
   tasks, heap, and process-tree RSS.
3. Assert one request stream for duplicate UI observers, zero hidden polling, and zero timer-driven
   requests after settlement.
4. Exercise multiple active status rows to measure the approved continuous motion.
5. Document local and CI usage plus fixture privacy requirements.

Focused validation:

```sh
bun run --cwd scripts test perf
bun run perf:smoke
```

## Task 7: Backstops and delivery

1. Format changed files and run diff checks.
2. Run changed-package typechecks and lint.
3. Run focused web, client-runtime, contracts, and performance suites.
4. Because the completed change crosses source-control lifecycle and browser motion, build the web
   package and run the relevant browser suite.
5. Run the production external smoke and the active-source-control scenario under a monitored
   13-GiB cutoff; verify no server/provider/browser process remains.
6. Run the controlled main-versus-candidate comparison if the external metrics or bundle graph
   changed materially.
7. Commit by coherent boundary, fetch/rebase-audit against `origin/main`, push the branch, update PR
   #302 evidence, and verify checks.

Commands must use the pinned Bun version. Never invoke `bun test`; use package `bun run ... test`
scripts as shown above.
