import type {
  ResourceTelemetrySnapshot,
  ResourceTelemetryProcess,
  ResourceTelemetryAggregate,
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryInput,
} from "@ryco/contracts";
import { getResourceAttribution } from "./ResourceAttribution.ts";
export { recordResourceAttribution } from "./ResourceAttribution.ts";
import { nativeResourceMonitor } from "./NativeResourceMonitor.ts";
import { readDesktopResourceTelemetry } from "./DesktopResourceTelemetry.ts";

const MAX_SAMPLES = 720;
const MAX_PROCESSES = 2_000;
const history: ResourceTelemetrySnapshot[] = [];
let pending: Promise<ResourceTelemetrySnapshot> | undefined;
const processMetadata = new Map<
  string,
  {
    category: ResourceTelemetryProcess["category"];
    electronType?: string;
    firstSeenAt: string;
    lastSeenAt: string;
  }
>();
let terminalRoots = new Set<number>();
const sameProcess = (
  left: { pid: number; startTimeMs: number },
  right: { pid: number; startTimeMs: number },
) => left.pid === right.pid && Math.abs(left.startTimeMs - right.startTimeMs) < 1_000;
function evenlySpaced<A>(values: readonly A[], limit: number): readonly A[] {
  if (values.length <= limit) return values;
  if (limit <= 1) return values.length ? [values[values.length - 1]!] : [];
  return Array.from(
    { length: limit },
    (_, index) => values[Math.round((index * (values.length - 1)) / (limit - 1))]!,
  );
}
function aggregate(
  processes: readonly ResourceTelemetryProcess[],
  previous: readonly ResourceTelemetryProcess[],
): ResourceTelemetryAggregate {
  const keys = new Set(processes.map((p) => `${p.identity.pid}:${p.identity.startTimeMs}`));
  const old = new Set(previous.map((p) => `${p.identity.pid}:${p.identity.startTimeMs}`));
  const sum = (pick: (p: ResourceTelemetryProcess) => number) =>
    processes.reduce((total, p) => total + pick(p), 0);
  return {
    processCount: processes.length,
    currentCpuPercent: sum((p) => p.cpuPercent),
    cpuTimeMs: sum((p) => p.cpuTimeMs),
    currentRssBytes: sum((p) => p.residentBytes),
    peakRssBytes: sum((p) => p.peakResidentBytes),
    ioReadBytes: sum((p) => p.ioReadBytes),
    ioWriteBytes: sum((p) => p.ioWriteBytes),
    ioReadBytesPerSecond: sum((p) => p.ioReadBytesPerSecond),
    ioWriteBytesPerSecond: sum((p) => p.ioWriteBytesPerSecond),
    processStarts: [...keys].filter((k) => !old.has(k)).length,
    processExits: [...old].filter((k) => !keys.has(k)).length,
  };
}
async function collect(): Promise<ResourceTelemetrySnapshot> {
  const desktop = await readDesktopResourceTelemetry();
  nativeResourceMonitor.setExternalProcesses(
    desktop?.processes.map((p) => ({ pid: p.pid, startTimeMs: p.startTimeMs })) ?? [],
  );
  let native: Awaited<ReturnType<typeof nativeResourceMonitor.sample>> | undefined;
  try {
    native = await nativeResourceMonitor.sample();
  } catch {
    /* Source health carries failure; retain desktop diagnostics. */
  }
  const health = nativeResourceMonitor.health();
  const readAt = new Date().toISOString();
  const prior = history.at(-1);
  const elapsed = Math.max(1, Date.parse(readAt) - Date.parse(prior?.readAt ?? readAt));
  const previous = new Map(
    prior?.processes.map((p) => [`${p.identity.pid}:${p.identity.startTimeMs}`, p]),
  );
  const desktopByPid = new Map(desktop?.processes.map((p) => [p.pid, p]));
  const samples = [...(native?.processes ?? [])];
  for (const p of desktop?.processes ?? [])
    if (!samples.some((s) => s.pid === p.pid))
      samples.push({
        pid: p.pid,
        ppid: 0,
        startTimeMs: p.startTimeMs,
        runTimeMs: Math.max(0, Date.now() - p.startTimeMs),
        name: p.type,
        command: p.type,
        status: "running",
        cpuPercent: p.cpuPercent,
        cpuTimeMs: p.cpuTimeMs,
        residentBytes: p.residentBytes,
        virtualBytes: 0,
        ioReadBytes: 0,
        ioWriteBytes: 0,
        ioSemantics: "all-io",
      });
  samples.length = Math.min(samples.length, MAX_PROCESSES);
  const samplesByPid = new Map(samples.map((p) => [p.pid, p]));
  const childrenByPid = new Map<number, number[]>();
  for (const p of samples) {
    const children = childrenByPid.get(p.ppid) ?? [];
    children.push(p.pid);
    childrenByPid.set(p.ppid, children);
  }
  const processes: ResourceTelemetryProcess[] = samples.map((p) => {
    const old = previous.get(`${p.pid}:${p.startTimeMs}`);
    const candidate = desktopByPid.get(p.pid);
    const electron = candidate && sameProcess(p, candidate) ? candidate : undefined;
    let depth = 0;
    let parent = p.ppid;
    const visited = new Set<number>([p.pid]);
    while (parent && !visited.has(parent) && depth < 64) {
      visited.add(parent);
      const ancestor = samplesByPid.get(parent);
      if (!ancestor) break;
      depth++;
      parent = ancestor.ppid;
    }
    return {
      identity: { pid: p.pid, startTimeMs: p.startTimeMs },
      ppid: p.ppid,
      childPids: childrenByPid.get(p.pid) ?? [],
      depth,
      name: p.name,
      command: p.name,
      status: p.status,
      category: electron
        ? electron.type === "Browser"
          ? "electron-main"
          : electron.type === "GPU"
            ? "electron-gpu"
            : electron.type === "Tab"
              ? "electron-renderer"
              : "electron-utility"
        : p.pid === health.sidecarPid
          ? "resource-monitor"
          : p.pid === process.pid
            ? "server"
            : terminalRoots.has(p.pid)
              ? "terminal-root"
              : "server-child",
      ...(electron
        ? { electronType: electron.type, idleWakeupsPerSecond: electron.idleWakeupsPerSecond }
        : {}),
      cpuPercent: p.cpuPercent,
      cpuTimeMs: p.cpuTimeMs,
      residentBytes: p.residentBytes,
      peakResidentBytes: Math.max(p.residentBytes, old?.peakResidentBytes ?? 0),
      virtualBytes: p.virtualBytes,
      ioReadBytes: p.ioReadBytes,
      ioWriteBytes: p.ioWriteBytes,
      ioReadBytesPerSecond: old
        ? (Math.max(0, p.ioReadBytes - old.ioReadBytes) * 1000) / elapsed
        : 0,
      ioWriteBytesPerSecond: old
        ? (Math.max(0, p.ioWriteBytes - old.ioWriteBytes) * 1000) / elapsed
        : 0,
      ioSemantics:
        electron && !native?.processes.some((s) => sameProcess(s, p))
          ? "unavailable"
          : p.ioSemantics,
      runTimeMs: p.runTimeMs,
      firstSeenAt: old?.firstSeenAt ?? readAt,
      lastSeenAt: readAt,
    };
  });
  for (const p of processes) {
    const key = `${p.identity.pid}:${p.identity.startTimeMs}`;
    const existing = processMetadata.get(key);
    processMetadata.delete(key);
    processMetadata.set(key, {
      category: p.category,
      ...(p.electronType ? { electronType: p.electronType } : {}),
      firstSeenAt: existing?.firstSeenAt ?? p.firstSeenAt,
      lastSeenAt: p.lastSeenAt,
    });
  }
  for (const [key, metadata] of processMetadata)
    if (Date.parse(metadata.lastSeenAt) < Date.now() - 24 * 60 * 60 * 1000)
      processMetadata.delete(key);
  while (processMetadata.size > 20_000)
    processMetadata.delete(processMetadata.keys().next().value!);
  const isElectron = (p: ResourceTelemetryProcess) => p.category.startsWith("electron-");
  const isMonitor = (p: ResourceTelemetryProcess) => p.category === "resource-monitor";
  const group = (
    name: keyof ResourceTelemetrySnapshot["groups"],
    filter: (p: ResourceTelemetryProcess) => boolean,
  ) => {
    const selected = processes.filter(filter);
    const current = aggregate(selected, prior?.processes.filter(filter) ?? []);
    const old = prior?.groups[name];
    if (!old) return { ...current, cpuTimeMs: 0, ioReadBytes: 0, ioWriteBytes: 0 };
    const delta = (field: "ioReadBytes" | "ioWriteBytes" | "cpuTimeMs") =>
      selected.reduce(
        (sum, p) =>
          sum +
          Math.max(
            0,
            p[field] -
              (previous.get(`${p.identity.pid}:${p.identity.startTimeMs}`)?.[field] ?? p[field]),
          ),
        0,
      );
    return {
      ...current,
      cpuTimeMs: old.cpuTimeMs + delta("cpuTimeMs"),
      ioReadBytes: old.ioReadBytes + delta("ioReadBytes"),
      ioWriteBytes: old.ioWriteBytes + delta("ioWriteBytes"),
      peakRssBytes: Math.max(old.peakRssBytes, current.currentRssBytes),
      processStarts: old.processStarts + current.processStarts,
      processExits: old.processExits + current.processExits,
    };
  };
  const snapshot: ResourceTelemetrySnapshot = {
    readAt,
    sampleIntervalMs: nativeResourceMonitor.sampleIntervalMs?.() ?? (prior ? elapsed : 0),
    processes,
    groups: {
      backend: group("backend", (p) => !isElectron(p) && !isMonitor(p)),
      electron: group("electron", isElectron),
      monitor: group("monitor", isMonitor),
      allRyco: group("allRyco", () => true),
    },
    power: desktop?.power ?? null,
    speedLimitPercent: desktop?.power.speedLimitPercent ?? null,
    attribution: { readAt, entries: getResourceAttribution() },
    health: {
      native: {
        status: health.status,
        lastSampleAt: native ? new Date(native.sampledAtUnixMs).toISOString() : null,
        lastError: health.lastError ?? null,
      },
      desktop: {
        status: desktop ? "healthy" : "unavailable",
        lastSampleAt: desktop?.sampledAt ?? null,
        lastError: null,
      },
      sidecarPid: health.sidecarPid ?? null,
      sidecarVersion: health.sidecarVersion ?? null,
      restartCount: health.restartCount,
      collectionDurationMicros: native?.collectionDurationMicros ?? 0,
      scannedProcessCount: native?.scannedProcessCount ?? 0,
      retainedProcessCount: processes.length,
      inaccessibleProcessCount: native?.inaccessibleProcessCount ?? 0,
    },
  };
  history.push(snapshot);
  while (history.length > 1 && Date.parse(history[0]!.readAt) < Date.now() - 24 * 60 * 60 * 1000)
    history.shift();
  if (history.length > MAX_SAMPLES) history.splice(0, history.length - MAX_SAMPLES);
  let retainedProcesses = history.reduce((sum, sample) => sum + sample.processes.length, 0);
  while (retainedProcesses > 20_000 && history.length > 1)
    retainedProcesses -= history.shift()!.processes.length;
  const estimateBytes = (s: ResourceTelemetrySnapshot) =>
    4096 +
    s.processes.reduce(
      (total, p) => total + 512 + 2 * (p.name.length + p.command.length + p.status.length),
      0,
    );
  let retainedBytes = history.reduce((sum, s) => sum + estimateBytes(s), 0);
  while (retainedBytes > 32 * 1024 * 1024 && history.length > 1)
    retainedBytes -= estimateBytes(history.shift()!);
  return snapshot;
}
export function readResourceTelemetry(input?: {
  readonly terminalPids: readonly number[];
}): Promise<ResourceTelemetrySnapshot> {
  if (input)
    terminalRoots = new Set(
      input.terminalPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0),
    );
  if (pending) return pending;
  const cached = history.at(-1);
  if (cached && Date.now() - Date.parse(cached.readAt) < 1_000) return Promise.resolve(cached);
  pending = collect().finally(() => {
    pending = undefined;
  });
  return pending;
}
export async function retryResourceTelemetry(): Promise<ResourceTelemetrySnapshot> {
  if (pending) await pending;
  await nativeResourceMonitor.retry();
  pending = collect().finally(() => {
    pending = undefined;
  });
  return pending;
}
export async function readResourceTelemetryHistory(
  input: ResourceTelemetryHistoryInput,
): Promise<ResourceTelemetryHistory> {
  const latest = await readResourceTelemetry();
  const windowMs = Math.min(24 * 60 * 60 * 1000, Math.max(1_000, input.windowMs));
  const bucketMs = Math.min(windowMs, Math.max(1_000, input.bucketMs));
  const byTime = new Map(
    history
      .filter((s) => Date.parse(s.readAt) >= Date.now() - windowMs)
      .map((s) => [Date.parse(s.readAt), s]),
  );
  // Native history is authoritative for past native samples. Never attach today's
  // desktop process list or power state to a historical reading.
  let nativeHistory: Awaited<ReturnType<typeof nativeResourceMonitor.history>> = [];
  try {
    nativeHistory = await nativeResourceMonitor.history(windowMs);
  } catch {
    /* Available local history remains usable. */
  }
  // CPU totals cover all available identities, including processes that exited
  // between display samples and entries omitted from the top-process table.
  const cpuRanges = new Map<string, { first: number; last: number }>();
  const addCpu = (pid: number, startTimeMs: number, cpuTimeMs: number) => {
    const key = `${pid}:${startTimeMs}`;
    const prior = cpuRanges.get(key);
    cpuRanges.set(key, {
      first: Math.min(prior?.first ?? cpuTimeMs, cpuTimeMs),
      last: Math.max(prior?.last ?? cpuTimeMs, cpuTimeMs),
    });
  };
  for (const snapshot of nativeHistory)
    if (snapshot.sampledAtUnixMs >= Date.now() - windowMs)
      for (const p of snapshot.processes) addCpu(p.pid, p.startTimeMs, p.cpuTimeMs);
  for (const snapshot of byTime.values())
    for (const p of snapshot.processes) addCpu(p.identity.pid, p.identity.startTimeMs, p.cpuTimeMs);
  const totalCpuTimeMs = [...cpuRanges.values()].reduce(
    (sum, range) => sum + Math.max(0, range.last - range.first),
    0,
  );
  let retainedRows = 0;
  const eligibleNative = nativeHistory
    .filter((sample) => sample.sampledAtUnixMs >= Date.now() - windowMs)
    .toSorted((a, b) => a.sampledAtUnixMs - b.sampledAtUnixMs);
  const maxRows = eligibleNative.reduce(
    (max, sample) => Math.max(max, Math.min(MAX_PROCESSES, sample.processes.length)),
    1,
  );
  // Spread the row budget over the whole requested window, retaining both ends.
  const selectedNative = evenlySpaced(
    eligibleNative,
    Math.max(1, Math.min(MAX_SAMPLES, Math.floor(20_000 / maxRows))),
  );
  for (const sample of selectedNative) {
    if (
      sample.sampledAtUnixMs < Date.now() - windowMs ||
      retainedRows >= 20_000 ||
      byTime.has(sample.sampledAtUnixMs)
    )
      continue;
    const readAt = new Date(sample.sampledAtUnixMs).toISOString();
    const processes: ResourceTelemetryProcess[] = sample.processes
      .slice(0, Math.min(MAX_PROCESSES, 20_000 - retainedRows))
      .map((p) => {
        const metadata = processMetadata.get(`${p.pid}:${p.startTimeMs}`);
        return {
          identity: { pid: p.pid, startTimeMs: p.startTimeMs },
          ppid: p.ppid,
          childPids: [],
          depth: 0,
          name: p.name,
          command: p.name,
          status: p.status,
          ...(metadata?.electronType ? { electronType: metadata.electronType } : {}),
          category:
            metadata?.category ??
            (p.pid === process.pid
              ? "server"
              : p.pid === latest.health.sidecarPid
                ? "resource-monitor"
                : "server-child"),
          cpuPercent: p.cpuPercent,
          cpuTimeMs: p.cpuTimeMs,
          residentBytes: p.residentBytes,
          peakResidentBytes: p.residentBytes,
          virtualBytes: p.virtualBytes,
          ioReadBytes: p.ioReadBytes,
          ioWriteBytes: p.ioWriteBytes,
          ioReadBytesPerSecond: 0,
          ioWriteBytesPerSecond: 0,
          ioSemantics: p.ioSemantics,
          runTimeMs: p.runTimeMs,
          firstSeenAt: metadata && metadata.firstSeenAt < readAt ? metadata.firstSeenAt : readAt,
          lastSeenAt: readAt,
        };
      });
    retainedRows += processes.length;
    const all = aggregate(processes, []);
    byTime.set(sample.sampledAtUnixMs, {
      ...latest,
      readAt,
      processes,
      power: null,
      speedLimitPercent: null,
      groups: {
        backend: aggregate(
          processes.filter(
            (p) => !p.category.startsWith("electron-") && p.category !== "resource-monitor",
          ),
          [],
        ),
        electron: aggregate(
          processes.filter((p) => p.category.startsWith("electron-")),
          [],
        ),
        monitor: aggregate(
          processes.filter((p) => p.category === "resource-monitor"),
          [],
        ),
        allRyco: all,
      },
    });
  }
  const samples = evenlySpaced(
    [...byTime.values()].toSorted((a, b) => a.readAt.localeCompare(b.readAt)),
    MAX_SAMPLES,
  );
  const buckets = new Map<number, ResourceTelemetrySnapshot[]>();
  for (const sample of samples) {
    const key = Math.floor(Date.parse(sample.readAt) / bucketMs) * bucketMs;
    const bucket = buckets.get(key) ?? [];
    bucket.push(sample);
    buckets.set(key, bucket);
  }
  const entries = new Map<string, ResourceTelemetryProcess[]>();
  for (const sample of samples)
    for (const p of sample.processes) {
      const key = `${p.identity.pid}:${p.identity.startTimeMs}`;
      const entriesForProcess = entries.get(key) ?? [];
      entriesForProcess.push(p);
      entries.set(key, entriesForProcess);
    }
  const ioDeltas = new Map<ResourceTelemetrySnapshot, { read: number; write: number }>();
  const previousCounters = new Map<string, { read: number; write: number }>();
  for (const sample of samples) {
    let read = 0,
      write = 0;
    for (const p of sample.processes) {
      const key = `${p.identity.pid}:${p.identity.startTimeMs}`;
      const old = previousCounters.get(key);
      if (old) {
        read += Math.max(0, p.ioReadBytes - old.read);
        write += Math.max(0, p.ioWriteBytes - old.write);
      }
      previousCounters.set(key, { read: p.ioReadBytes, write: p.ioWriteBytes });
    }
    ioDeltas.set(sample, { read, write });
  }
  return {
    readAt: latest.readAt,
    windowMs,
    bucketMs,
    sampleIntervalMs: latest.sampleIntervalMs,
    retainedSampleCount: samples.length,
    totalCpuTimeMs,
    health: latest.health,
    buckets: [...buckets].map(([at, ss]) => ({
      startedAt: new Date(at).toISOString(),
      endedAt: new Date(at + bucketMs).toISOString(),
      avgCpuPercent: ss.reduce((t, s) => t + s.groups.allRyco.currentCpuPercent, 0) / ss.length,
      maxCpuPercent: Math.max(...ss.map((s) => s.groups.allRyco.currentCpuPercent)),
      maxRssBytes: Math.max(...ss.map((s) => s.groups.allRyco.currentRssBytes)),
      ioReadBytes: ss.reduce((sum, sample) => sum + (ioDeltas.get(sample)?.read ?? 0), 0),
      ioWriteBytes: ss.reduce((sum, sample) => sum + (ioDeltas.get(sample)?.write ?? 0), 0),
      maxProcessCount: Math.max(...ss.map((s) => s.processes.length)),
    })),
    topProcesses: [...entries.values()]
      .map((ps) => {
        const p = ps.at(-1)!;
        return {
          identity: p.identity,
          ppid: p.ppid,
          depth: p.depth,
          name: p.name,
          command: p.command,
          category: p.category,
          firstSeenAt: ps[0]!.firstSeenAt,
          lastSeenAt: p.lastSeenAt,
          currentCpuPercent: p.cpuPercent,
          avgCpuPercent: ps.reduce((t, s) => t + s.cpuPercent, 0) / ps.length,
          maxCpuPercent: Math.max(...ps.map((s) => s.cpuPercent)),
          cpuTimeMs: Math.max(
            0,
            (cpuRanges.get(`${p.identity.pid}:${p.identity.startTimeMs}`)?.last ?? p.cpuTimeMs) -
              (cpuRanges.get(`${p.identity.pid}:${p.identity.startTimeMs}`)?.first ?? p.cpuTimeMs),
          ),
          currentRssBytes: p.residentBytes,
          peakRssBytes: Math.max(...ps.map((s) => s.peakResidentBytes)),
          ioReadBytes: p.ioReadBytes,
          ioWriteBytes: p.ioWriteBytes,
          ioSemantics: p.ioSemantics,
          sampleCount: ps.length,
        };
      })
      .toSorted((a, b) => b.peakRssBytes - a.peakRssBytes)
      .slice(0, 100),
  };
}
