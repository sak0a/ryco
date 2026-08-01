import {
  RELAY_CHUNK_FLAG_FINAL,
  RELAY_CHUNK_HEADER_BYTES,
  RELAY_CHUNK_MAGIC,
  RELAY_CHUNK_VERSION,
  RELAY_MAX_RPC_MESSAGE_BYTES,
} from "@ryco/contracts/relay";

// Splitting and reassembly for relay messages larger than one data frame.
//
// One RPC response is one relay data frame and a frame is capped, so a response
// above the cap destroys the channel. This splits the message across several
// frames with a header carried INSIDE the opaque `data.payload`, which the relay
// spec forbids the relay from parsing — so nothing on the wire changes and the
// Hub is not involved.
//
// Reassembly happens before the RPC decoder sees anything, so the serializer
// still decodes one complete message. That is what makes this safe where a
// streaming text serializer is not: a multi-byte UTF-8 sequence split across a
// frame boundary would decode incorrectly if each frame were decoded as text on
// arrival. Here the bytes are concatenated first and decoded once.

/**
 * A legacy-compatible chunk-support advertisement. JSON permits exactly these
 * four leading whitespace bytes; repeating them gives us a marker the
 * canonical RPC encoder will never emit while old decoders still accept it.
 */
export const RELAY_CHUNK_CAPABILITY_PRELUDE = Uint8Array.from([
  0x20, 0x09, 0x0d, 0x0a, 0x20, 0x09, 0x0d, 0x0a,
]);

export type ChunkPushResult =
  | { readonly kind: "pending" }
  | { readonly kind: "done"; readonly message: Uint8Array }
  | { readonly kind: "error"; readonly reason: ChunkError };

export type PreparedRelayMessage =
  | { readonly kind: "ready"; readonly payloads: ReadonlyArray<Uint8Array> }
  | { readonly kind: "error"; readonly reason: "message_too_large" | "peer_unsupported" };

export type ChunkError =
  | "bad_header"
  | "message_too_large"
  | "total_mismatch"
  | "overflow"
  | "truncated"
  | "interleaved_legacy";

/**
 * A chunked payload starts with a NUL magic byte. A legacy payload is JSON,
 * which always starts `{` or `[` — never NUL — so old and new senders are
 * distinguishable with no negotiation.
 */
export function isChunkedPayload(bytes: Uint8Array): boolean {
  return bytes.byteLength >= RELAY_CHUNK_HEADER_BYTES && bytes[0] === RELAY_CHUNK_MAGIC;
}

function startsWithChunkCapabilityPrelude(bytes: Uint8Array): boolean {
  if (bytes.byteLength < RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength) return false;
  for (let index = 0; index < RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength; index += 1) {
    if (bytes[index] !== RELAY_CHUNK_CAPABILITY_PRELUDE[index]) return false;
  }
  return true;
}

export function stripRelayChunkCapabilityPrelude(bytes: Uint8Array): {
  readonly advertised: boolean;
  readonly message: Uint8Array;
} {
  if (!startsWithChunkCapabilityPrelude(bytes)) {
    return { advertised: false, message: bytes };
  }
  return {
    advertised: true,
    message: bytes.subarray(RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength),
  };
}

function writeHeader(target: Uint8Array, totalBytes: number, final: boolean): void {
  target[0] = RELAY_CHUNK_MAGIC;
  target[1] = RELAY_CHUNK_VERSION;
  target[2] = final ? RELAY_CHUNK_FLAG_FINAL : 0;
  target[3] = 0;
  // Big-endian uint32, written by hand so this stays free of DataView aliasing
  // concerns when the caller hands us a subarray of a larger buffer.
  target[4] = (totalBytes >>> 24) & 0xff;
  target[5] = (totalBytes >>> 16) & 0xff;
  target[6] = (totalBytes >>> 8) & 0xff;
  target[7] = totalBytes & 0xff;
}

function readTotalBytes(chunk: Uint8Array): number {
  return (
    ((chunk[4]! << 24) >>> 0) + ((chunk[5]! << 16) >>> 0) + ((chunk[6]! << 8) >>> 0) + chunk[7]!
  );
}

/**
 * Split a message into relay-sized payloads.
 *
 * A message that already fits is returned UNCHANGED and unchunked, so the
 * overwhelmingly common case is byte-identical to before this existed and an
 * old receiver keeps working.
 */
