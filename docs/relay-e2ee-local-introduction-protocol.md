# Ryco E2EE Local Trusted Introduction protocol 1

## 1. Status and scope

This document is the normative extension that lets a signed Ryco Desktop application and the
Ryco backend process it spawned establish the native E2EE trust state defined by
[`relay-e2ee-protocol.md`](./relay-e2ee-protocol.md) without asking the owner to compare the
ordinary first-contact safety number on the same computer.

The extension does not change the relay frame set, the relay E2EE handshake, the Hub ticket, or
the Hub's authority. It replaces only the owner comparison in relay E2EE protocol 1 §13.2 with an
authenticated operating-system-local introduction. Its output is the same Branch A approved
client record on the node and the same verified native pin on the client. Application traffic is
still released only after a fresh relay ticket, channel, and IK handshake proves both introduced
keys.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are interpreted as in RFC 2119 and
RFC 8174.

Cross-device introduction, QR payloads, account recovery, and Hub-mediated key synchronization
are out of scope. They require their own protocol. This protocol MUST NOT be used when Desktop is
connecting to a backend it did not spawn.

## 2. Security boundary

The Local Trusted Introduction (LTI) trust anchor is the authenticated control relationship
between the native Desktop main process and its exact backend child process. It is not:

- Hub login, email verification, a Hub account or space identifier;
- a Hub node directory entry, node id, node claim response, or relay ticket by itself;
- a renderer, WebView, ordinary browser, loopback origin, cookie, or local owner session;
- a self-signed node capability statement delivered through the Hub; or
- possession of either public key without its corresponding signature.

The Hub may observe account and node routing metadata, replace relay traffic, and return arbitrary
claim and directory values. It MUST remain unable to make Desktop verify a node key other than the
one held by the authenticated child, or make the node approve a client key other than the one held
by Desktop's protected device-key adapter.

The following are required of a conforming local control channel:

1. Desktop creates at least 192 bits of random control secret before spawning the backend.
2. It passes that secret to the child through an inherited anonymous pipe or an equivalent
   process-private operating-system primitive. Environment variables, command-line arguments,
   files readable by the renderer, and renderer IPC return values are forbidden.
3. The child accepts LTI requests only in Desktop runtime mode, only on a loopback-bound listener,
   and only with the exact secret under a constant-time comparison.
4. The secret is distinct from every browser bootstrap, cookie, bearer, DPoP, relay, and Hub
   credential. It is never returned to preload or renderer code.
5. The child invalidates the secret when the process exits. Desktop invalidates it when that exact
   child exits and mints a new one for a replacement child.
6. Requests are bounded, use POST, reject redirects, and never log request or response bodies.

Plain loopback without all of these properties is not an authenticated local channel and MUST NOT
enable this protocol.

## 3. Keys and custody

LTI reuses, without changing their meaning, the three key families from relay E2EE protocol 1:

| Party   | Key                | Algorithm | Use                                                                 |
| ------- | ------------------ | --------- | ------------------------------------------------------------------- |
| Node    | node identity      | Ed25519   | Signs the approval attestation and later capability statements      |
| Desktop | client identity    | P-256     | Signs the introduction request and later client prekey certificates |
| Desktop | agreement identity | X25519    | Becomes the native IK initiator static key                          |

The node identity key MUST be the active key of the backend child and MUST equal the key used in
the just-completed automatic Hub node claim. Desktop performs that equality check before it signs
an introduction request. The backend independently checks the request's Hub origin, environment
id, node id, and node public key against its own active identity before approving anything.

The P-256 identity MUST be non-exportable and hardware-backed. On Apple platforms it MUST use the
Secure Enclave when available. On Android it MUST use a hardware-backed Android Keystore key when
the device reports hardware or StrongBox custody. Windows and Linux adapters may claim support
only when they can provide equivalent non-exportability and user-bound application custody.

The X25519 secret is not supported by the named hardware stores. It MUST use the device-only,
non-synchronizing, non-backup secure-store class required by relay E2EE protocol 1 §6.3 and MUST
be borrowed and zeroized exactly as that section requires.

An implementation that cannot establish the required custody MUST report LTI as unavailable. It
MUST NOT substitute a software P-256 key, silently perform ordinary first-contact promotion, or
label the result verified. The existing explicit pairing ceremony remains available.

## 4. Constants and identifiers

