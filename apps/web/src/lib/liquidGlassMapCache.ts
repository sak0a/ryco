import { readWebPerfNow, recordWebPerf } from "../perf/perfInstrumentation";
import type {
  LiquidGlassMapInput,
  LiquidGlassMapWorkerRequest,
  LiquidGlassMapWorkerResponse,
} from "./liquidGlassMapProtocol";

const MAP_DIMENSION_QUANTUM = 8;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 24;
const WORKER_TIMEOUT_MS = 2_000;

export interface LiquidGlassMapLease {
  readonly url: string;
  readonly release: () => void;
}

interface GeneratedLiquidGlassMap {
  readonly blob: Blob;
  readonly durationMs: number;
}

interface CacheEntry {
  readonly key: string;
  readonly promise: Promise<GeneratedLiquidGlassMap>;
  references: number;
  lastUsed: number;
  url: string | null;
  bytes: number;
}

export interface LiquidGlassMapCache {
  readonly acquire: (input: LiquidGlassMapInput) => Promise<LiquidGlassMapLease | null>;
  readonly clear: () => void;
  readonly inspect: () => { readonly entries: number; readonly bytes: number };
}

function quantize(value: number): number {
  return Math.max(
    MAP_DIMENSION_QUANTUM,
    Math.round(value / MAP_DIMENSION_QUANTUM) * MAP_DIMENSION_QUANTUM,
  );
}

export function quantizeLiquidGlassMapInput(input: LiquidGlassMapInput): LiquidGlassMapInput {
  return {
    width: quantize(input.width),
    height: quantize(input.height),
    radius: quantize(input.radius),
    edgeBandPx: quantize(input.edgeBandPx),
  };
}

function mapKey(input: LiquidGlassMapInput): string {
  return `${input.width}x${input.height}:r${input.radius}:b${input.edgeBandPx}`;
}

export function createLiquidGlassMapCache(input: {
  readonly generate: (mapInput: LiquidGlassMapInput) => Promise<GeneratedLiquidGlassMap>;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
  readonly onCacheHit?: () => void;
}): LiquidGlassMapCache {
  const entries = new Map<string, CacheEntry>();
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = input.now ?? Date.now;
  let totalBytes = 0;

  const remove = (entry: CacheEntry) => {
    if (entries.get(entry.key) !== entry || entry.references > 0) return false;
    entries.delete(entry.key);
    totalBytes -= entry.bytes;
    if (entry.url) input.revokeObjectUrl(entry.url);
    return true;
  };
  const evict = () => {
    if (entries.size <= maxEntries && totalBytes <= maxBytes) return;
    const candidates = [...entries.values()]
      .filter((entry) => entry.references === 0 && entry.url !== null)
      .toSorted((left, right) => left.lastUsed - right.lastUsed);
    for (const candidate of candidates) {
      remove(candidate);
      if (entries.size <= maxEntries && totalBytes <= maxBytes) break;
    }
  };

  return {
    acquire: async (requestedInput) => {
      const normalized = quantizeLiquidGlassMapInput(requestedInput);
      const key = mapKey(normalized);
      let entry = entries.get(key);
      if (entry) {
        entry.references += 1;
        entry.lastUsed = now();
        input.onCacheHit?.();
      } else {
        const promise = input.generate(normalized);
        entry = {
          key,
          promise,
          references: 1,
          lastUsed: now(),
          url: null,
          bytes: 0,
        };
        entries.set(key, entry);
        void promise.catch(() => {
          if (entries.get(key) === entry) entries.delete(key);
        });
      }

      const acquiredEntry = entry;
      try {
        const generated = await acquiredEntry.promise;
        if (entries.get(key) !== acquiredEntry) return null;
        if (acquiredEntry.url === null) {
          acquiredEntry.url = input.createObjectUrl(generated.blob);
          acquiredEntry.bytes = generated.blob.size;
          totalBytes += acquiredEntry.bytes;
        }
        acquiredEntry.lastUsed = now();
        let released = false;
        evict();
        return {
          url: acquiredEntry.url,
          release: () => {
            if (released) return;
            released = true;
            acquiredEntry.references = Math.max(0, acquiredEntry.references - 1);
            acquiredEntry.lastUsed = now();
            evict();
          },
        };
      } catch {
        acquiredEntry.references = Math.max(0, acquiredEntry.references - 1);
        if (entries.get(key) === acquiredEntry) entries.delete(key);
        return null;
      }
    },
    clear: () => {
      for (const entry of entries.values()) {
        if (entry.references === 0 && entry.url) input.revokeObjectUrl(entry.url);
      }
      for (const [key, entry] of entries) {
        if (entry.references === 0) entries.delete(key);
      }
      totalBytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    },
    inspect: () => ({ entries: entries.size, bytes: totalBytes }),
  };
}

interface PendingWorkerRequest {
  readonly resolve: (value: GeneratedLiquidGlassMap) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let requestSequence = 0;
const pendingRequests = new Map<number, PendingWorkerRequest>();

function rejectPendingRequests(error: Error): void {
  for (const request of pendingRequests.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  pendingRequests.clear();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }
  worker = new Worker(new URL("../workers/liquidGlass.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", (event: MessageEvent<LiquidGlassMapWorkerResponse>) => {
    const pending = pendingRequests.get(event.data.requestId);
    if (!pending) return;
    pendingRequests.delete(event.data.requestId);
    clearTimeout(pending.timeout);
    if (event.data.kind === "error") {
      pending.reject(new Error(event.data.message));
      return;
    }
    recordWebPerf("web.liquid-glass.worker", {
      durationMs: event.data.durationMs,
      bytes: event.data.blob.size,
    });
    pending.resolve({ blob: event.data.blob, durationMs: event.data.durationMs });
  });
  worker.addEventListener("error", () => {
    worker?.terminate();
    worker = null;
    rejectPendingRequests(new Error("Liquid-glass worker failed"));
  });
  return worker;
}

async function generateWithWorker(input: LiquidGlassMapInput): Promise<GeneratedLiquidGlassMap> {
  const activeWorker = getWorker();
  if (!activeWorker) throw new Error("Liquid-glass worker is unavailable");
  const requestId = ++requestSequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Liquid-glass worker timed out"));
    }, WORKER_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timeout });
    const request: LiquidGlassMapWorkerRequest = { requestId, ...input };
    // Worker.postMessage transfers to its worker and has no target-origin parameter.
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    activeWorker.postMessage(request);
  });
}

const sharedCache = createLiquidGlassMapCache({
  generate: generateWithWorker,
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  onCacheHit: () => recordWebPerf("web.liquid-glass.cache-hit"),
});

export async function acquireLiquidGlassMap(
  input: LiquidGlassMapInput,
): Promise<LiquidGlassMapLease | null> {
  const startedAt = readWebPerfNow();
  const pending = sharedCache.acquire(input);
  recordWebPerf("web.liquid-glass.main-thread", {
    durationMs: Math.max(0, readWebPerfNow() - startedAt),
  });
  const lease = await pending;
  recordWebPerf(lease ? "web.liquid-glass.request" : "web.liquid-glass.fallback");
  return lease;
}
