import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { hrtime } from "node:process";
import { fileURLToPath } from "node:url";

import { RELAY_INITIAL_LIMITS } from "@ryco/contracts/relay";
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

import { observeRoundTrip, type ObservedRoundTrip } from "./lib/relay-chunk-observation.ts";

// CHUNK-PATH PERFORMANCE MEASUREMENT — docs/relay-e2ee-protocol.md §4.2, §4.3, §4.5.
//
// WHAT THIS MEASURES. The relay CHUNK PATH only: `prepareRelayMessage` on the
// sending side and `RelayMessageAssembler` on the receiving side, for one
// logical message, at representative payload sizes, with and without the §3.3
// envelope wrapped around the payload. NOTHING ELSE IS INSIDE THE TIMED REGION —
// in particular no harness-side copy of the wire payload, which an earlier
// version of this script performed per chunk and which dominated every
// unchunked row (80–98% of the recorded duration was a `Uint8Array.from` that
// neither function under test makes). It is not needed: `splitRelayMessage`
// hands back a FRESH array per chunk and the advertising path a fresh
// prelude-prefixed copy, so the assembler's `body.fill(0)` never reaches
// anything the next iteration reads, and the unchunked path is not zeroed at all.
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
//   • NOT "E2EE is faster", either — the misreading in the other direction, and
//     the one an earlier version of this artifact actively invited. It measured
//     the two modes as separate blocks with a per-row warm-up, so the FIRST row
//     in the process absorbed JIT tiering every later row inherited, and the
//     small-payload rows reported which mode ran first rather than which is
//     faster: swapping the loop order moved the identical pair of numbers to the
//     opposite mode. Both modes are warmed globally and then INTERLEAVED sample
//     by sample below, and `nsPerOpRoundSpreadPercent` states how large a
//     difference has to be before it is a difference at all.
//   • NOT end-to-end throughput. There is no socket, no relay, no event loop
//     contention, no backpressure, and no second process. Every byte moves inside
//     one function call.
//   • NOT a regression gate. Nothing in the test suite asserts a wall-clock
//     threshold from this file, deliberately: a timing assertion on shared CI is
//     a flake generator. `measure-relay-chunk-perf.test.ts` checks the recorded
//     artifact's SHAPE and its size-only columns — chunk counts, wire bytes, and
//     both allocation figures, which it re-observes from the real objects — and
//     nothing else.
//   • NOT comparable across machines OR across runtimes. The `environment` block
//     records the ENGINE the numbers were produced on — `bun` when Bun ran them,
//     which is what `producedBy` invokes and which `process.version` alone would
//     hide, because Bun reports an emulated Node version there.
//
// WHAT THE NUMBERS ARE GOOD FOR: comparing one commit against another ON THE SAME
// MACHINE AND THE SAME RUNTIME, by a margin larger than this run's own
// round-to-round spread, and seeing the shape of the cost curve as a payload
// crosses the one-frame boundary.
//
// ALLOCATION IS OBSERVED FROM THE REAL OBJECTS. Sampling `process.memoryUsage()`
// around a loop measures the garbage collector's mood as much as the code, and
// the resulting number is neither stable nor comparable — but a hand-written
// closed form over the sizes is worse, because it keeps reporting the old answer
// after the behavior it models changes. So the sender's figure is summed from
// the returned arrays that are NOT IDENTICAL to the message handed in (identity
// is what proves the zero-copy path zero-copy), and the receiver's is summed
// from what the assembler reports holding through `heldBytes` plus the message
// it emitted, with the emitted message checked for whether it is a VIEW into the
// last payload or a fresh array.

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
const MODES: readonly Mode[] = ["legacy", "e2ee"];

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

/**
 * One split-and-reassemble round trip, and nothing else. Returns the reassembled
 * length so the caller can prove the trip really completed.
 */
function roundTrip(message: Uint8Array): number {
  const prepared = prepareRelayMessage(message, LIMITS);
  if (prepared.kind !== "ready") throw new Error(`prepare: ${prepared.reason}`);
  const assembler = new RelayMessageAssembler();
  let done = 0;
  for (const payload of prepared.payloads) {
    const result = assembler.push(payload);
    if (result.kind === "error") throw new Error(`assemble: ${result.reason}`);
    if (result.kind === "done") done = result.message.byteLength;
  }
  return done;
}

