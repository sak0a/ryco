# Sidebar Inbox and Settlement Lifecycle Implementation Plan

**Status:** Ready for implementation authorization

**Design:** `docs/plans/2026-07-31-sidebar-inbox-design.md`

**Goal:** Add a durable, server-backed thread settlement lifecycle; expose it through a global
desktop/web Inbox beside the existing Workspace tree; and align the existing native mobile Inbox
with the same shared policy.

**Phase-one scope:** Manual settle/unsettle, automatic settlement for merged or closed pull
requests, mixed-version capability handling, native mobile parity, reconnect safety, and bounded
large-list rendering.

**Deferred:** Snooze, inactivity settlement, worktree-level settlement, server-side Inbox paging,
and changes to the frozen web phone presentation.

## Execution rules

- Use Bun `1.3.14`, as pinned by `package.json`.
- Install with `bun install --frozen-lockfile`.
- Never run `bun test`; use `bun run test` or the package-level `test` scripts.
- Add a failing focused regression before each production behavior change.
- Keep `packages/contracts` schema-only and keep DOM/React Native imports out of
  `packages/client-runtime`.
- Put the pure lifecycle policy in the explicit `@ryco/shared/threadSettlement` export. Do not
  duplicate blocker precedence in the server, web, and mobile apps.
- Treat server projection state as authoritative. Client-local queues may add blockers, but they
  may not force a thread into settled state.
- Keep archive, pinning, status buckets, settlement, and future snooze as distinct concepts.
- Do not extend or remove the frozen `apps/web` phone tier.
- Do not add settlement events to the per-thread detail stream. Shell snapshots and
  `thread-upserted` events carry lifecycle state.
- Preserve hosted lifecycle ownership: only a current authorized shell generation may enable
  settlement mutations.
- Before staging each commit, compare `git status --short` with the implementation-start
  baseline. Preserve and report unrelated user/generated files.
- Do not stage the currently unrelated generated declaration edits or Android `.gradle/`
  directories.

## Dependency order

```text
contracts + shared policy
            │
            ▼
server command lifecycle ──► SQL projection + shell snapshots
            │                            │
            └──────────────┬─────────────┘
                           ▼
                 client-runtime model
                    │              │
                    ▼              ▼
               web Inbox      native Inbox
                    └──────┬───────┘
                           ▼
             reconnect, version-skew, a11y,
              performance, and full backstop
```

The user-visible toggle must not land before the server capability and client-runtime fallback are
in place. A new client connected to an old server must remain active-only, and an old snapshot
must decode before any UI code runs.

## Commit 1: Define the lifecycle contract and shared policy

Suggested commit:

```text
feat(contracts): define thread settlement lifecycle
```

### Task 1.1: Add backward-compatible contract fields and capability

**Files:**

- Modify: `packages/contracts/src/environment.ts`
- Create: `packages/contracts/src/environment.test.ts`
- Modify: `packages/contracts/src/orchestration.ts`
- Modify: `packages/contracts/src/orchestration.test.ts`

**Tests first:**

- Decode an environment descriptor with no `threadSettlement` field and assert `false`.
- Decode old full-thread and shell-thread payloads with no lifecycle fields and assert:

  ```ts
  settledOverride === null;
  settledAt === null;
  ```

- Round-trip `"settled"`, `"active"`, and `null` overrides.
- Round-trip `thread.settle` and the client form of `thread.unsettle`.
- Reject a client `thread.unsettle` command whose reason is `"activity"`.
- Round-trip `thread.settled` and both server event reasons for `thread.unsettled`.

**Implementation:**

1. Add `threadSettlement` to `ExecutionEnvironmentCapabilities` with a decoding default of
   `false`.
2. Define and export `ThreadSettlementOverride` as `"settled" | "active"`.
3. Add defaulted lifecycle fields to `OrchestrationThread` and `OrchestrationThreadShell`:

   ```ts
   settledOverride: ThreadSettlementOverride | null;
   settledAt: IsoDateTime | null;
   ```

4. Add client-dispatchable `thread.settle`.
5. Add client-dispatchable `thread.unsettle` with `reason: "user"` as a literal.
6. Add `thread.settled` and `thread.unsettled` to the event type and event union. The event-side
   unset reason is `"user" | "activity"`.
7. Add both commands to `DispatchableClientOrchestrationCommand`,
   `ClientOrchestrationCommand`, and `OrchestrationCommand`.
8. Keep automatic PR settlement out of the persisted override and out of these command payloads.

**Acceptance:**

- Old descriptors and snapshots decode without migration-time client failures.
- A client cannot construct a schema-valid activity reset.
- The TypeScript unions remain exhaustive.

### Task 1.2: Implement the one shared settlement policy

**Files:**

- Create: `packages/shared/src/threadSettlement.ts`
- Create: `packages/shared/src/threadSettlement.test.ts`
- Modify: `packages/shared/src/threadActivity.ts`
- Modify: `packages/shared/src/threadActivity.test.ts`
- Modify: `packages/shared/package.json`