export function splitRelayMessage(
  message: Uint8Array,
  maxChunkBytes: number,
): ReadonlyArray<Uint8Array> {
  if (message.byteLength <= maxChunkBytes) return [message];

  const capacity = maxChunkBytes - RELAY_CHUNK_HEADER_BYTES;
  if (capacity <= 0) {
    throw new Error("Relay chunk limit is too small to carry a chunk header.");
  }

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < message.byteLength; offset += capacity) {
    const slice = message.subarray(offset, Math.min(offset + capacity, message.byteLength));
    const chunk = new Uint8Array(RELAY_CHUNK_HEADER_BYTES + slice.byteLength);
    writeHeader(chunk, message.byteLength, offset + slice.byteLength >= message.byteLength);
    chunk.set(slice, RELAY_CHUNK_HEADER_BYTES);
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Prepare one logical message for the relay.
 *
 * Fitting messages advertise chunk support using JSON whitespace whenever
 * there is frame headroom. Oversized messages are emitted only after this
 * channel has observed peer support, keeping independently upgraded peers
 * compatible without changing relay protocol 1.2.
 */
export function prepareRelayMessage(
  message: Uint8Array,
  options: {
    readonly maxChunkBytes: number;
    readonly maxMessageBytes: number;
    readonly peerSupportsChunking: boolean;
  },
): PreparedRelayMessage {
  if (
    !Number.isSafeInteger(options.maxChunkBytes) ||
    options.maxChunkBytes <= 0 ||
    !Number.isSafeInteger(options.maxMessageBytes) ||
    options.maxMessageBytes < 0
  ) {
    throw new TypeError(
      "Relay chunk limits must be positive and message limits non-negative safe integers.",
    );
  }
  if (message.byteLength > options.maxMessageBytes) {
    return { kind: "error", reason: "message_too_large" };
  }
  if (message.byteLength <= options.maxChunkBytes) {
    if (message.byteLength + RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength <= options.maxChunkBytes) {
      const advertised = new Uint8Array(
        RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength + message.byteLength,
      );
      advertised.set(RELAY_CHUNK_CAPABILITY_PRELUDE);
      advertised.set(message, RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength);
      return { kind: "ready", payloads: [advertised] };
    }
    return { kind: "ready", payloads: [message] };
  }
  if (!options.peerSupportsChunking) {
    return { kind: "error", reason: "peer_unsupported" };
  }
  return {
    kind: "ready",
    payloads: splitRelayMessage(message, options.maxChunkBytes),
  };
}

/**
 * Reassembles chunks arriving in order on one channel.
 *
 * `heldBytes` is exposed so flow-control accounting can include buffered bytes:
 * without it a peer can hold megabytes that backpressure cannot see.
 */
export class RelayMessageAssembler {
  #parts: Uint8Array[] = [];
  #received = 0;
  #total = 0;
  #peerSupportsChunking = false;

  /** Bytes currently buffered awaiting completion. */
  get heldBytes(): number {
    return this.#received;
  }

  /**
   * Is a chunked message part-way through reassembly?
   *
   * Stated as its own fact rather than left to `heldBytes > 0`: a layer that has
   * to report an incomplete message at teardown is asking about reassembly
   * state, not about a byte count that happens to agree with it today.
   */
  get incompleteMessage(): boolean {
    return this.#total !== 0;
  }

  get peerSupportsChunking(): boolean {
    return this.#peerSupportsChunking;
  }

  push(payload: Uint8Array): ChunkPushResult {
    if (!isChunkedPayload(payload)) {
      // A legacy payload arriving mid-message means the peer interleaved, or a
      // chunk was lost. Either way the buffer can no longer be trusted.
      if (this.#total !== 0) {
        this.reset();
        return { kind: "error", reason: "interleaved_legacy" };
      }
      const stripped = stripRelayChunkCapabilityPrelude(payload);
      if (stripped.advertised) this.#peerSupportsChunking = true;
      return { kind: "done", message: stripped.message };
    }

    if (
      payload[1] !== RELAY_CHUNK_VERSION ||
      (payload[2]! & ~RELAY_CHUNK_FLAG_FINAL) !== 0 ||
      payload[3] !== 0
    ) {
      this.reset();
      return { kind: "error", reason: "bad_header" };
    }

    const total = readTotalBytes(payload);
    const body = payload.subarray(RELAY_CHUNK_HEADER_BYTES);
    const final = (payload[2]! & RELAY_CHUNK_FLAG_FINAL) !== 0;

    if (body.byteLength === 0) {
      this.reset();
      return { kind: "error", reason: "bad_header" };
    }

    if (this.#total === 0) {
      // Reject before retaining body bytes, so a hostile `totalBytes` cannot
      // reserve memory it has not actually sent.
      if (total > RELAY_MAX_RPC_MESSAGE_BYTES || total === 0) {
        return { kind: "error", reason: "message_too_large" };
      }
      this.#total = total;
      this.#received = 0;
    } else if (total !== this.#total) {
      this.reset();
      return { kind: "error", reason: "total_mismatch" };
    }

    if (this.#received + body.byteLength > this.#total) {
      this.reset();
      return { kind: "error", reason: "overflow" };
    }

    this.#peerSupportsChunking = true;
    // Retain exactly the body bytes we account for, rather than a subarray
    // whose backing buffer also keeps the frame header alive.
    const retainedBody = Uint8Array.from(body);
    body.fill(0);
    this.#parts.push(retainedBody);
    this.#received += body.byteLength;

    if (!final) return { kind: "pending" };

    if (this.#received !== this.#total) {
      this.reset();
      return { kind: "error", reason: "truncated" };
    }

    const message = new Uint8Array(this.#total);
    let offset = 0;
    for (const part of this.#parts) {
      message.set(part, offset);
      offset += part.byteLength;
      part.fill(0);
    }
    this.#parts = [];
    this.#received = 0;
    this.#total = 0;
    return { kind: "done", message };
  }

  /** Drops and zeroes any partial message. */
  reset(): void {
    for (const part of this.#parts) part.fill(0);
    this.#parts = [];
    this.#received = 0;
    this.#total = 0;
    this.#peerSupportsChunking = false;
  }
}
