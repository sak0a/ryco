import { describe, expect, it } from "vite-plus/test";

import type { RelayChannelId } from "@ryco/contracts/relay";
import { decodeRelayFrame } from "@ryco/shared/relayCodec";

import { RelaySendQueue } from "./RelaySendQueue.ts";

const channelA = `ch_${"A".repeat(22)}` as RelayChannelId;
const channelB = `ch_${"B".repeat(22)}` as RelayChannelId;
const version = { protocolMajor: 1, protocolMinor: 2 } as const;

function harness() {
  const sent: Uint8Array[] = [];
  const socket = {
    bufferedAmount: 0,
    send: (bytes: Uint8Array) => sent.push(Uint8Array.from(bytes)),
  };
  const queue = new RelaySendQueue(socket, {
    maxQueuedBytes: 4_096,
    maxControlFrameBytes: 1_024,
  });
  return { queue, sent, socket };
}

const data = (channelId: RelayChannelId, sequence: number, byte: number) => ({
  type: "data" as const,
  ...version,
  channelId,
  sequence: sequence as never,
  payload: Uint8Array.of(byte),
});

const decodedType = (bytes: Uint8Array) => {
  const result = decodeRelayFrame(bytes);
  if (!result.ok) throw new Error(result.error.code);
  return result.value.type;
};

describe("RelaySendQueue", () => {
  it("sends control first and schedules data fairly per channel", () => {
    const { queue, sent } = harness();
    expect(queue.enqueueData(data(channelA, 0, 1))).toBe(true);
    expect(queue.enqueueData(data(channelA, 1, 2))).toBe(true);
    expect(queue.enqueueData(data(channelB, 0, 3))).toBe(true);
    expect(
      queue.enqueueControl({
        type: "pong",
        ...version,
        nonce: new Uint8Array(8).fill(9),
      }),
    ).toBe(true);
    queue.flush();
    const decoded = sent.map((bytes) => decodeRelayFrame(bytes));
    expect(decoded.every((result) => result.ok)).toBe(true);
    expect(decoded.map((result) => (result.ok ? result.value.type : "error"))).toEqual([
      "pong",
      "data",
      "data",
      "data",
    ]);
    expect(
      decoded
        .slice(1)
        .map((result) => (result.ok && result.value.type === "data" ? result.value.channelId : "")),
    ).toEqual([channelA, channelB, channelA]);
    expect(queue.queuedBytes).toBe(0);
  });

  it("pauses one channel without blocking control or unrelated data", () => {
    const { queue, sent } = harness();
    queue.enqueueData(data(channelA, 0, 1));
    queue.enqueueData(data(channelB, 0, 2));
    queue.pause(channelA);
    queue.enqueueControl({
      type: "pong",
      ...version,
      nonce: new Uint8Array(8),
    });
    queue.flush();
    expect(sent).toHaveLength(2);
    expect(decodedType(sent[0]!)).toBe("pong");
    expect(decodedType(sent[1]!)).toBe("data");
    queue.resume(channelA);
    queue.flush();
    expect(sent).toHaveLength(3);
  });

  it("enqueues every frame of a message or none of them", () => {
    // A message can be several data frames, and a partial enqueue leaves the
    // peer's reassembler holding a truncated message the remaining frames will
    // never complete. It is also what makes a refusal safely reportable rather
    // than necessarily fatal: the caller needs to know that a refused message
    // produced no wire record at all.
    const { queue, sent } = harness();
    const batch = [data(channelA, 0, 1), data(channelA, 1, 2), data(channelA, 2, 3)];
    expect(queue.enqueueDataBatch(batch)).toBe(true);
    queue.flush();
    expect(sent).toHaveLength(3);

    // Fill the data budget so that only part of the next message would fit.
    sent.length = 0;
    let sequence = 0;
    while (queue.enqueueData(data(channelB, sequence, 1))) sequence += 1;
    const admitted = queue.queuedBytes;
    const oversizedBatch = [
      data(channelA, 0, 7),
      { ...data(channelA, 1, 7), payload: new Uint8Array(2_048) },
    ];
    expect(queue.enqueueDataBatch(oversizedBatch)).toBe(false);
    // Not one frame of the refused message was admitted, and the queue is
    // exactly as it was.
    expect(queue.queuedBytes).toBe(admitted);
    queue.flush();
    expect(
      sent.every((bytes) => {
        const decoded = decodeRelayFrame(bytes);
        return decoded.ok && decoded.value.type === "data" && decoded.value.channelId === channelB;
      }),
    ).toBe(true);
  });

  it("refuses a whole message when only its first frames would fit", () => {
    const { queue, socket } = harness();
    // Room for the first frame but not the second.
    socket.bufferedAmount = 1_800;
    expect(
      queue.enqueueDataBatch([
        { ...data(channelA, 0, 1), payload: new Uint8Array(512) },
        { ...data(channelA, 1, 2), payload: new Uint8Array(512) },
      ]),
    ).toBe(false);
    expect(queue.queuedBytes).toBe(0);
    expect(
      queue.enqueueDataBatch([{ ...data(channelA, 0, 1), payload: new Uint8Array(512) }]),
    ).toBe(true);
  });

  it("drains one channel on demand and reports what it could not send", () => {
    const { queue, sent } = harness();
    queue.enqueueData(data(channelA, 0, 1));
    queue.enqueueData(data(channelB, 0, 2));
    expect(queue.flushChannel(channelA)).toBe(true);
    expect(sent).toHaveLength(2);

    // Nothing queued is trivially drained.
    expect(queue.flushChannel(channelA)).toBe(true);

    // A channel the peer paused cannot be drained without violating the pause.
    queue.pause(channelA);
    queue.enqueueData(data(channelA, 1, 3));
    expect(queue.flushChannel(channelA)).toBe(false);
    expect(sent).toHaveLength(2);

    // Neither can a closed queue, which has already discarded what it held.
    queue.resume(channelA);
    queue.close();
    expect(queue.flushChannel(channelA)).toBe(false);
  });

  it("reserves control capacity, accounts native buffering, and cleans channels", () => {
    const { queue, socket } = harness();
    let sequence = 0;
    while (queue.enqueueData(data(channelA, sequence++, 1))) {
      // Fill only the data budget.
    }
    expect(
      queue.enqueueControl({
        type: "pong",
        ...version,
        nonce: new Uint8Array(8),
      }),
    ).toBe(true);
    const before = queue.queuedBytes;
    queue.removeChannel(channelA);
    expect(queue.queuedBytes).toBeLessThan(before);
    socket.bufferedAmount = 4_096;
    expect(
      queue.enqueueControl({
        type: "pong",
        ...version,
        nonce: new Uint8Array(8),
      }),
    ).toBe(false);
    queue.close();
    expect(queue.queuedBytes).toBe(0);
    expect(queue.closed).toBe(true);
  });
});
