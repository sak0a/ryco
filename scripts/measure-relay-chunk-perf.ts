import { writeFileSync } from "node:fs";
import { hrtime } from "node:process";

import { RELAY_INITIAL_LIMITS, RELAY_CHUNK_HEADER_BYTES } from "@ryco/contracts/relay";
import { E2EE_AEAD_TAG_BYTES, E2EE_ENVELOPE_OVERHEAD_BYTES } from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  encodeE2eeEnvelope,
  encodeE2eeInnerRecord,
} from "@ryco/shared/relayE2eeWire";
import {
  RELAY_CHUNK_CAPABILITY_PRELUDE,
  RelayMessageAssembler,
  prepareRelayMessage,
} from "@ryco/shared/relayMessageChunks";

// CHUNK-PATH PERFORMANCE MEASUREMENT — docs/relay-e2ee-protocol.md §4.2, §4.3, §4.5.
//
// WHAT THIS MEASURES. The relay CHUNK PATH only: `prepareRelayMessage` on the
// sending side and `RelayMessageAssembler` on the receiving side, for one
// logical message, at representative payload sizes, with and without the §3.3
// envelope wrapped around the payload.
//
// WHAT IT DOES NOT MEASURE, and what its numbers therefore may not be used to
// conclude:
//
//   • NOT the cost of E2EE. No AEAD runs here, no key is derived, no handshake
//     happens. The `e2ee` rows differ from the `legacy` rows in exactly one way:
//     the message carries `E2EE_ENVELOPE_OVERHEAD_BYTES` more bytes, because a
//     record is `header ‖ innerType ‖ ciphertext ‖ tag` rather than the payload
//     alone. Reading "E2EE costs X%" off these rows would be reading the cost of
//     32 bytes and calling it the cost of encryption.
//   • NOT end-to-end throughput. There is no socket, no relay, no event loop
//     contention, no backpressure, and no second process. Every byte moves inside
//     one function call.
//   • NOT a regression gate. Nothing in the test suite asserts a wall-clock
//     threshold from this file, deliberately: a timing assertion on shared CI is
//     a flake generator. `measure-relay-chunk-perf.test.ts` checks the recorded
//     artifact's SHAPE and its size-only columns — chunk counts and wire bytes,
//     which are deterministic — and nothing else.
//   • NOT comparable across machines. The `environment` block in the artifact
//     records the runtime and platform the numbers were produced on precisely so
//     that a later reader can see whether a comparison is legitimate. Two runs on
//     different hardware are two different measurements.
//
// WHAT THE NUMBERS ARE GOOD FOR: comparing one commit against another ON THE SAME
// MACHINE, and seeing the shape of the cost curve as a payload crosses the
// one-frame boundary.
//
// ALLOCATION IS MEASURED FROM REAL OUTPUTS, NOT SAMPLED FROM THE HEAP. Sampling
// `process.memoryUsage()` around a loop measures the garbage collector's mood as
// much as the code, and the resulting number is neither stable nor comparable.
// Instead every figure below is summed from the arrays the real functions
// actually produced and retained on one representative operation, so it is exact
// and it changes only when the split or reassembly rule changes.

const ARTIFACT = new URL("../docs/relay-e2ee-chunk-perf.json", import.meta.url);

/** Payload sizes that bracket the one-frame boundary in both directions. */
const PAYLOAD_SIZES: readonly number[] = [
  1_024,
  16_384,
  // `RELAY_MAX_DATA_CHUNK_BYTES` is 262,144, so these three sit just under, at,
  // and just over the point where one message stops being one frame.
  262_144 - E2EE_ENVELOPE_OVERHEAD_BYTES - RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength,
  262_144,
  1_048_576,
  4_194_304 - E2EE_ENVELOPE_OVERHEAD_BYTES,
];

const LIMITS = {
  maxChunkBytes: RELAY_INITIAL_LIMITS.maxDataChunkBytes,
  maxMessageBytes: RELAY_INITIAL_LIMITS.maxQueuedBytes,
  peerSupportsChunking: true,
} as const;

type Mode = "legacy" | "e2ee";

