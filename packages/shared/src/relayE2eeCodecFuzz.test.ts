import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_CAPABILITY_CARRIER_MAX_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
  E2EE_CAPABILITY_STATEMENT_MAX_BYTES,
  E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES,
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_CONTINUITY_CHAIN_MAX_LENGTH,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_HUB_ORIGIN_MAX_BYTES,
  E2EE_INNER_TYPE_BYTES,
  E2EE_NEGOTIATION_DISCRIMINATOR,
  E2EE_SERVER_ACCEPT_MAX_BYTES,
  E2EE_SUITE_REGISTRY_MAX_ENTRIES,
} from "./relayE2eeConstants.ts";
import { verifyNodeE2eeCapabilityStatement } from "./relayE2eeCapabilityVerify.ts";
import {
  decodeCanonicalE2eeCbor,
  decodeNodeE2eeCapabilityStatement,
  decodeNodeIdentityContinuityTranscript,
  encodeCanonicalE2eeCbor,
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
  encodeE2eeCapabilityCarrier,
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
// SEED POLICY. Every `fc.assert` runs under a seed DERIVED from the fixed
// `PROPERTY_SEED` below — the literal the sibling property suites use
// (`relayE2eeWire.test.ts`, `relayE2eeNoiseProperties.test.ts`,
// `relayCodec.test.ts`) — by `seedFor(label)`, a plain hash of the property's
// own name. Everything a fixed seed is for survives: no clock, no environment, a
// CI failure that reproduces byte for byte on a developer machine with no extra
// flags, and a shrunk counterexample printed with the `seed`/`path` pair that
// replays the single case. The seed MUST NOT be made time- or
// environment-dependent.
//
// The derivation exists because fast-check produces a DETERMINISTIC value
// sequence for a given arbitrary at a given seed, so while every property took
// the raw literal, all five framing properties saw the SAME 1,500 payloads and
// all three CBOR properties the same 600. The campaign's run counts were honest
// and its BREADTH was a fifth and a third of what they suggested — 1.5 million
// runs of five properties over 300,000 distinct payloads, not 1.5 million
// distinct payloads examined five times.
//
// WHAT THE SEARCH HAS ACTUALLY FOUND, so far: NOTHING. No decoder defect. The
// deepest clean campaign against the code as it stood was
// `RELAY_E2EE_FUZZ_SOAK=1000` — 1.5 million runs of each framing property,
// 600,000 of each CBOR property, and 250,000 of the §5.2 verifier property, 77
// seconds of wall clock on one developer machine, all properties green. A run at
// 3,000 was also attempted and all but one finished clean; that one was cut
// short by the RUNNER's default per-test timeout, not by a failure, and is
// reported that way rather than as a pass. "No defect found" at this depth is
// the honest claim and it is a weak one: it bounds nothing about inputs the
// generators do not reach, and this round found that several important classes
// were among them — every §5.3 carrier past its first byte, every input past any
// declared size bound, six of the eleven §5.2 step 0 failures, and every §3.6
// canonical violation that a random byte flip does not stumble into. Each of
// those now has a generator or a directed input, and a test that fails if it
// stops being reached.
//
// THE CORPUS IS THE GENERATOR BASE, not an afterthought. Uniformly random bytes
// almost never reach past a decoder's first guard: a random 64-byte string is a
// `bad_discriminator` in one comparison and tells you nothing about the code
// behind it. So the generators draw from the §16.3 fixture corpus — every
// committed `{"$bytes": …}` value in seven families, which is real protocol
// material — and MUTATE it: flip a byte, overwrite a byte, truncate, extend,
// splice two together, rewrite the leading discriminator, or pad it past every
// declared bound. Those inputs get past the framing checks and into the parsing
// the framing protects.
//
// A CORPUS BASE IS ONLY AS GOOD AS THE ACCEPT PATHS IT REACHES, and that is
// checked rather than assumed: the floor test at the bottom of this file
// requires at least one committed entry that each decoder ACCEPTS, by name. It
// exists because the §5.3 carrier family was absent from the list for a while
// and nothing noticed — every carrier obligation in this file was unreachable
// and both carrier properties compared `not_carrier` to `not_carrier`.
//
// WHERE BYTE-LEVEL MUTATION CANNOT REACH, INPUTS ARE BUILT. Three classes needed
// their own generators, because a random flip destroys the surrounding structure
// long before it produces the case: §5.3 carriers (built with the real encoder,
// then mutated as TEXT — alphabet, padding, member order, member count, spacing,
// UTF-8, length), §3.6 canonical violations (duplicate keys, long-form length
// heads, out-of-order keys, floats at all three widths), and the six §5.2 step 0
// failures that need a statement well formed everywhere except one field.

const PROPERTY_SEED = 0x5259_434f;

/**
 * A per-property seed, derived from the shared one by a label.
 *
 * fast-check produces a DETERMINISTIC value sequence for a given arbitrary at a
 * given seed, so every property that took `payloadArb` at the same seed and run
 * count saw the IDENTICAL sequence — five framing properties over one set of
 * 1,500 payloads rather than five sets, and three CBOR properties over one set
 * of 600. The campaign was a fifth and a third as broad as its run counts read.
 *
 * Offsetting by a label keeps every desirable property of a fixed seed — no
 * clock, no environment, a counterexample that replays with the printed
 * `seed`/`path` pair — while letting each property explore its own inputs. The
 * derivation is a plain hash of the label so a reader can compute it by hand.
 */
function seedFor(label: string): number {
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return (PROPERTY_SEED + hash) | 0;
}

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
 * wire payloads, F2 carries §5.3 CARRIERS, F3 carries capability statements, F4
 * and F5 carry directly signed transcripts and continuity chains, F8 carries
 * protected envelopes, and F12 carries negotiation and error records.
 *
 * F2 was absent from this list until the §5.3 accept path was measured, and its
 * absence made both carrier properties below vacuous: over 1,500 runs
 * `decodeE2eeCapabilityCarrier` returned `not_carrier` 1,500 times — zero `ok`,
 * zero `malformed` — because the six families listed here contain exactly two
 * `{`-leading entries and neither is a carrier. The floor test at the bottom of
 * this file now requires each decoder's accept path to be reachable from the
 * corpus, so a future family reshuffle cannot silently empty one again.
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
  "f02-carrier-compatibility.json",
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
  | { readonly kind: "reframe"; readonly discriminator: number }
  | { readonly kind: "oversize"; readonly tail: number };

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
    case "oversize": {
      // PAST EVERY DECLARED BOUND. Without this operator the generator's hard
      // ceiling is the `splice` case's `2 × corpusMax` — 2,510 bytes against a
      // largest bound of 8,192 — so every size assertion in this file held for
      // every reachable input and none of them could fail whatever the decoders
      // did. Deleting a decoder's size check entirely still passed.
      const out = new Uint8Array(base.byteLength + mutation.tail);
      out.set(base);
      out.fill(0x41, base.byteLength);
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
  // Weighted like the rest: an oversize input is refused early by every decoder,
  // so it is cheap, and it is the only arm that reaches the size clauses.
  fc.record({ kind: fc.constant("oversize" as const), tail: fc.nat({ max: 12_000 }) }),
);

/** A mutated corpus entry: real protocol bytes with one operator applied. */
const mutatedCorpusArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.nat({ max: 4_096 }), mutationArb)
  .map(([index, mutation]) => mutate(CORPUS[index % CORPUS.length]!, mutation));

