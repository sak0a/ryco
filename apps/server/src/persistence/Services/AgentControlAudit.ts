/**
 * AgentControlAuditRepository - Repository interface for Agent Control audit
 * metadata.
 *
 * Audit rows are append-only and deliberately narrow: identifiers, a bounded
 * audit-safe prompt summary, and flat string metadata. Full prompts, plan
 * payloads, secrets, and credentials must never enter this table — the
 * `metadata` shape (flat, bounded string values) makes payload dumps
 * structurally impossible.
 *
 * @module AgentControlAuditRepository
 */
import {
  AgentControlPromptSummary,
  AgentControlProposalId,
  IsoDateTime,
  TrimmedNonEmptyString,
} from "@ryco/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { AgentControlAuditRepositoryError } from "../Errors.ts";
import { AgentControlPrincipalScope } from "./AgentControlProposals.ts";

export const AgentControlAuditId = TrimmedNonEmptyString.pipe(Schema.brand("AgentControlAuditId"));
export type AgentControlAuditId = typeof AgentControlAuditId.Type;

/**
 * Bounded open slug so audit rows written by a newer build still decode
 * here. Known kinds are exported as `AGENT_CONTROL_AUDIT_EVENT_KINDS`.
 */
export const AgentControlAuditEventKind = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
).pipe(Schema.brand("AgentControlAuditEventKind"));
export type AgentControlAuditEventKind = typeof AgentControlAuditEventKind.Type;

export const AGENT_CONTROL_AUDIT_EVENT_KINDS = {
  proposalCreated: AgentControlAuditEventKind.make("proposal-created"),
  proposalApproved: AgentControlAuditEventKind.make("proposal-approved"),
  proposalRejected: AgentControlAuditEventKind.make("proposal-rejected"),
  proposalCancelled: AgentControlAuditEventKind.make("proposal-cancelled"),
  proposalExpired: AgentControlAuditEventKind.make("proposal-expired"),
  proposalExecuting: AgentControlAuditEventKind.make("proposal-executing"),
  proposalCompleted: AgentControlAuditEventKind.make("proposal-completed"),
  proposalFailed: AgentControlAuditEventKind.make("proposal-failed"),
  duplicateRequestRejected: AgentControlAuditEventKind.make("duplicate-request-rejected"),
} as const;

export const AGENT_CONTROL_AUDIT_METADATA_VALUE_MAX_CHARS = 256;

/** Flat identifier metadata: bounded string values only. */
export const AgentControlAuditMetadata = Schema.Record(
  TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  Schema.String.check(Schema.isMaxLength(AGENT_CONTROL_AUDIT_METADATA_VALUE_MAX_CHARS)),
);
export type AgentControlAuditMetadata = typeof AgentControlAuditMetadata.Type;

export const AgentControlAuditRecord = Schema.Struct({
  auditId: AgentControlAuditId,
  proposalId: AgentControlProposalId,
  eventKind: AgentControlAuditEventKind,
  principalScope: AgentControlPrincipalScope,
  promptSummary: Schema.NullOr(AgentControlPromptSummary),
  metadata: AgentControlAuditMetadata,
  createdAt: IsoDateTime,
});
export type AgentControlAuditRecord = typeof AgentControlAuditRecord.Type;

export const ListAgentControlAuditByProposalInput = Schema.Struct({
  proposalId: AgentControlProposalId,
});
export type ListAgentControlAuditByProposalInput = typeof ListAgentControlAuditByProposalInput.Type;

/**
 * AgentControlAuditRepositoryShape - Service API for audit rows.
 */
export interface AgentControlAuditRepositoryShape {
  /** Append an audit row. Rows are never updated or deleted. */
  readonly insert: (
    record: AgentControlAuditRecord,
  ) => Effect.Effect<void, AgentControlAuditRepositoryError>;

  /** Audit trail for one proposal in ascending creation order. */
  readonly listByProposalId: (
    input: ListAgentControlAuditByProposalInput,
  ) => Effect.Effect<ReadonlyArray<AgentControlAuditRecord>, AgentControlAuditRepositoryError>;
}

/**
 * AgentControlAuditRepository - Service tag for audit persistence.
 */
export class AgentControlAuditRepository extends Context.Service<
  AgentControlAuditRepository,
  AgentControlAuditRepositoryShape
>()("ryco/persistence/Services/AgentControlAudit/AgentControlAuditRepository") {}
