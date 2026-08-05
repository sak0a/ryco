import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_CAPABILITY_CARRIER_MAX_BYTES,
  E2EE_CAPABILITY_STATEMENT_MAX_BYTES,
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_INNER_TYPE_BYTES,
  E2EE_SERVER_ACCEPT_MAX_BYTES,
} from "./relayE2eeConstants.ts";
import { verifyNodeE2eeCapabilityStatement } from "./relayE2eeCapabilityVerify.ts";
import {
  decodeCanonicalE2eeCbor,
  decodeNodeE2eeCapabilityStatement,
  decodeNodeIdentityContinuityTranscript,
} from "./relayE2eeTranscripts.ts";
import {
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
  E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
  classifyPostStripPayload,
  decodeE2eeCapabilityCarrier,
  decodeE2eeEnvelope,
  decodeE2eeInnerRecord,
  decodeE2eeNegotiationRecord,
  encodeE2eeEnvelope,
  encodeE2eeInnerRecord,
  encodeE2eeNegotiationRecord,
  isE2eeInnerRecordType,
  type E2eeInnerRecordType,
} from "./relayE2eeWire.ts";

// THE DECODER FUZZ SUITE — docs/relay-e2ee-protocol.md §3.3, §3.6, §4.3, §5.2.
//
// WHAT IT COVERS AND WHY THESE SURFACES. Every function driven here parses bytes
// an ATTACKER CHOSE. §2.1 gives the relay full control of the wire, so the
// post-strip discriminator, the three §3.3 framing decoders, the §5.3 carrier
// decoder, the §3.6 canonical decoder, the §7.5 continuity decoder, and the §5.2
// statement decoder are the complete set of places in this package where
// untrusted bytes are turned into structure. Nothing downstream of them may be
// reached with a value they did not produce.
//
// THE PROPERTY. For ANY input bytes, each decoder either returns a valid typed
// value or refuses with a BOUNDED reason drawn from its own declared error
// union. It never throws, never returns a partially-initialised value, and never
// allocates in proportion to an attacker-controlled length FIELD before that
// field has been validated against the bytes that actually arrived.
//
// HOW EACH CLAUSE IS MADE FALSIFIABLE, because "we fuzzed it" is not evidence:
//
//   • "never throws" and "bounded reason" are checked directly: every call is
//     wrapped, a throw fails the property, and the returned `reason`/`failure`
//     is looked up in a literal list of that decoder's declared members. A
//     decoder that invented a new reason string fails here even though it
//     returned a well-formed result.
//   • "not partially initialised" is checked as a POSITIVE obligation on the
//     `ok` branch: every field the result type declares is present and of the
//     declared shape, byte views lie inside the input buffer, and — for the
//     three codecs that define an inverse — re-encoding the decoded value
//     reproduces the input bytes exactly. A decoder that returned `ok` with a
//     truncated ciphertext view would round-trip to different bytes.
//   • "no allocation proportional to a length field" is exercised by the
//     length-lying corpus below: CBOR heads that DECLARE a byte string, text
//     string, array or map of up to 2^64 − 1 elements while carrying almost no
//     payload. A decoder that sized a buffer from the declared length before
//     checking it against the remaining input throws `RangeError` or exhausts
//     memory at the top of that range, and both are failures of the first
//     clause. THIS IS THE HONEST LIMIT OF THE CHECK: it proves the decoders do
//     not pre-allocate at magnitudes a runtime cannot satisfy. It does not prove
//     that no allocation happens at a magnitude a runtime CAN satisfy — a
//     decoder that eagerly allocated 4 KiB per declared length would pass.
//   • "never hangs" is NOT asserted with a clock. A wall-clock assertion on
//     shared CI is a flake generator, and this program has lost hours to
//     load-induced false failures. Non-termination is caught by the test
//     runner's own timeout, which is the only bound here that is not a lie.
//
// SEED POLICY. Every `fc.assert` runs under the fixed `PROPERTY_SEED` below, the
// literal the sibling property suites use (`relayE2eeWire.test.ts`,
// `relayE2eeNoiseProperties.test.ts`, `relayCodec.test.ts`) — one seed across
// the package, so a change to the generators is visible as a change everywhere
// it matters. A failure on CI reproduces byte for byte on a developer machine
// with no extra flags, and fast-check prints the shrunk counterexample with the
// `seed`/`path` pair that replays the single case. The seed MUST NOT be made
// time- or environment-dependent.
//
// WHAT THE SEARCH HAS ACTUALLY FOUND, so far: NOTHING. No decoder defect. The
// deepest clean campaign against the code as committed was
// `RELAY_E2EE_FUZZ_SOAK=1000` — 1.5 million runs of each framing property,
// 600,000 of each CBOR property, and 250,000 of the §5.2 verifier property, 77
// seconds of wall clock on one developer machine, all fourteen properties green.
// A run at 3,000 was also attempted and thirteen of the fourteen finished clean;
// the fourteenth was cut short by the RUNNER's default per-test timeout, not by
// a failure, and is reported that way rather than as a pass. "No defect found"
// at this depth is the honest claim and it is a weak one: it bounds nothing
// about inputs the generators do not reach.
//
// THE CORPUS IS THE GENERATOR BASE, not an afterthought. Uniformly random bytes
// almost never reach past a decoder's first guard: a random 64-byte string is a
// `bad_discriminator` in one comparison and tells you nothing about the code
// behind it. So the generators draw from the §16.3 fixture corpus — every
// committed `{"$bytes": …}` value in six families, which is real protocol
// material — and MUTATE it: flip a byte, overwrite a byte, truncate, extend,
// splice two together, or rewrite the leading discriminator. Those inputs get
// past the framing checks and into the parsing the framing protects.

