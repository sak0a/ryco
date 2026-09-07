export interface ResourceAttributionEntry {
  readonly component: string;
  readonly operation: string;
  readonly logicalReadBytes: number;
  readonly logicalWriteBytes: number;
  readonly count: number;
  readonly durationMs: number;
}

/** Bounded labels and numeric counters only; never store paths, payloads or identifiers. */
export function makeResourceAttribution() {
  const entries = new Map<string, ResourceAttributionEntry>();
  const bounded = (value: number) =>
    Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value))) : 0;
  const add = (left: number, right: number) =>
    Math.min(Number.MAX_SAFE_INTEGER, left + bounded(right));
  return {
    record(
      component: string,
      operation: string,
      readBytes: number,
      writeBytes: number,
      durationMs: number,
      count = 1,
    ) {
      if (!/^[a-z][a-z0-9-]{0,63}$/u.test(component) || !/^[a-z][a-z0-9-]{0,63}$/u.test(operation))
        return;
      const key = `${component}:${operation}`;
      if (!entries.has(key) && entries.size >= 100) return;
      const previous = entries.get(key) ?? {
        component,
        operation,
        logicalReadBytes: 0,
        logicalWriteBytes: 0,
        count: 0,
        durationMs: 0,
      };
      entries.set(key, {
        ...previous,
        logicalReadBytes: add(previous.logicalReadBytes, readBytes),
        logicalWriteBytes: add(previous.logicalWriteBytes, writeBytes),
        count: add(previous.count, count),
        durationMs: add(previous.durationMs, durationMs),
      });
    },
    snapshot: (): ReadonlyArray<ResourceAttributionEntry> =>
      [...entries.values()].map((entry) => Object.assign({}, entry)),
  };
}
const attribution = makeResourceAttribution();
export const recordResourceAttribution = attribution.record;
export const getResourceAttribution = attribution.snapshot;
