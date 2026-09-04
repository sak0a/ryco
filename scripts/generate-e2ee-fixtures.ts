import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { sha256 as nobleSha256, sha512 } from "@noble/hashes/sha2.js";
import {
  e2eeChannelSizeBudget,
  E2EE_AAD_BYTES,
  E2EE_ACCOUNT_ID_MAX_BYTES,
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_CAPABILITY_CARRIER_FIXED_BYTES,
  E2EE_CAPABILITY_CARRIER_MAX_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
  E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES,
  E2EE_CAPABILITY_STATEMENT_MAX_BYTES,
  E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES,
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_CLOSE_RECORDS_RESERVED,
  E2EE_CONTINUITY_CHAIN_MAX_LENGTH,
  E2EE_COUNTER_MAX,
  E2EE_DIRECTION_LABEL_BYTES,
  E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
  E2EE_ENVELOPE_DISCRIMINATOR,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_ERROR_BODY_MAX_BYTES,
  E2EE_ERROR_RECORDS_RESERVED,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_HANDSHAKE_REJECT_PAD_BYTES,
  E2EE_HUB_ORIGIN_MAX_BYTES,
  E2EE_HUB_DEVICE_GRANT_MAX_BYTES,
  E2EE_MAX_CLOCK_SKEW,
  E2EE_NEGOTIATION_DISCRIMINATOR,
  E2EE_PREKEY_LIFETIME,
  E2EE_PROTOCOL_VERSION,
  E2EE_REKEY_MAX_BYTES,
  E2EE_REKEY_MAX_RECORDS,
  E2EE_SAFETY_NUMBER_DIGITS,
  E2EE_SAFETY_NUMBER_GROUP_BYTES,
  E2EE_SAFETY_NUMBER_GROUP_MODULUS,
  E2EE_SAFETY_NUMBER_HKDF_BYTES,
  E2EE_SAFETY_NUMBER_MIN_DISPLAYED_BITS,
  E2EE_SIGNING_INPUT_MAX_BYTES,
  E2EE_STATEMENT_WRAPPER_MAX_BYTES,
  E2EE_SUITE_REGISTRY_MAX_ENTRIES,
  E2EE_WEB_SAS_CHARS,
  E2EE_WEB_SAS_HKDF_BYTES,
  E2EE_WEB_SAS_MIN_DISPLAYED_BITS,
  RELAY_CHUNK_CAPABILITY_PRELUDE,
  RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
  RELAY_CHUNK_HEADER_BYTES,
  RELAY_CHUNK_MAGIC,
  RELAY_MAX_RPC_MESSAGE_BYTES,
  RPC_KEEPALIVE_INTERVAL,
  T_CLOSE,
  T_CLOSE_LINGER_MAX,
  T_KEEPALIVE_FLUSH_MARGIN,
} from "@ryco/shared/relayE2eeConstants";
import {
  decodeHubDeviceGrant,
  encodeHubDeviceGrantClaims,
  encodeHubDeviceGrantEnvelope,
  encodeHubDeviceGrantSigningEnvelope,
  verifyHubDeviceGrant,
  type HubDeviceGrantBindings,
  type HubDeviceGrantClaimsInput,
  type HubDeviceGrantVerificationKey,
} from "@ryco/shared/relayE2eeHubDeviceGrant";
import {
  E2EE_CLOSE_COMMITMENT_DOMAIN,
  E2EE_ERROR_CODE_INTERNAL,
  E2EE_ERROR_CODE_POLICY,
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  E2eeCloseMachine,
  decodeE2eeErrorRecordBody,
  e2eeCloseCommitment,
  encodeE2eeCloseCommitmentPreimage,
  encodeE2eeCloseRecordBody,
  encodeE2eeErrorRecordBody,
  type E2eeCloseCommitmentInput,
  type E2eeCloseReceiveResult,
  type E2eeCloseRecordToSend,
  type E2eeErrorCode,
  type E2eeSequencePosition,
} from "@ryco/shared/relayE2eeClose";
import {
  E2EE_CLIENT_IDENTITY_ALGORITHM,
  E2EE_NODE_IDENTITY_ALGORITHM,
  e2eeKeyFingerprint,
  formatE2eeKeyFingerprint,
  validateE2eeClientIdentityPublicKey,
  validateE2eeClientSignature,
  validateE2eeNodeIdentityPublicKey,
  verifyE2eeSignature,
} from "@ryco/shared/relayE2eeKeys";
import { E2eeNoiseHandshake } from "@ryco/shared/relayE2eeNoise";
import {
  deriveE2eeAeadKey,
  deriveE2eeEpochKeys,
  type E2eeDirectionState,
  type E2eeProtectResult,
  type E2eeRecordAeadFactory,
  E2eeRecordSession,
  type E2eeSessionSecrets,
  e2eeSessionSecretsFromNoiseKeys,
  type E2eeSyntheticDirectionState,
  type E2eeUnprotectResult,
  E2EE_AEAD_KEY_LABEL,
  E2EE_CLOSE_RECORD_PLAINTEXT_BYTES,
  E2EE_ERROR_RECORD_PLAINTEXT_MAX_BYTES,
  E2EE_POST_APPLICATION_RESERVE_PLAINTEXT_BYTES,
  E2EE_POST_APPLICATION_RESERVE_RECORDS,
  E2EE_RATCHET_LABEL,
  eraseE2eeSessionSecrets,
} from "@ryco/shared/relayE2eeSession";
import {
  canonicalizeE2eeHubOrigin,
  decodeCanonicalE2eeCbor,
  encodeCanonicalE2eeCbor,
  e2eeAuthorizationContextCommitment,
  type E2eeAuthorizationContextInput,
  e2eeEffectiveAdmittedPatterns,
  type E2eeTier,
  E2EE_CLIENT_PREKEY_TRANSCRIPT_DOMAIN,
  E2EE_NODE_CAPABILITY_DIGEST_DOMAIN,
  E2EE_NODE_CAPABILITY_TRANSCRIPT_DOMAIN,
  E2EE_NODE_IDENTITY_CONTINUITY_TRANSCRIPT_DOMAIN,
  E2EE_NODE_PREKEY_TRANSCRIPT_DOMAIN,
  E2EE_NOISE_PATTERN_IK,
  E2EE_NOISE_PATTERN_NX,
  encodeClientE2eePrekeyCertificateCarrier,
  encodeClientE2eePrekeyTranscript,
  encodeE2eeAuthorizationContext,
  encodeE2eeNoisePrologue,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eeCapabilityTranscript,
  encodeNodeE2eePrekeyTranscript,
  encodeNodeIdentityContinuityTranscript,
  nodeE2eeCapabilitySelfCheck,
  type NodeIdentityContinuityChainEntry,
  validateNodeE2eeContinuityChain,
  verifyNodeE2eeCapabilityCrossSignature,
} from "@ryco/shared/relayE2eeTranscripts";
import {
  deriveE2eeSafetyNumber,
  deriveE2eeWebSas,
} from "@ryco/shared/relayE2eeVerificationDisplay";
import {
  classifyPostStripPayload,
  decodeE2eeEnvelope,
  decodeE2eeNegotiationRecord,
  e2eeAeadNonce,
  type E2eeDirection,
  e2eeEnvelopeAad,
  type E2eeInnerRecordType,
  e2eeNegotiationRecordBound,
  e2eeNegotiationRecordDirection,
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_CLOSE,
  E2EE_INNER_TYPE_CLOSE_ACK,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
  E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
  encodeE2eeDirectionLabel,
  encodeE2eeEnvelope,
  encodeE2eeEnvelopeHeader,
  encodeE2eeHandshakeReject,
  encodeE2eeNegotiationRecord,
} from "@ryco/shared/relayE2eeWire";
import {
  RelayMessageAssembler,
  isChunkedPayload,
  prepareRelayMessage,
} from "@ryco/shared/relayMessageChunks";
import {
  encodeE2eeAccountGrantIkHelloPayload,
  decodeE2eeClientHello,
  decodeE2eeServerAccept,
  type E2eeAdmittedAuthoritySnapshot,
  type E2eeAdvertisedChannelMaterial,
  e2eeAuthorizationKeysEqual,
  e2eeAuthorizationWithdrawn,
  type E2eeClientAuthorization,
  type E2eeClientAuthorizationKey,
  E2eeClientHandshake,
  type E2eeClientHandshakeCredentials,
  type E2eeHandshakeChannel,
  type E2eeHandshakeFailure,
  type E2eeIkHelloPayload,
  type E2eeModeTransition,
  type E2eeNodeAdmissionPolicy,
  E2eeNodeHandshake,
  E2EE_NX_HELLO_PAYLOAD,
  encodeE2eeClientHello,
  encodeE2eeIkHelloPayload,
  encodeE2eeServerAcceptPayload,
  selectE2eeSuite,
  verifyE2eeClientPrekeyCertificate,
} from "@ryco/shared/relayE2eeHandshake";
import {
  NODE_AUTH_TRANSCRIPT_DOMAIN,
  NODE_KEY_ROTATION_TRANSCRIPT_DOMAIN,
  encodeNodeAuthenticationTranscript,
  encodeNodeKeyRotationTranscript,
} from "@ryco/shared/nodeIdentity";
import { decode, encode, rfc8949EncodeOptions } from "cborg";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type IndependentNoiseComposer = (input: {
  readonly pattern: "IK" | "NX";
  readonly prologue: Uint8Array;
  readonly initiatorStaticSecret?: Uint8Array;
  readonly initiatorEphemeralSecret: Uint8Array;
  readonly responderStaticSecret: Uint8Array;
  readonly responderEphemeralSecret: Uint8Array;
  readonly message1Payload: Uint8Array;
  readonly message2Payload: Uint8Array;
}) => {
  readonly message1: Uint8Array;
  readonly message2: Uint8Array;
  readonly handshakeHash: Uint8Array;
  readonly chainingKeyFinal: Uint8Array;
};

// Keep the oracle outside the scripts TypeScript project and outside every
// production module graph. The non-literal dynamic import is intentional: the
// generator executes it under Bun, while each project typechecks in isolation.
const independentReferencePath: string = fileURLToPath(
  new URL("../packages/shared/test/independent-e2ee/reference.ts", import.meta.url),
);
const { composeIndependentNoise } = (await import(independentReferencePath)) as unknown as {
  readonly composeIndependentNoise: IndependentNoiseComposer;
};

// Deterministic generator for the Ryco relay E2EE vector corpus —
// docs/relay-e2ee-protocol.md §16.1 (fixture home and generation), §16.2 (file
// format), and §16.3 (the normative family enumeration).
//
// It follows the convention of `scripts/generate-relay-fixtures.ts`: an exported
// fixture root, an exported corpus-generation function, an exported write
// function, a root `generate:e2ee-fixtures` script, and a sibling drift test
// that regenerates the corpus in memory and compares the committed files byte
// for byte. Fixtures are GENERATED, never hand-edited.
//
// DETERMINISM (§16.1). Fixed seeds, fixed identifiers, fixed timestamps, fixed
// nonces. No clock read, no ambient randomness, no iteration over an unordered
// collection. Handshake ephemerals go in through the state machine's
// `testOnlyEphemeralSecretKey` injection point, which exists for exactly this.
//
// Every protocol expectation is produced by the landed implementation. P7's
// explicitly named `noiseChainingKeyFinal` is the one exception: the supported
// Noise API intentionally does not expose it, so the import-isolated,
// straight-line test reference derives it and the landed implementation's
// independently exposed handshake hash must agree before it is emitted.
// This generator
// imports `@ryco/shared/relayE2ee*` and never restates a transcript element
// list, a domain string, a derivation, or a bound. Where §16.3 names a case the
// shared modules cannot yet decide — the §5.2 statement verifier, the §4.4 mode
// machine, the §7.5 node startup state machine, the §13.1 pin store — the case
// is NOT emitted with a guessed expectation; it is recorded in
// `DEFERRED_CASES` below, with the component that will own it, and the family
// header repeats the omission so a reader of the corpus alone can see it.
//
// TEST-ONLY KEYS (§16.1). Every seed, private key, and ephemeral below is a
// fixed public constant. The manifest carries the top-level warning, every
// family file repeats it, and every key field name is `testOnly`-prefixed. NONE
// OF THIS MATERIAL MAY EVER REACH A REAL ENDPOINT, and no production code path
// may accept it.

export const E2EE_FIXTURE_ROOT = fileURLToPath(
  new URL("../packages/shared/fixtures/e2ee/v1/", import.meta.url),
);

/**
 * The one file of the corpus this repository does not generate: §16.3 F15 is
 * the published cacophony and snow vector set, transcoded verbatim. The
 * generator reads it to record its digest and MUST NOT rewrite it (§16.3 F15,
 * and the file's own `provenance` array).
 */
export const TRANSCODED_FAMILY_FILE = "f15-noise-core-vectors.json";

const WARNING =
  "TEST-ONLY MATERIAL. Every private key, seed, ephemeral, and secret in this corpus is deterministic test material. It MUST NEVER be used for a real endpoint, and no production code path may accept it (docs/relay-e2ee-protocol.md §16.1).";

// ─── §16.2 JSON profile ──────────────────────────────────────────────────────

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface FixtureCase {
  readonly name: string;
  /** The spec sections this case is taken from, so a reviewer can check it against them. */
  readonly sections: readonly string[];
  readonly note?: string;
  readonly inputs: JsonValue;
  readonly expected: JsonValue;
}

interface FixtureFamily {
  readonly file: string;
  readonly number: number;
  readonly title: string;
  readonly sections: readonly string[];
  readonly summary: string;
  /** What §16.3 asks of this family that the landed modules cannot yet decide. */
  readonly deferred: readonly string[];
  readonly testKeyMaterial: JsonValue;
  readonly cases: readonly FixtureCase[];
}

// ─── §16.4 cross-runtime equality ────────────────────────────────────────────
//
// §16.4 obliges a named subset of the families to run in the web browser test
// suite as well as the Node gate, and the COMPLETE corpus to pass on physical
// devices on both mobile platforms before the native client ships E2EE support.
// Neither run exists in this repository yet. That absence is a deferral exactly
// like a missing case is, so it is DECLARED — once at the top of the manifest and
// again in each family §16.4 names — rather than left as an unmentioned gap for a
// reader to infer. A vector that produces different bytes on any supported
// runtime is a release-blocking defect (§16.4); nothing here has yet shown that
// none does.

/** The families §16.4 names, with the part of each it names. */
const CROSS_RUNTIME_SCOPES: ReadonlyMap<number, string> = new Map([
  [1, "this whole family"],
  [2, "this whole family"],
  [3, "the admitted-pattern cases of this family"],
  [7, "this whole family"],
  [8, "this whole family"],
  [10, "this whole family"],
  [14, "the `WebSAS` half of this family"],
  [16, "the NX cases of this family"],
  [17, "the P-256 cases of this family"],
  [19, "the Web-isolation cases of this family"],
]);

function crossRuntimeDeferral(family: number): string {
  const scope = CROSS_RUNTIME_SCOPES.get(family);
  if (scope === undefined) {
    throw new Error(`Family F${String(family)} is not named by §16.4.`);
  }
  return `§16.4 cross-runtime equality: ${scope} MUST ALSO run in the web browser test suite, and the complete corpus MUST additionally pass on physical devices on both mobile platforms before the native client ships E2EE support. Neither run exists yet — this repository has no browser test gate over packages/shared and no physical-device harness — so every vector here is currently discharged on the Node gate alone, under the §14.5 RN-realistic adapters. A vector that produces different bytes on any supported runtime is a release-blocking defect, and nothing has yet established that none of these does. Owned by the web phase, and by the native rollout, whose physical-device pass §16.4 makes an explicit acceptance gate rather than an optional extra.`;
}

/** §16.2: byte strings are `{"$bytes": "<lowercase hex>"}`. */
function b(value: Uint8Array): JsonValue {
  return { $bytes: Buffer.from(value).toString("hex") };
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const utf8 = new TextEncoder();

/**
 * Run a validator that signals rejection by throwing and record the outcome as
 * data. The error's CLASS is recorded and never its message: §7.1's error is
 * deliberately detail-free, and a fixture pinned to a message string would fail
 * on a reworded sentence rather than on a behavior change.
 */
function attempt<T>(
  run: () => T,
): { readonly ok: true; readonly value: T } | { readonly ok: false } {
  try {
    return { ok: true, value: run() };
  } catch {
    return { ok: false };
  }
}

function rejected(run: () => unknown): JsonValue {
  return { rejected: !attempt(run).ok };
}

// ─── TEST-ONLY key material (§16.1) ──────────────────────────────────────────
//
// The seeds are the ones `packages/shared/src/relayE2eeTranscripts.test.ts` and
// `relayE2eeHandshake.test.ts` already use, so the corpus and the module tests
// pin the SAME §7 material and a divergence between them is visible immediately.
// Every one of them is a counting or repeated-byte pattern and none of them is
// secret.

const seedOf = (value: number): Uint8Array => new Uint8Array(32).fill(value);
const COUNTING_SEED = Uint8Array.from({ length: 32 }, (_unused, index) => index);

/** Ed25519 node identity key (§7.1) — the statement's current identity key. */
const NODE_IDENTITY_SEED = COUNTING_SEED;
/** The identity key the node rotated away from, two rotations back (§7.5). */
const NODE_OLD_IDENTITY_SEED = seedOf(0x21);
/** The identity key the node rotated away from, one rotation back (§7.5). */
const NODE_NEW_IDENTITY_SEED = seedOf(0x22);
/** An identity key belonging to no lineage in this corpus (§7.5 splice cases). */
const UNRELATED_IDENTITY_SEED = seedOf(0x23);
/** X25519 node agreement prekey (§6.2, §7.3). */
const NODE_AGREEMENT_SECRET = seedOf(0x11);
/** X25519 client agreement prekey (§6.2, §7.4). */
const CLIENT_AGREEMENT_SECRET = seedOf(0x12);
/** P-256 client identity key (§7.1, §7.4). */
const CLIENT_IDENTITY_SECRET = COUNTING_SEED;

const NODE_IDENTITY_PUBLIC = ed25519.getPublicKey(NODE_IDENTITY_SEED);
const NODE_OLD_IDENTITY_PUBLIC = ed25519.getPublicKey(NODE_OLD_IDENTITY_SEED);
const NODE_NEW_IDENTITY_PUBLIC = ed25519.getPublicKey(NODE_NEW_IDENTITY_SEED);
const UNRELATED_IDENTITY_PUBLIC = ed25519.getPublicKey(UNRELATED_IDENTITY_SEED);
const NODE_AGREEMENT_PUBLIC = x25519.getPublicKey(NODE_AGREEMENT_SECRET);
const CLIENT_AGREEMENT_PUBLIC = x25519.getPublicKey(CLIENT_AGREEMENT_SECRET);
const CLIENT_IDENTITY_PUBLIC = p256.getPublicKey(CLIENT_IDENTITY_SECRET, false);

/** The nine-key lineage the `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` cases walk (§7.5). */
const MAX_CHAIN_SEEDS = Array.from({ length: E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1 }, (_u, index) =>
  seedOf(0x30 + index),
);
const MAX_CHAIN_PUBLIC = MAX_CHAIN_SEEDS.map((seed) => ed25519.getPublicKey(seed));

const HUB_ORIGIN = "https://hub.example.com";
const OTHER_HUB_ORIGIN = "https://other.example.com";
/** A canonical origin of exactly `E2EE_HUB_ORIGIN_MAX_BYTES` UTF-8 bytes (§7.1). */
const MAX_HUB_ORIGIN = `https://${"h".repeat(E2EE_HUB_ORIGIN_MAX_BYTES - "https://.example.com".length)}.example.com`;
/** One byte over the same bound; §7.1 refuses it and §7.6.1 names it. */
const OVERLONG_HUB_ORIGIN = `https://${"h".repeat(E2EE_HUB_ORIGIN_MAX_BYTES - "https://.example.com".length + 1)}.example.com`;

const NODE_ID = `node_${"A".repeat(22)}`;
const IDENTITY_KEY_ID = `nkey_${"B".repeat(22)}`;
const OLD_KEY_ID = `nkey_${"C".repeat(22)}`;
const NEW_KEY_ID = `nkey_${"D".repeat(22)}`;
const PREKEY_ID = `epk_${"E".repeat(22)}`;
/** §16.3 F17: the node-identity domains of `nodeIdentity.ts` need a rotation id. */
const ROTATION_REQUEST_ID = `nrot_${"G".repeat(22)}`;
/** A fixed 32-byte node-identity challenge; TEST ONLY, and not a secret. */
const NODE_IDENTITY_CHALLENGE = new Uint8Array(32).fill(0x5a);
const CONTINUITY_ID = `nct_${"F".repeat(22)}`;
const OTHER_CONTINUITY_ID = `nct_${"H".repeat(22)}`;
const ACCOUNT_ID = "acct_0123456789";
/** Exactly `E2EE_ACCOUNT_ID_MAX_BYTES` UTF-8 bytes, for the §3.2.1 S9 case. */
const MAX_ACCOUNT_ID = "a".repeat(E2EE_ACCOUNT_ID_MAX_BYTES);
const MAX_CHAIN_KEY_IDS = MAX_CHAIN_SEEDS.map(
  (_unused, index) => `nkey_${String.fromCharCode(0x4a + index).repeat(22)}`,
);

const CREATED_AT = 1_784_160_000_000;
const EXPIRES_AT = 1_786_752_000_000;
const ISSUED_AT = 1_784_160_030_000;
const STATEMENT_EXPIRES_AT = 1_784_160_630_000;
const NOW = 1_784_160_030_000;
/**
 * The first generation of the maximum-size lineage. §5.5's worked example
 * charges EVERY unsigned field its widest canonical encoding, so the
 * maximum-size statement below sets each of them above 2^32 — the point at
 * which RFC 8949 shortest-form encoding uses the nine-byte head. A generation
 * far above 1 is exactly what a node that has rotated many times carries, since
 * §7.5 prunes the chain to its most recent `E2EE_CONTINUITY_CHAIN_MAX_LENGTH`
 * entries and never renumbers them.
 */
const MAX_SIZE_FIRST_GENERATION = 4_294_967_297;
/** The same rule applied to every other unsigned field of the maximum-size statement. */
const MAX_SIZE_TIMESTAMP = 4_294_967_296;

const signNode = (message: Uint8Array, seed: Uint8Array = NODE_IDENTITY_SEED): Uint8Array =>
  ed25519.sign(message, seed);
const signClient = (message: Uint8Array, secret: Uint8Array = CLIENT_IDENTITY_SECRET): Uint8Array =>
  p256.sign(nobleSha256(message), secret, {
    prehash: false,
    lowS: false,
    format: "compact",
  });

const NODE_IDENTITY_FINGERPRINT = e2eeKeyFingerprint("node-identity", NODE_IDENTITY_PUBLIC);
const NODE_AGREEMENT_FINGERPRINT = e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC);

/** The shared key block every family file repeats, so no file is read in isolation. */
const SHARED_TEST_KEY_MATERIAL: JsonValue = {
  note: "TEST ONLY. Fixed public seeds; the public halves below are derived from them by the pinned primitives (§14.2). Identical to the material `packages/shared/src/relayE2eeTranscripts.test.ts` and `relayE2eeHandshake.test.ts` pin.",
  testOnlyNodeIdentitySeed: b(NODE_IDENTITY_SEED),
  nodeIdentityPublicKey: b(NODE_IDENTITY_PUBLIC),
  testOnlyNodeAgreementSecretKey: b(NODE_AGREEMENT_SECRET),
  nodeAgreementPublicKey: b(NODE_AGREEMENT_PUBLIC),
  testOnlyClientIdentitySecretKey: b(CLIENT_IDENTITY_SECRET),
  clientIdentityPublicKey: b(CLIENT_IDENTITY_PUBLIC),
  testOnlyClientAgreementSecretKey: b(CLIENT_AGREEMENT_SECRET),
  clientAgreementPublicKey: b(CLIENT_AGREEMENT_PUBLIC),
  testOnlyNodeOldIdentitySeed: b(NODE_OLD_IDENTITY_SEED),
  testOnlyNodeNewIdentitySeed: b(NODE_NEW_IDENTITY_SEED),
  testOnlyUnrelatedIdentitySeed: b(UNRELATED_IDENTITY_SEED),
  identifiers: {
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    prekeyId: PREKEY_ID,
    continuityId: CONTINUITY_ID,
    accountId: ACCOUNT_ID,
  },
  timestamps: { createdAt: CREATED_AT, expiresAt: EXPIRES_AT, issuedAt: ISSUED_AT, now: NOW },
};

// ─── shared §7 builders ──────────────────────────────────────────────────────
//
// Every one of these goes through the landed encoders; none of them restates an
// element list. `encodeCanonical` below is the pinned codec (§3.6) and is used
// only where the corpus needs a structure a CONFORMING ENCODER REFUSES TO BUILD
// — a peer-supplied mutation — which is exactly the shape §16.3 asks for in the
// negative cases.

function encodeCanonical(value: unknown): Uint8Array {
  return Uint8Array.from(encode(value, rfc8949EncodeOptions));
}

/** Decode canonical CBOR, mutate one element, re-encode: a peer-supplied tamper. */
function mutateElement(transcript: Uint8Array, index: number, value: unknown): Uint8Array {
  const copy = [...(decode(transcript) as unknown[])];
  copy[index] = value;
  return encodeCanonical(copy);
}

/** Drop the last element of a canonical array: a wrong-arity structure. */
function dropLastElement(transcript: Uint8Array): Uint8Array {
  return encodeCanonical((decode(transcript) as unknown[]).slice(0, -1));
}

/**
 * Re-emit a small definite array header in the next-wider form: `0x8b` becomes
 * `0x98 0x0b`. The value decodes identically and the bytes are non-canonical,
 * which is exactly what the §3.6 re-encode equality rule exists to catch.
 */
function widenArrayHeader(transcript: Uint8Array): Uint8Array {
  const head = transcript[0]!;
  if (head < 0x80 || head > 0x97) throw new Error("Fixture expects a small definite array header.");
  const out = new Uint8Array(transcript.byteLength + 1);
  out[0] = 0x98;
  out[1] = head - 0x80;
  out.set(transcript.subarray(1), 2);
  return out;
}

/** Re-emit a small definite array as an indefinite-length one, which §3.6 forbids. */
function indefiniteArray(transcript: Uint8Array): Uint8Array {
  const head = transcript[0]!;
  if (head < 0x80 || head > 0x97) throw new Error("Fixture expects a small definite array header.");
  const out = new Uint8Array(transcript.byteLength + 1);
  out[0] = 0x9f;
  out.set(transcript.subarray(1), 1);
  out[out.byteLength - 1] = 0xff;
  return out;
}

function appendByte(bytes: Uint8Array, byte: number): Uint8Array {
  const out = new Uint8Array(bytes.byteLength + 1);
  out.set(bytes);
  out[out.byteLength - 1] = byte;
  return out;
}

function flipBit(bytes: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[index] = copy[index]! ^ 0x01;
  return copy;
}

interface ContinuityLineage {
  readonly entries: readonly NodeIdentityContinuityChainEntry[];
  readonly publicKeys: readonly Uint8Array[];
  readonly keyIds: readonly string[];
}

function buildContinuityLineage(options: {
  readonly hubOrigin: string;
  readonly continuityId: string;
  readonly seeds: readonly Uint8Array[];
  readonly publicKeys: readonly Uint8Array[];
  readonly keyIds: readonly string[];
  readonly firstGeneration: number;
  readonly createdAt: number;
}): ContinuityLineage {
  const entries: NodeIdentityContinuityChainEntry[] = [];
  for (let index = 0; index + 1 < options.publicKeys.length; index += 1) {
    const transcript = encodeNodeIdentityContinuityTranscript({
      hubOrigin: options.hubOrigin,
      continuityId: options.continuityId,
      generation: options.firstGeneration + index,
      oldKeyId: options.keyIds[index]!,
      oldPublicKey: options.publicKeys[index]!,
      newKeyId: options.keyIds[index + 1]!,
      newPublicKey: options.publicKeys[index + 1]!,
      createdAt: options.createdAt,
    });
    // §7.5: every entry is signed by the OUTGOING key, before it is destroyed.
    entries.push({ transcript, signature: signNode(transcript, options.seeds[index]!) });
  }
  return { entries, publicKeys: options.publicKeys, keyIds: options.keyIds };
}

/** The two-rotation lineage `relayE2eeTranscripts.test.ts` pins: OLD → NEW → current. */
const SHORT_LINEAGE = buildContinuityLineage({
  hubOrigin: HUB_ORIGIN,
  continuityId: CONTINUITY_ID,
  seeds: [NODE_OLD_IDENTITY_SEED, NODE_NEW_IDENTITY_SEED, NODE_IDENTITY_SEED],
  publicKeys: [NODE_OLD_IDENTITY_PUBLIC, NODE_NEW_IDENTITY_PUBLIC, NODE_IDENTITY_PUBLIC],
  keyIds: [OLD_KEY_ID, NEW_KEY_ID, IDENTITY_KEY_ID],
  firstGeneration: 1,
  createdAt: CREATED_AT,
});

const MAX_LINEAGE_SHORT_ORIGIN = buildContinuityLineage({
  hubOrigin: HUB_ORIGIN,
  continuityId: CONTINUITY_ID,
  seeds: MAX_CHAIN_SEEDS,
  publicKeys: MAX_CHAIN_PUBLIC,
  keyIds: MAX_CHAIN_KEY_IDS,
  firstGeneration: MAX_SIZE_FIRST_GENERATION,
  createdAt: MAX_SIZE_TIMESTAMP,
});

const MAX_LINEAGE_MAX_ORIGIN = buildContinuityLineage({
  hubOrigin: MAX_HUB_ORIGIN,
  continuityId: CONTINUITY_ID,
  seeds: MAX_CHAIN_SEEDS,
  publicKeys: MAX_CHAIN_PUBLIC,
  keyIds: MAX_CHAIN_KEY_IDS,
  firstGeneration: MAX_SIZE_FIRST_GENERATION,
  createdAt: MAX_SIZE_TIMESTAMP,
});

interface StatementBuild {
  readonly transcript: Uint8Array;
  readonly envelope: Uint8Array;
  readonly signature: Uint8Array;
  readonly statement: Uint8Array;
  readonly base64url: string;
  readonly carrier: string;
  readonly carrierBytes: number;
  readonly nodePrekeyTranscript: Uint8Array;
  readonly crossSignature: Uint8Array;
  readonly identityPublicKey: Uint8Array;
  readonly identityFingerprint: Uint8Array;
  readonly agreementFingerprint: Uint8Array;
}

interface StatementOptions {
  readonly hubOrigin?: string;
  readonly identitySeed?: Uint8Array;
  readonly identityPublicKey?: Uint8Array;
  readonly identityKeyId?: string;
  readonly chain?: readonly NodeIdentityContinuityChainEntry[];
  readonly suiteRegistry?: readonly number[];
  readonly e2eeVersionMin?: number;
  readonly e2eeVersionMax?: number;
  readonly requireApprovedClientE2EE?: boolean;
  readonly policyGeneration?: number;
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly prekeyCreatedAt?: number;
  readonly prekeyExpiresAt?: number;
  readonly continuityId?: string;
}

/**
 * The §5.2 statement, end to end: the §7.3 cross-signature over the
 * reconstructible node prekey transcript, the §7.6 transcript, the §7.2.1
 * signing envelope, the identity signature over that envelope, the
 * `[ bstr(transcript), bstr(signature) ]` statement CBOR, and the §5.3 carrier.
 *
 * The carrier is `JSON.stringify` of the two-member object §5.3 fixes, which is
 * what §5.3 requires byte-identically; the base64url is unpadded, as §5.3 and
 * §3.2.1 S5 require.
 */
function buildStatement(options: StatementOptions = {}): StatementBuild {
  const hubOrigin = options.hubOrigin ?? HUB_ORIGIN;
  const identitySeed = options.identitySeed ?? NODE_IDENTITY_SEED;
  const identityPublicKey = options.identityPublicKey ?? ed25519.getPublicKey(identitySeed);
  const identityKeyId = options.identityKeyId ?? IDENTITY_KEY_ID;
  const prekeyCreatedAt = options.prekeyCreatedAt ?? CREATED_AT;
  const prekeyExpiresAt = options.prekeyExpiresAt ?? EXPIRES_AT;
  const nodePrekeyTranscript = encodeNodeE2eePrekeyTranscript({
    hubOrigin,
    nodeId: NODE_ID,
    identityKeyId,
    prekeyId: PREKEY_ID,
    identityPublicKey,
    agreementPublicKey: NODE_AGREEMENT_PUBLIC,
    createdAt: prekeyCreatedAt,
    expiresAt: prekeyExpiresAt,
  });
  const crossSignature = signNode(nodePrekeyTranscript, identitySeed);
  const transcript = encodeNodeE2eeCapabilityTranscript({
    hubOrigin,
    nodeId: NODE_ID,
    identityKeyId,
    identityPublicKey,
    e2eeVersionMin: options.e2eeVersionMin ?? 1,
    e2eeVersionMax: options.e2eeVersionMax ?? 1,
    suiteRegistry: options.suiteRegistry ?? [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    prekeyCertificate: {
      prekeyId: PREKEY_ID,
      agreementPublicKey: NODE_AGREEMENT_PUBLIC,
      crossSignature,
      createdAt: prekeyCreatedAt,
      expiresAt: prekeyExpiresAt,
    },
    continuityChain: options.chain ?? SHORT_LINEAGE.entries,
    requireE2EE: false,
    requireApprovedClientE2EE: options.requireApprovedClientE2EE ?? false,
    policyGeneration: options.policyGeneration ?? 7,
    issuedAt: options.issuedAt ?? ISSUED_AT,
    expiresAt: options.expiresAt ?? STATEMENT_EXPIRES_AT,
    continuityId: options.continuityId ?? CONTINUITY_ID,
  });
  const envelope = encodeNodeE2eeCapabilitySigningEnvelope(transcript);
  const signature = signNode(envelope, identitySeed);
  const statement = encodeCanonical([transcript, signature]);
  const base64url = Buffer.from(statement).toString("base64url");
  const carrier = JSON.stringify({ _tag: E2EE_CAPABILITY_CARRIER_TAG, statement: base64url });
  return {
    transcript,
    envelope,
    signature,
    statement,
    base64url,
    carrier,
    carrierBytes: Buffer.byteLength(carrier, "utf8"),
    nodePrekeyTranscript,
    crossSignature,
    identityPublicKey,
    identityFingerprint: e2eeKeyFingerprint("node-identity", identityPublicKey),
    agreementFingerprint: NODE_AGREEMENT_FINGERPRINT,
  };
}

/** The §7.6.1 self-check over a built statement, as a node runs it before advertising. */
function selfCheck(build: StatementBuild, hubOrigin: string, versionMin = 1, versionMax = 1) {
  return nodeE2eeCapabilitySelfCheck({
    hubOrigin,
    transcript: build.transcript,
    envelope: build.envelope,
    statement: build.statement,
    carrier: utf8.encode(build.carrier),
    e2eeVersionMin: versionMin,
    e2eeVersionMax: versionMax,
    continuityIdResolved: true,
  });
}

/**
 * The largest statement that actually VALIDATES under the version-1 registries:
 * every §3.2.1 bound taken simultaneously. Family F3 pins its figures against
 * the §5.5 worked example and family F2 presents its carrier at the §5.5
 * advertisement floor, so it is built once, here.
 */
const MAXIMUM_STATEMENT = buildStatement({
  hubOrigin: MAX_HUB_ORIGIN,
  identitySeed: MAX_CHAIN_SEEDS[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!,
  identityPublicKey: MAX_CHAIN_PUBLIC[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!,
  identityKeyId: MAX_CHAIN_KEY_IDS[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!,
  chain: MAX_LINEAGE_MAX_ORIGIN.entries,
  suiteRegistry: Array.from(
    { length: E2EE_SUITE_REGISTRY_MAX_ENTRIES },
    () => E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  ),
  policyGeneration: MAX_SIZE_TIMESTAMP,
  issuedAt: MAX_SIZE_TIMESTAMP,
  expiresAt: MAX_SIZE_TIMESTAMP,
  prekeyCreatedAt: MAX_SIZE_TIMESTAMP,
  prekeyExpiresAt: MAX_SIZE_TIMESTAMP,
});

// ─── F13 — fingerprints (§7.1) ───────────────────────────────────────────────

function buildFamily13(): FixtureFamily {
  const rows = [
    {
      name: "node-identity-key-fingerprint",
      family: "node-identity" as const,
      domain: "ryco.node-key.v1",
      algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
      publicKey: NODE_IDENTITY_PUBLIC,
    },
    {
      name: "client-identity-key-fingerprint",
      family: "client-identity" as const,
      domain: "ryco.client-key.v1",
      algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
      publicKey: CLIENT_IDENTITY_PUBLIC,
    },
    {
      name: "node-agreement-key-fingerprint",
      family: "agreement" as const,
      domain: "ryco.e2ee-agreement-key.v1",
      algorithm: "x25519",
      publicKey: NODE_AGREEMENT_PUBLIC,
    },
    {
      name: "client-agreement-key-fingerprint",
      family: "agreement" as const,
      domain: "ryco.e2ee-agreement-key.v1",
      algorithm: "x25519",
      publicKey: CLIENT_AGREEMENT_PUBLIC,
    },
  ];

  const cases: FixtureCase[] = rows.map((row) => {
    const digest = e2eeKeyFingerprint(row.family, row.publicKey);
    return {
      name: row.name,
      sections: ["7.1"],
      inputs: {
        keyFamily: row.family,
        fingerprintDomain: row.domain,
        algorithmLabel: row.algorithm,
        publicKey: b(row.publicKey),
        preimage: b(encodeCanonical([row.domain, row.algorithm, row.publicKey])),
      },
      expected: { fingerprint: b(digest), display: formatE2eeKeyFingerprint(digest) },
    };
  });

  return {
    file: "f13-fingerprints.json",
    number: 13,
    title: "Fingerprints",
    sections: ["7.1", "16.3 F13"],
    summary:
      "The three §7.1 fingerprint families over the corpus keys: the canonical-CBOR preimage `[domain, algorithm, bstr(publicKey)]`, its SHA-256 raw digest, and the `SHA256:` unpadded-base64url display form. The preimage is emitted so a reader can check the digest by hand without re-deriving the element list.",
    deferred: [],
    testKeyMaterial: SHARED_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F14 — safety number and `WebSAS` (§13.4, §13.5) ─────────────────────────

function buildFamily14(): FixtureFamily {
  const cases: FixtureCase[] = [];

  // §3.2.1 S10: (E2EE_SAFETY_NUMBER_HKDF_BYTES / E2EE_SAFETY_NUMBER_GROUP_BYTES)
  //             · log2(E2EE_SAFETY_NUMBER_GROUP_MODULUS)
  //             ≥ E2EE_SAFETY_NUMBER_MIN_DISPLAYED_BITS
  const safetyGroups = E2EE_SAFETY_NUMBER_HKDF_BYTES / E2EE_SAFETY_NUMBER_GROUP_BYTES;
  const safetyDisplayedBits = safetyGroups * Math.log2(E2EE_SAFETY_NUMBER_GROUP_MODULUS);

  for (const [name, accountId] of [
    ["safety-number-short-account-id", ACCOUNT_ID],
    ["safety-number-max-length-account-id", MAX_ACCOUNT_ID],
  ] as const) {
    const derived = deriveE2eeSafetyNumber({
      nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
      clientIdentityPublicKey: CLIENT_IDENTITY_PUBLIC,
      hubOrigin: HUB_ORIGIN,
      accountId,
    });
    cases.push({
      name,
      sections: ["13.4", "3.2.1 S10"],
      note: "The digest is the HKDF-Expand pseudorandom key DIRECTLY: §13.4 has no Extract step and no salt. `info` is the §3.5 label, which equals the input array's domain.",
      inputs: {
        nodeIdentityPublicKey: b(NODE_IDENTITY_PUBLIC),
        clientIdentityPublicKey: b(CLIENT_IDENTITY_PUBLIC),
        hubOrigin: HUB_ORIGIN,
        accountId,
        hkdfInfo: "ryco.relay-e2ee.safety-number.v1",
      },
      expected: {
        inputArray: b(derived.input),
        safetyNumberSecret: b(derived.secret),
        hkdfOutput: b(derived.output),
        display: derived.display,
        displayFormat: {
          digits: E2EE_SAFETY_NUMBER_DIGITS.digits,
          groups: E2EE_SAFETY_NUMBER_DIGITS.groups,
          digitsPerGroup: E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup,
        },
        displayedEntropyBits: safetyDisplayedBits,
        minimumDisplayedEntropyBits: E2EE_SAFETY_NUMBER_MIN_DISPLAYED_BITS,
        satisfiesS10: safetyDisplayedBits >= E2EE_SAFETY_NUMBER_MIN_DISPLAYED_BITS,
      },
    });
  }

  // §13.4: the same key pair under a different account yields a different number.
  const baseline = deriveE2eeSafetyNumber({
    nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
    clientIdentityPublicKey: CLIENT_IDENTITY_PUBLIC,
    hubOrigin: HUB_ORIGIN,
    accountId: ACCOUNT_ID,
  });
  const rescoped = deriveE2eeSafetyNumber({
    nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
    clientIdentityPublicKey: CLIENT_IDENTITY_PUBLIC,
    hubOrigin: OTHER_HUB_ORIGIN,
    accountId: ACCOUNT_ID,
  });
  cases.push({
    name: "safety-number-is-namespace-bound",
    sections: ["13.4"],
    note: "The same two identity keys under a different Hub origin MUST render a different number: the namespace is what makes the value long-term-meaningful.",
    inputs: {
      nodeIdentityPublicKey: b(NODE_IDENTITY_PUBLIC),
      clientIdentityPublicKey: b(CLIENT_IDENTITY_PUBLIC),
      accountId: ACCOUNT_ID,
      hubOriginA: HUB_ORIGIN,
      hubOriginB: OTHER_HUB_ORIGIN,
    },
    expected: {
      displayA: baseline.display,
      displayB: rescoped.display,
      differs: baseline.display !== rescoped.display,
    },
  });

  // §3.2.1 S11: E2EE_WEB_SAS_HKDF_BYTES · 8 ≥ E2EE_WEB_SAS_MIN_DISPLAYED_BITS
  const webSasDisplayedBits = E2EE_WEB_SAS_HKDF_BYTES * 8;
  const WEB_EPHEMERAL_SECRET = seedOf(0x13);
  const WEB_EPHEMERAL_PUBLIC = x25519.getPublicKey(WEB_EPHEMERAL_SECRET);
  const SESSION_BINDING_A = Uint8Array.from({ length: 32 }, (_u, index) => 0x50 + index);
  const SESSION_BINDING_B = Uint8Array.from({ length: 32 }, (_u, index) => 0x90 + index);

  for (const [name, sessionBindingHash] of [
    ["web-sas-session-one", SESSION_BINDING_A],
    ["web-sas-session-two", SESSION_BINDING_B],
  ] as const) {
    const derived = deriveE2eeWebSas({
      nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
      webEphemeralPublicKey: WEB_EPHEMERAL_PUBLIC,
      sessionBindingHash,
    });
    cases.push({
      name,
      sections: ["13.5", "3.2.1 S11"],
      note: "Unlike §13.4 this derivation HAS an Extract step and the salt is `sessionBindingHash`; that salt is the whole of the session binding. The value is per session and is NOT unforgeable against an active interposer (§13.5, §17.5).",
      inputs: {
        nodeIdentityPublicKey: b(NODE_IDENTITY_PUBLIC),
        testOnlyWebEphemeralSecretKey: b(WEB_EPHEMERAL_SECRET),
        webEphemeralPublicKey: b(WEB_EPHEMERAL_PUBLIC),
        sessionBindingHash: b(sessionBindingHash),
        hkdfInfo: "ryco.relay-e2ee.web-sas.v1",
      },
      expected: {
        inputArray: b(derived.input),
        prk: b(derived.prk),
        hkdfOutput: b(derived.output),
        display: derived.display,
        displayFormat: {
          chars: E2EE_WEB_SAS_CHARS.chars,
          groups: E2EE_WEB_SAS_CHARS.groups,
          charsPerGroup: E2EE_WEB_SAS_CHARS.charsPerGroup,
        },
        displayedEntropyBits: webSasDisplayedBits,
        minimumDisplayedEntropyBits: E2EE_WEB_SAS_MIN_DISPLAYED_BITS,
        satisfiesS11: webSasDisplayedBits >= E2EE_WEB_SAS_MIN_DISPLAYED_BITS,
      },
    });
  }

  const sasA = deriveE2eeWebSas({
    nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
    webEphemeralPublicKey: WEB_EPHEMERAL_PUBLIC,
    sessionBindingHash: SESSION_BINDING_A,
  });
  const sasB = deriveE2eeWebSas({
    nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
    webEphemeralPublicKey: WEB_EPHEMERAL_PUBLIC,
    sessionBindingHash: SESSION_BINDING_B,
  });
  cases.push({
    name: "web-sas-changes-every-session",
    sections: ["13.5"],
    note: "The same node key and the same web ephemeral under two session-binding hashes MUST render differently, which is what makes the value non-precomputable.",
    inputs: {
      sessionBindingHashA: b(SESSION_BINDING_A),
      sessionBindingHashB: b(SESSION_BINDING_B),
    },
    expected: {
      displayA: sasA.display,
      displayB: sasB.display,
      differs: sasA.display !== sasB.display,
    },
  });

  return {
    file: "f14-verification-display.json",
    number: 14,
    title: "Safety number and WebSAS",
    sections: ["13.4", "13.5", "3.2.1 S10", "3.2.1 S11", "16.3 F14"],
    summary:
      "The two owner-facing verification values: the §13.4 native safety number and the §13.5 `WebSAS`, each with its canonical-CBOR input array, its intermediate (`safetyNumberSecret`; `prk`), its HKDF output, and its exact rendered display string. Every rendering case additionally carries its displayed entropy against the §3.2.1 S10 and S11 floors, so both floors are discharged by fixture rather than by inspection.",
    deferred: [crossRuntimeDeferral(14)],
    testKeyMaterial: SHARED_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F1 — payload discrimination and chunk pipeline (§4.2, §4.3, §4.5) ───────
//
// The chunk-pipeline cases run at a deliberately small asserted
// `maxDataChunkBytes` so the fixture carries exact bytes rather than a
// quarter-megabyte of padding. The chunk layer is parametric in that limit and
// the code path is identical at any value, so nothing about the mechanics is
// lost; the case states the asserted limit as an explicit input. The §5.5
// advertisement floor is a CARRIER bound and is exercised by F3, not here.

const F1_ASSERTED_MAX_CHUNK_BYTES = 64;
/**
 * Hub-asserted `ready` limits chosen so the §4.5 ceilings are small enough to
 * write out exactly. `e2eeChannelSizeBudget` derives both from them.
 */
const F1_READY_LIMITS = { maxQueuedBytes: 384, maxControlFrameBytes: 256 } as const;
const F1_BUDGET = e2eeChannelSizeBudget(F1_READY_LIMITS);
const F1_SESSION_BINDING_HASH = Uint8Array.from({ length: 32 }, (_u, index) => 0x24 + index);

function freshSessionSecrets() {
  return e2eeSessionSecretsFromNoiseKeys({
    epochSecretC2N: seedOf(0x71),
    epochSecretN2C: seedOf(0x72),
    exporterSecret: seedOf(0x73),
  });
}

function newSession(
  direction: typeof E2EE_DIRECTION_CLIENT_TO_NODE | "n2c",
  plaintextCeiling = F1_BUDGET.plaintextCeiling,
): E2eeRecordSession {
  return new E2eeRecordSession({
    secrets: freshSessionSecrets(),
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash: F1_SESSION_BINDING_HASH,
    sendDirection: direction as typeof E2EE_DIRECTION_CLIENT_TO_NODE,
    plaintextCeiling,
  });
}

/**
 * One §4.2 send through a fresh session: the ceiling check, the inner-record
 * framing, the AEAD, and the envelope. `transmitted` counts the envelopes the
 * transmit callback actually saw, which is how the corpus asserts that a
 * refused record put NOTHING on the wire.
 */
async function protectOnce(
  body: Uint8Array,
  plaintextCeiling = F1_BUDGET.plaintextCeiling,
): Promise<{
  readonly result: Awaited<ReturnType<E2eeRecordSession["protect"]>>;
  readonly envelope: Uint8Array | undefined;
  readonly transmitted: number;
}> {
  const session = newSession(E2EE_DIRECTION_CLIENT_TO_NODE, plaintextCeiling);
  let envelope: Uint8Array | undefined;
  let transmitted = 0;
  const result = await session.protect({
    innerType: E2EE_INNER_TYPE_RPC,
    body,
    admit: () => true,
    transmit: (bytes) => {
      transmitted += 1;
      envelope = Uint8Array.from(bytes);
      return { kind: "sent" };
    },
  });
  session.erase();
  return { result, envelope, transmitted };
}

/** The receive side of §4.3 steps 1–2, exactly in order, over one wire payload. */
function receivePipeline(payload: Uint8Array): JsonValue {
  const assembler = new RelayMessageAssembler();
  const chunked = isChunkedPayload(payload);
  const pushed = assembler.push(payload);
  if (pushed.kind !== "done") {
    return {
      step1ChunkTest: { isChunkedPayload: chunked },
      step1Assembler: {
        kind: pushed.kind,
        ...(pushed.kind === "error" ? { reason: pushed.reason } : {}),
      },
    };
  }
  const postStrip = pushed.message;
  const klass = classifyPostStripPayload(postStrip);
  return {
    step1ChunkTest: { isChunkedPayload: chunked },
    step1Assembler: {
      kind: "done",
      postStripPayload: b(postStrip),
      postStripBytes: postStrip.byteLength,
      preludeStripped: postStrip.byteLength !== payload.byteLength,
      peerSupportsChunkingLatch: assembler.peerSupportsChunking,
    },
    step2Discrimination: {
      class: klass.kind,
      ...(klass.kind === "other" ? { reason: klass.reason } : {}),
    },
  };
}

function reassemble(payloads: readonly Uint8Array[]): JsonValue {
  const assembler = new RelayMessageAssembler();
  let message: Uint8Array | undefined;
  const steps = payloads.map((payload) => {
    const pushed = assembler.push(payload);
    if (pushed.kind === "done") message = pushed.message;
    return pushed.kind;
  });
  const klass = message === undefined ? undefined : classifyPostStripPayload(message);
  return {
    pushResults: steps,
    peerSupportsChunkingLatch: assembler.peerSupportsChunking,
    reassembled: message === undefined ? null : b(message),
    step2Discrimination: klass === undefined ? null : { class: klass.kind },
  };
}

async function buildFamily1(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];

  cases.push({
    name: "size-budget-under-the-relay-initial-limits",
    sections: ["4.5"],
    note: "The §4.5 ceilings under the limits the relay actually asserts by default, pinned as numbers so a change to `RELAY_MAX_RPC_MESSAGE_BYTES` or to `E2EE_ENVELOPE_OVERHEAD_BYTES` is visible here.",
    inputs: {
      maxQueuedBytes: 4 * 1_024 * 1_024,
      maxControlFrameBytes: 256 * 1_024,
      relayMaxRpcMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
    },
    expected: e2eeChannelSizeBudget({
      maxQueuedBytes: 4 * 1_024 * 1_024,
      maxControlFrameBytes: 256 * 1_024,
    }) as unknown as JsonValue,
  });

  cases.push({
    name: "size-budget-of-the-corpus-channel",
    sections: ["4.5"],
    note: "The asserted limits every other case in this family runs under.",
    inputs: { ...F1_READY_LIMITS },
    expected: F1_BUDGET as unknown as JsonValue,
  });

  // ── prelude ‖ envelope, and the no-headroom path ─────────────────────────
  const smallSend = await protectOnce(new Uint8Array(8).fill(0x5a));
  const envelope = smallSend.envelope!;
  const prepared = prepareRelayMessage(envelope, {
    maxChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
    maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
    peerSupportsChunking: false,
  });
  const preludedPayload = prepared.kind === "ready" ? prepared.payloads[0]! : new Uint8Array();

  cases.push({
    name: "prelude-then-envelope",
    sections: ["4.2 step 6", "4.3 steps 1-2", "3.4"],
    note: "§4.2 step 6: the envelope goes to the chunking layer UNCHANGED and takes the prelude like any other fitting message, so the peer's chunk-support latch behaves exactly as before this protocol.",
    inputs: {
      assertedMaxDataChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
      innerBodyBytes: 8,
      envelope: b(envelope),
      wirePayload: b(preludedPayload),
    },
    expected: {
      preludePresent: true,
      wirePayloadBytes: preludedPayload.byteLength,
      pipeline: receivePipeline(preludedPayload),
      firstPostStripByte: envelope[0]!,
    },
  });

  // The no-headroom path: an envelope that fits the chunk limit exactly, so
  // there is no room for the prelude and the payload is surfaced unchanged.
  const noHeadroomBody = new Uint8Array(F1_ASSERTED_MAX_CHUNK_BYTES - E2EE_ENVELOPE_OVERHEAD_BYTES);
  noHeadroomBody.fill(0x33);
  const noHeadroomSend = await protectOnce(noHeadroomBody);
  const noHeadroomEnvelope = noHeadroomSend.envelope!;
  const noHeadroomPrepared = prepareRelayMessage(noHeadroomEnvelope, {
    maxChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
    maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
    peerSupportsChunking: false,
  });
  const noHeadroomPayload =
    noHeadroomPrepared.kind === "ready" ? noHeadroomPrepared.payloads[0]! : new Uint8Array();
  cases.push({
    name: "envelope-without-prelude-no-headroom-path",
    sections: ["4.2 step 6", "4.3 steps 1-2"],
    inputs: {
      assertedMaxDataChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
      innerBodyBytes: noHeadroomBody.byteLength,
      wirePayload: b(noHeadroomPayload),
    },
    expected: {
      preludePresent: false,
      wirePayloadBytes: noHeadroomPayload.byteLength,
      surfacedUnchanged: hex(noHeadroomPayload) === hex(noHeadroomEnvelope),
      pipeline: receivePipeline(noHeadroomPayload),
    },
  });

  // ── the prelude-headroom boundary, in both directions ────────────────────
  for (const [name, envelopeBytes, preludeExpected] of [
    [
      "envelope-exactly-at-the-prelude-headroom-boundary",
      F1_ASSERTED_MAX_CHUNK_BYTES - RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
      true,
    ],
    [
      "envelope-one-byte-over-the-prelude-headroom-boundary",
      F1_ASSERTED_MAX_CHUNK_BYTES - RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES + 1,
      false,
    ],
  ] as const) {
    const body = new Uint8Array(envelopeBytes - E2EE_ENVELOPE_OVERHEAD_BYTES).fill(0x44);
    const send = await protectOnce(body);
    const built = send.envelope!;
    const ready = prepareRelayMessage(built, {
      maxChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
      maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
      peerSupportsChunking: false,
    });
    const payload = ready.kind === "ready" ? ready.payloads[0]! : new Uint8Array();
    cases.push({
      name,
      sections: ["4.2 step 6", "4.3 step 1"],
      note: "The prelude is prepended exactly when `len(message) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES ≤ assertedMaxDataChunkBytes`. These two cases sit on either side of that inequality.",
      inputs: {
        assertedMaxDataChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
        envelopeBytes: built.byteLength,
        wirePayload: b(payload),
      },
      expected: {
        preludePresent: preludeExpected,
        wirePayloadBytes: payload.byteLength,
        pipeline: receivePipeline(payload),
      },
    });
  }

  // ── the chunked path ──────────────────────────────────────────────────────
  const chunkedBody = new Uint8Array(96).fill(0x66);
  const chunkedSend = await protectOnce(chunkedBody);
  const chunkedEnvelope = chunkedSend.envelope!;
  const chunkedPrepared = prepareRelayMessage(chunkedEnvelope, {
    maxChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
    maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
    peerSupportsChunking: true,
  });
  const chunkPayloads = chunkedPrepared.kind === "ready" ? chunkedPrepared.payloads : [];
  cases.push({
    name: "chunked-envelope-reassembles-to-the-envelope",
    sections: ["4.2 step 6", "4.3 step 1", "3.4"],
    note: "Every chunk payload begins `RELAY_CHUNK_MAGIC`, which is why §4.3 forbids discriminating raw wire bytes: the discriminator is read only AFTER the assembler.",
    inputs: {
      assertedMaxDataChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
      envelopeBytes: chunkedEnvelope.byteLength,
      envelope: b(chunkedEnvelope),
      wirePayloads: chunkPayloads.map((payload) => b(payload)),
    },
    expected: {
      chunkCount: chunkPayloads.length,
      everyChunkStartsWithChunkMagic: chunkPayloads.every(
        (payload) => payload[0] === RELAY_CHUNK_MAGIC,
      ),
      chunkHeaderBytes: RELAY_CHUNK_HEADER_BYTES,
      reassembly: reassemble(chunkPayloads),
      reassembledEqualsEnvelope: true,
    },
  });

  // ── prelude ‖ legacy JSON ─────────────────────────────────────────────────
  const legacyJson = utf8.encode('{"_tag":"ryco.rpc.request","id":1}');
  const legacyPrepared = prepareRelayMessage(legacyJson, {
    maxChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
    maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
    peerSupportsChunking: false,
  });
  const legacyPayload =
    legacyPrepared.kind === "ready" ? legacyPrepared.payloads[0]! : new Uint8Array();
  cases.push({
    name: "prelude-then-legacy-json",
    sections: ["4.3 steps 1-2", "3.4"],
    inputs: {
      assertedMaxDataChunkBytes: F1_ASSERTED_MAX_CHUNK_BYTES,
      wirePayload: b(legacyPayload),
    },
    expected: { pipeline: receivePipeline(legacyPayload) },
  });

  // ── ciphertext with interior NUL runs ─────────────────────────────────────
  //
  // Built through the framing encoder with a synthetic ciphertext, because a
  // sender cannot choose the AEAD output: the point of the case is that a
  // post-strip payload holding `RELAY_CHUNK_MAGIC` runs at interior positions
  // is still classified by its FIRST byte and never re-enters the chunk parser.
  const nulCiphertext = Uint8Array.from({ length: 48 }, (_u, index) =>
    index >= 4 && index < 20 ? 0x00 : (index * 7 + 3) & 0xff,
  );
  const nulEnvelope = encodeE2eeEnvelope({
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    epoch: 0n,
    counter: 2n,
    ciphertext: nulCiphertext,
  });
  const nulDecoded = decodeE2eeEnvelope(nulEnvelope);
  cases.push({
    name: "ciphertext-with-interior-nul-runs",
    sections: ["4.3 steps 1-3", "3.3", "3.4"],
    note: "Synthetic ciphertext: a sender cannot choose AEAD output, and the property under test is a framing one. The payload holds a sixteen-byte run of `RELAY_CHUNK_MAGIC` at an interior offset and is still not a chunk, because the chunk test reads the FIRST byte.",
    inputs: { postStripPayload: b(nulEnvelope), interiorNulRun: { offset: 19, length: 16 } },
    expected: {
      isChunkedPayload: isChunkedPayload(nulEnvelope),
      pipeline: receivePipeline(nulEnvelope),
      envelopeDecode:
        nulDecoded.kind === "ok"
          ? {
              kind: "ok",
              version: nulDecoded.value.version,
              suite: nulDecoded.value.suite,
              epoch: Number(nulDecoded.value.epoch),
              counter: Number(nulDecoded.value.counter),
              header: b(nulDecoded.value.header),
            }
          : { kind: "error", reason: nulDecoded.reason },
    },
  });

  // ── zero-length inner body: a VALID §9.1 record ───────────────────────────
  const emptyBodySend = await protectOnce(new Uint8Array(0));
  const emptyBodyEnvelope = emptyBodySend.envelope!;
  const receiver = newSession("n2c");
  const emptyBodyReceived = receiver.unprotect(emptyBodyEnvelope);
  receiver.erase();
  cases.push({
    name: "envelope-with-a-zero-length-inner-body",
    sections: ["9.1", "3.3", "4.5"],
    note: "DISTINCT from the zero-length POST-STRIP payload cases below. A zero-length inner body is a valid §9.1 record; the envelope is exactly `E2EE_ENVELOPE_OVERHEAD_BYTES`, its minimum.",
    inputs: { innerType: E2EE_INNER_TYPE_RPC, innerBodyBytes: 0 },
    expected: {
      send:
        emptyBodySend.result.kind === "protected"
          ? {
              kind: "protected",
              epoch: Number(emptyBodySend.result.epoch),
              counter: Number(emptyBodySend.result.counter),
              plaintextBytes: emptyBodySend.result.plaintextBytes,
              envelopeBytes: emptyBodySend.result.envelopeBytes,
            }
          : { kind: emptyBodySend.result.kind },
      envelope: b(emptyBodyEnvelope),
      envelopeBytes: emptyBodyEnvelope.byteLength,
      envelopeOverheadBytes: E2EE_ENVELOPE_OVERHEAD_BYTES,
      receive:
        emptyBodyReceived.kind === "authenticated"
          ? {
              kind: "authenticated",
              innerType: emptyBodyReceived.innerType,
              bodyBytes: emptyBodyReceived.body.byteLength,
              plaintextBytes: emptyBodyReceived.plaintextBytes,
            }
          : { kind: "fatal", reason: emptyBodyReceived.reason },
    },
  });

  // ── the §4.5 plaintext ceiling, on both sides of it ──────────────────────
  const atCeiling = await protectOnce(new Uint8Array(F1_BUDGET.plaintextCeiling).fill(0x77));
  cases.push({
    name: "inner-body-exactly-at-the-plaintext-ceiling",
    sections: ["4.2 step 2", "4.5"],
    inputs: {
      ...F1_READY_LIMITS,
      plaintextCeiling: F1_BUDGET.plaintextCeiling,
      innerBodyBytes: F1_BUDGET.plaintextCeiling,
      // The byte the body is filled with, so the consuming test can protect the
      // SAME record and compare the envelope rather than believe it.
      innerBodyFill: 0x77,
    },
    expected: {
      send: atCeiling.result.kind,
      envelopeBytes: atCeiling.envelope!.byteLength,
      envelope: b(atCeiling.envelope!),
      transmittedRecords: atCeiling.transmitted,
    },
  });

  const productionLimits = {
    maxQueuedBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
    maxControlFrameBytes: 256 * 1_024,
  } as const;
  const productionBudget = e2eeChannelSizeBudget(productionLimits);
  const productionFill = 0x77;
  const productionCeiling = await protectOnce(
    new Uint8Array(productionBudget.plaintextCeiling).fill(productionFill),
    productionBudget.plaintextCeiling,
  );
  const productionEnvelope = productionCeiling.envelope!;
  cases.push({
    name: "production-inner-body-exactly-at-the-plaintext-ceiling-recipe",
    sections: ["4.2 step 2", "4.5", "16.4"],
    note: "The production-size boundary is represented by a deterministic fill recipe rather than embedding almost four MiB in the portable corpus. The independent runner rebuilds the whole envelope and verifies its digest plus both boundary slices.",
    inputs: {
      ...productionLimits,
      plaintextCeiling: productionBudget.plaintextCeiling,
      body: {
        $recipe: {
          kind: "fill",
          bytes: productionBudget.plaintextCeiling,
          byte: productionFill,
        },
      },
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      direction: E2EE_DIRECTION_CLIENT_TO_NODE,
      innerType: E2EE_INNER_TYPE_RPC,
      epoch: 0,
      counter: 0,
      epochSecret: b(seedOf(0x71)),
      sessionBindingHash: b(F1_SESSION_BINDING_HASH),
    },
    expected: {
      send: productionCeiling.result.kind,
      envelopeBytes: productionEnvelope.byteLength,
      envelopeSha256: sha256Hex(productionEnvelope),
      envelopePrefix: b(productionEnvelope.subarray(0, 32)),
      envelopeSuffix: b(productionEnvelope.subarray(-32)),
      transmittedRecords: productionCeiling.transmitted,
    },
  });

  const overCeiling = await protectOnce(new Uint8Array(F1_BUDGET.plaintextCeiling + 1).fill(0x77));
  cases.push({
    name: "inner-body-one-byte-over-the-plaintext-ceiling",
    sections: ["4.2 step 2", "4.5", "11.4"],
    note: "§4.2 step 2 is enforced BEFORE encryption: nothing is encrypted and nothing is transmitted, and `e2ee_message_too_large` is sender-local — the channel stays usable.",
    inputs: {
      plaintextCeiling: F1_BUDGET.plaintextCeiling,
      innerBodyBytes: F1_BUDGET.plaintextCeiling + 1,
      innerBodyFill: 0x77,
    },
    expected: {
      send:
        overCeiling.result.kind === "refused"
          ? { kind: "refused", reason: overCeiling.result.reason }
          : { kind: overCeiling.result.kind },
      transmittedRecords: overCeiling.transmitted,
      senderLocalError: "e2ee_message_too_large",
    },
  });

  // ── the two reachability paths to a zero-length POST-STRIP payload ───────
  //
  // §3.4 and §4.3 step 2. Each path is emitted in `negotiating`, `e2ee`, and
  // `legacy`; the §11 row is P6 before keys and Q6 after. The row itself is the
  // §4.4 mode machine's output and that machine is not in the shared modules
  // yet (see `deferred` below); what this family DERIVES is the pipeline result
  // the machine consumes — a zero-length post-strip payload classified `other`
  // with reason `empty`, and, on the prelude path, the chunk-support latch
  // already SET.
  const emptyPayload = new Uint8Array(0);
  const preludeOnlyPayload = Uint8Array.from(RELAY_CHUNK_CAPABILITY_PRELUDE);
  for (const [pathName, wirePayload] of [
    ["zero-length-data-payload", emptyPayload],
    ["data-payload-equal-to-the-chunk-capability-prelude", preludeOnlyPayload],
  ] as const) {
    const pipeline = receivePipeline(wirePayload);
    for (const state of ["negotiating", "e2ee", "legacy"] as const) {
      cases.push({
        name: `empty-post-strip-payload-${pathName}-in-${state}`,
        sections: ["3.4", "4.3 step 2", "11.2 P6", "11.3 Q6"],
        note:
          pathName === "data-payload-equal-to-the-chunk-capability-prelude"
            ? "The peer's chunk-support latch MUST still set before the fatal outcome is taken: the prelude was present and was stripped, and only then is the remainder found to be empty."
            : "A `data.payload` of length zero reaches the assembler, is not a chunk, carries no prelude, and surfaces as a zero-length post-strip payload.",
        inputs: { modeMachineState: state, wirePayload: b(wirePayload) },
        expected: {
          pipeline,
          fatal: state === "e2ee" ? "Q6" : "P6",
          disposition: state === "e2ee" ? "FATAL-POST" : "FATAL-PRE",
          neverSilentlyDropped: true,
          // `rowOwnedBy` was carried here and read by nothing. It said what this
          // family's own deferral already says — the §11 row is the §4.4 mode
          // machine's verdict, and no mode machine is reachable from
          // `packages/shared` — so it was an expectation-shaped restatement of a
          // deferral, and one no test could hold to anything. Deleted rather
          // than asserted: the ledger claims the deferral, and the deferral is
          // where a reader is told who owns the row.
        },
      });
    }
  }

  return {
    file: "f01-payload-discrimination.json",
    number: 1,
    title: "Payload discrimination and chunk pipeline",
    sections: ["4.2", "4.3", "4.5", "3.3", "3.4", "9.1", "11.4", "16.3 F1"],
    summary:
      "The §4.2 send pipeline and the §4.3 receive pipeline over exact wire bytes: prelude ‖ envelope, the no-headroom path, the chunked path, prelude ‖ legacy JSON, both sides of the prelude-headroom boundary, ciphertext holding interior `RELAY_CHUNK_MAGIC` runs, a zero-length inner body, both sides of the §4.5 plaintext ceiling, and the two reachability paths to a zero-length post-strip payload in all three modes.",
    deferred: [
      "The §11 row of each empty-payload case (P6 / Q6) is the §4.4 mode machine's verdict, and no mode machine is reachable from packages/shared/src: the node's lives in apps/server and the client's does not exist. The row is therefore carried here as the §16.2 condition label and the DERIVED expectation is the receive-pipeline result the machine consumes. The transition rows themselves are family F10, whose NODE rows are now generated and driven against the real runtime; its client rows remain deferred. Owned by the client phase.",
      crossRuntimeDeferral(1),
    ],
    testKeyMaterial: {
      note: "This family needs no signing key. The session secrets below are fixed test constants standing in for §6.5 `Split()` outputs; the handshake that really produces them is families F6 and F7.",
      testOnlyEpochSecretC2N: b(seedOf(0x71)),
      testOnlyEpochSecretN2C: b(seedOf(0x72)),
      testOnlyExporterSecret: b(seedOf(0x73)),
      sessionBindingHash: b(F1_SESSION_BINDING_HASH),
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
    },
    cases,
  };
}

// ─── F5 — continuity chains (§7.5, §13.3, §5.5) ──────────────────────────────

interface ChainCaseInput {
  readonly chain: readonly NodeIdentityContinuityChainEntry[];
  readonly hubOrigin: string;
  readonly continuityId: string;
  readonly identityPublicKey: Uint8Array;
  readonly pinnedIdentityFingerprint?: Uint8Array | undefined;
}

function chainOutcome(input: ChainCaseInput): JsonValue {
  const result = validateNodeE2eeContinuityChain(input);
  if (result.kind === "error") {
    return { kind: "error", failure: result.failure };
  }
  return {
    kind: "ok",
    certificates: result.certificates.length,
    ...(result.pinnedFingerprintUnchanged === undefined
      ? {}
      : {
          pinnedFingerprintUnchanged: result.pinnedFingerprintUnchanged,
          // §13.3: reaching the pin THROUGH the chain is the silent pin update.
          silentPinUpdate: result.pinnedFingerprintUnchanged === false,
        }),
  };
}

function chainInputJson(input: ChainCaseInput): JsonValue {
  return {
    hubOrigin: input.hubOrigin,
    continuityId: input.continuityId,
    identityPublicKey: b(input.identityPublicKey),
    ...(input.pinnedIdentityFingerprint === undefined
      ? {}
      : { pinnedIdentityFingerprint: b(input.pinnedIdentityFingerprint) }),
    chain: input.chain.map((entry) => ({
      transcript: b(entry.transcript),
      signature: b(entry.signature),
    })),
  };
}

function chainCase(
  name: string,
  sections: readonly string[],
  input: ChainCaseInput,
  note?: string,
): FixtureCase {
  return {
    name,
    sections,
    ...(note === undefined ? {} : { note }),
    inputs: chainInputJson(input),
    expected: chainOutcome(input),
  };
}

const OVERLONG_LINEAGE = buildContinuityLineage({
  hubOrigin: HUB_ORIGIN,
  continuityId: CONTINUITY_ID,
  seeds: [...MAX_CHAIN_SEEDS, seedOf(0x39)],
  publicKeys: [...MAX_CHAIN_PUBLIC, ed25519.getPublicKey(seedOf(0x39))],
  keyIds: [...MAX_CHAIN_KEY_IDS, `nkey_${"S".repeat(22)}`],
  firstGeneration: 1,
  createdAt: CREATED_AT,
});

function buildFamily5(): FixtureFamily {
  const cases: FixtureCase[] = [];
  const singleEntry = [SHORT_LINEAGE.entries[0]!];
  const oldFingerprint = e2eeKeyFingerprint("node-identity", NODE_OLD_IDENTITY_PUBLIC);
  const newFingerprint = e2eeKeyFingerprint("node-identity", NODE_NEW_IDENTITY_PUBLIC);

  cases.push(
    chainCase(
      "valid-chain-of-length-one-with-silent-pin-update",
      ["7.5", "13.3"],
      {
        chain: singleEntry,
        hubOrigin: HUB_ORIGIN,
        continuityId: CONTINUITY_ID,
        identityPublicKey: NODE_NEW_IDENTITY_PUBLIC,
        pinnedIdentityFingerprint: oldFingerprint,
      },
      "The verifier's pin is the key the node rotated away from; the chain walks from it to the current key, so the pin updates silently (§13.3) and no re-verification is raised.",
    ),
    chainCase(
      "valid-chain-with-a-pin-that-already-equals-the-current-key",
      ["7.5", "13.3"],
      {
        chain: SHORT_LINEAGE.entries,
        hubOrigin: HUB_ORIGIN,
        continuityId: CONTINUITY_ID,
        identityPublicKey: NODE_IDENTITY_PUBLIC,
        pinnedIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
      },
      "No rotation happened since the pin was recorded, so the chain is verified but the pin is unchanged — the contrast case for the silent update above.",
    ),
    chainCase("valid-chain-with-no-pin-held", ["7.5"], {
      chain: SHORT_LINEAGE.entries,
      hubOrigin: HUB_ORIGIN,
      continuityId: CONTINUITY_ID,
      identityPublicKey: NODE_IDENTITY_PUBLIC,
    }),
  );

  // ── the max-depth chain, run twice: short origin and maximum origin ───────
  for (const [name, lineage, hubOrigin] of [
    ["valid-max-length-chain-short-hub-origin", MAX_LINEAGE_SHORT_ORIGIN, HUB_ORIGIN],
    ["valid-max-length-chain-max-length-hub-origin", MAX_LINEAGE_MAX_ORIGIN, MAX_HUB_ORIGIN],
  ] as const) {
    const identityPublicKey = MAX_CHAIN_PUBLIC[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!;
    const pin = e2eeKeyFingerprint("node-identity", MAX_CHAIN_PUBLIC[0]!);
    const input: ChainCaseInput = {
      chain: lineage.entries,
      hubOrigin,
      continuityId: CONTINUITY_ID,
      identityPublicKey,
      pinnedIdentityFingerprint: pin,
    };
    const statement = buildStatement({
      hubOrigin,
      identitySeed: MAX_CHAIN_SEEDS[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!,
      identityPublicKey,
      identityKeyId: MAX_CHAIN_KEY_IDS[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!,
      chain: lineage.entries,
      suiteRegistry: Array.from(
        { length: E2EE_SUITE_REGISTRY_MAX_ENTRIES },
        () => E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      ),
      policyGeneration: MAX_SIZE_TIMESTAMP,
      issuedAt: MAX_SIZE_TIMESTAMP,
      expiresAt: MAX_SIZE_TIMESTAMP,
      prekeyCreatedAt: MAX_SIZE_TIMESTAMP,
      prekeyExpiresAt: MAX_SIZE_TIMESTAMP,
    });
    cases.push({
      name,
      sections: ["7.5", "13.3", "5.5", "3.2.1 S6"],
      note: "Depth and Hub-origin length MULTIPLY: the origin is repeated once per chain entry and once in the statement, so the maximum chain is measured against the carrier bounds at both origin lengths in one case rather than in two unrelated fixtures. The long-origin run additionally shows the silent-pin-update expectation is unchanged by origin length — effective chain depth may not depend on how long the Hub origin is.",
      inputs: {
        ...(chainInputJson(input) as Record<string, JsonValue>),
        hubOriginBytes: Buffer.byteLength(hubOrigin, "utf8"),
        chainLength: lineage.entries.length,
      },
      expected: {
        chain: chainOutcome(input),
        continuityTranscriptBytes: lineage.entries[0]!.transcript.byteLength,
        capabilityTranscriptBytes: statement.transcript.byteLength,
        statementBytes: statement.statement.byteLength,
        carrierBytes: statement.carrierBytes,
        carrierMaxBytes: E2EE_CAPABILITY_CARRIER_MAX_BYTES,
        carrierFits: statement.carrierBytes <= E2EE_CAPABILITY_CARRIER_MAX_BYTES,
        carrierPlusPreludeBytes: statement.carrierBytes + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
        advertisementMinChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
        satisfiesS6:
          statement.carrierBytes + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES <=
          E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      },
    });
  }

  // ── the invalid shapes ────────────────────────────────────────────────────
  const maxChain = MAX_LINEAGE_SHORT_ORIGIN.entries;
  const maxIdentity = MAX_CHAIN_PUBLIC[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!;
  const maxPin = e2eeKeyFingerprint("node-identity", MAX_CHAIN_PUBLIC[0]!);
  const base = {
    hubOrigin: HUB_ORIGIN,
    continuityId: CONTINUITY_ID,
    identityPublicKey: maxIdentity,
    pinnedIdentityFingerprint: maxPin,
  } as const;

  cases.push(
    chainCase(
      "missing-link",
      ["7.5"],
      { ...base, chain: [maxChain[0]!, ...maxChain.slice(2)] },
      "An interior entry removed. §7.5 checks generation consecutiveness before the key link, so this surfaces as `generation_not_consecutive`; the link check is exercised by the splice case below, which keeps generations consecutive.",
    ),
    chainCase(
      "reordered-entries",
      ["7.5"],
      { ...base, chain: [maxChain[1]!, maxChain[0]!, ...maxChain.slice(2)] },
      "Two adjacent entries swapped.",
    ),
    chainCase(
      "truncated-chain-head",
      ["7.5", "13.3"],
      { ...base, chain: maxChain.slice(1) },
      "Internally consistent and it reaches the current identity key, but it no longer reaches the verifier's pin: channel-fatal, and it takes the §13.3 re-verification path rather than a silent pin update.",
    ),
    chainCase(
      "truncated-chain-tail",
      ["7.5"],
      { ...base, chain: maxChain.slice(0, -1) },
      "The last rotation dropped, so the chain's final new key is not the statement's identity key.",
    ),
    chainCase(
      "over-length-chain",
      ["7.5", "15"],
      {
        chain: OVERLONG_LINEAGE.entries,
        hubOrigin: HUB_ORIGIN,
        continuityId: CONTINUITY_ID,
        identityPublicKey: ed25519.getPublicKey(seedOf(0x39)),
      },
      `${E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1} entries against a bound of ${E2EE_CONTINUITY_CHAIN_MAX_LENGTH}; rejected on the length alone, before any entry is decoded.`,
    ),
    chainCase("hub-origin-mismatch", ["7.5"], {
      ...base,
      chain: maxChain,
      hubOrigin: OTHER_HUB_ORIGIN,
    }),
    chainCase(
      "chain-continuity-id-disagrees-with-statement-element-18",
      ["7.5", "7.6"],
      { ...base, chain: maxChain, continuityId: OTHER_CONTINUITY_ID },
      "Element 18 of the statement against the entries' own continuity id. §7.5 makes every entry carry the statement-level value, which subsumes the requirement that the entries agree with each other.",
    ),
  );

  // A spliced key: the entry's generation is right, its continuity id and Hub
  // origin are right, and it is correctly signed by the key it names as
  // outgoing — but that key is not the previous entry's incoming key.
  {
    const splicedTranscript = encodeNodeIdentityContinuityTranscript({
      hubOrigin: HUB_ORIGIN,
      continuityId: CONTINUITY_ID,
      generation: MAX_SIZE_FIRST_GENERATION + 1,
      oldKeyId: `nkey_${"T".repeat(22)}`,
      oldPublicKey: UNRELATED_IDENTITY_PUBLIC,
      newKeyId: MAX_CHAIN_KEY_IDS[2]!,
      newPublicKey: MAX_CHAIN_PUBLIC[2]!,
      createdAt: MAX_SIZE_TIMESTAMP,
    });
    const spliced: NodeIdentityContinuityChainEntry = {
      transcript: splicedTranscript,
      signature: signNode(splicedTranscript, UNRELATED_IDENTITY_SEED),
    };
    cases.push(
      chainCase(
        "spliced-key",
        ["7.5"],
        { ...base, chain: [maxChain[0]!, spliced, ...maxChain.slice(2)] },
        "Correctly signed by the key it names as outgoing, with the right generation, the right continuity id, and the right Hub origin — and still rejected, because that key is not the previous entry's incoming key. This is the case a chain walk that verified signatures without linking them would pass.",
      ),
    );
  }

  // A generation gap and a generation regression, with the links left intact so
  // the generation rule is what fails.
  for (const [name, generation, note] of [
    [
      "generation-gap",
      MAX_SIZE_FIRST_GENERATION + 3,
      "Entry 1's generation skips one while its key link stays correct.",
    ],
    [
      "generation-regression",
      MAX_SIZE_FIRST_GENERATION - 1,
      "Entry 1's generation goes backwards while its key link stays correct.",
    ],
  ] as const) {
    const transcript = encodeNodeIdentityContinuityTranscript({
      hubOrigin: HUB_ORIGIN,
      continuityId: CONTINUITY_ID,
      generation,
      oldKeyId: MAX_CHAIN_KEY_IDS[1]!,
      oldPublicKey: MAX_CHAIN_PUBLIC[1]!,
      newKeyId: MAX_CHAIN_KEY_IDS[2]!,
      newPublicKey: MAX_CHAIN_PUBLIC[2]!,
      createdAt: MAX_SIZE_TIMESTAMP,
    });
    cases.push(
      chainCase(
        name,
        ["7.5"],
        {
          ...base,
          chain: [
            maxChain[0]!,
            { transcript, signature: signNode(transcript, MAX_CHAIN_SEEDS[1]!) },
            ...maxChain.slice(2),
          ],
        },
        note,
      ),
    );
  }

  // An invalid signature: one flipped bit in entry 1's signature.
  {
    const tampered = Uint8Array.from(maxChain[1]!.signature);
    tampered[0] = tampered[0]! ^ 0x01;
    cases.push(
      chainCase(
        "invalid-signature",
        ["7.5", "14.3"],
        {
          ...base,
          chain: [maxChain[0]!, { ...maxChain[1]!, signature: tampered }, ...maxChain.slice(2)],
        },
        "One bit flipped in one entry's signature — the smallest possible tamper.",
      ),
    );
  }

  // Two entries carrying different continuity ids, with the statement agreeing
  // with the first: §7.5 requires every entry to carry the identical value.
  {
    const foreign = encodeNodeIdentityContinuityTranscript({
      hubOrigin: HUB_ORIGIN,
      continuityId: OTHER_CONTINUITY_ID,
      generation: MAX_SIZE_FIRST_GENERATION + 1,
      oldKeyId: MAX_CHAIN_KEY_IDS[1]!,
      oldPublicKey: MAX_CHAIN_PUBLIC[1]!,
      newKeyId: MAX_CHAIN_KEY_IDS[2]!,
      newPublicKey: MAX_CHAIN_PUBLIC[2]!,
      createdAt: MAX_SIZE_TIMESTAMP,
    });
    cases.push(
      chainCase("mixed-continuity-ids-within-the-chain", ["7.5"], {
        ...base,
        chain: [
          maxChain[0]!,
          { transcript: foreign, signature: signNode(foreign, MAX_CHAIN_SEEDS[1]!) },
          ...maxChain.slice(2),
        ],
      }),
    );
  }

  // Shapes that are not chains at all, and an identity key this protocol will
  // not represent.
  {
    const truncatedTranscript = maxChain[0]!.transcript.subarray(
      0,
      maxChain[0]!.transcript.byteLength - 1,
    );
    cases.push(
      chainCase(
        "malformed-entry-truncated-transcript",
        ["7.5", "3.6"],
        {
          ...base,
          chain: [{ transcript: truncatedTranscript, signature: maxChain[0]!.signature }],
        },
        "Peer bytes that do not decode under the §3.6 strict profile are a typed failure, never a thrown error.",
      ),
      chainCase(
        "invalid-identity-key",
        ["7.5", "7.1"],
        {
          chain: [],
          hubOrigin: HUB_ORIGIN,
          continuityId: CONTINUITY_ID,
          identityPublicKey: new Uint8Array(31),
        },
        "Element 5 of the statement, reachable with no entries at all, so it is its own failure and never an entry's.",
      ),
      chainCase(
        "empty-chain-from-a-never-rotated-node",
        ["7.5", "7.6"],
        {
          chain: [],
          hubOrigin: HUB_ORIGIN,
          continuityId: CONTINUITY_ID,
          identityPublicKey: NODE_IDENTITY_PUBLIC,
        },
        "An empty chain is VALID: the node has never rotated. Element 18 is still required, which family F3 pins.",
      ),
    );
  }

  return {
    file: "f05-continuity-chains.json",
    number: 5,
    title: "Continuity chains",
    sections: ["7.5", "13.3", "5.5", "3.2.1 S6", "16.3 F5"],
    summary:
      "The §7.5 chain rules over exact carried entries: valid chains of length one and of `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` with the §13.3 silent-pin-update expectation, the max-depth chain run at both a short Hub origin and one of exactly `E2EE_HUB_ORIGIN_MAX_BYTES` with the carrier-fit assertions of §5.5 and §3.2.1 S6, and one case per invalid shape.",
    deferred: [
      "A chain whose continuity id disagrees with the PINNED value. `validateNodeE2eeContinuityChain` takes a pinned identity fingerprint and no pinned continuity id; the §13.1 durable pin record that holds one is not in packages/shared/src yet, so the comparison has no implementation to derive an expectation from. Owned by the client trust-state work (§13.1, §13.3).",
      "The §7.5 continuity-id storage and anchor cases (the five startup outcomes, the never-rotated anchor restore, and the pre-protocol migration mint). These are node-state transitions against a durable anchor. The state machine that decides them now EXISTS — `NodeContinuityAnchor` and the identity runtime in apps/server, which this generator sits under in the dependency graph and cannot import — and it is covered by its own module tests, but the outcomes have not been transcribed into this corpus and no consuming test holds the runtime to a committed table of them, as family F10's rows and family F18's transitions now are. Owned by the node phase.",
    ],
    testKeyMaterial: {
      ...(SHARED_TEST_KEY_MATERIAL as Record<string, JsonValue>),
      testOnlyMaxLengthLineageSeeds: MAX_CHAIN_SEEDS.map((seed) => b(seed)),
      maxLengthLineagePublicKeys: MAX_CHAIN_PUBLIC.map((key) => b(key)),
      maxLengthLineageKeyIds: MAX_CHAIN_KEY_IDS,
      maxLengthLineageFirstGeneration: MAX_SIZE_FIRST_GENERATION,
      maxHubOrigin: MAX_HUB_ORIGIN,
      shortLineageFingerprints: {
        old: b(oldFingerprint),
        intermediate: b(newFingerprint),
        current: b(NODE_IDENTITY_FINGERPRINT),
      },
    },
    cases,
  };
}

// ─── F4 — prekey certificates (§7.3, §7.4, §6.4) ─────────────────────────────

const CLIENT_PREKEY_TRANSCRIPT = encodeClientE2eePrekeyTranscript({
  hubOrigin: HUB_ORIGIN,
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
});
const CLIENT_PREKEY_SIGNATURE = signClient(CLIENT_PREKEY_TRANSCRIPT);

function clientPrekeyOutcome(input: {
  readonly transcript: Uint8Array;
  readonly signature: Uint8Array;
  readonly hubOrigin: string;
  readonly now: number;
}): JsonValue {
  const result = verifyE2eeClientPrekeyCertificate({
    transcript: input.transcript,
    signature: input.signature,
    hubOrigin: input.hubOrigin,
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    now: input.now,
  });
  if (result.kind === "error") return { kind: "error", failure: result.failure };
  return {
    kind: "ok",
    accountId: result.certificate.accountId,
    identityFingerprint: b(result.certificate.identityFingerprint),
    agreementFingerprint: b(result.certificate.agreementFingerprint),
  };
}

function clientPrekeyCase(options: {
  readonly name: string;
  readonly sections: readonly string[];
  readonly note?: string;
  readonly transcript?: Uint8Array;
  readonly signature?: Uint8Array;
  readonly hubOrigin?: string;
  readonly now?: number;
  readonly extraInputs?: Record<string, JsonValue>;
}): FixtureCase {
  const transcript = options.transcript ?? CLIENT_PREKEY_TRANSCRIPT;
  const signature = options.signature ?? CLIENT_PREKEY_SIGNATURE;
  const hubOrigin = options.hubOrigin ?? HUB_ORIGIN;
  const now = options.now ?? NOW;
  return {
    name: options.name,
    sections: options.sections,
    ...(options.note === undefined ? {} : { note: options.note }),
    inputs: {
      transcript: b(transcript),
      signature: b(signature),
      channelHubOrigin: hubOrigin,
      negotiatedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      now,
      ...options.extraInputs,
    },
    expected: {
      step5: clientPrekeyOutcome({ transcript, signature, hubOrigin, now }),
      ...(options.name.startsWith("valid") || options.name.includes("-accepted-")
        ? {}
        : { fatal: "P11" }),
    },
  };
}

function buildFamily4(): FixtureFamily {
  const cases: FixtureCase[] = [];

  // ── §7.3, the node certificate, through the §7.6 reconstruction ──────────
  const nodePrekeyTranscript = encodeNodeE2eePrekeyTranscript({
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    prekeyId: PREKEY_ID,
    identityPublicKey: NODE_IDENTITY_PUBLIC,
    agreementPublicKey: NODE_AGREEMENT_PUBLIC,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  });
  const nodeCrossSignature = signNode(nodePrekeyTranscript);

  const reconstruction = (overrides: {
    readonly hubOrigin?: string;
    readonly identityFingerprint?: Uint8Array;
    readonly agreementFingerprint?: Uint8Array;
    readonly crossSignature?: Uint8Array;
    readonly prekeyId?: string;
    readonly createdAt?: number;
  }): boolean =>
    verifyNodeE2eeCapabilityCrossSignature({
      hubOrigin: overrides.hubOrigin ?? HUB_ORIGIN,
      nodeId: NODE_ID,
      identityKeyId: IDENTITY_KEY_ID,
      identityPublicKey: NODE_IDENTITY_PUBLIC,
      identityFingerprint: overrides.identityFingerprint ?? NODE_IDENTITY_FINGERPRINT,
      prekeyCertificate: {
        prekeyId: overrides.prekeyId ?? PREKEY_ID,
        agreementPublicKey: NODE_AGREEMENT_PUBLIC,
        agreementFingerprint: overrides.agreementFingerprint ?? NODE_AGREEMENT_FINGERPRINT,
        crossSignature: overrides.crossSignature ?? nodeCrossSignature,
        createdAt: overrides.createdAt ?? CREATED_AT,
        expiresAt: EXPIRES_AT,
      },
    });

  cases.push({
    name: "valid-node-agreement-prekey-certificate",
    sections: ["7.3", "7.6"],
    note: "The statement does not carry the §7.3 transcript bytes; the verifier REBUILDS them from the statement's own identity fields and prekey members, and that reconstruction is what binds the advertised prekey to the advertised identity.",
    inputs: {
      hubOrigin: HUB_ORIGIN,
      nodeId: NODE_ID,
      identityKeyId: IDENTITY_KEY_ID,
      prekeyId: PREKEY_ID,
      identityPublicKey: b(NODE_IDENTITY_PUBLIC),
      agreementPublicKey: b(NODE_AGREEMENT_PUBLIC),
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      noiseUsage: { dh: "25519", hash: "SHA256" },
    },
    expected: {
      transcript: b(nodePrekeyTranscript),
      transcriptBytes: nodePrekeyTranscript.byteLength,
      transcriptSha256: sha256Hex(nodePrekeyTranscript),
      identityFingerprint: b(NODE_IDENTITY_FINGERPRINT),
      agreementFingerprint: b(NODE_AGREEMENT_FINGERPRINT),
      crossSignature: b(nodeCrossSignature),
      crossSignatureReconstructionVerifies: reconstruction({}),
      withinDirectSigningBound:
        nodePrekeyTranscript.byteLength <= E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
    },
  });

  {
    const maxOriginTranscript = encodeNodeE2eePrekeyTranscript({
      hubOrigin: MAX_HUB_ORIGIN,
      nodeId: NODE_ID,
      identityKeyId: IDENTITY_KEY_ID,
      prekeyId: PREKEY_ID,
      identityPublicKey: NODE_IDENTITY_PUBLIC,
      agreementPublicKey: NODE_AGREEMENT_PUBLIC,
      createdAt: MAX_SIZE_TIMESTAMP,
      expiresAt: MAX_SIZE_TIMESTAMP,
    });
    cases.push({
      name: "node-certificate-at-the-maximum-hub-origin-accepted-and-within-S9",
      sections: ["7.3", "3.2.1 S9"],
      note: "Every field the §7.3 encoder copies verbatim is carried here as an INPUT, so a consumer can rebuild the transcript from the inputs alone and compare against the committed bytes. Rebuilding it from the committed bytes instead would compare each copied element with itself.",
      inputs: {
        hubOrigin: MAX_HUB_ORIGIN,
        hubOriginBytes: Buffer.byteLength(MAX_HUB_ORIGIN, "utf8"),
        hubOriginMaxBytes: E2EE_HUB_ORIGIN_MAX_BYTES,
        nodeId: NODE_ID,
        identityKeyId: IDENTITY_KEY_ID,
        prekeyId: PREKEY_ID,
        identityPublicKey: b(NODE_IDENTITY_PUBLIC),
        agreementPublicKey: b(NODE_AGREEMENT_PUBLIC),
        createdAt: MAX_SIZE_TIMESTAMP,
        expiresAt: MAX_SIZE_TIMESTAMP,
      },
      expected: {
        transcript: b(maxOriginTranscript),
        transcriptBytes: maxOriginTranscript.byteLength,
        directSigningTranscriptMaxBytes: E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
        satisfiesS9: maxOriginTranscript.byteLength <= E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
      },
    });
  }

  cases.push({
    name: "node-certificate-cross-signature-lifted-from-another-hub-origin",
    sections: ["7.3", "7.6"],
    note: "A prekey lifted out of a statement for a different Hub origin reconstructs to different bytes and fails there — no signature check is needed to see it.",
    inputs: { statementHubOrigin: HUB_ORIGIN, crossSignatureBoundToHubOrigin: OTHER_HUB_ORIGIN },
    expected: {
      crossSignatureReconstructionVerifies: reconstruction({
        crossSignature: signNode(
          encodeNodeE2eePrekeyTranscript({
            hubOrigin: OTHER_HUB_ORIGIN,
            nodeId: NODE_ID,
            identityKeyId: IDENTITY_KEY_ID,
            prekeyId: PREKEY_ID,
            identityPublicKey: NODE_IDENTITY_PUBLIC,
            agreementPublicKey: NODE_AGREEMENT_PUBLIC,
            createdAt: CREATED_AT,
            expiresAt: EXPIRES_AT,
          }),
        ),
      }),
    },
  });

  cases.push({
    name: "node-certificate-carried-identity-fingerprint-disagrees-with-the-identity-key",
    sections: ["7.1", "7.6"],
    note: "§7.6 rebuilds element 7 of the §7.3 array from the statement's CARRIED element 6, so a statement that disagrees with itself reconstructs to bytes the cross-signature does not cover. Re-deriving the fingerprint instead would repair the disagreement and admit the statement.",
    inputs: {
      carriedIdentityFingerprint: b(e2eeKeyFingerprint("node-identity", UNRELATED_IDENTITY_PUBLIC)),
      recomputedIdentityFingerprint: b(NODE_IDENTITY_FINGERPRINT),
    },
    expected: {
      crossSignatureReconstructionVerifies: reconstruction({
        identityFingerprint: e2eeKeyFingerprint("node-identity", UNRELATED_IDENTITY_PUBLIC),
      }),
    },
  });

  cases.push({
    name: "node-certificate-carried-agreement-fingerprint-disagrees-with-the-agreement-key",
    sections: ["7.1", "7.6"],
    inputs: {
      carriedAgreementFingerprint: b(e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC)),
      recomputedAgreementFingerprint: b(NODE_AGREEMENT_FINGERPRINT),
    },
    expected: {
      crossSignatureReconstructionVerifies: reconstruction({
        agreementFingerprint: e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC),
      }),
    },
  });

  cases.push({
    name: "node-certificate-prekey-id-substituted-after-signing",
    sections: ["7.3", "7.6"],
    inputs: { signedPrekeyId: PREKEY_ID, carriedPrekeyId: `epk_${"Z".repeat(22)}` },
    expected: {
      crossSignatureReconstructionVerifies: reconstruction({ prekeyId: `epk_${"Z".repeat(22)}` }),
    },
  });

  cases.push({
    name: "node-certificate-usage-fields-are-not-carrier-supplied",
    sections: ["7.3", "3.4"],
    note: "§7.3 elements 9 and 10 pin the agreement key's Noise usage to the suite functions. They are ENCODER-DERIVED on both sides, so a statement cannot present different ones: the reconstruction rebuilds `25519`/`SHA256` and a signature made over any other usage fails.",
    inputs: {
      mutatedTranscript: b(mutateElement(nodePrekeyTranscript, 9, "448")),
      mutatedUsageDh: "448",
    },
    expected: {
      crossSignatureReconstructionVerifies: reconstruction({
        crossSignature: signNode(mutateElement(nodePrekeyTranscript, 9, "448")),
      }),
      reconstructedUsageDh: "25519",
      reconstructedUsageHash: "SHA256",
    },
  });

  // ── §7.4, the client certificate, through §8.6 step 5 ────────────────────
  cases.push(
    clientPrekeyCase({
      name: "valid-client-agreement-prekey-certificate",
      sections: ["7.4", "8.6 step 5"],
      note: "The §8.6 step 5 re-encode equality is against the §7.4 ENCODER ITSELF, so the domain, the algorithm label, the element order, the derived identity fingerprint, and the usage fields are all checked by construction.",
      extraInputs: {
        transcriptSha256: sha256Hex(CLIENT_PREKEY_TRANSCRIPT),
        transcriptBytes: CLIENT_PREKEY_TRANSCRIPT.byteLength,
      },
    }),
  );

  {
    const maxTranscript = encodeClientE2eePrekeyTranscript({
      hubOrigin: MAX_HUB_ORIGIN,
      accountId: MAX_ACCOUNT_ID,
      identityPublicKey: CLIENT_IDENTITY_PUBLIC,
      agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
      createdAt: MAX_SIZE_TIMESTAMP,
      expiresAt: MAX_SIZE_TIMESTAMP + E2EE_PREKEY_LIFETIME,
    });
    cases.push({
      name: "client-certificate-at-the-maximum-namespace-accepted-and-within-S9",
      sections: ["7.4", "3.2.1 S9"],
      note: "The largest §7.4 transcript the bounds admit: Hub origin at `E2EE_HUB_ORIGIN_MAX_BYTES`, account id at `E2EE_ACCOUNT_ID_MAX_BYTES`, every unsigned field at its widest canonical encoding. It is the largest of the three directly signed transcripts, so it is the one S9 turns on. Every encoder input is carried here rather than left to be read back out of the committed transcript, for the reason the node case beside it states.",
      inputs: {
        hubOrigin: MAX_HUB_ORIGIN,
        hubOriginBytes: Buffer.byteLength(MAX_HUB_ORIGIN, "utf8"),
        accountId: MAX_ACCOUNT_ID,
        accountIdBytes: Buffer.byteLength(MAX_ACCOUNT_ID, "utf8"),
        accountIdMaxBytes: E2EE_ACCOUNT_ID_MAX_BYTES,
        identityPublicKey: b(CLIENT_IDENTITY_PUBLIC),
        agreementPublicKey: b(CLIENT_AGREEMENT_PUBLIC),
        createdAt: MAX_SIZE_TIMESTAMP,
        expiresAt: MAX_SIZE_TIMESTAMP + E2EE_PREKEY_LIFETIME,
      },
      expected: {
        transcript: b(maxTranscript),
        transcriptBytes: maxTranscript.byteLength,
        directSigningTranscriptMaxBytes: E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
        satisfiesS9: maxTranscript.byteLength <= E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
        signingInputMaxBytes: E2EE_SIGNING_INPUT_MAX_BYTES,
        satisfiesS2: E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES <= E2EE_SIGNING_INPUT_MAX_BYTES,
      },
    });
  }

  // §6.4: validity, evaluated at handshake time against the verifier's clock
  // with at most `E2EE_MAX_CLOCK_SKEW` allowance, on both sides of each edge.
  for (const [name, now, note] of [
    [
      "client-certificate-not-yet-valid-accepted-exactly-at-the-clock-skew-boundary",
      CREATED_AT - E2EE_MAX_CLOCK_SKEW,
      "The verifier's clock is `E2EE_MAX_CLOCK_SKEW` behind the certificate's creation, which §6.4 tolerates exactly.",
    ],
    [
      "client-certificate-not-yet-valid-one-millisecond-beyond-the-clock-skew-boundary",
      CREATED_AT - E2EE_MAX_CLOCK_SKEW - 1,
      undefined,
    ],
    [
      "client-certificate-expiry-accepted-exactly-at-the-clock-skew-boundary",
      EXPIRES_AT + E2EE_MAX_CLOCK_SKEW,
      "The verifier's clock is `E2EE_MAX_CLOCK_SKEW` past expiry, which §6.4 tolerates exactly.",
    ],
    [
      "client-certificate-expiry-one-millisecond-beyond-the-clock-skew-boundary",
      EXPIRES_AT + E2EE_MAX_CLOCK_SKEW + 1,
      undefined,
    ],
  ] as const) {
    cases.push(
      clientPrekeyCase({
        name,
        sections: ["6.4", "8.6 step 5"],
        ...(note === undefined ? {} : { note }),
        now,
        extraInputs: {
          certificateCreatedAt: CREATED_AT,
          certificateExpiresAt: EXPIRES_AT,
          maxClockSkew: E2EE_MAX_CLOCK_SKEW,
        },
      }),
    );
  }

  {
    const overLifetime = encodeClientE2eePrekeyTranscript({
      hubOrigin: HUB_ORIGIN,
      accountId: ACCOUNT_ID,
      identityPublicKey: CLIENT_IDENTITY_PUBLIC,
      agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
      createdAt: CREATED_AT,
      expiresAt: CREATED_AT + E2EE_PREKEY_LIFETIME + 1,
    });
    cases.push(
      clientPrekeyCase({
        name: "client-certificate-lifetime-one-millisecond-over-the-prekey-lifetime",
        sections: ["6.4"],
        transcript: overLifetime,
        signature: signClient(overLifetime),
        now: CREATED_AT,
        extraInputs: { prekeyLifetime: E2EE_PREKEY_LIFETIME },
      }),
    );
  }

  {
    const foreignOrigin = encodeClientE2eePrekeyTranscript({
      hubOrigin: OTHER_HUB_ORIGIN,
      accountId: ACCOUNT_ID,
      identityPublicKey: CLIENT_IDENTITY_PUBLIC,
      agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
    });
    cases.push(
      clientPrekeyCase({
        name: "client-certificate-wrong-hub-origin-namespace",
        sections: ["7.4", "8.6 step 5"],
        transcript: foreignOrigin,
        signature: signClient(foreignOrigin),
        extraInputs: { certificateHubOrigin: OTHER_HUB_ORIGIN },
      }),
    );

    const foreignAccount = encodeClientE2eePrekeyTranscript({
      hubOrigin: HUB_ORIGIN,
      accountId: "acct_9876543210",
      identityPublicKey: CLIENT_IDENTITY_PUBLIC,
      agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
    });
    cases.push({
      name: "client-certificate-foreign-account-id-passes-step-5-and-is-caught-elsewhere",
      sections: ["7.4", "8.6 step 5", "8.3 element 10"],
      note: "§8.6 step 5 compares the certificate's HUB ORIGIN against the channel's and does not compare the account id; the account half of the namespace is bound by §8.3 element 10 and a substitution there is the cross-account splice of family F16. This case pins step 5's actual verdict so no reader assumes the check lives here.",
      inputs: {
        transcript: b(foreignAccount),
        signature: b(signClient(foreignAccount)),
        channelHubOrigin: HUB_ORIGIN,
        certificateAccountId: "acct_9876543210",
        channelAccountId: ACCOUNT_ID,
        now: NOW,
      },
      expected: {
        step5: clientPrekeyOutcome({
          transcript: foreignAccount,
          signature: signClient(foreignAccount),
          hubOrigin: HUB_ORIGIN,
          now: NOW,
        }),
        enforcedBy: "§8.3 element 10, evaluated at §8.6 step 7 (family F16)",
      },
    });
  }

  cases.push(
    clientPrekeyCase({
      name: "client-certificate-usage-field-substituted",
      sections: ["7.4", "8.6 step 5", "3.4"],
      note: "The §7.4 usage fields are encoder-derived, so the re-encode equality catches a usage substitution BEFORE the usage comparison runs. `usage_mismatch` is therefore reachable only once a suite registers different usage fields; today the substitution is `malformed`, which this case pins rather than assuming.",
      transcript: mutateElement(CLIENT_PREKEY_TRANSCRIPT, 7, "448"),
      signature: signClient(mutateElement(CLIENT_PREKEY_TRANSCRIPT, 7, "448")),
      extraInputs: { substitutedUsageDh: "448" },
    }),
    clientPrekeyCase({
      name: "client-certificate-invalid-signature",
      sections: ["7.4", "14.3"],
      signature: flipBit(CLIENT_PREKEY_SIGNATURE, 0),
    }),
    clientPrekeyCase({
      name: "client-certificate-signed-by-another-device-key",
      sections: ["7.4", "14.3"],
      signature: signClient(CLIENT_PREKEY_TRANSCRIPT, seedOf(0x41)),
      extraInputs: { testOnlyForeignClientIdentitySecretKey: b(seedOf(0x41)) },
    }),
  );

  // ── strict-decode failures (§3.6) ────────────────────────────────────────
  for (const [name, transcript, note] of [
    [
      "client-certificate-non-canonical-array-header",
      widenArrayHeader(CLIENT_PREKEY_TRANSCRIPT),
      "The array header re-emitted one byte wider. The value decodes identically; the §3.6 re-encode equality rule is what rejects it, because bytes that do not re-encode to themselves are not the bytes a signature covers.",
    ],
    [
      "client-certificate-indefinite-length-array",
      indefiniteArray(CLIENT_PREKEY_TRANSCRIPT),
      undefined,
    ],
    ["client-certificate-trailing-byte", appendByte(CLIENT_PREKEY_TRANSCRIPT, 0x00), undefined],
    [
      "client-certificate-truncated",
      CLIENT_PREKEY_TRANSCRIPT.subarray(0, CLIENT_PREKEY_TRANSCRIPT.byteLength - 1),
      undefined,
    ],
    [
      "client-certificate-float-element",
      mutateElement(CLIENT_PREKEY_TRANSCRIPT, 9, 1.5),
      "§3.6 forbids floating-point values in every E2EE structure, and the rejection is over the ENCODING: an integral float would otherwise be indistinguishable from an integer after decoding.",
    ],
    [
      "client-certificate-wrong-element-count",
      dropLastElement(CLIENT_PREKEY_TRANSCRIPT),
      undefined,
    ],
  ] as const) {
    cases.push(
      clientPrekeyCase({
        name,
        sections: ["3.6", "8.6 step 5"],
        ...(note === undefined ? {} : { note }),
        transcript,
        extraInputs: {
          canonicalDecode: (() => {
            const decoded = decodeCanonicalE2eeCbor(transcript);
            return decoded.kind === "ok"
              ? { kind: "ok" }
              : { kind: "error", reason: decoded.reason };
          })(),
        },
      }),
    );
  }

  return {
    file: "f04-prekey-certificates.json",
    number: 4,
    title: "Prekey certificates",
    sections: ["7.3", "7.4", "6.4", "8.6 step 5", "3.2.1 S9", "16.3 F4"],
    summary:
      "The §7.3 node agreement-prekey certificate through the §7.6 cross-signature reconstruction, and the §7.4 client agreement-prekey certificate through §8.6 step 5: valid transcripts and signatures, both sides of each `E2EE_MAX_CLOCK_SKEW` edge, the `E2EE_PREKEY_LIFETIME` bound, namespace mismatches, usage-field substitution, and the strict-decode failures of §3.6. The maximum-namespace certificates additionally discharge §3.2.1 S9.",
    deferred: [
      "The §6.4 staged-rotation overlap window (`E2EE_PREKEY_ROTATION_OVERLAP`, under which an outgoing and an incoming prekey both verify) is not decided by any module this generator can reach: `verifyE2eeClientPrekeyCertificate` evaluates one certificate against one clock. The node-side rotation state that holds two now EXISTS — `NodeE2eePrekeyClient` and `NodeE2eePrekeyStore` in apps/server — and is covered by its own module tests, but the overlap window has not been transcribed into this corpus and no consuming test holds the runtime to a committed table of it. Owned by the node phase.",
      "The §5.2 step 5 checks a VERIFIER applies to the node prekey carried in a capability statement — lifetime and rotation-overlap against the verifier's clock — have no landed implementation; the reconstruction above is the part §7.6 fixes. Owned by the §5.2 statement verifier.",
    ],
    testKeyMaterial: SHARED_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F3 — capability statement (§5.2, §5.7, §7.2.1, §7.6, §3.2.1) ────────────

/** §7.6 element 14, read back off the transcript the encoder derived it into. */
function admittedPatternsOf(transcript: Uint8Array): readonly string[] {
  return (decode(transcript) as unknown[])[14] as readonly string[];
}

function statementJson(build: StatementBuild): JsonValue {
  return {
    transcript: b(build.transcript),
    transcriptBytes: build.transcript.byteLength,
    transcriptSha256: sha256Hex(build.transcript),
    signingEnvelope: b(build.envelope),
    signingEnvelopeBytes: build.envelope.byteLength,
    signature: b(build.signature),
    statement: b(build.statement),
    statementBytes: build.statement.byteLength,
    base64urlChars: build.base64url.length,
    carrierBytes: build.carrierBytes,
    identityFingerprint: b(build.identityFingerprint),
    agreementFingerprint: b(build.agreementFingerprint),
    admittedPatterns: [...admittedPatternsOf(build.transcript)],
  };
}

function selectionCase(options: {
  readonly name: string;
  readonly sections: readonly string[];
  readonly note?: string;
  readonly tier: "native" | "web";
  readonly advertisedVersionMin: number;
  readonly advertisedVersionMax: number;
  readonly advertisedAdmittedPatterns: readonly ("IK" | "NX")[];
  readonly advertisedSuiteRegistry?: readonly number[];
  readonly localSuitePreference?: readonly number[];
  readonly statement?: StatementBuild;
  readonly latched: boolean;
}): FixtureCase {
  const registry = options.advertisedSuiteRegistry ?? [E2EE_SUITE_25519_CHACHAPOLY_SHA256];
  const preference = options.localSuitePreference ?? [E2EE_SUITE_25519_CHACHAPOLY_SHA256];
  const selection = selectE2eeSuite({
    tier: options.tier,
    localSuitePreference: preference,
    advertisedSuiteRegistry: registry,
    advertisedVersionMin: options.advertisedVersionMin,
    advertisedVersionMax: options.advertisedVersionMax,
    advertisedAdmittedPatterns: options.advertisedAdmittedPatterns,
  });
  const usable = selection.kind === "usable";
  return {
    name: options.name,
    sections: options.sections,
    ...(options.note === undefined ? {} : { note: options.note }),
    inputs: {
      tier: options.tier,
      tierNoisePattern: options.tier === "native" ? "IK" : "NX",
      selectionLatched: options.latched,
      protocolVersion: 1,
      advertisedVersionMin: options.advertisedVersionMin,
      advertisedVersionMax: options.advertisedVersionMax,
      advertisedAdmittedPatterns: [...options.advertisedAdmittedPatterns],
      advertisedSuiteRegistry: [...registry],
      localSuitePreference: [...preference],
      ...(options.statement === undefined
        ? { statementBytesEmitted: false }
        : {
            statement: b(options.statement.statement),
            carrierBytes: options.statement.carrierBytes,
          }),
    },
    expected: {
      selection:
        selection.kind === "usable"
          ? { kind: "usable", selectedSuite: selection.selectedSuite }
          : { kind: "unusable", reason: selection.reason },
      helloMayBeBuilt: usable,
      ...(usable
        ? { row: "K1" }
        : {
            row: options.latched ? "K2" : "K3",
            ...(options.latched ? { fatal: "P15" } : { evidenceTreatment: "absent-evidence" }),
            ticketSpentOnAHello: false,
          }),
    },
  };
}

function buildFamily3(): FixtureFamily {
  const cases: FixtureCase[] = [];
  const valid = buildStatement();
  const neverRotated = buildStatement({ chain: [] });

  cases.push({
    name: "valid-capability-statement",
    sections: ["5.2", "7.6", "7.2.1", "5.3"],
    note: "Element 14 is DERIVED from `requireApprovedClientE2EE` by the encoder, so a node cannot advertise an admitted set it does not serve, and the prekey member's agreement fingerprint is recomputed from the agreement key like every other fingerprint here.",
    inputs: {
      hubOrigin: HUB_ORIGIN,
      nodeId: NODE_ID,
      identityKeyId: IDENTITY_KEY_ID,
      identityPublicKey: b(NODE_IDENTITY_PUBLIC),
      e2eeVersionMin: 1,
      e2eeVersionMax: 1,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      prekeyId: PREKEY_ID,
      agreementPublicKey: b(NODE_AGREEMENT_PUBLIC),
      continuityChainLength: SHORT_LINEAGE.entries.length,
      requireE2EE: false,
      requireApprovedClientE2EE: false,
      policyGeneration: 7,
      issuedAt: ISSUED_AT,
      expiresAt: STATEMENT_EXPIRES_AT,
      continuityId: CONTINUITY_ID,
    },
    expected: {
      ...(statementJson(valid) as Record<string, JsonValue>),
      nodePrekeyTranscript: b(valid.nodePrekeyTranscript),
      crossSignature: b(valid.crossSignature),
      crossSignatureReconstructionVerifies: verifyNodeE2eeCapabilityCrossSignature({
        hubOrigin: HUB_ORIGIN,
        nodeId: NODE_ID,
        identityKeyId: IDENTITY_KEY_ID,
        identityPublicKey: NODE_IDENTITY_PUBLIC,
        identityFingerprint: valid.identityFingerprint,
        prekeyCertificate: {
          prekeyId: PREKEY_ID,
          agreementPublicKey: NODE_AGREEMENT_PUBLIC,
          agreementFingerprint: NODE_AGREEMENT_FINGERPRINT,
          crossSignature: valid.crossSignature,
          createdAt: CREATED_AT,
          expiresAt: EXPIRES_AT,
        },
      }),
      identitySignatureVerifiesOverTheEnvelope: verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_IDENTITY_PUBLIC,
        message: valid.envelope,
        signature: valid.signature,
      }),
      selfCheck: selfCheck(valid, HUB_ORIGIN),
      carrier: valid.carrier,
      carrierFixedBytes: E2EE_CAPABILITY_CARRIER_FIXED_BYTES,
      carrierFixedBytesMatchesJsonStringify:
        JSON.stringify({ _tag: E2EE_CAPABILITY_CARRIER_TAG, statement: "" }).length ===
        E2EE_CAPABILITY_CARRIER_FIXED_BYTES,
    },
  });

  cases.push({
    name: "valid-statement-from-a-never-rotated-node",
    sections: ["7.6 element 18", "7.5"],
    note: "Element 18 is REQUIRED in every statement, including from a node that has never rotated: the chain is empty and the continuity id is still present.",
    inputs: { continuityChainLength: 0, continuityId: CONTINUITY_ID },
    expected: {
      ...(statementJson(neverRotated) as Record<string, JsonValue>),
      continuityChainElement: [],
      continuityIdElement: (decode(neverRotated.transcript) as unknown[])[18] as string,
      selfCheck: selfCheck(neverRotated, HUB_ORIGIN),
    },
  });

  // ── the maximum conforming statement, and the §5.5 upper bound ───────────
  const maximum = MAXIMUM_STATEMENT;
  // §5.5 charges every unsigned field its widest canonical encoding, including
  // `e2eeVersionMin`, `e2eeVersionMax`, and each suite id, whose version-1
  // values encode in one byte. That over-charge is exactly eight bytes per
  // field, over two version fields and `E2EE_SUITE_REGISTRY_MAX_ENTRIES` suite
  // ids — every OTHER unsigned field of the statement above is already at its
  // widest, which is why the maximum-size statement sets each of them above
  // 2^32. The two numbers are pinned together so the size argument stays an
  // upper bound without pretending an unreachable statement is reachable.
  const OVER_CHARGED_FIELDS = 2 + E2EE_SUITE_REGISTRY_MAX_ENTRIES;
  const OVER_CHARGE_BYTES = OVER_CHARGED_FIELDS * 8;
  const upperBoundTranscriptBytes = maximum.transcript.byteLength + OVER_CHARGE_BYTES;
  const upperBoundStatementBytes = upperBoundTranscriptBytes + E2EE_STATEMENT_WRAPPER_MAX_BYTES;
  const upperBoundBase64urlChars = Math.ceil((4 * upperBoundStatementBytes) / 3);
  const upperBoundCarrierBytes = E2EE_CAPABILITY_CARRIER_FIXED_BYTES + upperBoundBase64urlChars;

  cases.push({
    name: "maximum-conforming-statement",
    sections: ["5.5", "3.2.1 S1", "3.2.1 S3", "3.2.1 S4", "3.2.1 S5", "3.2.1 S6", "3.2.1 S8"],
    note: "Every bound taken simultaneously: `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` chain entries, a Hub origin of exactly `E2EE_HUB_ORIGIN_MAX_BYTES`, `E2EE_SUITE_REGISTRY_MAX_ENTRIES` suite ids, and every unsigned field at its widest canonical encoding. TWO numbers are emitted for each figure and both are asserted: the largest statement that actually VALIDATES under the version-1 registries, and the §5.5 upper bound, which additionally charges the version and suite-id fields their widest encoding. They differ by exactly the over-charge §5.5 names.",
    inputs: {
      hubOriginBytes: Buffer.byteLength(MAX_HUB_ORIGIN, "utf8"),
      hubOriginMaxBytes: E2EE_HUB_ORIGIN_MAX_BYTES,
      continuityChainLength: E2EE_CONTINUITY_CHAIN_MAX_LENGTH,
      suiteRegistryEntries: E2EE_SUITE_REGISTRY_MAX_ENTRIES,
      firstGeneration: MAX_SIZE_FIRST_GENERATION,
      unsignedFieldValue: MAX_SIZE_TIMESTAMP,
    },
    expected: {
      continuityTranscriptBytes: MAX_LINEAGE_MAX_ORIGIN.entries[0]!.transcript.byteLength,
      largestValidating: {
        transcriptBytes: maximum.transcript.byteLength,
        statementBytes: maximum.statement.byteLength,
        base64urlChars: maximum.base64url.length,
        carrierBytes: maximum.carrierBytes,
        carrierPlusPreludeBytes: maximum.carrierBytes + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
      },
      section55UpperBound: {
        overChargedFields: OVER_CHARGED_FIELDS,
        overChargeBytes: OVER_CHARGE_BYTES,
        transcriptBytes: upperBoundTranscriptBytes,
        statementBytes: upperBoundStatementBytes,
        base64urlChars: upperBoundBase64urlChars,
        carrierBytes: upperBoundCarrierBytes,
        carrierPlusPreludeBytes: upperBoundCarrierBytes + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
      },
      bounds: {
        capabilityTranscriptMaxBytes: E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES,
        statementWrapperMaxBytes: E2EE_STATEMENT_WRAPPER_MAX_BYTES,
        capabilityStatementMaxBytes: E2EE_CAPABILITY_STATEMENT_MAX_BYTES,
        capabilityCarrierFixedBytes: E2EE_CAPABILITY_CARRIER_FIXED_BYTES,
        capabilityCarrierMaxBytes: E2EE_CAPABILITY_CARRIER_MAX_BYTES,
        advertisementMinChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
        capabilitySigningEnvelopeBytes: E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES,
        signingInputMaxBytes: E2EE_SIGNING_INPUT_MAX_BYTES,
      },
      satisfiesS8: upperBoundTranscriptBytes <= E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES,
      satisfiesS4:
        E2EE_CAPABILITY_STATEMENT_MAX_BYTES ===
        E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + E2EE_STATEMENT_WRAPPER_MAX_BYTES,
      satisfiesS5:
        E2EE_CAPABILITY_CARRIER_MAX_BYTES ===
        E2EE_CAPABILITY_CARRIER_FIXED_BYTES +
          Math.ceil((4 * E2EE_CAPABILITY_STATEMENT_MAX_BYTES) / 3),
      satisfiesS6:
        upperBoundCarrierBytes + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES <=
        E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      satisfiesS1: E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES <= E2EE_SIGNING_INPUT_MAX_BYTES,
      selfCheck: selfCheck(maximum, MAX_HUB_ORIGIN),
      // §5.5's contrast: the same transcript signed DIRECTLY would be unsignable.
      directSigningWouldExceedTheSigningInterface:
        maximum.transcript.byteLength > E2EE_SIGNING_INPUT_MAX_BYTES,
    },
  });

  // ── the §7.2.1 envelope is length-invariant ──────────────────────────────
  cases.push({
    name: "signing-envelope-length-is-identical-for-a-minimum-and-a-maximum-transcript",
    sections: ["7.2.1", "3.2.1 S1", "3.2.1 S3"],
    note: "This is why the transcript is never signed directly: the envelope is fixed-width whatever the chain depth, so a node that has rotated the permitted number of times can still sign.",
    inputs: {
      minimumTranscriptBytes: neverRotated.transcript.byteLength,
      maximumTranscriptBytes: maximum.transcript.byteLength,
    },
    expected: {
      minimumEnvelope: b(neverRotated.envelope),
      maximumEnvelope: b(maximum.envelope),
      minimumEnvelopeBytes: neverRotated.envelope.byteLength,
      maximumEnvelopeBytes: maximum.envelope.byteLength,
      identicalLengths: neverRotated.envelope.byteLength === maximum.envelope.byteLength,
      capabilitySigningEnvelopeBytes: E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES,
      bothWithinSigningInputMaxBytes:
        neverRotated.envelope.byteLength <= E2EE_SIGNING_INPUT_MAX_BYTES &&
        maximum.envelope.byteLength <= E2EE_SIGNING_INPUT_MAX_BYTES,
      digestDomain: E2EE_NODE_CAPABILITY_DIGEST_DOMAIN,
    },
  });

  // ── wrong signing inputs ─────────────────────────────────────────────────
  cases.push(
    {
      name: "signature-computed-over-the-raw-transcript-instead-of-the-envelope",
      sections: ["7.2", "7.2.1", "5.2 step 1"],
      note: "§7.2.1 forbids any structure that invites a verifier to accept a digest it did not compute; a signature made over the transcript itself does not verify against the envelope the verifier rebuilds.",
      inputs: {
        transcript: b(valid.transcript),
        signature: b(signNode(valid.transcript)),
        verifierRebuiltEnvelope: b(valid.envelope),
      },
      expected: {
        verifies: verifyE2eeSignature({
          algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
          publicKey: NODE_IDENTITY_PUBLIC,
          message: valid.envelope,
          signature: signNode(valid.transcript),
        }),
      },
    },
    {
      name: "envelope-built-from-a-digest-of-different-transcript-bytes",
      sections: ["7.2.1", "5.2 step 1"],
      note: "The signature is over a correctly formed envelope — of the WRONG transcript. The verifier rebuilds the envelope from the exact bytes received, so the substitution shows up as a signature failure and never as an accepted digest.",
      inputs: {
        carriedTranscript: b(valid.transcript),
        signedOverEnvelopeOfTranscript: b(neverRotated.transcript),
        signature: b(signNode(neverRotated.envelope)),
      },
      expected: {
        verifies: verifyE2eeSignature({
          algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
          publicKey: NODE_IDENTITY_PUBLIC,
          message: valid.envelope,
          signature: signNode(neverRotated.envelope),
        }),
      },
    },
  );

  // ── re-encode inequality ─────────────────────────────────────────────────
  {
    const nonCanonical = widenArrayHeader(valid.transcript);
    const decoded = decodeCanonicalE2eeCbor(nonCanonical);
    cases.push({
      name: "non-canonical-transcript-encoding",
      sections: ["3.6", "5.2 step 1"],
      note: "The same 19 elements with the array header re-emitted one byte wider. §3.6's re-encode equality rule rejects it before any signature check, and the identity signature over the canonical bytes does not cover these bytes either.",
      inputs: {
        canonicalTranscript: b(valid.transcript),
        nonCanonicalTranscript: b(nonCanonical),
      },
      expected: {
        canonicalDecode:
          decoded.kind === "ok" ? { kind: "ok" } : { kind: "error", reason: decoded.reason },
        envelopeOverTheNonCanonicalBytesDiffers:
          hex(encodeNodeE2eeCapabilitySigningEnvelope(nonCanonical)) !== hex(valid.envelope),
        verifiesUnderTheCanonicalSignature: verifyE2eeSignature({
          algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
          publicKey: NODE_IDENTITY_PUBLIC,
          message: encodeNodeE2eeCapabilitySigningEnvelope(nonCanonical),
          signature: valid.signature,
        }),
      },
    });
  }

  // ── fingerprint mismatch and cross-signature reconstruction failure ──────
  {
    const other = buildStatement({ hubOrigin: OTHER_HUB_ORIGIN });
    cases.push({
      name: "prekey-cross-signature-lifted-from-another-statement",
      sections: ["7.6", "5.2 step 5"],
      inputs: {
        statementHubOrigin: HUB_ORIGIN,
        crossSignatureTakenFromStatementForHubOrigin: OTHER_HUB_ORIGIN,
        crossSignature: b(other.crossSignature),
      },
      expected: {
        crossSignatureReconstructionVerifies: verifyNodeE2eeCapabilityCrossSignature({
          hubOrigin: HUB_ORIGIN,
          nodeId: NODE_ID,
          identityKeyId: IDENTITY_KEY_ID,
          identityPublicKey: NODE_IDENTITY_PUBLIC,
          identityFingerprint: NODE_IDENTITY_FINGERPRINT,
          prekeyCertificate: {
            prekeyId: PREKEY_ID,
            agreementPublicKey: NODE_AGREEMENT_PUBLIC,
            agreementFingerprint: NODE_AGREEMENT_FINGERPRINT,
            crossSignature: other.crossSignature,
            createdAt: CREATED_AT,
            expiresAt: EXPIRES_AT,
          },
        }),
      },
    });

    cases.push({
      name: "advertised-identity-fingerprint-disagrees-with-the-advertised-identity-key",
      sections: ["7.1", "7.6", "5.2 step 2"],
      note: "§5.2 step 2 recomputes EVERY advertised fingerprint from its algorithm-labelled raw public key. The reconstruction enforces the same rule, so the two agree on the verdict rather than leaving it to whichever runs first.",
      inputs: {
        carriedIdentityFingerprint: b(
          e2eeKeyFingerprint("node-identity", NODE_NEW_IDENTITY_PUBLIC),
        ),
        recomputedIdentityFingerprint: b(NODE_IDENTITY_FINGERPRINT),
      },
      expected: {
        crossSignatureReconstructionVerifies: verifyNodeE2eeCapabilityCrossSignature({
          hubOrigin: HUB_ORIGIN,
          nodeId: NODE_ID,
          identityKeyId: IDENTITY_KEY_ID,
          identityPublicKey: NODE_IDENTITY_PUBLIC,
          identityFingerprint: e2eeKeyFingerprint("node-identity", NODE_NEW_IDENTITY_PUBLIC),
          prekeyCertificate: {
            prekeyId: PREKEY_ID,
            agreementPublicKey: NODE_AGREEMENT_PUBLIC,
            agreementFingerprint: NODE_AGREEMENT_FINGERPRINT,
            crossSignature: valid.crossSignature,
            createdAt: CREATED_AT,
            expiresAt: EXPIRES_AT,
          },
        }),
      },
    });
  }

  // ── the bounds §5.2 step 0 and §7.6.1 enforce ────────────────────────────
  for (const [name, hubOrigin, accepted] of [
    ["hub-origin-exactly-at-the-bound", MAX_HUB_ORIGIN, true],
    ["hub-origin-one-byte-over-the-bound", OVERLONG_HUB_ORIGIN, false],
  ] as const) {
    cases.push({
      name,
      sections: ["7.1", "7.6.1"],
      inputs: {
        hubOrigin,
        hubOriginBytes: Buffer.byteLength(hubOrigin, "utf8"),
        hubOriginMaxBytes: E2EE_HUB_ORIGIN_MAX_BYTES,
      },
      expected: {
        canonicalizationAccepted: attempt(() => canonicalizeE2eeHubOrigin(hubOrigin)).ok,
        encoderAccepted: attempt(() => buildStatement({ hubOrigin })).ok,
        expectedAccepted: accepted,
        selfCheckOnAConformingArtifact: nodeE2eeCapabilitySelfCheck({
          hubOrigin,
          transcript: valid.transcript,
          envelope: valid.envelope,
          statement: valid.statement,
          carrier: utf8.encode(valid.carrier),
          e2eeVersionMin: 1,
          e2eeVersionMax: 1,
          continuityIdResolved: true,
        }),
      },
    });
  }

  for (const [name, entries, accepted] of [
    ["suite-registry-exactly-at-max-entries", E2EE_SUITE_REGISTRY_MAX_ENTRIES, true],
    ["suite-registry-one-entry-over-max-entries", E2EE_SUITE_REGISTRY_MAX_ENTRIES + 1, false],
  ] as const) {
    const registry = Array.from({ length: entries }, () => E2EE_SUITE_25519_CHACHAPOLY_SHA256);
    const built = attempt(() => buildStatement({ suiteRegistry: registry }));
    cases.push({
      name,
      sections: ["7.6 element 9", "15"],
      note: "Version 1 registers exactly one suite id, so the maximum registry is that id repeated: it is the largest registry the version-1 registries can actually produce, which is the reading §5.5 gives its own worked example.",
      inputs: { suiteRegistryEntries: entries, maxEntries: E2EE_SUITE_REGISTRY_MAX_ENTRIES },
      expected: {
        encoderAccepted: built.ok,
        expectedAccepted: accepted,
        ...(built.ok ? { transcriptBytes: built.value.transcript.byteLength } : {}),
      },
    });
  }

  // Length probes for §5.2 step 0. A CONFORMING statement cannot reach
  // `E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES` — the maximum-size case above is
  // 640 bytes below it — so the bound itself is exercised with synthetic
  // artifacts of exactly the two lengths that matter. They are length probes,
  // not statements, and the corpus says so rather than implying otherwise.
  for (const [name, length, accepted] of [
    ["transcript-exactly-at-the-transcript-bound", E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES, true],
    [
      "transcript-one-byte-over-the-transcript-bound",
      E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + 1,
      false,
    ],
  ] as const) {
    const probe = new Uint8Array(length).fill(0x41);
    cases.push({
      name,
      sections: ["5.2 step 0", "7.6", "7.6.1"],
      note: "SYNTHETIC LENGTH PROBE, not a conforming statement: the largest transcript the version-1 registries can produce is well below this bound, so the bound cannot be reached by a conforming encoder. What is exercised is §5.2 step 0's refusal to decode and §7.6.1's refusal to sign.",
      inputs: { transcriptBytes: length, transcriptMaxBytes: E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES },
      expected: {
        signingEnvelopeAccepted: attempt(() => encodeNodeE2eeCapabilitySigningEnvelope(probe)).ok,
        expectedAccepted: accepted,
        selfCheck: nodeE2eeCapabilitySelfCheck({
          hubOrigin: HUB_ORIGIN,
          transcript: probe,
          envelope: valid.envelope,
          statement: valid.statement,
          carrier: utf8.encode(valid.carrier),
          e2eeVersionMin: 1,
          e2eeVersionMax: 1,
          continuityIdResolved: true,
        }),
      },
    });
  }

  cases.push({
    name: "oversized-statement",
    sections: ["5.2 step 0", "7.6.1", "3.2.1 S4"],
    note: "Re-anchored to the CURRENT `E2EE_CAPABILITY_STATEMENT_MAX_BYTES`; a synthetic length probe for the same reason as the transcript probes above.",
    inputs: {
      statementBytes: E2EE_CAPABILITY_STATEMENT_MAX_BYTES + 1,
      statementMaxBytes: E2EE_CAPABILITY_STATEMENT_MAX_BYTES,
    },
    expected: {
      selfCheck: nodeE2eeCapabilitySelfCheck({
        hubOrigin: HUB_ORIGIN,
        transcript: valid.transcript,
        envelope: valid.envelope,
        statement: new Uint8Array(E2EE_CAPABILITY_STATEMENT_MAX_BYTES + 1),
        carrier: utf8.encode(valid.carrier),
        e2eeVersionMin: 1,
        e2eeVersionMax: 1,
        continuityIdResolved: true,
      }),
    },
  });

  cases.push({
    name: "oversized-carrier",
    sections: ["5.3", "7.6.1", "3.2.1 S5"],
    inputs: {
      carrierBytes: E2EE_CAPABILITY_CARRIER_MAX_BYTES + 1,
      carrierMaxBytes: E2EE_CAPABILITY_CARRIER_MAX_BYTES,
    },
    expected: {
      selfCheck: nodeE2eeCapabilitySelfCheck({
        hubOrigin: HUB_ORIGIN,
        transcript: valid.transcript,
        envelope: valid.envelope,
        statement: valid.statement,
        carrier: new Uint8Array(E2EE_CAPABILITY_CARRIER_MAX_BYTES + 1),
        e2eeVersionMin: 1,
        e2eeVersionMax: 1,
        continuityIdResolved: true,
      }),
    },
  });

  for (const [name, continuityId, note] of [
    [
      "malformed-continuity-id-wrong-prefix",
      `epk_${"F".repeat(22)}`,
      "The §7.1 prefix is part of the identifier.",
    ],
    ["malformed-continuity-id-too-short", `nct_${"F".repeat(21)}`, undefined],
    [
      "malformed-continuity-id-out-of-alphabet",
      `nct_${"*".repeat(22)}`,
      "The §7.1 body alphabet is `[A-Za-z0-9_-]`.",
    ],
    ["malformed-continuity-id-empty", "", undefined],
  ] as const) {
    cases.push({
      name,
      sections: ["7.6 element 18", "7.1"],
      ...(note === undefined ? {} : { note }),
      inputs: { continuityId },
      expected: { encoderRejects: rejected(() => buildStatement({ continuityId })) },
    });
  }

  cases.push({
    name: "continuity-id-unresolved-at-startup",
    sections: ["7.6.1", "7.5", "5.5 U2"],
    note: "The §7.5 startup cross-check is a NODE-STATE input here, not a computation: the state machine that decides it is owned by the node phase (see this family's `deferred` list). What is derived is the §7.6.1 verdict once the input is known.",
    inputs: { continuityIdResolved: false },
    expected: {
      selfCheck: nodeE2eeCapabilitySelfCheck({
        hubOrigin: HUB_ORIGIN,
        transcript: valid.transcript,
        envelope: valid.envelope,
        statement: valid.statement,
        carrier: utf8.encode(valid.carrier),
        e2eeVersionMin: 1,
        e2eeVersionMax: 1,
        continuityIdResolved: false,
      }),
      advertisementUnavailable: "U2 statement-unavailable",
      fatalUnderEffectiveRequireE2EE: "P23",
    },
  });

  // ── §5.2 step 8: the advertised protocol range ───────────────────────────
  {
    const excludes = buildStatement({ e2eeVersionMin: 2, e2eeVersionMax: 3 });
    for (const latched of [false, true]) {
      cases.push(
        selectionCase({
          name: `protocol-range-excludes-the-implemented-version-${latched ? "latched" : "unlatched"}`,
          sections: ["5.2 step 8", "7.6 elements 7-8", "8.2", "12.1.1"],
          note: "Fully valid and correctly signed, and still unusable evidence: a hello sent against a range that excludes this client's version cannot succeed and would spend the channel and its single-use ticket for nothing.",
          tier: "native",
          advertisedVersionMin: 2,
          advertisedVersionMax: 3,
          advertisedAdmittedPatterns: ["IK", "NX"],
          statement: excludes,
          latched,
        }),
      );
    }
    cases.push({
      name: "protocol-range-excludes-the-implemented-version-fails-the-node-self-check",
      sections: ["7.6.1", "5.5 U2"],
      inputs: { e2eeVersionMin: 2, e2eeVersionMax: 3, implementedVersion: 1 },
      expected: { selfCheck: selfCheck(excludes, HUB_ORIGIN, 2, 3) },
    });
  }

  for (const latched of [false, true]) {
    cases.push(
      selectionCase({
        name: `protocol-range-inverted-${latched ? "latched" : "unlatched"}`,
        sections: ["5.2 step 8", "7.6 elements 7-8"],
        note: "`e2eeVersionMin > e2eeVersionMax`. No signed statement bytes are emitted for this case: `encodeNodeE2eeCapabilityTranscript` refuses to build one, so an inverted range can only ever arrive as peer-supplied evidence, which is the position the selection input below models.",
        tier: "native",
        advertisedVersionMin: 3,
        advertisedVersionMax: 2,
        advertisedAdmittedPatterns: ["IK", "NX"],
        latched,
      }),
    );
  }

  {
    const boundary = buildStatement({ e2eeVersionMin: 1, e2eeVersionMax: 4 });
    cases.push(
      selectionCase({
        name: "protocol-range-minimum-equal-to-the-implemented-version",
        sections: ["5.2 step 8"],
        note: "A range test and not an equality test: the minimum equals `E2EE_PROTOCOL_VERSION` and the maximum is strictly greater, and the ordinary K1 path applies.",
        tier: "native",
        advertisedVersionMin: 1,
        advertisedVersionMax: 4,
        advertisedAdmittedPatterns: ["IK", "NX"],
        statement: boundary,
        latched: true,
      }),
    );
  }

  // ── §5.2 step 9: the effective admitted pattern set ──────────────────────
  {
    const ikOnly = buildStatement({ requireApprovedClientE2EE: true });
    const patterns = admittedPatternsOf(ikOnly.transcript) as readonly ("IK" | "NX")[];
    cases.push({
      name: "admitted-pattern-set-under-require-approved-client-e2ee",
      sections: ["7.6 element 14", "12.4"],
      note: "Element 14 is derived by the encoder from `requireApprovedClientE2EE`, so this is the set such a node advertises rather than one the fixture chose.",
      inputs: { requireApprovedClientE2EE: true },
      expected: { ...(statementJson(ikOnly) as Record<string, JsonValue>) },
    });

    cases.push(
      selectionCase({
        name: "admitted-pattern-set-ik-only-evaluated-as-web-latched",
        sections: ["5.2 step 9", "7.6 element 14", "8.1", "12.1", "12.4"],
        note: "The REACHABLE version-1 configuration: §12.1 sets the web latch on the statement's own validation and step 9 runs after it, so a web client against a node running `requireApprovedClientE2EE` takes P15 and no buffered send is ever flushed as plaintext.",
        tier: "web",
        advertisedVersionMin: 1,
        advertisedVersionMax: 1,
        advertisedAdmittedPatterns: patterns,
        statement: ikOnly,
        latched: true,
      }),
      selectionCase({
        name: "admitted-pattern-set-ik-only-evaluated-as-web-unlatched",
        sections: ["5.2 step 9", "7.6 element 14", "12.1.1"],
        note: "A RULE-LEVEL case, not a reachable web one: it pins the K3 branch of the same guard for the first future tier whose latch is unset. It does not claim a conforming version-1 web client can occupy this state.",
        tier: "web",
        advertisedVersionMin: 1,
        advertisedVersionMax: 1,
        advertisedAdmittedPatterns: patterns,
        statement: ikOnly,
        latched: false,
      }),
      selectionCase({
        name: "admitted-pattern-set-ik-only-evaluated-as-native",
        sections: ["5.2 step 9", "8.1"],
        note: "The identical statement bytes evaluated by a client whose tier runs `IK`: the ordinary K1 path, which is what makes the check a membership test against the client's own pattern rather than a length or literal test on the set.",
        tier: "native",
        advertisedVersionMin: 1,
        advertisedVersionMax: 1,
        advertisedAdmittedPatterns: patterns,
        statement: ikOnly,
        latched: true,
      }),
      selectionCase({
        name: "admitted-pattern-set-ik-and-nx-evaluated-as-web",
        sections: ["5.2 step 9"],
        tier: "web",
        advertisedVersionMin: 1,
        advertisedVersionMax: 1,
        advertisedAdmittedPatterns: admittedPatternsOf(valid.transcript) as readonly (
          | "IK"
          | "NX"
        )[],
        statement: valid,
        latched: true,
      }),
      selectionCase({
        name: "empty-suite-intersection",
        sections: ["8.2"],
        note: "The third way a valid, correctly signed statement is unusable; it carries the identical disposition to steps 8 and 9.",
        tier: "native",
        advertisedVersionMin: 1,
        advertisedVersionMax: 1,
        advertisedAdmittedPatterns: ["IK", "NX"],
        advertisedSuiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
        localSuitePreference: [0x02],
        latched: true,
      }),
    );
  }

  // ── §3.2.1 S9 over all three directly signed transcripts ────────────────
  {
    const nodePrekeyMax = encodeNodeE2eePrekeyTranscript({
      hubOrigin: MAX_HUB_ORIGIN,
      nodeId: NODE_ID,
      identityKeyId: IDENTITY_KEY_ID,
      prekeyId: PREKEY_ID,
      identityPublicKey: NODE_IDENTITY_PUBLIC,
      agreementPublicKey: NODE_AGREEMENT_PUBLIC,
      createdAt: MAX_SIZE_TIMESTAMP,
      expiresAt: MAX_SIZE_TIMESTAMP,
    });
    const clientPrekeyMax = encodeClientE2eePrekeyTranscript({
      hubOrigin: MAX_HUB_ORIGIN,
      accountId: MAX_ACCOUNT_ID,
      identityPublicKey: CLIENT_IDENTITY_PUBLIC,
      agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
      createdAt: MAX_SIZE_TIMESTAMP,
      expiresAt: MAX_SIZE_TIMESTAMP + E2EE_PREKEY_LIFETIME,
    });
    const continuityMax = MAX_LINEAGE_MAX_ORIGIN.entries[0]!.transcript;
    const largest = Math.max(
      nodePrekeyMax.byteLength,
      clientPrekeyMax.byteLength,
      continuityMax.byteLength,
    );
    cases.push({
      name: "largest-directly-signed-transcripts",
      sections: ["7.3", "7.4", "7.5", "3.2.1 S9"],
      note: "§7.3, §7.4, and §7.5 are of bounded, non-growing shape and are signed DIRECTLY, so S9 is what makes each of them producible.",
      inputs: {
        hubOriginBytes: E2EE_HUB_ORIGIN_MAX_BYTES,
        accountIdBytes: E2EE_ACCOUNT_ID_MAX_BYTES,
      },
      expected: {
        nodePrekeyTranscriptBytes: nodePrekeyMax.byteLength,
        clientPrekeyTranscriptBytes: clientPrekeyMax.byteLength,
        continuityTranscriptBytes: continuityMax.byteLength,
        largestDirectTranscriptBytes: largest,
        directSigningTranscriptMaxBytes: E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
        satisfiesS9: largest <= E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
      },
    });
  }

  return {
    file: "f03-capability-statement.json",
    number: 3,
    title: "Capability statement",
    sections: ["5.2", "5.3", "5.5", "5.7", "7.2.1", "7.6", "7.6.1", "3.2.1", "16.3 F3"],
    summary:
      "The §7.6 transcript, the §7.2.1 signing envelope, the identity signature, the recomputed fingerprints, the reconstructed prekey cross-signature, and the §5.3 carrier — for a valid statement, for a never-rotated node, and for the maximum conforming statement with both the largest-validating and the §5.5 upper-bound figures. Plus the size-invariant, wrong-signing-input, re-encode-inequality, protocol-range, and admitted-pattern cases.",
    deferred: [
      "The §5.2 step 3, 4, and 7 invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, and a lower policy generation, together with the §5.7 policy-generation recovery pair. There is no capability-statement VERIFIER in packages/shared/src: the landed modules encode the transcript, build and check the §7.2.1 envelope, verify the cross-signature, and run the §7.6.1 self-check, but nothing evaluates a received statement against a clock, a connected origin, or a stored policy generation. Emitting these cases would mean asserting an outcome no implementation produces. Owned by the §5.2 statement verifier.",
      "A statement OMITTING element 18, and a statement whose element 18 disagrees with the PINNED continuity id. The first needs a §7.6 statement decoder to have an arity verdict to derive; the second needs the §13.1 durable pin record. Owned by the §5.2 statement verifier and the client trust-state work respectively. The element-18-disagrees-with-a-carried-chain-entry case IS emitted, in family F5.",
      "The CLIENT half of the protocol-range and admitted-pattern cases — the K3/P15 channel disposition, the assertion that no `E2EEClientHello` was produced, and the single-use ticket accounting — is a §4.4 client row (family F10). What this family derives is `selectE2eeSuite`'s verdict. Their NODE-SIDE companions, a hello whose `e2eeVersion` lies outside the advertised range and an NX hello to a node running `requireApprovedClientE2EE`, ARE emitted, in family F12, where their §11.5 observable can be compared against the reject vector directly. Owned by the client phase, together with family F10.",
      "The K3/K2 channel dispositions and the ticket-accounting assertions attached to the selection cases are §4.4 client rows (family F10) and are carried here as labels. What this family DERIVES is `selectE2eeSuite`'s verdict, which is the precondition the rows read: `helloMayBeBuilt: false` is the 'no hello may be built from the statement' obligation, stated over the landed function. Owned by the client phase, which will assert the dispositions themselves.",
      crossRuntimeDeferral(3),
    ],
    testKeyMaterial: {
      ...(SHARED_TEST_KEY_MATERIAL as Record<string, JsonValue>),
      maxHubOrigin: MAX_HUB_ORIGIN,
      overlongHubOrigin: OVERLONG_HUB_ORIGIN,
      maxAccountId: MAX_ACCOUNT_ID,
      capabilityCarrierTag: E2EE_CAPABILITY_CARRIER_TAG,
      transcriptDomain: E2EE_NODE_CAPABILITY_TRANSCRIPT_DOMAIN,
      signingEnvelopeDomain: E2EE_NODE_CAPABILITY_DIGEST_DOMAIN,
    },
    cases,
  };
}

// ─── F17 — key-material validation (§7.1, §8.1, §14.3) ───────────────────────

const P256_FIELD_PRIME = p256.Point.Fp.ORDER;
const P256_GROUP_ORDER = p256.Point.Fn.ORDER;
const ED25519_FIELD_PRIME = ed25519.Point.Fp.ORDER;
const ED25519_GROUP_ORDER = ed25519.Point.Fn.ORDER;

function bigIntToBytesBe(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function bigIntToBytesLe(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function bytesBeToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bytesLeToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.byteLength - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]!);
  }
  return value;
}

/** `0x04 ‖ X ‖ Y` from two coordinates, whether or not the point is on the curve. */
function uncompressedP256(x: bigint, y: bigint, firstByte = 0x04): Uint8Array {
  const out = new Uint8Array(65);
  out[0] = firstByte;
  out.set(bigIntToBytesBe(x, 32), 1);
  out.set(bigIntToBytesBe(y, 32), 33);
  return out;
}

function buildFamily17(): FixtureFamily {
  const cases: FixtureCase[] = [];

  // ── §8.1: the all-zero X25519 shared secret ──────────────────────────────
  //
  // §8.1 mandates ONE behavior for an invalid or low-order input: abort. The
  // pinned primitive signals it by throwing out of the DH, the state machine
  // does not catch it, and the handshake classes map the throw to P10.
  const LOW_ORDER_POINTS: readonly (readonly [string, string])[] = [
    ["u-zero", "0000000000000000000000000000000000000000000000000000000000000000"],
    ["order-eight", "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800"],
  ];
  const F17_PROLOGUE = utf8.encode("ryco-e2ee-fixture-prologue");
  const F17_CLIENT_EPHEMERAL = seedOf(0x61);
  const F17_NODE_EPHEMERAL = seedOf(0x62);

  for (const [label, pointHex] of LOW_ORDER_POINTS) {
    const point = Uint8Array.from(Buffer.from(pointHex, "hex"));
    const ikAborted = !attempt(() =>
      new E2eeNoiseHandshake({
        pattern: "IK",
        role: "initiator",
        prologue: F17_PROLOGUE,
        staticSecretKey: CLIENT_AGREEMENT_SECRET,
        remoteStaticPublicKey: point,
        testOnlyEphemeralSecretKey: Uint8Array.from(F17_CLIENT_EPHEMERAL),
      }).writeMessage(new Uint8Array(0)),
    ).ok;
    const nxAborted = !attempt(() => {
      const responder = new E2eeNoiseHandshake({
        pattern: "NX",
        role: "responder",
        prologue: F17_PROLOGUE,
        staticSecretKey: NODE_AGREEMENT_SECRET,
        testOnlyEphemeralSecretKey: Uint8Array.from(F17_NODE_EPHEMERAL),
      });
      responder.readMessage(point);
      return responder.writeMessage(new Uint8Array(0));
    }).ok;

    cases.push({
      name: `x25519-all-zero-shared-secret-${label}`,
      sections: ["8.1", "14.3", "11.2 P10"],
      note: "The IK position is the initiator's `es` against the advertised node static; the NX position is the responder's `ee` against the client ephemeral carried in message 1. Both are the FIRST DH each role performs, so the abort happens before any key schedule exists.",
      inputs: {
        lowOrderPublicKey: b(point),
        prologue: b(F17_PROLOGUE),
        testOnlyClientEphemeralSecretKey: b(F17_CLIENT_EPHEMERAL),
        testOnlyNodeEphemeralSecretKey: b(F17_NODE_EPHEMERAL),
      },
      expected: {
        ikInitiatorEsAborted: ikAborted,
        nxResponderEeAborted: nxAborted,
        fatal: "P10",
        disposition: "FATAL-PRE",
        mandatedBehavior: "abort; §8.1 admits no other handling of an all-zero shared secret",
      },
    });
  }

  // ── §7.1: P-256 public keys ──────────────────────────────────────────────
  const validPoint = p256.Point.fromBytes(CLIENT_IDENTITY_PUBLIC).toAffine();
  const p256KeyCases: readonly (readonly [string, Uint8Array, string])[] = [
    [
      "p256-public-key-off-the-curve",
      uncompressedP256(validPoint.x, (validPoint.y + 1n) % P256_FIELD_PRIME),
      "Both coordinates are in range and the point is not on the curve.",
    ],
    [
      "p256-public-key-x-coordinate-at-the-field-prime",
      uncompressedP256(P256_FIELD_PRIME, validPoint.y),
      "The coordinate-range check is explicit because the pinned curve library decodes an uncompressed point without reducing first, so `X + p` would otherwise give one key two accepted encodings — and every §7.1 fingerprint is taken over the encoding.",
    ],
    [
      "p256-public-key-y-coordinate-above-the-field-prime",
      uncompressedP256(validPoint.x, validPoint.y + P256_FIELD_PRIME),
      undefined as unknown as string,
    ],
    [
      "p256-public-key-is-the-identity",
      uncompressedP256(0n, 0n),
      "The point at infinity, encoded as all-zero coordinates.",
    ],
    [
      "p256-public-key-compressed-prefix-02",
      uncompressedP256(validPoint.x, validPoint.y, 0x02),
      "§7.1 fixes X9.63 uncompressed form; a compressed or hybrid prefix is rejected before any signature check.",
    ],
    [
      "p256-public-key-compressed-prefix-03",
      uncompressedP256(validPoint.x, validPoint.y, 0x03),
      undefined as unknown as string,
    ],
    [
      "p256-public-key-hybrid-prefix-06",
      uncompressedP256(validPoint.x, validPoint.y, 0x06),
      undefined as unknown as string,
    ],
    [
      "p256-public-key-hybrid-prefix-07",
      uncompressedP256(validPoint.x, validPoint.y, 0x07),
      undefined as unknown as string,
    ],
    [
      "p256-public-key-wrong-length",
      CLIENT_IDENTITY_PUBLIC.subarray(0, 64),
      undefined as unknown as string,
    ],
  ];

  for (const [name, key, note] of p256KeyCases) {
    cases.push({
      name,
      sections: ["7.1", "11.2 P11"],
      ...(note === undefined ? {} : { note }),
      inputs: { publicKey: b(key), publicKeyBytes: key.byteLength },
      expected: {
        validation: rejected(() => validateE2eeClientIdentityPublicKey(key)),
        rejectedBeforeAnySignatureCheck: true,
        fatal: "P11",
        positionNote:
          "P11 is the row for material inside the IK client certificate (§8.6 step 5); the same encoding inside a node-signed statement is rows K2/K3, and P15 when the channel's selection is latched.",
      },
    });
  }

  cases.push({
    name: "p256-public-key-valid-control",
    sections: ["7.1"],
    note: "The control for the rejections above: the corpus key itself, in X9.63 uncompressed form.",
    inputs: { publicKey: b(CLIENT_IDENTITY_PUBLIC) },
    expected: {
      validationAccepted: attempt(() => validateE2eeClientIdentityPublicKey(CLIENT_IDENTITY_PUBLIC))
        .ok,
    },
  });

  // ── §7.1: P-256 ECDSA signature encodings ────────────────────────────────
  const validClientSignature = signClient(CLIENT_PREKEY_TRANSCRIPT);
  const derSignature = p256.sign(nobleSha256(CLIENT_PREKEY_TRANSCRIPT), CLIENT_IDENTITY_SECRET, {
    prehash: false,
    lowS: false,
    format: "der",
  });
  const rawWith = (r: bigint, s: bigint): Uint8Array => {
    const out = new Uint8Array(64);
    out.set(bigIntToBytesBe(r, 32), 0);
    out.set(bigIntToBytesBe(s, 32), 32);
    return out;
  };
  const validR = bytesBeToBigInt(validClientSignature.subarray(0, 32));
  const validS = bytesBeToBigInt(validClientSignature.subarray(32));

  const p256SignatureCases: readonly (readonly [string, Uint8Array, string | undefined])[] = [
    [
      "p256-signature-asn1-der-instead-of-raw",
      Uint8Array.from(derSignature),
      "§7.1 fixes fixed-width raw `r ‖ s`. DER never has that length and is rejected on the length alone; the verification path will not parse DER at all.",
    ],
    ["p256-signature-r-zero", rawWith(0n, validS), undefined],
    ["p256-signature-s-zero", rawWith(validR, 0n), undefined],
    ["p256-signature-r-at-the-group-order", rawWith(P256_GROUP_ORDER, validS), undefined],
    ["p256-signature-s-at-the-group-order", rawWith(validR, P256_GROUP_ORDER), undefined],
    [
      "p256-signature-r-above-the-group-order",
      rawWith(P256_GROUP_ORDER + 1n, validS),
      "`r` is an x-coordinate already reduced modulo `n`, so a conforming signer can never emit one at or above the group order; the rejection is on the ENCODING and precedes any curve arithmetic. §16.3 F17 requires the above-the-order case for `r` as well as for `s`, because a validator that range-checked only `s` would pass every other signature case in this family.",
    ],
    [
      "p256-signature-s-above-the-group-order",
      rawWith(validR, P256_GROUP_ORDER + 1n),
      "§7.1 accepts EITHER `s` value — the protocol derives no uniqueness from signature bytes — but both must lie in `[1, n − 1]`.",
    ],
  ];

  for (const [name, signature, note] of p256SignatureCases) {
    cases.push({
      name,
      sections: ["7.1", "14.3", "11.2 P11"],
      ...(note === undefined ? {} : { note }),
      inputs: { signature: b(signature), signatureBytes: signature.byteLength },
      expected: {
        encodingValidation: rejected(() => validateE2eeClientSignature(signature)),
        verificationVerdict: verifyE2eeSignature({
          algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
          publicKey: CLIENT_IDENTITY_PUBLIC,
          message: CLIENT_PREKEY_TRANSCRIPT,
          signature,
        }),
        fatal: "P11",
      },
    });
  }

  // ── §14.3: Ed25519 canonicality ──────────────────────────────────────────
  const F17_ED_SEED = seedOf(0x31);
  const F17_ED_PUBLIC = ed25519.getPublicKey(F17_ED_SEED);
  const F17_ED_MESSAGE = SHORT_LINEAGE.entries[0]!.transcript;

  for (const [name, key, note] of [
    [
      "ed25519-public-key-y-at-the-field-prime",
      bigIntToBytesLe(ED25519_FIELD_PRIME, 32),
      "A non-canonical encoding of the point with `y = 0`: strict RFC 8032 decoding rejects a `y` coordinate at or above the field prime, where a ZIP215-style verifier would reduce it.",
    ],
    [
      "ed25519-public-key-y-above-the-field-prime",
      bigIntToBytesLe(ED25519_FIELD_PRIME + 1n, 32),
      "A non-canonical encoding of the identity point.",
    ],
  ] as const) {
    cases.push({
      name,
      sections: ["7.1", "14.3"],
      note,
      inputs: { publicKey: b(key) },
      expected: {
        validation: rejected(() => validateE2eeNodeIdentityPublicKey(key)),
        verificationVerdict: verifyE2eeSignature({
          algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
          publicKey: key,
          message: F17_ED_MESSAGE,
          signature: new Uint8Array(64),
        }),
      },
    });
  }

  // A signature whose `R` is the identity point, once in its canonical encoding
  // and once in a non-canonical one. The pair is what isolates the ENCODING:
  // both signatures satisfy the verification equation, and only the encoding
  // differs. Forged here rather than sampled, because a signature whose `R` has
  // a small `y` cannot be reached by signing.
  {
    const scalar = (
      ed25519.utils as unknown as {
        getExtendedPublicKey: (seed: Uint8Array) => { readonly scalar: bigint };
      }
    ).getExtendedPublicKey(F17_ED_SEED).scalar;
    const forge = (rEncoding: Uint8Array): Uint8Array => {
      const challengeInput = new Uint8Array(64 + F17_ED_MESSAGE.byteLength);
      challengeInput.set(rEncoding);
      challengeInput.set(F17_ED_PUBLIC, 32);
      challengeInput.set(F17_ED_MESSAGE, 64);
      const challenge = bytesLeToBigInt(sha512(challengeInput)) % ED25519_GROUP_ORDER;
      const signature = new Uint8Array(64);
      signature.set(rEncoding);
      signature.set(bigIntToBytesLe((challenge * scalar) % ED25519_GROUP_ORDER, 32), 32);
      return signature;
    };
    const canonicalIdentityR = bigIntToBytesLe(1n, 32);
    const nonCanonicalIdentityR = bigIntToBytesLe(ED25519_FIELD_PRIME + 1n, 32);
    const canonicalForge = forge(canonicalIdentityR);
    const nonCanonicalForge = forge(nonCanonicalIdentityR);
    // The v1 corpus records Noble v1's relaxed-mode result. That version
    // canonicalized R before hashing the verification challenge; Noble v2
    // correctly hashes the original wire encoding. Recreate the old call here
    // so upgrading the primitive does not silently rewrite a versioned corpus.
    const legacyZip215Signature = Uint8Array.from(nonCanonicalForge);
    legacyZip215Signature.set(ed25519.Point.fromBytes(nonCanonicalIdentityR, true).toBytes(), 0);

    cases.push(
      {
        name: "ed25519-signature-with-a-canonically-encoded-identity-r-control",
        sections: ["14.3"],
        note: "THE CONTROL, and it is accepted: `R` is the identity point in its canonical encoding and the verification equation holds. It exists so the rejection below is known to be about the ENCODING and not about a broken equation.",
        inputs: {
          testOnlyIdentitySeed: b(F17_ED_SEED),
          publicKey: b(F17_ED_PUBLIC),
          message: b(F17_ED_MESSAGE),
          signature: b(canonicalForge),
          rEncoding: b(canonicalIdentityR),
        },
        expected: {
          verificationVerdict: verifyE2eeSignature({
            algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
            publicKey: F17_ED_PUBLIC,
            message: F17_ED_MESSAGE,
            signature: canonicalForge,
          }),
        },
      },
      {
        name: "ed25519-signature-with-a-non-canonically-encoded-identity-r",
        sections: ["7.1", "14.3"],
        note: "The identical point, encoded as `y = p + 1`. §14.3 requires `zip215: false`, which is strict RFC 8032, so this is rejected; the pinned primitive additionally rejects it under `zip215: true`, which is recorded rather than assumed.",
        inputs: {
          publicKey: b(F17_ED_PUBLIC),
          message: b(F17_ED_MESSAGE),
          signature: b(nonCanonicalForge),
          rEncoding: b(nonCanonicalIdentityR),
        },
        expected: {
          verificationVerdict: verifyE2eeSignature({
            algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
            publicKey: F17_ED_PUBLIC,
            message: F17_ED_MESSAGE,
            signature: nonCanonicalForge,
          }),
          pinnedPrimitiveUnderZip215Relaxation: ed25519.verify(
            legacyZip215Signature,
            F17_ED_MESSAGE,
            F17_ED_PUBLIC,
            { zip215: true },
          ),
          differsFromTheControlOnlyInTheEncodingOfR:
            hex(canonicalForge.subarray(32)) !== hex(nonCanonicalForge.subarray(32)),
        },
      },
    );
  }

  {
    const good = ed25519.sign(F17_ED_MESSAGE, F17_ED_SEED);
    const scalarS = bytesLeToBigInt(good.subarray(32));
    for (const [name, s] of [
      ["ed25519-signature-scalar-at-the-group-order", ED25519_GROUP_ORDER],
      ["ed25519-signature-scalar-above-the-group-order", scalarS + ED25519_GROUP_ORDER],
    ] as const) {
      const signature = new Uint8Array(64);
      signature.set(good.subarray(0, 32));
      signature.set(bigIntToBytesLe(s % (1n << 256n), 32), 32);
      cases.push({
        name,
        sections: ["7.1", "14.3"],
        note: "A non-canonical SCALAR encoding: RFC 8032 requires `S < L`.",
        inputs: {
          publicKey: b(F17_ED_PUBLIC),
          message: b(F17_ED_MESSAGE),
          signature: b(signature),
        },
        expected: {
          verificationVerdict: verifyE2eeSignature({
            algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
            publicKey: F17_ED_PUBLIC,
            message: F17_ED_MESSAGE,
            signature,
          }),
        },
      });
    }
  }

  // ── cross-domain signature substitution (§3.5, §7.2) ─────────────────────
  //
  // One valid signature per transcript domain, replayed into every OTHER
  // domain's verification path. This is the vector behind the no-ad-hoc-
  // transcript rule: the domain string is the first element of every one of
  // these structures, so no signature can be lifted between them.
  {
    const capability = buildStatement();
    // The two §3.5 NODE-IDENTITY domains. They live in `nodeIdentity.ts` rather
    // than `relayE2eeTranscripts.ts`, and they are signed by the SAME Ed25519
    // node identity key as the capability and prekey domains — which is exactly
    // why §16.3 F17 names them here rather than leaving them to that module's own
    // corpus. A per-module corpus can only show that a domain's own signature
    // verifies; nothing but this matrix shows that a node-auth proof cannot be
    // presented as a capability statement's signature, or the reverse.
    const nodeAuthTranscript = encodeNodeAuthenticationTranscript({
      hubOrigin: HUB_ORIGIN,
      protocolMajor: 1,
      protocolMinor: 0,
      nodeId: NODE_ID,
      activeKeyId: IDENTITY_KEY_ID,
      challengeExpiresAt: EXPIRES_AT,
      challenge: NODE_IDENTITY_CHALLENGE,
    });
    const nodeRotationTranscript = encodeNodeKeyRotationTranscript({
      hubOrigin: HUB_ORIGIN,
      protocolMajor: 1,
      protocolMinor: 0,
      rotationRequestId: ROTATION_REQUEST_ID,
      nodeId: NODE_ID,
      oldActiveKeyId: OLD_KEY_ID,
      newKeyId: NEW_KEY_ID,
      newKey: { algorithm: "ed25519", publicKey: NODE_NEW_IDENTITY_PUBLIC },
      challengeExpiresAt: EXPIRES_AT,
      challenge: NODE_IDENTITY_CHALLENGE,
    });

    const domains = [
      {
        domain: E2EE_NODE_PREKEY_TRANSCRIPT_DOMAIN,
        family: "e2ee",
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_IDENTITY_PUBLIC,
        message: capability.nodePrekeyTranscript,
        signature: capability.crossSignature,
      },
      {
        domain: E2EE_NODE_IDENTITY_CONTINUITY_TRANSCRIPT_DOMAIN,
        family: "e2ee",
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_OLD_IDENTITY_PUBLIC,
        message: SHORT_LINEAGE.entries[0]!.transcript,
        signature: SHORT_LINEAGE.entries[0]!.signature,
      },
      {
        domain: E2EE_NODE_CAPABILITY_DIGEST_DOMAIN,
        family: "e2ee",
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_IDENTITY_PUBLIC,
        message: capability.envelope,
        signature: capability.signature,
      },
      {
        domain: E2EE_CLIENT_PREKEY_TRANSCRIPT_DOMAIN,
        family: "e2ee",
        algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
        publicKey: CLIENT_IDENTITY_PUBLIC,
        message: CLIENT_PREKEY_TRANSCRIPT,
        signature: CLIENT_PREKEY_SIGNATURE,
      },
      {
        domain: NODE_AUTH_TRANSCRIPT_DOMAIN,
        family: "node-identity",
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_IDENTITY_PUBLIC,
        message: nodeAuthTranscript,
        signature: signNode(nodeAuthTranscript),
      },
      {
        domain: NODE_KEY_ROTATION_TRANSCRIPT_DOMAIN,
        family: "node-identity",
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_IDENTITY_PUBLIC,
        message: nodeRotationTranscript,
        signature: signNode(nodeRotationTranscript),
      },
    ] as const;

    const matrix = domains.map((verifier) => ({
      verificationPath: verifier.domain,
      transcriptFamily: verifier.family,
      algorithm: verifier.algorithm,
      ownSignatureVerifies: verifyE2eeSignature({
        algorithm: verifier.algorithm,
        publicKey: verifier.publicKey,
        message: verifier.message,
        signature: verifier.signature,
      }),
      substitutions: domains
        .filter((source) => source.domain !== verifier.domain)
        .map((source) => ({
          signatureFrom: source.domain,
          signatureFromFamily: source.family,
          verifies: verifyE2eeSignature({
            algorithm: verifier.algorithm,
            publicKey: verifier.publicKey,
            message: verifier.message,
            signature: source.signature,
          }),
        })),
    }));
    const substitutions = matrix.reduce((total, row) => total + row.substitutions.length, 0);
    const crossFamilySubstitutions = matrix.reduce(
      (total, row) =>
        total +
        row.substitutions.filter((entry) => entry.signatureFromFamily !== row.transcriptFamily)
          .length,
      0,
    );

    cases.push({
      name: "cross-domain-signature-substitution",
      sections: ["3.5", "7.2", "7.1"],
      note: "All five domain groups §16.3 F17 names — node prekey, client prekey, the capability statement through its §7.2.1 envelope, identity continuity, and the node-identity domains of `nodeIdentity.ts` — each one's valid signature replayed into every other one's verification path. The matrix is complete in both directions and spans both transcript families, which is what §3.5's closing rule asserts: every domain string is distinct ACROSS the node-identity and E2EE families, so no signature is liftable between them. Four of the six are signed by the same Ed25519 node identity key, so a substitution here fails on the transcript bytes alone and never on a key mismatch.",
      inputs: {
        domains: domains.map((entry) => ({
          domain: entry.domain,
          transcriptFamily: entry.family,
          algorithm: entry.algorithm,
          publicKey: b(entry.publicKey),
          message: b(entry.message),
          signature: b(entry.signature),
        })),
      },
      expected: {
        matrix: matrix as unknown as JsonValue,
        domainCount: domains.length,
        substitutionsTested: substitutions,
        crossFamilySubstitutionsTested: crossFamilySubstitutions,
        everyOwnSignatureVerifies: matrix.every((row) => row.ownSignatureVerifies),
        everySubstitutionRejected: matrix.every((row) =>
          row.substitutions.every((entry) => entry.verifies === false),
        ),
      },
    });
  }

  return {
    file: "f17-key-material-validation.json",
    number: 17,
    title: "Key-material validation",
    sections: ["7.1", "8.1", "14.3", "3.5", "7.2", "16.3 F17"],
    summary:
      "The strict validation rules the headline guarantee assumes: the §8.1 all-zero X25519 shared secret in both the IK and NX handshake positions, the §7.1 P-256 public-key and ECDSA-signature encodings, the §14.3 Ed25519 canonicality rules, and the complete cross-domain signature substitution matrix behind the §7.2 no-ad-hoc-transcript rule — all five domain groups §16.3 F17 names, the node-identity domains of `nodeIdentity.ts` included, replayed into every other domain's verification path in both directions.",
    deferred: [
      "Each case names the §11 row for the position the material occupies (P11 inside the IK client certificate, P10 for a Noise-level failure, K2/K3 and P15 inside a node-signed statement). The row for material inside a node-signed statement depends on the §5.2 verifier and the §12.1.1 selection classification, neither of which is in packages/shared/src; those rows are carried as §16.2 labels and the DERIVED value in every case is the validator's or the verification path's own verdict. Owned by the §5.2 statement verifier and the client phase.",
      "A small-order Ed25519 public key is NOT emitted as a rejected encoding: the pinned primitive's strict public-key validation accepts it, and the rejection happens at verification. Asserting a validator rejection here would have been wrong, so the case is left to the verification-path rows above.",
      crossRuntimeDeferral(17),
    ],
    testKeyMaterial: {
      ...(SHARED_TEST_KEY_MATERIAL as Record<string, JsonValue>),
      testOnlyEd25519CanonicalitySeed: b(F17_ED_SEED),
      ed25519CanonicalityPublicKey: b(F17_ED_PUBLIC),
      curveParameters: {
        p256FieldPrime: hex(bigIntToBytesBe(P256_FIELD_PRIME, 32)),
        p256GroupOrder: hex(bigIntToBytesBe(P256_GROUP_ORDER, 32)),
        ed25519FieldPrime: hex(bigIntToBytesBe(ED25519_FIELD_PRIME, 32)),
        ed25519GroupOrder: hex(bigIntToBytesBe(ED25519_GROUP_ORDER, 32)),
      },
    },
    cases,
  };
}

// ─── §8 shared handshake material (F6, F7, F8, F9, F11, F12, F16) ────────────
//
// One channel, one pair of endpoints, one set of TEST-ONLY ephemerals. Every
// family below drives the LANDED `E2eeClientHandshake` and `E2eeNodeHandshake`
// through their real methods; nothing here recomputes a transcript, a
// derivation, or a bound that those modules already own.

const CHANNEL_ID = `ch_${"G".repeat(22)}`;
/** A second channel, for the §8.3 "the snapshot is per channel" cases. */
const OTHER_CHANNEL_ID = `ch_${"I".repeat(22)}`;
const OTHER_ACCOUNT_ID = "acct_9876543210";
const RELAY_PROTOCOL_MAJOR = 1;
const RELAY_PROTOCOL_MINOR = 2;
/** The only member of the relay contract's closed capability vocabulary (§8.3). */
const CHANNEL_OPEN_CAPABILITY = "ryco.rpc";
const CHANNEL_OPEN_EFFECTIVE_ROLE = "operator";

/**
 * TEST ONLY (§16.1). Both handshake ephemerals and the client nonce are fixed
 * counting patterns, injected through the state machines' own
 * `testOnly*` hooks — which exist for exactly this and which production callers
 * MUST omit, so the values come from the §14.5 CSPRNG in every real endpoint.
 */
const CLIENT_EPHEMERAL_SECRET = Uint8Array.from({ length: 32 }, (_u, index) => 0x01 + index);
const NODE_EPHEMERAL_SECRET = Uint8Array.from({ length: 32 }, (_u, index) => 0x21 + index);
const CLIENT_NONCE = Uint8Array.from({ length: 32 }, (_u, index) => 0x9f - index);

const CLIENT_IDENTITY_FINGERPRINT = e2eeKeyFingerprint("client-identity", CLIENT_IDENTITY_PUBLIC);
const CLIENT_AGREEMENT_FINGERPRINT = e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC);

/** The §4.5 budget every §8/§9/§10 case below runs under: the relay's own defaults. */
const HANDSHAKE_READY_LIMITS = {
  maxQueuedBytes: 4 * 1_024 * 1_024,
  maxControlFrameBytes: 256 * 1_024,
} as const;
const HANDSHAKE_BUDGET = e2eeChannelSizeBudget(HANDSHAKE_READY_LIMITS);

const APPROVED_AUTHORIZATION: E2eeClientAuthorization = {
  status: "approved",
  maxRole: "owner",
  capabilitySet: [CHANNEL_OPEN_CAPABILITY],
};

const DEFAULT_POLICY: E2eeNodeAdmissionPolicy = {
  requireApprovedClientE2EE: false,
  suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
};

function handshakeChannel(overrides: Partial<E2eeHandshakeChannel> = {}): E2eeHandshakeChannel {
  return {
    hubOrigin: HUB_ORIGIN,
    channelId: CHANNEL_ID,
    relayProtocolMajor: RELAY_PROTOCOL_MAJOR,
    relayProtocolMinor: RELAY_PROTOCOL_MINOR,
    channelOpenCapability: CHANNEL_OPEN_CAPABILITY,
    channelOpenEffectiveRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
    ...overrides,
  };
}

function advertisedMaterial(
  overrides: Partial<E2eeAdvertisedChannelMaterial> = {},
): E2eeAdvertisedChannelMaterial {
  return {
    nodeId: NODE_ID,
    nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
    prekeyId: PREKEY_ID,
    agreementPublicKey: NODE_AGREEMENT_PUBLIC,
    continuityChainTranscripts: [],
    continuityId: CONTINUITY_ID,
    ...overrides,
  };
}

const NATIVE_CREDENTIALS: E2eeClientHandshakeCredentials = {
  tier: "native",
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  agreementSecretKey: CLIENT_AGREEMENT_SECRET,
  prekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
  prekeySignature: CLIENT_PREKEY_SIGNATURE,
};

const WEB_CREDENTIALS: E2eeClientHandshakeCredentials = { tier: "web" };

function makeClientHandshake(options: {
  readonly tier: E2eeTier;
  readonly channel?: E2eeHandshakeChannel;
  readonly advertised?: E2eeAdvertisedChannelMaterial;
  readonly offeredSuites?: readonly number[];
  readonly intendedCapability?: string;
  readonly intendedRole?: string;
}): E2eeClientHandshake {
  return new E2eeClientHandshake({
    channel: options.channel ?? handshakeChannel(),
    advertised: options.advertised ?? advertisedMaterial(),
    selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    offeredSuites: options.offeredSuites ?? [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    credentials: options.tier === "native" ? NATIVE_CREDENTIALS : WEB_CREDENTIALS,
    intendedCapability: options.intendedCapability ?? CHANNEL_OPEN_CAPABILITY,
    intendedRole: options.intendedRole ?? CHANNEL_OPEN_EFFECTIVE_ROLE,
    testOnlyClientNonce: copyOf(CLIENT_NONCE),
    testOnlyEphemeralSecretKey: copyOf(CLIENT_EPHEMERAL_SECRET),
  });
}

interface NodeHandshakeOverrides {
  readonly channel?: E2eeHandshakeChannel;
  readonly advertised?: E2eeAdvertisedChannelMaterial;
  readonly agreementSecretKey?: Uint8Array;
  readonly policy?: E2eeNodeAdmissionPolicy;
  readonly authorization?: E2eeClientAuthorization | undefined;
  readonly enterE2eeMode?: () => E2eeModeTransition;
  readonly advertisedVersionMin?: number;
  readonly advertisedVersionMax?: number;
}

function makeNodeHandshake(options: NodeHandshakeOverrides = {}): E2eeNodeHandshake {
  return new E2eeNodeHandshake({
    channel: options.channel ?? handshakeChannel(),
    advertised: options.advertised ?? advertisedMaterial(),
    advertisedVersionMin: options.advertisedVersionMin ?? 1,
    advertisedVersionMax: options.advertisedVersionMax ?? 1,
    agreementSecretKey: options.agreementSecretKey ?? NODE_AGREEMENT_SECRET,
    advertisementEmittedAt: NOW,
    readPolicy: () => options.policy ?? DEFAULT_POLICY,
    lookupClientAuthorization: () =>
      "authorization" in options ? options.authorization : APPROVED_AUTHORIZATION,
    ...(options.enterE2eeMode === undefined ? {} : { enterE2eeMode: options.enterE2eeMode }),
    testOnlyEphemeralSecretKey: copyOf(NODE_EPHEMERAL_SECRET),
  });
}

/** The §11.2 row and local reason of a failed handshake step, as data. */
function handshakeFailureJson(result: { readonly kind: string }): JsonValue {
  const failure = result as unknown as E2eeHandshakeFailure;
  return { kind: "fatal", row: failure.row, reason: failure.reason };
}

/**
 * The §11.5 pre-key observable of a node-detected FATAL-PRE condition. Every
 * field is fixed by §11.2 and none of them may vary by cause; the corpus emits
 * the bytes so a reviewer can compare them across families by eye.
 */
function preKeyObservable(): JsonValue {
  const reject = encodeE2eeHandshakeReject();
  return {
    handshakeRejectRecords: 1,
    handshakeReject: b(reject),
    handshakeRejectBytes: reject.byteLength,
    closeReason: "channel_rejected",
    applicationPayloadBytes: 0,
  };
}

const HANDSHAKE_REJECT_RECORD = encodeE2eeHandshakeReject();

/**
 * A hello assembled OUTSIDE `E2eeClientHandshake`, for the negative cases whose
 * whole point is a value a conforming client cannot produce: a mutated context
 * block, a tier label that disagrees with the Noise message, a nonempty NX
 * payload. Everything it does emit goes through the landed encoders.
 */
function craftHello(input: {
  readonly contextBlock: Uint8Array;
  readonly commitment?: Uint8Array;
  readonly wrapperTier?: E2eeTier;
  readonly noiseTier?: E2eeTier;
  readonly claims?: Partial<E2eeIkHelloPayload>;
  readonly nxPayload?: Uint8Array;
  readonly offeredSuites?: readonly number[];
  readonly channelId?: string;
  readonly nodeAgreementPublicKey?: Uint8Array;
}): Uint8Array {
  const commitment = input.commitment ?? e2eeAuthorizationContextCommitment(input.contextBlock);
  const noiseTier = input.noiseTier ?? input.wrapperTier ?? "native";
  const prologue = encodeE2eeNoisePrologue({
    hubOrigin: HUB_ORIGIN,
    channelId: input.channelId ?? CHANNEL_ID,
    relayProtocolMajor: RELAY_PROTOCOL_MAJOR,
    relayProtocolMinor: RELAY_PROTOCOL_MINOR,
    e2eeVersion: E2EE_PROTOCOL_VERSION,
    suiteId: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    nodeId: NODE_ID,
    contextCommitment: commitment,
  });
  const noise = new E2eeNoiseHandshake({
    pattern: noiseTier === "native" ? E2EE_NOISE_PATTERN_IK : E2EE_NOISE_PATTERN_NX,
    role: "initiator",
    prologue,
    staticSecretKey: noiseTier === "native" ? CLIENT_AGREEMENT_SECRET : undefined,
    remoteStaticPublicKey:
      noiseTier === "native" ? (input.nodeAgreementPublicKey ?? NODE_AGREEMENT_PUBLIC) : undefined,
    testOnlyEphemeralSecretKey: copyOf(CLIENT_EPHEMERAL_SECRET),
  });
  const payload =
    noiseTier === "native"
      ? encodeE2eeIkHelloPayload({
          clientPrekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
          clientPrekeySignature: CLIENT_PREKEY_SIGNATURE,
          accountId: ACCOUNT_ID,
          intendedCapability: CHANNEL_OPEN_CAPABILITY,
          intendedRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
          ...input.claims,
        })
      : (input.nxPayload ?? E2EE_NX_HELLO_PAYLOAD);
  return encodeE2eeClientHello({
    tier: input.wrapperTier ?? noiseTier,
    selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    offeredSuites: input.offeredSuites ?? [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    clientNonce: CLIENT_NONCE,
    contextCommitment: commitment,
    noiseMessage1: noise.writeMessage(payload),
  });
}

/** The §8.3 context input a conforming native client builds on this channel. */
function nativeContextInput(
  overrides: Partial<E2eeAuthorizationContextInput> = {},
): E2eeAuthorizationContextInput {
  return {
    hubOrigin: HUB_ORIGIN,
    channelId: CHANNEL_ID,
    relayProtocolMajor: RELAY_PROTOCOL_MAJOR,
    relayProtocolMinor: RELAY_PROTOCOL_MINOR,
    e2eeVersion: E2EE_PROTOCOL_VERSION,
    suiteId: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    nodeId: NODE_ID,
    nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
    clientIntendedCapability: CHANNEL_OPEN_CAPABILITY,
    clientIntendedRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
    channelOpenCapability: CHANNEL_OPEN_CAPABILITY,
    channelOpenEffectiveRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
    nodeAgreementFingerprint: NODE_AGREEMENT_FINGERPRINT,
    nodeContinuityChainTranscripts: [],
    nodeContinuityId: CONTINUITY_ID,
    client: {
      tier: "native",
      accountId: ACCOUNT_ID,
      identityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
      agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
    },
    ...overrides,
  };
}

// ─── the complete §8 trace both handshake families emit ──────────────────────

interface HandshakeTrace {
  readonly tier: E2eeTier;
  readonly channel: E2eeHandshakeChannel;
  readonly advertised: E2eeAdvertisedChannelMaterial;
  readonly contextBlock: Uint8Array;
  readonly contextCommitment: Uint8Array;
  readonly prologue: Uint8Array;
  readonly helloRecord: Uint8Array;
  readonly helloPayloadPlaintext: Uint8Array;
  readonly noiseMessage1: Uint8Array;
  readonly serverAcceptRecord: Uint8Array;
  readonly serverAcceptTbs: Uint8Array;
  readonly noiseMessage2: Uint8Array;
  readonly noiseHandshakeHash: Uint8Array;
  readonly noiseChainingKeyFinal: Uint8Array;
  readonly acceptPayloadPlaintext: Uint8Array;
  readonly confirmationTranscript: Uint8Array;
  readonly serverConfirmation: Uint8Array;
  readonly sessionBindingHash: Uint8Array;
  readonly epochSecretC2N: Uint8Array;
  readonly epochSecretN2C: Uint8Array;
  readonly exporterSecret: Uint8Array;
  readonly serverConfirmationKey: Uint8Array;
  readonly aeadKeyC2N: Uint8Array;
  readonly aeadKeyN2C: Uint8Array;
  readonly admittedAuthority: E2eeAdmittedAuthoritySnapshot | undefined;
  readonly implicitFinishDeadlineAt: number;
  /** The client and node halves agreed on every §6.5 secret. */
  readonly secretsAgree: boolean;
}

function copyOf(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

function replayNoiseHandshakeHash(input: {
  readonly tier: E2eeTier;
  readonly prologue: Uint8Array;
  readonly message1Payload: Uint8Array;
  readonly message2Payload: Uint8Array;
  readonly message1: Uint8Array;
  readonly message2: Uint8Array;
}): Uint8Array {
  const pattern = input.tier === "native" ? E2EE_NOISE_PATTERN_IK : E2EE_NOISE_PATTERN_NX;
  const initiator = new E2eeNoiseHandshake({
    pattern,
    role: "initiator",
    prologue: input.prologue,
    ...(input.tier === "native"
      ? {
          staticSecretKey: CLIENT_AGREEMENT_SECRET,
          remoteStaticPublicKey: NODE_AGREEMENT_PUBLIC,
        }
      : {}),
    testOnlyEphemeralSecretKey: copyOf(CLIENT_EPHEMERAL_SECRET),
  });
  const responder = new E2eeNoiseHandshake({
    pattern,
    role: "responder",
    prologue: input.prologue,
    staticSecretKey: NODE_AGREEMENT_SECRET,
    testOnlyEphemeralSecretKey: copyOf(NODE_EPHEMERAL_SECRET),
  });
  try {
    if (hex(initiator.writeMessage(input.message1Payload)) !== hex(input.message1)) {
      throw new Error("Fixture Noise replay disagreed on message 1.");
    }
    if (hex(responder.readMessage(input.message1)) !== hex(input.message1Payload)) {
      throw new Error("Fixture Noise replay disagreed on message-1 payload.");
    }
    if (hex(responder.writeMessage(input.message2Payload)) !== hex(input.message2)) {
      throw new Error("Fixture Noise replay disagreed on message 2.");
    }
    if (hex(initiator.readMessage(input.message2)) !== hex(input.message2Payload)) {
      throw new Error("Fixture Noise replay disagreed on message-2 payload.");
    }
    const initiatorHash = initiator.testOnlyHandshakeHash;
    const responderHash = responder.testOnlyHandshakeHash;
    if (
      initiatorHash === undefined ||
      responderHash === undefined ||
      hex(initiatorHash) !== hex(responderHash)
    ) {
      throw new Error("Fixture Noise endpoints disagreed on the final handshake hash.");
    }
    return copyOf(initiatorHash);
  } finally {
    initiator.destroy();
    responder.destroy();
  }
}

/**
 * Run one complete §8 handshake in process and snapshot every named
 * intermediate BEFORE the §6.5 secrets are handed to a session, which takes
 * ownership of them and erases them (§9.5).
 */
function runHandshakeTrace(options: {
  readonly tier: E2eeTier;
  readonly channel?: E2eeHandshakeChannel;
  readonly clientAdvertised?: E2eeAdvertisedChannelMaterial;
  readonly nodeAdvertised?: E2eeAdvertisedChannelMaterial;
}): HandshakeTrace {
  const channel = options.channel ?? handshakeChannel();
  const clientAdvertised = options.clientAdvertised ?? advertisedMaterial();
  const nodeAdvertised = options.nodeAdvertised ?? clientAdvertised;

  const client = makeClientHandshake({
    tier: options.tier,
    channel,
    advertised: clientAdvertised,
  });
  const hello = client.createHello(NOW);
  if (hello.kind !== "hello") throw new Error("Fixture handshake failed to build a hello.");
  const node = makeNodeHandshake({ channel, advertised: nodeAdvertised });
  const accept = node.receiveHello(hello.record, NOW);
  if (accept.kind !== "accepted") throw new Error("Fixture handshake was not accepted.");
  const established = client.receiveServerAccept(accept.record, NOW);
  if (established.kind !== "established") {
    throw new Error("Fixture handshake did not establish at the client.");
  }

  const decodedHello = decodeE2eeClientHello(hello.record);
  if (decodedHello.kind !== "ok") throw new Error("Fixture hello did not decode.");
  const decodedAccept = decodeE2eeServerAccept(accept.record);
  if (decodedAccept.kind !== "ok") throw new Error("Fixture accept did not decode.");

  const helloPayloadPlaintext =
    options.tier === "native"
      ? encodeE2eeIkHelloPayload({
          clientPrekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
          clientPrekeySignature: CLIENT_PREKEY_SIGNATURE,
          accountId: ACCOUNT_ID,
          intendedCapability: CHANNEL_OPEN_CAPABILITY,
          intendedRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
        })
      : E2EE_NX_HELLO_PAYLOAD;
  const acceptPayloadPlaintext = encodeE2eeServerAcceptPayload({
    channelOpenCapability: channel.channelOpenCapability,
    channelOpenEffectiveRole: channel.channelOpenEffectiveRole,
    nodeAgreementKeyFingerprint: e2eeKeyFingerprint("agreement", nodeAdvertised.agreementPublicKey),
  });
  const noiseHandshakeHash = replayNoiseHandshakeHash({
    tier: options.tier,
    prologue: hello.prologue,
    message1Payload: helloPayloadPlaintext,
    message2Payload: acceptPayloadPlaintext,
    message1: decodedHello.value.noiseMessage1,
    message2: decodedAccept.value.noiseMessage2,
  });
  const independentNoise = composeIndependentNoise({
    pattern: options.tier === "native" ? "IK" : "NX",
    prologue: hello.prologue,
    ...(options.tier === "native" ? { initiatorStaticSecret: CLIENT_AGREEMENT_SECRET } : {}),
    initiatorEphemeralSecret: CLIENT_EPHEMERAL_SECRET,
    responderStaticSecret: NODE_AGREEMENT_SECRET,
    responderEphemeralSecret: NODE_EPHEMERAL_SECRET,
    message1Payload: helloPayloadPlaintext,
    message2Payload: acceptPayloadPlaintext,
  });
  if (
    hex(independentNoise.message1) !== hex(decodedHello.value.noiseMessage1) ||
    hex(independentNoise.message2) !== hex(decodedAccept.value.noiseMessage2) ||
    hex(independentNoise.handshakeHash) !== hex(noiseHandshakeHash)
  ) {
    throw new Error("Independent Noise composition disagreed with the canonical handshake.");
  }

  const trace: HandshakeTrace = {
    tier: options.tier,
    channel,
    advertised: clientAdvertised,
    contextBlock: copyOf(hello.contextBlock),
    contextCommitment: copyOf(hello.contextCommitment),
    prologue: copyOf(hello.prologue),
    helloRecord: copyOf(hello.record),
    helloPayloadPlaintext,
    noiseMessage1: copyOf(decodedHello.value.noiseMessage1),
    serverAcceptRecord: copyOf(accept.record),
    serverAcceptTbs: copyOf(accept.serverAcceptTbs),
    noiseMessage2: copyOf(decodedAccept.value.noiseMessage2),
    noiseHandshakeHash,
    noiseChainingKeyFinal: independentNoise.chainingKeyFinal,
    acceptPayloadPlaintext,
    confirmationTranscript: copyOf(accept.confirmationTranscript),
    serverConfirmation: copyOf(decodedAccept.value.serverConfirmation),
    sessionBindingHash: copyOf(established.sessionBindingHash),
    epochSecretC2N: copyOf(established.secrets.epochSecretC2N),
    epochSecretN2C: copyOf(established.secrets.epochSecretN2C),
    exporterSecret: copyOf(established.secrets.exporterSecret),
    serverConfirmationKey: copyOf(established.secrets.serverConfirmationKey),
    aeadKeyC2N: deriveE2eeAeadKey(
      established.secrets.epochSecretC2N,
      E2EE_DIRECTION_CLIENT_TO_NODE,
    ),
    aeadKeyN2C: deriveE2eeAeadKey(
      established.secrets.epochSecretN2C,
      E2EE_DIRECTION_NODE_TO_CLIENT,
    ),
    admittedAuthority: accept.admittedAuthority,
    implicitFinishDeadlineAt: accept.implicitFinishDeadlineAt,
    secretsAgree:
      hex(accept.secrets.epochSecretC2N) === hex(established.secrets.epochSecretC2N) &&
      hex(accept.secrets.epochSecretN2C) === hex(established.secrets.epochSecretN2C) &&
      hex(accept.secrets.exporterSecret) === hex(established.secrets.exporterSecret) &&
      hex(accept.secrets.serverConfirmationKey) === hex(established.secrets.serverConfirmationKey),
  };

  // §9.5: both endpoints' secret bundles are erased here rather than left in the
  // generator's heap; every value the corpus carries was copied above.
  eraseE2eeSessionSecrets(established.secrets);
  eraseE2eeSessionSecrets(accept.secrets);
  return trace;
}

/** A fresh, independently owned copy of a trace's §6.5 secrets. */
function traceSecrets(trace: HandshakeTrace): E2eeSessionSecrets {
  return e2eeSessionSecretsFromNoiseKeys({
    epochSecretC2N: copyOf(trace.epochSecretC2N),
    epochSecretN2C: copyOf(trace.epochSecretN2C),
    exporterSecret: copyOf(trace.exporterSecret),
  });
}

function traceSession(
  trace: HandshakeTrace,
  sendDirection: E2eeDirection,
  synthetic?: {
    readonly send?: E2eeSyntheticDirectionState;
    readonly receive?: E2eeSyntheticDirectionState;
    readonly sessionBindingHash?: Uint8Array;
    readonly aeadFactory?: E2eeRecordAeadFactory;
  },
): E2eeRecordSession {
  return new E2eeRecordSession({
    secrets: traceSecrets(trace),
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash: synthetic?.sessionBindingHash ?? trace.sessionBindingHash,
    sendDirection,
    plaintextCeiling: HANDSHAKE_BUDGET.plaintextCeiling,
    ...(synthetic?.send === undefined ? {} : { testOnlySyntheticSendState: synthetic.send }),
    ...(synthetic?.receive === undefined
      ? {}
      : { testOnlySyntheticReceiveState: synthetic.receive }),
    ...(synthetic?.aeadFactory === undefined ? {} : { testOnlyAeadFactory: synthetic.aeadFactory }),
  });
}

// ─── §9 send/receive helpers ─────────────────────────────────────────────────

interface ProtectedRecord {
  readonly result: E2eeProtectResult;
  readonly envelope: Uint8Array | undefined;
  readonly transmitted: number;
}

async function protectRecord(
  session: E2eeRecordSession,
  innerType: E2eeInnerRecordType,
  body: Uint8Array,
): Promise<ProtectedRecord> {
  let envelope: Uint8Array | undefined;
  let transmitted = 0;
  const result = await session.protect({
    innerType,
    body,
    admit: () => true,
    transmit: (bytes) => {
      transmitted += 1;
      envelope = copyOf(bytes);
      return { kind: "sent" };
    },
  });
  return { result, envelope, transmitted };
}

async function protectOrThrow(
  session: E2eeRecordSession,
  innerType: E2eeInnerRecordType,
  body: Uint8Array,
): Promise<{
  readonly envelope: Uint8Array;
  readonly epoch: bigint;
  readonly counter: bigint;
  readonly epochCompleted: boolean;
  readonly plaintextBytes: number;
  readonly envelopeBytes: number;
}> {
  const sent = await protectRecord(session, innerType, body);
  if (sent.result.kind !== "protected" || sent.envelope === undefined) {
    throw new Error(`Fixture record was not protected: ${sent.result.kind}`);
  }
  return {
    envelope: sent.envelope,
    epoch: sent.result.epoch,
    counter: sent.result.counter,
    epochCompleted: sent.result.epochCompleted,
    plaintextBytes: sent.result.plaintextBytes,
    envelopeBytes: sent.result.envelopeBytes,
  };
}

function seq(position: { readonly epoch: bigint; readonly counter: bigint }): JsonValue {
  return { epoch: sequenceValue(position.epoch), counter: sequenceValue(position.counter) };
}

function safeNumber(value: bigint): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new RangeError("Fixture sequence value does not fit a JSON number exactly.");
  }
  return asNumber;
}

/**
 * A §9.2 sequence value as JSON. `E2EE_COUNTER_MAX` is 2^64 − 1, which no JSON
 * number represents exactly, and the §16.3 F9 counter-exhaustion states stand at
 * the ceiling by construction. A value inside the safe-integer range is emitted
 * as a number, exactly as it always was; anything beyond it is emitted as its
 * exact decimal string. Every consumer reads these through `BigInt`, which
 * accepts both spellings, so no existing case's bytes change.
 */
function sequenceValue(value: bigint): JsonValue {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString(10);
}

function directionStateJson(state: E2eeDirectionState): JsonValue {
  return {
    epoch: state.epoch === undefined ? null : sequenceValue(state.epoch),
    counter: state.counter === undefined ? null : sequenceValue(state.counter),
    epochRecords: state.epochRecords,
    epochBytes: state.epochBytes,
    exhausted: state.exhausted,
  };
}

function protectResultJson(result: E2eeProtectResult): JsonValue {
  switch (result.kind) {
    case "protected":
      return {
        kind: "protected",
        epoch: sequenceValue(result.epoch),
        counter: sequenceValue(result.counter),
        plaintextBytes: result.plaintextBytes,
        envelopeBytes: result.envelopeBytes,
        epochCompleted: result.epochCompleted,
      };
    case "refused":
      return { kind: "refused", reason: result.reason };
    case "unavailable":
      return { kind: "unavailable", reason: result.reason };
    case "close_required":
      return { kind: "close_required" };
    case "exhausted":
      return { kind: "exhausted" };
    case "send_failed":
      return {
        kind: "send_failed",
        epoch: sequenceValue(result.epoch),
        counter: sequenceValue(result.counter),
        delivery: result.delivery,
        sendPathUsable: result.sendPathUsable,
        mayEmitError: result.mayEmitError,
      };
  }
}

function unprotectResultJson(result: E2eeUnprotectResult): JsonValue {
  if (result.kind === "fatal") return { kind: "fatal", reason: result.reason };
  return {
    kind: "authenticated",
    innerType: result.innerType,
    bodyBytes: result.body.byteLength,
    epoch: sequenceValue(result.epoch),
    counter: sequenceValue(result.counter),
    plaintextBytes: result.plaintextBytes,
    epochCompleted: result.epochCompleted,
  };
}

// ─── F6 / F7 — the IK and NX handshakes (§8) ─────────────────────────────────

const IK_TRACE = runHandshakeTrace({ tier: "native" });
const NX_TRACE = runHandshakeTrace({ tier: "web" });

/** The shared §8 key block both handshake families repeat. */
const HANDSHAKE_TEST_KEY_MATERIAL: JsonValue = {
  ...(SHARED_TEST_KEY_MATERIAL as Record<string, JsonValue>),
  testOnlyClientEphemeralSecretKey: b(CLIENT_EPHEMERAL_SECRET),
  testOnlyNodeEphemeralSecretKey: b(NODE_EPHEMERAL_SECRET),
  testOnlyClientNonce: b(CLIENT_NONCE),
  clientIdentityFingerprint: b(CLIENT_IDENTITY_FINGERPRINT),
  clientAgreementFingerprint: b(CLIENT_AGREEMENT_FINGERPRINT),
  nodeIdentityFingerprint: b(NODE_IDENTITY_FINGERPRINT),
  nodeAgreementFingerprint: b(NODE_AGREEMENT_FINGERPRINT),
  channel: {
    channelId: CHANNEL_ID,
    relayProtocolMajor: RELAY_PROTOCOL_MAJOR,
    relayProtocolMinor: RELAY_PROTOCOL_MINOR,
    channelOpenCapability: CHANNEL_OPEN_CAPABILITY,
    channelOpenEffectiveRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
  },
};

/** Every §16.3 F6 named intermediate, in the order §8 produces them. */
function handshakeIntermediates(trace: HandshakeTrace): Record<string, JsonValue> {
  return {
    contextBlock: b(trace.contextBlock),
    contextBlockBytes: trace.contextBlock.byteLength,
    contextCommitment: b(trace.contextCommitment),
    prologue: b(trace.prologue),
    clientHello: b(trace.helloRecord),
    clientHelloBytes: trace.helloRecord.byteLength,
    noiseMessage1: b(trace.noiseMessage1),
    message1PayloadPlaintext: b(trace.helloPayloadPlaintext),
    message1PayloadPlaintextBytes: trace.helloPayloadPlaintext.byteLength,
    serverAcceptTbs: b(trace.serverAcceptTbs),
    noiseMessage2: b(trace.noiseMessage2),
    noiseHandshakeHash: b(trace.noiseHandshakeHash),
    noiseChainingKeyFinal: b(trace.noiseChainingKeyFinal),
    message2PayloadPlaintext: b(trace.acceptPayloadPlaintext),
    exporterSecret: b(trace.exporterSecret),
    serverConfirmationKey: b(trace.serverConfirmationKey),
    confirmationTranscript: b(trace.confirmationTranscript),
    serverConfirmation: b(trace.serverConfirmation),
    serverAccept: b(trace.serverAcceptRecord),
    serverAcceptBytes: trace.serverAcceptRecord.byteLength,
    sessionBindingHash: b(trace.sessionBindingHash),
    epochSecretC2N: b(trace.epochSecretC2N),
    epochSecretN2C: b(trace.epochSecretN2C),
    aeadKeyC2NEpoch0: b(trace.aeadKeyC2N),
    aeadKeyN2CEpoch0: b(trace.aeadKeyN2C),
    bothEndpointsDerivedIdenticalSecrets: trace.secretsAgree,
  };
}

/**
 * The first protected envelope in each direction, including the §8.9 implicit
 * finish: the client's first `0x01` envelope is what authenticates the finish,
 * and the node MUST NOT invoke the RPC handler before it does.
 */
async function firstEnvelopes(trace: HandshakeTrace): Promise<JsonValue> {
  const clientSession = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
  const nodeSession = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
  const node = makeNodeHandshake({ channel: trace.channel, advertised: trace.advertised });
  const helloAgain = node.receiveHello(trace.helloRecord, NOW);
  if (helloAgain.kind !== "accepted") throw new Error("Fixture node did not re-accept the hello.");
  eraseE2eeSessionSecrets(helloAgain.secrets);
  const beforeFinish = {
    mayInvokeRpcHandler: node.mayInvokeRpcHandler,
    mayEmitApplicationRpc: node.mayEmitApplicationRpc,
  };

  const c2nBody = utf8.encode('{"_tag":"ryco.rpc.ping"}');
  const c2n = await protectOrThrow(clientSession, E2EE_INNER_TYPE_RPC, c2nBody);
  const c2nReceived = nodeSession.unprotect(c2n.envelope);
  const finish = node.authenticateImplicitFinish({ now: NOW });

  const n2cBody = utf8.encode('{"_tag":"ryco.rpc.pong"}');
  const n2c = await protectOrThrow(nodeSession, E2EE_INNER_TYPE_RPC, n2cBody);
  const n2cReceived = clientSession.unprotect(n2c.envelope);

  const result: JsonValue = {
    clientToNode: {
      innerBody: b(c2nBody),
      envelope: b(c2n.envelope),
      envelopeBytes: c2n.envelopeBytes,
      position: seq({ epoch: c2n.epoch, counter: c2n.counter }),
      aad: b(
        e2eeEnvelopeAad({
          header: c2n.envelope.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
          sessionBindingHash: trace.sessionBindingHash,
          direction: E2EE_DIRECTION_CLIENT_TO_NODE,
        }),
      ),
      receivedByNode: unprotectResultJson(c2nReceived),
    },
    implicitFinish: {
      beforeFirstClientEnvelope: beforeFinish,
      result: finish.kind,
      mayInvokeRpcHandlerAfter: node.mayInvokeRpcHandler,
      mayEmitApplicationRpcAfter: node.mayEmitApplicationRpc,
      deadlineAt: trace.implicitFinishDeadlineAt,
    },
    nodeToClient: {
      innerBody: b(n2cBody),
      envelope: b(n2c.envelope),
      envelopeBytes: n2c.envelopeBytes,
      position: seq({ epoch: n2c.epoch, counter: n2c.counter }),
      aad: b(
        e2eeEnvelopeAad({
          header: n2c.envelope.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
          sessionBindingHash: trace.sessionBindingHash,
          direction: E2EE_DIRECTION_NODE_TO_CLIENT,
        }),
      ),
      receivedByClient: unprotectResultJson(n2cReceived),
    },
  };
  clientSession.erase();
  nodeSession.erase();
  return result;
}

async function buildFamily6(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];

  cases.push({
    name: "ik-handshake-complete-trace",
    sections: ["8.1", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "6.5"],
    note: "One deterministic IK handshake, end to end, with every §16.3 F6 named intermediate. Both endpoints ran the LANDED state machines against each other; `bothEndpointsDerivedIdenticalSecrets` is the assertion that they agreed on all four §6.5 secrets rather than the generator asserting it of itself.",
    inputs: {
      tier: "native",
      pattern: E2EE_NOISE_PATTERN_IK,
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      hubOrigin: HUB_ORIGIN,
      channelId: CHANNEL_ID,
      nodeId: NODE_ID,
      prekeyId: PREKEY_ID,
      continuityId: CONTINUITY_ID,
      continuityChainLength: 0,
      accountId: ACCOUNT_ID,
      intendedCapability: CHANNEL_OPEN_CAPABILITY,
      intendedRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
      clientPrekeyTranscript: b(CLIENT_PREKEY_TRANSCRIPT),
      clientPrekeySignature: b(CLIENT_PREKEY_SIGNATURE),
      now: NOW,
    },
    expected: {
      ...handshakeIntermediates(IK_TRACE),
      admittedAuthority: {
        hubOrigin: IK_TRACE.admittedAuthority!.hubOrigin,
        accountId: IK_TRACE.admittedAuthority!.accountId,
        clientIdentityFingerprint: b(IK_TRACE.admittedAuthority!.clientIdentityFingerprint),
        status: IK_TRACE.admittedAuthority!.status,
        maxRole: IK_TRACE.admittedAuthority!.maxRole,
        capabilitySet: [...IK_TRACE.admittedAuthority!.capabilitySet],
      },
      firstProtectedEnvelopes: await firstEnvelopes(IK_TRACE),
    },
  });

  return {
    file: "f06-ik-handshake.json",
    number: 6,
    title: "IK handshake",
    sections: ["8", "16.3 F6"],
    summary:
      "One complete deterministic IK handshake with every §16.3 F6 named intermediate as an expected output — the §8.3 context block and commitment, the §8.4 prologue, the §8.5 hello wire bytes and its encrypted message-1 payload, `ServerAcceptTBS`, the §6.5 secrets, `serverConfirmationKey`, `confirmationTranscript`, `serverConfirmation`, the final `E2EEServerAccept` wire bytes, `sessionBindingHash`, both epoch-0 AEAD keys, and the first protected envelope in each direction with the §8.9 implicit finish.",
    deferred: [],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

async function buildFamily7(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];

  cases.push({
    name: "nx-handshake-complete-trace",
    sections: ["8.1", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "6.5"],
    note: "The same shape as F6 on the web tier. Element 10 is the empty string and element 16 the empty array (§8.3 absence semantics), the message-1 payload is zero-length (§8.5), and the node records no §8.6 step 6 snapshot because NX carries no Branch A record.",
    inputs: {
      tier: "web",
      pattern: E2EE_NOISE_PATTERN_NX,
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      hubOrigin: HUB_ORIGIN,
      channelId: CHANNEL_ID,
      nodeId: NODE_ID,
      prekeyId: PREKEY_ID,
      continuityId: CONTINUITY_ID,
      continuityChainLength: 0,
      now: NOW,
    },
    expected: {
      ...handshakeIntermediates(NX_TRACE),
      message1PayloadIsEmpty: NX_TRACE.helloPayloadPlaintext.byteLength === 0,
      admittedAuthority: null,
      firstProtectedEnvelopes: await firstEnvelopes(NX_TRACE),
    },
  });

  // §8.5: a nonempty NX message-1 payload is a handshake failure. The NX first
  // message has no encryption keys (§8.10), so nothing may ride in it.
  const nonEmptyNxPayload = utf8.encode("not-empty");
  const nonEmptyHello = craftHello({
    contextBlock: NX_TRACE.contextBlock,
    noiseTier: "web",
    nxPayload: nonEmptyNxPayload,
  });
  const nonEmptyResult = makeNodeHandshake().receiveHello(nonEmptyHello, NOW);
  cases.push({
    name: "nx-message-1-payload-must-be-empty",
    sections: ["8.5", "8.6 step 5", "8.10", "11.2 P10"],
    note: "The wrapper, the prologue, and the context are the happy path's; only the Noise message-1 payload differs. The §8.10 property that makes this a rule is that message 1 of NX is unencrypted and unauthenticated.",
    inputs: {
      tier: "web",
      message1PayloadPlaintext: b(nonEmptyNxPayload),
      clientHello: b(nonEmptyHello),
    },
    expected: {
      ...(handshakeFailureJson(nonEmptyResult) as Record<string, JsonValue>),
      disposition: "FATAL-PRE",
      observable: preKeyObservable(),
    },
  });

  // §8.7/§8.8 step 3: in NX the `s` token of message 2 transmits the node
  // static, and the client MUST require it to byte-equal the advertised prekey
  // certificate's `agreementPublicKey`. The node below advertises the corpus
  // prekey and answers with a DIFFERENT static, which is exactly the substitution
  // the check exists to catch.
  const substituteSecret = seedOf(0x14);
  const substitutePublic = x25519.getPublicKey(substituteSecret);
  const substituteClient = makeClientHandshake({ tier: "web" });
  const substituteHello = substituteClient.createHello(NOW);
  if (substituteHello.kind !== "hello") throw new Error("Fixture NX hello failed.");
  const substituteNode = makeNodeHandshake({ agreementSecretKey: substituteSecret });
  const substituteAccept = substituteNode.receiveHello(substituteHello.record, NOW);
  if (substituteAccept.kind !== "accepted") {
    throw new Error("Fixture NX substitution node did not accept.");
  }
  eraseE2eeSessionSecrets(substituteAccept.secrets);
  const substituteResult = substituteClient.receiveServerAccept(substituteAccept.record, NOW);
  cases.push({
    name: "nx-responder-static-must-equal-the-advertised-prekey",
    sections: ["8.7", "8.8 step 3", "6.4", "11.2 P16"],
    note: "The node's context, accept payload, and confirmation are all built from the ADVERTISED prekey, so every other check passes; only the Noise static the client learns from message 2 differs. It is a check on the accept's content and therefore enumerates as P16, not as one of P10's three named Noise conditions.",
    inputs: {
      tier: "web",
      advertisedAgreementPublicKey: b(NODE_AGREEMENT_PUBLIC),
      testOnlySubstitutedAgreementSecretKey: b(substituteSecret),
      substitutedAgreementPublicKey: b(substitutePublic),
      serverAccept: b(substituteAccept.record),
    },
    expected: {
      ...(handshakeFailureJson(substituteResult) as Record<string, JsonValue>),
      disposition: "FATAL-PRE",
      clientEmitsNoRecord: true,
      closeReason: "channel_rejected",
    },
  });

  return {
    file: "f07-nx-handshake.json",
    number: 7,
    title: "NX handshake",
    sections: ["8", "16.3 F7"],
    summary:
      "The F6 shape on the web tier, plus the two rules that exist only for NX: the zero-length message-1 payload (§8.5), with a nonempty-payload case expecting FATAL-PRE `P10`; and the §8.8 step 3 responder-static byte-equality check against the advertised prekey, with a substitution case expecting `P16`.",
    deferred: [crossRuntimeDeferral(7)],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F8 — record protection (§9.1–§9.3) ──────────────────────────────────────

/**
 * A receiver whose AEAD key is the one its PEER used, so that the only
 * difference between the two endpoints' §9.1 inputs is the direction label §3.4
 * fixes. Without it the wrong-direction case would change two things at once —
 * the label in the AAD and the label in the §9.4 key derivation — and would
 * prove nothing about either. The key substitution goes through the session's
 * own documented test hook; the nonce, the AAD construction, and the §4.3
 * ordering all stay inside the module.
 */
function fixedKeyAeadFactory(key: Uint8Array): E2eeRecordAeadFactory {
  const owned = copyOf(key);
  return () => ({
    seal: (nonce, plaintext, aad) => chacha20poly1305(owned, nonce, aad).encrypt(plaintext),
    open: (nonce, ciphertext, aad) => chacha20poly1305(owned, nonce, aad).decrypt(ciphertext),
  });
}

async function buildFamily8(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];
  const trace = IK_TRACE;

  // ── exact AAD bytes for both directions ──────────────────────────────────
  for (const [name, direction] of [
    ["aad-client-to-node", E2EE_DIRECTION_CLIENT_TO_NODE],
    ["aad-node-to-client", E2EE_DIRECTION_NODE_TO_CLIENT],
  ] as const) {
    const header = encodeE2eeEnvelopeHeader({
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      epoch: 0n,
      counter: 0n,
    });
    const label = encodeE2eeDirectionLabel(direction);
    const aad = e2eeEnvelopeAad({
      header,
      sessionBindingHash: trace.sessionBindingHash,
      direction,
    });
    cases.push({
      name,
      sections: ["3.3", "9.1"],
      note: "The AAD is `header ‖ sessionBindingHash ‖ directionLabel`, and it is the exact envelope header rather than a re-encoding of its fields. The nonce is the header's own `epoch ‖ counter`.",
      inputs: {
        direction,
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        epoch: 0,
        counter: 0,
        sessionBindingHash: b(trace.sessionBindingHash),
      },
      expected: {
        header: b(header),
        headerBytes: header.byteLength,
        envelopeHeaderBytes: E2EE_ENVELOPE_HEADER_BYTES,
        directionLabel: b(label),
        nonce: b(e2eeAeadNonce(0n, 0n)),
        nonceEqualsHeaderSequenceFields:
          hex(e2eeAeadNonce(0n, 0n)) === hex(header.subarray(E2EE_ENVELOPE_HEADER_BYTES - 12)),
        aad: b(aad),
        aadBytes: aad.byteLength,
        matchesAadBytesConstant: aad.byteLength === E2EE_AAD_BYTES,
      },
    });
  }

  // ── envelopes at counters zero and one, in both directions ───────────────
  for (const [name, sendDirection] of [
    ["client-to-node", E2EE_DIRECTION_CLIENT_TO_NODE],
    ["node-to-client", E2EE_DIRECTION_NODE_TO_CLIENT],
  ] as const) {
    const sender = traceSession(trace, sendDirection);
    const receiver = traceSession(
      trace,
      sendDirection === E2EE_DIRECTION_CLIENT_TO_NODE
        ? E2EE_DIRECTION_NODE_TO_CLIENT
        : E2EE_DIRECTION_CLIENT_TO_NODE,
    );
    const bodies = [utf8.encode("counter-zero"), utf8.encode("counter-one")];
    const records: JsonValue[] = [];
    for (const body of bodies) {
      const sent = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, body);
      const received = receiver.unprotect(sent.envelope);
      records.push({
        innerBody: b(body),
        envelope: b(sent.envelope),
        envelopeBytes: sent.envelopeBytes,
        position: seq({ epoch: sent.epoch, counter: sent.counter }),
        aad: b(
          e2eeEnvelopeAad({
            header: sent.envelope.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
            sessionBindingHash: trace.sessionBindingHash,
            direction: sendDirection,
          }),
        ),
        received: unprotectResultJson(received),
      });
    }
    cases.push({
      name: `envelopes-at-counters-zero-and-one-${name}`,
      sections: ["9.1", "9.2", "9.3"],
      inputs: {
        sendDirection,
        aeadKey: b(
          sendDirection === E2EE_DIRECTION_CLIENT_TO_NODE ? trace.aeadKeyC2N : trace.aeadKeyN2C,
        ),
        sessionBindingHash: b(trace.sessionBindingHash),
      },
      expected: {
        records,
        senderNextSend: directionStateJson(sender.sendState),
        receiverExpectedNext: directionStateJson(receiver.receiveState),
      },
    });
    sender.erase();
    receiver.erase();
  }

  // ── a control record consuming the shared sequence ───────────────────────
  {
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
    const rpcBody = utf8.encode("application");
    const rpc = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, rpcBody);
    const rpcReceived = receiver.unprotect(rpc.envelope);
    const closeBody = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE,
      senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
      sessionBindingHash: trace.sessionBindingHash,
      finalSend: { epoch: 0n, counter: 1n },
      expectedRecv: { epoch: 0n, counter: 0n },
    });
    const control = await protectOrThrow(sender, E2EE_INNER_TYPE_CLOSE, closeBody);
    const controlReceived = receiver.unprotect(control.envelope);
    cases.push({
      name: "control-record-consumes-the-shared-sequence",
      sections: ["4.1", "9.1", "9.4"],
      note: "§4.1 defines no second nonce space: an `E2EEClose` takes the next `(epoch, counter)` of the same directional sequence an RPC record would have taken, and counts toward both §9.4 thresholds.",
      inputs: {
        firstRecord: { innerType: E2EE_INNER_TYPE_RPC, body: b(rpcBody) },
        secondRecord: { innerType: E2EE_INNER_TYPE_CLOSE, body: b(closeBody) },
      },
      expected: {
        firstEnvelope: b(rpc.envelope),
        firstPosition: seq({ epoch: rpc.epoch, counter: rpc.counter }),
        firstReceived: unprotectResultJson(rpcReceived),
        secondEnvelope: b(control.envelope),
        secondPosition: seq({ epoch: control.epoch, counter: control.counter }),
        secondReceived: unprotectResultJson(controlReceived),
        senderNextSend: directionStateJson(sender.sendState),
        controlRecordCountedTowardTheEpoch: sender.sendState.epochRecords === 2,
      },
    });
    sender.erase();
    receiver.erase();
  }

  // ── tampering ────────────────────────────────────────────────────────────
  //
  // §4.3 orders the receive checks: length, then `version`, then `suite`, all
  // before an AEAD is selected, then the §9.2 sequence comparison before
  // decryption, and only then the AEAD. A tampered HEADER byte is therefore
  // caught by the comparison its field belongs to and the ciphertext is never
  // decrypted, which is stronger than an authentication failure and is what the
  // corpus records; a tampered CIPHERTEXT or TAG byte is the AEAD failure.
  const tamperTargets: readonly {
    readonly name: string;
    readonly index: number;
    readonly field: string;
    readonly sections: readonly string[];
  }[] = [
    { name: "version", index: 1, field: "version", sections: ["4.3", "9.1", "11.3 Q1"] },
    { name: "suite", index: 2, field: "suite", sections: ["4.3", "9.1", "11.3 Q1"] },
    { name: "epoch", index: 3, field: "epoch", sections: ["9.2", "11.3 Q2"] },
    { name: "counter", index: 10, field: "counter", sections: ["9.2", "11.3 Q2"] },
  ];
  for (const target of tamperTargets) {
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
    const sent = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, utf8.encode("tamper-me"));
    const tampered = flipBit(sent.envelope, target.index);
    cases.push({
      name: `tampered-header-${target.name}-byte`,
      sections: target.sections,
      note: "The header is inside the AAD, so a tamper would also fail authentication — but §4.3's ordering means the field's own comparison fires first and the ciphertext is never decrypted.",
      inputs: {
        envelope: b(sent.envelope),
        tamperedByteIndex: target.index,
        tamperedField: target.field,
        tamperedEnvelope: b(tampered),
      },
      expected: {
        received: unprotectResultJson(receiver.unprotect(tampered)),
        ciphertextDecrypted: false,
        disposition: "FATAL-POST",
      },
    });
    sender.erase();
    receiver.erase();
  }

  for (const [name, offset, sections] of [
    ["tampered-ciphertext-byte", E2EE_ENVELOPE_HEADER_BYTES, ["9.1", "11.3 Q3"]],
    ["tampered-aead-tag-byte", -1, ["9.1", "11.3 Q3"]],
  ] as const) {
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
    const sent = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, utf8.encode("tamper-me"));
    const index = offset < 0 ? sent.envelope.byteLength + offset : offset;
    const tampered = flipBit(sent.envelope, index);
    cases.push({
      name,
      sections,
      inputs: {
        envelope: b(sent.envelope),
        tamperedByteIndex: index,
        tamperedEnvelope: b(tampered),
      },
      expected: {
        received: unprotectResultJson(receiver.unprotect(tampered)),
        disposition: "FATAL-POST",
      },
    });
    sender.erase();
    receiver.erase();
  }

  // ── a wrong direction label ──────────────────────────────────────────────
  {
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const sent = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, utf8.encode("direction"));
    // The receiver below expects `n2c` on its receive direction, so it builds the
    // AAD with the `n2c` label; its AEAD key is pinned to the SENDER's, so the
    // label is the only difference between the two §9.1 invocations.
    const mislabelled = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
      aeadFactory: fixedKeyAeadFactory(trace.aeadKeyC2N),
    });
    const senderAad = e2eeEnvelopeAad({
      header: sent.envelope.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
      sessionBindingHash: trace.sessionBindingHash,
      direction: E2EE_DIRECTION_CLIENT_TO_NODE,
    });
    const receiverAad = e2eeEnvelopeAad({
      header: sent.envelope.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
      sessionBindingHash: trace.sessionBindingHash,
      direction: E2EE_DIRECTION_NODE_TO_CLIENT,
    });
    cases.push({
      name: "wrong-direction-label-fails-authentication",
      sections: ["3.4", "9.1", "11.3 Q3"],
      note: "The direction label is bound TWICE — in the AAD (§9.1) and in the §9.4 key derivation — so an ordinary cross-direction delivery differs in two places at once and proves nothing about either. Here the receiver's AEAD key is pinned to the sender's through the session's own test hook, so the ONLY difference is the label, and the authentication failure is attributable to it alone.",
      inputs: {
        envelope: b(sent.envelope),
        senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
        receiverDirectionLabelUsed: E2EE_DIRECTION_NODE_TO_CLIENT,
        testOnlyPinnedAeadKey: b(trace.aeadKeyC2N),
      },
      expected: {
        senderAad: b(senderAad),
        receiverAad: b(receiverAad),
        aadsDifferOnlyInTheTrailingLabel:
          hex(senderAad.subarray(0, senderAad.byteLength - E2EE_DIRECTION_LABEL_BYTES)) ===
          hex(receiverAad.subarray(0, receiverAad.byteLength - E2EE_DIRECTION_LABEL_BYTES)),
        received: unprotectResultJson(mislabelled.unprotect(sent.envelope)),
        aeadKeysAlsoDifferByDirection:
          hex(deriveE2eeAeadKey(trace.epochSecretC2N, E2EE_DIRECTION_CLIENT_TO_NODE)) !==
          hex(deriveE2eeAeadKey(trace.epochSecretC2N, E2EE_DIRECTION_NODE_TO_CLIENT)),
        disposition: "FATAL-POST",
      },
    });
    sender.erase();
    mislabelled.erase();
  }

  // ── a wrong `sessionBindingHash` ─────────────────────────────────────────
  {
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const sent = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, utf8.encode("binding"));
    const otherBinding = flipBit(trace.sessionBindingHash, 0);
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
      sessionBindingHash: otherBinding,
    });
    cases.push({
      name: "wrong-session-binding-hash-fails-authentication",
      sections: ["3.3", "8.8 step 6", "9.1", "11.3 Q3"],
      note: "The receiver differs from the sender in one bit of `sessionBindingHash` and in nothing else — same suite, same keys, same position. This is what binds every protected record to the exact handshake wire bytes the two ends exchanged.",
      inputs: {
        envelope: b(sent.envelope),
        senderSessionBindingHash: b(trace.sessionBindingHash),
        receiverSessionBindingHash: b(otherBinding),
      },
      expected: {
        received: unprotectResultJson(receiver.unprotect(sent.envelope)),
        disposition: "FATAL-POST",
      },
    });
    sender.erase();
    receiver.erase();
  }

  return {
    file: "f08-record-protection.json",
    number: 8,
    title: "Record protection",
    sections: ["9.1", "9.2", "9.3", "16.3 F8"],
    summary:
      "The §9.1 AEAD invocation as data: the exact AAD bytes and nonce in both directions, envelopes at counters zero and one in both directions, a control record taking the next pair of the same directional sequence, and the four tampering cases — a header byte of each field, a ciphertext byte, an AEAD tag byte, the direction label, and `sessionBindingHash`.",
    deferred: [crossRuntimeDeferral(8)],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F9 — rekey boundaries (§9.4–§9.6) ───────────────────────────────────────

/**
 * The §9.6 terminal-epoch synthetic state that leaves exactly `records`
 * protectable records in a direction. TEST AND FIXTURE USE ONLY: no reachable
 * amount of traffic produces it, which is precisely why §16.3 F9 requires it.
 */
function terminalEpochState(records: number): E2eeSyntheticDirectionState {
  const used = E2EE_REKEY_MAX_RECORDS - records;
  return {
    epoch: E2EE_EPOCH_MAX,
    counter: BigInt(used),
    epochRecords: used,
    epochBytes: 0,
  };
}

/**
 * The OTHER §9.6 exhaustion state: a live epoch whose COUNTER stands `records`
 * short of `E2EE_COUNTER_MAX`. §9.6's first sentence names two ways a direction's
 * sequence space ends — "reaching `E2EE_COUNTER_MAX` within an epoch, or
 * completing epoch `E2EE_EPOCH_MAX`" — and `terminalEpochState` above produces
 * only the second.
 *
 * The epoch is deliberately NOT `E2EE_EPOCH_MAX` and the epoch's own §9.4 usage
 * is zero, so nothing about this state completes an epoch: the direction ends
 * because the counter reaches its ceiling and for no other reason. That is also
 * why the state has to be synthetic — `E2EE_REKEY_MAX_RECORDS` completes an epoch
 * long before a counter that starts at 0 could climb to 2^64 − 1, so no reachable
 * traffic ever exercises this branch, and §16.3 F9 asks for it precisely because
 * an implementation that wrapped here would never be caught by ordinary traffic.
 */
function counterExhaustionState(records: number): E2eeSyntheticDirectionState {
  return {
    epoch: 0n,
    counter: E2EE_COUNTER_MAX - BigInt(records - 1),
    epochRecords: 0,
    epochBytes: 0,
  };
}

/**
 * How many of a close trace's records reached a §9.4 threshold. DERIVED from the
 * emitted records rather than asserted, so the counter-exhaustion cases can show
 * that no epoch completed anywhere in them — the whole point of that state.
 */
function countEpochCompletions(records: readonly JsonValue[]): number {
  return records.filter(
    (record) => (record as { readonly epochCompleted?: boolean }).epochCompleted === true,
  ).length;
}

/** Both endpoints of a close phase: a §9 session and a §10 machine. */
interface CloseEndpoint {
  readonly session: E2eeRecordSession;
  readonly machine: E2eeCloseMachine;
  /**
   * The positions the §10 driver hands the machine. They track the session's own
   * state and FREEZE at the last position a direction held once §9.6 exhaustion
   * leaves it with no next position at all. The machine still needs an argument
   * there — the passed-through rule takes one unconditionally — and in that state
   * no further record can ever be sent or authenticated in that direction, so the
   * frozen value is the greatest position it ever held and the comparison stays
   * conservative.
   */
  nextSend: E2eeSequencePosition;
  expectedRecv: E2eeSequencePosition;
}

function closeEndpoint(
  trace: HandshakeTrace,
  sendDirection: E2eeDirection,
  synthetic?: {
    readonly send?: E2eeSyntheticDirectionState;
    readonly receive?: E2eeSyntheticDirectionState;
  },
): CloseEndpoint {
  const session = traceSession(trace, sendDirection, synthetic);
  return {
    session,
    machine: new E2eeCloseMachine({
      sessionBindingHash: trace.sessionBindingHash,
      sendDirection,
    }),
    nextSend: currentPosition(session.sendState),
    expectedRecv: currentPosition(session.receiveState),
  };
}

/** Refresh an endpoint's tracked positions, keeping the frozen ones on exhaustion. */
function refreshPositions(endpoint: CloseEndpoint): CloseEndpoint {
  const send = endpoint.session.sendState;
  const receive = endpoint.session.receiveState;
  if (send.epoch !== undefined && send.counter !== undefined) {
    endpoint.nextSend = { epoch: send.epoch, counter: send.counter };
  }
  if (receive.epoch !== undefined && receive.counter !== undefined) {
    endpoint.expectedRecv = { epoch: receive.epoch, counter: receive.counter };
  }
  return endpoint;
}

function currentPosition(state: E2eeDirectionState): E2eeSequencePosition {
  if (state.epoch === undefined || state.counter === undefined) {
    throw new Error("Fixture close endpoint has no position: the direction is exhausted.");
  }
  return { epoch: state.epoch, counter: state.counter };
}

/** Build, protect, and commit one close-machine record (§10.1, §10.2, §10.1.1). */
async function sendCloseRecord(
  endpoint: CloseEndpoint,
  kind: "close" | "close_ack",
  at: number,
  overrides?: { readonly expectedRecv?: E2eeSequencePosition },
): Promise<{
  readonly record: E2eeCloseRecordToSend;
  readonly envelope: Uint8Array;
  readonly epoch: bigint;
  readonly counter: bigint;
  readonly epochCompleted: boolean;
}> {
  refreshPositions(endpoint);
  const sendPosition = endpoint.nextSend;
  const expectedRecv =
    overrides?.expectedRecv ?? endpoint.machine.ackExpectedRecv ?? endpoint.expectedRecv;
  const record =
    kind === "close"
      ? endpoint.machine.buildClose({ sendPosition, expectedRecv })
      : endpoint.machine.buildCloseAck({ sendPosition, expectedRecv });
  const sent = await protectOrThrow(endpoint.session, record.innerType, record.body);
  endpoint.machine.noteTransmitted({
    record,
    epoch: sent.epoch,
    counter: sent.counter,
    epochCompleted: sent.epochCompleted,
    at,
  });
  refreshPositions(endpoint);
  return {
    record,
    envelope: sent.envelope,
    epoch: sent.epoch,
    counter: sent.counter,
    epochCompleted: sent.epochCompleted,
  };
}

/** Authenticate one envelope and run it through the close machine (§4.3 step 3, §10.2). */
function deliverToClose(
  endpoint: CloseEndpoint,
  envelope: Uint8Array,
  at: number,
): {
  readonly unprotected: E2eeUnprotectResult;
  readonly close: E2eeCloseReceiveResult | undefined;
} {
  refreshPositions(endpoint);
  const unprotected = endpoint.session.unprotect(envelope);
  if (unprotected.kind !== "authenticated") return { unprotected, close: undefined };
  const close = endpoint.machine.receive({
    innerType: unprotected.innerType,
    body: unprotected.body,
    envelope: { epoch: unprotected.epoch, counter: unprotected.counter },
    epochCompleted: unprotected.epochCompleted,
    currentNextSend: endpoint.nextSend,
    at,
  });
  refreshPositions(endpoint);
  return { unprotected, close };
}

function closeReceiveJson(result: E2eeCloseReceiveResult | undefined): JsonValue {
  if (result === undefined) return null;
  switch (result.kind) {
    case "application":
      return { kind: "application" };
    case "close":
      return {
        kind: "close",
        branch: result.branch,
        finalSend: seq(result.value.finalSend),
        expectedRecv: seq(result.value.expectedRecv),
      };
    case "close_ack":
      return {
        kind: "close_ack",
        exchangeComplete: result.exchangeComplete,
        finalSend: seq(result.value.finalSend),
        expectedRecv: seq(result.value.expectedRecv),
      };
    case "terminal_error":
      return { kind: "terminal_error", errorCode: result.value.errorCode };
    case "fatal":
      return {
        kind: "fatal",
        row: result.row,
        reason: result.reason,
        ...(result.decodeError === undefined ? {} : { decodeError: result.decodeError }),
      };
  }
}

function closeRecordJson(
  built: {
    readonly record: E2eeCloseRecordToSend;
    readonly envelope: Uint8Array;
    readonly epoch: bigint;
    readonly counter: bigint;
    readonly epochCompleted: boolean;
  },
  declaredExpectedRecv: E2eeSequencePosition,
  sessionBindingHash: Uint8Array,
  senderDirection: E2eeDirection,
): JsonValue {
  const commitmentInput: E2eeCloseCommitmentInput = {
    innerType: built.record.innerType,
    senderDirection,
    sessionBindingHash,
    finalSend: built.record.position,
    expectedRecv: declaredExpectedRecv,
  };
  return {
    purpose: built.record.purpose,
    innerType: built.record.innerType,
    senderDirection,
    position: seq({ epoch: built.epoch, counter: built.counter }),
    declaredFinalSend: seq(built.record.position),
    declaredExpectedRecv: seq(declaredExpectedRecv),
    commitmentPreimage: b(encodeE2eeCloseCommitmentPreimage(commitmentInput)),
    closeCommitment: b(e2eeCloseCommitment(commitmentInput)),
    body: b(built.record.body),
    bodyBytes: built.record.body.byteLength,
    envelope: b(built.envelope),
    envelopeBytes: built.envelope.byteLength,
    epochCompleted: built.epochCompleted,
  };
}

/**
 * The per-step state trace of the close machine, DELETED from F9 and F11 and
 * declared instead.
 *
 * Both families used to carry an `expected.steps` array — each endpoint's state,
 * branch, anchor, pending record, armed waits and verdict after every record of
 * the exchange. A read-liveness sweep of the whole corpus found that no
 * consuming suite touched a single one of its 397 leaves: the arrays could have
 * stated any transition at all, or the reverse of the real one, and no test in
 * this repository would have moved. That is the shape §16.3's ledger exists to
 * make impossible, so the blocks were removed rather than left reading as
 * coverage that nothing checks.
 *
 * Asserting them would need a CONSUMER-side derivation harness that drives
 * `E2eeCloseMachine` and `E2eeRecordSession` through both §10.2 branches and
 * both §9.6 exhaustion states, which is per-family work this round did not take
 * on. Everything the two families state about the RECORDS — bodies, commitment
 * preimages, commitments, declared positions, anchors, and both endpoints'
 * verdicts — is still generated and still asserted by the consuming suite.
 */
const CLOSE_STEP_TRACE_DEFERRAL =
  "The per-step state trace of the §10.2 close machine — each endpoint's state, branch, close anchor, pending record, armed waits, and verdict after every record of the exchange — is NOT carried. It was carried, as an `expected.steps` block, until a read-liveness sweep showed that no consuming suite read any of its leaves: the block could have stated any transition at all and failed nothing, so it was deleted rather than left reading as coverage. Asserting it needs a consumer-side derivation harness driving `E2eeCloseMachine` and `E2eeRecordSession` through both §10.2 branches and the §9.6 exhaustion states; every record-level value the cases state — bodies, commitment preimages, commitments, declared positions, anchors, and both verdicts — is still generated and still asserted. Owned by the close-machine derivation harness, tracked as residual work for this family in the manifest's `livenessCensus`.";

/**
 * The complete sequential close of §10.2, driven through both endpoints'
 * machines and sessions. Returns every record with its declared fields, its
 * commitment, and both endpoints' verdicts.
 */
async function runSequentialClose(
  trace: HandshakeTrace,
  synthetic?: {
    readonly initiator?: { readonly send?: E2eeSyntheticDirectionState };
    readonly responder?: { readonly send?: E2eeSyntheticDirectionState };
  },
): Promise<{
  readonly initiator: CloseEndpoint;
  readonly responder: CloseEndpoint;
  readonly records: readonly JsonValue[];
}> {
  const initiatorSend = synthetic?.initiator?.send;
  const responderSend = synthetic?.responder?.send;
  const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
    ...(initiatorSend === undefined ? {} : { send: initiatorSend }),
    ...(responderSend === undefined ? {} : { receive: responderSend }),
  });
  const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
    ...(responderSend === undefined ? {} : { send: responderSend }),
    ...(initiatorSend === undefined ? {} : { receive: initiatorSend }),
  });

  const records: JsonValue[] = [];

  const closeExpectedRecv = refreshPositions(initiator).expectedRecv;
  const close = await sendCloseRecord(initiator, "close", NOW);
  records.push(
    closeRecordJson(
      close,
      closeExpectedRecv,
      trace.sessionBindingHash,
      E2EE_DIRECTION_CLIENT_TO_NODE,
    ),
  );

  deliverToClose(responder, close.envelope, NOW);

  const ackExpectedRecv = responder.machine.ackExpectedRecv!;
  const ack = await sendCloseRecord(responder, "close_ack", NOW);
  records.push(
    closeRecordJson(ack, ackExpectedRecv, trace.sessionBindingHash, E2EE_DIRECTION_NODE_TO_CLIENT),
  );

  deliverToClose(initiator, ack.envelope, NOW);

  const finalExpectedRecv = refreshPositions(initiator).expectedRecv;
  const final = await sendCloseRecord(initiator, "close_ack", NOW, {
    expectedRecv: finalExpectedRecv,
  });
  records.push(
    closeRecordJson(
      final,
      finalExpectedRecv,
      trace.sessionBindingHash,
      E2EE_DIRECTION_CLIENT_TO_NODE,
    ),
  );

  deliverToClose(responder, final.envelope, NOW);

  return { initiator, responder, records };
}

/** A synthetic state that resumes a direction exactly where a live one stands. */
function mirrorState(state: E2eeDirectionState): E2eeSyntheticDirectionState {
  const position = currentPosition(state);
  return {
    epoch: position.epoch,
    counter: position.counter,
    epochRecords: state.epochRecords,
    epochBytes: state.epochBytes,
  };
}

/**
 * The §10.2 simultaneous branch: each side sends `E2EEClose`, validates the
 * peer's under the passed-through rule, answers with `E2EECloseAck` computed
 * after processing that close, and completes when the peer's ack validates
 * against its own §10.1.1 anchor. Four records, no final-confirmation step.
 *
 * `ackOverride` replaces one side's ack body with peer-supplied bytes, which is
 * how the negative cases of §16.3 F11 separate the two candidate readings of the
 * strict rule.
 */
async function runSimultaneousClose(
  trace: HandshakeTrace,
  options: {
    readonly initiatorSend?: E2eeSyntheticDirectionState;
    readonly responderSend?: E2eeSyntheticDirectionState;
    /** Bytes the responder's ack declares instead of its conforming value. */
    readonly responderAckExpectedRecvOverride?: E2eeSequencePosition;
  } = {},
): Promise<{
  readonly initiator: CloseEndpoint;
  readonly responder: CloseEndpoint;
  readonly records: readonly JsonValue[];
}> {
  const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
    ...(options.initiatorSend === undefined ? {} : { send: options.initiatorSend }),
    ...(options.responderSend === undefined ? {} : { receive: options.responderSend }),
  });
  const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
    ...(options.responderSend === undefined ? {} : { send: options.responderSend }),
    ...(options.initiatorSend === undefined ? {} : { receive: options.initiatorSend }),
  });
  const records: JsonValue[] = [];

  const initiatorCloseExpectedRecv = refreshPositions(initiator).expectedRecv;
  const initiatorClose = await sendCloseRecord(initiator, "close", NOW);
  records.push(
    closeRecordJson(
      initiatorClose,
      initiatorCloseExpectedRecv,
      trace.sessionBindingHash,
      E2EE_DIRECTION_CLIENT_TO_NODE,
    ),
  );
  const responderCloseExpectedRecv = refreshPositions(responder).expectedRecv;
  const responderClose = await sendCloseRecord(responder, "close", NOW);
  records.push(
    closeRecordJson(
      responderClose,
      responderCloseExpectedRecv,
      trace.sessionBindingHash,
      E2EE_DIRECTION_NODE_TO_CLIENT,
    ),
  );

  deliverToClose(initiator, responderClose.envelope, NOW);
  deliverToClose(responder, initiatorClose.envelope, NOW);

  const initiatorAckExpectedRecv = initiator.machine.ackExpectedRecv!;
  const initiatorAck = await sendCloseRecord(initiator, "close_ack", NOW);
  records.push(
    closeRecordJson(
      initiatorAck,
      initiatorAckExpectedRecv,
      trace.sessionBindingHash,
      E2EE_DIRECTION_CLIENT_TO_NODE,
    ),
  );

  let responderAck: {
    readonly envelope: Uint8Array;
    readonly declared: E2eeSequencePosition;
    readonly position: E2eeSequencePosition;
  };
  if (options.responderAckExpectedRecvOverride === undefined) {
    const declared = responder.machine.ackExpectedRecv!;
    const sent = await sendCloseRecord(responder, "close_ack", NOW);
    records.push(
      closeRecordJson(sent, declared, trace.sessionBindingHash, E2EE_DIRECTION_NODE_TO_CLIENT),
    );
    responderAck = {
      envelope: sent.envelope,
      declared,
      position: { epoch: sent.epoch, counter: sent.counter },
    };
  } else {
    // A record the conforming machine REFUSES TO BUILD: `buildCloseAck` rejects
    // any declaration other than the expected-next as of the peer's close. It is
    // assembled through the §10.1 body encoder and protected as an ordinary
    // control record, which is exactly what a non-conforming peer would put on
    // the wire.
    const position = refreshPositions(responder).nextSend;
    const declared = options.responderAckExpectedRecvOverride;
    const body = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
      sessionBindingHash: trace.sessionBindingHash,
      finalSend: position,
      expectedRecv: declared,
    });
    const sent = await protectOrThrow(responder.session, E2EE_INNER_TYPE_CLOSE_ACK, body);
    records.push({
      purpose: "close_ack",
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
      nonConforming: true,
      position: seq({ epoch: sent.epoch, counter: sent.counter }),
      declaredFinalSend: seq(position),
      declaredExpectedRecv: seq(declared),
      body: b(body),
      envelope: b(sent.envelope),
      envelopeBytes: sent.envelopeBytes,
    });
    responderAck = { envelope: sent.envelope, declared, position };
  }

  deliverToClose(initiator, responderAck.envelope, NOW);
  deliverToClose(responder, initiatorAck.envelope, NOW);

  return { initiator, responder, records };
}

async function buildFamily9(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];
  const trace = IK_TRACE;

  // ── the epoch key schedule, epochs 0 through 2, both directions ──────────
  for (const [name, direction, epochZeroSecret] of [
    ["client-to-node", E2EE_DIRECTION_CLIENT_TO_NODE, trace.epochSecretC2N],
    ["node-to-client", E2EE_DIRECTION_NODE_TO_CLIENT, trace.epochSecretN2C],
  ] as const) {
    const epochs: JsonValue[] = [];
    let epochSecret = copyOf(epochZeroSecret);
    for (let epoch = 0; epoch <= 2; epoch += 1) {
      const derived = deriveE2eeEpochKeys(epochSecret, direction);
      epochs.push({
        epoch,
        epochSecret: b(epochSecret),
        aeadKey: b(derived.aeadKey),
        nextEpochSecret: b(derived.nextEpochSecret),
      });
      epochSecret = derived.nextEpochSecret;
    }
    cases.push({
      name: `epoch-key-schedule-${name}`,
      sections: ["6.5", "9.4"],
      note: "`epochSecret_d[0]` is the `Split()` output of the F6 handshake. Both direction schedules are always derived at both endpoints regardless of traffic volume, so `aeadKey_d[0]` exists from the moment the session does on the direction an endpoint never sends on.",
      inputs: {
        direction,
        directionLabel: b(encodeE2eeDirectionLabel(direction)),
        epochSecretZero: b(epochZeroSecret),
        aeadKeyLabel: E2EE_AEAD_KEY_LABEL,
        ratchetLabel: E2EE_RATCHET_LABEL,
      },
      expected: { epochs },
    });
  }

  // ── the record-count threshold ───────────────────────────────────────────
  {
    const start = E2EE_REKEY_MAX_RECORDS - 1;
    const synthetic: E2eeSyntheticDirectionState = {
      epoch: 0n,
      counter: BigInt(start),
      epochRecords: start,
      epochBytes: 0,
    };
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE, { send: synthetic });
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT, { receive: synthetic });
    const boundary = await protectOrThrow(
      sender,
      E2EE_INNER_TYPE_RPC,
      utf8.encode("last-of-the-epoch"),
    );
    const boundaryReceived = receiver.unprotect(boundary.envelope);
    const successor = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, utf8.encode("first-of-e1"));
    const successorReceived = receiver.unprotect(successor.envelope);
    cases.push({
      name: "record-count-threshold-boundary",
      sections: ["9.4", "9.2"],
      note: "The record that REACHES the threshold is the last of its epoch, so the boundary record still carries epoch `e`; its successor carries `e + 1` and counter 0. The receiver's expectation advances by the same rule, which is why the boundary needs no signaling. The starting position is synthetic (§16.3 F9) because no reachable amount of test traffic produces it.",
      inputs: {
        rekeyMaxRecords: E2EE_REKEY_MAX_RECORDS,
        syntheticStart: {
          epoch: 0,
          counter: start,
          epochRecords: start,
          epochBytes: 0,
        },
      },
      expected: {
        boundaryRecord: {
          position: seq({ epoch: boundary.epoch, counter: boundary.counter }),
          epochCompleted: boundary.epochCompleted,
          received: unprotectResultJson(boundaryReceived),
        },
        successorRecord: {
          position: seq({ epoch: successor.epoch, counter: successor.counter }),
          epochCompleted: successor.epochCompleted,
          received: unprotectResultJson(successorReceived),
        },
        senderStateAfter: directionStateJson(sender.sendState),
        receiverStateAfter: directionStateJson(receiver.receiveState),
        counterNeverExceedsRekeyMaxRecordsMinusOne: start === E2EE_REKEY_MAX_RECORDS - 1,
      },
    });
    sender.erase();
    receiver.erase();
  }

  // ── the byte threshold ───────────────────────────────────────────────────
  {
    const remaining = 8;
    const synthetic: E2eeSyntheticDirectionState = {
      epoch: 0n,
      counter: 3n,
      epochRecords: 3,
      epochBytes: E2EE_REKEY_MAX_BYTES - remaining,
    };
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE, { send: synthetic });
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT, { receive: synthetic });
    const crossing = await protectOrThrow(
      sender,
      E2EE_INNER_TYPE_RPC,
      new Uint8Array(32).fill(0x7a),
    );
    const crossingReceived = receiver.unprotect(crossing.envelope);
    const successor = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, utf8.encode("first-of-e1"));
    const successorReceived = receiver.unprotect(successor.envelope);
    cases.push({
      name: "byte-threshold-crossing",
      sections: ["9.4", "9.2"],
      note: "The byte counter increases by the AUTHENTICATED INNER PLAINTEXT — the type byte plus the body — and the epoch is complete when it REACHES OR EXCEEDS `E2EE_REKEY_MAX_BYTES`. The crossing record is the last of its epoch, exactly as the record threshold's boundary record is.",
      inputs: {
        rekeyMaxBytes: E2EE_REKEY_MAX_BYTES,
        syntheticStart: {
          epoch: 0,
          counter: 3,
          epochRecords: 3,
          epochBytes: E2EE_REKEY_MAX_BYTES - remaining,
        },
        bodyBytes: 32,
      },
      expected: {
        crossingRecord: {
          position: seq({ epoch: crossing.epoch, counter: crossing.counter }),
          plaintextBytes: crossing.plaintextBytes,
          epochCompleted: crossing.epochCompleted,
          received: unprotectResultJson(crossingReceived),
        },
        successorRecord: {
          position: seq({ epoch: successor.epoch, counter: successor.counter }),
          epochCompleted: successor.epochCompleted,
          received: unprotectResultJson(successorReceived),
        },
        senderStateAfter: directionStateJson(sender.sendState),
        receiverStateAfter: directionStateJson(receiver.receiveState),
      },
    });
    sender.erase();
    receiver.erase();
  }

  // ── early, late, and skipped epoch transitions ───────────────────────────
  const transitionCases: readonly {
    readonly name: string;
    readonly note: string;
    readonly senderState: E2eeSyntheticDirectionState;
    readonly receiverState: E2eeSyntheticDirectionState;
  }[] = [
    {
      name: "early-epoch-transition",
      note: "The sender entered epoch 1 before its epoch-0 thresholds were reached; the receiver still expects `(0, 5)`.",
      senderState: { epoch: 1n, counter: 0n, epochRecords: 0, epochBytes: 0 },
      receiverState: { epoch: 0n, counter: 5n, epochRecords: 5, epochBytes: 0 },
    },
    {
      name: "late-epoch-transition",
      note: "The sender protected a further record in an epoch its own thresholds had already completed; the receiver has advanced to `(1, 0)`.",
      senderState: { epoch: 0n, counter: 12n, epochRecords: 12, epochBytes: 0 },
      receiverState: { epoch: 1n, counter: 0n, epochRecords: 0, epochBytes: 0 },
    },
    {
      name: "skipped-epoch-transition",
      note: "The sender jumped from epoch 0 to epoch 2; §9.2 accepts an epoch transition only as exactly +1 with counter 0.",
      senderState: { epoch: 2n, counter: 0n, epochRecords: 0, epochBytes: 0 },
      receiverState: { epoch: 1n, counter: 0n, epochRecords: 0, epochBytes: 0 },
    },
  ];
  for (const transition of transitionCases) {
    const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
      send: transition.senderState,
    });
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
      receive: transition.receiverState,
    });
    const sent = await protectOrThrow(sender, E2EE_INNER_TYPE_RPC, utf8.encode("out-of-sequence"));
    cases.push({
      name: transition.name,
      sections: ["9.2", "9.4", "11.3 Q2"],
      note: `${transition.note} A gap, a repeat, a regression, and an early, late, or skipped rekey are ALL THE SAME COMPARISON, because the receiver's expectation already encodes the §9.4 boundary — and the comparison runs before decryption, so the ciphertext is never decrypted.`,
      inputs: {
        senderPosition: seq({
          epoch: transition.senderState.epoch!,
          counter: transition.senderState.counter!,
        }),
        receiverExpectedNext: seq({
          epoch: transition.receiverState.epoch!,
          counter: transition.receiverState.counter!,
        }),
        envelope: b(sent.envelope),
      },
      expected: {
        received: unprotectResultJson(receiver.unprotect(sent.envelope)),
        ciphertextDecrypted: false,
        disposition: "FATAL-POST",
        attributable: false,
      },
    });
    sender.erase();
    receiver.erase();
  }

  // ── the §9.6 post-application reserve, and the close out of it ───────────
  cases.push({
    name: "post-application-reserve-composition",
    sections: ["9.6", "10.1", "11.3"],
    note: "The reserve is computed from the §10.1 body and the §11.3 body bound through the pinned codec, never written out by hand, so a change to either cannot silently leave the accounting behind.",
    inputs: {
      closeRecordsReserved: E2EE_CLOSE_RECORDS_RESERVED,
      errorRecordsReserved: E2EE_ERROR_RECORDS_RESERVED,
    },
    expected: {
      closeRecordPlaintextBytes: E2EE_CLOSE_RECORD_PLAINTEXT_BYTES,
      errorRecordPlaintextMaxBytes: E2EE_ERROR_RECORD_PLAINTEXT_MAX_BYTES,
      postApplicationReserveRecords: E2EE_POST_APPLICATION_RESERVE_RECORDS,
      postApplicationReservePlaintextBytes: [...E2EE_POST_APPLICATION_RESERVE_PLAINTEXT_BYTES],
      reserveRecordsMatchTheTwoHalves:
        E2EE_POST_APPLICATION_RESERVE_RECORDS ===
        E2EE_CLOSE_RECORDS_RESERVED + E2EE_ERROR_RECORDS_RESERVED,
    },
  });

  {
    const initiatorSend = terminalEpochState(E2EE_CLOSE_RECORDS_RESERVED);
    const responderSend = terminalEpochState(E2EE_CLOSE_RECORDS_RESERVED);
    const startRecords = E2EE_REKEY_MAX_RECORDS - E2EE_CLOSE_RECORDS_RESERVED;
    const sequential = await runSequentialClose(trace, {
      initiator: { send: initiatorSend },
      responder: { send: responderSend },
    });
    cases.push({
      name: "terminal-epoch-sequential-close-out-of-the-close-reserve",
      sections: ["9.6", "10.2", "10.1.1"],
      note: "Both endpoints start in epoch `E2EE_EPOCH_MAX` with exactly `E2EE_CLOSE_RECORDS_RESERVED` protectable records left. The initiator spends both (its `E2EEClose` and its final confirmation); the sequential responder spends ONE and leaves the remainder of its reserve unused, which is the intended slack §9.6 names. The synthetic state is not ratcheted, so both endpoints are constructed from the same secrets and the same synthetic position.",
      inputs: {
        epoch: safeNumber(E2EE_EPOCH_MAX),
        closeRecordsReserved: E2EE_CLOSE_RECORDS_RESERVED,
        initiatorSyntheticStart: {
          epoch: safeNumber(initiatorSend.epoch!),
          counter: safeNumber(initiatorSend.counter!),
          epochRecords: initiatorSend.epochRecords!,
        },
        responderSyntheticStart: {
          epoch: safeNumber(responderSend.epoch!),
          counter: safeNumber(responderSend.counter!),
          epochRecords: responderSend.epochRecords!,
        },
      },
      expected: {
        records: [...sequential.records],
        initiatorCloseRecordsSent: sequential.initiator.machine.closeRecordsSent,
        responderCloseRecordsSent: sequential.responder.machine.closeRecordsSent,
        initiatorRecordsSpent: sequential.initiator.session.sendState.epochRecords - startRecords,
        responderRecordsSpent: sequential.responder.session.sendState.epochRecords - startRecords,
        initiatorVerdict: sequential.initiator.machine.verdict ?? null,
        responderVerdict: sequential.responder.machine.verdict ?? null,
        initiatorSendState: directionStateJson(sequential.initiator.session.sendState),
        responderSendState: directionStateJson(sequential.responder.session.sendState),
        wrapped: false,
        reused: false,
      },
    });
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  {
    const initiatorSend = terminalEpochState(E2EE_CLOSE_RECORDS_RESERVED);
    const responderSend = terminalEpochState(E2EE_CLOSE_RECORDS_RESERVED);
    const startRecords = E2EE_REKEY_MAX_RECORDS - E2EE_CLOSE_RECORDS_RESERVED;
    const simultaneous = await runSimultaneousClose(trace, { initiatorSend, responderSend });
    cases.push({
      name: "terminal-epoch-simultaneous-close-out-of-the-close-reserve",
      sections: ["9.6", "10.2", "10.1.1"],
      note: "Each side of a simultaneous close protects `E2EE_CLOSE_RECORDS_RESERVED` records — its `E2EEClose` and its `E2EECloseAck` — which is why §9.6 sizes the close half unconditionally in every role rather than to the responder's single record.",
      inputs: {
        epoch: safeNumber(E2EE_EPOCH_MAX),
        closeRecordsReserved: E2EE_CLOSE_RECORDS_RESERVED,
        syntheticStartCounter: safeNumber(initiatorSend.counter!),
      },
      expected: {
        records: [...simultaneous.records],
        initiatorRecordsSpent: simultaneous.initiator.session.sendState.epochRecords - startRecords,
        responderRecordsSpent: simultaneous.responder.session.sendState.epochRecords - startRecords,
        initiatorVerdict: simultaneous.initiator.machine.verdict ?? null,
        responderVerdict: simultaneous.responder.machine.verdict ?? null,
        wrapped: false,
        reused: false,
      },
    });
    simultaneous.initiator.session.erase();
    simultaneous.responder.session.erase();
  }

  // ── the counter-ceiling half of §9.6 exhaustion ──────────────────────────
  //
  // §9.6 names TWO ways a direction's sequence space ends. The two cases above
  // exercise the second (completing epoch `E2EE_EPOCH_MAX`); these two exercise
  // the first (reaching `E2EE_COUNTER_MAX` within an epoch), over the same three
  // §10.2 roles, so neither half of the sentence rests on the other.
  const COUNTER_EXHAUSTION_NOTE =
    "The state is synthetic in the counter alone: the epoch is 0, its §9.4 usage is zero, and no record here completes an epoch — the direction ends because the counter reaches `E2EE_COUNTER_MAX` and for no other reason. `E2EE_REKEY_MAX_RECORDS` completes an epoch long before a counter starting at 0 could climb to 2^64 − 1, so no reachable traffic reaches this branch, which is exactly why §16.3 F9 asks for the state. Note what the reserve predicate does and does not say here: §9.6 scopes the post-application reserve to the two §9.4 thresholds WITHIN epoch `E2EE_EPOCH_MAX`, so `postApplicationReserveHeld` is true in this state even though fewer than the reserve of positions remain before the ceiling. What §9.6 binds at a counter ceiling is the other rule — no wrap, no reuse, no continuation — and that is what this trace pins.";

  {
    const initiatorSend = counterExhaustionState(E2EE_CLOSE_RECORDS_RESERVED);
    const responderSend = counterExhaustionState(E2EE_CLOSE_RECORDS_RESERVED);
    const probe = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE, { send: initiatorSend });
    const reserveHeld = probe.postApplicationReserveHeld;
    probe.erase();
    const sequential = await runSequentialClose(trace, {
      initiator: { send: initiatorSend },
      responder: { send: responderSend },
    });
    cases.push({
      name: "counter-exhaustion-sequential-close-out-of-the-close-reserve",
      sections: ["9.6", "10.2", "10.1.1"],
      note: `Both endpoints stand exactly \`E2EE_CLOSE_RECORDS_RESERVED\` positions short of \`E2EE_COUNTER_MAX\` in a LIVE epoch. The initiator spends both (its \`E2EEClose\` and its final confirmation) and the direction is exhausted at the ceiling; the sequential responder spends ONE and leaves the remainder of its reserve unused, which is the same §9.6 slack the terminal-epoch case names. ${COUNTER_EXHAUSTION_NOTE}`,
      inputs: {
        exhaustionCause: "counter-ceiling",
        counterMax: E2EE_COUNTER_MAX.toString(10),
        epochMax: safeNumber(E2EE_EPOCH_MAX),
        closeRecordsReserved: E2EE_CLOSE_RECORDS_RESERVED,
        postApplicationReserveRecords: E2EE_POST_APPLICATION_RESERVE_RECORDS,
        positionsRemainingBeforeTheCeiling: E2EE_CLOSE_RECORDS_RESERVED,
        initiatorSyntheticStart: {
          epoch: sequenceValue(initiatorSend.epoch!),
          counter: sequenceValue(initiatorSend.counter!),
          epochRecords: initiatorSend.epochRecords!,
          epochBytes: initiatorSend.epochBytes!,
        },
        responderSyntheticStart: {
          epoch: sequenceValue(responderSend.epoch!),
          counter: sequenceValue(responderSend.counter!),
          epochRecords: responderSend.epochRecords!,
          epochBytes: responderSend.epochBytes!,
        },
      },
      expected: {
        records: [...sequential.records],
        postApplicationReserveHeld: reserveHeld,
        initiatorCloseRecordsSent: sequential.initiator.machine.closeRecordsSent,
        responderCloseRecordsSent: sequential.responder.machine.closeRecordsSent,
        initiatorRecordsSpent: sequential.initiator.session.sendState.epochRecords,
        responderRecordsSpent: sequential.responder.session.sendState.epochRecords,
        initiatorVerdict: sequential.initiator.machine.verdict ?? null,
        responderVerdict: sequential.responder.machine.verdict ?? null,
        initiatorSendState: directionStateJson(sequential.initiator.session.sendState),
        responderSendState: directionStateJson(sequential.responder.session.sendState),
        initiatorExhaustedAtTheCeiling: sequential.initiator.session.sendState.exhausted,
        responderExhaustedAtTheCeiling: sequential.responder.session.sendState.exhausted,
        recordsThatCompletedAnEpoch: countEpochCompletions(sequential.records),
        wrapped: false,
        reused: false,
      },
    });
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  {
    const initiatorSend = counterExhaustionState(E2EE_CLOSE_RECORDS_RESERVED);
    const responderSend = counterExhaustionState(E2EE_CLOSE_RECORDS_RESERVED);
    const simultaneous = await runSimultaneousClose(trace, { initiatorSend, responderSend });
    cases.push({
      name: "counter-exhaustion-simultaneous-close-out-of-the-close-reserve",
      sections: ["9.6", "10.2", "10.1.1"],
      note: `Each side of a simultaneous close protects \`E2EE_CLOSE_RECORDS_RESERVED\` records — its \`E2EEClose\` and its \`E2EECloseAck\` — and both directions therefore end AT the counter ceiling, which is why §9.6 sizes the close half unconditionally in every role rather than to the responder's single record. ${COUNTER_EXHAUSTION_NOTE}`,
      inputs: {
        exhaustionCause: "counter-ceiling",
        counterMax: E2EE_COUNTER_MAX.toString(10),
        epochMax: safeNumber(E2EE_EPOCH_MAX),
        closeRecordsReserved: E2EE_CLOSE_RECORDS_RESERVED,
        postApplicationReserveRecords: E2EE_POST_APPLICATION_RESERVE_RECORDS,
        positionsRemainingBeforeTheCeiling: E2EE_CLOSE_RECORDS_RESERVED,
        syntheticStartCounter: sequenceValue(initiatorSend.counter!),
      },
      expected: {
        records: [...simultaneous.records],
        initiatorRecordsSpent: simultaneous.initiator.session.sendState.epochRecords,
        responderRecordsSpent: simultaneous.responder.session.sendState.epochRecords,
        initiatorVerdict: simultaneous.initiator.machine.verdict ?? null,
        responderVerdict: simultaneous.responder.machine.verdict ?? null,
        initiatorSendState: directionStateJson(simultaneous.initiator.session.sendState),
        responderSendState: directionStateJson(simultaneous.responder.session.sendState),
        initiatorExhaustedAtTheCeiling: simultaneous.initiator.session.sendState.exhausted,
        responderExhaustedAtTheCeiling: simultaneous.responder.session.sendState.exhausted,
        recordsThatCompletedAnEpoch: countEpochCompletions(simultaneous.records),
        wrapped: false,
        reused: false,
      },
    });
    simultaneous.initiator.session.erase();
    simultaneous.responder.session.erase();
  }

  // ── the terminal-error reserve ───────────────────────────────────────────
  for (const [name, availableRecords] of [
    ["terminal-epoch-error-record-out-of-the-error-reserve", E2EE_POST_APPLICATION_RESERVE_RECORDS],
    ["terminal-epoch-error-record-without-capacity", E2EE_CLOSE_RECORDS_RESERVED],
  ] as const) {
    const initiatorSend = terminalEpochState(availableRecords);
    const responderSend = terminalEpochState(availableRecords);
    const sequential = await runSequentialClose(trace, {
      initiator: { send: initiatorSend },
      responder: { send: responderSend },
    });
    // A non-conforming peer: §10.2 forbids it to protect anything after its own
    // close-machine record, and this endpoint's own session refuses to. The
    // stray is built from a separate session resumed at the peer's position,
    // which is exactly what a peer that ignored the prohibition would put out.
    const strayPosition = mirrorState(sequential.responder.session.sendState);
    const stray = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT, { send: strayPosition });
    // A stray CLOSE-MACHINE record rather than an RPC one: in the terminal epoch
    // §9.6 forbids a conforming session to protect an application record at all
    // (it would leave less than the post-application reserve), so the only
    // envelope that can reach the initiator beyond its machine's expectation
    // there is a control record. It is `record_beyond_machine` exactly as an RPC
    // record would be, and it is not an `E2EEError`, so it is a Q7 envelope.
    const strayBody = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
      sessionBindingHash: trace.sessionBindingHash,
      finalSend: { epoch: strayPosition.epoch!, counter: strayPosition.counter! },
      expectedRecv: { epoch: strayPosition.epoch!, counter: strayPosition.counter! },
    });
    const strayRecord = await protectOrThrow(stray, E2EE_INNER_TYPE_CLOSE_ACK, strayBody);
    const strayAtInitiator = deliverToClose(sequential.initiator, strayRecord.envelope, NOW);

    const errorBody = encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    const mayProtect = sequential.initiator.machine.mayProtectTerminalError;
    const errorSend = await protectRecord(
      sequential.initiator.session,
      E2EE_INNER_TYPE_ERROR,
      errorBody,
    );
    if (errorSend.result.kind === "protected") {
      sequential.initiator.machine.noteTerminalErrorTransmitted();
    }

    cases.push({
      name,
      sections: ["9.6", "10.2", "11.3", "11.5"],
      note:
        availableRecords === E2EE_POST_APPLICATION_RESERVE_RECORDS
          ? "The whole post-application reserve is held: the close machine spends `E2EE_CLOSE_RECORDS_RESERVED` and the terminal `E2EEError` is protected out of `E2EE_ERROR_RECORDS_RESERVED` at the NEXT `(epoch, counter)` — no wrap, no reuse, and no third close-machine record. This is the case that fails against an implementation sizing the reserve at the close half alone."
          : "The same trace from a synthetic state whose remaining capacity covers the close machine but NOT the error record. The close completes and the §11.5 observable is the 'none when the send path is unusable' case — never a wrap, a reuse, or a silently dropped obligation.",
      inputs: {
        epoch: safeNumber(E2EE_EPOCH_MAX),
        availableRecordsAtStart: availableRecords,
        postApplicationReserveRecords: E2EE_POST_APPLICATION_RESERVE_RECORDS,
        closeRecordsReserved: E2EE_CLOSE_RECORDS_RESERVED,
        errorRecordsReserved: E2EE_ERROR_RECORDS_RESERVED,
        strayRecord: {
          innerType: E2EE_INNER_TYPE_CLOSE_ACK,
          body: b(strayBody),
          position: seq({ epoch: strayRecord.epoch, counter: strayRecord.counter }),
          envelope: b(strayRecord.envelope),
        },
      },
      expected: {
        closeRecords: [...sequential.records],
        strayAuthenticated: unprotectResultJson(strayAtInitiator.unprotected),
        strayVerdict: closeReceiveJson(strayAtInitiator.close),
        mayProtectTerminalError: mayProtect,
        errorBody: b(errorBody),
        errorRecord: protectResultJson(errorSend.result),
        errorEnvelope: errorSend.envelope === undefined ? null : b(errorSend.envelope),
        errorRecordsOnTheWire: errorSend.transmitted,
        closeMachineRecordsSent: sequential.initiator.machine.closeRecordsSent,
        thirdCloseMachineRecordSent: false,
        initiatorSendState: directionStateJson(sequential.initiator.session.sendState),
        initiatorVerdict: sequential.initiator.machine.verdict ?? null,
        wrapped: false,
        reused: false,
        observable:
          errorSend.transmitted === 1
            ? { lengthUniformEncryptedRecords: 1, closeReason: "channel_rejected" }
            : { lengthUniformEncryptedRecords: 0, closeReason: "channel_rejected" },
      },
    });
    stray.erase();
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  // ── the §9.6 degenerate state ────────────────────────────────────────────
  {
    const initiatorSend = terminalEpochState(1);
    const responderSend = terminalEpochState(E2EE_POST_APPLICATION_RESERVE_RECORDS);
    const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
      send: initiatorSend,
      receive: responderSend,
    });
    const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
      send: responderSend,
      receive: initiatorSend,
    });
    const reserveHeld = initiator.session.postApplicationReserveHeld;
    const applicationAttempt = await protectRecord(
      initiator.session,
      E2EE_INNER_TYPE_RPC,
      utf8.encode("application"),
    );
    const closeExpectedRecv = currentPosition(initiator.session.receiveState);
    const close = await sendCloseRecord(initiator, "close", NOW);
    const closeAtResponder = deliverToClose(responder, close.envelope, NOW);
    const followUp = await protectRecord(
      initiator.session,
      E2EE_INNER_TYPE_CLOSE_ACK,
      encodeE2eeCloseRecordBody({
        innerType: E2EE_INNER_TYPE_CLOSE_ACK,
        senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
        sessionBindingHash: trace.sessionBindingHash,
        finalSend: { epoch: E2EE_EPOCH_MAX, counter: 0n },
        expectedRecv: closeExpectedRecv,
      }),
    );
    cases.push({
      name: "degenerate-state-below-the-post-application-reserve",
      sections: ["9.6", "10.1.1", "10.4"],
      note: "A state that already violated the reservation: ONE protectable record remains in the initiator's direction. The application record is refused with `close_required`, the `E2EEClose` spends the last position of the direction, and there is therefore no §10.1.1 anchor for a peer ack to equal — so §9.6 fixes the outcome as **Unclean — abrupt** with no wire record, and nothing wraps or is reused.",
      inputs: {
        epoch: safeNumber(E2EE_EPOCH_MAX),
        availableRecordsAtStart: 1,
        postApplicationReserveRecords: E2EE_POST_APPLICATION_RESERVE_RECORDS,
      },
      expected: {
        postApplicationReserveHeld: reserveHeld,
        applicationRecord: protectResultJson(applicationAttempt.result),
        applicationRecordsOnTheWire: applicationAttempt.transmitted,
        closeRecord: closeRecordJson(
          close,
          closeExpectedRecv,
          trace.sessionBindingHash,
          E2EE_DIRECTION_CLIENT_TO_NODE,
        ),
        closeAnchor:
          initiator.machine.closeAnchor === undefined ? null : seq(initiator.machine.closeAnchor),
        closeAnchorUnavailable: initiator.machine.closeAnchorUnavailable,
        initiatorVerdict: initiator.machine.verdict ?? null,
        initiatorSendState: directionStateJson(initiator.session.sendState),
        furtherCloseMachineRecord: protectResultJson(followUp.result),
        furtherRecordsOnTheWire: followUp.transmitted,
        responderView: closeReceiveJson(closeAtResponder.close),
        wrapped: false,
        reused: false,
      },
    });
    initiator.session.erase();
    responder.session.erase();
  }

  return {
    file: "f09-rekey-boundaries.json",
    number: 9,
    title: "Rekey boundaries",
    sections: ["9.4", "9.5", "9.6", "16.3 F9"],
    summary:
      "The §9.4 epoch schedule for epochs zero through two in both directions; both threshold boundaries with the successor that carries epoch +1 and counter 0; early, late, and skipped epoch transitions, each a §9.2 sequence mismatch decided before decryption; and BOTH §9.6 exhaustion states — a complete close protected entirely out of `E2EE_CLOSE_RECORDS_RESERVED` for all three roles, once in the terminal epoch and once at the `E2EE_COUNTER_MAX` ceiling within a live epoch — plus the terminal `E2EEError` protected out of `E2EE_ERROR_RECORDS_RESERVED` beyond the close machine, the same trace without capacity for the error record, and the degenerate state below the reserve.",
    deferred: [CLOSE_STEP_TRACE_DEFERRAL],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F11 — authenticated close (§10) ─────────────────────────────────────────

/**
 * A sequential close in which the responder's `E2EECloseAck` declares something
 * other than its conforming value. `buildCloseAck` refuses to produce such a
 * record — that is the point of the getter — so the body is assembled through
 * the §10.1 encoder and protected as an ordinary control record, which is what a
 * non-conforming peer puts on the wire.
 */
async function sequentialCloseWithCraftedAck(
  trace: HandshakeTrace,
  options: {
    readonly initiatorSend?: E2eeSyntheticDirectionState;
    readonly responderSend?: E2eeSyntheticDirectionState;
    readonly declare: (conforming: E2eeSequencePosition) => E2eeSequencePosition;
  },
): Promise<{
  readonly initiator: CloseEndpoint;
  readonly responder: CloseEndpoint;
  readonly closeRecord: JsonValue;
  readonly anchor: E2eeSequencePosition;
  readonly conformingDeclaration: E2eeSequencePosition;
  readonly craftedDeclaration: E2eeSequencePosition;
  readonly craftedAckBody: Uint8Array;
  readonly craftedAckEnvelope: Uint8Array;
  readonly received: E2eeCloseReceiveResult | undefined;
}> {
  const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
    ...(options.initiatorSend === undefined ? {} : { send: options.initiatorSend }),
    ...(options.responderSend === undefined ? {} : { receive: options.responderSend }),
  });
  const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
    ...(options.responderSend === undefined ? {} : { send: options.responderSend }),
    ...(options.initiatorSend === undefined ? {} : { receive: options.initiatorSend }),
  });
  const closeExpectedRecv = refreshPositions(initiator).expectedRecv;
  const close = await sendCloseRecord(initiator, "close", NOW);
  deliverToClose(responder, close.envelope, NOW);
  const conforming = responder.machine.ackExpectedRecv!;
  const declared = options.declare(conforming);
  const position = refreshPositions(responder).nextSend;
  const body = encodeE2eeCloseRecordBody({
    innerType: E2EE_INNER_TYPE_CLOSE_ACK,
    senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
    sessionBindingHash: trace.sessionBindingHash,
    finalSend: position,
    expectedRecv: declared,
  });
  const sent = await protectOrThrow(responder.session, E2EE_INNER_TYPE_CLOSE_ACK, body);
  const received = deliverToClose(initiator, sent.envelope, NOW);
  return {
    initiator,
    responder,
    closeRecord: closeRecordJson(
      close,
      closeExpectedRecv,
      trace.sessionBindingHash,
      E2EE_DIRECTION_CLIENT_TO_NODE,
    ),
    anchor: initiator.machine.closeAnchor!,
    conformingDeclaration: conforming,
    craftedDeclaration: declared,
    craftedAckBody: body,
    craftedAckEnvelope: sent.envelope,
    received: received.close,
  };
}

/** Protect a peer-supplied `E2EEClose` body and deliver it to a fresh responder. */
async function craftedCloseAtResponder(
  trace: HandshakeTrace,
  build: (valid: Uint8Array, position: E2eeSequencePosition) => Uint8Array,
): Promise<{
  readonly responder: CloseEndpoint;
  readonly body: Uint8Array;
  readonly envelope: Uint8Array;
  readonly received: E2eeCloseReceiveResult | undefined;
}> {
  const sender = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
  const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
  const position = currentPosition(sender.sendState);
  const valid = encodeE2eeCloseRecordBody({
    innerType: E2EE_INNER_TYPE_CLOSE,
    senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
    sessionBindingHash: trace.sessionBindingHash,
    finalSend: position,
    expectedRecv: currentPosition(sender.receiveState),
  });
  const body = build(valid, position);
  const sent = await protectOrThrow(sender, E2EE_INNER_TYPE_CLOSE, body);
  const received = deliverToClose(responder, sent.envelope, NOW);
  sender.erase();
  return { responder, body, envelope: sent.envelope, received: received.close };
}

async function buildFamily11(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];
  const trace = IK_TRACE;

  // ── the sequential clean close ───────────────────────────────────────────
  {
    const sequential = await runSequentialClose(trace);
    const keepalive = await protectRecord(
      sequential.initiator.session,
      E2EE_INNER_TYPE_RPC,
      utf8.encode('{"_tag":"ryco.rpc.ping"}'),
    );
    cases.push({
      name: "sequential-clean-close",
      sections: ["10.1", "10.1.1", "10.2", "10.4"],
      note: "All three records of §10.2 — the initiator's `E2EEClose`, the responder's `E2EECloseAck`, and the initiator's final confirmation — with their declared fields, their commitment preimages, and both endpoints' verdicts, which MUST both be Clean. In the sequential branch each endpoint's anchor equals its current next-send, because it has sent nothing since its own first close-machine record.",
      inputs: {
        epoch: 0,
        initiatorFirstSendCounter: 0,
        responderFirstSendCounter: 0,
        sessionBindingHash: b(trace.sessionBindingHash),
        closeCommitmentDomain: E2EE_CLOSE_COMMITMENT_DOMAIN,
      },
      expected: {
        records: [...sequential.records],
        initiatorVerdict: sequential.initiator.machine.verdict ?? null,
        responderVerdict: sequential.responder.machine.verdict ?? null,
        bothVerdictsClean:
          sequential.initiator.machine.verdict === "clean" &&
          sequential.responder.machine.verdict === "clean",
        initiatorWaitsArmed: sequential.initiator.machine.waitsArmed,
        responderWaitsArmed: sequential.responder.machine.waitsArmed,
        closeRecordsReserved: E2EE_CLOSE_RECORDS_RESERVED,
        initiatorCloseRecordsSent: sequential.initiator.machine.closeRecordsSent,
        responderCloseRecordsSent: sequential.responder.machine.closeRecordsSent,
        // §10.2, §3.2.2 L5: no keepalive `Ping` between the first close-machine
        // record and the channel's end, in ANY role.
        keepalivePingAfterTheFirstCloseRecord: protectResultJson(keepalive.result),
        keepalivePingRecordsOnTheWire: keepalive.transmitted,
        keepalivePingDiscardedNotBuffered: true,
      },
    });
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  // ── the simultaneous cases §16.3 F11 tabulates ───────────────────────────
  const SIMULTANEOUS_INITIATOR: E2eeSyntheticDirectionState = {
    epoch: 0n,
    counter: 7n,
    epochRecords: 7,
    epochBytes: 0,
  };
  const SIMULTANEOUS_RESPONDER: E2eeSyntheticDirectionState = {
    epoch: 0n,
    counter: 4n,
    epochRecords: 4,
    epochBytes: 0,
  };

  {
    const simultaneous = await runSimultaneousClose(trace, {
      initiatorSend: SIMULTANEOUS_INITIATOR,
      responderSend: SIMULTANEOUS_RESPONDER,
    });
    cases.push({
      name: "simultaneous-close-passing",
      sections: ["10.1.1", "10.2", "10.4"],
      note: "The §16.3 F11 table, with its counters fixed: epoch 0 throughout, the initiator's next-send `(0, 7)`, the responder's `(0, 4)`. Each ack satisfies the strict rule against the VALIDATOR'S ANCHOR — the initiator's `(0, 8)` and the responder's `(0, 5)` — and never against its current next-send, which in this branch is permanently one advance ahead of anything the peer could have acknowledged.",
      inputs: {
        epoch: 0,
        initiatorNextSend: { epoch: 0, counter: 7 },
        responderNextSend: { epoch: 0, counter: 4 },
      },
      expected: {
        records: [...simultaneous.records],
        initiatorAnchor: seq(simultaneous.initiator.machine.closeAnchor!),
        responderAnchor: seq(simultaneous.responder.machine.closeAnchor!),
        initiatorVerdict: simultaneous.initiator.machine.verdict ?? null,
        responderVerdict: simultaneous.responder.machine.verdict ?? null,
        bothVerdictsClean:
          simultaneous.initiator.machine.verdict === "clean" &&
          simultaneous.responder.machine.verdict === "clean",
        bothEndpointsAreLastRecordSenders:
          simultaneous.initiator.machine.isLastRecordSender &&
          simultaneous.responder.machine.isLastRecordSender,
      },
    });
    simultaneous.initiator.session.erase();
    simultaneous.responder.session.erase();
  }

  {
    // The disallowed reading: the responder's ack declares the initiator's
    // CURRENT next-send `(0, 9)` — after the initiator sent its own ack — rather
    // than the initiator's anchor `(0, 8)`.
    const simultaneous = await runSimultaneousClose(trace, {
      initiatorSend: SIMULTANEOUS_INITIATOR,
      responderSend: SIMULTANEOUS_RESPONDER,
      responderAckExpectedRecvOverride: { epoch: 0n, counter: 9n },
    });
    cases.push({
      name: "simultaneous-close-ack-declaring-current-next-send",
      sections: ["10.1", "10.1.1", "10.4", "11.3 Q7"],
      note: "A conforming implementation MUST reject this record; accepting it is the disallowed reading of the strict rule. The declaration `(0, 9)` is the initiator's current next-send after it sent its own ack; the strict rule reads the anchor `(0, 8)` instead.",
      inputs: {
        initiatorAnchor: { epoch: 0, counter: 8 },
        initiatorCurrentNextSend: { epoch: 0, counter: 9 },
        declaredExpectedRecv: { epoch: 0, counter: 9 },
      },
      expected: {
        records: [...simultaneous.records],
        initiatorVerdict: simultaneous.initiator.machine.verdict ?? null,
        disposition: "FATAL-POST",
        errorCode: "protocol_violation",
        acceptingItIsTheDisallowedReading: true,
      },
    });
    simultaneous.initiator.session.erase();
    simultaneous.responder.session.erase();
  }

  // ── the close anchor across an epoch boundary ────────────────────────────
  const EPOCH_BOUNDARY_INITIATOR: E2eeSyntheticDirectionState = {
    epoch: 0n,
    counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
    epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
    epochBytes: 0,
  };
  const EPOCH_BOUNDARY_RESPONDER: E2eeSyntheticDirectionState = {
    epoch: 0n,
    counter: 4n,
    epochRecords: 4,
    epochBytes: 0,
  };

  {
    const sequential = await runSequentialClose(trace, {
      initiator: { send: EPOCH_BOUNDARY_INITIATOR },
      responder: { send: EPOCH_BOUNDARY_RESPONDER },
    });
    cases.push({
      name: "close-anchor-across-an-epoch-boundary",
      sections: ["9.4", "10.1.1", "10.2"],
      note: "The initiator's `E2EEClose` is the last record of epoch 0 under the §9.4 record threshold, so the anchor is the §9.2/§9.4 ADVANCE of that position — `(1, 0)` and never counter + 1. The responder computes the same value from the `epochCompleted` flag its own authentication reported.",
      inputs: {
        rekeyMaxRecords: E2EE_REKEY_MAX_RECORDS,
        initiatorClosePosition: {
          epoch: 0,
          counter: E2EE_REKEY_MAX_RECORDS - 1,
        },
      },
      expected: {
        records: [...sequential.records],
        initiatorAnchor: seq(sequential.initiator.machine.closeAnchor!),
        anchorIsTheEpochAdvance:
          sequential.initiator.machine.closeAnchor!.epoch === 1n &&
          sequential.initiator.machine.closeAnchor!.counter === 0n,
        initiatorVerdict: sequential.initiator.machine.verdict ?? null,
        responderVerdict: sequential.responder.machine.verdict ?? null,
      },
    });
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  {
    const crafted = await sequentialCloseWithCraftedAck(trace, {
      initiatorSend: EPOCH_BOUNDARY_INITIATOR,
      responderSend: EPOCH_BOUNDARY_RESPONDER,
      declare: () => ({ epoch: 0n, counter: BigInt(E2EE_REKEY_MAX_RECORDS) }),
    });
    cases.push({
      name: "close-anchor-across-an-epoch-boundary-declaring-counter-plus-one",
      sections: ["9.4", "10.1.1", "11.3 Q7"],
      note: "The companion negative of the case above: an ack that declares `(e, counter + 1)` where the epoch-completing close advanced the anchor to `(e + 1, 0)`. It MUST fail as Q7.",
      inputs: {
        initiatorAnchor: seq(crafted.anchor),
        conformingDeclaration: seq(crafted.conformingDeclaration),
        declaredExpectedRecv: seq(crafted.craftedDeclaration),
        craftedAckBody: b(crafted.craftedAckBody),
        craftedAckEnvelope: b(crafted.craftedAckEnvelope),
      },
      expected: {
        closeRecord: crafted.closeRecord,
        received: closeReceiveJson(crafted.received),
        initiatorVerdict: crafted.initiator.machine.verdict ?? null,
        disposition: "FATAL-POST",
        errorCode: "protocol_violation",
      },
    });
    crafted.initiator.session.erase();
    crafted.responder.session.erase();
  }

  // ── a plain strict-rule violation in the sequential branch ───────────────
  {
    const crafted = await sequentialCloseWithCraftedAck(trace, {
      declare: (conforming) => ({ epoch: conforming.epoch, counter: conforming.counter + 1n }),
    });
    cases.push({
      name: "strict-rule-violation",
      sections: ["10.1", "10.1.1", "11.3 Q7"],
      note: "The strict rule is EXACT EQUALITY against the anchor: one past it fails exactly as one short of it would.",
      inputs: {
        initiatorAnchor: seq(crafted.anchor),
        declaredExpectedRecv: seq(crafted.craftedDeclaration),
        craftedAckBody: b(crafted.craftedAckBody),
      },
      expected: {
        received: closeReceiveJson(crafted.received),
        initiatorVerdict: crafted.initiator.machine.verdict ?? null,
        disposition: "FATAL-POST",
      },
    });
    crafted.initiator.session.erase();
    crafted.responder.session.erase();
  }

  // ── a passed-through-rule violation ──────────────────────────────────────
  {
    const violation = await craftedCloseAtResponder(trace, (_valid, position) =>
      encodeE2eeCloseRecordBody({
        innerType: E2EE_INNER_TYPE_CLOSE,
        senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
        sessionBindingHash: trace.sessionBindingHash,
        finalSend: position,
        expectedRecv: { epoch: 0n, counter: 9n },
      }),
    );
    cases.push({
      name: "passed-through-rule-violation",
      sections: ["10.1", "11.3 Q7"],
      note: "The passed-through rule is `≤ the receiver's CURRENT next-send` in lexicographic order — a state the peer's receive window could legitimately hold, since records may still be in flight. `(0, 9)` against a receiver whose next-send is `(0, 0)` is past anything it could have sent.",
      inputs: {
        receiverCurrentNextSend: { epoch: 0, counter: 0 },
        declaredExpectedRecv: { epoch: 0, counter: 9 },
        body: b(violation.body),
        envelope: b(violation.envelope),
      },
      expected: {
        received: closeReceiveJson(violation.received),
        verdict: violation.responder.machine.verdict ?? null,
        disposition: "FATAL-POST",
      },
    });
    violation.responder.session.erase();
  }

  // ── a commitment mismatch, and a malformed body ──────────────────────────
  {
    const otherCommitment = e2eeCloseCommitment({
      innerType: E2EE_INNER_TYPE_CLOSE,
      senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
      sessionBindingHash: trace.sessionBindingHash,
      finalSend: { epoch: 0n, counter: 0n },
      expectedRecv: { epoch: 0n, counter: 5n },
    });
    const mismatch = await craftedCloseAtResponder(trace, (valid) =>
      mutateElement(valid, 4, otherCommitment),
    );
    cases.push({
      name: "commitment-mismatch",
      sections: ["10.1", "11.3 Q7"],
      note: "Field 4 recomputed over DIFFERENT declared fields than the body carries. The encoder cannot build this — `encodeE2eeCloseRecordBody` computes the commitment from the same fields it writes — so the body is a peer-supplied mutation of the canonical bytes.",
      inputs: {
        body: b(mismatch.body),
        substitutedCommitment: b(otherCommitment),
      },
      expected: {
        received: closeReceiveJson(mismatch.received),
        verdict: mismatch.responder.machine.verdict ?? null,
        disposition: "FATAL-POST",
      },
    });
    mismatch.responder.session.erase();

    const malformed = await craftedCloseAtResponder(trace, (valid) => dropLastElement(valid));
    cases.push({
      name: "malformed-close-body",
      sections: ["3.6", "10.1", "11.3 Q7"],
      note: "Four elements where §10.1 fixes five. The strict decode of §3.6 — including the re-encode byte-equality rule — runs before any field is compared.",
      inputs: { body: b(malformed.body) },
      expected: {
        received: closeReceiveJson(malformed.received),
        verdict: malformed.responder.machine.verdict ?? null,
        disposition: "FATAL-POST",
      },
    });
    malformed.responder.session.erase();
  }

  // ── truncation at close ──────────────────────────────────────────────────
  {
    const sequential = await runSequentialClose(trace);
    const before = sequential.initiator.machine.verdict;
    const after = sequential.initiator.machine.noteChannelEnded({
      at: NOW + 10,
      incompleteReassembly: true,
    });
    cases.push({
      name: "truncation-at-close",
      sections: ["10.4"],
      note: "A partial reassembled message at close IS truncation, regardless of any other state — so it supersedes the Clean verdict the completed exchange recorded, and does NOT supersede a Failed one.",
      inputs: { exchangeCompleted: true, incompleteReassembly: true },
      expected: {
        verdictAtExchangeCompletion: before ?? null,
        verdictAtChannelEnd: after,
        wireRecordsEmitted: 0,
      },
    });
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  // ── the two readings §16.3 F11 separates ─────────────────────────────────
  {
    const sequential = await runSequentialClose(trace);
    const stray = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
      send: mirrorState(sequential.responder.session.sendState),
    });
    const strayBody = utf8.encode('{"_tag":"ryco.rpc.request"}');
    const strayRecord = await protectOrThrow(stray, E2EE_INNER_TYPE_RPC, strayBody);
    const strayAtInitiator = deliverToClose(sequential.initiator, strayRecord.envelope, NOW + 5);
    const errorBody = encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    const errorSend = await protectOrThrow(
      sequential.initiator.session,
      E2EE_INNER_TYPE_ERROR,
      errorBody,
    );
    sequential.initiator.machine.noteTerminalErrorTransmitted();
    const secondError = await protectRecord(
      sequential.initiator.session,
      E2EE_INNER_TYPE_ERROR,
      errorBody,
    );
    cases.push({
      name: "envelope-beyond-the-machines-expectation",
      sections: ["10.2", "10.4", "11.3 Q7", "11.5"],
      note: "An extra protected record arriving after the endpoint's exchange is complete, carrying an inner type other than `E2EEError`. The discarded reading produced neither an error record nor a Failed verdict; this one produces both, and the error record is the ONLY record protected after the close machine.",
      inputs: {
        exchangeCompleted: true,
        strayInnerType: E2EE_INNER_TYPE_RPC,
        strayBody: b(strayBody),
        strayEnvelope: b(strayRecord.envelope),
      },
      expected: {
        strayAuthenticated: unprotectResultJson(strayAtInitiator.unprotected),
        received: closeReceiveJson(strayAtInitiator.close),
        verdict: sequential.initiator.machine.verdict ?? null,
        verdictIsNotUncleanAbrupt: sequential.initiator.machine.verdict !== "unclean_abrupt",
        errorRecordEmitted: true,
        errorBody: b(errorBody),
        errorEnvelope: b(errorSend.envelope),
        errorEnvelopeBytes: errorSend.envelopeBytes,
        errorPosition: seq({ epoch: errorSend.epoch, counter: errorSend.counter }),
        secondErrorRecord: protectResultJson(secondError.result),
        secondErrorRecordsOnTheWire: secondError.transmitted,
        closeMachineRecordsSent: sequential.initiator.machine.closeRecordsSent,
        observable: { lengthUniformEncryptedRecords: 1, closeReason: "channel_rejected" },
      },
    });
    stray.erase();
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  {
    // The peer's view of that same trace.
    const sequential = await runSequentialClose(trace);
    const errorBody = encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
    const errorSend = await protectOrThrow(
      sequential.initiator.session,
      E2EE_INNER_TYPE_ERROR,
      errorBody,
    );
    sequential.initiator.machine.noteTerminalErrorTransmitted();
    const atResponder = deliverToClose(sequential.responder, errorSend.envelope, NOW + 5);
    // §11.3: the receiver MUST NOT reply. The close machine is what forbids it —
    // the session's own send gate would still admit a control record — so the
    // driver reads the machine and emits nothing, and the machine's commit hook
    // refuses the record outright.
    const mayReply = sequential.responder.machine.mayProtectTerminalError;
    const replyRefused = rejected(() =>
      sequential.responder.machine.noteTerminalErrorTransmitted(),
    );
    sequential.responder.session.erase();
    cases.push({
      name: "peer-terminal-error-after-a-completed-exchange",
      sections: ["10.2", "10.4", "11.3"],
      note: "An authenticated `E2EEError` arriving after the receiving endpoint's own exchange completed is the peer's TERMINAL record, not a Q7 envelope: the receiver erases secrets and closes WITHOUT replying. The Q7 reading would have the two endpoints answer each other's terminal errors indefinitely.",
      inputs: {
        exchangeCompleted: true,
        errorEnvelope: b(errorSend.envelope),
        errorCode: E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
      },
      expected: {
        received: closeReceiveJson(atResponder.close),
        isQ7: false,
        verdict: sequential.responder.machine.verdict ?? null,
        mayProtectTerminalErrorAfterwards: mayReply,
        secondErrorRecordRefusedByTheCloseMachine: replyRefused,
        replyRecordsOnTheWire: 0,
        secretsErased: sequential.responder.session.erased,
      },
    });
    sequential.initiator.session.erase();
  }

  // ── legacy JSON and a negotiation record during the close phase ──────────
  for (const [name, payload, description] of [
    [
      "legacy-json-during-the-close-phase",
      utf8.encode('{"_tag":"ryco.rpc.request","id":1}'),
      "legacy JSON",
    ],
    ["negotiation-record-during-the-close-phase", trace.helloRecord, "a negotiation record"],
  ] as const) {
    const sequential = await runSequentialClose(trace);
    const classified = classifyPostStripPayload(payload);
    const verdict = sequential.initiator.machine.noteFatal();
    cases.push({
      name,
      sections: ["4.3 step 2", "10.2", "10.4", "11.3 Q6"],
      note: `${description} delivered while the close phase is in progress. The close phase adds no exemption to rows N11/K18: the payload never reaches the record layer at all, because §4.3 step 2 classifies it before decryption, and the outcome is FATAL-POST Q6 with verdict Failed.`,
      inputs: {
        modeMachineState: "e2ee",
        closePhaseActive: true,
        payload: b(payload),
      },
      expected: {
        step2Discrimination: {
          class: classified.kind,
          ...(classified.kind === "other" ? { reason: classified.reason } : {}),
        },
        fatal: "Q6",
        disposition: "FATAL-POST",
        verdict,
        closePhaseGrantsNoExemption: true,
      },
    });
    sequential.initiator.session.erase();
    sequential.responder.session.erase();
  }

  // ── `T_CLOSE` expiry at each waiting step ────────────────────────────────
  {
    const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    await sendCloseRecord(initiator, "close", NOW);
    const deadline = initiator.machine.waitDeadlineAt!;
    const verdict = initiator.machine.noteWaitExpired(deadline + 1);
    cases.push({
      name: "t-close-expiry-sequential-initiator",
      sections: ["10.2", "10.3", "10.4"],
      note: "The contrast case that fixes which events this protocol declines to attribute: a `T_CLOSE` expiry is **Unclean — abrupt** with NO wire record, because it may equally be network failure, denial of service, or the peer's own local send failure.",
      inputs: { waitStep: "initiator-awaiting-close-ack", tClose: T_CLOSE, expiredAt: 1 },
      expected: {
        waitsArmed: initiator.machine.waitsArmed,
        waitDeadlineOffsetFromRecord: deadline - NOW,
        verdict,
        wireRecordsEmitted: 0,
        attributable: false,
      },
    });
    initiator.session.erase();
  }

  {
    const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
    const close = await sendCloseRecord(initiator, "close", NOW);
    deliverToClose(responder, close.envelope, NOW);
    await sendCloseRecord(responder, "close_ack", NOW);
    const deadline = responder.machine.waitDeadlineAt!;
    const verdict = responder.machine.noteWaitExpired(deadline + 1);
    cases.push({
      name: "t-close-expiry-sequential-responder",
      sections: ["10.2", "10.3", "10.4"],
      inputs: { waitStep: "responder-awaiting-final-confirmation", tClose: T_CLOSE, expiredAt: 1 },
      expected: {
        waitsArmed: responder.machine.waitsArmed,
        waitDeadlineOffsetFromRecord: deadline - NOW,
        verdict,
        wireRecordsEmitted: 0,
      },
    });
    initiator.session.erase();
    responder.session.erase();
  }

  {
    const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
      send: SIMULTANEOUS_INITIATOR,
      receive: SIMULTANEOUS_RESPONDER,
    });
    const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
      send: SIMULTANEOUS_RESPONDER,
      receive: SIMULTANEOUS_INITIATOR,
    });
    await sendCloseRecord(initiator, "close", NOW);
    const responderClose = await sendCloseRecord(responder, "close", NOW);
    deliverToClose(initiator, responderClose.envelope, NOW);
    await sendCloseRecord(initiator, "close_ack", NOW);
    const deadline = initiator.machine.waitDeadlineAt!;
    const verdict = initiator.machine.noteWaitExpired(deadline + 1);
    cases.push({
      name: "t-close-expiry-simultaneous-second-wait",
      sections: ["10.2", "10.3", "10.4"],
      note: "The simultaneous branch's SECOND wait. The transition into the branch does not end the first wait's obligation and nothing restarts or extends either; no path admits a third.",
      inputs: { waitStep: "simultaneous-awaiting-peer-ack", tClose: T_CLOSE, expiredAt: 1 },
      expected: {
        waitsArmed: initiator.machine.waitsArmed,
        maximumWaitsPerClosePhase: 2,
        verdict,
        wireRecordsEmitted: 0,
      },
    });
    initiator.session.erase();
    responder.session.erase();
  }

  // ── §10.4 precedence: truncation does not outrank a detected violation ───
  {
    const violation = await craftedCloseAtResponder(trace, (valid) => dropLastElement(valid));
    const afterFatal = violation.responder.machine.verdict;
    const afterEnd = violation.responder.machine.noteChannelEnded({
      at: NOW + 10,
      incompleteReassembly: true,
    });
    cases.push({
      name: "incomplete-reassembly-with-a-q7-violation",
      sections: ["10.4"],
      note: "A trace combining an incomplete reassembly with a Q7 violation. §10.4's precedence is Failed, then Unclean — truncation, then Unclean — abrupt, then Clean: the detected protocol violation is the more specific fact and is what the endpoint reports.",
      inputs: { q7Violation: true, incompleteReassembly: true },
      expected: {
        verdictAtViolation: afterFatal ?? null,
        verdictAtChannelEnd: afterEnd,
        isNotUncleanTruncation: afterEnd !== "unclean_truncation",
      },
    });
    violation.responder.session.erase();
  }

  // ── close-phase keepalive ────────────────────────────────────────────────
  {
    const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
    const close = await sendCloseRecord(initiator, "close", NOW);
    const anchor = initiator.machine.closeAnchor!;
    const conformingPing = await protectRecord(
      initiator.session,
      E2EE_INNER_TYPE_RPC,
      utf8.encode('{"_tag":"ryco.rpc.ping"}'),
    );
    deliverToClose(responder, close.envelope, NOW);
    // A NON-CONFORMING initiator that exempted the keepalive: the stray `Ping`
    // rides at the anchor's own position.
    const stray = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
      send: mirrorState(initiator.session.sendState),
    });
    const strayPing = await protectOrThrow(
      stray,
      E2EE_INNER_TYPE_RPC,
      utf8.encode('{"_tag":"ryco.rpc.ping"}'),
    );
    const strayAtResponder = deliverToClose(responder, strayPing.envelope, NOW);
    // …and what a responder that nonetheless answered from its advanced
    // expected-receive state would put on the wire.
    const crafted = await sequentialCloseWithCraftedAck(trace, {
      declare: (conforming) => ({ epoch: conforming.epoch, counter: conforming.counter + 1n }),
    });
    // §10.2 binds every role, not only the initiator: the sequential responder's
    // first close-machine record is its `E2EECloseAck`, and each simultaneous
    // side's is its own `E2EEClose`.
    const responderRole = await (async () => {
      const sequential = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
      const answering = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
      const opening = await sendCloseRecord(sequential, "close", NOW);
      deliverToClose(answering, opening.envelope, NOW);
      await sendCloseRecord(answering, "close_ack", NOW);
      const attempt = await protectRecord(
        answering.session,
        E2EE_INNER_TYPE_RPC,
        utf8.encode('{"_tag":"ryco.rpc.ping"}'),
      );
      const view = {
        mayProtectApplicationRecord: answering.machine.mayProtectApplicationRecord,
        keepaliveAttempt: protectResultJson(attempt.result),
        keepaliveRecordsOnTheWire: attempt.transmitted,
      };
      sequential.session.erase();
      answering.session.erase();
      return view;
    })();
    const simultaneousRole = await (async () => {
      const left = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
        send: SIMULTANEOUS_INITIATOR,
        receive: SIMULTANEOUS_RESPONDER,
      });
      const right = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
        send: SIMULTANEOUS_RESPONDER,
        receive: SIMULTANEOUS_INITIATOR,
      });
      const leftClose = await sendCloseRecord(left, "close", NOW);
      const rightClose = await sendCloseRecord(right, "close", NOW);
      deliverToClose(left, rightClose.envelope, NOW);
      deliverToClose(right, leftClose.envelope, NOW);
      const leftAttempt = await protectRecord(
        left.session,
        E2EE_INNER_TYPE_RPC,
        utf8.encode('{"_tag":"ryco.rpc.ping"}'),
      );
      const rightAttempt = await protectRecord(
        right.session,
        E2EE_INNER_TYPE_RPC,
        utf8.encode('{"_tag":"ryco.rpc.ping"}'),
      );
      const view = {
        mayProtectApplicationRecord:
          left.machine.mayProtectApplicationRecord || right.machine.mayProtectApplicationRecord,
        keepaliveAttempt: protectResultJson(leftAttempt.result),
        peerKeepaliveAttempt: protectResultJson(rightAttempt.result),
        keepaliveRecordsOnTheWire: leftAttempt.transmitted + rightAttempt.transmitted,
      };
      left.session.erase();
      right.session.erase();
      return view;
    })();
    cases.push({
      name: "no-keepalive-ping-after-the-first-close-machine-record",
      sections: ["3.2.2 L5", "10.1.1", "10.2", "11.3 Q7"],
      note: "The prohibition binds EVERY role — the sequential initiator from its `E2EEClose`, the sequential responder from its `E2EECloseAck`, and each simultaneous side from its own `E2EEClose` — and the case carries all three. A conforming sender cannot protect the `Ping` at all — it is an ordinary application RPC record and the send path latched at the first close-machine record, so it is DISCARDED, never buffered for a later flush. A conforming responder rejects a stray one as Q7. And a responder that instead answered from its advanced expected-receive state would declare an `expectedRecv` past the initiator's close anchor, which the initiator MUST reject as Q7 — which is why the prohibition is load-bearing rather than tidy.",
      inputs: {
        initiatorCloseAnchor: seq(anchor),
        strayPingPosition: seq({ epoch: strayPing.epoch, counter: strayPing.counter }),
      },
      expected: {
        mayProtectApplicationRecord: initiator.machine.mayProtectApplicationRecord,
        conformingKeepaliveAttempt: protectResultJson(conformingPing.result),
        conformingKeepaliveRecordsOnTheWire: conformingPing.transmitted,
        keepaliveDiscardedNotBuffered: true,
        strayPingAtResponder: closeReceiveJson(strayAtResponder.close),
        responderVerdict: responder.machine.verdict ?? null,
        sequentialResponderRole: responderRole,
        simultaneousRole: simultaneousRole,
        ackDeclaringPastTheAnchor: {
          declaredExpectedRecv: seq(crafted.craftedDeclaration),
          anchor: seq(crafted.anchor),
          received: closeReceiveJson(crafted.received),
          initiatorVerdict: crafted.initiator.machine.verdict ?? null,
        },
      },
    });
    stray.erase();
    initiator.session.erase();
    responder.session.erase();
    crafted.initiator.session.erase();
    crafted.responder.session.erase();
  }

  // ── the late-simultaneous worst-case phase duration (§3.2.2 L5) ──────────
  {
    const initiator = closeEndpoint(trace, E2EE_DIRECTION_CLIENT_TO_NODE, {
      send: SIMULTANEOUS_INITIATOR,
      receive: SIMULTANEOUS_RESPONDER,
    });
    const responder = closeEndpoint(trace, E2EE_DIRECTION_NODE_TO_CLIENT, {
      send: SIMULTANEOUS_RESPONDER,
      receive: SIMULTANEOUS_INITIATOR,
    });
    const t0 = NOW;
    const initiatorClose = await sendCloseRecord(initiator, "close", t0);
    const firstDeadline = initiator.machine.waitDeadlineAt!;
    const responderClose = await sendCloseRecord(responder, "close", t0);
    // The peer's `E2EEClose` is delivered just INSIDE the first `T_CLOSE`
    // deadline, so this endpoint takes the simultaneous branch at the last
    // moment the first wait admits.
    const t1 = firstDeadline - 1;
    deliverToClose(initiator, responderClose.envelope, t1);
    const deadlineAfterBranch = initiator.machine.waitDeadlineAt!;
    deliverToClose(responder, initiatorClose.envelope, t1);
    const initiatorAck = await sendCloseRecord(initiator, "close_ack", t1);
    const secondDeadline = initiator.machine.waitDeadlineAt!;
    const responderAck = await sendCloseRecord(responder, "close_ack", t1);
    deliverToClose(responder, initiatorAck.envelope, t1);
    // Delivered just inside the SECOND `T_CLOSE` deadline.
    const t2 = secondDeadline - 1;
    const ackAtInitiator = deliverToClose(initiator, responderAck.envelope, t2);
    // The peer's outer `channel.close` is withheld, so the §10.3 linger runs its
    // full bound.
    const lingerEnd = initiator.machine.lingerDeadlineAt!;
    const phaseEnd = Math.max(t2, lingerEnd);
    const totalPhase = phaseEnd - t0;
    cases.push({
      name: "late-simultaneous-phase-duration",
      sections: ["3.2.2 L5", "10.2", "10.3", "10.4"],
      note: "The worst-case close phase §3.2.2 L5 is derived from, as a TIMED case rather than a byte vector. It is the case that fails against constants chosen for a one-wait model, and against an implementation that re-arms `T_CLOSE` on any other event: the simultaneous transition neither restarted nor extended the first wait, and the second wait was armed by this endpoint's own ack.",
      inputs: {
        tClose: T_CLOSE,
        tCloseLingerMax: T_CLOSE_LINGER_MAX,
        keepaliveFlushMargin: T_KEEPALIVE_FLUSH_MARGIN,
        rpcKeepaliveInterval: RPC_KEEPALIVE_INTERVAL,
        ownCloseAt: 0,
        peerCloseDeliveredAt: t1 - t0,
        peerAckDeliveredAt: t2 - t0,
        peerChannelCloseWithheld: true,
      },
      expected: {
        firstWaitDeadlineOffset: firstDeadline - t0,
        deadlineUnchangedByTheSimultaneousTransition: deadlineAfterBranch === firstDeadline,
        secondWaitDeadlineOffset: secondDeadline - t0,
        waitsArmed: initiator.machine.waitsArmed,
        lingerDeadlineOffset: lingerEnd - t0,
        totalPhaseMilliseconds: totalPhase,
        phaseBound: 2 * T_CLOSE + T_CLOSE_LINGER_MAX,
        withinPhaseBound: totalPhase <= 2 * T_CLOSE + T_CLOSE_LINGER_MAX,
        phaseBoundPlusFlushMarginWithinKeepaliveInterval:
          2 * T_CLOSE + T_CLOSE_LINGER_MAX + T_KEEPALIVE_FLUSH_MARGIN <= RPC_KEEPALIVE_INTERVAL,
        received: closeReceiveJson(ackAtInitiator.close),
        verdict: initiator.machine.verdict ?? null,
      },
    });
    initiator.session.erase();
    responder.session.erase();
  }

  return {
    file: "f11-authenticated-close.json",
    number: 11,
    title: "Authenticated close",
    sections: ["10.1", "10.1.1", "10.2", "10.4", "16.3 F11"],
    summary:
      "The §10 close machine driven end to end: the sequential clean close with all three records, their commitment preimages, and both Clean verdicts; the §16.3 F11 simultaneous table with its counters fixed, including the negative case whose ack declares the validator's current next-send instead of its anchor; the close anchor across an epoch boundary with its companion negative; passed-through, strict, commitment, and decode violations; the verdict-disambiguation cases; the close-phase keepalive prohibition and why it is load-bearing; `T_CLOSE` expiry at each waiting step; and the §3.2.2 L5 worst-case phase duration as a timed case.",
    deferred: [
      "Ordering and linger behavior (§10.3) beyond the timed phase-duration case is not expressible as a deterministic wire vector and belongs to implementation tests rather than to this corpus, exactly as §16.3 F11 states.",
      CLOSE_STEP_TRACE_DEFERRAL,
    ],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F12 — error records (§11) ───────────────────────────────────────────────

async function buildFamily12(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];
  const trace = IK_TRACE;

  cases.push({
    name: "handshake-reject-record",
    sections: ["3.3", "11.2"],
    note: "`E2EEHandshakeReject` carries no cause, no code, no text, and no variable field: there is nothing to parameterize, which is why the encoder takes no arguments. A received reject of any other length — or of the same length carrying anything else — is itself malformed.",
    inputs: {
      negotiationDiscriminator: E2EE_NEGOTIATION_DISCRIMINATOR,
      recordType: E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
      padBytes: E2EE_HANDSHAKE_REJECT_PAD_BYTES,
    },
    expected: {
      record: b(HANDSHAKE_REJECT_RECORD),
      recordBytes: HANDSHAKE_REJECT_RECORD.byteLength,
      handshakeRejectBytes: E2EE_HANDSHAKE_REJECT_BYTES,
      bound: e2eeNegotiationRecordBound(
        E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
      ) as unknown as JsonValue,
      direction: e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT),
      decodesToItself: decodeE2eeNegotiationRecord(HANDSHAKE_REJECT_RECORD).kind === "ok",
      onePaddingBitFlipped: rejected(() => {
        const flipped = flipBit(HANDSHAKE_REJECT_RECORD, HANDSHAKE_REJECT_RECORD.byteLength - 1);
        const decoded = decodeE2eeNegotiationRecord(flipped);
        if (decoded.kind === "error") throw new Error(decoded.reason);
        return decoded;
      }),
    },
  });

  // ── byte-identity across the four approval-membership classes §11.2 names ─
  const helloForRejects = (() => {
    const client = makeClientHandshake({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture reject hello failed.");
    return hello.record;
  })();
  const mismatchedContextHello = craftHello({
    contextBlock: encodeE2eeAuthorizationContext(
      nativeContextInput({ nodeIdentityFingerprint: new Uint8Array(32).fill(0x09) }),
    ),
  });

  const rejectCauses: readonly {
    readonly name: string;
    readonly cause: string;
    readonly hello: Uint8Array;
    readonly authorization?: E2eeClientAuthorization | undefined;
  }[] = [
    {
      name: "absent-branch-a-record",
      cause: "no Branch A record",
      hello: helloForRejects,
      authorization: undefined,
    },
    {
      name: "pending-branch-a-record",
      cause: "a `pending` record",
      hello: helloForRejects,
      authorization: {
        status: "pending",
        maxRole: "owner",
        capabilitySet: [CHANNEL_OPEN_CAPABILITY],
      },
    },
    {
      name: "revoked-branch-a-record",
      cause: "a `revoked` record",
      hello: helloForRejects,
      authorization: {
        status: "revoked",
        maxRole: "owner",
        capabilitySet: [CHANNEL_OPEN_CAPABILITY],
      },
    },
    {
      name: "context-commitment-mismatch",
      cause: "a context-commitment mismatch",
      hello: mismatchedContextHello,
    },
  ];

  const rejectOutcomes = rejectCauses.map((entry) => {
    const node = makeNodeHandshake(
      "authorization" in entry ? { authorization: entry.authorization } : {},
    );
    const result = node.receiveHello(entry.hello, NOW);
    if (result.kind === "accepted") throw new Error("Fixture reject case was accepted.");
    return { entry, result };
  });

  for (const { entry, result } of rejectOutcomes) {
    cases.push({
      name: `handshake-reject-is-byte-identical-for-${entry.name}`,
      sections: ["11.2", "11.5"],
      note: `Cause: ${entry.cause}. §11.2 forbids approval membership, parser detail, transcript values, and node-local owner state from being distinguishable from the wire response, so the record BYTES, the record count, the close reason, and the application-payload count are identical across all four.`,
      inputs: {
        clientHello: b(entry.hello),
        branchARecord:
          "authorization" in entry
            ? entry.authorization === undefined
              ? null
              : {
                  status: entry.authorization.status,
                  maxRole: entry.authorization.maxRole,
                  capabilitySet: [...entry.authorization.capabilitySet],
                }
            : {
                status: APPROVED_AUTHORIZATION.status,
                maxRole: APPROVED_AUTHORIZATION.maxRole,
                capabilitySet: [...APPROVED_AUTHORIZATION.capabilitySet],
              },
      },
      expected: {
        ...(handshakeFailureJson(result) as Record<string, JsonValue>),
        disposition: "FATAL-PRE",
        observable: preKeyObservable(),
      },
    });
  }

  cases.push({
    name: "handshake-reject-bytes-do-not-vary-by-cause",
    sections: ["11.2", "11.5", "16.3 F12"],
    note: "The four causes above are precisely the approval-membership classes §11.2 forbids distinguishing. Their §11.2 ROWS differ — three are P12 and one is P13 — and that is a local diagnostic; what reaches the wire is one record, and it is the same record.",
    inputs: {
      causes: rejectCauses.map((entry) => entry.name),
    },
    expected: {
      rows: rejectOutcomes.map(({ result }) => (result as unknown as E2eeHandshakeFailure).row),
      record: b(HANDSHAKE_REJECT_RECORD),
      recordBytes: HANDSHAKE_REJECT_RECORD.byteLength,
      allCausesProduceIdenticalBytes: true,
      closeReason: "channel_rejected",
      applicationPayloadBytes: 0,
    },
  });

  // ── one `E2EEError` envelope per defined code ────────────────────────────
  const errorCodes: readonly { readonly code: E2eeErrorCode; readonly name: string }[] = [
    { code: E2EE_ERROR_CODE_PROTOCOL_VIOLATION, name: "protocol_violation" },
    { code: E2EE_ERROR_CODE_INTERNAL, name: "internal" },
    { code: E2EE_ERROR_CODE_POLICY, name: "policy" },
  ];
  const errorEnvelopes: { readonly name: string; readonly bytes: number }[] = [];
  for (const entry of errorCodes) {
    const session = traceSession(trace, E2EE_DIRECTION_CLIENT_TO_NODE);
    const receiver = traceSession(trace, E2EE_DIRECTION_NODE_TO_CLIENT);
    const body = encodeE2eeErrorRecordBody(entry.code);
    const sent = await protectOrThrow(session, E2EE_INNER_TYPE_ERROR, body);
    const received = receiver.unprotect(sent.envelope);
    const decodedBody =
      received.kind === "authenticated" ? decodeE2eeErrorRecordBody(received.body) : undefined;
    errorEnvelopes.push({ name: entry.name, bytes: sent.envelopeBytes });
    cases.push({
      name: `error-record-${entry.name}`,
      sections: ["11.3"],
      inputs: { errorCode: entry.code, errorCodeName: entry.name },
      expected: {
        body: b(body),
        bodyBytes: body.byteLength,
        errorBodyMaxBytes: E2EE_ERROR_BODY_MAX_BYTES,
        envelope: b(sent.envelope),
        envelopeBytes: sent.envelopeBytes,
        position: seq({ epoch: sent.epoch, counter: sent.counter }),
        received: unprotectResultJson(received),
        decodedErrorCode: decodedBody?.kind === "ok" ? decodedBody.value.errorCode : null,
      },
    });
    session.erase();
    receiver.erase();
  }

  // ── the §16.3 F3 node-side companions, whose byte-identity is against the
  //    reject vector above ───────────────────────────────────────────────────
  {
    const outsideRange = makeNodeHandshake({
      advertisedVersionMin: 2,
      advertisedVersionMax: 3,
    }).receiveHello(helloForRejects, NOW);
    cases.push({
      name: "node-side-companion-hello-outside-the-advertised-protocol-range",
      sections: ["5.2 step 8", "7.6 elements 7-8", "8.6 step 2", "11.2 P9", "11.5"],
      note: "The §16.3 F3 node-side companion: a hello whose `e2eeVersion` lies outside the range the node advertised on that channel. It is P9 at §8.6 step 2, and its §11.5 observable is byte-identical to the reject cases above — which is the enforcement that remains when a client leaves elements 7–8 unconsumed.",
      inputs: {
        advertisedVersionMin: 2,
        advertisedVersionMax: 3,
        helloE2eeVersion: E2EE_PROTOCOL_VERSION,
        clientHello: b(helloForRejects),
      },
      expected: {
        ...(handshakeFailureJson(outsideRange) as Record<string, JsonValue>),
        disposition: "FATAL-PRE",
        observable: preKeyObservable(),
      },
    });
  }

  {
    const nxClient = makeClientHandshake({ tier: "web" });
    const nxHello = nxClient.createHello(NOW);
    if (nxHello.kind !== "hello") throw new Error("Fixture NX companion hello failed.");
    const refused = makeNodeHandshake({
      policy: {
        requireApprovedClientE2EE: true,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      },
    }).receiveHello(nxHello.record, NOW);
    cases.push({
      name: "node-side-companion-nx-hello-under-require-approved-client-e2ee",
      sections: ["5.2 step 9", "7.6 element 14", "8.6 step 2", "12.4", "11.2 P9", "11.5"],
      note: 'The §16.3 F3 node-side companion for the admitted-pattern rule: an NX hello delivered to a node running `requireApprovedClientE2EE`, whose effective admitted pattern set is exactly `["IK"]`. This is the enforcement that remains when a client ignores element 14, and its observable is byte-identical to every other reject.',
      inputs: {
        requireApprovedClientE2EE: true,
        effectiveAdmittedPatterns: [...e2eeEffectiveAdmittedPatterns(true)],
        helloTier: "web",
        clientHello: b(nxHello.record),
      },
      expected: {
        ...(handshakeFailureJson(refused) as Record<string, JsonValue>),
        disposition: "FATAL-PRE",
        observable: preKeyObservable(),
      },
    });
  }

  cases.push({
    name: "every-error-envelope-is-length-identical",
    sections: ["11.3", "11.5"],
    note: "Every defined code encodes to the same body length, so the relay observes only that one more fixed-size encrypted record was sent. This is what makes the §11.5 post-key observable 'at most one length-uniform encrypted record'.",
    inputs: { codes: errorCodes.map((entry) => entry.name) },
    expected: {
      envelopeBytes: errorEnvelopes.map((entry) => entry.bytes),
      allLengthsIdentical: new Set(errorEnvelopes.map((entry) => entry.bytes)).size === 1,
    },
  });

  return {
    file: "f12-error-records.json",
    number: 12,
    title: "Error records",
    sections: ["11.2", "11.3", "11.5", "16.3 F12"],
    summary:
      "The exact `E2EEHandshakeReject` bytes and the proof they do not vary by cause — an absent Branch A record, a `pending` record, a `revoked` record, and a context-commitment mismatch, which are precisely the approval-membership classes §11.2 forbids distinguishing — plus one `E2EEError` envelope per defined §11.3 code and the assertion that all three envelopes are length-identical.",
    deferred: [
      "Reject TIMING is deliberately not a fixture assertion: the §11.2 ordering rule that keeps the durable pending write off the response path constrains an implementation, not a wire vector (§16.3 F12).",
    ],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F16 — authorization context and Branch A enforcement (§8.3, §13.6) ──────
//
// This family exists because the §2.2 active-Hub row rests entirely on the §8.3
// exact-equality rules and the §13.6 ceiling, and an implementation that never
// compared those elements would otherwise pass the whole corpus.

/** A lineage one rotation LONGER than the chain bound, for the §7.5 prune cases. */
const EXT_CHAIN_SEEDS = Array.from({ length: E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 2 }, (_u, index) =>
  seedOf(0x30 + index),
);
const EXT_CHAIN_PUBLIC = EXT_CHAIN_SEEDS.map((seed) => ed25519.getPublicKey(seed));
const EXT_CHAIN_KEY_IDS = EXT_CHAIN_SEEDS.map(
  (_unused, index) => `nkey_${String.fromCharCode(0x4a + index).repeat(22)}`,
);
const EXT_LINEAGE = buildContinuityLineage({
  hubOrigin: HUB_ORIGIN,
  continuityId: CONTINUITY_ID,
  seeds: EXT_CHAIN_SEEDS,
  publicKeys: EXT_CHAIN_PUBLIC,
  keyIds: EXT_CHAIN_KEY_IDS,
  firstGeneration: 1,
  createdAt: CREATED_AT,
});
const EXT_TRANSCRIPTS = EXT_LINEAGE.entries.map((entry) => entry.transcript);

/** The §8.3 element index of each field, so a reader can locate a mutation. */
const CONTEXT_ELEMENTS = {
  hubOrigin: 1,
  channelId: 2,
  nodeId: 7,
  nodeIdentityFingerprint: 9,
  accountId: 10,
  clientIntendedCapability: 11,
  clientIntendedRole: 12,
  channelOpenCapability: 13,
  channelOpenEffectiveRole: 14,
  nodeCertificateFingerprints: 15,
  clientCertificateFingerprints: 16,
  nodeContinuityId: 17,
} as const;

function contextElementsJson(block: Uint8Array): JsonValue {
  const elements = decode(block) as unknown[];
  const fingerprints = elements[15] as readonly Uint8Array[];
  const clientFingerprints = elements[16] as readonly Uint8Array[];
  return {
    elementCount: elements.length,
    domain: elements[0] as string,
    hubOrigin: elements[1] as string,
    channelId: elements[2] as string,
    nodeId: elements[7] as string,
    nodeIdentityAlgorithm: elements[8] as string,
    nodeIdentityFingerprint: b(elements[9] as Uint8Array),
    accountId: elements[10] as string,
    clientIntendedCapability: elements[11] as string,
    clientIntendedRole: elements[12] as string,
    channelOpenCapability: elements[13] as string,
    channelOpenEffectiveRole: elements[14] as string,
    nodeCertificateFingerprints: fingerprints.map((value) => b(value)),
    nodeCertificateFingerprintCount: fingerprints.length,
    clientCertificateFingerprints: clientFingerprints.map((value) => b(value)),
    nodeContinuityId: elements[17] as string,
  };
}

/** Deliver a crafted hello to a node and record its §11.2 outcome. */
function nodeOutcome(hello: Uint8Array, options: NodeHandshakeOverrides = {}): JsonValue {
  const result = makeNodeHandshake(options).receiveHello(hello, NOW);
  if (result.kind === "accepted") {
    eraseE2eeSessionSecrets(result.secrets);
    return { kind: "accepted", contextCommitment: b(result.contextCommitment) };
  }
  return {
    ...(handshakeFailureJson(result) as Record<string, JsonValue>),
    disposition: "FATAL-PRE",
    observable: preKeyObservable(),
  };
}

function buildFamily16(): FixtureFamily {
  const cases: FixtureCase[] = [];

  // ── the context block and commitment for both tiers ──────────────────────
  for (const [name, trace, tier] of [
    ["authorization-context-block-native-ik", IK_TRACE, "native"],
    ["authorization-context-block-web-nx", NX_TRACE, "web"],
  ] as const) {
    cases.push({
      name,
      sections: ["8.3"],
      note: "Both endpoints build the block independently from their own state and compare only the commitment (§8.6 step 7). Elements 10 and 16 are the ONLY tier-dependent elements: the web tier carries the empty string and the empty array, and element 17 has no absence form because the node it describes exists on both tiers.",
      inputs: {
        tier,
        hubOrigin: HUB_ORIGIN,
        channelId: CHANNEL_ID,
        relayProtocolMajor: RELAY_PROTOCOL_MAJOR,
        relayProtocolMinor: RELAY_PROTOCOL_MINOR,
        suiteId: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        nodeId: NODE_ID,
        continuityId: CONTINUITY_ID,
        continuityChainLength: 0,
        channelOpenCapability: CHANNEL_OPEN_CAPABILITY,
        channelOpenEffectiveRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
        ...(tier === "native" ? { accountId: ACCOUNT_ID } : {}),
      },
      expected: {
        contextBlock: b(trace.contextBlock),
        contextCommitment: b(trace.contextCommitment),
        contextCommitmentBytes: trace.contextCommitment.byteLength,
        elements: contextElementsJson(trace.contextBlock),
        commitmentIsSha256OfTheBlock:
          hex(e2eeAuthorizationContextCommitment(trace.contextBlock)) ===
          hex(trace.contextCommitment),
      },
    });
  }

  // ── one case per single-element mutation ─────────────────────────────────
  const mutations: readonly {
    readonly name: string;
    readonly element: number;
    readonly sections: readonly string[];
    readonly note: string;
    readonly hello: Uint8Array;
    readonly contextBlock: Uint8Array;
    readonly node?: NodeHandshakeOverrides;
    readonly extraExpected?: Record<string, JsonValue>;
  }[] = [
    (() => {
      const block = encodeE2eeAuthorizationContext(
        nativeContextInput({ nodeIdentityFingerprint: new Uint8Array(32).fill(0x09) }),
      );
      return {
        name: "element-9-node-fingerprint-substitution",
        element: CONTEXT_ELEMENTS.nodeIdentityFingerprint,
        sections: ["8.3", "8.6 step 7", "11.2 P13"],
        note: "The node rebuilds element 9 from the identity fingerprint it ADVERTISED on this channel, so a substituted value cannot survive the commitment comparison.",
        hello: craftHello({ contextBlock: block }),
        contextBlock: block,
      };
    })(),
    (() => {
      const block = encodeE2eeAuthorizationContext(
        nativeContextInput({
          client: {
            tier: "native",
            accountId: OTHER_ACCOUNT_ID,
            identityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
            agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
          },
        }),
      );
      return {
        name: "element-10-cross-account-splice",
        element: CONTEXT_ELEMENTS.accountId,
        sections: ["8.3", "8.6 step 7", "11.2 P13"],
        note: "The node builds element 10 from the AUTHENTICATED IK payload claims and the account id bound in the client certificate, so a context naming a different account does not match the one the certificate carries.",
        hello: craftHello({ contextBlock: block }),
        contextBlock: block,
      };
    })(),
    (() => {
      // The relay contract's version-1 capability vocabulary holds exactly one
      // literal, so a conforming encoder CANNOT build a block whose element 11
      // differs from element 13. The mismatch is therefore reachable only as a
      // peer-supplied mutation of the canonical bytes, which is exactly the shape
      // §16.3 asks a negative case to take.
      const block = mutateElement(
        encodeE2eeAuthorizationContext(nativeContextInput()),
        CONTEXT_ELEMENTS.clientIntendedCapability,
        "ryco.not-a-relay-capability",
      );
      return {
        name: "element-11-capability-mismatch-against-element-13",
        element: CONTEXT_ELEMENTS.clientIntendedCapability,
        sections: ["8.3", "8.6 step 7", "11.2 P13"],
        note: "§8.3 requires element 11 to EQUAL element 13 at both endpoints. Version 1's relay capability vocabulary has a single member, so this block is a peer-supplied mutation rather than anything an encoder will produce; the authenticated payload claims still carry the granted capability, so the node's rebuilt block differs from the committed one.",
        hello: craftHello({ contextBlock: block }),
        contextBlock: block,
      };
    })(),
    (() => {
      const block = encodeE2eeAuthorizationContext(
        nativeContextInput({ clientIntendedRole: "owner" }),
      );
      return {
        name: "element-12-role-escalation-above-element-14",
        element: CONTEXT_ELEMENTS.clientIntendedRole,
        sections: ["8.3", "8.6 step 5", "11.2 P13"],
        note: "The client commits to `owner` while the `channel.open` it received granted `operator`.",
        hello: craftHello({ contextBlock: block, claims: { intendedRole: "owner" } }),
        contextBlock: block,
      };
    })(),
    (() => {
      const block = encodeE2eeAuthorizationContext(
        nativeContextInput({ clientIntendedRole: "viewer" }),
      );
      return {
        name: "element-12-role-reduction-below-element-14",
        element: CONTEXT_ELEMENTS.clientIntendedRole,
        sections: ["8.3", "8.6 step 5", "11.2 P13"],
        note: "A SILENT ROLE REDUCTION is a context mismatch too: §8.3 makes a difference in EITHER direction fatal, and the handshake fails rather than proceeding at the lower authority.",
        hello: craftHello({ contextBlock: block, claims: { intendedRole: "viewer" } }),
        contextBlock: block,
      };
    })(),
    (() => {
      const block = encodeE2eeAuthorizationContext(
        nativeContextInput({ nodeContinuityId: OTHER_CONTINUITY_ID }),
      );
      return {
        name: "element-17-continuity-id-substitution-never-rotated-node",
        element: CONTEXT_ELEMENTS.nodeContinuityId,
        sections: ["7.5", "8.3", "8.6 step 7", "11.2 P13"],
        note: "The node has NEVER ROTATED, so its §7.6 element 11 chain is empty and element 15 carries no chain digest: element 17 is the only place the continuity id is bound. This is the run that exercises the gap element 17 exists to close — a corpus carrying only the max-chain run below would pass against an implementation that omitted element 17 entirely.",
        hello: craftHello({ contextBlock: block }),
        contextBlock: block,
        extraExpected: {
          // §8.3: the responder rebuilds element 17 from its OWN stored
          // continuity id, as of the advertisement it emitted on this channel.
          // A node whose stored id IS the substituted one accepts the identical
          // hello, which is what proves the value never comes from the wire. A
          // mutated statement element 18 delivered to a pinned client is a §5.2
          // step 6 channel-fatal BEFORE any hello (family F3), not a P13.
          acceptedByANodeWhoseStoredContinuityIdIsTheSubstitutedOne: nodeOutcome(
            craftHello({
              contextBlock: encodeE2eeAuthorizationContext(
                nativeContextInput({ nodeContinuityId: OTHER_CONTINUITY_ID }),
              ),
            }),
            { advertised: advertisedMaterial({ continuityId: OTHER_CONTINUITY_ID }) },
          ),
          element15EntryCount: 1,
          element15CarriesNoChainDigest: true,
        },
      };
    })(),
    (() => {
      const chain = MAX_LINEAGE_SHORT_ORIGIN.entries.map((entry) => entry.transcript);
      const identityFingerprint = e2eeKeyFingerprint(
        "node-identity",
        MAX_CHAIN_PUBLIC[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!,
      );
      const block = encodeE2eeAuthorizationContext(
        nativeContextInput({
          nodeIdentityFingerprint: identityFingerprint,
          nodeContinuityChainTranscripts: chain,
          nodeContinuityId: OTHER_CONTINUITY_ID,
        }),
      );
      return {
        name: "element-17-continuity-id-substitution-max-length-chain",
        element: CONTEXT_ELEMENTS.nodeContinuityId,
        sections: ["7.5", "8.3", "8.6 step 7", "11.2 P13"],
        note: "The same substitution against a node at `E2EE_CONTINUITY_CHAIN_MAX_LENGTH`, where element 15 already binds the id transitively through every chain-certificate digest. Both runs are required: only the never-rotated one isolates element 17.",
        hello: craftHello({ contextBlock: block }),
        contextBlock: block,
        node: {
          advertised: advertisedMaterial({
            nodeIdentityFingerprint: identityFingerprint,
            continuityChainTranscripts: chain,
          }),
        },
        extraExpected: {
          element15EntryCount: 1 + chain.length,
          element15CarriesNoChainDigest: false,
        },
      };
    })(),
    (() => {
      const block = encodeE2eeAuthorizationContext(nativeContextInput());
      return {
        name: "commitment-over-different-bytes-than-the-block",
        element: -1,
        sections: ["8.3", "8.6 step 7", "11.2 P13"],
        note: "A well-formed context block presented under a `contextCommitment` computed over DIFFERENT bytes. The responder rebuilds the block from its own state and compares only the commitment, so the preimage the client actually holds never reaches it.",
        hello: craftHello({ contextBlock: block, commitment: NX_TRACE.contextCommitment }),
        contextBlock: block,
      };
    })(),
    (() => {
      const block = encodeE2eeAuthorizationContext(nativeContextInput());
      return {
        name: "nx-absence-semantics-violated",
        element: CONTEXT_ELEMENTS.accountId,
        sections: ["8.3", "8.6 step 7", "11.2 P13"],
        note: "A web-tier hello whose context carries a nonempty element 10 AND a nonempty element 16. The two are inseparable by construction — `E2eeAuthorizationContextClient` is a discriminated union, which is what makes the §8.3 absence semantics unrepresentable-wrong in a conforming encoder — so one case covers both halves of the rule.",
        hello: craftHello({ contextBlock: block, noiseTier: "web" }),
        contextBlock: block,
      };
    })(),
  ];

  for (const mutation of mutations) {
    cases.push({
      name: mutation.name,
      sections: mutation.sections,
      note: mutation.note,
      inputs: {
        mutatedElement: mutation.element < 0 ? null : mutation.element,
        contextBlock: b(mutation.contextBlock),
        contextCommitment: b(e2eeAuthorizationContextCommitment(mutation.contextBlock)),
        clientHello: b(mutation.hello),
      },
      expected: {
        ...(nodeOutcome(mutation.hello, mutation.node ?? {}) as Record<string, JsonValue>),
        ...mutation.extraExpected,
      },
    });
  }

  // ── the suite-list strip ─────────────────────────────────────────────────
  {
    const client = makeClientHandshake({
      tier: "native",
      offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256, 2],
    });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture suite-strip hello failed.");
    const helloBody = (decode(hello.record.subarray(2)) as unknown[]).slice();
    helloBody[3] = [E2EE_SUITE_25519_CHACHAPOLY_SHA256];
    const strippedRecord = encodeE2eeNegotiationRecord(
      E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
      encodeCanonical(helloBody),
    );
    const node = makeNodeHandshake();
    const accept = node.receiveHello(strippedRecord, NOW);
    if (accept.kind !== "accepted") throw new Error("Fixture suite-strip node did not accept.");
    eraseE2eeSessionSecrets(accept.secrets);
    const clientResult = client.receiveServerAccept(accept.record, NOW);
    cases.push({
      name: "suite-list-strip-after-the-hello-was-hashed",
      sections: ["8.5", "8.7", "8.8 step 5", "11.2 P16"],
      note: "`offeredSuites` mutated in transit AFTER the client hashed its own hello wire bytes. Every node-side check passes — the stripped list still contains the selected suite — so the node's `confirmationTranscript` covers the STRIPPED bytes while the client's covers the original, and the confirmation MAC does not match. §8.7 hashes exact hello wire bytes precisely so this is detectable.",
      inputs: {
        offeredSuitesAsSent: [E2EE_SUITE_25519_CHACHAPOLY_SHA256, 2],
        offeredSuitesAsDelivered: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
        clientHelloAsSent: b(hello.record),
        clientHelloAsDelivered: b(strippedRecord),
      },
      expected: {
        nodeAccepted: true,
        serverAccept: b(accept.record),
        clientVerdict: handshakeFailureJson(clientResult),
        disposition: "FATAL-PRE",
        clientEmitsNoRecord: true,
        closeReason: "channel_rejected",
      },
    });
  }

  // ── advertised-snapshot cases (§8.3 construction rules, §7.5, §8.6 step 7) ─
  {
    const advertisedChain = EXT_TRANSCRIPTS.slice(0, 2);
    const currentChain = EXT_TRANSCRIPTS.slice(0, 3);
    const advertisedFingerprint = e2eeKeyFingerprint("node-identity", EXT_CHAIN_PUBLIC[2]!);
    const currentFingerprint = e2eeKeyFingerprint("node-identity", EXT_CHAIN_PUBLIC[3]!);
    const advertised = advertisedMaterial({
      nodeIdentityFingerprint: advertisedFingerprint,
      continuityChainTranscripts: advertisedChain,
    });
    const current = advertisedMaterial({
      nodeIdentityFingerprint: currentFingerprint,
      continuityChainTranscripts: currentChain,
    });
    const client = makeClientHandshake({ tier: "native", advertised });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture rotation hello failed.");
    const againstAdvertised = nodeOutcome(hello.record, { advertised });
    const againstCurrent = nodeOutcome(hello.record, { advertised: current });
    cases.push({
      name: "identity-rotation-between-advertisement-and-hello",
      sections: ["7.5", "8.3", "8.6 step 7"],
      note: "The node rotated its identity and appended a continuity certificate AFTER emitting the advertisement and BEFORE the hello arrived. The handshake completes against the chain and identity fingerprint the statement advertised; rebuilding element 15 from the node's CURRENT chain yields a different context and fails as P13, which is the implementation this rule exists to exclude. The client's element 15 is unchanged because it has only the validated statement to build from.",
      inputs: {
        advertisedChainLength: advertisedChain.length,
        currentChainLength: currentChain.length,
        advertisedIdentityFingerprint: b(advertisedFingerprint),
        currentIdentityFingerprint: b(currentFingerprint),
        clientHello: b(hello.record),
      },
      expected: {
        contextBlock: b(hello.contextBlock),
        elements: contextElementsJson(hello.contextBlock),
        againstTheAdvertisedSnapshot: againstAdvertised,
        againstTheNodesCurrentState: againstCurrent,
      },
    });
  }

  {
    const advertisedChain = EXT_TRANSCRIPTS.slice(0, E2EE_CONTINUITY_CHAIN_MAX_LENGTH);
    const prunedEntry = EXT_TRANSCRIPTS[0]!;
    const currentChain = EXT_TRANSCRIPTS.slice(1, E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1);
    const advertisedFingerprint = e2eeKeyFingerprint(
      "node-identity",
      EXT_CHAIN_PUBLIC[E2EE_CONTINUITY_CHAIN_MAX_LENGTH]!,
    );
    const currentFingerprint = e2eeKeyFingerprint(
      "node-identity",
      EXT_CHAIN_PUBLIC[E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1]!,
    );
    const advertised = advertisedMaterial({
      nodeIdentityFingerprint: advertisedFingerprint,
      continuityChainTranscripts: advertisedChain,
    });
    const current = advertisedMaterial({
      nodeIdentityFingerprint: currentFingerprint,
      continuityChainTranscripts: currentChain,
    });
    const client = makeClientHandshake({ tier: "native", advertised });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture prune hello failed.");
    const elements = decode(hello.contextBlock) as unknown[];
    const fingerprints = (elements[15] as readonly Uint8Array[]).map((value) => hex(value));
    cases.push({
      name: "identity-rotation-at-max-chain-length-prunes-the-oldest-entry",
      sections: ["7.5", "8.3", "8.6 step 7", "15"],
      note: "At `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` the append also PRUNES the oldest entry, so the node's current chain no longer contains it — but the channel's element 15 still carries its digest, because §7.5 requires the node to retain the advertised snapshot for the channel's lifetime.",
      inputs: {
        chainMaxLength: E2EE_CONTINUITY_CHAIN_MAX_LENGTH,
        advertisedChainLength: advertisedChain.length,
        currentChainLength: currentChain.length,
        prunedEntryTranscript: b(prunedEntry),
        clientHello: b(hello.record),
      },
      expected: {
        contextBlock: b(hello.contextBlock),
        element15EntryCount: fingerprints.length,
        prunedEntryDigest: { $bytes: sha256Hex(prunedEntry) },
        prunedEntryDigestStillPresentInElement15: fingerprints.includes(sha256Hex(prunedEntry)),
        againstTheAdvertisedSnapshot: nodeOutcome(hello.record, { advertised }),
        againstTheNodesCurrentState: nodeOutcome(hello.record, { advertised: current }),
      },
    });
  }

  {
    // §6.4: a prekey rotation in the same window. The channel's context and the
    // Noise responder static are both the ADVERTISED prekey, so the handshake
    // completes; a context rebuilt from the rotated prekey has a different
    // element 15 entry 0 and would fail step 7.
    const rotatedSecret = seedOf(0x15);
    const rotatedPublic = x25519.getPublicKey(rotatedSecret);
    const rotatedFingerprint = e2eeKeyFingerprint("agreement", rotatedPublic);
    const advertised = advertisedMaterial();
    const client = makeClientHandshake({ tier: "native", advertised });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture prekey-rotation hello failed.");
    const rotatedContext = encodeE2eeAuthorizationContext(
      nativeContextInput({ nodeAgreementFingerprint: rotatedFingerprint }),
    );
    const elements = decode(hello.contextBlock) as unknown[];
    const entryZero = (elements[15] as readonly Uint8Array[])[0]!;
    cases.push({
      name: "prekey-rotation-between-advertisement-and-hello",
      sections: ["6.4", "8.3", "8.6 step 7"],
      note: "The handshake completes against the prekey advertised ON THIS CHANNEL, and element 15 entry 0 is that prekey's agreement fingerprint. The counterfactual is stated as a commitment comparison rather than a second run, because a node answering with the rotated STATIC would fail in the Noise layer first and would prove nothing about element 15.",
      inputs: {
        advertisedAgreementPublicKey: b(NODE_AGREEMENT_PUBLIC),
        testOnlyRotatedAgreementSecretKey: b(rotatedSecret),
        rotatedAgreementPublicKey: b(rotatedPublic),
      },
      expected: {
        element15EntryZero: b(entryZero),
        element15EntryZeroIsTheAdvertisedAgreementFingerprint:
          hex(entryZero) === hex(NODE_AGREEMENT_FINGERPRINT),
        againstTheAdvertisedSnapshot: nodeOutcome(hello.record, { advertised }),
        rotatedContextCommitment: b(e2eeAuthorizationContextCommitment(rotatedContext)),
        rotatedContextDiffers:
          hex(e2eeAuthorizationContextCommitment(rotatedContext)) !== hex(hello.contextCommitment),
      },
    });
  }

  {
    // The next channel opened after either change carries the NEW material: the
    // snapshot is per channel and never a freeze of the node.
    const currentChain = EXT_TRANSCRIPTS.slice(0, 3);
    const currentFingerprint = e2eeKeyFingerprint("node-identity", EXT_CHAIN_PUBLIC[3]!);
    const advertised = advertisedMaterial({
      nodeIdentityFingerprint: currentFingerprint,
      continuityChainTranscripts: currentChain,
    });
    const channel = handshakeChannel({ channelId: OTHER_CHANNEL_ID });
    const client = makeClientHandshake({ tier: "native", channel, advertised });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture next-channel hello failed.");
    cases.push({
      name: "next-channel-carries-the-new-material",
      sections: ["5.1", "7.5", "8.3", "15"],
      note: "The per-channel snapshot pins IDENTITY MATERIAL for the channel that carried the statement; it is not a freeze of the node. A channel opened after the rotation advertises and commits to the new chain and the new identity fingerprint.",
      inputs: {
        channelId: OTHER_CHANNEL_ID,
        chainLength: currentChain.length,
        identityFingerprint: b(currentFingerprint),
      },
      expected: {
        contextBlock: b(hello.contextBlock),
        elements: contextElementsJson(hello.contextBlock),
        accepted: nodeOutcome(hello.record, { channel, advertised }),
      },
    });
  }

  // ── Branch A record-state cases ──────────────────────────────────────────
  const branchAHello = (() => {
    const client = makeClientHandshake({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture Branch A hello failed.");
    return hello.record;
  })();
  const branchARecords: readonly {
    readonly name: string;
    readonly record: E2eeClientAuthorization | undefined;
    readonly note: string;
  }[] = [
    { name: "absent", record: undefined, note: "no record for this key at all" },
    {
      name: "pending",
      record: { status: "pending", maxRole: "owner", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
      note: "a record awaiting the owner's approval",
    },
    {
      name: "revoked",
      record: { status: "revoked", maxRole: "owner", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
      note: "a record the owner revoked",
    },
    {
      name: "approved-capability-set-excludes-the-requested-capability",
      record: { status: "approved", maxRole: "owner", capabilitySet: [] },
      note: "an approved record whose `capabilitySet` does not contain the requested capability — the empty set, because version 1's relay capability vocabulary has exactly one member",
    },
    {
      name: "approved-max-role-below-the-requested-role",
      record: { status: "approved", maxRole: "viewer", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
      note: "an approved record whose `maxRole` is below the requested `operator` under the §8.3 ordering",
    },
  ];
  for (const entry of branchARecords) {
    cases.push({
      name: `branch-a-record-${entry.name}`,
      sections: ["8.6 step 6", "11.2 P12", "11.5", "13.6"],
      note: `The node's Branch A record for \`(hubOrigin, accountId, clientIdentityFingerprint)\` is ${entry.note}. All five record states expect P12 and the §11.5 observable is byte-identical across them and to the F12 reject cases: approval membership is exactly what §11.2 forbids distinguishing.`,
      inputs: {
        recordKey: {
          hubOrigin: HUB_ORIGIN,
          accountId: ACCOUNT_ID,
          clientIdentityFingerprint: b(CLIENT_IDENTITY_FINGERPRINT),
        },
        record:
          entry.record === undefined
            ? null
            : {
                status: entry.record.status,
                maxRole: entry.record.maxRole,
                capabilitySet: [...entry.record.capabilitySet],
              },
        requestedCapability: CHANNEL_OPEN_CAPABILITY,
        requestedRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
      },
      expected: nodeOutcome(branchAHello, { authorization: entry.record }),
    });
  }

  // ── §13.6 authorization-withdrawal cases ─────────────────────────────────
  const withdrawalSnapshot = IK_TRACE.admittedAuthority!;

  /** One §13.6 owner command applied to a channel's admitted-authority snapshot. */
  function withdrawalCase(options: {
    readonly name: string;
    readonly note: string;
    readonly changedKey?: E2eeClientAuthorizationKey;
    /** The record §8.6 step 6 read when the channel was admitted. */
    readonly admitted?: E2eeClientAuthorization;
    readonly record: E2eeClientAuthorization | undefined;
    readonly channelRole?: string;
    readonly extraExpected?: Record<string, JsonValue>;
  }): FixtureCase {
    const channelRole = options.channelRole ?? CHANNEL_OPEN_EFFECTIVE_ROLE;
    const channel = handshakeChannel({ channelOpenEffectiveRole: channelRole });
    const client = makeClientHandshake({
      tier: "native",
      channel,
      intendedRole: channelRole,
    });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture withdrawal hello failed.");
    const node = makeNodeHandshake({
      channel,
      ...(options.admitted === undefined ? {} : { authorization: options.admitted }),
    });
    const accept = node.receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("Fixture withdrawal channel was not admitted.");
    eraseE2eeSessionSecrets(accept.secrets);
    const snapshot = accept.admittedAuthority!;
    const changedKey = options.changedKey ?? {
      hubOrigin: snapshot.hubOrigin,
      accountId: snapshot.accountId,
      clientIdentityFingerprint: snapshot.clientIdentityFingerprint,
    };
    const keyMatches = e2eeAuthorizationKeysEqual(snapshot, changedKey);
    const withdrawn = keyMatches && e2eeAuthorizationWithdrawn(snapshot, options.record);
    const finish = node.authenticateImplicitFinish({
      now: NOW,
      reReadAuthorization: (key) =>
        e2eeAuthorizationKeysEqual(key, changedKey)
          ? options.record
          : {
              status: snapshot.status,
              maxRole: snapshot.maxRole,
              capabilitySet: [...snapshot.capabilitySet],
            },
    });
    return {
      name: options.name,
      sections: ["8.9", "11.3 Q9", "13.6"],
      note: options.note,
      inputs: {
        admittedAuthoritySnapshot: {
          hubOrigin: snapshot.hubOrigin,
          accountId: snapshot.accountId,
          clientIdentityFingerprint: b(snapshot.clientIdentityFingerprint),
          status: snapshot.status,
          maxRole: snapshot.maxRole,
          capabilitySet: [...snapshot.capabilitySet],
        },
        channelElement12Role: channelRole,
        changedRecordKey: {
          hubOrigin: changedKey.hubOrigin,
          accountId: changedKey.accountId,
          clientIdentityFingerprint: b(changedKey.clientIdentityFingerprint),
        },
        postChangeRecord:
          options.record === undefined
            ? null
            : {
                status: options.record.status,
                maxRole: options.record.maxRole,
                capabilitySet: [...options.record.capabilitySet],
              },
      },
      expected: {
        recordKeyMatches: keyMatches,
        withdrawn,
        implicitFinish:
          finish.kind === "finished"
            ? { kind: "finished" }
            : {
                kind: "fatal",
                row: finish.row,
                errorCode: finish.errorCode,
                reason: finish.reason,
              },
        channelStaysOpen: finish.kind === "finished",
        ...options.extraExpected,
      },
    };
  }

  cases.push(
    withdrawalCase({
      name: "withdrawal-status-approved-to-revoked",
      note: "`status` leaving `approved` is the first §13.6 transition: withdrawn, FATAL-POST Q9, code `policy`.",
      record: { status: "revoked", maxRole: "owner", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
    }),
  );
  for (const channelRole of ["owner", "viewer"] as const) {
    cases.push(
      withdrawalCase({
        name: `withdrawal-max-role-owner-to-viewer-channel-admitted-at-${channelRole}`,
        note: "`maxRole` reduced with `status` unchanged at `approved`. A STATUS-ONLY re-check passes this channel, which is exactly the defect the withdrawal test exists to close. The test reads the SNAPSHOT rather than the authority the channel is exercising, so both an `owner` channel and a `viewer` channel under the same `owner` ceiling are withdrawn.",
        record: { status: "approved", maxRole: "viewer", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
        channelRole,
        extraExpected: {
          statusStillApproved: true,
          aStatusOnlyRecheckWouldPassIt: true,
        },
      }),
    );
  }
  cases.push(
    withdrawalCase({
      name: "withdrawal-capability-set-loses-a-member",
      note: "`capabilitySet` no longer contains every member the snapshot held, with `maxRole` and `status` unchanged: withdrawn.",
      record: { status: "approved", maxRole: "owner", capabilitySet: [] },
    }),
    withdrawalCase({
      name: "widening-re-approval-is-not-a-withdrawal",
      note: "Re-approving the same record changes nothing the test reads: not withdrawn, and the channel stays open.",
      record: { status: "approved", maxRole: "owner", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
    }),
    withdrawalCase({
      name: "widening-max-role-increase-is-not-a-withdrawal",
      note: "The snapshot was admitted under an `operator` ceiling and the owner raised it to `owner`. Not withdrawn; the widened authority reaches the channel only on a fresh ticket, channel, and handshake.",
      admitted: {
        status: "approved",
        maxRole: "operator",
        capabilitySet: [CHANNEL_OPEN_CAPABILITY],
      },
      record: { status: "approved", maxRole: "owner", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
    }),
    withdrawalCase({
      name: "widening-capability-set-addition-is-not-a-withdrawal",
      note: "A capability added to the approved set, with `status` and `maxRole` unchanged: the new set is a superset of the old one, so nothing is withdrawn.",
      record: {
        status: "approved",
        maxRole: "owner",
        capabilitySet: [CHANNEL_OPEN_CAPABILITY, "ryco.future"],
      },
    }),
    withdrawalCase({
      name: "widening-first-approval-of-another-client-is-not-a-withdrawal",
      note: "A first approval names a DIFFERENT record key, so the full-key comparison does not match this channel's snapshot and the channel is untouched.",
      changedKey: {
        hubOrigin: HUB_ORIGIN,
        accountId: ACCOUNT_ID,
        clientIdentityFingerprint: new Uint8Array(32).fill(0x5c),
      },
      record: { status: "approved", maxRole: "owner", capabilitySet: [CHANNEL_OPEN_CAPABILITY] },
    }),
    withdrawalCase({
      name: "combined-narrow-and-widen-is-a-withdrawal",
      note: "One owner command that drops `owner` to `operator` while adding a capability IS a withdrawal: it contains a reduction, and the reduction governs.",
      record: {
        status: "approved",
        maxRole: "operator",
        capabilitySet: [CHANNEL_OPEN_CAPABILITY, "ryco.future"],
      },
    }),
    withdrawalCase({
      name: "withdrawal-under-a-different-account-scope",
      note: "The SAME client fingerprint under a different `(hubOrigin, accountId)` scope. A fingerprint-only sweep would close this channel; the full-key comparison §13.6 mandates does not, and the channel stays open.",
      changedKey: {
        hubOrigin: HUB_ORIGIN,
        accountId: OTHER_ACCOUNT_ID,
        clientIdentityFingerprint: withdrawalSnapshot.clientIdentityFingerprint,
      },
      record: undefined,
    }),
    withdrawalCase({
      name: "withdrawal-under-a-different-hub-origin",
      note: "The same client fingerprint and account under a different Hub origin: likewise not this channel's record.",
      changedKey: {
        hubOrigin: OTHER_HUB_ORIGIN,
        accountId: ACCOUNT_ID,
        clientIdentityFingerprint: withdrawalSnapshot.clientIdentityFingerprint,
      },
      record: undefined,
    }),
  );

  // The in-flight abort: a withdrawal landing between §8.6 step 6 and row N3.
  {
    const client = makeClientHandshake({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture in-flight hello failed.");
    const node = makeNodeHandshake({
      enterE2eeMode: () => ({ kind: "refused", reason: "authorization_withdrawn" }),
    });
    const result = node.receiveHello(hello.record, NOW);
    cases.push({
      name: "withdrawal-between-step-6-and-row-n3",
      sections: ["8.6 step 6", "8.6 step 8", "11.2 P12", "13.6"],
      note: "The owner's withdrawal committed after this handshake's step-6 read and before its row-N3 transition. The abort is FATAL-PRE and takes the GENERIC fixed-size `E2EEHandshakeReject`, byte-identical to the F12 reject cases — never a `policy` code, which exists only post-key.",
      inputs: {
        stepSixReadReturned: {
          status: APPROVED_AUTHORIZATION.status,
          maxRole: APPROVED_AUTHORIZATION.maxRole,
          capabilitySet: [...APPROVED_AUTHORIZATION.capabilitySet],
        },
        rowN3Transition: "refused: authorization_withdrawn",
      },
      expected: {
        ...(handshakeFailureJson(result) as Record<string, JsonValue>),
        disposition: "FATAL-PRE",
        errorCodeEmitted: null,
        observable: preKeyObservable(),
      },
    });
  }

  // An NX channel present while a withdrawal is applied.
  {
    const client = makeClientHandshake({ tier: "web" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture NX withdrawal hello failed.");
    const node = makeNodeHandshake();
    const accept = node.receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("Fixture NX channel was not admitted.");
    eraseE2eeSessionSecrets(accept.secrets);
    let reReads = 0;
    const finish = node.authenticateImplicitFinish({
      now: NOW,
      reReadAuthorization: () => {
        reReads += 1;
        return undefined;
      },
    });
    cases.push({
      name: "nx-channel-is-never-matched-by-an-authorization-withdrawal",
      sections: ["8.6 step 6", "8.9", "12.4", "13.6"],
      note: "NX carries no Branch A record and therefore no §8.6 step 6 snapshot, so no withdrawal can name an NX channel and there is nothing to re-read. The re-read callback is supplied and returns 'absent' — the most aggressive answer available — and is never invoked. §12.4 governs NX admission instead.",
      inputs: { tier: "web", reReadWouldReturn: null },
      expected: {
        admittedAuthority: accept.admittedAuthority === undefined ? null : "present",
        reReadInvocations: reReads,
        implicitFinish: { kind: finish.kind },
        channelStaysOpen: finish.kind === "finished",
      },
    });
  }

  return {
    file: "f16-authorization-context.json",
    number: 16,
    title: "Authorization context and Branch A enforcement",
    sections: ["8.3", "8.6", "8.7", "8.9", "11.3 Q9", "13.6", "16.3 F16"],
    summary:
      "The §8.3 context block and `contextCommitment` for both tiers, one case per single-element mutation with its mutated bytes and expected §11.2 row, the §8.7 suite-list strip surfaced as a confirmation failure, the §8.3 advertised-snapshot rules (identity rotation, a prune at the chain bound, a prekey rotation, and the next channel), the five Branch A record states with their byte-identical §11.5 observable, and the §13.6 withdrawal test over an admitted-authority snapshot including the full-key scope rule, the widenings, the combined narrow-and-widen command, the in-flight abort, and the NX channel that no withdrawal can name.",
    deferred: [
      "The §13.6 pending-cap and pairing-window cases — the cap-exceeding attempt with no window, the flood at `E2EE_PENDING_CLIENTS_MAX_GLOBAL`, the per-account and global eviction cases, the spent reservation, and the `E2EE_PAIRING_RESERVATION_LIFETIME` ageing case. They are node-state transitions over a durable pending set with reservations. The store that decides them now EXISTS — `NodeClientAuthorizationStore` and `NodeClientAuthorizationClient` in apps/server, which this generator sits under in the dependency graph and cannot import — and it is covered by its own module tests, but the transitions have not been transcribed into this corpus and no consuming test holds the runtime to a committed table of them, as family F10's rows and family F18's transitions now are. Owned by the node phase.",
      crossRuntimeDeferral(16),
    ],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F2 — capability carrier compatibility (§5.6, §5.5) ──────────────────────
//
// PARTIAL BY CONSTRUCTION. C1 and C6 are claims about THIS repository's own
// chunk assembler and about JSON whitespace, and both are derived below from the
// landed module. C2–C5 are claims about the behavior of the pinned third-party
// RPC client and of the node's RPC server: §5.6 scopes them normatively to
// `effect@4.0.0-beta.106` as patched, and requires the family to be RE-RUN
// against any new build before a changed pin lands. No shared module can produce
// their outcomes, so they are named in `deferred` rather than guessed at.

function buildFamily2(): FixtureFamily {
  const cases: FixtureCase[] = [];
  const carrier = buildStatement();
  const carrierBytes = utf8.encode(carrier.carrier);
  const preluded = new Uint8Array(RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES + carrierBytes.byteLength);
  preluded.set(RELAY_CHUNK_CAPABILITY_PRELUDE);
  preluded.set(carrierBytes, RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES);

  for (const [name, payload, preludePresent] of [
    ["c1-carrier-reassembly-with-the-prelude", preluded, true],
    ["c1-carrier-reassembly-without-the-prelude", carrierBytes, false],
  ] as const) {
    const assembler = new RelayMessageAssembler();
    const pushed = assembler.push(payload);
    const message = pushed.kind === "done" ? pushed.message : undefined;
    cases.push({
      name,
      sections: ["5.6 C1", "4.3 step 1", "3.4"],
      note: "The carrier can never enter the chunk parser: its first byte is `{`, not `RELAY_CHUNK_MAGIC`. With the prelude present the peer chunk-support latch is set exactly as for any other message, and the completed message equals the carrier JSON with the prelude stripped.",
      inputs: { wirePayload: b(payload), preludePresent },
      expected: {
        isChunkedPayload: isChunkedPayload(payload),
        assembler: { kind: pushed.kind },
        reassembled: message === undefined ? null : b(message),
        reassembledEqualsTheCarrier: message !== undefined && hex(message) === hex(carrierBytes),
        peerSupportsChunkingLatch: assembler.peerSupportsChunking,
        reassemblyError: null,
        step2Discrimination: {
          class: classifyPostStripPayload(message ?? payload).kind,
        },
      },
    });
  }

  {
    const decoder = new TextDecoder();
    const withPrelude = JSON.parse(decoder.decode(preluded)) as Record<string, unknown>;
    const withoutPrelude = JSON.parse(carrier.carrier) as Record<string, unknown>;
    cases.push({
      name: "c6-prelude-whitespace-tolerance",
      sections: ["5.6 C6", "3.4"],
      note: "A JSON parser consuming the UNSTRIPPED payload yields the identical object, because the prelude consists solely of JSON-permitted whitespace bytes. Clients that predate chunk reassembly therefore also ignore the carrier.",
      inputs: {
        prelude: b(RELAY_CHUNK_CAPABILITY_PRELUDE),
        unstrippedPayload: b(preluded),
      },
      expected: {
        preludeBytesAreAllJsonWhitespace: [...RELAY_CHUNK_CAPABILITY_PRELUDE].every((byte) =>
          [0x20, 0x09, 0x0a, 0x0d].includes(byte),
        ),
        parsedWithPrelude: JSON.stringify(withPrelude),
        parsedWithoutPrelude: JSON.stringify(withoutPrelude),
        identicalObject: JSON.stringify(withPrelude) === JSON.stringify(withoutPrelude),
        carrierTag: withPrelude._tag as string,
      },
    });
  }

  // ── the §5.5 carrier boundary pair ───────────────────────────────────────
  const maximumCarrier = utf8.encode(MAXIMUM_STATEMENT.carrier);
  {
    const prepared = prepareRelayMessage(maximumCarrier, {
      maxChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
      peerSupportsChunking: false,
    });
    const payload = prepared.kind === "ready" ? prepared.payloads[0]! : new Uint8Array();
    cases.push({
      name: "maximum-carrier-at-the-advertisement-floor",
      sections: ["5.5", "5.6", "3.2.1 S6"],
      note: "The maximum conforming carrier of F3 presented at an asserted `maxDataChunkBytes` of exactly `E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES`: it is emitted UNCHUNKED with the prelude intact, which is what §3.2.1 S6 exists to guarantee.",
      inputs: {
        assertedMaxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
        carrierBytes: MAXIMUM_STATEMENT.carrierBytes,
      },
      expected: {
        prepared: prepared.kind,
        payloadCount: prepared.kind === "ready" ? prepared.payloads.length : 0,
        chunked: isChunkedPayload(payload),
        preludePresent:
          payload.byteLength === maximumCarrier.byteLength + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
        wirePayloadBytes: payload.byteLength,
        carrierPlusPreludeBytes:
          MAXIMUM_STATEMENT.carrierBytes + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
        advertisementMinChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
        satisfiesS6:
          MAXIMUM_STATEMENT.carrierBytes + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES <=
          E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      },
    });
  }

  cases.push({
    name: "undersized-connection-one-byte-below-the-advertisement-floor",
    sections: ["5.5 U1", "12.5", "11.4"],
    note: "§5.5 U1 is a decision about the CONNECTION, not about a message: an asserted `maxDataChunkBytes` strictly below `E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES` suppresses the advertisement entirely, whatever the carrier's own size. The comparison is derived here; the suppression, the single `undersized-connection` occurrence, the absence of a peer-legacy occurrence, and FATAL-PRE under effective `requireE2EE` are the node's §12.5 accounting and are named in this family's `deferred` list.",
    inputs: {
      assertedMaxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1,
      advertisementMinChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
    },
    expected: {
      connectionIsUndersized:
        E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 < E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      diagnosticCode: "e2ee_advertisement_unavailable",
      diagnosticReasonLabel: "undersized-connection",
    },
  });

  return {
    file: "f02-carrier-compatibility.json",
    number: 2,
    title: "Capability carrier compatibility",
    sections: ["5.5", "5.6", "16.3 F2"],
    summary:
      "The §5.6 compatibility cases this repository's own modules decide: C1, the carrier through the client reassembly path with and without the prelude, and C6, the prelude's JSON-whitespace tolerance; plus the §5.5 carrier boundary at `E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES`, where the maximum conforming carrier of F3 is still emitted unchunked with the prelude intact.",
    deferred: [
      "Cases C2, C3, and C4 are behavioral claims about the PINNED third-party RPC client — its protocol-socket broadcast routing, its response dispatcher's default branch, and the client-runtime connection wrapper. §5.6 scopes them normatively to `effect@4.0.0-beta.106` as patched by `patches/effect@4.0.0-beta.106.patch`, and no shared module can produce their outcomes. They require a harness that drives the real decoder, and §5.6 requires that harness to be RE-RUN against any new build before a changed `effect` pin — or a changed patch touching its RPC client — lands. The current build is exercised by `apps/web/src/rpc/wsTransport.test.ts`. Owned by the §5.6 compatibility harness.",
      "Case C5, the node-direction hazard, is the defect reply the node's RPC server emits for an unknown request tag. It is a property of the pinned RPC server rather than of any protocol structure, and it is what makes the carrier direction node-to-client only. Owned by the §5.6 compatibility harness, together with the node phase.",
      "The §5.5 U1 accounting half of the boundary pair — advertisement suppression, exactly one `undersized-connection` occurrence, NO peer-legacy occurrence, and FATAL-PRE `P2`/`P23` under effective `requireE2EE` — is node policy (§12.5) with no implementation in packages/shared/src, so THIS family carries only the comparison the decision reads, which IS emitted above. The accounting itself is family F10's rows N15–N17, emitted there and driven against the real advertiser by the node-side consuming test. Owned by the node phase.",
      crossRuntimeDeferral(2),
    ],
    testKeyMaterial: SHARED_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F10 — mode machine (§4.4) ───────────────────────────────────────────────
//
// The NODE half of §16.3 F10 is emitted; the CLIENT half is not, and the reason
// is different for each.
//
// The node's rows N1–N17 have an implementation: `NodeE2eeChannelSession` in
// apps/server is the §4.4 node mode machine, and it is what the node-side
// consuming test — `apps/server/src/hubConnector/relayE2eeNodeCorpus.test.ts` —
// drives each row of this family against. The rows are emitted here as §4.4's
// own table (state, input class, guards → action, next state, §11 row), because
// this generator sits UNDER apps/server in the dependency graph and cannot
// import the runtime: `scripts` depends on `@ryco/shared`, `apps/server` depends
// on `scripts`'s dependencies and not the other way round, and inverting that to
// let a fixture generator import an application would be a worse trade than
// transcribing a normative table. What keeps the transcription honest is the
// node consuming test: every row below is replayed through the real session, on
// the real relay path, and a row whose action or next state the runtime does not
// produce fails there. Nothing asserts a §4.4 outcome that no implementation
// makes.
//
// Every value this generator CAN derive is still derived — the §4.3 step 2
// classification of each payload, the §11.5 pre-key observable's bytes, the
// negotiation-record bounds and directions — so a change to the wire module
// moves these files, not only the node's tests.
//
// The client rows K1–K24 stay deferred: they turn on the §12.1.1 selection
// classification and the §13.1 durable pin store, and neither is landed
// anywhere.

async function buildFamily10(): Promise<FixtureFamily> {
  const cases: FixtureCase[] = [];

  const helloRecord = IK_TRACE.helloRecord;
  const acceptRecord = IK_TRACE.serverAcceptRecord;
  // A well-formed envelope built through the §3.3 encoder. Its ciphertext is a
  // fixed pattern rather than a real AEAD output because nothing in this family
  // decrypts it: what the rows below turn on is the FIRST BYTE.
  const injectedEnvelope = encodeE2eeEnvelope({
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    epoch: 0n,
    counter: 0n,
    ciphertext: Uint8Array.from({ length: 17 }, (_u, index) => 0xa0 + index),
  });

  cases.push({
    name: "legacy-lock-injection-envelope-is-p5",
    sections: ["4.3 step 2", "4.4", "11.2 P5"],
    note: "An `0x01` envelope delivered to a channel that has locked `legacy`. It classifies as an envelope, which is P5 — a different §11.2 row from the negotiation record below, because §11.2's partition keeps them apart.",
    inputs: {
      modeMachineState: "legacy",
      postStripPayload: b(injectedEnvelope),
      firstByte: E2EE_ENVELOPE_DISCRIMINATOR,
    },
    expected: {
      step2Discrimination: { class: classifyPostStripPayload(injectedEnvelope).kind },
      fatal: "P5",
      disposition: "FATAL-PRE",
      sessionKeysExist: false,
    },
  });

  for (const [name, record, recordType, receivingEndpoint] of [
    [
      "legacy-lock-injection-client-hello-at-the-node-is-p24",
      helloRecord,
      E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
      "node",
    ],
    [
      "legacy-lock-injection-server-accept-at-the-client-is-p24",
      acceptRecord,
      E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
      "client",
    ],
  ] as const) {
    const bound = e2eeNegotiationRecordBound(recordType);
    const decoded = decodeE2eeNegotiationRecord(record);
    const expectedDirection = e2eeNegotiationRecordDirection(recordType);
    cases.push({
      name,
      sections: ["3.3", "3.4", "4.3 step 2", "4.4", "11.2 P24"],
      note: "A correctly sized, correctly directed negotiation record delivered after the channel locked `legacy`. It is NEITHER over-bound NOR misdirected, so it is not P3; §11.2's partition puts it at P24. This is the assertion that keeps the three legacy-lock rows disjoint.",
      inputs: {
        modeMachineState: "legacy",
        receivingEndpoint,
        postStripPayload: b(record),
        recordType,
      },
      expected: {
        step2Discrimination: { class: classifyPostStripPayload(record).kind },
        decodes: decoded.kind,
        recordBytes: record.byteLength,
        boundMaxBytes: bound.maxBytes,
        boundIsExact: bound.exact,
        withinItsBound: record.byteLength <= bound.maxBytes,
        registryDirection: expectedDirection,
        directedCorrectlyForThisEndpoint:
          (receivingEndpoint === "node" && expectedDirection === E2EE_DIRECTION_CLIENT_TO_NODE) ||
          (receivingEndpoint === "client" && expectedDirection === E2EE_DIRECTION_NODE_TO_CLIENT),
        overBound: false,
        misdirected: false,
        notP3: true,
        fatal: "P24",
        disposition: "FATAL-PRE",
        sessionKeysExist: false,
      },
    });
  }

  for (const [name, payload, reason] of [
    [
      "legacy-lock-injection-unknown-first-byte-is-p6",
      Uint8Array.from([0x7f, 0x01, 0x02]),
      "unknown_discriminator",
    ],
    ["legacy-lock-injection-absent-first-byte-is-p6", new Uint8Array(0), "empty"],
  ] as const) {
    const classified = classifyPostStripPayload(payload);
    cases.push({
      name,
      sections: ["3.4", "4.3 step 2", "4.4", "11.2 P6"],
      note: "An unknown or ABSENT first byte after the legacy lock. §3.4 enumerates the zero-length payload separately so no implementation treats it as a benign no-op: it is fatal in every state and never silently dropped.",
      inputs: { modeMachineState: "legacy", postStripPayload: b(payload) },
      expected: {
        step2Discrimination: {
          class: classified.kind,
          ...(classified.kind === "other" ? { reason: classified.reason } : {}),
        },
        matchesExpectedReason: classified.kind === "other" && classified.reason === reason,
        fatal: "P6",
        disposition: "FATAL-PRE",
        neverSilentlyDropped: true,
        sessionKeysExist: false,
      },
    });
  }

  {
    const bound = e2eeNegotiationRecordBound(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT);
    cases.push({
      name: "misdirected-negotiation-record-is-p3",
      sections: ["3.4", "4.4 N5", "11.2 P3"],
      note: "The contrast case that shows P24 above is not simply 'any negotiation record': an `E2EEServerAccept` arriving AT THE NODE is misdirected under the §3.4 direction registry and is P3, whatever the channel's state.",
      inputs: {
        receivingEndpoint: "node",
        recordType: E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
        postStripPayload: b(acceptRecord),
      },
      expected: {
        registryDirection: e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT),
        directedCorrectlyForThisEndpoint: false,
        misdirected: true,
        withinItsBound: acceptRecord.byteLength <= bound.maxBytes,
        fatal: "P3",
        disposition: "FATAL-PRE",
      },
    });
  }

  {
    // A record one byte over `E2EE_CLIENT_HELLO_MAX_BYTES`. The encoder refuses
    // to build it — §3.3's bound is enforced on the framed record so a sender
    // cannot emit a hello its peer must reject unread — so the bytes are framed
    // directly, which is what a non-conforming peer puts on the wire.
    const overBound = new Uint8Array(E2EE_CLIENT_HELLO_MAX_BYTES + 1);
    overBound[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
    overBound[1] = E2EE_NEGOTIATION_TYPE_CLIENT_HELLO;
    const decoded = decodeE2eeNegotiationRecord(overBound);
    cases.push({
      name: "over-bound-negotiation-record-is-p3",
      sections: ["3.3", "8.6 step 1", "11.2 P3"],
      note: "The per-type bound is enforced BEFORE the body is surfaced — §8.6 step 1's 'bounds before crypto' — so an over-bound hello is rejected without parsing anything inside it.",
      inputs: {
        recordType: E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
        recordBytes: overBound.byteLength,
        clientHelloMaxBytes: E2EE_CLIENT_HELLO_MAX_BYTES,
      },
      expected: {
        decodes: decoded.kind,
        reason: decoded.kind === "error" ? decoded.reason : null,
        overBound: true,
        bodyParsed: false,
        fatal: "P3",
        disposition: "FATAL-PRE",
      },
    });
  }

  // ── §4.4 node transition rows N1–N17 ──────────────────────────────────────
  //
  // One case per row, in the table's own order: the state the row is written
  // over, the input class §3.4 assigns, the guard values that select this row
  // rather than its neighbour, and the ACTION and NEXT STATE §4.4 states. Every
  // payload-driven row also carries the §4.3 step 2 classification derived from
  // the landed wire module, so the input side is never merely asserted.
  //
  // A row that is fatal carries its §11 row, its disposition, and — for the
  // pre-key rows — the §11.5 observable byte for byte, so the "identical for
  // every cause" property is comparable across this family and F12 by eye.

  const nodeLegacyJson = utf8.encode('{"_tag":"ryco.rpc.request","id":1}');
  const nodeUnknownFirstByte = Uint8Array.from([0x7f, 0x01, 0x02]);
  const nodeAbsentPayload = new Uint8Array(0);

  function nodeRow(entry: {
    readonly row: string;
    readonly name: string;
    readonly sections: readonly string[];
    readonly note: string;
    readonly state: string;
    readonly input: JsonValue;
    readonly payload?: Uint8Array;
    readonly guards: JsonValue;
    readonly expected: Readonly<Record<string, JsonValue>>;
  }): void {
    cases.push({
      name: entry.name,
      sections: entry.sections,
      note: entry.note,
      inputs: {
        endpoint: "node",
        row: entry.row,
        state: entry.state,
        input: entry.input,
        ...(entry.payload === undefined ? {} : { postStripPayload: b(entry.payload) }),
        guards: entry.guards,
      },
      expected: {
        row: entry.row,
        ...(entry.payload === undefined
          ? {}
          : { step2Discrimination: { class: classifyPostStripPayload(entry.payload).kind } }),
        ...entry.expected,
      },
    });
  }

  nodeRow({
    row: "N1",
    name: "row-n1-legacy-json-under-effective-require-e2ee",
    sections: ["4.4 N1", "11.2 P1", "12.3"],
    note: "Effective `requireE2EE` forbids entering `legacy` at all, so the first legacy RPC message is FATAL-PRE rather than a fallback. The row is P1, and it is the reason `requireE2EE` is a policy about channels and not only about advertisements.",
    state: "negotiating",
    input: { class: "LEGACY-JSON" },
    payload: nodeLegacyJson,
    guards: { effectiveRequireE2EE: true, advertisementEmitted: true },
    expected: {
      action: "FATAL-PRE",
      nextState: "closed",
      fatal: "P1",
      disposition: "FATAL-PRE",
      deliveredToTheRpcParser: false,
      fallbackOccurrence: null,
      observable: preKeyObservable(),
    },
  });

  nodeRow({
    row: "N2",
    name: "row-n2-legacy-json-locks-legacy-and-counts-one-peer-legacy-occurrence",
    sections: ["4.4 N2", "12.5"],
    note: "The compatibility default with an advertisement actually emitted: the channel locks `legacy`, the message reaches the RPC parser, and exactly ONE peer-legacy occurrence is recorded — the §12.5 evidence that a legacy peer population exists. N17 is the same admission WITHOUT an advertisement and MUST NOT add a second occurrence.",
    state: "negotiating",
    input: { class: "LEGACY-JSON" },
    payload: nodeLegacyJson,
    guards: { effectiveRequireE2EE: false, nodeE2eeCapable: true, advertisementEmitted: true },
    expected: {
      action: "lock legacy; count one peer-legacy fallback occurrence; deliver to the RPC parser",
      nextState: "legacy",
      fatal: null,
      deliveredToTheRpcParser: true,
      fallbackOccurrence: { class: "peer-legacy", count: 1 },
    },
  });

  {
    const bound = e2eeNegotiationRecordBound(E2EE_NEGOTIATION_TYPE_CLIENT_HELLO);
    nodeRow({
      row: "N3",
      name: "row-n3-client-hello-runs-the-responder-and-enters-e2ee",
      sections: ["4.4 N3", "8.6", "8.7"],
      note: "The only row that enters `e2ee`. Its action has two halves — run the §8.6 responder, then emit `E2EEServerAccept` — and §12.6 requires both to land in one synchronous turn, because the channel is an in-flight handshake to both withdrawal sweeps until the accept is on the send path.",
      state: "negotiating",
      input: { class: "NEGOTIATION", type: E2EE_NEGOTIATION_TYPE_CLIENT_HELLO },
      payload: helloRecord,
      guards: {
        advertisementEmitted: true,
        firstHelloOnThisChannel: true,
        withinItsBound: helloRecord.byteLength <= bound.maxBytes,
      },
      expected: {
        action: "run the §8.6 responder handshake; on success emit `E2EEServerAccept`",
        nextState: "e2ee",
        fatal: null,
        serverAccept: b(acceptRecord),
        serverAcceptBytes: acceptRecord.byteLength,
        registryDirection: e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT),
        deliveredToTheRpcParser: false,
        rpcOutputBeforeTheImplicitFinish: false,
      },
    });
  }

  for (const [name, guards, note] of [
    [
      "row-n4-a-second-hello-on-the-channel",
      { advertisementEmitted: true, firstHelloOnThisChannel: false },
      "Exactly one handshake attempt per channel (§4.4): a second hello is fatal whatever it contains, and a retry needs a fresh ticket, channel, and handshake.",
    ],
    [
      "row-n4-a-hello-with-no-advertisement-emitted",
      { advertisementEmitted: false, firstHelloOnThisChannel: true },
      "§5.1's advertise-never-probe rule from the node's side: a hello on a channel this node never advertised on is fatal rather than served, because the client cannot have validated a statement it was never sent.",
    ],
  ] as const) {
    nodeRow({
      row: "N4",
      name,
      sections: ["4.4 N4", "11.2 P4", "5.5"],
      note,
      state: "negotiating",
      input: { class: "NEGOTIATION", type: E2EE_NEGOTIATION_TYPE_CLIENT_HELLO },
      payload: helloRecord,
      guards,
      expected: {
        action: "FATAL-PRE",
        nextState: "closed",
        fatal: "P4",
        disposition: "FATAL-PRE",
        deliveredToTheRpcParser: false,
        observable: preKeyObservable(),
      },
    });
  }

  nodeRow({
    row: "N5",
    name: "row-n5-a-misdirected-negotiation-record-in-negotiating",
    sections: ["4.4 N5", "3.4", "11.2 P3"],
    note: "An `E2EEServerAccept` arriving AT THE NODE. The §3.4 registry fixes its direction as node to client, so at the node it is misdirected and P3 — the row that is P24 only once the channel has locked `legacy`.",
    state: "negotiating",
    input: { class: "NEGOTIATION", type: E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT },
    payload: acceptRecord,
    guards: {
      registryDirection: e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT),
      directedCorrectlyForThisEndpoint: false,
    },
    expected: {
      action: "FATAL-PRE",
      nextState: "closed",
      fatal: "P3",
      disposition: "FATAL-PRE",
      misdirected: true,
      deliveredToTheRpcParser: false,
      observable: preKeyObservable(),
    },
  });

  nodeRow({
    row: "N6",
    name: "row-n6-an-envelope-before-establishment",
    sections: ["4.4 N6", "11.2 P5"],
    note: "An envelope in `negotiating` cannot be authenticated — no session keys exist — so it is P5 and FATAL-PRE, never FATAL-POST.",
    state: "negotiating",
    input: { class: "ENVELOPE" },
    payload: injectedEnvelope,
    guards: { sessionKeysExist: false },
    expected: {
      action: "FATAL-PRE",
      nextState: "closed",
      fatal: "P5",
      disposition: "FATAL-PRE",
      sessionKeysExist: false,
      deliveredToTheRpcParser: false,
      observable: preKeyObservable(),
    },
  });

  for (const [name, payload, note] of [
    [
      "row-n7-an-unknown-first-byte-in-negotiating",
      nodeUnknownFirstByte,
      "An unknown discriminator in `negotiating`: fatal, never an implicit legacy path.",
    ],
    [
      "row-n7-an-absent-first-byte-in-negotiating",
      nodeAbsentPayload,
      "§3.4's absent case — a zero-length post-strip payload — takes the same row, so no implementation treats it as a benign no-op.",
    ],
  ] as const) {
    nodeRow({
      row: "N7",
      name,
      sections: ["4.4 N7", "3.4", "11.2 P6"],
      note,
      state: "negotiating",
      input: { class: "OTHER" },
      payload,
      guards: {},
      expected: {
        action: "FATAL-PRE",
        nextState: "closed",
        fatal: "P6",
        disposition: "FATAL-PRE",
        neverSilentlyDropped: true,
        deliveredToTheRpcParser: false,
        observable: preKeyObservable(),
      },
    });
  }

  nodeRow({
    row: "N8",
    name: "row-n8-the-handshake-deadline-under-effective-require-e2ee",
    sections: ["4.4 N8", "11.2 P7", "12.3"],
    note: "`T_HANDSHAKE_NODE` measured from advertisement emit, with the handshake incomplete. §4.4 guards this row deliberately: it covers a silent peer, an oversized or excessive negotiation exchange, and a plain timeout alike, and it is armed ONLY under effective `requireE2EE`.",
    state: "negotiating",
    input: { class: "TIMER", timer: "T_HANDSHAKE_NODE", startedAt: "advertisement emit" },
    guards: { effectiveRequireE2EE: true, handshakeComplete: false },
    expected: {
      action: "FATAL-PRE",
      nextState: "closed",
      fatal: "P7",
      disposition: "FATAL-PRE",
      deliveredToTheRpcParser: false,
      observable: preKeyObservable(),
    },
  });

  {
    // A real protected RPC envelope and its corrupted twin, so rows N9 and N10
    // are separated by the AEAD verdict rather than by a label.
    const nodeReceive = traceSession(IK_TRACE, E2EE_DIRECTION_NODE_TO_CLIENT);
    const clientSend = traceSession(IK_TRACE, E2EE_DIRECTION_CLIENT_TO_NODE);
    const rpcBody = utf8.encode('{"_tag":"ryco.rpc.request","id":1}');
    const first = await protectOrThrow(clientSend, E2EE_INNER_TYPE_RPC, rpcBody);
    const authenticated = nodeReceive.unprotect(first.envelope);

    nodeRow({
      row: "N9",
      name: "row-n9-an-authenticated-envelope-is-delivered-to-the-rpc-parser",
      sections: ["4.4 N9", "4.3 step 3", "8.9", "9.1"],
      note: "The only node row that reaches the RPC parser in `e2ee`. The FIRST authenticated client-to-node envelope also completes the §8.9 implicit client finish, and until it does the node MUST emit no RPC output and invoke no handler — which is why the delivery and the finish are asserted together.",
      state: "e2ee",
      input: { class: "ENVELOPE", innerType: E2EE_INNER_TYPE_RPC },
      payload: first.envelope,
      guards: { step3ChecksPass: true, knownInnerType: true, firstAuthenticatedC2nEnvelope: true },
      expected: {
        action: "deliver the authenticated inner record; complete the §8.9 implicit client finish",
        nextState: "e2ee",
        fatal: null,
        unprotect: unprotectResultJson(authenticated),
        deliveredToTheRpcParser: true,
        rpcOutputBeforeTheImplicitFinish: false,
      },
    });

    const corrupted = copyOf(first.envelope);
    corrupted[corrupted.byteLength - 1]! ^= 0x01;
    const corruptedReceive = traceSession(IK_TRACE, E2EE_DIRECTION_NODE_TO_CLIENT);
    const rejected = corruptedReceive.unprotect(corrupted);
    nodeRow({
      row: "N10",
      name: "row-n10-an-envelope-failing-a-step-3-check",
      sections: ["4.4 N10", "4.3 step 3", "11.3 Q3"],
      note: "The same envelope with one ciphertext bit flipped. Session keys exist, so the disposition is FATAL-POST and the node emits one encrypted `E2EEError` before closing — the row is Q3, and §11.3's code for every one of this table's rows is `protocol_violation`.",
      state: "e2ee",
      input: { class: "ENVELOPE", innerType: E2EE_INNER_TYPE_RPC, ciphertextBitFlipped: true },
      payload: corrupted,
      guards: { step3ChecksPass: false },
      expected: {
        action: "FATAL-POST",
        nextState: "closed",
        fatal: "Q3",
        disposition: "FATAL-POST",
        unprotect: unprotectResultJson(rejected),
        errorCode: E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
        errorRecordsOnTheWire: 1,
        closeReason: "channel_rejected",
        deliveredToTheRpcParser: false,
      },
    });
  }

  for (const [name, payload, inputClass, note] of [
    [
      "row-n11-legacy-json-after-e2ee",
      nodeLegacyJson,
      "LEGACY-JSON",
      "Plaintext after E2EE never reaches the RPC parser. This is the row a keepalive `Ping` would hit if a client let one escape after the mode locked, which is why §4.4's buffering rule covers all plaintext and not only application RPC.",
    ],
    [
      "row-n11-a-negotiation-record-after-e2ee",
      helloRecord,
      "NEGOTIATION",
      "A negotiation record in `e2ee` is Q6 and not P24: P24 is the `legacy` row, and here session keys exist, so the disposition is FATAL-POST.",
    ],
    [
      "row-n11-an-absent-first-byte-after-e2ee",
      nodeAbsentPayload,
      "OTHER",
      "§3.4's absent case in `e2ee`. §11.3 Q6 names it explicitly so a zero-length payload cannot be read as a benign no-op after establishment either.",
    ],
  ] as const) {
    nodeRow({
      row: "N11",
      name,
      sections: ["4.4 N11", "3.4", "11.3 Q6"],
      note,
      state: "e2ee",
      input: { class: inputClass },
      payload,
      guards: { sessionKeysExist: true },
      expected: {
        action: "FATAL-POST",
        nextState: "closed",
        fatal: "Q6",
        disposition: "FATAL-POST",
        errorCode: E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
        errorRecordsOnTheWire: 1,
        closeReason: "channel_rejected",
        deliveredToTheRpcParser: false,
      },
    });
  }

  nodeRow({
    row: "N12",
    name: "row-n12-legacy-json-in-legacy",
    sections: ["4.4 N12"],
    note: "The steady state of a locked-legacy channel: deliver, stay `legacy`, and count nothing — the channel's single §12.5 occurrence was recorded at the lock (N2) or at the suppressed advertisement (N16).",
    state: "legacy",
    input: { class: "LEGACY-JSON" },
    payload: nodeLegacyJson,
    guards: {},
    expected: {
      action: "deliver to the RPC parser",
      nextState: "legacy",
      fatal: null,
      deliveredToTheRpcParser: true,
      fallbackOccurrence: null,
    },
  });

  for (const [name, payload, inputClass, fatal, note] of [
    [
      "row-n13-an-envelope-in-legacy",
      injectedEnvelope,
      "ENVELOPE",
      "P5",
      "The envelope half of row N13. No session keys exist in `legacy`, so it is FATAL-PRE.",
    ],
    [
      "row-n13-a-negotiation-record-in-legacy",
      helloRecord,
      "NEGOTIATION",
      "P24",
      "The negotiation half of row N13, and the reason P24 exists as its own §11.2 row: this hello is correctly sized and correctly directed, so it is neither P3 nor P5.",
    ],
  ] as const) {
    nodeRow({
      row: "N13",
      name,
      sections: ["4.4 N13", `11.2 ${fatal}`],
      note,
      state: "legacy",
      input: { class: inputClass },
      payload,
      guards: { sessionKeysExist: false },
      expected: {
        action: "FATAL-PRE",
        nextState: "closed",
        fatal,
        disposition: "FATAL-PRE",
        sessionKeysExist: false,
        deliveredToTheRpcParser: false,
        observable: preKeyObservable(),
      },
    });
  }

  nodeRow({
    row: "N14",
    name: "row-n14-an-unknown-first-byte-in-legacy",
    sections: ["4.4 N14", "3.4", "11.2 P6"],
    note: "The `OTHER` row of the `legacy` state, completing §4.4's rule that a malformed, unknown, or absent first byte is fatal in EVERY state.",
    state: "legacy",
    input: { class: "OTHER" },
    payload: nodeUnknownFirstByte,
    guards: {},
    expected: {
      action: "FATAL-PRE",
      nextState: "closed",
      fatal: "P6",
      disposition: "FATAL-PRE",
      deliveredToTheRpcParser: false,
      observable: preKeyObservable(),
    },
  });

  // ── rows N15–N17: the connection-level input ─────────────────────────────
  //
  // §16.3 F10 states the extra fields these three MUST carry: the asserted
  // `maxDataChunkBytes`, the §7.6.1 self-check result, the effective
  // `requireE2EE` value, and which §12.5 class recorded an occurrence. The
  // self-check is run here by the landed module rather than described.

  const advertisable = buildStatement();
  const selfCheckPasses = selfCheck(advertisable, HUB_ORIGIN);
  const selfCheckFails = nodeE2eeCapabilitySelfCheck({
    hubOrigin: HUB_ORIGIN,
    transcript: advertisable.transcript,
    envelope: advertisable.envelope,
    statement: advertisable.statement,
    carrier: utf8.encode(advertisable.carrier),
    e2eeVersionMin: 1,
    e2eeVersionMax: 1,
    // §7.5's startup cross-check could not resolve the continuity id: §11.2 P23
    // names it as a U2 cause by that exact description.
    continuityIdResolved: false,
  });

  for (const [name, reason, fatal, maxDataChunkBytes, check, note] of [
    [
      "row-n15-an-undersized-connection-under-effective-require-e2ee",
      "undersized-connection",
      "P2",
      E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1,
      selfCheckPasses,
      "§5.5 U1: the connection's asserted `maxDataChunkBytes` is below the advertisement floor, so no carrier can be emitted at all. Under effective `requireE2EE` that is FATAL-PRE at `channel.accept` — before any carrier is built and before any peer input — and the row is P2. It is a property of the CONNECTION, so every channel on it takes the same row.",
    ],
    [
      "row-n15-no-conforming-statement-under-effective-require-e2ee",
      "statement-unavailable",
      "P23",
      RELAY_MAX_RPC_MESSAGE_BYTES,
      selfCheckFails,
      "§5.5 U2: the §7.6.1 self-check fails, here on an unresolvable continuity id under the §7.5 startup cross-check. Under effective `requireE2EE` the row is P23. The wire surface is identical to P2's and to every other pre-key failure; only the node-local operator diagnostic differs.",
    ],
  ] as const) {
    nodeRow({
      row: "N15",
      name,
      sections: ["4.4 N15", "5.5", `11.2 ${fatal}`, "7.6.1"],
      note,
      state: "negotiating",
      input: { class: "channel.accept" },
      guards: {
        assertedMaxDataChunkBytes: maxDataChunkBytes,
        advertisementMinChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
        selfCheck: check,
        effectiveRequireE2EE: true,
        advertisementUnavailableReason: reason,
      },
      expected: {
        action: "FATAL-PRE, before any carrier is built and before any peer input",
        nextState: "closed",
        fatal,
        disposition: "FATAL-PRE",
        carrierEmitted: false,
        fallbackOccurrence: null,
        operatorDiagnostic: { code: "e2ee_advertisement_unavailable", reason },
        observable: preKeyObservable(),
      },
    });
  }

  for (const [name, reason, maxDataChunkBytes, check, note] of [
    [
      "row-n16-an-undersized-connection-under-the-compatibility-default",
      "undersized-connection",
      E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1,
      selfCheckPasses,
      "§5.5 U1 without `requireE2EE`: the advertisement is suppressed, exactly ONE advertisement-unavailable occurrence is recorded for this channel, and no carrier is emitted. The occurrence is deliberately NOT peer-legacy: nothing yet says a legacy peer exists.",
    ],
    [
      "row-n16-no-conforming-statement-under-the-compatibility-default",
      "statement-unavailable",
      RELAY_MAX_RPC_MESSAGE_BYTES,
      selfCheckFails,
      "§5.5 U2 without `requireE2EE`. The same suppression and the same single occurrence: §12.5's advertisement-unavailable class does not partition by which of U1 or U2 caused it, and the §12.3 flip criterion reads the class.",
    ],
  ] as const) {
    nodeRow({
      row: "N16",
      name,
      sections: ["4.4 N16", "5.5", "12.5"],
      note,
      state: "negotiating",
      input: { class: "channel.accept" },
      guards: {
        assertedMaxDataChunkBytes: maxDataChunkBytes,
        advertisementMinChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
        selfCheck: check,
        effectiveRequireE2EE: false,
        advertisementUnavailableReason: reason,
      },
      expected: {
        action:
          "suppress the advertisement; record exactly one advertisement-unavailable occurrence; emit no carrier",
        nextState: "negotiating (no advertisement)",
        fatal: null,
        carrierEmitted: false,
        fallbackOccurrence: { class: "advertisement-unavailable", reason, count: 1 },
        peerLegacyOccurrence: 0,
        operatorDiagnostic: { code: "e2ee_advertisement_unavailable", reason },
      },
    });
  }

  nodeRow({
    row: "N17",
    name: "row-n17-legacy-json-on-a-channel-that-never-advertised",
    sections: ["4.4 N17", "12.3", "12.5"],
    note: "Rows N2 and N17 partition legacy admission by whether the node actually advertised. This channel's single §12.5 occurrence was already recorded by N16, so N2's peer-legacy count MUST NOT also fire — an advertisement the node could not emit is never recorded as evidence that a legacy peer exists.",
    state: "negotiating (no advertisement)",
    input: { class: "LEGACY-JSON" },
    payload: nodeLegacyJson,
    guards: {
      effectiveRequireE2EE: false,
      nodeE2eeCapable: true,
      advertisementEmitted: false,
      occurrenceAlreadyRecordedByRowN16: {
        class: "advertisement-unavailable",
        count: 1,
      },
    },
    expected: {
      action: "lock legacy; deliver to the RPC parser",
      nextState: "legacy",
      fatal: null,
      deliveredToTheRpcParser: true,
      peerLegacyOccurrenceAddedOnTopOfN16: 0,
      fallbackOccurrencesForThisChannel: {
        "peer-legacy": 0,
        "advertisement-unavailable": 1,
      },
    },
  });

  // ── the node deadline under each policy (§8.9) ───────────────────────────
  //
  // §16.3 F10 asks for three assertions beyond row N8's own case: that N8 does
  // NOT fire under the compatibility default, and that the SAME deadline
  // expiring after row N3 with no authenticated implicit finish is FATAL-POST
  // `Q8` under BOTH policies. §8.9 arms that half unconditionally, because there
  // the node is holding live key material rather than an idle slot.

  cases.push({
    name: "node-deadline-n8-does-not-fire-under-the-compatibility-default",
    sections: ["4.4 N8", "8.9", "12.3"],
    note: "Arming N8 unconditionally would make the default-policy node strictly less permissive than today's node — any peer whose first channel-borne JSON is later than `T_HANDSHAKE_NODE` would be closed where it is currently served — while buying no availability. The channel stays `negotiating` and its next input still decides it.",
    inputs: {
      endpoint: "node",
      state: "negotiating",
      input: { class: "TIMER", timer: "T_HANDSHAKE_NODE", startedAt: "advertisement emit" },
      guards: { effectiveRequireE2EE: false, handshakeComplete: false },
    },
    expected: {
      row: null,
      rowN8Fires: false,
      action: "no transition",
      nextState: "negotiating",
      fatal: null,
      recordsOnTheWire: 0,
      channelStaysOpen: true,
    },
  });

  for (const [name, effectiveRequireE2EE, note] of [
    [
      "node-deadline-after-row-n3-is-q8-under-effective-require-e2ee",
      true,
      "The §8.9 implicit-finish deadline on a channel that reached row N3 and never authenticated. It is FATAL-POST, not FATAL-PRE, because session keys exist.",
    ],
    [
      "node-deadline-after-row-n3-is-q8-under-the-compatibility-default",
      false,
      "The same expiry under the compatibility default, and this is the half §16.3 F10 singles out: §8.9's deadline is armed under EVERY policy, unlike row N8, because between row N3 and the finish the node is holding live key material rather than an idle channel slot.",
    ],
  ] as const) {
    cases.push({
      name,
      sections: ["8.9", "11.3 Q8", "4.4"],
      note,
      inputs: {
        endpoint: "node",
        state: "e2ee",
        input: { class: "TIMER", timer: "T_HANDSHAKE_NODE", startedAt: "advertisement emit" },
        guards: {
          effectiveRequireE2EE,
          reachedRowN3: true,
          implicitFinishAuthenticated: false,
        },
      },
      expected: {
        row: "Q8",
        action: "FATAL-POST",
        nextState: "closed",
        disposition: "FATAL-POST",
        armedUnderThisPolicy: true,
        errorCode: E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
        errorRecordsOnTheWire: 1,
        closeReason: "channel_rejected",
        deliveredToTheRpcParser: false,
      },
    });
  }

  return {
    file: "f10-mode-machine.json",
    number: 10,
    title: "Mode machine",
    sections: ["3.4", "4.3", "4.4", "8.9", "11.2", "11.3", "12.5", "16.3 F10"],
    summary:
      "The NODE half of §16.3 F10. Every §4.4 node transition row N1–N17, with its state, its input class and payload bytes, the guards that select it, and its expected ACTION and NEXT STATE — including rows N15–N17, whose input is `channel.accept` and whose §12.5 occurrence accounting §16.3 states field by field, and the §8.9 deadline under each policy. Plus the §11.2 partition of the legacy-lock injection rows: an envelope after the lock is P5, a correctly sized and correctly directed negotiation record after it is P24 — proved to be neither over-bound nor misdirected, and therefore not P3 — and an unknown or absent first byte is P6, each FATAL-PRE because no session keys exist in `legacy`, with two P3 contrast cases fixing the boundary of that partition. The node rows are replayed against the real runtime by apps/server/src/hubConnector/relayE2eeNodeCorpus.test.ts.",
    deferred: [
      "Every CLIENT transition row of §4.4 — K1–K24, with its input payload, its state, its expected ACTION and its next state. No client mode machine exists in this repository, so no client row has an implementation to derive an expectation from. The node rows N1–N17 ARE emitted above and are held to the real `NodeE2eeChannelSession` by the node-side consuming test. Owned by the client phase.",
      "The client rows' §12.1.1 selection classification, the `(hubOrigin, accountId)` scope, and the device-level `anyNodeVerified(hubOrigin)` marker, together with the account-scope-change cases that discharge the §12.1.1 provenance rule (K24/K23 versus K13). These need the §13.1 durable pin store and the §12.1.1 classifier, neither of which is landed. Owned by the client phase.",
      "The CLIENT timer and keepalive cases that discharge §3.2.2 L1 and L2 — the stalled accept (K15), the buffered keepalive round trip, and the send-buffer overflow including the connection-wide multi-channel accounting. The buffering and flushing behavior they assert belongs to a client mode machine and to the client's relay engine, neither of which exists here; the §8.9 node deadline under each policy IS emitted above. Owned by the client phase.",
      crossRuntimeDeferral(10),
    ],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F18 — node admission policy transitions (§12.3, §12.4, §12.6) ───────────
//
// §16.3 F18 is a family of NODE-STATE TRANSITIONS rather than wire vectors: each
// case states a pre-change policy, a policy generation, a live-channel set, the
// operator command applied, and the expected verdict of the §12.6
// policy-withdrawal test per channel.
//
// The runtime that decides those verdicts is `NodeE2eePolicyClient` and
// `NodeE2eePolicyStore` in apps/server, which this generator cannot import — see
// the note above family F10 for why the dependency does not run that way. The
// cases below are therefore §12.6's own table, and the node-side consuming test
// `apps/server/src/hubConnector/relayE2eeNodeCorpus.test.ts` replays every one
// of them through the real policy client, the real channel registrations, and
// the real single-snapshot sweep. A per-channel verdict the runtime does not
// produce fails there.
//
// The two values the landed shared modules DO decide are still derived here: the
// §7.6 element 14 effective admitted pattern set under each policy, and the
// §11.2 P25 in-flight abort's generic reject with its §11.5 observable.
//
// One field is repeated on every case on purpose. §12.6's display duty ends with
// a prohibition — a policy withdrawal MUST NOT record a §12.5 fallback
// occurrence of either class — and §16.3 F18 requires EVERY case to assert it,
// because folding an operator action into the §12.3 flip criterion would corrupt
// the very counter that decides whether legacy peers exist.

const F18_NO_FALLBACK_OCCURRENCE: JsonValue = {
  "peer-legacy": 0,
  "advertisement-unavailable": 0,
};

/** §12.4's effective policy, as the fixture states it, with element 14 derived. */
function f18Policy(policy: {
  readonly requireE2EE: boolean;
  readonly requireApprovedClientE2EE: boolean;
  readonly suiteRegistry: readonly number[];
}): JsonValue {
  return {
    requireE2EE: policy.requireE2EE,
    requireApprovedClientE2EE: policy.requireApprovedClientE2EE,
    suiteRegistry: [...policy.suiteRegistry],
    effectiveAdmittedPatterns: [...e2eeEffectiveAdmittedPatterns(policy.requireApprovedClientE2EE)],
  };
}

/** A `legacy` channel swept by §12.6: no record of any kind, not even a reject. */
const F18_LEGACY_SWEPT: JsonValue = {
  withdrawn: true,
  class: "legacy",
  disposition: "closed with no record",
  row: null,
  errorCode: null,
  errorRecordsOnTheWire: 0,
  handshakeRejectEmitted: false,
  closeReason: "channel_rejected",
};

/** An `e2ee` channel swept by §12.6: FATAL-POST `Q12`, code `policy`. */
function f18E2eeSwept(withdrawnClass: "nx_e2ee" | "suite_withdrawn"): JsonValue {
  return {
    withdrawn: true,
    class: withdrawnClass,
    disposition: "FATAL-POST",
    row: "Q12",
    errorCode: E2EE_ERROR_CODE_POLICY,
    errorRecordsOnTheWire: 1,
    handshakeRejectEmitted: false,
    closeReason: "channel_rejected",
  };
}

const F18_UNTOUCHED: JsonValue = {
  withdrawn: false,
  class: null,
  disposition: "untouched",
  row: null,
  errorCode: null,
  errorRecordsOnTheWire: 0,
  handshakeRejectEmitted: false,
  closeReason: null,
};

function f18Counts(counts: {
  readonly legacy?: number;
  readonly nxE2ee?: number;
  readonly suiteWithdrawn?: number;
  readonly abortedHandshakes?: number;
}): JsonValue {
  return {
    legacy: counts.legacy ?? 0,
    nxE2ee: counts.nxE2ee ?? 0,
    suiteWithdrawn: counts.suiteWithdrawn ?? 0,
    abortedHandshakes: counts.abortedHandshakes ?? 0,
  };
}

/** The suite every established channel in this family ran; the one that leaves. */
const F18_SUITE = E2EE_SUITE_25519_CHACHAPOLY_SHA256;
/**
 * A second registry entry, so a suite can LEAVE the registry without emptying
 * it. §7.6 element 9 requires the registry to be non-empty, ascending, and free
 * of duplicates, and `[F18_SUITE, F18_RETAINED_SUITE]` narrowing to
 * `[F18_RETAINED_SUITE]` is the smallest transition that satisfies all three on
 * both sides of the change.
 */
const F18_RETAINED_SUITE = E2EE_SUITE_25519_CHACHAPOLY_SHA256 + 1;

function buildFamily18(): FixtureFamily {
  const cases: FixtureCase[] = [];

  cases.push({
    name: "effective-admitted-patterns-by-policy",
    sections: ["7.6 element 14", "12.4", "8.6 step 2"],
    note: "Element 14 is COMPUTED from `requireApprovedClientE2EE` rather than carried independently, which is what makes it impossible for a node to admit a tier it does not advertise. The §8.6 step 2 membership test reads exactly this set.",
    inputs: { requireApprovedClientE2EE: [false, true] },
    expected: {
      compatibilityDefault: [...e2eeEffectiveAdmittedPatterns(false)],
      requireApprovedClientE2EE: [...e2eeEffectiveAdmittedPatterns(true)],
      narrowingRemovesOnlyNx:
        e2eeEffectiveAdmittedPatterns(false).includes(E2EE_NOISE_PATTERN_NX) &&
        !e2eeEffectiveAdmittedPatterns(true).includes(E2EE_NOISE_PATTERN_NX) &&
        e2eeEffectiveAdmittedPatterns(true).includes(E2EE_NOISE_PATTERN_IK),
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  {
    const client = makeClientHandshake({ tier: "native" });
    const hello = client.createHello(NOW);
    if (hello.kind !== "hello") throw new Error("Fixture P25 hello failed.");
    const policyNode = makeNodeHandshake({
      enterE2eeMode: () => ({ kind: "refused", reason: "policy_withdrawn" }),
    });
    const policyResult = policyNode.receiveHello(hello.record, NOW);
    const authorizationNode = makeNodeHandshake({
      enterE2eeMode: () => ({ kind: "refused", reason: "authorization_withdrawn" }),
    });
    const authorizationResult = authorizationNode.receiveHello(hello.record, NOW);
    cases.push({
      name: "in-flight-handshake-aborted-by-a-policy-withdrawal",
      sections: ["8.6 step 2", "8.6 step 8", "11.2 P25", "12.6"],
      note: "A handshake that passed §8.6 step 2 under the OLD policy and has not reached row N3. The abort names P25 and NOT P9: P9 is defined at step 2 and this handshake passed it. It takes the generic fixed-size `E2EEHandshakeReject`, byte-identical to the F12 reject cases, and never a `policy` code — which exists only post-key.",
      inputs: {
        passedStepTwoUnderTheOldPolicy: true,
        reachedRowN3: false,
        rowN3Transition: "refused: policy_withdrawn",
      },
      expected: {
        ...(handshakeFailureJson(policyResult) as Record<string, JsonValue>),
        disposition: "FATAL-PRE",
        errorCodeEmitted: null,
        observable: preKeyObservable(),
        authorizationWithdrawalRow: (authorizationResult as unknown as E2eeHandshakeFailure).row,
        rowsAreDistinct:
          (policyResult as unknown as E2eeHandshakeFailure).row !==
          (authorizationResult as unknown as E2eeHandshakeFailure).row,
        bothTakeTheIdenticalObservable: true,
        noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
      },
    });
  }

  // ── the per-channel cases (§12.6) ────────────────────────────────────────
  //
  // Each states the pre-change policy and generation, the live-channel set with
  // every channel's mode, tier and established suite, the operator command, and
  // the per-channel verdict of the §12.6 test.

  const COMPATIBILITY_DEFAULT = {
    requireE2EE: false,
    requireApprovedClientE2EE: false,
    suiteRegistry: [F18_SUITE],
  } as const;

  /** The three-channel set §16.3 F18 names twice: one `legacy`, one NX, one IK. */
  const THREE_CHANNELS: JsonValue = [
    { id: "ch-legacy", mode: "legacy", tier: null, pattern: null, suite: null },
    { id: "ch-nx", mode: "e2ee", tier: "web", pattern: E2EE_NOISE_PATTERN_NX, suite: F18_SUITE },
    {
      id: "ch-ik",
      mode: "e2ee",
      tier: "native",
      pattern: E2EE_NOISE_PATTERN_IK,
      suite: F18_SUITE,
      // §8.6 step 6 admitted this channel against an `approved` record. §12.6 is
      // explicit that its test MUST NOT read this snapshot; it is stated here so
      // the case can assert the IK channel's fate is decided WITHOUT it.
      admittedAuthoritySnapshot: { status: "approved", maxRole: "owner" },
    },
  ];

  cases.push({
    name: "require-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    sections: ["12.6", "11.3 Q12", "12.5"],
    note: "The first §12.6 narrowing. It withdraws the `legacy` channel and NOTHING else: `requireE2EE` is about whether plaintext may be admitted at all, and both `e2ee` channels already satisfy it. The `legacy` channel holds no session keys, so it closes with `channel_rejected` and NO record — in particular no `E2EEHandshakeReject`, which is a negotiation record and would be row K21 at the peer, which is the plausible wrong implementation this case exists to catch.",
    inputs: {
      policyBefore: f18Policy(COMPATIBILITY_DEFAULT),
      policyGenerationBefore: 7,
      channels: THREE_CHANNELS,
      command: { requireE2EE: true },
    },
    expected: {
      isWithdrawal: true,
      policyAfter: f18Policy({ ...COMPATIBILITY_DEFAULT, requireE2EE: true }),
      policyGenerationAfter: 8,
      perChannel: [
        { id: "ch-legacy", ...(F18_LEGACY_SWEPT as Record<string, JsonValue>) },
        { id: "ch-nx", ...(F18_UNTOUCHED as Record<string, JsonValue>) },
        { id: "ch-ik", ...(F18_UNTOUCHED as Record<string, JsonValue>) },
      ],
      handshakeRejectOnTheLegacyChannel: false,
      counts: f18Counts({ legacy: 1 }),
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  cases.push({
    name: "require-approved-client-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    sections: ["12.4", "12.6", "11.3 Q12"],
    note: '§12.4 makes this narrowing imply effective `requireE2EE`, so the `legacy` channel goes too. The NX channel is FATAL-POST `Q12` with code `policy` and one length-uniform `E2EEError`. The IK channel STAYS OPEN, and §12.6 is explicit that this is a consequence rather than an exemption: §8.6 step 6 admitted it only against an `approved` record, and element 14 under `requireApprovedClientE2EE` is exactly `["IK"]`.',
    inputs: {
      policyBefore: f18Policy(COMPATIBILITY_DEFAULT),
      policyGenerationBefore: 7,
      channels: THREE_CHANNELS,
      command: { requireApprovedClientE2EE: true },
    },
    expected: {
      isWithdrawal: true,
      policyAfter: f18Policy({ ...COMPATIBILITY_DEFAULT, requireApprovedClientE2EE: true }),
      policyGenerationAfter: 8,
      effectiveRequireE2EEAfter: true,
      perChannel: [
        { id: "ch-legacy", ...(F18_LEGACY_SWEPT as Record<string, JsonValue>) },
        { id: "ch-nx", ...(f18E2eeSwept("nx_e2ee") as Record<string, JsonValue>) },
        { id: "ch-ik", ...(F18_UNTOUCHED as Record<string, JsonValue>) },
      ],
      ikStaysOpenWithoutReadingItsStep6Snapshot: true,
      counts: f18Counts({ legacy: 1, nxE2ee: 1 }),
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  // The suite clause, run TWICE against the same command — once with the
  // established channel IK and once with it NX. §12.6's suite bullet is
  // unqualified by tier on purpose, and a generator free to pick one would leave
  // the rule pinned by prose alone.
  for (const [tier, pattern] of [
    ["native", E2EE_NOISE_PATTERN_IK],
    ["web", E2EE_NOISE_PATTERN_NX],
  ] as const) {
    const withdrawnChannel: JsonValue = {
      id: "ch-on-the-withdrawn-suite",
      mode: "e2ee",
      tier,
      pattern,
      suite: F18_SUITE,
      ...(pattern === E2EE_NOISE_PATTERN_IK
        ? // §16.3: the IK run MUST carry an UNCHANGED `approved` record and
          // assert the channel is closed anyway, since "the record is still
          // approved" is the plausible wrong exemption.
          { admittedAuthoritySnapshot: { status: "approved", maxRole: "owner" } }
        : {}),
    };
    cases.push({
      name: `a-suite-leaving-the-registry-closes-the-${tier === "native" ? "ik" : "nx"}-channel-established-on-it`,
      sections: ["12.6", "11.3 Q12", "7.6 element 9"],
      note: "The suite clause is tier-independent, and this is the run that proves it for this tier. A companion channel on a retained suite is untouched by the same command, so the sweep is shown to be keyed on the channel's own established suite and not on the fact that a narrowing happened.",
      inputs: {
        policyBefore: f18Policy({
          ...COMPATIBILITY_DEFAULT,
          suiteRegistry: [F18_SUITE, F18_RETAINED_SUITE],
        }),
        policyGenerationBefore: 7,
        channels: [
          withdrawnChannel,
          {
            id: "ch-on-the-retained-suite",
            mode: "e2ee",
            tier,
            pattern,
            suite: F18_RETAINED_SUITE,
          },
        ],
        command: { suiteRegistry: [F18_RETAINED_SUITE] },
      },
      expected: {
        isWithdrawal: true,
        policyAfter: f18Policy({
          ...COMPATIBILITY_DEFAULT,
          suiteRegistry: [F18_RETAINED_SUITE],
        }),
        policyGenerationAfter: 8,
        perChannel: [
          {
            id: "ch-on-the-withdrawn-suite",
            ...(f18E2eeSwept("suite_withdrawn") as Record<string, JsonValue>),
          },
          { id: "ch-on-the-retained-suite", ...(F18_UNTOUCHED as Record<string, JsonValue>) },
        ],
        ...(pattern === E2EE_NOISE_PATTERN_IK
          ? { closedDespiteAnUnchangedApprovedRecord: true }
          : {}),
        counts: f18Counts({ suiteWithdrawn: 1 }),
        noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
      },
    });
  }

  cases.push({
    name: "a-widening-closes-nothing-and-still-advances-the-policy-generation",
    sections: ["12.6", "5.7"],
    note: "A pure widening is not a withdrawal and sweeps nothing — it takes effect on the next advertisement and on channels admitted after it, never retroactively. The §5.7 generation still advances, because the generation tracks the committed policy rather than the sweep, and a client holding a higher remembered generation must not be served the old statement. The live-channel set is the one the PRE-CHANGE policy can actually hold: `requireApprovedClientE2EE` admits no `legacy` channel and no NX channel, so a case that opened one here would be asserting over a state the node cannot reach.",
    inputs: {
      policyBefore: f18Policy({
        requireE2EE: true,
        requireApprovedClientE2EE: true,
        suiteRegistry: [F18_SUITE],
      }),
      policyGenerationBefore: 7,
      channels: [
        {
          id: "ch-ik",
          mode: "e2ee",
          tier: "native",
          pattern: E2EE_NOISE_PATTERN_IK,
          suite: F18_SUITE,
          admittedAuthoritySnapshot: { status: "approved", maxRole: "owner" },
        },
      ],
      command: {
        requireE2EE: false,
        requireApprovedClientE2EE: false,
        suiteRegistry: [F18_SUITE, F18_RETAINED_SUITE],
      },
    },
    expected: {
      isWithdrawal: false,
      policyAfter: f18Policy({
        requireE2EE: false,
        requireApprovedClientE2EE: false,
        suiteRegistry: [F18_SUITE, F18_RETAINED_SUITE],
      }),
      policyGenerationAfter: 8,
      generationStillAdvances: true,
      perChannel: [{ id: "ch-ik", ...(F18_UNTOUCHED as Record<string, JsonValue>) }],
      counts: f18Counts({}),
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  cases.push({
    name: "a-combined-narrow-and-widen-command-is-a-withdrawal",
    sections: ["12.6", "13.6"],
    note: "One command that enables `requireE2EE` while ADDING a suite. It contains a reduction and the reduction governs, exactly as in §13.6 — the per-channel expectations are the narrowing's, unchanged by the widening travelling with it.",
    inputs: {
      policyBefore: f18Policy(COMPATIBILITY_DEFAULT),
      policyGenerationBefore: 7,
      channels: THREE_CHANNELS,
      command: { requireE2EE: true, suiteRegistry: [F18_SUITE, F18_RETAINED_SUITE] },
    },
    expected: {
      isWithdrawal: true,
      policyAfter: f18Policy({
        ...COMPATIBILITY_DEFAULT,
        requireE2EE: true,
        suiteRegistry: [F18_SUITE, F18_RETAINED_SUITE],
      }),
      policyGenerationAfter: 8,
      perChannelMatchesTheNarrowingAlone: true,
      perChannel: [
        { id: "ch-legacy", ...(F18_LEGACY_SWEPT as Record<string, JsonValue>) },
        { id: "ch-nx", ...(F18_UNTOUCHED as Record<string, JsonValue>) },
        { id: "ch-ik", ...(F18_UNTOUCHED as Record<string, JsonValue>) },
      ],
      counts: f18Counts({ legacy: 1 }),
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  for (const [name, nextInput, expectedRow, note] of [
    [
      "a-negotiating-channel-is-not-swept-and-then-fails-closed-on-a-refused-hello",
      { class: "NEGOTIATION", type: E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, tier: "web" },
      "P9",
      "The channel has been admitted to nothing, so §12.6 does not sweep it. What makes that safe is step (a)'s ordering: the commit has already happened, so this hello reaches §8.6 step 2 under the NARROWED policy and is refused there as `P9` — not `P25`, which is the row for a handshake that already PASSED step 2.",
    ],
    [
      "a-negotiating-channel-is-not-swept-and-then-fails-closed-on-legacy-json",
      { class: "LEGACY-JSON" },
      "P1",
      "The same channel taking plaintext instead. Under the newly effective `requireE2EE` that is row N1, §11.2 `P1` — fail-closed, and reached without the sweep having to touch the channel at all.",
    ],
  ] as const) {
    cases.push({
      name,
      sections: ["12.6", "8.6 step 2", "4.4 N1", `11.2 ${expectedRow}`],
      note,
      inputs: {
        policyBefore: f18Policy(COMPATIBILITY_DEFAULT),
        policyGenerationBefore: 7,
        channels: [
          { id: "ch-negotiating", mode: "negotiating", tier: null, pattern: null, suite: null },
        ],
        command: { requireE2EE: true, requireApprovedClientE2EE: true },
        nextInputAfterTheCommand: nextInput,
      },
      expected: {
        isWithdrawal: true,
        sweptByTheWithdrawal: false,
        perChannel: [{ id: "ch-negotiating", ...(F18_UNTOUCHED as Record<string, JsonValue>) }],
        nextInputRow: expectedRow,
        nextInputDisposition: "FATAL-PRE",
        failsClosed: true,
        observable: preKeyObservable(),
        counts: f18Counts({}),
        noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
      },
    });
  }

  // ── the ordering cases (§12.6 (a) before (b), and the row-N3 race) ───────

  cases.push({
    name: "a-hello-reaching-step-2-after-the-durable-commit-is-refused-there",
    sections: ["12.6", "8.6 step 2", "11.2 P9"],
    note: "The ordering itself. Committing first means every handshake that reaches §8.6 step 2 afterwards reads the narrowed policy, so no channel can be established behind a sweep that has already passed. A node that swept first and committed second would leave a window whose length is the sweep's own duration.",
    inputs: {
      policyBefore: f18Policy(COMPATIBILITY_DEFAULT),
      policyGenerationBefore: 7,
      command: { requireApprovedClientE2EE: true },
      helloArrivesAt: "after step (a)'s durable commit",
      helloTier: "web",
      helloPattern: E2EE_NOISE_PATTERN_NX,
    },
    expected: {
      policyReadAtStepTwo: f18Policy({
        ...COMPATIBILITY_DEFAULT,
        requireApprovedClientE2EE: true,
      }),
      admittedPatternsAtStepTwo: [...e2eeEffectiveAdmittedPatterns(true)],
      helloAdmitted: false,
      row: "P9",
      disposition: "FATAL-PRE",
      channelEstablishedBehindTheSweep: false,
      observable: preKeyObservable(),
      counts: f18Counts({}),
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  for (const [name, order, note] of [
    [
      "the-row-n3-race-with-the-live-channel-enumeration-attempted-first",
      ["live-channels", "in-flight-handshakes"],
      "A handshake that passed §8.6 step 2 under the old policy, whose row-N3 transition is scheduled to land concurrently with the sweep, between the two enumerations. §12.6 requires both to be one pass over ONE consistent snapshot, so the channel is dispatched exactly once by the mode that snapshot froze.",
    ],
    [
      "the-row-n3-race-with-the-in-flight-enumeration-attempted-first",
      ["in-flight-handshakes", "live-channels"],
      "The same race with the enumerations attempted in the other order. A conforming implementation produces the identical outcome in both; an implementation that runs two independent passes loses the channel in one of them, which is the defect this pair pins.",
    ],
  ] as const) {
    cases.push({
      name,
      sections: ["12.6", "8.6 step 2", "11.2 P25", "11.3 Q12"],
      note,
      inputs: {
        policyBefore: f18Policy(COMPATIBILITY_DEFAULT),
        policyGenerationBefore: 7,
        command: { requireApprovedClientE2EE: true },
        racingChannel: {
          id: "ch-racing",
          passedStepTwoUnderTheOldPolicy: true,
          tier: "web",
          pattern: E2EE_NOISE_PATTERN_NX,
          suite: F18_SUITE,
          rowN3LandsConcurrentlyWithTheSweep: true,
        },
        enumerationOrderAttempted: [...order],
      },
      expected: {
        oneConsistentSnapshot: true,
        dispatchedExactlyOnce: true,
        leftOpen: false,
        // Exactly one of the two, decided by the phase the snapshot froze, and
        // the case asserts the DISJUNCTION rather than picking a winner: both
        // are conforming, and an outcome outside the pair is not.
        outcomeIsOneOf: [
          { reachedRowN3: true, row: "Q12", disposition: "FATAL-POST", countedIn: "nxE2ee" },
          {
            reachedRowN3: false,
            row: "P25",
            disposition: "FATAL-PRE",
            countedIn: "abortedHandshakes",
          },
        ],
        totalChannelsAccountedFor: 1,
        sameOutcomeInBothEnumerationOrders: true,
        noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
      },
    });
  }

  // ── step (c) and the §12.5 non-interaction ───────────────────────────────

  cases.push({
    name: "step-c-counts-broken-out-by-class",
    sections: ["12.6 step (c)"],
    note: "The acknowledgement's own numbers, over a channel set that populates every class at once: a `legacy` channel, an NX `e2ee` channel, an `e2ee` channel of each tier on a suite that is leaving the registry, and an in-flight handshake the new policy refuses. A channel missed by one of the two enumerations shows up here as a count and not only as a surviving channel.",
    inputs: {
      policyBefore: f18Policy({
        requireE2EE: false,
        requireApprovedClientE2EE: false,
        suiteRegistry: [F18_SUITE, F18_RETAINED_SUITE],
      }),
      policyGenerationBefore: 7,
      channels: [
        { id: "ch-legacy", mode: "legacy", tier: null, pattern: null, suite: null },
        {
          id: "ch-nx-retained-suite",
          mode: "e2ee",
          tier: "web",
          pattern: E2EE_NOISE_PATTERN_NX,
          suite: F18_RETAINED_SUITE,
        },
        {
          id: "ch-nx-withdrawn-suite",
          mode: "e2ee",
          tier: "web",
          pattern: E2EE_NOISE_PATTERN_NX,
          suite: F18_SUITE,
        },
        {
          id: "ch-ik-withdrawn-suite",
          mode: "e2ee",
          tier: "native",
          pattern: E2EE_NOISE_PATTERN_IK,
          suite: F18_SUITE,
        },
        {
          id: "ch-in-flight-nx",
          mode: "in_flight",
          tier: "web",
          pattern: E2EE_NOISE_PATTERN_NX,
          suite: F18_RETAINED_SUITE,
        },
        {
          id: "ch-negotiating",
          mode: "negotiating",
          tier: null,
          pattern: null,
          suite: null,
        },
      ],
      command: { requireApprovedClientE2EE: true, suiteRegistry: [F18_RETAINED_SUITE] },
    },
    expected: {
      isWithdrawal: true,
      // The NX channels match the NX bullet first, so they are counted once, in
      // the first class that names them — §12.6 evaluates the bullets in order.
      perChannel: [
        { id: "ch-legacy", ...(F18_LEGACY_SWEPT as Record<string, JsonValue>) },
        { id: "ch-nx-retained-suite", ...(f18E2eeSwept("nx_e2ee") as Record<string, JsonValue>) },
        { id: "ch-nx-withdrawn-suite", ...(f18E2eeSwept("nx_e2ee") as Record<string, JsonValue>) },
        {
          id: "ch-ik-withdrawn-suite",
          ...(f18E2eeSwept("suite_withdrawn") as Record<string, JsonValue>),
        },
        {
          id: "ch-in-flight-nx",
          withdrawn: true,
          class: "handshake",
          disposition: "FATAL-PRE",
          row: "P25",
          errorCode: null,
          errorRecordsOnTheWire: 0,
          handshakeRejectEmitted: true,
          closeReason: "channel_rejected",
        },
        { id: "ch-negotiating", ...(F18_UNTOUCHED as Record<string, JsonValue>) },
      ],
      counts: f18Counts({ legacy: 1, nxE2ee: 2, suiteWithdrawn: 1, abortedHandshakes: 1 }),
      channelsAccountedFor: 6,
      eachChannelDispatchedExactlyOnce: true,
      inFlightAbortObservable: preKeyObservable(),
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  cases.push({
    name: "no-withdrawal-records-a-fallback-occurrence-of-either-class",
    sections: ["12.6", "12.5", "12.3"],
    note: "§12.6's closing prohibition, stated once over the whole family: a policy withdrawal is neither a legacy acceptance nor an advertisement failure, and folding it into either §12.5 counter would corrupt the §12.3 flip criterion with the operator's own action. Every case in this family carries `noFallbackOccurrenceRecorded`; this case names the invariant so it is claimed rather than merely repeated.",
    inputs: {
      appliesTo: "every case in this family",
      fallbackClasses: ["peer-legacy", "advertisement-unavailable"],
    },
    expected: {
      recordedByAnyWithdrawal: F18_NO_FALLBACK_OCCURRENCE,
      sweepIsAnOperatorActionNotALegacyAcceptance: true,
      noFallbackOccurrenceRecorded: F18_NO_FALLBACK_OCCURRENCE,
    },
  });

  return {
    file: "f18-node-admission-policy.json",
    number: 18,
    title: "Node admission policy transitions",
    sections: ["8.6", "11.2 P25", "11.3 Q12", "12.3", "12.4", "12.5", "12.6", "5.7", "16.3 F18"],
    summary:
      "§16.3 F18 in full. The §7.6 element 14 effective admitted pattern set under each policy and the §11.2 P25 in-flight abort with its generic fixed-size reject, both derived from the landed shared modules; and the §12.6 node-state transitions — `requireE2EE` and `requireApprovedClientE2EE` false → true over a `legacy`, an NX and an IK channel, the tier-independent suite clause run twice against the same command, the widening that closes nothing while the generation still advances, the combined narrow-and-widen command, the `negotiating` channel that is not swept and then fails closed, the two ordering cases including the row-N3 race in both enumeration orders, the step (c) counts broken out by class, and the §12.5 non-interaction every case asserts. The transitions are replayed against the real policy client by apps/server/src/hubConnector/relayE2eeNodeCorpus.test.ts.",
    deferred: [],
    testKeyMaterial: HANDSHAKE_TEST_KEY_MATERIAL,
    cases,
  };
}

// ─── F19 — account-enrolled native Hub device grants (§18) ─────────────────

const F19_HUB_GRANT_SEED = seedOf(0x41);
const F19_OTHER_HUB_GRANT_SEED = seedOf(0x42);
const F19_HUB_GRANT_PUBLIC = ed25519.getPublicKey(F19_HUB_GRANT_SEED);
const F19_STATEMENT_DIGEST = nobleSha256(utf8.encode("f19-node-statement"));
const F19_ACCOUNT_ID = `acct_${"A".repeat(22)}`;
const F19_ENROLLMENT_ID = `enr_${"E".repeat(22)}`;
const F19_GRANT_ID = `hgr_${"G".repeat(22)}`;
const F19_GRANT_KEY_ID = `hgk_${"K".repeat(22)}`;
const F19_TICKET_ID = `rtk_${"T".repeat(22)}`;
const F19_CLIENT_PREKEY_TRANSCRIPT = encodeClientE2eePrekeyTranscript({
  hubOrigin: HUB_ORIGIN,
  accountId: F19_ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  createdAt: NOW - 30_000,
  expiresAt: NOW + 180_000,
});
const F19_CLIENT_PREKEY_SIGNATURE = signClient(F19_CLIENT_PREKEY_TRANSCRIPT);
const F19_CLIENT_PREKEY_CARRIER = encodeClientE2eePrekeyCertificateCarrier(
  F19_CLIENT_PREKEY_TRANSCRIPT,
  F19_CLIENT_PREKEY_SIGNATURE,
);
const F19_CERTIFICATE_DIGEST = nobleSha256(F19_CLIENT_PREKEY_CARRIER);

const F19_BASE_CLAIMS = {
  issuerHubOrigin: HUB_ORIGIN,
  keyId: F19_GRANT_KEY_ID,
  grantId: F19_GRANT_ID,
  accountId: F19_ACCOUNT_ID,
  accountAuthEpoch: 3,
  enrollmentId: F19_ENROLLMENT_ID,
  enrollmentRevision: 4,
  deviceAuthEpoch: 5,
  deviceIdentityPublicKey: CLIENT_IDENTITY_PUBLIC,
  deviceAgreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  clientPrekeyCertificateDigest: F19_CERTIFICATE_DIGEST,
  nodeId: NODE_ID,
  nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
  nodeAgreementPublicKey: NODE_AGREEMENT_PUBLIC,
  nodeContinuityId: CONTINUITY_ID,
  nodePolicyGeneration: 6,
  nodeCapabilityStatementDigest: F19_STATEMENT_DIGEST,
  relayTicketId: F19_TICKET_ID,
  maximumRole: "operator",
  capabilities: ["ryco.rpc"],
  issuedAt: NOW,
  notBefore: NOW - 1_000,
  expiresAt: NOW + 60_000,
  nonce: new Uint8Array(32).fill(0x19),
} as unknown as HubDeviceGrantClaimsInput;

const F19_BASE_KEY: HubDeviceGrantVerificationKey = {
  keyId: F19_GRANT_KEY_ID,
  publicKey: F19_HUB_GRANT_PUBLIC,
  notBefore: NOW - 60_000,
  notAfter: NOW + 180_000,
};

const F19_BASE_BINDINGS: HubDeviceGrantBindings = {
  issuerHubOrigin: HUB_ORIGIN,
  accountId: F19_ACCOUNT_ID,
  accountAuthEpoch: 3,
  enrollmentId: F19_ENROLLMENT_ID,
  enrollmentRevision: 4,
  deviceAuthEpoch: 5,
  enrollmentStatus: "active",
  deviceIdentityPublicKey: CLIENT_IDENTITY_PUBLIC,
  deviceAgreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  clientPrekeyCertificateDigest: F19_CERTIFICATE_DIGEST,
  clientPrekeyCertificateExpiresAt: NOW + 180_000,
  nodeId: NODE_ID,
  nodeIdentityPublicKey: NODE_IDENTITY_PUBLIC,
  nodeAgreementPublicKey: NODE_AGREEMENT_PUBLIC,
  nodeAgreementPrekeyExpiresAt: NOW + 180_000,
  nodeContinuityId: CONTINUITY_ID,
  nodePolicyGeneration: 6,
  nodeCapabilityStatementDigest: F19_STATEMENT_DIGEST,
  nodeCapabilityStatementExpiresAt: NOW + 180_000,
  relayTicketId: F19_TICKET_ID,
  relayTicketExpiresAt: NOW + 180_000,
  effectiveRole: "operator",
  effectiveCapabilities: ["ryco.rpc"],
  accountGrantAllowed: true,
  now: NOW,
};

function f19SignClaims(
  claims: HubDeviceGrantClaimsInput = F19_BASE_CLAIMS,
  seed: Uint8Array = F19_HUB_GRANT_SEED,
): {
  readonly claimsBytes: Uint8Array;
  readonly signingEnvelope: Uint8Array;
  readonly signature: Uint8Array;
  readonly envelope: Uint8Array;
} {
  const claimsBytes = encodeHubDeviceGrantClaims(claims);
  const signingEnvelope = encodeHubDeviceGrantSigningEnvelope(claimsBytes);
  const signature = ed25519.sign(signingEnvelope, seed);
  return {
    claimsBytes,
    signingEnvelope,
    signature,
    envelope: encodeHubDeviceGrantEnvelope(claimsBytes, signature),
  };
}

function f19ResignArray(array: readonly unknown[]): Uint8Array {
  const claimsBytes = encodeCanonicalE2eeCbor(array);
  return encodeHubDeviceGrantEnvelope(
    claimsBytes,
    ed25519.sign(encodeHubDeviceGrantSigningEnvelope(claimsBytes), F19_HUB_GRANT_SEED),
  );
}

function f19ClaimsArray(envelope: Uint8Array): unknown[] {
  const decodedEnvelope = decodeCanonicalE2eeCbor(envelope);
  if (decodedEnvelope.kind !== "ok" || !Array.isArray(decodedEnvelope.value)) {
    throw new Error("F19 generator expected a canonical grant envelope.");
  }
  const decodedClaims = decodeCanonicalE2eeCbor(decodedEnvelope.value[0] as Uint8Array);
  if (decodedClaims.kind !== "ok" || !Array.isArray(decodedClaims.value)) {
    throw new Error("F19 generator expected canonical grant claims.");
  }
  return [...decodedClaims.value];
}

function f19KeyJson(key: HubDeviceGrantVerificationKey): JsonValue {
  return {
    keyId: key.keyId,
    publicKey: b(key.publicKey),
    notBefore: key.notBefore,
    notAfter: key.notAfter,
  };
}

function f19BindingsJson(bindings: HubDeviceGrantBindings): JsonValue {
  return {
    issuerHubOrigin: bindings.issuerHubOrigin,
    accountId: bindings.accountId,
    accountAuthEpoch: bindings.accountAuthEpoch,
    enrollmentId: bindings.enrollmentId,
    enrollmentRevision: bindings.enrollmentRevision,
    deviceAuthEpoch: bindings.deviceAuthEpoch,
    enrollmentStatus: bindings.enrollmentStatus,
    deviceIdentityPublicKey: b(bindings.deviceIdentityPublicKey),
    deviceAgreementPublicKey: b(bindings.deviceAgreementPublicKey),
    clientPrekeyCertificateDigest: b(bindings.clientPrekeyCertificateDigest),
    clientPrekeyCertificateExpiresAt: bindings.clientPrekeyCertificateExpiresAt,
    nodeId: bindings.nodeId,
    nodeIdentityPublicKey: b(bindings.nodeIdentityPublicKey),
    nodeAgreementPublicKey: b(bindings.nodeAgreementPublicKey),
    nodeAgreementPrekeyExpiresAt: bindings.nodeAgreementPrekeyExpiresAt,
    nodeContinuityId: bindings.nodeContinuityId,
    nodePolicyGeneration: bindings.nodePolicyGeneration,
    nodeCapabilityStatementDigest: b(bindings.nodeCapabilityStatementDigest),
    nodeCapabilityStatementExpiresAt: bindings.nodeCapabilityStatementExpiresAt,
    relayTicketId: bindings.relayTicketId,
    relayTicketExpiresAt: bindings.relayTicketExpiresAt,
    effectiveRole: bindings.effectiveRole,
    effectiveCapabilities: bindings.effectiveCapabilities,
    accountGrantAllowed: bindings.accountGrantAllowed,
    now: bindings.now,
  };
}

function f19Verdict(
  envelope: Uint8Array,
  verificationKeys: readonly HubDeviceGrantVerificationKey[],
  bindings: HubDeviceGrantBindings,
): JsonValue {
  const result = verifyHubDeviceGrant({ envelope, verificationKeys, bindings });
  return result.kind === "ok" ? { kind: "ok" } : { kind: "error", reason: result.reason };
}

function f19Case(input: {
  readonly name: string;
  readonly envelope: Uint8Array;
  readonly verificationKeys?: readonly HubDeviceGrantVerificationKey[];
  readonly bindings?: HubDeviceGrantBindings;
  readonly note?: string;
  readonly inputsExtra?: Readonly<Record<string, JsonValue>>;
  readonly expectedExtra?: Readonly<Record<string, JsonValue>>;
}): FixtureCase {
  const verificationKeys = input.verificationKeys ?? [F19_BASE_KEY];
  const bindings = input.bindings ?? F19_BASE_BINDINGS;
  return {
    name: input.name,
    sections: ["18.2", "18.3", "18.7", "16.3 F19"],
    ...(input.note === undefined ? {} : { note: input.note }),
    inputs: {
      envelope: b(input.envelope),
      verificationKeys: verificationKeys.map(f19KeyJson),
      bindings: f19BindingsJson(bindings),
      ...input.inputsExtra,
    },
    expected: {
      ...(f19Verdict(input.envelope, verificationKeys, bindings) as Record<string, JsonValue>),
      ...input.expectedExtra,
    },
  };
}

function f19AccountHandshakeTrace(valid: ReturnType<typeof f19SignClaims>): {
  readonly inputs: Readonly<Record<string, JsonValue>>;
  readonly expected: Readonly<Record<string, JsonValue>>;
} {
  const verifiedGrant = verifyHubDeviceGrant({
    envelope: valid.envelope,
    verificationKeys: [F19_BASE_KEY],
    bindings: F19_BASE_BINDINGS,
  });
  if (verifiedGrant.kind !== "ok") throw new Error("F19 account grant did not verify.");

  const channel = handshakeChannel({
    relayProtocolMinor: 3,
    accountGrantContext: {
      relayTicketId: F19_TICKET_ID,
      deviceGrantDigest: verifiedGrant.grantDigest,
      nodeCapabilityStatementDigest: F19_STATEMENT_DIGEST,
    },
  });
  const advertised = advertisedMaterial({
    policyGeneration: F19_BASE_CLAIMS.nodePolicyGeneration,
    capabilityStatementDigest: F19_STATEMENT_DIGEST,
  });
  const credentials: E2eeClientHandshakeCredentials = {
    tier: "native",
    trustSource: "account-enrolled",
    accountId: F19_ACCOUNT_ID,
    identityPublicKey: CLIENT_IDENTITY_PUBLIC,
    agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
    agreementSecretKey: CLIENT_AGREEMENT_SECRET,
    prekeyTranscript: F19_CLIENT_PREKEY_TRANSCRIPT,
    prekeySignature: F19_CLIENT_PREKEY_SIGNATURE,
    deviceGrant: verifiedGrant,
  };
  const client = new E2eeClientHandshake({
    channel,
    advertised,
    selectedSuite: E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
    offeredSuites: [
      E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
      E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    ],
    credentials,
    intendedCapability: CHANNEL_OPEN_CAPABILITY,
    intendedRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
    testOnlyClientNonce: copyOf(CLIENT_NONCE),
    testOnlyEphemeralSecretKey: copyOf(CLIENT_EPHEMERAL_SECRET),
  });
  const hello = client.createHello(NOW);
  if (hello.kind !== "hello") throw new Error("F19 account hello was not created.");

  let localAuthorizationReads = 0;
  let pairingEvaluations = 0;
  let grantVerifications = 0;
  const node = new E2eeNodeHandshake({
    channel,
    advertised,
    advertisedVersionMin: 1,
    advertisedVersionMax: 1,
    agreementSecretKey: NODE_AGREEMENT_SECRET,
    advertisementEmittedAt: NOW,
    readPolicy: () => ({
      requireApprovedClientE2EE: false,
      suiteRegistry: [
        E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
        E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      ],
    }),
    lookupClientAuthorization: () => {
      localAuthorizationReads += 1;
      return APPROVED_AUTHORIZATION;
    },
    evaluatePairingAdmission: () => {
      pairingEvaluations += 1;
    },
    verifyAccountGrant: (input) => {
      grantVerifications += 1;
      return (
        verifyHubDeviceGrant({
          envelope: input.grant.envelope,
          verificationKeys: [F19_BASE_KEY],
          bindings: {
            ...F19_BASE_BINDINGS,
            now: input.now,
            clientPrekeyCertificateDigest: input.certificateDigest,
            clientPrekeyCertificateExpiresAt: input.certificate.expiresAt,
            nodeId: input.advertised.nodeId,
            nodeAgreementPublicKey: input.advertised.agreementPublicKey,
            nodeContinuityId: input.advertised.continuityId,
            nodePolicyGeneration: input.advertised.policyGeneration ?? -1,
            nodeCapabilityStatementDigest:
              input.advertised.capabilityStatementDigest ?? new Uint8Array(0),
            relayTicketId: input.channel.accountGrantContext?.relayTicketId ?? "",
            effectiveRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
            effectiveCapabilities: [CHANNEL_OPEN_CAPABILITY],
          },
        }).kind === "ok"
      );
    },
    testOnlyEphemeralSecretKey: copyOf(NODE_EPHEMERAL_SECRET),
  });
  const accept = node.receiveHello(hello.record, NOW);
  if (accept.kind !== "accepted") throw new Error("F19 account hello was not accepted.");
  const established = client.receiveServerAccept(accept.record, NOW);
  if (established.kind !== "established") {
    throw new Error("F19 account handshake did not establish.");
  }
  const decodedHello = decodeE2eeClientHello(hello.record);
  const decodedAccept = decodeE2eeServerAccept(accept.record);
  const decodedContext = decodeCanonicalE2eeCbor(hello.contextBlock);
  if (
    decodedHello.kind !== "ok" ||
    decodedAccept.kind !== "ok" ||
    decodedContext.kind !== "ok" ||
    !Array.isArray(decodedContext.value)
  ) {
    throw new Error("F19 account trace did not strict-decode.");
  }
  const message1Payload = encodeE2eeAccountGrantIkHelloPayload({
    clientPrekeyTranscript: F19_CLIENT_PREKEY_TRANSCRIPT,
    clientPrekeySignature: F19_CLIENT_PREKEY_SIGNATURE,
    accountId: F19_ACCOUNT_ID,
    intendedCapability: CHANNEL_OPEN_CAPABILITY,
    intendedRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
    hubDeviceGrant: valid.envelope,
  });
  const decodedMessage1Payload = decodeCanonicalE2eeCbor(message1Payload);
  if (decodedMessage1Payload.kind !== "ok" || !Array.isArray(decodedMessage1Payload.value)) {
    throw new Error("F19 account payload did not strict-decode.");
  }
  const message2Payload = encodeE2eeServerAcceptPayload({
    channelOpenCapability: CHANNEL_OPEN_CAPABILITY,
    channelOpenEffectiveRole: CHANNEL_OPEN_EFFECTIVE_ROLE,
    nodeAgreementKeyFingerprint: NODE_AGREEMENT_FINGERPRINT,
  });
  const noiseHandshakeHash = replayNoiseHandshakeHash({
    tier: "native",
    prologue: hello.prologue,
    message1Payload,
    message2Payload,
    message1: decodedHello.value.noiseMessage1,
    message2: decodedAccept.value.noiseMessage2,
  });
  const independentNoise = composeIndependentNoise({
    pattern: "IK",
    prologue: hello.prologue,
    initiatorStaticSecret: CLIENT_AGREEMENT_SECRET,
    initiatorEphemeralSecret: CLIENT_EPHEMERAL_SECRET,
    responderStaticSecret: NODE_AGREEMENT_SECRET,
    responderEphemeralSecret: NODE_EPHEMERAL_SECRET,
    message1Payload,
    message2Payload,
  });
  if (
    hex(independentNoise.message1) !== hex(decodedHello.value.noiseMessage1) ||
    hex(independentNoise.message2) !== hex(decodedAccept.value.noiseMessage2) ||
    hex(independentNoise.handshakeHash) !== hex(noiseHandshakeHash)
  ) {
    throw new Error("Independent F19 Noise composition disagreed with the account handshake.");
  }

  const trace: HandshakeTrace = {
    tier: "native",
    channel,
    advertised,
    contextBlock: copyOf(hello.contextBlock),
    contextCommitment: copyOf(hello.contextCommitment),
    prologue: copyOf(hello.prologue),
    helloRecord: copyOf(hello.record),
    helloPayloadPlaintext: message1Payload,
    noiseMessage1: copyOf(decodedHello.value.noiseMessage1),
    serverAcceptRecord: copyOf(accept.record),
    serverAcceptTbs: copyOf(accept.serverAcceptTbs),
    noiseMessage2: copyOf(decodedAccept.value.noiseMessage2),
    noiseHandshakeHash,
    noiseChainingKeyFinal: independentNoise.chainingKeyFinal,
    acceptPayloadPlaintext: message2Payload,
    confirmationTranscript: copyOf(accept.confirmationTranscript),
    serverConfirmation: copyOf(decodedAccept.value.serverConfirmation),
    sessionBindingHash: copyOf(established.sessionBindingHash),
    epochSecretC2N: copyOf(established.secrets.epochSecretC2N),
    epochSecretN2C: copyOf(established.secrets.epochSecretN2C),
    exporterSecret: copyOf(established.secrets.exporterSecret),
    serverConfirmationKey: copyOf(established.secrets.serverConfirmationKey),
    aeadKeyC2N: deriveE2eeAeadKey(
      established.secrets.epochSecretC2N,
      E2EE_DIRECTION_CLIENT_TO_NODE,
    ),
    aeadKeyN2C: deriveE2eeAeadKey(
      established.secrets.epochSecretN2C,
      E2EE_DIRECTION_NODE_TO_CLIENT,
    ),
    admittedAuthority: accept.admittedAuthority,
    implicitFinishDeadlineAt: accept.implicitFinishDeadlineAt,
    secretsAgree:
      hex(accept.secrets.epochSecretC2N) === hex(established.secrets.epochSecretC2N) &&
      hex(accept.secrets.epochSecretN2C) === hex(established.secrets.epochSecretN2C) &&
      hex(accept.secrets.exporterSecret) === hex(established.secrets.exporterSecret) &&
      hex(accept.secrets.serverConfirmationKey) === hex(established.secrets.serverConfirmationKey),
  };
  const authority = accept.accountGrantAuthority;
  if (authority === undefined) throw new Error("F19 account lease handle is missing.");
  const result = {
    inputs: {
      tier: "native",
      pattern: E2EE_NOISE_PATTERN_IK,
      selectedSuite: E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
      offeredSuites: [
        E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
        E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      ],
      clientPrekeyTranscript: b(F19_CLIENT_PREKEY_TRANSCRIPT),
      clientPrekeySignature: b(F19_CLIENT_PREKEY_SIGNATURE),
      certificateCarrier: b(F19_CLIENT_PREKEY_CARRIER),
      now: NOW,
    },
    expected: {
      ...handshakeIntermediates(trace),
      certificateCarrier: b(F19_CLIENT_PREKEY_CARRIER),
      certificateCarrierDigest: b(F19_CERTIFICATE_DIGEST),
      contextElements: decodedContext.value.length,
      helloWrapperElements: 7,
      message1PayloadElements: decodedMessage1Payload.value.length,
      clientTrustSource: established.trustSource,
      nodeTrustSource: accept.trustSource,
      localAuthorizationReads,
      pairingEvaluations,
      grantVerifications,
      accountGrantAuthority: {
        trustSource: authority.trustSource,
        hubOrigin: authority.hubOrigin,
        accountId: authority.accountId,
        enrollmentId: authority.enrollmentId,
        enrollmentRevision: authority.enrollmentRevision,
        accountAuthEpoch: authority.accountAuthEpoch,
        deviceAuthEpoch: authority.deviceAuthEpoch,
        clientIdentityFingerprint: b(authority.clientIdentityFingerprint),
        maximumRole: authority.maximumRole,
        capabilitySet: [...authority.capabilitySet],
      },
    },
  } satisfies {
    readonly inputs: Readonly<Record<string, JsonValue>>;
    readonly expected: Readonly<Record<string, JsonValue>>;
  };
  eraseE2eeSessionSecrets(established.secrets);
  eraseE2eeSessionSecrets(accept.secrets);
  return result;
}

function buildFamily19(): FixtureFamily {
  const valid = f19SignClaims();
  const accountTrace = f19AccountHandshakeTrace(valid);
  const cases: FixtureCase[] = [
    f19Case({
      name: "valid-account-enrolled-native-device-grant",
      envelope: valid.envelope,
      inputsExtra: accountTrace.inputs,
      expectedExtra: {
        claimsBytes: b(valid.claimsBytes),
        signingEnvelope: b(valid.signingEnvelope),
        signature: b(valid.signature),
        envelope: b(valid.envelope),
        grantDigest: b(nobleSha256(valid.envelope)),
        envelopeBytes: valid.envelope.byteLength,
        ...accountTrace.expected,
      },
    }),
  ];

  const maxClaims = {
    ...F19_BASE_CLAIMS,
    keyId: `hgk_${"K".repeat(43)}`,
    grantId: `hgr_${"G".repeat(43)}`,
    accountId: `acct_${"A".repeat(43)}`,
    enrollmentId: `enr_${"E".repeat(43)}`,
    nodeId: `node_${"N".repeat(43)}`,
    relayTicketId: `rtk_${"T".repeat(43)}`,
  } as HubDeviceGrantClaimsInput;
  const max = f19SignClaims(maxClaims);
  const maxKey = { ...F19_BASE_KEY, keyId: maxClaims.keyId };
  const maxBindings: HubDeviceGrantBindings = {
    ...F19_BASE_BINDINGS,
    accountId: maxClaims.accountId,
    enrollmentId: maxClaims.enrollmentId,
    nodeId: maxClaims.nodeId,
    relayTicketId: maxClaims.relayTicketId,
  };
  cases.push(
    f19Case({
      name: "maximum-width-conforming-grant-fits-the-hard-envelope-bound",
      envelope: max.envelope,
      verificationKeys: [maxKey],
      bindings: maxBindings,
      expectedExtra: {
        envelopeBytes: max.envelope.byteLength,
        maximumEnvelopeBytes: E2EE_HUB_DEVICE_GRANT_MAX_BYTES,
        withinBound: max.envelope.byteLength <= E2EE_HUB_DEVICE_GRANT_MAX_BYTES,
      },
    }),
    f19Case({
      name: "exactly-2048-bytes-is-not-rejected-as-oversize",
      envelope: new Uint8Array(E2EE_HUB_DEVICE_GRANT_MAX_BYTES),
    }),
    f19Case({
      name: "one-byte-over-the-grant-bound-is-rejected-before-cbor",
      envelope: new Uint8Array(E2EE_HUB_DEVICE_GRANT_MAX_BYTES + 1),
    }),
    f19Case({ name: "malformed-grant-envelope", envelope: new Uint8Array([0xff]) }),
    f19Case({
      name: "non-canonical-grant-envelope",
      envelope: widenArrayHeader(valid.envelope),
    }),
  );

  for (const [name, index, value] of [
    ["unsupported-grant-version", 1, 2],
    ["unsupported-grant-suite", 2, 1],
  ] as const) {
    const array = f19ClaimsArray(valid.envelope);
    array[index] = value;
    cases.push(f19Case({ name, envelope: f19ResignArray(array) }));
  }
  const short = f19ClaimsArray(valid.envelope).slice(0, -1);
  cases.push(
    f19Case({ name: "wrong-grant-claims-element-count", envelope: f19ResignArray(short) }),
  );
  const wrongFingerprint = f19ClaimsArray(valid.envelope);
  wrongFingerprint[13] = new Uint8Array(32).fill(0xaa);
  cases.push(
    f19Case({
      name: "carried-device-fingerprint-is-recomputed",
      envelope: f19ResignArray(wrongFingerprint),
    }),
  );

  cases.push(
    f19Case({
      name: "signature-under-an-unrelated-hub-key",
      envelope: f19SignClaims(F19_BASE_CLAIMS, F19_OTHER_HUB_GRANT_SEED).envelope,
    }),
    f19Case({
      name: "cross-domain-signature-over-bare-claims",
      envelope: encodeHubDeviceGrantEnvelope(
        valid.claimsBytes,
        ed25519.sign(valid.claimsBytes, F19_HUB_GRANT_SEED),
      ),
    }),
    f19Case({
      name: "unknown-hub-verification-key-id",
      envelope: valid.envelope,
      verificationKeys: [{ ...F19_BASE_KEY, keyId: `hgk_${"X".repeat(22)}` }],
    }),
    f19Case({
      name: "duplicate-hub-verification-key-id",
      envelope: valid.envelope,
      verificationKeys: [F19_BASE_KEY, F19_BASE_KEY],
    }),
    f19Case({
      name: "retired-hub-verification-key",
      envelope: valid.envelope,
      verificationKeys: [{ ...F19_BASE_KEY, notAfter: F19_BASE_CLAIMS.expiresAt - 1 }],
    }),
  );

  const futureClaims = {
    ...F19_BASE_CLAIMS,
    issuedAt: NOW + 30_001,
    notBefore: NOW + 30_001,
    expiresAt: NOW + 90_001,
  } as HubDeviceGrantClaimsInput;
  cases.push(
    f19Case({
      name: "grant-one-millisecond-beyond-early-clock-skew",
      envelope: f19SignClaims(futureClaims).envelope,
    }),
    f19Case({
      name: "grant-at-the-early-clock-skew-boundary",
      envelope: f19SignClaims({
        ...futureClaims,
        issuedAt: NOW + 30_000,
        notBefore: NOW + 30_000,
        expiresAt: NOW + 90_000,
      } as HubDeviceGrantClaimsInput).envelope,
    }),
    f19Case({
      name: "grant-one-millisecond-after-expiry",
      envelope: valid.envelope,
      bindings: { ...F19_BASE_BINDINGS, now: F19_BASE_CLAIMS.expiresAt + 1 },
    }),
    f19Case({
      name: "grant-at-the-exact-expiry-boundary",
      envelope: valid.envelope,
      bindings: { ...F19_BASE_BINDINGS, now: F19_BASE_CLAIMS.expiresAt },
    }),
  );

  const otherAgreementKey = x25519.getPublicKey(seedOf(0x51));
  const otherDeviceKey = p256.getPublicKey(seedOf(0x52), false);
  const otherNodeKey = ed25519.getPublicKey(seedOf(0x53));
  const bindingMutations: readonly [string, HubDeviceGrantBindings][] = [
    ["origin", { ...F19_BASE_BINDINGS, issuerHubOrigin: OTHER_HUB_ORIGIN }],
    ["account-id", { ...F19_BASE_BINDINGS, accountId: `acct_${"Z".repeat(22)}` }],
    ["account-epoch", { ...F19_BASE_BINDINGS, accountAuthEpoch: 4 }],
    ["enrollment-id", { ...F19_BASE_BINDINGS, enrollmentId: `enr_${"Z".repeat(22)}` }],
    ["enrollment-revision", { ...F19_BASE_BINDINGS, enrollmentRevision: 5 }],
    ["device-epoch", { ...F19_BASE_BINDINGS, deviceAuthEpoch: 6 }],
    ["device-identity-key", { ...F19_BASE_BINDINGS, deviceIdentityPublicKey: otherDeviceKey }],
    ["device-agreement-key", { ...F19_BASE_BINDINGS, deviceAgreementPublicKey: otherAgreementKey }],
    [
      "client-certificate-digest",
      { ...F19_BASE_BINDINGS, clientPrekeyCertificateDigest: seedOf(0x54) },
    ],
    ["node-id", { ...F19_BASE_BINDINGS, nodeId: `node_${"Z".repeat(22)}` }],
    ["node-identity-key", { ...F19_BASE_BINDINGS, nodeIdentityPublicKey: otherNodeKey }],
    ["node-agreement-key", { ...F19_BASE_BINDINGS, nodeAgreementPublicKey: otherAgreementKey }],
    ["node-continuity-id", { ...F19_BASE_BINDINGS, nodeContinuityId: OTHER_CONTINUITY_ID }],
    ["node-policy-generation", { ...F19_BASE_BINDINGS, nodePolicyGeneration: 7 }],
    [
      "node-statement-digest",
      { ...F19_BASE_BINDINGS, nodeCapabilityStatementDigest: seedOf(0x55) },
    ],
    ["relay-ticket-replay", { ...F19_BASE_BINDINGS, relayTicketId: `rtk_${"Z".repeat(22)}` }],
  ];
  for (const [binding, bindings] of bindingMutations) {
    cases.push(
      f19Case({
        name: `wrong-${binding}-binding`,
        envelope: valid.envelope,
        bindings,
      }),
    );
  }

  for (const [name, bindings] of [
    [
      "relay-ticket-expires-before-the-grant",
      { ...F19_BASE_BINDINGS, relayTicketExpiresAt: F19_BASE_CLAIMS.expiresAt - 1 },
    ],
    [
      "client-certificate-expires-before-the-grant",
      { ...F19_BASE_BINDINGS, clientPrekeyCertificateExpiresAt: F19_BASE_CLAIMS.expiresAt - 1 },
    ],
    [
      "node-statement-expires-before-the-grant",
      { ...F19_BASE_BINDINGS, nodeCapabilityStatementExpiresAt: F19_BASE_CLAIMS.expiresAt - 1 },
    ],
    [
      "node-prekey-expires-before-the-grant",
      { ...F19_BASE_BINDINGS, nodeAgreementPrekeyExpiresAt: F19_BASE_CLAIMS.expiresAt - 1 },
    ],
  ] as const) {
    cases.push(f19Case({ name, envelope: valid.envelope, bindings }));
  }

  cases.push(
    f19Case({
      name: "revoked-enrollment",
      envelope: valid.envelope,
      bindings: { ...F19_BASE_BINDINGS, enrollmentStatus: "revoked" },
    }),
    f19Case({
      name: "local-policy-denies-account-grant",
      envelope: valid.envelope,
      bindings: { ...F19_BASE_BINDINGS, accountGrantAllowed: false },
    }),
    f19Case({
      name: "effective-role-escalates-above-grant-ceiling",
      envelope: valid.envelope,
      bindings: { ...F19_BASE_BINDINGS, effectiveRole: "owner" },
    }),
    f19Case({
      name: "effective-capabilities-are-not-a-distinct-subset",
      envelope: valid.envelope,
      bindings: { ...F19_BASE_BINDINGS, effectiveCapabilities: ["ryco.rpc", "ryco.rpc"] },
    }),
  );

  return {
    file: "f19-account-device-grant.json",
    number: 19,
    title: "Account-enrolled native Hub device grants",
    sections: ["18.2", "18.3", "18.7", "16.3 F19"],
    summary:
      "Canonical Hub device-grant claims, domain-separated Ed25519 verification, hard pre-decode bounds, complete authenticated caller bindings, clock/key overlap, replay, revocation, authority intersection, and a deterministic full suite-0x02 IK trace independently composed through the reference Noise implementation.",
    deferred: [
      "§16.3 F19 relay-minor, connector-generation, statement-acknowledgement, retained-prekey, in-flight revocation, lease, durable-write, and four-mode policy vectors are deferred. Owned by the node and Hub lifecycle implementations.",
      "§16.3 F19 Web-isolation vectors are deferred. Owned by the Web isolation implementation.",
      crossRuntimeDeferral(19),
    ],
    testKeyMaterial: {
      shared: SHARED_TEST_KEY_MATERIAL,
      testOnlyHubGrantSeed: b(F19_HUB_GRANT_SEED),
      hubGrantPublicKey: b(F19_HUB_GRANT_PUBLIC),
      testOnlyUnrelatedHubGrantSeed: b(F19_OTHER_HUB_GRANT_SEED),
      handshake: HANDSHAKE_TEST_KEY_MATERIAL,
    },
    cases,
  };
}

// ─── corpus assembly ─────────────────────────────────────────────────────────

/**
 * The §16.3 families this generator emits no file for at all. It is EMPTY: every
 * family F1–F19 now has a file. What several of those files still defer is
 * recorded per family, in the file's own `deferred` array and in the manifest's
 * `partialFamilies` list, so a reader of the corpus alone can see exactly which
 * §16.3 cases are missing and which component will own each.
 *
 * It is kept, and kept exported, because a family that later has to be removed
 * wholesale MUST land here rather than vanishing: a corpus that silently omits a
 * family is exactly the failure §16.3 is written to prevent.
 */
export const DEFERRED_FAMILIES: readonly {
  readonly family: number;
  readonly title: string;
  readonly reason: string;
  readonly ownedBy: string;
}[] = [];

/**
 * THE MEASURED LIVENESS CENSUS.
 *
 * §16.3 says which cases the corpus must carry. Nothing in it, and nothing in
 * the consuming ledger, says whether a committed case ASSERTS anything — and a
 * sweep over every scalar under every `expected` block found that roughly half
 * of them are read by no test at all. A reader who opens this corpus sees 334
 * cases and 3,434 expectations and has no way to learn that without repeating
 * the sweep, so the measurement is recorded here, per family, as numbers.
 *
 * These are MEASUREMENTS, not invariants — but they are pinned in both
 * directions rather than only from below. `cases` and `expectedLeaves` are
 * re-derived from the committed files by the consuming suite and cannot drift
 * from them. `liveLeaves` is the result of a run, and the consuming suite
 * asserts it EQUALS what the instrumented suites read: the shared suite's own
 * reads plus the leaves listed, path by path, in
 * `E2EE_CORPUS_DELEGATED_LEAF_READS` for the suites that read what it cannot.
 * A number here that drifts above reality fails a test; re-measuring means
 * re-running the three consuming suites with the recorder in
 * `packages/shared/src/relayE2eeCorpusLiveness.ts`.
 *
 * WHAT A HIGH `livePercent` DOES NOT MEAN. Read-liveness counts a leaf a suite
 * touched, and the per-case rule the suites enforce is a floor of one live leaf.
 * Neither says a case's expectations are meaningfully asserted. `casesByLive-
 * LeafCount` beside these numbers is the honest shape.
 */
const LIVENESS_CENSUS_FAMILIES: readonly JsonValue[] = [
  {
    family: 1,
    file: "f01-payload-discrimination.json",
    cases: 19,
    expectedLeaves: 167,
    liveLeaves: 167,
    inertLeaves: 0,
    livePercent: 100.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "None measured: every leaf of every case is read by the shared consuming suite, which re-runs the §4.3 pipeline, the chunk assembler and the §4.2 send path over each case's own bytes. What remains for this family is the §16.4 cross-runtime run.",
    residualOwner: "the web phase and the native rollout, for the §16.4 run only",
  },
  {
    family: 2,
    file: "f02-carrier-compatibility.json",
    cases: 5,
    expectedLeaves: 30,
    liveLeaves: 16,
    inertLeaves: 14,
    livePercent: 53.3,
    casesWithNoLiveLeaf: 0,
    residual:
      "Fourteen leaves inert, all of them C1's and C6's restatements of an assembler or classifier result the same case already states elsewhere (`assembler`, `reassemblyError`, `peerSupportsChunkingLatch`, `isChunkedPayload`, `step2Discrimination`), plus the C5 defect-reply block.",
    residualOwner: "the F2 carrier harness",
  },
  {
    family: 3,
    file: "f03-capability-statement.json",
    cases: 35,
    expectedLeaves: 190,
    liveLeaves: 80,
    inertLeaves: 110,
    livePercent: 42.1,
    casesWithNoLiveLeaf: 17,
    residual:
      "110 leaves inert and seventeen cases with no live leaf at all — the largest hole in the corpus. The `selfCheck` verdicts (14 leaves) are the node advertisement self-check, which lives in apps/server and no consuming suite drives; `bounds`, `encoderAccepted`, `encoderRejects`, `expectedAccepted` and `transcriptBytes` are derivable from the §7.2 transcript encoder already reachable from packages/shared and simply have no consumer yet.",
    residualOwner:
      "the F3 statement harness; the `selfCheck` half additionally waits on a node-side consumer",
  },
  {
    family: 4,
    file: "f04-prekey-certificates.json",
    cases: 25,
    expectedLeaves: 81,
    liveLeaves: 80,
    inertLeaves: 1,
    livePercent: 98.8,
    casesWithNoLiveLeaf: 0,
    residual:
      "One leaf inert, after the F4 certificate harness drove the node path this family had carried unread since it was committed: `enforcedBy` on the foreign-account-id case, a §16.2 prose pointer to §8.3 element 10 and family F16 rather than a value any module derives. Everything else is now driven — the §7.3 node transcript is rebuilt and its cross-signature re-verified, all five node-certificate substitutions go through the §7.6 reconstruction, both maximum-size transcripts are decoded and fed back through their own encoders against the §3.2.1 S9 and S2 bounds, and every rejected client certificate is held to the single §11.2 row.",
    residualOwner:
      "no residual harness work; the one prose pointer's subject is carried as a case in F16",
  },
  {
    family: 5,
    file: "f05-continuity-chains.json",
    cases: 20,
    expectedLeaves: 66,
    liveLeaves: 52,
    inertLeaves: 14,
    livePercent: 78.8,
    casesWithNoLiveLeaf: 0,
    residual:
      "Fourteen leaves inert: the §5.5 size figures beside the two max-depth chains (`statementBytes`, `carrierMaxBytes`, `capabilityTranscriptBytes`, `continuityTranscriptBytes`, `advertisementMinChunkBytes`) and the pin-update pair on the same two cases.",
    residualOwner: "the F5 size-argument harness",
  },
  {
    family: 6,
    file: "f06-ik-handshake.json",
    cases: 1,
    expectedLeaves: 64,
    liveLeaves: 28,
    inertLeaves: 36,
    livePercent: 43.8,
    casesWithNoLiveLeaf: 0,
    residual:
      "36 of the single trace's 64 leaves inert, 22 of them the `firstProtectedEnvelopes` block: its AADs and §8.9 implicit-finish gate are read, its envelope bytes, positions and per-side received blocks are not. The §8.6 step-6 `admittedAuthority` snapshot (6) is also unread here — F16 carries the same snapshot and drives it.",
    residualOwner: "the F6/F7 handshake harness",
  },
  {
    family: 7,
    file: "f07-nx-handshake.json",
    cases: 3,
    expectedLeaves: 75,
    liveLeaves: 33,
    inertLeaves: 42,
    livePercent: 44.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "42 leaves inert: the same `firstProtectedEnvelopes` block as F6, plus the §11.5 `observable` of the two negative NX cases.",
    residualOwner: "the F6/F7 handshake harness",
  },
  {
    family: 8,
    file: "f08-record-protection.json",
    cases: 13,
    expectedLeaves: 148,
    liveLeaves: 117,
    inertLeaves: 31,
    livePercent: 79.1,
    casesWithNoLiveLeaf: 0,
    residual:
      "31 leaves inert after this round drove the six tampering cases and both counter-zero-and-one round trips through the real §9.1 path. What remains is the control-record case's `firstReceived`/`secondReceived` blocks and the constant restatements beside the two AAD cases.",
    residualOwner: "the F8 record harness",
  },
  {
    family: 9,
    file: "f09-rekey-boundaries.json",
    cases: 15,
    expectedLeaves: 589,
    liveLeaves: 182,
    inertLeaves: 407,
    livePercent: 30.9,
    casesWithNoLiveLeaf: 0,
    residual:
      "407 leaves inert — the largest inert block left in the corpus. The epoch schedule and the two §9.6 exhaustion verdicts are derived; the per-record `records` arrays (140 leaves) and the `closeRecords` arrays (96) that carry each close-machine record's body, commitment and envelope are not. The 200-leaf `steps` state trace that used to sit beside them was DELETED this round and declared in this family's `deferred` list rather than left counted.",
    residualOwner: "the close-machine derivation harness",
  },
  {
    family: 10,
    file: "f10-mode-machine.json",
    cases: 34,
    expectedLeaves: 361,
    liveLeaves: 361,
    inertLeaves: 0,
    livePercent: 100.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "None measured: every leaf is read once the node consuming suite's run is unioned with the shared one. The node rows are driven against the real runtime; the client rows remain declared in this family's `deferred` list.",
    residualOwner: "the client phase, for the client rows the family still defers",
  },
  {
    family: 11,
    file: "f11-authenticated-close.json",
    cases: 20,
    expectedLeaves: 396,
    liveLeaves: 198,
    inertLeaves: 198,
    livePercent: 50.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "198 leaves inert. Every close-machine body, commitment preimage and commitment is rebuilt from the case's own declared fields, but the `records` arrays' envelope bytes and positions (96 leaves) and most `received` blocks are unread. The 197-leaf `steps` state trace was DELETED this round and declared rather than left counted.",
    residualOwner: "the close-machine derivation harness",
  },
  {
    family: 12,
    file: "f12-error-records.json",
    cases: 12,
    expectedLeaves: 120,
    liveLeaves: 42,
    inertLeaves: 78,
    livePercent: 35.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "78 leaves inert. The `E2EEHandshakeReject` record is pinned byte for byte; the protected `E2EEError` cases' `received` blocks (21 leaves) and their §11.5 `observable` blocks (12) are not read — both need a session to open the record with.",
    residualOwner: "the F12 error-record harness",
  },
  {
    family: 13,
    file: "f13-fingerprints.json",
    cases: 4,
    expectedLeaves: 8,
    liveLeaves: 8,
    inertLeaves: 0,
    livePercent: 100.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "None measured: every fingerprint vector is recomputed by the shared consuming suite.",
    residualOwner: "no residual",
  },
  {
    family: 14,
    file: "f14-verification-display.json",
    cases: 6,
    expectedLeaves: 46,
    liveLeaves: 30,
    inertLeaves: 16,
    livePercent: 65.2,
    casesWithNoLiveLeaf: 0,
    residual:
      "Sixteen leaves inert, all of them the §13.4/§13.5 `displayFormat` blocks — the grouping, separator and casing rules of the rendered form, as opposed to the digits themselves, which are derived.",
    residualOwner: "the F14 display harness",
  },
  {
    family: 15,
    file: "f15-noise-core-vectors.json",
    cases: 4,
    expectedLeaves: 22,
    liveLeaves: 22,
    inertLeaves: 0,
    livePercent: 100.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "None measured: all four transcoded vectors are driven by packages/shared/src/relayE2eeNoise.test.ts. They read as inert in the shared corpus suite, which is why the per-case liveness table delegates them to that suite explicitly.",
    residualOwner: "no residual",
  },
  {
    family: 16,
    file: "f16-authorization-context.json",
    cases: 34,
    expectedLeaves: 332,
    liveLeaves: 144,
    inertLeaves: 188,
    livePercent: 43.4,
    casesWithNoLiveLeaf: 0,
    residual:
      "188 leaves inert. The context commitment, the §8.7 confirmation transcript, the client-side suite-strip verdict and the withdrawal verdicts are derived; the per-case `elements` blocks (65 leaves) that restate each §8.3 context element and the §11.5 `observable` blocks (65) are not read.",
    residualOwner: "the F16 context harness",
  },
  {
    family: 17,
    file: "f17-key-material-validation.json",
    cases: 26,
    expectedLeaves: 197,
    liveLeaves: 168,
    inertLeaves: 29,
    livePercent: 85.3,
    casesWithNoLiveLeaf: 0,
    residual:
      "29 leaves inert, after the F17 key-material harness drove the Ed25519 canonicality group and every remaining verification verdict. What is left is a LABEL residual rather than a derivation one: `positionNote` (9) and the p256-signature `fatal` rows (7) are §11 position rows this family's own `deferred` list already declares undecidable from packages/shared — they depend on the §5.2 verifier and the §12.1.1 selection classification; `rejectedBeforeAnySignatureCheck` (9) is an ORDERING claim no consumer here can observe, because nothing exposes that no signature check ran; and the `disposition`/`mandatedBehavior` pair beside each X25519 case (4) restates §8.1's mandated handling in prose.",
    residualOwner:
      "the §5.2 statement verifier and the client phase, for the position rows; the ordering claim needs an instrumented §8.6 step-5 consumer",
  },
  {
    family: 18,
    file: "f18-node-admission-policy.json",
    cases: 15,
    expectedLeaves: 405,
    liveLeaves: 405,
    inertLeaves: 0,
    livePercent: 100.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "None measured: every leaf is read once the node consuming suite's run is unioned with the shared one; the §12.6 procedure is driven against the real policy store.",
    residualOwner: "no residual",
  },
  {
    family: 19,
    file: "f19-account-device-grant.json",
    cases: 43,
    expectedLeaves: 137,
    liveLeaves: 137,
    inertLeaves: 0,
    livePercent: 100.0,
    casesWithNoLiveLeaf: 0,
    residual:
      "None measured in the landed grant and suite-0x02 IK slices: every expected grant byte and verdict is replayed through the shared verifier, and the complete account-enrolled handshake trace is reconstructed by the shared implementation plus the import-isolated Noise reference. The family-level deferred list names the node/Hub lifecycle, Web-isolation, and cross-runtime work not yet carried by this file.",
    residualOwner: "the remaining F19 implementation phases named by the family deferrals",
  },
];

export interface E2eeFixtureCorpus {
  /** Generated family files, keyed by filename, as UTF-8 JSON text. */
  readonly files: ReadonlyMap<string, string>;
  readonly manifestJson: string;
}

function familyJson(family: FixtureFamily): string {
  const document = {
    family: {
      number: family.number,
      title: family.title,
      sections: family.sections,
      summary: family.summary,
      generator: "scripts/generate-e2ee-fixtures.ts",
    },
    warning: WARNING,
    ...(family.deferred.length === 0 ? {} : { deferred: family.deferred }),
    testKeyMaterial: family.testKeyMaterial,
    cases: family.cases,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Build the whole corpus in memory. Asynchronous because the §4.2 send pipeline
 * is: `E2eeRecordSession.protect` takes admission and transmit callbacks and
 * awaits them, and family F1 drives it rather than reimplementing it.
 */
export async function generateE2eeFixtureCorpus(): Promise<E2eeFixtureCorpus> {
  const families: readonly FixtureFamily[] = [
    await buildFamily1(),
    buildFamily2(),
    buildFamily3(),
    buildFamily4(),
    buildFamily5(),
    await buildFamily6(),
    await buildFamily7(),
    await buildFamily8(),
    await buildFamily9(),
    await buildFamily10(),
    await buildFamily11(),
    await buildFamily12(),
    buildFamily13(),
    buildFamily14(),
    buildFamily16(),
    buildFamily17(),
    buildFamily18(),
    buildFamily19(),
  ];

  const files = new Map<string, string>();
  const entries: Record<string, JsonValue> = {};
  const partialFamilies: JsonValue[] = [];
  for (const family of [...families].toSorted((left, right) =>
    left.file.localeCompare(right.file),
  )) {
    if (family.deferred.length > 0) {
      partialFamilies.push({
        family: family.number,
        title: family.title,
        file: family.file,
        deferred: [...family.deferred],
      });
    }
    const json = familyJson(family);
    files.set(family.file, json);
    entries[family.file] = {
      family: family.number,
      title: family.title,
      sections: [...family.sections],
      sha256: sha256Hex(utf8.encode(json)),
      origin: "generated",
      generator: "scripts/generate-e2ee-fixtures.ts",
      cases: family.cases.length,
      ...(family.deferred.length === 0 ? {} : { deferred: [...family.deferred] }),
    };
  }

  // §16.3 F15 is transcoded, not generated: its digest is read off the
  // checked-in file and its metadata is preserved verbatim.
  const transcoded = new Uint8Array(
    await readFile(`${E2EE_FIXTURE_ROOT}${TRANSCODED_FAMILY_FILE}`),
  );
  entries[TRANSCODED_FAMILY_FILE] = {
    family: 15,
    title: "Noise core vectors",
    sections: ["14.1", "16.3 F15"],
    sha256: sha256Hex(transcoded),
    origin: "transcoded-upstream",
    originNote:
      "Not generated by this repository. Transcoded verbatim from the published cacophony and snow Noise test-vector sets; the file's own `provenance` array records each source repository, commit, retrieval URL, upstream file SHA-256, and git blob id.",
    sources: [
      {
        source: "cacophony",
        url: "https://raw.githubusercontent.com/haskell-cryptography/cacophony/18b7348c54fd61fcd0c220298883de0d09c8364d/vectors/cacophony.txt",
        sourceFileSha256: "3bde7c09a6f349ee11c825c50fcc02649f8f02a47c857a459206b357f9386cae",
      },
      {
        source: "snow",
        url: "https://raw.githubusercontent.com/mcginty/snow/d00b360cc61a7fe519ce7539974dca4f36c4654a/tests/vectors/snow.txt",
        sourceFileSha256: "69da433305fd045f6c9f01b656662a389d022688986fd39fbe7af009cd402fd3",
      },
    ],
  };

  const portableRunners = (file: string, caseName: string): readonly string[] => {
    if (
      file === "f01-payload-discrimination.json" &&
      caseName === "production-inner-body-exactly-at-the-plaintext-ceiling-recipe"
    ) {
      return ["reference-ts"];
    }
    if (
      (file === "f06-ik-handshake.json" && caseName === "ik-handshake-complete-trace") ||
      (file === "f07-nx-handshake.json" && caseName === "nx-handshake-complete-trace")
    ) {
      return ["snow-rust", "reference-ts", "mobile-dev-sideload"];
    }
    if (
      file === "f08-record-protection.json" ||
      (file === "f09-rekey-boundaries.json" && caseName.startsWith("epoch-key-schedule-"))
    ) {
      return ["reference-ts"];
    }
    if (file === "f04-prekey-certificates.json") {
      if (caseName === "valid-node-agreement-prekey-certificate") {
        return ["mobile-dev-sideload"];
      }
      if (caseName === "valid-client-agreement-prekey-certificate") {
        return ["reference-ts"];
      }
      if (
        caseName.startsWith("client-certificate-") &&
        /(?:non-canonical|indefinite|trailing|truncated|float|wrong-element)/u.test(caseName)
      ) {
        return ["reference-ts", "mobile-dev-sideload"];
      }
    }
    if (file === "f17-key-material-validation.json" && caseName.startsWith("p256-")) {
      return ["reference-ts", "mobile-dev-sideload"];
    }
    return [];
  };
  const allPortableCases = [
    ...families.map((family) => ({
      file: family.file,
      family: family.number,
      cases: family.cases,
    })),
    {
      file: TRANSCODED_FAMILY_FILE,
      family: 15,
      cases: (JSON.parse(new TextDecoder().decode(transcoded)) as { cases: FixtureCase[] }).cases,
    },
  ].flatMap(({ file, family, cases }) =>
    cases.map(({ name }) => ({ file, family, caseName: name })),
  );
  const portableRoutes = allPortableCases
    .map(({ file, family, caseName }) => ({
      fixtureId: `F${String(family).padStart(2, "0")}/${caseName}`,
      file,
      case: caseName,
      runners: portableRunners(file, caseName),
    }))
    .filter(({ runners }) => runners.length > 0);
  const portableExclusions = allPortableCases
    .filter(({ file, caseName }) => portableRunners(file, caseName).length === 0)
    .map(({ file, family, caseName }) => ({
      fixtureId: `F${String(family).padStart(2, "0")}/${caseName}`,
      file,
      case: caseName,
      reason:
        "Not portable in P7: this case needs a Hub/node state machine, platform UI, timing/concurrency, or a first-party-only semantic oracle beyond the independent primitive composition.",
      ownedBy: "the case's existing Node/Hub/platform consuming suite",
    }));

  const manifest = {
    formatVersion: 1,
    warning: WARNING,
    encoding: "deterministic-cbor-rfc8949",
    encodingNote:
      "The encoding identifier above applies to transcript bytes in the families that carry them. Family 15 carries no transcript bytes: its byte strings are raw Noise wire bytes and raw key material, copied verbatim from the upstream vector sets.",
    generator: "scripts/generate-e2ee-fixtures.ts",
    files: Object.fromEntries(
      Object.keys(entries)
        .toSorted()
        .map((key) => [key, entries[key]!]),
    ),
    portableExecution: {
      version: 1,
      status: "explicit exhaustive routing; physical-device execution remains an operator gate",
      limits: {
        totalJsonBytes: 2 * 1_024 * 1_024,
        familyJsonBytes: 256 * 1_024,
        families: 32,
        casesPerFamily: 64,
        totalCases: 512,
        fixtureIdUtf8Bytes: 128,
        ordinaryDecodedBytes: 16 * 1_024,
        recipePayloadBytes: 4_194_304,
      },
      routes: portableRoutes,
      exclusions: portableExclusions,
      runnerOwners: {
        "snow-rust": "packages/shared/test/independent-e2ee/snow",
        "reference-ts": "packages/shared/test/independent-e2ee/reference.test.ts",
        "mobile-dev-sideload": "apps/mobile/src/devtools/e2eeVectorRunner.ts",
      },
      doesNotProve:
        "This metadata and its automated tests do not prove a physical-device run occurred; the native release gate still requires recorded iOS and Android device results.",
    },
    deferredFamilies: DEFERRED_FAMILIES,
    /**
     * Families that are present but incomplete: what each still defers, and to
     * which component, is written out in the family file's own `deferred` array
     * and repeated in this manifest's per-file entries. §16.3 is incomplete by
     * design at this point in the rollout; a SILENT omission is what it forbids.
     *
     * This list is EXHAUSTIVE by construction — it is built from the families'
     * own `deferred` arrays, and `packages/shared/src/relayE2eeCorpus.test.ts`
     * checks every §16.3-named case against it, so a case that is neither
     * generated nor named here fails a test rather than going unnoticed.
     */
    partialFamilies: partialFamilies,
    /**
     * §16.4, declared rather than left unmentioned. It is not a missing CASE —
     * every vector below exists — but a missing RUN, and an undeclared missing
     * run reads exactly like a discharged obligation.
     */
    crossRuntime: {
      section: "16.4",
      requirement:
        "Every family runs under the repository's Node test gate. The families named below MUST ALSO run in the web browser test suite, and before the native client ships E2EE support the COMPLETE corpus MUST additionally pass on physical devices on both mobile platforms — an explicit acceptance gate of the native rollout, not an optional extra. A vector that produces different bytes on any supported runtime is a release-blocking defect.",
      status: "declared-deferred",
      browserRun: {
        state: "not-wired",
        families: [...CROSS_RUNTIME_SCOPES.keys()].toSorted((left, right) => left - right),
        scopes: Object.fromEntries(
          [...CROSS_RUNTIME_SCOPES.entries()]
            .toSorted((left, right) => left[0] - right[0])
            .map(([family, scope]) => [`F${String(family)}`, scope]),
        ),
        reason:
          "This repository has no browser test gate over packages/shared, so no vector in these families has yet been run anywhere but Node.",
        ownedBy: "the web phase",
      },
      physicalDeviceRun: {
        state: "not-wired",
        families: "all",
        reason:
          "Until the native client ships E2EE support the Node run uses the §14.5 RN-realistic crypto adapters; the physical-device pass on both mobile platforms has not been performed.",
        ownedBy: "the native rollout's acceptance gate",
      },
    },
    /**
     * WHAT THE CORPUS ACTUALLY ASSERTS, AS MEASURED NUMBERS.
     *
     * The `deferred` lists above say which §16.3 obligations the corpus does not
     * CARRY. They say nothing about the obligations it does carry, and a case
     * reduced to a name and an empty `expected` block discharges its ledger
     * obligation exactly as well as one that is re-derived through the
     * implementation. This block is the missing half: how much of what is
     * committed here is read by a test, per family, with the method stated.
     */
    livenessCensus: {
      section: "16.3",
      status: "read-liveness measured; per-case rule is a one-live-leaf floor",
      measuredOn: "2026-09-04",
      unit: 'One LEAF is one scalar under a case\'s `expected` block; a §16.2 `{"$bytes": …}` wrapper counts as one leaf, not two.',
      method:
        "READ-LIVENESS, measured in one run of each consuming suite and unioned. Every family is loaded through `packages/shared/src/relayE2eeCorpusLiveness.ts`, which hands each leaf to the suite behind an accessor that records the read; a leaf is LIVE when some suite read it. The three runs are `bun run --cwd packages/shared test` (the shared corpus suite and the F15 Noise suite) and `bun run --cwd apps/server test src` (the node suite). Re-measuring means re-running those with the recorder in place. The union is not taken on trust: every leaf a suite other than the shared one is the sole reader of is listed path by path in `E2EE_CORPUS_DELEGATED_LEAF_READS`, the shared suite rejects any such path that is not a real leaf or that it reads itself, the named suite asserts it really reads its own paths, and the per-family `liveLeaves` below is then asserted to EQUAL that union. A published figure that drifts above what the suites read fails a test.",
      whatLiveMeans:
        "Read-liveness is an UPPER BOUND on assertion. A suite that reads a value and does not compare it, or reads it only to feed it back as an input, marks it live here. It is exact in the direction that matters: a leaf no suite reads cannot be asserted by one, so every INERT leaf below is proof of absent coverage, while a LIVE leaf is only evidence of present coverage.",
      perCaseClaims:
        "packages/shared/src/relayE2eeCorpusLiveness.ts — E2EE_CORPUS_CASE_LIVENESS. Every committed case must carry at least one live leaf or appear in that table, which names the suite that reads it or declares it DECORATIVE with a reason and an owner. Each of the three consuming suites checks the claims naming it, in both directions.",
      perCaseFloor:
        "WHAT THAT RULE GUARANTEES IS A FLOOR, AND ONLY A FLOOR: each committed case has at least one leaf that some suite reads. It is NOT a guarantee that a case's expectations are meaningfully asserted, and it should not be read as one. A case can keep its name and one or two live leaves while every other field in its `expected` block is inert, and it passes every check here — 137 of the 334 committed cases have at most two live leaves and 224 have at most five. The floor's value is narrower than it looks: hollowing a case out entirely fails, and the emptiness that remains is counted and named instead of silent. For the shape rather than the threshold, read `casesByLiveLeafCount` below.",
      assertionLiveness: {
        currentCorpus:
          "PARTIAL. Two families have been swept against the corpus as it stands — F4 and F17, the two whose live counts moved this round — and for those two the tight figure now EQUALS the read-liveness figure. Every other family's number in this census is read-liveness and nothing more.",
        measuredFamilySweep: {
          families: "F4 and F17",
          method:
            'Every scalar under `expected` in both families mutated in turn, one per run — booleans negated, numbers incremented, strings altered in their first character, `{"$bytes": …}` wrappers XORed in their first byte — followed by a full run of `packages/shared/src/relayE2eeCorpus.test.ts`. A leaf counts LIVE when its mutation fails that run. Neither family has an entry in `E2EE_CORPUS_DELEGATED_LEAF_READS`, so the shared suite is their sole reader and this sweep is their whole union rather than a lower bound on it.',
          leaves: 278,
          liveLeaves: 248,
          inertLeaves: 30,
          agreesWithReadLiveness: true,
          note: "248 of 278, and the 30 that survive mutation are EXACTLY the 30 the per-family residuals below declare inert: F4's one `enforcedBy` prose pointer, and F17's four `disposition`/`mandatedBehavior` restatements, nine `rejectedBeforeAnySignatureCheck` ordering claims, nine `positionNote` rows and seven p256-signature `fatal` rows. So for these two families read-liveness is not merely an upper bound on assertion — it is tight, and every leaf the census calls live has a case that fails when the leaf changes.",
        },
        published:
          "READ-liveness, which is an upper bound on assertion: a leaf a suite reads and never compares to anything counts as live here. Treat every `liveLeaves` figure below as a ceiling on how much is actually asserted, not as a measure of it — except for F4 and F17, where `measuredFamilySweep` has closed the gap.",
        staleFigure:
          "The 49.4% in `independentMutationSweep` is a GLOBAL assertion-liveness number and it is STALE: it was measured against a superseded corpus — 3,684 leaves, before the 397-leaf close-machine `steps` blocks were deleted and before the F8 tampering, F8 round-trip and F17 substitution-matrix assertions were added. It is not comparable line for line with anything below.",
        refreshCost:
          "A per-leaf mutation sweep over the remaining sixteen families: mutate each of their committed expectation leaves in turn and re-run the three consuming suites for each, then re-derive the per-family and per-case figures from which mutations failed a test. That is roughly 3,000 further full suite runs, which is why this round sweeps the two families whose numbers moved and publishes read-liveness for the rest rather than quoting a stale global figure as if it were current.",
        ownedBy: "the hardening phase, alongside the per-family assertion harnesses",
      },
      independentMutationSweep: {
        method:
          "An independent per-leaf MUTATION sweep, run outside this repository against the corpus as it stood before this round: every scalar under `expected` was mutated in turn and the consuming suites re-run.",
        measuredAgainst:
          "The 3,684-leaf corpus that preceded this round — before the 397-leaf close-machine `steps` blocks were deleted and before the F8 tampering, F8 round-trip and F17 substitution-matrix assertions were added. Its figures are NOT comparable line for line with the per-family numbers below.",
        liveLeaves: 1821,
        inertLeaves: 1863,
        totalLeaves: 3684,
        casesWithNoLiveLeaf: 37,
        note: "Mutation-liveness is the tighter measure — it counts a leaf live only when changing it fails a test — and its global figure is 49.4%. It is also STALE: it describes the superseded corpus named in `measuredAgainst`, not the one committed here, so it is not the number to cite about anything below either. There is no current assertion-liveness figure; see `assertionLiveness`.",
      },
      totals: {
        cases: 334,
        expectedLeaves: 3434,
        liveLeaves: 2270,
        inertLeaves: 1164,
        livePercent: 66.1,
        casesWithNoLiveLeaf: 17,
      },
      casesByLiveLeafCount: {
        note: "THE SHAPE, published because the single figure misleads. `casesWithNoLiveLeaf: 17 of 334` reads, against a one-leaf threshold, as though the other 317 assert something substantial. They do not: the per-case rule is a floor of one leaf, and most of the corpus sits just above it. Buckets are counts of CASES by how many of their own expectation leaves any suite reads, over the same union the per-family figures are pinned to.",
        buckets: [
          { liveLeaves: "0", cases: 17 },
          { liveLeaves: "1", cases: 19 },
          { liveLeaves: "2", cases: 101 },
          { liveLeaves: "3-5", cases: 87 },
          { liveLeaves: "6-10", cases: 55 },
          { liveLeaves: "11-25", cases: 38 },
          { liveLeaves: "26+", cases: 17 },
        ],
        atMostTwoLiveLeaves: 137,
        atMostFiveLiveLeaves: 224,
      },
      families: LIVENESS_CENSUS_FAMILIES,
    },
    /**
     * A LIMITATION OF THE COVERAGE MACHINERY ITSELF, recorded here so that it
     * reaches a reader of these FIXTURES and not only a reader of the test file
     * that carries the ledger.
     *
     * Everything above — `deferred`, `partialFamilies`, `deferredFamilies` — is
     * held to §16.3 by a hand-written ledger in the consuming test. That ledger
     * is a transcription of a prose section, and nothing verifies the
     * transcription. The fields below say exactly what that does and does not
     * establish.
     */
    ledgerFidelity: {
      section: "16.3",
      ledger: "packages/shared/src/relayE2eeCorpus.test.ts — SECTION_16_3_LEDGER",
      status: "hand-maintained-transcription",
      proves:
        "The ledger enumerates §16.3's obligations in the CONSUMING test, and the tests in that file hold this corpus to it: every obligation written there resolves exactly one way — as a generated case or as a declared deferral, never as neither; no committed case exists that no obligation claims; no family deferral exists that no obligation claims, and none is claimed twice; and every obligation standing for a group states its case count EXACTLY, so the group can neither lose a member nor gain one without the ledger entry moving with it. So a case that is dropped, a case that is added outside the ledger, or a deferral that is quietly deleted, fails a test. One further check crosses into content: an obligation whose every matching case is read by NO suite must carry an `unasserted` field naming what is missing and who owns it. NINE obligations are in that state and say so, checked against the measured union rather than against a declaration, and in both directions — the field must come off when a case goes live, which is how four of them came off it in this round.",
      doesNotProve:
        "That a committed case ASSERTS anything beyond a single leaf. The ledger constrains NAMES and COUNTS and never content: a case reduced to nothing but its name discharges its obligation exactly as well as one re-derived through the implementation, and 17 of the 334 committed cases are in that state — see `livenessCensus`, which measures it per family and names every one of them. `unasserted` catches only total emptiness: an obligation with one live leaf across its cases and every other field inert passes both checks, and most of this corpus is close to that state — see `livenessCensus.casesByLiveLeafCount`. And: that the ledger is a FAITHFUL transcription of §16.3. The specification is prose and no test in this repository parses it, so an obligation §16.3 states and nobody transcribed into the ledger is invisible to every test — it does not read as missing, it does not exist. Nothing checks that an entry's quoted wording still matches the document either: narrowing an obligation in §16.3, or in the ledger, fails nothing.",
      reviewObligation:
        "When EITHER side changes — an edit to §16.3, or an edit to the ledger — a reviewer MUST diff the ledger against §16.3 by eye, entry against paragraph, and confirm the two enumerate the same set. That review is the only thing standing between a §16.3 obligation and silent non-coverage. Every ledger entry carries a `section` field naming the §16.3 paragraph to open and a `spec` field carrying the specification's own words for the obligation, so the diff is a side-by-side read rather than an interpretation.",
      whyNotAutomated:
        "Parsing §16.3's prose to derive the obligation set automatically was considered and deliberately rejected. The section is discursive English — nested bullets, prose qualifiers, single obligations spread across several sentences, some of them negative — and an extractor over it would be wrong in ways no test could surface. A green check from an unreliable extractor is strictly worse than a known limitation whose reviewer is told, in as many words, to close it.",
      /**
       * THE OBLIGATIONS THE CORPUS CARRIES AND NOTHING ASSERTS.
       *
       * These resolve as `generated` in the ledger — a committed case matches —
       * while every case backing them is read by no suite at all. The ledger
       * read as covering them and the census said the opposite; nothing compared
       * the two until a test was written to. Listed here so the number reaches a
       * reader of the fixtures, with the owner of each piece of missing work.
       */
      unassertedObligations: {
        count: 9,
        note: "Nine §16.3 obligations resolve as generated — the corpus carries a case for each — and every case backing them is read by no consuming suite. All nine are F3. Four more were on this list until the F4 certificate harness and the F17 key-material harness landed, and they came off it because their cases went live, not because anything was relabelled. Each remaining one carries an `unasserted` field in SECTION_16_3_LEDGER stating what is unread and who owns it, checked against the measured read-liveness union in both directions: the field must be present while the cases are inert and must come off when one goes live.",
        ids: [
          "f3-continuity-id-unresolved",
          "f3-cross-signature-reconstruction",
          "f3-fingerprint-mismatch",
          "f3-hub-origin-bound",
          "f3-malformed-continuity-id",
          "f3-oversized-statement",
          "f3-re-encode-inequality",
          "f3-suite-registry-bound",
          "f3-transcript-bound",
        ],
        ownedBy: [
          "the F3 statement harness — 9 obligations (16 cases): the §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work",
        ],
      },
    },
  };
  return { files, manifestJson: `${JSON.stringify(manifest, null, 2)}\n` };
}

/**
 * Write the corpus. Obsolete GENERATED family files are removed so a renamed
 * family cannot linger; `f15-noise-core-vectors.json` is never touched, because
 * this repository does not produce it.
 */
export async function writeE2eeFixtureCorpus(
  fixtureRoot: string = E2EE_FIXTURE_ROOT,
): Promise<void> {
  const corpus = await generateE2eeFixtureCorpus();
  await mkdir(fixtureRoot, { recursive: true });
  const existing = await readdir(fixtureRoot);
  for (const entry of existing) {
    if (!/^f\d+-.*\.json$/.test(entry)) continue;
    if (entry === TRANSCODED_FAMILY_FILE || corpus.files.has(entry)) continue;
    await rm(`${fixtureRoot}/${entry}`, { force: true });
  }
  for (const [name, json] of corpus.files) {
    await writeFile(`${fixtureRoot}/${name}`, json, "utf8");
  }
  await writeFile(`${fixtureRoot}/manifest.json`, corpus.manifestJson, "utf8");
}

if (import.meta.main) {
  await writeE2eeFixtureCorpus();
  process.stdout.write(`Wrote E2EE fixtures to ${E2EE_FIXTURE_ROOT}\n`);
}