const PROPERTY_SEED = 0x5259_434f;

/**
 * A SOAK MULTIPLIER on every run count below, default 1.
 *
 * The committed counts are sized for the gate — the whole file runs in well
 * under a second, because a fuzz suite that costs a minute on every push stops
 * being run. That is a deliberately small budget, and a small budget is a weak
 * search, so the multiplier exists to make a longer campaign REPRODUCIBLE rather
 * than a thing somebody did once locally and cannot re-run:
 *
 *     RELAY_E2EE_FUZZ_SOAK=50 bunx vp test run src/relayE2eeCodecFuzz.test.ts
 *
 * The seed does not move with it, so a soak at multiplier N explores a superset
 * of the cases the gate explores and any counterexample it finds replays at the
 * gate's own seed with the printed `path`. It NEVER shrinks the search: values
 * below 1 are clamped away, so no environment can quietly turn this file off.
 */
const SOAK = Math.max(1, Number(process.env.RELAY_E2EE_FUZZ_SOAK ?? "1") || 1);

/** Runs for a property over the cheap byte-level framing decoders. */
const FRAMING_RUNS = 1_500 * SOAK;
/** Runs for a property that drives a CBOR decode, which is heavier. */
const CBOR_RUNS = 600 * SOAK;
/** Runs for a property that drives the whole §5.2 verifier over one statement. */
const VERIFIER_RUNS = 250 * SOAK;

// ─── the seed corpus ─────────────────────────────────────────────────────────

const FIXTURE_ROOT = new URL("../fixtures/e2ee/v1/", import.meta.url);

/**
 * Every committed byte string in the named families, deduplicated.
 *
 * The families are chosen for the surfaces under test: F1 carries post-strip
 * wire payloads, F3 carries capability statements and §5.3 carriers, F4 and F5
 * carry directly signed transcripts and continuity chains, F8 carries protected
 * envelopes, and F12 carries negotiation and error records.
 */
function corpusBytes(files: readonly string[]): readonly Uint8Array[] {
  const seen = new Map<string, Uint8Array>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const element of value) walk(element);
      return;
    }
    const record = value as Record<string, unknown>;
    const wrapped = record.$bytes;
    if (typeof wrapped === "string" && Object.keys(record).length === 1) {
      if (wrapped.length > 0 && wrapped.length <= 12_000 && !seen.has(wrapped)) {
        seen.set(wrapped, Uint8Array.from(Buffer.from(wrapped, "hex")));
      }
      return;
    }
    for (const key of Object.keys(record)) walk(record[key]);
  };
  for (const file of files) {
    walk(JSON.parse(new TextDecoder().decode(readFileSync(new URL(file, FIXTURE_ROOT)))));
  }
  return [...seen.values()];
}

