# 31 — Context handoff

| Field                       | Value                         |
| --------------------------- | ----------------------------- |
| **Batch**                   | Provider orchestration        |
| **Order in batch**          | Standalone                    |
| **Depends on (same batch)** | —                             |
| **Execution style**         | Lead agent plus three workers |

## Prompt

Implement repeatable, idle-only context handoffs between provider instances/models inside one
visible Ryco thread. A selection is staged locally; the next send atomically requests the handoff.
The server starts a fresh target provider runtime, injects a deterministic canonical context
package into only the target's first turn, fences all prior runtime epochs, and persists a
screenshot-style timeline breaker before the triggering message.

This feature has an approved design. Execute it; do not restart product design or substitute a
different handoff model.

### Read before editing

Read these files completely and treat them as the implementation contract:

1. Repository `AGENTS.md`.
2. `docs/superpowers/specs/2026-08-04-context-handoff-design.md`.
3. `docs/superpowers/plans/2026-08-04-context-handoff.md`.

Then inspect the existing contracts, persistence repositories, provider lifecycle, orchestration
decider/reactors, client-runtime projections, send engine, provider picker, and message timeline
named in the plan. Confirm assumptions against current code before changing it.

Optional upstream references are inspiration only; Ryco's approved design and invariants win:

- `pingdotgg/t3code` PR 2829 for orchestration/context-transfer concepts.
- `pingdotgg/t3code` PR 5307 for the lifecycle-row visual direction.
- `pingdotgg/t3code` issues 4766, 4944, and 2365 for lost source binding, stale lifecycle events,
  and incompatible provider-native resume failure modes.

### Non-negotiable behavior

- Keep one visible Ryco thread and route. Support repeated `A -> B -> C -> A` handoffs.
- Allow handoff only while idle. Recheck eligibility in the client action and on the server.
- Selecting another provider/model has no server effect. It creates no session, event, activity,
  or marker until the user sends.
- Use the existing `thread.turn.start` as the trigger. Do not add a separate public switch command.
- Determine the source from the pre-command canonical thread state. Stop sending a changed
  `thread.meta.update` before `thread.turn.start`.
- Every V1 target is a fresh provider-native runtime. Disable explicit and persisted resume
  cursors. Do not resume an older native conversation or implement delta transfer in V1.
- Build context deterministically from Ryco's canonical history. Do not ask the outgoing provider
  to summarize and do not depend on it being available.
- Include useful structured messages, plans, terminal tool/command results, paths/file changes,
  checkpoint summaries, relevant failures/questions, and prior boundary metadata. Exclude hidden
  reasoning, protocol noise, unknown payload copies, telemetry, target startup, the current message,
  and recursive context bodies.
- Keep the visible user message unchanged. Preserve it exactly in the target provider input.
- Store the large context document only in a server-local operational table. Never place it in
  orchestration events, activities, snapshots, RPC responses, logs, or analytics.
- Fence provider events by both `ProviderInstanceId` and `RuntimeSessionId` before any mutation.
  This must reject late `A1` events after `A1 -> B -> A2`, including `session.exited`.
- Bound different-instance stale cleanup and retry it asynchronously. For same-instance fresh
  replacement, fail explicitly if the old thread-keyed runtime cannot stop safely.
- Do not claim cross-process exactly-once delivery. Reconcile a durable `dispatching` operation;
  if acceptance cannot be proved, mark it `delivery-uncertain` and never blindly resend.
- Commit the target as the canonical model only after the target accepts the first turn. A failed
  handoff preserves the source selection and exposes an explicit failed boundary.
- Render a persisted divider before `targetMessageId`, using source logo/model list, an arrow, and
  target logo/model. Persist presentation snapshots so old markers survive provider renames.
- Keep pending internal states hidden. Show consumed, failed, and delivery-uncertain outcomes with
  accessible status semantics.
- Do not extend `apps/mobile` or the frozen `apps/web` phone provider flow.
- Reject or safely constrain provider-native rollback across a handoff epoch in V1.

