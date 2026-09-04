import * as fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_AAD_BYTES,
  E2EE_AEAD_NONCE_BYTES,
  E2EE_AEAD_TAG_BYTES,
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_COUNTER_MAX,
  E2EE_ENVELOPE_DISCRIMINATOR,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_HANDSHAKE_REJECT_PAD_BYTES,
  E2EE_NEGOTIATION_DISCRIMINATOR,
  E2EE_PROTOCOL_VERSION,
  E2EE_SERVER_ACCEPT_MAX_BYTES,
  E2EE_SESSION_BINDING_HASH_BYTES,
  RELAY_CHUNK_CAPABILITY_PRELUDE,
  RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
  RELAY_CHUNK_MAGIC,
  RELAY_MAX_RPC_MESSAGE_BYTES,
  RELAY_MIN_DATA_CHUNK_BYTES,
  e2eeChannelSizeBudget,
} from "./relayE2eeConstants.ts";
import {
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
  classifyPostStripPayload,
  decodeE2eeEnvelope,
  decodeE2eeInnerRecord,
  decodeE2eeNegotiationRecord,
  e2eeAeadNonce,
  e2eeAeadNonceFromHeader,
  e2eeEnvelopeAad,
  e2eeNegotiationRecordDirection,
  encodeE2eeDirectionLabel,
  encodeE2eeEnvelope,
  encodeE2eeEnvelopeHeader,
  encodeE2eeHandshakeReject,
  encodeE2eeInnerRecord,
  encodeE2eeNegotiationRecord,
  isE2eeDirection,
  type E2eeDirection,
  type E2eeEnvelopeFields,
  type E2eeInnerRecordType,
} from "./relayE2eeWire.ts";
import {
  RelayMessageAssembler,
  isChunkedPayload,
  prepareRelayMessage,
  stripRelayChunkCapabilityPrelude,
} from "./relayMessageChunks.ts";

const PROPERTY_SEED = 0x5259_434f;
const SUITE = E2EE_SUITE_25519_CHACHAPOLY_SHA256;
const MIN_CIPHERTEXT_BYTES = E2EE_ENVELOPE_OVERHEAD_BYTES - E2EE_ENVELOPE_HEADER_BYTES;

/**
 * §11.2 fixes every byte of the reject record: the negotiation discriminator,
 * the reject type, then the canonical-CBOR byte string holding sixty zero bytes
 * — major type 2 with a one-byte length, which is `0x58 0x3C`. Written out as
 * literals because this record is the whole pre-key error surface: an
 * independent implementation must produce these 64 bytes and no others.
 */
const CANONICAL_HANDSHAKE_REJECT: ReadonlyArray<number> = [
  0x02,
  0x03,
  0x58,
  0x3c,
  ...new Uint8Array(60),
];

function ciphertext(byteLength: number, fill = 0xa5): Uint8Array {
  return new Uint8Array(byteLength).fill(fill);
}

function envelope(fields: Partial<E2eeEnvelopeFields> = {}, body = ciphertext(64)): Uint8Array {
  return encodeE2eeEnvelope({ suite: SUITE, epoch: 0n, counter: 0n, ...fields, ciphertext: body });
}

function unwrap<Value>(result: { kind: "ok"; value: Value } | { kind: "error"; reason: string }) {
  if (result.kind !== "ok") throw new Error(`unexpected error: ${result.reason}`);
  return result.value;
}

function assembleOne(payloads: ReadonlyArray<Uint8Array>): Uint8Array {
  const assembler = new RelayMessageAssembler();
  let assembled: Uint8Array | undefined;
  for (const payload of payloads) {
    const result = assembler.push(payload);
    if (result.kind === "done") {
      expect(assembled).toBeUndefined();
      assembled = result.message;
    } else {
      expect(result).toEqual({ kind: "pending" });
    }
  }
  if (!assembled) throw new Error("the assembler never completed a message");
  return assembled;
}

// ─────────────────────────────────────────────────────────────────────────────
// The §3.4 registries and the §11.2 record, pinned to their literal wire values.
//
// Every expected value is the literal the specification prints. Registry values
// are what an independent implementation matches on, so an assertion written
// over the symbol it is checking — `expect(E2EE_INNER_TYPE_CLOSE).toBe(
// E2EE_INNER_TYPE_CLOSE)` in any of its disguises — proves nothing at all.
// ─────────────────────────────────────────────────────────────────────────────

type SpecRegistryRow = readonly [
  registry: string,
  entry: string,
  actual: () => unknown,
  spec: unknown,
];