**Public API:**

Expose the module only through:

```text
@ryco/shared/threadSettlement
```

The module should export small structural input types plus:

```ts
hasQueuedTurnStart(input): boolean
canSettleThread(input): { canSettle: boolean; blocker: SettlementBlocker | null }
classifyThreadSettlement(input): "active" | "settled" | "excluded"
getEffectiveSettlementTimestamp(input): string | null
compareActiveInboxEntries(left, right): number
compareSettledInboxEntries(left, right): number
```

Extend `@ryco/shared/threadActivity` with a small
`derivePendingThreadRequestState(activities)` helper. It returns pending approval/input booleans
from ordered request/resolution activity, including the existing stale-request failure cleanup.
The server decider and SQL shell-summary projection must consume this helper instead of maintaining
two request-lifecycle implementations.

Use a normalized input rather than importing app-specific thread types. The normalized input must
carry only:

- archived/deleted timestamps;
- parent-worktree archive timestamp;
- settlement capability;
- override and explicit settlement time;
- orchestration session status;
- latest-turn state and timestamps;
- latest user-message timestamp;
- pending approval/input booleans;
- PR state and worktree update time;
- client-local queued/delivery-unknown booleans;
- pinned state, creation time, scoped key, and a supplied current time where required.

**Tests first:**

- Table-test every override × PR-state × blocker combination.
- Assert blockers win over explicit settlement and PR automation.
- Assert explicit `"active"` suppresses merged/closed PR automation.
- Assert reopening a PR wakes a neutral auto-settled thread.
- Assert unsupported environments remain active.
- Assert archived threads and archived parent worktrees are excluded.
- Assert a recent user message newer than the adopted turn is queued for two minutes.
- Cover a user timestamp slightly ahead of the local clock.
- Cover an old unmatched message outside the grace window.
- Assert a failed latest turn or failed session start clears the queued-start blocker.
- Assert pending request derivation handles request, resolution, stale-response cleanup, and
  unrelated activities in deterministic activity order.
- Treat invalid blocker timestamps conservatively as active.
- Fall back through valid effective timestamp candidates without allowing `NaN` ordering.
- Assert deterministic active ordering: pinned, creation descending, scoped key.
- Assert deterministic settled ordering: effective settlement descending, creation descending,
  scoped key.
- Use property-oriented checks for comparator antisymmetry and deterministic tie-breaking.

**Implementation constraints:**

1. Return a blocker reason, not only a boolean, so all clients can explain disabled settlement.
2. Use the orchestration status (`starting`/`running`), not the legacy display phase.
3. Keep client-local queue and delivery uncertainty as additive blockers.
4. Do not read the system clock internally except through an explicit defaultable clock seam.
5. If an automatic PR-settled row has no valid effective timestamp, keep it active rather than
   hiding it with unstable ordering.
6. Avoid importing Zustand, React, SQL, or platform APIs.

**Focused verification:**

```sh
bun run --cwd packages/contracts test -- src/environment.test.ts
bun run --cwd packages/contracts test -- src/orchestration.test.ts
bun run --cwd packages/shared test -- \
  src/threadSettlement.test.ts \
  src/threadActivity.test.ts
```

## Commit 2: Make settlement authoritative on the server

Suggested commit:

```text
feat(server): persist and project thread settlement
```

### Task 2.1: Add the idempotent SQL migration

**Files:**

- Create: `apps/server/src/persistence/Migrations/042_ProjectionThreadsSettled.ts`
- Create: `apps/server/src/persistence/Migrations/042_ProjectionThreadsSettled.test.ts`
- Modify: `apps/server/src/persistence/Migrations.ts`

**Tests first:**

- Migrate a database through migration 41, apply migration 42, and inspect both columns.
- Run migration 42 against a table where neither column exists.
- Run it against a repair fixture where only one column exists.
- Run it again after both columns exist.
- Assert existing rows read both values as SQL `NULL`.

**Implementation:**

1. Inspect `PRAGMA table_info(projection_threads)`.
2. Add `settled_override TEXT` only when absent.
3. Add `settled_at TEXT` only when absent.
4. Register migration 42 in the static import list and `migrationEntries`.
5. Do not add an index; phase one partitions the existing shell snapshot client-side.

### Task 2.2: Extend the projection-thread repository

**Files:**

- Modify: `apps/server/src/persistence/Services/ProjectionThreads.ts`
- Modify: `apps/server/src/persistence/Layers/ProjectionThreads.ts`
- Create: `apps/server/src/persistence/Layers/ProjectionThreads.test.ts`

**Tests first:**

- Upsert/read each override state.
- Update a row from settled to active and verify `settled_at` clears.
- Verify list ordering remains creation-based and unchanged.
- Verify an old/null row maps to null lifecycle fields.

**Implementation:**

