# Automatic account-enrolled native E2EE implementation plan

**Goal:** Make one Hub login sufficient for a compatible native Desktop or mobile installation to
enroll its public device identity, discover every authorized online node, and connect with native Noise
IK without QR codes or manual approval, while preserving stronger locally verified trust and the weaker
Web NX tier.

**Architecture:** Add a short-lived, Ed25519-signed `HubDeviceGrant` to native relay-ticket responses.
Register a second native IK suite for account-grant authorization so the current locally approved IK
suite and its vectors remain byte-for-byte compatible. The grant binds the Hub, account, device key pair,
client prekey certificate, node capability statement, relay ticket, authority, epochs, and expiry. Nodes
verify it into an in-memory channel lease and never write it to the durable approved-client store.
`packages/client-runtime` coordinates idempotent enrollment and trust selection; Desktop and mobile keep
key custody in their platform adapters.

**Design:** `docs/superpowers/specs/2026-09-04-automatic-account-native-e2ee-design.md`

## Delivery topology

This is a high-risk cross-runtime change delivered through six ordered checkpoints:

1. **Normative protocol and schemas.** Freeze the new suite, grant bytes, bounds, and relay-control
   vocabulary before an endpoint accepts them.
2. **Shared cryptography.** Land canonical grant verification and deterministic vectors with no runtime
   admission enabled.
3. **Node and Hub plumbing.** Publish node statements, distribute Hub verifier keys, validate grants in
   shadow mode, and implement the private Hub counterpart behind dark capabilities.
4. **Shared native runtime.** Add strict Hub methods, enrollment reconciliation, trust resolution, and
   ticket/grant lifecycle ownership.
5. **Platform adoption and UX.** Enable mobile and Desktop automatic native E2EE, preserve optional
   independent verification, and keep Web isolated from native grants.
6. **Qualification and rollout.** Complete browser vectors, adversarial and cross-version testing,
   hardware qualification, independent audit, performance comparison, and staged enablement.

The public protocol commit must merge before the private Hub counterpart copies no schema and instead
consumes the released public contracts and fixtures. Native default enablement must not merge before a
compatible Hub and node capability are available. Private Hub implementation, deployment identifiers,
and operational evidence remain outside this repository.

## Cross-cutting rules

- Add a failing focused test before each behavior change and keep every task independently committable.
- Use Bun 1.4.0 and `bun install --frozen-lockfile`. Never run `bun test`; use `bun run test` or focused
  package scripts.
- Keep `packages/contracts` schema-only, `packages/shared` free of Hub/network orchestration, and
  `packages/client-runtime` free of DOM, Electron, React Native, Expo, and Node imports.
- Preserve the existing suite `0x01`, locally approved IK handshake, Web NX handshake, fixtures, and
  direct-node behavior byte-for-byte unless a separately reviewed security correction requires a
  change.
- Implement account grants as suite `0x02`, native IK only. Web must reject or ignore it during suite
  selection and must never parse a grant as authorization.
- A locally verified pin and matching local authorization always choose suite `0x01`. Suite `0x02`
  never overwrites a verified pin, creates an approved-client record, or reports **Verified locally**.
- Account grants are accepted only on a Hub relay channel carrying the exact ticket ID and grant digest.
  Direct transports never accept them.
- No native plaintext fallback is introduced. Unsupported automatic E2EE reports **Update required** or
  offers the existing secure manual recovery path.
- Grant, ticket, DPoP, key, safety-number, account, and node material must not enter logs, telemetry,
  URLs, browser storage, service-worker caches, crash reports, or committed qualification artifacts.
- Before every commit, run focused checks, `git diff --check`, inspect the staged diff, and scan for
  secrets, private Hub data, generated drift, and unrelated files.

## Wave 1: Normative protocol and shared contracts

### Task 1: Amend the normative E2EE and Hub-connector protocols

**Files:**

- Modify: `docs/relay-e2ee-protocol.md`
- Modify: `docs/hub-connector.md`
- Modify: `docs/hosted-hub-client.md`
- Modify: `docs/relay-e2ee-web-browser-vectors.md`

**Work:**

1. Register suite `0x02` as native-only
   `Noise_IK_25519_ChaChaPoly_SHA256 + HubDeviceGrant`. Keep suite `0x01` unchanged for locally
   approved native IK and Web NX.
2. Specify exact fixed-position canonical-CBOR arrays for grant claims and signed envelopes, Ed25519
   signature domain `ryco.hub-device-grant.v1`, derived fingerprints, exact certificate/statement
   digests, and strict re-encode equality.
3. Set the grant envelope maximum to 2,048 bytes and validity to the earliest of ticket expiry,
   issuance plus two minutes, client prekey expiry, or node statement/prekey expiry.
4. Add exact identifier, collection, string, key, nonce, timestamp, clock-skew, role, and capability
   bounds. Unknown values and excess elements fail closed.
5. Define how suite `0x02` extends the native IK payload and authorization context while suite `0x01`
   keeps its existing encodings. Bind the suite, grant digest, ticket ID, node statement digest, client
   certificate digest, epochs, and authority into the authenticated context/prologue.
6. Add worst-case wire arithmetic proving the complete suite-`0x02` client hello fits
   `E2EE_CLIENT_HELLO_MAX_BYTES`. Do not raise or fragment the hello merely to fit the grant.
7. Specify relay protocol minor 3 control-plane additions: node statement publication and acknowledgement,
   Hub verifier-key rotation, grant revocation, and account-grant ticket context on `channel.open`.
8. Define the four policy modes and their migration from the current two booleans. The current strongest
   `requireApprovedClientE2EE` meaning maps to **Require locally approved native E2EE**.
9. Add the trust-source vocabulary, revocation behavior, error rows, rate limits, key rotation, staged
   prekey retention, no-application-data handshake rule, and no-legacy-fallback rule.