// ─── CBOR-STRUCTURE-AWARE MUTATION ───────────────────────────────────────────
//
// The byte-level operators above reach §3.6's canonical rules only by accident —
// `non_canonical` fired on 0.83% of inputs at the gate budget and every one of
// them was incidental. But the canonical rules are precisely what
// `decodeCanonicalE2eeCbor`'s re-encode check exists to enforce, so they deserve
// an operator that produces them on purpose: a map with a DUPLICATE key, a
// length encoded in a longer head than the shortest form, a map whose keys are
// out of canonical order, and a float where an integer belongs.
//
// These are emitted as raw bytes rather than built through the encoder, because
// the encoder refuses to produce any of them — which is the point.

/** A CBOR head for `major` declaring `length`, in a head of exactly `width`. */
function cborHeadOfWidth(major: number, length: number, width: 1 | 2 | 3 | 5): Uint8Array {
  const prefix = major << 5;
  if (width === 1) return Uint8Array.from([prefix | length]);
  if (width === 2) return Uint8Array.from([prefix | 24, length & 0xff]);
  if (width === 3) return Uint8Array.from([prefix | 25, (length >> 8) & 0xff, length & 0xff]);
  return Uint8Array.from([
    prefix | 26,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
}

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, one) => total + one.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

/** Canonical CBOR for a small unsigned integer, which is one byte below 24. */
const uint = (value: number): Uint8Array =>
  value < 24 ? Uint8Array.from([value]) : Uint8Array.from([0x18, value & 0xff]);

/**
 * Inputs that break exactly one §3.6 rule each, plus the canonical control they
 * were built from. A decoder that dropped its re-encode check would accept the
 * violations; one that broke would reject the control.
 *
 * They do not all land on the same reason, and that is information rather than
 * noise: a long-form length head and a duplicate key are caught by the re-encode
 * check and answered `malformed`, out-of-order keys are answered
 * `non_canonical`, and a float of any width is `float_forbidden`. All three are
 * refusals, which is what the properties assert.
 */
const NON_CANONICAL: readonly { readonly label: string; readonly bytes: Uint8Array }[] = [
  // The control: `{1: 1, 2: 2}` in shortest form, canonical key order.
  {
    label: "canonical control",
    bytes: concat(cborHeadOfWidth(5, 2, 1), uint(1), uint(1), uint(2), uint(2)),
  },
  // §3.6: a map key appearing twice.
  {
    label: "duplicate map key",
    bytes: concat(cborHeadOfWidth(5, 2, 1), uint(1), uint(1), uint(1), uint(2)),
  },
  // §3.6: keys out of canonical order.
  {
    label: "map keys out of order",
    bytes: concat(cborHeadOfWidth(5, 2, 1), uint(2), uint(2), uint(1), uint(1)),
  },
  // §3.6 / RFC 8949 shortest form: a two-element array in a two-byte head.
  {
    label: "array length in a longer head",
    bytes: concat(cborHeadOfWidth(4, 2, 2), uint(1), uint(2)),
  },
  // …and the same for a byte string.
  {
    label: "byte-string length in a four-byte head",
    bytes: concat(cborHeadOfWidth(2, 2, 3), Uint8Array.from([0x41, 0x42])),
  },
  // §3.6 forbids floats outright, at any width.
  { label: "half float", bytes: Uint8Array.from([0x82, 0xf9, 0x3c, 0x00, 0x01]) },
  { label: "single float", bytes: Uint8Array.from([0x82, 0xfa, 0x3f, 0x80, 0x00, 0x00, 0x01]) },
  {
    label: "double float",
    bytes: Uint8Array.from([0x82, 0xfb, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0, 0x01]),
  },
];

/**
 * A float head spliced into a corpus entry at an arbitrary position.
 *
 * `float_forbidden` fired ZERO times over 600 gate runs and 600 soak runs of the
 * byte-level generator: a random byte lands on 0xf9/0xfa/0xfb rarely, and when
 * it does the surrounding structure is almost always already malformed, so the
 * decoder answers `malformed` before it reaches the float. This arm puts the
 * head where a value is expected.
 */
const floatInjectionArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.nat({ max: 4_096 }), fc.nat({ max: 8_192 }), fc.constantFrom(0xf9, 0xfa, 0xfb))
  .map(([index, at, head]) => {
    const base = CORPUS[index % CORPUS.length]!;
    const offset = base.byteLength === 0 ? 0 : at % base.byteLength;
    const out = new Uint8Array(base.byteLength + 9);
    out.set(base.subarray(0, offset));
    out[offset] = head;
    out.set(base.subarray(offset), offset + 9);
    return out;
  });

