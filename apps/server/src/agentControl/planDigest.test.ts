import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentControlCreateThreadEntry,
  type AgentControlCreateThreadsPlan,
  type AgentControlSendMessagePlan,
} from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { canonicalAgentControlPlanJson, computeAgentControlPlanDigest } from "./planDigest.ts";

const baseEntry: AgentControlCreateThreadEntry = {
  projectId: ProjectId.make("project-1"),
  title: "Fix the flaky test",
  prompt: "Investigate and fix the flaky worktree test.",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  runtimeMode: "full-access",
  envMode: "worktree",
  baseRef: "main",
};

const basePlan: AgentControlCreateThreadsPlan = {
  kind: "createThreads",
  entries: [baseEntry],
};

describe("computeAgentControlPlanDigest", () => {
  it("is deterministic and independent of object key order", () => {
    const reordered: AgentControlCreateThreadsPlan = {
      kind: "createThreads",
      entries: [
        {
          envMode: "worktree",
          runtimeMode: "full-access",
          baseRef: "main",
          modelSelection: { model: "gpt-5.6", instanceId: ProviderInstanceId.make("codex") },
          prompt: "Investigate and fix the flaky worktree test.",
          title: "Fix the flaky test",
          projectId: ProjectId.make("project-1"),
        },
      ],
    };

    expect(computeAgentControlPlanDigest(basePlan)).toBe(computeAgentControlPlanDigest(basePlan));
    expect(computeAgentControlPlanDigest(reordered)).toBe(computeAgentControlPlanDigest(basePlan));
  });

  it("changes for any semantic plan change", () => {
    const digest = computeAgentControlPlanDigest(basePlan);
    const changedPrompt: AgentControlCreateThreadsPlan = {
      kind: "createThreads",
      entries: [{ ...baseEntry, prompt: "Do something else entirely." }],
    };
    const changedKind: AgentControlSendMessagePlan = {
      kind: "sendMessage",
      threadId: ThreadId.make("thread-1"),
      text: "Investigate and fix the flaky worktree test.",
      delivery: "queue",
    };

    expect(computeAgentControlPlanDigest(changedPrompt)).not.toBe(digest);
    expect(computeAgentControlPlanDigest(changedKind)).not.toBe(digest);
  });

  it("produces sha-256 hex over key-sorted canonical JSON", () => {
    expect(computeAgentControlPlanDigest(basePlan)).toMatch(/^[a-f0-9]{64}$/);
    const canonical = canonicalAgentControlPlanJson(basePlan);
    expect(canonical.indexOf('"entries"')).toBeLessThan(canonical.indexOf('"kind"'));
  });
});
