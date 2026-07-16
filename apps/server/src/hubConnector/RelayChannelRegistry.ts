import type {
  RelayChannelId,
  RelayChannelOpenFrame,
  RelayDataFrame,
  RelayEffectiveRole,
  RelayFrame,
  RelayLimits,
} from "@ryco/contracts/relay";

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

export class RelayChannelRegistry {
  readonly #limits: RelayLimits;
  readonly #sendQueue: RelaySendQueue;
  readonly #factory: RelayChannelSessionFactory;
  readonly #channels = new Map<string, ChannelEntry>();
  readonly #preparing = new Set<string>();
  #stopping = false;

  constructor(options: {
    readonly limits: RelayLimits;
    readonly sendQueue: RelaySendQueue;
    readonly factory: RelayChannelSessionFactory;
  }) {
    this.#limits = options.limits;
    this.#sendQueue = options.sendQueue;
    this.#factory = options.factory;
  }

  get size(): number {
    return this.#channels.size;
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
        if (this.#channels.has(frame.channelId as string)) this.#sendQueue.pause(frame.channelId);
        return;
      case "flow.resume":
        if (this.#channels.has(frame.channelId as string)) this.#sendQueue.resume(frame.channelId);
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
        this.#sendQueue.enqueueControl({
          type: "flow.resume",
          ...version,
          channelId: entry.channelId,
        });
      }
    }
  }

  async closeChannel(channelId: RelayChannelId, reason?: "slow_consumer" | "protocol_unsupported") {
    const key = channelId as string;
    const entry = this.#channels.get(key);
    if (entry === undefined || entry.closed) return;
    entry.closed = true;
    this.#channels.delete(key);
    this.#sendQueue.removeChannel(channelId);
    if (reason !== undefined) {
      this.#sendQueue.enqueueControl({
        type: "channel.close",
        ...version,
        channelId,
        reason,
      });
    }
    await entry.session.close().catch(() => undefined);
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
      this.#sendQueue.enqueueControl({
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
          const accepted = this.#sendQueue.enqueueData({
            type: "data",
            ...version,
            channelId: frame.channelId,
            sequence: outputSequence as RelayDataFrame["sequence"],
            payload: Uint8Array.from(bytes),
          });
          if (accepted) {
            outputSequence += 1;
            entry.outboundSequence = outputSequence;
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
      this.#sendQueue.enqueueControl({
        type: "channel.accept",
        ...version,
        channelId: frame.channelId,
      });
    } catch {
      this.#sendQueue.enqueueControl({
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
    if (entry === undefined || entry.closed) return;
    if (
      (frame.sequence as number) !== entry.inboundSequence ||
      entry.inboundSequence > 0xffff_ffff
    ) {
      await this.closeChannel(frame.channelId, "protocol_unsupported");
      return;
    }
    if (entry.inboundPaused) {
      entry.graceFrames += 1;
      if (entry.graceFrames > 1) {
        await this.closeChannel(frame.channelId, "slow_consumer");
        return;
      }
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
      this.#sendQueue.enqueueControl({
        type: "flow.pause",
        ...version,
        channelId: frame.channelId,
      });
    }
  }
}
