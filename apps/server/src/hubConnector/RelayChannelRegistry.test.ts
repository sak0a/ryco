import { describe, expect, it } from "vite-plus/test";

import type {
  RelayChannelId,
  RelayChannelOpenFrame,
  RelayEffectiveRole,
  RelayFrame,
  RelayLimits,
} from "@ryco/contracts/relay";
import { RELAY_MAX_RPC_MESSAGE_BYTES } from "@ryco/contracts/relay";
import { decodeRelayFrame } from "@ryco/shared/relayCodec";

import {
  RelayChannelProtocolError,
  RelayChannelRegistry,
  type RelayRpcChannelSession,
} from "./RelayChannelRegistry.ts";
import { RelaySendQueue } from "./RelaySendQueue.ts";

const channelA = `ch_${"A".repeat(22)}` as RelayChannelId;
const channelB = `ch_${"B".repeat(22)}` as RelayChannelId;
const version = { protocolMajor: 1, protocolMinor: 2 } as const;
const limits: RelayLimits = {
  maxControlFrameBytes: 1_024,
  maxDataChunkBytes: 1_024,
  maxQueuedBytes: 4_096,
  maxChannels: 2,
  heartbeatIntervalMs: 20_000,
  deadConnectionTimeoutMs: 45_000,
  authenticationDeadlineMs: 5_000,
};

const openFrame = (
  channelId: RelayChannelId,
  effectiveRole: RelayEffectiveRole = "operator",
): RelayChannelOpenFrame => ({
  type: "channel.open",
  ...version,
  channelId,
  capability: "ryco.rpc",
  effectiveRole,
});

function decodeAll(sent: Uint8Array[]): RelayFrame[] {
  return sent.map((bytes) => {
    const decoded = decodeRelayFrame(bytes);
    if (!decoded.ok) throw new Error(decoded.error.code);
    return decoded.value;
  });
}

function harness() {
  const sent: Uint8Array[] = [];
  const socket = {
    bufferedAmount: 0,
    send: (bytes: Uint8Array) => sent.push(Uint8Array.from(bytes)),
  };
  let fatalCalls = 0;
  const sendQueue = new RelaySendQueue(socket, limits);
  const received = new Map<string, Uint8Array[]>();
  const sessions = new Map<
    string,
    RelayRpcChannelSession & {
      queued: number;
      closes: number;
      send: (bytes: Uint8Array) => boolean;
    }
  >();
  const registry = new RelayChannelRegistry({
    limits,
    sendQueue,
    factory: {
      open: async ({ channelId, send }) => {
        const values: Uint8Array[] = [];
        received.set(channelId as string, values);
        const session = {
          queued: 0,
          closes: 0,
          send,
          receive: async (bytes: Uint8Array) => {
            values.push(Uint8Array.from(bytes));
            return true;
          },
          queuedBytes: async () => session.queued,
          close: async () => {
            session.closes += 1;
          },
        };
        sessions.set(channelId as string, session);
        return session;
      },
    },
    onFatal: () => {
      fatalCalls += 1;
    },
  });
  return { registry, sendQueue, sent, received, sessions, socket, fatalCalls: () => fatalCalls };
}

