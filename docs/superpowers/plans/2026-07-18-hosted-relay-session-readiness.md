# Hosted Relay Session Readiness Implementation Plan

**Goal:** Make the hosted client reliably leave synchronization after receiving the node's initial
shell snapshot, preserve the live stream, and show a bounded retryable failure instead of waiting
forever when synchronization cannot complete.

**Architecture:** A test-only in-memory relay bridge will join the production hosted logical
WebSocket, canonical relay codec, Effect RPC client, node `RpcByteSession`, and streamed
orchestration handler. Startup readiness will be separated into core snapshot acceptance and
secondary UI reconciliation. A generation-scoped 30-second watchdog and explicit same-node retry
will cover genuine non-delivery without creating another socket retry loop.

**Design spec:**
`docs/superpowers/specs/2026-07-18-hosted-relay-session-readiness-design.md`

## Execution rules

- Work only on `fix/hosted-relay-session-readiness` in the public repository.
- Do not change relay schemas, relay fixtures, RPC access policy, authentication, ticket semantics,
  payload limits, or flow-control behavior.
- Do not add private service names, domains, identifiers, issue links, credentials, or captured
  payloads.
- Add a failing regression before changing production behavior. If the full integration harness is
  green on the current implementation, use it to narrow the failure and add a smaller red test
  before patching production code.
- Never run `bun test`; use `bun run test` and optional file filters.
- Before each commit, run `git diff --check` and inspect staged changes for private or sensitive
  material.

---

## Task 1: Reproduce streamed RPC across the complete hosted relay boundary

**Files:**

- Create: `apps/server/src/hubConnector/HostedRelaySessionIntegration.test.ts`
- Modify if a focused server-side assertion is needed:
  `apps/server/src/hubConnector/RelayRpcIntegration.test.ts`
- Modify if a focused client-side assertion is needed: `apps/web/src/hostedHub/relaySocket.test.ts`

- [ ] Build a test-only physical socket that accepts canonical client authentication, emits
      negotiated ready/channel frames, and bridges canonical data frames to a real
      `RpcByteSession`.
- [ ] Use `HostedRelayRpcWebSocket`, the production Effect RPC WebSocket protocol, `WsRpcGroup`, and
      a real streamed `orchestration.subscribeShell` handler.
- [ ] Emit one synthetic initial snapshot and one later synthetic shell event.
- [ ] Assert that the client receives the snapshot, returns the Effect stream acknowledgment, then
      receives the later event without reconnecting.
- [ ] Assert exact ordering, monotonically increasing relay sequences, bounded queues, one logical
      channel, and deterministic scope cleanup.
- [ ] Use only synthetic public identifiers and metadata. Assert sensitive canaries are absent from
      errors and snapshots.
- [ ] Run
      `bun run test apps/server/src/hubConnector/HostedRelaySessionIntegration.test.ts apps/server/src/hubConnector/RelayRpcIntegration.test.ts apps/web/src/hostedHub/relaySocket.test.ts`.
- [ ] Record whether the failure is transport delivery, stream acknowledgment, snapshot callback,
      or readiness transition. Do not change production code until a test is red at that boundary.

**Checkpoint commit:** `test(hub): reproduce hosted relay session synchronization`

## Task 2: Make snapshot acceptance release readiness deterministically

**Files:**

- Modify: `apps/web/src/environments/runtime/connection.ts`
- Modify: `apps/web/src/environments/runtime/service.ts`
- Modify: `apps/web/src/environments/runtime/connection.test.ts`
- Modify: `apps/web/src/environments/runtime/service.test.ts`
- Modify if required by the reproduced boundary: `apps/web/src/rpc/wsTransport.ts`
- Modify if required by the reproduced boundary: `apps/web/src/rpc/wsTransport.test.ts`

- [ ] Split initial snapshot processing into explicit core acceptance and secondary derived-state
      reconciliation.
- [ ] Apply the valid snapshot, record its projection version, resolve the connection bootstrap
      gate, and mark the matching hosted environment ready before secondary reconciliation.
- [ ] Treat an unchanged snapshot received during replay as readiness confirmation without applying
      it twice.
- [ ] Keep older snapshots rejected and prevent a snapshot for another environment from changing
      hosted readiness.
- [ ] Convert transport, decoding, validation, and core application failures during initial
      synchronization into an explicit callback instead of silently swallowing them.
