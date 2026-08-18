import { Context } from "effect";
import type { Effect } from "effect";
import type { AgentControlProposalId } from "@ryco/contracts";

/** Lifecycle owner and sole consumer of approved Agent Control proposals. */
export interface AgentControlExecutionShape {
  /** Idempotently attempt to consume one approved proposal. */
  readonly executeApproved: (proposalId: AgentControlProposalId) => Effect.Effect<void>;
  /** Conservatively settle operations left incomplete by a prior process. */
  readonly recoverIncomplete: Effect.Effect<void>;
}

export class AgentControlExecution extends Context.Service<
  AgentControlExecution,
  AgentControlExecutionShape
>()("ryco/agentControl/Services/AgentControlExecution") {}