1. Add `settledOverride` and `settledAt` to `ProjectionThread`.
2. Add both columns to insert, conflict-update, `getById`, and `listByProjectId`.
3. Keep the repository API row-oriented; do not add a separate mutation method unless profiling
   demonstrates that full-row upserts are a bottleneck.

### Task 2.3: Enforce settle invariants in the decider

**Files:**

- Modify: `apps/server/src/orchestration/commandInvariants.ts`
- Modify: `apps/server/src/orchestration/commandInvariants.test.ts`
- Modify: `apps/server/src/orchestration/decider.ts`
- Create: `apps/server/src/orchestration/decider.settlement.test.ts`
- Modify: `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- Modify: `apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts`

**Tests first:**

- Reject settle for archived/deleted threads.
- Reject settle when the attached worktree is archived.
- Reject settle for pending approval or user input.
- Reject settle for `starting` or `running` sessions.
- Reject settle during the queued-turn grace period.
- Accept settle for an eligible idle thread.
- Re-settle an explicitly settled thread without changing its original `settledAt` or
  `updatedAt`.
- Unsettle an explicit settlement into override `"active"`.
- Unsettle a neutral merged/closed-PR thread into override `"active"`.
- Re-unsettle an explicitly active thread without changing `updatedAt`.
- Verify command aggregate routing for both new command types.

**Implementation:**

1. Add a normalized full-read-model adapter that derives:
   - latest user-message time from `thread.messages`;
   - pending approval/input state from `derivePendingThreadRequestState(thread.activities)`;
   - attached worktree state through `worktreeId`, with the existing safe path fallback only where
     current worktree helpers already allow it.
2. Call the shared `canSettleThread` policy from a new invariant helper.
3. For a first accepted `thread.settle`, use one `nowIso()` value for `settledAt`, `updatedAt`, and
   event occurrence.
4. For a repeated settle with a new command ID, emit the same original `settledAt` and unchanged
   `updatedAt`. This satisfies the engine's non-empty-event invariant while remaining a projected
   no-op.
5. For a user unsettle:
   - set override `"active"`;
   - clear `settledAt`;
   - use a new timestamp unless the thread is already explicitly active.
6. Add both commands to `commandToAggregateRef`.

### Task 2.4: Reset stale overrides on real activity

**Files:**

- Modify: `apps/server/src/orchestration/decider.ts`
- Modify: `apps/server/src/orchestration/decider.settlement.test.ts`

**Tests first:**

- A user turn start prepends `thread.unsettled(reason: "activity")` before message and turn-start
  events when an override exists.
- A session transition to `starting` or `running` resets an override before the session event.
- `approval.requested` and `user-input.requested` activities reset an override.
- Neutral threads do not emit redundant activity-unsettled events.
- Idle/session-complete bookkeeping does not repeatedly churn lifecycle timestamps.
- One command containing multiple emitted events projects each event in order before deciding the
  next state.

**Implementation:**

1. Add one internal helper that conditionally creates an activity-unsettled event.
2. Use it from:
   - `thread.turn.start`;
   - `thread.session.set` for `starting`/`running`;
   - `thread.activity.append` for approval/input requests.
3. Activity resets clear the override to `null`; they do not set `"active"`.
4. Preserve existing event causation between the user-message and turn-start events.
5. Do not expose activity reset as a client command.

### Task 2.5: Project events into memory, SQL, and snapshots

**Files:**

- Modify: `apps/server/src/orchestration/projector.ts`
- Modify: `apps/server/src/orchestration/projector.test.ts`
- Modify: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- Modify: `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`
- Modify: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- Modify: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts`
- Modify: `apps/server/src/ws/context/orchestrationStreams.test.ts`

**Tests first:**

- Thread creation initializes both fields to null in memory and SQL.
- `thread.settled` writes `"settled"` plus the accepted time.
- User unset writes `"active"` and clears the time.
- Activity unset writes null/null.
- Full-thread and shell-thread snapshots return identical lifecycle values.
- A settlement event produces a shell `thread-upserted`.
- A settlement event does not appear in the per-thread detail stream.
- Snapshot restore followed by a new event produces the same state as uninterrupted projection.

**Implementation:**

1. Extend every full and shell thread-row schema and SQL select in
   `ProjectionSnapshotQuery.ts`.
2. Map the fields into both `OrchestrationThread` and `OrchestrationThreadShell`.
3. Initialize null fields in the in-memory projector and SQL projection pipeline.
4. Replace the pipeline-local pending-user-input reducer with the shared request-state helper.
5. Handle both settlement events in both projectors.
6. Let the shell stream's existing thread-aggregate fallback query the updated shell row.
7. Deliberately leave `isThreadDetailEvent` unchanged and pin that choice with a regression.

### Task 2.6: Advertise support

**Files:**

- Modify: `apps/server/src/environment/Layers/ServerEnvironment.ts`
- Modify: `apps/server/src/environment/Layers/ServerEnvironment.test.ts`

**Tests first:**

- Assert new server descriptors advertise `threadSettlement: true`.

**Implementation:**

- Add the capability beside `repositoryIdentity`.