// `actual` is a thunk rather than a value so that a row whose encoder throws
// fails its own row, instead of taking the whole file down at import time.
const SPEC_REGISTRIES: ReadonlyArray<SpecRegistryRow> = [
  [
    "§3.4 suite registry",
    "25519 / ChaChaPoly / SHA-256",
    () => E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    0x01,
  ],
  [
    "§18 suite registry",
    "account-grant IK / 25519 / ChaChaPoly / SHA-256",
    () => E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
    0x02,
  ],
  ["§3.4 inner-record types", "RPC", () => E2EE_INNER_TYPE_RPC, 0x01],
  ["§3.4 inner-record types", "E2EEClose", () => E2EE_INNER_TYPE_CLOSE, 0x02],
  ["§3.4 inner-record types", "E2EEError", () => E2EE_INNER_TYPE_ERROR, 0x03],
  ["§3.4 inner-record types", "E2EECloseAck", () => E2EE_INNER_TYPE_CLOSE_ACK, 0x04],
  ["§3.4 negotiation types", "E2EEClientHello", () => E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, 0x01],
  ["§3.4 negotiation types", "E2EEServerAccept", () => E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT, 0x02],
  [
    "§3.4 negotiation types",
    "E2EEHandshakeReject",
    () => E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
    0x03,
  ],
  ["§3.4 direction labels", "client → node", () => E2EE_DIRECTION_CLIENT_TO_NODE, "c2n"],
  [
    "§3.4 direction labels",
    "client → node, as bytes",
    () => [...encodeE2eeDirectionLabel(E2EE_DIRECTION_CLIENT_TO_NODE)],
    [0x63, 0x32, 0x6e],
  ],
  ["§3.4 direction labels", "node → client", () => E2EE_DIRECTION_NODE_TO_CLIENT, "n2c"],
  [
    "§3.4 direction labels",
    "node → client, as bytes",
    () => [...encodeE2eeDirectionLabel(E2EE_DIRECTION_NODE_TO_CLIENT)],
    [0x6e, 0x32, 0x63],
  ],
  [
    "§11.2 handshake reject",
    "the one conforming record",
    () => [...encodeE2eeHandshakeReject()],
    CANONICAL_HANDSHAKE_REJECT,
  ],
];

describe("§3.3 and §3.4 wire values, pinned to their literals", () => {
  for (const [registry, entry, actual, spec] of SPEC_REGISTRIES) {
    it(`${registry} | ${entry}`, () => {
      expect(actual()).toEqual(spec);
    });
  }

  it("§3.3 envelope header | the exact byte layout", () => {
    const header = encodeE2eeEnvelopeHeader({
      suite: SUITE,
      epoch: 0x0102_0304n,
      counter: 0x0a0b_0c0d_0e0f_1011n,
    });
    expect(header.byteLength).toBe(15);
    // discriminator 0x01, version 0x01, suite 0x01, uint32be epoch, uint64be
    // counter — offsets 0, 1, 2, 3 and 7 exactly as §3.3 tabulates them.
    expect([...header]).toEqual([
      0x01, 0x01, 0x01, 0x01, 0x02, 0x03, 0x04, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11,
    ]);
  });

  it("§3.3 negotiation record | the exact two-byte framing", () => {
    const record = encodeE2eeNegotiationRecord(
      E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
      Uint8Array.from([0xa1, 0x00]),
    );
    expect([...record]).toEqual([0x02, 0x01, 0xa1, 0x00]);
  });

  it("§11.2 handshake reject | the body is the canonical CBOR of sixty zero bytes", () => {
    const reject = encodeE2eeHandshakeReject();
    expect(reject.byteLength).toBe(64);
    expect(reject.byteLength).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
    expect(reject.byteLength - 2 - 2).toBe(E2EE_HANDSHAKE_REJECT_PAD_BYTES);
    expect([...reject.subarray(4)]).toEqual([...new Uint8Array(60)]);
  });
});

