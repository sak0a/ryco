export const DEFAULT_ROLLING_WINDOW_MAX_SAMPLES = 256;
export const DEFAULT_ROLLING_WINDOW_MS = 5 * 60 * 1000;

interface RollingSample {
  readonly recordedAt: number;
  readonly durationMs: number;
}

export interface RollingDurationWindowOptions {
  readonly maxSamples?: number;
  readonly maxWindowMs?: number;
  readonly now?: () => number;
}

export class RollingDurationWindow {
  private readonly maxSamples: number;
  private readonly maxWindowMs: number;
  private readonly now: () => number;
  private samples: RollingSample[] = [];

  constructor(options: RollingDurationWindowOptions = {}) {
    this.maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_ROLLING_WINDOW_MAX_SAMPLES);
    this.maxWindowMs = Math.max(1, options.maxWindowMs ?? DEFAULT_ROLLING_WINDOW_MS);
    this.now = options.now ?? (() => Date.now());
  }

  record(durationMs: number, recordedAt = this.now()): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    this.evictExpired(recordedAt);
    this.samples.push({
      recordedAt,
      durationMs,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(this.samples.length - this.maxSamples);
    }
  }

  count(): number {
    this.evictExpired();
    return this.samples.length;
  }

  average(): number | null {
    this.evictExpired();
    if (this.samples.length === 0) {
      return null;
    }

    const total = this.samples.reduce((sum, sample) => sum + sample.durationMs, 0);
    return total / this.samples.length;
  }

  percentile(percent: number): number | null {
    this.evictExpired();
    if (this.samples.length === 0) {
      return null;
    }

    const normalizedPercent = Math.min(100, Math.max(0, percent));
    const sorted = this.samples
      .map((sample) => sample.durationMs)
      .toSorted((left, right) => left - right);
    const index = Math.ceil((normalizedPercent / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? null;
  }

  private evictExpired(now = this.now()): void {
    const cutoff = now - this.maxWindowMs;
    if (this.samples.length === 0) {
      return;
    }

    let firstValidIndex = 0;
    while (
      firstValidIndex < this.samples.length &&
      this.samples[firstValidIndex]!.recordedAt < cutoff
    ) {
      firstValidIndex += 1;
    }

    if (firstValidIndex > 0) {
      this.samples = this.samples.slice(firstValidIndex);
    }
  }
}