**Focused verification:**

```sh
bun run --cwd apps/server test -- \
  src/persistence/Migrations/042_ProjectionThreadsSettled.test.ts \
  src/persistence/Layers/ProjectionThreads.test.ts \
  src/orchestration/commandInvariants.test.ts \
  src/orchestration/decider.settlement.test.ts \
  src/orchestration/projector.test.ts \
  src/orchestration/Layers/OrchestrationEngine.test.ts \
  src/orchestration/Layers/ProjectionPipeline.test.ts \
  src/orchestration/Layers/ProjectionSnapshotQuery.test.ts \
  src/ws/context/orchestrationStreams.test.ts \
  src/environment/Layers/ServerEnvironment.test.ts
```

## Commit 3: Derive one global Inbox model in client-runtime

Suggested commit:

```text
feat(client-runtime): derive thread inbox settlement
```

### Task 3.1: Carry lifecycle fields through shell and detail state

**Files:**

- Modify: `packages/client-runtime/src/state/threads/types.ts`
- Modify: `packages/client-runtime/src/state/threads/store.ts`
- Modify: `packages/client-runtime/src/state/threads/store.test.ts`

**Tests first:**

- Map shell snapshots and detail snapshots with both lifecycle fields.
- Default missing lifecycle fields to null through contract decoding.
- Apply shell `thread-upserted` transitions for settle, user unset, and activity unset.
- Apply raw settlement events safely when replay code invokes the orchestration-event reducer.
- Replace an environment shell generation without retaining stale lifecycle fields.

**Implementation:**

1. Add the two fields to `Thread`, `ThreadShell`, and `SidebarThreadSummary`.
2. Update `mapThread`, `mapThreadShell`, `toThreadShell`, thread creation, event reducers, and all
   equality/write paths.
3. Keep settlement fields in shell summary state so global classification never requires a detail
   subscription.

### Task 3.2: Add the platform-neutral Inbox view model

**Files:**

- Create: `packages/client-runtime/src/state/threads/threadInbox.ts`
- Create: `packages/client-runtime/src/state/threads/threadInbox.test.ts`
- Modify: `packages/client-runtime/src/state/threads/index.ts`

**API shape:**

Provide a pure builder whose inputs include:

- cross-environment projects, worktrees, and sidebar thread summaries;
- per-environment descriptor/capability and connection/mutation state;
- scoped pinned-thread keys;
- scoped local-queue and delivery-unknown keys;
- optional client-local draft summaries;
- optional environment/project/worktree/text filters;
- a current routed thread key;
- a clock value for queued-start evaluation.

Return:

```ts
{
  active: ThreadInboxEntry[];
  settled: ThreadInboxEntry[];
  excludedCount: number;
}
```

Each entry should include the shared lifecycle result and presentation-neutral context:

- scoped thread key and reference;
- thread summary;
- project/worktree references;
- environment label;
- capability and mutation readiness;
- blocker reason;
- effective settlement timestamp;
- draft/pinned/current flags.

**Tests first:**

- Global all-environments output by default.
- Mixed supported and unsupported environments.
- Scoped worktree lookup cannot join identical worktree IDs across environments.
- Merged/closed PR automation and reopened PR behavior.
- Archived thread/worktree exclusion.
- Local queue and delivery-unknown blockers.
- Client-local drafts remain active and non-settleable.
- Draft promotion replaces, rather than duplicates, the row.
- Current settled route remains addressable in the returned model.
- Filters narrow presentation only and do not alter lifecycle classification.
- Active and settled ordering matches the shared comparators.
- Background status updates do not reorder active rows.

**Implementation:**

1. Build all lookup maps with scoped keys.
2. Adapt each summary to the shared classifier input.
3. Classify before applying presentation filters so counts and current-row reachability are
   predictable.
4. Treat missing capabilities as unsupported/active.
5. Treat disconnected, read-only, or not-yet-current shell state as mutation-disabled without
   hiding the row.
6. Reuse the sidebar's established eligibility semantics for user-visible top-level threads.
7. Keep labels and visual status strings out of this package.

### Task 3.3: Expose queue state without coupling it to classification

**Files:**

- Modify: `packages/client-runtime/src/state/message-queue/logic.ts`
- Modify: `packages/client-runtime/src/state/message-queue/logic.test.ts`

**Implementation:**

- Add a pure helper that returns the scoped keys with non-empty queues.
- Do not make the Inbox model import a Zustand store.
- Web and mobile pass their own queue snapshots into the same builder.

**Focused verification:**

```sh
bun run --cwd packages/client-runtime test -- \
  src/state/threads/store.test.ts \
  src/state/threads/threadInbox.test.ts \
  src/state/message-queue/logic.test.ts
```

## Commit 4: Extract shared web-sidebar inputs without behavior changes

Suggested commit:

```text
refactor(sidebar): share workspace data with inbox
```

### Task 4.1: Extract only the common data assembly

**Files:**

