import { EventId, TurnId, type OrchestrationThreadActivity } from "@ryco/contracts";
import { describe, expect, it } from "vitest";

import { deriveThreadSubagents, findThreadSubagent } from "./threadWorkspaceViewModel";

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id ?? crypto.randomUUID()),
    createdAt: overrides.createdAt ?? "2026-06-04T10:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Subagent task",
    tone: overrides.tone ?? "tool",
    payload: overrides.payload ?? {},
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("deriveThreadSubagents", () => {
  it("groups subagent lifecycle activities and infers a display name", () => {
    const activities = [
      makeActivity({
        id: "agent-start",
        kind: "tool.started",
        createdAt: "2026-06-04T10:00:00.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          title: "Subagent task",
          detail: "Hilbert: inspect the retry flow",
        },
      }),
      makeActivity({
        id: "agent-done",
        kind: "tool.completed",
        createdAt: "2026-06-04T10:00:03.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "completed",
          title: "Subagent task",
          detail: "Hilbert: inspect the retry flow",
        },
      }),
    ];

    expect(deriveThreadSubagents(activities)).toEqual([
      expect.objectContaining({
        name: "Hilbert",
        status: "finished",
        detail: "Hilbert: inspect the retry flow",
      }),
    ]);
  });

  it("uses structured subagent metadata when available", () => {
    const activities = [
      makeActivity({
        id: "agent-start",
        kind: "tool.started",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          title: "Subagent task",
          detail: "Find failing checks",
          data: {
            input: {
              subagent_type: "code-reviewer",
              description: "Find failing checks",
            },
          },
        },
      }),
    ];

    expect(deriveThreadSubagents(activities)[0]).toMatchObject({
      name: "Code Reviewer",
      status: "running",
      detail: "Find failing checks",
    });
  });

  it("attaches collapsed work-log entries back to lifecycle rows", () => {
    const activities = [
      makeActivity({
        id: "agent-start",
        kind: "tool.started",
        createdAt: "2026-06-04T10:00:00.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          detail: "Hilbert: inspect the retry flow",
          data: {
            toolCallId: "toolu-1",
          },
        },
      }),
      makeActivity({
        id: "agent-done",
        kind: "tool.completed",
        createdAt: "2026-06-04T10:00:05.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "completed",
          detail: "Hilbert: inspect the retry flow",
          data: {
            toolCallId: "toolu-1",
          },
        },
      }),
    ];

    const [subagent] = deriveThreadSubagents(activities);

    expect(subagent?.entries).toHaveLength(1);
    expect(subagent?.entries[0]?.detail).toBe("Hilbert: inspect the retry flow");
  });
});

describe("findThreadSubagent", () => {
  it("returns the keyed subagent", () => {
    const subagents = deriveThreadSubagents([
      makeActivity({
        id: "agent",
        payload: {
          itemType: "collab_agent_tool_call",
          detail: "Hilbert: inspect the retry flow",
        },
      }),
    ]);

    expect(findThreadSubagent(subagents, subagents[0]?.key)).toBe(subagents[0]);
    expect(findThreadSubagent(subagents, "missing")).toBeNull();
  });
});
