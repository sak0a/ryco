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

export type ChunkPushResult =
  | { readonly kind: "pending" }
  | { readonly kind: "done"; readonly message: Uint8Array }
  | { readonly kind: "error"; readonly reason: ChunkError };

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
 * Reassembles chunks arriving in order on one channel.
 *
 * `heldBytes` is exposed so flow-control accounting can include buffered bytes:
 * without it a peer can hold megabytes that backpressure cannot see.
 */
export class RelayMessageAssembler {
  #buffer: Uint8Array | null = null;
  #received = 0;
  #total = 0;

  /** Bytes currently buffered awaiting completion. */
  get heldBytes(): number {
    return this.#received;
  }

  push(payload: Uint8Array): ChunkPushResult {
    if (!isChunkedPayload(payload)) {
      // A legacy payload arriving mid-message means the peer interleaved, or a
      // chunk was lost. Either way the buffer can no longer be trusted.
      if (this.#buffer !== null) {
        this.reset();
        return { kind: "error", reason: "interleaved_legacy" };
      }
      return { kind: "done", message: payload };
    }

    if (payload[1] !== RELAY_CHUNK_VERSION || payload[3] !== 0) {
      this.reset();
      return { kind: "error", reason: "bad_header" };
    }

    const total = readTotalBytes(payload);
    const body = payload.subarray(RELAY_CHUNK_HEADER_BYTES);
    const final = (payload[2]! & RELAY_CHUNK_FLAG_FINAL) !== 0;

    if (this.#buffer === null) {
      // Reject before allocating, so a hostile `totalBytes` cannot make us
      // reserve memory we then discard.
      if (total > RELAY_MAX_RPC_MESSAGE_BYTES || total === 0) {
        return { kind: "error", reason: "message_too_large" };
      }
      this.#buffer = new Uint8Array(total);
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

    this.#buffer.set(body, this.#received);
    this.#received += body.byteLength;

    if (!final) return { kind: "pending" };

    if (this.#received !== this.#total) {
      this.reset();
      return { kind: "error", reason: "truncated" };
    }

    const message = this.#buffer;
    this.#buffer = null;
    this.#received = 0;
    this.#total = 0;
    return { kind: "done", message };
  }

  /** Drops and zeroes any partial message. */
  reset(): void {
    this.#buffer?.fill(0);
    this.#buffer = null;
    this.#received = 0;
    this.#total = 0;
  }
}
