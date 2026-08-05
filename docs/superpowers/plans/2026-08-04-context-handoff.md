# Context handoff implementation plan

**Goal:** Add repeatable, idle-only provider/model handoffs inside one visible Ryco thread, using a
fresh target provider runtime, a deterministic portable context artifact, session-epoch fencing, and
a persisted screenshot-style timeline breaker.

**Design spec:**
`docs/superpowers/specs/2026-08-04-context-handoff-design.md`

**Lead-agent prompt:**
`docs/prompts/features/31-context-handoff.md`

## Execution rules

- Read the design spec, this plan, repository `AGENTS.md`, and the referenced existing files before
  editing.
- Preserve the approved semantics: one visible thread, idle only, selection staged until send,
  repeatable handoffs, fresh target runtime, full deterministic context, and no provider-native
  resume/delta optimization in V1.
- Do not introduce a separate user-facing “switch now” command. The existing `thread.turn.start`
  carrying the first target message is the handoff trigger.
- Do not put the context body in orchestration events, activities, shell snapshots, RPC responses,
  logs, or analytics.
- Do not depend on the outgoing provider for compaction or summary generation.
- Do not claim crash-safe exactly-once provider delivery. Use durable compare-and-set plus
  at-most-once recovery for ambiguous `dispatching` operations.
- Keep normal turns unchanged when provider instance and model slug do not change. Options-only
  changes are not handoffs.
- Keep the frozen `apps/web` phone tier constrained to its existing provider. Do not add mobile
  implementation in this change.
- Add tests with each slice. Never run `bun test`; always use `bun run test`.
- Use `apply_patch` for manual edits, preserve unrelated work, inspect the full diff, and run
  `git diff --check` before handoff.

## Parallel execution map

There are four useful work slots: one coordinator plus three subagents. Parallelize only after the
contract and migration foundation is merged into the shared worktree.

### Wave 0 — coordinator only

The coordinator owns Task 0 and Task 1. Freeze names and schemas first so subagents do not invent
incompatible event/activity/runtime shapes.

### Wave 1 — three independent subagents

- **Subagent A — provider epoch and replacement lifecycle:** Tasks 3–5. It owns provider contracts
  after Task 1, adapter propagation, ProviderService routing, bounded cleanup, and stale reaping.
- **Subagent B — context artifact:** Task 6. It owns the repository, builder, renderer, budgeting,
  digest, and focused tests. It must not edit `ProviderCommandReactor.ts`.
- **Subagent C — client runtime and visual marker:** Tasks 10 and 12. It owns activity parsing,
  milestone retention, timeline ordering, and the marker component. It must not edit
  `ChatView.tsx` during Wave 1.
- **Coordinator:** Tasks 2, 7–9, then integration. The coordinator owns `orchestration.ts`,
  `decider.ts`, `ProviderCommandReactor.ts`, startup wiring, and the final cross-layer tests.

### Wave 2 — conflict-controlled web integration

After Subagent C lands the client-runtime/marker primitives, assign exactly one agent ownership of
`ChatView.tsx`, `ChatComposer.tsx`, and the picker/send integration in Task 11. Do not let two agents
edit `ChatView.tsx` concurrently.

### Wave 3 — coordinator integration and validation

The coordinator completes Tasks 13–15, resolves cross-slice issues, runs the full backstop, and
reviews the feature against every acceptance criterion.

## Task 0: Preflight and baseline

**Owner:** coordinator.

**Files:** read-only inspection across the repository.

- [ ] Confirm the worktree is clean or record every pre-existing change.
- [ ] Confirm the Bun version pinned in `package.json` and run `bun install --frozen-lockfile`.
- [ ] Run focused existing tests before edits:
  - [ ] contracts orchestration/provider/runtime tests;
  - [ ] `ProviderService.test.ts`;
  - [ ] `ProviderCommandReactor.test.ts`;
  - [ ] `ProviderRuntimeIngestion.test.ts`;
  - [ ] client-runtime session/send-engine tests;
  - [ ] `ChatView.logic.test.ts` and timeline tests.
- [ ] Record baseline failures without modifying unrelated code.
- [ ] Reconfirm the current latest migration id is `041`; reserve `042` for this feature.

## Task 1: Freeze the shared contract

**Owner:** coordinator. Complete before parallel work.

**Files:**

