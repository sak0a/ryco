# Automatic account-enrolled native E2EE design

## Summary

Ryco will make hardware-identified native E2EE the normal consequence of signing in to the Hub. A fresh
Desktop or mobile installation creates its device keys, enrolls their public portions into the signed-in
account, discovers the account's online nodes, and connects without QR codes, safety-number entry, or a
second approval ceremony.

The Hub authorizes this automatic path with a short-lived, node- and ticket-bound `HubDeviceGrant`.
The native client and node still complete a Noise IK handshake and prove possession of their private
keys. The Hub never receives a device private key, node private key, Noise session key, or plaintext
application payload.

This deliberately makes the signed-in Hub account an authorization root for the automatic native tier.
A compromised Hub or account session may enroll a new device and authorize it to permitted nodes. That
is the explicit product trade-off selected for login-only setup. Users who want protection against an
actively malicious Hub can independently verify a node or use an existing local trusted introduction;
those stronger pins always outrank account enrollment and can never be silently replaced by it.

The first release covers automatic discovery and connection to live, online nodes. Nodes remain
authoritative for projects, tasks, files, conversations, terminals, source-control state, and other
application data. An encrypted Hub history or offline data mirror is not part of this design.

### Relationship to the earlier trust design

This specification supersedes only the onboarding decision and corresponding non-goal in
`2026-08-29-cross-node-trust-readiness-and-parity-design.md` that rejected account-login authorization and
selected one-scan approval. The earlier design's node-scoped readiness, mutation leasing, Desktop workspace,
settings ownership, notification provenance, Web disclosure, CLI, and mobile parity decisions remain in
force. If the two specifications disagree about native onboarding or account enrollment, this document
is authoritative.

## Motivation

The current implementation has most of the required cryptographic and lifecycle foundations:

- a native hardware-backed identity key and a separate device-only agreement key;
- Noise IK for native clients and Noise NX for web clients;
- node identity pins, safety numbers, manual approval, and cross-device approval;
- automatic local trusted introduction between Desktop and its colocated node;
- DPoP-bound Hub authorization;
- a Hub node directory and short-lived relay tickets;
- demand-driven connection supervision;
- fresh reconnect generations and snapshot-before-mutation readiness.

The remaining product mismatch is that remote native devices still require explicit node approval and
a QR or fingerprint ceremony. That makes E2EE feel optional and difficult even when a user has already
proved control of the account that owns the nodes.

The desired experience is:

1. Sign in once on a native device.
2. See authorized online machines automatically.
3. Establish native E2EE automatically wherever both ends support it.
4. Load current node data without another setup step.
5. Keep fingerprints and safety numbers visible for inspection or an optional stronger verification.

## Current-state findings

The design follows a code, protocol, test, and live-UI audit performed before this specification was
written.

### Existing strengths

- Desktop already has a secure zero-touch path for its colocated node through automatic node claim and
  Local Trusted Introduction. This remains the highest-priority automatic path.
- Hosted reconnect has one authoritative lifecycle owner. It revalidates the account and directory,
  creates a fresh relay generation, and waits for a current shell snapshot before publishing mutation
  readiness.
- Native clients use Noise IK and device-held keys. Web uses an explicitly weaker Noise NX tier.
- Desktop already prepares ticket, relay headers, and handshake work in parallel.
- Connection demand is capped and reconnects are staggered, avoiding an unbounded reconnect burst.
- The service worker is already intended to cache only the static application shell, not the data plane.

### Gaps to close

- Remote mobile onboarding still makes approval plus a QR scan the default path.
- The current policies do not express an intermediate native tier that is encrypted and account-trusted
  but not locally verified.
- Android requires StrongBox rather than accepting another demonstrably hardware-backed TEE, reducing
  availability on otherwise suitable devices.
- The direct/non-Hub Security screen attempts Hub operations and can display an opaque
  `Hub E2EE operation failed` error.
- The first-party Noise state machine has not received the independent audit required before broad
  default enablement.
- Browser qualification is incomplete: the full F10 path is not fixture-driven in Chromium, the F7
  complete trace is absent, and two admitted F3 patterns are not represented. The browser manifest also
  still describes the run as not wired.
- `docs/relay-e2ee-noise-audit-scope.md` still describes the old pinned 1.x Noble lineage, while the
  runtime uses `@noble/curves@2.3.0` and the protocol records a 2.2.0 maintainer-audit baseline. The
  scope, current version, review lineage, and explicit owner acceptance must be reconciled.

### Baseline verification