interface Row extends ObservedRoundTrip {
  readonly mode: Mode;
  readonly payloadBytes: number;
  readonly messageBytes: number;
  readonly nsPerOpMedian: number;
  readonly nsPerOpP90: number;
  readonly nsPerOpRoundMedians: readonly number[];
  readonly nsPerOpRoundMin: number;
  readonly nsPerOpRoundSpreadPercent: number;
  readonly nsPerOpRoundIqrPercent: number;
  readonly payloadMibPerSecond: number;
  readonly roundTripsPerSample: number;
  readonly samples: number;
  readonly roundTrips: number;
}

// ─── the timing method ───────────────────────────────────────────────────────

/**
 * Round trips run per (mode, size) BEFORE ANY ROW IS SAMPLED.
 *
 * Global rather than per row, and unconditional rather than `Math.min`-ed
 * against the iteration count: the earlier per-row warm-up let the first row
 * measured in the process pay for tiering that every later row inherited, which
 * is a bias with the size of the effect the rows report.
 */
const WARMUP_ROUND_TRIPS = 50;
/**
 * Rounds of sampling, each in a SEPARATE PROCESS, so run-to-run spread is
 * measured rather than assumed.
 *
 * Separate rather than five passes inside one process because the spread that
 * matters to a reader following this artifact's own advice — rerun on the same
 * machine, compare — is process-to-process: a fresh heap, a fresh JIT, and a
 * fresh allocator state each time. Five passes in one process measure drift
 * within a warmed process and read as several times more stable than the
 * comparison actually is.
 */
const ROUNDS = 5;
/** Samples per round per row. Each sample times a BATCH, never one round trip. */
const SAMPLES_PER_ROUND = 25;
/**
 * How long one sample must span.
 *
 * `hrtime.bigint()` on Apple Silicon advances in 125/3 ns ticks, so a sample of
 * a single 1 KiB round trip is six to nine ticks and a ±1-tick quantum is ±11%
 * to ±17% — larger than any difference these rows report. Batching until a
 * sample spans ~200 µs puts every row at thousands of ticks, where quantization
 * is below 0.05%.
 */
const TARGET_SAMPLE_NS = 200_000;
/** A ceiling on the batch, so a pathologically fast row cannot run away. */
const MAX_BATCH = 1 << 20;

/**
 * Bun's own version when Bun is the engine, `undefined` under Node.
 *
 * Read off `globalThis` rather than the `Bun` global directly, because this file
 * is typechecked without Bun's ambient types — and read at all because
 * `process.release.name` is "node" and `process.version` an emulated Node
 * version under Bun, so the two fields a benchmark usually records would name
 * V8 for numbers JavaScriptCore produced.
 */
const bunVersion: string | undefined = (
  globalThis as { readonly Bun?: { readonly version?: string } }
).Bun?.version;

/** The smallest nonzero delta this machine's clock reports, in nanoseconds. */
function timerQuantumNs(): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const started = hrtime.bigint();
    let delta = 0;
    while (delta === 0) delta = Number(hrtime.bigint() - started);
    if (delta < smallest) smallest = delta;
  }
  return smallest;
}

const median = (sorted: readonly number[]): number => sorted[Math.floor(sorted.length / 2)]!;

/**
 * Grow a batch by doubling until the MEDIAN of several timed batches spans
 * `TARGET_SAMPLE_NS`.
 *
 * The median rather than one attempt because a single cold attempt at a 256 KiB
 * payload can take longer than the whole target on page faults alone, and a
 * calibration that believed it would settle on a batch of one.
 *
 * Calibrated ONCE, in the parent, and then handed to every round: batching an
 * operation that ALLOCATES changes what is measured, because a batch of 32 has
 * 32 live 256 KiB buffers where a batch of 1 hands the same buffer back to the
 * allocator each time. Two rounds that settled on different batches would not be
 * two samples of one measurement, and the run-to-run spread would be reporting
 * the calibration rather than the machine.
 */
function calibrateBatch(message: Uint8Array): number {
  let batch = 1;
  for (;;) {
    const attempts: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = hrtime.bigint();
      for (let index = 0; index < batch; index += 1) roundTrip(message);
      attempts.push(Number(hrtime.bigint() - started));
    }
    attempts.sort((left, right) => left - right);
    if (median(attempts) >= TARGET_SAMPLE_NS || batch >= MAX_BATCH) return batch;
    batch *= 2;
  }
}

// ─── the run ─────────────────────────────────────────────────────────────────

interface Cell {
  readonly mode: Mode;
  readonly payloadBytes: number;
  readonly message: Uint8Array;
}