describe("RelayChannelRegistry", () => {
  it("explicitly accepts authorized channels and forwards opaque ordered bytes", async () => {
    const { registry, sendQueue, sent, received, sessions } = harness();
    await registry.handle(openFrame(channelA));
    sendQueue.flush();
    expect(decodeAll(sent)[0]).toMatchObject({ type: "channel.accept", channelId: channelA });
    const payload = Uint8Array.of(0, 255, 0x7b, 0x80);
    await registry.handle({
      type: "data",
      ...version,
      channelId: channelA,
      sequence: 0 as never,
      payload,
    });
    expect(received.get(channelA as string)).toEqual([payload]);

    expect(sessions.get(channelA as string)!.send(Uint8Array.of(9, 0, 8))).toBe(true);
    sendQueue.flush();
    const output = decodeAll(sent).at(-1);
    expect(output).toMatchObject({ type: "data", channelId: channelA, sequence: 0 });
    expect(output?.type === "data" && output.payload).toEqual(Uint8Array.of(9, 0, 8));
  });

  it("closes an oversized outbound frame as transfer_limit, not slow_consumer", async () => {
    // Regression: a response larger than maxDataChunkBytes and a genuinely full
    // send queue used to collapse into one close reason. Reporting the first as
    // `slow_consumer` makes an application bug -- this node emitted a frame over
    // the negotiated limit -- read as a network problem in relay telemetry, and
    // that is why oversized RPC responses went undiagnosed. The inbound path has
    // always called the identical condition `transfer_limit`.
    const { registry, sendQueue, sent, sessions } = harness();
    await registry.handle(openFrame(channelA));
    sendQueue.flush();
    sent.length = 0;

    // A message over the per-frame limit is now SPLIT rather than refused, so
    // only one above the reassembly ceiling is rejected — and when it is, the
    // reason must name the real cause.
    const session = sessions.get(channelA as string)!;
    expect(session.send(new Uint8Array(RELAY_MAX_RPC_MESSAGE_BYTES + 1))).toBe(false);

    await Promise.resolve();
    sendQueue.flush();
    const close = decodeAll(sent).find((frame) => frame.type === "channel.close");
    expect(close).toMatchObject({ channelId: channelA, reason: "transfer_limit" });
    expect(close?.type === "channel.close" && close.reason).not.toBe("slow_consumer");
  });

  it("splits a message larger than one data frame instead of killing the channel", async () => {
    // The defect this fixes: one RPC response was unconditionally one relay
    // frame, so any response over the limit destroyed the channel. Repositories
    // of a few thousand files already exceeded it.
    const { registry, sendQueue, sent, sessions } = harness();
    await registry.handle(openFrame(channelA));
    sendQueue.flush();
    sent.length = 0;

    // Two frames' worth. Each frame also costs ~101 bytes of CBOR overhead
    // against the 4 KiB queue budget, so a larger message would trip the queue
    // rather than exercise the split.
    const message = new Uint8Array(limits.maxDataChunkBytes * 2 - 64);
    for (let i = 0; i < message.byteLength; i += 1) message[i] = i % 251;
    expect(sessions.get(channelA as string)!.send(message)).toBe(true);
    sendQueue.flush();

    const frames = decodeAll(sent);
    expect(frames.every((frame) => frame.type === "data")).toBe(true);
    expect(frames.length).toBeGreaterThan(1);
    // Every frame stays inside the negotiated limit, and the channel survives.
    for (const frame of frames) {
      expect(frame.type === "data" && frame.payload.byteLength).toBeLessThanOrEqual(
        limits.maxDataChunkBytes,
      );
    }
    expect(registry.has(channelA)).toBe(true);
    // Sequence numbers advance once per FRAME, not once per message.
    expect(frames.map((frame) => (frame.type === "data" ? frame.sequence : -1))).toEqual(
      frames.map((_, index) => index),
    );
  });

  it("rejects unsupported and duplicate channels without constructing extra sessions", async () => {
    const { registry, sendQueue, sent, sessions } = harness();
    await registry.handle(openFrame(channelA, "viewer"));
    await registry.handle(openFrame(channelA, "owner"));
    await registry.handle({
      type: "channel.open",
      ...version,
      channelId: channelB,
      effectiveRole: "operator",
    });
    sendQueue.flush();
    expect(sessions).toHaveLength(1);
    expect(decodeAll(sent).map((frame) => frame.type)).toEqual([
      "channel.accept",
      "channel.reject",
      "channel.reject",
    ]);
  });

  it("closes sequence violations and slow consumers per channel only", async () => {
    const { registry, sendQueue, sent, sessions } = harness();
    await registry.handle(openFrame(channelA));
    await registry.handle(openFrame(channelB));
    await registry.handle({
      type: "data",
      ...version,
      channelId: channelA,
      sequence: 1 as never,
      payload: Uint8Array.of(1),
    });
    expect(registry.has(channelA)).toBe(false);
    expect(registry.has(channelB)).toBe(true);
    expect(sessions.get(channelA as string)!.closes).toBe(1);

    const sessionB = sessions.get(channelB as string)!;
    sessionB.queued = 1_200;
    await registry.handle({
      type: "data",
      ...version,
      channelId: channelB,
      sequence: 0 as never,
      payload: new Uint8Array(1_000),
    });
    // A paused channel now gets enough grace for one whole message to land,
    // since a message can be many frames. Drive past that allowance.
    const allowance = Math.ceil(limits.maxQueuedBytes / limits.maxDataChunkBytes) + 1;
    for (let sequence = 1; sequence <= allowance + 1; sequence += 1) {
      await registry.handle({
        type: "data",
        ...version,
        channelId: channelB,
        sequence: sequence as never,
        payload: Uint8Array.of(2),
      });
    }
    expect(registry.has(channelB)).toBe(false);
    expect(sessionB.closes).toBe(1);
    sendQueue.flush();
    expect(
      decodeAll(sent).some(
        (frame) => frame.type === "channel.close" && frame.reason === "slow_consumer",
      ),
    ).toBe(true);
  });

  it("pauses outbound data independently and cleans every channel on shutdown", async () => {
    const { registry, sendQueue, sent, sessions } = harness();
    await registry.handle(openFrame(channelA));
    await registry.handle(openFrame(channelB));
    sendQueue.flush();
    sent.length = 0;
    await registry.handle({ type: "flow.pause", ...version, channelId: channelA });
    sessions.get(channelA as string)!.send(Uint8Array.of(1));
    sessions.get(channelB as string)!.send(Uint8Array.of(2));
    sendQueue.flush();
    expect(decodeAll(sent)).toHaveLength(1);
    expect(decodeAll(sent)[0]).toMatchObject({ type: "data", channelId: channelB });
    await registry.closeAll();
    expect(registry.size).toBe(0);
    expect([...sessions.values()].every((session) => session.closes === 1)).toBe(true);
    expect(sendQueue.queuedBytes).toBe(0);
  });

  it("reports inbound flow refresh demand until a drained channel resumes", async () => {
    const { registry, sendQueue, sent, sessions } = harness();
    await registry.handle(openFrame(channelA));
    sendQueue.flush();
    sent.length = 0;
    const session = sessions.get(channelA as string)!;
    session.queued = 1_200;
    await registry.handle({
      type: "data",
      ...version,
      channelId: channelA,
      sequence: 0 as never,
      payload: Uint8Array.of(1),
    });
    expect(registry.needsFlowRefresh).toBe(true);
    sendQueue.flush();
    expect(decodeAll(sent).at(-1)?.type).toBe("flow.pause");

    session.queued = 0;
    await registry.refreshFlow();
    expect(registry.needsFlowRefresh).toBe(false);
    sendQueue.flush();
    expect(decodeAll(sent).at(-1)?.type).toBe("flow.resume");
  });

  it("fails closed on unknown ownership and isolates negotiated or aggregate limit violations", async () => {
    const { registry, sendQueue, sent, sessions } = harness();
    await expect(
      registry.handle({
        type: "data",
        ...version,
        channelId: channelA,
        sequence: 0 as never,
        payload: Uint8Array.of(1),
      }),
    ).rejects.toBeInstanceOf(RelayChannelProtocolError);

    await registry.handle(openFrame(channelA));
    await registry.handle(openFrame(channelB));
    sendQueue.flush();
    sent.length = 0;
    await registry.handle({
      type: "data",
      ...version,
      channelId: channelA,
      sequence: 0 as never,
      payload: new Uint8Array(limits.maxDataChunkBytes + 1),
    });
    expect(registry.has(channelA)).toBe(false);
    expect(registry.has(channelB)).toBe(true);

    sessions.get(channelB as string)!.queued = limits.maxQueuedBytes - limits.maxControlFrameBytes;
    await registry.handle({
      type: "data",
      ...version,
      channelId: channelB,
      sequence: 0 as never,
      payload: Uint8Array.of(2),
    });
    expect(registry.has(channelB)).toBe(false);
    sendQueue.flush();
    expect(
      decodeAll(sent).some(
        (frame) => frame.type === "channel.close" && frame.reason === "transfer_limit",
      ),
    ).toBe(true);
  });

  it("closes a channel and signals fatal when outbound buffering cannot retain a close", async () => {
    const { registry, sendQueue, sessions, socket, fatalCalls } = harness();
    await registry.handle(openFrame(channelA));
    sendQueue.flush();
    socket.bufferedAmount = limits.maxQueuedBytes;
    expect(sessions.get(channelA as string)!.send(Uint8Array.of(9))).toBe(false);
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    expect(registry.has(channelA)).toBe(false);
    expect(sessions.get(channelA as string)!.closes).toBe(1);
    expect(fatalCalls()).toBe(1);
  });
});