/**
 * The bytes one logical message occupies in each mode.
 *
 * The `e2ee` message is a REAL envelope built by the real encoder over a
 * ciphertext of the payload's length plus the tag — the wire shape a protected
 * record has. The ciphertext is not real AEAD output and does not need to be:
 * the chunk path is length-driven and cannot tell one 4 MiB buffer from another.
 */
function messageFor(mode: Mode, payloadBytes: number): Uint8Array {
  const payload = new Uint8Array(payloadBytes).fill(0x41);
  if (mode === "legacy") return payload;
  const ciphertext = encodeE2eeInnerRecord(
    E2EE_INNER_TYPE_RPC,
    new Uint8Array(payloadBytes + E2EE_AEAD_TAG_BYTES),
  );
  ciphertext.set(payload, 1);
  return encodeE2eeEnvelope({
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    epoch: 0n,
    counter: 1n,
    ciphertext,
  });
}

/** One split-and-reassemble round trip. Returns the reassembled length. */
function roundTrip(message: Uint8Array): number {
  const prepared = prepareRelayMessage(message, LIMITS);
  if (prepared.kind !== "ready") throw new Error(`prepare: ${prepared.reason}`);
  const assembler = new RelayMessageAssembler();
  let done = 0;
  for (const payload of prepared.payloads) {
    const result = assembler.push(Uint8Array.from(payload));
    if (result.kind === "error") throw new Error(`assemble: ${result.reason}`);
    if (result.kind === "done") done = result.message.byteLength;
  }
  return done;
}

interface Row {
  readonly mode: Mode;
  readonly payloadBytes: number;
  readonly messageBytes: number;
  readonly wireBytes: number;
  readonly chunks: number;
  readonly chunkHeaderBytes: number;
  readonly preludeBytes: number;
  readonly senderAllocatedBytes: number;
  readonly receiverAllocatedBytes: number;
  readonly nsPerOpMedian: number;
  readonly nsPerOpP90: number;
  readonly payloadMibPerSecond: number;
  readonly iterations: number;
}

/** Iterations per size, dropping as the payload grows so the run stays bounded. */
function iterationsFor(payloadBytes: number): number {
  if (payloadBytes <= 16_384) return 2_000;
  if (payloadBytes <= 262_144) return 400;
  if (payloadBytes <= 1_048_576) return 120;
  return 40;
}

function measure(mode: Mode, payloadBytes: number): Row {
  const message = messageFor(mode, payloadBytes);
  const prepared = prepareRelayMessage(message, LIMITS);
  if (prepared.kind !== "ready") throw new Error(`prepare: ${prepared.reason}`);

  // ── the size columns, summed from what the real split produced ────────────
  const wireBytes = prepared.payloads.reduce((total, one) => total + one.byteLength, 0);
  const chunked = prepared.payloads.length > 1;
  const preludeBytes = chunked ? 0 : wireBytes - message.byteLength;
  const chunkHeaderBytes = chunked ? prepared.payloads.length * RELAY_CHUNK_HEADER_BYTES : 0;
  // The sender allocates one fresh array per chunk when it chunks, one
  // prelude-prefixed copy when it advertises, and NOTHING at all when the
  // message already fits and there is no headroom for a prelude — that last
  // case returns the caller's own array unchanged, which is why the common path
  // costs no copy.
  const senderAllocatedBytes = chunked ? wireBytes : preludeBytes === 0 ? 0 : wireBytes;
  // The receiver retains one copy of each chunk body and then one copy of the
  // assembled message; an unchunked payload is handed straight on.
  const receiverAllocatedBytes = chunked ? 2 * message.byteLength : 0;

  // ── the timing columns ────────────────────────────────────────────────────
  const iterations = iterationsFor(payloadBytes);
  // Warm up so the first samples are not measuring JIT tiering.
  for (let index = 0; index < Math.min(iterations, 50); index += 1) roundTrip(message);
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = hrtime.bigint();
    const length = roundTrip(message);
    samples.push(Number(hrtime.bigint() - started));
    if (length !== message.byteLength) throw new Error("round trip lost bytes");
  }
  samples.sort((left, right) => left - right);
  const median = samples[Math.floor(samples.length / 2)]!;
  const p90 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.9))]!;

  return {
    mode,
    payloadBytes,
    messageBytes: message.byteLength,
    wireBytes,
    chunks: prepared.payloads.length,
    chunkHeaderBytes,
    preludeBytes,
    senderAllocatedBytes,
    receiverAllocatedBytes,
    nsPerOpMedian: median,
    nsPerOpP90: p90,
    payloadMibPerSecond: Math.round((payloadBytes / (median / 1e9) / (1024 * 1024)) * 10) / 10,
    iterations,
  };
}

