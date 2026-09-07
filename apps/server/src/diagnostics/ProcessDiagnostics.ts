import { execFile } from "node:child_process";

import { nativeResourceMonitor } from "./NativeResourceMonitor.ts";

export interface DiagnosticsProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly startTimeMs: number;
  /** Executable name only: arguments can contain prompts and credentials. */
  readonly command: string;
  readonly status: string;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly elapsed: string;
  readonly depth: number;
  readonly childPids: ReadonlyArray<number>;
}

export interface ProcessDiagnosticsSnapshot {
  readonly readAt: string;
  readonly serverPid: number;
  readonly processes: ReadonlyArray<DiagnosticsProcessEntry>;
  readonly totalCpuPercent: number;
  readonly totalRssBytes: number;
  readonly error?: string;
}

export interface DiagnosticProcessSignalInput {
  readonly pid: number;
  readonly startTimeMs: number;
  readonly signal: "SIGINT" | "SIGKILL";
}

export interface DiagnosticProcessSignalResult {
  readonly pid: number;
  readonly signal: "SIGINT" | "SIGKILL";
  readonly signaled: boolean;
  readonly message?: string;
}

const QUERY_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PROCESSES = 20_000;

/** Parse fixed numeric columns; never capture command-line arguments. */
export function parseProcessTable(output: string): ReadonlyArray<DiagnosticsProcessEntry> {
  const entries: DiagnosticsProcessEntry[] = [];
  for (const line of output.split("\n").slice(0, MAX_PROCESSES)) {
    const match = line
      .trim()
      .match(
        /^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/u,
      );
    if (!match) continue;
    const [, pidText, ppidText, startedText, cpuText, rssText, status, elapsed, command] = match;
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    const startTimeMs = Date.parse(startedText ?? "");
    const cpuPercent = Number(cpuText);
    const rssBytes = Number(rssText) * 1024;
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      !Number.isSafeInteger(ppid) ||
      !Number.isFinite(startTimeMs) ||
      !Number.isFinite(cpuPercent) ||
      cpuPercent < 0 ||
      !Number.isSafeInteger(rssBytes) ||
      rssBytes < 0 ||
      !status ||
      !elapsed ||
      !command
    )
      continue;
    entries.push({
      pid,
      ppid,
      startTimeMs,
      cpuPercent,
      rssBytes,
      status,
      elapsed: elapsed.slice(0, 64),
      command: command.replace(/\p{Cc}/gu, "").slice(0, 512),
      depth: 0,
      childPids: [],
    });
  }
  return entries;
}

/** Only return the server's descendants, in stable tree order. */
export function selectProcessDescendants(
  entries: ReadonlyArray<DiagnosticsProcessEntry>,
  serverPid: number,
): ReadonlyArray<DiagnosticsProcessEntry> {
  const byParent = new Map<number, DiagnosticsProcessEntry[]>();
  for (const entry of entries) {
    const siblings = byParent.get(entry.ppid) ?? [];
    siblings.push(entry);
    byParent.set(entry.ppid, siblings);
  }
  const result: DiagnosticsProcessEntry[] = [];
  const visited = new Set<number>([serverPid]);
  const pending = (byParent.get(serverPid) ?? [])
    .toSorted((a, b) => b.pid - a.pid)
    .map((entry) => ({ entry, depth: 0 }));
  while (pending.length > 0 && result.length < MAX_PROCESSES) {
    const next = pending.pop();
    if (!next || visited.has(next.entry.pid)) continue;
    visited.add(next.entry.pid);
    const children = (byParent.get(next.entry.pid) ?? []).filter(
      (child) => !visited.has(child.pid),
    );
    result.push({
      ...next.entry,
      depth: next.depth,
      childPids: children.map((child) => child.pid).toSorted((a, b) => a - b),
    });
    for (const child of children.toSorted((a, b) => b.pid - a.pid)) {
      pending.push({ entry: child, depth: next.depth + 1 });
    }
  }
  return result;
}