- `packages/contracts/src/baseSchemas.ts`
- `packages/contracts/src/provider.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/provider.test.ts`
- `packages/contracts/src/providerRuntime.test.ts`
- `packages/contracts/src/orchestration.test.ts`

### 1.1 Identifiers and runtime identity

- [ ] Add branded `ContextHandoffId` through the existing entity-id helper.
- [ ] Reuse existing `RuntimeSessionId`; do not create a competing epoch identifier.
- [ ] Add `runtimeSessionId` to `ProviderSessionStartInput`, `ProviderSession`,
      `ProviderRuntimeEventBase`, and `OrchestrationSession`.
- [ ] Make new fields optional or decoding-defaulted where historical event/session payloads must
      remain readable. New runtime code must always populate them.
- [ ] Add a fresh-start policy such as `resumePolicy: "compatible" | "fresh"`; omission decodes as
      compatible for existing callers.

### 1.2 Handoff metadata

- [ ] Define a versioned `ContextHandoffEndpointSnapshot` containing instance id, driver kind,
      provider display name/accent when available, model slug, and optional model display label.
- [ ] Define a discriminated `ContextHandoffActivityPayload` for `requested`, `preparing`,
      `dispatching`, `consumed`, `failed`, and `delivery-uncertain` states. It carries metadata and a
      digest only—never context content.
- [ ] Keep `sources` as an array to support the multi-source screenshot and later delta handoffs.
- [ ] Include `handoffId`, `targetMessageId`, optional `targetTurnId`, source/target selections,
      source/target runtime ids, mode, context version/digest, and bounded failure text.
- [ ] Define `ContextHandoffReference` for `thread.turn-start-requested`, with only the correlation
      fields the reactor needs.
- [ ] Add an optional reference to `ThreadTurnStartRequestedPayload` so historical events decode.
- [ ] Add the small `thread.context-handoff-requested` event payload/type. Do not add a separate
      dispatchable client command.

### 1.3 Contract tests

- [ ] Decode/encode every activity status and single/multiple endpoint forms.
- [ ] Reject malformed ids, empty source arrays where prohibited, and oversized errors.
- [ ] Decode historical provider/session/runtime events without runtime ids.
- [ ] Decode historical turn-start events without a handoff reference.
- [ ] Verify fresh/compatible resume policy defaults.
- [ ] Verify existing legacy `ModelSelection` promotion remains unchanged.

**Checkpoint:** run the focused contract tests, `bun typecheck`, and `bun run typecheck:effect`.

## Task 2: Add migration and runtime/handoff persistence foundations

**Owner:** coordinator or a foundation subagent before Wave 1.

**Files:**

- `apps/server/src/persistence/Migrations/042_ContextHandoffRuntimeSessions.ts`
- `apps/server/src/persistence/Migrations/042_ContextHandoffRuntimeSessions.test.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/persistence/Services/ProviderSessionRuntime.ts`
- `apps/server/src/persistence/Layers/ProviderSessionRuntime.ts`
- `apps/server/src/persistence/Services/ProjectionThreadSessions.ts`
- `apps/server/src/persistence/Layers/ProjectionThreadSessions.ts`
- new `apps/server/src/persistence/Services/ContextHandoffs.ts`
- new `apps/server/src/persistence/Layers/ContextHandoffs.ts`
- corresponding repository tests

### 2.1 Runtime-session columns

- [ ] Add nullable `runtime_session_id` to `provider_session_runtime` and
      `projection_thread_sessions` for rollout compatibility.
- [ ] Update every SELECT/INSERT/UPSERT and row schema to round-trip the id.
- [ ] Preserve legacy rows and indexes.

### 2.2 Handoff operational table

- [ ] Create `provider_context_handoffs` with:
  - [ ] `handoff_id` primary key and `thread_id`;
  - [ ] source/target `ModelSelection` JSON;
  - [ ] source/target runtime session ids;
  - [ ] status and context version;
  - [ ] structured context JSON and SHA-256 digest;
  - [ ] first message id and accepted provider turn id;
  - [ ] bounded error and created/updated timestamps.
- [ ] Add an index on `(thread_id, status, created_at)`.
- [ ] Keep the table server-local; do not expose context JSON in projection snapshots.

### 2.3 Repository operations

- [ ] Add idempotent create/get/list-by-thread operations.
- [ ] Add compare-and-set status transitions with expected current state.
- [ ] Add `storeContextIfEmpty` so retries reuse the original artifact/digest.
- [ ] Add reconciliation queries for `preparing` and `dispatching` rows.
- [ ] Test duplicate creates, lost CAS races, persistence across reopen, and legacy migration.

