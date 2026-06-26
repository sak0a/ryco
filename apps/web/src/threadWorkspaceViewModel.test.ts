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
  it("groups subagent lifecycle activities, infers a role, and assigns a codename", () => {
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

    const subagents = deriveThreadSubagents(activities);
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({
      role: "Hilbert",
      status: "finished",
      detail: "Hilbert: inspect the retry flow",
    });
    // The primary name is always an abstract codename, never the inferred role.
    expect(subagents[0]?.name).toMatch(/^[A-Z][A-Za-z]+( \d+)?$/);
    expect(subagents[0]?.name).not.toBe("Hilbert");
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
      role: "Code Reviewer",
      status: "running",
      detail: "Find failing checks",
    });
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
      role: "Researcher",
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

  it("groups canonical subagent lifecycle activities and attaches message deltas", () => {
    const activities = [
      makeActivity({
        id: "subagent-start",
        kind: "subagent.started",
        createdAt: "2026-06-04T10:00:00.000Z",
        payload: {
          itemType: "subagent",
          subagent: {
            subagentId: "managed-1",
            origin: "native",
            capability: "transcript",
            label: "Cache Inspector",
            description: "Inspect the cache eviction path.",
            providerThreadId: "provider-child-1",
            providerSessionId: "session-child-1",
          },
          status: "running",
        },
      }),
      makeActivity({
        id: "subagent-progress",
        kind: "subagent.updated",
        createdAt: "2026-06-04T10:00:03.000Z",
        payload: {
          itemType: "subagent",
          subagent: {
            subagentId: "managed-1",
            origin: "native",
            capability: "transcript",
          },
          status: "running",
          summary: "Reading cache invalidation code.",
          lastToolName: "read",
        },
      }),
      makeActivity({
        id: "subagent-message",
        kind: "subagent.message.delta",
        createdAt: "2026-06-04T10:00:04.000Z",
        payload: {
          subagentId: "managed-1",
          providerThreadId: "provider-child-1",
          providerItemId: "message-1",
          text: "The eviction path skips stale keys.",
        },
      }),
      makeActivity({
        id: "subagent-complete",
        kind: "subagent.completed",
        createdAt: "2026-06-04T10:00:05.000Z",
        payload: {
          itemType: "subagent",
          subagent: {
            subagentId: "managed-1",
            origin: "native",
            capability: "transcript",
          },
          status: "completed",
          summary: "Found stale-key eviction risk.",
        },
      }),
    ];

    expect(deriveThreadSubagents(activities)[0]).toMatchObject({
      key: "subagent:managed-1",
      role: "Cache Inspector",
      status: "finished",
      origin: "native",
      capability: "transcript",
      tool: "read",
      detail: "Found stale-key eviction risk.",
      providerThreadIds: ["provider-child-1"],
      providerSessionIds: ["session-child-1"],
      messages: [
        {
          id: "message-1",
          text: "The eviction path skips stale keys.",
          providerThreadId: "provider-child-1",
        },
      ],
    });
  });

  it("uses canonical provider-neutral subagent metadata and messages", () => {
    const activities = [
      makeActivity({
        id: "subagent-started",
        kind: "subagent.started",
        createdAt: "2026-06-04T10:00:00.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "running",
          subagent: {
            subagentId: "opencode:session:child-1",
            origin: "native",
            capability: "transcript",
            label: "OpenCode reviewer",
            providerThreadId: "child-1",
            providerSessionId: "child-1",
          },
        },
      }),
      makeActivity({
        id: "subagent-message",
        kind: "agent.message",
        createdAt: "2026-06-04T10:00:04.000Z",
        payload: {
          itemType: "assistant_message",
          subagentId: "opencode:session:child-1",
          providerThreadId: "child-1",
          providerItemId: "message-1",
          text: "The retry flow drops partial stream state.",
        },
      }),
      makeActivity({
        id: "subagent-completed",
        kind: "subagent.completed",
        createdAt: "2026-06-04T10:00:05.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "completed",
          subagent: {
            subagentId: "opencode:session:child-1",
            origin: "native",
            capability: "transcript",
            label: "OpenCode reviewer",
            providerThreadId: "child-1",
            providerSessionId: "child-1",
          },
        },
      }),
    ];

    expect(deriveThreadSubagents(activities)[0]).toMatchObject({
      key: "subagent:opencode:session:child-1",
      role: "OpenCode Reviewer",
      status: "finished",
      origin: "native",
      capability: "transcript",
      providerThreadIds: ["child-1"],
      providerSessionIds: ["child-1"],
      messages: [
        {
          id: "message-1",
          text: "The retry flow drops partial stream state.",
          providerThreadId: "child-1",
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

  it("assigns stable, unique abstract codenames when no role can be inferred", () => {
    const activities = [
      makeActivity({
        id: "agent-a",
        kind: "tool.started",
        createdAt: "2026-06-04T10:00:00.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          detail: "Investigate the failing checks",
          data: { toolCallId: "call-a" },
        },
      }),
      makeActivity({
        id: "agent-b",
        kind: "tool.started",
        createdAt: "2026-06-04T10:00:01.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          detail: "Trace the retry path",
          data: { toolCallId: "call-b" },
        },
      }),
    ];

    const subagents = deriveThreadSubagents(activities);
    expect(subagents).toHaveLength(2);

    for (const subagent of subagents) {
      // A memorable codename, never the old "Subagent 1, 2, 3…" counter.
      expect(subagent.name).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(subagent.name).not.toMatch(/^Subagent\b/);
      // No inferable role, so the subtitle stays empty.
      expect(subagent.role).toBeNull();
    }
    expect(subagents[0]?.name).not.toBe(subagents[1]?.name);

    // Codenames are seeded from the stable subagent key, so they do not drift
    // between renders of the same activity stream.
    const second = deriveThreadSubagents(activities);
    expect(second.map((subagent) => subagent.name)).toEqual(
      subagents.map((subagent) => subagent.name),
    );
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