### Execution protocol

1. Record the baseline, install with `bun install --frozen-lockfile`, and run the focused existing
   tests named in Task 0.
2. Implement Task 1 contracts and Task 2 migration/repository foundations first. Do not delegate
   downstream slices until their shared schemas and persistence interfaces compile.
3. After the foundation is stable, use three subagents in parallel with the ownership below.
4. Require each subagent to inspect before editing, add focused tests, run relevant checks, report
   exact files changed and results, and avoid commits unless you explicitly coordinate commits.
5. You own integration points and resolve mismatches against the approved spec, not by weakening
   runtime fencing, atomicity, durability, or context privacy.
6. Assign exactly one agent to the `ChatView.tsx`/composer integration after the client marker
   primitives land. Never have two agents edit `ChatView.tsx` concurrently.
7. Complete Tasks 13–15 yourself: cross-layer tests, browser flows, documentation, complete diff
   review, and all repository backstops.

### Lead-agent ownership

The lead owns:

- Task 0 baseline and Task 1 shared contracts.
- Task 2 migration and persistence foundation, unless assigned to a temporary foundation worker
  before the three parallel slices start.
- Tasks 7–9: atomic turn-start decision, coordinator/reactor integration, recovery, and checkpoint
  epoch safety.
- Task 11 web selection/send integration, or delegation of that whole hot-file slice to exactly one
  worker after Wave 1.
- Tasks 13–15 and all final integration decisions.

Do not let workers independently redesign event ordering, activity status, persistence state, or
fresh-session semantics.

### Subagent A prompt — runtime epoch and replacement lifecycle

> Read `AGENTS.md`, the context-handoff design spec, and implementation-plan Tasks 3–5. Implement
> only Tasks 3–5. Propagate the already-defined `RuntimeSessionId` through every provider adapter,
> provider session/directory binding, and every canonical runtime event. Add the ingestion guard
> before any buffer, lifecycle, activity, request, message, plan, tool, or subagent mutation. Refactor
> ProviderService to route the exact instance/runtime binding, disable all resume state in fresh
> mode, bound different-instance stale cleanup, safely handle same-instance fresh replacement, and
> add reaper retry. Add focused regressions for late source events and `A1 -> B -> A2`, hanging stop,
> no resume leakage, and exact routing. Do not edit orchestration contracts beyond adapting to the
> lead's frozen schema. Do not edit the context builder, `ProviderCommandReactor.ts`, or web files.
> Preserve unrelated changes. Run the focused provider/ingestion tests and both typechecks; report
> changed files, commands, results, and integration assumptions to the lead.

### Subagent B prompt — deterministic context artifact

> Read `AGENTS.md`, the context-handoff design spec, and implementation-plan Task 6. Implement only
> the pure structured context builder, budget-aware renderer, small service, and focused tests using
> the lead's frozen contracts/repository interface. Build from canonical state before
> `targetMessageId`; coalesce terminal tool lifecycle; allow-list useful messages, plans, commands,
> outputs, paths, file/checkpoint changes, failures/questions, prior boundary metadata, and relevant
> subagent summaries. Exclude hidden reasoning, arbitrary unknown payloads, telemetry, startup,
> current target message, and recursive handoff bodies. Produce deterministic ordering/JSON/digest,
> section-aware truncation, Unicode-safe limits, and preserve the exact current message. Never log
> or expose the artifact. You may extract a provider-neutral helper into
> `packages/shared/src/toolActivity.ts` only if it is genuinely reusable. Do not edit
> `ProviderCommandReactor.ts`, provider adapters, persistence migrations, or web files. Run focused
> tests and both typechecks; report changed files, commands, results, and the renderer API.

### Subagent C prompt — client projection and marker primitive

