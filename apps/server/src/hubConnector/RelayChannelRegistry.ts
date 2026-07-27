import type {
  RelayChannelId,
  RelayChannelOpenFrame,
  RelayCloseReason,
  RelayControlFrame,
  RelayDataFrame,
  RelayEffectiveRole,
  RelayFrame,
  RelayLimits,
} from "@ryco/contracts/relay";
import { RELAY_MAX_RPC_MESSAGE_BYTES } from "@ryco/contracts/relay";
import { splitRelayMessage } from "@ryco/shared/relayMessageChunks";

import { RelaySendQueue } from "./RelaySendQueue.ts";

const version = { protocolMajor: 1, protocolMinor: 2 } as const;

export interface RelayRpcChannelSession {
  readonly receive: (bytes: Uint8Array) => Promise<boolean>;
  readonly queuedBytes: () => Promise<number>;
  readonly close: () => Promise<void>;
}

export interface RelayChannelSessionFactory {
  readonly open: (input: {
    readonly channelId: RelayChannelId;
    readonly effectiveRole: RelayEffectiveRole;
    readonly send: (bytes: Uint8Array) => boolean;
  }) => Promise<RelayRpcChannelSession>;
}

interface ChannelEntry {
  readonly channelId: RelayChannelId;
  readonly role: RelayEffectiveRole;
  readonly session: RelayRpcChannelSession;
  inboundSequence: number;
  outboundSequence: number;
  inboundPaused: boolean;
  graceFrames: number;
  closed: boolean;
}

export class RelayChannelProtocolError extends Error {
  constructor() {
    super("Relay channel protocol violation.");
    this.name = "RelayChannelProtocolError";
  }
}

export class RelayChannelQueueError extends Error {
  constructor() {
    super("Relay channel control queue is full.");
    this.name = "RelayChannelQueueError";
  }
}

export class RelayChannelRegistry {
  readonly #limits: RelayLimits;
  readonly #sendQueue: RelaySendQueue;
  readonly #factory: RelayChannelSessionFactory;
  readonly #onFatal: () => void;
  readonly #onOutboundReady: () => void;
  readonly #channels = new Map<string, ChannelEntry>();
  readonly #preparing = new Set<string>();
  #stopping = false;

  constructor(options: {
    readonly limits: RelayLimits;
    readonly sendQueue: RelaySendQueue;
    readonly factory: RelayChannelSessionFactory;
    readonly onFatal?: () => void;
    readonly onOutboundReady?: () => void;
  }) {
    this.#limits = options.limits;
    this.#sendQueue = options.sendQueue;
    this.#factory = options.factory;
    this.#onFatal = options.onFatal ?? (() => undefined);
    this.#onOutboundReady = options.onOutboundReady ?? (() => undefined);
  }

  get size(): number {
    return this.#channels.size;
  }

  get needsFlowRefresh(): boolean {
    for (const entry of this.#channels.values()) {
      if (entry.inboundPaused && !entry.closed) return true;
    }
    return false;
  }

  has(channelId: RelayChannelId): boolean {
    return this.#channels.has(channelId as string);
  }