The audit passed 746 focused Vitest tests across shared, client-runtime, Desktop, mobile, and server
packages, plus 74 focused Chromium browser tests for codec parity, malicious relay behavior, NX
handshake behavior, record protection, verification UI, and node security. A live direct-node browser
check confirmed the current token-based setup and exposed the direct-mode Security UX problem.

These results establish a healthy baseline. They are not a substitute for the additional adversarial,
cross-version, hardware, and end-to-end qualification required by this design.

## Goals

1. Make Hub login sufficient to enroll a native device and connect it to every authorized, compatible,
   online node without a QR code or manual approval.
2. Preserve native end-to-end transport encryption and private-key custody on the device and node.
3. Bind every automatic authorization to the exact account, Hub origin, device, node, relay ticket,
   role, capabilities, account and device authentication epochs, and short validity window.
4. Preserve Local Trusted Introduction and independently verified pins as stronger trust than Hub
   account enrollment.
5. Keep node and client fingerprints, safety numbers, key backing, trust source, and revocation controls
   inspectable without making them onboarding requirements.
6. Add no separate per-node network round trip to the normal ticket-and-connect path.
7. Keep the current snapshot-before-mutation, generation-fencing, and reconnect ownership rules.
8. Fail closed on unsupported or invalid native security states rather than falling back to plaintext.
9. Keep Web's existing, explicitly weaker security tier compatible with the same Hub account and node
   directory.

## Non-goals

- Protecting an automatically account-enrolled native device from a malicious Hub or a fully compromised
  account session. Independent verification exists for that stronger threat model.
- Uploading node-owned application data to the Hub for offline access.
- Synchronizing native private keys through the Hub, a password, a recovery phrase, or a cloud keychain.
- Making Web equivalent to a hardware-backed native identity.
- Replacing Noise, rewriting the shared connection supervisor, or creating a second mobile lifecycle.
- Extending the frozen `apps/web` phone presentation tier.
- Automatically converting account enrollment into a durable locally approved client record.
- Allowing an account grant on a direct, non-Hub transport.

## Threat model and trust tiers

### Attacker coverage

For all E2EE tiers, the relay and network may observe, delay, drop, replay, reorder, duplicate, or mutate
traffic. Successful native handshakes prove possession of the device and node private keys, and record
protection preserves confidentiality and integrity after the handshake.

The tiers differ in who may authorize or substitute keys:

| Trust tier         | Setup                                                                   | Protects against passive Hub           | Protects against active Hub               | May mutate                             |
| ------------------ | ----------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- | -------------------------------------- |
| `locally-verified` | LTI, independent verification, or existing manual/cross-device approval | Yes                                    | Yes, after the trusted pin is established | According to effective role and policy |
| `account-enrolled` | Hub login and short-lived account grant                                 | Yes                                    | No                                        | According to effective role and policy |
| `web-unsigned`     | Browser NX                                                              | Yes while served client code is honest | No                                        | According to existing web policy       |
| `legacy`           | Existing non-E2EE transport                                             | No E2EE claim                          | No                                        | Only when compatibility policy permits |

`locally-verified` is stronger than `account-enrolled`. An account grant that conflicts with a locally
verified node pin or client authorization is rejected. It cannot replace, downgrade, or repair the pin.

A node identity cached only through `account-enrolled` trust may change automatically when a fresh,
valid Hub grant names the exact current node capability statement. This does not weaken the model because
the Hub was already the authorization root for that tier. The UI records the change and retains the
existing policy-generation high-water mark. A locally verified node identity never changes this way.

### Explicit selected trade-off

Login-only onboarding means the Hub account can authorize a new hardware key. DPoP prevents bearer-token
replay without possession of the bound key, but it does not create a second human authorization factor.
This is intentional. Users may upgrade a connection to local verification when they require resistance
to active Hub or account compromise.

## Selected architecture

### 1. Persistent public device enrollment

Each native installation maintains two separated device-held keys with different custody properties:

- a non-exportable, hardware-backed P-256 identity key used for device identity, the client prekey
  cross-signature, and DPoP proofs;
- an X25519 agreement key held in device-only, non-synchronizing, non-backup secure storage and borrowed
  into process memory only for bounded Noise operations.

On iOS, the P-256 key remains inside Secure Enclave and the X25519 secret remains in a
`ThisDeviceOnly` Keychain item. On Android, StrongBox is preferred for the P-256 key; a hardware-backed
TEE is accepted when StrongBox is unavailable and platform key metadata confirms hardware custody. The
X25519 secret remains in the existing backup- and transfer-excluded secure-store class. A software-only
P-256 identity or a synchronizing/backed-up agreement secret is not accepted for the automatic native
tier.

