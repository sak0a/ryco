import type { UsageRecord } from "./usageRecord.ts";

import { describe, expect, it } from "vite-plus/test";

import { UsageAggregator } from "./usageAggregation.ts";

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    // This instant is August 6 in Los Angeles.
    timestampMs: Date.parse("2026-08-07T04:05:13.944Z"),
    model: "claude-sonnet-4-5-20250929",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationInputTokens: 10,
      outputTokens: 50,
      reasoningTokens: 25,
      totalTokens: 1160,
    },
    reportedCostUsd: null,
    dedupeKey: null,
    ...overrides,
  };
}

function aggregate(records: readonly UsageRecord[], timeZone = "UTC") {
  const aggregator = new UsageAggregator({
    sourceId: "source-a",
    timeZone,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });
  for (const item of records) aggregator.add(item);
  return aggregator.finish();
}

describe("UsageAggregator", () => {
  it("deduplicates Claude identities globally across files", () => {
    const result = aggregate([
      record({ dedupeKey: "msg_1:req_1" }),
      record({ dedupeKey: "msg_1:req_1" }),
      record({ dedupeKey: "msg_1:req_1" }),
    ]);

    expect(result.duplicatesDropped).toBe(2);
    expect(result.acceptedRecords).toBe(1);
    expect(result.buckets[0]?.tokens.outputTokens).toBe(50);
  });

  it("sums inherently unique records and does not add reasoning twice", () => {
    const result = aggregate([record(), record()]);

    expect(result.buckets[0]?.tokens.reasoningTokens).toBe(50);
    expect(result.buckets[0]?.tokens.totalTokens).toBe(2320);
    expect(result.buckets[0]?.responseCount).toBe(2);
    expect(result.buckets[0]?.sessionCount).toBe(1);
  });

  it("buckets by the caller's IANA time zone", () => {
    expect(aggregate([record()], "UTC").buckets[0]?.date).toBe("2026-08-07");
    expect(aggregate([record()], "America/Los_Angeles").buckets[0]?.date).toBe("2026-08-06");
  });

  it("preserves provider-reported costs and marks unpriced token coverage", () => {
    const result = aggregate([record({ reportedCostUsd: 1.25 }), record()]);
    const bucket = result.buckets[0];

    expect(bucket?.estimatedCostUsd).toBe(1.25);
    expect(bucket?.costSource).toBe("mixed");
    expect(bucket?.pricedTokenCount).toBe(1160);
    expect(bucket?.unpricedTokenCount).toBe(1160);
  });

  it("accepts an injected model pricer", () => {
    const aggregator = new UsageAggregator({
      sourceId: "source-a",
      timeZone: "UTC",
      endDate: "2026-08-31",
      price: (item) => ({
        estimatedCostUsd: 0.5,
        estimatedCacheSavingsUsd: 0.75,
        pricedTokenCount: item.totals.totalTokens,
        unpricedTokenCount: 0,
        costSource: "litellm",
      }),
    });
    aggregator.add(record());
    const bucket = aggregator.finish().buckets[0];

    expect(bucket?.estimatedCostUsd).toBe(0.5);
    expect(bucket?.estimatedCacheSavingsUsd).toBe(0.75);
    expect(bucket?.costSource).toBe("litellm");
  });

  it("drops records outside either edge of the requested window", () => {
    const result = aggregate([
      record({ timestampMs: Date.parse("2026-07-31T12:00:00Z") }),
      record({ timestampMs: Date.parse("2026-09-01T12:00:00Z") }),
    ]);

    expect(result.outOfWindow).toBe(2);
    expect(result.buckets).toHaveLength(0);
  });

  it("throws for an invalid time zone so the RPC can return a typed error", () => {
    expect(
      () =>
        new UsageAggregator({
          sourceId: "source-a",
          timeZone: "Mars/Olympus_Mons",
          endDate: "2026-08-31",
        }),
    ).toThrow();
  });
});
