# Relay E2EE Noise state machine — third-party audit scope

This document scopes a security audit of one module: the first-party Noise handshake state
machine of the Ryco relay E2EE protocol. It exists so that commissioning the audit is a short
email rather than a research project.

The audit is not optional polish. [§14.1 of the protocol](./relay-e2ee-protocol.md) makes a
scoped third-party audit of this module a **precondition for flipping the `requireE2EE` default**
(§12.3), and §17.1 records the unaudited state machine as the protocol's largest open risk,
carried deliberately until that audit completes.

All `§` references below are to [`docs/relay-e2ee-protocol.md`](./relay-e2ee-protocol.md), the
normative specification, unless a reference says "Noise §", which means the Noise Protocol
Framework at the revision named in [section 3](#3-protocol-names-spec-revision-and-the-exporter).

## 1. What is being audited

**In scope — one file:**

| Path                                         | Lines | Role                                     |
| -------------------------------------------- | ----- | ---------------------------------------- |
| `packages/shared/src/relayE2eeNoise.ts`      | 978   | The state machine. The audit target.     |
| `packages/shared/src/relayE2eeNoise.test.ts` | 1,088 | Its colocated suite, 46 cases. Evidence. |

The module is heavily commented; the executable surface is roughly half its line count. It
is a single file by protocol obligation, not by accident: §14.1 permits **exactly one** first-party
module implementing the Noise `CipherState`/`SymmetricState`/`HandshakeState` composition, and that
bound is what makes a scoped audit possible at all.

**What the module does.** For the two protocol names of §3.4, at the Noise revision of §3.2:
`Initialize` (protocol name, prologue, IK pre-message static), `WriteMessage`/`ReadMessage` for the
two message patterns, `MixKey`/`MixHash`/`EncryptAndHash`/`DecryptAndHash`, the handshake
`CipherState` with its nonce, `Split()`, and the §6.5 exporter. It enforces message ordering,
single use, and its own key-material length preconditions.

**What it delegates to the audited primitives.** Every AEAD, hash, HMAC/HKDF, and curve operation
is a call into `@noble/ciphers`, `@noble/hashes`, or `@noble/curves`, through their documented
public entry points only (§14.6). §14.1 requires the module to "perform no primitive arithmetic of
its own". Confirming that it in fact performs none is a legitimate audit question; performing an
analysis of the primitives is not (section 4).

**What it deliberately does not do** — each of these is a boundary the auditor should hold the code
to, not a gap:

- **No transport encryption.** §6.5 consumes the two `Split()` outputs as the directional epoch-0
  secrets of §9 and forbids using the Noise cipher states for transport, so `split()` returns raw
  key bytes and no post-handshake `CipherState` is ever constructed. Record protection, the
  `epoch ‖ counter` record nonce, AEAD framing, and the rekey ratchet live in
  `packages/shared/src/relayE2eeWire.ts` and are outside this scope.
- **No §8 payload schema enforcement.** The §8.5 rule that an NX message-1 payload MUST be
  zero-length, the CBOR payload shapes of §8.5/§8.7, and the ordering of responder checks in §8.6
  belong to the handshake driver. The module carries whatever payload bytes it is given, because
  the official §16.3 F15 vectors carry payloads on every message of both patterns and the module
  MUST reproduce them exactly.
- **No clock, no channel state, no logging, no I/O, no network, no persistence.**

**Context, not scope.** These siblings are worth reading to understand the module's callers, but
they are not the audit target: `relayE2eeConstants.ts` (§3.2 constants), `relayE2eeWire.ts`
(envelope codec, record framing, AAD/nonce), `relayE2eeTranscripts.ts` (the §8.4 prologue and the
§7 certificate transcripts), `relayE2eeKeys.ts`, `relayE2eeVerificationDisplay.ts`.

## 2. Why a first-party implementation exists

The library policy this protocol was drafted under required an **audited** full Noise
implementation, with primitive packages alone explicitly not satisfying the requirement, and a hard
stop rather than a bespoke composition if no qualifying dependency existed. That stop condition
fired. §14.1 records the resolution verbatim as an accepted deviation:

> No audited pure-TS Noise implementation exists (research verdict, 2026-07-30). Owner accepted:
> first-party minimal frozen Noise IK+NX state machine implemented in `packages/shared` on audited
> noble primitives.

The survey behind that verdict found the gap structural rather than a search failure:

- No pure-TS/JS Noise implementation has ever been audited **as** a Noise implementation.
- The libraries that cover IK+NX are built on native-binding or unaudited-JS sodium splits, with no
  Hermes support — and Ryco needs Bun, evergreen browsers, and Hermes from one codebase.
- No JS Noise library exposes a supported exporter or post-`Split()` derivation API, which §6.5
  requires.
- The one widely deployed JS Noise library is XX-only, WASM-assisted, and carries CVE-2022-24759 —
  an unvalidated handshake-payload signature permitting MITM — which is itself a concrete
  demonstration of how unaudited handshake state machines fail.

§14.1 bounds the deviation with normative obligations: the single frozen module above; official
Noise vectors MUST pass; cross-implementation vectors against at least one independent
implementation MUST pass; property-based tests MUST cover the state machine; the full adversarial
suite MUST run against it; and **this audit** is required before the `requireE2EE` default flip.

## 3. Protocol names, spec revision, and the exporter

- **Native signed tier (IK):** `Noise_IK_25519_ChaChaPoly_SHA256`
- **Web tier (NX):** `Noise_NX_25519_ChaChaPoly_SHA256`
- Both are suite `0x01` in the §3.4 registry. X25519 (RFC 7748), ChaCha20-Poly1305 (RFC 8439),
  SHA-256. The client is always the initiator and the node always the responder (§8.1).
- **Noise Protocol Framework revision 34** (`NOISE_SPEC_REVISION`, §3.2). Both protocol names are
  exactly 32 bytes, so `InitializeSymmetric` takes the zero-padding branch, not the hashing branch.
- **Prologue:** the canonical-CBOR array of §8.4, domain-separated by
  `"ryco.relay-e2ee.prologue.v1"` and containing the channel id, so every Noise message and derived
  key is channel-unique. The module receives it as opaque bytes.

**The exporter is first-party, not standard Noise.** §6.5 defines exactly three extractable values
and forbids extracting anything else from handshake state:

```text
(k_c2n, k_n2c)      = Noise Split() outputs, in Noise order (initiator-to-responder first)
epochSecret_c2n[0]  = k_c2n
epochSecret_n2c[0]  = k_n2c
exporterSecret      = HKDF-Expand(ck_final, "ryco.relay-e2ee.exporter.v1", 32)
```

`ck_final` is the Noise chaining key at the moment `Split()` is invoked. The chaining key itself is
never handed out; `split()` derives all three values and erases the symmetric state before
returning. `exporterSecret` feeds only `serverConfirmationKey` (§8.7). §14.6 satisfies its
no-undocumented-internals rule by construction here: the exporter **is** this protocol's documented
API, because the state machine defining it is first-party.

## 4. Threat model to assume

**The relay is a fully active man-in-the-middle.** The Hub authenticates both relay connections,
mints the single-use tickets, and authors `channel.open` including its `capability` and
`effectiveRole` fields; node ids and channel ids are Hub-minted. Nothing in the relay protocol lets
a node distinguish a genuine client from a session the Hub originated itself (§2.1). The auditor
should assume the adversary controls all traffic and all timing between the endpoints and may
substitute, reorder, replay, truncate, drop, or originate messages at will. E2EE treats the Hub's
own ordering and size checks as untrusted.

**Endpoints are honest.** Compromise of the node host or the client device is outside the threat
model (§2.6), as are traffic analysis of the §2.5 metadata, an operator-proof web client (§2.4),
cryptographic attribution of an abrupt close, and post-compromise recovery within an open channel.

**Explicitly out of scope: the primitives.** They are independently audited, and re-auditing them is
not what this engagement buys. §14.2 states the lineage exactly:

| Package          | Independent audit                          | Scope relevant here                                                                                                      |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@noble/curves`  | Cure53, September 2024 (baseline `1.6.0`)  | Scope includes ed25519, ed448, hash-to-curve, and the low-level Edwards **and Montgomery** modules — X25519 is in scope. |
| `@noble/curves`  | Trail of Bits, February 2023 (v0.7.3)      | Abstract Weierstrass, modular arithmetic, hash-to-curve, secp256k1.                                                      |
| `@noble/curves`  | Kudelski Security, September 2023 (v1.2.0) | Curve, modular, Poseidon, Weierstrass modules.                                                                           |
| `@noble/ciphers` | Cure53, September 2024 (baseline `1.0.0`)  | Full scope, explicitly including ChaCha20 and Poly1305 — exactly the suite AEAD.                                         |
| `@noble/hashes`  | Cure53, January 2022 (baseline `1.0.0`)    | Everything except BLAKE3, SHA-3 addons, SHA-1, and Argon2 — SHA-256, HMAC, and HKDF are in scope.                        |

Pinned versions in this repository are `@noble/curves@1.9.7`, `@noble/ciphers@1.3.0`, and
`@noble/hashes@1.8.0` — each within the independently audited major lineage and not older than its
baseline, as §14.2's pin-audited-lineage rule requires. Two caveats, stated plainly rather than
buried: P-256 is a thin configuration over the audited abstract Weierstrass code but the top-level
NIST-curve module was never named in an independent audit scope, and the 2.x lines carry only a
maintainer self-audit. Neither affects this module — it uses X25519, ChaCha20-Poly1305, SHA-256,
and HKDF only, and touches no P-256 and no CBOR.

Also accepted, not findings: JavaScript cannot guarantee constant-time execution under JIT and GC
(§17.2), and zeroization in a managed runtime bounds but cannot eliminate residual copies (§17.3).
Timing and memory-residue observations are welcome as context; they are known and accepted risks.

## 5. Questions worth the auditor's attention

1. **Message ordering and single-use enforcement.** The two patterns are two messages long, so the
   sequence is fixed and every other order must be rejected. The module distinguishes two failure
   classes deliberately: a precondition rejection (calling an operation this party does not owe)
   touches no state and leaves a live handshake usable, while any failure raised while _processing_
   a message destroys the handshake, because a partially applied message leaves a symmetric state
   no conforming peer can agree with. Is that split correct, and is it exploitable? Is `split()`
   reachable exactly once, only after both messages, with every later operation refused? §8.1
   allows exactly one handshake attempt per channel.
2. **Nonce handling and exhaustion.** The handshake cipher nonce is Noise §5.1's 32 zero bits
   followed by little-endian `n`. Every AEAD invocation in both patterns should use counter 0,
   because each is preceded by a `MixKey()` that resets the counter — meaning no handshake
   transcript can distinguish this encoding from a wrong one, which is exactly why it is pinned by
   literal test vectors instead. Is there any reachable path that reuses a `(key, nonce)` pair? Is
   `n` incremented only on successful decryption? Is `2^64 − 1` correctly reserved rather than used?
3. **The exporter derivation.** `Split()` is `HKDF(ck_final, empty, 2)` and the exporter is
   `HKDF-Expand(ck_final, "ryco.relay-e2ee.exporter.v1", 32)` over the _same_ chaining key. Is that
   domain separation sound, and is the exporter output independent of the two split outputs? A
   second question underneath it: the module expresses Noise §4.3's `HKDF(ck, ikm, 2)` on RFC 5869
   `extract`/`expand` rather than on a hand-rolled HMAC chain. The claimed identity — Noise's
   `temp_key` is `extract` with the chaining key as salt, and Noise's two outputs are the first
   2·HASHLEN bytes of `expand` with empty `info` — is the single most load-bearing rewrite in the
   file and deserves direct verification.
4. **Erasure.** §6.5 and §9.5 require the ephemeral private key, the static copy, the chaining key,
   the handshake hash, and the cipher state to be overwritten with zeros. Are all of them zeroed on
   `split()`, on `destroy()`, and on every failure path? Are intermediate buffers (HKDF outputs,
   shared secrets, derived nonces) zeroed? Does the module ever retain a reference to a caller's
   buffer, or hand back a view aliasing internal state? Ownership of the test-only injected
   ephemeral is worth a look.
5. **The all-zero DH abort.** §8.1 and §14.3 make an all-zero X25519 output — the invalid and
   low-order input case — a mandatory handshake abort, signalled by the pinned primitive's own
   throw. The module does not catch or reclassify it. Is there any path where a zero shared secret
   could be mixed instead of aborting? Relatedly, §11.2 requires every pre-key failure to be
   externally indistinguishable; the module's `reason` field is documented as local classification
   only and must never reach a peer, a log, or an error surface. Does the code make that easy to
   honour, or easy to leak?
6. **Do the §8.10 payload security properties actually hold for this implementation?** §8.10 makes
   no blanket claim; it states a Noise authentication/confidentiality grade per payload and per
   direction, and the whole tier story of §2.2 rests on it:

   | Payload / direction           | Auth | Conf | Claim that must hold                                             |
   | ----------------------------- | ---- | ---- | ---------------------------------------------------------------- |
   | IK message-1 payload          | 1    | 2    | KCI against the node agreement key; no forward secrecy           |
   | IK message-2 payload          | 2    | 4    | KCI-resistant; weak FS conditional on the node agreement prekey  |
   | IK transport, both directions | 2    | 5    | Mutual static auth, KCI-resistant, strong forward secrecy        |
   | NX message-1 payload          | 0    | 0    | Nothing; MUST be empty (enforced by the driver, not this module) |
   | NX message-2 payload          | 2    | 1    | Node authenticated; encrypted to an anonymous ephemeral          |
   | NX client→node transport      | 0    | 5    | **The client is never authenticated at the Noise level**         |
   | NX node→client transport      | 2    | 1    | Node-authenticated to whoever initiated; FS via `ee`             |

   The question is whether the code as written realizes exactly those grades — no accidental
   strengthening, and more importantly no accidental weakening. Concretely: are the message-pattern
   token sequences right; does `#mixDh` resolve each DH token's local and remote key correctly for
   _both_ roles (`es` is `DH(e, rs)` for the initiator and `DH(s, re)` for the responder, `se` is
   the mirror); is the IK pre-message `MixHash` of the responder static performed identically by
   both parties; and is the prologue mixed before it? Identity hiding is part of the same question:
   the IK client static and certificate are encrypted under keys derived from `es` only, so they are
   hidden from passive observers but readable — including retroactively — by any holder of the node
   agreement private key. That exposure is documented and accepted; silently widening it would not
   be.

## 6. Evidence available to the auditor

| Evidence                                       | Status                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| The specification                              | Landed: `docs/relay-e2ee-protocol.md`, normative, ~6,200 lines                |
| Colocated unit and golden-transcript suite     | Landed: `packages/shared/src/relayE2eeNoise.test.ts`, 46 cases                |
| Official Noise vectors (§16.3 family F15)      | Landed: `packages/shared/fixtures/e2ee/v1/f15-noise-core-vectors.json`        |
| Cross-implementation vectors                   | Partly landed by F15; see below                                               |
| Property-based state-machine suite             | Landed: `packages/shared/src/relayE2eeNoiseProperties.test.ts`, 23 properties |
| Adversarial suite with a hostile-relay harness | Landed: `packages/shared/src/relayE2eeAttackerRelay.test.ts`, 124 cases       |

That table is deliberately honest: an auditor should know which evidence exists today and which is
an obligation still being discharged. One row remains short of closed — cross-implementation
vectors, discharged by F15 for the official inputs but not for this protocol's own §8.4 prologue and
§8.5/§8.7 payload shapes, as the F15 note below explains. Every other row is landed, and none of
them is a deliverable the auditor is being asked to produce.

**F15, precisely.** The corpus holds the four applicable vectors — the `Noise_IK_25519_ChaChaPoly_SHA256`
and `Noise_NX_25519_ChaChaPoly_SHA256` entries of the published cacophony (Haskell) and snow (Rust)
vector sets, transcoded verbatim, with each source repository, commit, retrieval URL, and upstream
file SHA-256 recorded in the file's `provenance` array and the family file's own digest pinned both
in `manifest.json` and as a literal in the suite. All four pass: every handshake message byte for
byte in both directions, both cacophony handshake hashes, and every post-handshake transport message
under the `Split()` outputs. Those transport messages are what pin `Split()`: the sets publish no
split keys, but each transport ciphertext is produced under one of them, so reproducing them pins
both outputs and their §6.5 order.

Because cacophony and snow are independent implementations in different languages, F15 also
discharges most of the cross-implementation row: identical static keys, ephemerals, prologues, and
payloads produce identical transcripts and `Split()` outputs against two of them. What it does not
cover is this protocol's own inputs — a §8.4 canonical-CBOR prologue and the §8.5/§8.7 payload
shapes run against a live third-party implementation — so that row is marked partly landed rather
than closed.

**What the landed suite already pins**, all as exact byte literals so that any change to a token
order, a DH argument, the nonce encoding, the HKDF chain, a protocol name, or the exporter label
fails a test:

- Byte-exact golden transcripts and all three session values for both patterns, cross-checked
  against a straight-line transcription of the revision-34 pseudocode written independently of the
  module under test. The static keys are the published RFC 7748 §6.1 X25519 test vectors, so a wrong
  curve or a wrong encoding shows up immediately.
- The Noise cipher-nonce encoding, the reserved `2^64 − 1` value, the exporter label and derivation.
- Ordering: operations neither party owes, second writes, second reads, `split()` before both
  messages, and single-use behaviour after both `split()` and `destroy()`.
- The all-zero X25519 abort in three distinct positions (IK initiator against a low-order responder
  static, NX initiator against a low-order responder ephemeral, IK responder against a low-order
  initiator ephemeral).
- Handshake aborts on a mutated ciphertext byte, a truncated message, a message beyond the Noise
  bound, a prologue disagreement, and a wrong responder static.
- Role and key-material preconditions, erasure of ephemeral secrets at `split()` and `destroy()`,
  non-mutation of caller buffers, determinism, and re-derivation of every session value when a
  single ephemeral changes.

The golden transcripts explicitly do **not** discharge §14.1's official-vector obligation; they are
a first-party cross-check, and the official vectors are family F15 of the §16 corpus, described
above.

**The property suite, precisely.** `relayE2eeNoiseProperties.test.ts` holds 23 properties in seven
groups, run under `fast-check` with a fixed seed recorded in the file header, so a failure on CI
reproduces byte for byte with no extra flags. It quantifies over what the enumerated suite can only
sample. Message ordering is checked against a model of the module's own status across arbitrary
interleavings of `writeMessage`/`readMessage`/`split`/`destroy` on a real initiator and a real
responder, with the bytes between them chosen adversarially (the peer's genuine message, the party's
own message reflected back, an empty buffer, a corrupted copy) — the property is that no generated
sequence reaches `split()` except through the pattern's exact legal order over authentic bytes, and
that two ends that both split always agree. The two failure classes of section 5 question 1 are
separated as properties: any number of precondition refusals leaves a handshake completing normally,
and every operation after a handshake is spent — by `split()`, by `destroy()`, or by a processing
failure — is refused. Erasure is asserted **on the buffer**, not on a flag, over every prefix of a
handshake and over the failure paths an attacker can force. Mutation and truncation are stated in
the only form that is true for both patterns, since an NX message-1 payload is cleartext and a
mutated one is legitimately read: no mutation and no truncation of any handshake message may leave
the two ends holding the same session keys. The remaining groups cover role symmetry (both roles
reaching one handshake hash and one `Split()`), prologue binding (stated where it actually lives —
in `h`, not in `ck`, which is why a fixed key set under two prologues yields the _same_ `Split()`
outputs and a differing handshake hash), the IK pre-message static, key-material bounds, the
exporter as a pure confined function of `ck`, and the Noise §5.1 nonce encoding against an
independently written little-endian reference.

**The hostile-relay harness, precisely.** `relayE2eeAttackerRelay.test.ts` runs two complete
endpoints — handshake, record session, and close machine — against each other with the relay
between them, and its final section replaces the hand-carried delivery of the earlier sections with
a relay that **owns** delivery: frames are captured into a queue nothing drains on its own, and each
§2.1 capability is one operation — hold and release later, drop, reorder, duplicate (release the
same held frame twice), modify (which subsumes truncate and restamp), reflect, and inject bytes no
endpoint produced. The harness adds no key material; cases needing a record that is authentic but
non-conforming still say so and still mint it from a peer's own keys. What the schedule buys over
value mutation is the second half of each attack: the withheld record released into the erasure the
overtaking one caused, the same across a §9.4 rekey boundary, the duplicate landing after the peer
moved on, the genuine implicit finish released after an injected record spent the node's session, an
ack held past `T_CLOSE` and released after the verdict, and — the case only a schedule can state —
the relay **keeping** the single §11.3 `E2EEError`, which leaves the two ends in the asymmetric state
§10.4 resolves as an unattributed **Unclean — abrupt** rather than in one either side can be walked
out of.

**One accessor exists only for F15.** `E2eeNoiseHandshake.testOnlyHandshakeHash` returns the Noise
§5.2 handshake hash of a live handshake and `undefined` once `split()` or `destroy()` has erased it.
Nothing in the protocol consumes `h` — §6.5 fixes the three extractable values and requires the
handshake hash to be erased, and §8.7/§8.8 hash exact wire bytes instead — but the cacophony vectors
publish a `handshake_hash` per vector and `h` is unobservable through every other surface here,
since the `Split()` outputs and the exporter all derive from `ck`. The accessor is the only way that
field could be checked rather than silently dropped, and the suite asserts it returns `undefined`
after erasure, so it witnesses the §6.5 rule rather than weakening it. An auditor should confirm
that no production path reads it.

## 7. Practical notes

**Repository.** `https://github.com/sak0a/ryco` — public, MIT licensed, a Bun monorepo. Everything
named in this document is in the public repository; no private infrastructure is involved in the
audit.

**Build and test.**

```sh
bun install --frozen-lockfile
bun run test                       # whole repository (Vitest)
bun run --cwd packages/shared test # the module's own suite
bun typecheck
```

Use the Bun version pinned in `package.json` (`engines.bun`, currently `^1.3.14`). Never invoke
`bun test`, which runs Bun's own runner instead of the configured Vitest setup and will not execute
these suites.

**Minimal reproduction environment.** The module is pure computation: no clock, no network, no
filesystem, no database, no build step of its own. Its complete closure is the file itself, two
intra-repo imports (`relayE2eeConstants.ts` for the §3.2 sizes, and two pattern constants and a type
from `relayE2eeTranscripts.ts`), and the three noble packages. An auditor who prefers to work
outside the monorepo can copy those files into a bare Bun or Node project with the three pinned
dependencies and run the state machine standalone; nothing in it requires the rest of Ryco to exist.
Deterministic handshakes are available through the module's test-only ephemeral injection, which is
the same mechanism the §16.1 fixture generator uses.

**Reporting.** Findings anchored to specification section numbers are the most useful form, since
every rule this module implements has one.

## 8. Readiness

**The module is stable and the audit can be commissioned.** The state machine was written before the
implementation phases that exercise it, and it has now been driven from both directions: the node
responder (`apps/server/src/hubConnector/NodeE2eeChannelSession.ts`) and the client initiator
(`packages/client-runtime/src/relay/relayE2eeInitiator.ts`) both complete real IK handshakes against
it, and the §16.3 corpus is generated through it. That was the point of auditing after those phases
rather than before: the file has not changed since the client and node work landed, so an audit
commissioned now is auditing the code that ships.

**The two §14.1 evidence obligations that were outstanding are now landed** — the property-based
state-machine suite and the adversarial suite driven through a hostile-relay harness, both described
in section 6. Neither was ever a deliverable the auditor was asked to produce; they are the
evidence the engagement is read alongside, and an auditor should find them in the tree rather than
be told they are coming. The one row still short of closed is the cross-implementation vectors,
which F15 discharges for the official inputs but not for this protocol's own §8.4 prologue and
§8.5/§8.7 payload shapes.

What the audit gates, precisely: §14.1 makes it a precondition for flipping the `requireE2EE` default
(§12.3), and nothing else. Every tier below that default ships without it. §17.1 carries the
unaudited state machine as the protocol's largest open risk until the audit closes.
