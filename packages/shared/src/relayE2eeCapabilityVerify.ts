import {
  E2EE_ACCOUNT_ID_MAX_BYTES,
  E2EE_CAPABILITY_STATEMENT_VALIDITY,
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PREKEY_LIFETIME,
} from "./relayE2eeConstants.ts";
import { selectE2eeSuite, type E2eeStatementUnusableReason } from "./relayE2eeHandshake.ts";
import {
  E2EE_NODE_IDENTITY_ALGORITHM,
  e2eeBytesEqual,
  e2eeKeyFingerprint,
  verifyE2eeSignature,
} from "./relayE2eeKeys.ts";
import {
  canonicalizeE2eeHubOrigin,
  decodeNodeE2eeCapabilityStatement,
  encodeNodeE2eeCapabilitySigningEnvelope,
  validateNodeE2eeContinuityChain,
  verifyNodeE2eeCapabilityCrossSignature,
  type E2eeTier,
  type NodeE2eeCapabilityStatement,
  type NodeE2eeCapabilityStatementDecodeFailure,
  type NodeIdentityContinuityChainFailure,
} from "./relayE2eeTranscripts.ts";
import { type E2eeSuiteId } from "./relayE2eeWire.ts";

// The client-side §5.2 capability-statement verifier —
// docs/relay-e2ee-protocol.md §5.2 steps 0–9, with the §5.7 freshness and
// rollback rules, the §6.4 prekey rules, the §7.5 chain rules, and the §7.6
// cross-signature reconstruction it defers to.
//
// PURE LOGIC. It holds no storage, opens no channel, and decides nothing the
// mode machine (§4.4) or the selection resolution (§12.1.1) decides: it is handed
// one statement, the origin the client is connected to, the client's own tier and
// suite policy, a clock, and — when the caller's selection resolved to one — a
// VERIFIED pin, and it answers what §5.2 says about that statement.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE RESULT IS THREE FAILURE VARIANTS AND NOT A BOOLEAN
// ─────────────────────────────────────────────────────────────────────────────
// §5.2 places steps 8 and 9 AFTER every validation step, and says why: "a
// statement that also fails step 6 is an identity event and MUST surface as the
// §13.3 re-verification path, which a version check running earlier would mask".
// A verifier that answered `{ ok: false, reason }` over one flat vocabulary
// leaves that requirement to whoever writes the switch, and the failure mode —
// an identity substitution reported to the owner as an unsupported protocol
// version — is silent.
//
// So the requirement is carried by the TYPE. Each variant has its own reason
// vocabulary and the three do not overlap:
//
//   • `invalid`        — steps 0–5, step 7, and step 6 for a caller holding no
//                        verified pin. Rows K2/K3 of §4.4.
//   • `identity-event` — step 6 with a VERIFIED pin, and nothing else. The §13.3
//                        re-verification path.
//   • `unusable`       — steps 8 and 9, and §8.2's empty suite intersection,
//                        which §5.2 step 8 explicitly gives the same disposition.
//
// A version-range or admitted-pattern failure is therefore INCAPABLE of
// representing an identity substitution: `E2eeStatementUnusableReason` contains
// no identity reason and cannot be widened to hold one without changing §8.2's
// own type. Downstream switches on the variant, never on a boolean.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE IDENTITY EVENT NEEDS A PIN
// ─────────────────────────────────────────────────────────────────────────────
// §5.2 step 6 is scoped to "when a **verified** pin exists for this node", and
// §13.3's surface says "the node you previously verified is presenting a
// different identity" — copy §13.2.1 requires to fire only "when a channel
// resolves to a verified pin and the identity fails to authenticate to it".
// With no pin there is nothing to re-verify against: §12.1.1 classifies such a
// selection, §13.2.1 owns its surface, and §7.6 element 18 calls a statement
// disagreeing with its own chain INVALID. An unpinned chain break therefore
// takes rows K2/K3 as any other invalid statement does. Answering the §13.3 path
// there would hand a Hub — which synthesizes the whole self-signed statement on
// first contact — a re-verification prompt it can raise on every channel at zero
// cost, which is the click-through training §13.3 opens by forbidding.
//
// Steps 8 and 9 are not re-implemented here either. `selectE2eeSuite` already is
// them, together with §8.2, and a second copy would be a second §5.2 step 8.