describe("post-strip discrimination (§3.4, §4.3 step 2)", () => {
  it("classifies each discriminator the registry defines", () => {
    expect(classifyPostStripPayload(envelope())).toEqual({ kind: "envelope" });
    expect(
      classifyPostStripPayload(Uint8Array.from([E2EE_NEGOTIATION_DISCRIMINATOR, 0x01])),
    ).toEqual({ kind: "negotiation" });
    expect(classifyPostStripPayload(new TextEncoder().encode('{"_tag":"x"}'))).toEqual({
      kind: "legacy-json",
    });
    expect(classifyPostStripPayload(new TextEncoder().encode("[]"))).toEqual({
      kind: "legacy-json",
    });
  });

  it("treats a zero-length post-strip payload as its own enumerated row", () => {
    // §3.4 enumerates this rather than leaving it to the catch-all, and §4.3
    // step 2 makes it fatal in every state.
    expect(classifyPostStripPayload(new Uint8Array(0))).toEqual({
      kind: "other",
      reason: "empty",
    });
  });

  it("reaches the zero-length row through both of the paths §3.4 names", () => {
    // The first path is a `data.payload` of length zero, which the relay frame
    // schema admits and the assembler surfaces as a completed message.
    expect(assembleOne([new Uint8Array(0)]).byteLength).toBe(0);
    expect(classifyPostStripPayload(assembleOne([new Uint8Array(0)]))).toEqual({
      kind: "other",
      reason: "empty",
    });

    // The second is a payload consisting of exactly the chunk prelude, which
    // post-strips to nothing. It is only reachable through the strip, which is
    // why classifying raw payloads instead would miss it: before the strip
    // these eight bytes classify as a malformed unknown discriminator.
    const preludeOnly = Uint8Array.from(RELAY_CHUNK_CAPABILITY_PRELUDE);
    expect(classifyPostStripPayload(preludeOnly)).toEqual({
      kind: "other",
      reason: "unknown_discriminator",
    });
    const stripped = stripRelayChunkCapabilityPrelude(preludeOnly);
    expect(stripped.advertised).toBe(true);
    expect(stripped.message.byteLength).toBe(0);
    expect(classifyPostStripPayload(stripped.message)).toEqual({
      kind: "other",
      reason: "empty",
    });

    // And through the assembler, which is the path a receiver actually takes:
    // the peer is latched as chunk-capable and the message is still empty.
    const assembler = new RelayMessageAssembler();
    const result = assembler.push(Uint8Array.from(RELAY_CHUNK_CAPABILITY_PRELUDE));
    expect(result).toEqual({ kind: "done", message: new Uint8Array(0) });
    expect(assembler.peerSupportsChunking).toBe(true);
  });

  it("classifies every unregistered first byte as malformed", () => {
    for (const first of [RELAY_CHUNK_MAGIC, 0x03, 0x20, 0x7a, 0x7c, 0xff]) {
      expect(classifyPostStripPayload(Uint8Array.from([first, 0x00]))).toEqual({
        kind: "other",
        reason: "unknown_discriminator",
      });
    }
  });

  it("hands out frozen classes, so no consumer can corrupt classification", () => {
    // The classes are shared singletons on the hottest inbound path. Frozen,
    // one consumer's stray write cannot reclassify every later payload in the
    // process — which on this path would mean routing peer bytes by a class
    // nothing on the wire chose.
    const cases: ReadonlyArray<Uint8Array> = [
      envelope(),
      Uint8Array.from([E2EE_NEGOTIATION_DISCRIMINATOR, 0x01]),
      new TextEncoder().encode("[]"),
      new Uint8Array(0),
      Uint8Array.from([0xff]),
    ];
    for (const payload of cases) {
      expect(Object.isFrozen(classifyPostStripPayload(payload))).toBe(true);
    }

    const classified = classifyPostStripPayload(envelope());
    expect(() => {
      (classified as { kind: string }).kind = "legacy-json";
    }).toThrow(TypeError);
    expect(() => {
      (classified as { reason?: string }).reason = "empty";
    }).toThrow(TypeError);
    expect(classifyPostStripPayload(envelope())).toEqual({ kind: "envelope" });

    const empty = classifyPostStripPayload(new Uint8Array(0));
    expect(() => {
      (empty as { reason: string }).reason = "unknown_discriminator";
    }).toThrow(TypeError);
    expect(classifyPostStripPayload(new Uint8Array(0))).toEqual({
      kind: "other",
      reason: "empty",
    });
  });

  it("never mistakes an envelope for a chunk, whatever the ciphertext holds", () => {
    // §4.3: no structure this protocol emits can be taken for a chunk by the
    // chunk-layer test, because the discriminator is never RELAY_CHUNK_MAGIC —
    // even when the ciphertext begins with it and is full of interior NUL runs.
    const colliding = envelope({}, ciphertext(512, RELAY_CHUNK_MAGIC));
    expect(colliding[E2EE_ENVELOPE_HEADER_BYTES]).toBe(RELAY_CHUNK_MAGIC);
    expect(isChunkedPayload(colliding)).toBe(false);
    expect(classifyPostStripPayload(colliding)).toEqual({ kind: "envelope" });

    const reject = encodeE2eeHandshakeReject();
    expect(isChunkedPayload(reject)).toBe(false);
    expect(classifyPostStripPayload(reject)).toEqual({ kind: "negotiation" });
  });

  it("classifies every seeded byte string into exactly one class", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (payload) => {
        const result = classifyPostStripPayload(payload);
        if (payload.byteLength === 0) {
          return result.kind === "other" && result.reason === "empty";
        }
        switch (payload[0]) {
          case E2EE_ENVELOPE_DISCRIMINATOR:
            return result.kind === "envelope";
          case E2EE_NEGOTIATION_DISCRIMINATOR:
            return result.kind === "negotiation";
          case 0x7b:
          case 0x5b:
            return result.kind === "legacy-json";
          default:
            return result.kind === "other" && result.reason === "unknown_discriminator";
        }
      }),
      { seed: PROPERTY_SEED, numRuns: 500 },
    );
  });
});