After Hub login, the client sends an idempotent enrollment upsert containing:

- Hub origin and account identifier;
- stable installation enrollment identifier;
- P-256 public identity key and fingerprint;
- X25519 public agreement key and fingerprint;
- the current client agreement-prekey certificate cross-signed by the P-256 identity key, including its
  identifier and expiry;
- platform, application version, platform-reported key-backing class, and user-editable device label;
- requested maximum role and capability set;
- a one-time enrollment nonce.

The enrollment call uses the account's DPoP-bound authorization. The Hub verifies that the DPoP public
key equals the enrolled P-256 identity, validates the client prekey certificate and its cross-signature,
and checks the account binding, nonce, and allowed role. Repeating the same upsert is safe. Renewing an
expiring certificate for the same keys updates the enrollment in place.
Reusing an enrollment identifier with different keys creates a new enrollment revision and retains the
previous device entry as revoked or superseded rather than silently changing its identity.

The first-party native adapter locally verifies its P-256 backing before enrollment. Unless a separate
platform-attestation system is introduced, the Hub stores the backing class as signed client metadata,
not as independently attested authorization evidence. Nodes must not increase authority based on that
label.

The Hub stores only public keys, fingerprints, bounded metadata, role/capability limits, timestamps, and
revocation state. Reinstalling or losing device keys creates a new enrollment. Old enrollments remain
visible and revocable.

### 2. Ticket-bound `HubDeviceGrant`

When an enrolled native client requests a relay ticket, the normal ticket response also contains a
signed `HubDeviceGrant`. This avoids a second per-node network round trip.

The node publishes its current signed capability statement to the Hub whenever its identity, agreement
prekey, continuity chain, suite set, or policy generation changes. The Hub checks the statement's
canonical form, signature, expiry, and identity against the authenticated node connector, and grants only
against the complete validated statement. The ticket and incoming channel metadata identify that exact
statement digest. The node retains the matching statement and agreement prekey for at least the
ticket/grant overlap, using the protocol's existing staged-rotation discipline. If the exact statement is
no longer available, the node rejects the attempt and the client obtains a fresh ticket and grant.

The canonical grant payload contains:

```ts
interface HubDeviceGrantClaims {
  readonly version: 1;
  readonly issuerHubOrigin: string;
  readonly keyId: string;
  readonly accountId: string;
  readonly accountAuthEpoch: number;
  readonly enrollmentId: string;
  readonly enrollmentRevision: number;
  readonly deviceAuthEpoch: number;
  readonly deviceIdentityP256: Uint8Array;
  readonly deviceIdentityFingerprint: string;
  readonly deviceAgreementX25519: Uint8Array;
  readonly deviceAgreementFingerprint: string;
  readonly clientPrekeyCertificateDigest: Uint8Array;
  readonly nodeId: string;
  readonly nodeIdentityEd25519: Uint8Array;
  readonly nodeIdentityFingerprint: string;
  readonly nodeAgreementX25519: Uint8Array;
  readonly nodeAgreementFingerprint: string;
  readonly nodeContinuityId: string;
  readonly nodePolicyGeneration: number;
  readonly nodeCapabilityStatementDigest: Uint8Array;
  readonly relayTicketId: string;
  readonly maximumRole: HostedRole;
  readonly capabilities: ReadonlyArray<HostedCapability>;
  readonly issuedAt: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly nonce: Uint8Array;
}
```

The envelope uses canonical CBOR and an Ed25519 signature over a fixed-size,
`ryco.hub-device-grant.v1` domain-separated digest. The grant expires at the earliest of the relay ticket
expiry, two minutes after issuance, the client prekey-certificate expiry, or the node capability/prekey
expiry. It is valid for one Hub origin, account, account and device authentication epoch, enrollment
revision, device key pair and certificate, node identity and advertised statement, relay ticket, role
ceiling, and capability ceiling.

The ticket identifier and grant nonce are included in the authenticated Noise transcript. A grant
cannot be moved to another relay attempt or replayed with another device agreement key. The node accepts
account grants only on the Hub relay path that delivered the matching current ticket; direct endpoints
never accept them.

Hub signing keys are selected by `keyId`. Nodes consume an authenticated verification keyset with an
overlap window for rotation. Unknown keys, expired overlap, invalid canonical encoding, unsupported
versions, and invalid signatures fail closed.