- Create: `apps/web/src/components/sidebar/sidebarData.ts`
- Create: `apps/web/src/components/sidebar/sidebarData.test.ts`
- Create: `apps/web/src/components/sidebar/hooks/useSidebarData.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify as needed: `apps/web/src/components/sidebar/sidebarTreeAdapters.ts`
- Modify as needed: `apps/web/src/components/sidebar/sidebarTreeAdapters.test.ts`

**Tests first:**

- The extracted model preserves current physical-to-logical project grouping.
- Environment labels and primary-environment preference remain unchanged.
- Scoped project/thread/worktree maps do not collide across environments.
- The current route resolves to the same logical project as before.
- Draft context and promoted-draft replacement remain unchanged.

**Implementation:**

1. Move cross-environment selection, project grouping, environment-label lookup, and scoped lookup
   map construction into a pure builder plus a thin hook.
2. Keep Workspace-only concerns in `Sidebar.tsx`:
   - project folders and manual project ordering;
   - drag/drop;
   - expansion state;
   - Workspace thread preview state;
   - project/worktree context actions.
3. Keep both projections mounted under one sidebar frame only when that is necessary to preserve
   state; otherwise render one projection and persist its intentional state in its owner.
4. Do not change rendered Workspace markup or ordering in this commit.

**Regression coverage:**

- Extend the closest existing sidebar browser test to compare project/worktree/thread output before
  and after extraction.
- Keep current screenshots stable unless the test harness itself needs a semantic locator update.

**Focused verification:**

```sh
bun run --cwd apps/web test -- \
  src/components/sidebar/sidebarData.test.ts \
  src/components/sidebar/sidebarTreeAdapters.test.ts \
  src/components/sidebar/hooks/useSidebarTree.test.ts
bun run --cwd apps/web test:browser -- src/components/sidebar/SidebarWorktreeList.browser.tsx
```

## Commit 5: Add the desktop/web Inbox and settlement actions

Suggested commit:

```text
feat(sidebar): add global inbox settlement view
```

### Task 5.1: Persist the Inbox/Workspace choice

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Modify: `packages/contracts/src/settings.test.ts`
- Modify: `apps/web/src/hooks/useSettings.ts` only if patch routing exposes a gap
- Create: `apps/web/src/components/sidebar/SidebarViewToggle.tsx`
- Create: `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

**Tests first:**

- Missing `sidebarViewMode` decodes to `"workspace"`.
- Both `"workspace"` and `"inbox"` persist through `ClientSettingsSchema`.
- `ClientSettingsPatch` accepts the new key.
- The segmented control has correct accessible roles, labels, selected state, keyboard operation,
  and focus visibility.
- Selecting a mode persists it and clears thread multi-selection.

**Implementation:**

1. Add:

   ```ts
   sidebarViewMode: "workspace" | "inbox";
   ```

   to client settings and the client patch schema.

2. Default to `"workspace"`.
3. Render the toggle below the existing shared header and above projection-specific content.
4. Do not render it in the frozen web phone tier; `AppSidebarLayout` already limits this sidebar to
   the desktop presentation.
5. Clear multi-selection whenever the mode changes.

### Task 5.2: Build the Inbox presentation

**Files:**

- Create: `apps/web/src/components/sidebar/inbox/SidebarInbox.tsx`
- Create: `apps/web/src/components/sidebar/inbox/SidebarInboxRow.tsx`
- Create: `apps/web/src/components/sidebar/inbox/SidebarSettledSection.tsx`
- Create: `apps/web/src/components/sidebar/inbox/SidebarInboxFilters.tsx`
- Create: `apps/web/src/components/sidebar/inbox/SidebarInbox.logic.ts`
- Create: `apps/web/src/components/sidebar/inbox/SidebarInbox.logic.test.ts`
- Create: `apps/web/src/components/sidebar/inbox/SidebarInbox.browser.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

**Presentation constants:**

```ts
const SETTLED_PAGE_SIZE = 20;
const INBOX_VIRTUALIZATION_THRESHOLD = 40;
```

Keep these in the pure logic module so behavior is tested and easy to tune.

**Tests first:**

- All environments/projects are visible with no filter.
- Environment, logical-project, directory/worktree, and text filters compose.
- Changing scope clears multi-selection.
- Active rows show attention status and compact project/directory/environment context.
- PR/issue/Jira chips reuse existing source-control presentation.
- Working rows remain readable and expose duration/status.
- Settled rows use the slim variant.
- The settled shelf starts collapsed, pages by 20, and does not page active rows.
- A currently routed settled row renders even while the shelf is collapsed.
- A list crossing the threshold uses one flattened virtualized list rather than nested
  virtualizers.
- Reduced motion and the existing density threshold disable expensive list animation.
- Only the small visible/prewarm window retains detail subscriptions.

**Implementation:**

1. Feed `threadInbox.ts` with:
   - shared sidebar data;
   - environment capabilities/readiness;
   - pin state;
   - web message-queue keys;
   - local draft summaries;
   - the current route.
2. Keep the default filter state as All.
3. Use one flattened row model for large lists so section headers, active rows, the settled shelf,
   and “Show more” can be virtualized together.
4. Reuse existing status indicators, work-item chips, provider colors, tooltip primitives, and
   sidebar spacing tokens.
5. Do not reuse `SidebarThreadRow` if doing so couples Workspace-only drag/rename/preview behavior
   into Inbox. Share smaller primitives instead.
6. Preserve active order during status changes.
7. Show update-server guidance for unsupported rows, but keep those rows active and navigable.
8. Empty states must distinguish:
   - no environments/projects/threads;
   - no active work but a non-empty settled shelf;
   - filters hiding otherwise visible work.

### Task 5.3: Add safe mutation wrappers and row actions

**Files:**

- Create: `apps/web/src/hooks/useThreadSettlementActions.ts`
- Create: `apps/web/src/hooks/useThreadSettlementActions.test.ts`
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarThreadActions.ts`
- Modify: `apps/web/src/components/sidebar/inbox/SidebarInboxRow.tsx`
- Modify: `apps/web/src/components/sidebar/inbox/SidebarInbox.tsx`
- Modify: `apps/web/src/components/sidebar/inbox/SidebarInbox.browser.tsx`