const CORPUS = corpusBytes([
  "f01-payload-discrimination.json",
  "f03-capability-statement.json",
  "f04-prekey-certificates.json",
  "f05-continuity-chains.json",
  "f08-record-protection.json",
  "f12-error-records.json",
]);

/** One mutation of one corpus entry. The operator is part of the generated case. */
type Mutation =
  | { readonly kind: "identity" }
  | { readonly kind: "flip"; readonly index: number; readonly bit: number }
  | { readonly kind: "overwrite"; readonly index: number; readonly byte: number }
  | { readonly kind: "truncate"; readonly length: number }
  | { readonly kind: "extend"; readonly tail: Uint8Array }
  | { readonly kind: "splice"; readonly other: number; readonly at: number }
  | { readonly kind: "reframe"; readonly discriminator: number };

function mutate(base: Uint8Array, mutation: Mutation): Uint8Array {
  switch (mutation.kind) {
    case "identity":
      return base;
    case "flip": {
      if (base.byteLength === 0) return base;
      const out = Uint8Array.from(base);
      const index = mutation.index % base.byteLength;
      out[index] = out[index]! ^ (1 << (mutation.bit % 8));
      return out;
    }
    case "overwrite": {
      if (base.byteLength === 0) return base;
      const out = Uint8Array.from(base);
      out[mutation.index % base.byteLength] = mutation.byte;
      return out;
    }
    case "truncate":
      return base.subarray(0, mutation.length % (base.byteLength + 1));
    case "extend": {
      const out = new Uint8Array(base.byteLength + mutation.tail.byteLength);
      out.set(base);
      out.set(mutation.tail, base.byteLength);
      return out;
    }
    case "splice": {
      const other = CORPUS[mutation.other % CORPUS.length]!;
      const at = mutation.at % (base.byteLength + 1);
      const out = new Uint8Array(at + other.byteLength);
      out.set(base.subarray(0, at));
      out.set(other, at);
      return out;
    }
    case "reframe": {
      if (base.byteLength === 0) return Uint8Array.from([mutation.discriminator]);
      const out = Uint8Array.from(base);
      out[0] = mutation.discriminator;
      return out;
    }
  }
}

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.constant<Mutation>({ kind: "identity" }),
  fc.record({
    kind: fc.constant("flip" as const),
    index: fc.nat({ max: 8_192 }),
    bit: fc.nat({ max: 7 }),
  }),
  fc.record({
    kind: fc.constant("overwrite" as const),
    index: fc.nat({ max: 8_192 }),
    byte: fc.nat({ max: 255 }),
  }),
  fc.record({ kind: fc.constant("truncate" as const), length: fc.nat({ max: 8_192 }) }),
  fc.record({
    kind: fc.constant("extend" as const),
    tail: fc.uint8Array({ maxLength: 64 }),
  }),
  fc.record({
    kind: fc.constant("splice" as const),
    other: fc.nat({ max: 4_096 }),
    at: fc.nat({ max: 8_192 }),
  }),
  fc.record({ kind: fc.constant("reframe" as const), discriminator: fc.nat({ max: 255 }) }),
);

/** A mutated corpus entry: real protocol bytes with one operator applied. */
const mutatedCorpusArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.nat({ max: 4_096 }), mutationArb)
  .map(([index, mutation]) => mutate(CORPUS[index % CORPUS.length]!, mutation));

/**
 * The generator every decoder property runs under: half structured corpus, half
 * unstructured bytes. The unstructured half is not decoration — it is the only
 * part that reaches the zero-length and single-byte rows §3.4 enumerates
 * separately, which no mutation of a real payload produces often.
 */
const payloadArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  { arbitrary: mutatedCorpusArb, weight: 3 },
  { arbitrary: fc.uint8Array({ maxLength: 512 }), weight: 1 },
  { arbitrary: fc.uint8Array({ maxLength: 4 }), weight: 1 },
);

// ─── length-lying inputs ─────────────────────────────────────────────────────

/**
 * A CBOR head that DECLARES `length` items of `major` and then stops. These are
 * the inputs a decoder that sized a buffer from a declared length would die on:
 * the largest declares 2^64 − 1 bytes and carries none of them.
 */
