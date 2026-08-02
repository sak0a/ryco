import { describe, expect, it } from "vite-plus/test";
import { EventId } from "@ryco/contracts";
import {
  capThreadActivitiesPreservingMilestones,
  derivePendingThreadRequestState,
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

  it("derives pending approval and user-input request state in activity order", () => {
    const requestActivity = (
      id: string,
      kind: string,
      requestId: string,
      createdAt: string,
      detail?: string,
    ) => ({
      id: EventId.make(id),
      kind,
      createdAt,
      payload: {
        requestId,
        ...(detail ? { detail } : {}),
      },
    });

    expect(
      derivePendingThreadRequestState([
        requestActivity(
          "approval-open",
          "approval.requested",
          "approval-1",
          "2026-01-01T00:00:00Z",
        ),
        requestActivity("input-open", "user-input.requested", "input-1", "2026-01-01T00:00:01Z"),
        requestActivity(
          "approval-stale",
          "provider.approval.respond.failed",
          "approval-1",
          "2026-01-01T00:00:02Z",
          "Unknown pending approval request",
        ),
        requestActivity("input-resolved", "user-input.resolved", "input-1", "2026-01-01T00:00:03Z"),
        requestActivity(
          "approval-open-2",
          "approval.requested",
          "approval-2",
          "2026-01-01T00:00:04Z",
        ),
      ]),
    ).toEqual({
      pendingApprovalCount: 1,
      pendingUserInputCount: 0,
      hasPendingApprovals: true,
      hasPendingUserInput: false,
    });
  });
});
