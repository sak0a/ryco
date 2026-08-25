# Inbox Hover Details and Thread Settlement Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-25-inbox-hover-settlement-design.md`

**Baseline:** `main` at `e7004012c`

**Goal:** Add a durable, reversible settlement lifecycle shared by web, desktop, and mobile, then
complete the desktop/web Inbox row with the right-side detail card approved in the design.

## Execution rules

- Use Bun `1.4.0`, pinned by `package.json`, and install with
  `bun install --frozen-lockfile` when dependencies are not already current.
- Never run `bun test`; use package scripts that invoke Vitest.
- Add or port focused regressions before each production behavior.
- Keep `packages/contracts` schema-only and keep DOM/React Native imports out of
  `packages/client-runtime`.
- Reuse current Inbox, environment, readiness, degraded-reason, provider, and routing vocabulary.
- Preserve hosted lifecycle ownership and scoped environment identity.
- Do not extend the frozen web-phone presentation.
- Do not merge or rebase obsolete PR #268 wholesale. Port only behavior that still fits current
  contracts and component boundaries.
- Keep the unrelated root-worktree edit to `apps/mobile/uniwind-types.d.ts` untouched.

## Dependency order

```text
contracts + shared policy
            │
            ▼
server events + SQL projection
            │
            ▼
client-runtime Inbox lifecycle
       │                    │
       ▼                    ▼
web/desktop Inbox      native mobile Inbox
       │                    │
       └─────────┬──────────┘
                 ▼
       cross-surface validation
```

## Phase 1: Contracts and shared settlement policy

Suggested commit: `feat(contracts): define thread settlement lifecycle`

### Contract changes

Modify:

- `packages/contracts/src/environment.ts`
- `packages/contracts/src/environment.test.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/orchestration.test.ts`

Add backward-compatible defaults for:

- `ExecutionEnvironmentCapabilities.threadSettlement`, default `false`;
- thread and shell fields `settledOverride` and `settledAt`;
- client commands `thread.settle` and `thread.unsettle(reason: "user")`;
- server events `thread.settled` and `thread.unsettled(reason: "user" | "activity")`.

Tests must prove old descriptors/snapshots decode, valid states round-trip, and clients cannot send
the server-only activity reason.

### Shared pure policy

Create:

- `packages/shared/src/threadSettlement.ts`
- `packages/shared/src/threadSettlement.test.ts`

Modify the explicit exports in `packages/shared/package.json`. Extend the existing shared thread
activity helper only if the server currently duplicates pending approval/input derivation.

Port the normalized, structural policy from PR #268 and adapt it to current contracts. It provides:

- eligibility and blocker precedence;
- bounded queued-turn detection;
- Active/Settled/Excluded classification;
- effective settlement timestamps;
- deterministic Active and Settled sorting.

Focused checks:

```sh
bun run --cwd packages/contracts test -- src/environment.test.ts src/orchestration.test.ts
bun run --cwd packages/shared test -- src/threadSettlement.test.ts
```

## Phase 2: Authoritative server lifecycle and persistence

Suggested commit: `feat(server): persist and project thread settlement`

### Migration and repository

Add the next available migration after current migration 51 rather than reusing PR #268's obsolete
number:

- `apps/server/src/persistence/Migrations/052_ProjectionThreadsSettled.ts`
- `apps/server/src/persistence/Migrations/052_ProjectionThreadsSettled.test.ts`

Modify:

- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/persistence/Services/ProjectionThreads.ts`
- `apps/server/src/persistence/Layers/ProjectionThreads.ts`
- focused repository tests.

The migration independently checks and adds nullable `settled_override` and `settled_at` columns so
partial repair and repeated startup are safe.

### Decider and projector

Modify:

- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/commandInvariants.ts` when current boundaries require it;
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- shell-stream tests and server environment capabilities.

Port the PR #268 decider/projector tests, then adapt them to current goal, handoff, and agent-control
events. The server must:

- reject every design-specified blocker;
- preserve idempotent settlement timestamps;
- map user unsettlement to the explicit Active override;
- clear either override on real work before projecting that work;
- project lifecycle fields through SQL, full snapshots, shell snapshots, and shell upserts;
- keep settlement events out of the thread-detail stream;
- advertise `threadSettlement: true`.

Focused checks run the new migration, persistence, decider, projector, pipeline, snapshot, stream,
and environment tests through `bun run --cwd apps/server test -- ...`.

## Phase 3: Shared client-runtime Inbox lifecycle

Suggested commit: `feat(client-runtime): derive thread inbox settlement`

Modify:

- `packages/client-runtime/src/state/threads/types.ts`
- `packages/client-runtime/src/state/threads/store.ts`
- `packages/client-runtime/src/state/threads/store.test.ts`
- the current cross-environment selectors that feed web and mobile.

Create:

- `packages/client-runtime/src/state/threads/threadInbox.ts`
- `packages/client-runtime/src/state/threads/threadInbox.test.ts`

The pure builder consumes scoped projects, worktrees, shell threads, capability/readiness, local
queue/delivery state, and current route. It returns Active and Settled entries carrying scoped
mutation eligibility and presentation context. Missing capability remains Active and read-only.

Port PR #268's optimistic reconciliation only where current shell projection latency needs it. Key
pending state by `(environmentId, threadId)` and acknowledge the latest mutation by durable command
sequence so Settle followed immediately by Move to Active cannot converge on stale state.

