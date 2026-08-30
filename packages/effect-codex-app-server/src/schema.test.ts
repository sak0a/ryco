import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import * as CodexSchema from "./schema.ts";

describe("Codex app-server schema compatibility", () => {
  it("accepts Codex 0.150 multi-agent values", () => {
    const activityKindSchemas = [
      CodexSchema.ServerNotification__SubAgentActivityKind,
      CodexSchema.V2ItemStartedNotification__SubAgentActivityKind,
      CodexSchema.V2ItemCompletedNotification__SubAgentActivityKind,
      CodexSchema.V2ThreadReadResponse__SubAgentActivityKind,
      CodexSchema.V2ThreadResumeResponse__SubAgentActivityKind,
    ];

    for (const schema of activityKindSchemas) {
      expect(Schema.is(schema)("completed")).toBe(true);
    }

    for (const tool of ["sendMessage", "followupTask", "interruptAgent", "listAgents"]) {
      expect(Schema.is(CodexSchema.ServerNotification__CollabAgentTool)(tool)).toBe(true);
      expect(Schema.is(CodexSchema.V2ThreadResumeResponse__CollabAgentTool)(tool)).toBe(true);
    }

    expect(
      Schema.is(CodexSchema.ServerNotification__CollabAgentToolCallStatus)("interrupted"),
    ).toBe(true);
    expect(
      Schema.is(CodexSchema.V2ThreadResumeResponse__CollabAgentToolCallStatus)("interrupted"),
    ).toBe(true);

    expect(
      Schema.is(CodexSchema.V2ThreadResumeResponse)({
        approvalPolicy: "never",
        approvalsReviewer: "user",
        cwd: "/tmp/project",
        model: "gpt-5.6-sol",
        modelProvider: "openai",
        sandbox: { type: "dangerFullAccess" },
        thread: {
          cliVersion: "0.150.0",
          createdAt: 0,
          cwd: "/tmp/project",
          ephemeral: false,
          id: "root-thread",
          modelProvider: "openai",
          preview: "",
          sessionId: "session-1",
          source: "cli",
          status: { type: "idle" },
          turns: [
            {
              id: "turn-1",
              status: "completed",
              items: [
                {
                  agentsStates: {},
                  id: "item-1",
                  receiverThreadIds: ["child-thread"],
                  senderThreadId: "root-thread",
                  status: "interrupted",
                  tool: "followupTask",
                  type: "collabAgentToolCall",
                },
              ],
            },
          ],
          updatedAt: 0,
        },
      }),
    ).toBe(true);
  });

  it("accepts max and ultra reasoning efforts in model-list responses", () => {
    const decoded = Schema.decodeUnknownSync(CodexSchema.V2ModelListResponse)({
      data: [
        {
          defaultReasoningEffort: "max",
          description: "Frontier model for complex professional work",
          displayName: "GPT-5.6 Sol",
          hidden: false,
          id: "gpt-5.6-sol",
          isDefault: true,
          model: "gpt-5.6-sol",
          supportedReasoningEfforts: [
            { reasoningEffort: "none", description: "No reasoning" },
            { reasoningEffort: "max", description: "Maximum reasoning" },
            { reasoningEffort: "ultra", description: "Ultra reasoning" },
          ],
        },
      ],
    });

    expect(decoded.data[0]?.defaultReasoningEffort).toBe("max");
    expect(decoded.data[0]?.supportedReasoningEfforts.at(-1)?.reasoningEffort).toBe("ultra");
  });

  it("accepts ultra reasoning effort in turn start payloads", () => {
    expect(
      Schema.decodeUnknownSync(CodexSchema.V2TurnStartParams)({
        threadId: "thread-1",
        input: [],
        effort: "ultra",
      }).effort,
    ).toBe("ultra");
  });

  it("accepts Codex 0.130 priority service tier in thread start payloads", () => {
    expect(
      Schema.decodeUnknownSync(CodexSchema.V2ThreadStartParams)({
        cwd: "/tmp/project",
        serviceTier: "priority",
      }).serviceTier,
    ).toBe("priority");
  });

  it("accepts Codex 0.130 priority service tier in thread start responses", () => {
    const decoded = Schema.decodeUnknownSync(CodexSchema.V2ThreadStartResponse)({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      cwd: "/tmp/project",
      model: "gpt-5.5",
      modelProvider: "openai",
      sandbox: { type: "dangerFullAccess" },
      serviceTier: "priority",
      thread: {
        cliVersion: "0.130.0",
        createdAt: 1_779_000_000,
        cwd: "/tmp/project",
        ephemeral: false,
        id: "thread-1",
        modelProvider: "openai",
        preview: "",
        sessionId: "thread-1",
        source: "appServer",
        status: { type: "idle" },
        turns: [],
        updatedAt: 1_779_000_000,
      },
    });

    expect(decoded.serviceTier).toBe("priority");
  });
});