The encoded envelope has a hard 2,048-byte limit and is rejected before CBOR parsing when larger. Every
identifier, array, string, and byte field retains the protocol's existing bound or gains an explicit
smaller bound. The protocol amendment must include worst-case wire arithmetic proving that the complete
account-grant IK message still fits `E2EE_CLIENT_HELLO_MAX_BYTES`; the message is never fragmented merely
to accommodate a grant. Every carried fingerprint must equal the fingerprint derived from its carried
public key, and every carried digest must equal the exact canonical envelope it names.

### 3. Distinct native account-grant Noise mode

The automatic path remains Noise IK: the client knows the node's static key from the signed grant, and
both sides prove possession of their static private keys. It is negotiated as a distinct native
account-grant suite/auth mode rather than overloading the existing locally approved IK mode.

After the relay opens, the node emits the signed capability statement selected by the ticket. The client
validates it and requires its canonical digest to equal the grant before constructing IK message 1. That
encrypted IK payload carries the exact grant and client prekey certificate. The node decrypts the client
static key and payload, validates both envelopes against the ticket context, and only then creates the
ephemeral channel authorization. No application payload is included in either handshake message.

Its prologue/transcript binds at least:

- protocol and auth-mode identifiers;
- Hub origin and account identifier;
- grant version and canonical grant digest;
- ticket identifier and relay channel generation;
- node identifier, identity and agreement fingerprints, continuity identifier, and policy generation;
- the exact node capability-statement and client prekey-certificate digests;
- client identity and agreement fingerprints;
- effective requested role and capabilities.

The distinct mode prevents a grant from being interpreted as a local approval and prevents suite or
trust-source downgrade. The existing Noise state machine and record layer are reused rather than forked.
Only authentication inputs, validation, and transcript domain separation are extended.

Before sending application data, the node verifies the Hub signature, time window, ticket, origin,
account and device epochs, its own identity and current advertised statement, the client identity,
agreement key and prekey certificate, role, and capabilities. The client verifies the same grant
bindings, validates the exact node-signed capability statement named by the grant, and checks the node
agreement key before accepting the handshake result.

### 4. Ephemeral node authorization

A valid grant produces an in-memory `account-enrolled` authorization lease for the current channel. It
does not create or update a permanent locally approved client record.

Effective authority is the intersection of:

1. the account's current directory role for the node;
2. the grant's maximum role and capabilities;
3. the ticket and relay channel role;
4. node-local security and authorization policy;
5. any stronger local authorization restrictions.

No input may increase authority granted by another. Unknown roles or capabilities are rejected rather
than ignored.

A current locally approved client record for the same key takes precedence and reports
`locally-verified`. A conflicting local denial, revoked record, or verified identity pin rejects the
account grant.

### 5. Automatic client flow

After native login, the shared client runtime performs these operations:

1. Ensure the P-256 identity exists in approved hardware-backed storage and the X25519 agreement secret
   exists in the required device-only secure-store class.
2. Exchange or restore DPoP-bound account authorization.
3. Upsert the public device enrollment and refresh the Hub node directory in parallel where dependencies
   permit.
4. Reconcile authorized online nodes with the connection catalog.
5. Prioritize the colocated node, the last active node, nodes required by the visible UI or cached work,
   and then the remaining online nodes.
6. For each demanded node, obtain a fresh ticket containing a fresh grant.
7. Open a fresh relay generation and complete the account-grant Noise IK handshake.
8. Accept a current shell/workspace snapshot.
9. Publish read readiness, then mutation authority only when the existing lifecycle requirements are
   satisfied.

Local Trusted Introduction is attempted before account enrollment for the Desktop app's colocated node.
An already matching locally verified pin is used before the account-grant tier. Account enrollment is
the default for remote compatible native nodes. Manual or cross-device verification remains an optional
upgrade and recovery path.

The client keeps high-priority nodes warm within existing demand limits and sweeps other online nodes
for bounded metadata snapshots without opening unbounded simultaneous connections. Cached snapshots may
render read-only while offline. Mutations always target a current node connection and are never queued
under stale authority.

### 6. Reconnect and readiness invariants

Every reconnect obtains a new ticket, grant, relay channel, Noise handshake, generation, and snapshot.
Expired tickets or grants are discarded together. A client may perform one immediate fresh acquisition
after an expiry race; further failures use the existing bounded backoff.

The authoritative hosted lifecycle owner remains unchanged. Generic direct or saved-environment helpers
must not race it or publish hosted readiness. Stale generations cannot publish role, snapshot, trust
source, or mutation authority.

