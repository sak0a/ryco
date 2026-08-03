import { ed25519 } from "@noble/curves/ed25519";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_ACCOUNT_ID_MAX_BYTES,
  E2EE_CAPABILITY_CARRIER_FIXED_BYTES,
  E2EE_CAPABILITY_CARRIER_MAX_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
  E2EE_CAPABILITY_STATEMENT_MAX_BYTES,
  E2EE_CAPABILITY_STATEMENT_VALIDITY,
  E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES,
  E2EE_CONTINUITY_CHAIN_MAX_LENGTH,
  E2EE_HUB_ORIGIN_MAX_BYTES,
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PREKEY_LIFETIME,
  E2EE_STATEMENT_WRAPPER_MAX_BYTES,
  E2EE_SUITE_REGISTRY_MAX_ENTRIES,
} from "./relayE2eeConstants.ts";
import {
  verifyNodeE2eeCapabilityStatement,
  type NodeE2eeCapabilityVerification,
  type NodeE2eeCapabilityVerificationInput,
} from "./relayE2eeCapabilityVerify.ts";
import { e2eeKeyFingerprint } from "./relayE2eeKeys.ts";
import {
  decodeCanonicalE2eeCbor,
  decodeNodeE2eeCapabilityStatement,
  encodeCanonicalE2eeCbor,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eeCapabilityTranscript,
  encodeNodeE2eePrekeyTranscript,
  encodeNodeIdentityContinuityTranscript,
  type NodeE2eeCapabilityTranscriptInput,
  type NodeIdentityContinuityChainEntry,
} from "./relayE2eeTranscripts.ts";
import {
  decodeE2eeCapabilityCarrier,
  encodeE2eeCapabilityCarrier,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
} from "./relayE2eeWire.ts";

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

// §16.1 deterministic material, identical to the seeds the corpus pins. TEST
// ONLY: these keys derive from public fixed seeds and must never key a real
// endpoint.
const NODE_SEED = bytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
const OLD_SEED = bytes("2121212121212121212121212121212121212121212121212121212121212121");
const NEW_SEED = bytes("2222222222222222222222222222222222222222222222222222222222222222");
const UNRELATED_SEED = bytes("2323232323232323232323232323232323232323232323232323232323232323");

const NODE_PUBLIC_KEY = ed25519.getPublicKey(NODE_SEED);
const OLD_PUBLIC_KEY = ed25519.getPublicKey(OLD_SEED);
const NEW_PUBLIC_KEY = ed25519.getPublicKey(NEW_SEED);
const UNRELATED_PUBLIC_KEY = ed25519.getPublicKey(UNRELATED_SEED);
const AGREEMENT_PUBLIC_KEY = bytes(
  "7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
);

const HUB_ORIGIN = "https://hub.example.com";
const OTHER_ORIGIN = "https://other.example.com";
const NODE_ID = "node_AAAAAAAAAAAAAAAAAAAAAA";
const IDENTITY_KEY_ID = "nkey_BBBBBBBBBBBBBBBBBBBBBB";
const OLD_KEY_ID = "nkey_CCCCCCCCCCCCCCCCCCCCCC";
const NEW_KEY_ID = "nkey_DDDDDDDDDDDDDDDDDDDDDD";
const PREKEY_ID = "epk_EEEEEEEEEEEEEEEEEEEEEE";
const CONTINUITY_ID = "nct_FFFFFFFFFFFFFFFFFFFFFF";
const OTHER_CONTINUITY_ID = "nct_HHHHHHHHHHHHHHHHHHHHHH";

const PREKEY_CREATED_AT = 1_784_160_000_000;
const PREKEY_EXPIRES_AT = 1_786_752_000_000;
const ISSUED_AT = 1_784_160_030_000;
const EXPIRES_AT = 1_784_160_630_000;
const NOW = 1_784_160_030_000;

const IDENTITY_FINGERPRINT = e2eeKeyFingerprint("node-identity", NODE_PUBLIC_KEY);
const OLD_FINGERPRINT = e2eeKeyFingerprint("node-identity", OLD_PUBLIC_KEY);
const UNRELATED_FINGERPRINT = e2eeKeyFingerprint("node-identity", UNRELATED_PUBLIC_KEY);

const PREKEY_CROSS_SIGNATURE = ed25519.sign(
  encodeNodeE2eePrekeyTranscript({
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    prekeyId: PREKEY_ID,
    identityPublicKey: NODE_PUBLIC_KEY,
    agreementPublicKey: AGREEMENT_PUBLIC_KEY,
    createdAt: PREKEY_CREATED_AT,
    expiresAt: PREKEY_EXPIRES_AT,
  }),
  NODE_SEED,
);

interface ContinuityInput {
  readonly generation: number;
  readonly oldSeed: Uint8Array;
  readonly oldKeyId: string;
  readonly newPublicKey: Uint8Array;
  readonly newKeyId: string;
  readonly hubOrigin?: string;
  readonly continuityId?: string;
  readonly signingSeed?: Uint8Array;
}

function continuityEntry(input: ContinuityInput): NodeIdentityContinuityChainEntry {
  const transcript = encodeNodeIdentityContinuityTranscript({
    hubOrigin: input.hubOrigin ?? HUB_ORIGIN,
    continuityId: input.continuityId ?? CONTINUITY_ID,
    generation: input.generation,
    oldKeyId: input.oldKeyId,
    oldPublicKey: ed25519.getPublicKey(input.oldSeed),
    newKeyId: input.newKeyId,
    newPublicKey: input.newPublicKey,
    createdAt: PREKEY_CREATED_AT,
  });
  return { transcript, signature: ed25519.sign(transcript, input.signingSeed ?? input.oldSeed) };
}

/** Generation 1: the key the pin records rotates to the intermediate key. */
const CHAIN_FIRST = continuityEntry({
  generation: 1,
  oldSeed: OLD_SEED,
  oldKeyId: OLD_KEY_ID,
  newPublicKey: NEW_PUBLIC_KEY,
  newKeyId: NEW_KEY_ID,
});
/** Generation 2: the intermediate key rotates to the statement's current identity key. */
const CHAIN_SECOND = continuityEntry({
  generation: 2,
  oldSeed: NEW_SEED,
  oldKeyId: NEW_KEY_ID,
  newPublicKey: NODE_PUBLIC_KEY,
  newKeyId: IDENTITY_KEY_ID,
});
const CHAIN: readonly NodeIdentityContinuityChainEntry[] = [CHAIN_FIRST, CHAIN_SECOND];