/**
 * The §13.1 record a selection resolved to, when that record is `verified`.
 *
 * ONLY A VERIFIED PIN MAY BE PASSED. An `unverified` record carries the §13.2
 * pairing flow and anchors nothing — it holds no verified fingerprint and no
 * recorded continuity id — so a caller holding one passes no pin at all and the
 * statement is evaluated on first-contact footing. Which record a channel
 * resolves to is §12.1.1's decision and never anything the statement carries.
 */
export interface NodeE2eeVerifiedPin {
  /** The owner-verified `ryco.node-key.v1` fingerprint (§13.1). */
  readonly identityFingerprint: Uint8Array;
  /** The continuity id recorded at promotion (§7.5, §13.1). */
  readonly continuityId: string;
}

export interface NodeE2eeCapabilityVerificationInput {
  /** The §7.6 statement CBOR, exactly as the §5.3 carrier delivered it. */
  readonly statement: Uint8Array;
  /** §5.2 step 4: the Hub origin the client is ACTUALLY connected to. */
  readonly connectedHubOrigin: string;
  /** §8.1: the tier this client runs, which fixes the Noise pattern step 9 checks. */
  readonly tier: E2eeTier;
  /** §8.2: the client's own fixed local suite preference order. */
  readonly localSuitePreference: readonly number[];
  /** The verifier's clock, epoch milliseconds (§5.7, §6.4). */
  readonly now: number;
  /**
   * §12.1.1: the Hub-issued account scope this selection resolved under, when
   * one exists. The web tier has none (§8.3).
   */
  readonly accountId?: string | undefined;
  /** §13.1: the verified pin this selection resolved to (§12.1.1), when it did. */
  readonly pin?: NodeE2eeVerifiedPin | undefined;
  /**
   * §5.7: the highest policy generation already accepted for this node — from
   * the pin record on native, from the application-session memory on web. Absent
   * when none has been accepted yet.
   */
  readonly acceptedPolicyGeneration?: number | undefined;
}

export type NodeE2eeCapabilityInvalidReason =
  | NodeE2eeCapabilityStatementDecodeFailure
  /**
   * §7.1 / §15 over the verifier's OWN inputs. They are typed results rather
   * than thrown errors because the account scope is Hub-chosen (§12.1.1) and
   * therefore peer-influenced, and a verifier that threw on peer-influenced
   * input would be a denial-of-service surface rather than a verdict.
   */
  | "connected_hub_origin_invalid"
  | "account_scope_invalid"
  /** §5.2 step 1, over the LOCALLY rebuilt §7.2.1 envelope. */
  | "identity_signature_invalid"
  /** §5.2 step 2, against the CARRIED values. */
  | "identity_fingerprint_mismatch"
  | "agreement_fingerprint_mismatch"
  /** §5.2 step 3 / §5.7. */
  | "validity_interval_inverted"
  | "validity_interval_too_long"
  | "issued_at_in_future"
  | "statement_expired"
  /** §5.2 step 4. */
  | "hub_origin_mismatch"
  /**
   * §5.2 step 5 / §6.4 / §7.6. The four window rules are the ones the node
   * applies to the mirror-image §7.4 certificate (`verifyE2eeClientPrekeyCertificate`):
   * §6.4 puts the identical obligation on both verifiers, so a window one accepts
   * and the other refuses is a divergence and not a tier difference. The local
   * diagnostic §6.4 and §11.4 name for all four is `e2ee_prekey_expired`.
   */
  | "prekey_lifetime_inverted"
  | "prekey_lifetime_too_long"
  | "prekey_not_yet_valid"
  | "prekey_expired"
  | "prekey_cross_signature_invalid"
  /** §5.2 step 6 with NO verified pin: §7.6 element 18's `invalid`, never §13.3. */
  | "continuity_chain_invalid"
  /** §5.2 step 7 / §5.7. The client-side diagnostic is `e2ee_policy_generation_regressed`. */
  | "policy_generation_regressed";

/**
 * §5.2 step 6 against a VERIFIED pin, and nothing else can produce one. The
 * chain verdict is forwarded as §7.5's own typed failure rather than flattened
 * into a second vocabulary: one set of names describes a chain wherever it is
 * walked, pinned or not.
 */
