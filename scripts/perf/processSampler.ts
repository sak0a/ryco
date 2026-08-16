import { execFile } from "node:child_process";

import { median } from "./statistics.ts";
import type { ProcessTreeSummary } from "./model.ts";

export interface ProcessRow {
  readonly pid: number;
  readonly parentPid: number;
  readonly rssBytes: number;
  readonly cpuPercent: number;
  readonly command: string;
}

interface ProcessTreePoint {
  readonly rssBytes: number;
  readonly cpuPercent: number;
  readonly processCount: number;
}

export function parsePsTable(output: string): ProcessRow[] {
  return output.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/u.exec(line);
    if (!match) return [];
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const rssKiB = Number(match[3]);
    const cpuPercent = Number(match[4]);
    if (![pid, parentPid, rssKiB, cpuPercent].every(Number.isFinite)) return [];
    return [
      {
        pid,
        parentPid,
        rssBytes: rssKiB * 1024,
        cpuPercent,
        command: match[5] ?? "",
      },
    ];
  });
}

export function selectProcessTree(rows: readonly ProcessRow[], rootPid: number): ProcessRow[] {
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!selected.has(row.pid) && selected.has(row.parentPid)) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => selected.has(row.pid));
}

async function readProcessTable(): Promise<ProcessRow[]> {
  return await new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid=,rss=,pcpu=,comm="],
      { encoding: "utf8" },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(parsePsTable(stdout));
      },
    );
  });
}

export class ProcessTreeSampler {
  readonly #rootPid: number;
  readonly #intervalMs: number;
  readonly #points: ProcessTreePoint[] = [];
  #timer: NodeJS.Timeout | null = null;
  #pending: Promise<void> | null = null;
  #unavailableReason: string | null = null;

  constructor(rootPid: number, intervalMs = 250) {
    this.#rootPid = rootPid;
    this.#intervalMs = intervalMs;
  }

  start(): void {
    if (this.#timer || this.#pending) return;
    if (process.platform === "win32") {
      this.#unavailableReason = "Process-tree sampling through ps is unavailable on Windows.";
      return;
    }
    const sample = () => {
      if (this.#pending) return;
      this.#pending = readProcessTable()
        .then((rows) => {
          const tree = selectProcessTree(rows, this.#rootPid);
          if (tree.length === 0) return;
          this.#points.push({
            rssBytes: tree.reduce((sum, row) => sum + row.rssBytes, 0),
            cpuPercent: tree.reduce((sum, row) => sum + row.cpuPercent, 0),
            processCount: tree.length,
          });
        })
        .catch((error: unknown) => {
          this.#unavailableReason = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          this.#pending = null;
        });
    };
    sample();
    this.#timer = setInterval(sample, this.#intervalMs);
    this.#timer.unref();
  }

  async stop(): Promise<ProcessTreeSummary> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#pending;
    const cpuValues = this.#points.map((point) => point.cpuPercent);
    return {
      supported: this.#unavailableReason === null,
      samples: this.#points.length,
      peakRssBytes:
        this.#points.length > 0 ? Math.max(...this.#points.map((point) => point.rssBytes)) : null,
      medianCpuPercent: median(cpuValues),
      peakCpuPercent: cpuValues.length > 0 ? Math.max(...cpuValues) : null,
      peakProcessCount:
        this.#points.length > 0
          ? Math.max(...this.#points.map((point) => point.processCount))
          : null,
      unavailableReason: this.#unavailableReason,
    };
  }
}