Grant verification and a successful Noise handshake are necessary but not sufficient for mutation.
Mutation remains blocked until the current shell snapshot and all existing `NodeMutationLease`
conditions are satisfied.

## Revocation and key lifecycle

### Device or account revocation

Revoking a device causes the Hub to:

1. mark the enrollment revision revoked;
2. stop issuing tickets and grants to it;
3. advance the device authorization epoch, and the account epoch as well for account-wide events;
4. close its current relay channels;
5. publish the new epoch/revocation state to connected nodes and clients.

Because account grants are accepted only over Hub relay tickets, closing the relay removes the active
data path. The node also destroys the channel lease when it observes the close or revocation event. A
previous grant cannot authorize a new channel because it is ticket-bound and short-lived.

Account-wide security events advance `accountAuthEpoch`, invalidating all older grants. A single device
revocation advances `deviceAuthEpoch`, revokes its current enrollment revision, and prevents new grants
without forcing unrelated devices to regenerate keys.

### Node key changes

- A locally verified pin mismatch always blocks and requires explicit recovery or verification.
- An account-enrolled cached identity may change only when a fresh signed grant names the exact current
  node capability statement and the ticket targets that same node. This is a Hub-authorized identity
  replacement and is recorded in Security details.
- Replayed grants are rejected by ticket binding and expiry. The client also retains and enforces the
  existing node-policy-generation high-water mark for the account-trusted identity.
- Node re-registration never changes a locally verified pin.

### Reinstallation and loss

A fresh installation creates new hardware keys and enrolls as a new device after login. It does not
recover or clone the old device private keys. The old device remains visible in account security until
revoked or expired by policy.

## Failure behavior

| Failure                                                               | Required behavior                                                                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardware-backed identity or device-only agreement storage unavailable | Show that native account E2EE is unavailable; do not create a software identity, use synchronizing agreement storage, or connect through native legacy transport |
| Enrollment temporarily unavailable                                    | Remain signed in with a `Securing device` state, retry with backoff, and do not open an application channel                                                      |
| Ticket or grant expires during setup                                  | Discard both and acquire one fresh pair immediately                                                                                                              |
| Grant signature, binding, or canonical form invalid                   | Fail closed, record a bounded reason code, and do not attempt legacy fallback                                                                                    |
| Hub signing key unknown                                               | Refresh the authenticated keyset once; fail closed if still unknown                                                                                              |
| Locally verified node pin conflicts                                   | Block connection and show a high-severity identity-change warning                                                                                                |
| A fresh grant authorizes an account-trusted node identity change      | Update the account-trusted cached identity, retain the policy-generation high-water mark, and record the change in Security details                              |
| Node lacks account-grant support                                      | Show `Update required`; expose manual verification only if the node still supports secure native IK                                                              |
| Directory unavailable with a cached snapshot                          | Allow cached read-only browsing; do not issue mutations or claim current authorization                                                                           |
| Revocation occurs on a live channel                                   | Close the relay/channel, destroy readiness and mutation leases, and return to signed-in/disconnected state                                                       |
| Partial or repeated enrollment response                               | Reconcile by enrollment identifier and revision; never create duplicate active identities                                                                        |
| App crashes during setup                                              | Resume idempotently from hardware key and Hub enrollment state; never reuse a half-open handshake                                                                |

Errors shown to users are concise and actionable. Diagnostics may include stable bounded reason codes but
must not log private keys, DPoP proofs, grants, ticket secrets, handshake state, or plaintext payloads.

## Admission policies and compatibility

Account-grant support is additive and version-negotiated. Nodes advertise existing locally approved IK
and the new account-grant IK mode independently. Native clients choose the strongest available permitted
mode in this order:

1. Local Trusted Introduction or an existing locally verified authorization.
2. Native account-grant IK.
3. Optional manual/cross-device secure verification when explicitly requested.

There is no automatic native plaintext fallback.

The product policies become:

| Policy                               | Legacy   | Web NX   | Native account grant | Native locally verified |
| ------------------------------------ | -------- | -------- | -------------------- | ----------------------- |
| Compatibility                        | Allowed  | Allowed  | Allowed              | Allowed                 |
| Require E2EE                         | Rejected | Allowed  | Allowed              | Allowed                 |
| Require native E2EE                  | Rejected | Rejected | Allowed              | Allowed                 |
| Require locally approved native E2EE | Rejected | Rejected | Rejected             | Allowed                 |