**Tests first:**

- Eligible active rows expose hover, keyboard, and context-menu Settle.
- Settled rows expose Unsettle.
- Ineligible rows explain the blocker and never dispatch.
- Unsupported environments never dispatch.
- Disconnected/read-only/not-current hosted environments never dispatch.
- Mixed-version rows gate independently.
- Double invocation while a command is pending produces one dispatch.
- Bulk settlement skips ineligible/unsupported rows, settles eligible rows, and reports counts.
- Bulk failure in one environment does not prevent independent eligible rows from being attempted.
- Switching mode/scope removes hidden selections from action scope.

**Implementation:**

1. Resolve `EnvironmentApi` at invocation time.
2. Gate by:
   - row capability;
   - shared policy result;
   - current environment connection/role;
   - hosted `orchestration.dispatchCommand` mutation capability;
   - a per-scoped-row pending-command set.
3. Dispatch `thread.settle` or `thread.unsettle(reason: "user")` with a new command ID.
4. Do not optimistically write lifecycle fields into the runtime store. A lightweight pending
   affordance is allowed; shell projection reconciles the result.
5. Bound bulk command concurrency to four and summarize succeeded, skipped, and failed counts in
   one toast.
6. Keep Archive/Delete separate and retain their current confirmation/running safeguards.

### Task 5.4: Make navigation race-safe

**Files:**

- Modify: `apps/web/src/hooks/useThreadSettlementActions.ts`
- Modify: `apps/web/src/hooks/useThreadSettlementActions.test.ts`
- Modify: `apps/web/src/components/sidebar/inbox/SidebarInbox.browser.tsx`

**Tests first:**

- Settling the current Inbox row navigates to the next active row.
- If there is no next row, it uses the previous active row.
- If no active row remains, the settled thread stays open.
- If the user navigates while the command is pending, command completion does not pull them back.
- Settling from Workspace never navigates.

**Implementation:**

1. Capture next/previous active refs from the current stable order before dispatch.
2. Await command acceptance.
3. Re-read the current route.
4. Navigate only when it still identifies the settled thread and the initiating projection was
   Inbox.
5. Keep the settled current row exposed until the route changes.

### Task 5.5: Preserve shell-generation and mixed-version safety

**Files:**

- Modify: `apps/web/src/versionSkew.test.ts`
- Modify: `apps/web/src/environments/runtime/service.threadSubscriptions.test.ts`
- Modify: `apps/web/src/hostedHub/lifecycle.integration.test.ts`
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarData.ts`
- Modify: `apps/web/src/hooks/useThreadSettlementActions.ts`

**Tests first:**

- An old descriptor and old shell render active-only rows.
- A supported saved environment and unsupported primary environment gate independently.
- A replacement shell generation replaces both thread lifecycle and worktree PR state.
- Stale-generation thread or worktree updates cannot reclassify current rows.
- Hosted reconnect keeps mutations disabled through authorization, relay connection, replay, and
  current shell acceptance.
- A disconnected retained snapshot stays visible but read-only.

**Implementation:**

1. Build capability/readiness input from the same environment-runtime record that owns the shell.
2. Never combine a thread from one accepted generation with worktree state from another.
3. Preserve current hosted supervisor ownership; do not create a parallel reconnect helper.
4. Do not touch service-worker caching.

**Focused verification:**

```sh
bun run --cwd packages/contracts test -- src/settings.test.ts
bun run --cwd apps/web test -- \
  src/components/sidebar/inbox/SidebarInbox.logic.test.ts \
  src/hooks/useThreadSettlementActions.test.ts \
  src/versionSkew.test.ts \
  src/environments/runtime/service.threadSubscriptions.test.ts \
  src/hostedHub/lifecycle.integration.test.ts