describe("envelope codec (§3.3)", () => {
  it("round trips fields and ciphertext", () => {
    const body = ciphertext(129, 0x5c);
    const decoded = unwrap(decodeE2eeEnvelope(envelope({ epoch: 7n, counter: 65_537n }, body)));
    expect(decoded.version).toBe(E2EE_PROTOCOL_VERSION);
    expect(decoded.suite).toBe(SUITE);
    expect(decoded.epoch).toBe(7n);
    expect(decoded.counter).toBe(65_537n);
    expect(decoded.ciphertext).toEqual(body);
    expect(decoded.header.byteLength).toBe(E2EE_ENVELOPE_HEADER_BYTES);
  });

  it("returns the received header bytes, which is what the AAD covers", () => {
    const bytes = envelope({ epoch: 3n, counter: 9n });
    const decoded = unwrap(decodeE2eeEnvelope(bytes));
    expect(decoded.header).toEqual(bytes.subarray(0, E2EE_ENVELOPE_HEADER_BYTES));
  });

  it("accepts the minimum envelope and rejects one byte below it", () => {
    const smallest = envelope({}, ciphertext(MIN_CIPHERTEXT_BYTES));
    expect(smallest.byteLength).toBe(E2EE_ENVELOPE_OVERHEAD_BYTES);
    expect(decodeE2eeEnvelope(smallest).kind).toBe("ok");

    expect(decodeE2eeEnvelope(smallest.subarray(0, E2EE_ENVELOPE_OVERHEAD_BYTES - 1))).toEqual({
      kind: "error",
      reason: "truncated",
    });
  });

  it("refuses to build an envelope below the minimum length", () => {
    expect(() => envelope({}, ciphertext(MIN_CIPHERTEXT_BYTES - 1))).toThrow(TypeError);
  });

  it("rejects every truncation of a complete envelope", () => {
    const bytes = envelope();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: E2EE_ENVELOPE_OVERHEAD_BYTES - 1 }), (length) => {
        const result = decodeE2eeEnvelope(bytes.subarray(0, length));
        return result.kind === "error" && result.reason === "truncated";
      }),
      { seed: PROPERTY_SEED, numRuns: 64 },
    );
  });

  it("checks length before version, exactly as §4.3 step 3 orders it", () => {
    const short = envelope().slice(0, E2EE_ENVELOPE_OVERHEAD_BYTES - 1);
    short[1] = 0x02;
    expect(decodeE2eeEnvelope(short)).toEqual({ kind: "error", reason: "truncated" });
  });

  it("checks version before suite, exactly as §4.3 step 3 orders it", () => {
    // §4.3 step 3 fixes the order — length, then `version`, then `suite`, all
    // before any AEAD implementation is selected. A payload failing BOTH must
    // report the earlier check, or an implementation is free to pick an AEAD
    // for a version it never validated.
    const both = envelope();
    both[1] = 0x02;
    both[2] = 0x03;
    expect(decodeE2eeEnvelope(both)).toEqual({ kind: "error", reason: "unsupported_version" });

    // With only the suite reserved the later check is the one that fires, so
    // the ordering above is a real ordering and not a missing suite check.
    const suiteOnly = envelope();
    suiteOnly[2] = 0x03;
    expect(decodeE2eeEnvelope(suiteOnly)).toEqual({ kind: "error", reason: "unsupported_suite" });
  });

  it("rejects a foreign discriminator, an unknown version and a reserved suite", () => {
    expect(decodeE2eeEnvelope(new Uint8Array(0))).toEqual({
      kind: "error",
      reason: "bad_discriminator",
    });
    const legacy = new TextEncoder().encode(`{"a":${"1".repeat(40)}}`);
    expect(decodeE2eeEnvelope(legacy)).toEqual({ kind: "error", reason: "bad_discriminator" });

    const badVersion = envelope();
    badVersion[1] = 0x02;
    expect(decodeE2eeEnvelope(badVersion)).toEqual({
      kind: "error",
      reason: "unsupported_version",
    });

    for (const suite of [0x00, 0x03, 0xff]) {
      const badSuite = envelope();
      badSuite[2] = suite;
      expect(decodeE2eeEnvelope(badSuite)).toEqual({
        kind: "error",
        reason: "unsupported_suite",
      });
    }
  });

  it("refuses to encode an out-of-range or non-bigint epoch or counter", () => {
    expect(() => envelope({ epoch: E2EE_EPOCH_MAX + 1n })).toThrow(TypeError);
    expect(() => envelope({ counter: E2EE_COUNTER_MAX + 1n })).toThrow(TypeError);
    expect(() => envelope({ epoch: -1n })).toThrow(TypeError);
    expect(() => envelope({ counter: -1n })).toThrow(TypeError);
    // The forbidden representation itself (§3.1): a `number` counter must not
    // sneak through a JavaScript caller.
    expect(() => envelope({ counter: 1 as unknown as bigint })).toThrow(TypeError);
  });
});

describe("uint64 counters keep every bit (§3.1, §9.3)", () => {
  it("round trips the counter values a double cannot represent", () => {
    const unsafe = [
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      BigInt(Number.MAX_SAFE_INTEGER) + 2n,
      2n ** 63n,
      E2EE_COUNTER_MAX,
      E2EE_COUNTER_MAX - 1n,
    ];
    for (const counter of unsafe) {
      const decoded = unwrap(decodeE2eeEnvelope(envelope({ epoch: E2EE_EPOCH_MAX, counter })));
      expect(decoded.counter).toBe(counter);
      expect(decoded.epoch).toBe(E2EE_EPOCH_MAX);
    }
  });

  it("keeps two counters apart that IEEE-754 collapses into one", () => {
    // 2^53 and 2^53 + 1 are the same double. If either end of this codec ever
    // touched `number`, these two records would share a nonce.
    const low = 2n ** 53n;
    const high = low + 1n;
    expect(Number(low) === Number(high)).toBe(true);

    const first = envelope({ counter: low });
    const second = envelope({ counter: high });
    expect(first).not.toEqual(second);
    expect(unwrap(decodeE2eeEnvelope(first)).counter).toBe(low);
    expect(unwrap(decodeE2eeEnvelope(second)).counter).toBe(high);
  });

  it("round trips seeded epoch and counter pairs over the whole field range", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: E2EE_EPOCH_MAX }),
        fc.bigInt({ min: 0n, max: E2EE_COUNTER_MAX }),
        fc.uint8Array({ minLength: MIN_CIPHERTEXT_BYTES, maxLength: 256 }),
        (epoch, counter, body) => {
          const decoded = decodeE2eeEnvelope(
            encodeE2eeEnvelope({ suite: SUITE, epoch, counter, ciphertext: body }),
          );
          if (decoded.kind !== "ok") return false;
          return (
            decoded.value.epoch === epoch &&
            decoded.value.counter === counter &&
            Buffer.from(decoded.value.ciphertext).equals(body)
          );
        },
      ),
      { seed: PROPERTY_SEED, numRuns: 500 },
    );
  });
});