export type NodeE2eeCapabilityIdentityEvent =
  | { readonly reason: "continuity_chain"; readonly failure: NodeIdentityContinuityChainFailure }
  | { readonly reason: "pinned_continuity_id" };

/**
 * Where the verified statement's identity key stands relative to the client's
 * own trust state (§13).
 *
 * `none` is NOT "a new node". §5.2 and §13.2.1 are explicit that a first-contact
 * statement proves self-consistency only, that it MUST NOT set a trusted pin,
 * and that it may be a node substitution (§13.2.1 situations 2 and 3) rather than
 * routine pairing — which the client decides from its own pin set and its
 * `anyNodeVerified` marker, never from anything a statement carries.
 */
export type NodeE2eeCapabilityAnchor = "none" | "pin-unchanged" | "pin-updated";

/**
 * Every variant reached AFTER §5.2 steps 0–5 succeeded carries the decoded
 * statement, because at that point the verifier has proved what the surfaces
 * downstream have to display or record and no caller may re-derive it from the
 * raw bytes instead:
 *
 *   • `identity-event` — §13.3 displays "the new fingerprint and safety number"
 *     and §13.2.1 situation 2 displays it beside the previously verified one. A
 *     caller re-decoding `input.statement` to obtain that value would be showing
 *     the owner bytes whose signature and fingerprint agreement it never checked,
 *     in the one ceremony that rests on the owner comparing them.
 *   • `unusable` — §12.1 states that a statement unusable under §5.2 step 8, §5.2
 *     step 9, or §8.2 "**has validated**", so it sets the web latch, and §5.7
 *     requires web to remember the highest generation "set on the first statement
 *     it **validates**". Both read the statement; a verdict that dropped it would
 *     make §5.7's web rollback resistance unimplementable through this API.
 *
 * `invalid` carries none, and cannot: it is reachable before the statement
 * decodes at all.
 */
export type NodeE2eeCapabilityVerification =
  | {
      readonly kind: "verified";
      readonly statement: NodeE2eeCapabilityStatement;
      /** §8.2, decided over the validated statement; the hello may be built from it. */
      readonly selectedSuite: E2eeSuiteId;
      readonly anchor: NodeE2eeCapabilityAnchor;
    }
  | {
      readonly kind: "invalid";
      readonly reason: NodeE2eeCapabilityInvalidReason;
      /** §7.5's own verdict, present exactly when `reason` is `continuity_chain_invalid`. */
      readonly chainFailure?: NodeIdentityContinuityChainFailure;
    }
  | {
      readonly kind: "identity-event";
      readonly event: NodeE2eeCapabilityIdentityEvent;
      readonly statement: NodeE2eeCapabilityStatement;
    }
  | {
      readonly kind: "unusable";
      readonly reason: E2eeStatementUnusableReason;
      readonly statement: NodeE2eeCapabilityStatement;
    };

function invalid(reason: NodeE2eeCapabilityInvalidReason): NodeE2eeCapabilityVerification {
  return { kind: "invalid", reason };
}

const utf8 = new TextEncoder();

/**
 * §5.2 steps 0–9 over one received capability statement.
 *
 * The order is the specification's, and every step is fixed to the value the
 * statement CARRIES rather than to a re-derivation of it: step 1 rebuilds the
 * §7.2.1 envelope from the exact transcript bytes received, step 2 recomputes
 * both advertised fingerprints and COMPARES them against the carried ones, and
 * step 5 reconstructs the §7.3 prekey transcript from the statement's own
 * identity fields — including the carried element 6 — so a statement that
 * disagrees with itself fails instead of being repaired on the way past.
 *
 * The two remaining advertised fingerprints, on each carried continuity
 * certificate, are recomputed inside the §7.5 walk rather than beside it: those
 * two are what makes the pin REACHABLE — a pin is a `ryco.node-key.v1`
 * fingerprint and reachability is decided by comparing it against a
 * certificate's `oldFingerprint` — so accepting either on the carrier's
 * authority would let a spliced chain claim to reach a pin it never touched, and
 * a second copy of the recomputation here would be a second §5.2 step 2. Their
 * DISPOSITION is step 2's all the same, which is why the walk's `malformed_entry`
 * is answered `invalid` below and never as an identity event.
 *
 * The chain is walked whether or not a pin was supplied — §7.5's chain rules are
 * properties of the carried chain itself, and a break in them is channel-fatal on
 * first contact too — but the DISPOSITION differs: with a pin the break is the
 * §13.3 identity event, without one it is an invalid statement taking rows K2/K3.
 * See the pin rule in this module's header.
 *
 * PRECONDITION: `localSuitePreference` is the client's own nonempty policy. It
 * is local configuration, so `selectE2eeSuite` throws on an empty one; every
 * peer-supplied input reaching that call was bounded by the decode above.
 */
