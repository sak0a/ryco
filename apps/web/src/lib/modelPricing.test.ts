import { describe, expect, it } from "vite-plus/test";

import { canonicalizeModel, estimateCostUsd, formatUsd, getModelPrice } from "./modelPricing";
import { formatModelLabel } from "./statisticsFormat";

describe("canonicalizeModel", () => {
  it("keeps canonical/default slugs intact despite cross-provider alias collisions", () => {
    // The Copilot alias map maps "gpt-5.4" -> "gpt-5", but gpt-5.4 is the
    // canonical (default) Codex model and must stay itself.
    expect(canonicalizeModel("gpt-5.4")).toBe("gpt-5.4");
    expect(canonicalizeModel("gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(canonicalizeModel("claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  it("strips provider prefixes", () => {
    expect(canonicalizeModel("openai/gpt-5")).toBe("gpt-5");
  });

  it("resolves real aliases to canonical slugs", () => {
    expect(canonicalizeModel("opus")).toBe("claude-opus-4-8");
    expect(canonicalizeModel("sonnet")).toBe("claude-sonnet-4-6");
  });
});

describe("estimateCostUsd", () => {
  it("prices known models per-bucket", () => {
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 },
      "gpt-5.4",
    );
    expect(cost).toBeCloseTo(11.25, 5); // 1.25 input + 10 output
  });

  it("returns null for subscription/unknown models", () => {
    expect(getModelPrice("composer-2")).toBeNull();
    expect(
      estimateCostUsd({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 }, "composer-2"),
    ).toBeNull();
  });
});

describe("formatUsd", () => {
  it("formats across thresholds", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(2500)).toBe("$2,500");
  });
});

describe("formatModelLabel", () => {
  it("renders default + common models correctly (gpt-5.4 mislabel regression)", () => {
    expect(formatModelLabel("gpt-5.4")).toBe("GPT 5.4");
    expect(formatModelLabel("gpt-5.4-mini")).toBe("GPT 5.4 Mini");
    expect(formatModelLabel("claude-opus-4-8")).toBe("Claude Opus 4.8");
    expect(formatModelLabel("claude-haiku-4-5")).toBe("Claude Haiku 4.5");
    expect(formatModelLabel("composer-2")).toBe("Composer 2");
  });
});
