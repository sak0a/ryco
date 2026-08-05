import {
  CONTEXT_HANDOFF_ACTIVITY_KIND,
  CheckpointRef,
  ContextHandoffId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ContextHandoffEndpointSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildContextHandoffDocument,
  stableStringifyContextHandoff,
} from "./ContextHandoffBuilder.ts";

const baseTime = "2026-08-04T00:00:00.000Z";

function endpoint(instance: string, model: string): ContextHandoffEndpointSnapshot {
  return {
    providerInstanceId: ProviderInstanceId.make(instance),
    driverKind: ProviderDriverKind.make(instance.startsWith("claude") ? "claudeAgent" : "codex"),
    providerDisplayName: instance,
    modelSlug: model,
    modelDisplayName: model.toUpperCase(),
  };
}

function activity(input: {
  id: string;
  kind: string;
  payload: unknown;
  createdAt?: string;
  sequence?: number;
  turnId?: string | null;
  summary?: string;
  tone?: "info" | "tool" | "approval" | "error";
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    kind: input.kind,
    payload: input.payload,
    createdAt: input.createdAt ?? baseTime,
    ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
    turnId: input.turnId === undefined || input.turnId === null ? null : TurnId.make(input.turnId),
    summary: input.summary ?? input.kind,
    tone: input.tone ?? "info",
  };
}

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: ThreadId.make("thread-context"),
    projectId: ProjectId.make("project-context"),
    title: "Context handoff",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex_a"),
      model: "gpt-a",
    },
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: "feat/context",
    worktreePath: "/workspace/context",
    latestTurn: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