| Name                       | Value                                      |
| -------------------------- | ------------------------------------------ |
| `LTI_PROTOCOL_VERSION`     | `1`                                        |
| `LTI_REQUEST_DOMAIN`       | `ryco.e2ee.local-introduction.request.v1`  |
| `LTI_APPROVAL_DOMAIN`      | `ryco.e2ee.local-introduction.approval.v1` |
| `LTI_DIGEST_DOMAIN`        | `ryco.e2ee.local-introduction.digest.v1`   |
| `LTI_ID_BYTES`             | `32`                                       |
| `LTI_NONCE_BYTES`          | `32`                                       |
| `LTI_DIGEST_BYTES`         | `32`                                       |
| `LTI_MAX_TRANSCRIPT_BYTES` | `4096`                                     |
| `LTI_MAX_LIFETIME_MS`      | `300000`                                   |
| `LTI_CLOCK_SKEW_MS`        | `30000`                                    |
| `LTI_MAX_LABEL_CHARS`      | the relay E2EE client display-label bound  |
| `LTI_MAX_CAPABILITIES`     | `32`                                       |
| `LTI_LEDGER_MAX_ENTRIES`   | `64`                                       |
| `LTI_LEDGER_RETENTION_MS`  | `86400000`                                 |

`introductionId` and `nonce` are independent uniformly random byte strings generated by the
Desktop device-key adapter's CSPRNG. `introductionId` is the idempotency key. `nonce` prevents two
otherwise identical introductions from sharing a signed message.

The following string forms are admitted:

- canonical HTTPS Hub origins, plus the relay protocol's explicit loopback development exception;
- account ids admitted by relay E2EE protocol 1;
- `nclaim_` followed by 22–43 unpadded base64url characters;
- `install_` followed by 22–43 unpadded base64url characters;
- `env_` followed by exactly 22 unpadded base64url characters;
- `node_` followed by 22–43 unpadded base64url characters;
- roles admitted by the relay contract, ordered `viewer < operator < owner`; and
- capabilities admitted by the relay contract.

Capability sets are deduplicated and sorted by ascending Unicode code-point order before encoding.
An input that is not already in that canonical form MUST be rejected, not normalized after it has
been signed.

## 5. Encoding and signatures

Every transcript is a canonical CBOR array under the exact RFC 8949 profile and codec pinned by
relay E2EE protocol 1 §3.6. No map, optional trailing field, alternate integer width, or unknown
element is accepted. Timestamps are non-negative safe integers in Unix epoch milliseconds.

P-256 signatures are ECDSA over SHA-256 of the exact request transcript and use the fixed-width
64-byte `r || s` encoding from relay E2EE protocol 1 §7.1. Ed25519 signs the exact approval
transcript. All verification goes through the protocol's single strict verification choke point;
DER, compressed P-256 keys, ZIP-215 Ed25519 acceptance, and malformed curve points are rejected.

`requestDigest` is:

```text
SHA-256(canonical-CBOR([
  LTI_DIGEST_DOMAIN,
  requestTbs
]))
```

where `requestTbs` is carried as a CBOR byte string, not decoded and spliced into the outer array.

## 6. Introduction request

`LocalIntroductionRequestTBS` is a canonical CBOR array of exactly 24 elements in this order:

1. `LTI_REQUEST_DOMAIN`
2. `LTI_PROTOCOL_VERSION`
3. canonical Hub origin
4. account id
5. native node claim id
6. Desktop installation id
7. backend environment id
8. Hub node id returned by the completed claim
9. literal `ed25519`
10. raw node identity public key
11. literal `p256`
12. raw Desktop client identity public key
13. literal `x25519`
14. raw Desktop agreement public key
15. `introductionId`
16. `nonce`
17. maximum role
18. canonical capability array
19. display label, or CBOR `null`
20. node continuity id
21. node policy generation
22. claim completion disposition: `created` or `reconnected`
23. `issuedAt`
24. `expiresAt`

The node identity and both Desktop keys are fingerprinted using relay E2EE protocol 1 §7.1; the
fingerprints are deliberately not carried as redundant fields. Each side recomputes them from the
validated public keys.

`expiresAt` MUST be greater than `issuedAt` and no more than `LTI_MAX_LIFETIME_MS` later. At node
receipt, `issuedAt` MUST NOT be more than `LTI_CLOCK_SKEW_MS` in the future and `expiresAt` MUST be
strictly later than `now - LTI_CLOCK_SKEW_MS`.