10. Mark Web as NX-only and document that account-grant routes, suite `0x02`, and grant bytes are never a
    browser authorization mechanism.

**Review gate:** Obtain a protocol/security review of the amendment before Task 6 enables node shadow
validation. Record only public review conclusions.

**Commit:** `docs(e2ee): specify account-enrolled native suite`

### Task 2: Add schema-only account-enrollment and relay-minor-3 contracts

**Files:**

- Add: `packages/contracts/src/nativeE2ee.ts`
- Add: `packages/contracts/src/nativeE2ee.test.ts`
- Modify: `packages/contracts/src/hostedIdentity.ts`
- Modify: `packages/contracts/src/hostedIdentity.test.ts`
- Modify: `packages/contracts/src/relay.ts`
- Modify: `packages/contracts/src/relay.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

**Work:**

1. Add branded, bounded schemas for enrollment IDs/revisions, account and device auth epochs, P-256 and
   X25519 public material, client-prekey certificate carriers/digests, grant IDs/digests, Hub signing-key
   IDs, and base64url grant envelopes.
2. Add strict schemas and path constants for:
   - native current-device enrollment upsert;
   - list, rename, and revoke account E2EE devices;
   - Hub grant-verification keyset reads; and
   - native account-grant relay-ticket requests/responses.
3. Keep the existing relay-ticket response unchanged for browser/local flows. Define a distinct native
   response requiring `ticketId`, `deviceGrant`, `deviceGrantDigest`, expiry, and negotiated protocol
   minor 3.
4. Add bounded public account-device metadata with `reportedKeyBacking`; do not model it as attested
   authority.
5. Add relay minor 3 frames for node capability-statement publication/acknowledgement, keyset updates,
   enrollment revocation, and account-grant `channel.open` context.
6. Make minor-version guards reject partial ticket context, grant fields on older minors, suite `0x02`
   without minor 3, duplicate key IDs, inconsistent timestamps, and excess fields.
7. Export only schemas and types. Do not add signature verification, HTTP calls, or lifecycle logic.

**Focused verification:**

```sh
bun run --cwd packages/contracts test -- src/nativeE2ee.test.ts src/hostedIdentity.test.ts src/relay.test.ts
bun run typecheck --filter=@ryco/contracts
git diff --check
```

**Commit:** `feat(contracts): add account-enrolled e2ee protocol`

### Task 3: Implement canonical Hub-device-grant verification and fixtures

**Files:**

- Add: `packages/shared/src/relayE2eeHubDeviceGrant.ts`
- Add: `packages/shared/src/relayE2eeHubDeviceGrant.test.ts`
- Modify: `packages/shared/src/relayE2eeConstants.ts`
- Modify: `packages/shared/src/relayE2eeConstants.test.ts`
- Modify as required: canonical CBOR helpers currently used by `relayE2eeTranscripts.ts`
- Modify: `packages/shared/package.json`
- Modify: `scripts/generate-e2ee-fixtures.ts`
- Add: `packages/shared/fixtures/e2ee/v1/f19-account-device-grant.json`
- Modify: `packages/shared/fixtures/e2ee/v1/manifest.json`
- Modify: `packages/shared/src/relayE2eeCorpus.test.ts`
- Modify: `packages/shared/src/relayE2eeCorpusLiveness.ts`

**Work:**

1. Add a single canonical encoder/strict decoder for the fixed claim array and signed envelope. Reuse or
   extract the existing canonical-CBOR primitives instead of adding a second implementation.
2. Build the fixed-size domain-separated digest and verify Ed25519 signatures against an explicit,
   immutable Hub keyset selected by `keyId`.
3. Validate every semantic binding supplied by the caller: Hub origin, account and device epochs,
   enrollment/revision, device identity and agreement keys, client certificate digest, node identity
   and agreement keys, continuity ID, policy generation, statement digest, ticket ID, role,
   capabilities, and time.
4. Recompute every fingerprint from the carried algorithm-labelled public key. Compare fingerprints,
   digests, nonces, and key material without data-dependent early success.
5. Enforce the 2,048-byte bound before CBOR parsing or signature work. Apply field and collection bounds
   before expensive verification.
6. Return a closed success/failure union with stable secret-free reason codes. Never include claims,
   identifiers, keys, signatures, or input bytes in an error.
7. Generate F19 valid, boundary, non-canonical, malformed, wrong-binding, expired/future, unknown-key,
   duplicate-key, role/capability escalation, and replay vectors using test-only keys.
8. Make corpus liveness prove every expected F19 leaf is consumed by a test.

**Focused verification:**

```sh
bun run generate:e2ee-fixtures
bun run --cwd packages/shared test -- \
  src/relayE2eeHubDeviceGrant.test.ts \
  src/relayE2eeConstants.test.ts \
  src/relayE2eeCorpus.test.ts