bun run --cwd apps/web test:browser -- \
  src/components/sidebar/SidebarViewToggle.browser.tsx \
  src/components/sidebar/inbox/SidebarInbox.browser.tsx
```

## Commit 6: Align the native mobile Inbox

Suggested commit:

```text
feat(mobile): align inbox with thread settlement
```

### Task 6.1: Replace mobile-only lifecycle partitioning

**Files:**

- Modify: `apps/mobile/src/features/inbox/inboxModel.ts`
- Modify: `apps/mobile/src/features/inbox/inboxModel.test.ts`
- Modify: `apps/mobile/src/features/home/HomeScreen.tsx`
- Modify: `apps/mobile/src/features/home/HomeScreen.test.ts`
- Modify: `apps/mobile/src/state/messageQueueStore.ts` only if a read helper is needed
- Modify: `apps/mobile/src/state/threadOutbox.ts` only if a read helper is needed

**Tests first:**

- The existing all-nodes default remains null node scope.
- `Active now`/`Recent` becomes `Active`/`Settled`.
- Identical runtime input classifies identically to the web/client-runtime tests.
- Non-empty local outbox queues keep their scoped threads active and non-settleable.
- Merged/closed PR threads settle; explicit active keeps them active.
- Search and node scope remain presentation filters.
- Archived tasks remain excluded.

**Implementation:**

1. Keep mobile-specific labels, change-request formatting, empty states, and row state visuals in
   `inboxModel.ts`.
2. Replace its lifecycle partition with the client-runtime Inbox builder.
3. Pass non-empty persisted/in-memory outbox keys from `HomeScreen`.
4. Preserve `Inbox / Projects / Nodes` and treat Projects as the Workspace analogue.
5. Keep null node scope as All.

### Task 6.2: Carry capabilities into the mobile home model

**Files:**

- Modify: `apps/mobile/src/features/home/homeEnvironmentModel.ts`
- Modify: `apps/mobile/src/features/home/homeEnvironmentModel.test.ts`
- Modify: `apps/mobile/src/features/home/useHomeEnvironments.ts`
- Modify: `apps/mobile/src/hostedHub/primaryEnvironment.ts` only if a small React subscription
  helper belongs there

**Tests first:**

- Direct environment rows expose their descriptor's settlement capability.
- Hosted rows expose the current primary descriptor's capability.
- Missing descriptors are unsupported.
- Viewer/read-only and reconnecting rows remain visible but mutation-disabled.
- Hosted descriptor replacement updates the corresponding Inbox row without duplicating it.

**Implementation:**

1. Read direct capabilities from each catalog runtime descriptor.
2. Subscribe to the hosted primary descriptor through the existing descriptor store.
3. Add capability and mutation-readiness data to `InboxEnvironment`.
4. Keep the hosted lifecycle store as the authority for role/readiness.

### Task 6.3: Add touch settlement actions and correct archive language

**Files:**

- Modify: `apps/mobile/src/features/threads/sessionActions.ts`
- Modify: `apps/mobile/src/features/threads/sessionActions.test.ts`
- Modify: `apps/mobile/src/features/threads/threadHeaderModel.ts`
- Modify: `apps/mobile/src/features/threads/threadHeaderModel.test.ts`
- Modify: `apps/mobile/src/features/threads/ThreadActionsSheet.tsx`
- Modify: `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`
- Modify: `apps/mobile/src/features/inbox/InboxScreen.tsx`
- Modify: `apps/mobile/src/features/inbox/InboxThreadRow.tsx`

**Tests first:**

- Dispatch wrappers emit the exact settle/unsettle commands.
- The actions sheet shows Settle only when supported and eligible.
- It shows Unsettle for explicitly or automatically settled work.
- A blocker or mutation-unready environment disables the action with useful detail.
- Settled rows stay navigable.
- The settled section is collapsed/bounded without rendering an unbounded native list.
- Archive copy describes structural archival, not merely hiding from Inbox.

**Implementation:**

1. Add `setThreadSettled(api, threadId, settled)` beside existing session actions.
2. Feed the header model the same client-runtime lifecycle entry used by Home.
3. Add Settle/Unsettle to the existing touch-oriented task details sheet.
4. Keep Archive separate and use copy such as:
   - “Move this task out of active workspace lists.”
   - “Restore this archived task.”
5. Use the existing `LegendList`; flatten section rows and bound the initial settled page to 20.
6. Do not add behavior to `apps/web/src/components/shell/phone`.

**Focused verification:**

```sh
bun run --cwd apps/mobile test -- \
  src/features/inbox/inboxModel.test.ts \
  src/features/home/homeEnvironmentModel.test.ts \
  src/features/home/HomeScreen.test.ts \
  src/features/threads/sessionActions.test.ts \
  src/features/threads/threadHeaderModel.test.ts
