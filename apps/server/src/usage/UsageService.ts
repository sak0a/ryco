// @effect-diagnostics globalDate:off
import {
  USAGE_CONTRACT_VERSION,
  UsageReadError,
  type UsageCalendarDate,
  type UsageDailyBucket,
  type UsagePricingStatus,
  type UsageProviderKind,
  type UsageSourceCoverage,
  type UsageSummary,
  type UsageSummaryRequest,
} from "@ryco/contracts";
import { Cause, Clock, Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { UsageAggregator } from "./usageAggregation.ts";
import {
  lookupUsageModelRate,
  encodeUsageRateTable,
  parseUsageRateTable,
  priceUsageRecord,
  type UsageRateTable,
} from "./usagePricing.ts";
import {
  anonymizeUsageRecord,
  decodeUsageScanCache,
  deduplicateUsageRecordsWithinFile,
  encodeUsageScanCache,
  pruneUsageScanCache,
  type UsageScanCache,
  usageCacheFileKey,
  usageCacheRootKey,
} from "./usageScanCache.ts";
import { resolveUsageSourceIdentity } from "./usageSourceIdentity.ts";
import {
  listUsageTranscriptFiles,
  readUsageTranscript,
  type UsageTranscriptFile,
} from "./usageTranscriptReader.ts";
import type { UsageRecord } from "./usageRecord.ts";

export const LITELLM_USAGE_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const RATES_TTL_MS = 24 * 60 * 60 * 1000;
const MTIME_WINDOW_SLACK_MS = 36 * 60 * 60 * 1000;
const SCAN_CACHE_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

interface PersistedRates {
  readonly fetchedAtMs: number;
  readonly revision: string;
  readonly document: unknown;
}

interface ResolvedTranscriptSource {
  readonly provider: UsageProviderKind;
  readonly identityRoot: string;
  readonly scanRoots: readonly string[];
}

interface CachedReadResult {
  readonly records: readonly UsageRecord[];
  readonly reused: boolean;
  readonly skippedLineCount: number;
  readonly malformedLineCount: number;
  readonly failed: boolean;
}

export interface UsageServiceShape {
  readonly readSummary: (input: UsageSummaryRequest) => Effect.Effect<UsageSummary, UsageReadError>;
}

export class UsageService extends Context.Service<UsageService, UsageServiceShape>()(
  "ryco/usage/UsageService",
) {}

export const makeEmptyUsageSummary = (input: UsageSummaryRequest): UsageSummary => ({
  contractVersion: USAGE_CONTRACT_VERSION,
  ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
  endDate: input.endDate,
  timeZone: input.timeZone,
  generatedAt: "1970-01-01T00:00:00.000Z",
  scanDurationMs: 0,
  buckets: [],
  sources: [],
  pricing: {
    state: "unavailable",
    recognizedModelCount: 0,
    unrecognizedModelCount: 0,
  },
});

export const UsageServiceTest = UsageService.of({
  readSummary: (input) => Effect.succeed(makeEmptyUsageSummary(input)),
});

export const UsageServiceTestLayer = Layer.succeed(UsageService, UsageServiceTest);

function isValidCalendarDate(value: UsageCalendarDate): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function startOfCalendarDateMs(value: UsageCalendarDate): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function iso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ratesRevision(document: unknown): string {
  const json = JSON.stringify(document);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `litellm-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function configuredHomePath(config: unknown): string | undefined {
  if (typeof config !== "object" || config === null || !("homePath" in config)) {
    return undefined;
  }
  const homePath = config.homePath;
  return typeof homePath === "string" ? homePath : undefined;
}

const makeUsageService = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment;
  const httpClient = yield* HttpClient.HttpClient;
  const scanSemaphore = yield* Semaphore.make(1);

  const usageStateDir = path.join(config.stateDir, "usage");
  yield* fileSystem
    .makeDirectory(usageStateDir, { recursive: true })
    .pipe(Effect.catchCause(() => Effect.void));
  const scanCachePath = path.join(usageStateDir, "scan-cache.json");
  const ratesCachePath = path.join(usageStateDir, "pricing-cache.json");
  const scanCache: UsageScanCache = new Map();
  let scanCacheLoaded = false;
  let scanCacheDirty = false;
  let rates: UsageRateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesRevisionValue: string | null = null;
  let ratesState: UsagePricingStatus["state"] = "unavailable";

  const loadScanCache = Effect.fn("UsageService.loadScanCache")(function* () {
    if (scanCacheLoaded) return;
    scanCacheLoaded = true;
    const raw = yield* fileSystem
      .readFileString(scanCachePath)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (raw === null) return;
    const decoded = parseJson(raw);
    if (decoded === null) return;
    for (const [filePath, entry] of decodeUsageScanCache(decoded)) {
      scanCache.set(filePath, entry);
    }
  });

  const persistScanCache = Effect.fn("UsageService.persistScanCache")(function* () {
    if (!scanCacheDirty) return;
    yield* writeFileStringAtomically({
      filePath: scanCachePath,
      contents: `${JSON.stringify(encodeUsageScanCache(scanCache))}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.tap(() => Effect.sync(() => (scanCacheDirty = false))),
      Effect.catchCause(() => Effect.void),
    );
  });

  const loadRatesFromDisk = Effect.fn("UsageService.loadRatesFromDisk")(function* () {
    if (ratesFetchedAtMs !== null) return;
    const raw = yield* fileSystem
      .readFileString(ratesCachePath)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (raw === null) return;
    const parsed = parseJson(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    const cache = parsed as Partial<PersistedRates>;
    if (
      typeof cache.fetchedAtMs !== "number" ||
      !Number.isFinite(cache.fetchedAtMs) ||
      typeof cache.revision !== "string"
    ) {
      return;
    }
    const parsedRates = parseUsageRateTable(cache.document);
    if (parsedRates.size === 0) return;
    rates = parsedRates;
    ratesFetchedAtMs = cache.fetchedAtMs;
    ratesRevisionValue = cache.revision;
    ratesState = "cached";
  });

  const ensureRates = Effect.fn("UsageService.ensureRates")(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* loadRatesFromDisk();
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < RATES_TTL_MS) return;

    const document = yield* httpClient.get(LITELLM_USAGE_RATES_URL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(10_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (document === null) {
      ratesState = rates.size > 0 ? "cached" : "unavailable";
      return;
    }
    const parsedRates = parseUsageRateTable(document);
    if (parsedRates.size === 0) return;

    const revision = ratesRevision(document);
    rates = parsedRates;
    ratesFetchedAtMs = now;
    ratesRevisionValue = revision;
    ratesState = "live";
    yield* writeFileStringAtomically({
      filePath: ratesCachePath,
      contents: `${JSON.stringify({
        fetchedAtMs: now,
        revision,
        document: encodeUsageRateTable(rates),
      })}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.catchCause(() => Effect.void),
    );
  });

  const resolveTranscriptSources = Effect.fn("UsageService.resolveTranscriptSources")(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new UsageReadError({
            reason: "scan-failed",
            detail: "Server settings could not be read while locating provider transcripts.",
            cause,
          }),
      ),
    );
    const claudeHomes = [
      yield* resolveClaudeHomePath(settings.providers.claudeAgent).pipe(
        Effect.provideService(Path.Path, path),
      ),
    ];
    const codexHomes = [
      (yield* resolveCodexHomeLayout(settings.providers.codex).pipe(
        Effect.provideService(Path.Path, path),
      )).sharedHomePath,
    ];

    for (const instance of Object.values(settings.providerInstances)) {
      if (instance.enabled === false) continue;
      const homePath = configuredHomePath(instance.config);
      if (instance.driver === "claudeAgent") {
        claudeHomes.push(
          yield* resolveClaudeHomePath({
            homePath: homePath ?? settings.providers.claudeAgent.homePath,
          }).pipe(Effect.provideService(Path.Path, path)),
        );
      } else if (instance.driver === "codex") {
        codexHomes.push(
          (yield* resolveCodexHomeLayout({
            ...settings.providers.codex,
            homePath: homePath ?? settings.providers.codex.homePath,
          }).pipe(Effect.provideService(Path.Path, path))).sharedHomePath,
        );
      }
    }

    const sources = new Map<string, ResolvedTranscriptSource>();
    for (const claudeHome of claudeHomes) {
      const nestedClaudeRoot = path.join(claudeHome, ".claude", "projects");
      const nestedClaudeExists = yield* fileSystem
        .exists(nestedClaudeRoot)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      const claudeRoot = nestedClaudeExists ? nestedClaudeRoot : path.join(claudeHome, "projects");
      sources.set(`claude\0${claudeRoot}`, {
        provider: "claude",
        identityRoot: claudeRoot,
        scanRoots: [claudeRoot],
      });
    }
    for (const codexHome of codexHomes) {
      sources.set(`codex\0${codexHome}`, {
        provider: "codex",
        identityRoot: codexHome,
        scanRoots: [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")],
      });
    }
    return [...sources.values()];
  });

  const readFileRecords = Effect.fn("UsageService.readFileRecords")(function* (
    file: UsageTranscriptFile,
    provider: UsageProviderKind,
    rootKey: string,
  ): Effect.fn.Return<CachedReadResult> {
    const fileKey = usageCacheFileKey(provider, file.path);
    const cached = scanCache.get(fileKey);
    if (
      cached !== undefined &&
      cached.size === file.size &&
      cached.mtimeMs === file.mtimeMs &&
      cached.provider === provider
    ) {
      return {
        records: cached.records,
        reused: true,
        skippedLineCount: 0,
        malformedLineCount: 0,
        failed: false,
      };
    }

    const read = yield* Effect.promise(() => readUsageTranscript(file.path, provider));
    if (read === null) {
      return {
        records: [],
        reused: false,
        skippedLineCount: 0,
        malformedLineCount: 0,
        failed: true,
      };
    }
    const records = deduplicateUsageRecordsWithinFile(read.records).map(anonymizeUsageRecord);
    scanCache.set(fileKey, {
      rootKey,
      size: file.size,
      mtimeMs: file.mtimeMs,
      provider,
      records,
    });
    scanCacheDirty = true;
    return {
      records,
      reused: false,
      skippedLineCount: read.skippedLineCount,
      malformedLineCount: read.malformedLineCount,
      failed: false,
    };
  });

  const readSummaryUnlocked = Effect.fn("UsageService.readSummaryUnlocked")(function* (
    input: UsageSummaryRequest,
  ) {
    if (
      !isValidCalendarDate(input.endDate) ||
      (input.startDate !== undefined && !isValidCalendarDate(input.startDate))
    ) {
      return yield* new UsageReadError({
        reason: "invalid-window",
        detail: "The requested usage window contains an invalid calendar date.",
      });
    }
    if (input.startDate !== undefined && input.startDate > input.endDate) {
      return yield* new UsageReadError({
        reason: "invalid-window",
        detail: `startDate '${input.startDate}' is after endDate '${input.endDate}'.`,
      });
    }
    try {
      Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone });
    } catch {
      return yield* new UsageReadError({
        reason: "invalid-time-zone",
        detail: `Time zone '${input.timeZone}' is not a recognized IANA time zone.`,
      });
    }

    const scanStartedAtMs = yield* Clock.currentTimeMillis;
    yield* loadScanCache();
    yield* ensureRates();
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const sources = yield* resolveTranscriptSources();
    const windowStartMs =
      input.startDate === undefined
        ? 0
        : Math.max(0, startOfCalendarDateMs(input.startDate) - MTIME_WINDOW_SLACK_MS);
    const coverage: UsageSourceCoverage[] = [];
    const buckets: UsageDailyBucket[] = [];
    const liveFileKeys = new Set<string>();
    const walkedRootKeys = new Set<string>();
    const recognizedModels = new Set<string>();
    const unrecognizedModels = new Set<string>();
    const claimedSourceIds = new Set<string>();

    for (const source of sources) {
      const sourceStartedAtMs = yield* Clock.currentTimeMillis;
      const identity = yield* Effect.promise(() =>
        resolveUsageSourceIdentity({
          root: source.identityRoot,
          provider: source.provider,
          environmentId,
        }),
      );
      if (claimedSourceIds.has(identity.sourceId)) continue;
      claimedSourceIds.add(identity.sourceId);
      const aggregator = new UsageAggregator({
        sourceId: identity.sourceId,
        timeZone: input.timeZone,
        ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
        endDate: input.endDate,
        price: (record) => priceUsageRecord(rates, record),
      });
      const sessionIds = new Set<string>();
      let transcriptFileCount = 0;
      let reusedCacheFileCount = 0;
      let parsedFileCount = 0;
      let skippedLineCount = 0;
      let malformedLineCount = 0;
      let listingErrorCount = 0;
      let failedFileCount = 0;
      let existingRootCount = 0;

      for (const root of source.scanRoots) {
        const exists = yield* fileSystem
          .exists(root)
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        if (!exists) continue;
        existingRootCount += 1;
        const rootKey = usageCacheRootKey(source.provider, root);
        walkedRootKeys.add(rootKey);
        const listing = yield* Effect.promise(() => listUsageTranscriptFiles(root, windowStartMs));
        transcriptFileCount += listing.files.length;
        skippedLineCount += listing.skippedEntryCount;
        listingErrorCount += listing.errorCount;

        for (const file of listing.files) {
          liveFileKeys.add(usageCacheFileKey(source.provider, file.path));
          const read = yield* readFileRecords(file, source.provider, rootKey);
          if (read.reused) reusedCacheFileCount += 1;
          else if (!read.failed) parsedFileCount += 1;
          if (read.failed) failedFileCount += 1;
          skippedLineCount += read.skippedLineCount;
          malformedLineCount += read.malformedLineCount;
          for (const record of read.records) {
            if (aggregator.add(record)) {
              const recognized =
                record.reportedCostUsd !== null ||
                lookupUsageModelRate(rates, record.model) !== null;
              (recognized ? recognizedModels : unrecognizedModels).add(record.model);
              if (record.sessionId.length > 0) sessionIds.add(record.sessionId);
            }
          }
        }
      }

      const aggregated = aggregator.finish();
      buckets.push(...aggregated.buckets);
      const sourceFinishedAtMs = yield* Clock.currentTimeMillis;
      const status: UsageSourceCoverage["status"] =
        existingRootCount === 0
          ? "not-found"
          : failedFileCount > 0 || listingErrorCount > 0
            ? aggregated.acceptedRecords > 0 || reusedCacheFileCount > 0
              ? "partial"
              : "failed"
            : "complete";
      const diagnosticCode =
        status === "not-found"
          ? "transcript-directory-not-found"
          : listingErrorCount > 0
            ? "transcript-list-partial"
            : failedFileCount > 0
              ? "transcript-read-partial"
              : undefined;
      coverage.push({
        sourceId: identity.sourceId,
        provider: source.provider,
        deduplicationKind: identity.deduplicationKind,
        status,
        transcriptFileCount,
        reusedCacheFileCount,
        parsedFileCount,
        skippedLineCount,
        malformedLineCount,
        distinctSessionCount: sessionIds.size,
        distinctResponseCount: aggregated.acceptedRecords,
        scanStartedAt: iso(sourceStartedAtMs),
        scanFinishedAt: iso(sourceFinishedAtMs),
        scanDurationMs: Math.max(0, Math.trunc(sourceFinishedAtMs - sourceStartedAtMs)),
        ...(diagnosticCode ? { diagnosticCode } : {}),
        ...(status === "not-found"
          ? { message: "No transcript directory was found for this provider." }
          : status === "partial" || status === "failed"
            ? { message: "Some transcript files could not be read." }
            : {}),
      });
    }

    const removed = pruneUsageScanCache(scanCache, {
      liveFileKeys,
      walkedRootKeys,
      windowStartMs,
      retentionCutoffMs:
        input.startDate === undefined ? 0 : scanStartedAtMs - SCAN_CACHE_RETENTION_MS,
    });
    if (removed > 0) scanCacheDirty = true;
    yield* persistScanCache();

    buckets.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.provider.localeCompare(right.provider) ||
        left.model.localeCompare(right.model) ||
        left.sourceId.localeCompare(right.sourceId),
    );
    const finishedAtMs = yield* Clock.currentTimeMillis;
    const pricing: UsagePricingStatus = {
      state: ratesState,
      recognizedModelCount: recognizedModels.size,
      unrecognizedModelCount: unrecognizedModels.size,
      ...(ratesRevisionValue === null ? {} : { sourceRevision: ratesRevisionValue }),
      ...(ratesFetchedAtMs === null
        ? {}
        : {
            fetchedAt: iso(ratesFetchedAtMs),
            cacheAgeMs: Math.max(0, Math.trunc(finishedAtMs - ratesFetchedAtMs)),
          }),
    };
    return {
      contractVersion: USAGE_CONTRACT_VERSION,
      ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
      endDate: input.endDate,
      timeZone: input.timeZone,
      generatedAt: iso(finishedAtMs),
      scanDurationMs: Math.max(0, Math.trunc(finishedAtMs - scanStartedAtMs)),
      buckets,
      sources: coverage,
      pricing,
    } satisfies UsageSummary;
  });

  const readSummary = (input: UsageSummaryRequest) =>
    scanSemaphore
      .withPermits(1)(readSummaryUnlocked(input))
      .pipe(
        Effect.catchCause((cause) => {
          const failure = Cause.findErrorOption(cause);
          if (failure._tag === "Some" && Schema.is(UsageReadError)(failure.value)) {
            return Effect.fail(failure.value);
          }
          return Effect.fail(
            new UsageReadError({
              reason: "scan-failed",
              detail: "Usage transcripts could not be scanned.",
              cause: Cause.squash(cause),
            }),
          );
        }),
      );

  return { readSummary } satisfies UsageServiceShape;
});

export const UsageServiceLive = Layer.effect(UsageService, makeUsageService);