Desktop MUST obtain the active child descriptor over the authenticated local channel immediately
before constructing the request. It MUST compare the descriptor's Hub origin, environment id,
node id, node identity public key, and fingerprint with the completed Hub claim. A mismatch aborts
before signing and is presented as a local-node identity conflict, never as a pairing prompt.

The requested role and capability set MUST be no wider than both the claim's effective role and
the Desktop product's fixed native-client policy. Protocol version 1's automatic Desktop policy
is `owner` plus `{ "ryco.rpc" }`. A later capability requires a protocol and product-policy
change; it is not inherited automatically from a future relay contract.

## 7. Node processing and durable approval

The authenticated child performs these steps in order:

1. Bound and decode the request body. Validate the canonical transcript and key encodings.
2. Require Desktop runtime mode and the authenticated process-private control credential.
3. Re-read its active Hub identity. Require exact equality of Hub origin, environment id, node id,
   and node identity public key with request elements 3, 7, 8, and 10.
4. Re-read its continuity id and E2EE policy generation. Require exact equality with elements 20
   and 21. This prevents Desktop from pinning stale classification state after a concurrent node
   rotation or policy change.
5. Check lifetime and require a supported fixed native-client authority ceiling.
6. Verify the P-256 request signature against element 12.
7. Compute `requestDigest` and consult the LTI ledger by `introductionId`.
8. If no ledger entry exists, atomically create or reconcile the exact approved Branch A client
   record keyed by `(hubOrigin, accountId, clientIdentityFingerprint)` and commit a ledger entry.
9. Build and sign the approval transcript from the committed values.

The direct approval is not a bypass around the Branch A store. It MUST use the same approved cap,
role ordering, capability validation, safety-number derivation, revocation retention, live-channel
withdrawal ordering, and protected state file used by ordinary pairing. It differs only in the
evidence that authorizes the transition: the authenticated local channel plus both signatures
replace the owner's manual comparison.

An existing approved record is reconciled only when its authority is exactly equal to the request.
A pending record may be promoted. A revoked record MUST NOT be re-approved automatically. A record
with different authority or a different display label is a conflict and fails closed. The local
flow never widens or relabels a previously approved key by implication.

## 8. Idempotency, crashes, and replay

The node stores a bounded LTI ledger in node-local protected state, never in Hub persistence. One
entry contains only:

- `introductionId` encoded as unpadded base64url;
- `requestDigest` encoded as unpadded base64url;
- committed approval fields needed to reproduce the approval transcript;
- the node's public approval signature, so an exact replay remains possible after key rotation;
- `approvedAt`; and
- unknown forward fields preserved by the state parser.

It MUST NOT store the request signature, nonce, raw request body, private keys, control secret, Hub
session, DPoP token, or relay ticket.

An exact replay of `introductionId` plus `requestDigest` returns the same approval fields and the
stored public approval signature. Ed25519 signing is deterministic, so a re-sign under the same
key would be byte-identical; retaining the signature also makes replay independent of a later node
key rotation. Reuse of an
`introductionId` with any other digest is rejected uniformly. A completed entry may be returned
after request expiry only for exact crash reconciliation; it may never create or modify authority
after expiry.

The authorization record and LTI ledger are separate protected files and cannot be atomically
written across a crash. Reconciliation is therefore fail-closed and idempotent:

- crash before the approved record commits: no approval exists and retry may create it;
- crash after the record commits but before the ledger commits: retry observes only an exact
  equal approved record, writes the ledger, and returns the attestation;
- crash after the ledger commits: exact replay returns the same result;
- crash after the node returns approval but before Desktop promotes the pin: retry returns the
  same approval; Desktop remains unverified until its own durable promotion succeeds.

Ledger pruning first removes entries older than `LTI_LEDGER_RETENTION_MS`, then oldest entries
until at most `LTI_LEDGER_MAX_ENTRIES` remain. Pruning MUST NOT alter client authorization records.

## 9. Approval attestation

`LocalIntroductionApprovalTBS` is a canonical CBOR array of exactly 14 elements:

1. `LTI_APPROVAL_DOMAIN`
2. `LTI_PROTOCOL_VERSION`
3. `requestDigest`
4. literal `approved`
5. raw node identity public key
6. node identity fingerprint
7. client identity fingerprint
8. agreement-key fingerprint
9. maximum role
10. canonical capability array
11. node continuity id
12. node policy generation
13. `approvedAt`
14. the request's `expiresAt`

The three fingerprints are raw 32-byte digests. The node signs this exact transcript with its
active Ed25519 identity key and returns the transcript fields plus the 64-byte signature.

