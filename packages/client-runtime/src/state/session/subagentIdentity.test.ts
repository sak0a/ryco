import { describe, expect, it } from "vite-plus/test";

import {
  assignSubagentIdentities,
  formatSubagentRoleLabel,
  subagentRoleDuplicatesLabel,
} from "./subagentIdentity.ts";

describe("subagent identity", () => {
  it("resolves runtime and transcript keys to the same visual identity", () => {
    const runtimeIdentity = assignSubagentIdentities([
      { key: "agent-1", role: "code-reviewer", taskLabel: "Review reconnect handling" },
    ]).get("agent-1");
    const transcriptIdentity = assignSubagentIdentities([
      {
        key: "subagent:agent-1",
        role: "code-reviewer",
        taskLabel: "Review reconnect handling",
      },
    ]).get("subagent:agent-1");

    expect(runtimeIdentity).toEqual(transcriptIdentity);
    expect(runtimeIdentity).toMatchObject({
      role: "Code Reviewer",
      taskLabel: "Review reconnect handling",
      avatarKey: "agent-1",
    });
  });

  it("keeps provider roles open-ended while hiding generic or duplicate labels", () => {
    expect(formatSubagentRoleLabel("release-verifier")).toBe("Release Verifier");
    expect(formatSubagentRoleLabel("subagent")).toBeNull();
    expect(subagentRoleDuplicatesLabel("Reviewer", " reviewer ")).toBe(true);
    expect(subagentRoleDuplicatesLabel("Reviewer", "Inspect retries")).toBe(false);
  });
});