The existing strongest policy keeps its meaning. Deployments that require a second authorization factor
can retain locally approved native E2EE and never accept the automatic account tier.

Old clients and nodes continue using their currently supported secure flows. A new client encountering
an old node reports the limitation instead of weakening security. Web continues using NX and never sends,
parses, or accepts a native `HubDeviceGrant` as authorization.

## Component boundaries

### `packages/contracts`

Add schema-only contracts for:

- native device enrollment requests, results, revisions, and public metadata;
- `HubDeviceGrant` claims and signed envelope;
- ticket responses carrying an optional grant;
- advertised native authentication modes;
- trust/admission source and key-backing class;
- device revocation and authentication-epoch events;
- public Security-details state.

The package contains no cryptographic or orchestration logic.

### `packages/shared`

Own:

- canonical CBOR grant codecs;
- grant to-be-signed domain separation and digest construction;
- signature and claims validation primitives;
- account-grant transcript/prologue construction;
- auth-mode negotiation rules;
- deterministic reason codes for rejected grants.

Hub access, storage, React, Electron, React Native, and connection lifecycle logic do not enter this
package. Existing Noise and record-layer logic is reused.

### `packages/client-runtime`

Add a platform-neutral native account enrollment coordinator and trust resolver. Together they own:

- hardware-key capability checks through platform interfaces;
- idempotent enrollment reconciliation;
- ticket/grant expiry and retry state;
- trust ordering: local verified, account grant, explicit recovery;
- directory reconciliation and demand priorities;
- publication of connection trust source and Security details.

The existing connection catalog, supervisor, authorization, relay client, and state domains remain the
owners of their current concerns. The coordinator calls them through explicit interfaces rather than
duplicating reconnect logic.

No DOM, Electron, or React Native imports enter `packages/client-runtime`.

### `apps/desktop`

Desktop supplies its hardware-key adapter, device metadata, Hub login integration, and presentation.
Automatic node claim and Local Trusted Introduction remain the preferred path for the colocated node.
Remote nodes use the shared account enrollment flow.

### `apps/mobile`

Mobile supplies Secure Enclave/StrongBox/TEE adapters and native screens. The current verification route
is removed from normal onboarding and retained behind **Verify independently** or secure recovery.
Platform code reports the actual key-backing class; JavaScript cannot claim hardware custody on its own.

### `apps/server`

Add a narrowly scoped account-grant verifier beside the existing authorization boundary. It consumes
the authenticated Hub keyset and current ticket context, validates the grant using shared primitives,
intersects authority, and returns an ephemeral admission decision.

The node's durable approved-client store remains separate and unchanged by account grants. WebSocket/RPC
session reporting exposes the admission source without exposing the signed grant.

### Hub contract

The public Hub boundary gains:

- idempotent device enrollment and metadata update;
- list and revoke device operations;
- relay ticket responses with node-bound grants;
- signing-key discovery/rotation metadata;
- authentication epoch and revocation propagation.

This repository must document only the public contract and security semantics, not private deployment or
operational details.

## User experience

### Normal native onboarding

There is no E2EE wizard in the normal path. After login, the app shows a short `Securing this device`
state while ensuring keys and enrollment. Authorized machines then appear and connect according to
demand. The first application view is published only after the encrypted channel and current snapshot
are ready.

A new-device account notification is informational and supports audit/revocation. It is not an approval
gate.

### Connection labels

Every connection exposes one clear status:

- **Encrypted · Verified locally**
- **Encrypted · Account trusted**
- **Encrypted web**
- **Legacy connection**

The UI does not label account enrollment as independently verified or imply protection from a malicious
Hub.

### Security details

The user can inspect:

- device label, platform, enrollment identifier, and key-backing class;
- client identity and agreement-key fingerprints;
- node identity fingerprint;
- safety number;
- trust source and policy;
- first enrolled, last used, and last identity-change times;
- independent verification state;
- current connection and revocation state.

The transient grant itself is not displayed or persisted for UX. Exact expiry may appear in diagnostics,
but normal UI should not create churn around two-minute credentials.

Actions include **Verify independently**, **Rename device**, and **Revoke device**. Independent
verification upgrades future matching connections to `locally-verified` without changing the device's
account enrollment.

For the current device, the key-backing label comes from the native adapter's local verification. For a
different device, it is shown as **reported backing** unless a future remote-attestation design provides
independent evidence.

### Direct mode