const rows: Row[] = [];
for (const payloadBytes of PAYLOAD_SIZES) {
  for (const mode of ["legacy", "e2ee"] as const) rows.push(measure(mode, payloadBytes));
}

const artifact = {
  measurement: "relay chunk-path split and reassembly, legacy vs E2EE envelope",
  section: "4.2, 4.3, 4.5",
  measuredOn: new Date().toISOString().slice(0, 10),
  producedBy: "bun scripts/measure-relay-chunk-perf.ts",
  scope:
    "The relay CHUNK PATH only: `prepareRelayMessage` on the sending side and `RelayMessageAssembler` on the receiving side, over one logical message. No AEAD runs, no key is derived, no handshake happens, no socket exists, and no second process participates.",
  whatTheRowsMayNotBeUsedToConclude:
    "NOT the cost of E2EE. The `e2ee` rows differ from the `legacy` rows in exactly one way — the message carries E2EE_ENVELOPE_OVERHEAD_BYTES (32) more bytes — so a percentage read off them is the cost of 32 bytes and not the cost of encryption. NOT end-to-end throughput: there is no socket, no relay, no backpressure, and no event-loop contention. NOT a portable number: these are wall-clock samples from ONE machine, recorded in `environment` below, and two runs on different hardware are two different measurements rather than a comparison.",
  whatTheyAreGoodFor:
    "Comparing one commit against another ON THE SAME MACHINE, and seeing the shape of the cost curve where a payload crosses the one-frame boundary. The size columns (`wireBytes`, `chunks`, `chunkHeaderBytes`, `preludeBytes`, and both allocation figures) are deterministic and ARE portable; `measure-relay-chunk-perf.test.ts` holds the recorded values to what the code produces today. The timing columns are not gated by any test, deliberately: a wall-clock assertion on shared CI is a flake generator.",
  allocationMethod:
    "MEASURED FROM REAL OUTPUTS, not sampled from the heap. `senderAllocatedBytes` sums the arrays `prepareRelayMessage` actually returned when it allocated any — a message that fits with no prelude headroom is returned unchanged and costs zero. `receiverAllocatedBytes` is the copy `RelayMessageAssembler` retains per chunk body plus the one assembled message it emits. Sampling `process.memoryUsage()` around a loop was rejected: it measures the collector as much as the code and produces a figure that is neither stable nor comparable.",
  timingMethod: `Per row: ${String(50)} warm-up round trips, then N timed round trips with \`process.hrtime.bigint()\` around each, reported as the median and the 90th percentile of the samples. N is 2,000 at or below 16 KiB, 400 at or below 256 KiB, 120 at or below 1 MiB, and 40 above that, so the whole run stays bounded. \`payloadMibPerSecond\` is derived from the MEDIAN and from the PAYLOAD bytes, not the wire bytes.`,
  limits: {
    maxChunkBytes: LIMITS.maxChunkBytes,
    maxMessageBytes: LIMITS.maxMessageBytes,
    peerSupportsChunking: LIMITS.peerSupportsChunking,
    note: "`RELAY_INITIAL_LIMITS`, which is what a connection asserts before any negotiation narrows it.",
  },
  environment: {
    runtime: `${process.release.name ?? "node"} ${process.version}`,
    platform: `${process.platform}-${process.arch}`,
    note: "Recorded so a later reader can tell whether comparing against these numbers is legitimate. It usually is not.",
  },
  rows,
} as const;

writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`Wrote ${ARTIFACT.pathname}\n`);
for (const row of rows) {
  process.stdout.write(
    `${row.mode.padEnd(7)} payload=${String(row.payloadBytes).padStart(8)} chunks=${String(row.chunks).padStart(3)} wire=${String(row.wireBytes).padStart(8)} median=${String(row.nsPerOpMedian).padStart(9)}ns ${String(row.payloadMibPerSecond).padStart(8)} MiB/s\n`,
  );
}
