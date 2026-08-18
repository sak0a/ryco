/**
 * AgentControlOperationRepository - Repository interface for durable Agent
 * Control execution operations.
 *
 * Exactly one operation exists per accepted proposal. Rows carry monotonic
 * status, an attempt counter, and a durable state snapshot (completed steps
 * plus created-resource evidence) so restart recovery can resume, clean up,
 * or surface a clearly terminal failure.
 *
 * @module AgentControlOperationRepository
 */
import {
  AgentControlOperation,
  AgentControlOperationId,
  AgentControlOperationState,
  AgentControlOperationStatus,
  AgentControlProposalId,
  AgentControlResultEnvelope,
  IsoDateTime,
  NonNegativeInt,
} from "@ryco/contracts";
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

import type { AgentControlOperationRepositoryError } from "../Errors.ts";

export const InsertAgentControlOperationInput = AgentControlOperation;
export type InsertAgentControlOperationInput = typeof InsertAgentControlOperationInput.Type;

export const GetAgentControlOperationInput = Schema.Struct({
  operationId: AgentControlOperationId,
});
export type GetAgentControlOperationInput = typeof GetAgentControlOperationInput.Type;

export const GetAgentControlOperationByProposalInput = Schema.Struct({
  proposalId: AgentControlProposalId,
});
export type GetAgentControlOperationByProposalInput =
  typeof GetAgentControlOperationByProposalInput.Type;

export const CompareAndSetAgentControlOperationInput = Schema.Struct({
  operationId: AgentControlOperationId,
  expectedStatus: AgentControlOperationStatus,
  nextStatus: AgentControlOperationStatus,
  attempt: NonNegativeInt,
  state: AgentControlOperationState,
  result: Schema.NullOr(AgentControlResultEnvelope),
  updatedAt: IsoDateTime,
});
export type CompareAndSetAgentControlOperationInput =
  typeof CompareAndSetAgentControlOperationInput.Type;

/**
 * AgentControlOperationRepositoryShape - Service API for operation rows.
 */
export interface AgentControlOperationRepositoryShape {
  /**
   * Insert a new operation row. Returns `false` when the operation id or
   * the one-operation-per-proposal uniqueness already holds — callers
   * re-read by proposal id. Never overwrites.
   */
  readonly insert: (
    input: InsertAgentControlOperationInput,
  ) => Effect.Effect<boolean, AgentControlOperationRepositoryError>;

  /** Read an operation by id. */
  readonly getById: (
    input: GetAgentControlOperationInput,
  ) => Effect.Effect<Option.Option<AgentControlOperation>, AgentControlOperationRepositoryError>;

  /** Read the operation owned by a proposal. */
  readonly getByProposalId: (
    input: GetAgentControlOperationByProposalInput,
  ) => Effect.Effect<Option.Option<AgentControlOperation>, AgentControlOperationRepositoryError>;

  /** Non-terminal operations for restart recovery, oldest update first. */
  readonly listRecoverable: () => Effect.Effect<
    ReadonlyArray<AgentControlOperation>,
    AgentControlOperationRepositoryError
  >;

  /**
   * Monotonic status transition with a full state-snapshot replacement.
   * Returns `false` when the expected status did not match.
   */
  readonly compareAndSet: (
    input: CompareAndSetAgentControlOperationInput,
  ) => Effect.Effect<boolean, AgentControlOperationRepositoryError>;
}

/**
 * AgentControlOperationRepository - Service tag for operation persistence.
 */
export class AgentControlOperationRepository extends Context.Service<
  AgentControlOperationRepository,
  AgentControlOperationRepositoryShape
>()("ryco/persistence/Services/AgentControlOperations/AgentControlOperationRepository") {}