When the app is not connected to a Hub, Hub enrollment controls are hidden or replaced with a clear
explanation. The UI must not call Hub E2EE endpoints and render an opaque generic error.

## Performance requirements

- The grant is returned with the existing relay ticket; no new per-node request is added after directory
  discovery.
- Initial key creation runs once per installation. Enrollment and expiring prekey-certificate renewal
  reconcile idempotently on later logins.
- Enrollment refresh and directory refresh run in parallel when their inputs permit.
- Ticket preparation, relay setup, and client-side handshake preparation remain parallelized where safe.
- Existing demand caps, foreground prioritization, and staggered reconnect behavior remain in force.
- High-priority nodes connect first; remaining online nodes are swept only for bounded cached metadata.
- Grant parsing and signature verification occur before expensive or stateful node work where possible.

Release qualification compares median and tail time-to-first-current-snapshot against the existing
manual-approved reconnect baseline. The automatic path must not add a network round trip and must not
materially regress warm reconnect latency or reconnect-burst stability.

## Security and privacy requirements

- P-256 identity private keys remain hardware-backed and non-exportable. X25519 agreement secrets remain
  device-only, non-synchronizing, excluded from backup and transfer, and transiently borrowed and
  zeroized according to the existing protocol custody rules.
- The Hub never receives Noise session keys or plaintext application data.
- Grants, tickets, DPoP proofs, request bodies, authenticated RPC, relay traffic, and node content are
  never cached by the production service worker.
- Grants are not persisted beyond the bounded reconnect attempt unless an encrypted in-memory cache is
  required for coalescing the same ticket request. They are never written to general application state.
- Telemetry contains only bounded counts, latency distributions, platform capability classes, and stable
  failure categories. It excludes keys, fingerprints, safety numbers, account identifiers, node
  identifiers, tickets, grants, and application payloads.
- Unknown fields that affect authority, unknown enum values, non-canonical encodings, signature failures,
  time failures, and binding mismatches fail closed.
- Error handling must not flush buffered plaintext after a failed or downgraded handshake.

## Testing strategy

### Shared protocol tests

Add deterministic vectors and negative cases for:

- canonical claim and envelope encoding;
- grant signature and domain separation;
- wrong Hub origin, account epoch, device epoch, enrollment, enrollment revision, device identity,
  agreement key, client certificate, node, node statement, continuity identifier,
  policy generation, ticket, role, capability, key ID, nonce, or time window;
- non-canonical CBOR, duplicate fields, unsupported versions, truncated envelopes, and unknown enums;
- grant replay on another ticket, node, connection generation, or device key;
- account-grant versus local-approval transcript separation;
- suite downgrade and role/capability escalation attempts.

### Server tests

Cover:

- the complete policy matrix;
- authority intersection;
- precedence of local approval, local denial, and verified node pins;
- no durable approved-client write from account admission;
- ticket and relay-context binding;
- keyset rotation and unknown-key refresh;
- revocation closing active sessions and destroying mutation readiness;
- malformed input rejection before application data is accepted;
- no plaintext or buffered-record release after handshake failure.

### Client-runtime tests

Cover:

- cold login and first enrollment;
- restored login and idempotent upsert;
- reinstall/key loss and superseded enrollment handling;
- enrollment, ticket, and grant expiry races;
- offline cached read-only behavior;
- concurrent directory refresh and reconnect;
- demand ordering and connection caps;
- crash/restart recovery;
- locally verified trust precedence;
- account-trusted node identity replacement, statement binding, and policy-generation rollback rejection;
- generation fencing and snapshot-before-mutation.

### Platform tests

- iOS must demonstrate a non-exportable Secure Enclave P-256 identity, `ThisDeviceOnly` agreement-secret
  custody, and correct behavior after reinstall or biometric/device state changes.
- Android must distinguish StrongBox, hardware-backed TEE, and software-only P-256 identities, and must
  prove agreement-secret backup/transfer exclusion. StrongBox and TEE identities are accepted at their
  reported assurance levels; software-only identities are rejected.
- Desktop must preserve Local Trusted Introduction precedence and secure storage semantics.
- Simulators and emulators may test state machines but do not qualify hardware custody.

### Browser and service-worker tests

- Web remains NX-only and cannot negotiate or submit a native account grant.
- Complete the missing F10, F7, and admitted F3 Chromium vector coverage.
- Update the browser manifest to match the wired qualification suite.
- Verify that production service-worker rules never cache Hub APIs, tickets, grants, authenticated RPC,
  relay traffic, request bodies, or application documents.
