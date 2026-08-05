import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { RELAY_INITIAL_LIMITS } from "@ryco/contracts/relay";
import { E2EE_ENVELOPE_OVERHEAD_BYTES } from "@ryco/shared/relayE2eeConstants";

import { observeRoundTrip } from "./lib/relay-chunk-observation.ts";

// THE DRIFT GUARD FOR THE CHUNK-PATH MEASUREMENT ARTIFACT.
//
// `docs/relay-e2ee-chunk-perf.json` is a checked-in measurement, and a checked-in
// measurement rots in two different ways that need two different answers:
//
//   • ITS SIZE AND ALLOCATION COLUMNS CAN GO STALE, and they are deterministic —
//     the chunk count, the wire bytes, the header and prelude overhead, and both
//     allocation figures follow from what the real functions do and nothing
//     else. Those ARE recomputed here, through the SAME `observeRoundTrip` the
//     script uses, which reads them off `prepareRelayMessage`'s return value,
//     `RelayMessageAssembler.heldBytes`, array identity, and the bytes that came
//     out the far end. A change to the split rule, to what the sender copies, or
//     to what the assembler retains, that nobody re-measured, fails here.
//
//     THAT SHARED OBSERVATION IS THE POINT. The previous version of this guard
//     asserted `receiverAllocatedBytes === (chunked ? 2 * messageBytes : 0)` and
//     the script computed the recorded value from the identical expression: a
//     tautology over the sizes that could not notice the assembler dropping its
//     copies or `prepareRelayMessage` starting to copy the fitting case. Both
//     sides now derive from behavior, so behavior changing moves the recomputed
//     value away from the recorded one and this fails.
//
//   • ITS TIMING COLUMNS CANNOT BE GATED. A wall-clock assertion on shared CI is
//     a flake generator; this program has already lost hours to load-induced
//     false failures. So NOTHING here asserts a duration, a throughput, or a
//     ratio between two rows' durations, and that is a deliberate choice rather
//     than an oversight. What IS asserted is that the artifact still carries the
//     methodology and the disclaimers a reader needs in order not to over-read
//     the numbers — including the ones this round had to add, because the
//     artifact's own instructions ("rerun on the same machine and compare")
//     invite exactly the reading its dispersion makes unsafe.

const ARTIFACT = new URL("../docs/relay-e2ee-chunk-perf.json", import.meta.url);

