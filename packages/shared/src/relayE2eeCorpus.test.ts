import { decode } from "cborg";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_AAD_BYTES,
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_CLOSE_RECORDS_RESERVED,
  E2EE_COUNTER_MAX,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_ERROR_RECORDS_RESERVED,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_REKEY_MAX_RECORDS,
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
  E2EE_CLOSE_COMMITMENT_DOMAIN,
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
  deriveE2eeAeadKey,
  deriveE2eeEpochKeys,
  deriveE2eeServerConfirmationKey,
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
  E2EE_STRICT_DECODE_OPTIONS,
  e2eeAuthorizationContextCommitment,
  e2eeEffectiveAdmittedPatterns,
  encodeNodeE2eeCapabilitySigningEnvelope,
  validateNodeE2eeContinuityChain,
  type E2eeNoisePattern,
  type E2eeTier,
} from "./relayE2eeTranscripts.ts";
import {
  NODE_AUTH_TRANSCRIPT_DOMAIN,
  NODE_KEY_ROTATION_TRANSCRIPT_DOMAIN,
} from "./nodeIdentity.ts";
import { deriveE2eeSafetyNumber, deriveE2eeWebSas } from "./relayE2eeVerificationDisplay.ts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
  E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  classifyPostStripPayload,
  decodeE2eeNegotiationRecord,
  e2eeAeadNonce,
  e2eeEnvelopeAad,
  e2eeNegotiationRecordBound,
  e2eeNegotiationRecordDirection,
  encodeE2eeDirectionLabel,
  encodeE2eeEnvelopeHeader,
  encodeE2eeHandshakeReject,
  type E2eeDirection,
} from "./relayE2eeWire.ts";
import {
  RelayMessageAssembler,
  isChunkedPayload,
  prepareRelayMessage,
} from "./relayMessageChunks.ts";

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

function readFamily(name: string): FixtureFamily {
  const text = new TextDecoder().decode(readFileSync(new URL(name, FIXTURE_ROOT)));
  return JSON.parse(text) as FixtureFamily;
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
});