describe("buildContextHandoffDocument", () => {
  it("produces deterministic bytes and excludes the current message, later history, and protocol noise", () => {
    const targetMessageId = MessageId.make("message-target");
    const cyclic: Record<string, unknown> = { credential: "must-not-copy" };
    cyclic.self = cyclic;
    const thread = makeThread({
      messages: [
        {
          id: MessageId.make("message-user"),
          role: "user",
          text: "Please inspect the repository",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-08-04T00:00:01.000Z",
          updatedAt: "2026-08-04T00:00:01.000Z",
        },
        {
          id: MessageId.make("message-system"),
          role: "system",
          text: "hidden reasoning that must not transfer",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-08-04T00:00:02.000Z",
          updatedAt: "2026-08-04T00:00:02.000Z",
        },
        {
          id: MessageId.make("message-assistant"),
          role: "assistant",
          text: "I found the relevant service.",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-08-04T00:00:03.000Z",
          updatedAt: "2026-08-04T00:00:03.000Z",
        },
        {
          id: targetMessageId,
          role: "user",
          text: "CURRENT MESSAGE MUST STAY OUT",
          turnId: TurnId.make("turn-2"),
          streaming: false,
          createdAt: "2026-08-04T00:00:04.000Z",
          updatedAt: "2026-08-04T00:00:04.000Z",
        },
        {
          id: MessageId.make("message-after"),
          role: "assistant",
          text: "target startup result",
          turnId: TurnId.make("turn-2"),
          streaming: false,
          createdAt: "2026-08-04T00:00:05.000Z",
          updatedAt: "2026-08-04T00:00:05.000Z",
        },
      ],
      activities: [
        activity({
          id: "telemetry-unknown",
          kind: "provider.telemetry",
          payload: cyclic,
          createdAt: "2026-08-04T00:00:02.500Z",
        }),
        activity({
          id: "startup-after",
          kind: "task.started",
          payload: { description: "target startup" },
          createdAt: "2026-08-04T00:00:04.000Z",
        }),
        activity({
          id: "source-tool-equal-timestamp",
          kind: "tool.completed",
          tone: "tool",
          summary: "Source command",
          turnId: "turn-1",
          payload: {
            itemType: "command_execution",
            providerItemId: "source-item-equal-timestamp",
            data: { item: { type: "commandExecution", command: "git status", exitCode: 0 } },
          },
          createdAt: "2026-08-04T00:00:04.000Z",
        }),
      ],
    });

    const first = buildContextHandoffDocument({
      thread,
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
    });
    const second = buildContextHandoffDocument({
      thread: { ...thread, activities: thread.activities.toReversed() },
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
    });

    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.document.messages.map((message) => message.id)).toEqual([
      MessageId.make("message-user"),
      MessageId.make("message-assistant"),
    ]);
    expect(first.canonicalJson).not.toContain("CURRENT MESSAGE MUST STAY OUT");
    expect(first.canonicalJson).not.toContain("hidden reasoning");
    expect(first.canonicalJson).not.toContain("target startup");
    expect(first.canonicalJson).not.toContain("must-not-copy");
    expect(first.document.tools.map((tool) => tool.id)).toEqual([
      EventId.make("source-tool-equal-timestamp"),
    ]);
  });

  it("coalesces a tool-only lifecycle and retains command, failure output, and file changes", () => {
    const targetMessageId = MessageId.make("message-target");
    const output = `${"failure output ".repeat(2_000)}😀`;
    const thread = makeThread({
      messages: [
        {
          id: targetMessageId,
          role: "user",
          text: "",
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "shot.png",
              mimeType: "image/png",
              sizeBytes: 10,
            },
          ],
          turnId: TurnId.make("turn-2"),
          streaming: false,
          createdAt: "2026-08-04T00:00:10.000Z",
          updatedAt: "2026-08-04T00:00:10.000Z",
        },
      ],
      activities: [
        activity({
          id: "tool-start",
          kind: "tool.started",
          tone: "tool",
          summary: "Terminal started",
          turnId: "turn-1",
          sequence: 1,
          createdAt: "2026-08-04T00:00:01.000Z",
          payload: {
            itemType: "command_execution",
            providerItemId: "item-command",
            data: { item: { command: ["bun", "run", "test"] } },
          },
        }),
        activity({
          id: "tool-update",
          kind: "tool.updated",
          tone: "tool",
          summary: "Terminal running",
          turnId: "turn-1",
          sequence: 2,
          createdAt: "2026-08-04T00:00:02.000Z",
          payload: {
            itemType: "command_execution",
            providerItemId: "item-command",
            data: {
              item: { changes: [{ path: "apps/server/src/main.ts", additions: 8, deletions: 2 }] },
            },
          },
        }),
        activity({
          id: "tool-complete",
          kind: "tool.completed",
          tone: "tool",
          summary: "Terminal",
          turnId: "turn-1",
          sequence: 3,
          createdAt: "2026-08-04T00:00:03.000Z",
          payload: {
            itemType: "command_execution",
            providerItemId: "item-command",
            status: "failed",
            data: {
              item: { type: "commandExecution", aggregatedOutput: output, exitCode: 7 },
            },
          },
        }),
      ],
    });

    const artifact = buildContextHandoffDocument({
      thread,
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
    });

    expect(artifact.document.messages).toEqual([]);
    expect(artifact.document.tools).toHaveLength(1);
    expect(artifact.document.tools[0]).toMatchObject({
      id: EventId.make("tool-complete"),
      lifecycle: "completed",
      command: "bun run test",
      exitCode: 7,
      status: "failed",
      paths: ["apps/server/src/main.ts"],
      fileChanges: [{ path: "apps/server/src/main.ts", additions: 8, deletions: 2 }],
      truncated: true,
    });
    expect(artifact.document.tools[0]?.output?.endsWith("\ud83d")).toBe(false);
    expect(artifact.document.tools[0]?.output?.length).toBeLessThanOrEqual(16_000);
  });

  it("includes active plans, checkpoint stats, failures, pending questions, and subagent summaries", () => {
    const targetMessageId = MessageId.make("message-target");
    const thread = makeThread({
      messages: [
        {
          id: targetMessageId,
          role: "user",
          text: "continue",
          turnId: TurnId.make("turn-2"),
          streaming: false,
          createdAt: "2026-08-04T00:01:00.000Z",
          updatedAt: "2026-08-04T00:01:00.000Z",
        },
      ],
      proposedPlans: [
        {
          id: "plan-proposed",
          turnId: TurnId.make("turn-1"),
          planMarkdown: "1. Inspect\n2. Implement",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-08-04T00:00:01.000Z",
          updatedAt: "2026-08-04T00:00:01.000Z",
        },
      ],
      activities: [
        activity({
          id: "runtime-plan",
          kind: "turn.plan.updated",
          createdAt: "2026-08-04T00:00:02.000Z",
          payload: {
            explanation: "Keep the migration safe",
            plan: [
              { step: "Inspect", status: "completed" },
              { step: "Implement", status: "inProgress" },
            ],
          },
        }),
        activity({
          id: "runtime-error",
          kind: "runtime.error",
          tone: "error",
          summary: "Runtime error",
          createdAt: "2026-08-04T00:00:03.000Z",
          payload: { message: "Provider temporarily unavailable", telemetry: "ignore" },
        }),
        activity({
          id: "question",
          kind: "user-input.requested",
          createdAt: "2026-08-04T00:00:04.000Z",
          payload: {
            requestId: "request-1",
            questions: [
              {
                id: "scope",
                header: "Scope",
                question: "Which package should change?",
                options: [{ label: "Server", description: "Server only" }],
              },
            ],
          },
        }),
        activity({
          id: "subagent-complete",
          kind: "subagent.completed",
          tone: "tool",
          createdAt: "2026-08-04T00:00:05.000Z",
          payload: {
            status: "completed",
            detail: "Found the persistence boundary",
            subagent: {
              subagentId: "subagent-1",
              label: "Persistence scout",
              description: "Inspected repository code",
            },
          },
        }),
      ],
      checkpoints: [
        {
          turnId: TurnId.make("turn-1"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("checkpoint-1"),
          status: "ready",
          files: [
            {
              path: "apps/server/src/context.ts",
              kind: "modified",
              additions: 12,
              deletions: 3,
            },
          ],
          assistantMessageId: null,
          completedAt: "2026-08-04T00:00:06.000Z",
        },
      ],
    });

    const document = buildContextHandoffDocument({
      thread,
      targetMessageId,
      source: endpoint("codex_a", "gpt-a"),
      target: endpoint("claude_b", "claude-b"),
    }).document;

    expect(document.plans.map((plan) => plan.source)).toEqual(["proposed-plan", "runtime-plan"]);
    expect(document.plans[1]?.steps[1]).toEqual({ step: "Implement", status: "inProgress" });
    expect(document.checkpoints[0]?.files[0]).toEqual({
      path: "apps/server/src/context.ts",
      kind: "modified",
      additions: 12,
      deletions: 3,
    });
    expect(document.notices.map((notice) => notice.kind)).toEqual(["failure", "pending-question"]);
    expect(document.notices[1]?.questions[0]?.question).toBe("Which package should change?");
    expect(document.subagents[0]?.summary).toBe("Found the persistence boundary");
  });

  it("keeps prior boundary metadata, de-duplicates accumulated sources, and drops recursive bodies", () => {
    const sourceA = endpoint("codex_a", "gpt-a");
    const sourceB = endpoint("claude_b", "claude-b");
    const targetC = endpoint("codex_c", "gpt-c");
    const priorPayload = {
      schemaVersion: 1 as const,
      handoffId: ContextHandoffId.make("handoff-prior"),
      mode: "full-context-fresh-session" as const,
      targetMessageId: MessageId.make("message-prior-target"),
      targetTurnId: TurnId.make("turn-prior"),
      sourceSelection: { instanceId: sourceA.providerInstanceId, model: sourceA.modelSlug },
      targetSelection: { instanceId: sourceB.providerInstanceId, model: sourceB.modelSlug },
      sources: [sourceA, sourceA],
      target: sourceB,
      contextVersion: 1 as const,
      contextDigest: "a".repeat(64),
      status: "consumed" as const,
      recursiveContextBody: "DO NOT COPY THIS BODY",
    };
    const targetMessageId = MessageId.make("message-target");
    const thread = makeThread({
      messages: [
        {
          id: targetMessageId,
          role: "user",
          text: "continue again",
          turnId: TurnId.make("turn-3"),
          streaming: false,
          createdAt: "2026-08-04T00:00:10.000Z",
          updatedAt: "2026-08-04T00:00:10.000Z",
        },
      ],
      activities: [
        activity({
          id: "handoff-prior-activity",
          kind: CONTEXT_HANDOFF_ACTIVITY_KIND,
          summary: "Context handoff",
          createdAt: "2026-08-04T00:00:01.000Z",
          payload: priorPayload,
        }),
      ],
    });

    const artifact = buildContextHandoffDocument({
      thread,
      targetMessageId,
      source: sourceB,
      target: targetC,
    });

    expect(artifact.document.provenance.sources.map((entry) => entry.providerInstanceId)).toEqual([
      sourceA.providerInstanceId,
      sourceB.providerInstanceId,
    ]);
    expect(artifact.document.priorHandoffs).toHaveLength(1);
    expect(artifact.canonicalJson).not.toContain("DO NOT COPY THIS BODY");
    expect(stableStringifyContextHandoff({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });
});
