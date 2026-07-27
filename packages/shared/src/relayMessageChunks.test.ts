import { RELAY_CHUNK_HEADER_BYTES, RELAY_MAX_RPC_MESSAGE_BYTES } from "@ryco/contracts/relay";
import { RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it } from "vite-plus/test";

import {
  prepareRelayMessage,
  RELAY_CHUNK_CAPABILITY_PRELUDE,
  isChunkedPayload,
  RelayMessageAssembler,
  splitRelayMessage,
  stripRelayChunkCapabilityPrelude,
} from "./relayMessageChunks.ts";

const LIMIT = 64;

function roundTrip(message: Uint8Array, limit = LIMIT): Uint8Array {
  const assembler = new RelayMessageAssembler();
  let out: Uint8Array | null = null;
  for (const chunk of splitRelayMessage(message, limit)) {
    const result = assembler.push(chunk);
    if (result.kind === "error") throw new Error(`unexpected error: ${result.reason}`);
    if (result.kind === "done") out = result.message;
  }
  if (!out) throw new Error("never completed");
  return out;
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("splitRelayMessage", () => {
  it("leaves a message that already fits completely untouched", () => {
    // The common path must be byte-identical to before chunking existed, so an
    // old receiver keeps working and no extra copy is made.
    const message = bytes(0x7b, 0x22, 0x61, 0x22, 0x7d);
    const chunks = splitRelayMessage(message, LIMIT);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(message);
  });

  it("treats exactly the limit as fitting", () => {
    const message = new Uint8Array(LIMIT).fill(0x41);
    expect(splitRelayMessage(message, LIMIT)).toHaveLength(1);
    expect(splitRelayMessage(new Uint8Array(LIMIT + 1), LIMIT).length).toBeGreaterThan(1);
  });

  it("keeps every chunk within the limit", () => {
    for (const size of [LIMIT + 1, 200, 1_000]) {
      for (const chunk of splitRelayMessage(new Uint8Array(size), LIMIT)) {
        expect(chunk.byteLength).toBeLessThanOrEqual(LIMIT);
      }
    }
  });

  it("refuses a limit too small to carry a header", () => {
    expect(() => splitRelayMessage(new Uint8Array(100), RELAY_CHUNK_HEADER_BYTES)).toThrow();
  });
});

describe("chunk capability negotiation", () => {
  it("uses a prelude that the legacy JSON RPC decoder accepts as whitespace", () => {
    const parser = RpcSerialization.json.makeUnsafe();
    const message = new TextEncoder().encode("[]");
    const advertised = new Uint8Array(
      RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength + message.byteLength,
    );
    advertised.set(RELAY_CHUNK_CAPABILITY_PRELUDE);
    advertised.set(message, RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength);

    expect(parser.decode(advertised)).toEqual([]);
  });

  it("detects and strips the exact capability prelude", () => {
    const message = new TextEncoder().encode('{"ok":true}');
    const prepared = prepareRelayMessage(message, {
      maxChunkBytes: LIMIT,
      maxMessageBytes: 1_024,
      peerSupportsChunking: false,
    });

    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.payloads).toHaveLength(1);
    expect(prepared.payloads[0]).not.toBe(message);
    expect(stripRelayChunkCapabilityPrelude(prepared.payloads[0]!)).toEqual({
      advertised: true,
      message,
    });
  });

  it("leaves unadvertised legacy payloads byte-identical", () => {
    const legacy = new TextEncoder().encode('{"legacy":true}');
    expect(stripRelayChunkCapabilityPrelude(legacy)).toEqual({
      advertised: false,
      message: legacy,
    });
  });

  it("does not emit chunks before the peer advertises support", () => {
    const message = new Uint8Array(LIMIT + 1);
    expect(
      prepareRelayMessage(message, {
        maxChunkBytes: LIMIT,
        maxMessageBytes: 1_024,
        peerSupportsChunking: false,
      }),
    ).toEqual({ kind: "error", reason: "peer_unsupported" });
  });

  it("chunks an oversized frame after the peer advertises support", () => {
    const message = new Uint8Array(LIMIT + 1);
    const prepared = prepareRelayMessage(message, {
      maxChunkBytes: LIMIT,
      maxMessageBytes: 1_024,
      peerSupportsChunking: true,
    });
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.payloads.length).toBeGreaterThan(1);
    expect(prepared.payloads.every(isChunkedPayload)).toBe(true);
  });

  it("enforces the negotiated logical-message ceiling before framing", () => {
    expect(
      prepareRelayMessage(new Uint8Array(101), {
        maxChunkBytes: LIMIT,
        maxMessageBytes: 100,
        peerSupportsChunking: true,
      }),
    ).toEqual({ kind: "error", reason: "message_too_large" });
  });

  it("rejects cleanly when negotiated queue limits leave no message headroom", () => {
    expect(
      prepareRelayMessage(new Uint8Array(1), {
        maxChunkBytes: LIMIT,
        maxMessageBytes: 0,
        peerSupportsChunking: true,
      }),
    ).toEqual({ kind: "error", reason: "message_too_large" });
  });
});