> Read `AGENTS.md`, the context-handoff design spec, and implementation-plan Tasks 10 and 12.
> Implement only typed client-runtime activity projection, milestone retention, explicit
> `targetMessageId` timeline anchoring, and the screenshot-style marker component/tests. Decode with
> the exported schema—do not cast unknown activity data. Keep pending states hidden; represent
> consumed, failed, and delivery-uncertain outcomes. Preserve handoffs as milestones alongside
> compaction. Insert the marker before its target message even when timestamps tie; use a safe
> chronological fallback only if the anchor was pruned. Reuse provider icon helpers, persist-label
> fallbacks, accessible text/tooltips, responsive truncation/wrapping, and avoid work groups, turn
> folds, minimap, and message-search targets. Do not edit `ChatView.tsx`, `ChatComposer.tsx`, picker
> selection behavior, server files, or contracts. Run focused client-runtime/web tests and both
> typechecks; report changed files, commands, results, and the view-model/component API.

### Web integration owner prompt — staged selection and atomic send

Run this only after Subagent C's primitives are available:

> Read `AGENTS.md`, the context-handoff design spec, and implementation-plan Task 11. You have sole
> ownership of `ChatView.tsx`, `ChatComposer.tsx`, provider/model picker integration, and the send
> boundary for this task. Replace the permanent post-start provider lock with a pure eligibility
> policy: all ready providers while truly idle, continuation-only while busy/frozen. Include every
> state listed in the plan and recheck on selection. Stage the target only in composer state;
> selection alone must send no RPC and create no optimistic marker. Remove the changed-model
> `thread.meta.update` that currently occurs before `thread.turn.start`; pass the target selection
> on that command and preserve other settings behavior. Keep immediate rejection rollback and retry
> predictable. Do not redesign server handoff semantics or marker internals. Add logic/send/browser
> tests for no-effect selection, target-on-send, busy race, rejection, retry, and frozen phone tier.
> Run focused web/client tests and both typechecks; report changed files, commands, and results.

### Coordination rules

- Use a shared-worktree ownership ledger in your progress notes. Before a worker edits a file, make
  sure no other active worker owns it.
- Workers may read all files but write only their assigned slice. Reassign shared files explicitly.
- Integrate contracts/migration first, then Wave 1 workers, then the single web integration owner,
  then cross-layer tests.
- Review every worker diff before accepting it. Verify new provider events always carry the
  requested runtime id and no context content escaped the operational repository.
- If current code invalidates a plan detail, preserve the invariant and adjust the smallest local
  mechanism. Record the deviation and why. Ask the user only if the approved product behavior must
  change.
- Preserve user changes. Use `apply_patch` for manual edits. Do not perform destructive git
  operations. Do not commit unless the user has explicitly requested it.

### Required validation

Run focused tests continuously, then the complete repository backstop exactly as required by
`AGENTS.md`:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Install the pinned browser runtime first with
`bun run --cwd apps/web test:browser:install` if it is absent. Never run `bun test`.

Also run `git diff --check`, inspect the full diff, and manually exercise successful
`A -> B -> C -> A`, failure, delivery ambiguity, reload/reconnect, busy-race, long/multiple labels,
light/dark, and narrow desktop/tablet behavior.

### Completion report

Do not declare completion until every merge-blocking acceptance item in the implementation plan is
satisfied. Report:

- behavior implemented and deliberate V1 limits;
- migration/contract impact;
- runtime-fencing and crash-recovery behavior;
- context privacy/budget guarantees;
- exact tests and validation results;
- any baseline or remaining failure with its exact error;
- files changed and any plan deviation.

### Acceptance

- One visible idle thread supports repeated provider/model handoffs.
- Selection alone has no server-side effect.
- Every target starts fresh and receives one deterministic, bounded context preamble.
- The exact current message remains canonical and unmodified.
- Prior runtime epochs cannot mutate the active thread.
- Stale cleanup cannot hang a different-instance target indefinitely.
- Failed or ambiguous delivery never appears as a successful context-aware continuation.
- Durable logo/model breakers render directly before their triggering messages after reload.
- Provider-native rollback cannot cross epochs unsafely.
- All required repository and browser checks pass.
