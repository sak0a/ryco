import {
  AgentControlOperationId,
  AgentControlProposalId,
  AgentControlRequestId,
  AgentControlRiskTag,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorktreeId,
  type AgentControlOperation,
  type AgentControlPrincipal,
  type AgentControlProposal,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { AgentControlOperationRepository } from "../../persistence/Services/AgentControlOperations.ts";
import { AgentControlAuditRepositoryLive } from "../../persistence/Layers/AgentControlAudit.ts";
import { AgentControlOperationRepositoryLive } from "../../persistence/Layers/AgentControlOperations.ts";
import { AgentControlProposalRepositoryLive } from "../../persistence/Layers/AgentControlProposals.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AgentControlOperationStore } from "../Services/AgentControlOperationStore.ts";
import { AgentControlProposalStore } from "../Services/AgentControlProposalStore.ts";
import { AgentControlOperationStoreLive } from "./AgentControlOperationStore.ts";
import { AgentControlPolicyLive } from "./AgentControlPolicy.ts";
import { AgentControlProposalEventsLive } from "./AgentControlProposalEvents.ts";
import { AgentControlProposalStoreLive } from "./AgentControlProposalStore.ts";

const principal: AgentControlPrincipal = {
  kind: "provider-session",
  threadId: ThreadId.make("thread-1"),
  providerInstanceId: ProviderInstanceId.make("codex"),
};

const makeLayer = (enabled: boolean) =>
  Layer.mergeAll(AgentControlOperationStoreLive, AgentControlProposalStoreLive).pipe(
    Layer.provideMerge(AgentControlProposalEventsLive),
    Layer.provideMerge(AgentControlPolicyLive),
    Layer.provideMerge(AgentControlProposalRepositoryLive),
    Layer.provideMerge(AgentControlOperationRepositoryLive),
    Layer.provideMerge(AgentControlAuditRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerSettingsService.layerTest(enabled ? { agentControl: { enabled: true } } : {}),
    ),
  );

const disabledLayer = it.layer(makeLayer(false));
const enabledLayer = it.layer(makeLayer(true));

/** Drive a proposal to `executing` through the real lifecycle. */
const executingProposal = (requestIdValue: string) =>
  Effect.gen(function* () {
    const proposals = yield* AgentControlProposalStore;
    const { proposal } = yield* proposals.submit({
      principal,
      requestId: AgentControlRequestId.make(requestIdValue),
      plan: {
        kind: "createThreads",
        entries: [
          {
            projectId: ProjectId.make("project-1"),
            title: "Fix the flaky test",
            prompt: "Investigate and fix the flaky worktree test.",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
            runtimeMode: "full-access",
            envMode: "worktree",
          },
        ],
      },
      riskTags: [AgentControlRiskTag.make("creates-threads")],
      promptSummary: "Create 1 thread in project-1",
      expiresAt: "2026-08-17T01:00:00.000Z",
      now: "2026-08-17T00:00:00.000Z",
    });
    yield* proposals.decide({
      proposalId: proposal.proposalId,
      decision: "approved",
      actor: "user",
      decidedAt: "2026-08-17T00:05:00.000Z",
    });
    return yield* proposals.beginExecution({
      proposalId: proposal.proposalId,
      actor: "executor",
      now: "2026-08-17T00:06:00.000Z",
    });
  });

disabledLayer("AgentControlOperationStore (feature disabled)", (it) => {
  it.effect("refuses to create operations while disabled", () =>
    Effect.gen(function* () {
      const store = yield* AgentControlOperationStore;
      const proposal = {
        status: "executing",
      } as AgentControlProposal;

      const error = yield* Effect.flip(
        store.createForProposal({ proposal, now: "2026-08-17T00:06:00.000Z" }),
      );
      assert.strictEqual(error._tag, "AgentControlDisabledError");
    }),
  );

  it.effect("refuses to advance work while disabled but still lets cleanup settle", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlOperationRepository;
      const store = yield* AgentControlOperationStore;
      const seed = (idValue: string, status: AgentControlOperation["status"]) =>
        repository.insert({
          operationId: AgentControlOperationId.make(idValue),
          proposalId: AgentControlProposalId.make(`proposal-${idValue}`),
          actionKind: "createThreads",
          status,
          attempt: 0,
          state: {
            completedSteps: [],
            commandReceipts: [],
            resources: {
              threadIds: [],
              ownedThreadIds: [],
              worktreeIds: [],
              ownedWorktrees: [],
            },
          },
          result: null,
          createdAt: "2026-08-17T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
        });
      yield* seed("op-disabled-pending", "pending");
      yield* seed("op-disabled-running", "running");

      // A pre-existing pending operation must not start running while the
      // feature gate is off.
      const startError = yield* Effect.flip(
        store.transition({
          operationId: AgentControlOperationId.make("op-disabled-pending"),
          expectedStatus: "pending",
          nextStatus: "running",
          actor: "executor",
          attempt: 1,
          state: {
            completedSteps: [],
            commandReceipts: [],
            resources: {
              threadIds: [],
              ownedThreadIds: [],
              worktreeIds: [],
              ownedWorktrees: [],
            },
          },
          result: null,
          updatedAt: "2026-08-17T00:01:00.000Z",
        }),
      );
      assert.strictEqual(startError._tag, "AgentControlDisabledError");

      // Winding down an interrupted run stays possible so restart cleanup
      // can settle stragglers.
      const compensating = yield* store.transition({
        operationId: AgentControlOperationId.make("op-disabled-running"),
        expectedStatus: "running",
        nextStatus: "compensating",
        actor: "executor",
        attempt: 1,
        state: {
          completedSteps: [],
          commandReceipts: [],
          resources: {
            threadIds: [],
            ownedThreadIds: [],
            worktreeIds: [],
            ownedWorktrees: [],
          },
        },
        result: null,
        updatedAt: "2026-08-17T00:01:00.000Z",
      });
      assert.strictEqual(compensating.status, "compensating");
    }),
  );
});

