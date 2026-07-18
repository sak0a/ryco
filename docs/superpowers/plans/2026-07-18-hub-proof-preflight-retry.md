# Hub Proof-Preflight Retry Implementation Plan

**Goal:** Keep genuine node identity rejection terminal while allowing the outbound Hub connector
to recover automatically from deployment-time proof-preflight unavailability.

**Architecture:** Extend the existing bounded HTTP helper with a non-sensitive failure phase,
classify node-challenge HTTP outcomes in the node-proof client, preserve the stable reason through
`HubIdentityRuntime`, and translate it into the connector's existing failure state machine. The
relay protocol, proof transcript, protected-key custody, and WebSocket authentication path remain
unchanged.

**Design spec:**
`docs/superpowers/specs/2026-07-18-hub-proof-preflight-retry-design.md`

## Execution rules

- Work only on `fix/hub-proof-preflight-retry` in the public repository.
- Add regressions before changing production classification.
- Do not add a private hostname, service identifier, issue reference, captured response, credential,
  challenge, signature, key, payload, or filesystem path.
- Do not change relay schemas, fixtures, proof transcripts, authentication policy, role policy,
  ticket behavior, queue limits, or reconnect timing.
- Never run `bun test`; use `bun run test` or the package-level test commands.
- Preserve the exact credential-free, no-store, no-redirect proof-preflight request policy.
- Before each commit, run `git diff --check` and inspect the complete staged diff.

## Task 1: Add bounded HTTP failure-phase coverage

**Files:**

- Modify: `apps/server/src/hubIdentity/BoundedHttp.ts`
- Create or modify: `apps/server/src/hubIdentity/BoundedHttp.test.ts`

- [ ] Define a bounded internal failure descriptor that distinguishes transport interruption from an
      invalid completed response and optionally carries only the numeric HTTP status.
- [ ] Add tests for fetch rejection, timeout/abort, body-read rejection, invalid content length,
      oversized body, missing body, malformed JSON, and a successful bounded response.
- [ ] Prove existing callers may continue collapsing the descriptor without behavior changes.

## Task 2: Add red node-proof classification regressions

**Files:**

- Modify: `apps/server/src/hubIdentity/HubNodeProofClient.test.ts`
- Modify: `apps/server/src/hubConnector/RelayConnectionSession.test.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.test.ts`

- [ ] Add exact mappings for transport failure, 429, 503, other 5xx, explicit 4xx rejection, and a
      malformed successful challenge.
- [ ] Assert errors contain only the stable generic message and bounded internal reason.
- [ ] Assert a preserved transient proof reason reaches `RelayConnectionSession` without opening a
      WebSocket and enters automatic connector backoff.
- [ ] Assert a subsequent retry requests a fresh proof and reaches `online` with one generation and
      one reconnect timer.
- [ ] Keep explicit relay `authentication_failed`, local state/key failure, and signing failure
      terminal.
- [ ] Run the focused tests and confirm the new transient cases fail on current production code.

## Task 3: Implement bounded proof-preflight classification

**Files:**

- Modify: `apps/server/src/hubIdentity/BoundedHttp.ts`
- Modify: `apps/server/src/hubIdentity/HubNodeProofClient.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.ts`
- Modify: `apps/server/src/hubConnector/RelayConnectionSession.ts`

- [ ] Pass a transport-versus-invalid-response descriptor to the existing bounded HTTP failure
      callback without retaining response bodies or causes.
- [ ] Classify node-challenge outcomes exactly as specified: transport/other 5xx to `network`, 503
      to `server_draining`, 429 to `rate_limited`, other 4xx to `authentication_failed`, and invalid
      success to `protocol_invalid`.
- [ ] Map local state, key selection, and signing failures to `identity_unavailable`.
- [ ] Preserve recognized proof reasons through `HubIdentityRuntime` using a bounded exported error
      type owned by the connector runtime boundary.
- [ ] Translate the reason to the existing `ConnectorFailureKind`; retain terminal fallback for an
      unknown identity implementation error.
- [ ] Do not accept or parse remote retry metadata.

## Task 4: Verify focused behavior and compatibility

- [ ] Run the bounded HTTP, node-proof, relay-session, connector-state, and connector lifecycle
      suites.
- [ ] Run all server Hub identity and Hub connector tests.
- [ ] Confirm a transient retry creates a fresh challenge/signature rather than reusing proof bytes.
- [ ] Confirm no canonical relay schema or fixture file changed.
- [ ] Confirm no private or sensitive material appears in tests, source, errors, or diagnostics.

## Task 5: Run public quality gates

- [ ] Confirm Bun `1.3.14`.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect` because the server runtime boundary is touched.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run --cwd apps/web test:browser`.
- [ ] Run `bun run release:smoke`.

## Task 6: Review and publish

- [ ] Run `git diff --check` and inspect the complete branch diff against `origin/main`.
- [ ] Confirm the diff contains only the design, plan, bounded failure classification, and tests.
- [ ] Confirm canonical relay schemas and fixtures are unchanged.
- [ ] Commit with clear conventional messages and push the real public branch.
- [ ] Open a public PR describing the reusable connector defect without private deployment details.
- [ ] Wait for CI and review, address every actionable comment, and rerun affected gates.
- [ ] Merge only after the required checks pass and record the immutable public-main commit.

## Private follow-up boundary

Updating a private gitlink, rebuilding or deploying a private image, changing a live service,
creating or restoring volumes, and copying encrypted backups remain separate private operations.
They require their own repository changes and target-specific live-mutation approval.