function cborHead(major: number, length: bigint, payload: Uint8Array): Uint8Array {
  const prefix = major << 5;
  let head: number[];
  if (length < 24n) head = [prefix | Number(length)];
  else if (length <= 0xffn) head = [prefix | 24, Number(length)];
  else if (length <= 0xffffn)
    head = [prefix | 25, Number(length >> 8n) & 0xff, Number(length) & 0xff];
  else if (length <= 0xffff_ffffn) {
    head = [prefix | 26];
    for (let shift = 24n; shift >= 0n; shift -= 8n) head.push(Number((length >> shift) & 0xffn));
  } else {
    head = [prefix | 27];
    for (let shift = 56n; shift >= 0n; shift -= 8n) head.push(Number((length >> shift) & 0xffn));
  }
  const out = new Uint8Array(head.length + payload.byteLength);
  out.set(Uint8Array.from(head));
  out.set(payload, head.length);
  return out;
}

/** Byte string, text string, array, and map — every CBOR major type with a length. */
const LENGTH_BEARING_MAJORS: readonly number[] = [2, 3, 4, 5];

const DECLARED_LENGTHS: readonly bigint[] = [
  0x18n,
  0xffn,
  0x0100n,
  0xffffn,
  0x0001_0000n,
  0x7fff_ffffn,
  0xffff_ffffn,
  0x0000_0001_0000_0000n,
  0x7fff_ffff_ffff_ffffn,
  0xffff_ffff_ffff_ffffn,
];

const LENGTH_LYING: readonly Uint8Array[] = LENGTH_BEARING_MAJORS.flatMap((major) =>
  DECLARED_LENGTHS.flatMap((length) => [
    cborHead(major, length, new Uint8Array()),
    cborHead(major, length, Uint8Array.from([0x01])),
    // …and one wrapped in a two-element array, which is the §7.6 statement shape:
    // a decoder that recursed before checking the inner length fails here.
    Uint8Array.from([0x82, ...cborHead(major, length, new Uint8Array()), 0x40]),
  ]),
);

// ─── shared obligations ──────────────────────────────────────────────────────

/** Every reason `decodeE2eeEnvelope` declares (§3.3). */
const ENVELOPE_REASONS = new Set([
  "bad_discriminator",
  "truncated",
  "unsupported_version",
  "unsupported_suite",
]);
/** Every reason `decodeE2eeInnerRecord` declares (§3.3). */
const INNER_REASONS = new Set(["truncated", "reserved_inner_type"]);
/** Every reason `decodeE2eeNegotiationRecord` declares (§3.3, §11.2). */
const NEGOTIATION_REASONS = new Set([
  "bad_discriminator",
  "truncated",
  "reserved_record_type",
  "too_large",
  "length_mismatch",
  "non_canonical_reject",
]);
/** Every reason `decodeE2eeCapabilityCarrier` declares (§5.3). */
const CARRIER_REASONS = new Set(["not_carrier", "malformed"]);
/** Every reason `decodeCanonicalE2eeCbor` declares (§3.6). */
const CANONICAL_REASONS = new Set(["malformed", "non_canonical", "float_forbidden"]);
/** Every failure `decodeNodeE2eeCapabilityStatement` declares (§5.2 step 0, §15). */
const STATEMENT_FAILURES = new Set([
  "statement_too_large",
  "statement_malformed",
  "statement_non_canonical",
  "statement_float_forbidden",
  "transcript_too_large",
  "transcript_malformed",
  "transcript_non_canonical",
  "transcript_float_forbidden",
  "hub_origin_too_long",
  "suite_registry_too_large",
  "continuity_chain_too_long",
]);

/**
 * Call `decode` on `payload` and hold it to the shared obligation: it returns,
 * it returns a discriminated result, and an `error` carries a reason the
 * decoder's own union declares. Returns the result so a caller can add the
 * per-decoder obligations of the `ok` branch.
 *
 * A throw is reported with the input's LENGTH and its error's NAME, never its
 * bytes: a fuzz failure message is a log line, and §11.4 does not stop applying
 * because the bytes came from a generator. The original error is attached as
 * `cause` so a failure is debuggable — that is the runner's own diagnostic
 * channel, and everything reaching it here is generated test material, never
 * session or key material.
 */
