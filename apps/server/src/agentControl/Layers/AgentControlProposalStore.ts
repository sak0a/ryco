import {
  AGENT_CONTROL_ERROR_CODES,
  AGENT_CONTROL_PLAN_VERSION,
  AgentControlProposal,
  AgentControlProposalId,
  type AgentControlProposalStatus,
  type IsoDateTime,
} from "@ryco/contracts";
import { Effect, Layer, Option } from "effect";

import {
  AGENT_CONTROL_AUDIT_EVENT_KINDS,
  type AgentControlAuditEventKind,
  AgentControlAuditId,
  type AgentControlAuditMetadata,
  AgentControlAuditRepository,
} from "../../persistence/Services/AgentControlAudit.ts";
import {
  type AgentControlPrincipalScope,
  AgentControlProposalRepository,
} from "../../persistence/Services/AgentControlProposals.ts";
import {
  AgentControlDuplicateRequestError,
  AgentControlInvalidTransitionError,
  AgentControlProposalExpiredError,
  AgentControlProposalNotFoundError,
} from "../Errors.ts";
import { agentControlPrincipalScope } from "../principal.ts";
import { computeAgentControlPlanDigest } from "../planDigest.ts";
import { AgentControlPolicy } from "../Services/AgentControlPolicy.ts";
import {
  AgentControlProposalStore,
  type AgentControlProposalStoreShape,
  type AgentControlProposalDecision,
  agentControlFailureResult,
} from "../Services/AgentControlProposalStore.ts";
import { proposalTransitionIssue, type AgentControlTransitionActor } from "../transitions.ts";

const DECISION_AUDIT_EVENT_KINDS: Record<AgentControlProposalDecision, AgentControlAuditEventKind> =
  {
    approved: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalApproved,
    rejected: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalRejected,
    cancelled: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalCancelled,
  };

const DECISION_ERROR_CODES = {
  rejected: AGENT_CONTROL_ERROR_CODES.rejected,
  cancelled: AGENT_CONTROL_ERROR_CODES.cancelled,
} as const;

/**
 * Identifier-only audit metadata. Deliberately never derived from plan
 * content: no prompt text, titles, or message bodies may enter audit rows.
 */
const auditMetadataForProposal = (proposal: AgentControlProposal): AgentControlAuditMetadata => ({
  requestId: proposal.requestId,
  actionKind: proposal.plan.kind,
  planDigest: proposal.planDigest,
  principalKind: proposal.principal.kind,
  expiresAt: proposal.expiresAt,
  ...(proposal.principal.kind === "provider-session"
    ? {
        threadId: proposal.principal.threadId,
        providerInstanceId: proposal.principal.providerInstanceId,
      }
    : { integrationId: proposal.principal.integrationId }),
});