export function verifyNodeE2eeCapabilityStatement(
  input: NodeE2eeCapabilityVerificationInput,
): NodeE2eeCapabilityVerification {
  let connectedHubOrigin: string;
  try {
    connectedHubOrigin = canonicalizeE2eeHubOrigin(input.connectedHubOrigin);
  } catch {
    return invalid("connected_hub_origin_invalid");
  }
  if (input.accountId !== undefined) {
    const accountIdBytes = utf8.encode(input.accountId).byteLength;
    if (accountIdBytes === 0 || accountIdBytes > E2EE_ACCOUNT_ID_MAX_BYTES) {
      return invalid("account_scope_invalid");
    }
  }

  // Step 0, with the §15 counting bounds: the statement bound before the
  // statement is decoded, the transcript bound before the transcript is, and the
  // suite registry and chain depth before any signature is verified.
  const decoded = decodeNodeE2eeCapabilityStatement(input.statement);
  if (decoded.kind === "error") return invalid(decoded.failure);
  const statement = decoded.value;

  // Step 1. The envelope is never carried; both endpoints rebuild it, and no
  // digest may be accepted from the wire (§7.2.1).
  let envelope: Uint8Array;
  try {
    envelope = encodeNodeE2eeCapabilitySigningEnvelope(statement.transcript);
  } catch {
    return invalid("identity_signature_invalid");
  }
  if (
    !verifyE2eeSignature({
      algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
      publicKey: statement.identityPublicKey,
      message: envelope,
      signature: statement.signature,
    })
  ) {
    return invalid("identity_signature_invalid");
  }

  // Step 2.
  if (
    !e2eeBytesEqual(
      e2eeKeyFingerprint("node-identity", statement.identityPublicKey),
      statement.identityFingerprint,
    )
  ) {
    return invalid("identity_fingerprint_mismatch");
  }
  if (
    !e2eeBytesEqual(
      e2eeKeyFingerprint("agreement", statement.prekeyCertificate.agreementPublicKey),
      statement.prekeyCertificate.agreementFingerprint,
    )
  ) {
    return invalid("agreement_fingerprint_mismatch");
  }

  // Step 3. The interval is a property of the statement and takes no skew; the
  // two clock comparisons take `E2EE_MAX_CLOCK_SKEW` each (§5.7).
  if (statement.expiresAt < statement.issuedAt) return invalid("validity_interval_inverted");
  if (statement.expiresAt - statement.issuedAt > E2EE_CAPABILITY_STATEMENT_VALIDITY) {
    return invalid("validity_interval_too_long");
  }
  if (statement.issuedAt > input.now + E2EE_MAX_CLOCK_SKEW) return invalid("issued_at_in_future");
  if (statement.expiresAt < input.now - E2EE_MAX_CLOCK_SKEW) return invalid("statement_expired");

  // Step 4.
  if (statement.hubOrigin !== connectedHubOrigin) return invalid("hub_origin_mismatch");

  // Step 5. The §6.4 rotation overlap is a node-side staging obligation whose
  // whole client-visible consequence is that both the outgoing and the incoming
  // certificate verify "each within its own validity window" — which is the
  // window checked here, over the certificate advertised on this channel (§5.1).
  // There is no separate overlap comparison for a client to make: it never sees
  // the other certificate.
  //
  // Both edges of the window are checked, and an empty window is refused: §6.4
  // bounds the LENGTH of a prekey's validity, so a rule testing only the upper
  // edge would leave its POSITION unbounded and a certificate dated ten years
  // out would be accepted for ten years plus its lifetime. The node applies the
  // same four rules to the §7.4 mirror.
  const prekey = statement.prekeyCertificate;
  if (prekey.expiresAt <= prekey.createdAt) return invalid("prekey_lifetime_inverted");
  if (prekey.expiresAt - prekey.createdAt > E2EE_PREKEY_LIFETIME) {
    return invalid("prekey_lifetime_too_long");
  }
  if (input.now + E2EE_MAX_CLOCK_SKEW < prekey.createdAt) return invalid("prekey_not_yet_valid");
  if (prekey.expiresAt < input.now - E2EE_MAX_CLOCK_SKEW) return invalid("prekey_expired");
  if (
    !verifyNodeE2eeCapabilityCrossSignature({
      hubOrigin: statement.hubOrigin,
      nodeId: statement.nodeId,
      identityKeyId: statement.identityKeyId,
      identityPublicKey: statement.identityPublicKey,
      identityFingerprint: statement.identityFingerprint,
      prekeyCertificate: prekey,
    })
  ) {
    return invalid("prekey_cross_signature_invalid");
  }

  // Step 6, and the only step that can answer `identity-event` — which it does
  // only against a verified pin, per the pin rule in this module's header.
  if (input.pin !== undefined && statement.continuityId !== input.pin.continuityId) {
    return { kind: "identity-event", event: { reason: "pinned_continuity_id" }, statement };
  }
  const chain = validateNodeE2eeContinuityChain({
    chain: statement.continuityChain,
    hubOrigin: statement.hubOrigin,
    continuityId: statement.continuityId,
    identityPublicKey: statement.identityPublicKey,
    ...(input.pin === undefined
      ? {}
      : { pinnedIdentityFingerprint: input.pin.identityFingerprint }),
  });
  if (chain.kind === "error") {
    // `malformed_entry` is the walk's §5.2 STEP 2 verdict, reached before it
    // authenticates anything: the statement decoder above already fixed every
    // entry's carried shape, so the only way the walk reaches it here is the
    // §7.5 transcript decode — which is exactly step 2's recomputation of that
    // certificate's two advertised fingerprints from the keys they name, plus
    // that certificate's own structure. Step 2 says reject, and §5.2 places it
    // before step 6 has an anchor to authenticate against: a statement whose own
    // chain does not decode presents no identity to compare, so it is INVALID at
    // every footing rather than §13.3's "the node you previously verified is
    // presenting a different identity". Only the walk's authentication failures
    // — a spliced, reordered, truncated, or signature-invalid chain, a
    // generation regression, a continuity id disagreement, an unreached pin —
    // are step 6's, and only they take the identity event.
    if (input.pin === undefined || chain.failure === "malformed_entry") {
      return { kind: "invalid", reason: "continuity_chain_invalid", chainFailure: chain.failure };
    }
    return {
      kind: "identity-event",
      event: { reason: "continuity_chain", failure: chain.failure },
      statement,
    };
  }

  // Step 7. A regressed generation is an invalid statement and NEVER an identity
  // event: a Hub can replay a genuine older statement inside its validity, and
  // §5.7 forbids letting that launch the §13.2 ceremony or the §13.3 UI.
  if (
    input.acceptedPolicyGeneration !== undefined &&
    statement.policyGeneration < input.acceptedPolicyGeneration
  ) {
    return invalid("policy_generation_regressed");
  }

  // Steps 8 and 9, and §8.2 — the three ways a valid statement is still unusable
  // evidence, all carrying the one disposition: no hello may be built from it.
  const selection = selectE2eeSuite({
    tier: input.tier,
    localSuitePreference: input.localSuitePreference,
    advertisedSuiteRegistry: statement.suiteRegistry,
    advertisedVersionMin: statement.e2eeVersionMin,
    advertisedVersionMax: statement.e2eeVersionMax,
    advertisedAdmittedPatterns: statement.admittedPatterns,
  });
  if (selection.kind === "unusable") {
    return { kind: "unusable", reason: selection.reason, statement };
  }

  return {
    kind: "verified",
    statement,
    selectedSuite: selection.selectedSuite,
    anchor:
      chain.pinnedFingerprintUnchanged === undefined
        ? "none"
        : chain.pinnedFingerprintUnchanged
          ? "pin-unchanged"
          : "pin-updated",
  };
}
