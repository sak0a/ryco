import { RELAY_CHUNK_HEADER_BYTES } from "@ryco/contracts/relay";
import { RelayMessageAssembler, prepareRelayMessage } from "@ryco/shared/relayMessageChunks";

// WHAT ONE CHUNK-PATH ROUND TRIP ACTUALLY DID — docs/relay-e2ee-protocol.md §4.2.
//
// This module exists so that `scripts/measure-relay-chunk-perf.ts` and its drift
// guard `scripts/measure-relay-chunk-perf.test.ts` share ONE observation of the
// real objects rather than two copies of a formula over the sizes. The
// difference matters: a closed form like `chunked ? 2 * messageBytes : 0` keeps
// reporting the old answer after the behavior it models changes, and a guard
// that re-derives the same expression can never catch that. Everything below is
// read off `prepareRelayMessage`'s return value, `RelayMessageAssembler`'s own
// `heldBytes` accessor, array identity, and the bytes that came out the far end.
//
// It is side-effect free on purpose: importing the measurement script would run
// the measurement.

export interface ObservedRoundTrip {
  readonly wireBytes: number;
  readonly chunks: number;
  readonly chunkHeaderBytes: number;
  readonly preludeBytes: number;
  /** Summed from the returned arrays that are NOT the message handed in. */
  readonly senderAllocatedBytes: number;
  /** Identity: the fitting path hands the caller's own array straight back. */
  readonly senderReturnedCallerArray: boolean;
  /** The assembler's retained bodies plus the message it emitted, if fresh. */
  readonly receiverAllocatedBytes: number;
  /** The most `heldBytes` ever reported — what backpressure would have seen. */
  readonly receiverPeakHeldBytes: number;
  /** Whether the emitted message is a window into the last payload pushed. */
  readonly receiverEmittedIsViewOfPayload: boolean;
  /** The message survives even though the assembler zeroes each body it takes. */
  readonly roundTripPreservesEveryByte: boolean;
}

export interface ObservedRoundTripLimits {
  readonly maxChunkBytes: number;
  readonly maxMessageBytes: number;
  readonly peerSupportsChunking: boolean;
}

/** Whether `view` is a window into `buffer` rather than a fresh allocation. */
function isViewOf(view: Uint8Array, buffer: Uint8Array): boolean {
  return (
    view.buffer === buffer.buffer &&
    view.byteOffset >= buffer.byteOffset &&
    view.byteOffset + view.byteLength <= buffer.byteOffset + buffer.byteLength
  );
}

/**
 * Run ONE split-and-reassemble round trip with the real objects instrumented,
 * and report what they did rather than what a formula says they would do.
 */
export function observeRoundTrip(
  message: Uint8Array,
  limits: ObservedRoundTripLimits,
): ObservedRoundTrip {
  const prepared = prepareRelayMessage(message, limits);
  if (prepared.kind !== "ready") throw new Error(`prepare: ${prepared.reason}`);
  const wireBytes = prepared.payloads.reduce((total, one) => total + one.byteLength, 0);
  const chunked = prepared.payloads.length > 1;

  // The sender's figure, from IDENTITY: an array the caller handed in and got
  // back cost nothing, and that identity is exactly what makes the fitting path
  // a zero-copy path. A `prepareRelayMessage` that started copying that case
  // would change this number and fail the drift guard.
  const senderReturnedCallerArray =
    prepared.payloads.length === 1 && prepared.payloads[0] === message;
  const senderAllocatedBytes = prepared.payloads.reduce(
    (total, one) => total + (one === message ? 0 : one.byteLength),
    0,
  );

  // The receiver's figure, from `heldBytes` — the accessor flow control reads,
  // so it is the assembler's own statement about what it is retaining — plus the
  // message it emitted, counted only when that message is a fresh array rather
  // than a window into the payload it was handed.
  const assembler = new RelayMessageAssembler();
  let retainedBodies = 0;
  let previousHeld = 0;
  let peakHeld = 0;
  let emitted: Uint8Array | undefined;
  let emittedIsView = false;
  for (const payload of prepared.payloads) {
    const result = assembler.push(payload);
    if (result.kind === "error") throw new Error(`assemble: ${result.reason}`);
    if (result.kind === "pending") {
      retainedBodies += assembler.heldBytes - previousHeld;
      previousHeld = assembler.heldBytes;
      peakHeld = Math.max(peakHeld, assembler.heldBytes);
      continue;
    }
    emitted = result.message;
    emittedIsView = isViewOf(result.message, payload);
    // Whatever the emitted message carries beyond what was already held came out
    // of this last payload, and was retained the same way the others were.
    if (!emittedIsView) retainedBodies += result.message.byteLength - previousHeld;
  }
  if (emitted === undefined) throw new Error("round trip never completed");

  // The bytes survive even though the assembler zeroes every chunk body it
  // consumes — which is only possible because it COPIED them. An assembler that
  // started retaining subarrays would emit zeroes and fail here.
  let preserved = emitted.byteLength === message.byteLength;
  if (preserved) {
    for (let index = 0; index < message.byteLength; index += 1) {
      if (emitted[index] !== message[index]) {
        preserved = false;
        break;
      }
    }
  }

  return {
    wireBytes,
    chunks: prepared.payloads.length,
    chunkHeaderBytes: chunked ? prepared.payloads.length * RELAY_CHUNK_HEADER_BYTES : 0,
    preludeBytes: chunked ? 0 : wireBytes - message.byteLength,
    senderAllocatedBytes,
    senderReturnedCallerArray,
    receiverAllocatedBytes: retainedBodies + (emittedIsView ? 0 : emitted.byteLength),
    receiverPeakHeldBytes: peakHeld,
    receiverEmittedIsViewOfPayload: emittedIsView,
    roundTripPreservesEveryByte: preserved,
  };
}
