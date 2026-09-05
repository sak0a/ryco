import type { OrchestrationThreadActivity } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pruneStaleContextWindowActivities } from "./contextWindowActivities.ts";

function activity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: id as OrchestrationThreadActivity["id"],
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: null,
    createdAt: `2026-08-02T00:00:0${id}.000Z`,
  };
}

describe("pruneStaleContextWindowActivities", () => {
  it("keeps only the latest valid context gauge without reordering other activity", () => {
    const result = pruneStaleContextWindowActivities([
      activity("1", "context-window.updated", { usedTokens: 100 }),
      activity("2", "tool.completed", { name: "test" }),
      activity("3", "context-window.updated", { usedTokens: 200 }),
      activity("4", "context-window.updated", {}),
      activity("5", "message.note", {}),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(["2", "3", "5"]);
  });

  it("removes unusable context gauges when no valid value exists", () => {
    const result = pruneStaleContextWindowActivities([
      activity("1", "context-window.updated", { usedTokens: -1 }),
      activity("2", "context-window.updated", { usedTokens: Number.NaN }),
      activity("3", "tool.completed", {}),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(["3"]);
  });
  it("retains an explicit zero reset instead of stale usage", () => {
    const result = pruneStaleContextWindowActivities([
      activity("1", "context-window.updated", { usedTokens: 100 }),
      activity("2", "context-window.updated", { usedTokens: 0, maxTokens: 128_000 }),
    ]);
    expect(result.map((entry) => entry.id)).toEqual(["2"]);
  });
});