- Fix and cover the direct-mode Security surface so it does not call Hub-only operations.

### Cross-version and end-to-end qualification

Qualify old and new clients, nodes, and Hub capabilities in every supported combination. Incompatible
native combinations must show `Update required` or an explicit secure recovery path; none may silently
select legacy transport.

The final interactive matrix includes:

- two live online nodes;
- a fresh Desktop installation;
- a physical iPhone installation;
- representative Android StrongBox and TEE devices;
- hosted Chrome for the weaker web tier and Security controls;
- direct/non-Hub Chrome for the corrected Security state;
- revocation while a native channel is active;
- independent verification followed by a malicious Hub key-substitution attempt.

Computer Use may drive Desktop and Chrome qualification. Physical-device evidence is required for native
hardware-key claims.

## Audit and release gates

The feature ships through separate Hub, node, and client capability flags:

1. Land schemas, codecs, verification, and negative vectors with the feature disabled.
2. Enable Hub grant issuance only for test accounts and nodes advertising support.
3. Enable node shadow validation without accepting account admission.
4. Enable opt-in native account admission for internal qualification.
5. Complete cross-version, malicious-relay, revocation, hardware, and browser qualification.
6. Enable account enrollment by default for compatible native clients and nodes.
7. Consider changing broader E2EE policy defaults only after independent audit and operational review.

Before step 6:

- commission an independent review of the first-party Noise state machine;
- perform protocol/security review of the account-grant claims, signature domain, Noise transcript, and
  downgrade resistance;
- complete the outstanding Chromium vectors and correct their manifest;
- reconcile `docs/relay-e2ee-noise-audit-scope.md` with the current Noble version, audit baseline, and
  explicit owner acceptance;
- pass the full targeted native, server, browser, cross-version, and end-to-end qualification matrix;
- confirm that telemetry and logs contain none of the prohibited security material.

Rollback disables new grant issuance and account admission while leaving locally verified native IK,
manual recovery, Web NX, and compatible existing clients available under their configured policies.

## Acceptance criteria

1. On a fresh compatible native installation, signing in is sufficient to create or restore an account
   enrollment, discover authorized online nodes, and load their current snapshots without QR codes,
   fingerprints, or another approval action.
2. The first node-owned application data is processed only after a valid ticket-bound grant, successful
   account-grant Noise IK handshake, and current snapshot readiness.
3. The normal ticket-and-connect path adds no per-node network round trip for the grant.
4. Locally verified pins and denials always outrank Hub account enrollment and are never silently
   overwritten or downgraded.
5. Device or account revocation prevents new grants, closes live relay channels, and immediately removes
   read and mutation readiness on connected clients.
6. Unsupported, malformed, expired, revoked, or downgraded native paths fail closed without plaintext
   fallback.
7. Web remains available under its explicit weaker tier and never obtains native trust semantics.
8. Users can inspect client and node fingerprints, safety numbers, hardware backing, trust source, and
   device history, and can independently verify or revoke a device at any time.
9. Android automatic enrollment works with verified StrongBox or hardware-backed TEE identity custody,
   preserves backup-excluded agreement-key storage, and rejects software-only identities.
10. Direct-mode Security UI does not perform Hub-only operations or display the current opaque Hub error.
11. Warm reconnect and reconnect-burst performance remain within the established baseline while retaining
    snapshot-before-mutation and stale-generation fencing.

## Follow-up work outside this design

An encrypted, account-portable Hub data mirror may later support offline browsing and recovery when all
nodes are offline. That feature requires a separate account-root-key, synchronization, conflict,
retention, recovery, and metadata-leakage design. It is intentionally not coupled to automatic live-node
enrollment.

Passkey PRF, OPAQUE, or key-transparency mechanisms may later reduce trust in the Hub or provide stronger
cross-device account recovery. They are not required for the selected login-only trust model and should
not delay this implementation.

## References

- `docs/relay-e2ee-protocol.md`
- `docs/relay-e2ee-noise-audit-scope.md`
- `docs/hub-connector.md`
- `docs/superpowers/specs/2026-08-29-cross-node-trust-readiness-and-parity-design.md`
- [RFC 9449: OAuth 2.0 Demonstrating Proof of Possession](https://www.rfc-editor.org/rfc/rfc9449)
- [Web Authentication Level 3 PRF extension](https://www.w3.org/TR/webauthn-3/#sctn-prf-extension)
- [RFC 9807: The OPAQUE Asymmetric PAKE Protocol](https://www.rfc-editor.org/rfc/rfc9807)