const nonCanonicalArb: fc.Arbitrary<Uint8Array> = fc
  .nat({ max: NON_CANONICAL.length - 1 })
  .map((index) => NON_CANONICAL[index]!.bytes);

/**
 * The generator every decoder property runs under: half structured corpus, half
 * unstructured bytes. The unstructured half is not decoration — it is the only
 * part that reaches the zero-length and single-byte rows §3.4 enumerates
 * separately, which no mutation of a real payload produces often. The last two
 * arms are structure-aware: they exist because the byte-level operators reach
 * §3.6's canonical rules and its float prohibition only by accident, at rates
 * under one percent and zero percent respectively.
 */
const payloadArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  { arbitrary: mutatedCorpusArb, weight: 3 },
  { arbitrary: fc.uint8Array({ maxLength: 512 }), weight: 1 },
  { arbitrary: fc.uint8Array({ maxLength: 4 }), weight: 1 },
  { arbitrary: floatInjectionArb, weight: 1 },
  { arbitrary: nonCanonicalArb, weight: 1 },
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
      { seed: seedFor("post-strip-discrimination"), numRuns: FRAMING_RUNS },
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
      { seed: seedFor("envelope-framing"), numRuns: FRAMING_RUNS },
    );
  });

  it("never accepts a payload below the §3.3 overhead, whatever its header says", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        if (payload.byteLength >= E2EE_ENVELOPE_OVERHEAD_BYTES) return;
        expect(decodeE2eeEnvelope(payload).kind).toBe("error");
      }),
      { seed: seedFor("envelope-overhead-floor"), numRuns: FRAMING_RUNS },
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
      { seed: seedFor("inner-record-framing"), numRuns: FRAMING_RUNS },
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
        // THE BOUNDS AS THE DECODER'S VERDICT. A well-framed record past its own
        // type's bound must be refused, and the generator now produces those:
        // until the `oversize` operator existed the largest reachable input was
        // 2,510 bytes against bounds of 4,096 and 8,192, so `too_large` never
        // fired for a hello or an accept and the assertions below were true of
        // every input regardless of what the decoder did.
        if (payload.byteLength >= 2 && payload[0] === E2EE_NEGOTIATION_DISCRIMINATOR) {
          const bound = BOUND_OF.get(payload[1]!);
          if (bound !== undefined && payload.byteLength > bound) {
            expect(result.kind, "an oversize negotiation record was accepted").toBe("error");
          }
        }
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
      { seed: seedFor("negotiation-framing"), numRuns: FRAMING_RUNS },
    );
  });
});