## Task 3: Propagate runtime session ids through every adapter

**Owner:** Subagent A.

**Files:**

- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Services/ProviderSessionDirectory.ts`
- `apps/server/src/provider/Layers/ProviderSessionDirectory.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/provider/Layers/CopilotAdapter.ts`
- Copilot session/event mapping files
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts` and ACP event factories/runtime as needed
- `apps/server/src/provider/Layers/GrokAdapter.ts` and ACP event factories/runtime as needed
- their focused adapter tests

- [ ] Require new session starts to receive the reserved `RuntimeSessionId`.
- [ ] Store it in each adapter's per-thread session context.
- [ ] Return it on `ProviderSession`.
- [ ] Stamp it on every canonical runtime event, including synchronous startup events, late exit,
      errors, tool events, requests, subagents, and assistant deltas.
- [ ] Ensure stopping an old session cannot stamp the id of a later same-instance session.
- [ ] Reject or fail tests when an adapter reports a mismatched id.
- [ ] Add A(epoch 1) then A(epoch 2) unit coverage for adapters with reusable runtimes.

**Checkpoint:** all adapter tests and provider contract tests pass.

## Task 4: Fence stale runtime events before any mutation

**Owner:** Subagent A.

**Files:**

- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- observability/metrics definitions used by provider ingestion

- [ ] At the start of runtime-event processing, resolve the projected active session.
- [ ] Before flushing buffers, remembering subagents, appending activities, or changing lifecycle,
      require both provider instance and runtime session id to match.
- [ ] Permit legacy missing runtime ids only during explicit recovery/compatibility paths; new
      handoff epochs must never use the legacy fallback.
- [ ] Drop mismatches and increment a low-cardinality stale-event metric/log.
- [ ] Ensure a stale `session.exited` cannot clear the current active turn or buffers.
- [ ] Ensure stale assistant deltas, tool events, approvals, runtime errors, plans, and subagent events
      cannot enter the canonical thread.
- [ ] Add regression tests for source A events after A→B and for epoch A1 after A1→B→A2.

## Task 5: Refactor ProviderService replacement and cleanup

**Owner:** Subagent A.

**Files:**

- `apps/server/src/provider/Services/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderService.test.ts`
- `apps/server/src/provider/Layers/ProviderSessionReaper.ts`
- `apps/server/src/provider/Layers/ProviderSessionReaper.test.ts`
- provider directory persistence/tests

- [ ] Add exact-binding `getSession(threadId)` routing based on instance/runtime id; stop selecting the
      first `listSessions()` entry sharing a thread id.
- [ ] Update directory bindings to include runtime id and clear old resume/runtime payload on
      provider/instance change or fresh replacement.
- [ ] In fresh mode, ignore both explicit and persisted resume cursors.
- [ ] Split target startup/binding from stale cleanup; remove the synchronous unbounded
      `stopStaleSessionsForThread` barrier.
- [ ] Return/capture the previous binding so target-start/send failure can restore it when the exact
      source runtime is still valid.
- [ ] For different instances, make old stop best-effort with a short deadline and do not route the
      stale runtime after target binding.
- [ ] For the same instance, stop the old thread-keyed runtime before fresh start; fail explicitly on
      timeout rather than aliasing two epochs.
- [ ] Teach the session reaper to retry stale instance/runtime pairs.
- [ ] Make `listSessions()` tolerate temporary duplicate app-thread sessions and expose only the
      authoritative binding to ordinary callers.
- [ ] Add tests for never-resolving stop, target routing during duplicate presence, stale reaping,
      no resume leakage, rollback to a still-valid source binding, and same-instance timeout.

## Task 6: Build and render the deterministic context artifact

**Owner:** Subagent B.

**Files:**

- new `apps/server/src/orchestration/contextHandoff/ContextHandoffBuilder.ts`
- new `apps/server/src/orchestration/contextHandoff/ContextHandoffRenderer.ts`
- new `apps/server/src/orchestration/contextHandoff/ContextHandoffService.ts`
- matching focused tests
- `packages/shared/src/toolActivity.ts` and tests only when a provider-neutral extraction helper is
  genuinely reusable

### 6.1 Structured builder

- [ ] Accept the canonical thread snapshot, target message id, source/target metadata, and prior
      handoff metadata.
