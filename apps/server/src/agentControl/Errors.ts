import { Schema } from "effect";

// ===============================
// Agent Control Domain Errors
// ===============================

/**
 * The Agent Control feature gate is off (or unreadable — the gate fails
 * closed). Every Agent Control entry point surfaces this instead of
 * partially working while disabled.
 */
export class AgentControlDisabledError extends Schema.TaggedError<AgentControlDisabledError>()(
  "AgentControlDisabledError",
  {
    operation: Schema.String,
  },
) {
  override get message(): string {
    return `Agent Control is disabled: ${this.operation} refused`;
  }
}

export class AgentControlCapabilityDeniedError extends Schema.TaggedError<AgentControlCapabilityDeniedError>()(
  "AgentControlCapabilityDeniedError",
  {
    operation: Schema.String,
    capability: Schema.String,
  },
) {
  override get message(): string {
    return `Agent Control capability ${this.capability} denied in ${this.operation}`;
  }
}

/**
 * The caller reused a request id with a different plan. The original
 * proposal is never modified; the caller must issue a new request id.
 */
export class AgentControlDuplicateRequestError extends Schema.TaggedError<AgentControlDuplicateRequestError>()(
  "AgentControlDuplicateRequestError",
  {
    requestId: Schema.String,
    existingProposalId: Schema.NullOr(Schema.String),
    requestedPlanDigest: Schema.String,
    existingPlanDigest: Schema.NullOr(Schema.String),
  },
) {
  override get message(): string {
    return `Agent Control request ${this.requestId} was already used with a different plan`;
  }
}

export class AgentControlProposalNotFoundError extends Schema.TaggedError<AgentControlProposalNotFoundError>()(
  "AgentControlProposalNotFoundError",
  {
    proposalId: Schema.String,
  },
) {
  override get message(): string {
    return `Agent Control proposal ${this.proposalId} was not found`;
  }
}

export class AgentControlOperationNotFoundError extends Schema.TaggedError<AgentControlOperationNotFoundError>()(
  "AgentControlOperationNotFoundError",
  {
    operationId: Schema.String,
  },
) {
  override get message(): string {
    return `Agent Control operation ${this.operationId} was not found`;
  }
}

/**
 * A state transition outside the legal transition table (or by an actor
 * that is not permitted to perform it) was rejected. Also raised when a
 * compare-and-set loses a race and the re-read state no longer permits the
 * transition — the winner's state stands.
 */
export class AgentControlInvalidTransitionError extends Schema.TaggedError<AgentControlInvalidTransitionError>()(
  "AgentControlInvalidTransitionError",
  {
    entity: Schema.Literals(["proposal", "operation"]),
    from: Schema.String,
    to: Schema.String,
    actor: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Illegal Agent Control ${this.entity} transition ${this.from} -> ${this.to} by ${this.actor}: ${this.detail}`;
  }
}

/** The proposal's expiry passed before it could be decided or executed. */
export class AgentControlProposalExpiredError extends Schema.TaggedError<AgentControlProposalExpiredError>()(
  "AgentControlProposalExpiredError",
  {
    proposalId: Schema.String,
    expiresAt: Schema.String,
  },
) {
  override get message(): string {
    return `Agent Control proposal ${this.proposalId} expired at ${this.expiresAt}`;
  }
}
