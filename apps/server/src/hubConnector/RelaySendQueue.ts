import type { RelayChannelId, RelayControlFrame, RelayDataFrame } from "@ryco/contracts/relay";
import { encodeRelayFrame } from "@ryco/shared/relayCodec";

import type { HubRelaySocket } from "./HubRelayTransport.ts";

const ENTRY_OVERHEAD_BYTES = 32;

interface QueueEntry {
  readonly bytes: Uint8Array;
  readonly reservedBytes: number;
  readonly channelId?: string;
}

export interface RelaySendQueueLimits {
  readonly maxQueuedBytes: number;
  readonly maxControlFrameBytes: number;
}

export class RelaySendQueue {
  readonly #socket: Pick<HubRelaySocket, "bufferedAmount" | "send">;
  readonly #limits: RelaySendQueueLimits;
  readonly #control: QueueEntry[] = [];
  readonly #data = new Map<string, QueueEntry[]>();
  readonly #channelOrder: string[] = [];
  readonly #paused = new Set<string>();
  #queuedBytes = 0;
  #roundRobinIndex = 0;
  #closed = false;

  constructor(
    socket: Pick<HubRelaySocket, "bufferedAmount" | "send">,
    limits: RelaySendQueueLimits,
  ) {
    this.#socket = socket;
    this.#limits = limits;
  }

  get queuedBytes(): number {
    return this.#queuedBytes;
  }

  get ownedBytes(): number {
    return this.#queuedBytes + this.#socket.bufferedAmount;
  }

  get closed(): boolean {
    return this.#closed;
  }