- [ ] Isolate a secondary reconciliation exception after core application and emit only the stable
      `hosted_snapshot_reconciliation_failed` diagnostic code.
- [ ] Preserve long-lived subscription recovery, acknowledgments, event ordering, and direct/saved
      environment behavior.
- [ ] Add tests for first snapshot, duplicate replay snapshot, stale snapshot, wrong environment,
      core failure, secondary failure, and later stream events.
- [ ] Run
      `bun run test apps/web/src/environments/runtime/connection.test.ts apps/web/src/environments/runtime/service.test.ts apps/server/src/hubConnector/HostedRelaySessionIntegration.test.ts`.

**Checkpoint commit:** `fix(hub): release hosted readiness after snapshot acceptance`

## Task 3: Add the bounded synchronization watchdog and same-node retry

**Files:**

- Modify: `apps/web/src/hostedHub/state.ts`
- Modify: `apps/web/src/hostedHub/environment.ts`
- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.tsx`
- Modify: `apps/web/src/hostedHub/state.test.ts`
- Modify: `apps/web/src/hostedHub/environment.test.ts`
- Modify or create a focused browser test for `HostedHubRoot` if DOM behavior is not covered by
  state tests.

- [ ] Start one generation-scoped 30-second watchdog when node activation enters synchronizing.
- [ ] Clear it on readiness, node change, sign-out/session expiry, environment teardown, and test
      reset.
- [ ] Ignore stale callbacks from previous selection generations.
- [ ] On timeout or explicit initial-snapshot failure, enter a terminal hosted synchronization
      failure with the exact message `Ryco state could not be synchronized.`
- [ ] Add a Retry action to the failure surface. Retry increments the generation, tears down the
      previous logical session, obtains a new one-use relay ticket through the existing attempt
      factory, and activates the same selected node.
- [ ] Prevent concurrent retries and never render `RootAppShell` before a valid snapshot is accepted.
- [ ] Keep the ordinary reconnect policy unchanged and avoid a second automatic retry loop.
- [ ] Test 29,999 ms versus 30,000 ms, every cancellation path, duplicate retry clicks, fresh ticket
      use, and stale timer isolation with fake clocks.
- [ ] Run
      `bun run test apps/web/src/hostedHub/state.test.ts apps/web/src/hostedHub/environment.test.ts apps/web/src/hostedHub/transport.test.ts` plus the focused component test.

**Checkpoint commit:** `fix(hub): bound hosted synchronization and retry`

## Task 4: Run affected regression suites

**Files:** No planned production changes.

- [ ] Run all hosted-client tests under `apps/web/src/hostedHub`.
- [ ] Run environment runtime, WebSocket transport/client, direct server WebSocket, relay connector,
      RPC access, orchestration stream, identity, and connector lifecycle tests.
- [ ] Run `bun run --cwd apps/web test:browser` for the hosted startup/failure/retry surface.
- [ ] Confirm direct-browser, desktop-local, SSH-assisted, and outbound connector startup paths are
      unchanged.
- [ ] Confirm no canonical relay schema or fixture file changed.

## Task 5: Run public quality gates and review

- [ ] Confirm Bun `1.3.14` and run `bun install --frozen-lockfile` only if dependency state requires
      installation; no dependency change is planned.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect` because the Effect RPC transport is covered.
- [ ] Run `bun run test`.
- [ ] Run `bun run build` because the hosted web artifact changes.
- [ ] Run `bun run --cwd apps/web test:browser` and `bun run release:smoke`.
- [ ] Review the complete branch diff for unrelated changes, secrets, private infrastructure,
      sensitive diagnostics, public/private boundary violations, and canonical contract drift.
- [ ] Confirm the only documentation additions are this public design and implementation plan.

## Task 6: Publish the public fix

- [ ] Push `fix/hosted-relay-session-readiness` to the public origin.
- [ ] Open a public PR describing the reusable hosted relay defect, snapshot readiness ordering,
      bounded failure/retry behavior, security invariants, and test evidence without referencing a
      private service or issue.
- [ ] Wait for CI and review, resolve every actionable comment, and rerun affected gates.
- [ ] Merge only after all required checks pass.
- [ ] Record the immutable public-main merge commit for separate private dependency pinning.

## Private follow-up boundary

Updating a private gitlink, rebuilding a private image, deploying a service, changing DNS or
service configuration, and running a live qualification remain outside this public plan. Each is a
separate private operation and any live service mutation still requires explicit target-specific
approval.
