import { EventId, TurnId, type OrchestrationThreadActivity } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

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

  it("assigns stable fallback names and accent colors when provider metadata has no name", () => {
    const activities = [
      makeActivity({
        id: "agent-one",
        sequence: 1,
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          data: {
            toolCallId: "toolu-one",
          },
        },
      }),
      makeActivity({
        id: "agent-two",
        sequence: 2,
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          data: {
            toolCallId: "toolu-two",
          },
        },
      }),
    ];

    const firstPass = deriveThreadSubagents(activities);
    const secondPass = deriveThreadSubagents(activities.toReversed());
    const identity = (subagent: (typeof firstPass)[number]) => ({
      key: subagent.key,
      name: subagent.name,
      accentColor: subagent.accentColor,
    });

    expect(firstPass).toHaveLength(2);
    expect(firstPass.map((subagent) => subagent.name)).not.toContain("Subagent 1");
    expect(new Set(firstPass.map((subagent) => subagent.name)).size).toBe(2);
    expect(firstPass.every((subagent) => /^#[0-9a-f]{6}$/i.test(subagent.accentColor))).toBe(true);
    expect(secondPass.map(identity)).toEqual(firstPass.map(identity));
  });

  it("uses Codex collab metadata and attaches child agent messages", () => {
    const activities = [
      makeActivity({
        id: "agent-start",
        kind: "tool.started",
        createdAt: "2026-06-04T10:00:00.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          providerItemId: "collab-1",
          data: {
            item: {
              type: "collabAgentToolCall",
              id: "collab-1",
              tool: "spawnAgent",
              prompt: "You are a researcher. Inspect the retry flow.",
              receiverThreadIds: ["child-thread-1"],
              senderThreadId: "parent-thread",
              status: "inProgress",
              agentsStates: {
                "child-thread-1": {
                  status: "running",
                  message: "Inspecting retry paths",
                },
              },
            },
          },
        },
      }),
      makeActivity({
        id: "child-message",
        kind: "agent.message",
        createdAt: "2026-06-04T10:00:04.000Z",
        payload: {
          itemType: "assistant_message",
          providerThreadId: "child-thread-1",
          providerItemId: "msg-child-1",
          text: "The retry flow drops partial stream state.",
        },
      }),
    ];

    expect(deriveThreadSubagents(activities)[0]).toMatchObject({
      key: "subagent:collab-1",
      name: "Researcher",
      status: "running",
      tool: "spawnAgent",
      detail: "You are a researcher. Inspect the retry flow.",
      providerThreadIds: ["child-thread-1"],
      messages: [
        {
          id: "msg-child-1",
          text: "The retry flow drops partial stream state.",
          providerThreadId: "child-thread-1",
        },
      ],
    });
  });

  it("does not attach unrelated agent messages to a subagent", () => {
    const activities = [
      makeActivity({
        id: "agent-start",
        kind: "tool.started",
        payload: {
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              type: "collabAgentToolCall",
              id: "collab-1",
              tool: "spawnAgent",
              prompt: "Investigate failures",
              receiverThreadIds: ["child-thread-1"],
              senderThreadId: "parent-thread",
              status: "completed",
              agentsStates: {},
            },
          },
        },
      }),
      makeActivity({
        id: "main-message",
        kind: "agent.message",
        payload: {
          itemType: "assistant_message",
          providerThreadId: "parent-thread",
          providerItemId: "msg-main",
          text: "Main assistant answer.",
        },
      }),
    ];

    expect(deriveThreadSubagents(activities)[0]?.messages).toEqual([]);
  });

  it("uses lifecycle completion even when nested Codex agent state is stale", () => {
    const activities = [
      makeActivity({
        id: "agent-done",
        kind: "tool.completed",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "completed",
          data: {
            item: {
              type: "collabAgentToolCall",
              id: "collab-1",
              tool: "spawnAgent",
              prompt: "You are a researcher. Inspect the retry flow.",
              receiverThreadIds: ["child-thread-1"],
              status: "inProgress",
              agentsStates: {
                "child-thread-1": {
                  status: "running",
                },
              },
            },
          },
        },
      }),
    ];

    expect(deriveThreadSubagents(activities)[0]).toMatchObject({
      status: "finished",
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
