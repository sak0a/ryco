/**
 * AgentControlProposalRepository - Repository interface for Agent Control
 * approval proposals.
 *
 * Proposals are immutable where it matters: the plan payload, digest,
 * principal, and request identity are written once and never updated. The
 * only mutation is a compare-and-set status transition that may also stamp
 * the decision time and terminal result.
 *
 * This repository is independent of `ProjectionPendingApprovalRepository`,
 * which represents provider-native callback approvals.
 *
 * @module AgentControlProposalRepository
 */
import {
  AgentControlProposal,
  AgentControlProposalId,
  AgentControlProposalStatus,
  AgentControlRequestId,
  AgentControlResultEnvelope,
  IsoDateTime,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@ryco/contracts";
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

import type { AgentControlProposalRepositoryError } from "../Errors.ts";

/**
 * Idempotency scope key derived from the proposal's principal (see
 * `agentControlPrincipalScope`). `requestId` is unique within one scope.
 */
export const AgentControlPrincipalScope = TrimmedNonEmptyString.check(Schema.isMaxLength(256)).pipe(
  Schema.brand("AgentControlPrincipalScope"),
);
export type AgentControlPrincipalScope = typeof AgentControlPrincipalScope.Type;

export const InsertAgentControlProposalInput = Schema.Struct({
  proposal: AgentControlProposal,
  principalScope: AgentControlPrincipalScope,
});
export type InsertAgentControlProposalInput = typeof InsertAgentControlProposalInput.Type;

export const GetAgentControlProposalInput = Schema.Struct({
  proposalId: AgentControlProposalId,
});
export type GetAgentControlProposalInput = typeof GetAgentControlProposalInput.Type;

export const FindAgentControlProposalByRequestInput = Schema.Struct({
  principalScope: AgentControlPrincipalScope,
  requestId: AgentControlRequestId,
});
export type FindAgentControlProposalByRequestInput =
  typeof FindAgentControlProposalByRequestInput.Type;

export const ListPendingAgentControlProposalsInput = Schema.Struct({
  limit: PositiveInt,
});
export type ListPendingAgentControlProposalsInput =
  typeof ListPendingAgentControlProposalsInput.Type;

export const CompareAndSetAgentControlProposalStatusInput = Schema.Struct({
  proposalId: AgentControlProposalId,
  expectedStatus: AgentControlProposalStatus,
  nextStatus: AgentControlProposalStatus,
  decidedAt: Schema.NullOr(IsoDateTime),
  result: Schema.NullOr(AgentControlResultEnvelope),
  updatedAt: IsoDateTime,
});
export type CompareAndSetAgentControlProposalStatusInput =
  typeof CompareAndSetAgentControlProposalStatusInput.Type;

/**
 * AgentControlProposalRepositoryShape - Service API for proposal rows.
 */
export interface AgentControlProposalRepositoryShape {
  /**
   * Insert a new proposal row. Returns `false` when either the proposal id
   * or the `(principalScope, requestId)` idempotency key already exists —
   * callers re-read by request and compare digests. Never overwrites.
   */
  readonly insert: (
    input: InsertAgentControlProposalInput,
  ) => Effect.Effect<boolean, AgentControlProposalRepositoryError>;

  /** Read a proposal by id. */
  readonly getById: (
    input: GetAgentControlProposalInput,
  ) => Effect.Effect<Option.Option<AgentControlProposal>, AgentControlProposalRepositoryError>;

  /** Idempotent request lookup within one principal scope. */
  readonly findByRequest: (
    input: FindAgentControlProposalByRequestInput,
  ) => Effect.Effect<Option.Option<AgentControlProposal>, AgentControlProposalRepositoryError>;

  /** Pending approval queue, oldest first. */
  readonly listPending: (
    input: ListPendingAgentControlProposalsInput,
  ) => Effect.Effect<ReadonlyArray<AgentControlProposal>, AgentControlProposalRepositoryError>;

  /**
   * Monotonic status transition. Only `status`, `decided_at`, `result_json`,
   * and `updated_at` change; returns `false` when the expected status did
   * not match (exactly one caller wins a transition).
   */
  readonly compareAndSetStatus: (
    input: CompareAndSetAgentControlProposalStatusInput,
  ) => Effect.Effect<boolean, AgentControlProposalRepositoryError>;
}

/**
 * AgentControlProposalRepository - Service tag for proposal persistence.
 */
export class AgentControlProposalRepository extends Context.Service<
  AgentControlProposalRepository,
  AgentControlProposalRepositoryShape
>()("ryco/persistence/Services/AgentControlProposals/AgentControlProposalRepository") {}