describe("AEAD parameters (§3.3)", () => {
  it("builds the nonce as the envelope's own epoch and counter fields", () => {
    const fields = { suite: SUITE, epoch: 0xdead_beefn, counter: 0x0123_4567_89ab_cdefn } as const;
    const nonce = e2eeAeadNonce(fields.epoch, fields.counter);
    const header = encodeE2eeEnvelopeHeader(fields);
    expect(nonce.byteLength).toBe(E2EE_AEAD_NONCE_BYTES);
    expect([...nonce]).toEqual([
      0xde, 0xad, 0xbe, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    ]);
    expect(nonce).toEqual(header.subarray(3, E2EE_ENVELOPE_HEADER_BYTES));
    // The receive-path form reads the same bytes out of the header it already
    // has, and must never disagree with the send-path form.
    expect(e2eeAeadNonceFromHeader(header)).toEqual(nonce);
    expect(e2eeAeadNonceFromHeader(unwrap(decodeE2eeEnvelope(envelope(fields))).header)).toEqual(
      nonce,
    );
    expect(() => e2eeAeadNonceFromHeader(header.subarray(1))).toThrow(TypeError);
  });

  it("builds the AAD as header ‖ sessionBindingHash ‖ direction label", () => {
    const header = encodeE2eeEnvelopeHeader({ suite: SUITE, epoch: 1n, counter: 2n });
    const sessionBindingHash = new Uint8Array(E2EE_SESSION_BINDING_HASH_BYTES).fill(0x33);
    const aad = e2eeEnvelopeAad({
      header,
      sessionBindingHash,
      direction: E2EE_DIRECTION_CLIENT_TO_NODE,
    });
    expect(aad.byteLength).toBe(50);
    expect(aad.byteLength).toBe(E2EE_AAD_BYTES);
    expect(aad.subarray(0, E2EE_ENVELOPE_HEADER_BYTES)).toEqual(header);
    expect(
      aad.subarray(
        E2EE_ENVELOPE_HEADER_BYTES,
        E2EE_ENVELOPE_HEADER_BYTES + E2EE_SESSION_BINDING_HASH_BYTES,
      ),
    ).toEqual(sessionBindingHash);
    expect([...aad.subarray(E2EE_AAD_BYTES - 3)]).toEqual([0x63, 0x32, 0x6e]);
  });

  it("separates the two directions in the AAD", () => {
    const header = encodeE2eeEnvelopeHeader({ suite: SUITE, epoch: 1n, counter: 2n });
    const sessionBindingHash = new Uint8Array(E2EE_SESSION_BINDING_HASH_BYTES);
    const base = { header, sessionBindingHash } as const;
    expect(e2eeEnvelopeAad({ ...base, direction: E2EE_DIRECTION_CLIENT_TO_NODE })).not.toEqual(
      e2eeEnvelopeAad({ ...base, direction: E2EE_DIRECTION_NODE_TO_CLIENT }),
    );
    expect([...encodeE2eeDirectionLabel(E2EE_DIRECTION_NODE_TO_CLIENT)]).toEqual([
      0x6e, 0x32, 0x63,
    ]);
  });

  it("refuses a header or session binding hash of the wrong length", () => {
    const header = encodeE2eeEnvelopeHeader({ suite: SUITE, epoch: 1n, counter: 2n });
    expect(() =>
      e2eeEnvelopeAad({
        header: header.subarray(0, E2EE_ENVELOPE_HEADER_BYTES - 1),
        sessionBindingHash: new Uint8Array(E2EE_SESSION_BINDING_HASH_BYTES),
        direction: E2EE_DIRECTION_CLIENT_TO_NODE,
      }),
    ).toThrow(TypeError);
    expect(() =>
      e2eeEnvelopeAad({
        header,
        sessionBindingHash: new Uint8Array(E2EE_SESSION_BINDING_HASH_BYTES - 1),
        direction: E2EE_DIRECTION_CLIENT_TO_NODE,
      }),
    ).toThrow(TypeError);
  });

  it("refuses an unregistered direction, like every other registry encoder", () => {
    expect(isE2eeDirection(E2EE_DIRECTION_CLIENT_TO_NODE)).toBe(true);
    expect(isE2eeDirection(E2EE_DIRECTION_NODE_TO_CLIENT)).toBe(true);
    for (const value of ["", "c2N", "N2C", "n2c ", "abc", "c2nc2n"]) {
      expect(isE2eeDirection(value)).toBe(false);
      expect(() => encodeE2eeDirectionLabel(value as E2eeDirection)).toThrow(TypeError);
    }
    // The label is AAD, so an unguarded encoder would not fail here but at the
    // peer's AEAD — indistinguishable from tampering, one round trip later.
    expect(() =>
      e2eeEnvelopeAad({
        header: encodeE2eeEnvelopeHeader({ suite: SUITE, epoch: 1n, counter: 2n }),
        sessionBindingHash: new Uint8Array(E2EE_SESSION_BINDING_HASH_BYTES),
        direction: "c2c" as E2eeDirection,
      }),
    ).toThrow(TypeError);
  });
});

