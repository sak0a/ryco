# Queued Message Steering Implementation Plan

Design: `docs/superpowers/specs/2026-08-17-queued-message-steering-design.md`

## Objective

Keep follow-up sends queued by default while allowing a user to promote one queued entry into an
exact active Codex turn. Preserve the queued copy until an accepted steer is projected, share policy
between web and native mobile, and leave unsupported providers queued without interruption.

## Task 1: Contracts and shared projection model

Files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/provider.ts`
- `packages/contracts/src/server.ts`
- `packages/contracts/src/orchestration.test.ts`
- `packages/contracts/src/server.test.ts`

Steps:

1. Add `TurnDispatchMode`, steer request/result payloads, and the public steer command plus
   requested/accepted/rejected orchestration events.
2. Add the optional user-message dispatch marker with legacy-compatible decoding.
3. Add provider steer input/result contracts and the server-provider capability field.
4. Cover decoding, bounds, defaults, and malformed expected-turn inputs.

Focused validation:

```sh
bun run --cwd packages/contracts test src/orchestration.test.ts src/server.test.ts
```

## Task 2: Orchestration request and outcome lifecycle

Files:

- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- related decider, projector, reactor, and projection tests
- `packages/client-runtime/src/state/threads/store.ts`
- `packages/client-runtime/src/state/threads/store.test.ts`

Steps:

1. Validate that `thread.turn.steer` targets the exact active turn and persist only a requested
   event at command acceptance.
2. Route requested events through `ProviderCommandReactor` and publish a server-owned accepted or
   rejected resolution after the provider result.
3. Project accepted content as a user message on the existing turn with `dispatchMode: "steer"`.
4. Project rejected outcomes as bounded provider-failure activity without changing turn state.
5. Teach the shared thread store to apply accepted/rejected outcomes idempotently.

Focused validation:

```sh
bun run --cwd apps/server test src/orchestration/decider.test.ts src/orchestration/projector.test.ts
bun run --cwd apps/server test src/orchestration/Layers/ProviderCommandReactor.test.ts src/orchestration/Layers/ProjectionPipeline.test.ts
bun run --cwd packages/client-runtime test src/state/threads/store.test.ts
```

## Task 3: Provider capability and Codex protocol

Files:

- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Services/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/providerSnapshot.ts`
- provider registry/snapshot construction files and focused tests

Steps:

1. Add the adapter capability/method contract and typed provider-service steer operation.
2. Route only through the current bound session, require the expected active turn, and do not
   recover or switch sessions.
3. Advertise native steering from Codex and project it into `ServerProvider` snapshots; all other
   providers advertise unsupported.
4. Reuse Codex turn input shaping and call `turn/steer` with provider thread ID,
   `expectedTurnId`, and stable `clientUserMessageId`.
5. Decode the response, preserve the active turn, and map stale/non-steerable errors without
   interrupting.

Focused validation:

```sh
bun run --cwd apps/server test src/provider/Layers/CodexAdapter.test.ts src/provider/Layers/ProviderService.test.ts
bun run --cwd apps/server test src/provider/providerSnapshot.test.ts src/provider/Layers/ProviderAdapterRegistry.test.ts
```

## Task 4: Shared queue steering policy

Files:

- `packages/client-runtime/src/state/message-queue/logic.ts`
- `packages/client-runtime/src/state/message-queue/store.ts`
- `packages/client-runtime/src/state/message-queue/index.ts`
- corresponding tests
- shared composer dispatch helpers under `packages/client-runtime/src/state/composer/`

Steps:

1. Give queued entries stable message identity and track pending steer attempts per scoped thread.
2. Add pure eligibility results for connection, active turn, provider capability, and exact
   model/mode compatibility.
3. Add provider-neutral steer command preparation from a fully encoded composer snapshot.
4. Ensure ordinary drains stop at a pending first entry and cleanup is idempotent on accepted or
   rejected outcomes.

Focused validation:

```sh
bun run --cwd packages/client-runtime test src/state/message-queue src/state/composer
```

## Task 5: Web and desktop interaction

Files:

- `apps/web/src/components/chat/ComposerQueuedMessages.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/messageQueue.logic.ts`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- focused logic/component/browser tests

Steps:

1. Add enabled, disabled-with-reason, and pending Steer states to queued rows while preserving
   reorder/remove behavior.
2. Dispatch a queued snapshot with the exact active turn and retain it until accepted projection.
3. Exclude pending entries from queue drain and restore the row on rejection.
4. Revoke cloned blob previews only after accepted removal or explicit deletion.
5. Render a quiet Steered message marker and suppress the new action in the frozen web phone tier.

Focused validation:

```sh
bun run --cwd apps/web test src/messageQueue.logic.test.ts src/components/ChatView.logic.test.ts
bun run --cwd apps/web test src/components/chat/MessagesTimeline.test.tsx
bun run --cwd apps/web test:browser -- src/components/ChatView.browser.tsx
```

## Task 6: Native mobile interaction and reconciliation

Files:

- `apps/mobile/src/state/threadOutboxModel.ts`
- `apps/mobile/src/state/threadOutbox.ts`
- `apps/mobile/src/state/use-thread-outbox-drain.ts`
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`
- `apps/mobile/src/features/threads/ThreadComposer.tsx`
- a new compact queued-message component near the thread composer
- `apps/mobile/src/state/threadTimeline.ts`
- focused mobile tests

Steps:

1. Select the current thread's durable queued entries and show their compact previews above the
   composer.
2. Prepare persisted attachments through the mobile codec and submit an exact-turn steer.
3. Keep the outbox entry through pending/rejection and remove it after accepted projection.
4. Reconcile projected user message IDs before normal drain so an accepted background steer cannot
   later send as a new turn.
5. Render the Steered transcript marker with native styling and accessibility labels.

Focused validation:

```sh
bun run --cwd apps/mobile test src/state/threadOutboxModel.test.ts src/state/threadOutbox.test.ts
bun run --cwd apps/mobile test src/state/threadTimeline.test.ts
```

## Task 7: Backstops and review

1. Run focused formatting, lint, typecheck, and tests while completing each boundary.
2. Run `git diff --check` and inspect all generated/persistence changes for compatibility.
3. Because the feature crosses contracts, provider runtime, orchestration, shared client state,
   web, and mobile, run the approved repository backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
```

4. Review stale-turn, duplicate-delivery, unsupported-provider, reconnect, attachment, and frozen
   web-phone behavior in the final diff.

Commands use Bun 1.3.14. Never invoke `bun test`; use `bun run test` or package test scripts.