async function queryProcessTable(fresh = false): Promise<ReadonlyArray<DiagnosticsProcessEntry>> {
  try {
    const snapshot = await nativeResourceMonitor.sample({ fresh });
    return snapshot.processes.map((entry) => ({
      pid: entry.pid,
      ppid: entry.ppid,
      startTimeMs: entry.startTimeMs,
      command: entry.command,
      status: entry.status,
      cpuPercent: entry.cpuPercent,
      rssBytes: entry.residentBytes,
      elapsed: `${Math.floor(entry.runTimeMs / 1000)}s`,
      depth: 0,
      childPids: [],
    }));
  } catch {
    /* The native binary may not be bundled on a development installation. */
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return Promise.reject(new Error("Process diagnostics are unavailable on this platform."));
  }
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/ps",
      ["-axo", "pid=,ppid=,lstart=,pcpu=,rss=,stat=,etime=,comm="],
      {
        encoding: "utf8",
        timeout: QUERY_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, LC_ALL: "C" },
      },
      (error, stdout) => {
        if (error)
          reject(new Error("Unable to collect process diagnostics within the collection limits."));
        else resolve(parseProcessTable(stdout));
      },
    );
  });
}

export function makeProcessDiagnostics(
  dependencies: {
    readonly query?: () => Promise<ReadonlyArray<DiagnosticsProcessEntry>>;
    readonly kill?: (pid: number, signal: "SIGINT" | "SIGKILL") => void;
    readonly serverPid?: number;
    readonly sidecarPid?: () => number | undefined;
  } = {},
) {
  const query = dependencies.query ?? queryProcessTable;
  const queryFresh = dependencies.query ?? (() => queryProcessTable(true));
  const kill =
    dependencies.kill ??
    ((pid, signal) => {
      process.kill(pid, signal);
    });
  const serverPid = dependencies.serverPid ?? process.pid;
  const sidecarPid = dependencies.sidecarPid ?? (() => nativeResourceMonitor.health().sidecarPid);
  let inFlight: Promise<ReadonlyArray<DiagnosticsProcessEntry>> | undefined;
  const readTable = () => {
    if (inFlight) return inFlight;
    const pending = query();
    inFlight = pending;
    void pending.then(
      () => {
        if (inFlight === pending) inFlight = undefined;
      },
      () => {
        if (inFlight === pending) inFlight = undefined;
      },
    );
    return pending;
  };
  return {
    async read(): Promise<ProcessDiagnosticsSnapshot> {
      try {
        const table = await readTable();
        const monitorPid = sidecarPid();
        const processes = selectProcessDescendants(
          table.filter((entry) => entry.pid !== monitorPid),
          serverPid,
        );
        return {
          readAt: new Date().toISOString(),
          serverPid,
          processes,
          totalCpuPercent: processes.reduce((sum, entry) => sum + entry.cpuPercent, 0),
          totalRssBytes: processes.reduce((sum, entry) => sum + entry.rssBytes, 0),
        };
      } catch {
        return {
          readAt: new Date().toISOString(),
          serverPid,
          processes: [],
          totalCpuPercent: 0,
          totalRssBytes: 0,
          error: "Process collection unavailable or exceeded its time/output limit.",
        };
      }
    },
    async signal(input: DiagnosticProcessSignalInput): Promise<DiagnosticProcessSignalResult> {
      const denied = (message: string): DiagnosticProcessSignalResult => ({
        ...input,
        signaled: false,
        message,
      });
      if (
        !Number.isSafeInteger(input.pid) ||
        input.pid <= 1 ||
        input.pid === serverPid ||
        input.pid === sidecarPid() ||
        !Number.isFinite(input.startTimeMs) ||
        input.startTimeMs <= 0 ||
        (input.signal !== "SIGINT" && input.signal !== "SIGKILL")
      ) {
        return denied("Refusing an invalid or protected process signal.");
      }
      try {
        // Never reuse a cached/read-in-flight snapshot for destructive actions.
        const descendants = selectProcessDescendants(await queryFresh(), serverPid);
        const selected = descendants.find(
          (entry) => entry.pid === input.pid && entry.startTimeMs === input.startTimeMs,
        );
        if (!selected)
          return denied("Process is no longer a live descendant with the selected identity.");
        kill(input.pid, input.signal);
        return { ...input, signaled: true };
      } catch {
        return denied("Could not verify or signal the selected process.");
      }
    },
  };
}

const diagnostics = makeProcessDiagnostics();
export const readProcessDiagnostics = diagnostics.read;
export const signalDiagnosticProcess = diagnostics.signal;
