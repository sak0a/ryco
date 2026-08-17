import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";

import {
  AGENT_CONTROL_CAPABILITIES,
  AGENT_CONTROL_ACTION_CAPABILITIES,
  AGENT_CONTROL_PLAN_VERSION,
  AgentControlActionPlan,
  AgentControlCapability,
  AgentControlOperation,
  AgentControlOperationState,
  AgentControlPlanDigest,
  AgentControlPrincipal,
  AgentControlProposal,
  AgentControlProposalStatus,
  AgentControlResultEnvelope,
  AgentControlRiskTag,
} from "./agentControl.ts";

const decodePlan = Schema.decodeUnknownSync(AgentControlActionPlan);
const decodePrincipal = Schema.decodeUnknownSync(AgentControlPrincipal);
const decodeProposal = Schema.decodeUnknownSync(AgentControlProposal);
const decodeOperation = Schema.decodeUnknownSync(AgentControlOperation);
const decodeOperationState = Schema.decodeUnknownSync(AgentControlOperationState);
const decodeResult = Schema.decodeUnknownSync(AgentControlResultEnvelope);
const decodeStatus = Schema.decodeUnknownSync(AgentControlProposalStatus);
const decodeDigest = Schema.decodeUnknownSync(AgentControlPlanDigest);
const decodeCapability = Schema.decodeUnknownSync(AgentControlCapability);
const decodeRiskTag = Schema.decodeUnknownSync(AgentControlRiskTag);

const createThreadsPlan = {
  kind: "createThreads",
  entries: [
    {
      projectId: "project-1",
      title: "Fix the flaky test",
      prompt: "Investigate and fix the flaky worktree test.",
      modelSelection: { instanceId: "codex", model: "gpt-5.6" },
      runtimeMode: "full-access",
      envMode: "worktree",
      baseRef: "main",
    },
  ],
};

const digest = "a".repeat(64);

const proposalWire = {
  proposalId: "proposal-1",
  requestId: "request-1",
  principal: {
    kind: "provider-session",
    threadId: "thread-1",
    providerInstanceId: "codex",
    runtimeSessionId: "runtime-1",
    turnId: "turn-1",
  },
  planVersion: AGENT_CONTROL_PLAN_VERSION,
  plan: createThreadsPlan,
  planDigest: digest,
  riskTags: ["creates-threads", "starts-provider-turn"],
  promptSummary: "Create 1 thread in project-1",
  status: "pending-user-approval",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  expiresAt: "2026-08-17T01:00:00.000Z",
  decidedAt: null,
  result: null,
};

describe("AgentControlActionPlan", () => {
  it("decodes every initial action kind", () => {
    expect(decodePlan(createThreadsPlan).kind).toBe("createThreads");
    expect(
      decodePlan({
        kind: "sendMessage",
        threadId: "thread-1",
        text: "Please also run the tests.",
        delivery: "queue",
      }).kind,
    ).toBe("sendMessage");
    expect(
      decodePlan({ kind: "interruptThread", threadId: "thread-1", turnId: "turn-9" }).kind,
    ).toBe("interruptThread");
    expect(decodePlan({ kind: "updateThread", threadId: "thread-1", archived: true }).kind).toBe(
      "updateThread",
    );
  });

  it("rejects unknown action kinds", () => {
    expect(() => decodePlan({ kind: "runShellCommand", command: "rm -rf /" })).toThrow();
  });

  it("bounds createThreads batches: never empty, never unbounded", () => {
    expect(() => decodePlan({ kind: "createThreads", entries: [] })).toThrow();
    const entry = createThreadsPlan.entries[0];
    expect(() =>
      decodePlan({ kind: "createThreads", entries: Array.from({ length: 11 }, () => entry) }),
    ).toThrow();
  });

  it("targets provider instances via ModelSelection, absorbing the legacy provider key", () => {
    const decoded = decodePlan({
      kind: "createThreads",
      entries: [
        {
          ...createThreadsPlan.entries[0],
          modelSelection: { provider: "codex", model: "gpt-5.6" },
        },
      ],
    });
    if (decoded.kind !== "createThreads") throw new Error("expected createThreads");
    expect(decoded.entries[0]?.modelSelection.instanceId).toBe("codex");
  });
});

