export interface PerfRateRecord {
  readonly count?: number;
  readonly bytes?: number;
  readonly durationMs?: number;
}

export interface PerfRateSummary {
  readonly label: string;
  readonly reason: string;
  readonly windowMs: number;
  readonly count: number;
  readonly ratePerSecond: number;
  readonly bytes: number;
  readonly bytesPerSecond: number;
  readonly durationSamples: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number;
  readonly maxDurationMs: number;
}

export interface PerfRateReporter {
  readonly enabled: boolean;
  record(record?: PerfRateRecord): void;
  flush(reason?: string): void;
  dispose(): void;
}

export interface PerfRateReporterOptions {
  readonly label: string;
  readonly enabled: boolean;
  readonly intervalMs?: number;
  readonly logEmptyIntervals?: boolean;
  readonly now?: () => number;
  readonly log?: (summary: PerfRateSummary) => void;
}

const DEFAULT_INTERVAL_MS = 5_000;

const noopReporter: PerfRateReporter = {
  enabled: false,
  record: () => undefined,
  flush: () => undefined,
  dispose: () => undefined,
};
let textEncoder: { encode(input?: string): Uint8Array } | null | undefined;

export function parsePerfProfileFlag(value: string | number | boolean | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function approximateTextBytes(text: string): number {
  textEncoder ??= globalThis.TextEncoder ? new TextEncoder() : null;
  return textEncoder ? textEncoder.encode(text).byteLength : text.length;
}

export function approximateJsonBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? approximateTextBytes(json) : 0;
  } catch {
    return 0;
  }
}

function defaultNow(): number {
  return Date.now();
}

function defaultLog(summary: PerfRateSummary): void {
  console.info("[perf]", summary);
}

export function createPerfRateReporter(options: PerfRateReporterOptions): PerfRateReporter {
  if (!options.enabled) {
    return noopReporter;
  }

  const now = options.now ?? defaultNow;
  const log = options.log ?? defaultLog;
  const intervalMs = Math.max(250, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  let windowStartedAt = now();
  let count = 0;
  let bytes = 0;
  let durationSamples = 0;
  let totalDurationMs = 0;
  let maxDurationMs = 0;

  const reset = () => {
    windowStartedAt = now();
    count = 0;
    bytes = 0;
    durationSamples = 0;
    totalDurationMs = 0;
    maxDurationMs = 0;
  };

  const flush = (reason = "interval") => {
    const endedAt = now();
    const windowMs = Math.max(1, endedAt - windowStartedAt);
    if (!options.logEmptyIntervals && count === 0 && bytes === 0 && durationSamples === 0) {
      reset();
      return;
    }

    log({
      label: options.label,
      reason,
      windowMs,
      count,
      ratePerSecond: (count / windowMs) * 1_000,
      bytes,
      bytesPerSecond: (bytes / windowMs) * 1_000,
      durationSamples,
      totalDurationMs,
      averageDurationMs: durationSamples > 0 ? totalDurationMs / durationSamples : 0,
      maxDurationMs,
    });
    reset();
  };

  const interval = globalThis.setInterval(() => {
    flush();
  }, intervalMs);
  (interval as { unref?: () => void }).unref?.();

  return {
    enabled: true,
    record: (record = {}) => {
      const nextCount = record.count ?? 1;
      if (Number.isFinite(nextCount) && nextCount > 0) {
        count += nextCount;
      }
      const nextBytes = record.bytes ?? 0;
      if (Number.isFinite(nextBytes) && nextBytes > 0) {
        bytes += nextBytes;
      }
      const nextDurationMs = record.durationMs;
      if (nextDurationMs !== undefined && Number.isFinite(nextDurationMs) && nextDurationMs >= 0) {
        durationSamples += 1;
        totalDurationMs += nextDurationMs;
        maxDurationMs = Math.max(maxDurationMs, nextDurationMs);
      }
    },
    flush,
    dispose: () => {
      globalThis.clearInterval(interval);
      flush("dispose");
    },
  };
}