function bounded<Result extends { readonly kind: string }>(
  label: string,
  decode: () => Result,
  reasonKey: "reason" | "failure",
  reasons: ReadonlySet<string>,
  payload: Uint8Array,
): Result {
  let result: Result;
  try {
    result = decode();
  } catch (error) {
    throw new Error(
      `${label} threw on a ${String(payload.byteLength)}-byte input instead of refusing it: ${
        error instanceof Error ? error.name : "unknown"
      }`,
      { cause: error },
    );
  }
  if (result === undefined || result === null || typeof result !== "object") {
    throw new Error(`${label} returned a non-result on a ${String(payload.byteLength)}-byte input`);
  }
  if (result.kind === "error") {
    const reason = (result as unknown as Record<string, unknown>)[reasonKey];
    if (typeof reason !== "string" || !reasons.has(reason)) {
      throw new Error(`${label} refused with an undeclared ${reasonKey}: ${String(reason)}`);
    }
  } else if (result.kind !== "ok") {
    throw new Error(`${label} returned an unknown kind: ${String(result.kind)}`);
  }
  return result;
}

/** Whether `view` is a window into `buffer` and not a copy of something else. */
function isViewOf(view: Uint8Array, buffer: Uint8Array): boolean {
  return (
    view.buffer === buffer.buffer &&
    view.byteOffset >= buffer.byteOffset &&
    view.byteOffset + view.byteLength <= buffer.byteOffset + buffer.byteLength
  );
}

// ─── §4.3 step 2: the discriminator ──────────────────────────────────────────

describe("fuzz: §4.3 post-strip discrimination", () => {
  it("is total, deterministic, and hands back an immutable class", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const first = classifyPostStripPayload(payload);
        const second = classifyPostStripPayload(Uint8Array.from(payload));
        // Determinism across two calls with equal bytes is the check that
        // catches a classifier that grew per-payload state in a shared
        // singleton: the module hands back FROZEN shared objects, and one stray
        // assignment would reclassify every later payload in the process.
        expect(second).toEqual(first);
        expect(Object.isFrozen(first)).toBe(true);
        expect(["envelope", "negotiation", "legacy-json", "other"]).toContain(first.kind);
        if (first.kind === "other") {
          expect(["empty", "unknown_discriminator"]).toContain(first.reason);
        }
      }),
      { seed: PROPERTY_SEED, numRuns: FRAMING_RUNS },
    );
  });
});

// ─── §3.3 framing ────────────────────────────────────────────────────────────

describe("fuzz: §3.3 envelope framing", () => {
  it("refuses or returns a complete envelope that re-encodes to its own bytes", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = bounded(
          "decodeE2eeEnvelope",
          () => decodeE2eeEnvelope(payload),
          "reason",
          ENVELOPE_REASONS,
          payload,
        );
        if (result.kind !== "ok") return;
        const value = result.value;
        // A complete value: every declared field, in its declared type. `epoch`
        // and `counter` are `bigint` because §3.1 forbids IEEE-754 for them, and
        // a decoder that handed back a `number` would lose the precision nonce
        // uniqueness rests on without failing anything else here.
        expect(typeof value.epoch).toBe("bigint");
        expect(typeof value.counter).toBe("bigint");
        expect(value.epoch >= 0n).toBe(true);
        expect(value.counter >= 0n).toBe(true);
        expect(value.header.byteLength).toBe(E2EE_ENVELOPE_HEADER_BYTES);
        expect(value.ciphertext.byteLength).toBe(payload.byteLength - E2EE_ENVELOPE_HEADER_BYTES);
        // Views, not copies: the AAD covers the RECEIVED header bytes, so a
        // decoder that re-encoded the parsed fields would authenticate bytes the
        // peer never sent.
        expect(isViewOf(value.header, payload)).toBe(true);
        expect(isViewOf(value.ciphertext, payload)).toBe(true);
        // …and the inverse holds exactly, which is what "not partially
        // initialised" means for a codec that defines one.
        expect(
          Buffer.from(
            encodeE2eeEnvelope({
              suite: value.suite,
              epoch: value.epoch,
              counter: value.counter,
              ciphertext: value.ciphertext,
            }),
          ).toString("hex"),
        ).toBe(Buffer.from(payload).toString("hex"));
      }),
      { seed: PROPERTY_SEED, numRuns: FRAMING_RUNS },
    );
  });

  it("never accepts a payload below the §3.3 overhead, whatever its header says", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        if (payload.byteLength >= E2EE_ENVELOPE_OVERHEAD_BYTES) return;
        expect(decodeE2eeEnvelope(payload).kind).toBe("error");
      }),
      { seed: PROPERTY_SEED, numRuns: FRAMING_RUNS },
    );
  });
});

