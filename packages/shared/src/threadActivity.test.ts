import { describe, expect, it } from "vite-plus/test";
import { EventId } from "@ryco/contracts";
import {
  capThreadActivitiesPreservingMilestones,
  isContextCompactionActivity,
  isTerminalContextHandoffActivity,
  isThreadActivityMilestone,
} from "./threadActivity.ts";

function activity(id: string, kind = "tool.completed", payload: unknown = {}) {
  return {
    id: EventId.make(id),
    kind,
    payload,
  };
}

function handoffPayload(status: "consumed" | "failed" | "delivery-uncertain") {
  return {
    schemaVersion: 1,
    handoffId: "handoff-1",
    mode: "full-context-fresh-session",
    targetMessageId: "message-2",
    sourceSelection: { instanceId: "codex_work", model: "gpt-5.6" },
    targetSelection: { instanceId: "claude_work", model: "claude-fable-5" },
    sources: [
      {
        providerInstanceId: "codex_work",
        driverKind: "codex",
        modelSlug: "gpt-5.6",
      },
    ],
    target: {
      providerInstanceId: "claude_work",
      driverKind: "claudeAgent",
      modelSlug: "claude-fable-5",
    },
    ...(status === "failed" ? {} : { contextVersion: 1, contextDigest: "a".repeat(64) }),
    status,
    ...(status === "failed" || status === "delivery-uncertain"
      ? { error: "Target delivery failed" }
      : {}),
  };
}

describe("threadActivity", () => {
  it("identifies context compaction activities", () => {
    expect(isContextCompactionActivity(activity("compaction", "context-compaction"))).toBe(true);
    expect(isContextCompactionActivity(activity("tool"))).toBe(false);
  });

  it("identifies only terminal, schema-valid context handoffs as milestones", () => {
    expect(
      isTerminalContextHandoffActivity(
        activity("handoff", "context-handoff", handoffPayload("consumed")),
      ),
    ).toBe(true);
    expect(
      isTerminalContextHandoffActivity(
        activity("pending", "context-handoff", {
          ...handoffPayload("consumed"),
          status: "preparing",
        }),
      ),
    ).toBe(false);
    expect(isTerminalContextHandoffActivity(activity("malformed", "context-handoff"))).toBe(false);
    expect(
      isThreadActivityMilestone(
        activity("uncertain", "context-handoff", handoffPayload("delivery-uncertain")),
      ),
    ).toBe(true);
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

  it("preserves older terminal handoffs alongside compaction milestones", () => {
    const result = capThreadActivitiesPreservingMilestones(
      [
        activity("old-handoff", "context-handoff", handoffPayload("consumed")),
        activity("old-pending", "context-handoff", {
          ...handoffPayload("consumed"),
          status: "dispatching",
        }),
        activity("old-compaction", "context-compaction"),
        activity("recent-tool-1"),
        activity("recent-tool-2"),
      ],
      2,
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "old-handoff",
      "old-compaction",
      "recent-tool-1",
      "recent-tool-2",
    ]);
  });
});