- [ ] Stop history at the target message and exclude that message.
- [ ] Coalesce tool lifecycle by stable turn/item identity and prefer terminal state.
- [ ] Extract allow-listed command, exit-code, output, path, file-change, plan, checkpoint, failure,
      question, and subagent fields.
- [ ] Exclude arbitrary unknown payloads, hidden reasoning, telemetry, startup events, and handoff
      context bodies.
- [ ] Stable-sort entries and object keys.
- [ ] Accumulate/de-duplicate source endpoint snapshots from prior completed handoffs plus the
      immediate source.
- [ ] Persist structured JSON and a deterministic SHA-256 digest through the repository.

### 6.2 Budget-aware renderer

- [ ] Compute the exact available text budget from `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` after the
      current user message and envelope.
- [ ] Preserve the exact current user message.
- [ ] Use section priorities and per-field caps; select recent/high-value entries and render selected
      entries chronologically.
- [ ] Produce a valid minimal envelope even for tool-only or attachment-only turns.
- [ ] Handle Unicode boundaries without splitting surrogate pairs.
- [ ] Reject only when the current message leaves no room for the minimum handoff header.

### 6.3 Tests

- [ ] Determinism and digest stability.
- [ ] Tool-only histories and missing assistant messages.
- [ ] Commands with non-zero exit codes and large output.
- [ ] File changes/checkpoint stats/active plans/pending questions.
- [ ] Malformed and cyclic-looking unknown payloads are ignored safely.
- [ ] Current message and target events are excluded.
- [ ] Prior handoffs do not recursively inflate the artifact.
- [ ] Unicode/pathological length cases stay within the limit.

## Task 7: Make `thread.turn.start` atomically request a handoff

**Owner:** coordinator.

**Files:**

- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/commandInvariants.ts` if a reusable idle helper is warranted
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- new or focused decider/projector/pipeline tests

- [ ] Determine target selection from the command and source selection from the pre-command thread.
- [ ] Trigger a handoff only for a started thread when instance id or model slug differs; ignore
      options-only differences.
- [ ] Enforce server-side idle invariants: no starting/running turn, active callback/request, queued
      work, or actionable handoff.
- [ ] Derive a stable handoff/activity id from the accepted turn command.
- [ ] Atomically emit request metadata, pending marker activity, user message, and turn-start request
      in deterministic sequence.
- [ ] Do not update canonical thread model selection yet. Commit it only after provider acceptance.
- [ ] Keep first-turn and unchanged-selection behavior byte-for-byte compatible where possible.
- [ ] Update projections for small handoff metadata only; never include context JSON in snapshots.
- [ ] Test event order, pre-mutation source capture, running rejection, options-only behavior,
      duplicate command receipts, and repeated A→B→A source selection.

## Task 8: Coordinate handoff preparation, target dispatch, and recovery

**Owner:** coordinator.

**Files:**

- new `apps/server/src/orchestration/Services/ContextHandoffCoordinator.ts`
- new `apps/server/src/orchestration/Layers/ContextHandoffCoordinator.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/Layers/OrchestrationReactor.ts`
- `apps/server/src/server.ts` / layer wiring
- focused coordinator and reactor tests

- [ ] On a handoff turn, idempotently create/load the operational row and CAS `requested` to
      `preparing`.
- [ ] Build/store the artifact before starting the target runtime.
- [ ] Resolve source/target endpoint presentation snapshots from provider instance metadata.
- [ ] Reserve a new runtime session id and start the target with fresh policy.
- [ ] Bind/fence the target and render the stored artifact with the exact current message budget.
- [ ] Do not fork the initial `sendTurn` before acceptance; wait for `ProviderTurnStartResult`.
- [ ] CAS to `dispatching` before invoking the provider and record the first message id.
- [ ] On acceptance, persist provider turn id, CAS to `consumed`, update the same activity to
      consumed, and dispatch `thread.meta.update` to commit the target selection.
- [ ] Start bounded source cleanup after successful target acceptance for different instances.
- [ ] On pre-acceptance failure, stop partial target state, restore an exact still-live source binding
      when possible, preserve source canonical selection, and update the marker to failed.
- [ ] Ensure the normal no-handoff path still uses existing session/model-switch behavior.
- [ ] Add startup recovery for `preparing` and `dispatching`: reuse stored context, reconcile accepted
      turns, or mark `delivery-uncertain`; never auto-resend ambiguous dispatches.
- [ ] Add duplicate event/turn processing tests proving one in-process target start/send.

## Task 9: Make checkpoint rollback epoch-aware for V1

**Owner:** coordinator.

**Files:**

- `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts`
- contracts only if an explicit error code is needed

- [ ] Identify the last handoff boundary/runtime epoch for the active thread.
- [ ] Prevent `rollbackConversation(numTurns)` from applying app-thread turn counts that include work
      executed by another provider-native session.
- [ ] For V1, reject provider-native rollback across a handoff boundary with a clear activity/error;
      keep filesystem checkpoint behavior explicit and non-corrupting.
- [ ] Preserve existing rollback behavior wholly inside the active epoch.
- [ ] Add cross-provider and A→B→A regression tests.

## Task 10: Add typed client-runtime handoff projection and milestone retention

**Owner:** Subagent C.

**Files:**

- new `packages/client-runtime/src/state/session/contextHandoff.ts`
- `packages/client-runtime/src/state/session/session-logic.ts`
- session-logic tests
- `packages/shared/src/threadActivity.ts`
- `packages/shared/src/threadActivity.test.ts`

- [ ] Decode activity payloads with the exported contract schema; never cast unknown payloads.
- [ ] Produce `ContextHandoffTimelineEntry` with stable ids, status, sources, target, and target
      message anchor.
- [ ] Extend `ThreadActivityViewModel` and `TimelineEntry` without affecting work-log derivation.
- [ ] Insert the handoff entry explicitly before `targetMessageId`; use chronological fallback only
      when the anchor message has been pruned.
- [ ] Keep pending internal markers hidden; render consumed, failed, and delivery-uncertain states.
- [ ] Generalize milestone retention so handoff and compaction activities survive the activity cap.
- [ ] Ensure revert filtering removes markers beyond the reverted target turn/boundary.
- [ ] Test malformed payload fallback, equal timestamps, multiple sources, repeated markers, stable
      ids, milestone caps, and unchanged compaction behavior.

## Task 11: Stage idle provider selection and make send atomic

**Owner:** one web integration agent; it owns `ChatView.tsx` exclusively during this task.

**Files:**

- `apps/web/src/components/ChatView.logic.ts`
- `apps/web/src/components/ChatView.logic.test.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/ModelPickerContent.tsx`
- `packages/client-runtime/src/state/composer/sendEngine.ts`
- `packages/client-runtime/src/state/composer/sendEngine.test.ts`
- `apps/web/src/hooks/executeChatSendTurn.ts`
- `apps/web/src/hooks/executeChatSendTurn.test.ts`

### 11.1 Explicit selection policy

- [ ] Replace the permanent post-start `lockedProvider` assumption with a pure policy:
      all-ready while eligible, continuation-only while busy/frozen.
- [ ] Include running/starting/connecting, local dispatch/undo window, worktree preparation, pending
      approval/input, queue state, mutation authority, unavailable environment, and phone tier.
- [ ] Recheck the policy in `onProviderModelSelect` to close picker-open races.
- [ ] Preserve current-provider/continuation behavior while busy.

### 11.2 Staged selection

- [ ] Keep the target solely in the composer draft until send.
- [ ] Show its logo/model immediately in the trigger.
- [ ] Normalize traits unsupported by the target, including ask mode.
- [ ] Selecting back to the canonical model cancels pending handoff semantics naturally.
- [ ] Do not dispatch a handoff command or optimistic marker on selection.

### 11.3 Atomic send boundary

- [ ] Stop using a preceding `thread.meta.update` to persist a changed model before
      `thread.turn.start`.
- [ ] Continue passing the target selection on `thread.turn.start`.
- [ ] Keep other next-turn settings persistence ordered and compatible.
- [ ] On immediate command rejection, restore prompt/attachments through existing rollback and keep
      the staged target retryable.
- [ ] On async handoff failure, render the persisted failure state and keep selection/retry behavior
      predictable.
- [ ] Test no server effect on selection, undo-before-commit, target on turn-start, no unsafe meta
      update, busy race, and retry.

## Task 12: Render the screenshot-style timeline breaker

**Owner:** Subagent C for the primitive, then web integration agent for wiring if needed.

**Files:**

- new `apps/web/src/components/chat/ContextHandoffMarkerRow.tsx`
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/MessagesTimeline.test.tsx`
- `apps/web/src/components/chat/MessagesTimeline.browser.tsx`
- existing provider icon/model display helpers

