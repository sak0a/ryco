import {
  AGENT_CONTROL_PLAN_VERSION,
  type AgentControlOperation,
  AgentControlOperationId,
  type AgentControlProposal,
  AgentControlProposalId,
  AgentControlRequestId,
  AgentControlRiskTag,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorktreeId,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import {
  AGENT_CONTROL_AUDIT_EVENT_KINDS,
  AgentControlAuditId,
  AgentControlAuditRepository,
} from "../Services/AgentControlAudit.ts";
import { AgentControlOperationRepository } from "../Services/AgentControlOperations.ts";
import {
  AgentControlPrincipalScope,
  AgentControlProposalRepository,
} from "../Services/AgentControlProposals.ts";
import { AgentControlAuditRepositoryLive } from "./AgentControlAudit.ts";
import { AgentControlOperationRepositoryLive } from "./AgentControlOperations.ts";
import { AgentControlProposalRepositoryLive } from "./AgentControlProposals.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  Layer.mergeAll(
    AgentControlProposalRepositoryLive,
    AgentControlOperationRepositoryLive,
    AgentControlAuditRepositoryLive,
  ).pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const createdAt = "2026-08-17T00:00:00.000Z";
const scope = AgentControlPrincipalScope.make("provider-session:thread-1");

function pendingProposal(
  proposalIdValue: string,
  requestIdValue: string,
  overrides: Partial<AgentControlProposal> = {},
): AgentControlProposal {
  return {
    proposalId: AgentControlProposalId.make(proposalIdValue),
    requestId: AgentControlRequestId.make(requestIdValue),
    principal: {
      kind: "provider-session",
      threadId: ThreadId.make("thread-1"),
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    planVersion: AGENT_CONTROL_PLAN_VERSION,
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
    planDigest: "a".repeat(64),
    riskTags: [AgentControlRiskTag.make("creates-threads")],
    promptSummary: "Create 1 thread in project-1",
    status: "pending-user-approval",
    createdAt,
    updatedAt: createdAt,
    expiresAt: "2026-08-17T01:00:00.000Z",
    decidedAt: null,
    result: null,
    ...overrides,
  };
}

function pendingOperation(
  operationIdValue: string,
  proposalIdValue: string,
  overrides: Partial<AgentControlOperation> = {},
): AgentControlOperation {
  return {
    operationId: AgentControlOperationId.make(operationIdValue),
    proposalId: AgentControlProposalId.make(proposalIdValue),
    actionKind: "createThreads",
    status: "pending",
    attempt: 0,
    state: { completedSteps: [], resources: { threadIds: [], worktreeIds: [] } },
    result: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

layer("AgentControlProposalRepository", (it) => {
  it.effect("inserts once and round-trips principal, plan, and risk tags", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlProposalRepository;
      const proposal = pendingProposal("proposal-roundtrip", "request-roundtrip");

      assert.isTrue(yield* repository.insert({ proposal, principalScope: scope }));
      assert.isFalse(yield* repository.insert({ proposal, principalScope: scope }));

      const row = Option.getOrThrow(yield* repository.getById({ proposalId: proposal.proposalId }));
      assert.deepStrictEqual(row, proposal);
    }),
  );

  it.effect("refuses a second proposal reusing the scope and request id", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlProposalRepository;
      yield* repository.insert({
        proposal: pendingProposal("proposal-idem-1", "request-idem"),
        principalScope: scope,
      });

      assert.isFalse(
        yield* repository.insert({
          proposal: pendingProposal("proposal-idem-2", "request-idem"),
          principalScope: scope,
        }),
      );
      const found = Option.getOrThrow(
        yield* repository.findByRequest({
          principalScope: scope,
          requestId: AgentControlRequestId.make("request-idem"),
        }),
      );
      assert.strictEqual(found.proposalId, "proposal-idem-1");

      // The same request id under another principal scope is a new request.
      assert.isTrue(
        yield* repository.insert({
          proposal: pendingProposal("proposal-idem-3", "request-idem"),
          principalScope: AgentControlPrincipalScope.make("external-integration:cli"),
        }),
      );
    }),
  );

  it.effect("lists only pending proposals in stable chronology", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlProposalRepository;
      yield* repository.insert({
        proposal: pendingProposal("proposal-queue-2", "request-queue-2", {
          createdAt: "2026-08-17T00:00:02.000Z",
        }),
        principalScope: scope,
      });
      yield* repository.insert({
        proposal: pendingProposal("proposal-queue-1", "request-queue-1", {
          createdAt: "2026-08-17T00:00:01.000Z",
        }),
        principalScope: scope,
      });
      yield* repository.insert({
        proposal: pendingProposal("proposal-queue-3", "request-queue-3", {
          createdAt: "2026-08-17T00:00:03.000Z",
          status: "approved",
        }),
        principalScope: scope,
      });

      const pending = (yield* repository.listPending({ limit: 10 })).filter((row) =>
        row.proposalId.startsWith("proposal-queue-"),
      );
      assert.deepStrictEqual(
        pending.map((row) => row.proposalId),
        ["proposal-queue-1", "proposal-queue-2"],
      );
    }),
  );

  it.effect("lets exactly one caller win a status transition and preserves the digest", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlProposalRepository;
      const proposal = pendingProposal("proposal-cas", "request-cas");
      yield* repository.insert({ proposal, principalScope: scope });

      assert.isTrue(
        yield* repository.compareAndSetStatus({
          proposalId: proposal.proposalId,
          expectedStatus: "pending-user-approval",
          nextStatus: "approved",
          decidedAt: "2026-08-17T00:00:05.000Z",
          result: null,
          updatedAt: "2026-08-17T00:00:05.000Z",
        }),
      );
      assert.isFalse(
        yield* repository.compareAndSetStatus({
          proposalId: proposal.proposalId,
          expectedStatus: "pending-user-approval",
          nextStatus: "rejected",
          decidedAt: "2026-08-17T00:00:06.000Z",
          result: null,
          updatedAt: "2026-08-17T00:00:06.000Z",
        }),
      );

      assert.isTrue(
        yield* repository.compareAndSetStatus({
          proposalId: proposal.proposalId,
          expectedStatus: "approved",
          nextStatus: "executing",
          decidedAt: "2026-08-17T00:00:05.000Z",
          result: null,
          updatedAt: "2026-08-17T00:00:07.000Z",
        }),
      );
      assert.isTrue(
        yield* repository.compareAndSetStatus({
          proposalId: proposal.proposalId,
          expectedStatus: "executing",
          nextStatus: "completed",
          decidedAt: "2026-08-17T00:00:05.000Z",
          result: {
            outcome: "completed",
            createdThreadIds: [ThreadId.make("thread-2")],
            completedAt: "2026-08-17T00:00:08.000Z",
          },
          updatedAt: "2026-08-17T00:00:08.000Z",
        }),
      );

      const row = Option.getOrThrow(yield* repository.getById({ proposalId: proposal.proposalId }));
      assert.strictEqual(row.status, "completed");
      // The immutable core never changes across transitions.
      assert.strictEqual(row.planDigest, proposal.planDigest);
      assert.deepStrictEqual(row.plan, proposal.plan);
      assert.deepStrictEqual(row.principal, proposal.principal);
      assert.strictEqual(row.requestId, proposal.requestId);
      assert.deepStrictEqual(row.result, {
        outcome: "completed",
        createdThreadIds: [ThreadId.make("thread-2")],
        completedAt: "2026-08-17T00:00:08.000Z",
      });
    }),
  );
});