interface Row {
  readonly mode: "legacy" | "e2ee";
  readonly payloadBytes: number;
  readonly messageBytes: number;
  readonly wireBytes: number;
  readonly chunks: number;
  readonly chunkHeaderBytes: number;
  readonly preludeBytes: number;
  readonly senderAllocatedBytes: number;
  readonly senderReturnedCallerArray: boolean;
  readonly receiverAllocatedBytes: number;
  readonly receiverPeakHeldBytes: number;
  readonly receiverEmittedIsViewOfPayload: boolean;
  readonly roundTripPreservesEveryByte: boolean;
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

interface Artifact {
  readonly measurement: string;
  readonly section: string;
  readonly measuredOn: string;
  readonly producedBy: string;
  readonly scope: string;
  readonly whatTheRowsMayNotBeUsedToConclude: string;
  readonly whatTheyAreGoodFor: string;
  readonly allocationMethod: string;
  readonly timingMethod: string;
  readonly limits: {
    readonly maxChunkBytes: number;
    readonly maxMessageBytes: number;
    readonly peerSupportsChunking: boolean;
    readonly note: string;
  };
  readonly environment: {
    readonly runtime: string;
    readonly emulatedNodeVersion: string;
    readonly platform: string;
    readonly timerQuantumNs: number;
    readonly note: string;
  };
  readonly rows: readonly Row[];
}

const ARTIFACT_JSON = JSON.parse(new TextDecoder().decode(readFileSync(ARTIFACT))) as Artifact;

describe("relay chunk-path perf artifact", () => {
  it("carries the methodology and the disclaimers, not just numbers", () => {
    expect(ARTIFACT_JSON.producedBy).toBe("bun scripts/measure-relay-chunk-perf.ts");
    expect(ARTIFACT_JSON.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The scope has to say what did NOT run, or a reader takes these for the
    // cost of the protocol rather than the cost of the chunk layer — and it has
    // to say that the harness itself is outside the timed region, because when
    // it was inside it was 80–98% of every unchunked row.
    expect(ARTIFACT_JSON.scope).toContain("No AEAD runs");
    expect(ARTIFACT_JSON.scope).toContain("no socket");
    expect(ARTIFACT_JSON.scope).toContain("no harness-side copy");
    // The single most available misreading is "E2EE costs X%", and the artifact
    // has to close it in as many words…
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain("NOT the cost of E2EE");
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain(
      "E2EE_ENVELOPE_OVERHEAD_BYTES",
    );
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain("ONE machine");
    // …and the misreading in the OTHER direction too. An earlier revision closed
    // "E2EE costs X%" and left "E2EE is faster" open while publishing rows that
    // said exactly that, because of a warm-up order bias.
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain("E2EE is faster");
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain(
      "A DIFFERENCE SMALLER THAN THAT SPREAD IS NOT A DIFFERENCE",
    );
    // …and it has to say which columns are portable and which are not, because
    // the artifact mixes both kinds of number in one table.
    expect(ARTIFACT_JSON.whatTheyAreGoodFor).toContain("SAME MACHINE");
    expect(ARTIFACT_JSON.whatTheyAreGoodFor).toContain("deterministic");
    // The comparison the artifact RECOMMENDS is only safe above the run-to-run
    // spread, so the artifact must name that floor rather than leave a reader to
    // discover it by mistaking noise for a regression.
    expect(ARTIFACT_JSON.whatTheyAreGoodFor).toContain("nsPerOpRoundSpreadPercent");
    expect(ARTIFACT_JSON.whatTheyAreGoodFor).toContain("SEPARATE PROCESSES");
    expect(ARTIFACT_JSON.allocationMethod).toContain("OBSERVED FROM THE REAL OBJECTS");
    expect(ARTIFACT_JSON.allocationMethod).toContain("heldBytes");
    expect(ARTIFACT_JSON.timingMethod).toContain("median");
    // Timer granularity and batching, because the smallest rows used to be six
    // to nine ticks of a 41.7 ns clock while five significant figures were
    // published beside them.
    expect(ARTIFACT_JSON.timingMethod).toContain("quantum");
    expect(ARTIFACT_JSON.timingMethod).toContain("BATCH");
    expect(ARTIFACT_JSON.timingMethod).toContain("INTERLEAVED");
    expect(ARTIFACT_JSON.limits.maxChunkBytes).toBe(RELAY_INITIAL_LIMITS.maxDataChunkBytes);
    expect(ARTIFACT_JSON.limits.maxMessageBytes).toBe(RELAY_INITIAL_LIMITS.maxQueuedBytes);
  });

  it("names the engine the numbers came from, not the one it emulates", () => {
    // THE FIELD THAT EXISTS TO MAKE A LATER COMPARISON CHECKABLE. Under Bun,
    // `process.release.name` is "node" and `process.version` is an emulated Node
    // version, so a runtime recorded from those two named V8 for numbers
    // JavaScriptCore produced — and a reader rerunning under genuine Node of
    // that version would have seen a matching `environment` block and believed
    // the comparison legitimate while comparing two engines.
    const environment = ARTIFACT_JSON.environment;
    const invoked = ARTIFACT_JSON.producedBy.split(" ")[0];
    expect(invoked).toBeDefined();
    expect(environment.runtime.startsWith(`${String(invoked)} `)).toBe(true);
    expect(environment.runtime).not.toBe(`node ${environment.emulatedNodeVersion}`);
    expect(environment.platform).toContain("-");
    // The timer's own resolution, so a reader can see how many ticks a row is.
    expect(environment.timerQuantumNs).toBeGreaterThan(0);
    expect(environment.note.length).toBeGreaterThan(40);
  });

  it("re-observes every deterministic column from the real chunk path", () => {
    expect(ARTIFACT_JSON.rows.length).toBeGreaterThan(0);
    // Both modes at every size, so a row cannot be dropped without failing here.
    const sizes = [...new Set(ARTIFACT_JSON.rows.map((row) => row.payloadBytes))];
    expect(ARTIFACT_JSON.rows.length).toBe(sizes.length * 2);

    for (const row of ARTIFACT_JSON.rows) {
      const label = `${row.mode}/${String(row.payloadBytes)}`;
      // The `e2ee` message is the payload plus exactly the §3.3 envelope
      // overhead. If that constant moved and nobody re-measured, this fails.
      expect(row.messageBytes, label).toBe(
        row.mode === "e2ee" ? row.payloadBytes + E2EE_ENVELOPE_OVERHEAD_BYTES : row.payloadBytes,
      );
      // Filled rather than zeroed: an all-NUL buffer is what `isChunkedPayload`
      // reads as a chunk header, so a zeroed message would be refused by the
      // assembler for a reason that has nothing to do with the sizes under test.
      // No conforming sender emits one — legacy JSON starts `{` or `[` and an
      // envelope starts `E2EE_ENVELOPE_DISCRIMINATOR` — so filling here keeps the
      // round trip on the path the artifact describes.
      const observed = observeRoundTrip(new Uint8Array(row.messageBytes).fill(0x41), {
        maxChunkBytes: ARTIFACT_JSON.limits.maxChunkBytes,
        maxMessageBytes: ARTIFACT_JSON.limits.maxMessageBytes,
        peerSupportsChunking: ARTIFACT_JSON.limits.peerSupportsChunking,
      });
      // EVERY observed column at once, so a column can neither drift nor be
      // added to the artifact and left ungated.
      expect(
        {
          wireBytes: row.wireBytes,
          chunks: row.chunks,
          chunkHeaderBytes: row.chunkHeaderBytes,
          preludeBytes: row.preludeBytes,
          senderAllocatedBytes: row.senderAllocatedBytes,
          senderReturnedCallerArray: row.senderReturnedCallerArray,
          receiverAllocatedBytes: row.receiverAllocatedBytes,
          receiverPeakHeldBytes: row.receiverPeakHeldBytes,
          receiverEmittedIsViewOfPayload: row.receiverEmittedIsViewOfPayload,
          roundTripPreservesEveryByte: row.roundTripPreservesEveryByte,
        },
        label,
      ).toEqual(observed);
      // …and the round trip really completes with every byte intact, which is
      // what makes the receiver's figure a figure about a working path.
      expect(observed.roundTripPreservesEveryByte, label).toBe(true);

      // The timing columns are recorded, never gated. All that is checked is
      // that they are present, positive, and internally consistent — a row with
      // a zero duration is a measurement that did not happen, and a row whose
      // dispersion fields disagree with its own round medians is a row whose
      // spread disclosure means nothing.
      expect(row.nsPerOpMedian, label).toBeGreaterThan(0);
      expect(row.nsPerOpP90, label).toBeGreaterThanOrEqual(row.nsPerOpMedian);
      expect(row.roundTripsPerSample, label).toBeGreaterThan(0);
      expect(row.samples, label).toBeGreaterThan(0);
      expect(row.roundTrips, label).toBeGreaterThanOrEqual(row.samples);
      expect(row.nsPerOpRoundMedians.length, label).toBeGreaterThanOrEqual(5);
      expect(row.nsPerOpRoundMin, label).toBe(Math.min(...row.nsPerOpRoundMedians));
      const highest = Math.max(...row.nsPerOpRoundMedians);
      expect(row.nsPerOpRoundSpreadPercent, label).toBe(
        Math.round(((highest - row.nsPerOpRoundMin) / row.nsPerOpRoundMin) * 1000) / 10,
      );
      expect(row.nsPerOpRoundIqrPercent, label).toBeLessThanOrEqual(
        row.nsPerOpRoundSpreadPercent + 0.1,
      );
      // Three significant figures, not five: the underlying sample is a
      // wall-clock duration whose run-to-run spread is in the percent range.
      const digits = String(row.payloadMibPerSecond).replace(/[^1-9]/g, "").length;
      expect(digits, `${label} significant figures`).toBeLessThanOrEqual(3);
    }
  });

  it("carries at least one size where the envelope alone crosses the frame boundary", () => {
    // THE ROW THE MEASUREMENT EXISTS FOR. E2EE adds 32 bytes per record, and
    // there is a payload size at which those 32 bytes are the difference between
    // one unchunked frame — which `prepareRelayMessage` returns UNCHANGED, at
    // zero copy — and two chunks with a header each and a full reassembly copy
    // on the far side. A measurement that never crossed that boundary would show
    // a uniform 32-byte tax and miss the only place the cost is structural.
    const crossings = ARTIFACT_JSON.rows.filter((row) => row.mode === "e2ee" && row.chunks > 1);
    expect(crossings.length, "no e2ee row is chunked").toBeGreaterThan(0);
    const boundary = ARTIFACT_JSON.rows.find(
      (row) =>
        row.mode === "e2ee" &&
        row.chunks > 1 &&
        ARTIFACT_JSON.rows.some(
          (other) =>
            other.mode === "legacy" &&
            other.payloadBytes === row.payloadBytes &&
            other.chunks === 1,
        ),
    );
    expect(
      boundary,
      "no payload size where legacy fits one frame and the same payload under E2EE does not",
    ).toBeDefined();
    if (boundary === undefined) return;
    // At that size the allocation columns diverge structurally, and THAT is the
    // comparison worth making — it is a byte count, so it is portable, unlike
    // the durations beside it.
    const legacy = ARTIFACT_JSON.rows.find(
      (row) => row.mode === "legacy" && row.payloadBytes === boundary.payloadBytes,
    );
    expect(legacy).toBeDefined();
    if (legacy === undefined) return;
    expect(legacy.senderAllocatedBytes).toBe(0);
    expect(legacy.receiverAllocatedBytes).toBe(0);
    // …and the reason it is zero is IDENTITY, not arithmetic: the sender handed
    // the caller's own array back and the receiver's message is a window into it.
    expect(legacy.senderReturnedCallerArray).toBe(true);
    expect(legacy.receiverEmittedIsViewOfPayload).toBe(true);
    expect(boundary.senderAllocatedBytes).toBeGreaterThan(0);
    expect(boundary.receiverAllocatedBytes).toBeGreaterThan(0);
    expect(boundary.senderReturnedCallerArray).toBe(false);
    expect(boundary.receiverEmittedIsViewOfPayload).toBe(false);
  });
});