bun run typecheck --filter=@ryco/shared
git diff --check
```

**Commit:** `feat(shared): verify hub device grants`

### Task 4: Add the account-grant IK suite without changing suite `0x01`

**Files:**

- Modify: `packages/shared/src/relayE2eeWire.ts`
- Modify: `packages/shared/src/relayE2eeWire.test.ts`
- Modify: `packages/shared/src/relayE2eeTranscripts.ts`
- Modify: `packages/shared/src/relayE2eeTranscripts.test.ts`
- Modify: `packages/shared/src/relayE2eeHandshake.ts`
- Modify: `packages/shared/src/relayE2eeHandshake.test.ts`
- Modify: `packages/shared/src/relayE2eeAttackerRelay.test.ts`
- Modify: `packages/shared/src/relayE2eeNoiseProperties.test.ts`
- Modify: `packages/shared/test/independent-e2ee/reference.ts`
- Modify as required: `packages/shared/test/independent-e2ee/snow/*`
- Modify: `scripts/generate-e2ee-fixtures.ts`
- Modify: `packages/shared/fixtures/e2ee/v1/f19-account-device-grant.json`

**Work:**

1. Register suite `0x02` with the same Noise primitives as `0x01`, but only for native IK and only with
   an account-grant payload. Teach suite selection to filter by tier and trust source before preference.
2. Represent native credentials as a discriminated union: locally approved suite `0x01` or account grant
   suite `0x02`. Keep Web credentials unable to represent suite `0x02`.
3. Preserve the existing seven-element client-hello wrapper. Add a suite-`0x02` IK payload containing
   the exact grant envelope and exact client-prekey certificate; keep the suite-`0x01` payload unchanged.
4. Use a separately domain-separated authorization context for suite `0x02` containing the grant digest,
   ticket ID, statement/certificate digests, epochs, and effective authority. The suite ID already
   separates the Noise prologue.
5. Add a node callback that verifies account authorization against node-owned ticket/keyset state. The
   pure handshake does not fetch Hub state or write authorization records.
6. Carry the established trust source and bounded enrollment handle to the node channel owner so it can
   register revocation, diagnostics, and UI state without exposing the grant.
7. Reject suite confusion, a grant in suite `0x01`, no grant in suite `0x02`, NX with suite `0x02`,
   certificate/grant disagreement, statement substitution, altered ticket context, downgrade, replay,
   and post-verification authority changes.
8. Extend F19 with a deterministic full account-grant IK trace and verify its Noise bytes and derived
   secrets through the independent Snow/reference harness.
9. Assert every pre-existing fixture and suite-`0x01` golden byte remains unchanged.

**Focused verification:**

```sh
bun run generate:e2ee-fixtures
bun run --cwd packages/shared test -- \
  src/relayE2eeWire.test.ts \
  src/relayE2eeTranscripts.test.ts \
  src/relayE2eeHandshake.test.ts \
  src/relayE2eeAttackerRelay.test.ts \
  src/relayE2eeNoiseProperties.test.ts \
  test/independent-e2ee/reference.test.ts
bun run typecheck --filter=@ryco/shared
git diff --check
```

**Commit:** `feat(shared): add account-grant noise ik suite`

## Wave 2: Node and Hub authorization plumbing

### Task 5: Publish node E2EE state and consume Hub verifier keys

**Files:**

- Modify: `apps/server/src/hubConnector/HubConnector.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.test.ts`
- Modify: `apps/server/src/hubConnector/HubConnectorState.ts`
- Modify: `apps/server/src/hubConnector/HubConnectorState.test.ts`
- Modify: `apps/server/src/hubConnector/HubConnectorLive.ts`
- Modify: `apps/server/src/hubConnector/RelayConnectionSession.ts`
- Modify: `apps/server/src/hubConnector/RelayConnectionSession.test.ts`
- Modify: `apps/server/src/hubConnector/RelayChannelRegistry.ts`
- Modify: `apps/server/src/hubConnector/RelayChannelRegistry.test.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.test.ts`
- Modify as required: `apps/server/src/hubIdentity/NodeE2eeCapabilityStatement.ts`

**Work:**

1. Negotiate relay minor 3 only when both sides advertise it. Keep minor 2 behavior unchanged.
2. After `ready`, publish the exact current node capability statement and its canonical digest. Republish
   after identity, prekey, continuity, suite, or policy changes and after every reconnect.
3. Accept an acknowledgement only for the current connector generation and exact digest. Do not permit
   account-grant admission until the Hub has acknowledged that statement.
4. Maintain an in-memory, generation-numbered Hub Ed25519 verification keyset received on the authenticated
   connector. Validate uniqueness, overlap windows, bounds, and origin before replacing the old set.
5. Extend account-grant `channel.open` context with the exact public ticket ID and grant digest. Require
   both for minor 3 account-grant channels and neither for older/local/Web channels.
6. Route enrollment-revocation events to the node E2EE session owner. Ignore stale epochs but never ignore
   a newer valid revocation generation.
7. Retain the exact advertised statement and matching prekey for open ticket/grant overlap using the
   existing outgoing-prekey discipline. If it is unavailable, reject the channel before handshake.
8. Clear statement acknowledgement, keyset, ticket context, and revocation subscriptions on connector
   generation change. Stale generations cannot publish readiness.

**Focused verification:**

```sh
bun run --cwd apps/server test -- \
  src/hubConnector/HubConnector.test.ts \
  src/hubConnector/HubConnectorState.test.ts \
  src/hubConnector/RelayConnectionSession.test.ts \
  src/hubConnector/RelayChannelRegistry.test.ts \
  src/hubConnector/HubIdentityRuntime.test.ts
bun run typecheck --filter=ryco-cli
git diff --check
```

**Commit:** `feat(server): publish account-grant e2ee state`

### Task 6: Verify grants into ephemeral node admission

**Files:**

- Add: `apps/server/src/hubConnector/NodeAccountGrantVerifier.ts`
- Add: `apps/server/src/hubConnector/NodeAccountGrantVerifier.test.ts`
- Modify: `apps/server/src/hubConnector/NodeE2eeChannelSession.ts`
- Modify: `apps/server/src/hubConnector/NodeE2eeChannelSession.test.ts`
- Modify: `apps/server/src/hubConnector/NodeE2eeSessionDirectory.ts`
- Modify: `apps/server/src/hubConnector/e2eeOperatorContract.ts`
- Modify: `apps/server/src/hubConnector/relayE2eeInteropMatrix.test.ts`
- Modify: `apps/server/src/hubConnector/HostedRelaySessionIntegration.test.ts`
- Modify: `apps/server/src/hubIdentity/NodeE2eePolicyStore.ts`
- Modify: `apps/server/src/hubIdentity/NodeE2eePolicyStore.test.ts`
- Modify: `apps/server/src/hubIdentity/NodeE2eePolicyClient.ts`
- Modify: `apps/server/src/hubIdentity/NodeE2eePolicyClient.test.ts`
- Modify as required: local E2EE HTTP/CLI settings and their tests

**Work:**

1. Build `NodeAccountGrantVerifier` from current connector origin/generation, acknowledged statement,
   retained prekey, Hub keyset, and exact `channel.open` ticket context.
2. Verify the grant through the shared verifier after the handshake rate limit and bounds checks but
   before mode transition or application data. Match the decrypted client static key and certificate.
3. Intersect directory/channel role, grant maximum role/capabilities, node policy, and any local
   restrictions. No source may widen another.
4. Return an immutable, in-memory `account-enrolled` admission lease tied to one channel. Never call a
   durable `approve`, `commitPairingAdmission`, or approved-client-store write.
5. Keep suite `0x01` on the current durable local-authorization path. Select/report **Verified locally**
   only when the client used suite `0x01`; a local record may reject or narrow suite `0x02` but cannot
   cosmetically promote it.
6. Replace the stored policy's two-boolean source of truth with the four-mode enum, including a crash-safe
   v1 migration and compatibility projections for existing CLI/API consumers.
7. Register session trust source and a bounded enrollment handle in memory. Do not expose account, grant,
   ticket, key, or channel identifiers through the operator listing.
8. On a matching revocation or policy withdrawal, abort in-flight handshakes, close established channels,
   erase session state, and invalidate read/mutation readiness.
9. Test the full policy matrix, local-denial precedence, no durable writes, key rotation, revoked epochs,
   stale connector generations, unknown fields, replay, suite downgrade, concurrent withdrawal, and
   uniform pre-key wire errors.

**Focused verification:**

```sh
bun run --cwd apps/server test -- \
  src/hubConnector/NodeAccountGrantVerifier.test.ts \
  src/hubConnector/NodeE2eeChannelSession.test.ts \
  src/hubConnector/relayE2eeInteropMatrix.test.ts \
  src/hubConnector/HostedRelaySessionIntegration.test.ts \
  src/hubIdentity/NodeE2eePolicyStore.test.ts \
  src/hubIdentity/NodeE2eePolicyClient.test.ts
bun run typecheck --filter=ryco-cli
git diff --check
```

**Commit:** `feat(server): admit account-enrolled native clients`

### Task 7: Implement the contract-matched Hub counterpart separately

**Repository:** Private Hub repository, after Tasks 1–4 are merged and pinned. Do not add private paths,
deployment data, issue links, or qualification evidence to this public plan.

**Work:**

1. Persist only public device enrollment material, bounded display metadata, role/capability ceilings,
   account/device auth epochs, and revocation timestamps.
2. Require a native DPoP-bound account session for current-device upsert. Verify the DPoP public key,
   client prekey cross-signature, nonce/idempotency key, account, and supported key algorithms.
3. Accept and verify node capability-state publication from authenticated node connectors. Grant only
   against the exact acknowledged, unexpired statement and negotiated relay minor 3.
4. Maintain an isolated Ed25519 grant-signing keyring with `keyId`, staged overlap, public-key
   distribution, and rollback-safe generation. Private signing keys never enter public artifacts.
5. Return a two-minute-or-shorter grant in the native ticket response with no extra client request. Bind
   it to the exact ticket ID, node statement, enrollment, account/device epochs, role, and capabilities.
6. Implement device list, rename, and revoke. Revocation stops grant issuance, advances the device epoch,
   closes matching relay channels, and pushes the event to online nodes.
7. Keep browser ticket responses grant-free and reject native-grant requests from cookie/browser
   sessions.
8. Add dark issuance, node-shadow-validation, opt-in admission, and default-enrollment flags separately.
9. Consume the public F19 vectors and contract decoders; do not copy their schemas by hand.
10. Complete private unit/integration/abuse tests and review before exposing the capability to public
    clients.

**Gate:** Tasks 8–13 may land disabled, but automatic admission cannot be enabled until this counterpart
is deployed to the intended test environment and advertises the exact public capability version.

## Wave 3: Shared native enrollment and trust runtime

### Task 8: Add strict native enrollment and ticket APIs

**Files:**

- Modify: `packages/client-runtime/src/authorization/types.ts`
- Modify: `packages/client-runtime/src/authorization/api.ts`
- Modify: `packages/client-runtime/src/authorization/api.test.ts`
- Modify: `packages/client-runtime/src/authorization/index.ts`
- Modify: `packages/client-runtime/src/authorization/state.ts`
- Modify: `packages/client-runtime/src/authorization/state.test.ts`
- Modify: `packages/client-runtime/src/relay/transport.ts`
- Modify: `packages/client-runtime/src/relay/transport.test.ts`

**Work:**

1. Add native-only `upsertE2eeDeviceEnrollment` and `issueAccountGrantRelayTicket` methods that require
   bearer/DPoP transport. Keep the existing browser/local ticket method grant-free.
2. Add list, rename, and revoke methods usable by authenticated account-security surfaces with the
   existing cookie/CSRF versus bearer/DPoP separation.
3. Decode every request/response through the new strict contract schemas. Reject malformed grants,
   partial ticket context, wrong minor versions, bad keysets, and response-mode mixing before changing
   state.
4. Return grant bytes only to the bounded connection attempt that requested them. Never place them in
   Zustand, persisted profiles, diagnostics, errors, or generic ticket history.
5. Make the native ticket method carry the current enrollment ID/revision and requested suite `0x02`.
   The Hub selects and binds the final current node statement, role, and capabilities; the client verifies
   those returned bindings against the authenticated directory and relay advertisement.
6. Fetch and decode the authenticated Hub grant-verification keyset for native clients, with bounded
   rotation overlap and generation fencing. Do not trust a key delivered only inside a ticket response.
7. Add account-device public state and mutations without coupling them to relay readiness.
8. On device self-revocation or account epoch change, clear native enrollment state and synchronously
   invalidate current hosted generations before retry or sign-in.
9. Test DPoP proof mode, browser rejection, CSRF separation, strict decoding, key rotation, expiry, abort,
   concurrent requests, stale generations, revocation, and secret-free errors.

**Focused verification:**

```sh
bun run --cwd packages/client-runtime test -- \
  src/authorization/api.test.ts \
  src/authorization/state.test.ts \
  src/relay/transport.test.ts
bun run typecheck --filter=@ryco/client-runtime
git diff --check
```

**Commit:** `feat(client-runtime): add native e2ee enrollment api`

### Task 9: Add the platform-neutral enrollment coordinator and trust resolver

**Files:**

- Add: `packages/client-runtime/src/authorization/nativeE2eeEnrollment.ts`
- Add: `packages/client-runtime/src/authorization/nativeE2eeEnrollment.test.ts`
- Add: `packages/client-runtime/src/authorization/nativeE2eeTrustResolver.ts`
- Add: `packages/client-runtime/src/authorization/nativeE2eeTrustResolver.test.ts`
- Modify: `packages/client-runtime/src/authorization/index.ts`
- Modify: `packages/client-runtime/src/platform/index.ts`
- Modify: `packages/client-runtime/src/platform/platform.test.ts`
- Modify: `packages/client-runtime/src/connection/catalog.ts`
- Modify: `packages/client-runtime/src/connection/supervision.ts`
- Modify as required: hosted lifecycle and projection tests in `packages/client-runtime`

**Work:**

1. Define a narrow platform adapter that can ensure/describe the hardware P-256 identity, ensure/renew
   the cross-signed X25519 client prekey, borrow the agreement secret for one operation, maintain the
   non-secret installation enrollment ID, and read/write account-trusted node metadata.
2. Implement a generation-fenced coordinator with closed states: `idle`, `securing`, `ready`,
   `retrying`, `unavailable`, and `revoked`. It holds no private key or grant bytes after the operation.
3. After login, ensure device material and upsert enrollment. Start directory refresh in parallel once
   account and public identity are available; never let directory success imply enrollment readiness.
4. Reconcile same-key certificate renewal in place, key loss/reinstall as a new enrollment, exact
   idempotent responses, and stale or superseded revisions.
5. Resolve connection trust in strict order: Local Trusted Introduction, matching locally verified pin,
   account-grant eligibility, then explicit secure recovery. There is no automatic legacy branch.
6. Choose suite `0x01` only for locally verified trust and suite `0x02` only with a current enrollment and
   native grant ticket. Account-trusted node identity changes require a fresh grant and preserve the
   policy-generation high-water mark.
7. Before constructing a suite-`0x02` hello, verify the grant signature and every ticket, enrollment,
   certificate, node-statement, role/capability, epoch, and expiry binding with the authenticated Hub
   keyset. Treat a mismatching directory or relay advertisement as a hard authorization failure.
8. Preserve the existing connection supervisor's demand caps, priority order, reconnect backoff,
   generation fencing, and snapshot-before-mutation rules. The coordinator supplies authorization; it
   does not become a second lifecycle owner.
9. Connect the colocated node, last-active node, visible/cache-needed nodes, and remaining online nodes in
   that order. Metadata sweeps remain bounded and read-only until current readiness.
10. Test cold login, restored login, concurrent callers, certificate renewal, reinstall, key corruption,
    unsupported hardware, invalid grant bindings, key rotation, expiry retry, offline cache, account
    switch, node identity change, verified-pin conflict, policy high-water rollback, revocation, and stale
    generation completion.

**Focused verification:**

```sh
bun run --cwd packages/client-runtime test -- \
  src/authorization/nativeE2eeEnrollment.test.ts \
  src/authorization/nativeE2eeTrustResolver.test.ts \
  src/platform/platform.test.ts
bun run typecheck --filter=@ryco/client-runtime
git diff --check
```

**Commit:** `feat(client-runtime): coordinate account-enrolled e2ee`

## Wave 4: Native platform adoption and user experience

### Task 10: Add Android hardware-backed TEE fallback without software fallback

**Files:**

- Modify: `apps/mobile/modules/ryco-device-key/index.ts`
- Modify: `apps/mobile/modules/ryco-device-key/android/src/main/java/expo/modules/rycodevicekey/RycoDeviceKeyModule.kt`
- Modify as required: Android native module tests or device-helper fixtures
- Modify: `apps/mobile/src/platform/deviceKey.ts`
- Modify: `apps/mobile/src/platform/deviceKey.test.ts`
- Modify: `apps/mobile/src/features/hostedHub/hostedAuthModel.ts`
- Modify: `apps/mobile/src/features/hostedHub/hostedAuthModel.test.ts`

**Work:**

1. Preserve and prefer an existing valid StrongBox P-256 key.
2. On first creation, attempt StrongBox. Only when StrongBox is unavailable, create a separate Android
   Keystore P-256 key and accept it if `KeyInfo` proves TEE/secure-hardware custody.
3. Return an exact backing enum: `strongbox`, `tee`, or `unavailable`. Never infer StrongBox from generic
   secure-hardware status and never report software storage as TEE.
4. Do not delete a valid key because a transient keystore read or backing query fails. Make creation
   create-only and concurrency-safe.
5. Keep the private key non-exportable and keep the X25519 secret in the existing backup/transfer-excluded
   store. Do not claim X25519 is a hardware-keystore key.
6. Update hosted availability/UI copy to accept TEE at a visibly lower reported assurance than StrongBox.
7. Test existing StrongBox, unavailable StrongBox with valid TEE, software-only rejection, API-level
   differences, corrupt alias, concurrent ensure, transient failure, and no destructive replacement.

**Focused verification:**

```sh
bun run --cwd apps/mobile test -- \
  src/platform/deviceKey.test.ts \
  src/features/hostedHub/hostedAuthModel.test.ts
bun run --cwd apps/mobile typecheck
git diff --check
```

**Commit:** `feat(mobile): accept hardware-backed android tee identity`

### Task 11: Make mobile login automatically establish native E2EE

**Files:**

- Modify: `apps/mobile/src/platform/e2eeClientPrekey.ts`
- Modify: `apps/mobile/src/platform/e2eeClientPrekey.test.ts`
- Modify: `apps/mobile/src/platform/e2eeTrustModel.ts`
- Modify: `apps/mobile/src/platform/e2eeTrustModel.test.ts`
- Modify: `apps/mobile/src/platform/e2eeTrustStore.ts`
- Modify: `apps/mobile/src/platform/e2eeTrustStore.test.ts`
- Modify: `apps/mobile/src/hostedHub/e2eeAttempt.ts`
- Modify: `apps/mobile/src/hostedHub/e2eeAttempt.test.ts`
- Modify: `apps/mobile/src/hostedHub/e2eeSession.ts`
- Modify: `apps/mobile/src/hostedHub/e2eeSession.test.ts`
- Modify: `apps/mobile/src/hostedHub/relaySocket.ts`
- Modify: `apps/mobile/src/hostedHub/relaySocket.test.ts`
- Modify: `apps/mobile/src/hostedHub/runtime.ts`
- Modify: `apps/mobile/src/connection/hostedConnectionCoordinator.ts`
- Modify: `apps/mobile/src/connection/hostedConnectionCoordinator.test.ts`
- Modify: `apps/mobile/src/features/e2ee/E2eeNodeVerificationRouteScreen.tsx`
- Modify: `apps/mobile/src/features/e2ee/E2eeNodeSecurityRouteScreen.tsx`
- Modify: `apps/mobile/src/features/e2ee/e2eeTrustUiModel.ts`
- Modify: `apps/mobile/src/features/e2ee/e2eeTrustUiModel.test.ts`
- Modify: `apps/mobile/src/features/hostedHub/HubNodeSection.tsx`
- Modify: `apps/mobile/src/features/hostedHub/HubNodeSection.test.ts`

**Work:**

1. Implement the shared enrollment platform adapter over Secure Enclave/StrongBox/TEE identity,
   device-only agreement/prekey storage, and a non-secret installation enrollment ID.
2. Add a separate account-trusted node record that stores only public node identity/continuity,
   policy-generation high-water, trust timestamps, and Hub/account scope. Never mark it verified.
3. Prepare public identity and prekey before the native ticket request; attach the returned grant only to
   that relay attempt and borrow the X25519 secret only while constructing IK message 1.
4. Require suite `0x02`, exact grant/ticket/channel context, and current generation for account trust.
   Expired pairs are discarded together and reacquired once before normal backoff.
5. Preserve verified-pin and Local Trusted Introduction precedence. A verified mismatch blocks with no
   Hub-authorized repair.
6. Start enrollment after login/session restore and allow node-directory discovery in parallel. Render
   `Securing this device` until enrollment is ready; do not open an app data channel early.
7. Remove the QR/manual ceremony from normal node selection. Keep it under **Verify independently** and
   secure recovery.
8. Render **Encrypted · Account trusted**, **Encrypted · Verified locally**, fingerprints, safety number,
   local/reported key backing, first-enrolled/last-used times, identity-change history, and revoke action.
9. Keep cached node data read-only while offline and keep mutations disabled until the current snapshot
   publishes readiness.
10. Test a fresh install/login with zero pairing actions, restored login, all-node discovery, demand order,
    grant expiry, offline launch, revoked device, reinstall, valid account-trusted identity change,
    verified mismatch, unsupported node, no native fallback, and optional verification upgrade.

**Focused verification:**

```sh
bun run --cwd apps/mobile test -- \
  src/platform/e2eeClientPrekey.test.ts \
  src/platform/e2eeTrustModel.test.ts \
  src/platform/e2eeTrustStore.test.ts \
  src/hostedHub/e2eeAttempt.test.ts \
  src/hostedHub/e2eeSession.test.ts \
  src/hostedHub/relaySocket.test.ts \
  src/connection/hostedConnectionCoordinator.test.ts \
  src/features/e2ee/e2eeTrustUiModel.test.ts \
  src/features/hostedHub/HubNodeSection.test.ts
bun run --cwd apps/mobile typecheck
git diff --check
```

**Commit:** `feat(mobile): enable login-only native e2ee`

### Task 12: Enable account-enrolled remote E2EE in Desktop

**Files:**

- Modify: `apps/desktop/src/desktopHostedIdentity.ts`
- Modify: `apps/desktop/src/desktopE2eePrekey.ts`
- Modify: `apps/desktop/src/desktopE2eePrekey.test.ts`
- Modify: `apps/desktop/src/desktopE2eeTrust.ts`
- Modify: `apps/desktop/src/desktopE2eeTrust.test.ts`
- Modify: `apps/desktop/src/desktopNativeE2eeHandshake.ts`
- Modify: `apps/desktop/src/desktopNativeE2eeHandshake.test.ts`
- Modify: `apps/desktop/src/desktopWorkspaceRelay.ts`
- Modify: `apps/desktop/src/desktopWorkspaceRelay.test.ts`
- Modify as required: `apps/desktop/src/desktopWorkspaceClient.ts`, `apps/desktop/src/main.ts`, and IPC
  contracts/tests

**Work:**

1. Implement the shared enrollment adapter in the Desktop main process. Keep P-256/X25519 custody and
   handshake state out of the renderer.
2. Enroll the existing Desktop identity/prekey after native Hub login and session restoration.
3. Resolve trust before ticket issuance. Use Local Trusted Introduction for the colocated node, suite
   `0x01` for verified remote pins, and request a suite-`0x02` grant only for eligible remote nodes.
4. Preserve parallel ticket, headers, key preparation, and handshake startup after enrollment readiness.
   Adding a grant must not add a per-node request.
5. Pass grant/ticket/channel context into the main-process handshake and return only established session
   secrets and public trust source to the renderer.
6. Never persist a grant or convert it into a Desktop approved/verified record. Independent verification
   remains a separate user action.
7. On account/device revocation, close affected workspace relays and invalidate Desktop connection and
   mutation readiness.
8. Test local-introduction precedence, verified remote, automatic remote, grant expiry, concurrent node
   activation, account switch, revocation, key loss, statement rotation, and no renderer secret exposure.

**Focused verification:**

```sh
bun run --cwd apps/desktop test -- \
  src/desktopE2eePrekey.test.ts \
  src/desktopE2eeTrust.test.ts \
  src/desktopNativeE2eeHandshake.test.ts \
  src/desktopWorkspaceRelay.test.ts
bun run typecheck --filter=@ryco/desktop
bun run build:desktop
git diff --check
```

**Commit:** `feat(desktop): enable account-enrolled remote e2ee`

### Task 13: Add honest cross-client Security UI and preserve Web isolation

**Files:**

- Modify: `apps/web/src/components/settings/NodeSecuritySettings.logic.ts`
- Modify: `apps/web/src/components/settings/NodeSecuritySettings.logic.test.ts`
- Modify: `apps/web/src/components/settings/NodeSecuritySettings.tsx`
- Modify: `apps/web/src/components/settings/NodeSecuritySettings.browser.tsx`
- Modify: `apps/web/src/components/hostedHub/HostedE2eeVerification.logic.ts`
- Modify: `apps/web/src/components/hostedHub/HostedE2eeVerification.logic.test.ts`
- Modify: `apps/web/src/components/hostedHub/HostedE2eeVerification.tsx`
- Modify: `apps/web/src/components/hostedHub/HostedNativeAuthorizationRoute.tsx`
- Modify as required: account-security settings components and tests in `apps/web/src/components`
- Modify: `apps/web/src/hostedHub/e2eeAttempt.ts`
- Modify: `apps/web/src/hostedHub/e2eeAttempt.test.ts`
- Modify: `apps/web/src/pwa/serviceWorkerPolicy.ts`
- Modify: `apps/web/src/pwa/serviceWorkerPolicy.test.ts`

**Work:**

1. Add the four connection labels and explanatory details without claiming active-Hub resistance for
   account enrollment.
2. Display client/node fingerprints, safety number, trust source, enrollment history, local versus
   reported backing, and independent-verification state. Never display or serialize the transient grant.
3. Add account-device list, rename, and revoke actions. A new-device notification is informational, not
   an approval gate.
4. Hide Hub-only enrollment/device controls in direct mode or explain their absence. Do not call Hub
   E2EE endpoints and render `Hub E2EE operation failed` when no Hub exists.
5. Keep **Verify independently** and recovery available without making either the default node path.
6. Make Web suite selection exclude suite `0x02` even if a malicious statement advertises only it. Web
   ticket requests use the existing grant-free method and Web code never parses grant bytes.
7. Add every enrollment, grant-keyset, native-ticket, and revocation route to the service-worker
   never-cache policy alongside authenticated RPC and relay traffic.
8. Test direct mode, hosted account trust, verified precedence, revocation, grant canaries absent from DOM,
   URL/history/storage/cache/logs, malicious suite advertisement, and unchanged Web NX behavior.

**Focused verification:**

```sh
bun run --cwd apps/web test -- \
  src/components/settings/NodeSecuritySettings.logic.test.ts \
  src/components/hostedHub/HostedE2eeVerification.logic.test.ts \
  src/hostedHub/e2eeAttempt.test.ts \
  src/pwa/serviceWorkerPolicy.test.ts
bun run typecheck --filter=@ryco/web
git diff --check
```

**Commit:** `feat(web): expose account e2ee trust without weakening web`

## Wave 5: Browser corpus, audit, and qualification

### Task 14: Close the existing Chromium vector gaps

**Files:**

- Add or modify: `apps/web/src/components/hostedHub/E2eeModeMachine.browser.tsx`
- Modify: `apps/web/src/components/hostedHub/E2eeNxHandshake.browser.tsx`
- Modify: `apps/web/src/components/hostedHub/E2eeCodecParity.browser.tsx`
- Add or modify: account-grant browser rejection coverage under
  `apps/web/src/components/hostedHub/*browser.tsx`
- Modify: `packages/shared/fixtures/e2ee/v1/manifest.json`
- Modify: `packages/shared/src/relayE2eeCorpusLiveness.ts`
- Modify: `docs/relay-e2ee-web-browser-vectors.md`

**Work:**

1. Import and drive every F10 mode-machine case in Chromium, including all committed byte leaves and
   shipped-client behavior.
2. Drive F7 `nx-handshake-complete-trace` from the committed fixture in Chromium.
3. Drive F3 `-under-require-approved-client-e2ee` and `-evaluated-as-native` admitted-pattern cases.
4. Add F19 browser tests proving Web rejects account-grant suite selection and does not decode, store,
   or forward grant bytes.
5. Change the manifest browser-run state from `not-wired` only after the declared scopes and liveness
   census are actually consumed. Remove only deferrals made false by these tests.
6. Update the browser-vector document to state exact remaining physical-device obligations honestly.

**Focused verification:**

```sh
bun run --cwd apps/web test:browser -- \
  src/components/hostedHub/E2eeModeMachine.browser.tsx \
  src/components/hostedHub/E2eeNxHandshake.browser.tsx \
  src/components/hostedHub/E2eeCodecParity.browser.tsx
bun run --cwd packages/shared test -- \
  src/relayE2eeCorpus.test.ts
git diff --check
```

Install the pinned Chromium runtime first with `bun run --cwd apps/web test:browser:install` only when it
is absent.

**Commit:** `test(e2ee): complete chromium protocol corpus`

### Task 15: Run the cross-boundary automated backstop

1. Reinstall with `bun install --frozen-lockfile` and confirm Bun 1.4.0.
2. Run all focused tests from Tasks 2–14 after their checkpoints.
3. Run the full repository backstop because this change crosses contracts, cryptography, relay protocol,
   authorization, server, Web, Desktop, and native mobile boundaries:

   ```sh
   bun fmt
   bun run fmt:check
   bun lint
   bun typecheck
   bun run test
   bun run build
   ```

4. Run the high-risk web and Desktop gates:

   ```sh
   bun run build --filter=@ryco/web
   bun run --cwd apps/web test:browser
   bun run build:desktop
   ```

5. Run mobile typecheck, the complete mobile test package, an iOS development build, and representative
   Android StrongBox/TEE builds. Simulator/emulator success does not qualify hardware custody.
6. Run malicious-relay, full F19, old/new interop, policy migration, revocation, connector restart,
   statement/prekey rotation, and no-plaintext-leak suites with secret canaries.
7. Compare generated fixtures against a clean regeneration and prove suite `0x01` fixture hashes did not
   change.
8. Audit the entire diff for private Hub data, credentials, grant/ticket/key bytes, unbounded errors,
   service-worker data-plane caching, generated drift, and unrelated changes.

### Task 16: Reconcile audit scope and prepare external review

**Files:**

- Modify: `docs/relay-e2ee-noise-audit-scope.md`
- Modify: `docs/relay-e2ee-protocol.md`
- Modify: `docs/relay-e2ee-web-browser-vectors.md`
- Modify as required: public security/release documentation

**Work:**

1. Correct the stale claim that Noble 1.x is pinned. Record the runtime's `@noble/curves@2.3.0`, the
   protocol's 2.2.0 maintainer-audit baseline, the exact delta reviewed, and explicit owner acceptance.
2. Do not describe the maintainer audit as an independent review of Ryco's Noise state machine.
3. Prepare a bounded audit package for the first-party Noise state machine plus suite `0x02` grant
   transcript, canonical encoding, authorization callback, downgrade behavior, and record-layer
   integration.
4. Commission independent review and keep broad default enablement blocked until high-severity findings
   are resolved and retested.
5. Update protocol conformance tables, fixture counts/hashes, browser status, policy names, and rollout
   state to match implemented reality.

**Commit:** `docs(e2ee): reconcile audit scope and rollout gates`

### Task 17: Live zero-touch, revocation, and performance qualification

1. Use two disposable live nodes and a non-production test account. Record no real identifiers,
   fingerprints, credentials, paths, or screenshots in the public repository.
2. With Computer Use and a fresh Desktop profile, sign in once and confirm both authorized online nodes
   appear without QR or approval. Verify the colocated node reports **Verified locally** and a remote node
   reports **Account trusted**.
3. On a physical iPhone, perform a fresh installation and login. Confirm key/enrollment setup is automatic,
   nodes appear, and first node-owned data renders only after IK and a current snapshot.
4. On representative Android devices, repeat with StrongBox and TEE backing. Confirm software-only or
   unverifiable backing fails closed with no native legacy connection.
5. In hosted Chrome, confirm Web remains **Encrypted web**, never receives native grants, and can list or
   revoke account devices according to account role. In direct Chrome, confirm Hub-only Security controls
   are absent and no opaque Hub error occurs.
6. Inspect fingerprints and safety numbers, then independently verify one remote node. Reconnect and
   confirm it upgrades to **Verified locally** and rejects a Hub-substituted node identity.
7. Revoke an active native device. Confirm the Hub stops issuing grants, closes its relay channels, nodes
   retire matching leases, and clients synchronously remove read/mutation readiness.
8. Exercise ticket/grant expiry, node statement rotation, account switch, offline cached read-only launch,
   node restart, Hub reconnect, and old-node **Update required** behavior.
9. Measure cold login-to-first-current-snapshot, warm reconnect, and multi-node foreground reconnect burst
   against the manually approved baseline. Confirm no extra per-node HTTP round trip and no material
   regression in median/tail latency or connection stability.
10. Roll out in order: Hub issuance dark, node shadow validation, internal opt-in admission, native client
    opt-in, then default account enrollment. Keep the strongest locally approved policy unchanged.
11. Verify rollback by disabling issuance/admission while retaining suite `0x01`, manual recovery, Web NX,
    and compatible cached read-only behavior.

## Completion criteria

- Fresh compatible Desktop and mobile installations need only Hub login to discover and securely connect
  to authorized online nodes.
- Suite `0x01` and locally verified trust remain unchanged and always outrank account enrollment.
- Suite `0x02` succeeds only with an exact, current, ticket-bound grant and never writes durable node
  approval.
- Device/account revocation closes live access and prevents reconnect.
- Web never obtains native authorization semantics and direct mode no longer calls Hub-only E2EE APIs.
- Hardware, browser, adversarial, cross-version, performance, and full-repository gates pass.
- The independent audit and explicit rollout gates are complete before automatic account E2EE becomes the
  broad default.
