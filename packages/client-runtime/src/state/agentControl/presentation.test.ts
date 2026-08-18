import { describe, expect, it } from "vite-plus/test";
import {
  AgentControlProposalId,
  AgentControlRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type AgentControlProposal,
} from "@ryco/contracts";

import { buildAgentControlProposalCardModel } from "./presentation.ts";

function makeProposal(overrides: Partial<AgentControlProposal> = {}): AgentControlProposal {
  return {
    proposalId: AgentControlProposalId.make("proposal-1"),
    requestId: AgentControlRequestId.make("request-1"),
    principal: {
      kind: "provider-session",
      threadId: ThreadId.make("thread-caller-1234"),
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    planVersion: 1,
    plan: {
      kind: "sendMessage",
      threadId: ThreadId.make("thread-target-5678"),
      text: "Continue with the migration.",
      delivery: "queue",
    },
    planDigest: "a".repeat(64),
    riskTags: [],
    promptSummary: "Queue a message",
    status: "pending-user-approval",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    expiresAt: "2026-08-17T01:00:00.000Z",
    decidedAt: null,
    result: null,
    ...overrides,
  };
}

describe("buildAgentControlProposalCardModel", () => {
  it("summarizes a multi-entry createThreads batch with runtime and worktree info", () => {
    const model = buildAgentControlProposalCardModel(
      makeProposal({
        plan: {
          kind: "createThreads",
          entries: [1, 2].map((index) => ({
            projectId: ProjectId.make("project-1"),
            title: `Task ${index}`,
            prompt: `Prompt ${index}`,
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
            runtimeMode: "full-access",
            envMode: "worktree",
            baseRef: "main",
          })),
        },
      }),
    );
    expect(model.actionLabel).toBe("Create 2 threads");
    expect(model.targetLabel).toBe("project project-1");
    expect(model.runtimeLabel).toBe("full-access · worktree");
    expect(model.detailSections).toHaveLength(2);
    expect(model.detailSections[0]?.heading).toBe("Thread 1: Task 1");
    expect(model.detailSections[0]?.lines).toContain("Base ref: main");
    expect(model.detailSections[0]?.lines).toContain("Prompt: Prompt 1");
  });

  it("labels sendMessage steering distinctly from queueing", () => {
    const queueModel = buildAgentControlProposalCardModel(makeProposal());
    expect(queueModel.actionLabel).toBe("Queue message");
    expect(queueModel.targetLabel).toBe("thread thread-t…");

    const steerModel = buildAgentControlProposalCardModel(
      makeProposal({
        plan: {
          kind: "sendMessage",
          threadId: ThreadId.make("thread-target-5678"),
          text: "Stop and re-plan.",
          delivery: "steer",
        },
      }),
    );
    expect(steerModel.actionLabel).toBe("Steer thread");
  });

  it("describes interrupt and update plans", () => {
    const interrupt = buildAgentControlProposalCardModel(
      makeProposal({
        plan: {
          kind: "interruptThread",
          threadId: ThreadId.make("thread-target-5678"),
          turnId: TurnId.make("turn-9"),
        },
      }),
    );
    expect(interrupt.actionLabel).toBe("Interrupt thread");
    expect(interrupt.detailSections[0]?.lines).toContain("Only turn: turn-9");

    const update = buildAgentControlProposalCardModel(
      makeProposal({
        plan: {
          kind: "updateThread",
          threadId: ThreadId.make("thread-target-5678"),
          title: "New title",
          archived: true,
          persistentGoal: null,
        },
      }),
    );
    expect(update.actionLabel).toBe("Update thread");
    expect(update.detailSections[0]?.lines).toEqual([
      "Thread: thread-target-5678",
      "Title: New title",
      "Archive thread",
      "Clear persistent goal",
    ]);
  });

  it("identifies external integration origins without a caller thread", () => {
    const model = buildAgentControlProposalCardModel(
      makeProposal({
        principal: {
          kind: "external-integration",
          integrationId: "integration-abcdef-123456" as never,
          label: "Local Codex CLI" as never,
        },
      }),
    );
    expect(model.originLabel).toBe("External integration Local Codex CLI");
    expect(model.originThreadId).toBeNull();
  });

  it("labels terminal outcomes from the result envelope", () => {
    const completed = buildAgentControlProposalCardModel(
      makeProposal({
        status: "completed",
        result: {
          outcome: "completed",
          createdThreadIds: [ThreadId.make("thread-new-1")],
          execution: {
            operationId: "operation-123456789" as never,
            commands: [
              {
                commandId: "command-1" as never,
                commandType: "thread.turn.start",
                sequence: 17,
              },
            ],
            affectedThreadIds: [ThreadId.make("thread-new-1")],
            worktreeIds: [],
            delivery: "queued",
          },
          completedAt: "2026-08-17T00:10:00.000Z",
        },
      }),
    );
    expect(completed.outcomeLabel).toBe("Completed · created 1 thread");
    expect(completed.executionLabel).toBe("Operation operatio… · 1 command · delivery: queued");
    expect(completed.affectedThreadIds).toEqual(["thread-new-1"]);
    expect(completed.isPending).toBe(false);

    const failed = buildAgentControlProposalCardModel(
      makeProposal({
        status: "failed",
        result: {
          outcome: "failed",
          error: {
            code: "execution-failed" as never,
            message: "Worktree preflight failed",
            retryable: true,
          },
          failedAt: "2026-08-17T00:10:00.000Z",
        },
      }),
    );
    expect(failed.outcomeLabel).toBe("execution-failed: Worktree preflight failed");
    expect(failed.statusTone).toBe("danger");
  });
});
