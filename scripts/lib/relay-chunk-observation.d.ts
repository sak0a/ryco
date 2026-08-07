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
/**
 * Run ONE split-and-reassemble round trip with the real objects instrumented,
 * and report what they did rather than what a formula says they would do.
 */
export declare function observeRoundTrip(
  message: Uint8Array,
  limits: ObservedRoundTripLimits,
): ObservedRoundTrip;