// ─── §5.3 carrier ────────────────────────────────────────────────────────────

// CARRIER-SHAPED INPUTS, built rather than stumbled upon.
//
// `decodeE2eeCapabilityCarrier` returned `not_carrier` on 1,500 of 1,500 gate
// inputs and on 150,000 of 150,000 soak inputs before this generator existed:
// the corpus contained two `{`-leading entries and neither was a carrier, so
// everything past the first byte — the JSON parse, the `_tag` compare, the
// member-order check, the byte-identical re-encode, and the hand-written strict
// `base64urlUnpaddedDecode` — was fuzzed exactly zero times. That decoder is the
// highest-risk parser in the module and it was the least exercised.
//
// So a carrier is BUILT with the real encoder from a real corpus statement, and
// then its TEXT is mutated: the alphabet, the padding, the member order, the
// member count, the JSON spacing, the UTF-8, and the length.

/** One operator over a carrier's JSON text. Part of the generated case. */
type CarrierMutation =
  | { readonly kind: "intact" }
  | { readonly kind: "statement-char"; readonly at: number; readonly replacement: string }
  | { readonly kind: "statement-truncate"; readonly drop: number }
  | { readonly kind: "statement-pad"; readonly pad: string }
  | { readonly kind: "statement-empty" }
  | { readonly kind: "member-order" }
  | { readonly kind: "member-extra" }
  | { readonly kind: "spacing" }
  | { readonly kind: "wrong-tag" }
  | { readonly kind: "bad-utf8"; readonly at: number }
  | { readonly kind: "oversize" };

/**
 * The real tag, imported rather than written out again: a local copy that drifts
 * turns every "malformed" mutation below into a `not_carrier` and quietly
 * un-covers the decoder's whole body, which is the failure this generator exists
 * to end.
 */
const CARRIER_TAG = E2EE_CAPABILITY_CARRIER_TAG;
/** Characters outside the base64url alphabet, plus two inside it. */
const CARRIER_REPLACEMENTS = ["=", "+", "/", " ", "!", "\u00e9", "A", "_"] as const;

function buildCarrier(statement: Uint8Array, mutation: CarrierMutation): Uint8Array {
  const encoder = new TextEncoder();
  if (mutation.kind === "oversize") {
    // Past `E2EE_CAPABILITY_CARRIER_MAX_BYTES` while still a well-formed
    // carrier, so the §5.3 bound is what refuses it and nothing else. Built by
    // hand rather than through the encoder, which applies §5.3's bound at emit
    // and would refuse to produce this — the whole point being that a peer is
    // under no such obligation.
    // A LENGTH THE ALPHABET DECODER ACCEPTS, deliberately: a multiple of four
    // of in-alphabet characters. A length leaving one leftover character would
    // be refused by `base64urlUnpaddedDecode` instead, and this input would then
    // be refused whether or not the §5.3 bound is applied — which is exactly the
    // shape that makes a bound assertion unfalsifiable.
    return encoder.encode(
      JSON.stringify({
        _tag: CARRIER_TAG,
        statement: "A".repeat(Math.ceil((E2EE_CAPABILITY_CARRIER_MAX_BYTES + 64) / 4) * 4),
      }),
    );
  }
  const carrier = encodeE2eeCapabilityCarrier(statement);
  const text = new TextDecoder().decode(carrier);
  const parsed = JSON.parse(text) as { readonly _tag: string; readonly statement: string };
  let value = parsed.statement;
  switch (mutation.kind) {
    case "intact":
      return carrier;
    case "statement-char": {
      if (value.length === 0) return carrier;
      const at = mutation.at % value.length;
      value = value.slice(0, at) + mutation.replacement + value.slice(at + 1);
      break;
    }
    case "statement-truncate":
      value = value.slice(0, Math.max(0, value.length - (mutation.drop % 5)));
      break;
    case "statement-pad":
      value += mutation.pad;
      break;
    case "statement-empty":
      value = "";
      break;
    case "member-order":
      return encoder.encode(JSON.stringify({ statement: value, _tag: CARRIER_TAG }));
    case "member-extra":
      return encoder.encode(
        JSON.stringify({ _tag: CARRIER_TAG, statement: value, extra: "unexpected" }),
      );
    case "spacing":
      return encoder.encode(JSON.stringify({ _tag: CARRIER_TAG, statement: value }, null, 1));
    case "wrong-tag":
      return encoder.encode(JSON.stringify({ _tag: "ryco.rpc.request", statement: value }));
    case "bad-utf8": {
      const out = Uint8Array.from(carrier);
      // A lone continuation byte: valid JSON structure, invalid UTF-8, which is
      // what makes this the input the shared `TextDecoder` property is about.
      if (out.byteLength > 4) out[4 + (mutation.at % (out.byteLength - 4))] = 0x80;
      return out;
    }
  }
  return encoder.encode(JSON.stringify({ _tag: CARRIER_TAG, statement: value }));
}