const BASE_TRANSCRIPT: NodeE2eeCapabilityTranscriptInput = {
  hubOrigin: HUB_ORIGIN,
  nodeId: NODE_ID,
  identityKeyId: IDENTITY_KEY_ID,
  identityPublicKey: NODE_PUBLIC_KEY,
  e2eeVersionMin: 1,
  e2eeVersionMax: 1,
  suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
  prekeyCertificate: {
    prekeyId: PREKEY_ID,
    agreementPublicKey: AGREEMENT_PUBLIC_KEY,
    crossSignature: PREKEY_CROSS_SIGNATURE,
    createdAt: PREKEY_CREATED_AT,
    expiresAt: PREKEY_EXPIRES_AT,
  },
  continuityChain: CHAIN,
  requireE2EE: false,
  requireApprovedClientE2EE: false,
  policyGeneration: 7,
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_AT,
  continuityId: CONTINUITY_ID,
};

function transcriptOf(overrides: Partial<NodeE2eeCapabilityTranscriptInput> = {}): Uint8Array {
  return encodeNodeE2eeCapabilityTranscript({ ...BASE_TRANSCRIPT, ...overrides });
}

function statementOf(transcript: Uint8Array, seed: Uint8Array = NODE_SEED): Uint8Array {
  return encodeCanonicalE2eeCbor([
    transcript,
    ed25519.sign(encodeNodeE2eeCapabilitySigningEnvelope(transcript), seed),
  ]);
}

/** The 19 transcript elements, so a case can state a value the encoder refuses to build. */
function elementsOf(transcript: Uint8Array): unknown[] {
  const decoded = decodeCanonicalE2eeCbor(transcript);
  if (decoded.kind !== "ok" || !Array.isArray(decoded.value)) {
    throw new Error("transcript is not a canonical CBOR array");
  }
  return [...decoded.value];
}

/**
 * A statement whose transcript carries `mutate`'s edit and whose signature is
 * REGENERATED over it. Every step-2 through step-7 case below is built this way
 * on purpose: a tampered statement that also failed step 1 would prove nothing
 * about the step it is named for.
 */
function tamperedStatement(
  mutate: (elements: unknown[]) => void,
  seed: Uint8Array = NODE_SEED,
): Uint8Array {
  const elements = elementsOf(transcriptOf());
  mutate(elements);
  return statementOf(encodeCanonicalE2eeCbor(elements), seed);
}

const STATEMENT = statementOf(transcriptOf());

const BASE_INPUT: NodeE2eeCapabilityVerificationInput = {
  statement: STATEMENT,
  connectedHubOrigin: HUB_ORIGIN,
  tier: "native",
  localSuitePreference: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
  now: NOW,
};

function verify(
  overrides: Partial<NodeE2eeCapabilityVerificationInput> = {},
): NodeE2eeCapabilityVerification {
  return verifyNodeE2eeCapabilityStatement({ ...BASE_INPUT, ...overrides });
}

/** The `{ kind, reason }` / `{ kind, event }` shape a case asserts, without the payload. */
function verdict(result: NodeE2eeCapabilityVerification): unknown {
  if (result.kind === "verified") return { kind: "verified", anchor: result.anchor };
  if (result.kind === "identity-event") return { kind: "identity-event", event: result.event };
  return { kind: result.kind, reason: result.reason };
}

describe("§5.3 capability carrier", () => {
  it("emits the bytes the node's own carrier assertions pin, and reads them back", () => {
    const carrier = encodeE2eeCapabilityCarrier(STATEMENT);
    const text = new TextDecoder().decode(carrier);
    const parsed = JSON.parse(text) as { readonly _tag: string; readonly statement: string };

    // The literal shape `NodeE2eeChannelAdvertiser.test.ts` asserts on the wire.
    expect(carrier[0]).toBe(0x7b);
    expect(Object.keys(parsed)).toEqual(["_tag", "statement"]);
    expect(parsed._tag).toBe("ryco.e2ee.capability.v1");
    expect(text).not.toContain("requestId");
    expect(text).toBe(JSON.stringify({ _tag: parsed._tag, statement: parsed.statement }));
    expect(parsed.statement).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(carrier.byteLength).toBe(E2EE_CAPABILITY_CARRIER_FIXED_BYTES + parsed.statement.length);
    expect(parsed.statement.length).toBe(Math.ceil((4 * STATEMENT.byteLength) / 3));

    const decoded = decodeE2eeCapabilityCarrier(carrier);
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") return;
    expect(hex(decoded.value)).toBe(hex(STATEMENT));
  });

  it("round-trips every statement length class the base64url tail distinguishes", () => {
    for (const length of [1, 2, 3, 4, 5, 6, 31, 32, 33]) {
      const statement = Uint8Array.from({ length }, (_unused, index) => (index * 37 + 11) & 0xff);
      const decoded = decodeE2eeCapabilityCarrier(encodeE2eeCapabilityCarrier(statement));
      expect(decoded.kind, String(length)).toBe("ok");
      if (decoded.kind !== "ok") continue;
      expect(hex(decoded.value), String(length)).toBe(hex(statement));
    }
  });

  it("rejects an oversized payload before it is parsed at all", () => {
    // Over the bound AND not JSON: only a decoder that measured first can answer
    // `too_large` for it.
    const oversized = new Uint8Array(E2EE_CAPABILITY_CARRIER_MAX_BYTES + 1).fill(0x7b);
    expect(decodeE2eeCapabilityCarrier(oversized)).toEqual({ kind: "error", reason: "too_large" });
    // One byte under, the same bytes reach the parser and fail there instead.
    expect(
      decodeE2eeCapabilityCarrier(oversized.subarray(0, E2EE_CAPABILITY_CARRIER_MAX_BYTES)),
    ).toEqual({ kind: "error", reason: "not_carrier" });
  });

  it("answers `not_carrier` for the legacy JSON this class is mostly made of", () => {
    for (const payload of [
      '{"_tag":"rpc.response","requestId":"01HZ","value":1}',
      '{"requestId":"01HZ"}',
      "[]",
      "{}",
      '{"_tag":"ryco.e2ee.capability.v2","statement":"AAAA"}',
    ]) {
      expect(decodeE2eeCapabilityCarrier(utf8(payload)), payload).toEqual({
        kind: "error",
        reason: "not_carrier",
      });
    }
    expect(decodeE2eeCapabilityCarrier(new Uint8Array(0))).toEqual({
      kind: "error",
      reason: "not_carrier",
    });
  });

  it("refuses every carrier-tagged payload that is not the exact §5.3 form", () => {
    const statement = "AAAA";
    for (const payload of [
      // A third member, a reversed member order, and a `requestId` — each of
      // which §5.3 forbids and each of which a lenient reader would accept.
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"${statement}","requestId":"01HZ"}`,
      `{"requestId":"01HZ","_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"${statement}"}`,
      `{"statement":"${statement}","_tag":"${E2EE_CAPABILITY_CARRIER_TAG}"}`,
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}"}`,
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":""}`,
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":null}`,
      // Whitespace a standard encoder never emits. The prelude is stripped
      // before discrimination (§4.3 step 1), so nothing legitimate looks like it.
      `{ "_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"${statement}" }`,
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}", "statement":"${statement}"}`,
      // A statement text that is not unpadded base64url.
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"AAA="}`,
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"AA+/"}`,
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"AAAAA"}`,
      // Canonical unpadded base64url leaves the unused tail bits zero; `AB` and
      // `AAB` decode to the same bytes as `AA` and `AAA` and are refused.
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"AB"}`,
      `{"_tag":"${E2EE_CAPABILITY_CARRIER_TAG}","statement":"AAB"}`,
    ]) {
      expect(decodeE2eeCapabilityCarrier(utf8(payload)), payload).toEqual({
        kind: "error",
        reason: "malformed",
      });
    }
  });

  it("refuses bytes a lenient UTF-8 decode would repair into a carrier", () => {
    const carrier = encodeE2eeCapabilityCarrier(STATEMENT);
    const mutated = Uint8Array.from(carrier);
    // A lone continuation byte inside the base64url text. `TextDecoder` replaces
    // it with U+FFFD, which re-encodes to three bytes that are not these bytes.
    mutated[E2EE_CAPABILITY_CARRIER_FIXED_BYTES + 10] = 0x80;
    expect(decodeE2eeCapabilityCarrier(mutated)).toEqual({ kind: "error", reason: "malformed" });
  });
});