```

## Commit 7: Cross-surface hardening and final verification

Suggested commit:

```text
test(inbox): harden settlement lifecycle
```

Use this commit only for cross-cutting regressions, documentation, and narrowly necessary fixes
found by the full backstop. Do not accumulate unfinished production code here.

### Task 7.1: Add end-to-end lifecycle scenarios

**Files:**

- Modify: `apps/server/src/server.test.ts`
- Modify: `apps/web/src/components/sidebar/inbox/SidebarInbox.browser.tsx`
- Modify: `apps/web/src/hostedHub/lifecycle.integration.test.ts`
- Modify relevant native tests from Commit 6

**Scenarios:**

1. Create thread → settle → reconnect → thread remains explicitly settled.
2. Unsettle → reconnect → explicit active survives and suppresses closed-PR automation.
3. Send new user work → override resets → active across reconnect.
4. Close PR → neutral eligible thread settles automatically.
5. Start work after PR close → thread is active while blocked.
6. Clear blocker → neutral closed-PR thread settles again.
7. Reopen PR → neutral thread becomes active.
8. Pending approval/input never disappears into Settled.
9. Mixed old/new environments preserve rows and gate mutations independently.
10. Replace hosted generation mid-command → stale completion cannot publish readiness or navigate.

### Task 7.2: Accessibility and performance pass

**Checks:**

- Toggle, filters, row actions, shelf disclosure, “Show more,” and bulk actions are keyboard
  reachable.
- Icon-only controls have names and tooltips.
- Status is not communicated by color alone.
- Live announcements are bounded; list-wide reclassification does not produce one announcement
  per row.
- Reduced-motion preferences disable nonessential movement.
- Active rows do not reorder during streaming/status churn.
- The Inbox does not subscribe to every thread detail.
- The default collapsed settled shelf renders at most 20 settled rows.
- Expanding a large shelf keeps DOM/native row counts bounded by virtualization.
- Sidebar prewarming stays capped at the existing small window.

### Task 7.3: Update user-facing documentation

**Files:**

- Modify the most relevant user guide under `docs/`
- Do not modify the approved design except to add a link to this implementation plan or record a
  formally approved deviation.

**Document:**

- Inbox versus Workspace;
- Settle versus Archive;
- manual settle/unsettle;
- merged/closed PR automation;
- why running/approval/input work cannot settle;
- mixed-version update-server behavior;
- Snooze/inactivity as not yet included.

## Full repository backstop

Run from the repository root:

```sh
bun --version
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

If the pinned Chromium runtime is absent:

```sh
bun run --cwd apps/web test:browser:install
```

Then:

1. Run `git diff --check`.
2. Inspect the complete diff against the implementation-start commit.
3. Inspect `git status --short`.
4. Confirm no unrelated declarations, Android build caches, credentials, private Hub details, or
   generated artifacts are staged.
5. Confirm no direct `bun test` invocation appears in notes or automation.
6. Report pre-existing warnings separately from new failures.

`bun run build:desktop` is required only if implementation changes the desktop pipeline itself.
The ordinary full build still covers desktop consumers of the shared contracts. Release workflow
changes are out of scope; if they become necessary, also run `bun run release:smoke`.

## Expected commit sequence

```text
feat(contracts): define thread settlement lifecycle
feat(server): persist and project thread settlement
feat(client-runtime): derive thread inbox settlement
refactor(sidebar): share workspace data with inbox
feat(sidebar): add global inbox settlement view
feat(mobile): align inbox with thread settlement
test(inbox): harden settlement lifecycle
```

Each commit should pass its focused tests and typecheck its affected packages. The final commit
must pass the complete repository backstop and browser suite.

## Stop conditions

Pause and amend the design before continuing if implementation proves any of these assumptions
false:

- a shell snapshot lacks enough summary data to apply the shared blocker policy;
- thread and worktree state cannot be kept generation-consistent without a new server query;
- lifecycle events must enter the detail stream for correctness;
- client-local draft promotion cannot be made duplicate-free with existing scoped keys;
- a server-side paged Inbox is required to keep current shell sizes responsive;
- native mobile cannot consume the shared client-runtime model without adding platform imports to
  that package.

Do not silently solve those discoveries with a second policy, a stale-state shortcut, or a broad
architecture change. Record the evidence, update the approved design, and obtain approval for the
deviation.

## Definition of done

Implementation is complete only when:

1. Settlement is durable across reloads, devices, and reconnects.
2. New work, running/starting sessions, approvals, user input, and queued delivery cannot be hidden
   as settled.
3. Merged/closed PR automation uses the same scoped worktree state as the thread.
4. Explicit active suppresses PR automation until real activity returns the thread to neutral.
5. Old servers remain active-only and never receive unsupported commands.
6. The web Inbox and native Inbox classify identical state identically.
7. Workspace behavior, archive behavior, and the frozen web phone tier remain unchanged.
8. Current settled routes remain reachable and route changes are race-safe.
9. Large settled lists are bounded/virtualized and the shell-first subscription model remains
   intact.
10. All focused checks, the full repository backstop, and the browser suite pass.