describe("inner-record framing (§3.3, §3.4)", () => {
  const types: ReadonlyArray<E2eeInnerRecordType> = [
    E2EE_INNER_TYPE_RPC,
    E2EE_INNER_TYPE_CLOSE,
    E2EE_INNER_TYPE_ERROR,
    E2EE_INNER_TYPE_CLOSE_ACK,
  ];

  it("round trips every registered inner type", () => {
    for (const innerType of types) {
      const body = Uint8Array.from([0x7b, 0x7d, innerType]);
      const decoded = unwrap(decodeE2eeInnerRecord(encodeE2eeInnerRecord(innerType, body)));
      expect(decoded.innerType).toBe(innerType);
      expect(decoded.body).toEqual(body);
    }
  });

  it("accepts a zero-length body, which §9.1 makes valid at this layer", () => {
    const plaintext = encodeE2eeInnerRecord(E2EE_INNER_TYPE_RPC, new Uint8Array(0));
    expect(plaintext.byteLength).toBe(1);
    const decoded = unwrap(decodeE2eeInnerRecord(plaintext));
    expect(decoded.innerType).toBe(E2EE_INNER_TYPE_RPC);
    expect(decoded.body.byteLength).toBe(0);
  });

  it("rejects a reserved inner type instead of passing it through", () => {
    // §4.4 N10 makes this FATAL-POST: an endpoint that skipped an unknown
    // authenticated record would let the peer choose what the application sees.
    for (const reserved of [0x00, 0x05, 0x7f, 0xff]) {
      expect(decodeE2eeInnerRecord(Uint8Array.from([reserved, 0x01]))).toEqual({
        kind: "error",
        reason: "reserved_inner_type",
      });
    }
    expect(() =>
      encodeE2eeInnerRecord(0x05 as unknown as E2eeInnerRecordType, new Uint8Array(0)),
    ).toThrow(TypeError);
  });

  it("rejects an empty record plaintext, which carries no type byte", () => {
    expect(decodeE2eeInnerRecord(new Uint8Array(0))).toEqual({
      kind: "error",
      reason: "truncated",
    });
  });

  it("round trips seeded bodies under every registered type", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...types),
        fc.uint8Array({ maxLength: 512 }),
        (innerType, body) => {
          const decoded = decodeE2eeInnerRecord(encodeE2eeInnerRecord(innerType, body));
          return (
            decoded.kind === "ok" &&
            decoded.value.innerType === innerType &&
            Buffer.from(decoded.value.body).equals(body)
          );
        },
      ),
      { seed: PROPERTY_SEED, numRuns: 300 },
    );
  });
});