Focused checks:

```sh
bun run --cwd packages/client-runtime test -- \
  src/state/threads/store.test.ts \
  src/state/threads/threadInbox.test.ts
```

## Phase 4: Desktop/web Inbox actions and right-side details

Suggested commit: `feat(web): add inbox settlement and hover details`

Modify the current implementation rather than restoring PR #268's obsolete sidebar tree:

- `apps/web/src/components/inboxSidebar/InboxSidebar.tsx`
- `apps/web/src/components/inboxSidebar/inboxSidebarModel.ts`
- `apps/web/src/components/inboxSidebar/inboxSidebarModel.test.ts`
- `apps/web/src/components/Sidebar.tsx` only when wiring requires it.

Create small focused modules as needed:

- settlement action hook resolving the row's `EnvironmentApi` at invocation time;
- hover-card content component;
- sidebar-edge virtual anchor helper;
- browser coverage for row actions and placement.

Implementation steps:

1. Feed current Inbox rows from the shared lifecycle builder without changing existing unified
   environment/project behavior.
2. Keep the Active section first and add a collapsed, bounded Settled section below it.
3. Swap the row's fixed time/status slot to Settle on hover/focus without moving metadata.
4. Settled rows swap settlement time to Move to Active and remain navigable.
5. Preserve the current detail route when its thread changes sections.
6. Anchor a semantic hover card to the right edge of the sidebar and align it to the row. Reuse
   project artwork, This Device/environment labeling, provider icon/model labels, PR state, and
   current degraded/blocker copy.
7. Expose actions by keyboard and context menu; disabled rows explain the authoritative blocker.
8. Gate dispatch by row capability, shared eligibility, owning environment readiness/role, and a
   scoped pending-command set.

Browser checks cover right-side placement, collision handling, pointer transfer without flicker,
focus access, stable row geometry, reduced motion, light/dark surfaces, and Settle/Move-to-Active.

Focused checks:

```sh
bun run --cwd apps/web test -- \
  src/components/inboxSidebar/inboxSidebarModel.test.ts
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

## Phase 5: Native mobile parity

Suggested commit: `feat(mobile): add thread settlement actions`

Modify:

- `apps/mobile/src/features/inbox/inboxModel.ts`
- `apps/mobile/src/features/inbox/inboxModel.test.ts`
- `apps/mobile/src/features/inbox/InboxScreen.tsx`
- `apps/mobile/src/features/inbox/InboxThreadRow.tsx`
- the existing thread action sheet/header/session action modules;
- the home environment model only where capability/readiness input is missing.

Keep classification, grouping, labels, eligibility, and command selection in pure model modules.
The native Inbox uses the same Active/Settled partition and exposes Settle/Move to Active through
its existing touch action surface. It does not implement hover and does not add native imports to
shared runtime modules.

Focused checks use the required script:

```sh
bun run --cwd apps/mobile test -- \
  src/features/inbox/inboxModel.test.ts \
  src/features/threads/sessionActions.test.ts \
  src/features/threads/threadHeaderModel.test.ts
```

Run only files that exist after adapting current mobile boundaries; never invoke `bun test`.

## Phase 6: Cross-surface hardening and evidence

Suggested commit: `test(inbox): harden settlement lifecycle`

Add focused regressions for:

1. settle, reconnect, and durable restoration;
2. Move to Active suppressing closed-PR automation;
3. new work clearing overrides and returning the row to Active;
4. closed/merged PR automatic settlement and reopened PR reactivation;
5. approval, input, running, queued, and delivery-unknown blockers;
6. old/new environments gating independently;
7. two environments with the same raw thread ID mutating only the scoped owner;
8. stale connection generations failing to publish mutation authority or acknowledgement;
9. rapid Settle then Move to Active convergence;
10. web, desktop, and mobile receiving identical classification from identical input.

Live QA:

- web and desktop: hover card, Settle, Move to Active, route preservation, reconnect;
- iOS simulator: Active/Settled grouping and both actions;
- two concurrently connected clients: state propagation in both directions;
- unsupported/offline environment: visible last-known row with no mutation;
- no console errors, routing regression, or connection churn.

Because the change crosses contracts, persistence, shared runtime, web, desktop, and mobile, run the
full repository backstop after focused checks:

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Install the pinned browser runtime first only if missing. Run `bun run build:desktop` if desktop
pipeline code changes; shared web UI alone is covered by the web build and normal repository build.

## Stop conditions

Stop and amend the approved design instead of guessing if:

- the current shell snapshot lacks enough data for shared eligibility;
- thread/worktree generations cannot be kept consistent without a new authoritative query;
- settlement requires terminating a provider session;
- current native action surfaces cannot represent the lifecycle without forking policy;
- preserving the current route conflicts with authoritative Inbox reconciliation.

## Definition of done

- Settlement persists across reloads, reconnects, and clients.
- Active work and unresolved user actions cannot disappear into Settled.
- Merged/closed PR automation and Keep active follow the approved model.
- Old environments stay Active-only and never receive unsupported commands.
- Web, desktop, and mobile share one classification and scoped mutation path.
- The desktop/web card opens to the right with the approved details and accessible fallback.
- Settling the open thread preserves its detail route.
- Focused checks, the proportional full backstop, browser suite, and live QA pass.