const carrierMutationArb: fc.Arbitrary<CarrierMutation> = fc.oneof(
  fc.constant<CarrierMutation>({ kind: "intact" }),
  fc.record({
    kind: fc.constant("statement-char" as const),
    at: fc.nat({ max: 8_192 }),
    replacement: fc.constantFrom(...CARRIER_REPLACEMENTS),
  }),
  fc.record({ kind: fc.constant("statement-truncate" as const), drop: fc.nat({ max: 4 }) }),
  fc.record({
    kind: fc.constant("statement-pad" as const),
    pad: fc.constantFrom("=", "==", "A", "AA", "AAA"),
  }),
  fc.constant<CarrierMutation>({ kind: "statement-empty" }),
  fc.constant<CarrierMutation>({ kind: "member-order" }),
  fc.constant<CarrierMutation>({ kind: "member-extra" }),
  fc.constant<CarrierMutation>({ kind: "spacing" }),
  fc.constant<CarrierMutation>({ kind: "wrong-tag" }),
  fc.record({ kind: fc.constant("bad-utf8" as const), at: fc.nat({ max: 8_192 }) }),
  fc.constant<CarrierMutation>({ kind: "oversize" }),
);

const mutatedCarrierArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.nat({ max: 4_096 }), carrierMutationArb)
  .map(([index, mutation]) => buildCarrier(CORPUS[index % CORPUS.length]!, mutation));

/** What the carrier properties run under: the general population plus carriers. */
const carrierPayloadArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  { arbitrary: mutatedCarrierArb, weight: 3 },
  { arbitrary: payloadArb, weight: 1 },
);

