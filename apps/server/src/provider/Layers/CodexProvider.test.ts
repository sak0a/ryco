import { describe, expect, it } from "vitest";
import * as CodexSchema from "effect-codex-app-server/schema";

import { parseCodexRateLimits } from "./CodexProvider.ts";

const baseResponse = (
  rateLimits: CodexSchema.V2GetAccountRateLimitsResponse__RateLimitSnapshot,
): CodexSchema.V2GetAccountRateLimitsResponse => ({ rateLimits });

describe("parseCodexRateLimits", () => {
  it("normalizes the upstream snapshot into the contract shape", () => {
    const result = parseCodexRateLimits(
      baseResponse({
        limitId: "primary",
        limitName: "ChatGPT Pro",
        planType: "pro",
        primary: {
          usedPercent: 42,
          resetsAt: 1_700_000_000,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 7,
          windowDurationMins: 7 * 24 * 60,
        },
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: "$12.50",
        },
        rateLimitReachedType: "rate_limit_reached",
      }),
    );

    expect(result).toEqual({
      limitId: "primary",
      limitName: "ChatGPT Pro",
      planType: "pro",
      primary: {
        usedPercent: 42,
        resetsAt: 1_700_000_000,
        windowDurationMins: 300,
      },
      secondary: {
        usedPercent: 7,
        windowDurationMins: 7 * 24 * 60,
      },
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "$12.50",
      },
      rateLimitReachedType: "rate_limit_reached",
    });
  });

  it("drops null window fields rather than forwarding them", () => {
    const result = parseCodexRateLimits(
      baseResponse({
        primary: {
          usedPercent: 10,
          resetsAt: null,
          windowDurationMins: null,
        },
      }),
    );

    expect(result).toEqual({
      primary: { usedPercent: 10 },
    });
  });

  it("returns undefined when no usage data is present", () => {
    expect(parseCodexRateLimits(baseResponse({}))).toBeUndefined();
    expect(
      parseCodexRateLimits(
        baseResponse({
          limitName: "ChatGPT Pro",
          planType: "pro",
        }),
      ),
    ).toBeUndefined();
  });

  it("retains credits even when usage windows are absent", () => {
    expect(
      parseCodexRateLimits(
        baseResponse({
          credits: {
            hasCredits: false,
            unlimited: true,
          },
        }),
      ),
    ).toEqual({
      credits: { hasCredits: false, unlimited: true },
    });
  });
});
