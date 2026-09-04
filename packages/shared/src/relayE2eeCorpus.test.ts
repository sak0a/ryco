import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decode } from "cborg";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { RELAY_CHUNK_HEADER_BYTES, RELAY_CHUNK_MAGIC } from "@ryco/contracts/relay";

import {
  E2EE_AAD_BYTES,
  E2EE_ACCOUNT_ID_MAX_BYTES,
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_CLOSE_RECORDS_RESERVED,
  E2EE_COUNTER_MAX,
  E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_ERROR_RECORDS_RESERVED,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_HUB_ORIGIN_MAX_BYTES,
  E2EE_HUB_DEVICE_GRANT_MAX_BYTES,
  E2EE_REKEY_MAX_RECORDS,
  E2EE_SIGNING_INPUT_MAX_BYTES,
  RELAY_CHUNK_CAPABILITY_PRELUDE,
  RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
  RELAY_MAX_RPC_MESSAGE_BYTES,
  T_CLOSE,
  T_CLOSE_LINGER_MAX,
  T_KEEPALIVE_FLUSH_MARGIN,
  RPC_KEEPALIVE_INTERVAL,
  e2eeChannelSizeBudget,
} from "./relayE2eeConstants.ts";
import {
  decodeHubDeviceGrant,
  encodeHubDeviceGrantSigningEnvelope,
  verifyHubDeviceGrant,
  type HubDeviceGrantBindings,
  type HubDeviceGrantVerificationKey,
} from "./relayE2eeHubDeviceGrant.ts";
import {
  E2EE_CLOSE_COMMITMENT_DOMAIN,
  E2EE_ERROR_CODE_POLICY,
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  e2eeCloseCommitment,
  encodeE2eeCloseCommitmentPreimage,
  encodeE2eeCloseRecordBody,
  encodeE2eeErrorRecordBody,
  nextE2eeSequencePosition,
  validateE2eeCloseRecord,
  type E2eeCloseRecordType,
  type E2eeSequencePosition,
} from "./relayE2eeClose.ts";
import {
  E2EE_POST_APPLICATION_RESERVE_RECORDS,
  E2eeRecordSession,
  deriveE2eeAeadKey,
  deriveE2eeEpochKeys,
  deriveE2eeServerConfirmationKey,
  type E2eeDirectionState,
  type E2eeProtectResult,
  type E2eeSessionSecrets,
} from "./relayE2eeSession.ts";
import {
  E2EE_CLIENT_IDENTITY_ALGORITHM,
  E2EE_NODE_IDENTITY_ALGORITHM,
  e2eeKeyFingerprint,
  formatE2eeKeyFingerprint,
  validateE2eeClientIdentityPublicKey,
  validateE2eeClientSignature,
  validateE2eeNodeIdentityPublicKey,
  verifyE2eeSignature,
  type E2eeKeyFamily,
} from "./relayE2eeKeys.ts";
import {
  E2eeClientHandshake,
  decodeE2eeClientHello,
  decodeE2eeServerAccept,
  e2eeAuthorizationKeysEqual,
  e2eeAuthorizationWithdrawn,
  e2eeConfirmationTranscript,
  e2eeServerConfirmation,
  e2eeSessionBindingHash,
  selectE2eeSuite,
  verifyE2eeClientPrekeyCertificate,
} from "./relayE2eeHandshake.ts";
import {
  E2EE_CLIENT_PREKEY_TRANSCRIPT_DOMAIN,
  E2EE_NODE_CAPABILITY_DIGEST_DOMAIN,
  E2EE_NODE_IDENTITY_CONTINUITY_TRANSCRIPT_DOMAIN,
  E2EE_NODE_PREKEY_TRANSCRIPT_DOMAIN,
  E2EE_NOISE_PATTERN_NX,
  E2EE_STRICT_DECODE_OPTIONS,
  decodeCanonicalE2eeCbor,
  e2eeAuthorizationContextCommitment,
  e2eeEffectiveAdmittedPatterns,
  encodeClientE2eePrekeyTranscript,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eePrekeyTranscript,
  validateNodeE2eeContinuityChain,
  verifyNodeE2eeCapabilityCrossSignature,
  type E2eeNoisePattern,
  type E2eeTier,
} from "./relayE2eeTranscripts.ts";
import {
  NODE_AUTH_TRANSCRIPT_DOMAIN,
  NODE_KEY_ROTATION_TRANSCRIPT_DOMAIN,
} from "./nodeIdentity.ts";
import { E2eeNoiseHandshake } from "./relayE2eeNoise.ts";
import { deriveE2eeSafetyNumber, deriveE2eeWebSas } from "./relayE2eeVerificationDisplay.ts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_RPC,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
  E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  classifyPostStripPayload,
  decodeE2eeEnvelope,
  decodeE2eeNegotiationRecord,
  e2eeAeadNonce,
  e2eeEnvelopeAad,
  e2eeNegotiationRecordBound,
  e2eeNegotiationRecordDirection,
  encodeE2eeCapabilityCarrier,
  encodeE2eeDirectionLabel,
  encodeE2eeEnvelopeHeader,
  encodeE2eeHandshakeReject,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "./relayE2eeWire.ts";
import {
  RelayMessageAssembler,
  isChunkedPayload,
  prepareRelayMessage,
} from "./relayMessageChunks.ts";
import {
  E2EE_CORPUS_CASE_LIVENESS,
  E2EE_CORPUS_DELEGATED_LEAF_READS,
  E2eeCorpusLivenessRecorder,
} from "./relayE2eeCorpusLiveness.ts";

// The CONSUMING side of the §16.3 corpus. It reads the committed family files
// and re-derives each case's expectations from that case's own INPUTS, through
// the shared modules — never through the generator, which lives in another
// package and is exercised by its own drift test.
//
// That separation is the point. The drift test proves the committed bytes are
// what the generator produces today; this file proves the committed bytes are
// what the IMPLEMENTATION produces, so a change that moved both the generator
// and the implementation together would still have to move these assertions.

const FIXTURE_ROOT = new URL("../fixtures/e2ee/v1/", import.meta.url);

interface FixtureBytes {
  readonly $bytes: string;
}

type JsonRecord = Readonly<Record<string, unknown>>;

interface FixtureCase {
  readonly name: string;
  readonly sections: readonly string[];
  readonly note?: string;
  readonly inputs: JsonRecord;
  readonly expected: JsonRecord;
}

interface FixtureFamily {
  readonly family: { readonly number: number; readonly title: string };
  readonly warning: string;
  readonly deferred?: readonly string[];
  readonly testKeyMaterial: JsonRecord;
  readonly cases: readonly FixtureCase[];
}

/**
 * Every family is loaded THROUGH the read-liveness recorder, so that the last
 * test in this file can say which committed cases this suite actually reads and
 * which carry leaves nothing touches. See `relayE2eeCorpusLiveness.ts`.
 */
const LIVENESS = new E2eeCorpusLivenessRecorder();

function readFamily(name: string): FixtureFamily {
  const text = new TextDecoder().decode(readFileSync(new URL(name, FIXTURE_ROOT)));
  return LIVENESS.watch(name, JSON.parse(text) as FixtureFamily);
}

/** §16.2: byte strings are `{"$bytes": "<lowercase hex>"}` and nothing else. */
function fixtureBytes(value: unknown): Uint8Array {
  const wrapper = value as FixtureBytes;
  expect(Object.keys(wrapper)).toEqual(["$bytes"]);
  expect(wrapper.$bytes).toMatch(/^(?:[0-9a-f]{2})*$/);
  return Uint8Array.from(Buffer.from(wrapper.$bytes, "hex"));
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

/** UTF-8 length, which is the unit every §3.2.1 text bound is stated in. */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Whether a §7.1 validator ACCEPTED its input. The validators signal rejection
 * by throwing, and a case that states its own accept/reject verdict has to be
 * compared against that verdict rather than against a literal written here.
 */
function accepts(validate: () => unknown): boolean {
  try {
    validate();
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether two 32-byte Edwards point encodings carry the same sign bit and the
 * same `y` MODULO the field prime — that is, whether they are two encodings of
 * one point, one of which is non-canonical (RFC 8032 §5.1.3 requires `y < p`).
 *
 * Written out over the bytes rather than taken from a curve implementation on
 * purpose: the claim under test is about the ENCODINGS, and decoding them
 * through a library that already rejects the non-canonical one cannot express it.
 */
function sameEdwardsY(left: Uint8Array, right: Uint8Array): boolean {
  const FIELD_PRIME = (1n << 255n) - 19n;
  const parse = (encoding: Uint8Array): { readonly sign: number; readonly y: bigint } => {
    expect(encoding.byteLength).toBe(32);
    let y = 0n;
    for (let index = 31; index >= 0; index -= 1) {
      y = (y << 8n) | BigInt(index === 31 ? encoding[index]! & 0x7f : encoding[index]!);
    }
    return { sign: (encoding[31]! >> 7) & 1, y };
  };
  const a = parse(left);
  const b = parse(right);
  return a.sign === b.sign && a.y % FIELD_PRIME === b.y % FIELD_PRIME;
}

const F01 = readFamily("f01-payload-discrimination.json");
const F02 = readFamily("f02-carrier-compatibility.json");
const F03 = readFamily("f03-capability-statement.json");
const F04 = readFamily("f04-prekey-certificates.json");
const F05 = readFamily("f05-continuity-chains.json");
const F06 = readFamily("f06-ik-handshake.json");
const F07 = readFamily("f07-nx-handshake.json");
const F08 = readFamily("f08-record-protection.json");
const F09 = readFamily("f09-rekey-boundaries.json");
const F10 = readFamily("f10-mode-machine.json");
const F11 = readFamily("f11-authenticated-close.json");
const F12 = readFamily("f12-error-records.json");
const F13 = readFamily("f13-fingerprints.json");
const F14 = readFamily("f14-verification-display.json");
const F16 = readFamily("f16-authorization-context.json");
const F17 = readFamily("f17-key-material-validation.json");
const F18 = readFamily("f18-node-admission-policy.json");
const F19 = readFamily("f19-account-device-grant.json");

const ALL_FAMILIES = [
  F01,
  F02,
  F03,
  F04,
  F05,
  F06,
  F07,
  F08,
  F09,
  F10,
  F11,
  F12,
  F13,
  F14,
  F16,
  F17,
  F18,
  F19,
];

/**
 * F15 is transcoded upstream, not generated, and carries neither per-case
 * `sections` nor a `testKeyMaterial` block — so it is out of the §16.2 format
 * checks above. The §16.3 ledger below still has to account for it: "transcoded,
 * therefore exempt" is exactly the reasoning a silent omission hides behind.
 */
const F15 = readFamily("f15-noise-core-vectors.json");

/** Every family file by §16.3 number, so the ledger can address them uniformly. */
const FAMILY_FILES: ReadonlyMap<number, string> = new Map([
  [1, "f01-payload-discrimination.json"],
  [2, "f02-carrier-compatibility.json"],
  [3, "f03-capability-statement.json"],
  [4, "f04-prekey-certificates.json"],
  [5, "f05-continuity-chains.json"],
  [6, "f06-ik-handshake.json"],
  [7, "f07-nx-handshake.json"],
  [8, "f08-record-protection.json"],
  [9, "f09-rekey-boundaries.json"],
  [10, "f10-mode-machine.json"],
  [11, "f11-authenticated-close.json"],
  [12, "f12-error-records.json"],
  [13, "f13-fingerprints.json"],
  [14, "f14-verification-display.json"],
  [15, "f15-noise-core-vectors.json"],
  [16, "f16-authorization-context.json"],
  [17, "f17-key-material-validation.json"],
  [18, "f18-node-admission-policy.json"],
  [19, "f19-account-device-grant.json"],
]);

const FAMILIES_BY_NUMBER: ReadonlyMap<number, FixtureFamily> = new Map(
  [...ALL_FAMILIES, F15].map((family) => [family.family.number, family]),
);

function familyByNumber(number: number): FixtureFamily {
  const found = FAMILIES_BY_NUMBER.get(number);
  if (found === undefined) throw new Error(`Fixture family F${String(number)} is missing.`);
  return found;
}

interface ManifestFileEntry {
  readonly family: number;
  readonly title: string;
  readonly deferred?: readonly string[];
}

interface CorpusManifest {
  readonly files: Readonly<Record<string, ManifestFileEntry>>;
  readonly deferredFamilies: readonly { readonly family: number }[];
  readonly partialFamilies: readonly {
    readonly family: number;
    readonly title: string;
    readonly file: string;
    readonly deferred: readonly string[];
  }[];
  readonly crossRuntime: {
    readonly section: string;
    readonly status: string;
    readonly requirement: string;
    readonly browserRun: {
      readonly state: string;
      readonly families: readonly number[];
      readonly scopes: Readonly<Record<string, string>>;
      readonly reason: string;
      readonly ownedBy: string;
    };
    readonly physicalDeviceRun: {
      readonly state: string;
      readonly families: string;
      readonly reason: string;
      readonly ownedBy: string;
    };
  };
  /**
   * The §16.3 coverage ledger's own limitation, carried in the corpus so that a
   * reader of the FIXTURES meets it too. See the ledger's header in this file.
   */
  readonly ledgerFidelity: {
    readonly section: string;
    readonly ledger: string;
    readonly status: string;
    readonly proves: string;
    readonly doesNotProve: string;
    readonly reviewObligation: string;
    readonly whyNotAutomated: string;
    /** The obligations the corpus carries and nothing asserts. */
    readonly unassertedObligations: {
      readonly count: number;
      readonly note: string;
      readonly ids: readonly string[];
      readonly ownedBy: readonly string[];
    };
  };
  /**
   * The measured read-liveness of the corpus, per family. See the liveness
   * describe at the bottom of this file, and `relayE2eeCorpusLiveness.ts`.
   */
  readonly livenessCensus: {
    readonly section: string;
    readonly status: string;
    readonly measuredOn: string;
    readonly unit: string;
    readonly method: string;
    readonly whatLiveMeans: string;
    readonly perCaseClaims: string;
    /**
     * What the per-case rule actually enforces, stated as the floor it is rather
     * than as the coverage claim a reader would otherwise take it for.
     */
    readonly perCaseFloor: string;
    /**
     * How much assertion-liveness figure exists for THIS corpus. Two families
     * have been swept; this block says which, carries their numbers, and names
     * the cost of the rest.
     */
    readonly assertionLiveness: {
      readonly currentCorpus: string;
      readonly measuredFamilySweep: {
        readonly families: string;
        readonly method: string;
        readonly leaves: number;
        readonly liveLeaves: number;
        readonly inertLeaves: number;
        readonly agreesWithReadLiveness: boolean;
        readonly note: string;
      };
      readonly published: string;
      readonly staleFigure: string;
      readonly refreshCost: string;
      readonly ownedBy: string;
    };
    readonly independentMutationSweep: {
      readonly method: string;
      readonly measuredAgainst: string;
      readonly liveLeaves: number;
      readonly inertLeaves: number;
      readonly totalLeaves: number;
      readonly casesWithNoLiveLeaf: number;
      readonly note: string;
    };
    readonly totals: {
      readonly cases: number;
      readonly expectedLeaves: number;
      readonly liveLeaves: number;
      readonly inertLeaves: number;
      readonly livePercent: number;
      readonly casesWithNoLiveLeaf: number;
    };
    /**
     * THE SHAPE, not one number. `casesWithNoLiveLeaf` alone invites the reading
     * that every other case asserts something substantial; this is the histogram
     * that shows how many cases sit one or two leaves above the floor.
     */
    readonly casesByLiveLeafCount: {
      readonly note: string;
      readonly buckets: readonly {
        readonly liveLeaves: string;
        readonly cases: number;
      }[];
      readonly atMostTwoLiveLeaves: number;
      readonly atMostFiveLiveLeaves: number;
    };
    readonly families: readonly {
      readonly family: number;
      readonly file: string;
      readonly cases: number;
      readonly expectedLeaves: number;
      readonly liveLeaves: number;
      readonly inertLeaves: number;
      readonly livePercent: number;
      readonly casesWithNoLiveLeaf: number;
      readonly residual: string;
      readonly residualOwner: string;
    }[];
  };
}

const MANIFEST = JSON.parse(
  new TextDecoder().decode(readFileSync(new URL("manifest.json", FIXTURE_ROOT))),
) as CorpusManifest;

/**
 * A `{epoch, counter}` pair as the §9 modules take it: exact `bigint`s (§9.3).
 *
 * A counter is a JSON number where one fits exactly and its decimal STRING where
 * it does not — `E2EE_COUNTER_MAX` is 2^64 − 1, and the §16.3 F9 counter-
 * exhaustion states stand at that ceiling. `BigInt` reads both spellings, and
 * reading them through it is what keeps the comparison exact either way.
 */
function position(value: unknown): E2eeSequencePosition {
  const pair = value as {
    readonly epoch: number | string;
    readonly counter: number | string;
  };
  return { epoch: BigInt(pair.epoch), counter: BigInt(pair.counter) };
}

/** One direction's §9.2 state in the shape the corpus writes it. */
function directionState(state: E2eeDirectionState): JsonRecord {
  const value = (sequence: bigint | undefined): number | string | null => {
    if (sequence === undefined) return null;
    const asNumber = Number(sequence);
    return Number.isSafeInteger(asNumber) ? asNumber : sequence.toString(10);
  };
  return {
    epoch: value(state.epoch),
    counter: value(state.counter),
    epochRecords: state.epochRecords,
    epochBytes: state.epochBytes,
    exhausted: state.exhausted,
  };
}

function caseByName(family: FixtureFamily, name: string): FixtureCase {
  const found = family.cases.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Fixture case ${name} is missing from the corpus.`);
  return found;
}

/** Cases whose name matches a prefix, asserted to be a nonempty set. */
function casesMatching(family: FixtureFamily, pattern: RegExp): readonly FixtureCase[] {
  const found = family.cases.filter((entry) => pattern.test(entry.name));
  expect(found.length, String(pattern)).toBeGreaterThan(0);
  return found;
}

/**
 * The cases of `family` that carry `field` under `expected`, PINNED TO AN EXACT
 * COUNT.
 *
 * This exists because of a defect that ran through this file: an assertion
 * written as `if (entry.expected.someField !== undefined) { expect(…) }`, or one
 * that read the field with a `??` default, DELETES ITSELF the moment the
 * generator stops emitting the field. Nothing fails; the loop simply stops
 * finding anything to check, and the suite goes on reporting green over a
 * corpus that no longer carries the value. Thirty-five assertions were written
 * that way.
 *
 * A field that only SOME cases carry is legitimate — a row that states no
 * `errorCode` is a row that emits no error record. What is not legitimate is
 * leaving how many carry it unstated. Pinning the count makes both directions
 * fail: the field disappearing from a case, and a case quietly growing it.
 *
 * Presence is tested with `Object.hasOwn`, which does not READ the value, so a
 * field named here but never asserted still reads as inert in the liveness
 * census rather than being marked live by its own bookkeeping.
 */
function carrying(
  cases: readonly FixtureCase[],
  field: string,
  count: number,
): readonly FixtureCase[] {
  const found = cases.filter((entry) => Object.hasOwn(entry.expected, field));
  expect(
    found.length,
    `${String(found.length)} of ${String(cases.length)} cases carry expected.${field}, the suite requires exactly ${String(count)} — update this number in the same commit as the case`,
  ).toBe(count);
  return found;
}

describe("§16.2 corpus format", () => {
  it("carries a family header, the test-only warning, and named cases everywhere", () => {
    for (const family of ALL_FAMILIES) {
      expect(typeof family.family.number).toBe("number");
      expect(family.family.title.length).toBeGreaterThan(0);
      expect(family.warning).toContain("TEST-ONLY");
      expect(family.cases.length).toBeGreaterThan(0);
      const names = family.cases.map((entry) => entry.name);
      expect(new Set(names).size, `family ${family.family.number}`).toBe(names.length);
      for (const entry of family.cases) {
        expect(entry.sections.length, entry.name).toBeGreaterThan(0);
        expect(typeof entry.inputs, entry.name).toBe("object");
        expect(typeof entry.expected, entry.name).toBe("object");
      }
    }
  });
});

describe("§16.3 F13 fingerprints (§7.1)", () => {
  it("recomputes every fingerprint and display form from the case's own public key", () => {
    expect(F13.cases.length).toBeGreaterThanOrEqual(4);
    for (const entry of F13.cases) {
      const publicKey = fixtureBytes(entry.inputs.publicKey);
      const family = entry.inputs.keyFamily as E2eeKeyFamily;
      const digest = e2eeKeyFingerprint(family, publicKey);
      expect(hex(digest), entry.name).toBe(hex(fixtureBytes(entry.expected.fingerprint)));
      expect(formatE2eeKeyFingerprint(digest), entry.name).toBe(entry.expected.display);
      // The display form is derived from the digest and never carried separately.
      expect(entry.expected.display as string, entry.name).toMatch(/^SHA256:[A-Za-z0-9_-]+$/);
    }
  });

  it("covers all three §7.1 fingerprint families", () => {
    expect(new Set(F13.cases.map((entry) => entry.inputs.keyFamily))).toEqual(
      new Set(["node-identity", "client-identity", "agreement"]),
    );
  });
});

describe("§16.3 F14 safety number and WebSAS (§13.4, §13.5)", () => {
  it("reproduces every safety-number intermediate and rendering", () => {
    for (const entry of casesMatching(F14, /^safety-number-(short|max-length)-account-id$/)) {
      const derived = deriveE2eeSafetyNumber({
        nodeIdentityPublicKey: fixtureBytes(entry.inputs.nodeIdentityPublicKey),
        clientIdentityPublicKey: fixtureBytes(entry.inputs.clientIdentityPublicKey),
        hubOrigin: entry.inputs.hubOrigin as string,
        accountId: entry.inputs.accountId as string,
      });
      expect(hex(derived.input), entry.name).toBe(hex(fixtureBytes(entry.expected.inputArray)));
      expect(hex(derived.secret), entry.name).toBe(
        hex(fixtureBytes(entry.expected.safetyNumberSecret)),
      );
      expect(hex(derived.output), entry.name).toBe(hex(fixtureBytes(entry.expected.hkdfOutput)));
      expect(derived.display, entry.name).toBe(entry.expected.display);
      // §3.2.1 S10, discharged by fixture rather than by inspection.
      expect(entry.expected.satisfiesS10, entry.name).toBe(true);
      expect(entry.expected.displayedEntropyBits as number, entry.name).toBeGreaterThanOrEqual(
        entry.expected.minimumDisplayedEntropyBits as number,
      );
    }
  });

  it("reproduces every WebSAS intermediate and rendering", () => {
    for (const entry of casesMatching(F14, /^web-sas-session-/)) {
      const derived = deriveE2eeWebSas({
        nodeIdentityPublicKey: fixtureBytes(entry.inputs.nodeIdentityPublicKey),
        webEphemeralPublicKey: fixtureBytes(entry.inputs.webEphemeralPublicKey),
        sessionBindingHash: fixtureBytes(entry.inputs.sessionBindingHash),
      });
      expect(hex(derived.input), entry.name).toBe(hex(fixtureBytes(entry.expected.inputArray)));
      expect(hex(derived.prk), entry.name).toBe(hex(fixtureBytes(entry.expected.prk)));
      expect(hex(derived.output), entry.name).toBe(hex(fixtureBytes(entry.expected.hkdfOutput)));
      expect(derived.display, entry.name).toBe(entry.expected.display);
      // §3.2.1 S11.
      expect(entry.expected.satisfiesS11, entry.name).toBe(true);
      expect(entry.expected.displayedEntropyBits as number, entry.name).toBeGreaterThanOrEqual(
        entry.expected.minimumDisplayedEntropyBits as number,
      );
    }
  });

  it("keeps the safety number namespace-bound and the WebSAS per session", () => {
    expect(caseByName(F14, "safety-number-is-namespace-bound").expected.differs).toBe(true);
    expect(caseByName(F14, "web-sas-changes-every-session").expected.differs).toBe(true);
  });

  /**
   * §13.5's whole point is a comparison: the web UI shows the string and the
   * node CLI shows the string, and the owner compares them out of band. That
   * only means something if the two ends feed the derivation IDENTICAL bytes,
   * and the one input they reach differently is the web client's Noise
   * ephemeral — the client holds its own (`localEphemeralPublicKey`), the node
   * observes it off message 1 (`remoteEphemeralPublicKey`, which is how
   * `E2eeNodeAcceptResult.peerEphemeralPublicKey` is filled).
   *
   * So the fixture's `webEphemeralPublicKey` is not taken on trust here: it is
   * re-derived by driving a REAL NX handshake from the case's own
   * `testOnlyWebEphemeralSecretKey` and read once through each accessor. Both
   * are then run through §13.5 and required to reproduce the case's exact
   * rendered display — the compare-to-CLI claim, discharged at the derivation
   * level rather than assumed.
   */
  it("renders the same WebSAS from the client's own ephemeral and the node's view of it", () => {
    const displays: string[] = [];
    for (const entry of casesMatching(F14, /^web-sas-session-/)) {
      const client = new E2eeNoiseHandshake({
        pattern: E2EE_NOISE_PATTERN_NX,
        role: "initiator",
        prologue: new Uint8Array(0),
        testOnlyEphemeralSecretKey: fixtureBytes(entry.inputs.testOnlyWebEphemeralSecretKey),
      });
      const node = new E2eeNoiseHandshake({
        pattern: E2EE_NOISE_PATTERN_NX,
        role: "responder",
        prologue: new Uint8Array(0),
        staticSecretKey: fixtureBytes(F14.testKeyMaterial.testOnlyNodeAgreementSecretKey),
      });
      node.readMessage(client.writeMessage(new Uint8Array(0)));
      client.readMessage(node.writeMessage(new Uint8Array(0)));
      // §6.2: the ephemeral SECRET is gone from here on; only the public
      // component of it survives, on both sides.
      client.split();
      node.split();

      const fromClient = client.localEphemeralPublicKey;
      const fromNode = node.remoteEphemeralPublicKey;
      expect(hex(fromClient!), entry.name).toBe(
        hex(fixtureBytes(entry.inputs.webEphemeralPublicKey)),
      );
      expect(hex(fromNode!), entry.name).toBe(hex(fromClient!));

      const shared = {
        nodeIdentityPublicKey: fixtureBytes(entry.inputs.nodeIdentityPublicKey),
        sessionBindingHash: fixtureBytes(entry.inputs.sessionBindingHash),
      };
      const clientSide = deriveE2eeWebSas({ ...shared, webEphemeralPublicKey: fromClient! });
      const nodeSide = deriveE2eeWebSas({ ...shared, webEphemeralPublicKey: fromNode! });
      expect(clientSide.display, entry.name).toBe(entry.expected.display);
      expect(nodeSide.display, entry.name).toBe(clientSide.display);
      expect(hex(nodeSide.output), entry.name).toBe(hex(clientSide.output));
      displays.push(clientSide.display);
    }
    // `web-sas-changes-every-session`, restated over the two live handshakes
    // above: one node key, one ephemeral, two session bindings, two strings.
    expect(displays.length).toBe(2);
    expect(displays[0] !== displays[1]).toBe(
      caseByName(F14, "web-sas-changes-every-session").expected.differs,
    );
  });
});

describe("§16.3 F5 continuity chains (§7.5, §13.3)", () => {
  /** Exactly the cases whose verdict is nested under `expected.chain`. */
  const nestedChainVerdicts = new Set(carrying(F05.cases, "chain", 2).map((entry) => entry.name));

  it("reproduces every chain verdict from the case's own carried entries", () => {
    for (const entry of F05.cases) {
      const chain = (entry.inputs.chain as readonly JsonRecord[]).map((link) => ({
        transcript: fixtureBytes(link.transcript),
        signature: fixtureBytes(link.signature),
      }));
      const pinned = entry.inputs.pinnedIdentityFingerprint;
      const result = validateNodeE2eeContinuityChain({
        chain,
        hubOrigin: entry.inputs.hubOrigin as string,
        continuityId: entry.inputs.continuityId as string,
        identityPublicKey: fixtureBytes(entry.inputs.identityPublicKey),
        pinnedIdentityFingerprint: pinned === undefined ? undefined : fixtureBytes(pinned),
      });
      // Two cases state the verdict under a `chain` sub-object because they also
      // state carrier sizes beside it; the rest state it at the top level. WHICH
      // two is pinned, so the `??` this used to be written as can no longer
      // silently fall through to the wrong object when a key moves.
      const expected = (
        nestedChainVerdicts.has(entry.name) ? entry.expected.chain : entry.expected
      ) as JsonRecord;
      expect(result.kind, entry.name).toBe(expected.kind);
      if (result.kind === "error") {
        expect(result.failure, entry.name).toBe(expected.failure);
        continue;
      }
      expect(result.certificates.length, entry.name).toBe(expected.certificates);
      // §13.3: reaching the pin THROUGH the chain is the silent pin update. Only
      // the two chains presented against a pin state it, and both must.
      if (!nestedChainVerdicts.has(entry.name)) continue;
      expect(result.pinnedFingerprintUnchanged, entry.name).toBe(
        expected.pinnedFingerprintUnchanged,
      );
      expect(expected.silentPinUpdate, entry.name).toBe(
        result.pinnedFingerprintUnchanged === false,
      );
    }
  });

  it("carries a max-depth chain at both a short and a maximum Hub origin, with the same verdict", () => {
    const short = caseByName(F05, "valid-max-length-chain-short-hub-origin");
    const long = caseByName(F05, "valid-max-length-chain-max-length-hub-origin");
    for (const entry of [short, long]) {
      expect((entry.expected.chain as JsonRecord).kind, entry.name).toBe("ok");
      // §5.5 and §3.2.1 S6: depth and origin length multiply, and the carrier
      // must still fit with the full prelude headroom.
      expect(entry.expected.carrierFits, entry.name).toBe(true);
      expect(entry.expected.satisfiesS6, entry.name).toBe(true);
      expect(entry.expected.carrierPlusPreludeBytes, entry.name).toBe(
        (entry.expected.carrierBytes as number) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
      );
    }
    // The silent-pin-update expectation is unchanged by origin length.
    expect((long.expected.chain as JsonRecord).silentPinUpdate).toBe(
      (short.expected.chain as JsonRecord).silentPinUpdate,
    );
    expect(long.inputs.chainLength).toBe(short.inputs.chainLength);
    expect(long.inputs.hubOriginBytes as number).toBeGreaterThan(
      short.inputs.hubOriginBytes as number,
    );
  });

  it("covers every invalid shape §16.3 F5 enumerates", () => {
    const failures = new Set(
      F05.cases
        .map(
          (entry) =>
            (
              (nestedChainVerdicts.has(entry.name)
                ? entry.expected.chain
                : entry.expected) as JsonRecord
            ).failure,
        )
        .filter((failure): failure is string => typeof failure === "string"),
    );
    for (const failure of [
      "chain_too_long",
      "malformed_entry",
      "invalid_identity_key",
      "hub_origin_mismatch",
      "continuity_id_mismatch",
      "generation_not_consecutive",
      "link_mismatch",
      "invalid_signature",
      "identity_key_mismatch",
      "pin_not_reached",
    ]) {
      expect(failures.has(failure), failure).toBe(true);
    }
  });
});

describe("§16.3 F4 prekey certificates (§7.3, §7.4, §6.4)", () => {
  it("reproduces every §8.6 step 5 verdict from the case's own transcript and signature", () => {
    for (const entry of F04.cases) {
      if (entry.inputs.transcript === undefined || entry.inputs.signature === undefined) continue;
      const result = verifyE2eeClientPrekeyCertificate({
        transcript: fixtureBytes(entry.inputs.transcript),
        signature: fixtureBytes(entry.inputs.signature),
        hubOrigin: entry.inputs.channelHubOrigin as string,
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        now: entry.inputs.now as number,
      });
      const expected = entry.expected.step5 as JsonRecord;
      expect(result.kind, entry.name).toBe(expected.kind);
      if (result.kind === "error") {
        expect(result.failure, entry.name).toBe(expected.failure);
        continue;
      }
      expect(result.certificate.accountId, entry.name).toBe(expected.accountId);
      expect(hex(result.certificate.identityFingerprint), entry.name).toBe(
        hex(fixtureBytes(expected.identityFingerprint)),
      );
      expect(hex(result.certificate.agreementFingerprint), entry.name).toBe(
        hex(fixtureBytes(expected.agreementFingerprint)),
      );
    }
  });

  it("puts the clock-skew boundary cases on the sides §6.4 fixes", () => {
    const accepted = [
      "client-certificate-not-yet-valid-accepted-exactly-at-the-clock-skew-boundary",
      "client-certificate-expiry-accepted-exactly-at-the-clock-skew-boundary",
    ];
    const rejected = [
      "client-certificate-not-yet-valid-one-millisecond-beyond-the-clock-skew-boundary",
      "client-certificate-expiry-one-millisecond-beyond-the-clock-skew-boundary",
    ];
    for (const name of accepted) {
      expect((caseByName(F04, name).expected.step5 as JsonRecord).kind, name).toBe("ok");
    }
    for (const name of rejected) {
      const step5 = caseByName(F04, name).expected.step5 as JsonRecord;
      expect(step5.kind, name).toBe("error");
      expect(step5.failure, name).toBe("expired");
      // §11.2 P11 is the row for material in this position.
      expect(caseByName(F04, name).expected.fatal, name).toBe("P11");
    }
  });

  it("rejects every §3.6 strict-decode failure the family carries", () => {
    for (const entry of casesMatching(
      F04,
      /^client-certificate-(non-canonical|indefinite|trailing|truncated|float|wrong-element)/,
    )) {
      expect((entry.expected.step5 as JsonRecord).failure, entry.name).toBe("malformed");
    }
  });

  // ── THE NODE CERTIFICATE PATH (§7.3, §7.6) ─────────────────────────────────
  //
  // The client half above was driven end to end from the first round; the NODE
  // half was not, and its seven cases were carried as `decorative` — committed,
  // claimed by the ledger, read by nothing. Everything below re-derives each
  // case's own stated values through the shared §7.3 encoder and the §7.6
  // reconstruction, so a fixture that stopped agreeing with the implementation
  // fails here instead of reading as coverage.
  //
  // The one thing this suite cannot supply is a signer: §7.3 transcripts are
  // signed DIRECTLY by the node identity key, and the corpus commits its
  // test-only seed for exactly that reason. `ed25519.sign` below is the
  // generator's own signing step re-run over the transcript THIS side rebuilt,
  // which is what makes the cross-signature assertions non-circular.

  const NODE = F04.testKeyMaterial.identifiers as JsonRecord;
  const nodeIdentityPublic = (): Uint8Array =>
    fixtureBytes(F04.testKeyMaterial.nodeIdentityPublicKey);
  const nodeAgreementPublic = (): Uint8Array =>
    fixtureBytes(F04.testKeyMaterial.nodeAgreementPublicKey);
  const nodeIdentitySeed = (): Uint8Array =>
    fixtureBytes(F04.testKeyMaterial.testOnlyNodeIdentitySeed);
  const clientIdentityPublic = (): Uint8Array =>
    fixtureBytes(F04.testKeyMaterial.clientIdentityPublicKey);
  const clientAgreementPublic = (): Uint8Array =>
    fixtureBytes(F04.testKeyMaterial.clientAgreementPublicKey);

  /** The §7.3 transcript, over the corpus material, with one field overridden. */
  const nodeTranscript = (over: {
    readonly hubOrigin?: string;
    readonly prekeyId?: string;
  }): Uint8Array => {
    const base = caseByName(F04, "valid-node-agreement-prekey-certificate");
    return encodeNodeE2eePrekeyTranscript({
      hubOrigin: over.hubOrigin ?? (NODE.hubOrigin as string),
      nodeId: NODE.nodeId as string,
      identityKeyId: NODE.identityKeyId as string,
      prekeyId: over.prekeyId ?? (NODE.prekeyId as string),
      identityPublicKey: nodeIdentityPublic(),
      agreementPublicKey: nodeAgreementPublic(),
      createdAt: base.inputs.createdAt as number,
      expiresAt: base.inputs.expiresAt as number,
    });
  };

  /**
   * §7.6 step: rebuild the §7.3 transcript from what a STATEMENT carries and
   * check the cross-signature over it. Every field defaults to the corpus's own
   * conforming material, so a case names only what it substitutes.
   */
  const reconstructCrossSignature = (over: {
    readonly hubOrigin?: string;
    readonly prekeyId?: string;
    readonly identityFingerprint?: Uint8Array;
    readonly agreementFingerprint?: Uint8Array;
    readonly crossSignature?: Uint8Array;
  }): boolean => {
    const base = caseByName(F04, "valid-node-agreement-prekey-certificate");
    return verifyNodeE2eeCapabilityCrossSignature({
      hubOrigin: over.hubOrigin ?? (NODE.hubOrigin as string),
      nodeId: NODE.nodeId as string,
      identityKeyId: NODE.identityKeyId as string,
      identityPublicKey: nodeIdentityPublic(),
      identityFingerprint:
        over.identityFingerprint ?? e2eeKeyFingerprint("node-identity", nodeIdentityPublic()),
      prekeyCertificate: {
        prekeyId: over.prekeyId ?? (NODE.prekeyId as string),
        agreementPublicKey: nodeAgreementPublic(),
        agreementFingerprint:
          over.agreementFingerprint ?? e2eeKeyFingerprint("agreement", nodeAgreementPublic()),
        createdAt: base.inputs.createdAt as number,
        expiresAt: base.inputs.expiresAt as number,
        crossSignature: over.crossSignature ?? ed25519.sign(nodeTranscript({}), nodeIdentitySeed()),
      },
    });
  };

  it("rebuilds the §7.3 node transcript and re-verifies its cross-signature", () => {
    const entry = caseByName(F04, "valid-node-agreement-prekey-certificate");
    const transcript = encodeNodeE2eePrekeyTranscript({
      hubOrigin: entry.inputs.hubOrigin as string,
      nodeId: entry.inputs.nodeId as string,
      identityKeyId: entry.inputs.identityKeyId as string,
      prekeyId: entry.inputs.prekeyId as string,
      identityPublicKey: fixtureBytes(entry.inputs.identityPublicKey),
      agreementPublicKey: fixtureBytes(entry.inputs.agreementPublicKey),
      createdAt: entry.inputs.createdAt as number,
      expiresAt: entry.inputs.expiresAt as number,
    });
    expect(hex(transcript)).toBe(hex(fixtureBytes(entry.expected.transcript)));
    expect(transcript.byteLength).toBe(entry.expected.transcriptBytes);
    expect(hex(sha256(transcript))).toBe(entry.expected.transcriptSha256);
    // §7.1: both fingerprints are recomputed, never carried on trust.
    expect(
      hex(e2eeKeyFingerprint("node-identity", fixtureBytes(entry.inputs.identityPublicKey))),
    ).toBe(hex(fixtureBytes(entry.expected.identityFingerprint)));
    expect(
      hex(e2eeKeyFingerprint("agreement", fixtureBytes(entry.inputs.agreementPublicKey))),
    ).toBe(hex(fixtureBytes(entry.expected.agreementFingerprint)));
    // The committed cross-signature is the node identity key's signature over
    // exactly these bytes, and it verifies through the same choke point §5.2 uses.
    expect(hex(ed25519.sign(transcript, nodeIdentitySeed()))).toBe(
      hex(fixtureBytes(entry.expected.crossSignature)),
    );
    expect(
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: fixtureBytes(entry.inputs.identityPublicKey),
        message: transcript,
        signature: fixtureBytes(entry.expected.crossSignature),
      }),
    ).toBe(entry.expected.crossSignatureReconstructionVerifies);
    expect(reconstructCrossSignature({})).toBe(entry.expected.crossSignatureReconstructionVerifies);
    expect(entry.expected.withinDirectSigningBound).toBe(
      transcript.byteLength <= E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
    );
  });

  it("fails the §7.6 reconstruction on every node-certificate substitution the family carries", () => {
    // Each of these is a statement that disagrees with itself or with the
    // signature it carries. §7.6 rebuilds element 7 of the §7.3 array from the
    // statement's CARRIED element 6 rather than re-deriving it, so a
    // disagreement produces bytes the cross-signature does not cover — which is
    // the whole reason the reconstruction cannot go through the plain encoder.
    const lifted = caseByName(
      F04,
      "node-certificate-cross-signature-lifted-from-another-hub-origin",
    );
    expect(
      reconstructCrossSignature({
        hubOrigin: lifted.inputs.statementHubOrigin as string,
        crossSignature: ed25519.sign(
          nodeTranscript({ hubOrigin: lifted.inputs.crossSignatureBoundToHubOrigin as string }),
          nodeIdentitySeed(),
        ),
      }),
      lifted.name,
    ).toBe(lifted.expected.crossSignatureReconstructionVerifies);

    const identity = caseByName(
      F04,
      "node-certificate-carried-identity-fingerprint-disagrees-with-the-identity-key",
    );
    expect(hex(fixtureBytes(identity.inputs.recomputedIdentityFingerprint)), identity.name).toBe(
      hex(e2eeKeyFingerprint("node-identity", nodeIdentityPublic())),
    );
    expect(
      reconstructCrossSignature({
        identityFingerprint: fixtureBytes(identity.inputs.carriedIdentityFingerprint),
      }),
      identity.name,
    ).toBe(identity.expected.crossSignatureReconstructionVerifies);

    const agreement = caseByName(
      F04,
      "node-certificate-carried-agreement-fingerprint-disagrees-with-the-agreement-key",
    );
    expect(hex(fixtureBytes(agreement.inputs.recomputedAgreementFingerprint)), agreement.name).toBe(
      hex(e2eeKeyFingerprint("agreement", nodeAgreementPublic())),
    );
    expect(
      reconstructCrossSignature({
        agreementFingerprint: fixtureBytes(agreement.inputs.carriedAgreementFingerprint),
      }),
      agreement.name,
    ).toBe(agreement.expected.crossSignatureReconstructionVerifies);

    const substituted = caseByName(F04, "node-certificate-prekey-id-substituted-after-signing");
    expect(
      reconstructCrossSignature({
        prekeyId: substituted.inputs.carriedPrekeyId as string,
        crossSignature: ed25519.sign(
          nodeTranscript({ prekeyId: substituted.inputs.signedPrekeyId as string }),
          nodeIdentitySeed(),
        ),
      }),
      substituted.name,
    ).toBe(substituted.expected.crossSignatureReconstructionVerifies);

    // §7.3 elements 9 and 10 are ENCODER-DERIVED on both sides: a statement
    // cannot present a different Noise usage, because the reconstruction rebuilds
    // the suite's own functions and a signature over anything else fails.
    const usage = caseByName(F04, "node-certificate-usage-fields-are-not-carrier-supplied");
    const mutated = fixtureBytes(usage.inputs.mutatedTranscript);
    const mutatedElements = decodeCanonicalE2eeCbor(mutated);
    expect(mutatedElements.kind, usage.name).toBe("ok");
    expect((mutatedElements as { readonly value: readonly unknown[] }).value[9], usage.name).toBe(
      usage.inputs.mutatedUsageDh,
    );
    expect(
      reconstructCrossSignature({ crossSignature: ed25519.sign(mutated, nodeIdentitySeed()) }),
      usage.name,
    ).toBe(usage.expected.crossSignatureReconstructionVerifies);
    const rebuilt = decodeCanonicalE2eeCbor(nodeTranscript({}));
    expect(rebuilt.kind, usage.name).toBe("ok");
    const rebuiltElements = (rebuilt as { readonly value: readonly unknown[] }).value;
    expect(rebuiltElements[9], usage.name).toBe(usage.expected.reconstructedUsageDh);
    expect(rebuiltElements[10], usage.name).toBe(usage.expected.reconstructedUsageHash);
  });

  it("keeps the two largest directly signed transcripts inside §3.2.1 S9 and S2", () => {
    // The two size-argument cases are rebuilt from their own `inputs` — never
    // from the committed transcript — and the result is compared against the
    // committed bytes. That direction is what makes the comparison falsifiable:
    // an encoder fed from the decoded transcript would copy every verbatim
    // element straight back and compare it with itself, so a fixture that
    // stopped agreeing with the implementation on the node id, either public
    // key, an identifier or a timestamp would read as covered. Driving the
    // encoder from the inputs instead means every element the encoder COPIES is
    // pinned by the input it came from, and every element it DERIVES — element
    // 7's fingerprint, the algorithm and usage constants, the S9 bound — is
    // pinned by the encoder itself.
    const node = caseByName(
      F04,
      "node-certificate-at-the-maximum-hub-origin-accepted-and-within-S9",
    );
    const nodeElements = decodeCanonicalE2eeCbor(fixtureBytes(node.expected.transcript));
    expect(nodeElements.kind, node.name).toBe("ok");
    const nodeFields = (nodeElements as { readonly value: readonly unknown[] }).value;
    expect(nodeFields[1], node.name).toBe(node.inputs.hubOrigin);
    expect(utf8Bytes(node.inputs.hubOrigin as string), node.name).toBe(node.inputs.hubOriginBytes);
    expect(node.inputs.hubOriginMaxBytes, node.name).toBe(E2EE_HUB_ORIGIN_MAX_BYTES);
    // …and the identifiers and keys the case names really are this family's own
    // material, so the inputs cannot drift away from the corpus either.
    expect(node.inputs.nodeId, node.name).toBe(NODE.nodeId);
    expect(node.inputs.identityKeyId, node.name).toBe(NODE.identityKeyId);
    expect(node.inputs.prekeyId, node.name).toBe(NODE.prekeyId);
    expect(hex(fixtureBytes(node.inputs.identityPublicKey)), node.name).toBe(
      hex(nodeIdentityPublic()),
    );
    expect(hex(fixtureBytes(node.inputs.agreementPublicKey)), node.name).toBe(
      hex(nodeAgreementPublic()),
    );
    const nodeTranscriptBytes = encodeNodeE2eePrekeyTranscript({
      hubOrigin: node.inputs.hubOrigin as string,
      nodeId: node.inputs.nodeId as string,
      identityKeyId: node.inputs.identityKeyId as string,
      prekeyId: node.inputs.prekeyId as string,
      identityPublicKey: fixtureBytes(node.inputs.identityPublicKey),
      agreementPublicKey: fixtureBytes(node.inputs.agreementPublicKey),
      createdAt: node.inputs.createdAt as number,
      expiresAt: node.inputs.expiresAt as number,
    });
    expect(hex(nodeTranscriptBytes), node.name).toBe(hex(fixtureBytes(node.expected.transcript)));
    // The decoded transcript agrees with the inputs element for element, which
    // is the same statement made from the other side: the committed bytes carry
    // exactly the material the encoder was handed.
    expect(nodeFields[2], node.name).toBe(node.inputs.nodeId);
    expect(nodeFields[4], node.name).toBe(node.inputs.identityKeyId);
    expect(nodeFields[5], node.name).toBe(node.inputs.prekeyId);
    expect(hex(nodeFields[6] as Uint8Array), node.name).toBe(hex(nodeIdentityPublic()));
    expect(hex(nodeFields[8] as Uint8Array), node.name).toBe(hex(nodeAgreementPublic()));
    expect(nodeFields[11], node.name).toBe(node.inputs.createdAt);
    expect(nodeFields[12], node.name).toBe(node.inputs.expiresAt);
    expect(nodeTranscriptBytes.byteLength, node.name).toBe(node.expected.transcriptBytes);
    expect(node.expected.directSigningTranscriptMaxBytes, node.name).toBe(
      E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
    );
    expect(node.expected.satisfiesS9, node.name).toBe(
      nodeTranscriptBytes.byteLength <= E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
    );

    const client = caseByName(
      F04,
      "client-certificate-at-the-maximum-namespace-accepted-and-within-S9",
    );
    const clientElements = decodeCanonicalE2eeCbor(fixtureBytes(client.expected.transcript));
    expect(clientElements.kind, client.name).toBe("ok");
    const clientFields = (clientElements as { readonly value: readonly unknown[] }).value;
    expect(utf8Bytes(client.inputs.hubOrigin as string), client.name).toBe(
      client.inputs.hubOriginBytes,
    );
    expect(utf8Bytes(client.inputs.accountId as string), client.name).toBe(
      client.inputs.accountIdBytes,
    );
    expect(client.inputs.accountIdMaxBytes, client.name).toBe(E2EE_ACCOUNT_ID_MAX_BYTES);
    expect(hex(fixtureBytes(client.inputs.identityPublicKey)), client.name).toBe(
      hex(clientIdentityPublic()),
    );
    expect(hex(fixtureBytes(client.inputs.agreementPublicKey)), client.name).toBe(
      hex(clientAgreementPublic()),
    );
    const clientTranscript = encodeClientE2eePrekeyTranscript({
      hubOrigin: client.inputs.hubOrigin as string,
      accountId: client.inputs.accountId as string,
      identityPublicKey: fixtureBytes(client.inputs.identityPublicKey),
      agreementPublicKey: fixtureBytes(client.inputs.agreementPublicKey),
      createdAt: client.inputs.createdAt as number,
      expiresAt: client.inputs.expiresAt as number,
    });
    expect(hex(clientTranscript), client.name).toBe(hex(fixtureBytes(client.expected.transcript)));
    // The account-id TEXT is compared, not only its UTF-8 length: a 256-byte
    // string of the wrong bytes is the same length as the right one.
    expect(clientFields[1], client.name).toBe(client.inputs.hubOrigin);
    expect(clientFields[2], client.name).toBe(client.inputs.accountId);
    expect(hex(clientFields[4] as Uint8Array), client.name).toBe(hex(clientIdentityPublic()));
    expect(hex(clientFields[6] as Uint8Array), client.name).toBe(hex(clientAgreementPublic()));
    expect(clientFields[9], client.name).toBe(client.inputs.createdAt);
    expect(clientFields[10], client.name).toBe(client.inputs.expiresAt);
    expect(clientTranscript.byteLength, client.name).toBe(client.expected.transcriptBytes);
    expect(client.expected.directSigningTranscriptMaxBytes, client.name).toBe(
      E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
    );
    expect(client.expected.satisfiesS9, client.name).toBe(
      clientTranscript.byteLength <= E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
    );
    expect(client.expected.signingInputMaxBytes, client.name).toBe(E2EE_SIGNING_INPUT_MAX_BYTES);
    expect(client.expected.satisfiesS2, client.name).toBe(
      clientTranscript.byteLength <= E2EE_SIGNING_INPUT_MAX_BYTES,
    );
    // …and it really is the larger of the two, which is what makes it the case
    // S9 turns on rather than one of two arbitrary maxima.
    expect(clientTranscript.byteLength).toBeGreaterThan(nodeTranscriptBytes.byteLength);
  });

  it("gives every rejected client certificate the one §11.2 row this family has", () => {
    // §11.2 admits exactly one pre-key observable, so every step-5 rejection in
    // this family is P11 and no case may state another row. Both directions
    // fail: a case that stops stating the row, and a case that states a
    // different one.
    const rejected = F04.cases.filter(
      (entry) =>
        entry.name.startsWith("client-certificate-") &&
        (entry.expected.step5 as JsonRecord | undefined)?.kind === "error",
    );
    expect(rejected.length, "rejected client-certificate cases").toBe(13);
    for (const entry of carrying(rejected, "fatal", 13)) {
      expect(entry.expected.fatal, entry.name).toBe("P11");
    }
  });
});

describe("§16.3 F3 capability statement (§5.2, §7.2.1, §7.6)", () => {
  const valid = caseByName(F03, "valid-capability-statement");

  it("verifies the identity signature over the locally rebuilt §7.2.1 envelope", () => {
    const transcript = fixtureBytes(valid.expected.transcript);
    const rebuilt = encodeNodeE2eeCapabilitySigningEnvelope(transcript);
    // §5.2 step 1: the envelope is rebuilt LOCALLY from the exact transcript
    // bytes received; no digest is carried on the wire and none may be accepted.
    expect(hex(rebuilt)).toBe(hex(fixtureBytes(valid.expected.signingEnvelope)));
    expect(
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: fixtureBytes(valid.inputs.identityPublicKey),
        message: rebuilt,
        signature: fixtureBytes(valid.expected.signature),
      }),
    ).toBe(true);
    expect(valid.expected.identitySignatureVerifiesOverTheEnvelope).toBe(true);
    expect(valid.expected.crossSignatureReconstructionVerifies).toBe(true);
  });

  it("refuses a signature made over the wrong signing input", () => {
    for (const name of [
      "signature-computed-over-the-raw-transcript-instead-of-the-envelope",
      "envelope-built-from-a-digest-of-different-transcript-bytes",
    ]) {
      const entry = caseByName(F03, name);
      expect(
        verifyE2eeSignature({
          algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
          publicKey: fixtureBytes(F03.testKeyMaterial.nodeIdentityPublicKey),
          message: encodeNodeE2eeCapabilitySigningEnvelope(
            fixtureBytes(
              (entry.inputs.transcript ?? entry.inputs.carriedTranscript) as FixtureBytes,
            ),
          ),
          signature: fixtureBytes(entry.inputs.signature),
        }),
        name,
      ).toBe(false);
      expect(entry.expected.verifies, name).toBe(false);
    }
  });

  it("reproduces every §8.2 selection verdict from the case's own advertised fields", () => {
    for (const entry of F03.cases) {
      if (entry.inputs.tier === undefined) continue;
      const selection = selectE2eeSuite({
        tier: entry.inputs.tier as E2eeTier,
        localSuitePreference: entry.inputs.localSuitePreference as readonly number[],
        advertisedSuiteRegistry: entry.inputs.advertisedSuiteRegistry as readonly number[],
        advertisedVersionMin: entry.inputs.advertisedVersionMin as number,
        advertisedVersionMax: entry.inputs.advertisedVersionMax as number,
        advertisedAdmittedPatterns: entry.inputs
          .advertisedAdmittedPatterns as readonly E2eeNoisePattern[],
      });
      const expected = entry.expected.selection as JsonRecord;
      expect(selection.kind, entry.name).toBe(expected.kind);
      if (selection.kind === "unusable") {
        expect(selection.reason, entry.name).toBe(expected.reason);
        // §5.2 steps 8 and 9 and §8.2 all carry one disposition: no hello.
        expect(entry.expected.helloMayBeBuilt, entry.name).toBe(false);
        expect(entry.expected.ticketSpentOnAHello, entry.name).toBe(false);
        expect(entry.expected.row, entry.name).toBe(entry.inputs.selectionLatched ? "K2" : "K3");
      } else {
        expect(selection.selectedSuite, entry.name).toBe(expected.selectedSuite);
        expect(entry.expected.helloMayBeBuilt, entry.name).toBe(true);
      }
    }
  });

  it("pins the §5.5 worked-example figures against the encoder's own output", () => {
    const maximum = caseByName(F03, "maximum-conforming-statement");
    const largest = maximum.expected.largestValidating as JsonRecord;
    const upper = maximum.expected.section55UpperBound as JsonRecord;
    const bounds = maximum.expected.bounds as JsonRecord;

    // The two numbers §16.3 F3 requires, and the exact difference between them.
    expect(upper.transcriptBytes).toBe(
      (largest.transcriptBytes as number) + (upper.overChargeBytes as number),
    );
    expect(upper.statementBytes).toBe(
      (upper.transcriptBytes as number) + (bounds.statementWrapperMaxBytes as number),
    );
    expect(upper.base64urlChars).toBe(Math.ceil((4 * (upper.statementBytes as number)) / 3));
    expect(upper.carrierBytes).toBe(
      (bounds.capabilityCarrierFixedBytes as number) + (upper.base64urlChars as number),
    );
    expect(upper.carrierPlusPreludeBytes).toBe(
      (upper.carrierBytes as number) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
    );
    expect(largest.carrierPlusPreludeBytes).toBe(
      (largest.carrierBytes as number) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
    );

    for (const invariant of [
      "satisfiesS1",
      "satisfiesS4",
      "satisfiesS5",
      "satisfiesS6",
      "satisfiesS8",
    ]) {
      expect(maximum.expected[invariant], invariant).toBe(true);
    }
    // §7.2.1 exists because the same transcript signed directly is unsignable.
    expect(maximum.expected.directSigningWouldExceedTheSigningInterface).toBe(true);
    expect(caseByName(F03, "largest-directly-signed-transcripts").expected.satisfiesS9).toBe(true);
  });

  it("keeps the §7.2.1 envelope length-invariant", () => {
    const entry = caseByName(
      F03,
      "signing-envelope-length-is-identical-for-a-minimum-and-a-maximum-transcript",
    );
    expect(entry.expected.identicalLengths).toBe(true);
    expect(entry.expected.bothWithinSigningInputMaxBytes).toBe(true);
    expect(entry.expected.minimumEnvelopeBytes).toBe(entry.expected.capabilitySigningEnvelopeBytes);
    expect(entry.expected.maximumEnvelopeBytes).toBe(entry.expected.capabilitySigningEnvelopeBytes);
  });

  it("builds the §5.3 carrier as a real JSON encoder would", () => {
    const carrier = valid.expected.carrier as string;
    expect(carrier.startsWith("{")).toBe(true);
    const parsed = JSON.parse(carrier) as Readonly<Record<string, string>>;
    expect(Object.keys(parsed)).toEqual(["_tag", "statement"]);
    expect(parsed._tag).toBe(E2EE_CAPABILITY_CARRIER_TAG);
    expect(carrier).not.toContain("requestId");
    expect(carrier).toBe(JSON.stringify({ _tag: parsed._tag, statement: parsed.statement }));
    // §5.3: unpadded base64url of the statement CBOR, and nothing else.
    expect(parsed.statement).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hex(Uint8Array.from(Buffer.from(parsed.statement!, "base64url")))).toBe(
      hex(fixtureBytes(valid.expected.statement)),
    );
    expect(valid.expected.carrierFixedBytesMatchesJsonStringify).toBe(true);
  });

  it("reproduces every fixture carrier from the shared §5.3 encoder", () => {
    // The node's own encoder against the normative bytes, over every case that
    // carries a statement — including the maximum-size one, whose base64url is
    // where a hand-rolled expansion would first disagree.
    let checked = 0;
    for (const entry of F03.cases) {
      const statement = entry.expected.statement;
      const carrier = entry.expected.carrier;
      if (statement === undefined || typeof carrier !== "string") continue;
      const built = encodeE2eeCapabilityCarrier(fixtureBytes(statement));
      expect(new TextDecoder().decode(built), entry.name).toBe(carrier);
      expect(built.byteLength, entry.name).toBe(entry.expected.carrierBytes);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/** §4.5's ceiling for the channel every record case of F1 runs under. */
const PLAINTEXT_CEILING_OF_THE_CORPUS_CHANNEL = e2eeChannelSizeBudget({
  maxQueuedBytes: 384,
  maxControlFrameBytes: 256,
}).plaintextCeiling;

describe("§16.3 F1 payload discrimination and chunk pipeline (§4.2, §4.3, §4.5)", () => {
  it("reproduces the §4.3 receive pipeline for every case that carries one wire payload", () => {
    for (const entry of F01.cases) {
      const payload = entry.inputs.wirePayload ?? entry.inputs.postStripPayload;
      if (payload === undefined) continue;
      const bytes = fixtureBytes(payload);
      const pipeline = entry.expected.pipeline as JsonRecord;
      expect((pipeline.step1ChunkTest as JsonRecord).isChunkedPayload, entry.name).toBe(
        isChunkedPayload(bytes),
      );
      const assembler = new RelayMessageAssembler();
      const pushed = assembler.push(bytes);
      expect(pushed.kind, entry.name).toBe((pipeline.step1Assembler as JsonRecord).kind);
      if (pushed.kind !== "done") continue;

      const step1 = pipeline.step1Assembler as JsonRecord;
      expect(hex(pushed.message), entry.name).toBe(hex(fixtureBytes(step1.postStripPayload)));
      expect(pushed.message.byteLength, entry.name).toBe(step1.postStripBytes);
      expect(assembler.peerSupportsChunking, entry.name).toBe(step1.peerSupportsChunkingLatch);
      // WHETHER the prelude was there, stated three ways across this family and
      // checked as one: the payload carries it, step 1 stripped it, and what
      // came out is shorter by exactly its length. All three were free before —
      // a case could claim the prelude was stripped from a payload that never
      // carried one, which is the §4.3 step-1 behaviour the family exists to
      // pin.
      const carriedThePrelude =
        bytes.byteLength >= RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES &&
        hex(bytes.subarray(0, RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES)) ===
          hex(RELAY_CHUNK_CAPABILITY_PRELUDE);
      expect(step1.preludeStripped, entry.name).toBe(carriedThePrelude);

      const classified = classifyPostStripPayload(pushed.message);
      const step2 = pipeline.step2Discrimination as JsonRecord;
      expect(classified.kind, entry.name).toBe(step2.class);
      if (classified.kind === "other") expect(classified.reason, entry.name).toBe(step2.reason);

      // The §9.1 header fields, read off the very bytes the pipeline surfaced.
      const decode = entry.expected.envelopeDecode as JsonRecord | undefined;
      if (decode === undefined) continue;
      const envelope = decodeE2eeEnvelope(pushed.message);
      expect(envelope.kind, entry.name).toBe(decode.kind);
      if (envelope.kind !== "ok") continue;
      expect(envelope.value.version, entry.name).toBe(decode.version);
      expect(envelope.value.suite, entry.name).toBe(decode.suite);
      expect(Number(envelope.value.epoch), entry.name).toBe(decode.epoch);
      expect(Number(envelope.value.counter), entry.name).toBe(decode.counter);
      expect(hex(envelope.value.header), entry.name).toBe(hex(fixtureBytes(decode.header)));
    }
  });

  it("checks every top-level restatement of a §4.3 step-1 fact against the step itself", () => {
    // These five fields were each read behind `if (… !== undefined)` inside the
    // pipeline loop above, so a generator that stopped emitting one deleted its
    // own assertion in silence. Each is now driven from a PINNED set of
    // carriers: the field vanishing from a case fails here, and a case growing
    // it without this number moving fails here too.
    const payloadOf = (entry: FixtureCase): Uint8Array =>
      fixtureBytes(entry.inputs.wirePayload ?? entry.inputs.postStripPayload);
    const surfaced = (entry: FixtureCase): Uint8Array => {
      const pushed = new RelayMessageAssembler().push(payloadOf(entry));
      if (pushed.kind !== "done") throw new Error(`${entry.name}: §4.3 step 1 did not complete`);
      return pushed.message;
    };

    for (const entry of carrying(F01.cases, "isChunkedPayload", 1)) {
      expect(entry.expected.isChunkedPayload, entry.name).toBe(isChunkedPayload(payloadOf(entry)));
    }
    for (const entry of carrying(F01.cases, "wirePayloadBytes", 4)) {
      expect(entry.expected.wirePayloadBytes, entry.name).toBe(payloadOf(entry).byteLength);
    }
    for (const entry of carrying(F01.cases, "preludePresent", 4)) {
      const bytes = payloadOf(entry);
      expect(entry.expected.preludePresent, entry.name).toBe(
        bytes.byteLength >= RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES &&
          hex(bytes.subarray(0, RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES)) ===
            hex(RELAY_CHUNK_CAPABILITY_PRELUDE),
      );
    }
    for (const entry of carrying(F01.cases, "surfacedUnchanged", 1)) {
      expect(entry.expected.surfacedUnchanged, entry.name).toBe(
        hex(surfaced(entry)) === hex(payloadOf(entry)),
      );
    }
    for (const entry of carrying(F01.cases, "firstPostStripByte", 1)) {
      expect(entry.expected.firstPostStripByte, entry.name).toBe(surfaced(entry)[0]);
    }
  });

  it("re-protects the two inner-body boundary cases from the family's own secrets", () => {
    // `send`, `receive`, `envelope` and the overhead were carried and read by
    // nothing: a case could state a counter it never used, a plaintext length
    // that contradicted its own body, or envelope bytes that were not the bytes
    // it carried. They are all outputs of ONE operation, so the operation is run
    // here — with this family's own §6.5 stand-in secrets — and every field is
    // checked against what it returned, the envelope included, byte for byte.
    const session = (
      plaintextCeiling = PLAINTEXT_CEILING_OF_THE_CORPUS_CHANNEL,
    ): E2eeRecordSession =>
      new E2eeRecordSession({
        secrets: {
          epochSecretC2N: fixtureBytes(F01.testKeyMaterial.testOnlyEpochSecretC2N),
          epochSecretN2C: fixtureBytes(F01.testKeyMaterial.testOnlyEpochSecretN2C),
          exporterSecret: fixtureBytes(F01.testKeyMaterial.testOnlyExporterSecret),
          serverConfirmationKey: deriveE2eeServerConfirmationKey(
            fixtureBytes(F01.testKeyMaterial.testOnlyExporterSecret),
          ),
        },
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        sessionBindingHash: fixtureBytes(F01.testKeyMaterial.sessionBindingHash),
        sendDirection: F01.testKeyMaterial.sendDirection as E2eeDirection,
        plaintextCeiling,
      });

    const protect = async (
      entry: FixtureCase,
    ): Promise<{ result: E2eeProtectResult; envelope: Uint8Array | undefined }> => {
      let envelope: Uint8Array | undefined;
      const result = await session().protect({
        innerType: (entry.inputs.innerType ?? E2EE_INNER_TYPE_RPC) as E2eeInnerRecordType,
        body: new Uint8Array(entry.inputs.innerBodyBytes as number).fill(
          (entry.inputs.innerBodyFill as number | undefined) ?? 0,
        ),
        admit: () => true,
        transmit: (bytes) => {
          envelope = Uint8Array.from(bytes);
          return { kind: "sent" };
        },
      });
      return { result, envelope };
    };

    return (async (): Promise<void> => {
      // A zero-length inner body is a VALID §9.1 record, and the case's `send`
      // and `receive` blocks are the two halves of that one round trip.
      const zero = caseByName(F01, "envelope-with-a-zero-length-inner-body");
      const zeroRun = await protect(zero);
      const send = zero.expected.send as JsonRecord;
      expect(zeroRun.result.kind).toBe(send.kind);
      if (zeroRun.result.kind !== "protected") throw new Error("the zero-length body was refused");
      expect(Number(zeroRun.result.epoch)).toBe(send.epoch);
      expect(Number(zeroRun.result.counter)).toBe(send.counter);
      expect(zeroRun.result.plaintextBytes).toBe(send.plaintextBytes);
      expect(zeroRun.result.envelopeBytes).toBe(send.envelopeBytes);
      expect(hex(zeroRun.envelope!)).toBe(hex(fixtureBytes(zero.expected.envelope)));
      expect(zero.expected.envelopeBytes).toBe(zeroRun.envelope!.byteLength);
      expect(zero.expected.envelopeOverheadBytes).toBe(E2EE_ENVELOPE_OVERHEAD_BYTES);
      // …and the peer's side of it, from a session holding the same secrets in
      // the receiving direction.
      const peer = new E2eeRecordSession({
        secrets: {
          epochSecretC2N: fixtureBytes(F01.testKeyMaterial.testOnlyEpochSecretC2N),
          epochSecretN2C: fixtureBytes(F01.testKeyMaterial.testOnlyEpochSecretN2C),
          exporterSecret: fixtureBytes(F01.testKeyMaterial.testOnlyExporterSecret),
          serverConfirmationKey: deriveE2eeServerConfirmationKey(
            fixtureBytes(F01.testKeyMaterial.testOnlyExporterSecret),
          ),
        },
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        sessionBindingHash: fixtureBytes(F01.testKeyMaterial.sessionBindingHash),
        sendDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
        plaintextCeiling: PLAINTEXT_CEILING_OF_THE_CORPUS_CHANNEL,
      });
      const received = peer.unprotect(zeroRun.envelope!);
      const receive = zero.expected.receive as JsonRecord;
      expect(received.kind).toBe(receive.kind);
      if (received.kind !== "authenticated") throw new Error("the round trip did not authenticate");
      expect(received.innerType).toBe(receive.innerType);
      expect(received.body.byteLength).toBe(receive.bodyBytes);
      expect(received.plaintextBytes).toBe(receive.plaintextBytes);

      // The ceiling pair: the last body that fits is sent, and the first that
      // does not is refused sender-locally with nothing on the wire.
      const at = caseByName(F01, "inner-body-exactly-at-the-plaintext-ceiling");
      const atRun = await protect(at);
      expect(atRun.result.kind).toBe(at.expected.send);
      expect(hex(atRun.envelope!)).toBe(hex(fixtureBytes(at.expected.envelope)));
      expect(at.expected.envelopeBytes).toBe(atRun.envelope!.byteLength);
      expect(at.expected.transmittedRecords).toBe(1);

      const production = caseByName(
        F01,
        "production-inner-body-exactly-at-the-plaintext-ceiling-recipe",
      );
      const recipe = (production.inputs.body as JsonRecord).$recipe as JsonRecord;
      expect(recipe.kind).toBe("fill");
      const productionBody = new Uint8Array(recipe.bytes as number).fill(recipe.byte as number);
      let productionEnvelope: Uint8Array | undefined;
      const productionSession = session(production.inputs.plaintextCeiling as number);
      const productionResult = await productionSession.protect({
        innerType: production.inputs.innerType as E2eeInnerRecordType,
        body: productionBody,
        admit: () => true,
        transmit: (value) => {
          productionEnvelope = Uint8Array.from(value);
          return { kind: "sent" };
        },
      });
      productionSession.erase();
      expect(productionResult.kind).toBe(production.expected.send);
      expect(productionEnvelope?.byteLength).toBe(production.expected.envelopeBytes);
      expect(hex(sha256(productionEnvelope!))).toBe(production.expected.envelopeSha256);
      expect(hex(productionEnvelope!.subarray(0, 32))).toBe(
        hex(fixtureBytes(production.expected.envelopePrefix)),
      );
      expect(hex(productionEnvelope!.subarray(-32))).toBe(
        hex(fixtureBytes(production.expected.envelopeSuffix)),
      );
      expect(production.expected.transmittedRecords).toBe(1);

      const over = caseByName(F01, "inner-body-one-byte-over-the-plaintext-ceiling");
      const overRun = await protect(over);
      const refused = over.expected.send as JsonRecord;
      expect(overRun.result.kind).toBe(refused.kind);
      if (overRun.result.kind !== "refused") throw new Error("the over-ceiling body was sent");
      expect(overRun.result.reason).toBe(refused.reason);
      expect(over.expected.senderLocalError).toBe(overRun.result.reason);
      expect(over.expected.transmittedRecords).toBe(overRun.envelope === undefined ? 0 : 1);
    })();
  });

  it("reassembles the chunked envelope to the exact envelope bytes", () => {
    const entry = caseByName(F01, "chunked-envelope-reassembles-to-the-envelope");
    const payloads = (entry.inputs.wirePayloads as readonly FixtureBytes[]).map(fixtureBytes);
    // `chunkCount` and `chunkHeaderBytes` were emitted and read by nothing: the
    // case could have claimed one chunk beside three payloads, or a header size
    // the framing does not use, and the reassembly below still passed. Both are
    // derivable — one from the payloads the case carries, the other from the
    // framing constant every chunk is built with — so both are derived.
    expect(entry.expected.chunkCount, "one count per carried wire payload").toBe(payloads.length);
    expect(entry.expected.chunkHeaderBytes, "§4.5's chunk framing").toBe(RELAY_CHUNK_HEADER_BYTES);
    expect(entry.expected.everyChunkStartsWithChunkMagic).toBe(
      payloads.every((payload) => payload[0] === RELAY_CHUNK_MAGIC),
    );
    expect(entry.expected.everyChunkStartsWithChunkMagic).toBe(true);
    const assembler = new RelayMessageAssembler();
    let message: Uint8Array | undefined;
    const pushResults: string[] = [];
    for (const payload of payloads) {
      expect(isChunkedPayload(payload)).toBe(true);
      // Every chunk carries the header, so the body is what the header leaves.
      expect(payload.byteLength, "header plus body").toBeGreaterThan(
        entry.expected.chunkHeaderBytes as number,
      );
      const pushed = assembler.push(payload);
      pushResults.push(pushed.kind);
      if (pushed.kind === "done") message = pushed.message;
    }
    expect(message).toBeDefined();
    expect(hex(message!)).toBe(hex(fixtureBytes(entry.inputs.envelope)));
    expect(classifyPostStripPayload(message!).kind).toBe("envelope");
    // The reassembly block, against the assembler that produced it.
    const reassembly = entry.expected.reassembly as JsonRecord;
    expect(reassembly.pushResults).toEqual(pushResults);
    expect(reassembly.peerSupportsChunkingLatch).toBe(assembler.peerSupportsChunking);
    expect(hex(fixtureBytes(reassembly.reassembled))).toBe(hex(message!));
    expect((reassembly.step2Discrimination as JsonRecord).class).toBe(
      classifyPostStripPayload(message!).kind,
    );
    expect(entry.expected.reassembledEqualsEnvelope).toBe(
      hex(message!) === hex(fixtureBytes(entry.inputs.envelope)),
    );
  });

  it("puts the prelude on exactly one side of the headroom boundary", () => {
    const at = caseByName(F01, "envelope-exactly-at-the-prelude-headroom-boundary");
    const over = caseByName(F01, "envelope-one-byte-over-the-prelude-headroom-boundary");
    expect(at.expected.preludePresent).toBe(true);
    expect(over.expected.preludePresent).toBe(false);
    expect((over.inputs.envelopeBytes as number) - (at.inputs.envelopeBytes as number)).toBe(1);
    expect((at.inputs.envelopeBytes as number) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES).toBe(
      at.inputs.assertedMaxDataChunkBytes,
    );
  });

  it("carries both reachability paths to a zero-length post-strip payload in all three modes", () => {
    const empties = casesMatching(F01, /^empty-post-strip-payload-/);
    expect(empties.length).toBe(6);
    for (const entry of empties) {
      const pipeline = entry.expected.pipeline as JsonRecord;
      const step1 = pipeline.step1Assembler as JsonRecord;
      const step2 = pipeline.step2Discrimination as JsonRecord;
      expect(step1.postStripBytes, entry.name).toBe(0);
      expect(step2.class, entry.name).toBe("other");
      expect(step2.reason, entry.name).toBe("empty");
      expect(entry.expected.neverSilentlyDropped, entry.name).toBe(true);
      // §11.2 P6 before keys, §11.3 Q6 after.
      expect(entry.expected.fatal, entry.name).toBe(
        entry.inputs.modeMachineState === "e2ee" ? "Q6" : "P6",
      );
      expect(entry.expected.disposition, entry.name).toBe(
        entry.inputs.modeMachineState === "e2ee" ? "FATAL-POST" : "FATAL-PRE",
      );
      // The prelude path MUST set the chunk-support latch before the fatal
      // outcome is taken; the zero-length path has no prelude to set it with.
      expect(step1.peerSupportsChunkingLatch, entry.name).toBe(
        entry.name.includes("chunk-capability-prelude"),
      );
    }
    expect(new Set(empties.map((entry) => entry.inputs.modeMachineState))).toEqual(
      new Set(["negotiating", "e2ee", "legacy"]),
    );
  });

  it("reproduces the §4.5 budget and both sides of the plaintext ceiling", () => {
    for (const name of [
      "size-budget-under-the-relay-initial-limits",
      "size-budget-of-the-corpus-channel",
    ]) {
      const entry = caseByName(F01, name);
      expect(
        e2eeChannelSizeBudget({
          maxQueuedBytes: entry.inputs.maxQueuedBytes as number,
          maxControlFrameBytes: entry.inputs.maxControlFrameBytes as number,
        }),
        name,
      ).toEqual(entry.expected);
    }

    const at = caseByName(F01, "inner-body-exactly-at-the-plaintext-ceiling");
    expect(at.expected.send).toBe("protected");
    expect(at.expected.envelopeBytes).toBe(
      (at.inputs.innerBodyBytes as number) + E2EE_ENVELOPE_OVERHEAD_BYTES,
    );
    expect(at.expected.transmittedRecords).toBe(1);

    const over = caseByName(F01, "inner-body-one-byte-over-the-plaintext-ceiling");
    expect(over.expected.send).toEqual({ kind: "refused", reason: "e2ee_message_too_large" });
    // §4.2 step 2: nothing encrypted, nothing transmitted.
    expect(over.expected.transmittedRecords).toBe(0);
    expect((over.inputs.innerBodyBytes as number) - (at.inputs.innerBodyBytes as number)).toBe(1);
  });

  it("treats a zero-length inner body as a valid §9.1 record", () => {
    const entry = caseByName(F01, "envelope-with-a-zero-length-inner-body");
    expect(entry.expected.envelopeBytes).toBe(E2EE_ENVELOPE_OVERHEAD_BYTES);
    expect((entry.expected.receive as JsonRecord).kind).toBe("authenticated");
    expect((entry.expected.receive as JsonRecord).bodyBytes).toBe(0);
    // Distinct from the zero-length POST-STRIP payload, which is fatal.
    expect(classifyPostStripPayload(fixtureBytes(entry.expected.envelope)).kind).toBe("envelope");
  });
});

describe("§16.3 F17 key-material validation (§7.1, §8.1, §14.3)", () => {
  it("rejects every §7.1 P-256 public-key encoding the family carries", () => {
    for (const entry of casesMatching(F17, /^p256-public-key-(?!valid)/)) {
      const key = fixtureBytes(entry.inputs.publicKey);
      expect(() => validateE2eeClientIdentityPublicKey(key), entry.name).toThrow();
      expect((entry.expected.validation as JsonRecord).rejected, entry.name).toBe(true);
      expect(entry.expected.fatal, entry.name).toBe("P11");
    }
    const control = caseByName(F17, "p256-public-key-valid-control");
    expect(() =>
      validateE2eeClientIdentityPublicKey(fixtureBytes(control.inputs.publicKey)),
    ).not.toThrow();
    // The control's verdict is the case's OWN claim, not a literal here: an
    // `expected` block stating the validator rejects its control would fail.
    expect(control.expected.validationAccepted, control.name).toBe(
      accepts(() => validateE2eeClientIdentityPublicKey(fixtureBytes(control.inputs.publicKey))),
    );
  });

  it("rejects every §7.1 P-256 signature encoding the family carries", () => {
    for (const entry of casesMatching(F17, /^p256-signature-/)) {
      const signature = fixtureBytes(entry.inputs.signature);
      expect(() => validateE2eeClientSignature(signature), entry.name).toThrow();
      expect((entry.expected.encodingValidation as JsonRecord).rejected, entry.name).toBe(true);
      // The single verification choke point returns false and never throws, and
      // the case's own `verificationVerdict` is what it is compared against — it
      // used to be compared against a literal `false` written here, which left
      // the corpus free to state anything at all.
      const verdict = verifyE2eeSignature({
        algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
        publicKey: fixtureBytes(F17.testKeyMaterial.clientIdentityPublicKey),
        message: fixtureBytes(
          caseByName(F04, "valid-client-agreement-prekey-certificate").inputs.transcript,
        ),
        signature,
      });
      expect(verdict, entry.name).toBe(false);
      expect(entry.expected.verificationVerdict, entry.name).toBe(verdict);
    }
  });

  it("applies strict RFC 8032 to Ed25519 keys and signatures (§14.3)", () => {
    const control = caseByName(
      F17,
      "ed25519-signature-with-a-canonically-encoded-identity-r-control",
    );
    const nonCanonical = caseByName(
      F17,
      "ed25519-signature-with-a-non-canonically-encoded-identity-r",
    );
    const verifyUnder = (key: Uint8Array, entry: FixtureCase): boolean =>
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: key,
        message: fixtureBytes(entry.inputs.message),
        signature: fixtureBytes(entry.inputs.signature),
      });
    const verifyCase = (entry: FixtureCase): boolean =>
      verifyUnder(fixtureBytes(entry.inputs.publicKey), entry);

    for (const entry of casesMatching(F17, /^ed25519-public-key-/)) {
      const key = fixtureBytes(entry.inputs.publicKey);
      expect(() => validateE2eeNodeIdentityPublicKey(key), entry.name).toThrow();
      // Both halves of what the case states: the validator refuses the encoding,
      // and the verification choke point refuses it too rather than throwing —
      // driven against the control's own message and signature, which is the
      // only pair in this family a key substitution can be tested with.
      expect((entry.expected.validation as JsonRecord).rejected, entry.name).toBe(
        !accepts(() => validateE2eeNodeIdentityPublicKey(key)),
      );
      expect(entry.expected.verificationVerdict, entry.name).toBe(verifyUnder(key, control));
    }

    // The pair differs ONLY in the encoding of R, so the rejection below is
    // about canonicality and not about a broken verification equation.
    expect(control.expected.verificationVerdict).toBe(verifyCase(control));
    expect(control.expected.verificationVerdict).toBe(true);
    expect(nonCanonical.expected.verificationVerdict).toBe(verifyCase(nonCanonical));
    expect(nonCanonical.expected.verificationVerdict).toBe(false);
    // §14.3 pins `zip215: false`. The version-1 fixture also records the old
    // primitive's ZIP215 result. Noble v1 canonicalized R and A before hashing
    // the challenge; v2 correctly hashes the exact encodings and therefore
    // accepts this constructed relaxed-mode signature.
    const signature = fixtureBytes(nonCanonical.inputs.signature);
    expect(
      ed25519.verify(
        signature,
        fixtureBytes(nonCanonical.inputs.message),
        fixtureBytes(nonCanonical.inputs.publicKey),
        { zip215: true },
      ),
    ).toBe(true);
    const legacyZip215Signature = Uint8Array.from(signature);
    legacyZip215Signature.set(
      ed25519.Point.fromBytes(fixtureBytes(nonCanonical.inputs.rEncoding), true).toBytes(),
      0,
    );
    expect(nonCanonical.expected.pinnedPrimitiveUnderZip215Relaxation).toBe(
      ed25519.verify(
        legacyZip215Signature,
        fixtureBytes(nonCanonical.inputs.message),
        fixtureBytes(nonCanonical.inputs.publicKey),
        { zip215: true },
      ),
    );

    // "Differs only in the encoding of R" is derived, not asserted by fiat: the
    // key and the message are byte-identical, and the two `R` encodings carry
    // the same sign bit and the same `y` MODULO the field prime while differing
    // as byte strings. The scalar half necessarily differs — `S` is computed
    // over the encoding of `R` — so an EQUALITY there would say the opposite of
    // what the case means; the inequality below is the statement that does hold,
    // and it is asserted rather than left implicit so a regenerated pair that
    // reused one `S` across both cases fails here.
    expect(hex(fixtureBytes(control.inputs.signature)).slice(64)).not.toBe(
      hex(fixtureBytes(nonCanonical.inputs.signature)).slice(64),
    );
    expect(nonCanonical.expected.differsFromTheControlOnlyInTheEncodingOfR).toBe(
      hex(fixtureBytes(control.inputs.publicKey)) ===
        hex(fixtureBytes(nonCanonical.inputs.publicKey)) &&
        hex(fixtureBytes(control.inputs.message)) ===
          hex(fixtureBytes(nonCanonical.inputs.message)) &&
        hex(fixtureBytes(control.inputs.rEncoding)) !==
          hex(fixtureBytes(nonCanonical.inputs.rEncoding)) &&
        sameEdwardsY(
          fixtureBytes(control.inputs.rEncoding),
          fixtureBytes(nonCanonical.inputs.rEncoding),
        ),
    );
    expect(nonCanonical.expected.differsFromTheControlOnlyInTheEncodingOfR).toBe(true);
    // …and each `rEncoding` really is its own signature's first half, so the
    // comparison above is about the signatures and not about two loose fields.
    for (const entry of [control, nonCanonical]) {
      expect(hex(fixtureBytes(entry.inputs.rEncoding)), entry.name).toBe(
        hex(fixtureBytes(entry.inputs.signature).subarray(0, 32)),
      );
    }

    for (const entry of casesMatching(F17, /^ed25519-signature-scalar-/)) {
      expect(entry.expected.verificationVerdict, entry.name).toBe(verifyCase(entry));
      expect(entry.expected.verificationVerdict, entry.name).toBe(false);
    }
  });

  it("rejects every cross-domain signature substitution, in both §3.5 families (§7.2)", () => {
    const entry = caseByName(F17, "cross-domain-signature-substitution");
    const domains = entry.inputs.domains as readonly JsonRecord[];
    // All five domain groups §16.3 F17 names. The last two are the node-identity
    // domains: they live in `nodeIdentity.ts`, not in the E2EE transcript module,
    // and §3.5's closing rule is precisely that a signature is not liftable
    // ACROSS the two families either.
    expect(domains.map((domain) => domain.domain)).toEqual([
      E2EE_NODE_PREKEY_TRANSCRIPT_DOMAIN,
      E2EE_NODE_IDENTITY_CONTINUITY_TRANSCRIPT_DOMAIN,
      E2EE_NODE_CAPABILITY_DIGEST_DOMAIN,
      E2EE_CLIENT_PREKEY_TRANSCRIPT_DOMAIN,
      NODE_AUTH_TRANSCRIPT_DOMAIN,
      NODE_KEY_ROTATION_TRANSCRIPT_DOMAIN,
    ]);
    expect(new Set(domains.map((domain) => domain.transcriptFamily))).toEqual(
      new Set(["e2ee", "node-identity"]),
    );

    for (const domain of domains) {
      // §3.5: the domain string is the FIRST element of its canonical-CBOR
      // structure. A message that did not carry it would make the row vacuous.
      const decoded = decode(fixtureBytes(domain.message), E2EE_STRICT_DECODE_OPTIONS) as readonly [
        string,
        ...unknown[],
      ];
      expect(decoded[0], String(domain.domain)).toBe(domain.domain);
    }

    // THE MATRIX IS THE ASSERTION TARGET, not a restatement beside one.
    //
    // The substitutions were driven through `verifyE2eeSignature` before this,
    // but against the INPUT domains alone: the 114-leaf `expected.matrix` block
    // that records the result row by row was read by nothing, so it could have
    // said a substitution verifies and no test would have moved. Every row and
    // every cell is now compared against what the verification path returned.
    const matrix = entry.expected.matrix as readonly JsonRecord[];
    expect(matrix.map((row) => row.verificationPath)).toEqual(
      domains.map((domain) => domain.domain),
    );

    let substitutions = 0;
    for (const row of matrix) {
      const verifier = domains.find((domain) => domain.domain === row.verificationPath);
      if (verifier === undefined) throw new Error(`no domain for ${String(row.verificationPath)}`);
      const path = String(row.verificationPath);
      expect(row.transcriptFamily, path).toBe(verifier.transcriptFamily);
      expect(row.algorithm, path).toBe(verifier.algorithm);
      // Each verification path runs under its OWN public key, carried with the
      // case: four of the six domains are signed by the same Ed25519 node
      // identity key, so a substitution across them fails on the transcript
      // bytes alone and never on a key mismatch.
      const verify = (signature: Uint8Array): boolean =>
        verifyE2eeSignature({
          algorithm: verifier.algorithm as "ed25519" | "p256",
          publicKey: fixtureBytes(verifier.publicKey),
          message: fixtureBytes(verifier.message),
          signature,
        });
      expect(row.ownSignatureVerifies, path).toBe(verify(fixtureBytes(verifier.signature)));
      expect(row.ownSignatureVerifies, path).toBe(true);

      const replays = row.substitutions as readonly JsonRecord[];
      // Every OTHER domain, in order: the row is the full off-diagonal of its
      // column and not a sample of it.
      expect(
        replays.map((replay) => replay.signatureFrom),
        path,
      ).toEqual(
        domains.filter((domain) => domain.domain !== row.verificationPath).map((d) => d.domain),
      );
      for (const replay of replays) {
        const source = domains.find((domain) => domain.domain === replay.signatureFrom);
        if (source === undefined) throw new Error(`no domain for ${String(replay.signatureFrom)}`);
        const label = `${String(replay.signatureFrom)} -> ${path}`;
        substitutions += 1;
        expect(replay.signatureFromFamily, label).toBe(source.transcriptFamily);
        expect(replay.verifies, label).toBe(verify(fixtureBytes(source.signature)));
        expect(replay.verifies, label).toBe(false);
      }
    }
    // The matrix is complete in both directions, not a sampled diagonal.
    expect(entry.expected.domainCount).toBe(domains.length);
    expect(substitutions).toBe(domains.length * (domains.length - 1));
    expect(entry.expected.substitutionsTested).toBe(substitutions);
    expect(entry.expected.everyOwnSignatureVerifies).toBe(true);
    expect(entry.expected.everySubstitutionRejected).toBe(true);

    const nodeIdentity = domains.filter((domain) => domain.transcriptFamily === "node-identity");
    expect(nodeIdentity.length).toBe(2);
    expect(entry.expected.crossFamilySubstitutionsTested).toBe(
      2 * nodeIdentity.length * (domains.length - nodeIdentity.length),
    );
  });

  it("aborts the handshake on an all-zero X25519 shared secret in both positions", () => {
    for (const entry of casesMatching(F17, /^x25519-all-zero-shared-secret-/)) {
      expect(entry.expected.ikInitiatorEsAborted, entry.name).toBe(true);
      expect(entry.expected.nxResponderEeAborted, entry.name).toBe(true);
      expect(entry.expected.fatal, entry.name).toBe("P10");
    }
  });
});

describe("§16.3 F6 and F7 handshakes (§8)", () => {
  const traces = [
    { family: F06, name: "ik-handshake-complete-trace", tier: "native" as const },
    { family: F07, name: "nx-handshake-complete-trace", tier: "web" as const },
  ];

  it("re-derives every §8 intermediate from the case's own carried bytes", () => {
    for (const entry of traces) {
      const trace = caseByName(entry.family, entry.name).expected;
      const contextBlock = fixtureBytes(trace.contextBlock);
      const clientHello = fixtureBytes(trace.clientHello);
      const serverAccept = fixtureBytes(trace.serverAccept);
      const serverAcceptTbs = fixtureBytes(trace.serverAcceptTbs);

      // §8.3: the commitment is SHA-256 of the canonical-CBOR block.
      expect(hex(e2eeAuthorizationContextCommitment(contextBlock)), entry.name).toBe(
        hex(fixtureBytes(trace.contextCommitment)),
      );

      // §8.7: `serverConfirmationKey` comes from `exporterSecret` and nothing else.
      const confirmationKey = deriveE2eeServerConfirmationKey(fixtureBytes(trace.exporterSecret));
      expect(hex(confirmationKey), entry.name).toBe(hex(fixtureBytes(trace.serverConfirmationKey)));

      // §8.7: the transcript covers the EXACT hello wire bytes, the TBS, and the block.
      const transcript = e2eeConfirmationTranscript({
        clientHelloWireBytes: clientHello,
        serverAcceptTbsWireBytes: serverAcceptTbs,
        contextBlock,
      });
      expect(hex(transcript), entry.name).toBe(hex(fixtureBytes(trace.confirmationTranscript)));
      expect(hex(e2eeServerConfirmation(confirmationKey, transcript)), entry.name).toBe(
        hex(fixtureBytes(trace.serverConfirmation)),
      );

      // §8.8 step 6: the binding is over the EXACT FINAL WIRE BYTES received.
      expect(
        hex(
          e2eeSessionBindingHash({
            clientHelloWireBytes: clientHello,
            serverAcceptWireBytes: serverAccept,
            contextBlock,
          }),
        ),
        entry.name,
      ).toBe(hex(fixtureBytes(trace.sessionBindingHash)));

      // §9.4: both epoch-0 AEAD keys, from the two `Split()` outputs.
      expect(
        hex(deriveE2eeAeadKey(fixtureBytes(trace.epochSecretC2N), E2EE_DIRECTION_CLIENT_TO_NODE)),
        entry.name,
      ).toBe(hex(fixtureBytes(trace.aeadKeyC2NEpoch0)));
      expect(
        hex(deriveE2eeAeadKey(fixtureBytes(trace.epochSecretN2C), E2EE_DIRECTION_NODE_TO_CLIENT)),
        entry.name,
      ).toBe(hex(fixtureBytes(trace.aeadKeyN2CEpoch0)));

      // The records decode to the values the trace names, through the §8 codecs.
      const hello = decodeE2eeClientHello(clientHello);
      expect(hello.kind, entry.name).toBe("ok");
      if (hello.kind !== "ok") continue;
      expect(hello.value.tier, entry.name).toBe(entry.tier);
      expect(hex(hello.value.noiseMessage1), entry.name).toBe(
        hex(fixtureBytes(trace.noiseMessage1)),
      );
      const accept = decodeE2eeServerAccept(serverAccept);
      expect(accept.kind, entry.name).toBe("ok");
      if (accept.kind !== "ok") continue;
      expect(hex(accept.value.serverConfirmation), entry.name).toBe(
        hex(fixtureBytes(trace.serverConfirmation)),
      );
      expect(hex(accept.value.contextCommitment), entry.name).toBe(
        hex(fixtureBytes(trace.contextCommitment)),
      );
      expect(fixtureBytes(trace.noiseHandshakeHash).byteLength, entry.name).toBe(32);
      expect(fixtureBytes(trace.noiseChainingKeyFinal).byteLength, entry.name).toBe(32);
      expect(hex(fixtureBytes(trace.noiseHandshakeHash)), entry.name).not.toBe(
        hex(fixtureBytes(trace.sessionBindingHash)),
      );
      expect(trace.bothEndpointsDerivedIdenticalSecrets, entry.name).toBe(true);
    }
  });

  it("gates the RPC handler on the §8.9 implicit finish, in both tiers", () => {
    for (const entry of traces) {
      const envelopes = caseByName(entry.family, entry.name).expected
        .firstProtectedEnvelopes as JsonRecord;
      const finish = envelopes.implicitFinish as JsonRecord;
      expect(finish.beforeFirstClientEnvelope, entry.name).toEqual({
        mayInvokeRpcHandler: false,
        mayEmitApplicationRpc: false,
      });
      expect(finish.result, entry.name).toBe("finished");
      expect(finish.mayInvokeRpcHandlerAfter, entry.name).toBe(true);

      // The AAD of each first envelope, recomputed from the header it carries.
      for (const [key, direction] of [
        ["clientToNode", E2EE_DIRECTION_CLIENT_TO_NODE],
        ["nodeToClient", E2EE_DIRECTION_NODE_TO_CLIENT],
      ] as const) {
        const side = envelopes[key] as JsonRecord;
        const envelope = fixtureBytes(side.envelope);
        const trace = caseByName(entry.family, entry.name).expected;
        expect(
          hex(
            e2eeEnvelopeAad({
              header: envelope.subarray(0, 15),
              sessionBindingHash: fixtureBytes(trace.sessionBindingHash),
              direction,
            }),
          ),
          `${entry.name} ${key}`,
        ).toBe(hex(fixtureBytes(side.aad)));
        expect(
          (side.receivedByNode ?? side.receivedByClient) as JsonRecord,
          entry.name,
        ).toMatchObject({ kind: "authenticated" });
      }
    }
  });

  it("keeps the two NX-only rules", () => {
    expect(caseByName(F07, "nx-handshake-complete-trace").expected.message1PayloadIsEmpty).toBe(
      true,
    );
    const nonEmpty = caseByName(F07, "nx-message-1-payload-must-be-empty").expected;
    expect(nonEmpty.row).toBe("P10");
    expect(nonEmpty.reason).toBe("nx_payload_not_empty");
    const substitution = caseByName(
      F07,
      "nx-responder-static-must-equal-the-advertised-prekey",
    ).expected;
    expect(substitution.row).toBe("P16");
    expect(substitution.clientEmitsNoRecord).toBe(true);
  });
});

describe("§16.3 F8 record protection (§9.1–§9.3)", () => {
  it("recomputes the AAD and the nonce for both directions", () => {
    for (const entry of casesMatching(F08, /^aad-(client-to-node|node-to-client)$/)) {
      const direction = entry.inputs.direction as E2eeDirection;
      const header = encodeE2eeEnvelopeHeader({
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        epoch: BigInt(entry.inputs.epoch as number),
        counter: BigInt(entry.inputs.counter as number),
      });
      expect(hex(header), entry.name).toBe(hex(fixtureBytes(entry.expected.header)));
      expect(hex(encodeE2eeDirectionLabel(direction)), entry.name).toBe(
        hex(fixtureBytes(entry.expected.directionLabel)),
      );
      expect(hex(e2eeAeadNonce(0n, 0n)), entry.name).toBe(hex(fixtureBytes(entry.expected.nonce)));
      const aad = e2eeEnvelopeAad({
        header,
        sessionBindingHash: fixtureBytes(entry.inputs.sessionBindingHash),
        direction,
      });
      expect(hex(aad), entry.name).toBe(hex(fixtureBytes(entry.expected.aad)));
      expect(aad.byteLength, entry.name).toBe(E2EE_AAD_BYTES);
      expect(entry.expected.matchesAadBytesConstant, entry.name).toBe(true);
      expect(entry.expected.nonceEqualsHeaderSequenceFields, entry.name).toBe(true);
    }
  });

  it("puts each tampering case on the §4.3 check its field belongs to", () => {
    const outcome = (name: string): string =>
      (caseByName(F08, name).expected.received as JsonRecord).reason as string;
    // §4.3's ordering: length, version, suite — before an AEAD is selected —
    // then the §9.2 sequence comparison, before decryption, then the AEAD.
    expect(outcome("tampered-header-version-byte")).toBe("version_mismatch");
    expect(outcome("tampered-header-suite-byte")).toBe("suite_mismatch");
    expect(outcome("tampered-header-epoch-byte")).toBe("sequence_mismatch");
    expect(outcome("tampered-header-counter-byte")).toBe("sequence_mismatch");
    expect(outcome("tampered-ciphertext-byte")).toBe("authentication_failed");
    expect(outcome("tampered-aead-tag-byte")).toBe("authentication_failed");
    for (const name of [
      "wrong-direction-label-fails-authentication",
      "wrong-session-binding-hash-fails-authentication",
    ]) {
      expect(outcome(name), name).toBe("authentication_failed");
    }
    for (const entry of casesMatching(F08, /^tampered-header-/)) {
      expect(entry.expected.ciphertextDecrypted, entry.name).toBe(false);
    }
  });

  it("drives every tampered envelope through the real §4.3 receive path", () => {
    // THE OBLIGATION THAT WAS COMMITTED, CLAIMED, AND EXECUTED BY NOTHING.
    //
    // `inputs.tamperedEnvelope` — the whole point of these six cases — had ZERO
    // references in any consuming suite. The test above reads only the `reason`
    // string beside it, so the corpus could have carried an envelope that opens
    // cleanly, or one tampered in a completely different field, and the case
    // would still have passed by agreeing with itself. The bytes are the case;
    // running them is the only thing that makes it a vector rather than a label.
    //
    // The session comes from F6: these envelopes are records of that IK trace,
    // and F6 carries its §6.5 outputs, so opening them here is a derivation
    // ACROSS families rather than a restatement of either.
    const trace = caseByName(F06, "ik-handshake-complete-trace").expected;
    const receiver = (): E2eeRecordSession =>
      new E2eeRecordSession({
        secrets: {
          epochSecretC2N: fixtureBytes(trace.epochSecretC2N),
          epochSecretN2C: fixtureBytes(trace.epochSecretN2C),
          exporterSecret: fixtureBytes(trace.exporterSecret),
          serverConfirmationKey: fixtureBytes(trace.serverConfirmationKey),
        },
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        sessionBindingHash: fixtureBytes(trace.sessionBindingHash),
        // Each case's envelope was sent client-to-node by a fresh sender, so the
        // receiver is a fresh node session at (epoch 0, counter 0).
        sendDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
        plaintextCeiling: PLAINTEXT_CEILING_OF_THE_CORPUS_CHANNEL,
      });

    for (const entry of casesMatching(F08, /^tampered-/)) {
      const clean = fixtureBytes(entry.inputs.envelope);
      const tampered = fixtureBytes(entry.inputs.tamperedEnvelope);

      // The untampered envelope opens, so a failure below is attributable to the
      // tamper and not to a mis-built session or a stale trace.
      expect(receiver().unprotect(clean).kind, entry.name).toBe("authenticated");

      // The tamper is exactly what the case says it is: one byte, at the
      // declared index, and nothing else moved.
      expect(tampered.byteLength, entry.name).toBe(clean.byteLength);
      const differing = [...clean].flatMap((byte, index) =>
        byte === tampered[index] ? [] : [index],
      );
      expect(differing, entry.name).toEqual([entry.inputs.tamperedByteIndex]);

      // …and the real receive path takes the §11.3 row the case names.
      const received = receiver().unprotect(tampered);
      const expected = entry.expected.received as JsonRecord;
      expect(received.kind, entry.name).toBe(expected.kind);
      if (received.kind !== "fatal") {
        throw new Error(`${entry.name}: the tampered envelope authenticated`);
      }
      expect(received.reason, entry.name).toBe(expected.reason);
      // §4.3's ordering as an OBSERVATION rather than a claim: a header field's
      // own comparison fires before an AEAD is selected, so a header tamper can
      // only surface as that field's mismatch and never as an authentication
      // failure. `ciphertextDecrypted` is exactly that distinction.
      if (entry.name.startsWith("tampered-header-")) {
        expect(entry.expected.ciphertextDecrypted, entry.name).toBe(false);
        expect(received.reason === "authentication_failed", entry.name).toBe(false);
      } else {
        expect(
          Object.hasOwn(entry.expected, "ciphertextDecrypted"),
          `${entry.name}: an AEAD failure decrypts nothing either, and says so by not claiming it`,
        ).toBe(false);
        expect(received.reason, entry.name).toBe("authentication_failed");
      }
      // Keys exist by definition here — the record was protected — so §11.3
      // puts every one of these on the post-key side of the disposition split.
      expect(entry.expected.disposition, entry.name).toBe("FATAL-POST");
    }
  });

  it("re-protects both counter-zero-and-one traces from the F6 session's own secrets", () => {
    // Both cases were entirely inert: `records`, `senderNextSend` and
    // `receiverExpectedNext` were read by nothing, so the envelopes, their AADs,
    // their positions and both endpoints' resulting states were free numbers.
    // They are all outputs of one round trip, so the round trip is run.
    const trace = caseByName(F06, "ik-handshake-complete-trace").expected;
    const secrets = (): E2eeSessionSecrets => ({
      epochSecretC2N: fixtureBytes(trace.epochSecretC2N),
      epochSecretN2C: fixtureBytes(trace.epochSecretN2C),
      exporterSecret: fixtureBytes(trace.exporterSecret),
      serverConfirmationKey: fixtureBytes(trace.serverConfirmationKey),
    });
    const session = (sendDirection: E2eeDirection): E2eeRecordSession =>
      new E2eeRecordSession({
        secrets: secrets(),
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        sessionBindingHash: fixtureBytes(trace.sessionBindingHash),
        sendDirection,
        plaintextCeiling: PLAINTEXT_CEILING_OF_THE_CORPUS_CHANNEL,
      });

    return (async (): Promise<void> => {
      for (const entry of casesMatching(F08, /^envelopes-at-counters-zero-and-one-/)) {
        const sendDirection = entry.inputs.sendDirection as E2eeDirection;
        const sender = session(sendDirection);
        const peer = session(
          sendDirection === E2EE_DIRECTION_CLIENT_TO_NODE
            ? E2EE_DIRECTION_NODE_TO_CLIENT
            : E2EE_DIRECTION_CLIENT_TO_NODE,
        );
        for (const record of entry.expected.records as readonly JsonRecord[]) {
          const label = `${entry.name} ${JSON.stringify(record.position)}`;
          let envelope: Uint8Array | undefined;
          const sent = await sender.protect({
            innerType: E2EE_INNER_TYPE_RPC,
            body: fixtureBytes(record.innerBody),
            admit: () => true,
            transmit: (bytes) => {
              envelope = Uint8Array.from(bytes);
              return { kind: "sent" };
            },
          });
          if (sent.kind !== "protected") throw new Error(`${label}: the record was refused`);
          expect(hex(envelope!), label).toBe(hex(fixtureBytes(record.envelope)));
          expect(sent.envelopeBytes, label).toBe(record.envelopeBytes);
          expect({ epoch: Number(sent.epoch), counter: Number(sent.counter) }, label).toEqual(
            record.position,
          );
          expect(
            hex(
              e2eeEnvelopeAad({
                header: envelope!.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
                sessionBindingHash: fixtureBytes(trace.sessionBindingHash),
                direction: sendDirection,
              }),
            ),
            label,
          ).toBe(hex(fixtureBytes(record.aad)));

          const received = peer.unprotect(envelope!);
          const expectedReceive = record.received as JsonRecord;
          expect(received.kind, label).toBe(expectedReceive.kind);
          if (received.kind !== "authenticated") throw new Error(`${label}: it did not open`);
          expect(received.innerType, label).toBe(expectedReceive.innerType);
          expect(received.body.byteLength, label).toBe(expectedReceive.bodyBytes);
          expect(Number(received.epoch), label).toBe(expectedReceive.epoch);
          expect(Number(received.counter), label).toBe(expectedReceive.counter);
          expect(received.plaintextBytes, label).toBe(expectedReceive.plaintextBytes);
          expect(received.epochCompleted, label).toBe(expectedReceive.epochCompleted);
        }
        // Both endpoints' resulting §9.2 state, from the sessions themselves.
        expect(directionState(sender.sendState), entry.name).toEqual(entry.expected.senderNextSend);
        expect(directionState(peer.receiveState), entry.name).toEqual(
          entry.expected.receiverExpectedNext,
        );
        sender.erase();
        peer.erase();
      }
    })();
  });

  it("isolates the direction label from the direction-keyed schedule", () => {
    const entry = caseByName(F08, "wrong-direction-label-fails-authentication");
    // The two AADs differ ONLY in the trailing label…
    expect(entry.expected.aadsDifferOnlyInTheTrailingLabel).toBe(true);
    const sender = fixtureBytes(entry.expected.senderAad);
    const receiver = fixtureBytes(entry.expected.receiverAad);
    expect(hex(sender.subarray(0, sender.byteLength - 3))).toBe(
      hex(receiver.subarray(0, receiver.byteLength - 3)),
    );
    expect(hex(sender)).not.toBe(hex(receiver));
    // …and the label is separately bound into the §9.4 key schedule.
    expect(entry.expected.aeadKeysAlsoDifferByDirection).toBe(true);
  });

  it("gives a control record the next pair of the same directional sequence", () => {
    const entry = caseByName(F08, "control-record-consumes-the-shared-sequence");
    expect(entry.expected.firstPosition).toEqual({ epoch: 0, counter: 0 });
    expect(entry.expected.secondPosition).toEqual({ epoch: 0, counter: 1 });
    expect(entry.expected.controlRecordCountedTowardTheEpoch).toBe(true);
  });
});

describe("§16.3 F9 rekey boundaries (§9.4–§9.6)", () => {
  it("re-derives the epoch schedule from each case's own epoch-0 secret", () => {
    for (const entry of casesMatching(F09, /^epoch-key-schedule-/)) {
      const direction = entry.inputs.direction as E2eeDirection;
      let secret = fixtureBytes(entry.inputs.epochSecretZero);
      for (const epoch of entry.expected.epochs as readonly JsonRecord[]) {
        expect(hex(secret), `${entry.name} e${String(epoch.epoch)}`).toBe(
          hex(fixtureBytes(epoch.epochSecret)),
        );
        const derived = deriveE2eeEpochKeys(secret, direction);
        expect(hex(derived.aeadKey), `${entry.name} e${String(epoch.epoch)}`).toBe(
          hex(fixtureBytes(epoch.aeadKey)),
        );
        expect(hex(derived.nextEpochSecret), `${entry.name} e${String(epoch.epoch)}`).toBe(
          hex(fixtureBytes(epoch.nextEpochSecret)),
        );
        // §9.4 spells the AEAD key out on its own, and both spellings agree.
        expect(hex(deriveE2eeAeadKey(secret, direction))).toBe(hex(derived.aeadKey));
        secret = derived.nextEpochSecret;
      }
    }
  });

  it("makes the threshold record the last of its epoch and its successor the first of e+1", () => {
    for (const [name, key] of [
      ["record-count-threshold-boundary", "boundaryRecord"],
      ["byte-threshold-crossing", "crossingRecord"],
    ] as const) {
      const entry = caseByName(F09, name);
      const boundary = entry.expected[key] as JsonRecord;
      const successor = entry.expected.successorRecord as JsonRecord;
      expect(boundary.epochCompleted, name).toBe(true);
      const boundaryPosition = position(boundary.position);
      expect(nextE2eeSequencePosition(boundaryPosition, true), name).toEqual(
        position(successor.position),
      );
      expect((successor.position as JsonRecord).counter, name).toBe(0);
      expect(successor.epochCompleted, name).toBe(false);
    }
    expect(caseByName(F09, "record-count-threshold-boundary").inputs.rekeyMaxRecords).toBe(
      E2EE_REKEY_MAX_RECORDS,
    );
  });

  it("treats every early, late, and skipped rekey as one §9.2 comparison", () => {
    for (const entry of casesMatching(F09, /-epoch-transition$/)) {
      expect((entry.expected.received as JsonRecord).reason, entry.name).toBe("sequence_mismatch");
      expect(entry.expected.ciphertextDecrypted, entry.name).toBe(false);
      expect(entry.expected.attributable, entry.name).toBe(false);
    }
  });

  it("spends the §9.6 reserve exactly as §10.2 assigns the roles", () => {
    const reserve = caseByName(F09, "post-application-reserve-composition").expected;
    expect(reserve.postApplicationReserveRecords).toBe(E2EE_POST_APPLICATION_RESERVE_RECORDS);
    expect(reserve.reserveRecordsMatchTheTwoHalves).toBe(true);
    expect((reserve.postApplicationReservePlaintextBytes as readonly number[]).length).toBe(
      E2EE_CLOSE_RECORDS_RESERVED + E2EE_ERROR_RECORDS_RESERVED,
    );

    const sequential = caseByName(
      F09,
      "terminal-epoch-sequential-close-out-of-the-close-reserve",
    ).expected;
    // The initiator spends both close-machine records; the responder spends one
    // and leaves the remainder of its reserve unused, which is §9.6's slack.
    expect(sequential.initiatorRecordsSpent).toBe(E2EE_CLOSE_RECORDS_RESERVED);
    expect(sequential.responderRecordsSpent).toBe(1);
    expect(sequential.initiatorVerdict).toBe("clean");
    expect(sequential.responderVerdict).toBe("clean");

    const simultaneous = caseByName(
      F09,
      "terminal-epoch-simultaneous-close-out-of-the-close-reserve",
    ).expected;
    expect(simultaneous.initiatorRecordsSpent).toBe(E2EE_CLOSE_RECORDS_RESERVED);
    expect(simultaneous.responderRecordsSpent).toBe(E2EE_CLOSE_RECORDS_RESERVED);
    for (const name of [
      "terminal-epoch-sequential-close-out-of-the-close-reserve",
      "terminal-epoch-simultaneous-close-out-of-the-close-reserve",
    ]) {
      expect(caseByName(F09, name).expected.wrapped, name).toBe(false);
      expect(caseByName(F09, name).expected.reused, name).toBe(false);
    }
  });

  it("ends a direction at the counter ceiling exactly as it ends one at the last epoch", () => {
    // §9.6's first sentence names TWO exhaustion conditions — "reaching
    // `E2EE_COUNTER_MAX` within an epoch, or completing epoch `E2EE_EPOCH_MAX`".
    // The cases above are the second. These are the first, over the same three
    // §10.2 roles, so neither half of that sentence rests on the other.
    const sequential = caseByName(
      F09,
      "counter-exhaustion-sequential-close-out-of-the-close-reserve",
    );
    const simultaneous = caseByName(
      F09,
      "counter-exhaustion-simultaneous-close-out-of-the-close-reserve",
    );

    for (const entry of [sequential, simultaneous]) {
      const records = entry.expected.records as readonly JsonRecord[];
      expect(entry.inputs.exhaustionCause, entry.name).toBe("counter-ceiling");
      expect(BigInt(entry.inputs.counterMax as string), entry.name).toBe(E2EE_COUNTER_MAX);
      // Nothing about this state completes an epoch: the epoch is live and below
      // `E2EE_EPOCH_MAX` throughout, so the counter ceiling is the only cause.
      expect(entry.expected.recordsThatCompletedAnEpoch, entry.name).toBe(0);
      for (const record of records) {
        expect(record.epochCompleted, `${entry.name} ${String(record.purpose)}`).toBe(false);
        const at = position(record.position);
        expect(at.epoch, `${entry.name} ${String(record.purpose)}`).toBe(0n);
        expect(at.epoch < BigInt(entry.inputs.epochMax as number)).toBe(true);
        expect(at.counter <= E2EE_COUNTER_MAX).toBe(true);
      }
      // Every position is distinct within its direction: no wrap, no reuse.
      for (const direction of [E2EE_DIRECTION_CLIENT_TO_NODE, E2EE_DIRECTION_NODE_TO_CLIENT]) {
        const spent = records
          .filter((record) => record.senderDirection === direction)
          .map((record) => String(position(record.position).counter));
        expect(new Set(spent).size, `${entry.name} ${direction}`).toBe(spent.length);
      }
      expect(entry.expected.wrapped, entry.name).toBe(false);
      expect(entry.expected.reused, entry.name).toBe(false);
      expect(entry.expected.initiatorVerdict, entry.name).toBe("clean");
      expect(entry.expected.responderVerdict, entry.name).toBe("clean");
      // The close is protected entirely out of the close half of the reserve.
      expect(entry.expected.initiatorRecordsSpent, entry.name).toBe(E2EE_CLOSE_RECORDS_RESERVED);
      // §9.6 scopes the RESERVE predicate to the two §9.4 thresholds within
      // epoch `E2EE_EPOCH_MAX`; the ceiling here is neither, which is why fewer
      // than the reserve of positions remain while the predicate still holds.
      expect(
        (entry.inputs.positionsRemainingBeforeTheCeiling as number) <
          (entry.inputs.postApplicationReserveRecords as number),
        entry.name,
      ).toBe(true);
    }

    // The initiator ends AT the ceiling, with no next position at all.
    const initiator = sequential.expected.initiatorSendState as JsonRecord;
    expect(sequential.expected.initiatorExhaustedAtTheCeiling).toBe(true);
    expect(initiator.exhausted).toBe(true);
    expect(initiator.epoch).toBeNull();
    expect(initiator.counter).toBeNull();
    // …and the sequential responder spends ONE record and leaves the rest of
    // its reserve unused, which is §9.6's intended slack, restated at the other
    // exhaustion condition.
    expect(sequential.expected.responderRecordsSpent).toBe(1);
    expect(sequential.expected.responderExhaustedAtTheCeiling).toBe(false);
    expect(BigInt((sequential.expected.responderSendState as JsonRecord).counter as string)).toBe(
      E2EE_COUNTER_MAX,
    );
    // Each side of a simultaneous close spends both, so both directions end.
    expect(simultaneous.expected.responderRecordsSpent).toBe(E2EE_CLOSE_RECORDS_RESERVED);
    expect(simultaneous.expected.initiatorExhaustedAtTheCeiling).toBe(true);
    expect(simultaneous.expected.responderExhaustedAtTheCeiling).toBe(true);

    // Every close-machine body is rebuilt from its own declared fields, at the
    // ceiling exactly as anywhere else — the §10.1 encoder takes a `bigint`.
    const sessionBindingHash = fixtureBytes(
      caseByName(F11, "sequential-clean-close").inputs.sessionBindingHash,
    );
    for (const entry of [sequential, simultaneous]) {
      for (const record of entry.expected.records as readonly JsonRecord[]) {
        const input = {
          innerType: record.innerType as E2eeCloseRecordType,
          senderDirection: record.senderDirection as E2eeDirection,
          sessionBindingHash,
          finalSend: position(record.declaredFinalSend),
          expectedRecv: position(record.declaredExpectedRecv),
        };
        const label = `${entry.name} ${String(record.purpose)} ${String(record.senderDirection)}`;
        expect(hex(encodeE2eeCloseRecordBody(input)), label).toBe(hex(fixtureBytes(record.body)));
        expect(hex(e2eeCloseCommitment(input)), label).toBe(
          hex(fixtureBytes(record.closeCommitment)),
        );
        expect(record.declaredFinalSend, label).toEqual(record.position);
      }
    }
  });

  it("holds the error reserve beyond the close reserve, and degrades without wrapping", () => {
    const held = caseByName(F09, "terminal-epoch-error-record-out-of-the-error-reserve").expected;
    expect((held.strayVerdict as JsonRecord).row).toBe("Q7");
    expect((held.errorRecord as JsonRecord).kind).toBe("protected");
    expect(held.errorRecordsOnTheWire).toBe(1);
    expect(held.closeMachineRecordsSent).toBe(E2EE_CLOSE_RECORDS_RESERVED);
    expect(held.thirdCloseMachineRecordSent).toBe(false);
    expect(held.wrapped).toBe(false);
    expect(held.reused).toBe(false);
    expect((held.observable as JsonRecord).lengthUniformEncryptedRecords).toBe(1);

    const short = caseByName(F09, "terminal-epoch-error-record-without-capacity").expected;
    expect((short.errorRecord as JsonRecord).kind).toBe("exhausted");
    expect(short.errorRecordsOnTheWire).toBe(0);
    expect(short.wrapped).toBe(false);
    expect((short.observable as JsonRecord).lengthUniformEncryptedRecords).toBe(0);

    const degenerate = caseByName(
      F09,
      "degenerate-state-below-the-post-application-reserve",
    ).expected;
    expect(degenerate.postApplicationReserveHeld).toBe(false);
    expect((degenerate.applicationRecord as JsonRecord).kind).toBe("close_required");
    expect(degenerate.applicationRecordsOnTheWire).toBe(0);
    expect(degenerate.closeAnchor).toBeNull();
    expect(degenerate.closeAnchorUnavailable).toBe(true);
    expect(degenerate.initiatorVerdict).toBe("unclean_abrupt");
    expect(degenerate.furtherRecordsOnTheWire).toBe(0);
  });
});

describe("§16.3 F11 authenticated close (§10)", () => {
  /** The four F11 cases that carry a record list, pinned so none can vanish. */
  const casesWithRecords = new Set(carrying(F11.cases, "records", 4).map((entry) => entry.name));
  const closeRecords = (name: string): readonly JsonRecord[] => {
    expect(casesWithRecords.has(name), `${name} must carry expected.records`).toBe(true);
    return caseByName(F11, name).expected.records as readonly JsonRecord[];
  };

  it("rebuilds every close-machine body and commitment from its own declared fields", () => {
    for (const name of [
      "sequential-clean-close",
      "simultaneous-close-passing",
      "close-anchor-across-an-epoch-boundary",
    ]) {
      const sessionBindingHash = fixtureBytes(
        caseByName(F11, "sequential-clean-close").inputs.sessionBindingHash,
      );
      for (const record of closeRecords(name)) {
        const label = `${name} ${String(record.purpose)} ${String(record.senderDirection)}`;
        const input = {
          innerType: record.innerType as E2eeCloseRecordType,
          senderDirection: record.senderDirection as E2eeDirection,
          sessionBindingHash,
          finalSend: position(record.declaredFinalSend),
          expectedRecv: position(record.declaredExpectedRecv),
        };
        // Every record is rebuilt from its own declared fields: the §10.1 body,
        // the commitment, and the commitment preimage.
        expect(hex(encodeE2eeCloseRecordBody(input)), label).toBe(hex(fixtureBytes(record.body)));
        expect(hex(e2eeCloseCommitment(input)), label).toBe(
          hex(fixtureBytes(record.closeCommitment)),
        );
        expect(hex(encodeE2eeCloseCommitmentPreimage(input)), label).toBe(
          hex(fixtureBytes(record.commitmentPreimage)),
        );
        // §10.1: fields 0–1 equal the carrying envelope's own header fields.
        expect(record.declaredFinalSend, label).toEqual(record.position);
      }
    }
    expect(caseByName(F11, "sequential-clean-close").inputs.closeCommitmentDomain).toBe(
      E2EE_CLOSE_COMMITMENT_DOMAIN,
    );
  });

  it("pins the §16.3 F11 simultaneous table exactly", () => {
    const passing = caseByName(F11, "simultaneous-close-passing").expected;
    expect(passing.initiatorAnchor).toEqual({ epoch: 0, counter: 8 });
    expect(passing.responderAnchor).toEqual({ epoch: 0, counter: 5 });
    expect(passing.bothVerdictsClean).toBe(true);
    const wire = closeRecords("simultaneous-close-passing").map((record) => [
      record.purpose,
      record.position,
      record.declaredExpectedRecv,
    ]);
    expect(wire).toEqual([
      ["close", { epoch: 0, counter: 7 }, { epoch: 0, counter: 4 }],
      ["close", { epoch: 0, counter: 4 }, { epoch: 0, counter: 7 }],
      ["close_ack", { epoch: 0, counter: 8 }, { epoch: 0, counter: 5 }],
      ["close_ack", { epoch: 0, counter: 5 }, { epoch: 0, counter: 8 }],
    ]);

    // The negative: an ack declaring the validator's CURRENT next-send.
    const negative = caseByName(F11, "simultaneous-close-ack-declaring-current-next-send");
    expect(negative.inputs.declaredExpectedRecv).toEqual({ epoch: 0, counter: 9 });
    expect(negative.inputs.initiatorAnchor).toEqual({ epoch: 0, counter: 8 });
    expect(negative.expected.initiatorVerdict).toBe("failed");
    expect(negative.expected.acceptingItIsTheDisallowedReading).toBe(true);
    // Re-derived: the strict rule reads the ANCHOR, and this record fails it.
    const crafted = closeRecords("simultaneous-close-ack-declaring-current-next-send").find(
      (record) => record.nonConforming === true,
    )!;
    expect(
      validateE2eeCloseRecord({
        innerType: crafted.innerType as E2eeCloseRecordType,
        body: fixtureBytes(crafted.body),
        envelope: position(crafted.position),
        sessionBindingHash: fixtureBytes(
          caseByName(F11, "sequential-clean-close").inputs.sessionBindingHash,
        ),
        senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
        currentNextSend: { epoch: 0n, counter: 9n },
        closeAnchor: position(negative.inputs.initiatorAnchor),
      }),
    ).toEqual({ kind: "invalid", reason: "strict_rule" });
  });

  it("advances the close anchor across an epoch boundary and rejects counter + 1", () => {
    const accepted = caseByName(F11, "close-anchor-across-an-epoch-boundary").expected;
    expect(accepted.initiatorAnchor).toEqual({ epoch: 1, counter: 0 });
    expect(accepted.anchorIsTheEpochAdvance).toBe(true);
    expect(accepted.initiatorVerdict).toBe("clean");
    expect(accepted.responderVerdict).toBe("clean");
    const negative = caseByName(
      F11,
      "close-anchor-across-an-epoch-boundary-declaring-counter-plus-one",
    );
    expect(negative.inputs.declaredExpectedRecv).toEqual({
      epoch: 0,
      counter: E2EE_REKEY_MAX_RECORDS,
    });
    expect((negative.expected.received as JsonRecord).row).toBe("Q7");
    expect((negative.expected.received as JsonRecord).reason).toBe("strict_rule");
  });

  it("separates the two readings §10.2 left open, in both directions", () => {
    const beyond = caseByName(F11, "envelope-beyond-the-machines-expectation").expected;
    expect((beyond.received as JsonRecord).row).toBe("Q7");
    expect(beyond.verdict).toBe("failed");
    expect(beyond.verdictIsNotUncleanAbrupt).toBe(true);
    expect(beyond.errorRecordEmitted).toBe(true);
    expect((beyond.secondErrorRecord as JsonRecord).kind).toBe("unavailable");
    expect(beyond.secondErrorRecordsOnTheWire).toBe(0);

    const peer = caseByName(F11, "peer-terminal-error-after-a-completed-exchange").expected;
    expect((peer.received as JsonRecord).kind).toBe("terminal_error");
    expect(peer.isQ7).toBe(false);
    expect(peer.verdict).toBe("failed");
    expect(peer.replyRecordsOnTheWire).toBe(0);
    expect(peer.secretsErased).toBe(true);

    for (const entry of casesMatching(F11, /-during-the-close-phase$/)) {
      expect(entry.expected.fatal, entry.name).toBe("Q6");
      expect(entry.expected.verdict, entry.name).toBe("failed");
      expect(entry.expected.closePhaseGrantsNoExemption, entry.name).toBe(true);
      expect(classifyPostStripPayload(fixtureBytes(entry.inputs.payload)).kind, entry.name).toBe(
        (entry.expected.step2Discrimination as JsonRecord).class,
      );
    }

    for (const entry of casesMatching(F11, /^t-close-expiry-/)) {
      expect(entry.expected.verdict, entry.name).toBe("unclean_abrupt");
      expect(entry.expected.wireRecordsEmitted, entry.name).toBe(0);
    }
    expect(
      caseByName(F11, "t-close-expiry-sequential-initiator").expected.waitDeadlineOffsetFromRecord,
    ).toBe(T_CLOSE);

    const precedence = caseByName(F11, "incomplete-reassembly-with-a-q7-violation").expected;
    expect(precedence.verdictAtChannelEnd).toBe("failed");
    expect(precedence.isNotUncleanTruncation).toBe(true);
    const truncation = caseByName(F11, "truncation-at-close").expected;
    expect(truncation.verdictAtExchangeCompletion).toBe("clean");
    expect(truncation.verdictAtChannelEnd).toBe("unclean_truncation");
  });

  it("keeps every keepalive out of the close phase, and bounds the phase by §3.2.2 L5", () => {
    const keepalive = caseByName(
      F11,
      "no-keepalive-ping-after-the-first-close-machine-record",
    ).expected;
    expect(keepalive.mayProtectApplicationRecord).toBe(false);
    expect((keepalive.conformingKeepaliveAttempt as JsonRecord).reason).toBe(
      "application_phase_closed",
    );
    expect(keepalive.conformingKeepaliveRecordsOnTheWire).toBe(0);
    expect(keepalive.keepaliveDiscardedNotBuffered).toBe(true);
    expect((keepalive.strayPingAtResponder as JsonRecord).row).toBe("Q7");
    // Every role, not only the initiator (§10.2, §3.2.2 L5).
    for (const role of ["sequentialResponderRole", "simultaneousRole"] as const) {
      const view = keepalive[role] as JsonRecord;
      expect(view.mayProtectApplicationRecord, role).toBe(false);
      expect((view.keepaliveAttempt as JsonRecord).reason, role).toBe("application_phase_closed");
      expect(view.keepaliveRecordsOnTheWire, role).toBe(0);
    }
    const past = keepalive.ackDeclaringPastTheAnchor as JsonRecord;
    expect((past.received as JsonRecord).reason).toBe("strict_rule");
    expect(past.initiatorVerdict).toBe("failed");
    expect(caseByName(F11, "sequential-clean-close").expected.keepalivePingRecordsOnTheWire).toBe(
      0,
    );

    const timed = caseByName(F11, "late-simultaneous-phase-duration").expected;
    expect(timed.waitsArmed).toBe(2);
    expect(timed.deadlineUnchangedByTheSimultaneousTransition).toBe(true);
    expect(timed.firstWaitDeadlineOffset).toBe(T_CLOSE);
    expect(timed.verdict).toBe("clean");
    expect(timed.phaseBound).toBe(2 * T_CLOSE + T_CLOSE_LINGER_MAX);
    expect(timed.withinPhaseBound).toBe(true);
    expect(timed.totalPhaseMilliseconds as number).toBeLessThanOrEqual(timed.phaseBound as number);
    expect(2 * T_CLOSE + T_CLOSE_LINGER_MAX + T_KEEPALIVE_FLUSH_MARGIN).toBeLessThanOrEqual(
      RPC_KEEPALIVE_INTERVAL,
    );
  });

  it("rejects every §10.1 receiver-check violation the family carries", () => {
    for (const [name, reason] of [
      ["passed-through-rule-violation", "passed_through_rule"],
      ["commitment-mismatch", "commitment_mismatch"],
      ["malformed-close-body", "malformed_body"],
      ["strict-rule-violation", "strict_rule"],
    ] as const) {
      const entry = caseByName(F11, name);
      expect((entry.expected.received as JsonRecord).reason, name).toBe(reason);
      expect((entry.expected.received as JsonRecord).row, name).toBe("Q7");
    }
  });
});

describe("§16.3 F12 error records (§11)", () => {
  it("reproduces the reject record and its byte-identity across causes", () => {
    const reject = caseByName(F12, "handshake-reject-record");
    const bytes = fixtureBytes(reject.expected.record);
    expect(hex(encodeE2eeHandshakeReject())).toBe(hex(bytes));
    expect(bytes.byteLength).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
    expect(decodeE2eeNegotiationRecord(bytes).kind).toBe("ok");
    expect((reject.expected.onePaddingBitFlipped as JsonRecord).rejected).toBe(true);

    const causes = casesMatching(F12, /^handshake-reject-is-byte-identical-for-/);
    expect(causes.length).toBe(4);
    for (const entry of causes) {
      const observable = entry.expected.observable as JsonRecord;
      expect(hex(fixtureBytes(observable.handshakeReject)), entry.name).toBe(hex(bytes));
      expect(observable.handshakeRejectRecords, entry.name).toBe(1);
      expect(observable.closeReason, entry.name).toBe("channel_rejected");
      expect(observable.applicationPayloadBytes, entry.name).toBe(0);
      expect(entry.expected.disposition, entry.name).toBe("FATAL-PRE");
    }
    const summary = caseByName(F12, "handshake-reject-bytes-do-not-vary-by-cause").expected;
    expect(summary.allCausesProduceIdenticalBytes).toBe(true);
    // The §11.2 ROWS differ and that is a local diagnostic; the wire does not.
    expect(new Set(summary.rows as readonly string[]).size).toBeGreaterThan(1);
    expect(hex(fixtureBytes(summary.record))).toBe(hex(bytes));

    // The node-side companions take the identical observable.
    for (const entry of casesMatching(F12, /^node-side-companion-/)) {
      expect(entry.expected.row, entry.name).toBe("P9");
      expect(
        hex(fixtureBytes((entry.expected.observable as JsonRecord).handshakeReject)),
        entry.name,
      ).toBe(hex(bytes));
    }
  });

  it("re-encodes every §11.3 error body and keeps the envelopes length-identical", () => {
    for (const entry of casesMatching(F12, /^error-record-/)) {
      const code = entry.inputs.errorCode as 1 | 2 | 3;
      expect(hex(encodeE2eeErrorRecordBody(code)), entry.name).toBe(
        hex(fixtureBytes(entry.expected.body)),
      );
      expect(entry.expected.decodedErrorCode, entry.name).toBe(code);
    }
    const uniform = caseByName(F12, "every-error-envelope-is-length-identical").expected;
    expect(uniform.allLengthsIdentical).toBe(true);
    expect(new Set(uniform.envelopeBytes as readonly number[]).size).toBe(1);
  });
});

describe("§16.3 F16 authorization context and Branch A enforcement (§8.3, §13.6)", () => {
  it("recomputes the commitment of every context block the family carries", () => {
    for (const entry of casesMatching(F16, /^authorization-context-block-/)) {
      const block = fixtureBytes(entry.expected.contextBlock);
      expect(hex(e2eeAuthorizationContextCommitment(block)), entry.name).toBe(
        hex(fixtureBytes(entry.expected.contextCommitment)),
      );
      expect(entry.expected.commitmentIsSha256OfTheBlock, entry.name).toBe(true);
      const elements = entry.expected.elements as JsonRecord;
      expect(elements.elementCount, entry.name).toBe(18);
      // §8.3 absence semantics: elements 10 and 16 are the ONLY tier-dependent ones.
      if (entry.inputs.tier === "web") {
        expect(elements.accountId, entry.name).toBe("");
        expect(elements.clientCertificateFingerprints, entry.name).toEqual([]);
      } else {
        expect(elements.accountId, entry.name).not.toBe("");
        expect((elements.clientCertificateFingerprints as readonly unknown[]).length).toBe(2);
      }
      // Element 17 has no absence form on either tier.
      expect(elements.nodeContinuityId, entry.name).not.toBe("");
    }
  });

  it("makes every single-element mutation a P13 with the same observable", () => {
    const mutations = F16.cases.filter((entry) => entry.expected.row === "P13");
    expect(mutations.length).toBeGreaterThanOrEqual(9);
    for (const entry of mutations) {
      expect(entry.expected.reason, entry.name).toBe("context_mismatch");
      expect(entry.expected.disposition, entry.name).toBe("FATAL-PRE");
      // The commitment carried with each mutated block is the block's own.
      if (entry.name !== "commitment-over-different-bytes-than-the-block") {
        expect(
          hex(e2eeAuthorizationContextCommitment(fixtureBytes(entry.inputs.contextBlock))),
          entry.name,
        ).toBe(hex(fixtureBytes(entry.inputs.contextCommitment)));
      }
    }
    // §16.3 F16: element 17 is run twice, and only the never-rotated run
    // isolates it — a max-depth chain binds the id through element 15 as well.
    const neverRotated = caseByName(
      F16,
      "element-17-continuity-id-substitution-never-rotated-node",
    ).expected;
    expect(neverRotated.element15CarriesNoChainDigest).toBe(true);
    expect(neverRotated.element15EntryCount).toBe(1);
    expect(
      (neverRotated.acceptedByANodeWhoseStoredContinuityIdIsTheSubstitutedOne as JsonRecord).kind,
    ).toBe("accepted");
    const maxChain = caseByName(
      F16,
      "element-17-continuity-id-substitution-max-length-chain",
    ).expected;
    expect(maxChain.element15CarriesNoChainDigest).toBe(false);
    expect(maxChain.element15EntryCount as number).toBeGreaterThan(1);
  });

  it("breaks the confirmation when the suite list is stripped after the hello was hashed", () => {
    // §8.7 hashes the EXACT hello wire bytes precisely so this is detectable:
    // every node-side check passes — the stripped list still contains the
    // selected suite — so the node's `confirmationTranscript` covers the
    // stripped bytes while the client's covers the original.
    //
    // The client is rebuilt from this family's own §16.1 material, so the hello
    // it emits is compared BYTE FOR BYTE against the one the case carries before
    // the case's own `E2EEServerAccept` is fed to it. Without that equality the
    // verdict below would be a property of some other handshake.
    const entry = caseByName(F16, "suite-list-strip-after-the-hello-was-hashed");
    const material = F16.testKeyMaterial;
    const identifiers = material.identifiers as JsonRecord;
    const timestamps = material.timestamps as JsonRecord;
    const channel = material.channel as JsonRecord;
    const prekeyTranscript = encodeClientE2eePrekeyTranscript({
      hubOrigin: identifiers.hubOrigin as string,
      accountId: identifiers.accountId as string,
      identityPublicKey: fixtureBytes(material.clientIdentityPublicKey),
      agreementPublicKey: fixtureBytes(material.clientAgreementPublicKey),
      createdAt: timestamps.createdAt as number,
      expiresAt: timestamps.expiresAt as number,
    });
    const client = new E2eeClientHandshake({
      channel: {
        hubOrigin: identifiers.hubOrigin as string,
        channelId: channel.channelId as string,
        relayProtocolMajor: channel.relayProtocolMajor as number,
        relayProtocolMinor: channel.relayProtocolMinor as number,
        channelOpenCapability: channel.channelOpenCapability as string,
        channelOpenEffectiveRole: channel.channelOpenEffectiveRole as string,
      },
      advertised: {
        nodeId: identifiers.nodeId as string,
        nodeIdentityFingerprint: fixtureBytes(material.nodeIdentityFingerprint),
        prekeyId: identifiers.prekeyId as string,
        agreementPublicKey: fixtureBytes(material.nodeAgreementPublicKey),
        continuityChainTranscripts: [],
        continuityId: identifiers.continuityId as string,
      },
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: entry.inputs.offeredSuitesAsSent as readonly number[],
      credentials: {
        tier: "native",
        accountId: identifiers.accountId as string,
        identityPublicKey: fixtureBytes(material.clientIdentityPublicKey),
        agreementPublicKey: fixtureBytes(material.clientAgreementPublicKey),
        agreementSecretKey: fixtureBytes(material.testOnlyClientAgreementSecretKey),
        prekeyTranscript,
        prekeySignature: p256.sign(
          sha256(prekeyTranscript),
          fixtureBytes(material.testOnlyClientIdentitySecretKey),
          {
            prehash: false,
            lowS: false,
            format: "compact",
          },
        ),
      },
      intendedCapability: channel.channelOpenCapability as string,
      intendedRole: channel.channelOpenEffectiveRole as string,
      testOnlyClientNonce: fixtureBytes(material.testOnlyClientNonce),
      testOnlyEphemeralSecretKey: fixtureBytes(material.testOnlyClientEphemeralSecretKey),
    });
    const hello = client.createHello(timestamps.now as number);
    expect(hello.kind).toBe("hello");
    if (hello.kind !== "hello") throw new Error("expected a hello");
    expect(hex(hello.record)).toBe(hex(fixtureBytes(entry.inputs.clientHelloAsSent)));
    // The mutation is confined to the clear wrapper: `noiseMessage1` is
    // untouched, which is why every node-side check passes.
    expect((entry.inputs.offeredSuitesAsDelivered as readonly number[]).length).toBe(
      (entry.inputs.offeredSuitesAsSent as readonly number[]).length - 1,
    );
    expect(hex(fixtureBytes(entry.inputs.clientHelloAsDelivered))).not.toBe(hex(hello.record));
    expect(entry.expected.nodeAccepted).toBe(true);

    const verdict = client.receiveServerAccept(
      fixtureBytes(entry.expected.serverAccept),
      timestamps.now as number,
    );
    const expectedVerdict = entry.expected.clientVerdict as JsonRecord;
    expect(verdict.kind).toBe(expectedVerdict.kind);
    if (verdict.kind !== "fatal") throw new Error("expected the confirmation to fail");
    expect(verdict.row).toBe(expectedVerdict.row);
    expect(verdict.reason).toBe(expectedVerdict.reason);
    // §11.2: a client executing FATAL-PRE sends nothing and closes.
    expect(entry.expected.disposition).toBe("FATAL-PRE");
    expect(entry.expected.clientEmitsNoRecord).toBe(true);
    expect(entry.expected.closeReason).toBe("channel_rejected");
  });

  it("builds the node's own elements from the advertised snapshot, never its current state", () => {
    for (const name of [
      "identity-rotation-between-advertisement-and-hello",
      "identity-rotation-at-max-chain-length-prunes-the-oldest-entry",
    ]) {
      const entry = caseByName(F16, name).expected;
      expect((entry.againstTheAdvertisedSnapshot as JsonRecord).kind, name).toBe("accepted");
      expect((entry.againstTheNodesCurrentState as JsonRecord).row, name).toBe("P13");
    }
    const pruned = caseByName(
      F16,
      "identity-rotation-at-max-chain-length-prunes-the-oldest-entry",
    ).expected;
    expect(pruned.prunedEntryDigestStillPresentInElement15).toBe(true);
    const prekey = caseByName(F16, "prekey-rotation-between-advertisement-and-hello").expected;
    expect(prekey.element15EntryZeroIsTheAdvertisedAgreementFingerprint).toBe(true);
    expect(prekey.rotatedContextDiffers).toBe(true);
    expect((prekey.againstTheAdvertisedSnapshot as JsonRecord).kind).toBe("accepted");
    expect(
      (caseByName(F16, "next-channel-carries-the-new-material").expected.accepted as JsonRecord)
        .kind,
    ).toBe("accepted");
  });

  it("gives all five Branch A record states one row and one observable", () => {
    const records = casesMatching(F16, /^branch-a-record-/);
    expect(records.length).toBe(5);
    const reject = hex(
      fixtureBytes(
        caseByName(F12, "handshake-reject-record").expected.record as FixtureBytes as unknown,
      ),
    );
    for (const entry of records) {
      expect(entry.expected.row, entry.name).toBe("P12");
      expect(entry.expected.disposition, entry.name).toBe("FATAL-PRE");
      const observable = entry.expected.observable as JsonRecord;
      expect(hex(fixtureBytes(observable.handshakeReject)), entry.name).toBe(reject);
    }
    // The in-flight abort takes the same generic reject and never a policy code.
    const inFlight = caseByName(F16, "withdrawal-between-step-6-and-row-n3").expected;
    expect(inFlight.row).toBe("P12");
    expect(inFlight.errorCodeEmitted).toBeNull();
    expect(hex(fixtureBytes((inFlight.observable as JsonRecord).handshakeReject))).toBe(reject);
  });

  it("re-runs the §13.6 withdrawal test from each case's own snapshot and record", () => {
    for (const entry of F16.cases) {
      const snapshot = entry.inputs.admittedAuthoritySnapshot as JsonRecord | undefined;
      if (snapshot === undefined) continue;
      const changed = entry.inputs.changedRecordKey as JsonRecord;
      const record = entry.inputs.postChangeRecord as JsonRecord | null;
      const authority = {
        status: snapshot.status as "approved",
        maxRole: snapshot.maxRole as string,
        capabilitySet: snapshot.capabilitySet as readonly string[],
      };
      const keysEqual = e2eeAuthorizationKeysEqual(
        {
          hubOrigin: snapshot.hubOrigin as string,
          accountId: snapshot.accountId as string,
          clientIdentityFingerprint: fixtureBytes(snapshot.clientIdentityFingerprint),
        },
        {
          hubOrigin: changed.hubOrigin as string,
          accountId: changed.accountId as string,
          clientIdentityFingerprint: fixtureBytes(changed.clientIdentityFingerprint),
        },
      );
      expect(keysEqual, entry.name).toBe(entry.expected.recordKeyMatches);
      const withdrawn =
        keysEqual &&
        e2eeAuthorizationWithdrawn(
          authority,
          record === null
            ? undefined
            : {
                status: record.status as "approved" | "pending" | "revoked",
                maxRole: record.maxRole as string,
                capabilitySet: record.capabilitySet as readonly string[],
              },
        );
      expect(withdrawn, entry.name).toBe(entry.expected.withdrawn);
      const finish = entry.expected.implicitFinish as JsonRecord;
      if (withdrawn) {
        expect(finish, entry.name).toEqual({
          kind: "fatal",
          row: "Q9",
          errorCode: "policy",
          reason: "authorization_withdrawn",
        });
      } else {
        expect(finish, entry.name).toEqual({ kind: "finished" });
        expect(entry.expected.channelStaysOpen, entry.name).toBe(true);
      }
    }
    // A status-only re-check is exactly what the test exists to defeat.
    for (const entry of casesMatching(F16, /^withdrawal-max-role-owner-to-viewer-/)) {
      expect(entry.expected.statusStillApproved, entry.name).toBe(true);
      expect(entry.expected.aStatusOnlyRecheckWouldPassIt, entry.name).toBe(true);
      expect(entry.expected.withdrawn, entry.name).toBe(true);
    }
    // NX carries no snapshot, so nothing is re-read and nothing is swept.
    const nx = caseByName(
      F16,
      "nx-channel-is-never-matched-by-an-authorization-withdrawal",
    ).expected;
    expect(nx.admittedAuthority).toBeNull();
    expect(nx.reReadInvocations).toBe(0);
    expect(nx.channelStaysOpen).toBe(true);
  });
});

describe("§16.3 F2 carrier compatibility (§5.5, §5.6)", () => {
  it("re-runs C1 through the assembler and C6 through a JSON parser", () => {
    for (const entry of casesMatching(F02, /^c1-carrier-reassembly-/)) {
      const payload = fixtureBytes(entry.inputs.wirePayload);
      expect(isChunkedPayload(payload), entry.name).toBe(false);
      const assembler = new RelayMessageAssembler();
      const pushed = assembler.push(payload);
      expect(pushed.kind, entry.name).toBe("done");
      if (pushed.kind !== "done") continue;
      expect(hex(pushed.message), entry.name).toBe(hex(fixtureBytes(entry.expected.reassembled)));
      expect(assembler.peerSupportsChunking, entry.name).toBe(entry.inputs.preludePresent);
      expect(entry.expected.reassembledEqualsTheCarrier, entry.name).toBe(true);
      expect(classifyPostStripPayload(pushed.message).kind, entry.name).toBe("legacy-json");
    }

    const c6 = caseByName(F02, "c6-prelude-whitespace-tolerance");
    expect(hex(fixtureBytes(c6.inputs.prelude))).toBe(hex(RELAY_CHUNK_CAPABILITY_PRELUDE));
    expect(c6.expected.preludeBytesAreAllJsonWhitespace).toBe(true);
    const unstripped = new TextDecoder().decode(fixtureBytes(c6.inputs.unstrippedPayload));
    expect(JSON.stringify(JSON.parse(unstripped) as unknown)).toBe(c6.expected.parsedWithPrelude);
    expect(c6.expected.identicalObject).toBe(true);
    expect(c6.expected.carrierTag).toBe(E2EE_CAPABILITY_CARRIER_TAG);
  });

  it("emits the maximum carrier unchunked with the prelude at the advertisement floor", () => {
    const entry = caseByName(F02, "maximum-carrier-at-the-advertisement-floor");
    expect(entry.inputs.assertedMaxDataChunkBytes).toBe(E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES);
    expect(entry.expected.chunked).toBe(false);
    expect(entry.expected.preludePresent).toBe(true);
    expect(entry.expected.payloadCount).toBe(1);
    expect(entry.expected.satisfiesS6).toBe(true);
    expect(entry.expected.carrierPlusPreludeBytes).toBe(
      (entry.inputs.carrierBytes as number) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
    );
    // Re-derived: a message of that size takes the prelude at that chunk limit.
    const prepared = prepareRelayMessage(new Uint8Array(entry.inputs.carrierBytes as number), {
      maxChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
      peerSupportsChunking: false,
    });
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.payloads.length).toBe(1);
    expect(prepared.payloads[0]!.byteLength).toBe(entry.expected.wirePayloadBytes);

    const below = caseByName(F02, "undersized-connection-one-byte-below-the-advertisement-floor");
    expect(below.inputs.assertedMaxDataChunkBytes).toBe(E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1);
    expect(below.expected.connectionIsUndersized).toBe(true);
    expect(below.expected.diagnosticReasonLabel).toBe("undersized-connection");
  });
});

describe("§16.3 F10 mode machine (§4.4, §11.2)", () => {
  it("keeps the three legacy-lock rows disjoint by the §11.2 partition", () => {
    const injections = casesMatching(F10, /^legacy-lock-injection-/);
    const rows = new Map(
      injections.map((entry) => [entry.name, entry.expected.fatal as string] as const),
    );
    expect(rows.get("legacy-lock-injection-envelope-is-p5")).toBe("P5");
    expect(rows.get("legacy-lock-injection-client-hello-at-the-node-is-p24")).toBe("P24");
    expect(rows.get("legacy-lock-injection-server-accept-at-the-client-is-p24")).toBe("P24");
    expect(rows.get("legacy-lock-injection-unknown-first-byte-is-p6")).toBe("P6");
    expect(rows.get("legacy-lock-injection-absent-first-byte-is-p6")).toBe("P6");
    const preKeyRows = [...injections, ...casesMatching(F10, /-is-p3$/)];
    for (const entry of preKeyRows) {
      expect(entry.expected.disposition, entry.name).toBe("FATAL-PRE");
    }
    // Five of the seven restate the same fact as `sessionKeysExist`. WHICH five
    // is pinned, so the restatement cannot be dropped without failing here.
    for (const entry of carrying(preKeyRows, "sessionKeysExist", 5)) {
      expect(entry.expected.sessionKeysExist, entry.name).toBe(false);
    }
  });

  it("re-derives the §4.3 step 2 class of every payload the family carries", () => {
    // The one part of this family a shared module decides, and it decides it for
    // the transition rows too: the row a §4.4 machine takes is selected by the
    // input CLASS, so a fixture whose stated class the classifier does not
    // produce would send the node-side consumer down a different row than the
    // one it is asserting.
    let checked = 0;
    for (const entry of F10.cases) {
      const payload = entry.inputs.postStripPayload;
      if (payload === undefined) continue;
      const step2 = entry.expected.step2Discrimination as JsonRecord | undefined;
      if (step2 === undefined) continue;
      expect(classifyPostStripPayload(fixtureBytes(payload)).kind, entry.name).toBe(step2.class);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it("gives every node row its §4.4 action, next state, and §11 row", () => {
    // The STRUCTURE of the transition rows, which is all this side can check:
    // whether the runtime actually takes them is the subject of
    // `apps/server/src/hubConnector/relayE2eeNodeCorpus.test.ts`, which cannot
    // be reached from this package. What is asserted here is that no row is
    // carried without the four fields §16.3 F10 requires of one, and that every
    // pre-key row's §11.5 observable is the SAME observable — §11.2's anti-oracle
    // rule, stated over the corpus rather than over an implementation.
    const rows = casesMatching(F10, /^row-n\d/);
    const numbered = new Set<string>();
    const observables = new Set<string>();
    for (const entry of rows) {
      const row = entry.inputs.row as string;
      expect(row, entry.name).toMatch(/^N(?:[1-9]|1[0-7])$/);
      numbered.add(row);
      expect(entry.expected.row, entry.name).toBe(row);
      expect(typeof entry.expected.action, entry.name).toBe("string");
      expect(typeof entry.expected.nextState, entry.name).toBe("string");
      if (entry.expected.disposition === "FATAL-PRE") {
        expect(hex(fixtureBytes((entry.expected.observable as JsonRecord).handshakeReject))).toBe(
          hex(encodeE2eeHandshakeReject()),
        );
        observables.add(JSON.stringify(entry.expected.observable));
      }
    }
    // One case per §4.4 node row, N1 through N17.
    for (let row = 1; row <= 17; row += 1) {
      expect(numbered.has(`N${String(row)}`), `row N${String(row)}`).toBe(true);
    }
    expect(observables.size, "§11.2: one observable for every pre-key cause").toBe(1);
  });

  it("arms the §8.9 deadline under every policy and row N8 under only one", () => {
    // The distinction §16.3 F10 singles out, and the reason the two halves are
    // one timer: row N8 is guarded on effective `requireE2EE`, because a
    // default-policy node holding an idle channel slot costs nothing; §8.9's
    // half is armed unconditionally, because between row N3 and the finish the
    // node is holding live session keys.
    const n8 = caseByName(F10, "row-n8-the-handshake-deadline-under-effective-require-e2ee");
    expect((n8.inputs.guards as JsonRecord).effectiveRequireE2EE).toBe(true);
    expect(n8.expected.fatal).toBe("P7");

    const unarmed = caseByName(
      F10,
      "node-deadline-n8-does-not-fire-under-the-compatibility-default",
    );
    expect((unarmed.inputs.guards as JsonRecord).effectiveRequireE2EE).toBe(false);
    expect(unarmed.expected.rowN8Fires).toBe(false);
    expect(unarmed.expected.nextState).toBe("negotiating");

    const afterN3 = casesMatching(F10, /^node-deadline-after-row-n3-/);
    expect(afterN3).toHaveLength(2);
    expect(
      new Set(afterN3.map((entry) => (entry.inputs.guards as JsonRecord).effectiveRequireE2EE)),
    ).toEqual(new Set([true, false]));
    for (const entry of afterN3) {
      expect(entry.expected.row, entry.name).toBe("Q8");
      expect(entry.expected.disposition, entry.name).toBe("FATAL-POST");
      expect(entry.expected.armedUnderThisPolicy, entry.name).toBe(true);
    }
  });

  it("states the §12.5 accounting rows N15–N17 turn on", () => {
    // §16.3 F10 names these fields specifically: the asserted `maxDataChunkBytes`,
    // the §7.6.1 self-check result, the effective `requireE2EE` value, and which
    // §12.5 class recorded an occurrence — with N17 asserting that NO peer-legacy
    // occurrence is added on top of N16's.
    for (const entry of casesMatching(F10, /^row-n1[56]-/)) {
      const guards = entry.inputs.guards as JsonRecord;
      expect(typeof guards.assertedMaxDataChunkBytes, entry.name).toBe("number");
      expect(typeof guards.effectiveRequireE2EE, entry.name).toBe("boolean");
      expect(guards.selfCheck, entry.name).toBeDefined();
      expect(entry.expected.carrierEmitted, entry.name).toBe(false);
    }
    const n16 = casesMatching(F10, /^row-n16-/);
    for (const entry of n16) {
      expect((entry.expected.fallbackOccurrence as JsonRecord).class, entry.name).toBe(
        "advertisement-unavailable",
      );
      expect((entry.expected.fallbackOccurrence as JsonRecord).count, entry.name).toBe(1);
      expect(entry.expected.peerLegacyOccurrence, entry.name).toBe(0);
    }
    const n17 = caseByName(F10, "row-n17-legacy-json-on-a-channel-that-never-advertised");
    expect(n17.expected.peerLegacyOccurrenceAddedOnTopOfN16).toBe(0);
    expect(n17.expected.fallbackOccurrencesForThisChannel).toEqual({
      "peer-legacy": 0,
      "advertisement-unavailable": 1,
    });
  });

  it("proves the P24 records are neither over-bound nor misdirected", () => {
    // Every field of the §11.2 partition test, derived from the record itself.
    // Seven of them per case — `decodes`, `recordBytes`, `boundMaxBytes`,
    // `boundIsExact`, `withinItsBound`, `overBound`, `misdirected` — were
    // carried and read by nothing, which is how a case can state a bound the
    // registry does not give and a verdict the bound does not support.
    const partition = casesMatching(F10, /-is-p(?:24|3)$/);
    const derived = new Map<string, Record<string, unknown>>();
    for (const entry of partition) {
      const recordType = entry.inputs.recordType as
        | typeof E2EE_NEGOTIATION_TYPE_CLIENT_HELLO
        | typeof E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT
        | typeof E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT;
      const bound = e2eeNegotiationRecordBound(recordType);
      const direction = e2eeNegotiationRecordDirection(recordType);
      const receivedBy = entry.inputs.receivingEndpoint as string | undefined;
      const payload = entry.inputs.postStripPayload;
      const recordBytes =
        payload === undefined
          ? (entry.inputs.recordBytes as number)
          : fixtureBytes(payload).byteLength;
      const withinItsBound = recordBytes <= bound.maxBytes;
      // §11.2's partition, as the row each case takes: over-bound OR misdirected
      // is `P3`, and a record that is neither is `P24`. `misdirected` is derived
      // here rather than read, so a row that omits it cannot change the verdict.
      const addressedHere =
        receivedBy === undefined || direction === (receivedBy === "node" ? "c2n" : "n2c");
      expect(entry.expected.fatal, entry.name).toBe(
        !withinItsBound || !addressedHere ? "P3" : "P24",
      );
      derived.set(entry.name, {
        boundMaxBytes: bound.maxBytes,
        boundIsExact: bound.exact,
        registryDirection: direction,
        directedCorrectlyForThisEndpoint: addressedHere,
        misdirected: !addressedHere,
        recordBytes,
        withinItsBound,
        overBound: !withinItsBound,
        notP3: withinItsBound && addressedHere,
        decodes:
          payload === undefined
            ? undefined
            : decodeE2eeNegotiationRecord(fixtureBytes(payload)).kind,
      });
    }
    // Each restatement of one of those derivations, over the EXACT set of cases
    // that carries it. Written as `if (… !== undefined)` before, which is an
    // assertion that deletes itself the moment the generator stops emitting the
    // field; the counts below are what makes that a failure instead.
    const restated = (field: string, count: number): void => {
      for (const entry of carrying(partition, field, count)) {
        expect(entry.expected[field], `${entry.name}.${field}`).toBe(
          derived.get(entry.name)![field],
        );
      }
    };
    restated("boundMaxBytes", 2);
    restated("boundIsExact", 2);
    restated("registryDirection", 3);
    restated("directedCorrectlyForThisEndpoint", 3);
    restated("misdirected", 3);
    restated("recordBytes", 2);
    restated("withinItsBound", 3);
    restated("overBound", 3);
    restated("notP3", 2);
    // …and the decode verdict of the two cases that carry a record to decode.
    // The third states `decodes: "error"` for a record too large to be built at
    // all, and is asserted below against its own §11 reason. `?? "ok"` is
    // exactly the default that would have hidden the field disappearing.
    for (const entry of carrying(
      partition.filter((one) => one.inputs.postStripPayload !== undefined),
      "decodes",
      2,
    )) {
      expect(entry.expected.decodes, `${entry.name}.decodes`).toBe(
        derived.get(entry.name)!.decodes,
      );
    }
    // …and the two P3 contrast cases that fix the boundary of that partition.
    const misdirected = caseByName(F10, "misdirected-negotiation-record-is-p3");
    expect(misdirected.expected.misdirected).toBe(true);
    expect(misdirected.expected.registryDirection).toBe(
      e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT),
    );
    const overBound = caseByName(F10, "over-bound-negotiation-record-is-p3");
    expect(overBound.inputs.recordBytes).toBe(E2EE_CLIENT_HELLO_MAX_BYTES + 1);
    expect(overBound.expected.decodes).toBe("error");
    expect(overBound.expected.reason).toBe("too_large");
    expect(overBound.expected.bodyParsed).toBe(false);
  });

  it("unprotects rows N9 and N10 with the F6 session those rows were traced from", () => {
    // Rows N9 and N10 carry an `unprotect` block that nothing read: the node
    // consumer drives them with a record its OWN identity produced, so it cannot
    // compare these bytes, and the shared consumer had no session to open them
    // with. Every number in the block was free — an epoch, a counter, a body
    // length, and on N10 the §4.3 step-3 check that failed.
    //
    // The session does exist in the corpus: both payloads are records of the F6
    // IK trace, and F6 carries that trace's §6.5 outputs. Opening them here is a
    // derivation across the two families rather than a restatement of either.
    const trace = caseByName(F06, "ik-handshake-complete-trace").expected;
    const receiving = (): E2eeRecordSession =>
      new E2eeRecordSession({
        secrets: {
          epochSecretC2N: fixtureBytes(trace.epochSecretC2N),
          epochSecretN2C: fixtureBytes(trace.epochSecretN2C),
          exporterSecret: fixtureBytes(trace.exporterSecret),
          serverConfirmationKey: fixtureBytes(trace.serverConfirmationKey),
        },
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        sessionBindingHash: fixtureBytes(trace.sessionBindingHash),
        // The NODE receives client-to-node records, so it sends the other way.
        sendDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
        plaintextCeiling: PLAINTEXT_CEILING_OF_THE_CORPUS_CHANNEL,
      });

    const n9 = caseByName(F10, "row-n9-an-authenticated-envelope-is-delivered-to-the-rpc-parser");
    const authenticated = receiving().unprotect(fixtureBytes(n9.inputs.postStripPayload));
    const expectedN9 = n9.expected.unprotect as JsonRecord;
    expect(authenticated.kind).toBe(expectedN9.kind);
    if (authenticated.kind !== "authenticated") throw new Error("row N9's envelope did not open");
    expect(authenticated.innerType).toBe(expectedN9.innerType);
    expect(authenticated.body.byteLength).toBe(expectedN9.bodyBytes);
    expect(Number(authenticated.epoch)).toBe(expectedN9.epoch);
    expect(Number(authenticated.counter)).toBe(expectedN9.counter);
    expect(authenticated.plaintextBytes).toBe(expectedN9.plaintextBytes);
    expect(authenticated.epochCompleted).toBe(expectedN9.epochCompleted);

    // N10 is the same record with one ciphertext bit flipped, so it must fail
    // the §4.3 step-3 check the tampering belongs to — the same reason F8's
    // tampered-ciphertext case names, because it is the same tampering.
    const n10 = caseByName(F10, "row-n10-an-envelope-failing-a-step-3-check");
    const rejected = receiving().unprotect(fixtureBytes(n10.inputs.postStripPayload));
    const expectedN10 = n10.expected.unprotect as JsonRecord;
    expect(rejected.kind).toBe(expectedN10.kind);
    if (rejected.kind !== "fatal") throw new Error("row N10's corrupted envelope opened");
    expect(rejected.reason).toBe(expectedN10.reason);
    expect(expectedN10.reason).toBe(
      (caseByName(F08, "tampered-ciphertext-byte").expected.received as JsonRecord).reason,
    );
  });

  it("derives the misdirection verdict of every row that states one", () => {
    // Row N5 states `misdirected` beside guards that already decide it: the
    // registry direction of the record's own type, against the endpoint that
    // received it. The field was free, so the row could have claimed a correctly
    // directed record was misdirected and still taken `P3`.
    // Every row that states one, over a PINNED set: the guard was
    // `if (… === undefined) continue`, which stops finding rows the moment the
    // generator stops emitting the field and reports the same green either way.
    for (const entry of carrying(F10.cases, "misdirected", 4)) {
      const guards = entry.inputs.guards as JsonRecord | undefined;
      const recordType = (entry.inputs.recordType ??
        (entry.inputs.input as JsonRecord | undefined)?.type) as
        | typeof E2EE_NEGOTIATION_TYPE_CLIENT_HELLO
        | typeof E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT
        | typeof E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT;
      expect(recordType, `${entry.name}: a misdirection verdict needs a record type`).toBeDefined();
      const direction = e2eeNegotiationRecordDirection(recordType);
      const receivedBy = (entry.inputs.receivingEndpoint ?? entry.inputs.endpoint) as string;
      const addressedHere = direction === (receivedBy === "node" ? "c2n" : "n2c");
      expect(entry.expected.misdirected, entry.name).toBe(!addressedHere);
      if (guards === undefined) continue;
      expect(guards.registryDirection, entry.name).toBe(direction);
      expect(guards.directedCorrectlyForThisEndpoint, entry.name).toBe(addressedHere);
    }
  });

  it("derives every §4.3 step 2 reason, and the fields that restate it", () => {
    // `matchesExpectedReason` and `neverSilentlyDropped` are two claims about a
    // case that carried them and nothing that read them: the first says the
    // classifier produced the reason the case names, the second says the payload
    // ended in a §11 row rather than being dropped. Both are decidable from the
    // case itself, so neither is a free boolean any more.
    let checked = 0;
    const reasonOf = new Map<string, boolean>();
    for (const entry of F10.cases) {
      const payload = entry.inputs.postStripPayload;
      const step2 = entry.expected.step2Discrimination as JsonRecord | undefined;
      if (payload === undefined || step2 === undefined) continue;
      const classified = classifyPostStripPayload(fixtureBytes(payload));
      if (step2.reason !== undefined) {
        expect(classified.kind === "other" ? classified.reason : undefined, entry.name).toBe(
          step2.reason,
        );
      }
      reasonOf.set(entry.name, classified.kind === "other" && classified.reason === step2.reason);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
    // The two restatements, over the exact sets that carry them.
    for (const entry of carrying(F10.cases, "matchesExpectedReason", 2)) {
      expect(entry.expected.matchesExpectedReason, entry.name).toBe(reasonOf.get(entry.name));
    }
    for (const entry of carrying(F10.cases, "neverSilentlyDropped", 4)) {
      // Not dropped means: it named a §11 row and closed the channel.
      expect(entry.expected.neverSilentlyDropped, entry.name).toBe(
        Object.hasOwn(entry.expected, "fatal") && entry.expected.fatal !== null,
      );
    }
  });

  it("derives each row's post-key facts from the §11 table its row belongs to", () => {
    // `sessionKeysExist`, `errorCode` and the §12.5 occurrence block were free.
    // They are not: §11.2 is the pre-key table and §11.3 the post-key one, so a
    // row's letter decides whether keys exist and whether the row can carry a
    // protected `E2EEError` at all — and §11.3's code for every one of these
    // rows is `protocol_violation`, since `policy` is §12.6's and belongs to a
    // withdrawal rather than to a mode-machine violation.
    // A row's §11 letter, from whichever field the row states it in. `fatal` and
    // `row` are the two spellings the corpus uses; reading them as
    // `fatal ?? row` silently accepted a case that had lost BOTH, so which
    // spelling each case uses is pinned instead.
    const carriesFatal = new Set(carrying(F10.cases, "fatal", 32).map((entry) => entry.name));
    const carriesRow = new Set(carrying(F10.cases, "row", 27).map((entry) => entry.name));
    const letterOf = (entry: FixtureCase): string | null => {
      expect(
        carriesFatal.has(entry.name) || carriesRow.has(entry.name),
        `${entry.name}: states its §11 row in neither \`fatal\` nor \`row\``,
      ).toBe(true);
      return (carriesFatal.has(entry.name) ? entry.expected.fatal : entry.expected.row) as
        | string
        | null;
    };
    const postKeyOf = (entry: FixtureCase): boolean => {
      const row = letterOf(entry);
      return typeof row === "string" && row.startsWith("Q");
    };

    for (const entry of carrying(F10.cases, "sessionKeysExist", 8)) {
      expect(entry.expected.sessionKeysExist, entry.name).toBe(postKeyOf(entry));
    }
    for (const entry of carrying(F10.cases, "disposition", 26)) {
      const row = letterOf(entry);
      if (typeof row !== "string") continue;
      expect(entry.expected.disposition, entry.name).toBe(
        postKeyOf(entry) ? "FATAL-POST" : "FATAL-PRE",
      );
    }
    for (const entry of carrying(F10.cases, "errorCode", 6)) {
      expect(postKeyOf(entry), `${entry.name}: only a §11.3 row protects an error record`).toBe(
        true,
      );
      expect(entry.expected.errorCode, entry.name).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
      expect(entry.expected.errorRecordsOnTheWire, entry.name).toBe(1);
    }
    // The four §5.5 rows whose whole subject is that NO capability carrier went
    // out. `carrierEmitted ?? false` read the same green whether the field was
    // there or not, which is the one thing these rows exist to state.
    for (const entry of carrying(F10.cases, "carrierEmitted", 4)) {
      expect(entry.expected.carrierEmitted, entry.name).toBe(false);
      expect(entry.name, "only the §5.5 advertisement rows state it").toMatch(/^row-n1[56]-/);
    }

    for (const entry of F10.cases) {
      // §12.5's two classes: the occurrence block is either absent, or `null`
      // meaning this row records nothing, or an object naming exactly one class
      // with the reason the row's own guard states.
      if (!("fallbackOccurrence" in entry.expected)) continue;
      const occurrence = entry.expected.fallbackOccurrence as JsonRecord | null;
      if (occurrence === null) continue;
      expect(Object.keys(occurrence).toSorted(), entry.name).toEqual(
        occurrence.reason === undefined ? ["class", "count"] : ["class", "count", "reason"],
      );
      expect(occurrence.count, entry.name).toBe(1);
      const guards = entry.inputs.guards as JsonRecord | undefined;
      if (occurrence.class === "advertisement-unavailable") {
        expect(occurrence.reason, entry.name).toBe(guards?.advertisementUnavailableReason);
      }
    }
  });

  it("pins row N3's accept to the same record the P24 case is built from", () => {
    // Row N3's `serverAccept` is key-dependent, so the node-side consumer drives
    // the row with an accept its own identity produced and cannot compare these
    // bytes. That left the accept, its length and its registry direction carried
    // and unread here. They are checkable without the keys: the record decodes,
    // it is the SERVER_ACCEPT type whose registry direction is `n2c`, its length
    // is the length stated — and it is byte-identical to the record the P24
    // legacy-lock case injects, which is what makes the two cases one record
    // seen in two states rather than two records that happen to agree.
    const n3 = caseByName(F10, "row-n3-client-hello-runs-the-responder-and-enters-e2ee");
    const accept = fixtureBytes(n3.expected.serverAccept);
    expect(n3.expected.serverAcceptBytes).toBe(accept.byteLength);
    const decoded = decodeE2eeNegotiationRecord(accept);
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") throw new Error("row N3's accept does not decode");
    expect(decoded.value.recordType).toBe(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT);
    expect(n3.expected.registryDirection).toBe(
      e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT),
    );
    expect(accept.byteLength).toBeLessThanOrEqual(
      e2eeNegotiationRecordBound(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT).maxBytes,
    );
    const p24 = caseByName(F10, "legacy-lock-injection-server-accept-at-the-client-is-p24");
    expect(hex(accept), "the same accept, injected after a legacy lock").toBe(
      hex(fixtureBytes(p24.inputs.postStripPayload)),
    );
  });

  it("derives the operator diagnostic of every suppressed advertisement", () => {
    // §12.5 makes the reason label part of the occurrence AND of the operator's
    // diagnostic, and the two must be the same label: a node that recorded
    // `undersized-connection` and told the operator `statement-unavailable`
    // would misreport which condition fired. Both were free strings.
    let checked = 0;
    for (const entry of F10.cases) {
      const diagnostic = entry.expected.operatorDiagnostic as JsonRecord | undefined;
      if (diagnostic === undefined) continue;
      const guards = entry.inputs.guards as JsonRecord;
      expect(diagnostic.code, entry.name).toBe("e2ee_advertisement_unavailable");
      expect(diagnostic.reason, entry.name).toBe(guards.advertisementUnavailableReason);
      expect(entry.expected.carrierEmitted, entry.name).toBe(false);
      checked += 1;
    }
    expect(checked, "rows N15 and N16, in both §5.5 reasons").toBe(4);
  });
});

describe("§16.3 F18 node admission policy (§12.4, §12.6)", () => {
  it("derives element 14 from the policy and pins the P25 in-flight abort", () => {
    const patterns = caseByName(F18, "effective-admitted-patterns-by-policy").expected;
    expect(patterns.compatibilityDefault).toEqual([...e2eeEffectiveAdmittedPatterns(false)]);
    expect(patterns.requireApprovedClientE2EE).toEqual([...e2eeEffectiveAdmittedPatterns(true)]);
    expect(patterns.narrowingRemovesOnlyNx).toBe(true);

    const abort = caseByName(F18, "in-flight-handshake-aborted-by-a-policy-withdrawal").expected;
    expect(abort.row).toBe("P25");
    expect(abort.reason).toBe("policy_withdrawn");
    expect(abort.errorCodeEmitted).toBeNull();
    expect(abort.authorizationWithdrawalRow).toBe("P12");
    expect(abort.rowsAreDistinct).toBe(true);
    // `kind` and `disposition` follow from the row and are not free: `P25` is a
    // §11.2 row, so it is fatal, and every §11.2 row is FATAL-PRE by definition
    // of the table it is in. Stating them without checking them left two fields
    // that could name a non-fatal outcome on a row that closes the channel.
    expect(abort.kind).toBe("fatal");
    expect(abort.disposition).toBe("FATAL-PRE");
    // The two aborts fire on different grounds and share one observable — which
    // is the anti-oracle claim `bothTakeTheIdenticalObservable` makes, so the
    // claim is checked against the OTHER row's own committed observable rather
    // than believed. F16 carries `P12` for the §13.6 withdrawal; if the two ever
    // diverged, a peer could tell a policy withdrawal from an authorization one.
    const observable = abort.observable as JsonRecord;
    expect(hex(fixtureBytes(observable.handshakeReject))).toBe(hex(encodeE2eeHandshakeReject()));
    expect(observable.handshakeRejectRecords).toBe(1);
    expect(observable.handshakeRejectBytes).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
    expect(observable.applicationPayloadBytes).toBe(0);
    expect(observable.closeReason).toBe("channel_rejected");
    const p12 = caseByName(F16, "withdrawal-between-step-6-and-row-n3").expected;
    expect(p12.row, "the row F18 names as the other in-flight abort").toBe(
      abort.authorizationWithdrawalRow,
    );
    expect(abort.bothTakeTheIdenticalObservable).toBe(
      JSON.stringify(p12.observable) === JSON.stringify(observable),
    );
    expect(abort.bothTakeTheIdenticalObservable, "§11.2: one observable per cause").toBe(true);
  });

  it("derives the family-wide §12.5 non-interaction claim from the family", () => {
    // `recordedByAnyWithdrawal` is the ONE case that names §12.6's closing
    // prohibition, and it is a claim about every OTHER case: "no withdrawal in
    // this family recorded a fallback occurrence of either class". So it is the
    // sum of what those cases carry, and it is derived from them here rather
    // than restated — a hand-written pair of zeros beside a family that had
    // grown a nonzero occurrence would read as the invariant holding.
    const named = caseByName(F18, "no-withdrawal-records-a-fallback-occurrence-of-either-class");
    const total = { "peer-legacy": 0, "advertisement-unavailable": 0 };
    for (const entry of F18.cases) {
      const recorded = entry.expected.noFallbackOccurrenceRecorded as Record<string, number>;
      total["peer-legacy"] += recorded["peer-legacy"]!;
      total["advertisement-unavailable"] += recorded["advertisement-unavailable"]!;
    }
    expect(named.expected.recordedByAnyWithdrawal).toEqual(total);
    expect(named.expected.sweepIsAnOperatorActionNotALegacyAcceptance).toBe(true);
  });

  it("derives every transition case's element 14 from its own policy", () => {
    // The one value in a §12.6 transition case that a shared module decides. It
    // is what the per-channel NX bullet reads, so a case whose stated admitted
    // pattern set disagreed with §12.4's derivation would be asserting a sweep
    // over a policy the node cannot hold.
    let checked = 0;
    for (const entry of F18.cases) {
      for (const key of ["policyBefore", "policyAfter"] as const) {
        const policy = (entry.inputs[key] ?? entry.expected[key]) as JsonRecord | undefined;
        if (policy === undefined) continue;
        expect(policy.effectiveAdmittedPatterns, `${entry.name}.${key}`).toEqual([
          ...e2eeEffectiveAdmittedPatterns(policy.requireApprovedClientE2EE as boolean),
        ]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it("gives the suite clause both tiers against one command", () => {
    // §12.6's suite bullet is unqualified by tier ON PURPOSE, and a generator
    // free to pick one would leave the rule pinned by prose alone. The IK run
    // additionally carries an unchanged `approved` record, because "the record
    // is still approved" is the plausible wrong exemption.
    const runs = casesMatching(F18, /^a-suite-leaving-the-registry-closes-the-/);
    expect(runs).toHaveLength(2);
    for (const entry of runs) {
      const withdrawn = (entry.expected.perChannel as readonly JsonRecord[])[0]!;
      expect(withdrawn.class, entry.name).toBe("suite_withdrawn");
      expect(withdrawn.row, entry.name).toBe("Q12");
      expect(entry.expected.counts, entry.name).toEqual({
        legacy: 0,
        nxE2ee: 0,
        suiteWithdrawn: 1,
        abortedHandshakes: 0,
      });
    }
    expect(
      caseByName(F18, "a-suite-leaving-the-registry-closes-the-ik-channel-established-on-it")
        .expected.closedDespiteAnUnchangedApprovedRecord,
    ).toBe(true);
  });

  it("states what a negotiating channel does AFTER the command, not only that it survived", () => {
    // §12.6 leaves a `negotiating` channel out of both enumerations, and the
    // second half of that bullet is what makes the first half safe: the channel
    // must then fail closed on its next input under the COMMITTED policy. Three
    // fields carry that half — `sweptByTheWithdrawal`, `nextInputRow`, and
    // `failsClosed` — and until this test they were carried and read by nobody:
    // the generic per-case check reads `perChannel` and the counts, both of
    // which stay correct however those three are set. The node-side consuming
    // test drives them against the real runtime; this side pins the pair the
    // fixture states, so a row swapped between the two cases fails here too.
    const cases = casesMatching(
      F18,
      /^a-negotiating-channel-is-not-swept-and-then-fails-closed-on-/,
    );
    expect(cases).toHaveLength(2);
    const rows = new Set<string>();
    for (const entry of cases) {
      expect(entry.expected.sweptByTheWithdrawal, entry.name).toBe(false);
      expect(entry.expected.isWithdrawal, entry.name).toBe(true);
      for (const channel of entry.expected.perChannel as readonly JsonRecord[]) {
        expect(channel.withdrawn, entry.name).toBe(false);
        expect(channel.disposition, entry.name).toBe("untouched");
      }
      expect(entry.expected.failsClosed, entry.name).toBe(true);
      expect(entry.expected.nextInputDisposition, entry.name).toBe("FATAL-PRE");
      // The row is decided by the input's §4.3 class, so it is derivable here
      // rather than a number the generator was free to choose: plaintext under a
      // newly effective `requireE2EE` is row N1 (`P1`); a hello whose tier the
      // new policy refuses is refused at §8.6 step 2 (`P9`), never `P25`, which
      // belongs to a handshake that already PASSED step 2.
      const next = entry.inputs.nextInputAfterTheCommand as JsonRecord;
      expect(entry.expected.nextInputRow, entry.name).toBe(
        next.class === "LEGACY-JSON" ? "P1" : "P9",
      );
      rows.add(entry.expected.nextInputRow as string);
      expect(hex(fixtureBytes((entry.expected.observable as JsonRecord).handshakeReject))).toBe(
        hex(encodeE2eeHandshakeReject()),
      );
    }
    expect(rows.size, "the two cases take different rows").toBe(2);
  });

  it("records the §12.5 non-interaction on every case in the family", () => {
    // §12.6's closing prohibition. A withdrawal is an operator action, and
    // folding it into either §12.5 counter would corrupt the §12.3 flip
    // criterion with the operator's own command — so EVERY case asserts it, not
    // only the one that names it.
    for (const entry of F18.cases) {
      expect(entry.expected.noFallbackOccurrenceRecorded, entry.name).toEqual({
        "peer-legacy": 0,
        "advertisement-unavailable": 0,
      });
    }
    const named = caseByName(F18, "no-withdrawal-records-a-fallback-occurrence-of-either-class");
    expect(named.expected.sweepIsAnOperatorActionNotALegacyAcceptance).toBe(true);
  });

  it("keeps the row-N3 race's two orders to one disjunction of two outcomes", () => {
    // §12.6 step (b): one pass over one snapshot, each channel dispatched
    // exactly once. Both outcomes are conforming — the phase the snapshot froze
    // decides which — and an outcome outside the pair is not.
    const races = casesMatching(F18, /^the-row-n3-race-/);
    expect(races).toHaveLength(2);
    for (const entry of races) {
      expect(entry.expected.dispatchedExactlyOnce, entry.name).toBe(true);
      expect(entry.expected.leftOpen, entry.name).toBe(false);
      const outcomes = entry.expected.outcomeIsOneOf as readonly JsonRecord[];
      expect(outcomes.map((outcome) => outcome.row)).toEqual(["Q12", "P25"]);
      expect(outcomes.map((outcome) => outcome.countedIn)).toEqual(["nxE2ee", "abortedHandshakes"]);
    }
    expect(
      new Set(races.map((entry) => JSON.stringify(entry.inputs.enumerationOrderAttempted))).size,
      "the two orders are actually different",
    ).toBe(2);
  });

  it("gives every pre-key observable in the family the one §11.5 observable", () => {
    // §11.2's anti-oracle rule over F18: a refused hello, an aborted in-flight
    // handshake and a fail-closed negotiating channel are three different causes
    // and MUST be one observable. Parts of these blocks were driven by the node
    // consumer — the record count and the close reason — and the rest were free
    // numbers beside them, which is precisely where a cause-dependent length
    // would hide.
    // Pinned rather than filtered: `.filter(… !== undefined)` finds nothing at
    // all when the generator stops emitting the block, and the length check
    // below is the only thing that ever noticed.
    const observables = carrying(F18.cases, "observable", 4).map(
      (entry) => [entry.name, entry.expected.observable as JsonRecord] as const,
    );
    for (const [name, observable] of observables) {
      expect(hex(fixtureBytes(observable.handshakeReject)), name).toBe(
        hex(encodeE2eeHandshakeReject()),
      );
      expect(observable.handshakeRejectBytes, name).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
      expect(observable.handshakeRejectRecords, name).toBe(1);
      expect(observable.applicationPayloadBytes, name).toBe(0);
      expect(observable.closeReason, name).toBe("channel_rejected");
    }
    // …and they are one object, not five that happen to agree field by field.
    expect(new Set(observables.map(([, observable]) => JSON.stringify(observable))).size).toBe(1);
  });

  it("derives each case's own summary claim instead of restating it", () => {
    // Five fields that each summarise what the rest of their own case already
    // says. Every one of them was a free boolean or a free list: the case could
    // claim the generation advanced while carrying a pair that did not move, or
    // claim the combined command matched the narrowing alone while carrying a
    // different verdict list, and nothing failed. A summary is only worth
    // carrying if it is checked against what it summarises.
    const widening = caseByName(
      F18,
      "a-widening-closes-nothing-and-still-advances-the-policy-generation",
    );
    expect(widening.expected.generationStillAdvances).toBe(
      (widening.expected.policyGenerationAfter as number) -
        (widening.inputs.policyGenerationBefore as number) ===
        1,
    );
    expect(widening.expected.generationStillAdvances, "§5.7: a widening spends one too").toBe(true);

    // §12.6: a command that narrows AND widens is a withdrawal, with the same
    // per-channel expectations as the narrowing alone. "The same" is checkable —
    // against the narrowing-alone case's own verdict list, which is what makes
    // the claim mean the widening half reached nothing.
    const combined = caseByName(F18, "a-combined-narrow-and-widen-command-is-a-withdrawal");
    const narrowingAlone = caseByName(
      F18,
      "require-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    );
    expect(combined.expected.perChannelMatchesTheNarrowingAlone).toBe(
      JSON.stringify(combined.expected.perChannel) ===
        JSON.stringify(narrowingAlone.expected.perChannel),
    );
    expect(combined.expected.perChannelMatchesTheNarrowingAlone).toBe(true);
    expect(combined.expected.isWithdrawal, "it contains a reduction").toBe(true);

    // §12.6 is explicit that the IK channel surviving `requireApprovedClientE2EE`
    // is a CONSEQUENCE of §8.6 step 6 and not an exemption the sweep applies, so
    // the per-channel test must not read the step-6 snapshot at all. The claim
    // is therefore about a channel that HAS one and survives anyway.
    const approved = caseByName(
      F18,
      "require-approved-client-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    );
    const withSnapshot = (approved.inputs.channels as readonly JsonRecord[]).filter(
      (channel) => channel.admittedAuthoritySnapshot !== undefined,
    );
    expect(withSnapshot.map((channel) => channel.id)).toEqual(["ch-ik"]);
    const verdicts = new Map(
      (approved.expected.perChannel as readonly JsonRecord[]).map((channel) => [
        channel.id,
        channel,
      ]),
    );
    expect(approved.expected.ikStaysOpenWithoutReadingItsStep6Snapshot).toBe(
      withSnapshot.every((channel) => verdicts.get(channel.id)?.withdrawn === false),
    );
    expect(approved.expected.ikStaysOpenWithoutReadingItsStep6Snapshot).toBe(true);

    // §12.6's ordering case: the policy the hello reads at §8.6 step 2 is the
    // COMMITTED one, so its admitted set is §12.4's derivation over the narrowed
    // value — and whether the hello is admitted is a membership test in it,
    // which is exactly the test §8.6 step 2 runs.
    const ordering = caseByName(
      F18,
      "a-hello-reaching-step-2-after-the-durable-commit-is-refused-there",
    );
    const atStepTwo = ordering.expected.policyReadAtStepTwo as JsonRecord;
    expect(ordering.expected.admittedPatternsAtStepTwo).toEqual(
      atStepTwo.effectiveAdmittedPatterns,
    );
    expect(ordering.expected.admittedPatternsAtStepTwo).toEqual([
      ...e2eeEffectiveAdmittedPatterns(atStepTwo.requireApprovedClientE2EE as boolean),
    ]);
    expect(ordering.expected.helloAdmitted).toBe(
      (ordering.expected.admittedPatternsAtStepTwo as readonly string[]).includes(
        ordering.inputs.helloPattern as string,
      ),
    );
    expect(ordering.expected.helloAdmitted, "the narrowed policy refuses it").toBe(false);
  });

  it("fixes every per-channel verdict's §11 observable from the class alone", () => {
    // WHAT THIS IS FOR. `perChannel` carries nine fields per channel and the
    // node-side consumer drives two of them — `withdrawn`, and `class` through
    // which list the sweep terminated the channel on. The remaining seven were
    // emitted, read by nothing, and free: an entry could name `Q12` on a
    // `legacy` close, or one error record on an untouched channel, and every
    // suite stayed green. A field that looks like an expectation and is not one
    // is worse than an absent field, so they are derived here.
    //
    // They ARE derivable, and from one input: §12.6 fixes the class, and the
    // class fixes the rest through §11. A `legacy` channel holds no keys, so it
    // closes with NO record of any kind — the reject would be row K21 at the
    // peer, which is the wrong implementation §16.3 F18 names explicitly. An
    // `e2ee` channel of either withdrawal class holds keys, so it is FATAL-POST
    // `Q12` with exactly one length-uniform `E2EEError` carrying `policy`. An
    // in-flight handshake holds none yet, so it is FATAL-PRE `P25` with the
    // generic fixed-size reject and no error record. A channel the sweep did not
    // touch produces nothing at all. There is no per-channel freedom left in
    // that table, which is exactly why every field of it can be checked.
    interface ChannelVerdict {
      readonly disposition: string;
      readonly row: string | null;
      readonly errorCode: number | null;
      readonly errorRecordsOnTheWire: number;
      readonly handshakeRejectEmitted: boolean;
      readonly closeReason: string | null;
    }
    const VERDICTS: ReadonlyMap<string, ChannelVerdict> = new Map([
      [
        "legacy",
        {
          disposition: "closed with no record",
          row: null,
          errorCode: null,
          errorRecordsOnTheWire: 0,
          handshakeRejectEmitted: false,
          closeReason: "channel_rejected",
        },
      ],
      [
        "nx_e2ee",
        {
          disposition: "FATAL-POST",
          row: "Q12",
          errorCode: E2EE_ERROR_CODE_POLICY,
          errorRecordsOnTheWire: 1,
          handshakeRejectEmitted: false,
          closeReason: "channel_rejected",
        },
      ],
      [
        "suite_withdrawn",
        {
          disposition: "FATAL-POST",
          row: "Q12",
          errorCode: E2EE_ERROR_CODE_POLICY,
          errorRecordsOnTheWire: 1,
          handshakeRejectEmitted: false,
          closeReason: "channel_rejected",
        },
      ],
      [
        "handshake",
        {
          disposition: "FATAL-PRE",
          row: "P25",
          errorCode: null,
          errorRecordsOnTheWire: 0,
          handshakeRejectEmitted: true,
          closeReason: "channel_rejected",
        },
      ],
      [
        "untouched",
        {
          disposition: "untouched",
          row: null,
          errorCode: null,
          errorRecordsOnTheWire: 0,
          handshakeRejectEmitted: false,
          closeReason: null,
        },
      ],
    ]);

    let checked = 0;
    for (const entry of F18.cases) {
      const perChannel = entry.expected.perChannel as readonly JsonRecord[] | undefined;
      if (perChannel === undefined) continue;
      // The verdict list is the CHANNEL list, in order and complete: a channel
      // dropped from it would otherwise take no verdict and be missed by every
      // check below, which is the shape of a channel neither enumeration saw.
      const channels = entry.inputs.channels as readonly JsonRecord[];
      expect(
        perChannel.map((channel) => channel.id),
        entry.name,
      ).toEqual(channels.map((channel) => channel.id));
      for (const channel of perChannel) {
        const where = `${entry.name}: ${String(channel.id)}`;
        // `withdrawn` and `class` are one fact stated twice, and the two must
        // not be able to disagree: a class on a surviving channel would count a
        // close that never happened.
        expect(channel.withdrawn, where).toBe(channel.class !== null);
        const verdict = VERDICTS.get((channel.class as string | null) ?? "untouched");
        expect(verdict, `${where}: class ${String(channel.class)} is outside §12.6`).toBeDefined();
        expect(channel.disposition, where).toBe(verdict!.disposition);
        expect(channel.row, where).toBe(verdict!.row);
        expect(channel.errorCode, where).toBe(verdict!.errorCode);
        expect(channel.errorRecordsOnTheWire, where).toBe(verdict!.errorRecordsOnTheWire);
        expect(channel.handshakeRejectEmitted, where).toBe(verdict!.handshakeRejectEmitted);
        expect(channel.closeReason, where).toBe(verdict!.closeReason);
        checked += 1;
      }
    }
    expect(checked, "the family's channel verdicts").toBe(22);
  });

  it("reports the step (c) counts broken out by class against the channel set", () => {
    const entry = caseByName(F18, "step-c-counts-broken-out-by-class");
    const channels = entry.inputs.channels as readonly JsonRecord[];
    const perChannel = entry.expected.perChannel as readonly JsonRecord[];
    expect(perChannel.map((channel) => channel.id)).toEqual(channels.map((channel) => channel.id));
    expect(entry.expected.channelsAccountedFor).toBe(channels.length);
    // The counts are the per-channel verdicts, tallied — so a channel missed by
    // an enumeration is visible as a count and not only as a survivor.
    const tally = { legacy: 0, nxE2ee: 0, suiteWithdrawn: 0, abortedHandshakes: 0 };
    for (const channel of perChannel) {
      switch (channel.class) {
        case "legacy":
          tally.legacy += 1;
          break;
        case "nx_e2ee":
          tally.nxE2ee += 1;
          break;
        case "suite_withdrawn":
          tally.suiteWithdrawn += 1;
          break;
        case "handshake":
          tally.abortedHandshakes += 1;
          break;
        default:
          expect(channel.withdrawn, String(channel.id)).toBe(false);
      }
    }
    expect(entry.expected.counts).toEqual(tally);
    // The in-flight abort this case's channel set contains takes the SAME §11.5
    // pre-key observable as the case that names the abort — which is §11.2's
    // anti-oracle rule across two cases, and is why the block is carried here at
    // all. It was carried and read by nobody: every number in it was free.
    const abort = caseByName(F18, "in-flight-handshake-aborted-by-a-policy-withdrawal");
    expect(entry.expected.inFlightAbortObservable).toEqual(abort.expected.observable);
    const observable = entry.expected.inFlightAbortObservable as JsonRecord;
    expect(hex(fixtureBytes(observable.handshakeReject))).toBe(hex(encodeE2eeHandshakeReject()));
    expect(observable.handshakeRejectBytes).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
    expect(observable.handshakeRejectRecords).toBe(1);
    expect(observable.applicationPayloadBytes).toBe(0);
    // …and the case's own channel set has to contain the abort it describes.
    expect(
      perChannel.filter((channel) => channel.class === "handshake").map((channel) => channel.id),
    ).toEqual(["ch-in-flight-nx"]);
  });
});

describe("§16.3 F19 account-enrolled native Hub device grants (§18)", () => {
  function keyFromFixture(value: unknown): HubDeviceGrantVerificationKey {
    const key = value as JsonRecord;
    return {
      keyId: key.keyId as string,
      publicKey: fixtureBytes(key.publicKey),
      notBefore: key.notBefore as number,
      notAfter: key.notAfter as number,
    };
  }

  function bindingsFromFixture(value: unknown): HubDeviceGrantBindings {
    const bindings = value as JsonRecord;
    return {
      issuerHubOrigin: bindings.issuerHubOrigin as string,
      accountId: bindings.accountId as string,
      accountAuthEpoch: bindings.accountAuthEpoch as number,
      enrollmentId: bindings.enrollmentId as string,
      enrollmentRevision: bindings.enrollmentRevision as number,
      deviceAuthEpoch: bindings.deviceAuthEpoch as number,
      enrollmentStatus: bindings.enrollmentStatus as HubDeviceGrantBindings["enrollmentStatus"],
      deviceIdentityPublicKey: fixtureBytes(bindings.deviceIdentityPublicKey),
      deviceAgreementPublicKey: fixtureBytes(bindings.deviceAgreementPublicKey),
      clientPrekeyCertificateDigest: fixtureBytes(bindings.clientPrekeyCertificateDigest),
      clientPrekeyCertificateExpiresAt: bindings.clientPrekeyCertificateExpiresAt as number,
      nodeId: bindings.nodeId as string,
      nodeIdentityPublicKey: fixtureBytes(bindings.nodeIdentityPublicKey),
      nodeAgreementPublicKey: fixtureBytes(bindings.nodeAgreementPublicKey),
      nodeAgreementPrekeyExpiresAt: bindings.nodeAgreementPrekeyExpiresAt as number,
      nodeContinuityId: bindings.nodeContinuityId as string,
      nodePolicyGeneration: bindings.nodePolicyGeneration as number,
      nodeCapabilityStatementDigest: fixtureBytes(bindings.nodeCapabilityStatementDigest),
      nodeCapabilityStatementExpiresAt: bindings.nodeCapabilityStatementExpiresAt as number,
      relayTicketId: bindings.relayTicketId as string,
      relayTicketExpiresAt: bindings.relayTicketExpiresAt as number,
      effectiveRole: bindings.effectiveRole as HubDeviceGrantBindings["effectiveRole"],
      effectiveCapabilities:
        bindings.effectiveCapabilities as HubDeviceGrantBindings["effectiveCapabilities"],
      accountGrantAllowed: bindings.accountGrantAllowed as boolean,
      now: bindings.now as number,
    };
  }

  it("replays every grant and consumes every expected F19 leaf", () => {
    expect(F19.cases).toHaveLength(43);
    for (const entry of F19.cases) {
      const envelope = fixtureBytes(entry.inputs.envelope);
      const keys = (entry.inputs.verificationKeys as readonly unknown[]).map(keyFromFixture);
      const bindings = bindingsFromFixture(entry.inputs.bindings);
      const result = verifyHubDeviceGrant({ envelope, verificationKeys: keys, bindings });
      const actual: Record<string, unknown> =
        result.kind === "ok" ? { kind: "ok" } : { kind: "error", reason: result.reason };

      if (Object.hasOwn(entry.expected, "claimsBytes")) {
        expect(result.kind, entry.name).toBe("ok");
        if (result.kind !== "ok") continue;
        actual.claimsBytes = { $bytes: hex(result.claimsBytes) };
        actual.signingEnvelope = {
          $bytes: hex(encodeHubDeviceGrantSigningEnvelope(result.claimsBytes)),
        };
        actual.signature = { $bytes: hex(result.signature) };
        actual.envelope = { $bytes: hex(envelope) };
        actual.grantDigest = { $bytes: hex(result.grantDigest) };
      }
      if (Object.hasOwn(entry.expected, "envelopeBytes")) {
        actual.envelopeBytes = envelope.byteLength;
      }
      if (Object.hasOwn(entry.expected, "maximumEnvelopeBytes")) {
        actual.maximumEnvelopeBytes = E2EE_HUB_DEVICE_GRANT_MAX_BYTES;
        actual.withinBound = envelope.byteLength <= E2EE_HUB_DEVICE_GRANT_MAX_BYTES;
      }
      expect(actual, entry.name).toEqual(entry.expected);
    }
  });

  it("pins the boundary ordering independently of CBOR and signature validity", () => {
    const at = caseByName(F19, "exactly-2048-bytes-is-not-rejected-as-oversize");
    const over = caseByName(F19, "one-byte-over-the-grant-bound-is-rejected-before-cbor");
    expect(fixtureBytes(at.inputs.envelope)).toHaveLength(E2EE_HUB_DEVICE_GRANT_MAX_BYTES);
    expect(at.expected.reason).toBe("grant_malformed");
    expect(fixtureBytes(over.inputs.envelope)).toHaveLength(E2EE_HUB_DEVICE_GRANT_MAX_BYTES + 1);
    expect(over.expected.reason).toBe("grant_oversize");
  });

  it("keeps failures closed and free of peer-controlled identifiers", () => {
    for (const entry of F19.cases) {
      if (entry.expected.kind !== "error") continue;
      const result = decodeHubDeviceGrant(fixtureBytes(entry.inputs.envelope));
      if (result.kind === "ok") continue;
      expect(Object.keys(result).toSorted(), entry.name).toEqual(["kind", "reason"]);
      expect(JSON.stringify(result), entry.name).not.toContain("acct_");
      expect(JSON.stringify(result), entry.name).not.toContain("rtk_");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The §16.3 coverage ledger
// ═══════════════════════════════════════════════════════════════════════════
//
// ───────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE TRUSTING ANY LEDGER TEST AT THE BOTTOM OF THIS FILE.
// ───────────────────────────────────────────────────────────────────────────
//
// THE LEDGER IS A HAND-MAINTAINED TRANSCRIPTION OF §16.3, AND NOTHING VERIFIES
// THE TRANSCRIPTION. `docs/relay-e2ee-protocol.md` §16.3 is prose, and no test
// in this repository parses it. The tests below therefore prove that the
// CORPUS matches THIS LEDGER. They do not prove that THIS LEDGER matches THE
// SPECIFICATION. That gap is real, it is not closed anywhere, and it is stated
// here rather than left for a reader to infer from what the tests happen to do.
//
// WHAT THE LEDGER TESTS DO PROVE
//   • every obligation WRITTEN HERE resolves exactly one way — as a generated
//     case, or as a declared deferral — and never as neither;
//   • no committed fixture case exists that no obligation here claims;
//   • no family deferral exists that no obligation here claims, and none is
//     claimed by two;
//   • every group obligation's declared `cases` count equals the number of
//     committed cases its matcher claims — EXACTLY, in both directions, so a
//     member cannot disappear and one cannot be added without the entry moving;
//   • every obligation whose every matching case is read by NO suite carries
//     `unasserted`, naming what is missing and who owns it. THIRTEEN do. That
//     check runs against the measured union, not against a declaration, and it
//     runs in both directions — the field must come off when a case goes live.
//
// WHAT THEY CANNOT PROVE
//   • that the obligations written here are ALL of §16.3's obligations. An
//     obligation the specification states and nobody transcribed into this
//     array is invisible to every test in this file — it is not "missing", it
//     does not exist as far as the tests are concerned. THIS IS THE RESIDUAL.
//   • that an entry's `spec` text still says what §16.3 says. Editing the
//     document's wording, or narrowing an obligation there, fails nothing here.
//   • that a case it claims ASSERTS ANYTHING BEYOND ONE LEAF. `generated` is a
//     claim about existence; `unasserted` catches only the total-emptiness case.
//     An obligation with one live leaf across its cases and everything else
//     inert passes both. See the census immediately below.
//
// ───────────────────────────────────────────────────────────────────────────
// THE MEASURED CENSUS: HOW MUCH OF THIS CORPUS IS ACTUALLY CHECKED
// ───────────────────────────────────────────────────────────────────────────
//
// THE LEDGER CONSTRAINS NAMES AND COUNTS, NEVER CONTENT. A case reduced to
// nothing but a `name` and an empty `expected` block discharges its obligation
// exactly as well as one whose every field is re-derived through the
// implementation. So the ledger proves a case EXISTS. It does not prove the
// case SAYS anything, and the numbers below are what that costs today.
//
// Measured by read-liveness — every family is loaded through
// `relayE2eeCorpusLiveness.ts`, which hands each leaf to the suite behind an
// accessor that records the read — over one run of each consuming suite,
// unioned. A LEAF is one scalar under `expected`, counting a `{"$bytes": …}`
// wrapper as one. Full method, per-family residuals and owners are in the
// corpus manifest under `livenessCensus`; the tests at the bottom of this file
// hold the manifest to the corpus and to itself.
//
//   2,224 of 3,388 committed expectation leaves are read by some suite: 65.6%.
//   1,164 are read by nothing. 17 of the 334 committed cases carry no live
//   leaf at all — they are named one by one in `E2EE_CORPUS_CASE_LIVENESS`,
//   each with the reason and the owner of the missing work.
//
//   Per family, live/total: F1 161/161 · F2 16/30 · F3 80/190 · F4 80/81 ·
//   F5 52/66 · F6 26/62 · F7 31/73 · F8 117/148 · F9 182/589 · F10 361/361 ·
//   F11 198/396 · F12 42/120 · F13 8/8 · F14 30/46 · F15 22/22 · F16 144/332 ·
//   F17 168/197 · F18 405/405 · F19 91/91.
//
//   MOVED THIS ROUND, and only these two: F4 44→80 and F17 150→168, which took
//   the contentless count from 32 to 17 and left every remaining one in F3.
//   Nothing was relabelled to get there, and that is MEASURED rather than
//   asserted: a per-leaf mutation sweep was run over both families — all 278
//   committed leaves, one mutation per run, each followed by a full run of this
//   file — and 248 of them fail when the leaf changes. The 30 that survive are
//   EXACTLY the 30 the two families' residuals below declare inert. Neither
//   family has an entry in `E2EE_CORPUS_DELEGATED_LEAF_READS`, so this suite is
//   their sole reader and the sweep covers their whole union. For F4 and F17,
//   therefore, read-liveness is not merely an upper bound on assertion — it is
//   tight. The manifest records the sweep under
//   `livenessCensus.assertionLiveness.measuredFamilySweep`. The four ledger
//   obligations that stopped being `unasserted` stopped because their cases went
//   live.
//
// "17 OF 334" IS NOT THE INTERESTING NUMBER, AND ON ITS OWN IT MISLEADS: with a
// one-leaf threshold it invites the reading that the other 317 assert something
// substantial. The distribution is what shows the shape, and the manifest
// publishes it as `casesByLiveLeafCount`:
//
//   live leaves per case:  0 → 17 · 1 → 19 · 2 → 101 · 3–5 → 87 · 6–10 → 56 ·
//   11–25 → 38 · 26+ → 16.   137 of 334 cases have at most TWO live leaves;
//   224 have at most five.
//
// READ-LIVENESS IS AN UPPER BOUND ON ASSERTION EVERYWHERE EXCEPT F4 AND F17. A
// suite that reads a value and never compares it marks it live here. The tighter
// measure is a per-leaf MUTATION sweep; this round ran one over F4 and F17 (see
// above), and for those two the two measures agree exactly. For the other
// sixteen families the only global assertion figure anyone has is the sweep
// against the 3,684-leaf corpus that PRECEDED this round: 1,821 live, 1,863
// inert, 49.4%, 37 contentless cases. That corpus is superseded — the 397-leaf
// close-machine `steps` blocks were deleted and F8 and F17 assertions were added
// since — so 49.4% is stale and no line-for-line comparison with the per-family
// numbers above is valid. Everything published above for those sixteen families
// is read-liveness. Closing the rest means ~3,000 further single-leaf mutations,
// each followed by the shared, node and Noise suites. The manifest records this
// under `livenessCensus.assertionLiveness`.
//
// THE MECHANISM, as opposed to the number, IS A FLOOR: a committed case must
// carry at least ONE leaf some consuming suite reads, or appear in
// `E2EE_CORPUS_CASE_LIVENESS` naming the suite that reads it or declaring it
// DECORATIVE with a reason and a named owner. What that guarantees is exactly
// that — one leaf per committed case is read by somebody. It does NOT guarantee
// that a case's expectations are meaningfully asserted: a case can keep its
// name and one or two live leaves while every other field in its `expected`
// block is inert, and it passes. Hollowing a case out ENTIRELY fails, and the
// emptiness that remains is counted and named rather than silent, which is the
// exact failure the ledger's own partition rule was added to close one level up.
//
// THE PER-FAMILY NUMBERS ARE PINNED FROM ABOVE AS WELL AS BELOW. Each family's
// live count is a union across three suites in two packages; the leaves another
// suite is the sole reader of are written down path by path in
// `E2EE_CORPUS_DELEGATED_LEAF_READS`, checked to be real leaves this suite does
// not read, and asserted to be genuinely read in the suite they name. So the
// union is recomputed here EXACTLY, and a census that drifts above what the
// suites read fails rather than reads.
//
// THE REVIEW OBLIGATION THAT STANDS IN FOR THE MISSING MECHANISM
//   When EITHER side changes — an edit to §16.3, or an edit to this array — a
//   reviewer MUST diff this array against §16.3 BY EYE, entry against
//   paragraph, and confirm the two enumerate the same set. That review is the
//   only thing standing between a §16.3 obligation and silent non-coverage.
//
//   Every entry carries two fields that exist solely to make that diff
//   MECHANICAL rather than interpretive: `section` names the exact §16.3
//   paragraph to open, and `spec` carries §16.3's own words for the obligation.
//   Read those two columns against the document side by side. Do NOT try to
//   reconstruct an obligation from its regex — the regex matches case NAMES the
//   generator chose, which is a different vocabulary from the specification's.
//
//   `spec` convention: text outside square brackets is §16.3's own wording,
//   quoted or condensed without changing its terms. Text inside [square
//   brackets] is the transcriber's, and says which part of a multi-case
//   sentence this entry covers, or flags a case §16.3 does NOT name — those
//   entries exist because the corpus carries the case and the "claims every
//   committed case" test requires an obligation for it.
//
// A MECHANISM WAS CONSIDERED AND DELIBERATELY NOT BUILT
//   Parsing §16.3's prose to derive the obligation set automatically was
//   rejected. The section is discursive English — nested bullets, prose
//   qualifiers, one obligation spread over three sentences and two of them
//   negative — and an extractor over it would be wrong in ways no test could
//   surface. A green check from an unreliable extractor is strictly worse than
//   a known limitation whose reviewer is told, in as many words, to close it.
//   The same limitation is recorded in the corpus manifest under
//   `ledgerFidelity`, so it reaches a reader of the fixtures as well as a
//   reader of this file.
//
// WHY THE LEDGER EXISTS AT ALL
//   The corpus is incomplete by design at this point in the rollout, so the
//   property that matters is not "complete" but "nothing missing in silence".
//   Family-level presence cannot express that: every family below has a file,
//   and three §16.3-named cases were nevertheless absent from both the corpus
//   and its own deferral lists at one point — neither generated nor declared,
//   and no test could tell.
//
//   The ledger closes that, WITHIN THE BOUND STATED ABOVE. It enumerates
//   §16.3's obligations here, in the CONSUMING test rather than in the
//   generator, and resolves each one exactly one way:
//
//     `generated` — at least one committed case in that family matches; or
//     `declared`  — exactly one deferral string in that family names it.
//
//   Because the ledger lives on this side, a generator that drops a case cannot
//   also drop the obligation. Because the two resolutions are exclusive and the
//   declared half is a BIJECTION with the families' deferral strings, a case
//   cannot be quietly moved from "emitted" to "not mentioned at all": removing
//   it forces someone to write a deferral, and writing a deferral no obligation
//   claims fails just as loudly.
interface CoverageObligation {
  /** Stable id, so a failure names the §16.3 obligation and not a regex. */
  readonly id: string;
  readonly family: number;
  /**
   * WHERE the obligation is written, precise enough to open the document at the
   * right paragraph: the §16.3 family bullet, or the named sub-paragraph inside
   * it. `16.4` appears for the cross-runtime obligations, which §16.4 states and
   * each family repeats in its own deferral list.
   *
   * Half of the side-by-side review described above. It is a POINTER, and no
   * test can confirm it points anywhere real.
   */
  readonly section: string;
  /**
   * WHAT the specification says there, in the specification's own words where it
   * names the case and a close condensation of them where it describes one.
   * [Square brackets] mark the transcriber's additions — see the `spec`
   * convention in the header above.
   *
   * The other half of the review. Nothing checks it against the document.
   */
  readonly spec: string;
  /** §16.3 asks for this and the corpus carries it: a case name must match. */
  readonly generated?: RegExp;
  /**
   * How many cases the obligation stands for. EXACTLY, not a floor, and omitted
   * means exactly one — `pins each generated obligation to its exact case count`
   * holds the corpus to this number in BOTH directions.
   *
   * It was a floor once, and a floor is what let one obligation drift to
   * `atLeast: 18` against nineteen committed cases: a case inside that group
   * could be deleted and every ledger test stayed green, which is the whole
   * failure the number exists to prevent. A floor also lets a case be ADDED
   * without anyone touching the ledger, so the entry stops describing the corpus
   * without ever failing. Growth is still expressible — it is one edit to this
   * number, made in the same commit as the case, which is the point.
   */
  readonly cases?: number;
  /** §16.3 asks for this and the corpus does not: a deferral must name it. */
  readonly declared?: RegExp;
  /**
   * SET WHEN THE CORPUS CARRIES THE CASE AND NOTHING ASSERTS IT.
   *
   * `generated` means "a committed case matches", which is a statement about
   * EXISTENCE. Thirteen obligations resolve that way while every case backing
   * them was decorative — read by no suite at all — so the ledger read as
   * covering them and the census, one file over, recorded the opposite. The two
   * statements disagreed and no test compared them.
   *
   * An obligation whose every matching case is decorative MUST carry this field,
   * naming what is missing and who owns it. It is the ledger's third resolution:
   * generated-but-unasserted, declared rather than implied.
   *
   * The check runs in BOTH directions. An obligation with this field and one
   * non-decorative case fails — remove the field when the harness lands. An
   * obligation whose cases are all decorative and lacks the field fails too.
   */
  readonly unasserted?: string;
}

const CROSS_RUNTIME = /^§16\.4 cross-runtime equality:/;

const SECTION_16_3_LEDGER: readonly CoverageObligation[] = [
  // ── F1 — payload discrimination and chunk pipeline ─────────────────────────
  {
    id: "f1-size-budget",
    family: 1,
    section: "16.3 F1 (§4.5)",
    spec: "[Not named by §16.3. A repository addition: the §4.5 size budget — RELAY_MAX_RPC_MESSAGE_BYTES, E2EE_ENVELOPE_OVERHEAD_BYTES and the resulting `plaintextCeiling` — pinned as exact numbers, once under the limits the relay asserts by default and once for the channel every other case in this family runs under, so a constant change is visible here rather than only as moved bytes.]",
    generated: /^size-budget-/,
    cases: 2,
  },
  {
    id: "f1-prelude-then-envelope",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "prelude ‖ envelope (prelude stripped, first byte `E2EE_ENVELOPE_DISCRIMINATOR`)",
    generated: /^prelude-then-envelope$/,
  },
  {
    id: "f1-envelope-without-prelude",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "envelope without prelude (no-headroom path, surfaced unchanged)",
    generated: /^envelope-without-prelude-/,
  },
  {
    id: "f1-chunked-envelope",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "chunked envelope whose chunk payloads start `RELAY_CHUNK_MAGIC` (reassembles to the envelope)",
    generated: /^chunked-envelope-reassembles-/,
  },
  {
    id: "f1-prelude-then-legacy-json",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "prelude ‖ legacy JSON (surfaced as legacy JSON)",
    generated: /^prelude-then-legacy-json$/,
  },
  {
    id: "f1-headroom-boundary",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "envelope exactly at the prelude-headroom boundary and one byte over (prelude present, then absent)",
    generated: /^envelope-(exactly-at|one-byte-over)-the-prelude-headroom-boundary$/,
    cases: 2,
  },
  {
    id: "f1-interior-nul-runs",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "ciphertext with interior `0x00` runs (never enters the chunk parser post-strip)",
    generated: /^ciphertext-with-interior-nul-runs$/,
  },
  {
    id: "f1-zero-length-inner-body",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "envelope with a zero-length inner body (valid) [distinct from the empty-payload cases below, which §16.3 says are a distinct pair of reachability paths]",
    generated: /^envelope-with-a-zero-length-inner-body$/,
  },
  {
    id: "f1-plaintext-ceiling",
    family: 1,
    section: "16.3 F1 (§4.2, §4.3, §4.5)",
    spec: "inner body exactly at `plaintextCeiling` (sent) and one byte over (`e2ee_message_too_large`, nothing transmitted)",
    generated:
      /^(?:production-)?inner-body-(exactly-at|one-byte-over)-the-plaintext-ceiling(?:-recipe)?$/,
    cases: 3,
  },
  {
    id: "f1-empty-payload-zero-length-path",
    family: 1,
    section: "16.3 F1 — Empty-payload cases (§3.4, §4.3 step 2)",
    spec: "The corpus MUST additionally carry the zero-length post-strip payload along both of its reachability paths, in `negotiating`, `e2ee`, and `legacy`: a `data.payload` of length zero [this entry], and a `data.payload` equal to exactly `RELAY_CHUNK_CAPABILITY_PRELUDE`.",
    generated: /^empty-post-strip-payload-zero-length-data-payload-in-/,
    cases: 3,
  },
  {
    id: "f1-empty-payload-prelude-path",
    family: 1,
    section: "16.3 F1 — Empty-payload cases (§3.4, §4.3 step 2)",
    spec: "…and a `data.payload` equal to exactly `RELAY_CHUNK_CAPABILITY_PRELUDE` [this entry]. …the prelude case MUST additionally assert that the peer's chunk-support latch still sets before the fatal outcome is taken.",
    generated: /^empty-post-strip-payload-data-payload-equal-to-the-chunk-capability-prelude-in-/,
    cases: 3,
  },
  {
    id: "f1-empty-payload-row",
    family: 1,
    section: "16.3 F1 — Empty-payload cases (§3.4, §4.3 step 2)",
    spec: "Each case expects `P6` before keys and `Q6` after [this entry covers the §11 row itself, which is the §4.4 mode machine's verdict].",
    declared: /^The §11 row of each empty-payload case/,
  },
  {
    id: "f1-cross-runtime",
    family: 1,
    section: "16.4 (recorded against F1)",
    spec: "Families exercising web-facing surfaces — F1, F2, F7, F8, F10, … — MUST also run in the web browser test suite. Before the native client ships E2EE support the complete corpus MUST additionally pass on physical devices on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F2 — capability carrier compatibility ──────────────────────────────────
  {
    id: "f2-c1",
    family: 2,
    section: "16.3 F2 (§5.6, §5.5)",
    spec: "one case per compatibility case C1–C6, each with exact carrier bytes (with and without prelude where applicable) and the required outcome [this entry covers C1, carrier reassembly, in both its with-prelude and without-prelude forms]",
    generated: /^c1-carrier-reassembly-/,
    cases: 2,
  },
  {
    id: "f2-c6",
    family: 2,
    section: "16.3 F2 (§5.6, §5.5)",
    spec: "one case per compatibility case C1–C6, each with exact carrier bytes … and the required outcome [this entry covers C6, prelude whitespace tolerance]",
    generated: /^c6-prelude-whitespace-tolerance$/,
  },
  {
    id: "f2-carrier-boundary-at",
    family: 2,
    section: "16.3 F2 (§5.6, §5.5)",
    spec: "the carrier boundary pair: the maximum conforming carrier of F3 presented at an asserted `maxDataChunkBytes` of exactly `E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES` (emitted unchunked, prelude intact) [this entry]",
    generated: /^maximum-carrier-at-the-advertisement-floor$/,
  },
  {
    id: "f2-carrier-boundary-below",
    family: 2,
    section: "16.3 F2 (§5.6, §5.5)",
    spec: "…and at one byte below it (§5.5 U1 — advertisement suppressed, one `undersized-connection` occurrence recorded, no peer-legacy occurrence, and FATAL-PRE under effective `requireE2EE`) [this entry carries the comparison; the occurrence accounting is the separate obligation below]",
    generated: /^undersized-connection-one-byte-below-the-advertisement-floor$/,
  },
  {
    id: "f2-c2-c3-c4",
    family: 2,
    section: "16.3 F2 (§5.6, §5.5)",
    spec: "one case per compatibility case C1–C6 … This family is the normative enforcement point for §5.6's version binding: each case MUST fail if the pinned RPC client's behavior regresses, and the family MUST be re-run against any new build before a changed `effect` pin — or a changed patch touching its RPC client — lands. [this entry covers C2, C3 and C4]",
    declared: /^Cases C2, C3, and C4 are behavioral claims/,
  },
  {
    id: "f2-c5",
    family: 2,
    section: "16.3 F2 (§5.6, §5.5)",
    spec: "including the C5 defect-reply demonstration of the prohibited client-to-node direction",
    declared: /^Case C5, the node-direction hazard/,
  },
  {
    id: "f2-u1-accounting",
    family: 2,
    section: "16.3 F2 (§5.6, §5.5)",
    spec: "…(§5.5 U1 — advertisement suppressed, one `undersized-connection` occurrence recorded, no peer-legacy occurrence, and FATAL-PRE under effective `requireE2EE`) [this entry covers the §12.5 occurrence-accounting half of that clause. THIS FAMILY does not carry it: the case above carries only the comparison. The accounting is emitted in family F10 as rows N15–N17 and driven there — which is a different §16.3 obligation, claimed by a different entry, and does not discharge this one.]",
    declared: /^The §5\.5 U1 accounting half/,
  },
  {
    id: "f2-cross-runtime",
    family: 2,
    section: "16.4 (recorded against F2)",
    spec: "Families exercising web-facing surfaces — F1, F2, F7, F8, F10, … — MUST also run in the web browser test suite, plus the physical-device pass on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F3 — capability statement ──────────────────────────────────────────────
  {
    id: "f3-valid-statement",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "a valid statement (transcript bytes, §7.2.1 envelope bytes, signature, recomputed fingerprints, reconstructed prekey cross-signature)",
    generated: /^valid-capability-statement$/,
  },
  {
    id: "f3-never-rotated-node",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "a valid statement from a never-rotated node, asserting that element 18 `continuityId` is present with an empty element 11 chain",
    generated: /^valid-statement-from-a-never-rotated-node$/,
  },
  {
    id: "f3-maximum-conforming",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "the maximum conforming statement: `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` chain entries, a Hub origin of exactly `E2EE_HUB_ORIGIN_MAX_BYTES`, `E2EE_SUITE_REGISTRY_MAX_ENTRIES` suite ids, and the widest canonical integer encoding for every unsigned field — asserting the exact transcript length, the exact statement length, the exact base64url length, and the exact carrier JSON length against their §3.2 constants, plus `carrier + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES ≤ E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES`. … The generator MUST emit two numbers here and assert both: the §5.5 upper bound … and the largest statement that actually validates under those registries.",
    generated: /^maximum-conforming-statement$/,
  },
  {
    id: "f3-envelope-length-invariant",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "the §7.2.1 envelope for a minimum-size and a maximum-size transcript, asserting identical lengths equal to `E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES` and both within `E2EE_SIGNING_INPUT_MAX_BYTES`",
    generated: /^signing-envelope-length-is-identical-for-a-minimum-and-a-maximum-transcript$/,
  },
  {
    id: "f3-wrong-signing-input",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "a statement whose signature was computed over the raw transcript bytes instead of the §7.2.1 envelope (invalid), and one whose envelope was built from a digest of different transcript bytes than those carried (invalid)",
    generated:
      /^(signature-computed-over-the-raw-transcript-instead-of-the-envelope|envelope-built-from-a-digest-of-different-transcript-bytes)$/,
    cases: 2,
  },
  {
    id: "f3-re-encode-inequality",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "and invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, lower policy generation, fingerprint mismatch, cross-signature reconstruction failure, oversized statement …, re-encode inequality (non-canonical bytes) [this entry: re-encode inequality]",
    generated: /^non-canonical-transcript-encoding$/,
    unasserted:
      "The corpus carries `non-canonical-transcript-encoding` and nothing asserts it: `canonicalDecode`, `envelopeOverTheNonCanonicalBytesDiffers` and `verifiesUnderTheCanonicalSignature` are read by no suite. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-cross-signature-reconstruction",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "and invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, lower policy generation, fingerprint mismatch, cross-signature reconstruction failure, oversized statement …, re-encode inequality (non-canonical bytes) [this entry: cross-signature reconstruction failure]",
    generated: /^prekey-cross-signature-lifted-from-another-statement$/,
    unasserted:
      "The corpus carries `prekey-cross-signature-lifted-from-another-statement` and nothing asserts it: `crossSignatureReconstructionVerifies` is read by no suite. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-fingerprint-mismatch",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "and invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, lower policy generation, fingerprint mismatch, cross-signature reconstruction failure, oversized statement …, re-encode inequality (non-canonical bytes) [this entry: fingerprint mismatch]",
    generated: /^advertised-identity-fingerprint-disagrees-with-the-advertised-identity-key$/,
    unasserted:
      "The corpus carries `advertised-identity-fingerprint-disagrees-with-the-advertised-identity-key` and nothing asserts it: `crossSignatureReconstructionVerifies` is read by no suite. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-hub-origin-bound",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "a Hub origin exactly at and one byte over `E2EE_HUB_ORIGIN_MAX_BYTES` (accepted, then rejected — §7.1)",
    generated: /^hub-origin-(exactly-at|one-byte-over)-the-bound$/,
    cases: 2,
    unasserted:
      "The corpus carries both bound cases and nothing asserts either: `canonicalizationAccepted`, `encoderAccepted`, `expectedAccepted` and `selfCheckOnAConformingArtifact` are read by no suite, so the accept/reject split at `E2EE_HUB_ORIGIN_MAX_BYTES` is unverified. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-suite-registry-bound",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "a suite registry exactly at and one entry over `E2EE_SUITE_REGISTRY_MAX_ENTRIES`",
    generated: /^suite-registry-(exactly-at|one-entry-over)-max-entries$/,
    cases: 2,
    unasserted:
      "The corpus carries both bound cases and nothing asserts either: `encoderAccepted`, `expectedAccepted` and `transcriptBytes` are read by no suite, so the accept/reject split at `E2EE_SUITE_REGISTRY_MAX_ENTRIES` is unverified. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-transcript-bound",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "the same statement one byte over `E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES` (rejected at §5.2 step 0, and refused at emit by §7.6.1) and exactly at the bound (accepted)",
    generated: /^transcript-(exactly-at|one-byte-over)-the-transcript-bound$/,
    cases: 2,
    unasserted:
      "The corpus carries both bound cases and nothing asserts either: `signingEnvelopeAccepted`, `expectedAccepted` and `selfCheck` are read by no suite, so the accept/reject split at `E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES` is unverified. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-oversized-statement",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "oversized statement (re-anchored to the current `E2EE_CAPABILITY_STATEMENT_MAX_BYTES`) [carried as the statement bound and the carrier bound it implies]",
    generated: /^oversized-(statement|carrier)$/,
    cases: 2,
    unasserted:
      "The corpus carries `oversized-statement` and `oversized-carrier` and nothing asserts either: `selfCheck` is read by no suite. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-malformed-continuity-id",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "a statement omitting element 18 and one carrying a malformed continuity id (both invalid) [this entry covers the malformed half, carried once per malformation class; the omission half is declared below]",
    generated: /^malformed-continuity-id-/,
    cases: 4,
    unasserted:
      "The corpus carries all four malformation classes and nothing asserts any of them: `encoderRejects` is read by no suite. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-continuity-id-unresolved",
    family: 3,
    section: "16.3 F3 (§7.6.1) / F5 storage-and-anchor cases (§7.5, §5.5 U2)",
    spec: "[Not named in §16.3 F3. The emit-side face of the §7.5 startup cross-check: a node whose continuity id is unresolved at startup fails the §7.6.1 self-check and emits no advertisement, §5.5 U2 `statement-unavailable`. The node-state transitions that decide it are §16.3 F5's storage-and-anchor cases, declared there.]",
    generated: /^continuity-id-unresolved-at-startup$/,
    unasserted:
      "The corpus carries `continuity-id-unresolved-at-startup` and nothing asserts it: `selfCheck`, `advertisementUnavailable` and `fatalUnderEffectiveRequireE2EE` are read by no suite. Owned by the F3 statement harness. The §5.2 verifier and the node advertisement self-check live in apps/server, and the encoder-side halves are shared-side per-family harness work not taken on in this round.",
  },
  {
    id: "f3-protocol-range",
    family: 3,
    section: "16.3 F3 — Protocol-range cases (§5.2 step 8, §7.6 elements 7–8)",
    spec: "a fully valid, correctly signed statement whose advertised range excludes `E2EE_PROTOCOL_VERSION` — both bounds strictly above it — and one whose range is inverted (`e2eeVersionMin > e2eeVersionMax`). Each MUST be run twice against the same bytes: with the channel's selection not latched, expecting row K3 …, and with the selection latched, expecting `P15`. … A boundary case MUST also carry a range whose minimum equals `E2EE_PROTOCOL_VERSION` and whose maximum is strictly greater, expecting the ordinary K1 path, so the check is a range test and not an equality test.",
    generated: /^protocol-range-/,
    cases: 6,
  },
  {
    id: "f3-admitted-patterns",
    family: 3,
    section: "16.3 F3 — Admitted-pattern cases (§5.2 step 9, §7.6 element 14, §8.2)",
    spec: 'a fully valid, correctly signed statement whose element 14 is exactly ["IK"] … evaluated as a web client, whose tier runs "NX". … that run expects `P15` … The same bytes MUST also be run with the selection not latched, expecting row K3 … A companion case MUST evaluate the identical statement as a native client, whose tier runs "IK", expecting the ordinary K1 path … A further case MUST carry ["IK", "NX"] evaluated as web, also expecting K1.',
    generated: /^admitted-pattern-set-/,
    cases: 5,
  },
  {
    id: "f3-empty-suite-intersection",
    family: 3,
    section: "16.3 F3 — Admitted-pattern cases (§8.2)",
    spec: "[Not named by §16.3. The third §8.2 way a valid, correctly signed statement is unusable — an empty suite intersection — carried beside the step-8 and step-9 cases because it carries the identical channel disposition and would otherwise be the one selection outcome no vector pins.]",
    generated: /^empty-suite-intersection$/,
  },
  {
    id: "f3-s9-direct-signing",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S9)",
    spec: "the largest §7.3, §7.4, and §7.5 transcripts at `E2EE_HUB_ORIGIN_MAX_BYTES` and `E2EE_ACCOUNT_ID_MAX_BYTES`, asserting each is within `E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES` (§3.2.1 S9)",
    generated: /^largest-directly-signed-transcripts$/,
  },
  {
    id: "f3-statement-verifier",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, lower policy generation … and the §5.7 policy-generation recovery pair — a statement at generation N presented to a client holding N + k (rejected, local diagnostic `e2ee_policy_generation_regressed`, no ceremony launched) followed by a statement at a generation strictly above N + k (accepted).",
    declared: /^The §5\.2 step 3, 4, and 7 invalid variants/,
  },
  {
    id: "f3-element-18-arity-and-pin",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "a statement omitting element 18 [this entry covers the omission half] … and a statement whose continuity id differs from the pinned value (channel-fatal with the §13.3 re-verification expectation, not a new-node outcome)",
    declared: /^A statement OMITTING element 18/,
  },
  {
    id: "f3-client-half-of-the-selection-rows",
    family: 3,
    section: "16.3 F3 — Protocol-range and Admitted-pattern cases (§5.2 steps 8–9)",
    spec: "Both cases MUST assert explicitly that no `E2EEClientHello` was produced, since sending one is what an implementation that leaves elements 7–8 unconsumed would do. … Both runs MUST assert explicitly that no `E2EEClientHello` was produced and that the single-use ticket was not spent on one. [this entry covers the client-side assertions; the node-side companions §16.3 also requires are emitted in F12]",
    declared: /^The CLIENT half of the protocol-range and admitted-pattern cases/,
  },
  {
    id: "f3-selection-row-labels",
    family: 3,
    section: "16.3 F3 — Protocol-range and Admitted-pattern cases (§5.2 steps 8–9)",
    spec: "expecting row K3 — unusable evidence, no hello emitted, the ticket not spent on a hello, and the `T_ADV` rows still deciding the channel; and with the selection latched, expecting `P15` [this entry covers the channel dispositions themselves, which are §4.4 client rows and belong to F10]",
    declared: /^The K3\/K2 channel dispositions/,
  },
  {
    id: "f3-cross-runtime",
    family: 3,
    section: "16.4 (recorded against F3)",
    spec: "…the admitted-pattern cases of F3 … MUST also run in the web browser test suite, plus the physical-device pass on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F4 — prekey certificates ───────────────────────────────────────────────
  {
    id: "f4-valid-node-certificate",
    family: 4,
    section: "16.3 F4 (§7.3, §7.4, §6.4)",
    spec: "valid node and client certificates (transcript bytes and signatures) [node half]",
    generated: /^valid-node-agreement-prekey-certificate$/,
  },
  {
    id: "f4-valid-client-certificate",
    family: 4,
    section: "16.3 F4 (§7.3, §7.4, §6.4)",
    spec: "valid node and client certificates (transcript bytes and signatures) [client half]",
    generated: /^valid-client-agreement-prekey-certificate$/,
  },
  {
    id: "f4-node-certificate-variants",
    family: 4,
    section: "16.3 F4 (§7.3)",
    spec: "[Not enumerated individually by §16.3, which states its invalid variants over the client certificate. The same rules applied to the §7.3 NODE certificate: maximum Hub origin within S9, a cross-signature lifted from another Hub origin, carried identity and agreement fingerprints disagreeing with their keys, a prekey id substituted after signing, and usage fields that are not carrier-supplied.]",
    generated: /^node-certificate-/,
    cases: 6,
  },
  {
    id: "f4-clock-skew-boundary",
    family: 4,
    section: "16.3 F4 (§7.3, §7.4, §6.4)",
    spec: "expiry exactly at and one beyond the `E2EE_MAX_CLOCK_SKEW` boundary [carried at both edges of the window: not-yet-valid and expired]",
    generated:
      /^client-certificate-(not-yet-valid|expiry)-(accepted-exactly-at|one-millisecond-beyond)-the-clock-skew-boundary$/,
    cases: 4,
  },
  {
    id: "f4-prekey-lifetime",
    family: 4,
    section: "16.3 F4 (§6.4)",
    spec: "[Not named by §16.3. A certificate whose validity interval runs one millisecond over `E2EE_PREKEY_LIFETIME` — the §6.4 lifetime bound the clock-skew boundary above sits inside.]",
    generated: /^client-certificate-lifetime-one-millisecond-over-the-prekey-lifetime$/,
  },
  {
    id: "f4-wrong-namespace",
    family: 4,
    section: "16.3 F4 (§7.3, §7.4, §6.4)",
    spec: "wrong namespace (`hubOrigin`, `accountId`)",
    generated: /^client-certificate-(wrong-hub-origin-namespace|foreign-account-id-)/,
    cases: 2,
  },
  {
    id: "f4-usage-field-mismatch",
    family: 4,
    section: "16.3 F4 (§7.3, §7.4, §6.4)",
    spec: "valid node and client certificates (transcript bytes and signatures); expiry exactly at and one beyond the `E2EE_MAX_CLOCK_SKEW` boundary; wrong namespace (`hubOrigin`, `accountId`); usage-field mismatch against the suite; strict-decode failures [this entry: usage-field mismatch against the suite]",
    generated: /^client-certificate-usage-field-substituted$/,
  },
  {
    id: "f4-invalid-signature",
    family: 4,
    section: "16.3 F4 (§7.4)",
    spec: "[Not named by §16.3. The §7.4 signature check itself, which every namespace and usage case above sits on top of: an invalid signature, and a certificate signed by another device key.]",
    generated: /^client-certificate-(invalid-signature|signed-by-another-device-key)$/,
    cases: 2,
  },
  {
    id: "f4-max-namespace-s9",
    family: 4,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S9), carried in F4",
    spec: "the largest §7.3, §7.4, and §7.5 transcripts at `E2EE_HUB_ORIGIN_MAX_BYTES` and `E2EE_ACCOUNT_ID_MAX_BYTES`, asserting each is within `E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES` (§3.2.1 S9) [the §7.4 client-certificate half, emitted here beside the certificate it bounds]",
    generated: /^client-certificate-at-the-maximum-namespace-/,
  },
  {
    id: "f4-strict-decode",
    family: 4,
    section: "16.3 F4 (§7.3, §7.4, §6.4)",
    spec: "valid node and client certificates (transcript bytes and signatures); expiry exactly at and one beyond the `E2EE_MAX_CLOCK_SKEW` boundary; wrong namespace (`hubOrigin`, `accountId`); usage-field mismatch against the suite; strict-decode failures [this entry: strict-decode failures, carried once per §3.6 violation class]",
    generated:
      /^client-certificate-(non-canonical|indefinite|trailing|truncated|float|wrong-element)/,
    cases: 6,
  },
  {
    id: "f4-rotation-overlap",
    family: 4,
    section: "16.3 F4 (§6.4)",
    spec: "F4 — Prekey certificates (§7.3, §7.4, §6.4) [§16.3 F4 reaches the §6.4 staged-rotation overlap window only through that section reference; the window is the state in which an outgoing and an incoming prekey both verify]",
    declared: /^The §6\.4 staged-rotation overlap window/,
  },
  {
    id: "f4-statement-step-5",
    family: 4,
    section: "16.3 F3 (§5.2 step 5), carried in F4",
    spec: "[Not named by §16.3 as its own case. The §5.2 step 5 checks a verifier applies to the node prekey carried in a capability statement — lifetime and rotation overlap against the verifier's clock — which F3's valid-statement case reconstructs but does not evaluate.]",
    declared: /^The §5\.2 step 5 checks a VERIFIER applies/,
  },

  // ── F5 — continuity chains ─────────────────────────────────────────────────
  {
    id: "f5-valid-length-one",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "valid chains of length one … with the silent-pin-update expectation [the length-one half, carried once per pin state: no pin held, a pin that already equals the current key, and the pin the chain silently updates]",
    generated: /^valid-chain-(of-length-one-with-silent-pin-update|with-)/,
    cases: 3,
  },
  {
    id: "f5-valid-max-length",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "valid chains … of `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` with the silent-pin-update expectation. … The `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` case MUST be run twice: once with a short test Hub origin, and once with a Hub origin of exactly `E2EE_HUB_ORIGIN_MAX_BYTES`. … Both runs MUST assert the resulting carrier fits `E2EE_CAPABILITY_CARRIER_MAX_BYTES` and that `carrier + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES ≤ E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES`. The long-origin run MUST additionally assert the silent-pin-update expectation is unchanged by origin length.",
    generated: /^valid-max-length-chain-(short|max-length)-hub-origin$/,
    cases: 2,
  },
  {
    id: "f5-missing-link",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link … each channel-fatal with the re-verification expectation",
    generated: /^missing-link$/,
  },
  {
    id: "f5-spliced-key",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: spliced key]",
    generated: /^spliced-key$/,
  },
  {
    id: "f5-reordered",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: reordered entries]",
    generated: /^reordered-entries$/,
  },
  {
    id: "f5-truncated",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: truncated chain, carried at both ends — head and tail]",
    generated: /^truncated-chain-(head|tail)$/,
    cases: 2,
  },
  {
    id: "f5-generation-gap-and-regression",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: generation gap and regression]",
    generated: /^generation-(gap|regression)$/,
    cases: 2,
  },
  {
    id: "f5-invalid-signature",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: invalid signature]",
    generated: /^invalid-signature$/,
  },
  {
    id: "f5-over-length",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: over-length chain]",
    generated: /^over-length-chain$/,
  },
  {
    id: "f5-mixed-continuity-ids",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: mixed continuity ids within the chain]",
    generated: /^mixed-continuity-ids-within-the-chain$/,
  },
  {
    id: "f5-entry-disagrees-with-element-18",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: a chain entry whose continuity id disagrees with statement element 18]",
    generated: /^chain-continuity-id-disagrees-with-statement-element-18$/,
  },
  {
    id: "f5-hub-origin-mismatch",
    family: 5,
    section: "16.3 F5 (§7.5)",
    spec: "[Not named by §16.3. A chain entry bound to a different Hub origin — the §7.5 namespace binding the missing-link and spliced-key cases are stated over.]",
    generated: /^hub-origin-mismatch$/,
  },
  {
    id: "f5-malformed-entry",
    family: 5,
    section: "16.3 F5 (§7.5, §3.6)",
    spec: "[Not named by §16.3. A chain entry whose transcript does not decode under the §3.6 strict profile: peer bytes that fail to decode are a typed failure, never a thrown error.]",
    generated: /^malformed-entry-truncated-transcript$/,
  },
  {
    id: "f5-invalid-identity-key",
    family: 5,
    section: "16.3 F5 (§7.5, §7.1)",
    spec: "[Not named by §16.3. Statement element 5 carrying an invalid identity key — reachable with no chain entries at all, so it is the statement's own failure and never an entry's.]",
    generated: /^invalid-identity-key$/,
  },
  {
    id: "f5-empty-chain",
    family: 5,
    section: "16.3 F3 (§7.6 element 11), carried in F5",
    spec: "a valid statement from a never-rotated node, asserting that element 18 `continuityId` is present with an empty element 11 chain [this entry carries the chain-validation side of that case]",
    generated: /^empty-chain-from-a-never-rotated-node$/,
  },
  {
    id: "f5-pinned-continuity-id",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation",
    declared: /^A chain whose continuity id disagrees with the PINNED value/,
  },
  {
    id: "f5-storage-and-anchor",
    family: 5,
    section: "16.3 F5 — Continuity-id storage and anchor cases (§7.5)",
    spec: "each states the node's stored continuity id, its continuity-id anchor, its chain depth, and its rotation generation, and expects one of the five §7.5 startup outcomes … anchor and stored value both unset (mint exactly once, crash-atomically…); anchor and stored value equal (normal); anchor set with the stored value absent, on a node whose chain is empty and whose rotation generation is 0 — the benign never-rotated restore …; anchor unset with a stored value present (adopt into the anchor, no mint); and anchor and stored value both present and different, plus an unreadable anchor … A migration case MUST cover a node whose identity predates this protocol: one mint at upgrade, durable before the first advertisement.",
    declared: /^The §7\.5 continuity-id storage and anchor cases/,
  },

  // ── F6 / F7 — the two handshakes ───────────────────────────────────────────
  {
    id: "f6-ik-complete-trace",
    family: 6,
    section: "16.3 F6 (§8)",
    spec: "a complete deterministic handshake with every named intermediate as an expected output: context block bytes, `contextCommitment`, prologue bytes, `E2EEClientHello` wire bytes, IK message-1 payload plaintext, `ServerAcceptTBS` bytes, `exporterSecret`, `serverConfirmationKey`, `confirmationTranscript`, `serverConfirmation`, final `E2EEServerAccept` wire bytes, `sessionBindingHash`, `k_c2n`, `k_n2c`, both epoch-0 AEAD keys, and the first protected envelope in each direction (implicit finish included)",
    generated: /^ik-handshake-complete-trace$/,
  },
  {
    id: "f7-nx-complete-trace",
    family: 7,
    section: "16.3 F7 (§8)",
    spec: "the same shape for NX [every named intermediate of the F6 list, for the NX pattern]",
    generated: /^nx-handshake-complete-trace$/,
  },
  {
    id: "f7-empty-message-1-payload",
    family: 7,
    section: "16.3 F7 (§8)",
    spec: "the empty message-1 payload rule (a nonempty payload case expecting failure)",
    generated: /^nx-message-1-payload-must-be-empty$/,
  },
  {
    id: "f7-responder-static-equality",
    family: 7,
    section: "16.3 F7 (§8)",
    spec: "the responder-static byte-equality check (mismatch case expecting failure)",
    generated: /^nx-responder-static-must-equal-the-advertised-prekey$/,
  },
  {
    id: "f7-cross-runtime",
    family: 7,
    section: "16.4 (recorded against F7)",
    spec: "Families exercising web-facing surfaces — F1, F2, F7, F8, F10, … — MUST also run in the web browser test suite, plus the physical-device pass on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F8 — record protection ─────────────────────────────────────────────────
  {
    id: "f8-aad-both-directions",
    family: 8,
    section: "16.3 F8 (§9.1–§9.3)",
    spec: "exact AAD bytes for both directions; envelopes at counters zero and one; a control record consuming the shared sequence; a tampered header byte, a wrong direction label, and a wrong `sessionBindingHash` — each failing authentication [this entry: exact AAD bytes for both directions]",
    generated: /^aad-(client-to-node|node-to-client)$/,
    cases: 2,
  },
  {
    id: "f8-counters-zero-and-one",
    family: 8,
    section: "16.3 F8 (§9.1–§9.3)",
    spec: "envelopes at counters zero and one [carried in both directions]",
    generated: /^envelopes-at-counters-zero-and-one-/,
    cases: 2,
  },
  {
    id: "f8-control-record",
    family: 8,
    section: "16.3 F8 (§9.1–§9.3)",
    spec: "a control record consuming the shared sequence",
    generated: /^control-record-consumes-the-shared-sequence$/,
  },
  {
    id: "f8-tampering",
    family: 8,
    section: "16.3 F8 (§9.1–§9.3)",
    spec: "a tampered header byte … each failing authentication [carried once per §3.3 header field, plus a ciphertext byte and an AEAD-tag byte]",
    generated: /^tampered-(header|ciphertext|aead)-/,
    cases: 6,
  },
  {
    id: "f8-wrong-direction-label",
    family: 8,
    section: "16.3 F8 (§9.1–§9.3)",
    spec: "a wrong direction label … each failing authentication",
    generated: /^wrong-direction-label-fails-authentication$/,
  },
  {
    id: "f8-wrong-session-binding-hash",
    family: 8,
    section: "16.3 F8 (§9.1–§9.3)",
    spec: "a wrong `sessionBindingHash` — each failing authentication",
    generated: /^wrong-session-binding-hash-fails-authentication$/,
  },
  {
    id: "f8-cross-runtime",
    family: 8,
    section: "16.4 (recorded against F8)",
    spec: "Families exercising web-facing surfaces — F1, F2, F7, F8, F10, … — MUST also run in the web browser test suite, plus the physical-device pass on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F9 — rekey boundaries ──────────────────────────────────────────────────
  {
    id: "f9-epoch-schedule",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "epoch secrets and AEAD keys for epochs zero through two in both directions",
    generated: /^epoch-key-schedule-(client-to-node|node-to-client)$/,
    cases: 2,
  },
  {
    id: "f9-record-count-threshold",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "the record-count boundary at `E2EE_REKEY_MAX_RECORDS` (boundary record is the last of its epoch; successor carries epoch +1, counter 0)",
    generated: /^record-count-threshold-boundary$/,
  },
  {
    id: "f9-byte-threshold",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "the byte-threshold crossing at `E2EE_REKEY_MAX_BYTES` (the crossing record is the last)",
    generated: /^byte-threshold-crossing$/,
  },
  {
    id: "f9-epoch-transitions",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "early, late, and skipped epoch transitions (each fatal)",
    generated: /^(early|late|skipped)-epoch-transition$/,
    cases: 3,
  },
  {
    id: "f9-reserve-composition",
    family: 9,
    section: "16.3 F9 (§9.6)",
    spec: "[Not named by §16.3. The composition of the §9.6 post-application reserve itself — `E2EE_CLOSE_RECORDS_RESERVED` plus `E2EE_ERROR_RECORDS_RESERVED` and their plaintext sizes — pinned as the arithmetic every close-reserve and error-reserve case below is asserted against.]",
    generated: /^post-application-reserve-composition$/,
  },
  {
    id: "f9-epoch-exhaustion-close",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "synthetic counter- and epoch-exhaustion states with the authenticated-close expectation — each asserting that a complete close exchange is protected entirely out of the `E2EE_CLOSE_RECORDS_RESERVED` half of the §9.6 post-application reserve in the final epoch, once for the sequential initiator (`E2EEClose` plus final confirmation), once for a simultaneous close (`E2EEClose` plus `E2EECloseAck`), and once for the sequential responder, which leaves the remainder of its reserve unused [epoch-exhaustion half]",
    generated: /^terminal-epoch-(sequential|simultaneous)-close-out-of-the-close-reserve$/,
    cases: 2,
  },
  {
    id: "f9-counter-exhaustion-close",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "synthetic counter- and epoch-exhaustion states with the authenticated-close expectation … once for the sequential initiator …, once for a simultaneous close …, and once for the sequential responder [counter-exhaustion half]",
    generated: /^counter-exhaustion-(sequential|simultaneous)-close-out-of-the-close-reserve$/,
    cases: 2,
  },
  {
    id: "f9-error-reserve",
    family: 9,
    section: "16.3 F9 — Terminal-error reserve cases (§9.6, §10.2, §11.3)",
    spec: "in the terminal epoch: a complete sequential-initiator exchange that has spent both close-machine records, followed by a stray protected envelope, asserting that the resulting `E2EEError` is protected out of `E2EE_ERROR_RECORDS_RESERVED` at the next `(epoch, counter)` with no wrap, no reuse, and no third close-machine record — this is the case that fails against an implementation sizing the reserve at `E2EE_CLOSE_RECORDS_RESERVED` alone; and the same trace from a synthetic state whose remaining capacity covers the close machine but not the error record, expecting the close without the error record and the §11.5 send path unusable observable rather than a wrap or a dropped obligation.",
    generated: /^terminal-epoch-error-record-(out-of-the-error-reserve|without-capacity)$/,
    cases: 2,
  },
  {
    id: "f9-degenerate-state",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "a synthetic state holding less than the post-application reserve, expecting the §9.6 degenerate outcome (no wrap, no reuse, verdict unclean-abrupt)",
    generated: /^degenerate-state-below-the-post-application-reserve$/,
  },
  {
    id: "f9-close-machine-step-trace",
    family: 9,
    section: "16.3 F9 (§9.6, §10.2)",
    spec: "…each asserting that a complete close exchange is protected entirely out of the `E2EE_CLOSE_RECORDS_RESERVED` half of the §9.6 post-application reserve in the final epoch [this entry covers the per-STEP state trace of that exchange — the close machine's state, branch, anchor, pending record and armed waits after each of its records. §16.3 asks for the exchange, and the records it produces are generated and asserted by the entries above; the intermediate machine states were carried and read by nothing, so they were deleted rather than left counted]",
    declared: /^The per-step state trace of the §10\.2 close machine/,
  },

  // ── F10 — mode machine ─────────────────────────────────────────────────────
  {
    id: "f10-legacy-lock-injection",
    family: 10,
    section: "16.3 F10 (§4.4)",
    spec: "The legacy-lock injection cases MUST name their §11 row per §16.2, and the rows are disjoint by §11.2's partition: an envelope after the lock is `P5`, a negotiation record after the lock is `P24` — carried at minimum as a correctly sized, correctly directed `E2EEClientHello` at the node and `E2EEServerAccept` at the client, which are neither over-bound nor misdirected and therefore not `P3` — and an unknown or absent first byte is `P6`. Each MUST also assert the disposition is FATAL-PRE, since no session keys exist in `legacy`.",
    generated: /^legacy-lock-injection-/,
    cases: 5,
  },
  {
    id: "f10-p3-contrast",
    family: 10,
    section: "16.3 F10 (§4.4, §11.2)",
    spec: "…which are neither over-bound nor misdirected and therefore not `P3` [this entry carries the two contrast cases that ARE `P3`: a misdirected negotiation record and an over-bound one, so the P24 rows above are shown to be a partition and not a default]",
    generated: /-is-p3$/,
    cases: 2,
  },
  {
    id: "f10-node-transition-rows",
    family: 10,
    section: "16.3 F10 (§4.4 rows N1–N14)",
    spec: "one case per transition row N1–N17 [and K1–K24, which is the entry below] — input payload bytes and state, expected action and next state — including plaintext injection after E2EE, envelope and negotiation injection after a legacy lock, and an unknown first byte in every state [this entry carries the node rows N1–N14; N15–N17 have their own §16.3 paragraph and their own entry below]",
    generated: /^row-n(?:[1-9]|1[0-4])-/,
    cases: 19,
  },
  {
    id: "f10-client-transition-rows",
    family: 10,
    section: "16.3 F10 (§4.4 rows K1–K24)",
    spec: "one case per transition row [N1–N17 and] K1–K24 — input payload bytes and state, expected action and next state [this entry carries the client half; the node half is generated above]",
    declared: /^Every CLIENT transition row of §4\.4/,
  },
  {
    id: "f10-selection-classification",
    family: 10,
    section: "16.3 F10 (§4.4, §12.1.1) incl. the Account-scope-change cases",
    spec: "The client rows are driven by a §12.1.1 selection classification, which each case MUST state explicitly as an input alongside the payload bytes — and … each case MUST also state the `(hubOrigin, accountId)` scope it runs under and the value of the device-level `anyNodeVerified(hubOrigin)` marker (§13.1). … latched selection with the carrier withheld and `T_ADV` expiring (K14 → FATAL-PRE …); latched selection receiving non-carrier legacy JSON at data sequence 0 (K10 → FATAL-PRE); unexpected selection … (K24 …) and with non-carrier legacy JSON (K23 …); the same unexpected selection after a recorded owner legacy consent (K13 / K9 lock legacy); and a legacy-eligible first-contact selection … with the marker unset (K13 locks legacy). … Account-scope-change cases: the expected row is K24 … a companion case … (K23 …), and a third … expecting K13. No case may combine an unset marker with a `verified` pin … Cases MUST assert the classification is computed before any payload arrives.",
    declared: /^The client rows' §12\.1\.1 selection classification/,
  },
  {
    id: "f10-rows-n15-n17",
    family: 10,
    section: "16.3 F10 (§4.4 rows N15–N17)",
    spec: "Rows N15–N17 are driven by a connection-level input rather than a payload: each case MUST state the asserted `maxDataChunkBytes`, the §7.6.1 self-check result, and the effective `requireE2EE` value, and MUST assert which §12.5 class (if any) recorded an occurrence — including the N17 case, which MUST assert that no peer-legacy occurrence is added on top of N16's.",
    generated: /^row-n1[567]-/,
    cases: 5,
  },
  {
    id: "f10-node-deadline-under-each-policy",
    family: 10,
    section: "16.3 F10 — Timer and keepalive cases (§8.9 deadline)",
    spec: "Node deadline under each policy. `T_HANDSHAKE_NODE` expiry while `negotiating` MUST fire N8 under effective `requireE2EE` and MUST NOT fire it under the compatibility default; the same deadline expiring after row N3 with no authenticated implicit finish MUST be FATAL-POST `Q8` under both policies (§8.9). [The N8-fires half is the row-N8 case claimed by the node-transition-rows entry above; this entry carries the three assertions that are not a row of §4.4's table.]",
    generated: /^node-deadline-/,
    cases: 3,
  },
  {
    id: "f10-client-timer-and-keepalive",
    family: 10,
    section: "16.3 F10 — Timer and keepalive cases (§3.2.2 L1 and L2)",
    spec: "Stalled accept (K15). A valid carrier, a valid hello, and then `E2EEServerAccept` withheld past `T_HANDSHAKE` … no plaintext left the client at any point in `negotiating`, including no keepalive `Ping`. — Buffered keepalive round trip … flushed as an envelope on entering `e2ee` (and as plaintext on entering `legacy` via K13). — Send-buffer overflow. Submissions past `E2EE_NEGOTIATION_BUFFER_MAX_BYTES` while `negotiating`, asserting `e2ee_send_unavailable` … plus a multi-channel accounting case … [the node deadline half of this §16.3 paragraph is generated; this entry carries the three client cases]",
    declared: /^The CLIENT timer and keepalive cases/,
  },
  {
    id: "f10-cross-runtime",
    family: 10,
    section: "16.4 (recorded against F10)",
    spec: "Families exercising web-facing surfaces — F1, F2, F7, F8, F10, … — MUST also run in the web browser test suite … the §16.4 browser run exercises the degenerate web mapping of §12.1.1 instead, including the same withheld-carrier case before and after the session's first validated statement (K13 then K14).",
    declared: CROSS_RUNTIME,
  },

  // ── F11 — authenticated close ──────────────────────────────────────────────
  {
    id: "f11-sequential-clean-close",
    family: 11,
    section: "16.3 F11 (§10)",
    spec: "a sequential clean close (all three records — the initiator's `E2EEClose`, the responder's `E2EECloseAck`, and the initiator's final confirmation, §10.2 — with their bodies, commitments, and both verdicts, which MUST both be Clean)",
    generated: /^sequential-clean-close$/,
  },
  {
    id: "f11-simultaneous-table",
    family: 11,
    section: "16.3 F11 — simultaneous-close table (§10.1.1)",
    spec: "The simultaneous cases MUST pin the §10.1.1 close anchor with explicit counters … Shared state: epoch 0 throughout, initiator I's next-send `(0, 7)`, responder R's next-send `(0, 4)`. [table rows: “Simultaneous close, passing” — both acks satisfy the strict rule against the validator's anchor, verdict Clean at both endpoints; and “Simultaneous close, ack declaring current next-send (negative)” — strict-rule failure at I: FATAL-POST `Q7`, `protocol_violation`, verdict Failed]",
    generated: /^simultaneous-close-(passing|ack-declaring-current-next-send)$/,
    cases: 2,
  },
  {
    id: "f11-close-anchor-epoch-boundary",
    family: 11,
    section: "16.3 F11 — simultaneous-close table (§10.1.1)",
    spec: "[table row] Close anchor across an epoch boundary — I's `E2EEClose` is the last record of epoch `e` under a §9.4 threshold; R's `E2EECloseAck` declares `expectedRecv` `(e + 1, 0)`. Accepted: the anchor is the §9.2/§9.4 advance … A companion negative case declaring `(e, counter + 1)` MUST fail as `Q7`.",
    generated: /^close-anchor-across-an-epoch-boundary/,
    cases: 2,
  },
  {
    id: "f11-passed-through-rule",
    family: 11,
    section: "16.3 F11 (§10)",
    spec: "a sequential clean close (…); the simultaneous cases below; a passed-through-rule violation; a strict-rule violation; a commitment mismatch; and truncation at close (incomplete reassembly, verdict unclean-truncation) [this entry: a passed-through-rule violation]",
    generated: /^passed-through-rule-violation$/,
  },
  {
    id: "f11-strict-rule",
    family: 11,
    section: "16.3 F11 (§10)",
    spec: "a sequential clean close (…); the simultaneous cases below; a passed-through-rule violation; a strict-rule violation; a commitment mismatch; and truncation at close (incomplete reassembly, verdict unclean-truncation) [this entry: a strict-rule violation]",
    generated: /^strict-rule-violation$/,
  },
  {
    id: "f11-commitment-mismatch",
    family: 11,
    section: "16.3 F11 (§10)",
    spec: "a commitment mismatch [carried with the malformed close body it must be distinguished from]",
    generated: /^(commitment-mismatch|malformed-close-body)$/,
    cases: 2,
  },
  {
    id: "f11-truncation",
    family: 11,
    section: "16.3 F11 (§10)",
    spec: "truncation at close (incomplete reassembly, verdict unclean-truncation)",
    generated: /^truncation-at-close$/,
  },
  {
    id: "f11-q7-beyond-expectation",
    family: 11,
    section: "16.3 F11 — Verdict-disambiguation cases (§10.2, §10.4, §11.3 Q6/Q7)",
    spec: "an envelope beyond the machine's expectation — an extra protected record arriving after the endpoint's exchange is complete, carrying any inner type other than `E2EEError` — expecting FATAL-POST `Q7`, `protocol_violation`, one length-uniform `E2EEError` on the wire, and verdict Failed. The case MUST assert explicitly that the verdict is not Unclean — abrupt and that the error record is emitted … and that it is the only record protected after the close machine (§10.2)",
    generated: /^envelope-beyond-the-machines-expectation$/,
  },
  {
    id: "f11-peer-terminal-error",
    family: 11,
    section: "16.3 F11 — Verdict-disambiguation cases (§10.2, §10.4, §11.3 Q6/Q7)",
    spec: "the peer's view of that same trace: an authenticated `E2EEError` arriving after the receiving endpoint's own exchange completed, expecting no record on the wire in reply, verdict Failed, and secrets erased. The case MUST assert explicitly that this is not `Q7` and produces no second error record.",
    generated: /^peer-terminal-error-after-a-completed-exchange$/,
  },
  {
    id: "f11-close-phase-injection",
    family: 11,
    section: "16.3 F11 — Verdict-disambiguation cases (§10.2, §10.4, §11.3 Q6/Q7)",
    spec: "legacy JSON and a negotiation record delivered during the close phase, expecting FATAL-POST `Q6` and verdict Failed, so the close phase is shown to add no exemption to rows N11/K18",
    generated: /-during-the-close-phase$/,
    cases: 2,
  },
  {
    id: "f11-t-close-expiry",
    family: 11,
    section: "16.3 F11 — Verdict-disambiguation cases (§10.2, §10.4, §11.3 Q6/Q7)",
    spec: "a `T_CLOSE` expiry at each waiting step, expecting Unclean — abrupt with no wire record — the contrast case that fixes which events this protocol declines to attribute",
    generated: /^t-close-expiry-/,
    cases: 3,
  },
  {
    id: "f11-precedence",
    family: 11,
    section: "16.3 F11 — Verdict-disambiguation cases (§10.2, §10.4, §11.3 Q6/Q7)",
    spec: "a trace combining an incomplete reassembly with a `Q7` violation, asserting the §10.4 precedence: verdict Failed, not Unclean — truncation",
    generated: /^incomplete-reassembly-with-a-q7-violation$/,
  },
  {
    id: "f11-close-phase-keepalive",
    family: 11,
    section: "16.3 F11 — Close-phase keepalive cases (§10.2, §3.2.2 L5)",
    spec: "no keepalive `Ping` record appears between an endpoint's first close-machine record and the channel's end, in the sequential-initiator, sequential-responder, and simultaneous cases alike, and … a `Ping` submitted during that window is discarded rather than buffered for a later flush. A companion case MUST show why: a `Ping` protected after the initiator's `E2EEClose` makes the responder's `E2EECloseAck` declare an `expectedRecv` past the initiator's close anchor, which the initiator MUST reject as `Q7`.",
    generated: /^no-keepalive-ping-after-the-first-close-machine-record$/,
  },
  {
    id: "f11-late-simultaneous-duration",
    family: 11,
    section: "16.3 F11 — Late-simultaneous phase-duration case (§10.2, §3.2.2 L5)",
    spec: "an endpoint sends `E2EEClose` at `t = 0`; the peer's `E2EEClose` is delivered just inside the first `T_CLOSE` deadline …; the peer's `E2EECloseAck` is delivered just inside the second `T_CLOSE` deadline; and the peer's outer `channel.close` is withheld so the §10.3 linger runs its full `T_CLOSE_LINGER_MAX`. The case MUST assert that the total phase does not exceed `2 · T_CLOSE + T_CLOSE_LINGER_MAX`, that this quantity plus `T_KEEPALIVE_FLUSH_MARGIN` is within `RPC_KEEPALIVE_INTERVAL` (§3.2.2 L5), that the endpoint's verdict is Clean, and that the simultaneous transition did not restart or extend either wait.",
    generated: /^late-simultaneous-phase-duration$/,
  },
  {
    id: "f11-ordering-and-linger",
    family: 11,
    section: "16.3 F11 (§10.3)",
    spec: "Ordering and linger behavior (§10.3) is not expressible as a deterministic wire vector and belongs to implementation tests, not this corpus.",
    declared: /^Ordering and linger behavior \(§10\.3\)/,
  },
  {
    id: "f11-close-machine-step-trace",
    family: 11,
    section: "16.3 F11 (§10.2)",
    spec: "a sequential clean close (all three records … with their bodies, commitments, and both verdicts) … the simultaneous cases below [this entry covers the per-STEP state trace of those exchanges — the machine's state, branch, anchor, pending record and armed waits after each record. The records, bodies, commitments and both verdicts §16.3 names are generated and asserted by the entries above; the intermediate machine states were carried and read by nothing, so they were deleted rather than left counted]",
    declared: /^The per-step state trace of the §10\.2 close machine/,
  },

  // ── F12 — error records ────────────────────────────────────────────────────
  {
    id: "f12-reject-record",
    family: 12,
    section: "16.3 F12 (§11)",
    spec: "the exact, byte-identical `E2EEHandshakeReject` record",
    generated: /^handshake-reject-record$/,
  },
  {
    id: "f12-reject-byte-identity",
    family: 12,
    section: "16.3 F12 (§11)",
    spec: "The reject case MUST be asserted byte-identical across causes — at minimum an absent Branch A record, a `pending` record, a `revoked` record, and a context-commitment mismatch — since those four are precisely the approval-membership classes §11.2 forbids distinguishing.",
    generated: /^handshake-reject-(is-byte-identical-for-|bytes-do-not-vary-by-cause)/,
    cases: 5,
  },
  {
    id: "f12-error-record-per-code",
    family: 12,
    section: "16.3 F12 (§11)",
    spec: "one `E2EEError` envelope per defined code",
    generated: /^error-record-/,
    cases: 3,
  },
  {
    id: "f12-length-uniformity",
    family: 12,
    section: "16.3 F12 (§11)",
    spec: "demonstrating identical envelope lengths",
    generated: /^every-error-envelope-is-length-identical$/,
  },
  {
    id: "f12-node-side-companions",
    family: 12,
    section: "16.3 F3 — Protocol-range and Admitted-pattern cases, carried in F12",
    spec: "A companion node-side case MUST deliver a hello whose `e2eeVersion` lies outside the range the node advertised on that channel, expecting `P9` with the §11.5 observable byte-identical to the F12 reject cases. … A node-side companion MUST deliver an NX hello to a node running `requireApprovedClientE2EE`, expecting `P9` with the §11.5 observable byte-identical to the F12 reject cases. [both emitted here, where that comparison is direct]",
    generated: /^node-side-companion-/,
    cases: 2,
  },
  {
    id: "f12-reject-timing",
    family: 12,
    section: "16.3 F12 (§11.2)",
    spec: "Reject timing is not a fixture assertion: the §11.2 ordering rule that keeps the durable pending write off the response path constrains an implementation, not a wire vector.",
    declared: /^Reject TIMING is deliberately not a fixture assertion/,
  },

  // ── F13 / F14 — fingerprints and verification display ──────────────────────
  {
    id: "f13-fingerprint-families",
    family: 13,
    section: "16.3 F13 (§7.1)",
    spec: "node, client, and agreement fingerprint vectors from the fixture keys, raw digests and `SHA256:` display forms",
    generated: /-key-fingerprint$/,
    cases: 4,
  },
  {
    id: "f14-safety-number",
    family: 14,
    section: "16.3 F14 (§13.4, §13.5)",
    spec: "input arrays, intermediates (`safetyNumberSecret`, `prk`), HKDF outputs, and the exact rendered display strings for fixed inputs. Each rendering case MUST additionally assert its displayed entropy against §3.2.1 S10 and S11. [safety-number half, S10]",
    generated: /^safety-number-/,
    cases: 3,
  },
  {
    id: "f14-web-sas",
    family: 14,
    section: "16.3 F14 (§13.4, §13.5)",
    spec: "input arrays, intermediates (`safetyNumberSecret`, `prk`), HKDF outputs, and the exact rendered display strings for fixed inputs. Each rendering case MUST additionally assert its displayed entropy against §3.2.1 S10 and S11. [`WebSAS` half, S11]",
    generated: /^web-sas-/,
    cases: 3,
  },
  {
    id: "f14-cross-runtime",
    family: 14,
    section: "16.4 (recorded against F14)",
    spec: "…the `WebSAS` half of F14 … MUST also run in the web browser test suite, plus the physical-device pass on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F15 — Noise core vectors ───────────────────────────────────────────────
  {
    id: "f15-cacophony",
    family: 15,
    section: "16.3 F15 (§14.1)",
    spec: "the official cacophony/snow vector sets for `Noise_IK_25519_ChaChaPoly_SHA256` and `Noise_NX_25519_ChaChaPoly_SHA256`, transcoded into the corpus format; the state machine MUST reproduce them exactly [cacophony half]",
    generated: /^cacophony\/Noise_(IK|NX)_25519_ChaChaPoly_SHA256$/,
    cases: 2,
  },
  {
    id: "f15-snow",
    family: 15,
    section: "16.3 F15 (§14.1)",
    spec: "the official cacophony/snow vector sets for `Noise_IK_25519_ChaChaPoly_SHA256` and `Noise_NX_25519_ChaChaPoly_SHA256`, transcoded into the corpus format; the state machine MUST reproduce them exactly [snow half]",
    generated: /^snow\/Noise_(IK|NX)_25519_ChaChaPoly_SHA256$/,
    cases: 2,
  },

  // ── F16 — authorization context and Branch A ───────────────────────────────
  {
    id: "f16-context-blocks",
    family: 16,
    section: "16.3 F16 (§8.3, §7.5, §8.6 steps 6–7, §8.7, §8.9, §11.3 Q9, §13.6)",
    spec: "It reuses the F6 (IK) and F7 (NX) happy-path material and emits the context-block bytes and `contextCommitment` for both tiers, then one case per single-element mutation, each giving the mutated context bytes, the resulting commitment, and the expected outcome",
    generated: /^authorization-context-block-/,
    cases: 2,
  },
  {
    id: "f16-element-9",
    family: 16,
    section: "16.3 F16 (§8.3)",
    spec: "one case per single-element mutation, each giving the mutated context bytes, the resulting commitment, and the expected outcome: element 9 node-fingerprint substitution — `P13`",
    generated: /^element-9-node-fingerprint-substitution$/,
  },
  {
    id: "f16-element-10",
    family: 16,
    section: "16.3 F16 (§8.3)",
    spec: "one case per single-element mutation, each giving the mutated context bytes, the resulting commitment, and the expected outcome: … element 10 cross-account splice — `P13`",
    generated: /^element-10-cross-account-splice$/,
  },
  {
    id: "f16-element-17-both-runs",
    family: 16,
    section: "16.3 F16 (§8.3, §7.5)",
    spec: "element 17 continuity-id substitution — `P13`. This case MUST be run twice: once against a never-rotated node, whose §7.6 element 11 continuity chain is empty and whose context element 15 therefore carries no chain digest, and once against a node at `E2EE_CONTINUITY_CHAIN_MAX_LENGTH`. … The first run MUST additionally assert that the responder rebuilt element 17 from its own stored continuity id.",
    generated: /^element-17-continuity-id-substitution-(never-rotated-node|max-length-chain)$/,
    cases: 2,
  },
  {
    id: "f16-element-11",
    family: 16,
    section: "16.3 F16 (§8.3)",
    spec: "one case per single-element mutation … element 11 capability mismatch against element 13 — `P13`",
    generated: /^element-11-capability-mismatch-against-element-13$/,
  },
  {
    id: "f16-element-12",
    family: 16,
    section: "16.3 F16 (§8.3)",
    spec: "element 12 role escalation above element 14 — `P13`; element 12 role reduction below element 14 — `P13`, since §8.3 makes a difference in either direction a context mismatch",
    generated: /^element-12-role-(escalation-above|reduction-below)-element-14$/,
    cases: 2,
  },
  {
    id: "f16-commitment-preimage",
    family: 16,
    section: "16.3 F16 (§8.3)",
    spec: "a commitment/preimage mismatch: a well-formed context block presented under a `contextCommitment` computed over different bytes — `P13`",
    generated: /^commitment-over-different-bytes-than-the-block$/,
  },
  {
    id: "f16-nx-absence-semantics",
    family: 16,
    section: "16.3 F16 (§8.3)",
    spec: "the NX absence semantics violated: a nonempty element 10 or element 16 on the web tier — `P13`",
    generated: /^nx-absence-semantics-violated$/,
  },
  {
    id: "f16-suite-list-strip",
    family: 16,
    section: "16.3 F16 (§8.7)",
    spec: "a suite-list strip: `offeredSuites` mutated after the hello wire bytes were hashed, expecting confirmation failure (§8.7 hashes exact hello wire bytes), surfaced as `P16` at the client",
    generated: /^suite-list-strip-after-the-hello-was-hashed$/,
  },
  {
    id: "f16-advertised-snapshot",
    family: 16,
    section: "16.3 F16 — Advertised-snapshot cases (§8.3, §7.5, §8.6 step 7)",
    spec: "an identity rotation appending a continuity certificate in that window — the handshake completes, against the chain and identity fingerprint the statement advertised … ; the same window at `E2EE_CONTINUITY_CHAIN_MAX_LENGTH`, where the append also prunes the oldest entry — same expectation, and the case MUST assert the pruned entry's digest is still present in the channel's element 15; a prekey rotation in the same window, asserting the handshake completes against the prekey advertised on that channel (§6.4) and that element 15's entry 0 is the advertised agreement fingerprint",
    generated:
      /^(identity|prekey)-rotation-(between-advertisement-and-hello|at-max-chain-length-prunes-the-oldest-entry)$/,
    cases: 3,
  },
  {
    id: "f16-next-channel",
    family: 16,
    section: "16.3 F16 — Advertised-snapshot cases (§8.3, §7.5, §8.6 step 7)",
    spec: "the next channel opened after either change, asserting its statement and its element 15 carry the new material — the snapshot is per channel and never a freeze of the node",
    generated: /^next-channel-carries-the-new-material$/,
  },
  {
    id: "f16-branch-a-record-states",
    family: 16,
    section: "16.3 F16 — Branch A record-state cases (§8.6 step 6, §11.2)",
    spec: "Each case MUST state the node's Branch A record for `(hubOrigin, accountId, clientIdentityFingerprint)` as an explicit input … record absent, `pending`, `revoked`, an approved record whose `capabilitySet` excludes the requested capability, and an approved record whose `maxRole` is below the requested role. All five expect `P12`, and each MUST assert the §11.5 observable is byte-identical to the others and to the F12 reject cases.",
    generated: /^branch-a-record-/,
    cases: 5,
  },
  {
    id: "f16-withdrawal-cases",
    family: 16,
    section: "16.3 F16 — Authorization-withdrawal cases (§13.6, §8.9, §11.3 Q9)",
    spec: "`status approved → revoked` — withdrawn; Q9, code `policy`; `maxRole owner → viewer` with `status` unchanged at `approved` — withdrawn; Q9 … run once against a channel admitted at element-12 `owner` and once against a channel admitted at element-12 `viewer`, both expecting Q9; `capabilitySet` losing a member the snapshot held … — withdrawn; Q9; a withdrawal applied to the same client fingerprint under a different `(hubOrigin, accountId)` scope — not withdrawn for this channel …; a withdrawal landing between §8.6 step 6 and row N3 — the in-flight abort, which MUST take the generic fixed-size `E2EEHandshakeReject` … never a `policy` code; a withdrawal landing after row N3 but before the authenticated implicit finish — Q9, per §8.9 [this last is carried as the `implicitFinish` expectation on each withdrawal case above, not as a separate case]",
    generated: /^withdrawal-/,
    cases: 7,
  },
  {
    id: "f16-widening-cases",
    family: 16,
    section: "16.3 F16 — Authorization-withdrawal cases (§13.6, §8.9, §11.3 Q9)",
    spec: "a widening — first approval, re-approval, `maxRole` increase, `capabilitySet` addition — not withdrawn; the channel stays open and the widened authority reaches it only on a fresh ticket, channel, and handshake",
    generated: /^widening-/,
    cases: 4,
  },
  {
    id: "f16-combined-narrow-and-widen",
    family: 16,
    section: "16.3 F16 — Authorization-withdrawal cases (§13.6, §8.9, §11.3 Q9)",
    spec: "a combined narrow-and-widen command — withdrawn, because it contains a reduction",
    generated: /^combined-narrow-and-widen-is-a-withdrawal$/,
  },
  {
    id: "f16-nx-never-swept",
    family: 16,
    section: "16.3 F16 — Authorization-withdrawal cases (§13.6, §8.9, §11.3 Q9)",
    spec: "an NX channel present while any of the above is applied — no snapshot, no re-check, never matched by the sweep, and asserted to stay open (§12.4 governs NX admission instead)",
    generated: /^nx-channel-is-never-matched-by-an-authorization-withdrawal$/,
  },
  {
    id: "f16-pending-cap",
    family: 16,
    section: "16.3 F16 — Pending-cap and pairing-window cases (§13.6, §11.2, §15, §3.2.2 L4)",
    spec: "each states the pending set with each record's partition and `pairingReservedAt`, whether a window is open and which discriminator it names, and the attempt's authenticated `clientIdentityFingerprint`. The corpus MUST carry, at minimum: a cap-exceeding attempt with no window …; a window open and the attempt's fingerprint not matching the discriminator …; a matching attempt exceeding only `E2EE_PENDING_CLIENTS_MAX_PER_ACCOUNT` …; a matching attempt exceeding only `E2EE_PENDING_CLIENTS_MAX_GLOBAL` …; a matching attempt exceeding both …; a second matching attempt in the same window …; an eviction candidate set in which every record holds an unexpired reservation …; the same set with one reservation aged past `E2EE_PAIRING_RESERVATION_LIFETIME` …; and, in every one of these cases, the assertion that `approved` and `revoked` records were untouched and that the §11.5 observable was byte-identical throughout.",
    declared: /^The §13\.6 pending-cap and pairing-window cases/,
  },
  {
    id: "f16-cross-runtime",
    family: 16,
    section: "16.4 (recorded against F16)",
    spec: "…the NX cases of F16 … MUST also run in the web browser test suite, plus the physical-device pass on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F17 — key-material validation ──────────────────────────────────────────
  {
    id: "f17-x25519-all-zero",
    family: 17,
    section: "16.3 F17 (§8.1)",
    spec: "an X25519 input producing an all-zero shared secret from a low-order point, expecting the single mandated behavior of §8.1 — abort, `P10` — in both the IK and NX handshake positions",
    generated: /^x25519-all-zero-shared-secret-/,
    cases: 2,
  },
  {
    id: "f17-p256-public-keys",
    family: 17,
    section: "16.3 F17 (§7.1)",
    spec: "P-256 public keys that are off the curve, have a coordinate at or above the field prime, are the identity, or carry a first byte other than `0x04` (compressed and hybrid prefixes included) — each rejected by §7.1 before any signature check",
    generated: /^p256-public-key-/,
    cases: 10,
  },
  {
    id: "f17-p256-signatures",
    family: 17,
    section: "16.3 F17 (§7.1)",
    spec: "P-256 ECDSA signatures presented as ASN.1/DER instead of fixed-width raw `r ‖ s`, and raw signatures with `r` or `s` equal to zero or at or above the group order — each rejected [seven cases: DER; `r` zero; `s` zero; `r` at the order; `s` at the order; `r` above the order; `s` above the order]",
    generated: /^p256-signature-/,
    cases: 7,
  },
  {
    id: "f17-ed25519-canonicality",
    family: 17,
    section: "16.3 F17 (§14.3)",
    spec: "Ed25519 signatures that are non-canonical in point or scalar encoding — values a ZIP215-style verifier accepts and RFC 8032 MUST reject (§14.3)",
    generated: /^ed25519-(public-key|signature)-/,
    cases: 6,
  },
  {
    id: "f17-cross-domain-substitution",
    family: 17,
    section: "16.3 F17 (§3.5, §7.2)",
    spec: "cross-domain signature substitution: one valid signature per §3.5 transcript domain — node prekey, client prekey, capability statement (through the §7.2.1 envelope), identity continuity, and the node-identity domains — replayed into every other domain's verification path, all rejected. This is the vector behind the §7.2 no-ad-hoc-transcript rule.",
    generated: /^cross-domain-signature-substitution$/,
  },
  {
    id: "f17-position-rows",
    family: 17,
    section: "16.3 F17 (§11, §5.2, §8.6 step 5, §12.1.1)",
    spec: "Each case MUST name the §11 outcome for the position the material occupies: `P11` for material inside the IK client certificate (§8.6 step 5); rows K2/K3 — and `P15` when the channel's selection is latched — for material inside a node-signed capability statement, prekey, or continuity certificate (§5.2, §12.1.1); and `P10` for a Noise-level failure.",
    declared: /^Each case names the §11 row for the position/,
  },
  {
    id: "f17-small-order-ed25519",
    family: 17,
    section: "16.3 F17 (§14.3)",
    spec: "[Not named by §16.3. A small-order Ed25519 public key as a rejected ENCODING: the corpus records why it is absent rather than emitting a rejection the pinned primitive's validator does not produce — the rejection happens at verification instead.]",
    declared: /^A small-order Ed25519 public key is NOT emitted/,
  },
  {
    id: "f17-cross-runtime",
    family: 17,
    section: "16.4 (recorded against F17)",
    spec: "…the P-256 cases of F17 … MUST also run in the web browser test suite, plus the physical-device pass on both mobile platforms.",
    declared: CROSS_RUNTIME,
  },

  // ── F18 — node admission policy transitions ────────────────────────────────
  {
    id: "f18-effective-admitted-patterns",
    family: 18,
    section: "16.3 F18 (§12.3, §12.4)",
    spec: "each states the node's pre-change policy (`requireE2EE`, `requireApprovedClientE2EE`, suite registry, effective admitted pattern set) and policy generation [this entry carries the effective admitted pattern set itself, per §12.4 policy combination]",
    generated: /^effective-admitted-patterns-by-policy$/,
  },
  {
    id: "f18-p25-in-flight-abort",
    family: 18,
    section: "16.3 F18 (§11.2 P25, §8.6 step 2, §12.6)",
    spec: "an in-flight handshake that passed §8.6 step 2 under the old policy and has not reached row N3 — aborted as FATAL-PRE naming §11.2 `P25`, with the generic fixed-size `E2EEHandshakeReject`, asserted byte-identical to the F12 reject cases and never a `policy` code, exactly as F16's in-flight authorization abort names `P12`. The case MUST name `P25` and not `P9`: P9 is defined at §8.6 step 2 and this handshake passed it.",
    generated: /^in-flight-handshake-aborted-by-a-policy-withdrawal$/,
  },
  {
    id: "f18-require-e2ee-narrowing",
    family: 18,
    section: "16.3 F18 (§12.6 per-channel bullets)",
    spec: "`requireE2EE` false → true with one `legacy` channel, one NX `e2ee` channel, and one IK `e2ee` channel open — the `legacy` channel withdrawn and closed with reason `channel_rejected` and no record of any kind, both `e2ee` channels untouched. The case MUST assert explicitly that no `E2EEHandshakeReject` was emitted on the `legacy` channel, since that is the plausible wrong implementation and would be row K21 at the peer",
    generated: /^require-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel$/,
  },
  {
    id: "f18-require-approved-narrowing",
    family: 18,
    section: "16.3 F18 (§12.6 per-channel bullets)",
    spec: "`requireApprovedClientE2EE` false → true over the same three channels — the `legacy` channel and the NX `e2ee` channel both withdrawn, the NX channel as FATAL-POST `Q12` with code `policy` and one length-uniform `E2EEError`, and the IK channel asserted to stay open, since §8.6 step 6 admitted it only against an `approved` record",
    generated: /^require-approved-client-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel$/,
  },
  {
    id: "f18-suite-clause-both-tiers",
    family: 18,
    section: "16.3 F18 (§12.6 suite bullet)",
    spec: "a suite leaving the advertised registry with an `e2ee` channel established on that suite — withdrawn, `Q12`; and a companion channel on a retained suite — not withdrawn. This case MUST be run twice against the same command: once with the established channel's handshake IK and once with it NX, both expecting `Q12`, since §12.6's suite clause is tier-independent and a generator free to pick a tier would leave the rule pinned by prose alone. The IK run MUST additionally carry an unchanged `approved` Branch A record and assert the channel is closed anyway, since \"the record is still approved\" is the plausible wrong exemption",
    generated: /^a-suite-leaving-the-registry-closes-the-(?:ik|nx)-channel-established-on-it$/,
    cases: 2,
  },
  {
    id: "f18-widening",
    family: 18,
    section: "16.3 F18 (§12.6 widening, §5.7)",
    spec: "a widening — `requireE2EE` or `requireApprovedClientE2EE` true → false, a suite added — asserting that no channel is closed and that the policy generation still advances (§5.7)",
    generated: /^a-widening-closes-nothing-and-still-advances-the-policy-generation$/,
  },
  {
    id: "f18-combined-narrow-and-widen",
    family: 18,
    section: "16.3 F18 (§12.6 combined command)",
    spec: "a combined narrow-and-widen command — a withdrawal, because it contains a reduction, with the same per-channel expectations as the narrowing alone",
    generated: /^a-combined-narrow-and-widen-command-is-a-withdrawal$/,
  },
  {
    id: "f18-negotiating-channel",
    family: 18,
    section: "16.3 F18 (§12.6, §8.6 step 2, §4.4 N1)",
    spec: "a `negotiating` channel present while any of the above is applied — asserted not swept, and then asserted fail-closed on its next input: a hello whose tier the new policy refuses is `P9`, legacy JSON under a newly effective `requireE2EE` is row N1",
    generated: /^a-negotiating-channel-is-not-swept-and-then-fails-closed-on-/,
    cases: 2,
  },
  {
    id: "f18-ordering-commit-first",
    family: 18,
    section: "16.3 F18 (§12.6 ordering)",
    spec: "the ordering itself: a hello that reaches §8.6 step 2 after the durable commit reads the narrowed policy and is refused there, asserting that no channel can be established behind a sweep that has already passed",
    generated: /^a-hello-reaching-step-2-after-the-durable-commit-is-refused-there$/,
  },
  {
    id: "f18-row-n3-race",
    family: 18,
    section: "16.3 F18 (§12.6 the row-N3 race)",
    spec: "the row-N3 race … a handshake that passed §8.6 step 2 under the old policy and whose row-N3 transition is scheduled to land concurrently with the sweep, between the live-channel enumeration and the in-flight enumeration. The case MUST assert that the channel is accounted for exactly once and is not left open — closed as `Q12` and counted in the step (c) `e2ee` class if it reached row N3, or aborted as `P25` and counted in the in-flight class if it did not — and MUST be run with the two enumerations attempted in both orders",
    generated: /^the-row-n3-race-with-the-/,
    cases: 2,
  },
  {
    id: "f18-step-c-counts",
    family: 18,
    section: "16.3 F18 (§12.6 step (c))",
    spec: "the reported counts of §12.6 step (c), broken out by class — `legacy`, NX `e2ee`, suite-withdrawn `e2ee` of either tier, and in-flight handshakes aborted — asserted against the channel set, so a channel missed by one of the two enumerations is visible as a count and not only as a surviving channel",
    generated: /^step-c-counts-broken-out-by-class$/,
  },
  {
    id: "f18-fallback-non-interaction",
    family: 18,
    section: "16.3 F18 (§12.5 non-interaction, §12.6)",
    spec: "the §12.5 non-interaction: every case above MUST assert that no fallback occurrence of either class was recorded by the withdrawal (§12.6), since the sweep is an operator action and not a legacy acceptance",
    generated: /^no-withdrawal-records-a-fallback-occurrence-of-either-class$/,
  },
  // ── F19 — account-enrolled native authorization ──────────────────────────
  {
    id: "f19-valid-grant-artifacts",
    family: 19,
    section: "16.3 F19 (§18.3)",
    spec: "exact grant claims, signing input, signature, envelope, and envelope digest for a valid deterministic trace",
    generated: /^valid-account-enrolled-native-device-grant$/,
  },
  {
    id: "f19-grant-bounds",
    family: 19,
    section: "16.3 F19 (§18.2, §18.3)",
    spec: "minimum and maximum conforming fields, the exact 2,048-byte envelope boundary, and one-byte-over rejection before CBOR or signature work [the minimum semantic fields are the valid-grant case above]",
    generated:
      /^(?:maximum-width-conforming-grant-fits-the-hard-envelope-bound|exactly-2048-bytes-is-not-rejected-as-oversize|one-byte-over-the-grant-bound-is-rejected-before-cbor)$/,
    cases: 3,
  },
  {
    id: "f19-malformed-canonical-shapes",
    family: 19,
    section: "16.3 F19 (§18.3)",
    spec: "malformed and non-canonical arrays, wrong element counts/types, and excess fields [the landed shared slice carries malformed, non-canonical, and wrong-count cases; remaining semantic boundary cases stay covered by contract/unit tests]",
    generated:
      /^(?:malformed-grant-envelope|non-canonical-grant-envelope|wrong-grant-claims-element-count)$/,
    cases: 3,
  },
  {
    id: "f19-version-suite",
    family: 19,
    section: "16.3 F19 (§18.3)",
    spec: "unsupported versions and unsupported account-grant suite identifiers",
    generated: /^unsupported-grant-(?:version|suite)$/,
    cases: 2,
  },
  {
    id: "f19-fingerprint-recomputation",
    family: 19,
    section: "16.3 F19 (§18.3, §18.7)",
    spec: "both device keys and fingerprints, node keys/fingerprints [one carried-fingerprint substitution pins recomputation; caller-binding substitutions below cover every raw key]",
    generated: /^carried-device-fingerprint-is-recomputed$/,
  },
  {
    id: "f19-signatures",
    family: 19,
    section: "16.3 F19 (§18.3)",
    spec: "non-canonical Ed25519 signatures, and cross-domain signature substitution [wrong-key and bare-claims cross-domain substitutions in this slice]",
    generated: /^(?:signature-under-an-unrelated-hub-key|cross-domain-signature-over-bare-claims)$/,
    cases: 2,
  },
  {
    id: "f19-keyset",
    family: 19,
    section: "16.3 F19 (§18.3)",
    spec: "unknown or retired signing keys, and duplicate key ids",
    generated:
      /^(?:unknown-hub-verification-key-id|duplicate-hub-verification-key-id|retired-hub-verification-key)$/,
    cases: 3,
  },
  {
    id: "f19-time-window",
    family: 19,
    section: "16.3 F19 (§18.3)",
    spec: "expired and future grants, including each exact clock-skew and expiry boundary",
    generated:
      /^grant-(?:one-millisecond-beyond-early-clock-skew|at-the-early-clock-skew-boundary|one-millisecond-after-expiry|at-the-exact-expiry-boundary)$/,
    cases: 4,
  },
  {
    id: "f19-caller-bindings",
    family: 19,
    section: "16.3 F19 (§18.7)",
    spec: "every binding changed one at a time: origin, account/device epoch, enrollment/revision, both device keys, certificate digest, node id/keys/continuity/policy generation, statement digest, ticket id, and replay on another ticket",
    generated: /^wrong-.*-binding$/,
    cases: 16,
  },
  {
    id: "f19-dependency-expiries",
    family: 19,
    section: "16.3 F19 (§18.3, §18.7)",
    spec: "each time bound [relay ticket, client certificate, node statement, and node agreement prekey must each outlive the grant]",
    generated:
      /^(?:relay-ticket|client-certificate|node-statement|node-prekey)-expires-before-the-grant$/,
    cases: 4,
  },
  {
    id: "f19-revocation",
    family: 19,
    section: "16.3 F19 (§18.7)",
    spec: "revocation [the pure verifier's already-revoked enrollment verdict]",
    generated: /^revoked-enrollment$/,
  },
  {
    id: "f19-authority-intersection",
    family: 19,
    section: "16.3 F19 (§18.7)",
    spec: "role/capability escalation, verified-pin/local-denial precedence, and exact authority intersection [pure grant/policy intersection cases]",
    generated:
      /^(?:local-policy-denies-account-grant|effective-role-escalates-above-grant-ceiling|effective-capabilities-are-not-a-distinct-subset)$/,
    cases: 3,
  },
  {
    id: "f19-account-grant-ik-trace",
    family: 19,
    section: "16.3 F19 (§18.4, §18.6)",
    spec: "certificate carrier and digest, suite-0x02 context block/commitment, hello, both Noise messages, confirmation, sessionBindingHash, and both directional epoch-zero secrets",
    declared: /^§16\.3 F19 suite-0x02 context, Noise trace, and confirmation vectors are deferred/,
  },
  {
    id: "f19-relay-and-node-lifecycle",
    family: 19,
    section: "16.3 F19 (§18.5, §18.7, §18.8)",
    spec: "relay minor 2, partial channel.open context, stale connector generation, unacknowledged statement, missing retained prekey, revocation during in-flight/established channels, four policy modes, local precedence, authority intersection, and no durable approved-client write",
    declared: /^§16\.3 F19 relay-minor, connector-generation, statement-acknowledgement/,
  },
  {
    id: "f19-web-isolation",
    family: 19,
    section: "16.3 F19 (§18.1, §18.9)",
    spec: "Web-only negative cases proving suite selection/failure, grant-free browser tickets, mixed-response rejection, and no grant canary in decoder, state, DOM, service-worker cache, or relay send",
    declared: /^§16\.3 F19 Web-isolation vectors are deferred/,
  },
  {
    id: "f19-cross-runtime",
    family: 19,
    section: "16.4",
    spec: "F19's Web-isolation cases MUST also run in the web browser test suite and the complete corpus on physical mobile devices before native E2EE ships",
    declared: CROSS_RUNTIME,
  },
];

describe("§16.3 coverage ledger", () => {
  it("is well formed: unique ids, one resolution each, every family accounted for", () => {
    const ids = SECTION_16_3_LEDGER.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SECTION_16_3_LEDGER) {
      expect((entry.generated === undefined) !== (entry.declared === undefined), entry.id).toBe(
        true,
      );
      expect(FAMILY_FILES.has(entry.family), entry.id).toBe(true);
    }
    const covered = new Set(SECTION_16_3_LEDGER.map((entry) => entry.family));
    for (let family = 1; family <= 19; family += 1) {
      expect(covered.has(family), `family F${String(family)}`).toBe(true);
    }
  });

  it("keeps every entry reviewable against the specification, which is all this can check", () => {
    // READ THE HEADER ABOVE THE LEDGER BEFORE READING THIS TEST. Fidelity to
    // §16.3 is NOT checked here and is not checked anywhere: the specification
    // is prose and nothing parses it. What this asserts is only that the two
    // fields a REVIEWER needs for the by-eye diff are present and usable on
    // every entry — a pointer into §16.3 and the specification's own words for
    // the obligation. An entry that carried an empty `spec`, or a `section`
    // pointing outside section 16, would make that review impossible to do
    // mechanically, and that failure mode at least IS mechanical.
    for (const entry of SECTION_16_3_LEDGER) {
      // §16.3 for the vector families; §16.4 for the cross-runtime runs, which
      // §16.4 states and each family repeats in its own deferral list.
      expect(entry.section, entry.id).toMatch(/^16\.[34]\b/);
      // Long enough to be an OBLIGATION rather than a label. §16.3 states
      // several of its cases in two or three words ("spliced key", "reordered
      // entries"), which read as nothing on their own, so those entries carry
      // the enclosing §16.3 sentence and a bracketed marker of which item in it
      // they cover. The floor is what stops the next entry from being a label.
      expect(entry.spec.trim().length, entry.id).toBeGreaterThanOrEqual(40);
      // Balanced brackets, so the "[transcriber's addition]" convention the
      // header defines cannot decay into unmarked paraphrase mid-sentence.
      expect(entry.spec.split("[").length, `${entry.id}: unbalanced [] in its spec text`).toBe(
        entry.spec.split("]").length,
      );
    }
    // The ledger is one array with one entry per obligation, and this is what a
    // reviewer counts against §16.3's bullets. Pinning the total means growing
    // or shrinking the ledger is a deliberate, visible edit rather than a line
    // that slips in with an unrelated change.
    expect(SECTION_16_3_LEDGER.length).toBe(186);
  });

  it("resolves every §16.3-named case as generated or as declared, never as neither", () => {
    // The assertion the corpus lacked. A case that §16.3 names and the corpus
    // neither carries nor declares fails HERE, by id, instead of disappearing
    // between a present family file and a deferral list that does not mention it.
    for (const entry of SECTION_16_3_LEDGER) {
      const family = familyByNumber(entry.family);
      if (entry.generated !== undefined) {
        // How MANY cases it must be generated by is the next test's subject.
        const matches = family.cases.filter((fixture) => entry.generated!.test(fixture.name));
        expect(matches.length, `${entry.id} is generated by no case`).toBeGreaterThan(0);
        continue;
      }
      const declarations = (family.deferred ?? []).filter((reason) => entry.declared!.test(reason));
      expect(declarations.length, `${entry.id} is declared by no deferral`).toBe(1);
      // A deferral is only a deferral if it says who will own the missing work,
      // or says in as many words that §16.3 excludes the case from the corpus on
      // purpose. "Missing, and nobody said why" is what this rules out.
      expect(declarations[0]!.length, entry.id).toBeGreaterThan(40);
      expect(
        /owned by|belongs to implementation tests|constrains an implementation|would have been wrong/i.test(
          declarations[0]!,
        ),
        entry.id,
      ).toBe(true);
    }
  });

  it("pins each generated obligation to its exact case count, so no group carries slack", () => {
    // THE PROPERTY THE HEADER CLAIMS, ASSERTED RATHER THAN ASSERTED IN PROSE.
    //
    // `cases` was a FLOOR until this test existed, and a floor is one-sided: an
    // obligation reading `atLeast: 18` against NINETEEN committed cases passed
    // with a case to spare, so one of its nineteen could be deleted and every
    // ledger test — including the one directly above, which is why this is a
    // separate test and not a tightened line inside it — stayed green. That is
    // exactly the silent loss the count exists to prevent, reintroduced by the
    // number that was supposed to prevent it. It had drifted that way once
    // already, in a ledger whose own header claimed the slack was zero.
    //
    // Exactness closes it in both directions at once. A case deleted from a
    // group drops the count below the number and fails; a case ADDED to a group
    // raises it above and fails too — which matters as much, because a group
    // that silently grows is an entry that has stopped describing the corpus
    // while still reading as if it does. Neither direction is a hardship: both
    // are one edit to this number, in the commit that moved the case.
    for (const entry of SECTION_16_3_LEDGER) {
      if (entry.generated === undefined) {
        // A deferral stands for work not carried, so it has no case count, and
        // carrying one would be a claim about cases that do not exist.
        expect(entry.cases, `${entry.id} is declared, so it may not state a case count`).toBe(
          undefined,
        );
        continue;
      }
      const matches = familyByNumber(entry.family).cases.filter((fixture) =>
        entry.generated!.test(fixture.name),
      );
      expect(
        matches.length,
        `${entry.id}: ${String(matches.length)} committed cases match, the ledger says ${String(entry.cases ?? 1)} — update the entry in the same commit as the case`,
      ).toBe(entry.cases ?? 1);
      // …and the omitted form means one, never "unspecified": an entry that
      // wrote `cases: 1` and one that omitted it must not be different things.
      expect(entry.cases, `${entry.id}: a count of one is written by omitting it`).not.toBe(1);
    }
  });

  it("claims every committed case, so a case cannot be added outside the ledger", () => {
    // The other direction. Without it the ledger could silently fall behind the
    // corpus, and an obligation that no longer matches anything would read as
    // satisfied by whatever case happened to share its prefix.
    for (const [number, file] of FAMILY_FILES) {
      const family = familyByNumber(number);
      const matchers = SECTION_16_3_LEDGER.filter(
        (entry) => entry.family === number && entry.generated !== undefined,
      );
      for (const fixture of family.cases) {
        expect(
          matchers.some((entry) => entry.generated!.test(fixture.name)),
          `${file}: case ${fixture.name} is claimed by no ledger obligation`,
        ).toBe(true);
      }
    }
  });

  it("gives each committed case to exactly one obligation, so one case cannot discharge two", () => {
    // THE HOLE THIS CLOSES IS HOW THE LEDGER GETS DEFEATED BY RELABELLING.
    //
    // "Claims every committed case" is a lower bound: it fails when a case has
    // NO obligation. It cannot fail when a case has two. So an obligation whose
    // work was never done could be moved from `declared` to `generated` and
    // pointed at a case some OTHER obligation already discharges — no fixture
    // written, no deferral left behind, and every ledger test still green. The
    // ledger would then read as covering more than the corpus carries, which is
    // strictly worse than reading as covering less: an honest gap becomes a
    // false assurance, and the gap is invisible in exactly the place a reader
    // goes to look for it.
    //
    // The rule is therefore a PARTITION, not a covering: the generated
    // obligations of a family carve its cases into disjoint sets. A genuinely
    // shared case is a sign that one obligation is really two halves of the same
    // §16.3 clause, which is one entry; or that the second half is not carried,
    // which is a deferral. Both are expressible. "Two obligations, one case" is
    // not, and that is the point.
    for (const [number, file] of FAMILY_FILES) {
      const family = familyByNumber(number);
      const matchers = SECTION_16_3_LEDGER.filter(
        (entry) => entry.family === number && entry.generated !== undefined,
      );
      for (const fixture of family.cases) {
        const claims = matchers.filter((entry) => entry.generated!.test(fixture.name));
        expect(
          claims.map((entry) => entry.id),
          `${file}: case ${fixture.name} is claimed by more than one obligation`,
        ).toHaveLength(1);
      }
    }
  });

  it("claims every declared deferral, so a deferral cannot be written outside the ledger", () => {
    // The bijection that makes "declared" mean something. A family that grows a
    // deferral no obligation names — the shape a quietly dropped case takes —
    // fails here, and so does an obligation whose deferral was deleted.
    for (const [number, file] of FAMILY_FILES) {
      const family = familyByNumber(number);
      const declarations = SECTION_16_3_LEDGER.filter(
        (entry) => entry.family === number && entry.declared !== undefined,
      );
      for (const reason of family.deferred ?? []) {
        const claims = declarations.filter((entry) => entry.declared!.test(reason));
        expect(
          claims.length,
          `${file}: deferral not claimed by exactly one obligation: ${reason}`,
        ).toBe(1);
      }
      expect(
        (family.deferred ?? []).length,
        `${file}: declared obligations and deferrals disagree`,
      ).toBe(declarations.length);
    }
  });

  it("keeps the manifest's partialFamilies exhaustive and in step with the family files", () => {
    // The manifest is what a reader of the corpus alone opens first, so the two
    // must agree in BOTH directions: every family with a deferral is listed, and
    // nothing is listed that has none.
    const listed = new Map(MANIFEST.partialFamilies.map((entry) => [entry.file, entry]));
    expect(listed.size).toBe(MANIFEST.partialFamilies.length);
    for (const [number, file] of FAMILY_FILES) {
      const family = familyByNumber(number);
      const deferred = family.deferred ?? [];
      const manifestEntry = MANIFEST.files[file];
      expect(manifestEntry, file).toBeDefined();
      expect(manifestEntry!.family, file).toBe(number);
      expect(manifestEntry!.deferred ?? [], file).toEqual(deferred);
      if (deferred.length === 0) {
        expect(listed.has(file), `${file} defers nothing and must not be listed as partial`).toBe(
          false,
        );
        continue;
      }
      expect(listed.get(file)?.deferred, file).toEqual(deferred);
      expect(listed.get(file)?.family, file).toBe(number);
    }
    // Nothing is wholesale-omitted; every F1–F19 has a file on disk.
    expect(MANIFEST.deferredFamilies).toEqual([]);
    expect(Object.keys(MANIFEST.files).toSorted()).toEqual([...FAMILY_FILES.values()].toSorted());
    // The families that defer NOTHING, named so the set cannot shrink unnoticed.
    const complete = [...FAMILY_FILES.keys()].filter(
      (number) => (familyByNumber(number).deferred ?? []).length === 0,
    );
    expect(complete).toEqual([6, 13, 15, 18]);
  });

  it("records the ledger's own fidelity limitation in the manifest, not only in this file", () => {
    // The residual is a property of the COVERAGE MACHINERY, so a reader who
    // opens the fixtures and their manifest — and never opens this test — would
    // otherwise see `deferred` lists that look exhaustive and have no way to
    // learn that their exhaustiveness rests on a hand-written transcription of
    // a prose section. The manifest carries the same statement this file's
    // ledger header makes, and this test is what keeps the two from drifting to
    // the point where one of them quietly stops saying it.
    const fidelity = MANIFEST.ledgerFidelity;
    expect(fidelity.section).toBe("16.3");
    expect(fidelity.status).toBe("hand-maintained-transcription");
    expect(fidelity.ledger).toContain("SECTION_16_3_LEDGER");
    expect(fidelity.ledger).toContain("relayE2eeCorpus.test.ts");
    // The negative half is the half that matters, and it must say what is NOT
    // established rather than merely that something is imperfect.
    expect(fidelity.doesNotProve).toContain("§16.3");
    expect(fidelity.doesNotProve.length).toBeGreaterThan(200);
    // …including the half the ledger cannot reach at all: a case it claims may
    // assert nothing. That is measured, not asserted, and the census is where.
    expect(fidelity.doesNotProve).toContain("livenessCensus");
    // …and it must say that `unasserted` closes only the TOTAL-emptiness case,
    // not that a claimed case asserts anything worth having.
    expect(fidelity.doesNotProve).toContain("casesByLiveLeafCount");
    expect(fidelity.doesNotProve).toContain("beyond a single leaf");
    expect(fidelity.proves).toContain("unasserted");
    expect(fidelity.proves.length).toBeGreaterThan(200);
    // …and it must name the review that stands in for the missing mechanism,
    // together with the two per-entry fields that make that review mechanical.
    expect(fidelity.reviewObligation).toContain("by eye");
    expect(fidelity.reviewObligation).toContain("section");
    expect(fidelity.reviewObligation).toContain("spec");
    expect(fidelity.whyNotAutomated.length).toBeGreaterThan(200);
  });

  it("declares the §16.4 cross-runtime run instead of leaving it unmentioned", () => {
    // §16.4 is not a missing case — every vector exists — but a missing RUN, and
    // an undeclared missing run reads exactly like a discharged obligation.
    const crossRuntime = MANIFEST.crossRuntime;
    expect(crossRuntime.section).toBe("16.4");
    expect(crossRuntime.status).toBe("declared-deferred");
    expect(crossRuntime.browserRun.state).toBe("not-wired");
    expect(crossRuntime.physicalDeviceRun.state).toBe("not-wired");
    expect(crossRuntime.physicalDeviceRun.families).toBe("all");
    expect(crossRuntime.browserRun.ownedBy.length).toBeGreaterThan(0);
    expect(crossRuntime.physicalDeviceRun.ownedBy.length).toBeGreaterThan(0);
    // Exactly the families §16.4 names: F1, F2, F7, F8, F10, the admitted-pattern
    // cases of F3, the `WebSAS` half of F14, the NX cases of F16, the P-256
    // cases of F17.
    expect(crossRuntime.browserRun.families).toEqual([1, 2, 3, 7, 8, 10, 14, 16, 17, 19]);
    expect(Object.keys(crossRuntime.browserRun.scopes).toSorted()).toEqual(
      crossRuntime.browserRun.families.map((family) => `F${String(family)}`).toSorted(),
    );
    // …and each of them repeats the declaration in its own file, so the family a
    // reader opens tells them the run has not happened.
    for (const family of crossRuntime.browserRun.families) {
      const declarations = (familyByNumber(family).deferred ?? []).filter((reason) =>
        CROSS_RUNTIME.test(reason),
      );
      expect(declarations.length, `F${String(family)}`).toBe(1);
      expect(declarations[0], `F${String(family)}`).toContain(
        crossRuntime.browserRun.scopes[`F${String(family)}`]!,
      );
    }
    // And no family that §16.4 does NOT name carries the declaration.
    for (const number of FAMILY_FILES.keys()) {
      if (crossRuntime.browserRun.families.includes(number)) continue;
      expect(
        (familyByNumber(number).deferred ?? []).some((reason) => CROSS_RUNTIME.test(reason)),
        `F${String(number)}`,
      ).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Corpus liveness — what the committed cases ACTUALLY ASSERT
// ═══════════════════════════════════════════════════════════════════════════
//
// The ledger above constrains NAMES and COUNTS. It cannot see content: a case
// stripped to nothing but its `name` discharges its obligation exactly as well
// as one whose every field is re-derived here, and thirty-three committed cases
// are in that state today. This is the mechanism that makes that a declared
// number instead of a silence.
//
// Every family is loaded through the read-liveness recorder, so this file knows
// which leaves its own tests touched. The rule is: a committed case must carry
// at least one leaf that a consuming suite reads, OR appear in
// `E2EE_CORPUS_CASE_LIVENESS` naming the suite that reads it or declaring it
// DECORATIVE with a reason and an owner. Both directions fail — a case listed
// as unread that this suite does read is as much a defect as the reverse.
//
// WHAT THAT RULE IS: A FLOOR OF ONE LEAF PER CASE. It guarantees that every
// committed case has at least one leaf some suite reads. It does not guarantee
// that a case's expectations are meaningfully asserted, and it is not evidence
// that they are. A case can keep its name and one or two live leaves with the
// rest of its `expected` block inert and satisfy this in full; 137 of the 334
// committed cases have at most two live leaves. The distribution the census
// publishes is the honest picture; the floor is the thing a test can enforce.
//
// These tests are LAST in the file on purpose: everything above has run by the
// time they read the recorder.
describe("§16.3 corpus liveness", () => {
  const claimKey = (file: string, name: string): string => `${file}::${name}`;
  const CLAIMS = new Map(
    E2EE_CORPUS_CASE_LIVENESS.map((claim) => [claimKey(claim.file, claim.case), claim]),
  );

  it("gives every committed case a live leaf, or an entry saying who reads it", () => {
    expect(CLAIMS.size, "the liveness table repeats a case").toBe(E2EE_CORPUS_CASE_LIVENESS.length);
    for (const [number, file] of FAMILY_FILES) {
      for (const entry of familyByNumber(number).cases) {
        const claim = CLAIMS.get(claimKey(file, entry.name));
        const live = LIVENESS.liveLeafCount(file, entry.name);
        if (claim === undefined) {
          expect(
            live,
            `${file}: ${entry.name} carries no leaf this suite reads, and no liveness claim says who does — make it live, or declare it`,
          ).toBeGreaterThan(0);
          continue;
        }
        expect(
          live,
          `${file}: ${entry.name} is listed as unread here, but this suite reads ${String(live)} of its leaves — remove the entry`,
        ).toBe(0);
      }
    }
  });

  it("keeps the liveness table honest: real cases, real reasons, named owners", () => {
    const committed = new Set(
      [...FAMILY_FILES].flatMap(([number, file]) =>
        familyByNumber(number).cases.map((entry) => claimKey(file, entry.name)),
      ),
    );
    for (const claim of E2EE_CORPUS_CASE_LIVENESS) {
      expect(
        committed.has(claimKey(claim.file, claim.case)),
        `${claim.file}: ${claim.case} is claimed by the liveness table and is not a committed case`,
      ).toBe(true);
      if (claim.reader !== "decorative") {
        // A delegation is verified in the suite it names, not here.
        expect(claim.reason, `${claim.case}: a delegation carries no reason`).toBeUndefined();
        continue;
      }
      // A DECORATIVE case is one the corpus commits, the ledger claims, and
      // nothing asserts. Listing it is the whole point — but a list entry that
      // said only "unread" would be the same silence one level further in, so
      // each names what is unread and who owns making it live.
      const reason = claim.reason ?? "";
      expect(reason.length, `${claim.case}: no reason`).toBeGreaterThan(80);
      expect(/owned by/i.test(reason), `${claim.case}: names no owner`).toBe(true);
      expect(/states /i.test(reason), `${claim.case}: does not say what is unread`).toBe(true);
    }
    // The two totals a reader compares against the manifest, pinned so that
    // growing either is a deliberate edit rather than a line that slips in.
    expect(E2EE_CORPUS_CASE_LIVENESS.filter((claim) => claim.reader === "decorative").length).toBe(
      17,
    );
    expect(E2EE_CORPUS_CASE_LIVENESS.filter((claim) => claim.reader === "noise").length).toBe(4);
  });

  it("keeps the manifest's measured census in step with the corpus and with itself", () => {
    const census = MANIFEST.livenessCensus;
    expect(census.section).toBe("16.3");
    // The status names the MEASURE and the ENFORCEMENT separately. It read
    // "measured" once, which a reader takes for "this corpus's coverage has been
    // established"; what is measured is read-liveness, and what is enforced per
    // case is a one-live-leaf floor.
    expect(census.status).toBe("read-liveness measured; per-case rule is a one-live-leaf floor");
    // The METHOD is the part a reader has to be able to check, so it must name
    // the recorder and the runs rather than asserting a number on trust.
    expect(census.method).toContain("relayE2eeCorpusLiveness.ts");
    expect(census.method).toContain("bun run --cwd packages/shared test");
    expect(census.method).toContain("bun run --cwd apps/server test src");
    // …and the census must say what a LIVE leaf does and does not establish.
    expect(census.whatLiveMeans).toContain("UPPER BOUND");
    expect(census.whatLiveMeans.length).toBeGreaterThan(200);
    expect(census.perCaseClaims).toContain("E2EE_CORPUS_CASE_LIVENESS");
    // The per-case rule must be stated as the FLOOR it is. The sentence it
    // replaced — "the three consuming suites each verify their half, so a case
    // that becomes contentless fails a test" — was true and read as much more:
    // what the suites verify is that at least one leaf of each case is read by
    // someone, which a case can satisfy while the rest of it says nothing.
    expect(census.perCaseFloor).toContain("floor");
    expect(census.perCaseFloor).toContain("at least one");
    expect(census.perCaseFloor).toContain("NOT");
    expect(census.perCaseFloor).toContain("casesByLiveLeafCount");
    expect(census.perCaseFloor.length).toBeGreaterThan(300);
    // The independent mutation sweep is the tighter measurement and is recorded
    // as such, against the corpus it was actually run on.
    expect(census.independentMutationSweep.totalLeaves).toBe(
      census.independentMutationSweep.liveLeaves + census.independentMutationSweep.inertLeaves,
    );
    expect(census.independentMutationSweep.measuredAgainst).toContain("3,684");
    // …and it must not read as a current figure. It described the corpus this
    // one replaced, and a note that says "cite this one where they disagree"
    // without saying it is stale is how a superseded number keeps circulating.
    expect(census.independentMutationSweep.note).toContain("STALE");

    // Every family, and the denominators re-derived from the committed files so
    // a census that has stopped describing the corpus fails rather than reads.
    expect(census.families.map((family) => family.family)).toEqual([...FAMILY_FILES.keys()]);
    let cases = 0;
    let leaves = 0;
    let live = 0;
    let contentless = 0;
    for (const family of census.families) {
      const committed = familyByNumber(family.family);
      expect(family.file, `F${String(family.family)}`).toBe(FAMILY_FILES.get(family.family));
      expect(family.cases, family.file).toBe(committed.cases.length);
      // Counted by the recorder from the PARSED file, before instrumentation —
      // walking `expected` here would read every leaf through the accessors and
      // make the census's own bookkeeping the thing that marks the corpus live.
      expect(family.expectedLeaves, family.file).toBe(
        committed.cases.reduce(
          (total, entry) => total + LIVENESS.leafCount(family.file, entry.name),
          0,
        ),
      );
      expect(family.inertLeaves, family.file).toBe(family.expectedLeaves - family.liveLeaves);
      expect(family.liveLeaves, family.file).toBeLessThanOrEqual(family.expectedLeaves);
      expect(family.livePercent, family.file).toBe(
        Math.round((1000 * family.liveLeaves) / family.expectedLeaves) / 10,
      );
      // Each family's contentless count is the exemption list, per family.
      expect(family.casesWithNoLiveLeaf, family.file).toBe(
        E2EE_CORPUS_CASE_LIVENESS.filter(
          (claim) => claim.file === family.file && claim.reader === "decorative",
        ).length,
      );
      // …and the residual is tracked with a real owner rather than implied.
      expect(family.residual.length, family.file).toBeGreaterThan(60);
      expect(family.residualOwner.length, family.file).toBeGreaterThan(3);
      cases += family.cases;
      leaves += family.expectedLeaves;
      live += family.liveLeaves;
      contentless += family.casesWithNoLiveLeaf;
    }
    expect(census.totals.cases).toBe(cases);
    expect(census.totals.expectedLeaves).toBe(leaves);
    expect(census.totals.liveLeaves).toBe(live);
    expect(census.totals.inertLeaves).toBe(leaves - live);
    expect(census.totals.casesWithNoLiveLeaf).toBe(contentless);
    expect(census.totals.livePercent).toBe(Math.round((1000 * live) / leaves) / 10);
  });

  it("keeps the cross-suite read attribution honest, so it cannot be padded", () => {
    // `E2EE_CORPUS_DELEGATED_LEAF_READS` is what makes the union computable in
    // one process, and a table of hand-written path strings is exactly the kind
    // of thing that can be padded to prop a number up. Three checks here, plus
    // one in each of the suites it names, remove every way to do that:
    //   • the case must exist, and each path must be a REAL leaf of it;
    //   • no path may be one THIS suite reads (otherwise it double-counts);
    //   • the case must be delegated to that same suite in the claims table.
    // The fourth — "the named suite really does read it" — is unverifiable here
    // and is asserted over there.
    const seen = new Set<string>();
    for (const entry of E2EE_CORPUS_DELEGATED_LEAF_READS) {
      const key = claimKey(entry.file, entry.case);
      expect(seen.has(key), `${entry.file}: ${entry.case} is attributed twice`).toBe(false);
      seen.add(key);
      expect(
        [...FAMILY_FILES.values()].includes(entry.file),
        `${entry.file} is not a committed family file`,
      ).toBe(true);
      const leaves = new Set(LIVENESS.leafPaths(entry.file, entry.case));
      expect(leaves.size, `${entry.file}: ${entry.case} is not a committed case`).toBeGreaterThan(
        0,
      );
      expect(entry.paths.length, `${entry.file}: ${entry.case} attributes no path`).toBeGreaterThan(
        0,
      );
      const readHere = new Set(LIVENESS.liveLeafPaths(entry.file, entry.case));
      for (const path of entry.paths) {
        expect(
          leaves.has(path),
          `${entry.file}: ${entry.case} attributes ${path}, which is not a leaf of that case`,
        ).toBe(true);
        expect(
          readHere.has(path),
          `${entry.file}: ${entry.case} attributes ${path} to the ${entry.reader} suite, and THIS suite reads it — it would be counted twice`,
        ).toBe(false);
      }
      const claim = CLAIMS.get(key);
      // A case whose every leaf comes from another suite must also be declared
      // in the claims table as belonging to that suite; a case this suite reads
      // some of has no claim entry, and that is the one legitimate shape.
      if (claim !== undefined) {
        expect(
          claim.reader,
          `${entry.file}: ${entry.case} is attributed to the ${entry.reader} suite and the claims table says ${claim.reader}`,
        ).toBe(entry.reader);
      }
    }
  });

  it("pins each family's live count to EXACTLY what the instrumented suites read", () => {
    // THE UPPER BOUND. This assertion used to be `toBeGreaterThanOrEqual`
    // against this one suite's own reads, which constrained the census from
    // BELOW only: a published figure that drifted UPWARD — the direction in
    // which a coverage number misleads — passed unchallenged. A census that
    // cannot overstate is the whole value of publishing one.
    //
    // The union is now computable here exactly, because every leaf that another
    // suite is the sole reader of is written down path by path in
    // `E2EE_CORPUS_DELEGATED_LEAF_READS`, that table is disjoint from what this
    // suite reads (checked above), and each named suite asserts it really reads
    // its own paths (checked there).
    let unionTotal = 0;
    for (const family of MANIFEST.livenessCensus.families) {
      const committed = familyByNumber(family.family);
      const here = committed.cases.reduce(
        (total, entry) => total + LIVENESS.liveLeafCount(family.file, entry.name),
        0,
      );
      const delegated = E2EE_CORPUS_DELEGATED_LEAF_READS.filter(
        (entry) => entry.file === family.file,
      ).reduce((total, entry) => total + entry.paths.length, 0);
      expect(
        family.liveLeaves,
        `${family.file}: the census records ${String(family.liveLeaves)} live leaves; this suite reads ${String(here)} and ${String(delegated)} more are attributed to another suite, so the measured union is ${String(here + delegated)}`,
      ).toBe(here + delegated);
      unionTotal += here + delegated;
    }
    expect(MANIFEST.livenessCensus.totals.liveLeaves).toBe(unionTotal);
  });

  it("publishes the SHAPE of per-case liveness, not one reassuring number", () => {
    // `casesWithNoLiveLeaf: 17 of 334` invites the reading that the other 317
    // assert something substantial. They do not: the rule is a one-leaf floor,
    // and a large fraction of the corpus sits one or two leaves above it. The
    // distribution is published so that shape is visible, and it is recomputed
    // here from the same union the census is pinned to.
    const counts: number[] = [];
    for (const [number, file] of FAMILY_FILES) {
      for (const entry of familyByNumber(number).cases) {
        const delegated =
          E2EE_CORPUS_DELEGATED_LEAF_READS.find(
            (one) => one.file === file && one.case === entry.name,
          )?.paths.length ?? 0;
        counts.push(LIVENESS.liveLeafCount(file, entry.name) + delegated);
      }
    }
    const bucketOf = (live: number): string =>
      live === 0
        ? "0"
        : live === 1
          ? "1"
          : live === 2
            ? "2"
            : live <= 5
              ? "3-5"
              : live <= 10
                ? "6-10"
                : live <= 25
                  ? "11-25"
                  : "26+";
    const distribution = MANIFEST.livenessCensus.casesByLiveLeafCount;
    // The buckets must PARTITION the corpus: same labels, in order, summing to
    // the case count. A bucket list that quietly drops a band would otherwise
    // publish a flattering subset.
    expect(distribution.buckets.map((bucket) => bucket.liveLeaves)).toEqual([
      "0",
      "1",
      "2",
      "3-5",
      "6-10",
      "11-25",
      "26+",
    ]);
    for (const bucket of distribution.buckets) {
      expect(bucket.cases, `bucket ${bucket.liveLeaves}`).toBe(
        counts.filter((live) => bucketOf(live) === bucket.liveLeaves).length,
      );
    }
    expect(distribution.buckets.reduce((total, bucket) => total + bucket.cases, 0)).toBe(
      MANIFEST.livenessCensus.totals.cases,
    );
    expect(distribution.atMostTwoLiveLeaves).toBe(counts.filter((live) => live <= 2).length);
    expect(distribution.atMostFiveLiveLeaves).toBe(counts.filter((live) => live <= 5).length);
    // …and the bucket for nothing-at-all must agree with the exemption list, so
    // the two ways the corpus reports emptiness cannot drift apart.
    expect(distribution.buckets[0]?.cases).toBe(MANIFEST.livenessCensus.totals.casesWithNoLiveLeaf);
  });

  it("says in the census which families have a tight figure and that the global one is stale", () => {
    // Two families have been swept against THIS corpus; the global
    // assertion-liveness numbers were measured against the corpus as it stood
    // BEFORE this round. Publishing either beside current per-family figures
    // without saying which is which reads as though the whole corpus has a
    // current tight measurement. It does not, and the census says what is
    // measured, what is read-liveness, and what closing the rest would take.
    const assertion = MANIFEST.livenessCensus.assertionLiveness;
    expect(assertion.currentCorpus).toContain("PARTIAL");
    expect(assertion.published).toContain("READ-liveness");
    expect(assertion.published).toContain("upper bound");
    expect(assertion.staleFigure).toContain("STALE");
    expect(assertion.staleFigure).toContain("superseded");
    expect(assertion.staleFigure).toContain("49.4%");
    expect(assertion.refreshCost.length).toBeGreaterThan(120);
    expect(assertion.ownedBy.length).toBeGreaterThan(3);
    // The stale figure must name the corpus it was measured against, and that
    // corpus must NOT be this one — a refreshed sweep would change these.
    expect(MANIFEST.livenessCensus.independentMutationSweep.totalLeaves).not.toBe(
      MANIFEST.livenessCensus.totals.expectedLeaves,
    );

    // THE SWEPT FAMILIES' NUMBERS ARE HELD TO THE CENSUS ITSELF, so the sweep
    // block cannot claim a coverage the per-family entries beside it contradict.
    // The sweep found the tight figure equal to the read figure for both, which
    // is the whole content of the claim — if a later round widens either family
    // without re-sweeping, `liveLeaves` moves here and this fails.
    const sweep = assertion.measuredFamilySweep;
    const swept = MANIFEST.livenessCensus.families.filter((family) =>
      [4, 17].includes(family.family),
    );
    expect(swept).toHaveLength(2);
    expect(sweep.families).toBe("F4 and F17");
    expect(sweep.leaves).toBe(swept.reduce((total, family) => total + family.expectedLeaves, 0));
    expect(sweep.liveLeaves).toBe(swept.reduce((total, family) => total + family.liveLeaves, 0));
    expect(sweep.inertLeaves).toBe(swept.reduce((total, family) => total + family.inertLeaves, 0));
    expect(sweep.agreesWithReadLiveness).toBe(true);
    // …and a swept family may not ALSO delegate leaves to another suite, because
    // the sweep ran only this file: a delegated leaf would be counted live by
    // the census and inert by the sweep, and the equality above would be false
    // for a reason nobody stated.
    for (const family of swept) {
      expect(
        E2EE_CORPUS_DELEGATED_LEAF_READS.filter((entry) => entry.file === family.file),
        family.file,
      ).toEqual([]);
    }
  });

  it("marks every ledger obligation whose every case is decorative as unasserted", () => {
    // THE LEDGER AND THE CENSUS USED TO DISAGREE IN SILENCE. `generated` means
    // "a committed case matches", which is a claim about EXISTENCE — and
    // fourteen obligations resolved that way while every case backing them was
    // read by no suite at all. The ledger read as covering them; the census, one
    // file over, said the opposite; nothing compared the two.
    //
    // Ground truth here is the MEASURED union, not the claims table, so an
    // obligation cannot be talked out of this by editing a declaration.
    const liveUnion = (file: string, name: string): number =>
      LIVENESS.liveLeafCount(file, name) +
      (E2EE_CORPUS_DELEGATED_LEAF_READS.find((one) => one.file === file && one.case === name)?.paths
        .length ?? 0);
    let unasserted = 0;
    for (const obligation of SECTION_16_3_LEDGER) {
      if (obligation.generated === undefined) {
        expect(
          obligation.unasserted,
          `${obligation.id}: a declared deferral cannot be "generated but unasserted"`,
        ).toBeUndefined();
        continue;
      }
      const file = FAMILY_FILES.get(obligation.family)!;
      const matched = familyByNumber(obligation.family).cases.filter((entry) =>
        obligation.generated!.test(entry.name),
      );
      const everyCaseInert = matched.every((entry) => liveUnion(file, entry.name) === 0);
      if (everyCaseInert) {
        unasserted += 1;
        const reason = obligation.unasserted ?? "";
        expect(
          reason.length,
          `${obligation.id}: every case it claims (${matched.map((entry) => entry.name).join(", ")}) is read by nothing, and the ledger does not say so — mark it \`unasserted\` with its owner, or make a case live`,
        ).toBeGreaterThan(120);
        expect(/owned by/i.test(reason), `${obligation.id}: names no owner`).toBe(true);
        continue;
      }
      expect(
        obligation.unasserted,
        `${obligation.id}: marked unasserted, and ${String(matched.filter((entry) => liveUnion(file, entry.name) > 0).length)} of its cases are read — remove the field`,
      ).toBeUndefined();
    }
    // Pinned, so the number moves only as a deliberate edit. It was FOURTEEN
    // until the client mode machine gave `f16-suite-list-strip` a driver, and
    // THIRTEEN until the F4 certificate harness and the F17 key-material
    // harness landed: those took `f4-valid-node-certificate`,
    // `f4-node-certificate-variants`, `f4-max-namespace-s9` and
    // `f17-ed25519-canonicality` off this list. Every one that remains is F3.
    expect(unasserted, "the count of generated-but-unasserted obligations").toBe(9);
    expect(SECTION_16_3_LEDGER.filter((entry) => entry.unasserted !== undefined).length).toBe(9);
    // …and the manifest carries the same list, so the number reaches a reader of
    // the FIXTURES and not only a reader of this file. Ids, not just a count: a
    // count alone cannot be checked against anything.
    const declared = MANIFEST.ledgerFidelity.unassertedObligations;
    expect(declared.count).toBe(9);
    expect([...declared.ids].toSorted()).toEqual(
      SECTION_16_3_LEDGER.filter((entry) => entry.unasserted !== undefined)
        .map((entry) => entry.id)
        .toSorted(),
    );
    // Every owner named in the ledger's own reasons must appear in the manifest's
    // owner list, so the two cannot describe different work.
    expect(declared.ownedBy.length).toBeGreaterThan(0);
    for (const owner of declared.ownedBy) {
      const harness = owner.split(" — ")[0] ?? "";
      expect(harness.length, "an owner entry with no harness named").toBeGreaterThan(5);
      expect(
        SECTION_16_3_LEDGER.some((entry) => entry.unasserted?.includes(harness) === true),
        `${harness} owns unasserted work in the manifest and no ledger entry names it`,
      ).toBe(true);
    }
  });
});
