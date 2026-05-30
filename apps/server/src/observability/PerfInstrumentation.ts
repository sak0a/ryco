import {
  approximateJsonBytes,
  approximateTextBytes,
  createPerfRateReporter,
  parsePerfProfileFlag,
  type PerfRateRecord,
  type PerfRateReporter,
} from "@ryco/shared/perf";

const SERVER_PERF_PROFILE_ENABLED =
  parsePerfProfileFlag(process.env.RYCO_PERF_PROFILE) ||
  parsePerfProfileFlag(process.env.VITE_RYCO_PERF_PROFILE);
const reporters = new Map<string, PerfRateReporter>();

export function isServerPerfProfileEnabled(): boolean {
  return SERVER_PERF_PROFILE_ENABLED;
}

export function getServerPerfReporter(label: string): PerfRateReporter {
  const existing = reporters.get(label);
  if (existing) {
    return existing;
  }

  const reporter = createPerfRateReporter({
    label,
    enabled: SERVER_PERF_PROFILE_ENABLED,
  });
  reporters.set(label, reporter);
  return reporter;
}

export function recordServerPerf(label: string, record?: PerfRateRecord): void {
  if (!SERVER_PERF_PROFILE_ENABLED) {
    return;
  }
  getServerPerfReporter(label).record(record);
}

export function recordServerPerfPayload(
  label: string,
  value: unknown,
  record?: Omit<PerfRateRecord, "bytes">,
): void {
  if (!SERVER_PERF_PROFILE_ENABLED) {
    return;
  }
  getServerPerfReporter(label).record({
    ...record,
    bytes: approximateJsonBytes(value),
  });
}

export { approximateJsonBytes, approximateTextBytes };