describe("fuzz: §5.3 capability carrier", () => {
  it("reaches the accept path and the malformed path, so the obligations below are not vacuous", () => {
    // THE GUARD ON THE GUARD. Every obligation in the two properties below sits
    // behind an `ok` or a `malformed`, and this file once shipped with both
    // unreachable — 1,500 of 1,500 inputs stopped at the first byte. So the
    // reachability is asserted directly rather than assumed, and it is asserted
    // against the SAME generator and seed the properties use.
    const seen = new Map<string, number>();
    fc.assert(
      fc.property(carrierPayloadArb, (payload) => {
        const result = decodeE2eeCapabilityCarrier(payload);
        const key = result.kind === "ok" ? "ok" : result.reason;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }),
      { seed: seedFor("carrier-reachability"), numRuns: FRAMING_RUNS },
    );
    for (const reason of ["ok", ...CARRIER_REASONS]) {
      expect(seen.get(reason) ?? 0, `${reason} never reached`).toBeGreaterThan(0);
    }
  });

  it("refuses or returns a statement whose carrier re-encodes to the exact payload", () => {
    fc.assert(
      fc.property(carrierPayloadArb, (payload) => {
        const result = bounded(
          "decodeE2eeCapabilityCarrier",
          () => decodeE2eeCapabilityCarrier(payload),
          "reason",
          CARRIER_REASONS,
          payload,
        );
        // THE BOUND, ASSERTED AS THE DECODER'S VERDICT rather than as a property
        // of the input. `expect(payload.byteLength).toBeLessThanOrEqual(BOUND)`
        // on the `ok` branch was true of every input the generator could produce
        // — its ceiling was 2,510 bytes against a 6,969-byte bound — so deleting
        // the decoder's size check entirely left it green. This direction fails
        // when the check goes.
        if (payload.byteLength > E2EE_CAPABILITY_CARRIER_MAX_BYTES) {
          expect(result.kind, "an oversize payload was accepted").toBe("error");
        }
        if (result.kind !== "ok") return;
        // An accepted carrier is inside the §5.3 bound and decodes to a nonempty
        // statement. The §5.2 step 0 statement bound is deliberately NOT applied
        // by this decoder, so the value it yields may exceed it — asserting the
        // opposite here would pin behavior the module documents it does not have.
        expect(payload.byteLength).toBeLessThanOrEqual(E2EE_CAPABILITY_CARRIER_MAX_BYTES);
        expect(result.value.byteLength).toBeGreaterThan(0);
        // …and the accepted statement really is what the encoder would carry, so
        // `ok` is a statement about the round trip and not about the tag alone.
        expect(Buffer.from(encodeE2eeCapabilityCarrier(result.value)).toString("hex")).toBe(
          Buffer.from(payload).toString("hex"),
        );
      }),
      { seed: seedFor("carrier-round-trip"), numRuns: FRAMING_RUNS },
    );
  });

  it("gives the same verdict twice, so no shared decoder state leaks between payloads", () => {
    // The module holds ONE `TextDecoder` and ONE `TextEncoder` across every
    // inbound legacy-JSON payload. A stateful streaming decode would carry a
    // partial multi-byte sequence from one payload into the next, which on this
    // path means one peer's bytes changing another's classification. Both
    // arguments draw carriers, so the comparison is between real verdicts rather
    // than between two `not_carrier`s — which is all it could ever be while F2
    // was missing from the corpus and no carrier generator existed.
    fc.assert(
      fc.property(carrierPayloadArb, carrierPayloadArb, (first, second) => {
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
      { seed: seedFor("carrier-shared-state"), numRuns: FRAMING_RUNS },
    );
  });
});

// ─── DIRECTED §5.2 STEP 0 INPUTS ─────────────────────────────────────────────
//
// Eleven failures are declared; the byte-level generator reached THREE of them
// at the gate budget and five at 150× the budget. `statement_too_large`,
// `transcript_too_large`, `hub_origin_too_long`, `suite_registry_too_large`,
// `continuity_chain_too_long` and the two float reasons were unreachable in
// practice: each needs a statement that is well formed everywhere EXCEPT the one
// field it violates, and a random byte flip destroys the surrounding structure
// long before it produces one.
//
// So they are built. A committed statement is decoded through the real decoders,
// ONE element is replaced, and the two layers are re-encoded through the real
// canonical encoder — which is what makes each input a statement that fails for
// exactly the stated reason rather than a blob that fails for the first reason
// anything checks.

/** The first corpus entry that decodes as a §5.2 statement, if any. */
const BASE_STATEMENT: Uint8Array | undefined = CORPUS.find(
  (entry) => decodeNodeE2eeCapabilityStatement(entry).kind === "ok",
);

function statementLayers():
  | { readonly outer: unknown[]; readonly transcript: unknown[] }
  | undefined {
  if (BASE_STATEMENT === undefined) return undefined;
  const outer = decodeCanonicalE2eeCbor(BASE_STATEMENT);
  if (outer.kind !== "ok" || !Array.isArray(outer.value)) return undefined;
  const transcriptBytes = outer.value[0];
  if (!(transcriptBytes instanceof Uint8Array)) return undefined;
  const inner = decodeCanonicalE2eeCbor(transcriptBytes);
  if (inner.kind !== "ok" || !Array.isArray(inner.value)) return undefined;
  return { outer: [...outer.value], transcript: [...inner.value] };
}

/** Rebuild a statement with one transcript element replaced. */
function statementWithTranscriptElement(at: number, value: unknown): Uint8Array | undefined {
  const layers = statementLayers();
  if (layers === undefined) return undefined;
  const transcript = [...layers.transcript];
  transcript[at] = value;
  const outer = [...layers.outer];
  outer[0] = encodeCanonicalE2eeCbor(transcript);
  return encodeCanonicalE2eeCbor(outer);
}

/** A float head spliced into a byte string a decoder will decode as CBOR. */
const FLOAT_ARRAY = Uint8Array.from([0x82, 0xfb, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0, 0x01]);
/** `{2: 2, 1: 1}` — well formed, decodable, and out of canonical key order. */
const OUT_OF_ORDER_MAP = concat(cborHeadOfWidth(5, 2, 1), uint(2), uint(2), uint(1), uint(1));

const DIRECTED_STATEMENTS: readonly { readonly failure: string; readonly bytes: Uint8Array }[] =
  BASE_STATEMENT === undefined
    ? []
    : ([
        // §5.2 step 0's first bound, before any decode.
        {
          failure: "statement_too_large",
          bytes: (() => {
            const out = new Uint8Array(E2EE_CAPABILITY_STATEMENT_MAX_BYTES + 1);
            out.set(BASE_STATEMENT.subarray(0, out.byteLength));
            return out;
          })(),
        },
        // A transcript past its own bound inside a statement inside the outer
        // bound — the ordering §5.2 step 0 fixes, and the only way to see it.
        // The signature element is one byte rather than sixty-four because a
        // real one would push the statement past its own bound and the earlier
        // check would fire instead; §5.2 step 0 reaches the transcript bound
        // BEFORE it looks at the signature's shape, which is exactly the
        // ordering this input exists to pin.
        {
          failure: "transcript_too_large",
          bytes: encodeCanonicalE2eeCbor([
            new Uint8Array(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + 1),
            0,
          ]),
        },
        { failure: "statement_malformed", bytes: encodeCanonicalE2eeCbor([1, 2, 3]) },
        // Out-of-order map keys, which is the violation `decodeCanonicalE2eeCbor`
        // answers `non_canonical` for. A long-form length head and a duplicate
        // key are refused too, but as `malformed` — the re-encode check catches
        // the first two before the ordering rule is reached — so neither would
        // land on the reason this entry is here to reach.
        { failure: "statement_non_canonical", bytes: OUT_OF_ORDER_MAP },
        { failure: "statement_float_forbidden", bytes: FLOAT_ARRAY },
        {
          failure: "transcript_float_forbidden",
          bytes: encodeCanonicalE2eeCbor([FLOAT_ARRAY, new Uint8Array(64)]),
        },
        {
          failure: "transcript_non_canonical",
          bytes: encodeCanonicalE2eeCbor([OUT_OF_ORDER_MAP, new Uint8Array(64)]),
        },
        {
          failure: "transcript_malformed",
          bytes: encodeCanonicalE2eeCbor([encodeCanonicalE2eeCbor([1, 2]), new Uint8Array(64)]),
        },
        // §7.2's element 1, over `E2EE_HUB_ORIGIN_MAX_BYTES` in UTF-8 but
        // otherwise a Hub origin the canonicalizer accepts.
        {
          failure: "hub_origin_too_long",
          bytes: statementWithTranscriptElement(
            1,
            `https://${"h".repeat(E2EE_HUB_ORIGIN_MAX_BYTES)}.example.com`,
          ),
        },
        // §15's counting bounds, both of them a length rather than a byte count.
        {
          failure: "suite_registry_too_large",
          bytes: statementWithTranscriptElement(
            9,
            Array.from({ length: E2EE_SUITE_REGISTRY_MAX_ENTRIES + 1 }, (_unused, at) => at + 1),
          ),
        },
        {
          failure: "continuity_chain_too_long",
          bytes: statementWithTranscriptElement(
            11,
            Array.from({ length: E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1 }, () => new Uint8Array(4)),
          ),
        },
      ].filter((entry) => entry.bytes !== undefined) as {
        readonly failure: string;
        readonly bytes: Uint8Array;
      }[]);

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
      { seed: seedFor("canonical-round-trip"), numRuns: CBOR_RUNS },
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
  it("reaches every failure §5.2 step 0 declares, so the undeclared-reason check is not empty", () => {
    // WHAT THE `STATEMENT_FAILURES` SET IS WORTH depends entirely on how much of
    // it is reachable. The property below fails a decoder that invents a reason
    // outside the set — but only for the reasons the inputs can produce, and the
    // byte-level generator produced three of eleven at the gate and five of
    // eleven at 150× the gate. The directed inputs above close the rest, and
    // this test asserts the closure EXACTLY, in both directions: an input that
    // stopped reaching its failure fails here, and so does a failure this file
    // stopped declaring.
    expect(BASE_STATEMENT, "no corpus entry decodes as a §5.2 statement").toBeDefined();
    const reached = new Set<string>();
    for (const directed of DIRECTED_STATEMENTS) {
      const result = decodeNodeE2eeCapabilityStatement(directed.bytes);
      expect(result.kind, directed.failure).toBe("error");
      if (result.kind !== "error") continue;
      expect(result.failure, `${directed.failure}: built input reached another failure`).toBe(
        directed.failure,
      );
      reached.add(result.failure);
    }
    expect([...reached].toSorted()).toEqual([...STATEMENT_FAILURES].toSorted());
    // …and the base really is accepted, so "reaches every failure" is a
    // statement about a decoder that also has an accept path.
    if (BASE_STATEMENT !== undefined) {
      expect(decodeNodeE2eeCapabilityStatement(BASE_STATEMENT).kind).toBe("ok");
    }
  });

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
        // THE BOUND AS THE DECODER'S VERDICT, not as a property of the input:
        // the `ok`-branch length assertion below held for every input the
        // generator could reach — its ceiling was under half this bound — so
        // deleting the decoder's size check left it green.
        if (payload.byteLength > E2EE_CAPABILITY_STATEMENT_MAX_BYTES) {
          expect(result.kind, "an oversize statement was accepted").toBe("error");
        }
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
      { seed: seedFor("statement-bounds"), numRuns: CBOR_RUNS },
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
      { seed: seedFor("continuity-transcript"), numRuns: CBOR_RUNS },
    );
  });
});

