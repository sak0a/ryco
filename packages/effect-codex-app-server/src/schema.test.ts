import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import * as CodexSchema from "./schema.ts";

describe("Codex app-server schema compatibility", () => {
  it("accepts max reasoning effort in model-list responses", () => {
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
          ],
        },
      ],
    });

    expect(decoded.data[0]?.defaultReasoningEffort).toBe("max");
    expect(decoded.data[0]?.supportedReasoningEfforts.at(-1)?.reasoningEffort).toBe("max");
  });

  it("accepts max reasoning effort in turn start payloads", () => {
    expect(
      Schema.decodeUnknownSync(CodexSchema.V2TurnStartParams)({
        threadId: "thread-1",
        input: [],
        effort: "max",
      }).effort,
    ).toBe("max");
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
        source: "appServer",
        status: { type: "idle" },
        turns: [],
        updatedAt: 1_779_000_000,
      },
    });

    expect(decoded.serviceTier).toBe("priority");
  });
});
