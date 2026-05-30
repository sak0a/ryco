import {
  approximateJsonBytes,
  approximateTextBytes,
  createPerfRateReporter,
  parsePerfProfileFlag,
  type PerfRateRecord,
  type PerfRateReporter,
} from "@ryco/shared/perf";

const WEB_PERF_PROFILE_ENABLED = parsePerfProfileFlag(import.meta.env.VITE_RYCO_PERF_PROFILE);
const reporters = new Map<string, PerfRateReporter>();

export function isWebPerfProfileEnabled(): boolean {
  return WEB_PERF_PROFILE_ENABLED;
}

export function readWebPerfNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function getWebPerfReporter(label: string): PerfRateReporter {
  const existing = reporters.get(label);
  if (existing) {
    return existing;
  }

  const reporter = createPerfRateReporter({
    label,
    enabled: WEB_PERF_PROFILE_ENABLED,
    now: readWebPerfNow,
  });
  reporters.set(label, reporter);
  return reporter;
}

export function recordWebPerf(label: string, record?: PerfRateRecord): void {
  if (!WEB_PERF_PROFILE_ENABLED) {
    return;
  }
  getWebPerfReporter(label).record(record);
}

export function recordWebPerfPayload(
  label: string,
  value: unknown,
  record?: Omit<PerfRateRecord, "bytes">,
): void {
  if (!WEB_PERF_PROFILE_ENABLED) {
    return;
  }
  getWebPerfReporter(label).record({
    ...record,
    bytes: approximateJsonBytes(value),
  });
}

export { approximateJsonBytes, approximateTextBytes };