describe("negotiation-record framing (§3.3, §3.4)", () => {
  it("round trips a hello and an accept, carrying the body bytes unchanged", () => {
    for (const recordType of [
      E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
      E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
    ] as const) {
      const body = Uint8Array.from([0xa1, 0x01, 0x02]);
      const record = encodeE2eeNegotiationRecord(recordType, body);
      expect(record[0]).toBe(E2EE_NEGOTIATION_DISCRIMINATOR);
      expect(record[1]).toBe(recordType);
      const decoded = unwrap(decodeE2eeNegotiationRecord(record));
      expect(decoded.recordType).toBe(recordType);
      expect(decoded.body).toEqual(body);
    }
  });

  it("enforces each type's total-length bound at exactly the boundary", () => {
    for (const [recordType, maxBytes] of [
      [E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, E2EE_CLIENT_HELLO_MAX_BYTES],
      [E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT, E2EE_SERVER_ACCEPT_MAX_BYTES],
    ] as const) {
      const atBound = encodeE2eeNegotiationRecord(recordType, new Uint8Array(maxBytes - 2));
      expect(atBound.byteLength).toBe(maxBytes);
      expect(decodeE2eeNegotiationRecord(atBound).kind).toBe("ok");

      expect(() => encodeE2eeNegotiationRecord(recordType, new Uint8Array(maxBytes - 1))).toThrow(
        RangeError,
      );

      const oneOver = new Uint8Array(maxBytes + 1);
      oneOver.set(atBound);
      oneOver[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
      oneOver[1] = recordType;
      expect(decodeE2eeNegotiationRecord(oneOver)).toEqual({ kind: "error", reason: "too_large" });
    }
  });

  it("holds the reject record to its exact length in both directions", () => {
    const reject = encodeE2eeHandshakeReject();
    expect(reject.byteLength).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
    expect(decodeE2eeNegotiationRecord(reject).kind).toBe("ok");

    // §11.2: every conforming reject is byte-identical, so a short one is
    // malformed just as surely as a long one.
    expect(
      decodeE2eeNegotiationRecord(reject.subarray(0, E2EE_HANDSHAKE_REJECT_BYTES - 1)),
    ).toEqual({ kind: "error", reason: "length_mismatch" });
    const oneOver = new Uint8Array(E2EE_HANDSHAKE_REJECT_BYTES + 1);
    oneOver.set(reject);
    expect(decodeE2eeNegotiationRecord(oneOver)).toEqual({ kind: "error", reason: "too_large" });
    expect(() =>
      encodeE2eeNegotiationRecord(
        E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
        new Uint8Array(E2EE_HANDSHAKE_REJECT_BYTES),
      ),
    ).toThrow(RangeError);
  });

  it("emits a fresh copy of the one reject record, never a shared buffer", () => {
    const first = encodeE2eeHandshakeReject();
    const second = encodeE2eeHandshakeReject();
    expect(first).not.toBe(second);
    first.fill(0xff);
    expect([...encodeE2eeHandshakeReject()]).toEqual(CANONICAL_HANDSHAKE_REJECT);
  });

  it("refuses every reject whose body is not the one §11.2 fixes", () => {
    // §11.2 fixes the bytes completely: the record carries no cause, no code,
    // no text and no variable field, because pre-key failures MUST be
    // indistinguishable from one another. A correctly sized reject with any
    // other body is a peer signalling through the one record deliberately left
    // with nothing to signal in — accepting it would reopen that channel.
    for (const mutatedIndex of [2, 3, 4, 5, E2EE_HANDSHAKE_REJECT_BYTES - 1]) {
      const forged = Uint8Array.from(CANONICAL_HANDSHAKE_REJECT);
      forged[mutatedIndex] = 0x01;
      expect(forged.byteLength).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
      expect(decodeE2eeNegotiationRecord(forged)).toEqual({
        kind: "error",
        reason: "non_canonical_reject",
      });
    }

    // A body of the right length that is not canonical CBOR at all — the shape
    // a hand-rolled implementation would produce.
    const bare = new Uint8Array(E2EE_HANDSHAKE_REJECT_BYTES);
    bare[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
    bare[1] = E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT;
    expect(decodeE2eeNegotiationRecord(bare)).toEqual({
      kind: "error",
      reason: "non_canonical_reject",
    });

    // And no encoder in this module can emit one either.
    expect(() =>
      encodeE2eeNegotiationRecord(
        E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
        new Uint8Array(E2EE_HANDSHAKE_REJECT_BYTES - 2),
      ),
    ).toThrow(TypeError);
  });

  it("rejects a foreign discriminator, a bare discriminator and a reserved type", () => {
    expect(decodeE2eeNegotiationRecord(new Uint8Array(0))).toEqual({
      kind: "error",
      reason: "bad_discriminator",
    });
    expect(decodeE2eeNegotiationRecord(envelope())).toEqual({
      kind: "error",
      reason: "bad_discriminator",
    });
    expect(decodeE2eeNegotiationRecord(Uint8Array.from([E2EE_NEGOTIATION_DISCRIMINATOR]))).toEqual({
      kind: "error",
      reason: "truncated",
    });
    for (const reserved of [0x00, 0x04, 0xff]) {
      expect(
        decodeE2eeNegotiationRecord(
          Uint8Array.from([E2EE_NEGOTIATION_DISCRIMINATOR, reserved, 0x01]),
        ),
      ).toEqual({ kind: "error", reason: "reserved_record_type" });
    }
  });

  it("reports the direction the registry fixes for each type", () => {
    expect(e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_CLIENT_HELLO)).toBe(
      E2EE_DIRECTION_CLIENT_TO_NODE,
    );
    expect(e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT)).toBe(
      E2EE_DIRECTION_NODE_TO_CLIENT,
    );
    expect(e2eeNegotiationRecordDirection(E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT)).toBe(
      E2EE_DIRECTION_NODE_TO_CLIENT,
    );
  });

  it("round trips seeded hello bodies within the bound", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1_024 }), (body) => {
        const decoded = decodeE2eeNegotiationRecord(
          encodeE2eeNegotiationRecord(E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, body),
        );
        return (
          decoded.kind === "ok" &&
          decoded.value.recordType === E2EE_NEGOTIATION_TYPE_CLIENT_HELLO &&
          Buffer.from(decoded.value.body).equals(body)
        );
      }),
      { seed: PROPERTY_SEED, numRuns: 250 },
    );
  });
});

