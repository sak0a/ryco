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

  it("uses provider-specific aliases before global canonical slugs", () => {
    expect(canonicalizeModel("gpt-5.4", "codex")).toBe("gpt-5.4");
    expect(canonicalizeModel("gpt-5.4", "copilot")).toBe("gpt-5");
    expect(canonicalizeModel("composer-1", "cursor")).toBe("composer-1.5");
  });
});

describe("estimateCostUsd", () => {
  it("prices known models per-bucket", () => {
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 },
      "gpt-5.4",
    );
    expect(cost).toBeCloseTo(17.5, 5); // $2.50 input + $15 output

    // Cached input is billed at the cache-read rate (Opus 4.8: $5 / $0.50 / $25).
    const opus = estimateCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 },
      "claude-opus-4-8",
    );
    expect(opus).toBeCloseTo(25.5, 5); // cached input is a discounted subset of input

    const mixedInput = estimateCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 0 },
      "gpt-5.4",
    );
    expect(mixedInput).toBeCloseTo(1.6, 5); // 600k * $2.50 + 400k * $0.25
  });

  it("returns null for genuinely unknown models", () => {
    expect(getModelPrice("totally-made-up-model")).toBeNull();
    expect(
      estimateCostUsd(
        { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 },
        "totally-made-up-model",
      ),
    ).toBeNull();
  });

  it("does not price total-only usage without an input/output breakdown", () => {
    expect(
      estimateCostUsd(
        { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 10_000 },
        "gpt-5.4",
      ),
    ).toBeNull();
  });

  it("prices models across providers (incl. provider-prefixed slugs)", () => {
    expect(getModelPrice("composer-2.5")).not.toBeNull();
    expect(getModelPrice("gemini-3-pro")).not.toBeNull();
    expect(getModelPrice("google/gemini-2.5-flash")).not.toBeNull();
    expect(getModelPrice("deepseek/deepseek-chat")).not.toBeNull();
    expect(getModelPrice("grok-build-0.1")).not.toBeNull();
    expect(getModelPrice("grok-code-fast-1")).not.toBeNull();
    expect(getModelPrice("moonshotai/kimi-k2.6")).not.toBeNull();
  });

  it("prices ambiguous model slugs with provider-specific aliases", () => {
    const tokens = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 };
    expect(estimateCostUsd(tokens, "gpt-5.4", "codex")).toBeCloseTo(17.5, 5);
    expect(estimateCostUsd(tokens, "gpt-5.4", "copilot")).toBeCloseTo(11.25, 5);
  });

  it("matches dated / preview router slugs via suffix fallback", () => {
    expect(getModelPrice("gemini-3-pro-preview")).toEqual(getModelPrice("gemini-3-pro"));
    expect(getModelPrice("claude-opus-4-8-20260101")).toEqual(getModelPrice("claude-opus-4-8"));
    // But pricing-relevant suffixes are preserved (mini ≠ base).
    expect(getModelPrice("gpt-5.4-mini")).not.toEqual(getModelPrice("gpt-5.4"));
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
