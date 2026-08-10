// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";

import type { UsageProviderKind } from "@ryco/contracts";

import type { UsageRecord } from "./usageRecord.ts";
import { withTokenTotal } from "./usageRecord.ts";

export const USAGE_SCAN_CACHE_VERSION = 2 as const;

export interface CachedUsageFile {
  readonly rootKey: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly provider: UsageProviderKind;
  readonly records: readonly UsageRecord[];
}

export type UsageScanCache = Map<string, CachedUsageFile>;

type SerializedRecord = readonly [
  timestampMs: number,
  modelIndex: number,
  sessionIndex: number,
  uncachedInputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  dedupeKey: string | null,
  reportedCostUsd: number | null,
];

interface SerializedFile {
  readonly o: string;
  readonly s: number;
  readonly m: number;
  readonly p: UsageProviderKind;
  readonly r: readonly SerializedRecord[];
}

interface SerializedCache {
  readonly version: number;
  readonly models: readonly string[];
  readonly sessions: readonly string[];
  readonly files: Readonly<Record<string, SerializedFile>>;
}

function hashPrivateIdentifier(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}\0${value}`).digest("hex");
}

export function usageCacheFileKey(provider: UsageProviderKind, canonicalPath: string): string {
  return hashPrivateIdentifier(`${provider}:transcript-file`, canonicalPath);
}

export function usageCacheRootKey(provider: UsageProviderKind, canonicalRoot: string): string {
  return hashPrivateIdentifier(`${provider}:transcript-root`, canonicalRoot);
}

/** Remove provider session/message identifiers before a parsed row becomes durable. */
export function anonymizeUsageRecord(record: UsageRecord): UsageRecord {
  return {
    ...record,
    sessionId:
      record.sessionId.length === 0
        ? ""
        : hashPrivateIdentifier(`${record.provider}:session`, record.sessionId),
    dedupeKey:
      record.dedupeKey === null
        ? null
        : hashPrivateIdentifier(`${record.provider}:response`, record.dedupeKey),
  };
}

export function deduplicateUsageRecordsWithinFile(
  records: readonly UsageRecord[],
): readonly UsageRecord[] {
  const seen = new Set<string>();
  const kept: UsageRecord[] = [];
  for (const record of records) {
    if (record.dedupeKey !== null) {
      if (seen.has(record.dedupeKey)) continue;
      seen.add(record.dedupeKey);
    }
    kept.push(record);
  }
  return kept;
}

export function encodeUsageScanCache(cache: UsageScanCache): SerializedCache {
  const models: string[] = [];
  const sessions: string[] = [];
  const modelIndexes = new Map<string, number>();
  const sessionIndexes = new Map<string, number>();
  const intern = (values: string[], indexes: Map<string, number>, value: string): number => {
    const existing = indexes.get(value);
    if (existing !== undefined) return existing;
    const next = values.length;
    values.push(value);
    indexes.set(value, next);
    return next;
  };

  const files: Record<string, SerializedFile> = {};
  for (const [fileKey, entry] of cache) {
    files[fileKey] = {
      o: entry.rootKey,
      s: entry.size,
      m: entry.mtimeMs,
      p: entry.provider,
      r: entry.records.map((record) => [
        record.timestampMs,
        intern(models, modelIndexes, record.model),
        intern(sessions, sessionIndexes, record.sessionId),
        record.totals.uncachedInputTokens,
        record.totals.cachedInputTokens,
        record.totals.cacheCreationInputTokens,
        record.totals.outputTokens,
        record.totals.reasoningTokens,
        record.dedupeKey,
        record.reportedCostUsd,
      ]),
    };
  }
  return { version: USAGE_SCAN_CACHE_VERSION, models, sessions, files };
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function decodeUsageScanCache(document: unknown): UsageScanCache {
  const cache: UsageScanCache = new Map();
  if (typeof document !== "object" || document === null) return cache;
  const root = document as Partial<SerializedCache>;
  if (
    root.version !== USAGE_SCAN_CACHE_VERSION ||
    !isArray(root.models) ||
    !root.models.every((value) => typeof value === "string") ||
    !isArray(root.sessions) ||
    !root.sessions.every((value) => typeof value === "string") ||
    typeof root.files !== "object" ||
    root.files === null
  ) {
    return cache;
  }

  const models = root.models as readonly string[];
  const sessions = root.sessions as readonly string[];
  for (const [fileKey, rawEntry] of Object.entries(root.files)) {
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const entry = rawEntry as Partial<SerializedFile>;
    if (
      typeof entry.o !== "string" ||
      entry.o.length === 0 ||
      typeof entry.s !== "number" ||
      !Number.isFinite(entry.s) ||
      typeof entry.m !== "number" ||
      !Number.isFinite(entry.m) ||
      (entry.p !== "claude" && entry.p !== "codex") ||
      !isArray(entry.r)
    ) {
      continue;
    }

    const records: UsageRecord[] = [];
    let corrupt = false;
    for (const rawRow of entry.r) {
      if (!isArray(rawRow) || rawRow.length < 10) {
        corrupt = true;
        break;
      }
      const [
        timestampMs,
        modelIndex,
        sessionIndex,
        uncached,
        cached,
        cacheCreation,
        output,
        reasoning,
        dedupeKey,
        reportedCostUsd,
      ] = rawRow as SerializedRecord;
      const model = typeof modelIndex === "number" ? models[modelIndex] : undefined;
      const sessionId = typeof sessionIndex === "number" ? sessions[sessionIndex] : undefined;
      const tokens = [uncached, cached, cacheCreation, output, reasoning];
      if (
        typeof timestampMs !== "number" ||
        !Number.isFinite(timestampMs) ||
        model === undefined ||
        sessionId === undefined ||
        tokens.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0) ||
        (dedupeKey !== null && typeof dedupeKey !== "string") ||
        (reportedCostUsd !== null &&
          (typeof reportedCostUsd !== "number" || !Number.isFinite(reportedCostUsd)))
      ) {
        corrupt = true;
        break;
      }

      records.push({
        provider: entry.p,
        timestampMs,
        model,
        sessionId,
        totals: withTokenTotal({
          uncachedInputTokens: uncached,
          cachedInputTokens: cached,
          cacheCreationInputTokens: cacheCreation,
          outputTokens: output,
          reasoningTokens: reasoning,
        }),
        dedupeKey,
        reportedCostUsd,
      });
    }
    if (!corrupt) {
      cache.set(fileKey, {
        rootKey: entry.o,
        size: entry.s,
        mtimeMs: entry.m,
        provider: entry.p,
        records,
      });
    }
  }
  return cache;
}

export interface PruneUsageScanCacheOptions {
  readonly liveFileKeys: ReadonlySet<string>;
  readonly walkedRootKeys: ReadonlySet<string>;
  readonly windowStartMs: number;
  readonly retentionCutoffMs: number;
}

export function pruneUsageScanCache(
  cache: UsageScanCache,
  options: PruneUsageScanCacheOptions,
): number {
  let removed = 0;
  for (const [fileKey, entry] of cache) {
    const agedOut = entry.mtimeMs < options.retentionCutoffMs;
    const underWalkedRoot = options.walkedRootKeys.has(entry.rootKey);
    const deleted =
      underWalkedRoot &&
      entry.mtimeMs >= options.windowStartMs &&
      !options.liveFileKeys.has(fileKey);
    if (agedOut || deleted) {
      cache.delete(fileKey);
      removed += 1;
    }
  }
  return removed;
}