Desktop MUST validate the approval transcript, recompute `requestDigest`, recompute all three
fingerprints, require exact authority/continuity/policy equality with its request, require the
approval node key to equal the just-claimed local node key, and verify the node signature. No
individual successful comparison is sufficient by itself.

## 10. Client pin promotion

Only after §9 succeeds may Desktop atomically promote the matching local node handle to the
`verified` state and set `anyNodeVerified(hubOrigin)` as relay E2EE protocol 1 §13.1 requires. The
verified record contains the node fingerprint, continuity id, policy generation, approval state,
node-id hint, and owner-legacy-consent state defined there. It records that verification method was
`local-trusted-introduction-v1` and the approval time for security UI, but this label grants no
additional authority.

The pin promotion and device-level marker MUST use the same device-only, non-synchronizing,
non-backup store and the same crash-atomic document write as ordinary native pairing. A failure to
write either leaves the selection unverified. The node approval is harmless but unusable until an
exact replay lets Desktop finish promotion.

Desktop then discards the local transcript material and requests a fresh Hub relay ticket. It MUST
open a fresh channel and complete the ordinary signed-capability verification and IK handshake.
The release guard MUST check all of the following before passing any application byte:

- the pin is durably verified;
- the capability statement authenticates to the pinned node identity;
- the IK peer proves the introduced node agreement key under that statement;
- the client proves the introduced P-256 identity and X25519 agreement key;
- the node admits the exact Hub/account/role/capability authorization context; and
- the policy generation is not below the durable high-water mark.

No existing pairing channel or pre-introduction relay channel is upgraded in place.

## 11. Errors and observability

Wire and local API errors are collapsed to bounded stable classes:

- `local_introduction_unavailable`
- `local_introduction_rejected`
- `local_introduction_conflict`
- `local_introduction_expired`
- `local_introduction_custody_unavailable`

Errors MUST NOT include a Hub origin, account, claim, installation, environment, node id,
fingerprint, public key, transcript, signature, nonce, path, control-secret detail, native keychain
status, or raw child-process error. Logs and telemetry may record only the stable class, protocol
version, coarse platform support, success/failure count, and duration bucket. The request and
approval bodies, public-key fingerprints, and node-owned content are never logged.

The security UI MUST distinguish:

- automatically verified on this computer;
- unsupported protected key custody, with ordinary pairing offered;
- approved on the node but not yet committed on this device, with retry offered; and
- local identity conflict, with no automatic fallback.

Dismissal never records trust and never selects Legacy mode.

## 12. Required tests and release gates

The public implementation MUST ship deterministic canonical-CBOR and signature fixtures for:

- one valid request and approval;
- every field substitution independently;
- non-canonical origin, capability ordering, and CBOR;
- malformed P-256, Ed25519, and X25519 keys and signatures;
- request expiry, future issue time, maximum lifetime, and clock-skew boundaries;
- wrong active node, claim, installation, environment, account, continuity id, and policy
  generation;
- exact replay, conflicting replay, all three crash boundaries, concurrent duplicate finish, and
  ledger pruning;
- pending promotion, equal approved reconciliation, revoked refusal, authority conflict, and
  approved-cap saturation;
- renderer access attempts, browser bootstrap-token substitution, missing control credential,
  stale child credential, redirect, non-loopback binding, and non-Desktop runtime;
- pin/marker atomicity, pin-write failure, and fresh-ticket/fresh-IK release gating; and
- unsupported or non-hardware-backed custody refusing the verified label.

At least one fixture verifier MUST be independent of the TypeScript implementation. Release
qualification additionally requires a signed production Desktop build on physical hardware whose
native adapter proves the platform-backed P-256 key is non-exportable. Simulator, unsigned build,
or software-key evidence does not satisfy that gate.

## 13. Residual risks

A same-user process that can inject into the signed Desktop main process, read its memory, control
the backend child, or subvert the operating-system key service is inside this protocol's trusted
computing base. Code signing does not prevent compromise after process launch. The short lifetime,
one-child control credential, hardware identity key, exact active-node comparison, and fresh IK
proof reduce exposure but do not turn a compromised computer into a trustworthy introducer.

Account recovery still restores only Hub account access. Loss of the Desktop secure store, the
hardware key, or every verified native device requires ordinary node-local pairing again. The Hub
never stores an LTI private key, trust pin, approval ledger, or recovery copy and therefore cannot
restore one.
