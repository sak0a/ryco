import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { RELAY_CHUNK_HEADER_BYTES, RELAY_INITIAL_LIMITS } from "@ryco/contracts/relay";
import { E2EE_ENVELOPE_OVERHEAD_BYTES } from "@ryco/shared/relayE2eeConstants";
import { RelayMessageAssembler, prepareRelayMessage } from "@ryco/shared/relayMessageChunks";

// THE DRIFT GUARD FOR THE CHUNK-PATH MEASUREMENT ARTIFACT.
//
// `docs/relay-e2ee-chunk-perf.json` is a checked-in measurement, and a checked-in
// measurement rots in two different ways that need two different answers:
//
//   • ITS SIZE COLUMNS CAN GO STALE, and they are deterministic — the chunk
//     count, the wire bytes, the header and prelude overhead, and both
//     allocation figures follow from the split rule and nothing else. Those ARE
//     recomputed here, from the real `prepareRelayMessage` and the real
//     `RelayMessageAssembler`, and held to the recorded values. A change to the
//     split rule that nobody re-measured fails here.
//   • ITS TIMING COLUMNS CANNOT BE GATED. A wall-clock assertion on shared CI is
//     a flake generator; this program has already lost hours to load-induced
//     false failures. So NOTHING here asserts a duration, a throughput, or a
//     ratio between two rows' durations, and that is a deliberate choice rather
//     than an oversight. What IS asserted is that the artifact still carries the
//     methodology and the disclaimers a reader needs in order not to over-read
//     the numbers — because a perf number without its methodology is worse than
//     no number at all.

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
  readonly receiverAllocatedBytes: number;
  readonly nsPerOpMedian: number;
  readonly nsPerOpP90: number;
  readonly payloadMibPerSecond: number;
  readonly iterations: number;
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
    readonly platform: string;
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
    // cost of the protocol rather than the cost of the chunk layer.
    expect(ARTIFACT_JSON.scope).toContain("No AEAD runs");
    expect(ARTIFACT_JSON.scope).toContain("no socket");
    // The single most available misreading is "E2EE costs X%", and the artifact
    // has to close it in as many words.
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain("NOT the cost of E2EE");
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain(
      "E2EE_ENVELOPE_OVERHEAD_BYTES",
    );
    expect(ARTIFACT_JSON.whatTheRowsMayNotBeUsedToConclude).toContain("ONE machine");
    // …and it has to say which columns are portable and which are not, because
    // the artifact mixes both kinds of number in one table.
    expect(ARTIFACT_JSON.whatTheyAreGoodFor).toContain("SAME MACHINE");
    expect(ARTIFACT_JSON.whatTheyAreGoodFor).toContain("deterministic");
    expect(ARTIFACT_JSON.allocationMethod).toContain("MEASURED FROM REAL OUTPUTS");
    expect(ARTIFACT_JSON.timingMethod).toContain("median");
    // The environment is what makes a later comparison checkable at all.
    expect(ARTIFACT_JSON.environment.runtime.length).toBeGreaterThan(3);
    expect(ARTIFACT_JSON.environment.platform).toContain("-");
    expect(ARTIFACT_JSON.limits.maxChunkBytes).toBe(RELAY_INITIAL_LIMITS.maxDataChunkBytes);
    expect(ARTIFACT_JSON.limits.maxMessageBytes).toBe(RELAY_INITIAL_LIMITS.maxQueuedBytes);
  });

  it("recomputes every deterministic column from the real chunk path", () => {
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
      // assembler below for a reason that has nothing to do with the sizes under
      // test. No conforming sender emits one — legacy JSON starts `{` or `[` and
      // an envelope starts `E2EE_ENVELOPE_DISCRIMINATOR` — so filling here keeps
      // the round trip on the path the artifact describes.
      const prepared = prepareRelayMessage(new Uint8Array(row.messageBytes).fill(0x41), {
        maxChunkBytes: ARTIFACT_JSON.limits.maxChunkBytes,
        maxMessageBytes: ARTIFACT_JSON.limits.maxMessageBytes,
        peerSupportsChunking: ARTIFACT_JSON.limits.peerSupportsChunking,
      });
      expect(prepared.kind, label).toBe("ready");
      if (prepared.kind !== "ready") continue;
      const wireBytes = prepared.payloads.reduce((total, one) => total + one.byteLength, 0);
      const chunked = prepared.payloads.length > 1;
      expect(row.chunks, label).toBe(prepared.payloads.length);
      expect(row.wireBytes, label).toBe(wireBytes);
      expect(row.chunkHeaderBytes, label).toBe(
        chunked ? prepared.payloads.length * RELAY_CHUNK_HEADER_BYTES : 0,
      );
      expect(row.preludeBytes, label).toBe(chunked ? 0 : wireBytes - row.messageBytes);
      expect(row.senderAllocatedBytes, label).toBe(
        chunked ? wireBytes : row.preludeBytes === 0 ? 0 : wireBytes,
      );
      expect(row.receiverAllocatedBytes, label).toBe(chunked ? 2 * row.messageBytes : 0);

      // …and the round trip really completes, so the allocation columns describe
      // a path that works rather than one that errors out early.
      const assembler = new RelayMessageAssembler();
      let assembled = 0;
      for (const payload of prepared.payloads) {
        const result = assembler.push(Uint8Array.from(payload));
        expect(result.kind, label).not.toBe("error");
        if (result.kind === "done") assembled = result.message.byteLength;
      }
      expect(assembled, label).toBe(row.messageBytes);

      // The timing columns are recorded, never gated. All that is checked is
      // that they are present and positive — a row with a zero duration is a
      // measurement that did not happen.
      expect(row.nsPerOpMedian, label).toBeGreaterThan(0);
      expect(row.nsPerOpP90, label).toBeGreaterThanOrEqual(row.nsPerOpMedian);
      expect(row.iterations, label).toBeGreaterThan(0);
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
    expect(boundary.senderAllocatedBytes).toBeGreaterThan(0);
    expect(boundary.receiverAllocatedBytes).toBeGreaterThan(0);
  });
});