describe("§5.2 statement verification", () => {
  it("accepts a conforming statement and hands back the §8.2 selection", () => {
    expect(verify()).toEqual({
      kind: "verified",
      statement: expect.anything(),
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      anchor: "none",
    });
    const result = verify();
    if (result.kind !== "verified") throw new Error("statement did not verify");
    // The decoded statement is the material §8.3 and §8.5 read next, carried as
    // the wire supplied it.
    expect(result.statement.nodeId).toBe(NODE_ID);
    expect(result.statement.hubOrigin).toBe(HUB_ORIGIN);
    expect(result.statement.policyGeneration).toBe(7);
    expect(result.statement.continuityId).toBe(CONTINUITY_ID);
    expect(result.statement.admittedPatterns).toEqual(["IK", "NX"]);
    expect(result.statement.continuityChain).toHaveLength(2);
    expect(hex(result.statement.identityFingerprint)).toBe(hex(IDENTITY_FINGERPRINT));
    expect(hex(result.statement.transcript)).toBe(hex(transcriptOf()));
  });

  it("rebuilds an untouched transcript byte for byte, so a tampered case differs only there", () => {
    const transcript = transcriptOf();
    expect(hex(encodeCanonicalE2eeCbor(elementsOf(transcript)))).toBe(hex(transcript));
  });

  describe("step 0 — bounds before decoding", () => {
    it("rejects an oversized statement before the statement CBOR is decoded", () => {
      // Over the bound and not decodable: `statement_too_large` is only
      // reachable when the length was measured first.
      const oversized = new Uint8Array(E2EE_CAPABILITY_STATEMENT_MAX_BYTES + 1).fill(0xff);
      expect(verdict(verify({ statement: oversized }))).toEqual({
        kind: "invalid",
        reason: "statement_too_large",
      });
      expect(verdict(verify({ statement: oversized.subarray(0, 8) }))).toEqual({
        kind: "invalid",
        reason: "statement_malformed",
      });
    });

    it("rejects an oversized transcript before the transcript CBOR is decoded", () => {
      // The transcript is over its bound and is not CBOR at all; the signature
      // element is not even the right shape. Only the specified order answers
      // `transcript_too_large`.
      const statement = encodeCanonicalE2eeCbor([
        new Uint8Array(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + 1).fill(0xff),
        new Uint8Array(1),
      ]);
      expect(statement.byteLength).toBeLessThanOrEqual(E2EE_CAPABILITY_STATEMENT_MAX_BYTES);
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "transcript_too_large",
      });
    });

    it("pins the §3.2.1 S4 arithmetic the two bounds are derived by", () => {
      expect(E2EE_CAPABILITY_STATEMENT_MAX_BYTES).toBe(
        E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + E2EE_STATEMENT_WRAPPER_MAX_BYTES,
      );
      expect(E2EE_CAPABILITY_STATEMENT_MAX_BYTES).toBe(5_190);
      expect(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES).toBe(5_120);
    });
  });

  describe("step 1 — the identity signature over the rebuilt §7.2.1 envelope", () => {
    it("verifies over the envelope and refuses every other signing input", () => {
      const transcript = transcriptOf();
      const envelope = encodeNodeE2eeCapabilitySigningEnvelope(transcript);
      expect(hex(statementOf(transcript))).toBe(
        hex(encodeCanonicalE2eeCbor([transcript, ed25519.sign(envelope, NODE_SEED)])),
      );
      // Signed over the raw transcript, not the envelope.
      expect(
        verdict(
          verify({
            statement: encodeCanonicalE2eeCbor([transcript, ed25519.sign(transcript, NODE_SEED)]),
          }),
        ),
      ).toEqual({ kind: "invalid", reason: "identity_signature_invalid" });
      // Signed by a key that is not the advertised one.
      expect(verdict(verify({ statement: statementOf(transcript, UNRELATED_SEED) }))).toEqual({
        kind: "invalid",
        reason: "identity_signature_invalid",
      });
    });

    it("refuses a statement carrying a bare digest where the transcript belongs", () => {
      // §7.2.1: no digest travels on the wire and none may be accepted from it.
      const digest = encodeNodeE2eeCapabilitySigningEnvelope(transcriptOf()).subarray(-32);
      expect(digest.byteLength).toBe(32);
      expect(
        verdict(
          verify({
            statement: encodeCanonicalE2eeCbor([digest, ed25519.sign(digest, NODE_SEED)]),
          }),
        ),
      ).toEqual({ kind: "invalid", reason: "transcript_malformed" });
    });

    it("verifies strictly, so a signature only a ZIP215 verifier accepts is refused", () => {
      // A = the identity point. `[S]B == R` holds for every message, so this pair
      // verifies under the ZIP215 relaxation; §14.3's `zip215: false` rejects the
      // small-order key. The first assertion is what proves the second is doing
      // work rather than tracking a library default.
      const smallOrderKey = bytes(
        "0100000000000000000000000000000000000000000000000000000000000000",
      );
      const scalar = 12_345_678_901_234_567_890n;
      const signature = new Uint8Array(64);
      signature.set(ed25519.Point.BASE.multiply(scalar).toBytes(), 0);
      let residue = scalar % ed25519.Point.Fn.ORDER;
      for (let index = 0; index < 32; index += 1) {
        signature[32 + index] = Number(residue & 0xffn);
        residue >>= 8n;
      }
      const elements = elementsOf(transcriptOf());
      elements[5] = smallOrderKey;
      elements[6] = e2eeKeyFingerprint("node-identity", smallOrderKey);
      const transcript = encodeCanonicalE2eeCbor(elements);
      const envelope = encodeNodeE2eeCapabilitySigningEnvelope(transcript);
      expect(ed25519.verify(signature, envelope, smallOrderKey, { zip215: true })).toBe(true);
      expect(ed25519.verify(signature, envelope, smallOrderKey, { zip215: false })).toBe(false);

      expect(
        verdict(verify({ statement: encodeCanonicalE2eeCbor([transcript, signature]) })),
      ).toEqual({ kind: "invalid", reason: "identity_signature_invalid" });
    });
  });

  describe("step 2 — every advertised fingerprint recomputed and COMPARED", () => {
    it("rejects a carried identity fingerprint that disagrees with the carried key", () => {
      // Re-signed, so step 1 passes: the only thing wrong is the carried element
      // 6. A verifier that re-derived the fingerprint instead of comparing
      // against the carried one would repair this statement and admit it.
      const statement = tamperedStatement((elements) => {
        elements[6] = UNRELATED_FINGERPRINT;
      });
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "identity_fingerprint_mismatch",
      });
    });

    it("rejects a carried agreement fingerprint that disagrees with the carried key", () => {
      const statement = tamperedStatement((elements) => {
        const prekey = [...(elements[10] as readonly unknown[])];
        prekey[3] = UNRELATED_FINGERPRINT;
        elements[10] = prekey;
      });
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "agreement_fingerprint_mismatch",
      });
    });
  });

  describe("step 3 — §5.7 freshness, with the specified skew", () => {
    const withInterval = (issuedAt: number, expiresAt: number): Uint8Array =>
      statementOf(transcriptOf({ issuedAt, expiresAt }));

    it("accepts the interval exactly at the bound and refuses one millisecond more", () => {
      expect(
        verify({
          statement: withInterval(ISSUED_AT, ISSUED_AT + E2EE_CAPABILITY_STATEMENT_VALIDITY),
        }).kind,
      ).toBe("verified");
      expect(
        verdict(
          verify({
            statement: withInterval(ISSUED_AT, ISSUED_AT + E2EE_CAPABILITY_STATEMENT_VALIDITY + 1),
          }),
        ),
      ).toEqual({ kind: "invalid", reason: "validity_interval_too_long" });
      expect(E2EE_CAPABILITY_STATEMENT_VALIDITY).toBe(600_000);
    });

    it("refuses an inverted interval, which no length check would catch", () => {
      expect(verdict(verify({ statement: withInterval(EXPIRES_AT, ISSUED_AT) }))).toEqual({
        kind: "invalid",
        reason: "validity_interval_inverted",
      });
    });

    it("allows exactly E2EE_MAX_CLOCK_SKEW of future issued-at and no more", () => {
      const atSkew = NOW + E2EE_MAX_CLOCK_SKEW;
      expect(verify({ statement: withInterval(atSkew, atSkew + 1_000) }).kind).toBe("verified");
      expect(verdict(verify({ statement: withInterval(atSkew + 1, atSkew + 1_000) }))).toEqual({
        kind: "invalid",
        reason: "issued_at_in_future",
      });
      expect(E2EE_MAX_CLOCK_SKEW).toBe(300_000);
    });

    it("allows exactly E2EE_MAX_CLOCK_SKEW of past expires-at and no more", () => {
      const atSkew = NOW - E2EE_MAX_CLOCK_SKEW;
      expect(verify({ statement: withInterval(atSkew - 1_000, atSkew) }).kind).toBe("verified");
      expect(verdict(verify({ statement: withInterval(atSkew - 1_001, atSkew - 1) }))).toEqual({
        kind: "invalid",
        reason: "statement_expired",
      });
    });
  });

  describe("step 4 — the origin the client is actually connected to", () => {
    it("rejects a statement minted for another Hub origin", () => {
      expect(verdict(verify({ connectedHubOrigin: OTHER_ORIGIN }))).toEqual({
        kind: "invalid",
        reason: "hub_origin_mismatch",
      });
    });
  });

  describe("step 5 — the §7.6 cross-signature reconstruction and §6.4 lifetime", () => {
    it("rejects a cross-signature lifted from a statement for another origin", () => {
      const lifted = ed25519.sign(
        encodeNodeE2eePrekeyTranscript({
          hubOrigin: OTHER_ORIGIN,
          nodeId: NODE_ID,
          identityKeyId: IDENTITY_KEY_ID,
          prekeyId: PREKEY_ID,
          identityPublicKey: NODE_PUBLIC_KEY,
          agreementPublicKey: AGREEMENT_PUBLIC_KEY,
          createdAt: PREKEY_CREATED_AT,
          expiresAt: PREKEY_EXPIRES_AT,
        }),
        NODE_SEED,
      );
      const statement = statementOf(
        transcriptOf({
          prekeyCertificate: { ...BASE_TRANSCRIPT.prekeyCertificate, crossSignature: lifted },
        }),
      );
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "prekey_cross_signature_invalid",
      });
    });

    it("rejects a prekey window edited after the cross-signature was made", () => {
      // The transcript is RECONSTRUCTED from the statement's own members, so
      // moving `createdAt` moves the bytes the cross-signature has to cover. It
      // is moved forward, which shortens the window, so the §6.4 lifetime bound
      // still holds and the cross-signature is the only thing left to fail.
      const statement = tamperedStatement((elements) => {
        const prekey = [...(elements[10] as readonly unknown[])];
        prekey[4] = PREKEY_CREATED_AT + 1_000;
        elements[10] = prekey;
      });
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "prekey_cross_signature_invalid",
      });
    });

    it("accepts a lifetime exactly at E2EE_PREKEY_LIFETIME and refuses one millisecond more", () => {
      expect(PREKEY_EXPIRES_AT - PREKEY_CREATED_AT).toBe(E2EE_PREKEY_LIFETIME);
      expect(E2EE_PREKEY_LIFETIME).toBe(2_592_000_000);
      expect(verify().kind).toBe("verified");
      // The bound is checked before the cross-signature, so an over-long window
      // reports its own reason rather than the signature that no longer covers it.
      const statement = tamperedStatement((elements) => {
        const prekey = [...(elements[10] as readonly unknown[])];
        prekey[5] = PREKEY_CREATED_AT + E2EE_PREKEY_LIFETIME + 1;
        elements[10] = prekey;
      });
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "prekey_lifetime_too_long",
      });
    });

    it("rejects an expired prekey against the verifier's own clock", () => {
      const expiresAt = NOW - E2EE_MAX_CLOCK_SKEW - 1;
      const statement = tamperedStatement((elements) => {
        const prekey = [...(elements[10] as readonly unknown[])];
        prekey[4] = expiresAt - 1_000;
        prekey[5] = expiresAt;
        elements[10] = prekey;
      });
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "prekey_expired",
      });
    });

    it("rejects an inverted prekey window", () => {
      const statement = tamperedStatement((elements) => {
        const prekey = [...(elements[10] as readonly unknown[])];
        prekey[4] = PREKEY_EXPIRES_AT;
        prekey[5] = PREKEY_CREATED_AT;
        elements[10] = prekey;
      });
      expect(verdict(verify({ statement }))).toEqual({
        kind: "invalid",
        reason: "prekey_lifetime_inverted",
      });
    });
  });

  describe("step 6 — the §7.5 chain, and the only step that answers `identity-event`", () => {
    const pinnedToOldKey = { identityFingerprint: OLD_FINGERPRINT, continuityId: CONTINUITY_ID };
    const pinnedToCurrentKey = {
      identityFingerprint: IDENTITY_FINGERPRINT,
      continuityId: CONTINUITY_ID,
    };

    const withChain = (chain: readonly NodeIdentityContinuityChainEntry[]): Uint8Array =>
      statementOf(transcriptOf({ continuityChain: chain }));

    it("walks a pin forward to the current key silently, and reports which anchor held", () => {
      expect(verdict(verify({ pin: pinnedToOldKey }))).toEqual({
        kind: "verified",
        anchor: "pin-updated",
      });
      expect(verdict(verify({ pin: pinnedToCurrentKey }))).toEqual({
        kind: "verified",
        anchor: "pin-unchanged",
      });
      expect(verdict(verify())).toEqual({ kind: "verified", anchor: "none" });
      expect(verdict(verify({ statement: withChain([]), pin: undefined }))).toEqual({
        kind: "verified",
        anchor: "none",
      });
    });

    it("answers `identity-event` for every chain break §7.5 enumerates", () => {
      const regressed = continuityEntry({
        generation: 1,
        oldSeed: NEW_SEED,
        oldKeyId: NEW_KEY_ID,
        newPublicKey: NODE_PUBLIC_KEY,
        newKeyId: IDENTITY_KEY_ID,
      });
      const spliced = continuityEntry({
        generation: 2,
        oldSeed: UNRELATED_SEED,
        oldKeyId: NEW_KEY_ID,
        newPublicKey: NODE_PUBLIC_KEY,
        newKeyId: IDENTITY_KEY_ID,
      });
      const otherOriginEntry = continuityEntry({
        generation: 2,
        oldSeed: NEW_SEED,
        oldKeyId: NEW_KEY_ID,
        newPublicKey: NODE_PUBLIC_KEY,
        newKeyId: IDENTITY_KEY_ID,
        hubOrigin: OTHER_ORIGIN,
      });
      const otherContinuityEntry = continuityEntry({
        generation: 2,
        oldSeed: NEW_SEED,
        oldKeyId: NEW_KEY_ID,
        newPublicKey: NODE_PUBLIC_KEY,
        newKeyId: IDENTITY_KEY_ID,
        continuityId: OTHER_CONTINUITY_ID,
      });
      const wronglySigned = continuityEntry({
        generation: 2,
        oldSeed: NEW_SEED,
        oldKeyId: NEW_KEY_ID,
        newPublicKey: NODE_PUBLIC_KEY,
        newKeyId: IDENTITY_KEY_ID,
        signingSeed: UNRELATED_SEED,
      });

      const cases: readonly (readonly [string, Uint8Array, string, unknown])[] = [
        ["spliced", withChain([CHAIN_FIRST, spliced]), "link_mismatch", pinnedToOldKey],
        [
          "reordered",
          withChain([CHAIN_SECOND, CHAIN_FIRST]),
          "generation_not_consecutive",
          pinnedToOldKey,
        ],
        ["truncated head", withChain([CHAIN_SECOND]), "pin_not_reached", pinnedToOldKey],
        ["truncated tail", withChain([CHAIN_FIRST]), "identity_key_mismatch", pinnedToOldKey],
        [
          "regressed",
          withChain([CHAIN_FIRST, regressed]),
          "generation_not_consecutive",
          pinnedToOldKey,
        ],
        [
          "hub origin",
          withChain([CHAIN_FIRST, otherOriginEntry]),
          "hub_origin_mismatch",
          pinnedToOldKey,
        ],
        [
          "continuity id",
          withChain([CHAIN_FIRST, otherContinuityEntry]),
          "continuity_id_mismatch",
          pinnedToOldKey,
        ],
        ["signature", withChain([CHAIN_FIRST, wronglySigned]), "invalid_signature", pinnedToOldKey],
        [
          "does not reach the pin",
          STATEMENT,
          "pin_not_reached",
          {
            identityFingerprint: UNRELATED_FINGERPRINT,
            continuityId: CONTINUITY_ID,
          },
        ],
        // Every break is channel-fatal on first contact too: §7.5's chain rules
        // are properties of the carried chain, not of the pin.
        ["spliced, unpinned", withChain([CHAIN_FIRST, spliced]), "link_mismatch", undefined],
      ];

      for (const [label, statement, failure, pin] of cases) {
        expect(
          verdict(verify({ statement, pin: pin as NodeE2eeCapabilityVerificationInput["pin"] })),
          label,
        ).toEqual({
          kind: "identity-event",
          event: { reason: "continuity_chain", failure },
        });
      }
    });

    it("treats a continuity id differing from the pinned one as an identity event, never first contact", () => {
      // A never-rotated node, so the pinned fingerprint already equals the
      // current key and the continuity id is the only thing left to disagree.
      const statement = statementOf(
        transcriptOf({ continuityId: OTHER_CONTINUITY_ID, continuityChain: [] }),
      );
      expect(
        verdict(verify({ statement, pin: { ...pinnedToCurrentKey, continuityId: CONTINUITY_ID } })),
      ).toEqual({ kind: "identity-event", event: { reason: "pinned_continuity_id" } });
      // The identical statement under a pin that records that id, and under no
      // pin at all, is exactly what the assertion above is about the PIN and not
      // about the id.
      expect(
        verdict(
          verify({ statement, pin: { ...pinnedToCurrentKey, continuityId: OTHER_CONTINUITY_ID } }),
        ),
      ).toEqual({ kind: "verified", anchor: "pin-unchanged" });
      expect(verdict(verify({ statement }))).toEqual({ kind: "verified", anchor: "none" });
    });
  });

  describe("step 7 — §5.7 policy-generation rollback", () => {
    it("reports a lower generation as invalid and specifically NOT as an identity event", () => {
      const result = verify({ acceptedPolicyGeneration: 8 });
      expect(verdict(result)).toEqual({ kind: "invalid", reason: "policy_generation_regressed" });
      expect(result.kind).not.toBe("identity-event");
      expect(verify({ acceptedPolicyGeneration: 7 }).kind).toBe("verified");
      expect(verify({ acceptedPolicyGeneration: 6 }).kind).toBe("verified");
    });
  });

  describe("steps 8 and 9 — unusable evidence, after everything else", () => {
    const outOfRange = statementOf(transcriptOf({ e2eeVersionMin: 2, e2eeVersionMax: 3 }));
    const inverted = statementOf(
      encodeCanonicalE2eeCbor(
        (() => {
          const elements = elementsOf(transcriptOf());
          elements[7] = 3;
          elements[8] = 2;
          return elements;
        })(),
      ),
    );
    const ikOnly = statementOf(transcriptOf({ requireApprovedClientE2EE: true }));

    it("answers `unusable` for a range that excludes this client's version", () => {
      expect(verdict(verify({ statement: outOfRange }))).toEqual({
        kind: "unusable",
        reason: "protocol_version_out_of_range",
      });
      expect(verdict(verify({ statement: inverted }))).toEqual({
        kind: "unusable",
        reason: "protocol_version_out_of_range",
      });
    });

    it("answers `unusable` for a pattern set this tier is absent from", () => {
      expect(verdict(verify({ statement: ikOnly, tier: "web" }))).toEqual({
        kind: "unusable",
        reason: "pattern_not_admitted",
      });
      // The identical statement is usable to the tier the set admits (§8.1).
      expect(verify({ statement: ikOnly, tier: "native" }).kind).toBe("verified");
    });

    it("answers `unusable` for an empty suite intersection, which §5.2 gives the same disposition", () => {
      expect(verdict(verify({ localSuitePreference: [0x7f] }))).toEqual({
        kind: "unusable",
        reason: "empty_suite_intersection",
      });
    });

    it("SURFACES AN IDENTITY EVENT THROUGH A FAILING STEP 8 OR 9", () => {
      // The whole reason §5.2 places steps 8 and 9 after every validation step:
      // a statement that also fails step 6 is an identity event and must reach
      // the §13.3 re-verification path, which a version or pattern check running
      // earlier would mask.
      const spliced = continuityEntry({
        generation: 2,
        oldSeed: UNRELATED_SEED,
        oldKeyId: NEW_KEY_ID,
        newPublicKey: NODE_PUBLIC_KEY,
        newKeyId: IDENTITY_KEY_ID,
      });
      const brokenChain = [CHAIN_FIRST, spliced];
      const pin = { identityFingerprint: OLD_FINGERPRINT, continuityId: CONTINUITY_ID };
      const identityEvent = {
        kind: "identity-event",
        event: { reason: "continuity_chain", failure: "link_mismatch" },
      };

      // Fails step 6 and step 8.
      expect(
        verdict(
          verify({
            statement: statementOf(
              transcriptOf({ continuityChain: brokenChain, e2eeVersionMin: 2, e2eeVersionMax: 3 }),
            ),
            pin,
          }),
        ),
      ).toEqual(identityEvent);
      // Fails step 6 and step 9.
      expect(
        verdict(
          verify({
            statement: statementOf(
              transcriptOf({ continuityChain: brokenChain, requireApprovedClientE2EE: true }),
            ),
            tier: "web",
            pin,
          }),
        ),
      ).toEqual(identityEvent);
      // The controls: the same two statements with an intact chain are exactly
      // the `unusable` verdicts the step-6 failure was masking.
      expect(
        verdict(
          verify({
            statement: statementOf(transcriptOf({ e2eeVersionMin: 2, e2eeVersionMax: 3 })),
            pin,
          }),
        ),
      ).toEqual({ kind: "unusable", reason: "protocol_version_out_of_range" });
      expect(
        verdict(
          verify({
            statement: statementOf(transcriptOf({ requireApprovedClientE2EE: true })),
            tier: "web",
            pin,
          }),
        ),
      ).toEqual({ kind: "unusable", reason: "pattern_not_admitted" });
    });

    it("keeps the identity vocabulary and the unusable vocabulary disjoint", () => {
      // The structural claim, stated as a value: an `unusable` verdict carries a
      // reason and nothing else, so there is no field an identity substitution
      // could travel in even if some later step tried to report one here.
      const unusable = verify({ statement: outOfRange });
      if (unusable.kind !== "unusable") throw new Error("expected an unusable verdict");
      expect(Object.keys(unusable).toSorted()).toEqual(["kind", "reason"]);
      expect([
        "protocol_version_out_of_range",
        "pattern_not_admitted",
        "empty_suite_intersection",
      ]).toContain(unusable.reason);
    });
  });

  describe("§3.6 canonical CBOR", () => {
    it("rejects every encoding the §3.6 profile forbids, at the statement layer", () => {
      const cases: readonly (readonly [string, Uint8Array, string])[] = [
        // Map keys the codec accepts and re-emits in bytewise order: the one
        // class that survives the strict decode and is caught by the §3.6
        // re-encode byte-equality rule instead.
        [
          "unsorted map keys",
          Uint8Array.from([0xa2, 0x62, 0x62, 0x62, 0x01, 0x61, 0x61, 0x02]),
          "statement_non_canonical",
        ],
        // A two-element array whose first byte string carries a two-byte length
        // header it does not need; the strict decode rejects it a step earlier.
        [
          "non-shortest length",
          Uint8Array.from([0x82, 0x59, 0x00, 0x05, 1, 2, 3, 4, 5, 0x40]),
          "statement_malformed",
        ],
        ["indefinite array", Uint8Array.from([0x9f, 0x01, 0xff]), "statement_malformed"],
        [
          "duplicate map keys",
          Uint8Array.from([0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02]),
          "statement_malformed",
        ],
        ["undefined", Uint8Array.from([0xf7]), "statement_malformed"],
        ["NaN", Uint8Array.from([0xf9, 0x7e, 0x00]), "statement_malformed"],
        ["Infinity", Uint8Array.from([0xf9, 0x7c, 0x00]), "statement_malformed"],
        ["float16", Uint8Array.from([0xf9, 0x3c, 0x00]), "statement_float_forbidden"],
        [
          "float64",
          Uint8Array.from([0xfb, 0x3f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
          "statement_float_forbidden",
        ],
        ["trailing bytes", Uint8Array.from([0x01, 0x01]), "statement_malformed"],
        ["empty", new Uint8Array(0), "statement_malformed"],
      ];
      for (const [label, statement, reason] of cases) {
        expect(verdict(verify({ statement })), label).toEqual({ kind: "invalid", reason });
      }
    });

    it("applies the same profile to the transcript inside a well-formed statement", () => {
      const wrap = (transcript: Uint8Array): Uint8Array =>
        encodeCanonicalE2eeCbor([transcript, ed25519.sign(new Uint8Array(1), NODE_SEED)]);
      // A float where element 15 belongs. It decodes to a value nothing can tell
      // from the integer, so only a walk over the ENCODING rejects it.
      const elements = elementsOf(transcriptOf());
      elements[15] = 1.5;
      expect(verdict(verify({ statement: wrap(encodeCanonicalE2eeCbor(elements)) }))).toEqual({
        kind: "invalid",
        reason: "transcript_float_forbidden",
      });
      // The re-encode rule reaches the inner layer too.
      expect(
        verdict(
          verify({
            statement: wrap(Uint8Array.from([0xa2, 0x62, 0x62, 0x62, 0x01, 0x61, 0x61, 0x02])),
          }),
        ),
      ).toEqual({ kind: "invalid", reason: "transcript_non_canonical" });
      // A transcript whose own outer array header is not shortest-form; the
      // strict decode rejects it a step before the re-encode rule would.
      const canonical = transcriptOf();
      const nonShortest = Uint8Array.from([0x98, 0x13, ...canonical.subarray(1)]);
      expect(verdict(verify({ statement: wrap(nonShortest) }))).toEqual({
        kind: "invalid",
        reason: "transcript_malformed",
      });
      expect(verdict(verify({ statement: wrap(Uint8Array.from([0x9f, 0x01, 0xff])) }))).toEqual({
        kind: "invalid",
        reason: "transcript_malformed",
      });
    });
  });

  describe("§15 bounds", () => {
    /** A statement whose signature cannot verify, so a bound that ran late would show. */
    const unsigned = (transcript: Uint8Array): Uint8Array =>
      encodeCanonicalE2eeCbor([transcript, new Uint8Array(64)]);

    it("checks the suite registry bound before any signature verification", () => {
      const atBound = elementsOf(transcriptOf());
      atBound[9] = Array.from({ length: E2EE_SUITE_REGISTRY_MAX_ENTRIES }, (_unused, i) => i + 1);
      expect(verdict(verify({ statement: unsigned(encodeCanonicalE2eeCbor(atBound)) }))).toEqual({
        kind: "invalid",
        reason: "identity_signature_invalid",
      });

      const overBound = elementsOf(transcriptOf());
      overBound[9] = Array.from(
        { length: E2EE_SUITE_REGISTRY_MAX_ENTRIES + 1 },
        (_unused, i) => i + 1,
      );
      expect(verdict(verify({ statement: unsigned(encodeCanonicalE2eeCbor(overBound)) }))).toEqual({
        kind: "invalid",
        reason: "suite_registry_too_large",
      });
      expect(E2EE_SUITE_REGISTRY_MAX_ENTRIES).toBe(8);
    });

    it("checks the continuity chain depth before any signature verification", () => {
      const entry = elementsOf(transcriptOf())[11] as readonly unknown[];
      const elements = elementsOf(transcriptOf());
      elements[11] = Array.from(
        { length: E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1 },
        () => entry[0] as unknown,
      );
      expect(verdict(verify({ statement: unsigned(encodeCanonicalE2eeCbor(elements)) }))).toEqual({
        kind: "invalid",
        reason: "continuity_chain_too_long",
      });
      expect(E2EE_CONTINUITY_CHAIN_MAX_LENGTH).toBe(8);
    });

    it("bounds the Hub origin the statement carries and the one the client connected to", () => {
      const overLong = `https://${"a".repeat(109)}.example.com`;
      expect(utf8(overLong).byteLength).toBe(E2EE_HUB_ORIGIN_MAX_BYTES + 1);
      const elements = elementsOf(transcriptOf());
      elements[1] = overLong;
      expect(verdict(verify({ statement: unsigned(encodeCanonicalE2eeCbor(elements)) }))).toEqual({
        kind: "invalid",
        reason: "hub_origin_too_long",
      });
      expect(verdict(verify({ connectedHubOrigin: overLong }))).toEqual({
        kind: "invalid",
        reason: "connected_hub_origin_invalid",
      });
      expect(verdict(verify({ connectedHubOrigin: "http://hub.example.com" }))).toEqual({
        kind: "invalid",
        reason: "connected_hub_origin_invalid",
      });
      expect(E2EE_HUB_ORIGIN_MAX_BYTES).toBe(128);
    });

    it("bounds the Hub-chosen account scope without throwing on it", () => {
      expect(verify({ accountId: "a".repeat(E2EE_ACCOUNT_ID_MAX_BYTES) }).kind).toBe("verified");
      expect(verdict(verify({ accountId: "a".repeat(E2EE_ACCOUNT_ID_MAX_BYTES + 1) }))).toEqual({
        kind: "invalid",
        reason: "account_scope_invalid",
      });
      expect(verdict(verify({ accountId: "" }))).toEqual({
        kind: "invalid",
        reason: "account_scope_invalid",
      });
      expect(E2EE_ACCOUNT_ID_MAX_BYTES).toBe(256);
    });
  });
});