const cells: readonly Cell[] = PAYLOAD_SIZES.flatMap((payloadBytes) =>
  MODES.map((mode) => ({ mode, payloadBytes, message: messageFor(mode, payloadBytes) })),
);

interface RoundResult {
  readonly quantumNs: number;
  /** One entry per cell, in `cells` order. */
  readonly cells: readonly { readonly samples: readonly number[] }[];
}

/** Warm every cell globally, before any cell is sampled or calibrated. */
function warmUp(): void {
  for (const cell of cells) {
    for (let index = 0; index < WARMUP_ROUND_TRIPS; index += 1) roundTrip(cell.message);
  }
}

/** One round, at the batches the parent calibrated. */
function measureRound(batches: readonly number[]): RoundResult {
  warmUp();
  const quantumNs = timerQuantumNs();
  const samples: number[][] = cells.map(() => []);
  // INTERLEAVED SAMPLING: the two modes of one size are measured next to each
  // other inside one loop, with their order alternating per sample, so neither
  // mode can inherit an advantage from having been measured first.
  for (let sample = 0; sample < SAMPLES_PER_ROUND; sample += 1) {
    for (let index = 0; index < cells.length; index += 2) {
      const order = sample % 2 === 0 ? [index, index + 1] : [index + 1, index];
      for (const at of order) {
        const batch = batches[at]!;
        const message = cells[at]!.message;
        const started = hrtime.bigint();
        for (let iteration = 0; iteration < batch; iteration += 1) roundTrip(message);
        samples[at]!.push(Number(hrtime.bigint() - started) / batch);
      }
    }
  }
  return { quantumNs, cells: samples.map((one) => ({ samples: one })) };
}

// A CHILD PROCESS measures exactly one round, at the batches the parent
// calibrated, and reports it. The parent below spawns `ROUNDS` of them.
const ROUND_BATCHES = process.env.RELAY_CHUNK_PERF_BATCHES;
if (ROUND_BATCHES !== undefined) {
  process.stdout.write(JSON.stringify(measureRound(JSON.parse(ROUND_BATCHES) as number[])));
  process.exit(0);
}

warmUp();
const BATCHES = cells.map((cell) => calibrateBatch(cell.message));
const rounds: RoundResult[] = [];
for (let round = 0; round < ROUNDS; round += 1) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    encoding: "utf8",
    env: { ...process.env, RELAY_CHUNK_PERF_BATCHES: JSON.stringify(BATCHES) },
  });
  if (child.status !== 0) {
    throw new Error(`round ${String(round)} failed: ${child.stderr.slice(0, 400)}`);
  }
  rounds.push(JSON.parse(child.stdout) as RoundResult);
}
const QUANTUM_NS = Math.min(...rounds.map((round) => round.quantumNs));

const rows: Row[] = [];
for (const [index, cell] of cells.entries()) {
  const perRound = rounds.map((round) => round.cells[index]!);
  const all = perRound.flatMap((round) => round.samples).toSorted((left, right) => left - right);
  // Rounded FIRST, then reduced: every dispersion field below is derived from
  // the round medians the artifact actually publishes, so a reader — and the
  // drift guard — can recompute them from the recorded numbers alone.
  const rounded = perRound.map((round) =>
    Math.round(median(round.samples.toSorted((left, right) => left - right))),
  );
  const ordered = rounded.toSorted((left, right) => left - right);
  const lowest = ordered[0]!;
  const highest = ordered[ordered.length - 1]!;
  // The interquartile range over the round medians, beside the full range: one
  // descheduled process moves the range and not the IQR, and a row where the two
  // differ by a lot is a row whose spread is one bad round rather than a floor.
  const quartileLow = ordered[Math.floor((ordered.length - 1) * 0.25)]!;
  const quartileHigh = ordered[Math.ceil((ordered.length - 1) * 0.75)]!;
  const nsPerOpMedian = median(all);
  // Three significant figures. The underlying sample is a wall-clock duration on
  // a loaded machine; publishing five digits of a number whose round-to-round
  // spread is in the percent range states a precision the measurement does not
  // have.
  const mib = cell.payloadBytes / (nsPerOpMedian / 1e9) / (1024 * 1024);
  rows.push({
    mode: cell.mode,
    payloadBytes: cell.payloadBytes,
    messageBytes: cell.message.byteLength,
    ...observeRoundTrip(cell.message, LIMITS),
    nsPerOpMedian: Math.round(nsPerOpMedian),
    nsPerOpP90: Math.round(all[Math.min(all.length - 1, Math.floor(all.length * 0.9))]!),
    nsPerOpRoundMedians: rounded,
    nsPerOpRoundMin: lowest,
    nsPerOpRoundSpreadPercent: Math.round(((highest - lowest) / lowest) * 1000) / 10,
    nsPerOpRoundIqrPercent: Math.round(((quartileHigh - quartileLow) / quartileLow) * 1000) / 10,
    payloadMibPerSecond: Number(mib.toPrecision(3)),
    roundTripsPerSample: BATCHES[index]!,
    samples: all.length,
    roundTrips: perRound.reduce(
      (total, round) => total + BATCHES[index]! * round.samples.length + WARMUP_ROUND_TRIPS,
      0,
    ),
  });
}

