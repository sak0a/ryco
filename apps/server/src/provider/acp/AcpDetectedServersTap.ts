/**
 * Helpers for taping ACP tool-call telemetry into the detected-servers
 * pipeline.
 *
 * ACP `toolCall.detail` is cumulative: each `session/update` ToolCallUpdated
 * REPLACES the previous text with a longer version. Forwarding the full
 * detail to the StdoutSniffer on every update would replay lines we already
 * saw, emitting duplicate registry events. This dedup remembers the last
 * length forwarded per toolCallId and only returns the new suffix.
 */
export class AcpDetailSuffixDedup {
  private readonly lengthByKey = new Map<string, number>();

  /**
   * Returns the new suffix to feed to a tracker, or `null` if nothing new.
   *
   * If the detail string shrank (defensive: shouldn't happen), the dedup is
   * reset and the full new string is returned so the tracker can re-process
   * it from scratch.
   */
  consume(key: string, detail: string): string | null {
    const previousLength = this.lengthByKey.get(key) ?? 0;
    if (detail.length < previousLength) {
      this.lengthByKey.set(key, detail.length);
      return detail;
    }
    if (detail.length > previousLength) {
      this.lengthByKey.set(key, detail.length);
      return detail.slice(previousLength);
    }
    return null;
  }

  reset(key: string): void {
    this.lengthByKey.delete(key);
  }
}
