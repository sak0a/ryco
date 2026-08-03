import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@ryco/contracts";

import {
  createInitialContextWindowUsage,
  deriveContextWindowUsage,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  parseContextWindowTokenLimit,
} from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("parses configured context window limits", () => {
    expect(parseContextWindowTokenLimit("200k")).toBe(200_000);
    expect(parseContextWindowTokenLimit("1M")).toBe(1_000_000);
    expect(parseContextWindowTokenLimit("1.5m")).toBe(1_500_000);
    expect(parseContextWindowTokenLimit("258000")).toBe(258_000);
  });

  it("treats malformed, non-positive, and unsupported context limits as unknown", () => {
    expect(parseContextWindowTokenLimit(null)).toBeNull();
    expect(parseContextWindowTokenLimit("0")).toBeNull();
    expect(parseContextWindowTokenLimit("1.5")).toBeNull();
    expect(parseContextWindowTokenLimit("200kb")).toBeNull();
  });

  it("creates an initial zero-usage state with or without a known limit", () => {
    expect(createInitialContextWindowUsage(200_000)).toMatchObject({
      usedTokens: 0,
      maxTokens: 200_000,
      remainingTokens: 200_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
    expect(createInitialContextWindowUsage(null)).toMatchObject({
      usedTokens: 0,
      maxTokens: null,
      remainingTokens: null,
      usedPercentage: null,
      remainingPercentage: null,
    });
  });

  it("prefers real provider usage over the configured initial limit", () => {
    const usage = deriveContextWindowUsage(
      [
        makeActivity("activity-1", "context-window.updated", {
          usedTokens: 14_000,
          maxTokens: 258_000,
        }),
      ],
      "1m",
    );

    expect(usage.usedTokens).toBe(14_000);
    expect(usage.maxTokens).toBe(258_000);
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });
});