describe("§16.3 F5 continuity chains (§7.5, §13.3)", () => {
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
      const expected = (entry.expected.chain ?? entry.expected) as JsonRecord;
      expect(result.kind, entry.name).toBe(expected.kind);
      if (result.kind === "error") {
        expect(result.failure, entry.name).toBe(expected.failure);
        continue;
      }
      expect(result.certificates.length, entry.name).toBe(expected.certificates);
      if (expected.pinnedFingerprintUnchanged !== undefined) {
        expect(result.pinnedFingerprintUnchanged, entry.name).toBe(
          expected.pinnedFingerprintUnchanged,
        );
        // §13.3: reaching the pin THROUGH the chain is the silent pin update.
        expect(expected.silentPinUpdate, entry.name).toBe(
          result.pinnedFingerprintUnchanged === false,
        );
      }
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
        .map((entry) => ((entry.expected.chain ?? entry.expected) as JsonRecord).failure)
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
});

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

      const classified = classifyPostStripPayload(pushed.message);
      const step2 = pipeline.step2Discrimination as JsonRecord;
      expect(classified.kind, entry.name).toBe(step2.class);
      if (classified.kind === "other") expect(classified.reason, entry.name).toBe(step2.reason);
    }
  });

  it("reassembles the chunked envelope to the exact envelope bytes", () => {
    const entry = caseByName(F01, "chunked-envelope-reassembles-to-the-envelope");
    const payloads = (entry.inputs.wirePayloads as readonly FixtureBytes[]).map(fixtureBytes);
    expect(entry.expected.everyChunkStartsWithChunkMagic).toBe(true);
    const assembler = new RelayMessageAssembler();
    let message: Uint8Array | undefined;
    for (const payload of payloads) {
      expect(isChunkedPayload(payload)).toBe(true);
      const pushed = assembler.push(payload);
      if (pushed.kind === "done") message = pushed.message;
    }
    expect(message).toBeDefined();
    expect(hex(message!)).toBe(hex(fixtureBytes(entry.inputs.envelope)));
    expect(classifyPostStripPayload(message!).kind).toBe("envelope");
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
  });

  it("rejects every §7.1 P-256 signature encoding the family carries", () => {
    for (const entry of casesMatching(F17, /^p256-signature-/)) {
      const signature = fixtureBytes(entry.inputs.signature);
      expect(() => validateE2eeClientSignature(signature), entry.name).toThrow();
      expect((entry.expected.encodingValidation as JsonRecord).rejected, entry.name).toBe(true);
      // The single verification choke point returns false and never throws.
      expect(
        verifyE2eeSignature({
          algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
          publicKey: fixtureBytes(F17.testKeyMaterial.clientIdentityPublicKey),
          message: fixtureBytes(
            caseByName(F04, "valid-client-agreement-prekey-certificate").inputs.transcript,
          ),
          signature,
        }),
        entry.name,
      ).toBe(false);
    }
  });

  it("applies strict RFC 8032 to Ed25519 keys and signatures (§14.3)", () => {
    for (const entry of casesMatching(F17, /^ed25519-public-key-/)) {
      const key = fixtureBytes(entry.inputs.publicKey);
      expect(() => validateE2eeNodeIdentityPublicKey(key), entry.name).toThrow();
    }

    const control = caseByName(
      F17,
      "ed25519-signature-with-a-canonically-encoded-identity-r-control",
    );
    const nonCanonical = caseByName(
      F17,
      "ed25519-signature-with-a-non-canonically-encoded-identity-r",
    );
    const verifyCase = (entry: FixtureCase): boolean =>
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: fixtureBytes(entry.inputs.publicKey),
        message: fixtureBytes(entry.inputs.message),
        signature: fixtureBytes(entry.inputs.signature),
      });
    // The pair differs ONLY in the encoding of R, so the rejection below is
    // about canonicality and not about a broken verification equation.
    expect(verifyCase(control)).toBe(true);
    expect(verifyCase(nonCanonical)).toBe(false);
    expect(hex(fixtureBytes(control.inputs.signature)).slice(64)).not.toBe(
      hex(fixtureBytes(nonCanonical.inputs.signature)).slice(64),
    );

    for (const entry of casesMatching(F17, /^ed25519-signature-scalar-/)) {
      expect(verifyCase(entry), entry.name).toBe(false);
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

    let substitutions = 0;
    for (const verifier of domains) {
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
      expect(verify(fixtureBytes(verifier.signature)), String(verifier.domain)).toBe(true);
      for (const source of domains) {
        if (source.domain === verifier.domain) continue;
        substitutions += 1;
        expect(
          verify(fixtureBytes(source.signature)),
          `${String(source.domain)} -> ${String(verifier.domain)}`,
        ).toBe(false);
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
  const closeRecords = (name: string): readonly JsonRecord[] =>
    (caseByName(F11, name).expected.records ?? []) as readonly JsonRecord[];

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
    const rows = new Map(
      F10.cases.map((entry) => [entry.name, entry.expected.fatal as string] as const),
    );
    expect(rows.get("legacy-lock-injection-envelope-is-p5")).toBe("P5");
    expect(rows.get("legacy-lock-injection-client-hello-at-the-node-is-p24")).toBe("P24");
    expect(rows.get("legacy-lock-injection-server-accept-at-the-client-is-p24")).toBe("P24");
    expect(rows.get("legacy-lock-injection-unknown-first-byte-is-p6")).toBe("P6");
    expect(rows.get("legacy-lock-injection-absent-first-byte-is-p6")).toBe("P6");
    for (const entry of F10.cases) {
      expect(entry.expected.disposition, entry.name).toBe("FATAL-PRE");
      if (entry.expected.sessionKeysExist !== undefined) {
        expect(entry.expected.sessionKeysExist, entry.name).toBe(false);
      }
      const payload = entry.inputs.postStripPayload;
      if (payload === undefined) continue;
      const bytes = fixtureBytes(payload);
      const step2 = entry.expected.step2Discrimination as JsonRecord | undefined;
      if (step2 !== undefined) {
        expect(classifyPostStripPayload(bytes).kind, entry.name).toBe(step2.class);
      }
    }
  });

  it("proves the P24 records are neither over-bound nor misdirected", () => {
    for (const entry of casesMatching(F10, /-is-p24$/)) {
      const record = fixtureBytes(entry.inputs.postStripPayload);
      const recordType = entry.inputs.recordType as
        | typeof E2EE_NEGOTIATION_TYPE_CLIENT_HELLO
        | typeof E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT
        | typeof E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT;
      const decoded = decodeE2eeNegotiationRecord(record);
      expect(decoded.kind, entry.name).toBe("ok");
      const bound = e2eeNegotiationRecordBound(recordType);
      expect(record.byteLength <= bound.maxBytes, entry.name).toBe(true);
      expect(e2eeNegotiationRecordDirection(recordType), entry.name).toBe(
        entry.expected.registryDirection,
      );
      expect(entry.expected.directedCorrectlyForThisEndpoint, entry.name).toBe(true);
      expect(entry.expected.notP3, entry.name).toBe(true);
    }
    // …and the two P3 contrast cases that fix the boundary of that partition.
    const misdirected = caseByName(F10, "misdirected-negotiation-record-is-p3");
    expect(misdirected.expected.misdirected).toBe(true);
    expect(misdirected.expected.registryDirection).toBe(
      e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT),
    );
    const overBound = caseByName(F10, "over-bound-negotiation-record-is-p3");
    expect(overBound.inputs.recordBytes).toBe(E2EE_CLIENT_HELLO_MAX_BYTES + 1);
    expect(overBound.expected.reason).toBe("too_large");
    expect(overBound.expected.bodyParsed).toBe(false);
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
    // The two aborts fire on different grounds and share one observable.
    expect(hex(fixtureBytes((abort.observable as JsonRecord).handshakeReject))).toBe(
      hex(encodeE2eeHandshakeReject()),
    );
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
//   • a group obligation cannot lose members below its `atLeast` floor.
//
// WHAT THEY CANNOT PROVE
//   • that the obligations written here are ALL of §16.3's obligations. An
//     obligation the specification states and nobody transcribed into this
//     array is invisible to every test in this file — it is not "missing", it
//     does not exist as far as the tests are concerned. THIS IS THE RESIDUAL.
//   • that an entry's `spec` text still says what §16.3 says. Editing the
//     document's wording, or narrowing an obligation there, fails nothing here.
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
   * How many cases the obligation stands for. A FLOOR, not an equality: the
   * corpus may still grow, but no case inside a group may disappear. Without it
   * a group matcher would keep passing while members of the group were deleted
   * one at a time — presence of the group is not presence of its cases.
   */
  readonly atLeast?: number;
  /** §16.3 asks for this and the corpus does not: a deferral must name it. */
  readonly declared?: RegExp;
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
    atLeast: 2,
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
    atLeast: 2,
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
    generated: /^inner-body-(exactly-at|one-byte-over)-the-plaintext-ceiling$/,
    atLeast: 2,
  },
  {
    id: "f1-empty-payload-zero-length-path",
    family: 1,
    section: "16.3 F1 — Empty-payload cases (§3.4, §4.3 step 2)",
    spec: "The corpus MUST additionally carry the zero-length post-strip payload along both of its reachability paths, in `negotiating`, `e2ee`, and `legacy`: a `data.payload` of length zero [this entry], and a `data.payload` equal to exactly `RELAY_CHUNK_CAPABILITY_PRELUDE`.",
    generated: /^empty-post-strip-payload-zero-length-data-payload-in-/,
    atLeast: 3,
  },
  {
    id: "f1-empty-payload-prelude-path",
    family: 1,
    section: "16.3 F1 — Empty-payload cases (§3.4, §4.3 step 2)",
    spec: "…and a `data.payload` equal to exactly `RELAY_CHUNK_CAPABILITY_PRELUDE` [this entry]. …the prelude case MUST additionally assert that the peer's chunk-support latch still sets before the fatal outcome is taken.",
    generated: /^empty-post-strip-payload-data-payload-equal-to-the-chunk-capability-prelude-in-/,
    atLeast: 3,
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
    atLeast: 2,
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
    spec: "…(§5.5 U1 — advertisement suppressed, one `undersized-connection` occurrence recorded, no peer-legacy occurrence, and FATAL-PRE under effective `requireE2EE`) [this entry covers the §12.5 occurrence-accounting half of that clause]",
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
    atLeast: 2,
  },
  {
    id: "f3-re-encode-inequality",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "and invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, lower policy generation, fingerprint mismatch, cross-signature reconstruction failure, oversized statement …, re-encode inequality (non-canonical bytes) [this entry: re-encode inequality]",
    generated: /^non-canonical-transcript-encoding$/,
  },
  {
    id: "f3-cross-signature-reconstruction",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "and invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, lower policy generation, fingerprint mismatch, cross-signature reconstruction failure, oversized statement …, re-encode inequality (non-canonical bytes) [this entry: cross-signature reconstruction failure]",
    generated: /^prekey-cross-signature-lifted-from-another-statement$/,
  },
  {
    id: "f3-fingerprint-mismatch",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "and invalid variants — expired, future issued-at, over-long validity interval, wrong Hub origin, lower policy generation, fingerprint mismatch, cross-signature reconstruction failure, oversized statement …, re-encode inequality (non-canonical bytes) [this entry: fingerprint mismatch]",
    generated: /^advertised-identity-fingerprint-disagrees-with-the-advertised-identity-key$/,
  },
  {
    id: "f3-hub-origin-bound",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "a Hub origin exactly at and one byte over `E2EE_HUB_ORIGIN_MAX_BYTES` (accepted, then rejected — §7.1)",
    generated: /^hub-origin-(exactly-at|one-byte-over)-the-bound$/,
    atLeast: 2,
  },
  {
    id: "f3-suite-registry-bound",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "a suite registry exactly at and one entry over `E2EE_SUITE_REGISTRY_MAX_ENTRIES`",
    generated: /^suite-registry-(exactly-at|one-entry-over)-max-entries$/,
    atLeast: 2,
  },
  {
    id: "f3-transcript-bound",
    family: 3,
    section: "16.3 F3 — Size-invariant cases (§3.2.1 S1, S3, S4, S5, S6, S8)",
    spec: "the same statement one byte over `E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES` (rejected at §5.2 step 0, and refused at emit by §7.6.1) and exactly at the bound (accepted)",
    generated: /^transcript-(exactly-at|one-byte-over)-the-transcript-bound$/,
    atLeast: 2,
  },
  {
    id: "f3-oversized-statement",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "oversized statement (re-anchored to the current `E2EE_CAPABILITY_STATEMENT_MAX_BYTES`) [carried as the statement bound and the carrier bound it implies]",
    generated: /^oversized-(statement|carrier)$/,
    atLeast: 2,
  },
  {
    id: "f3-malformed-continuity-id",
    family: 3,
    section: "16.3 F3 (§5.2, §5.7, §7.2.1, §7.6, §3.2.1)",
    spec: "a statement omitting element 18 and one carrying a malformed continuity id (both invalid) [this entry covers the malformed half, carried once per malformation class; the omission half is declared below]",
    generated: /^malformed-continuity-id-/,
    atLeast: 4,
  },
  {
    id: "f3-continuity-id-unresolved",
    family: 3,
    section: "16.3 F3 (§7.6.1) / F5 storage-and-anchor cases (§7.5, §5.5 U2)",
    spec: "[Not named in §16.3 F3. The emit-side face of the §7.5 startup cross-check: a node whose continuity id is unresolved at startup fails the §7.6.1 self-check and emits no advertisement, §5.5 U2 `statement-unavailable`. The node-state transitions that decide it are §16.3 F5's storage-and-anchor cases, declared there.]",
    generated: /^continuity-id-unresolved-at-startup$/,
  },
  {
    id: "f3-protocol-range",
    family: 3,
    section: "16.3 F3 — Protocol-range cases (§5.2 step 8, §7.6 elements 7–8)",
    spec: "a fully valid, correctly signed statement whose advertised range excludes `E2EE_PROTOCOL_VERSION` — both bounds strictly above it — and one whose range is inverted (`e2eeVersionMin > e2eeVersionMax`). Each MUST be run twice against the same bytes: with the channel's selection not latched, expecting row K3 …, and with the selection latched, expecting `P15`. … A boundary case MUST also carry a range whose minimum equals `E2EE_PROTOCOL_VERSION` and whose maximum is strictly greater, expecting the ordinary K1 path, so the check is a range test and not an equality test.",
    generated: /^protocol-range-/,
    atLeast: 6,
  },
  {
    id: "f3-admitted-patterns",
    family: 3,
    section: "16.3 F3 — Admitted-pattern cases (§5.2 step 9, §7.6 element 14, §8.2)",
    spec: 'a fully valid, correctly signed statement whose element 14 is exactly ["IK"] … evaluated as a web client, whose tier runs "NX". … that run expects `P15` … The same bytes MUST also be run with the selection not latched, expecting row K3 … A companion case MUST evaluate the identical statement as a native client, whose tier runs "IK", expecting the ordinary K1 path … A further case MUST carry ["IK", "NX"] evaluated as web, also expecting K1.',
    generated: /^admitted-pattern-set-/,
    atLeast: 5,
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
    atLeast: 6,
  },
  {
    id: "f4-clock-skew-boundary",
    family: 4,
    section: "16.3 F4 (§7.3, §7.4, §6.4)",
    spec: "expiry exactly at and one beyond the `E2EE_MAX_CLOCK_SKEW` boundary [carried at both edges of the window: not-yet-valid and expired]",
    generated:
      /^client-certificate-(not-yet-valid|expiry)-(accepted-exactly-at|one-millisecond-beyond)-the-clock-skew-boundary$/,
    atLeast: 4,
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
    atLeast: 2,
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
    atLeast: 2,
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
    atLeast: 6,
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
    atLeast: 3,
  },
  {
    id: "f5-valid-max-length",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "valid chains … of `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` with the silent-pin-update expectation. … The `E2EE_CONTINUITY_CHAIN_MAX_LENGTH` case MUST be run twice: once with a short test Hub origin, and once with a Hub origin of exactly `E2EE_HUB_ORIGIN_MAX_BYTES`. … Both runs MUST assert the resulting carrier fits `E2EE_CAPABILITY_CARRIER_MAX_BYTES` and that `carrier + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES ≤ E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES`. The long-origin run MUST additionally assert the silent-pin-update expectation is unchanged by origin length.",
    generated: /^valid-max-length-chain-(short|max-length)-hub-origin$/,
    atLeast: 2,
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
    atLeast: 2,
  },
  {
    id: "f5-generation-gap-and-regression",
    family: 5,
    section: "16.3 F5 (§7.5, §13.3, §5.5)",
    spec: "one case each for missing link, spliced key, reordered entries, truncated chain, generation gap and regression, invalid signature, over-length chain, mixed continuity ids within the chain, a chain entry whose continuity id disagrees with statement element 18, and a chain whose continuity id disagrees with the pinned value — each channel-fatal with the re-verification expectation [this entry: generation gap and regression]",
    generated: /^generation-(gap|regression)$/,
    atLeast: 2,
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
    atLeast: 2,
  },
  {
    id: "f8-counters-zero-and-one",
    family: 8,
    section: "16.3 F8 (§9.1–§9.3)",
    spec: "envelopes at counters zero and one [carried in both directions]",
    generated: /^envelopes-at-counters-zero-and-one-/,
    atLeast: 2,
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
    atLeast: 6,
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
    atLeast: 2,
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
    atLeast: 3,
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
    atLeast: 2,
  },
  {
    id: "f9-counter-exhaustion-close",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "synthetic counter- and epoch-exhaustion states with the authenticated-close expectation … once for the sequential initiator …, once for a simultaneous close …, and once for the sequential responder [counter-exhaustion half]",
    generated: /^counter-exhaustion-(sequential|simultaneous)-close-out-of-the-close-reserve$/,
    atLeast: 2,
  },
  {
    id: "f9-error-reserve",
    family: 9,
    section: "16.3 F9 — Terminal-error reserve cases (§9.6, §10.2, §11.3)",
    spec: "in the terminal epoch: a complete sequential-initiator exchange that has spent both close-machine records, followed by a stray protected envelope, asserting that the resulting `E2EEError` is protected out of `E2EE_ERROR_RECORDS_RESERVED` at the next `(epoch, counter)` with no wrap, no reuse, and no third close-machine record — this is the case that fails against an implementation sizing the reserve at `E2EE_CLOSE_RECORDS_RESERVED` alone; and the same trace from a synthetic state whose remaining capacity covers the close machine but not the error record, expecting the close without the error record and the §11.5 send path unusable observable rather than a wrap or a dropped obligation.",
    generated: /^terminal-epoch-error-record-(out-of-the-error-reserve|without-capacity)$/,
    atLeast: 2,
  },
  {
    id: "f9-degenerate-state",
    family: 9,
    section: "16.3 F9 (§9.4–§9.6)",
    spec: "a synthetic state holding less than the post-application reserve, expecting the §9.6 degenerate outcome (no wrap, no reuse, verdict unclean-abrupt)",
    generated: /^degenerate-state-below-the-post-application-reserve$/,
  },

  // ── F10 — mode machine ─────────────────────────────────────────────────────
  {
    id: "f10-legacy-lock-injection",
    family: 10,
    section: "16.3 F10 (§4.4)",
    spec: "The legacy-lock injection cases MUST name their §11 row per §16.2, and the rows are disjoint by §11.2's partition: an envelope after the lock is `P5`, a negotiation record after the lock is `P24` — carried at minimum as a correctly sized, correctly directed `E2EEClientHello` at the node and `E2EEServerAccept` at the client, which are neither over-bound nor misdirected and therefore not `P3` — and an unknown or absent first byte is `P6`. Each MUST also assert the disposition is FATAL-PRE, since no session keys exist in `legacy`.",
    generated: /^legacy-lock-injection-/,
    atLeast: 5,
  },
  {
    id: "f10-p3-contrast",
    family: 10,
    section: "16.3 F10 (§4.4, §11.2)",
    spec: "…which are neither over-bound nor misdirected and therefore not `P3` [this entry carries the two contrast cases that ARE `P3`: a misdirected negotiation record and an over-bound one, so the P24 rows above are shown to be a partition and not a default]",
    generated: /-is-p3$/,
    atLeast: 2,
  },
  {
    id: "f10-transition-rows",
    family: 10,
    section: "16.3 F10 (§4.4)",
    spec: "one case per transition row N1–N17 and K1–K24 — input payload bytes and state, expected action and next state — including plaintext injection after E2EE, envelope and negotiation injection after a legacy lock, and an unknown first byte in every state",
    declared: /^Every transition row of §4\.4/,
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
    declared: /^Rows N15–N17/,
  },
  {
    id: "f10-timer-and-keepalive",
    family: 10,
    section: "16.3 F10 — Timer and keepalive cases (§3.2.2 L1 and L2, §8.9 deadline)",
    spec: "Stalled accept (K15). A valid carrier, a valid hello, and then `E2EEServerAccept` withheld past `T_HANDSHAKE` … no plaintext left the client at any point in `negotiating`, including no keepalive `Ping`. — Buffered keepalive round trip … flushed as an envelope on entering `e2ee` (and as plaintext on entering `legacy` via K13). — Send-buffer overflow. Submissions past `E2EE_NEGOTIATION_BUFFER_MAX_BYTES` while `negotiating`, asserting `e2ee_send_unavailable` … plus a multi-channel accounting case … — Node deadline under each policy. `T_HANDSHAKE_NODE` expiry while `negotiating` MUST fire N8 under effective `requireE2EE` and MUST NOT fire it under the compatibility default; the same deadline expiring after row N3 with no authenticated implicit finish MUST be FATAL-POST `Q8` under both policies (§8.9).",
    declared: /^The timer and keepalive cases/,
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
    atLeast: 2,
  },
  {
    id: "f11-close-anchor-epoch-boundary",
    family: 11,
    section: "16.3 F11 — simultaneous-close table (§10.1.1)",
    spec: "[table row] Close anchor across an epoch boundary — I's `E2EEClose` is the last record of epoch `e` under a §9.4 threshold; R's `E2EECloseAck` declares `expectedRecv` `(e + 1, 0)`. Accepted: the anchor is the §9.2/§9.4 advance … A companion negative case declaring `(e, counter + 1)` MUST fail as `Q7`.",
    generated: /^close-anchor-across-an-epoch-boundary/,
    atLeast: 2,
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
    atLeast: 2,
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
    atLeast: 2,
  },
  {
    id: "f11-t-close-expiry",
    family: 11,
    section: "16.3 F11 — Verdict-disambiguation cases (§10.2, §10.4, §11.3 Q6/Q7)",
    spec: "a `T_CLOSE` expiry at each waiting step, expecting Unclean — abrupt with no wire record — the contrast case that fixes which events this protocol declines to attribute",
    generated: /^t-close-expiry-/,
    atLeast: 3,
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
    atLeast: 5,
  },
  {
    id: "f12-error-record-per-code",
    family: 12,
    section: "16.3 F12 (§11)",
    spec: "one `E2EEError` envelope per defined code",
    generated: /^error-record-/,
    atLeast: 3,
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
    atLeast: 2,
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
    atLeast: 4,
  },
  {
    id: "f14-safety-number",
    family: 14,
    section: "16.3 F14 (§13.4, §13.5)",
    spec: "input arrays, intermediates (`safetyNumberSecret`, `prk`), HKDF outputs, and the exact rendered display strings for fixed inputs. Each rendering case MUST additionally assert its displayed entropy against §3.2.1 S10 and S11. [safety-number half, S10]",
    generated: /^safety-number-/,
    atLeast: 3,
  },
  {
    id: "f14-web-sas",
    family: 14,
    section: "16.3 F14 (§13.4, §13.5)",
    spec: "input arrays, intermediates (`safetyNumberSecret`, `prk`), HKDF outputs, and the exact rendered display strings for fixed inputs. Each rendering case MUST additionally assert its displayed entropy against §3.2.1 S10 and S11. [`WebSAS` half, S11]",
    generated: /^web-sas-/,
    atLeast: 3,
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
    atLeast: 2,
  },
  {
    id: "f15-snow",
    family: 15,
    section: "16.3 F15 (§14.1)",
    spec: "the official cacophony/snow vector sets for `Noise_IK_25519_ChaChaPoly_SHA256` and `Noise_NX_25519_ChaChaPoly_SHA256`, transcoded into the corpus format; the state machine MUST reproduce them exactly [snow half]",
    generated: /^snow\/Noise_(IK|NX)_25519_ChaChaPoly_SHA256$/,
    atLeast: 2,
  },

  // ── F16 — authorization context and Branch A ───────────────────────────────
  {
    id: "f16-context-blocks",
    family: 16,
    section: "16.3 F16 (§8.3, §7.5, §8.6 steps 6–7, §8.7, §8.9, §11.3 Q9, §13.6)",
    spec: "It reuses the F6 (IK) and F7 (NX) happy-path material and emits the context-block bytes and `contextCommitment` for both tiers, then one case per single-element mutation, each giving the mutated context bytes, the resulting commitment, and the expected outcome",
    generated: /^authorization-context-block-/,
    atLeast: 2,
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
    atLeast: 2,
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
    atLeast: 2,
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
    atLeast: 3,
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
    atLeast: 5,
  },
  {
    id: "f16-withdrawal-cases",
    family: 16,
    section: "16.3 F16 — Authorization-withdrawal cases (§13.6, §8.9, §11.3 Q9)",
    spec: "`status approved → revoked` — withdrawn; Q9, code `policy`; `maxRole owner → viewer` with `status` unchanged at `approved` — withdrawn; Q9 … run once against a channel admitted at element-12 `owner` and once against a channel admitted at element-12 `viewer`, both expecting Q9; `capabilitySet` losing a member the snapshot held … — withdrawn; Q9; a withdrawal applied to the same client fingerprint under a different `(hubOrigin, accountId)` scope — not withdrawn for this channel …; a withdrawal landing between §8.6 step 6 and row N3 — the in-flight abort, which MUST take the generic fixed-size `E2EEHandshakeReject` … never a `policy` code; a withdrawal landing after row N3 but before the authenticated implicit finish — Q9, per §8.9 [this last is carried as the `implicitFinish` expectation on each withdrawal case above, not as a separate case]",
    generated: /^withdrawal-/,
    atLeast: 7,
  },
  {
    id: "f16-widening-cases",
    family: 16,
    section: "16.3 F16 — Authorization-withdrawal cases (§13.6, §8.9, §11.3 Q9)",
    spec: "a widening — first approval, re-approval, `maxRole` increase, `capabilitySet` addition — not withdrawn; the channel stays open and the widened authority reaches it only on a fresh ticket, channel, and handshake",
    generated: /^widening-/,
    atLeast: 4,
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
    id: "f16-policy-counterparts",
    family: 16,
    section: "16.3 F18 (§12.6), cross-referenced from F16",
    spec: "[Not a §16.3 F16 obligation. A pointer entry: the §12.6 policy-withdrawal counterparts of F16's §13.6 authorization-withdrawal cases are §16.3 F18, which this corpus carries only in part — so a reader of F16 is told where the other half lives and that it is incomplete.]",
    declared: /^The §12\.6 policy-withdrawal counterparts/,
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
    atLeast: 2,
  },
  {
    id: "f17-p256-public-keys",
    family: 17,
    section: "16.3 F17 (§7.1)",
    spec: "P-256 public keys that are off the curve, have a coordinate at or above the field prime, are the identity, or carry a first byte other than `0x04` (compressed and hybrid prefixes included) — each rejected by §7.1 before any signature check",
    generated: /^p256-public-key-/,
    atLeast: 10,
  },
  {
    id: "f17-p256-signatures",
    family: 17,
    section: "16.3 F17 (§7.1)",
    spec: "P-256 ECDSA signatures presented as ASN.1/DER instead of fixed-width raw `r ‖ s`, and raw signatures with `r` or `s` equal to zero or at or above the group order — each rejected [seven cases: DER; `r` zero; `s` zero; `r` at the order; `s` at the order; `r` above the order; `s` above the order]",
    generated: /^p256-signature-/,
    atLeast: 7,
  },
  {
    id: "f17-ed25519-canonicality",
    family: 17,
    section: "16.3 F17 (§14.3)",
    spec: "Ed25519 signatures that are non-canonical in point or scalar encoding — values a ZIP215-style verifier accepts and RFC 8032 MUST reject (§14.3)",
    generated: /^ed25519-(public-key|signature)-/,
    atLeast: 6,
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
    id: "f18-per-channel-cases",
    family: 18,
    section: "16.3 F18 (§12.6 per-channel bullets)",
    spec: "`requireE2EE` false → true with one `legacy` channel, one NX `e2ee` channel, and one IK `e2ee` channel open …; `requireApprovedClientE2EE` false → true over the same three channels …; a suite leaving the advertised registry with an `e2ee` channel established on that suite — withdrawn, `Q12`; and a companion channel on a retained suite — not withdrawn … run twice against the same command, once IK and once NX, both expecting `Q12`; a widening … asserting that no channel is closed and that the policy generation still advances (§5.7); a combined narrow-and-widen command — a withdrawal …; a `negotiating` channel present while any of the above is applied — asserted not swept, and then asserted fail-closed on its next input.",
    declared: /^Every per-channel case of §16\.3 F18/,
  },
  {
    id: "f18-ordering-cases",
    family: 18,
    section: "16.3 F18 (§12.6 ordering and the row-N3 race)",
    spec: "the ordering itself: a hello that reaches §8.6 step 2 after the durable commit reads the narrowed policy and is refused there …; the row-N3 race … a handshake that passed §8.6 step 2 under the old policy and whose row-N3 transition is scheduled to land concurrently with the sweep … The case MUST assert that the channel is accounted for exactly once and is not left open … and MUST be run with the two enumerations attempted in both orders.",
    declared: /^The §12\.6 ordering cases/,
  },
  {
    id: "f18-step-c-counts",
    family: 18,
    section: "16.3 F18 (§12.6 step (c), §12.5 non-interaction)",
    spec: "the reported counts of §12.6 step (c), broken out by class — `legacy`, NX `e2ee`, suite-withdrawn `e2ee` of either tier, and in-flight handshakes aborted — asserted against the channel set …; the §12.5 non-interaction: every case above MUST assert that no fallback occurrence of either class was recorded by the withdrawal (§12.6).",
    declared: /^The §12\.6 step \(c\) reported counts/,
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
    for (let family = 1; family <= 18; family += 1) {
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
    expect(SECTION_16_3_LEDGER.length).toBe(160);
  });

  it("resolves every §16.3-named case as generated or as declared, never as neither", () => {
    // The assertion the corpus lacked. A case that §16.3 names and the corpus
    // neither carries nor declares fails HERE, by id, instead of disappearing
    // between a present family file and a deferral list that does not mention it.
    for (const entry of SECTION_16_3_LEDGER) {
      const family = familyByNumber(entry.family);
      if (entry.generated !== undefined) {
        const matches = family.cases.filter((fixture) => entry.generated!.test(fixture.name));
        expect(matches.length, `${entry.id} is generated by no case`).toBeGreaterThan(0);
        expect(
          matches.length,
          `${entry.id} lost a case: ${String(matches.length)} present, ${String(entry.atLeast ?? 1)} required`,
        ).toBeGreaterThanOrEqual(entry.atLeast ?? 1);
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
    // Nothing is wholesale-omitted; every F1–F18 has a file on disk.
    expect(MANIFEST.deferredFamilies).toEqual([]);
    expect(Object.keys(MANIFEST.files).toSorted()).toEqual([...FAMILY_FILES.values()].toSorted());
    // The families that defer NOTHING, named so the set cannot shrink unnoticed.
    const complete = [...FAMILY_FILES.keys()].filter(
      (number) => (familyByNumber(number).deferred ?? []).length === 0,
    );
    expect(complete).toEqual([6, 9, 13, 15]);
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
    expect(crossRuntime.browserRun.families).toEqual([1, 2, 3, 7, 8, 10, 14, 16, 17]);
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