enabledLayer("AgentControlOperationStore", (it) => {
  it.effect("creates exactly one durable operation per executing proposal", () =>
    Effect.gen(function* () {
      const store = yield* AgentControlOperationStore;
      const proposal = yield* executingProposal("request-op-create");

      const first = yield* store.createForProposal({
        proposal,
        now: "2026-08-17T00:06:00.000Z",
      });
      assert.isFalse(first.replayed);
      assert.strictEqual(first.operation.status, "pending");
      assert.strictEqual(first.operation.actionKind, "createThreads");

      const replay = yield* store.createForProposal({
        proposal,
        now: "2026-08-17T00:07:00.000Z",
      });
      assert.isTrue(replay.replayed);
      assert.strictEqual(replay.operation.operationId, first.operation.operationId);
    }),
  );

  it.effect("refuses to create an operation for a proposal that is not executing", () =>
    Effect.gen(function* () {
      const proposals = yield* AgentControlProposalStore;
      const store = yield* AgentControlOperationStore;
      const { proposal } = yield* proposals.submit({
        principal,
        requestId: AgentControlRequestId.make("request-op-pending"),
        plan: {
          kind: "interruptThread",
          threadId: ThreadId.make("thread-1"),
        },
        riskTags: [],
        promptSummary: null,
        expiresAt: "2026-08-17T01:00:00.000Z",
        now: "2026-08-17T00:00:00.000Z",
      });

      const error = yield* Effect.flip(
        store.createForProposal({ proposal, now: "2026-08-17T00:01:00.000Z" }),
      );
      assert.strictEqual(error._tag, "AgentControlInvalidTransitionError");
    }),
  );

  it.effect("validates operation transitions and records recovery evidence", () =>
    Effect.gen(function* () {
      const store = yield* AgentControlOperationStore;
      const proposal = yield* executingProposal("request-op-transitions");
      const { operation } = yield* store.createForProposal({
        proposal,
        now: "2026-08-17T00:06:00.000Z",
      });

      // Users never drive operations.
      const userError = yield* Effect.flip(
        store.transition({
          operationId: operation.operationId,
          expectedStatus: "pending",
          nextStatus: "running",
          actor: "user",
          attempt: 1,
          state: operation.state,
          result: null,
          updatedAt: "2026-08-17T00:07:00.000Z",
        }),
      );
      assert.strictEqual(userError._tag, "AgentControlInvalidTransitionError");

      const running = yield* store.transition({
        operationId: operation.operationId,
        expectedStatus: "pending",
        nextStatus: "running",
        actor: "executor",
        attempt: 1,
        state: {
          completedSteps: ["worktree-preflight"],
          commandReceipts: [],
          resources: {
            threadIds: [],
            ownedThreadIds: [],
            worktreeIds: [WorktreeId.make("worktree-1")],
            ownedWorktrees: [],
          },
        },
        result: null,
        updatedAt: "2026-08-17T00:07:00.000Z",
      });
      assert.strictEqual(running.status, "running");
      assert.deepStrictEqual(running.state.resources.worktreeIds, [WorktreeId.make("worktree-1")]);

      // Skipping states is illegal even for the executor.
      const skipError = yield* Effect.flip(
        store.transition({
          operationId: operation.operationId,
          expectedStatus: "running",
          nextStatus: "pending",
          actor: "executor",
          attempt: 1,
          state: running.state,
          result: null,
          updatedAt: "2026-08-17T00:08:00.000Z",
        }),
      );
      assert.strictEqual(skipError._tag, "AgentControlInvalidTransitionError");

      const recoverableBefore = (yield* store.listRecoverable()).map((row) =>
        String(row.operationId),
      );
      assert.include(recoverableBefore, String(operation.operationId));

      const completed = yield* store.transition({
        operationId: operation.operationId,
        expectedStatus: "running",
        nextStatus: "completed",
        actor: "executor",
        attempt: 1,
        state: running.state,
        result: {
          outcome: "completed",
          createdThreadIds: [ThreadId.make("thread-2")],
          completedAt: "2026-08-17T00:09:00.000Z",
        },
        updatedAt: "2026-08-17T00:09:00.000Z",
      });
      assert.strictEqual(completed.status, "completed");

      const recoverableAfter = (yield* store.listRecoverable()).map((row) =>
        String(row.operationId),
      );
      assert.notInclude(recoverableAfter, String(operation.operationId));
    }),
  );
});