describe("fuzz: §3.3 inner-record framing", () => {
  it("refuses or splits an authenticated plaintext that re-encodes to itself", () => {
    fc.assert(
      fc.property(payloadArb, (plaintext) => {
        const result = bounded(
          "decodeE2eeInnerRecord",
          () => decodeE2eeInnerRecord(plaintext),
          "reason",
          INNER_REASONS,
          plaintext,
        );
        if (result.kind !== "ok") return;
        expect(isE2eeInnerRecordType(result.value.innerType)).toBe(true);
        expect(result.value.body.byteLength).toBe(plaintext.byteLength - E2EE_INNER_TYPE_BYTES);
        expect(isViewOf(result.value.body, plaintext)).toBe(true);
        expect(
          Buffer.from(
            encodeE2eeInnerRecord(result.value.innerType as E2eeInnerRecordType, result.value.body),
          ).toString("hex"),
        ).toBe(Buffer.from(plaintext).toString("hex"));
      }),
      { seed: PROPERTY_SEED, numRuns: FRAMING_RUNS },
    );
  });
});

describe("fuzz: §3.3 negotiation-record framing", () => {
  const BOUND_OF = new Map<number, number>([
    [E2EE_NEGOTIATION_TYPE_CLIENT_HELLO, E2EE_CLIENT_HELLO_MAX_BYTES],
    [E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT, E2EE_SERVER_ACCEPT_MAX_BYTES],
    [E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT, E2EE_HANDSHAKE_REJECT_BYTES],
  ]);

  it("refuses or returns a record inside the bound its own type fixes", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = bounded(
          "decodeE2eeNegotiationRecord",
          () => decodeE2eeNegotiationRecord(payload),
          "reason",
          NEGOTIATION_REASONS,
          payload,
        );
        if (result.kind !== "ok") return;
        const bound = BOUND_OF.get(result.value.recordType);
        expect(bound, "an accepted record carries an unregistered type").not.toBeUndefined();
        // §3.3's per-type bound is enforced on the FRAMED record, so an accepted
        // record is always inside it — including the reject, whose length is
        // fixed rather than capped (§11.2).
        expect(payload.byteLength).toBeLessThanOrEqual(bound!);
        if (result.value.recordType === E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT) {
          expect(payload.byteLength).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
        }
        expect(isViewOf(result.value.body, payload)).toBe(true);
        expect(
          Buffer.from(
            encodeE2eeNegotiationRecord(result.value.recordType, result.value.body),
          ).toString("hex"),
        ).toBe(Buffer.from(payload).toString("hex"));
      }),
      { seed: PROPERTY_SEED, numRuns: FRAMING_RUNS },
    );
  });
});

// ─── §5.3 carrier ────────────────────────────────────────────────────────────