  async handle(frame: RelayFrame): Promise<void> {
    switch (frame.type) {
      case "channel.open":
        await this.#open(frame);
        return;
      case "data":
        await this.#data(frame);
        return;
      case "flow.pause":
        if (!this.#channels.has(frame.channelId as string)) throw new RelayChannelProtocolError();
        this.#sendQueue.pause(frame.channelId);
        return;
      case "flow.resume":
        if (!this.#channels.has(frame.channelId as string)) throw new RelayChannelProtocolError();
        this.#sendQueue.resume(frame.channelId);
        return;
      case "channel.close":
        await this.closeChannel(frame.channelId);
        return;
      default:
        return;
    }
  }

  async refreshFlow(): Promise<void> {
    const lowWater = Math.floor(this.#channelBudget() * 0.5);
    for (const entry of this.#channels.values()) {
      if (!entry.inboundPaused || entry.closed) continue;
      if ((await entry.session.queuedBytes()) <= lowWater) {
        entry.inboundPaused = false;
        entry.graceFrames = 0;
        this.#enqueueControl({
          type: "flow.resume",
          ...version,
          channelId: entry.channelId,
        });
      }
    }
  }

  /**
   * How many frames a paused channel may still deliver before it counts as a
   * slow consumer.
   *
   * This used to be 1, on the assumption that one message is one frame. A
   * message can now arrive as several, so a one-frame grace would kill a
   * channel mid-message the moment it paused. The bound is the queue budget
   * rather than RELAY_MAX_RPC_MESSAGE_BYTES: a peer cannot have more than
   * `maxQueuedBytes` in flight regardless, so this is the tightest allowance
   * that cannot sever a legitimate message.
   */
  #graceFrameAllowance(): number {
    return Math.ceil(this.#limits.maxQueuedBytes / this.#limits.maxDataChunkBytes) + 1;
  }

  async closeChannel(channelId: RelayChannelId, reason?: RelayCloseReason) {
    const key = channelId as string;
    const entry = this.#channels.get(key);
    if (entry === undefined || entry.closed) return;
    entry.closed = true;
    this.#channels.delete(key);
    this.#sendQueue.removeChannel(channelId);
    let controlError: RelayChannelQueueError | undefined;
    try {
      if (reason !== undefined) {
        this.#enqueueControl({
          type: "channel.close",
          ...version,
          channelId,
          reason,
        });
      }
    } catch (error: unknown) {
      if (error instanceof RelayChannelQueueError) controlError = error;
      else throw error;
    }
    await entry.session.close().catch(() => undefined);
    if (controlError !== undefined) throw controlError;
  }

  async closeAll(): Promise<void> {
    this.#stopping = true;
    const ids = [...this.#channels.values()].map((entry) => entry.channelId);
    await Promise.all(ids.map((id) => this.closeChannel(id)));
    this.#preparing.clear();
  }

  #channelBudget(): number {
    return Math.max(
      this.#limits.maxDataChunkBytes,
      Math.floor(
        (this.#limits.maxQueuedBytes - this.#limits.maxControlFrameBytes) /
          this.#limits.maxChannels,
      ),
    );
  }

  async #open(frame: RelayChannelOpenFrame): Promise<void> {
    const key = frame.channelId as string;
    const rejected =
      this.#stopping ||
      frame.capability !== "ryco.rpc" ||
      frame.effectiveRole === undefined ||
      this.#channels.size + this.#preparing.size >= this.#limits.maxChannels ||
      this.#channels.has(key) ||
      this.#preparing.has(key);
    if (rejected) {
      this.#enqueueControl({
        type: "channel.reject",
        ...version,
        channelId: frame.channelId,
        reason: this.#stopping ? "server_draining" : "channel_rejected",
      });
      return;
    }
    this.#preparing.add(key);
    let entry: ChannelEntry | undefined;
    try {
      const role = frame.effectiveRole;
      let outputSequence = 0;
      const session = await this.#factory.open({
        channelId: frame.channelId,
        effectiveRole: role,
        send: (bytes) => {
          if (entry === undefined || entry.closed || outputSequence > 0xffff_ffff) return false;
          // Two different failures used to collapse into one close reason. An
          // oversized frame is a `transfer_limit` — exactly what the inbound
          // check reports for the identical condition below — while a full
          // queue is genuine backpressure and stays `slow_consumer`. Reporting
          // the first as the second makes an application bug ("this node emitted
          // a frame larger than the negotiated limit") look like a network
          // problem, which is why it went undiagnosed.
          // A message larger than one data frame is split across several. All
          // chunks of one message go into the per-channel FIFO synchronously
          // here, so they cannot interleave with another message.
          const oversized = bytes.byteLength > RELAY_MAX_RPC_MESSAGE_BYTES;
          const chunks = oversized ? [] : splitRelayMessage(bytes, this.#limits.maxDataChunkBytes);
          const accepted =
            !oversized &&
            chunks.every((chunk) =>
              this.#sendQueue.enqueueData({
                type: "data",
                ...version,
                channelId: frame.channelId,
                sequence: outputSequence++ as RelayDataFrame["sequence"],
                payload: Uint8Array.from(chunk),
              }),
            );
          if (accepted) {
            entry.outboundSequence = outputSequence;
            this.#onOutboundReady();
          } else {
            const reason: RelayCloseReason = oversized ? "transfer_limit" : "slow_consumer";
            queueMicrotask(() => {
              void this.closeChannel(frame.channelId, reason).catch(this.#onFatal);
            });
          }
          return accepted;
        },
      });
      if (this.#stopping) {
        await session.close().catch(() => undefined);
        throw new Error("stopping");
      }
      entry = {
        channelId: frame.channelId,
        role,
        session,
        inboundSequence: 0,
        outboundSequence: 0,
        inboundPaused: false,
        graceFrames: 0,
        closed: false,
      };
      this.#channels.set(key, entry);
      this.#enqueueControl({
        type: "channel.accept",
        ...version,
        channelId: frame.channelId,
      });
    } catch (error: unknown) {
      if (error instanceof RelayChannelQueueError) {
        this.#channels.delete(key);
        await entry?.session.close().catch(() => undefined);
        throw error;
      }
      this.#enqueueControl({
        type: "channel.reject",
        ...version,
        channelId: frame.channelId,
        reason: this.#stopping ? "server_draining" : "channel_rejected",
      });
    } finally {
      this.#preparing.delete(key);
    }
  }

  async #data(frame: RelayDataFrame): Promise<void> {
    const entry = this.#channels.get(frame.channelId as string);
    if (entry === undefined || entry.closed) throw new RelayChannelProtocolError();
    if (
      (frame.sequence as number) !== entry.inboundSequence ||
      entry.inboundSequence > 0xffff_ffff
    ) {
      await this.closeChannel(frame.channelId, "channel_rejected");
      return;
    }
    if (frame.payload.byteLength > this.#limits.maxDataChunkBytes) {
      await this.closeChannel(frame.channelId, "transfer_limit");
      return;
    }
    if (entry.inboundPaused) {
      entry.graceFrames += 1;
      // One message can now arrive as many frames, so a one-frame grace would
      // kill a channel mid-message the instant it paused. Allow a whole
      // maximum-size message to land, plus one.
      if (entry.graceFrames > this.#graceFrameAllowance()) {
        await this.closeChannel(frame.channelId, "slow_consumer");
        return;
      }
    }
    const aggregateQueued = (
      await Promise.all(
        [...this.#channels.values()].map((channel) => channel.session.queuedBytes()),
      )
    ).reduce((total, value) => total + value, 0);
    if (
      aggregateQueued + frame.payload.byteLength >
      this.#limits.maxQueuedBytes - this.#limits.maxControlFrameBytes
    ) {
      await this.closeChannel(frame.channelId, "slow_consumer");
      return;
    }
    const accepted = await entry.session.receive(Uint8Array.from(frame.payload));
    if (!accepted) {
      await this.closeChannel(frame.channelId, "slow_consumer");
      return;
    }
    entry.inboundSequence += 1;
    const queuedBytes = await entry.session.queuedBytes();
    if (!entry.inboundPaused && queuedBytes >= Math.floor(this.#channelBudget() * 0.75)) {
      entry.inboundPaused = true;
      entry.graceFrames = 0;
      this.#enqueueControl({
        type: "flow.pause",
        ...version,
        channelId: frame.channelId,
      });
    }
  }

  #enqueueControl(frame: RelayControlFrame): void {
    if (!this.#sendQueue.enqueueControl(frame)) throw new RelayChannelQueueError();
    this.#onOutboundReady();
  }
}