- [ ] Add a dedicated `context-handoff` row variant that cannot enter turn folds/work groups.
- [ ] Render divider lines, bidirectional context icon, source endpoint(s), arrow, and target endpoint.
- [ ] Reuse `ProviderInstanceIcon`/provider icon helpers and preserve custom-instance fallback.
- [ ] Use persisted labels first and current provider catalog only as an enhancement.
- [ ] Add danger/uncertain tones without presenting them as successful.
- [ ] Add complete accessible name/tooltip, stable data attributes, truncation, and source wrapping.
- [ ] Exclude the marker from minimap/message search targets.
- [ ] Test known/unknown provider, one/multiple sources, long labels, light/dark, narrow width, no
      overflow, memo stability, and compaction coexistence.

## Task 13: Add cross-layer integration and browser flows

**Owner:** coordinator.

**Files:** focused existing integration harnesses; add new files only if current harnesses cannot
express the flow cleanly.

- [ ] Server integration: Codex A→Claude B→Grok C→Codex A in one app thread.
- [ ] Assert four distinct runtime session ids and three context artifacts/markers.
- [ ] Assert every target first input contains its one handoff envelope plus exact current message.
- [ ] Assert ordinary second turns on each epoch contain no repeated envelope.
- [ ] Assert all old epoch event classes are fenced.
- [ ] Assert a hanging stale stop does not block a different target.
- [ ] Assert same-instance fresh-stop timeout fails explicitly.
- [ ] Assert target startup/send failure never creates a blank “successful” continuation.
- [ ] Assert handoff activity and operational state survive server restart without duplicate send.
- [ ] Browser flow on one route/thread:
  - [ ] selection alone creates no RPC/activity;
  - [ ] send carries target selection;
  - [ ] persisted marker anchors before target user message;
  - [ ] repeated switches produce ordered markers;
  - [ ] remount/reconnect reproduces markers without duplication;
  - [ ] busy-state race rejects stale picker selection;
  - [ ] failure state is visible and retryable.
- [ ] Verify scroll pinning at end and no scroll theft while reading history.

## Task 14: Observability, diagnostics, and docs

**Owner:** coordinator.

- [ ] Add low-cardinality counters/timers for requested, consumed, failed, delivery-uncertain,
      context bytes/entries, stale events dropped, stale-stop timeout, and preparation/dispatch
      latency.
- [ ] Never log context content, prompts, command output, credentials, or digests as high-cardinality
      labels.
- [ ] Add concise architecture/user docs explaining idle-only behavior, fresh-session semantics,
      failure/retry, and why old provider-native undo cannot cross the boundary.
- [ ] Keep public docs free of private deployment/issue data per `AGENTS.md`.

## Task 15: Validate and hand off

**Owner:** coordinator.

- [ ] Run all focused tests from Tasks 1–13.
- [ ] Run `git diff --check` and inspect the complete diff for unrelated changes, context leakage,
      casts of unknown activity payloads, and missing runtime ids.
- [ ] Run the full required repository backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
```

- [ ] Because this changes web interaction and responsive timeline layout, also run:

```sh
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

- [ ] Install the pinned Playwright browser first if necessary:

```sh
bun run --cwd apps/web test:browser:install
```

- [ ] Manually inspect idle picker, successful A→B→C→A breakers, long/multiple labels, failed
      handoff, light/dark, narrow desktop/tablet, reload, and reconnect.
- [ ] Report exact test commands/results, known limitations, migration impact, and any deliberately
      deferred native-resume/delta work.

## Merge-blocking acceptance checklist

- [ ] One visible thread supports repeated idle provider/model handoffs.
- [ ] Selection alone has no server effect.
- [ ] Source selection and runtime epoch are captured before target mutation.
- [ ] Every handoff target is fresh and receives no resume cursor.
- [ ] Context is deterministic, bounded, useful for tool-only history, and never stored in events.
- [ ] Current user text is unchanged in canonical history and preserved exactly in provider input.
- [ ] Late source and earlier same-provider epoch events cannot mutate the active thread.
- [ ] Different-instance stale shutdown cannot hang the target indefinitely.
- [ ] Failed/ambiguous delivery is explicit and never silently treated as context-aware success.
- [ ] Timeline breakers are durable, anchored correctly, accessible, responsive, and match the
      approved screenshot direction.
- [ ] Cross-boundary provider-native rollback is safe/rejected explicitly.
- [ ] Full repository and browser backstops pass.