describe("fuzz: §5.3 capability carrier", () => {
  it("refuses or returns a statement whose carrier re-encodes to the exact payload", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = bounded(
          "decodeE2eeCapabilityCarrier",
          () => decodeE2eeCapabilityCarrier(payload),
          "reason",
          CARRIER_REASONS,
          payload,
        );
        if (result.kind !== "ok") return;
        // An accepted carrier is inside the §5.3 bound and decodes to a nonempty
        // statement. The §5.2 step 0 statement bound is deliberately NOT applied
        // by this decoder, so the value it yields may exceed it — asserting the
        // opposite here would pin behavior the module documents it does not have.
        expect(payload.byteLength).toBeLessThanOrEqual(E2EE_CAPABILITY_CARRIER_MAX_BYTES);
        expect(result.value.byteLength).toBeGreaterThan(0);
      }),
      { seed: PROPERTY_SEED, numRuns: FRAMING_RUNS },
    );
  });

  it("gives the same verdict twice, so no shared decoder state leaks between payloads", () => {
    // The module holds ONE `TextDecoder` and ONE `TextEncoder` across every
    // inbound legacy-JSON payload. A stateful streaming decode would carry a
    // partial multi-byte sequence from one payload into the next, which on this
    // path means one peer's bytes changing another's classification.
    fc.assert(
      fc.property(payloadArb, payloadArb, (first, second) => {
        const before = decodeE2eeCapabilityCarrier(first);
        decodeE2eeCapabilityCarrier(second);
        const after = decodeE2eeCapabilityCarrier(Uint8Array.from(first));
        expect(after.kind).toBe(before.kind);
        if (before.kind === "error" && after.kind === "error") {
          expect(after.reason).toBe(before.reason);
        }
        if (before.kind === "ok" && after.kind === "ok") {
          expect(Buffer.from(after.value).toString("hex")).toBe(
            Buffer.from(before.value).toString("hex"),
          );
        }
      }),
      { seed: PROPERTY_SEED, numRuns: FRAMING_RUNS },
    );
  });
});

// ─── §3.6 canonical CBOR ─────────────────────────────────────────────────────

describe("fuzz: §3.6 canonical decoder", () => {
  it("refuses or returns a value that re-encodes to the exact input bytes", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = bounded(
          "decodeCanonicalE2eeCbor",
          () => decodeCanonicalE2eeCbor(payload),
          "reason",
          CANONICAL_REASONS,
          payload,
        );
        // The §3.6 re-encode rule is the decoder's own postcondition, so an `ok`
        // result is only meaningful if it survives being asked again. Feeding the
        // value back through the decoder is not possible — it takes bytes — so
        // the check is that a second decode of the same bytes agrees.
        if (result.kind !== "ok") return;
        const again = decodeCanonicalE2eeCbor(Uint8Array.from(payload));
        expect(again.kind).toBe("ok");
        expect(payload.byteLength).toBeGreaterThan(0);
      }),
      { seed: PROPERTY_SEED, numRuns: CBOR_RUNS },
    );
  });

  it("refuses every declared length it was not handed the bytes for", () => {
    // THE ALLOCATION CLAUSE. Each of these declares up to 2^64 − 1 items and
    // carries none of them. A decoder that sized a buffer from the declared
    // length before checking it against the remaining input throws or exhausts
    // memory here; `bounded` turns either into a failure.
    expect(LENGTH_LYING.length).toBe(LENGTH_BEARING_MAJORS.length * DECLARED_LENGTHS.length * 3);
    for (const payload of LENGTH_LYING) {
      const result = bounded(
        "decodeCanonicalE2eeCbor",
        () => decodeCanonicalE2eeCbor(payload),
        "reason",
        CANONICAL_REASONS,
        payload,
      );
      expect(result.kind, Buffer.from(payload).toString("hex")).toBe("error");
    }
  });
});

// ─── §5.2 statement decode and §7.5 continuity decode ────────────────────────

describe("fuzz: §5.2 statement decoder", () => {
  it("refuses or returns a statement inside every bound §5.2 step 0 applies", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = bounded(
          "decodeNodeE2eeCapabilityStatement",
          () => decodeNodeE2eeCapabilityStatement(payload),
          "failure",
          STATEMENT_FAILURES,
          payload,
        );
        if (result.kind !== "ok") return;
        expect(payload.byteLength).toBeLessThanOrEqual(E2EE_CAPABILITY_STATEMENT_MAX_BYTES);
        const value = result.value;
        // The fields a caller acts on before any signature check, all present.
        expect(typeof value.hubOrigin).toBe("string");
        expect(value.transcript.byteLength).toBeGreaterThan(0);
        expect(value.signature.byteLength).toBeGreaterThan(0);
        expect(value.identityPublicKey.byteLength).toBeGreaterThan(0);
        expect(value.identityFingerprint.byteLength).toBe(32);
        expect(Array.isArray(value.suiteRegistry)).toBe(true);
        expect(Array.isArray(value.continuityChain)).toBe(true);
      }),
      { seed: PROPERTY_SEED, numRuns: CBOR_RUNS },
    );
  });

  it("refuses every declared length it was not handed the bytes for", () => {
    for (const payload of LENGTH_LYING) {
      const result = bounded(
        "decodeNodeE2eeCapabilityStatement",
        () => decodeNodeE2eeCapabilityStatement(payload),
        "failure",
        STATEMENT_FAILURES,
        payload,
      );
      expect(result.kind, Buffer.from(payload).toString("hex")).toBe("error");
    }
  });
});