describe("round trip", () => {
  it("restores messages of every awkward size", () => {
    for (const size of [LIMIT + 1, LIMIT * 2, LIMIT * 2 - 1, 1, 999]) {
      const message = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) message[i] = i % 256;
      expect(roundTrip(message)).toEqual(message);
    }
  });

  it("restores a multi-byte UTF-8 sequence split across a chunk boundary", () => {
    // THE test. A streaming text serializer decodes each frame as text on
    // arrival and would mangle a codepoint straddling the boundary. This
    // concatenates bytes and decodes once, so it cannot.
    const text = "🙂 grüße 日本語 ".repeat(40);
    const encoded = new TextEncoder().encode(text);
    expect(encoded.byteLength).toBeGreaterThan(LIMIT);
    expect(new TextDecoder().decode(roundTrip(encoded))).toBe(text);
  });

  it("survives a chunk size that lands mid-codepoint deliberately", () => {
    const encoded = new TextEncoder().encode("é".repeat(200));
    // 2-byte codepoints against an odd capacity guarantees a split codepoint.
    for (const limit of [RELAY_CHUNK_HEADER_BYTES + 1, RELAY_CHUNK_HEADER_BYTES + 3]) {
      expect(new TextDecoder().decode(roundTrip(encoded, limit))).toBe("é".repeat(200));
    }
  });
});

describe("isChunkedPayload", () => {
  it("never mistakes JSON for a chunk", () => {
    // JSON never begins with NUL, which is what makes the magic byte safe.
    expect(isChunkedPayload(new TextEncoder().encode('{"a":1}'))).toBe(false);
    expect(isChunkedPayload(new TextEncoder().encode("[1,2,3]"))).toBe(false);
  });

  it("needs a full header before claiming a payload is chunked", () => {
    expect(isChunkedPayload(bytes(0x00, 0x01))).toBe(false);
    expect(isChunkedPayload(splitRelayMessage(new Uint8Array(200), LIMIT)[0]!)).toBe(true);
  });
});