layer("AgentControlOperationRepository", (it) => {
  it.effect("owns one operation per proposal and round-trips recovery state", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlOperationRepository;
      const operation = pendingOperation("operation-1", "proposal-op-1", {
        state: {
          completedSteps: ["worktree-preflight"],
          resources: {
            threadIds: [ThreadId.make("thread-2")],
            worktreeIds: [WorktreeId.make("worktree-1")],
          },
        },
      });

      assert.isTrue(yield* repository.insert(operation));
      assert.isFalse(yield* repository.insert(operation));
      assert.isFalse(
        yield* repository.insert(pendingOperation("operation-other", "proposal-op-1")),
      );

      const row = Option.getOrThrow(
        yield* repository.getByProposalId({ proposalId: operation.proposalId }),
      );
      assert.deepStrictEqual(row, operation);
    }),
  );

  it.effect("recovers only non-terminal operations and lets one CAS win", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlOperationRepository;
      yield* repository.insert(pendingOperation("operation-live", "proposal-op-live"));
      yield* repository.insert(
        pendingOperation("operation-done", "proposal-op-done", {
          status: "completed",
          result: { outcome: "completed", completedAt: createdAt },
        }),
      );

      const recoverable = (yield* repository.listRecoverable()).map((row) =>
        String(row.operationId),
      );
      assert.include(recoverable, "operation-live");
      assert.notInclude(recoverable, "operation-done");

      assert.isTrue(
        yield* repository.compareAndSet({
          operationId: AgentControlOperationId.make("operation-live"),
          expectedStatus: "pending",
          nextStatus: "running",
          attempt: 1,
          state: { completedSteps: [], resources: { threadIds: [], worktreeIds: [] } },
          result: null,
          updatedAt: "2026-08-17T00:00:09.000Z",
        }),
      );
      assert.isFalse(
        yield* repository.compareAndSet({
          operationId: AgentControlOperationId.make("operation-live"),
          expectedStatus: "pending",
          nextStatus: "cancelled",
          attempt: 1,
          state: { completedSteps: [], resources: { threadIds: [], worktreeIds: [] } },
          result: null,
          updatedAt: "2026-08-17T00:00:10.000Z",
        }),
      );
    }),
  );
});

layer("AgentControlAuditRepository", (it) => {
  it.effect("appends audit rows and lists them in creation order", () =>
    Effect.gen(function* () {
      const repository = yield* AgentControlAuditRepository;
      const proposalId = AgentControlProposalId.make("proposal-audit");

      yield* repository.insert({
        auditId: AgentControlAuditId.make("audit-1"),
        proposalId,
        eventKind: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalCreated,
        principalScope: scope,
        promptSummary: "Create 1 thread in project-1",
        metadata: { requestId: "request-audit", planDigest: "a".repeat(64) },
        createdAt: "2026-08-17T00:00:01.000Z",
      });
      yield* repository.insert({
        auditId: AgentControlAuditId.make("audit-2"),
        proposalId,
        eventKind: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalApproved,
        principalScope: scope,
        promptSummary: null,
        metadata: {},
        createdAt: "2026-08-17T00:00:02.000Z",
      });

      const rows = yield* repository.listByProposalId({ proposalId });
      assert.deepStrictEqual(
        rows.map((row) => row.eventKind),
        ["proposal-created", "proposal-approved"],
      );
      assert.deepStrictEqual(rows[0]?.metadata, {
        requestId: "request-audit",
        planDigest: "a".repeat(64),
      });
    }),
  );
});
