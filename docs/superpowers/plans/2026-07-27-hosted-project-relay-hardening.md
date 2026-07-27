# Hosted Project and Relay Hardening Implementation Plan

**Goal:** Make hosted project browsing, creation, and clone destinations recover from transient
environment-API gaps, while making relay chunking safe across independently upgraded endpoints and
fully bounded by negotiated memory limits.

**Architecture:** The web browse hook will observe environment-connection replacement and treat a
missing API as retryable unavailable state. Relay endpoints will advertise chunk support with a
legacy-JSON-compatible whitespace prelude, gate chunk emission on peer support, and use one shared
lazy assembler whose retained bytes participate in flow control.

**Design spec:**
`docs/superpowers/specs/2026-07-27-hosted-project-relay-hardening-design.md`

## Execution rules

- Work only on `agent/hosted-project-relay-hardening` in the public `ryco` repository.
- Do not change relay intermediaries, deployment state, or vendored bundles.
- Add regression tests before each production behavior change and confirm they fail for the
  expected reason.
- Address both unresolved PR #251 review threads: peer capability negotiation and client
  assembler-byte accounting.
- Never run `bun test`; use `bun run test` or package-level Vitest commands.
- Do not change relay protocol 1.2 schemas, Hub frame handling, authentication, authorization,
  ticket, role, grant, snapshot-readiness, or request-replay behavior.
- Do not log filesystem contents, RPC payloads, tickets, credentials, private identifiers, or
  provider exception bodies.
- Before every commit, run `git diff --check` and inspect the complete staged diff.

## Task 1: Add shared relay codec regressions

**Files:**

- Modify: `packages/shared/src/relayMessageChunks.test.ts`

- [ ] Prove the exact capability prelude is accepted as leading whitespace by the Effect JSON RPC
      decoder.
- [ ] Prove a new receiver detects and strips the prelude while returning the original JSON bytes.
- [ ] Prove unadvertised legacy payloads remain byte-identical.
- [ ] Prove unsupported chunk flag bits are rejected as `bad_header`.
- [ ] Prove a nine-byte first chunk can declare 4 MiB while retaining only its one-byte body.
- [ ] Prove reset zeroes and releases every retained partial chunk.
- [ ] Retain the existing UTF-8 split-mid-codepoint round trip.
- [ ] Run the focused shared test and confirm the new cases fail on the current eager assembler and
      absent capability codec.

## Task 2: Implement the shared negotiated message codec

**Files:**

- Modify: `packages/shared/src/relayMessageChunks.ts`
- Modify only if required for exports: `packages/shared/package.json`

- [ ] Define the fixed eight-byte JSON-whitespace capability prelude.
- [ ] Add detection and stripping helpers without weakening legacy payload pass-through.
- [ ] Add shared outbound preparation that advertises fitting unchunked messages, gates chunking
      on observed peer support, and returns a stable unsupported/oversized result.
- [ ] Make `RelayMessageAssembler` record peer support from the prelude or a valid chunk.
- [ ] Replace eager total-buffer allocation with owned retained body chunks.
- [ ] Allocate and concatenate only after a valid final chunk exactly matches the declared total.
- [ ] Reject unknown flags, nonzero reserved bytes, total mismatch, overflow, truncation, and
      interleaved legacy payloads.
- [ ] Keep `heldBytes` equal to actual retained body bytes and zero retained bytes on reset/error.
- [ ] Run the focused shared suite until all existing and new cases pass.

## Task 3: Add browser relay regressions

**Files:**

- Modify: `packages/client-runtime/src/relay/relayEngine.test.ts`

- [ ] Add a mixed-version test proving an oversized send before server advertisement closes with
      `transfer_limit` and emits no chunk frame.
- [ ] Prove fitting outbound messages carry the legacy-compatible advertisement.
- [ ] Prove receiving an advertised response enables a later multi-frame outbound request.
- [ ] Reproduce the prior 3,000-byte message against a 2,048-byte inbound queue with one microtask
      between frames; require bounded failure or flow pause before delivery.
- [ ] Prove assembler-held bytes control high-water pause and low-water resume.
- [ ] Prove closing during a partial message releases assembler state.
- [ ] Run the focused client-runtime relay test and confirm the accounting and negotiation cases
      fail on current behavior.

## Task 4: Implement browser relay negotiation and accounting

**Files:**

- Modify: `packages/client-runtime/src/relay/relayEngine.ts`

- [ ] Prepare every outbound payload through the shared negotiated codec.
- [ ] Derive the effective logical-message ceiling from the fixed 4 MiB ceiling and negotiated
      queue/control limits.
