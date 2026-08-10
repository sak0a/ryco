import { describe, expect, it } from "vite-plus/test";

import type { UsageRecord } from "./usageRecord.ts";
import {
  lookupUsageModelRate,
  normalizeUsageModelName,
  parseUsageRateTable,
  priceUsageRecord,
} from "./usagePricing.ts";

const record: UsageRecord = {
  provider: "claude",
  timestampMs: 0,
  model: "anthropic/CLAUDE-SONNET-4-5-20250929",
  sessionId: "session-a",
  totals: {
    uncachedInputTokens: 100,
    cachedInputTokens: 1000,
    cacheCreationInputTokens: 10,
    outputTokens: 50,
    reasoningTokens: 0,
    totalTokens: 1160,
  },
  reportedCostUsd: null,
  dedupeKey: null,
};

const rates = parseUsageRateTable({
  "claude-sonnet-4-5-20250929": {
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00005,
    cache_read_input_token_cost: 0.000001,
    cache_creation_input_token_cost: 0.0000125,
  },
  partial: { input_cost_per_token: 1 },
  "no-cache-rates": {
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00005,
  },
});

describe("usage pricing", () => {
  it("normalizes provider prefixes and rejects partial rate entries", () => {
    expect(normalizeUsageModelName(" Anthropic/Claude-SONNET ")).toBe("claude-sonnet");
    expect(lookupUsageModelRate(rates, record.model)).not.toBeNull();
    expect(lookupUsageModelRate(rates, "partial")).toBeNull();
  });

  it("prices each token class and estimates cache savings", () => {
    const priced = priceUsageRecord(rates, record);

    expect(priced.estimatedCostUsd).toBeCloseTo(0.004625, 9);
    expect(priced.estimatedCacheSavingsUsd).toBeCloseTo(0.009, 9);
    expect(priced.costSource).toBe("litellm");
    expect(priced.pricedTokenCount).toBe(1160);
  });

  it("prefers provider-reported cost while retaining rate-based cache savings", () => {
    const priced = priceUsageRecord(rates, { ...record, reportedCostUsd: 1.25 });
    expect(priced.estimatedCostUsd).toBe(1.25);
    expect(priced.costSource).toBe("provider-reported");
    expect(priced.estimatedCacheSavingsUsd).toBeCloseTo(0.009, 9);
  });

  it("does not silently price cache categories at the ordinary input rate", () => {
    const priced = priceUsageRecord(rates, { ...record, model: "no-cache-rates" });
    expect(priced.estimatedCostUsd).toBeCloseTo(0.0035, 9);
    expect(priced.estimatedCacheSavingsUsd).toBeNull();
    expect(priced.pricedTokenCount).toBe(150);
    expect(priced.unpricedTokenCount).toBe(1010);
  });

  it("keeps tokens but leaves unknown and ambiguous model families unpriced", () => {
    for (const model of ["kimi-k3", "sonnet", "<synthetic>"]) {
      const priced = priceUsageRecord(rates, { ...record, model });
      expect(priced.estimatedCostUsd).toBeNull();
      expect(priced.pricedTokenCount).toBe(0);
      expect(priced.unpricedTokenCount).toBe(1160);
      expect(priced.costSource).toBe("unpriced");
    }
  });
});
