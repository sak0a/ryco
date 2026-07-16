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