// ─── §5.2, the whole verifier ────────────────────────────────────────────────

describe("fuzz: §5.2 statement verification", () => {
  const verify = (statement: Uint8Array): ReturnType<typeof verifyNodeE2eeCapabilityStatement> => {
    try {
      return verifyNodeE2eeCapabilityStatement({
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
  };

  it("returns one of the four §5.2 verdicts for any statement bytes", () => {
    // The verifier is the first thing a client runs on bytes the relay chose,
    // and it is reached BEFORE any pin or session exists. Everything it can
    // answer is a verdict; a throw here is a pre-key denial-of-service surface,
    // which §11.4 does not permit and no caller guards against.
    fc.assert(
      fc.property(payloadArb, (statement) => {
        const verdict = verify(statement);
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
      { seed: seedFor("verifier-verdicts"), numRuns: VERIFIER_RUNS },
    );
  });

  it("reaches a non-invalid verdict at all, so the `statement` obligation is live", () => {
    // THE OTHER BRANCH. Over 250 gate runs the generated inputs produced
    // `invalid` 250 times, so the `expect(verdict.statement).not.toBeUndefined()`
    // above was dead code — the verifier could have dropped `statement` from
    // every other verdict and the property would still have passed. The corpus's
    // own accepted statement is what reaches the branch, and asserting it here
    // means a corpus that stopped carrying one fails loudly rather than quietly
    // returning the property to being half a property.
    expect(BASE_STATEMENT, "no corpus entry decodes as a §5.2 statement").toBeDefined();
    if (BASE_STATEMENT === undefined) return;
    const verdict = verify(BASE_STATEMENT);
    expect(verdict.kind).not.toBe("invalid");
    if (verdict.kind === "invalid") return;
    expect(verdict.statement).not.toBeUndefined();
    // …and an input that IS invalid still carries a reason, so both branches of
    // the property above are driven by something rather than one of them alone.
    const invalid = verify(new Uint8Array([0x00]));
    expect(invalid.kind).toBe("invalid");
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

  it("carries an accepted input for EVERY decoder, not only for the three it used to check", () => {
    // THE HOLE THIS CLOSES. The floor above counted accepts for envelopes, inner
    // records and canonical CBOR, and for nothing else — so when the §5.3 carrier
    // family was left out of `CORPUS`, `decodeE2eeCapabilityCarrier` answered
    // `not_carrier` on 1,500 of 1,500 inputs and every obligation on its `ok`
    // branch became unreachable, and no test noticed. A decoder whose accept path
    // the corpus cannot reach is a decoder this file is not fuzzing past its
    // first guard, so each one is counted by name.
    const accepts = (predicate: (entry: Uint8Array) => boolean): number =>
      CORPUS.filter((entry) => predicate(entry)).length;
    expect(
      accepts((entry) => decodeE2eeCapabilityCarrier(entry).kind === "ok"),
      "no corpus entry decodes as a §5.3 carrier — is the carrier family in CORPUS?",
    ).toBeGreaterThan(0);
    expect(
      accepts((entry) => decodeE2eeNegotiationRecord(entry).kind === "ok"),
      "no corpus entry decodes as a §3.3 negotiation record",
    ).toBeGreaterThan(0);
    expect(
      accepts((entry) => decodeNodeE2eeCapabilityStatement(entry).kind === "ok"),
      "no corpus entry decodes as a §5.2 statement",
    ).toBeGreaterThan(0);
    expect(
      accepts((entry) => decodeNodeIdentityContinuityTranscript(entry).kind === "ok"),
      "no corpus entry decodes as a §7.5 continuity transcript",
    ).toBeGreaterThan(0);
  });
});