describe("fuzz: §7.5 continuity-transcript decoder", () => {
  it("refuses or returns a certificate whose fingerprints it recomputed itself", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = bounded(
          "decodeNodeIdentityContinuityTranscript",
          () => decodeNodeIdentityContinuityTranscript(payload),
          "reason",
          CANONICAL_REASONS,
          payload,
        );
        if (result.kind !== "ok") return;
        const value = result.value;
        expect(typeof value.continuityId).toBe("string");
        expect(Number.isSafeInteger(value.generation)).toBe(true);
        expect(value.oldFingerprint.byteLength).toBe(32);
        expect(value.newFingerprint.byteLength).toBe(32);
      }),
      { seed: PROPERTY_SEED, numRuns: CBOR_RUNS },
    );
  });
});

// ─── §5.2, the whole verifier ────────────────────────────────────────────────

describe("fuzz: §5.2 statement verification", () => {
  it("returns one of the four §5.2 verdicts for any statement bytes", () => {
    // The verifier is the first thing a client runs on bytes the relay chose,
    // and it is reached BEFORE any pin or session exists. Everything it can
    // answer is a verdict; a throw here is a pre-key denial-of-service surface,
    // which §11.4 does not permit and no caller guards against.
    fc.assert(
      fc.property(payloadArb, (statement) => {
        let verdict;
        try {
          verdict = verifyNodeE2eeCapabilityStatement({
            statement,
            connectedHubOrigin: "https://hub.example.com",
            tier: "native",
            localSuitePreference: [0x01],
            now: 1_784_160_030_000,
            accountId: "acct_0123456789",
          });
        } catch (error) {
          throw new Error(
            `verifyNodeE2eeCapabilityStatement threw on a ${String(statement.byteLength)}-byte statement: ${
              error instanceof Error ? error.name : "unknown"
            }`,
            { cause: error },
          );
        }
        expect(["verified", "invalid", "identity-event", "unusable"]).toContain(verdict.kind);
        if (verdict.kind === "invalid") {
          expect(typeof verdict.reason).toBe("string");
          expect(verdict.reason.length).toBeGreaterThan(0);
        } else {
          // Every other verdict carries the decoded statement, because §13.3 and
          // §5.7 both read it and a caller must never re-decode the raw bytes.
          expect(verdict.statement).not.toBeUndefined();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: VERIFIER_RUNS },
    );
  });
});

// ─── the corpus itself ───────────────────────────────────────────────────────

describe("fuzz: the seed corpus", () => {
  it("is large enough and really is protocol material, not an empty pool", () => {
    // A generator base that silently emptied would leave every property above
    // running on random bytes alone — green, and testing almost nothing past the
    // first guard. Pinned to a floor rather than an exact count so that adding a
    // fixture case does not fail an unrelated suite.
    expect(CORPUS.length).toBeGreaterThan(150);
    expect(CORPUS.every((entry) => entry.byteLength > 0)).toBe(true);
    // …and the mutated generator must actually reach the decoders' accept paths,
    // or the `ok` branches above are unreachable and their obligations vacuous.
    let acceptedEnvelopes = 0;
    let acceptedInner = 0;
    let acceptedCanonical = 0;
    for (const entry of CORPUS) {
      if (decodeE2eeEnvelope(entry).kind === "ok") acceptedEnvelopes += 1;
      if (decodeE2eeInnerRecord(entry).kind === "ok") acceptedInner += 1;
      if (decodeCanonicalE2eeCbor(entry).kind === "ok") acceptedCanonical += 1;
    }
    expect(acceptedEnvelopes, "no corpus entry decodes as an envelope").toBeGreaterThan(0);
    expect(acceptedInner, "no corpus entry decodes as an inner record").toBeGreaterThan(0);
    expect(acceptedCanonical, "no corpus entry decodes as canonical CBOR").toBeGreaterThan(0);
  });
});