describe("RelayMessageAssembler", () => {
  it("passes a legacy unchunked payload straight through", () => {
    const assembler = new RelayMessageAssembler();
    const legacy = new TextEncoder().encode('{"ok":true}');
    expect(assembler.push(legacy)).toEqual({ kind: "done", message: legacy });
  });

  it("reports held bytes so backpressure can see buffered data", () => {
    const assembler = new RelayMessageAssembler();
    const chunks = splitRelayMessage(new Uint8Array(200), LIMIT);
    expect(assembler.heldBytes).toBe(0);
    assembler.push(chunks[0]!);
    expect(assembler.heldBytes).toBeGreaterThan(0);
    for (const chunk of chunks.slice(1)) assembler.push(chunk);
    // Back to zero once the message is delivered — nothing stays buffered.
    expect(assembler.heldBytes).toBe(0);
  });

  it("rejects an oversized total before allocating anything", () => {
    const assembler = new RelayMessageAssembler();
    const header = new Uint8Array(RELAY_CHUNK_HEADER_BYTES + 1);
    header[0] = 0x00;
    header[1] = 0x01;
    const huge = RELAY_MAX_RPC_MESSAGE_BYTES + 1;
    header[4] = (huge >>> 24) & 0xff;
    header[5] = (huge >>> 16) & 0xff;
    header[6] = (huge >>> 8) & 0xff;
    header[7] = huge & 0xff;
    expect(assembler.push(header)).toEqual({ kind: "error", reason: "message_too_large" });
    expect(assembler.heldBytes).toBe(0);
  });

  it("rejects an unknown version or a dirty reserved byte", () => {
    for (const [index, value] of [
      [1, 0x02],
      [3, 0x01],
    ] as const) {
      const assembler = new RelayMessageAssembler();
      const chunk = Uint8Array.from(splitRelayMessage(new Uint8Array(200), LIMIT)[0]!);
      chunk[index] = value;
      expect(assembler.push(chunk)).toEqual({ kind: "error", reason: "bad_header" });
    }
  });

  it("rejects unsupported chunk flag bits", () => {
    const assembler = new RelayMessageAssembler();
    const chunk = Uint8Array.from(splitRelayMessage(new Uint8Array(200), LIMIT)[0]!);
    chunk[2] = 0x02;
    expect(assembler.push(chunk)).toEqual({ kind: "error", reason: "bad_header" });
  });

  it("retains only received body bytes instead of allocating the declared total", () => {
    const assembler = new RelayMessageAssembler();
    const chunk = new Uint8Array(RELAY_CHUNK_HEADER_BYTES + 1);
    chunk[0] = 0x00;
    chunk[1] = 0x01;
    chunk[4] = (RELAY_MAX_RPC_MESSAGE_BYTES >>> 24) & 0xff;
    chunk[5] = (RELAY_MAX_RPC_MESSAGE_BYTES >>> 16) & 0xff;
    chunk[6] = (RELAY_MAX_RPC_MESSAGE_BYTES >>> 8) & 0xff;
    chunk[7] = RELAY_MAX_RPC_MESSAGE_BYTES & 0xff;
    chunk[8] = 0x7f;

    expect(assembler.push(chunk)).toEqual({ kind: "pending" });
    expect(assembler.heldBytes).toBe(1);
  });

  it("rejects a chunk whose total disagrees with the first", () => {
    const assembler = new RelayMessageAssembler();
    const chunks = splitRelayMessage(new Uint8Array(200), LIMIT);
    assembler.push(chunks[0]!);
    const tampered = Uint8Array.from(chunks[1]!);
    tampered[7] = (tampered[7]! + 1) & 0xff;
    expect(assembler.push(tampered)).toEqual({ kind: "error", reason: "total_mismatch" });
  });

  it("rejects more bytes than the message declared", () => {
    const assembler = new RelayMessageAssembler();
    const chunks = splitRelayMessage(new Uint8Array(200), LIMIT);
    for (const chunk of chunks.slice(0, -1)) assembler.push(chunk);
    // Replay a full-size chunk after the body is nearly complete.
    expect(assembler.push(chunks[0]!)).toEqual({ kind: "error", reason: "overflow" });
  });

  it("rejects a final chunk that arrives short", () => {
    const assembler = new RelayMessageAssembler();
    const chunks = splitRelayMessage(new Uint8Array(200), LIMIT);
    // Mark the FIRST chunk final while the total still claims 200 bytes.
    const early = Uint8Array.from(chunks[0]!);
    early[2] = 0x01;
    expect(assembler.push(early)).toEqual({ kind: "error", reason: "truncated" });
  });

  it("rejects a legacy payload interleaved into a partial message", () => {
    const assembler = new RelayMessageAssembler();
    assembler.push(splitRelayMessage(new Uint8Array(200), LIMIT)[0]!);
    const legacy = new TextEncoder().encode('{"ok":true}');
    expect(assembler.push(legacy)).toEqual({ kind: "error", reason: "interleaved_legacy" });
    expect(assembler.heldBytes).toBe(0);
  });

  it("is reusable after an error", () => {
    const assembler = new RelayMessageAssembler();
    const chunk = Uint8Array.from(splitRelayMessage(new Uint8Array(200), LIMIT)[0]!);
    chunk[1] = 0x02;
    assembler.push(chunk);
    // A clean message after a rejected one must still work.
    const message = new Uint8Array(150).fill(7);
    let out: Uint8Array | null = null;
    for (const next of splitRelayMessage(message, LIMIT)) {
      const result = assembler.push(next);
      if (result.kind === "done") out = result.message;
    }
    expect(out).toEqual(message);
  });

  it("drops held bytes on reset", () => {
    const assembler = new RelayMessageAssembler();
    const first = Uint8Array.from(splitRelayMessage(new Uint8Array(200).fill(0x7f), LIMIT)[0]!);
    assembler.push(first);
    assembler.reset();
    expect(assembler.heldBytes).toBe(0);
    expect([...first.subarray(RELAY_CHUNK_HEADER_BYTES)]).toEqual(
      Array.from({ length: first.byteLength - RELAY_CHUNK_HEADER_BYTES }, () => 0),
    );
  });
});
