# Desktop Hub Connection — Server Slices 1–3 Implementation Plan

**Goal:** Add the three owner-gated local operations the desktop Hub GUI needs, each of which also
closes a defect reachable from the `ryco hub` CLI today: an implemented-but-unrouted `resume()`, an
enrollment ceremony that becomes unrecoverable once its output scrolls away, and no way to tell an
enrolled node from a never-enrolled one.

**Architecture:** Three additions to the existing owner-gated HTTP control plane in
`apps/server/src/hubConnector/http.ts`. No new transport, no new client, no WebSocket RPC, no change
to the connector state machine, the relay adapter, or the reconnect policy. Slice 2 adds one field
to the persisted enrollment state; slice 3 adds one sibling contract schema. `HubConnectorStatus`
is not modified.

**Design spec:** `docs/superpowers/specs/2026-07-26-desktop-hub-connection-design.md`

**Scope:** Slices 1–3 only. Slice 4 (`POST /api/hub/leave`) is **hard-blocked** on Hub-side node
removal — see Hub obligation 3 in the spec — and is not in this plan. No UI work here; the desktop
and web slices (5–8) follow separately and depend on slice 3.

## Execution rules

- Work only on `design/desktop-hub-connection` (PR #243) or a branch from it.
- **Every task in this plan is `/security-review`-gated with owner sign-off before merge.** All three
  slices touch identity, credentials, or the connector control plane.
- Do not modify relay schemas, relay fixtures, node-proof transcripts, or node-identity fixtures.
- Do not add a field to `HubConnectorStatus`. It is a closed schema
  (`2026-07-16-outbound-hub-connector-design.md:510`) with a cross-field `.check()`.
- Keep origins, node/key/environment identifiers, polling secrets, key material, challenges,
  signatures, and raw peer error text out of every response, log, and error — per
  `docs/hub-connector.md:164`. This is a per-task obligation, not a cleanup pass.
- Write tests with each behavior; run focused tests after every task.
- Never run `bun test`; use `bun run test` with file filters.
- Small conventional commits at the checkpoints below. Before each commit run `git diff --check` and
  read the staged diff for sensitive material.
- Nothing here can be tested against a live Hub. Every test uses the existing fakes and fixtures.
  Do not add a test that requires network egress.

---

## Task 1: Route the existing `resume()` operation

**Why this is first:** `connector.resume()` is already implemented and already exposed on
`HubConnectorServiceShape` (`apps/server/src/hubConnector/HubConnectorLive.ts:20`, `:126`) with
**zero non-test callers**. Today the only recovery from `connection_replaced` or a transient locked
keychain is a full process restart, which in the desktop tears down every provider session,
terminal, and orchestration run to retry one outbound socket.

**Files:**

- Modify: `apps/server/src/hubConnector/http.ts`
- Modify: `apps/server/src/cli.ts` (add `ryco hub resume`)
- Modify: `apps/server/src/cli.test.ts`
- Create: `apps/server/src/hubConnector/http.test.ts`
- Modify: `docs/hub-connector.md`

- [ ] Add `hubConnectorResumeRouteLayer` as `POST /api/hub/resume`, modelled exactly on
      `hubConnectorEnrollmentCancelRouteLayer` (`http.ts:50-62`): `yield* authenticateOwner`, call
      the service, respond `HubConnectorStatus` with status 200.
- [ ] Merge it into `hubConnectorRoutesLayer` (`http.ts:64-68`). No change is needed at
      `server.ts:367` — the merged layer is already provided there.
- [ ] Return `connector.status()` after resume so the caller sees the resulting state without a
      second request.
- [ ] Add `ryco hub resume` to the `hubCommand` subcommands (`cli.ts:1216-1219`), reusing
      `runHubCommand` and `formatHubStatus` exactly as `hub cancel` does.
- [ ] Create `http.test.ts` covering all four routes: owner session succeeds; a non-owner
      authenticated session gets 403; an unauthenticated request gets the `respondToAuthError`
      status. Assert the 403 body names no origin and no identifier.
- [ ] Test that resume is idempotent — two calls in a row leave the same state and neither throws.
- [ ] Test the three early-return paths in `resume()` (`HubConnector.ts:126-127`) surface as a
      status response rather than an error: not started, `#stopping`, connector disabled, and
      `revoked`. **`revoked` returning unchanged is correct and must be asserted**, because the panel
      relies on it to keep saying "will not retry" rather than appearing to act.
- [ ] Document `ryco hub resume` in `docs/hub-connector.md` beside `status`/`enroll`/`cancel`, and
      note in the troubleshooting list that `connection_replaced` is resolved by resume rather than
      by restart.
- [ ] Run `bun run test apps/server/src/hubConnector/http.test.ts apps/server/src/cli.test.ts`.

**Commit:** `Route the Hub connector resume operation`

---

## Task 2: Persist the device code and make a pending ceremony readable

**Why:** The device code, fingerprint, and expiry exist **only** in the 201 body of
`POST /api/hub/enrollment`. `HubConnectorStatus` carries none of them and
`PendingHubEnrollmentState` persists none of them, while `enroll()` throws when
`pendingEnrollment !== null` (`HubConnector.ts:172-173`) and surfaces as
`"Hub enrollment operation failed."`. Losing the terminal output — or closing a dialog — strands a
live ceremony with no way back in and no way forward except cancel, which destroys key custody.

**This changes a deliberate one-shot display policy and must be called out explicitly at security
review.** The argument for it is that the current behaviour pushes operators toward
cancel-and-re-enroll, which is strictly worse for key custody than re-reading a code that is already
displayed on the Hub's own approval screen.

**Files:**

- Modify: `packages/contracts/src/hubConnector.ts`
- Modify: `packages/contracts/src/hubConnector.test.ts`
- Modify: `apps/server/src/hubIdentity/LocalHubIdentityState.ts`
- Modify: `apps/server/src/hubIdentity/LocalHubIdentityState.test.ts`
- Modify: `apps/server/src/hubIdentity/HubEnrollmentClient.ts`
- Modify: `apps/server/src/hubIdentity/HubEnrollmentClient.test.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.test.ts`
- Modify: `apps/server/src/hubConnector/http.ts`
- Modify: `apps/server/src/hubConnector/http.test.ts`
- Modify: `docs/hub-connector.md`, `docs/node-identity.md`

- [ ] Add `deviceCode: string` to `PendingHubEnrollmentState`
      (`LocalHubIdentityState.ts:8-16`). It is a non-bearer routing identifier, consistent with the
      "bounded non-bearer metadata" rule in `docs/node-identity.md:93-99`. **The polling secret stays
      in the protected store and is not persisted here.**
- [ ] Validate it in `parsePending` against the existing device-code pattern
      (`/^[A-Z0-9-]{4,32}$/`, matching `HubEnrollmentStartResult` in contracts). A pending record
      whose device code fails the pattern is `identity_state_corrupt`, consistent with every other
      field.
- [ ] Persist it where `HubEnrollmentClient.start` writes the pending record, from
      `StartedHubEnrollment.deviceCode` (`HubEnrollmentClient.ts:70-76`).
- [ ] Add a state-migration test: a pending record written **without** `deviceCode` (the shape that
      exists on disk today) must not hard-fail the whole identity state. Decide and encode one
      behaviour — treat the ceremony as unreadable and return `pending` with no ceremony detail,
      rather than corrupting state and stranding an enrolled node. Assert an `activeNode` alongside a
      legacy pending record still loads.
- [ ] Extend `HubEnrollmentStartResult` (`packages/contracts/src/hubConnector.ts:100-107`) with
      `label`, `platformOs`, `platformArch`, `clientVersion`, and `algorithm`, matching the field set
      the Hub approval screen renders (`apps/web/src/components/hostedHub/HostedNodeEnrollment.tsx:162-179`).
      Bound every string. All five are already computed node-side
      (`HubConnectorLive.ts:110-114`, `HubEnrollmentClient.ts:13-18`) and already sent to the Hub.
- [ ] Populate them in `HubConnector.enroll()`'s return (`HubConnector.ts:188-194`) from
      `#enrollmentMetadata` and the started key's descriptor algorithm.
- [ ] Add a `readPendingEnrollment()` to `HubIdentityRuntimeShape` (`HubIdentityRuntime.ts:63-66`)
      that returns the persisted pending record plus a **recomputed** fingerprint via
      `getPublicDescriptor(pending.keySecretName)`
      (`apps/server/src/hubIdentity/NodeSigningIdentity.ts:40`).
      **Recompute rather than persist the fingerprint** — it guarantees the displayed value matches
      the key actually on disk, so a tampered state file cannot show a fingerprint that differs from
      what will be signed with.
- [ ] Add `GET /api/hub/enrollment` returning the same bounded shape as the enrollment-start result:
      `deviceCode`, `fingerprint`, `label`, `platformOs`, `platformArch`, `clientVersion`,
      `algorithm`, `expiresAt`, `pollIntervalMs`, and current `status`. Return **404 with a bounded
      body** when no ceremony is pending. It carries no origin, no node/key/environment identifier,
      and no polling secret.
- [ ] Test: start a ceremony, read it back, assert every field matches the start response byte for
      byte — the two surfaces must never disagree, because an operator may compare using either.
- [ ] Test: the recomputed fingerprint equals the one returned at start, using the checked-in
      node-identity fixture.
- [ ] Test: after `cancelEnrollment`, the read returns 404 and the device code is gone from disk.
- [ ] Test: an expired pending ceremony is still readable (so the panel can say "expired" rather
      than "nothing here"), and its `expiresAt` is in the past.
- [ ] Add a canary test asserting no response from any `/api/hub/*` route contains the configured
      origin, a `node_`/`env_`/key identifier, or the polling secret.
- [ ] Update `docs/hub-connector.md` — the enrollment section currently implies the code is shown
      once — and `docs/node-identity.md`'s local-state field list.
- [ ] Run `bun run test packages/contracts/src/hubConnector.test.ts apps/server/src/hubIdentity apps/server/src/hubConnector`.

**Commit:** `Persist the Hub device code and expose the pending ceremony`

---

## Task 3: Expose a bounded identity-presence summary

**Why:** `state: "disabled"` is returned both when nothing was ever enrolled and when an identity
exists with the connector switched off — `start()` returns before reading identity state in both the
disabled and `configuration_invalid` branches (`HubConnector.ts:85-95`). Without a separate signal
the desktop cannot make the origin field read-only once enrolled, and the permanent
`identity_origin_mismatch` trap described in the spec stays reachable exactly as designed.

**Files:**

- Modify: `packages/contracts/src/hubConnector.ts`
- Modify: `packages/contracts/src/hubConnector.test.ts`
- Modify: `apps/server/src/hubConnector/HubConnectorLive.ts`
- Modify: `apps/server/src/hubConnector/http.ts`
- Modify: `apps/server/src/hubConnector/http.test.ts`
- Modify: `docs/hub-connector.md`

- [ ] Add a **sibling** schema, not a status field:
      `HubIdentitySummary = Schema.Struct({ enrolled: Schema.Literals(["none", "pending", "active"]) })`.
      No origin, no identifiers, no fingerprint, no timestamps.
- [ ] Add a **canary test asserting `HubConnectorStatus`'s exact field set is unchanged**, so any
      future addition to the closed status schema is a deliberate review event rather than a silent
      drift.
- [ ] Expose `identitySummary()` on `HubConnectorServiceShape`, deriving it from
      `identity.readState()`: `activeNode !== null` → `active`; else `pendingEnrollment !== null` →
      `pending`; else `none`.
- [ ] **When the identity runtime has degraded to the `unavailableIdentity` stub
      (`HubConnectorLive.ts:57-67`), every method throws.** Return `none` is wrong — it would let the
      panel offer to edit an origin for a node that may well be enrolled. Add a fourth value
      `unknown`, or fail the route with a bounded error. Choose one, encode it in the schema, and
      test it; do not let the stub silently read as "not enrolled".
- [ ] Add `GET /api/hub/identity`, owner-gated, returning `HubIdentitySummary`.
- [ ] Test all states: never enrolled; pending ceremony; active node; active node with the connector
      disabled (**the case that motivates the whole task** — status says `disabled`, summary says
      `active`); and the degraded-stub case.
- [ ] Test that the response is byte-identical regardless of which Hub the node enrolled against —
      the summary must not vary with origin.
- [ ] Document the route in `docs/hub-connector.md` and state that it is the only supported way to
      distinguish an enrolled node from a never-enrolled one.
- [ ] Run `bun run test packages/contracts/src/hubConnector.test.ts apps/server/src/hubConnector`.

**Commit:** `Expose a bounded Hub identity presence summary`

---

## Final checks

- [ ] `bun fmt && bun run fmt:check && bun lint && bun typecheck && bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] Re-read every added response shape against the deny-list at `docs/hub-connector.md:164`.
- [ ] Confirm no change was made to `HubConnectorStatus`, the relay schemas, or the fixtures.
- [ ] `/security-review` with owner sign-off, explicitly flagging: the device-code persistence policy
      change (task 2) and the new identity-presence disclosure (task 3).

## What these slices deliberately do not do

- No UI. The desktop and web slices depend on task 3 and follow separately.
- No `POST /api/hub/leave`. Hard-blocked on Hub-side node removal; shipping it first would make
  leaving a one-way door per machine, per Hub.
- No loopback restriction on the routes. Withdrawn in the spec — a relayed operator already reaches
  these operations through `terminalOpen` and the CLI, so the guard would close nothing while
  breaking administration of a headless node from a paired laptop.
- No change to reconnect policy, backoff, or the state machine's transitions.

## Unverifiable without a deployed Hub

Every task here is tested against fakes and the checked-in node-identity fixtures. Not covered, and
not claimable at review: a real approval, denial, or expiry; `revoked` or
`identity_origin_mismatch` as lived states; and whether the recomputed fingerprint matches what a
real Hub displays. Those await a deployed Hub and a real enrolled node.
