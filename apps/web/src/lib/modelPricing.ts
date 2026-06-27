import { MODEL_SLUG_ALIASES_BY_PROVIDER } from "@ryco/contracts";

/**
 * Approximate per-token pricing used to estimate spend on the Statistics
 * dashboard.
 *
 * ⚠️ These are ESTIMATES, expressed in USD per 1,000,000 tokens, and need
 * occasional upkeep as providers change pricing. Models authenticated via a
 * subscription/OAuth plan (e.g. Cursor Composer) deliberately have no entry —
 * a per-token cost is meaningless there, so the UI shows "—" instead of a
 * misleading dollar figure.
 */
export interface ModelPrice {
  readonly inputPer1M: number;
  readonly cachedInputPer1M: number;
  readonly outputPer1M: number;
}

// Flatten the per-provider alias maps into a single alias→canonical lookup so we
// can canonicalize a model slug even when the provider isn't known at the call
// site (the dashboard groups by the thread's stored model slug).
//
// Aliases that resolve to DIFFERENT canonical slugs across providers (e.g. "5.4"
// is gpt-5.4 for Codex but gpt-5 for Copilot) are ambiguous without provider
// context, so we drop them rather than resolve by arbitrary insertion order —
// the flattened fallback only covers globally-unambiguous aliases.
const FLAT_ALIASES: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const ambiguous = new Set<string>();
  for (const map of Object.values(MODEL_SLUG_ALIASES_BY_PROVIDER)) {
    if (!map) continue;
    for (const [alias, canonical] of Object.entries(map)) {
      const existing = out[alias];
      if (existing !== undefined && existing !== canonical) {
        ambiguous.add(alias);
      } else {
        out[alias] = canonical;
      }
    }
  }
  for (const alias of ambiguous) {
    delete out[alias];
  }
  return out;
})();

/** USD per 1,000,000 tokens, keyed by canonical model slug. Edit as needed. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI / Codex tier
  "gpt-5.4": { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10 },
  "gpt-5.4-mini": { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2 },
  "gpt-5.3-codex": { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10 },
  "gpt-5.3-codex-spark": { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10 },
  "gpt-5": { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10 },
  "gpt-5-mini": { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2 },
  // Anthropic / Claude tier
  "claude-opus-4-8": { inputPer1M: 15, cachedInputPer1M: 1.5, outputPer1M: 75 },
  "claude-opus-4-7": { inputPer1M: 15, cachedInputPer1M: 1.5, outputPer1M: 75 },
  "claude-opus-4-6": { inputPer1M: 15, cachedInputPer1M: 1.5, outputPer1M: 75 },
  "claude-opus-4-5": { inputPer1M: 15, cachedInputPer1M: 1.5, outputPer1M: 75 },
  "claude-sonnet-4-6": { inputPer1M: 3, cachedInputPer1M: 0.3, outputPer1M: 15 },
  "claude-haiku-4-5": { inputPer1M: 0.8, cachedInputPer1M: 0.08, outputPer1M: 4 },
  "claude-fable-5": { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10 },
};

// Slugs that are themselves canonical: every priced model plus every alias
// TARGET. A canonical slug must never be rewritten by a colliding alias KEY from
// another provider — e.g. the Copilot map aliases "gpt-5.4" → "gpt-5", but
// "gpt-5.4" is the canonical (and default) Codex model and must stay itself.
const CANONICAL_SLUGS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(MODEL_PRICES),
  ...Object.values(MODEL_SLUG_ALIASES_BY_PROVIDER).flatMap((map) =>
    map ? Object.values(map) : [],
  ),
]);

export function canonicalizeModel(model: string): string {
  const trimmed = model.trim();
  // Strip a provider prefix like "openai/gpt-5" → "gpt-5".
  const stripped = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  if (CANONICAL_SLUGS.has(trimmed)) return trimmed;
  if (CANONICAL_SLUGS.has(stripped)) return stripped;
  return FLAT_ALIASES[trimmed] ?? FLAT_ALIASES[stripped] ?? stripped;
}

export function getModelPrice(model: string): ModelPrice | null {
  return MODEL_PRICES[canonicalizeModel(model)] ?? null;
}

export interface TokenTotals {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

/**
 * Estimate spend for one model's token totals. Input, cached-input and output
 * are treated as separate buckets (matching how providers report them).
 * Returns `null` when the model has no known per-token price.
 */
export function estimateCostUsd(tokens: TokenTotals, model: string): number | null {
  const price = getModelPrice(model);
  if (!price) {
    return null;
  }
  return (
    (tokens.inputTokens * price.inputPer1M +
      tokens.cachedInputTokens * price.cachedInputPer1M +
      tokens.outputTokens * price.outputPer1M) /
    1_000_000
  );
}

export interface AggregateCost {
  /** Total estimated spend across all priced models, in USD. */
  readonly usd: number;
  /** True when at least one model contributing tokens has no known price. */
  readonly hasUnpriced: boolean;
}

/** Sum estimated spend across many per-model token totals. */
export function estimateAggregateCost(
  rows: ReadonlyArray<TokenTotals & { readonly model: string }>,
): AggregateCost {
  let usd = 0;
  let hasUnpriced = false;
  for (const row of rows) {
    const cost = estimateCostUsd(row, row.model);
    if (cost === null) {
      if (row.inputTokens > 0 || row.outputTokens > 0 || row.cachedInputTokens > 0) {
        hasUnpriced = true;
      }
      continue;
    }
    usd += cost;
  }
  return { usd, hasUnpriced };
}

export function formatUsd(amount: number): string {
  if (amount <= 0) {
    return "$0.00";
  }
  if (amount < 0.01) {
    return "<$0.01";
  }
  if (amount < 1000) {
    return `$${amount.toFixed(2)}`;
  }
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}