  enqueueControl(frame: RelayControlFrame): boolean {
    if (this.#closed) return false;
    const entry = this.#encode(frame);
    if (entry.bytes.byteLength > this.#limits.maxControlFrameBytes) {
      entry.bytes.fill(0);
      return false;
    }
    if (this.ownedBytes + entry.reservedBytes > this.#limits.maxQueuedBytes) {
      entry.bytes.fill(0);
      return false;
    }
    this.#control.push(entry);
    this.#queuedBytes += entry.reservedBytes;
    return true;
  }

  enqueueData(frame: RelayDataFrame): boolean {
    return this.enqueueDataBatch([frame]);
  }

  /**
   * Enqueue every frame of one message, or none of them.
   *
   * One message can be several data frames, and a partial enqueue leaves the
   * peer's reassembler holding a truncated message that the remaining frames
   * will never complete. Refusing atomically is also what makes a refusal
   * reportable rather than necessarily fatal: a caller that treats backpressure
   * as recoverable needs the guarantee that a refused message produced no wire
   * record at all.
   */
  enqueueDataBatch(frames: readonly RelayDataFrame[]): boolean {
    if (this.#closed) return false;
    const entries = frames.map((frame) => this.#encode(frame));
    const dataCapacity = this.#limits.maxQueuedBytes - this.#limits.maxControlFrameBytes;
    const reserved = entries.reduce((total, entry) => total + entry.reservedBytes, 0);
    if (this.ownedBytes + reserved > dataCapacity) {
      for (const entry of entries) entry.bytes.fill(0);
      return false;
    }
    for (const [index, entry] of entries.entries()) {
      const channelId = frames[index]!.channelId as string;
      let queue = this.#data.get(channelId);
      if (queue === undefined) {
        queue = [];
        this.#data.set(channelId, queue);
        this.#channelOrder.push(channelId);
      }
      queue.push(entry);
      this.#queuedBytes += entry.reservedBytes;
    }
    return true;
  }

  /**
   * Drain the queue and report whether this channel's data reached the socket.
   *
   * The owner of this queue decides *when* to flush, but a channel that is
   * about to be torn down cannot wait for that decision: whatever is still
   * queued for it is discarded by `removeChannel`, and the `channel.close` that
   * follows would overtake it anyway because control frames drain first. So the
   * close path drives this directly rather than through a notification the
   * owner may or may not act on.
   *
   * It drives the ordinary `flush()` rather than writing this channel's frames
   * out of band, so control-before-data ordering — including this channel's own
   * `channel.accept` — is preserved exactly as on every other path.
   *
   * Returns false when something is still queued for the channel: the peer has
   * flow-paused it, the socket cannot take more, or the socket failed (in which
   * case this queue is already closed). A send failure is reported rather than
   * thrown, because the caller is already tearing the channel down.
   */
  flushChannel(channelId: RelayChannelId): boolean {
    // A closed queue has already discarded everything it held, so reporting
    // "drained" would claim a delivery that did not happen.
    if (this.#closed) return false;
    const key = channelId as string;
    if ((this.#data.get(key)?.length ?? 0) === 0) return true;
    try {
      this.flush();
    } catch {
      return false;
    }
    return (this.#data.get(key)?.length ?? 0) === 0;
  }

  pause(channelId: RelayChannelId): void {
    this.#paused.add(channelId as string);
  }

  resume(channelId: RelayChannelId): void {
    this.#paused.delete(channelId as string);
  }

  removeChannel(channelId: RelayChannelId): void {
    const key = channelId as string;
    const queue = this.#data.get(key);
    if (queue !== undefined) {
      for (const entry of queue) {
        this.#queuedBytes -= entry.reservedBytes;
        entry.bytes.fill(0);
      }
      this.#data.delete(key);
    }
    const index = this.#channelOrder.indexOf(key);
    if (index !== -1) this.#channelOrder.splice(index, 1);
    this.#paused.delete(key);
    if (this.#channelOrder.length === 0) this.#roundRobinIndex = 0;
    else this.#roundRobinIndex %= this.#channelOrder.length;
  }

  flush(): void {
    if (this.#closed) return;
    while (true) {
      const entry = this.#control.shift() ?? this.#takeNextData();
      if (entry === undefined) return;
      if (this.#socket.bufferedAmount + entry.reservedBytes > this.#limits.maxQueuedBytes) {
        this.#requeueFront(entry);
        return;
      }
      this.#queuedBytes -= entry.reservedBytes;
      try {
        this.#socket.send(entry.bytes);
      } catch {
        entry.bytes.fill(0);
        this.close();
        throw new Error("Relay send failed.");
      }
      entry.bytes.fill(0);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#control) entry.bytes.fill(0);
    for (const queue of this.#data.values()) {
      for (const entry of queue) entry.bytes.fill(0);
    }
    this.#control.length = 0;
    this.#data.clear();
    this.#channelOrder.length = 0;
    this.#paused.clear();
    this.#queuedBytes = 0;
    this.#roundRobinIndex = 0;
  }

  #encode(frame: RelayControlFrame | RelayDataFrame): QueueEntry {
    const result = encodeRelayFrame(frame);
    if (!result.ok) throw new Error("Relay frame encoding failed.");
    return {
      bytes: result.value,
      reservedBytes: result.value.byteLength + ENTRY_OVERHEAD_BYTES,
      ...(frame.type === "data" ? { channelId: frame.channelId as string } : {}),
    };
  }

  #takeNextData(): QueueEntry | undefined {
    if (this.#channelOrder.length === 0) return undefined;
    let examined = 0;
    while (examined < this.#channelOrder.length) {
      const index = this.#roundRobinIndex % this.#channelOrder.length;
      const channelId = this.#channelOrder[index]!;
      this.#roundRobinIndex = (index + 1) % this.#channelOrder.length;
      examined += 1;
      if (this.#paused.has(channelId)) continue;
      const queue = this.#data.get(channelId);
      const entry = queue?.shift();
      if (entry === undefined) continue;
      if (queue!.length === 0) {
        this.#data.delete(channelId);
        this.#channelOrder.splice(index, 1);
        if (this.#channelOrder.length === 0) this.#roundRobinIndex = 0;
        else this.#roundRobinIndex %= this.#channelOrder.length;
      }
      return entry;
    }
    return undefined;
  }

  #requeueFront(entry: QueueEntry): void {
    if (entry.channelId === undefined) {
      this.#control.unshift(entry);
      return;
    }
    let queue = this.#data.get(entry.channelId);
    if (queue === undefined) {
      queue = [];
      this.#data.set(entry.channelId, queue);
      this.#channelOrder.unshift(entry.channelId);
      this.#roundRobinIndex = 0;
    }
    queue.unshift(entry);
  }
}