describe("AgentControlPrincipal", () => {
  it("decodes both principal kinds", () => {
    expect(decodePrincipal(proposalWire.principal).kind).toBe("provider-session");
    expect(
      decodePrincipal({
        kind: "external-integration",
        integrationId: "integration-1",
        label: "Local Codex CLI",
      }).kind,
    ).toBe("external-integration");
  });

  it("rejects unknown principal kinds", () => {
    expect(() => decodePrincipal({ kind: "browser-session", sessionId: "s" })).toThrow();
  });
});

describe("AgentControlProposal", () => {
  it("round-trips a full proposal through decode and encode", () => {
    const decoded = decodeProposal(proposalWire);
    expect(decoded.status).toBe("pending-user-approval");
    expect(decoded.planDigest).toBe(digest);
    const encoded = Schema.encodeUnknownSync(AgentControlProposal)(decoded);
    expect(decodeProposal(encoded)).toEqual(decoded);
  });

  it("decodes every proposal status and rejects unknown ones", () => {
    for (const status of [
      "pending-user-approval",
      "approved",
      "rejected",
      "expired",
      "executing",
      "completed",
      "failed",
      "cancelled",
    ]) {
      expect(decodeStatus(status)).toBe(status);
    }
    expect(() => decodeStatus("awaiting-review")).toThrow();
  });

  it("only accepts sha-256 hex plan digests", () => {
    expect(decodeDigest(digest)).toBe(digest);
    expect(() => decodeDigest("not-a-digest")).toThrow();
    expect(() => decodeDigest("A".repeat(64))).toThrow();
  });

  it("decodes terminal result envelopes", () => {
    const failed = decodeResult({
      outcome: "failed",
      error: { code: "revalidation-failed", message: "Thread was deleted.", retryable: false },
      failedAt: "2026-08-17T00:10:00.000Z",
    });
    expect(failed.outcome).toBe("failed");
    const completed = decodeResult({
      outcome: "completed",
      createdThreadIds: ["thread-2"],
      completedAt: "2026-08-17T00:10:00.000Z",
    });
    expect(completed.outcome).toBe("completed");
  });
});

describe("forward compatibility (additive extension)", () => {
  it("decodes capability and risk-tag slugs this build does not know about", () => {
    // A newer build may persist capabilities/tags this build has never
    // heard of; decoding must succeed and authorization (not parsing)
    // rejects them.
    expect(decodeCapability("automations.create")).toBe("automations.create");
    expect(decodeRiskTag("touches-settings")).toBe("touches-settings");
  });

  it("rejects malformed slugs", () => {
    expect(() => decodeCapability("Threads.Create")).toThrow();
    expect(() => decodeCapability("1bad")).toThrow();
  });

  it("maps every action kind to a required capability", () => {
    expect(AGENT_CONTROL_ACTION_CAPABILITIES.createThreads).toBe(
      AGENT_CONTROL_CAPABILITIES.createThreads,
    );
    expect(Object.keys(AGENT_CONTROL_ACTION_CAPABILITIES).toSorted()).toEqual([
      "createThreads",
      "interruptThread",
      "sendMessage",
      "updateThread",
    ]);
  });
});

describe("AgentControlOperation", () => {
  it("decodes a durable operation with recovery evidence", () => {
    const operation = decodeOperation({
      operationId: "operation-1",
      proposalId: "proposal-1",
      actionKind: "createThreads",
      status: "running",
      attempt: 1,
      state: {
        completedSteps: ["worktree-preflight"],
        resources: { threadIds: [], worktreeIds: ["worktree-1"] },
      },
      result: null,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:05:00.000Z",
    });
    expect(operation.state.resources.worktreeIds).toEqual(["worktree-1"]);
  });

  it("defaults absent state collections so older rows keep decoding", () => {
    const state = decodeOperationState({});
    expect(state.completedSteps).toEqual([]);
    expect(state.resources).toEqual({ threadIds: [], worktreeIds: [] });
  });
});
