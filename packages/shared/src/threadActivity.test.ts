import { describe, expect, it } from "vitest";
import { EventId } from "@ryco/contracts";
import {
  capThreadActivitiesPreservingMilestones,
  isContextCompactionActivity,
} from "./threadActivity.ts";

function activity(id: string, kind = "tool.completed") {
  return {
    id: EventId.make(id),
    kind,
  };
}

describe("threadActivity", () => {
  it("identifies context compaction activities", () => {
    expect(isContextCompactionActivity(activity("compaction", "context-compaction"))).toBe(true);
    expect(isContextCompactionActivity(activity("tool"))).toBe(false);
  });

  it("caps recent activities while preserving older context compaction milestones", () => {
    const result = capThreadActivitiesPreservingMilestones(
      [
        activity("old-tool-1"),
        activity("old-compaction", "context-compaction"),
        activity("old-tool-2"),
        activity("recent-tool-1"),
        activity("recent-tool-2"),
      ],
      2,
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "old-compaction",
      "recent-tool-1",
      "recent-tool-2",
    ]);
  });
});
