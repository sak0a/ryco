import type { UsageTokenTotals } from "@ryco/contracts";

import type { UsageRecordPrice } from "./usageAggregation.ts";
import type { UsageRecord } from "./usageRecord.ts";

export interface UsageModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number | null;
  readonly cacheCreationCostPerToken: number | null;
}

export type UsageRateTable = ReadonlyMap<string, UsageModelRate>;

interface LiteLlmEntry {
  readonly input_cost_per_token?: unknown;
  readonly output_cost_per_token?: unknown;
  readonly cache_read_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost?: unknown;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeUsageModelName(model: string): string {
  const normalized = model.trim().toLowerCase();
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

export function parseUsageRateTable(document: unknown): UsageRateTable {
  const rates = new Map<string, UsageModelRate>();
  if (typeof document !== "object" || document === null) return rates;

  for (const [model, rawEntry] of Object.entries(document as Record<string, unknown>)) {
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const entry = rawEntry as LiteLlmEntry;
    const input = finiteNonNegative(entry.input_cost_per_token);
    const output = finiteNonNegative(entry.output_cost_per_token);
    if (input === null || output === null) continue;

    rates.set(normalizeUsageModelName(model), {
      inputCostPerToken: input,
      outputCostPerToken: output,
      cacheReadCostPerToken: finiteNonNegative(entry.cache_read_input_token_cost),
      cacheCreationCostPerToken: finiteNonNegative(entry.cache_creation_input_token_cost),
    });
  }
  return rates;
}

/** Serialize only the validated pricing fields needed by usage estimation. */
export function encodeUsageRateTable(rates: UsageRateTable): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    [...rates].map(([model, rate]) => [
      model,
      {
        input_cost_per_token: rate.inputCostPerToken,
        output_cost_per_token: rate.outputCostPerToken,
        ...(rate.cacheReadCostPerToken === null
          ? {}
          : { cache_read_input_token_cost: rate.cacheReadCostPerToken }),
        ...(rate.cacheCreationCostPerToken === null
          ? {}
          : { cache_creation_input_token_cost: rate.cacheCreationCostPerToken }),
      },
    ]),
  );
}

const UNPRICEABLE_MODEL_NAMES = new Set([
  "",
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
]);

export function lookupUsageModelRate(rates: UsageRateTable, model: string): UsageModelRate | null {
  const normalized = normalizeUsageModelName(model);
  if (UNPRICEABLE_MODEL_NAMES.has(normalized)) return null;
  return rates.get(normalized) ?? null;
}

export function estimateUsageCost(rate: UsageModelRate, totals: UsageTokenTotals): number {
  return (
    totals.uncachedInputTokens * rate.inputCostPerToken +
    totals.cachedInputTokens * (rate.cacheReadCostPerToken ?? 0) +
    totals.cacheCreationInputTokens * (rate.cacheCreationCostPerToken ?? 0) +
    totals.outputTokens * rate.outputCostPerToken
  );
}

export function estimateUsageCacheSavings(
  rate: UsageModelRate,
  totals: UsageTokenTotals,
): number | null {
  if (
    (totals.cachedInputTokens > 0 && rate.cacheReadCostPerToken === null) ||
    (totals.cacheCreationInputTokens > 0 && rate.cacheCreationCostPerToken === null)
  ) {
    return null;
  }
  const cacheReadSavings = Math.max(
    0,
    totals.cachedInputTokens * (rate.inputCostPerToken - (rate.cacheReadCostPerToken ?? 0)),
  );
  const cacheCreationSavings = Math.max(
    0,
    totals.cacheCreationInputTokens *
      (rate.inputCostPerToken - (rate.cacheCreationCostPerToken ?? 0)),
  );
  return cacheReadSavings + cacheCreationSavings;
}

function priceableTokenCounts(
  rate: UsageModelRate,
  totals: UsageTokenTotals,
): { readonly priced: number; readonly unpriced: number } {
  const priced =
    totals.uncachedInputTokens +
    totals.outputTokens +
    (rate.cacheReadCostPerToken === null ? 0 : totals.cachedInputTokens) +
    (rate.cacheCreationCostPerToken === null ? 0 : totals.cacheCreationInputTokens);
  return { priced, unpriced: Math.max(0, totals.totalTokens - priced) };
}

export function priceUsageRecord(rates: UsageRateTable, record: UsageRecord): UsageRecordPrice {
  const rate = lookupUsageModelRate(rates, record.model);
  if (record.reportedCostUsd !== null) {
    return {
      estimatedCostUsd: record.reportedCostUsd,
      estimatedCacheSavingsUsd:
        rate === null ? null : estimateUsageCacheSavings(rate, record.totals),
      pricedTokenCount: record.totals.totalTokens,
      unpricedTokenCount: 0,
      costSource: "provider-reported",
    };
  }
  if (rate === null) {
    return {
      estimatedCostUsd: null,
      estimatedCacheSavingsUsd: null,
      pricedTokenCount: 0,
      unpricedTokenCount: record.totals.totalTokens,
      costSource: "unpriced",
    };
  }
  const coverage = priceableTokenCounts(rate, record.totals);
  if (coverage.priced === 0) {
    return {
      estimatedCostUsd: null,
      estimatedCacheSavingsUsd: null,
      pricedTokenCount: 0,
      unpricedTokenCount: record.totals.totalTokens,
      costSource: "unpriced",
    };
  }
  return {
    estimatedCostUsd: estimateUsageCost(rate, record.totals),
    estimatedCacheSavingsUsd: estimateUsageCacheSavings(rate, record.totals),
    pricedTokenCount: coverage.priced,
    unpricedTokenCount: coverage.unpriced,
    costSource: "litellm",
  };
}
