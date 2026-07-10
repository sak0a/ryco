import { describe, expect, it } from "vite-plus/test";
import * as CodexSchema from "effect-codex-app-server/schema";

import { parseCodexModelListResponse, parseCodexRateLimits } from "./CodexProvider.ts";

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

describe("parseCodexModelListResponse", () => {
  it("maps GPT-5.6 max and ultra reasoning efforts into selectable model capabilities", () => {
    const models = parseCodexModelListResponse({
      data: [
        {
          defaultReasoningEffort: "max",
          description: "Frontier model for complex professional work",
          displayName: "gpt-5.6-sol",
          hidden: false,
          id: "gpt-5.6-sol",
          isDefault: true,
          model: "gpt-5.6-sol",
          supportedReasoningEfforts: [
            { reasoningEffort: "none", description: "No reasoning" },
            { reasoningEffort: "low", description: "Low reasoning" },
            { reasoningEffort: "medium", description: "Medium reasoning" },
            { reasoningEffort: "high", description: "High reasoning" },
            { reasoningEffort: "xhigh", description: "Extra high reasoning" },
            { reasoningEffort: "max", description: "Maximum reasoning" },
            { reasoningEffort: "ultra", description: "Ultra reasoning" },
          ],
        },
      ],
    } satisfies CodexSchema.V2ModelListResponse);

    expect(models[0]).toMatchObject({
      slug: "gpt-5.6-sol",
      name: "GPT-5.6-Sol",
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            currentValue: "max",
            options: [
              { id: "none", label: "None" },
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium" },
              { id: "high", label: "High" },
              { id: "xhigh", label: "Extra High" },
              { id: "max", label: "Max", isDefault: true },
              { id: "ultra", label: "Ultra" },
            ],
          },
        ],
      },
    });
  });

  it("formats unknown future reasoning efforts instead of dropping labels", () => {
    const models = parseCodexModelListResponse({
      data: [
        {
          defaultReasoningEffort: "ultra-deep",
          description: "Future model",
          displayName: "future-model",
          hidden: false,
          id: "future-model",
          isDefault: false,
          model: "future-model",
          supportedReasoningEfforts: [
            { reasoningEffort: "ultra-deep", description: "Future effort" },
          ],
        },
      ],
    } satisfies CodexSchema.V2ModelListResponse);

    const descriptor = models[0]!.capabilities!.optionDescriptors![0];
    expect(descriptor).toMatchObject({
      currentValue: "ultra-deep",
      options: [{ id: "ultra-deep", label: "Ultra Deep", isDefault: true }],
    });
  });
});
