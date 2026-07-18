# WebSocket URL-Provider Retry Implementation Plan

**Goal:** Allow an existing browser transport to recover when its asynchronous WebSocket URL
provider fails transiently during reconnect, without weakening hosted terminal-state or ticket
security.

**Architecture:** Reuse the existing transport reconnect schedule for async URL resolution before
the Effect socket layer's required infallible boundary. Every retry invokes the provider again.
Hosted mode therefore requests fresh one-use attempt material while its existing state machine and
`shouldReconnect` predicate remain authoritative.

**Design spec:**
`docs/superpowers/specs/2026-07-19-websocket-url-provider-retry-design.md`

## Execution rules

- Work only on `fix/ws-url-provider-retry` in the public repository.
- Add regression tests before production changes and confirm they fail for the expected reason.
- Never run `bun test`; use `bun run test` or the package-level test command.
- Do not change relay schemas, compatibility fixtures, ticket policy, authentication, CSRF, Origin,
  RP-ID, cookies, roles, queue limits, or request replay behavior.
- Do not expose provider exceptions, tickets, response bodies, URLs containing credentials, private
  infrastructure, or issue references in source, tests, commits, or the PR.
- Do not patch Effect, add unsafe casts, or add a hosted-only retry loop.
- Before every commit, run `git diff --check` and inspect the full staged diff.

## Task 1: Add red shared-transport regressions

**Files:**

- Modify: `apps/web/src/rpc/wsTransport.test.ts`

- [ ] Add a deterministic async provider that rejects once, then resolves a valid URL.
- [ ] Configure zero test delay and prove the provider is invoked twice while only one WebSocket is
      constructed.
- [ ] Open the first socket, close it, reject the next provider invocation, and prove a later fresh
      provider result constructs and opens the replacement socket.
- [ ] Prove a fixed lifecycle error is emitted without reflecting a sensitive exception canary.
- [ ] Prove `shouldReconnect()` becoming false stops another provider invocation.
- [ ] Prove disposing during a non-zero retry delay cancels the pending retry.
- [ ] Run the focused test file and confirm the recovery cases fail because the current provider
      error becomes a defect before retry.

## Task 2: Implement generic async-provider retry

**Files:**

- Modify: `apps/web/src/rpc/protocol.ts`

- [ ] Construct the canonical retry schedule before the dynamic URL Effect.
- [ ] Replace arbitrary provider-error reflection with one fixed bounded message.
- [ ] Apply the schedule to provider resolution and URL normalization before `Effect.orDie`.
- [ ] Continue applying the same immutable schedule description to the RPC socket loop.
- [ ] Preserve synchronous static URL normalization exactly.
- [ ] Check the composed session activity guard before each provider invocation and stop the retry
      schedule when the transport session is inactive.
- [ ] Preserve all lifecycle composition, socket construction, close handling, request hooks, and
      retry-transient-error behavior.

## Task 3: Add hosted integration coverage

**Files:**

- Modify: `apps/web/src/hostedHub/transport.test.ts`
- Modify: `apps/web/src/hostedHub/transport.ts`

- [ ] Drive `HostedRelayAttemptFactory.nextUrl()` through a transient ticket-preflight failure and
      then success under the shared transport retry path.
- [ ] Record the selected connection generation when ticket acquisition starts so retryable
      pre-socket failures remain eligible for the existing hosted reconnect predicate.
- [ ] Assert a fresh ticket request occurs and exactly one relay socket is constructed.
- [ ] Drive a terminal ticket failure and prove the schedule stops without constructing a socket.
- [ ] Preserve existing ticket-consumed-once and delivery-unknown assertions.
- [ ] Avoid adding production hosted state solely for tests.

## Task 4: Verify focused behavior and boundaries

- [ ] Run focused WebSocket transport and hosted transport suites.
- [ ] Run all web RPC and hosted Hub unit tests.
- [ ] Confirm provider retries use configured delay/cancellation and do not spin.
- [ ] Confirm terminal hosted state remains terminal and no ticket or request is replayed.
- [ ] Scan diffs and test output for sensitive canaries and private identifiers.
- [ ] Confirm canonical relay schemas and compatibility fixtures have no diff.

## Task 5: Run public quality gates

- [ ] Confirm the repository-pinned Bun version is active.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect` because Effect transport code changes.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run --cwd apps/web test:browser`.
- [ ] Run `bun run release:smoke`.

## Task 6: Review and publish

- [ ] Run `git diff --check` and inspect the full branch diff against `origin/main`.
- [ ] Confirm the branch contains only the approved design, plan, generic transport repair, and
      focused tests.
- [ ] Commit implementation with a focused conventional message.
- [ ] Push the real public branch and open a public PR describing only the reusable defect.
- [ ] Wait for CI and review; address actionable feedback and rerun affected gates.
- [ ] Merge only after required checks pass and record the immutable public-main commit.

## Private follow-up boundary

Updating the private Hub gitlink, rebuilding or deploying a private image, mutating Coolify or VPS
state, and repeating live drain/reconnect qualification remain separate private operations. Before
any live mutation, present the exact target, operations, data impact, downtime, and rollback and wait
for explicit approval.