describe("the framing layers compose (§4.2, §4.3, §4.5)", () => {
  it("carries an inner record through an envelope and back out", () => {
    // The AEAD is a later slice, so this stands in ciphertext-shaped bytes: the
    // point is that the framing on either side of it lines up.
    const body = new TextEncoder().encode('{"_tag":"Request"}');
    const plaintext = encodeE2eeInnerRecord(E2EE_INNER_TYPE_RPC, body);
    const sealed = new Uint8Array(plaintext.byteLength + E2EE_AEAD_TAG_BYTES);
    sealed.set(plaintext);

    const wire = encodeE2eeEnvelope({
      suite: SUITE,
      epoch: 4n,
      counter: 2n ** 40n,
      ciphertext: sealed,
    });
    expect(classifyPostStripPayload(wire)).toEqual({ kind: "envelope" });

    const decodedEnvelope = unwrap(decodeE2eeEnvelope(wire));
    const opened = decodedEnvelope.ciphertext.subarray(
      0,
      decodedEnvelope.ciphertext.byteLength - E2EE_AEAD_TAG_BYTES,
    );
    const inner = unwrap(decodeE2eeInnerRecord(opened));
    expect(inner.innerType).toBe(E2EE_INNER_TYPE_RPC);
    expect(inner.body).toEqual(body);
    expect(decodedEnvelope.counter).toBe(2n ** 40n);
  });

  it("turns a body at the plaintext ceiling into an envelope at exactly the message ceiling", () => {
    // §4.5's two ceilings differ by exactly what §3.3 framing adds, which is
    // what makes `plaintextCeiling` the largest body whose envelope still fits.
    const budget = e2eeChannelSizeBudget({ maxQueuedBytes: 8_192, maxControlFrameBytes: 4_096 });
    expect(budget.effectiveMessageCeiling).toBe(4_096);
    expect(budget.establishable).toBe(true);

    const plaintext = encodeE2eeInnerRecord(
      E2EE_INNER_TYPE_RPC,
      new Uint8Array(budget.plaintextCeiling).fill(0x2a),
    );
    const sealed = new Uint8Array(plaintext.byteLength + E2EE_AEAD_TAG_BYTES);
    sealed.set(plaintext);
    const wire = encodeE2eeEnvelope({ suite: SUITE, epoch: 0n, counter: 0n, ciphertext: sealed });
    expect(wire.byteLength).toBe(budget.effectiveMessageCeiling);
  });

  it("survives the real chunking layer when the envelope is oversized", () => {
    // §4.2 step 6 hands the envelope to the chunking layer UNCHANGED, so an
    // oversized envelope is split, carried, reassembled and only then
    // discriminated. Nothing here is a stand-in: these are the helpers the
    // relay send and receive paths use.
    const maxChunkBytes = RELAY_MIN_DATA_CHUNK_BYTES;
    const wire = envelope({ epoch: 9n, counter: 2n ** 33n + 7n }, ciphertext(3_000, 0x5a));
    const expected = Uint8Array.from(wire);
    expect(wire.byteLength).toBeGreaterThan(maxChunkBytes);

    const prepared = prepareRelayMessage(wire, {
      maxChunkBytes,
      maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
      peerSupportsChunking: true,
    });
    if (prepared.kind !== "ready") throw new Error(`unexpected prepare result: ${prepared.reason}`);
    expect(prepared.payloads.length).toBeGreaterThan(1);

    for (const payload of prepared.payloads) {
      expect(isChunkedPayload(payload)).toBe(true);
      expect(payload.byteLength).toBeLessThanOrEqual(maxChunkBytes);
      // §4.3 step 1 before step 2: a chunk's own first byte belongs to the
      // chunk layer, and discriminating it would classify every oversized
      // message as malformed.
      expect(classifyPostStripPayload(payload)).toEqual({
        kind: "other",
        reason: "unknown_discriminator",
      });
    }

    const reassembled = assembleOne(prepared.payloads);
    expect(reassembled).toEqual(expected);
    expect(classifyPostStripPayload(reassembled)).toEqual({ kind: "envelope" });
    const decoded = unwrap(decodeE2eeEnvelope(reassembled));
    expect(decoded.epoch).toBe(9n);
    expect(decoded.counter).toBe(2n ** 33n + 7n);
    expect(decoded.ciphertext).toEqual(expected.subarray(E2EE_ENVELOPE_HEADER_BYTES));
  });

  it("round trips at the prelude-headroom boundary and one byte past it", () => {
    // A fitting message carries the chunk-support prelude only while there is
    // frame headroom for it. Both sides of that boundary must post-strip back
    // to the identical envelope, because the strip is what the discriminator
    // runs on (§4.2 step 6, §4.3 step 1).
    const maxChunkBytes = RELAY_MIN_DATA_CHUNK_BYTES;
    const prepare = (wire: Uint8Array) =>
      prepareRelayMessage(wire, {
        maxChunkBytes,
        maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
        peerSupportsChunking: false,
      });

    const withHeadroom = envelope(
      {},
      ciphertext(maxChunkBytes - RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES - E2EE_ENVELOPE_HEADER_BYTES),
    );
    expect(withHeadroom.byteLength).toBe(maxChunkBytes - RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES);
    const advertised = prepare(withHeadroom);
    if (advertised.kind !== "ready") throw new Error("expected a ready payload");
    expect(advertised.payloads).toHaveLength(1);
    expect(advertised.payloads[0]!.byteLength).toBe(maxChunkBytes);
    expect([...advertised.payloads[0]!.subarray(0, RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES)]).toEqual([
      ...RELAY_CHUNK_CAPABILITY_PRELUDE,
    ]);

    const expectedWithHeadroom = Uint8Array.from(withHeadroom);
    const strippedAdvertised = assembleOne(advertised.payloads);
    expect(strippedAdvertised).toEqual(expectedWithHeadroom);
    expect(classifyPostStripPayload(strippedAdvertised)).toEqual({ kind: "envelope" });
    expect(decodeE2eeEnvelope(strippedAdvertised).kind).toBe("ok");

    // One byte over the headroom: the envelope still fits the chunk limit, so
    // it is emitted whole and WITHOUT the prelude rather than chunked.
    const overHeadroom = envelope(
      {},
      ciphertext(
        maxChunkBytes - RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES - E2EE_ENVELOPE_HEADER_BYTES + 1,
      ),
    );
    expect(overHeadroom.byteLength).toBe(maxChunkBytes - RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES + 1);
    const bare = prepare(overHeadroom);
    if (bare.kind !== "ready") throw new Error("expected a ready payload");
    expect(bare.payloads).toHaveLength(1);
    expect(bare.payloads[0]!.byteLength).toBe(overHeadroom.byteLength);
    expect(isChunkedPayload(bare.payloads[0]!)).toBe(false);

    const expectedOverHeadroom = Uint8Array.from(overHeadroom);
    const strippedBare = assembleOne(bare.payloads);
    expect(strippedBare).toEqual(expectedOverHeadroom);
    expect(classifyPostStripPayload(strippedBare)).toEqual({ kind: "envelope" });
    expect(decodeE2eeEnvelope(strippedBare).kind).toBe("ok");
  });
});