const widestSpread = Math.max(...rows.map((row) => row.nsPerOpRoundSpreadPercent));

const artifact = {
  measurement: "relay chunk-path split and reassembly, legacy vs E2EE envelope",
  section: "4.2, 4.3, 4.5",
  measuredOn: new Date().toISOString().slice(0, 10),
  producedBy: "bun scripts/measure-relay-chunk-perf.ts",
  scope:
    "The relay CHUNK PATH only: `prepareRelayMessage` on the sending side and `RelayMessageAssembler` on the receiving side, over one logical message. Nothing else is inside the timed region — in particular no harness-side copy of the wire payload. No AEAD runs, no key is derived, no handshake happens, no socket exists, and no second process participates.",
  whatTheRowsMayNotBeUsedToConclude:
    "NOT the cost of E2EE. The `e2ee` rows differ from the `legacy` rows in exactly one way — the message carries E2EE_ENVELOPE_OVERHEAD_BYTES (32) more bytes — so a percentage read off them is the cost of 32 bytes and not the cost of encryption. NOT `E2EE is faster` either: the e2ee message is strictly larger and does strictly more work, so a row where it reads faster is reading noise, and `nsPerOpRoundSpreadPercent` on each row says how much noise there is. A DIFFERENCE SMALLER THAN THAT SPREAD IS NOT A DIFFERENCE. NOT a throughput, on the rows that copy nothing: where `senderAllocatedBytes` and `receiverAllocatedBytes` are both zero the chunk path moves no bytes at all — it hands one array along — so `payloadMibPerSecond` there is payload size over a pointer pass and not a rate anything sustains. NOT end-to-end throughput anywhere: there is no socket, no relay, no backpressure, and no event-loop contention. NOT a portable number: these are wall-clock samples from ONE machine on ONE runtime, both recorded in `environment` below, and two runs on different hardware or different engines are two different measurements rather than a comparison.",
  whatTheyAreGoodFor: `Comparing one commit against another ON THE SAME MACHINE and the same runtime, BY A MARGIN LARGER THAN THIS RUN'S OWN RUN-TO-RUN SPREAD — the widest such spread here is ${String(widestSpread)}%, and each row carries its own in \`nsPerOpRoundSpreadPercent\` alongside the ${String(ROUNDS)} round medians it was computed from. Those rounds ran in ${String(ROUNDS)} SEPARATE PROCESSES, so the spread is the one a reader following this advice actually faces rather than drift inside one warmed process. Anything under a row's spread is noise, in either direction. Also: seeing the shape of the cost curve where a payload crosses the one-frame boundary. The size columns (\`wireBytes\`, \`chunks\`, \`chunkHeaderBytes\`, \`preludeBytes\`, and both allocation figures) are deterministic and ARE portable; \`measure-relay-chunk-perf.test.ts\` re-observes them from the real objects and holds the recorded values to what the code does today. The timing columns are not gated by any test, deliberately: a wall-clock assertion on shared CI is a flake generator.`,
  allocationMethod:
    "OBSERVED FROM THE REAL OBJECTS, not sampled from the heap and not modelled by a formula. `senderAllocatedBytes` sums the arrays `prepareRelayMessage` returned that are NOT IDENTICAL to the message it was handed — `senderReturnedCallerArray` records that identity directly, and it is what makes the fitting path a zero-copy path. `receiverAllocatedBytes` is summed from the assembler's own `heldBytes` accessor across the pushes plus the message it emitted, counted only when `receiverEmittedIsViewOfPayload` is false; `roundTripPreservesEveryByte` records that the message survives even though the assembler zeroes each chunk body it consumes, which is only possible because it copied them. A closed form over the sizes was REJECTED: it keeps reporting the old answer after the behavior it models changes, and a drift guard that re-derived the same expression could never catch it.",
  timingMethod: `${String(ROUNDS)} rounds in ${String(ROUNDS)} SEPARATE PROCESSES, each round: ${String(WARMUP_ROUND_TRIPS)} warm-up round trips per (mode, size) BEFORE ANY ROW IS SAMPLED — globally, and unconditionally rather than capped at the iteration count, so no row inherits another row's JIT tiering — then ${String(SAMPLES_PER_ROUND)} samples per row, with the two modes of each size INTERLEAVED inside one loop and their order alternating per sample. Each sample times a BATCH of round trips rather than one, sized per row ONCE in the parent — by doubling until the median of five timed batches spans at least ${String(TARGET_SAMPLE_NS)} ns — and then held fixed for every round, because batching an operation that ALLOCATES changes what is measured and two rounds at different batches would not be two samples of one thing; \`roundTripsPerSample\` records the batch. This machine's \`process.hrtime.bigint()\` quantum measured ${String(Math.round(QUANTUM_NS * 100) / 100)} ns, so at ${String(TARGET_SAMPLE_NS)} ns a sample spans roughly ${String(Math.round(TARGET_SAMPLE_NS / QUANTUM_NS))} ticks and quantization is negligible; timing single round trips would have put the smallest rows at fewer than ten ticks, where one tick is a double-digit percentage. \`nsPerOpMedian\` and \`nsPerOpP90\` are over all ${String(ROUNDS * SAMPLES_PER_ROUND)} per-operation samples; \`nsPerOpRoundMedians\` is one median per process, \`nsPerOpRoundMin\` the lowest of them, \`nsPerOpRoundSpreadPercent\` their full range over that minimum, and \`nsPerOpRoundIqrPercent\` their interquartile range over its own lower quartile. Where those last two differ sharply the spread is one descheduled process rather than a floor, and \`nsPerOpRoundMin\` is the statistic to compare — the rows that allocate a fresh ~256 KiB buffer per operation behave that way here. \`payloadMibPerSecond\` is derived from the MEDIAN and from the PAYLOAD bytes, not the wire bytes, and is reported to three significant figures because that is what the underlying sample supports.`,
  limits: {
    maxChunkBytes: LIMITS.maxChunkBytes,
    maxMessageBytes: LIMITS.maxMessageBytes,
    peerSupportsChunking: LIMITS.peerSupportsChunking,
    note: "`RELAY_INITIAL_LIMITS`, which is what a connection asserts before any negotiation narrows it.",
  },
  environment: {
    // THE ENGINE, not `process.version`. Under Bun, `process.release.name` is
    // "node" and `process.version` is an emulated Node version, so recording
    // those would name V8 for numbers JavaScriptCore produced — and a later
    // reader comparing against a genuine Node run of the same version would be
    // comparing two engines while the field that exists to prevent exactly that
    // told them it was fine.
    runtime: bunVersion === undefined ? `node ${process.version}` : `bun ${bunVersion}`,
    emulatedNodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    timerQuantumNs: Math.round(QUANTUM_NS * 100) / 100,
    note: "Recorded so a later reader can tell whether comparing against these numbers is legitimate. It usually is not: a different machine, a different engine, or a margin under the row's own spread all make the comparison meaningless.",
  },
  rows,
} as const;

writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
// Handed to the repository formatter rather than left in `JSON.stringify`'s
// layout: `fmt:check` runs over `docs/` too, so an artifact this script wrote
// and nobody formatted fails the gate on the next push. Failing loudly here is
// the point — a silently unformatted artifact is a broken gate discovered later.
const formatted = spawnSync("bunx", ["vp", "fmt", fileURLToPath(ARTIFACT)], { encoding: "utf8" });
if (formatted.status !== 0) {
  throw new Error(`formatting the artifact failed: ${formatted.stderr.slice(0, 400)}`);
}
process.stdout.write(`Wrote ${ARTIFACT.pathname}\n`);
for (const row of rows) {
  process.stdout.write(
    `${row.mode.padEnd(7)} payload=${String(row.payloadBytes).padStart(8)} chunks=${String(row.chunks).padStart(3)} wire=${String(row.wireBytes).padStart(8)} median=${String(row.nsPerOpMedian).padStart(9)}ns ±${String(row.nsPerOpRoundSpreadPercent).padStart(5)}% ${String(row.payloadMibPerSecond).padStart(8)} MiB/s\n`,
  );
}
