import type { WorkItemActivityEntry, WorkItemComment } from "@ryco/contracts";
import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  filterWorkItemActivityEntries,
  isWorkItemTransitionActivity,
  workItemActivityCounts,
} from "./WorkItemDetail.logic";

const now = DateTime.fromDateUnsafe(new Date("2026-06-09T10:00:00.000Z"));

function activity(id: string, field: string): WorkItemActivityEntry {
  return {
    id,
    createdAt: now,
    items: [{ field, from: "Old", to: "New" }],
  };
}

function comment(id: string): WorkItemComment {
  return {
    id,
    author: "Jira",
    body: "Comment",
    createdAt: now,
  };
}

describe("WorkItemDetail activity filtering", () => {
  it("classifies Jira status-like changelog rows as transitions", () => {
    expect(isWorkItemTransitionActivity(activity("1", "status"))).toBe(true);
    expect(isWorkItemTransitionActivity(activity("2", "Resolution"))).toBe(true);
    expect(isWorkItemTransitionActivity(activity("3", "priority"))).toBe(false);
  });

  it("counts comments, history, transitions, and all activity", () => {
    const counts = workItemActivityCounts({
      comments: [comment("c1"), comment("c2")],
      activity: [activity("a1", "priority"), activity("a2", "status")],
    });

    expect(counts).toEqual({
      comments: 2,
      history: 1,
      transitions: 1,
      all: 4,
    });
  });

  it("filters changelog activity by selected activity tab", () => {
    const entries = [activity("a1", "priority"), activity("a2", "status")];

    expect(filterWorkItemActivityEntries({ activity: entries, filter: "comments" })).toEqual([]);
    expect(filterWorkItemActivityEntries({ activity: entries, filter: "history" })).toEqual([
      entries[0],
    ]);
    expect(filterWorkItemActivityEntries({ activity: entries, filter: "transitions" })).toEqual([
      entries[1],
    ]);
    expect(filterWorkItemActivityEntries({ activity: entries, filter: "all" })).toEqual(entries);
  });
});
