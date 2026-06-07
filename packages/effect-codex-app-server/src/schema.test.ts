import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import * as CodexSchema from "./schema.ts";

describe("Codex app-server schema compatibility", () => {
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