- [ ] Fail unsupported or oversized chunk attempts with `transfer_limit` before enqueueing bytes.
- [ ] Include assembler-held bytes in inbound capacity, pause, and resume calculations.
- [ ] Preserve sequence, queue reservation, control lane, socket backpressure, and close-reason
      behavior.
- [ ] Reset the assembler in `#finish`.
- [ ] Run the focused client-runtime relay suite until all cases pass.

## Task 5: Add and implement node-side negotiation

**Files:**

- Modify: `apps/server/src/ws/RpcByteSession.ts`
- Modify: `apps/server/src/hubConnector/RelayChannelRegistry.ts`
- Modify: `apps/server/src/hubConnector/RelayChannelRegistry.test.ts`
- Modify as needed: `apps/server/src/hubConnector/RelayRpcIntegration.test.ts`

- [ ] Add tests proving the node advertises on fitting responses.
- [ ] Add an old-client mode and prove a large response closes with `transfer_limit` without
      emitting chunk payloads.
- [ ] Add a new-client mode whose advertised request enables a large chunked response.
- [ ] Expose channel-local peer chunk support from `RpcByteSession`.
- [ ] Prepare node responses through the same shared negotiated codec as the browser.
- [ ] Apply the negotiated effective logical-message ceiling before queue insertion.
- [ ] Preserve aggregate queued-byte checks, pause grace, channel sequence, and FIFO ordering.
- [ ] Extend the RPC integration test so a response above 256 KiB is reassembled and decoded as one
      message.
- [ ] Run focused server byte-session, registry, and integration suites until they pass.

## Task 6: Add filesystem-browse readiness regressions

**Files:**

- Modify: `apps/web/src/rpc/projectAtoms.test.ts` if present, otherwise add the closest focused
  state test beside `projectAtoms.ts`.
- Modify: `apps/web/src/components/ChatView.browser.tsx`

- [ ] Prove a missing environment API publishes unavailable state without setting fresh cached
      data.
- [ ] Register or replace the target connection and prove the active browse automatically retries.
- [ ] Prove a superseded missing/failing request cannot overwrite a later successful result.
- [ ] Prove a server browse error retains prior successful data.
- [ ] Add a browser regression that opens Local folder while unavailable, shows a bounded status,
      reconnects the environment, and then renders returned directories without reopening the
      picker.
- [ ] Run focused state and browser tests and confirm they fail on current caching behavior.

## Task 7: Implement connection-aware browsing and action errors

**Files:**

- Modify: `apps/web/src/rpc/useProject.ts`
- Modify: `apps/web/src/rpc/projectAtoms.ts`
- Modify: `apps/web/src/components/CommandPaletteDialog.tsx`
- Modify only if a shared hook is warranted:
  `apps/web/src/environments/runtime/index.ts`

- [ ] Subscribe the browse hook to the existing environment-connection supervisor.
- [ ] Refetch active browse scopes when the target connection appears or is replaced.
- [ ] Keep missing-API state retryable and bounded instead of committing an empty success.
- [ ] Render an unavailable/browse-error status row without disabling manual path input.
- [ ] Replace the silent add-project API return with the existing visible error toast.
- [ ] Refactor the internal add operation to accept an explicit environment and API.
- [ ] Pass the successful clone API into clone-to-add project registration.
- [ ] Preserve path normalization, duplicate-project navigation, project creation, and new-thread
      behavior.
- [ ] Run focused web unit and browser suites until all new and existing cases pass.

## Task 8: Verify integration and compatibility boundaries

- [ ] Run all shared relay codec tests.
- [ ] Run all client-runtime relay tests.
- [ ] Run all server relay, byte-session, and hosted-session integration tests.
- [ ] Run all project atom, command palette logic, and filesystem workspace tests.
- [ ] Run focused command-palette browser tests.
- [ ] Confirm the old/new compatibility matrix from the design spec.
- [ ] Confirm no relay protocol schema or fixture changed.
- [ ] Confirm the branch contains no relay-intermediary or deployment changes.
- [ ] Scan diffs and output for sensitive or private identifiers.

## Task 9: Run the repository backstop

- [ ] Confirm Bun 1.3.14 remains active.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run build --filter=@ryco/web`.
- [ ] Run `bun run --cwd apps/web test:browser`.

## Task 10: Review and publish

- [ ] Run `git diff --check` and inspect the complete branch diff against `origin/main`.
- [ ] Confirm the branch contains only the approved design, this plan, public implementation, and
      focused tests.
- [ ] Commit with a focused conventional message.
- [ ] Push the updated branch to draft PR #253.
- [ ] Update the draft PR body with final behavior and exact validation.
- [ ] Do not reply to or resolve PR #251 review threads unless the user separately requests that
      GitHub write.

## Deployment follow-up boundary

Vendor updates, relay-intermediary policy changes, deployment, and live qualification remain
separate operations outside this implementation plan.