// ─── §16.3 corpus ────────────────────────────────────────────────────────────
//
// The consuming pattern of `relayE2eeCorpus.test.ts`: the committed family files
// are read, and each case's expectation is re-derived from that case's own
// inputs THROUGH this verifier. Only the families whose cases carry a complete
// signed statement or carrier are applicable — F3 and F2 — plus the F5 chains
// whose final identity key is one the corpus publishes a seed for, which is what
// lets a statement be built around them here.

const FIXTURE_ROOT = new URL("../fixtures/e2ee/v1/", import.meta.url);

interface FixtureCase {
  readonly name: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>>;
}

interface FixtureFamily {
  readonly testKeyMaterial: Readonly<Record<string, unknown>>;
  readonly cases: readonly FixtureCase[];
}

function readFamily(name: string): FixtureFamily {
  return JSON.parse(
    new TextDecoder().decode(readFileSync(new URL(name, FIXTURE_ROOT))),
  ) as FixtureFamily;
}

function fixtureBytes(value: unknown): Uint8Array {
  const wrapper = value as { readonly $bytes: string };
  expect(Object.keys(wrapper)).toEqual(["$bytes"]);
  return bytes(wrapper.$bytes);
}

function caseByName(family: FixtureFamily, name: string): FixtureCase {
  const found = family.cases.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Fixture case ${name} is missing from the corpus.`);
  return found;
}

const F02 = readFamily("f02-carrier-compatibility.json");
const F03 = readFamily("f03-capability-statement.json");
const F05 = readFamily("f05-continuity-chains.json");

describe("§16.3 corpus, driven through the §5.2 verifier", () => {
  it("builds the committed statement bytes from the committed inputs", () => {
    // The locally built statement IS the corpus's, byte for byte — which is what
    // makes every locally built case above a case about the same artifact the
    // node emits.
    const valid = caseByName(F03, "valid-capability-statement");
    expect(hex(transcriptOf())).toBe(hex(fixtureBytes(valid.expected.transcript)));
    expect(hex(STATEMENT)).toBe(hex(fixtureBytes(valid.expected.statement)));
    expect(hex(NODE_PUBLIC_KEY)).toBe(hex(fixtureBytes(F03.testKeyMaterial.nodeIdentityPublicKey)));
    expect(hex(IDENTITY_FINGERPRINT)).toBe(hex(fixtureBytes(valid.expected.identityFingerprint)));
  });

  it("verifies the committed valid statements against the committed clock", () => {
    for (const name of [
      "valid-capability-statement",
      "valid-statement-from-a-never-rotated-node",
    ]) {
      const entry = caseByName(F03, name);
      const result = verify({ statement: fixtureBytes(entry.expected.statement), now: NOW });
      expect(verdict(result), name).toEqual({ kind: "verified", anchor: "none" });
      if (result.kind !== "verified") continue;
      expect(result.statement.admittedPatterns, name).toEqual(entry.expected.admittedPatterns);
      expect(hex(result.statement.prekeyCertificate.agreementFingerprint), name).toBe(
        hex(fixtureBytes(entry.expected.agreementFingerprint)),
      );
    }
  });

  it("reproduces every committed §5.2 step 8 and step 9 verdict from the committed statement", () => {
    const applicable = F03.cases.filter((entry) => entry.inputs.statement !== undefined);
    expect(applicable.map((entry) => entry.name)).toEqual([
      "protocol-range-excludes-the-implemented-version-unlatched",
      "protocol-range-excludes-the-implemented-version-latched",
      "protocol-range-minimum-equal-to-the-implemented-version",
      "admitted-pattern-set-ik-only-evaluated-as-web-latched",
      "admitted-pattern-set-ik-only-evaluated-as-web-unlatched",
      "admitted-pattern-set-ik-only-evaluated-as-native",
      "admitted-pattern-set-ik-and-nx-evaluated-as-web",
    ]);
    for (const entry of applicable) {
      const selection = entry.expected.selection as Readonly<Record<string, unknown>>;
      const result = verify({
        statement: fixtureBytes(entry.inputs.statement),
        tier: entry.inputs.tier as "native" | "web",
        localSuitePreference: entry.inputs.localSuitePreference as readonly number[],
        now: NOW,
      });
      if (selection.kind === "unusable") {
        expect(verdict(result), entry.name).toEqual({
          kind: "unusable",
          reason: selection.reason,
        });
        expect(entry.expected.helloMayBeBuilt, entry.name).toBe(false);
      } else {
        expect(result.kind, entry.name).toBe("verified");
        if (result.kind !== "verified") continue;
        expect(result.selectedSuite, entry.name).toBe(selection.selectedSuite);
        expect(entry.expected.helloMayBeBuilt, entry.name).toBe(true);
      }
    }
  });

  it("reads the committed carriers back to the statements they carry", () => {
    for (const name of [
      "c1-carrier-reassembly-with-the-prelude",
      "c1-carrier-reassembly-without-the-prelude",
    ]) {
      const entry = caseByName(F02, name);
      const carrier = fixtureBytes(entry.expected.reassembled);
      const decoded = decodeE2eeCapabilityCarrier(carrier);
      expect(decoded.kind, name).toBe("ok");
      if (decoded.kind !== "ok") continue;
      expect(decodeNodeE2eeCapabilityStatement(decoded.value).kind, name).toBe("ok");
      expect(entry.expected.carrierTag ?? E2EE_CAPABILITY_CARRIER_TAG).toBe(
        E2EE_CAPABILITY_CARRIER_TAG,
      );
    }
  });

  it("walks the committed continuity chains whose identity key the corpus publishes a seed for", () => {
    const seeds = new Map([
      [hex(NODE_PUBLIC_KEY), NODE_SEED],
      [hex(NEW_PUBLIC_KEY), NEW_SEED],
    ]);
    const applicable = F05.cases.filter((entry) =>
      seeds.has(hex(fixtureBytes(entry.inputs.identityPublicKey))),
    );
    expect(applicable.map((entry) => entry.name)).toEqual([
      "valid-chain-of-length-one-with-silent-pin-update",
      "valid-chain-with-a-pin-that-already-equals-the-current-key",
      "valid-chain-with-no-pin-held",
      "empty-chain-from-a-never-rotated-node",
    ]);
    for (const entry of applicable) {
      const identityPublicKey = fixtureBytes(entry.inputs.identityPublicKey);
      const seed = seeds.get(hex(identityPublicKey));
      if (seed === undefined) continue;
      const chain = (entry.inputs.chain as readonly Readonly<Record<string, unknown>>[]).map(
        (carried) => ({
          transcript: fixtureBytes(carried.transcript),
          signature: fixtureBytes(carried.signature),
        }),
      );
      // The prekey cross-signature is bound to the identity key, so it is
      // re-made under the key this case advertises.
      const crossSignature = ed25519.sign(
        encodeNodeE2eePrekeyTranscript({
          hubOrigin: entry.inputs.hubOrigin as string,
          nodeId: NODE_ID,
          identityKeyId: IDENTITY_KEY_ID,
          prekeyId: PREKEY_ID,
          identityPublicKey,
          agreementPublicKey: AGREEMENT_PUBLIC_KEY,
          createdAt: PREKEY_CREATED_AT,
          expiresAt: PREKEY_EXPIRES_AT,
        }),
        seed,
      );
      const statement = statementOf(
        transcriptOf({
          hubOrigin: entry.inputs.hubOrigin as string,
          identityPublicKey,
          continuityId: entry.inputs.continuityId as string,
          continuityChain: chain,
          prekeyCertificate: { ...BASE_TRANSCRIPT.prekeyCertificate, crossSignature },
        }),
        seed,
      );
      const pinned = entry.inputs.pinnedIdentityFingerprint;
      const result = verify({
        statement,
        connectedHubOrigin: entry.inputs.hubOrigin as string,
        ...(pinned === undefined
          ? {}
          : {
              pin: {
                identityFingerprint: fixtureBytes(pinned),
                continuityId: entry.inputs.continuityId as string,
              },
            }),
      });
      expect(result.kind, entry.name).toBe("verified");
      if (result.kind !== "verified") continue;
      expect(entry.expected.kind, entry.name).toBe("ok");
      const unchanged = entry.expected.pinnedFingerprintUnchanged;
      expect(result.anchor, entry.name).toBe(
        pinned === undefined ? "none" : unchanged === true ? "pin-unchanged" : "pin-updated",
      );
    }
  });
});
