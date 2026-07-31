# Sidebar Inbox and Settlement Lifecycle Design

**Status:** Approved

**Date:** 2026-07-31

**Scope:** Desktop/web sidebar, existing native Inbox, shared contracts/runtime, and server orchestration

**Deferred:** Snooze and inactivity settlement

## Summary

Ryco should add an **Inbox** view beside its existing **Workspace** sidebar view.

- **Inbox** answers: “What needs my attention across Ryco?”
- **Workspace** answers: “Where does this work live?”

The two views are projections over the same server-backed projects, worktrees, sessions, and
source-control state. Inbox does not replace Ryco's structural project/worktree model. Workspace
continues to own project organization, worktree creation and management, source-control context,
manual ordering, and archive management.

Phase one introduces a first-class thread settlement lifecycle:

- Users can manually settle and unsettle a thread.
- Threads attached to a worktree whose PR becomes merged or closed settle automatically.
- Running/starting work, queued turn starts, pending approvals, and pending user input cannot
  classify as settled.
- Real activity wakes an explicitly settled thread.
- Settlement is reversible and does not archive, stop, delete, or otherwise mutate the underlying
  provider session or worktree.
- Snooze and inactivity-based auto-settlement are intentionally deferred.

The Inbox's default scope is global: all environments and projects currently represented in the
client runtime. Filters may narrow that scope without changing the default.

Ryco's native mobile app already has an `Inbox / Projects / Nodes` home-mode control. The new
shared settlement policy should align that existing Inbox rather than introducing a second mobile
implementation later.

## Research baseline

### T3Code's Sidebar v2