const makeAgentControlProposalStore = Effect.gen(function* () {
  const policy = yield* AgentControlPolicy;
  const proposals = yield* AgentControlProposalRepository;
  const audit = yield* AgentControlAuditRepository;

  const appendAudit = (input: {
    readonly proposal: AgentControlProposal;
    readonly principalScope: AgentControlPrincipalScope;
    readonly eventKind: AgentControlAuditEventKind;
    readonly createdAt: IsoDateTime;
    readonly extraMetadata?: AgentControlAuditMetadata;
  }) =>
    audit.insert({
      auditId: AgentControlAuditId.make(crypto.randomUUID()),
      proposalId: input.proposal.proposalId,
      eventKind: input.eventKind,
      principalScope: input.principalScope,
      promptSummary: input.proposal.promptSummary,
      metadata: {
        ...auditMetadataForProposal(input.proposal),
        ...input.extraMetadata,
      },
      createdAt: input.createdAt,
    });

  const getOrNotFound = (proposalId: AgentControlProposalId) =>
    proposals.getById({ proposalId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new AgentControlProposalNotFoundError({ proposalId })),
          onSome: Effect.succeed,
        }),
      ),
    );

  /**
   * Winner-takes-once transition: validate against the legal table, then
   * compare-and-set. A lost race re-reads and reports the actual state.
   */
  const transitionTo = (input: {
    readonly current: AgentControlProposal;
    readonly nextStatus: AgentControlProposalStatus;
    readonly actor: AgentControlTransitionActor;
    readonly decidedAt: IsoDateTime | null;
    readonly result: AgentControlProposal["result"];
    readonly eventKind: AgentControlAuditEventKind;
    readonly updatedAt: IsoDateTime;
  }) =>
    Effect.gen(function* () {
      const issue = proposalTransitionIssue({
        from: input.current.status,
        to: input.nextStatus,
        actor: input.actor,
      });
      if (issue !== null) {
        return yield* new AgentControlInvalidTransitionError({
          entity: "proposal",
          from: input.current.status,
          to: input.nextStatus,
          actor: input.actor,
          detail: issue,
        });
      }

      const won = yield* proposals.compareAndSetStatus({
        proposalId: input.current.proposalId,
        expectedStatus: input.current.status,
        nextStatus: input.nextStatus,
        decidedAt: input.decidedAt,
        result: input.result,
        updatedAt: input.updatedAt,
      });
      if (!won) {
        const actual = yield* getOrNotFound(input.current.proposalId);
        return yield* new AgentControlInvalidTransitionError({
          entity: "proposal",
          from: actual.status,
          to: input.nextStatus,
          actor: input.actor,
          detail: `lost transition race; proposal is now ${actual.status}`,
        });
      }

      const updated: AgentControlProposal = {
        ...input.current,
        status: input.nextStatus,
        decidedAt: input.decidedAt,
        result: input.result,
        updatedAt: input.updatedAt,
      };
      yield* appendAudit({
        proposal: updated,
        principalScope: agentControlPrincipalScope(updated.principal),
        eventKind: input.eventKind,
        createdAt: input.updatedAt,
      });
      return updated;
    });

  /**
   * Expiry enforcement shared by decision and execution paths: a
   * non-terminal proposal past its expiry is expired in place (best effort;
   * a lost race just means someone else settled it) and refuses the caller.
   */
  const failIfExpired = (proposal: AgentControlProposal, now: IsoDateTime) =>
    Effect.gen(function* () {
      if (now < proposal.expiresAt) {
        return;
      }
      const expiry = transitionTo({
        current: proposal,
        nextStatus: "expired",
        actor: "system",
        decidedAt: proposal.decidedAt,
        result: agentControlFailureResult({
          error: {
            code: AGENT_CONTROL_ERROR_CODES.expired,
            message: `Proposal expired at ${proposal.expiresAt}`,
            retryable: true,
          },
          failedAt: now,
        }),
        eventKind: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalExpired,
        updatedAt: now,
      });
      yield* expiry.pipe(
        Effect.catchTag("AgentControlInvalidTransitionError", () => Effect.succeed(proposal)),
      );
      return yield* new AgentControlProposalExpiredError({
        proposalId: proposal.proposalId,
        expiresAt: proposal.expiresAt,
      });
    });

  const submit: AgentControlProposalStoreShape["submit"] = (input) =>
    Effect.gen(function* () {
      yield* policy.requireEnabled("AgentControlProposalStore.submit");

      const planDigest = computeAgentControlPlanDigest(input.plan);
      const principalScope = agentControlPrincipalScope(input.principal);
      const proposal: AgentControlProposal = {
        proposalId: AgentControlProposalId.make(crypto.randomUUID()),
        requestId: input.requestId,
        principal: input.principal,
        planVersion: AGENT_CONTROL_PLAN_VERSION,
        plan: input.plan,
        planDigest,
        riskTags: input.riskTags,
        promptSummary: input.promptSummary,
        status: "pending-user-approval",
        createdAt: input.now,
        updatedAt: input.now,
        expiresAt: input.expiresAt,
        decidedAt: null,
        result: null,
      };

      const inserted = yield* proposals.insert({ proposal, principalScope });
      if (inserted) {
        yield* appendAudit({
          proposal,
          principalScope,
          eventKind: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalCreated,
          createdAt: input.now,
        });
        return { proposal, replayed: false };
      }

      const existing = yield* proposals.findByRequest({
        principalScope,
        requestId: input.requestId,
      });
      if (Option.isNone(existing)) {
        // The insert conflicted on something other than the request key
        // (a proposal-id collision). Surface it as a duplicate rather than
        // pretending a row exists.
        return yield* new AgentControlDuplicateRequestError({
          requestId: input.requestId,
          existingProposalId: null,
          requestedPlanDigest: planDigest,
          existingPlanDigest: null,
        });
      }
      if (existing.value.planDigest === planDigest) {
        return { proposal: existing.value, replayed: true };
      }

      yield* appendAudit({
        proposal: existing.value,
        principalScope,
        eventKind: AGENT_CONTROL_AUDIT_EVENT_KINDS.duplicateRequestRejected,
        createdAt: input.now,
        extraMetadata: { requestedPlanDigest: planDigest },
      });
      return yield* new AgentControlDuplicateRequestError({
        requestId: input.requestId,
        existingProposalId: existing.value.proposalId,
        requestedPlanDigest: planDigest,
        existingPlanDigest: existing.value.planDigest,
      });
    });

  const getById: AgentControlProposalStoreShape["getById"] = (proposalId) =>
    proposals.getById({ proposalId });

  const listPending: AgentControlProposalStoreShape["listPending"] = (input) =>
    proposals.listPending({ limit: input.limit });

  const decide: AgentControlProposalStoreShape["decide"] = (input) =>
    Effect.gen(function* () {
      yield* policy.requireEnabled("AgentControlProposalStore.decide");
      const current = yield* getOrNotFound(input.proposalId);
      yield* failIfExpired(current, input.decidedAt);

      const result =
        input.decision === "approved"
          ? null
          : agentControlFailureResult({
              error: {
                code: DECISION_ERROR_CODES[input.decision],
                message: `Proposal was ${input.decision}`,
                retryable: false,
              },
              failedAt: input.decidedAt,
            });
      return yield* transitionTo({
        current,
        nextStatus: input.decision,
        actor: input.actor,
        decidedAt: input.decidedAt,
        result,
        eventKind: DECISION_AUDIT_EVENT_KINDS[input.decision],
        updatedAt: input.decidedAt,
      });
    });

  const beginExecution: AgentControlProposalStoreShape["beginExecution"] = (input) =>
    Effect.gen(function* () {
      yield* policy.requireEnabled("AgentControlProposalStore.beginExecution");
      const current = yield* getOrNotFound(input.proposalId);
      yield* failIfExpired(current, input.now);

      return yield* transitionTo({
        current,
        nextStatus: "executing",
        actor: input.actor,
        decidedAt: current.decidedAt,
        result: null,
        eventKind: AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalExecuting,
        updatedAt: input.now,
      });
    });

  const settleExecution: AgentControlProposalStoreShape["settleExecution"] = (input) =>
    Effect.gen(function* () {
      const current = yield* getOrNotFound(input.proposalId);
      const completed = input.result.outcome === "completed";
      return yield* transitionTo({
        current,
        nextStatus: completed ? "completed" : "failed",
        actor: "executor",
        decidedAt: current.decidedAt,
        result: input.result,
        eventKind: completed
          ? AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalCompleted
          : AGENT_CONTROL_AUDIT_EVENT_KINDS.proposalFailed,
        updatedAt: input.now,
      });
    });

  return {
    submit,
    getById,
    listPending,
    decide,
    beginExecution,
    settleExecution,
  } satisfies AgentControlProposalStoreShape;
});

export const AgentControlProposalStoreLive = Layer.effect(
  AgentControlProposalStore,
  makeAgentControlProposalStore,
);
