import {
  AGENT_CONTROL_RISK_TAGS,
  AgentControlAutomationId,
  AgentControlProposalId,
  AgentControlRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentControlAutomation,
  type AgentControlProposal,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { AgentControlAuditRepositoryLive } from "../../persistence/Layers/AgentControlAudit.ts";
import { AgentControlAutomationRepositoryLive } from "../../persistence/Layers/AgentControlAutomations.ts";
import { AgentControlOperationRepositoryLive } from "../../persistence/Layers/AgentControlOperations.ts";
import { AgentControlProposalRepositoryLive } from "../../persistence/Layers/AgentControlProposals.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AgentControlAutomationRepository } from "../../persistence/Services/AgentControlAutomations.ts";
import { AgentControlAuditRepository } from "../../persistence/Services/AgentControlAudit.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { AgentControlAutomationService } from "../Services/AgentControlAutomation.ts";
import { AgentControlProposalStore } from "../Services/AgentControlProposalStore.ts";
import { AgentControlPolicyLive } from "./AgentControlPolicy.ts";
import { AgentControlProposalEventsLive } from "./AgentControlProposalEvents.ts";
import { AgentControlProposalStoreLive } from "./AgentControlProposalStore.ts";
import { makeAgentControlAutomationLive } from "./AgentControlAutomation.ts";

const projectId = ProjectId.make("project-automation-lifecycle");
const otherProjectId = ProjectId.make("project-automation-other");
const providerInstanceId = ProviderInstanceId.make("provider-automation-lifecycle");

const principal = {
  kind: "provider-session" as const,
  threadId: ThreadId.make("thread-automation-origin"),
  providerInstanceId,
  originProjectId: projectId,
  originRuntimeMode: "approval-required" as const,
  originEnvMode: "worktree" as const,
};

const makeAutomation = (id: string, start: string): AgentControlAutomation => ({
  automationId: AgentControlAutomationId.make(id),
  principal,
  projectId,
  providerInstanceId,
  definition: {
    execution: {
      projectId,
      title: "Governed task",
      prompt: "Perform only the approved governed task.",
      modelSelection: { instanceId: providerInstanceId, model: "test-model" },
      runtimeMode: "approval-required",
      envMode: "worktree",
    },
    schedule: { kind: "once", runAt: start },
    enabled: true,
  },
  revision: 1,
  enabled: true,
  cancelled: false,
  cancelledAt: null,
  nextRunAt: start,
  createdAt: start,
  updatedAt: start,
});

const layer = it.layer(
  makeAgentControlAutomationLive({ disableBackground: true }).pipe(
    Layer.provideMerge(AgentControlAutomationRepositoryLive),
    Layer.provideMerge(AgentControlProposalStoreLive),
    Layer.provideMerge(AgentControlProposalEventsLive),
    Layer.provideMerge(AgentControlPolicyLive),
    Layer.provideMerge(AgentControlProposalRepositoryLive),
    Layer.provideMerge(AgentControlOperationRepositoryLive),
    Layer.provideMerge(AgentControlAuditRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(ServerSettingsService.layerTest({ agentControl: { enabled: true } })),
  ),
);

const cancellationProposal = (
  automation: AgentControlAutomation,
  request: string,
): AgentControlProposal => ({
  proposalId: AgentControlProposalId.make(`proposal-${request}`),
  requestId: AgentControlRequestId.make(request),
  principal,
  planVersion: 1,
  plan: {
    kind: "cancelAutomation",
    automationId: automation.automationId,
    expected: {
      revision: automation.revision,
      definition: automation.definition,
      cancelled: automation.cancelled,
      updatedAt: automation.updatedAt,
    },
  },
  planDigest: "a".repeat(64),
  riskTags: [AGENT_CONTROL_RISK_TAGS.cancelsAutomation],
  promptSummary: "Cancel future runs",
  status: "executing",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: "2099-01-01T00:00:00.000Z",
  decidedAt: new Date().toISOString(),
  result: null,
});

layer("AgentControlAutomationService", (it) => {
  it.effect("accepted schedule definitions only persist lifecycle state", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlAutomationRepository;
      const automations = yield* AgentControlAutomationService;
      const runAt = new Date(Date.now() + 60_000).toISOString();
      const automationId = AgentControlAutomationId.make("automation-accepted-definition");
      const proposal: AgentControlProposal = {
        proposalId: AgentControlProposalId.make("proposal-accepted-definition"),
        requestId: AgentControlRequestId.make("request-accepted-definition"),
        principal,
        planVersion: 1,
        plan: {
          kind: "createAutomation",
          automationId,
          definition: makeAutomation("template-only", runAt).definition,
        },
        planDigest: "e".repeat(64),
        riskTags: [AGENT_CONTROL_RISK_TAGS.createsAutomation],
        promptSummary: "Create schedule definition",
        status: "executing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: "2099-01-01T00:00:00.000Z",
        decidedAt: new Date().toISOString(),
        result: null,
      };

      const stored = yield* automations.applyLifecycle(proposal);
      assert.strictEqual(stored.automationId, automationId);
      assert.strictEqual(stored.nextRunAt, runAt);
      assert.deepStrictEqual(yield* repository.listRuns({ automationId, limit: 50 }), []);
      // Lifecycle application has no orchestration or provider runtime
      // dependency, so approval cannot create a thread or start a turn.
    }),
  );

  it.effect("materializes one fresh inert proposal and recovery does not duplicate it", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlAutomationRepository;
      const automations = yield* AgentControlAutomationService;
      const proposals = yield* AgentControlProposalStore;
      const audit = yield* AgentControlAuditRepository;
      const automation = makeAutomation(
        "automation-due-once",
        new Date(Date.now() - 60_000).toISOString(),
      );
      assert.isTrue(yield* repository.insertAutomation(automation));
      assert.strictEqual(yield* automations.materializeDue, 1);
      assert.strictEqual(yield* automations.materializeDue, 0);
      yield* automations.recover;
      yield* automations.recover;

      const active = (yield* proposals.listActive({ limit: 100 })).filter(
        (proposal) =>
          proposal.plan.kind === "automationRun" &&
          proposal.plan.automationId === automation.automationId,
      );
      assert.strictEqual(active.length, 1);
      assert.strictEqual(active[0]?.status, "pending-user-approval");
      const auditTrail = yield* audit.listByProposalId({
        proposalId: active[0]!.proposalId,
      });
      assert.strictEqual(auditTrail[0]?.metadata.schedulerOutcome, "on-time");
      assert.strictEqual(
        auditTrail[0]?.metadata.recoverySafety,
        "idempotent-occurrence-and-request",
      );
      const runs = yield* repository.listRuns({ automationId: automation.automationId, limit: 50 });
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0]?.status, "pending-approval");
      // No orchestration/provider service is a dependency of scheduling: a
      // due occurrence can only persist its fresh proposal here.
    }),
  );

  it.effect("rejection and expiry make a run terminal and permit no execution", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlAutomationRepository;
      const automations = yield* AgentControlAutomationService;
      const proposals = yield* AgentControlProposalStore;
      const automation = makeAutomation(
        "automation-rejected",
        new Date(Date.now() - 60_000).toISOString(),
      );
      assert.isTrue(yield* repository.insertAutomation(automation));
      yield* automations.materializeDue;
      const run = (yield* repository.listRuns({
        automationId: automation.automationId,
        limit: 1,
      }))[0]!;
      assert.isNotNull(run.proposalId);
      const rejected = yield* proposals.decide({
        proposalId: run.proposalId!,
        decision: "rejected",
        actor: "user",
        decidedAt: new Date().toISOString(),
      });
      yield* automations.reconcileProposal(rejected);
      const settled = yield* repository.getRun(run.runId);
      assert.strictEqual(Option.getOrThrow(settled).status, "rejected");
      const refusal = yield* Effect.flip(
        automations.validateRun({ ...rejected, status: "approved" }),
      );
      assert.strictEqual(refusal._tag, "AgentControlPlanValidationError");

      const expiring = makeAutomation(
        "automation-expired",
        new Date(Date.now() - 30_000).toISOString(),
      );
      assert.isTrue(yield* repository.insertAutomation(expiring));
      yield* automations.materializeDue;
      const expiringRun = (yield* repository.listRuns({
        automationId: expiring.automationId,
        limit: 1,
      }))[0]!;
      const expired = yield* proposals.expireOverdue({
        now: "2099-01-01T00:00:00.000Z",
        limit: 100,
      });
      const expiredProposal = expired.find(
        (proposal) => proposal.proposalId === expiringRun.proposalId,
      )!;
      yield* automations.reconcileProposal(expiredProposal);
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getRun(expiringRun.runId)).status,
        "expired",
      );
      const expiredRefusal = yield* Effect.flip(
        automations.validateRun({ ...expiredProposal, status: "approved" }),
      );
      assert.strictEqual(expiredRefusal._tag, "AgentControlPlanValidationError");
    }),
  );

  it.effect(
    "cancellation prevents future runs, wins pending races, and preserves accepted runs",
    () =>
      Effect.gen(function* () {
        const repository = yield* AgentControlAutomationRepository;
        const automations = yield* AgentControlAutomationService;
        const proposals = yield* AgentControlProposalStore;

        const pendingAutomation = makeAutomation(
          "automation-cancel-pending",
          new Date(Date.now() - 60_000).toISOString(),
        );
        assert.isTrue(yield* repository.insertAutomation(pendingAutomation));
        yield* automations.materializeDue;
        const pendingRun = (yield* repository.listRuns({
          automationId: pendingAutomation.automationId,
          limit: 1,
        }))[0]!;
        const cancelledAutomation = yield* automations.applyLifecycle(
          cancellationProposal(pendingAutomation, "cancel-pending"),
        );
        assert.isTrue(cancelledAutomation.cancelled);
        assert.isNull(cancelledAutomation.nextRunAt);
        const cancelledProposal = Option.getOrThrow(
          yield* proposals.getById(pendingRun.proposalId!),
        );
        assert.strictEqual(cancelledProposal.status, "cancelled");
        yield* automations.reconcileProposal(cancelledProposal);
        assert.strictEqual(
          Option.getOrThrow(yield* repository.getRun(pendingRun.runId)).status,
          "cancelled",
        );
        assert.strictEqual(yield* automations.materializeDue, 0);

        const acceptedAutomation = makeAutomation(
          "automation-cancel-accepted",
          new Date(Date.now() - 30_000).toISOString(),
        );
        assert.isTrue(yield* repository.insertAutomation(acceptedAutomation));
        yield* automations.materializeDue;
        const acceptedRun = (yield* repository.listRuns({
          automationId: acceptedAutomation.automationId,
          limit: 1,
        }))[0]!;
        const approved = yield* proposals.decide({
          proposalId: acceptedRun.proposalId!,
          decision: "approved",
          actor: "user",
          decidedAt: new Date().toISOString(),
        });
        yield* automations.reconcileProposal(approved);
        yield* automations.applyLifecycle(
          cancellationProposal(acceptedAutomation, "cancel-after-accept"),
        );
        assert.strictEqual(
          Option.getOrThrow(yield* repository.getRun(acceptedRun.runId)).status,
          "approved",
        );
        yield* automations.validateRun(approved);
      }),
  );

  it.effect("hides automations outside the exact project/provider scope", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlAutomationRepository;
      const automations = yield* AgentControlAutomationService;
      const automation = makeAutomation(
        "automation-scope",
        new Date(Date.now() + 60_000).toISOString(),
      );
      assert.isTrue(yield* repository.insertAutomation(automation));
      const denied = yield* Effect.flip(
        automations.get(automation.automationId, {
          projectId: otherProjectId,
          providerInstanceId,
        }),
      );
      assert.strictEqual(denied._tag, "AgentControlPlanValidationError");
    }),
  );
});