The reference implementation landed primarily in
[pingdotgg/t3code#4026](https://github.com/pingdotgg/t3code/pull/4026) and shipped through the
[`v0.0.29`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.29)–[`v0.0.31`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.31)
releases in July 2026. At the time of this design, the latest observed nightly was
[`v0.0.32-nightly.20260731.961`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.32-nightly.20260731.961).

The useful ideas are:

1. A flat attention list replaces activity-driven project grouping in the Inbox view.
2. Active threads use rich status rows; settled threads move into a slim, collapsible tail.
3. Settlement is server-backed and distinct from archive.
4. A tri-state override distinguishes:
   - explicit settlement,
   - explicit keep-active,
   - no override, allowing automatic policy.
5. The UI and server enforce the same settlement blockers.
6. New activity resets lifecycle overrides so stale user intent does not hide current work.
7. Active rows keep a stable creation-time order. Background activity changes row status but does
   not make the list jump.
8. Capability negotiation prevents new clients from sending settlement commands to older servers.
9. Directly opened settled threads remain reachable even when the settled shelf is collapsed.

Follow-up work added working duration/status refinements in
[#4274](https://github.com/pingdotgg/t3code/pull/4274), Snooze in
[#4311](https://github.com/pingdotgg/t3code/pull/4311), and staged default enablement in
[#4491](https://github.com/pingdotgg/t3code/pull/4491).

Ryco should reuse the lifecycle and reliability lessons, not copy T3Code's information
architecture wholesale.

### Ryco today

Ryco's sidebar already contains a richer structural model:

- Environments are combined in one client runtime.
- Physical projects may be grouped into logical cross-environment projects using repository
  identity.
- Local one-level folders can organize logical projects.
- Git projects render worktrees/directories with PR, issue, and Jira context.
- Worktrees aggregate session status.
- Sessions support local pinning, creation/update sorting, archive, delete, and multi-selection.
- The shell stream already carries the summary fields needed for attention classification:
  latest turn, latest user message, session status, approvals, input requests, and actionable
  plans.
- Worktree shells already carry PR state and update timestamps.
- `apps/mobile` already has a global Inbox across nodes/projects, with node scope and search.
  It currently partitions rows into activity-derived `Active now` and `Recent` sections and uses
  archive as “Hide this task from the Inbox.”
- Mobile's `Inbox / Projects / Nodes` control is already the phone equivalent of the selected
  Inbox / Workspace model; its policy needs alignment, not replacement.

The main implementation surfaces are:

- `apps/web/src/components/AppSidebarLayout.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/sidebar/SidebarProjectItem.tsx`
- `apps/web/src/components/sidebar/SidebarWorktreeList.tsx`
- `apps/web/src/components/sidebar/SidebarThreadRow.tsx`
- `apps/web/src/components/sidebar/hooks/useSidebarTree.ts`
- `apps/web/src/components/sidebar/hooks/useSidebarProjectThreadPresentation.ts`
- `apps/mobile/src/features/inbox/inboxModel.ts`
- `apps/mobile/src/features/inbox/InboxScreen.tsx`
- `apps/mobile/src/features/inbox/InboxThreadRow.tsx`
- `apps/mobile/src/features/home/HomeScreen.tsx`
- `apps/mobile/src/features/threads/ThreadActionsSheet.tsx`
- `packages/client-runtime/src/state/threads/`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/environment.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/persistence/`

Today, a thread has only archive/delete lifecycle state. `manualStatusBucket` and derived
worktree status describe execution/workflow state, not whether the user considers the thread
handled.

## Product decisions

| Decision              | Approved behavior                       |
| --------------------- | --------------------------------------- |
| Sidebar model         | Inbox / Workspace toggle                |
| Default Inbox scope   | All available environments and projects |
| Existing hierarchy    | Preserved in Workspace                  |
| Manual settlement     | Included                                |
| Automatic settlement  | PR merged or closed                     |
| Inactivity settlement | Deferred                                |
| Snooze                | Deferred to phase two                   |
| Archive               | Remains separate                        |
| Worktree settlement   | Not introduced                          |
| Web phone surface     | Not extended                            |
| Native mobile         | Align the existing Inbox in phase one   |

## Mental model

Ryco will have two orthogonal state dimensions.

### Execution/workflow state

This is the existing status-bucket model:

- `idle`
- `in_progress`
- `review`
- `done`

It answers what the agent/session/worktree is doing. It can be manually overridden and aggregated
from sessions to a worktree.

### Attention state

This is the new settlement model:

- active
- settled

It answers whether the thread should occupy the user's attention queue.

Snooze will eventually be an overlay on active state, not a third settlement destination.

### Archive state

Archive remains a structural visibility lifecycle:

- an archived thread is absent from normal Inbox and Workspace lists;
- an archived worktree and its attached threads are absent from the normal Inbox;
- archive management remains available through existing archived views/settings.

Settlement never archives a thread or worktree. Archiving does not need to erase settlement
metadata; unarchiving may restore a thread to its previous effective attention state.

## Data model

### Contract fields

Add the following to both `OrchestrationThread` and `OrchestrationThreadShell`:

```ts
settledOverride: "settled" | "active" | null;
settledAt: IsoDateTime | null;
```

Both fields must decode with `null` defaults for snapshots produced before the migration.

The meanings are:

- `"settled"`: explicit user settlement.
- `"active"`: explicit user keep-active override. This is how a user unsets a thread that would
  otherwise auto-settle because its PR is merged or closed.
- `null`: no user override; automatic policy may apply.

`settledAt` is non-null only when `settledOverride === "settled"`. It is the original accepted
manual settlement time and is preserved across duplicate settle commands.

Do not encode automatic PR settlement into `settledOverride`. It is a derived state from
server-projected worktree source-control state.

### Capability

Extend `ExecutionEnvironmentCapabilities` with:

```ts
threadSettlement?: boolean
```

New servers advertise `true`. Missing or false means:

- the client must not send settle/unsettle commands;
- the row remains active unless excluded by archive;
- settlement actions are hidden or disabled with an update-server explanation.

Mixed-version global Inbox views are supported per row/per environment. A single older server must
not disable settlement for other environments.

### Persistence

Add migration `042_ProjectionThreadsSettled.ts`:

```sql
ALTER TABLE projection_threads ADD COLUMN settled_override TEXT;
ALTER TABLE projection_threads ADD COLUMN settled_at TEXT;
```

The migration must inspect `PRAGMA table_info(projection_threads)` before adding each column so it
is idempotent and repair-friendly, following current migration conventions.

Update:

- the migration registry;
- `ProjectionThread` persistence schema;
- projection-thread insert/upsert/select queries;
- snapshot query row schemas and mapping;
- projection pipeline writes;
- migration, repository, and snapshot tests.

An index on `settled_at` is not initially required because phase one still loads the existing shell
snapshot and partitions client-side. Add an index only with a future server-paged Inbox query.

## Commands and events

Add client-dispatchable commands:

```ts
{
  type: "thread.settle";
  commandId;
  threadId;
}
{
  type: "thread.unsettle";
  commandId;
  threadId;
  reason: "user";
}
```

Add events:

```ts
{
  type: "thread.settled";
  payload: {
    threadId;
    settledAt;
    updatedAt;
  }
}

{
  type: "thread.unsettled";
  payload: {
    threadId;
    reason: "user" | "activity";
    updatedAt;
  }
}
```

Clients may only send `thread.unsettle` with `reason: "user"`. Activity resets are decided by the
server and cannot be forged by a client.

### Idempotency

The orchestration engine currently expects accepted commands to produce events. Therefore:

- settling an explicitly settled thread re-emits `thread.settled` with the original `settledAt`
  and unchanged `updatedAt`;
- unsetting an explicitly active thread re-emits `thread.unsettled` with unchanged `updatedAt`.

This makes duplicate clicks and bulk retries projected no-ops without turning them into user-facing
errors or changing sort order.

### Projection behavior

- `thread.settled` projects `settledOverride = "settled"` and the payload's `settledAt`.
- `thread.unsettled` with reason `"user"` projects `settledOverride = "active"` and clears
  `settledAt`.
- `thread.unsettled` with reason `"activity"` projects `settledOverride = null` and clears
  `settledAt`.
- thread creation projects both fields as null.

Settlement events do not need to enter the per-thread detail event stream. The shell upsert and
thread snapshot carry the lifecycle fields, while the existing detail stream remains limited to
message/activity/session content events. This also reduces exposure of unknown event variants to
older clients.

## Settlement classification

Place the pure classifier and queued-turn detection in a new explicit shared export:

```text
@ryco/shared/threadSettlement
```

Both server invariants and `packages/client-runtime` consume this shared logic. UI partitioning
remains in the client runtime.

This avoids maintaining subtly different blocker lists in server and client code.

### `canSettle`

A thread can be manually settled only when all conditions hold:

1. The thread is not archived/deleted.
2. Its parent worktree, if any, is not archived.
3. There is no pending approval.
4. There is no pending user-input request.
5. The session is not `starting` or `running`.
6. There is no queued turn start.

A queued turn start is a recent user message that has not yet been adopted by a latest turn. Use a
bounded two-minute grace window and tolerate clock skew in both directions. A failed session start
clears the queued condition because the failure is already visible.

The client uses `canSettle` to disable/reject before a round trip. The server uses the same rules as
the authoritative race guard.

The client-runtime wrapper must additionally treat a client-local queued/outbox message or
delivery-unknown state for the scoped thread as a blocker. The server cannot enforce work it has
not received yet; after receipt, the shell-based queued-turn guard and activity reset become
authoritative.

### `effectiveSettled`

Partition a normal visible thread in this order:

1. If settlement is unsupported for its environment, return active.
2. If any `canSettle` activity blocker is present, return active.
3. If `settledOverride === "settled"`, return settled.
4. If `settledOverride === "active"`, return active.
5. If the attached worktree's `prState` is `"merged"` or `"closed"`, return settled.
6. Otherwise return active.

PR automation applies to every normal, non-archived thread attached to the PR worktree. Threads
without a projected worktree or PR state are manual-only.

Issue and Jira completion do not trigger settlement in phase one.

### Automatic settlement time

Automatic PR settlement is derived, so it has no persisted `settledAt`. For settled-tail ordering,
derive an effective timestamp:

1. explicit `settledAt`, else
2. the latest valid timestamp among worktree `updatedAt`, latest-turn completion, latest user
   message, thread `updatedAt`, and thread `createdAt`.

This means a thread blocked by running work after a PR closes enters the settled tail at the point
the blocker last changed, rather than pretending it settled before the work finished.

Malformed timestamps must keep a thread active or fall back to a valid older timestamp; they must
never cause surprising settlement.

## Lifecycle transitions

| Trigger                               | Result                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| User settles eligible active thread   | override becomes `"settled"`                                 |
| User unsets explicitly settled thread | override becomes `"active"`                                  |
| User unsets auto-settled PR thread    | override becomes `"active"`                                  |
| User sends a new message              | any override resets to null before turn start                |
| Session becomes starting/running      | any remaining override resets to null                        |
| Approval/input request arrives        | any remaining override resets to null                        |
| PR becomes merged/closed              | neutral eligible threads classify settled                    |
| PR reopens                            | neutral auto-settled threads classify active                 |
| Blocker appears                       | thread classifies active regardless of override              |
| Blocker clears on merged/closed PR    | neutral thread may auto-settle again                         |
| User archives thread                  | thread leaves both normal views; settlement metadata remains |
| User deletes thread                   | lifecycle data is deleted with the thread                    |

Activity resets both explicit settled and explicit active overrides. This is important: a manual
keep-active choice suppresses PR automation for the current quiet period, but new real work returns
the thread to neutral policy rather than creating a permanent pin.

Existing local thread pinning remains an ordering preference. It is not the same as
`settledOverride: "active"` and should not be renamed or reused for settlement.

## Client-runtime design

Extend the shell/detail thread types and reducers with the lifecycle fields.

Add pure selectors/helpers under `packages/client-runtime/src/state/threads/` for:

- effective settlement;
- effective settlement timestamp;
- active/settled partitioning;
- stable Inbox sorting;
- capability lookup per environment;
- worktree lookup by scoped worktree ID.

The shared client runtime must remain free of DOM and React Native imports so native mobile can
reuse the same classification later.

The global partition consumes shell summaries only. It must not subscribe to every thread's detail
stream. Client-local draft summaries are a lightweight overlay on that partition rather than a
reason to load server thread details.

### Drafts and non-user threads

Unsent client-local drafts remain visible as active Inbox rows:

- they are never classified settled;
- they have no settle action;
- they use the same environment/project/directory context as in Workspace;
- promotion to a server thread replaces the draft row without producing a duplicate.

This prevents creating a draft from Inbox and then losing its navigation row before the first
message is sent.

Inbox must reuse the sidebar's normal user-thread eligibility filter. Hidden/runtime-only subagent
threads must not become top-level Inbox rows merely because they exist in a shell snapshot. Their
activity may still contribute to the parent thread's existing status model where supported.

### Sorting

Active Inbox ordering:

1. locally pinned threads first;
2. creation time descending;
3. scoped thread key as deterministic tie-breaker.

Activity never reorders active rows.

Settled ordering:

1. effective settlement timestamp descending;
2. creation time descending;
3. scoped thread key.

The currently routed thread remains renderable even if it is in a collapsed settled shelf.

## Web sidebar design

### Composition

Refactor `ThreadSidebar` into a stable frame with:

- shared header and creation/settings actions;
- `SidebarViewToggle`;
- `SidebarInbox`;
- the existing Workspace project tree.

Do not fork the whole existing `Sidebar.tsx`. Extract the cross-environment project/thread/worktree
selection and logical-project lookup into a shared sidebar-data hook or view model used by both
projections.

Workspace should continue to compose the current:

- `SidebarProjectList`;
- `SidebarProjectItem`;
- `SidebarWorktreeList`;
- `SidebarProjectThreadList`;
- current drag/drop, folder, worktree, and archive behaviors.

### Toggle persistence

Add local client setting:

```ts
sidebarViewMode: "workspace" | "inbox";
```

Default it to `"workspace"` for existing compatibility. The segmented toggle is visible in the
desktop/tablet sidebar and remembers the last choice on that client.

The Inbox's filter scope defaults to all. A filter change is local presentation state and must not
change project grouping or server lifecycle.

### Inbox row content

Each active row should show, within available width:

- status indicator and thread title;
- compact logical project name;
- worktree title/branch or directory context;
- environment indicator when relevant;
- provider/instance indicator when helpful;
- PR/issue/Jira chip when present;
- pending approval/input, working duration, failure, plan-ready, or completed-unseen state;
- hover settle action when eligible.

Rows in `starting`/`running` state may visually fade because the work is currently with the agent,
but their status and duration remain legible.

The settled shelf uses slim rows and a bounded initial page. “Show more” operates only on that
shelf. Large expanded lists use the existing virtualization strategy rather than rendering all
rows.

### Actions

Provide settlement through:

- hover check action on eligible active rows;
- context-menu Settle/Unsettle;
- keyboard-accessible row actions;
- multi-selection actions limited to the exact rendered selection.

Bulk settlement skips unsupported/ineligible rows and reports a bounded result summary rather than
failing the whole batch at the first blocker.

Changing sidebar mode or changing the Inbox scope clears sidebar multi-selection. Hidden selections
must never remain actionable after the visible projection changes.

Archive and delete remain separate context-menu actions with their existing confirmation and
running-state safeguards.

### Navigation after settlement

If the user settles the currently routed thread from Inbox:

1. compute the next visible active row using the current stable order;
2. dispatch the command;
3. after success, navigate only if the route is still the same thread;
4. prefer the next row, then the previous row;
5. if no active row remains, keep the settled thread open and expose it through the settled shelf.

Do not navigate after settling from Workspace because settlement does not remove the row from the
structural tree.

This route check prevents a slow command response from pulling the user away after they manually
navigate elsewhere.

### Global scope and filtering

“All” includes every environment with a loaded/retained shell snapshot. A disconnected environment
may remain visible with a connection badge, but mutations are disabled until that environment's
normal mutation capability is restored.

Filters may narrow by:

- environment;
- logical project;
- worktree/directory;
- text search.

Filtering never changes settlement state. Clearing filters returns to the global queue.

## Hosted Hub and reconnect behavior

Settlement must obey the existing hosted lifecycle boundary:

- The server projection is authoritative.
- A hosted browser does not enable settle/unsettle until its current generation has an authorized
  directory, a current shell snapshot, and mutation capability.
- Stale relay/shell generations cannot publish settlement readiness or mutate lifecycle state.
- Optimistic row feedback may be shown, but authoritative classification must reconcile from the
  accepted command and current shell.
- The service worker must not cache settlement RPC, shell state, commands, or authenticated data.

Automatic PR classification must use thread and worktree data from the same accepted shell
generation. Do not combine a current thread shell with stale source-control state from an older
generation.

## Native mobile alignment

Do not extend the frozen web `phone:` presentation tier.

`apps/mobile` already owns the intended phone Inbox and must consume the same settlement policy as
web:

- retain the existing `Inbox / Projects / Nodes` home-mode control;
- treat Projects as the structural Workspace analogue;
- keep null node scope as the all-nodes default;
- replace the local activity-vs-recent partition policy with shared active/settled
  classification;
- render pending/working/error states within active rows without using activity to define the
  lifecycle destination;
- keep mobile's delivery-unknown state active and non-settleable until the outbox resolves;
- expose Settle/Unsettle through touch-appropriate thread actions;
- keep Archive as a separate destructive lifecycle and remove copy that defines it merely as
  “Hide this task from the Inbox”;
- capability-gate lifecycle actions per environment exactly like web.

Move lifecycle classification and section inputs out of mobile-only `inboxModel.ts` into
`packages/client-runtime`; keep React Native row formatting, navigation, empty states, and
touch-specific presentation inside `apps/mobile`.

The settled section may start collapsed or bounded on mobile, but a directly opened settled task
must remain reachable. This is an adaptation of presentation, not a fork of lifecycle policy.

## Performance

The Inbox should preserve the sidebar's shell-first performance model:

- derive from `SidebarThreadSummary` and `SidebarWorktreeSummary`;
- overlay client-local drafts without detail subscriptions;
- memoize partitioning by relevant shell maps/capabilities;
- avoid detail subscriptions for classification;
- prewarm only the same small visible/likely-to-open set used today;
- render a bounded settled page by default;
- virtualize large expanded lists;
- disable expensive entry/exit animation above existing density thresholds.

No phase-one server pagination API is required. If shell size later becomes a bottleneck, introduce
a server-paged settled query with an index as a separate design.

## Rollout

1. Ship schema, migration, projection, capability, and shared classifier support.
2. Ship the Inbox/Workspace toggle with Workspace as the migration-safe initial mode.
3. Align the existing native Inbox with the shared active/settled partition and lifecycle actions.
4. Include manual settlement and PR merged/closed automation in the same user-visible release.
5. Observe reconnect, mixed-version, and large-shell behavior before considering Inbox as a new
   desktop default.
6. Consider Snooze and inactivity settlement only after phase-one lifecycle reliability is proven.

An older environment remains usable in the global Inbox as active-only. The client must not hide
its threads merely because it lacks settlement support.

## Verification strategy

### Contracts

- Old snapshots decode settlement fields as null.
- New commands/events round-trip through Effect Schema.
- Clients cannot encode activity-reason unsettle commands.
- Missing `threadSettlement` capability decodes as unsupported.

### Shared classifier

Use table-driven and property-oriented tests for:

- override × PR state × blocker precedence;
- explicit active suppressing PR automation;
- PR reopen returning neutral threads to active;
- queued-turn grace window and clock skew;
- client-local queued/outbox and delivery-unknown blockers;
- failed session start clearing queued state;
- malformed timestamps never hiding work;
- archived thread/worktree exclusion;
- stable deterministic sorting.

### Server

- settle/unsettle command invariants;
- duplicate command idempotency;
- running/starting, approval, input, and queued-turn races;
- message send, session start, and blocking request activity resets;
- projection and read-model updates;
- migration idempotency;
- repository and snapshot persistence;
- capability advertisement.

### Client runtime

- shell and detail mapping of lifecycle fields;
- cross-environment capability lookup;
- partitioning with mixed old/new environments;
- source-control worktree join;
- draft overlay/promotion without duplicates;
- hidden/subagent thread exclusion;
- shell-generation replacement/reconnect behavior.

### Web

- toggle persistence;
- global default scope;
- stable active ordering during status changes;
- settle/unsettle hover, context, keyboard, and bulk actions;
- selection clearing when mode/scope changes;
- unsent draft visibility and promotion;
- navigation race protection;
- current settled route reachability;
- disconnected/unauthorized mutation gating;
- bounded settled expansion and virtualization;
- Workspace behavior remains unchanged.

### Native mobile

- existing Inbox/Projects/Nodes navigation remains stable;
- all-nodes scope remains the default;
- Active now/Recent migrates to the shared active/settled partition;
- delivery-unknown work remains active and non-settleable;
- settle/unsettle capability and mutation gating;
- archive copy/actions remain semantically separate;
- settled-row reachability and bounded rendering;
- shared classifier parity with web for identical shell inputs.

### Required repository backstop

Any implementation must run:

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

Install the pinned Playwright runtime first when necessary:

```sh
bun run --cwd apps/web test:browser:install
```

Desktop pipeline changes additionally require `bun run build:desktop`.

## Implementation slices

These are architectural slices, not authorization to implement.

1. **Contracts and shared policy**
   - settlement fields, capability, commands/events;
   - shared classifier and truth-table tests.
2. **Server lifecycle**
   - migration/repository/query changes;
   - decider/projector/pipeline;
   - activity resets and capability advertisement.
3. **Client-runtime projection**
   - store mapping, selectors, partitioning, sorting;
   - mixed-environment support.
4. **Web composition**
   - shared sidebar data model;
   - toggle and Inbox rows/shelves/actions;
   - navigation and bulk behavior.
5. **Native Inbox alignment**
   - replace mobile-only partition policy with shared selectors;
   - add touch settlement actions and settled presentation;
   - preserve Inbox/Projects/Nodes navigation and node scoping.
6. **PR automation and hardening**
   - worktree PR-state join;
   - reconnect/version-skew/browser coverage;
   - performance and accessibility pass.

## Non-goals

- Snooze or timed wakeups.
- Inactivity-based settlement.
- Auto-archiving threads or worktrees.
- Settling a whole worktree as a new lifecycle.
- Replacing status buckets.
- Reorganizing Workspace's project/worktree tree.
- Adding status-bucket headers to the current worktree list.
- Extending the web phone UI.
- Redesigning native mobile's existing home navigation.
- Adding server-paged Inbox APIs.

## Success criteria

The design is successful when:

1. A user can switch between a global attention queue and the existing structural tree without
   losing context or state.
2. Manual settlement is durable across reloads, devices, and reconnects.
3. Merged/closed PR work leaves the active Inbox unless blocked or explicitly kept active.
4. Approvals, user input, live work, and newly queued turns are never hidden as settled.
5. New activity wakes explicitly settled work and resets stale overrides.
6. Archive, pinning, worktree status, and settlement remain distinct and predictable.
7. Mixed-version and hosted reconnect behavior fail visible and safe rather than hiding work.
8. Workspace's current behavior and performance do not regress.
9. Native and web classify the same shell/worktree state into the same attention lifecycle.
