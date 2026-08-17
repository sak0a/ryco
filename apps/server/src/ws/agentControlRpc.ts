import {
  AGENT_CONTROL_WS_METHODS,
  AgentControlProposalStatus,
  AgentControlRpcError,
} from "@ryco/contracts";
import { Effect, Option, Schema, Stream } from "effect";

import type { AgentControlProposalStoreError } from "../agentControl/Services/AgentControlProposalStore.ts";
import { observeRpcEffect, observeRpcStreamEffect } from "../observability/RpcInstrumentation.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

const isProposalStatus = Schema.is(AgentControlProposalStatus);

/**
 * Map internal lifecycle failures onto the bounded RPC error. A decision
 * conflict names the proposal's actual status so the client can render
 * "already approved elsewhere"; nothing else about the resource — plans,
 * prompts, storage details — crosses this boundary.
 */
export const toAgentControlRpcError = (
  error: AgentControlProposalStoreError,
): AgentControlRpcError => {
  switch (error._tag) {
    case "AgentControlDisabledError":
      return new AgentControlRpcError({
        code: "disabled",
        message: "Agent Control is disabled.",
      });
    case "AgentControlProposalNotFoundError":
      return new AgentControlRpcError({
        code: "not-found",
        message: "Agent Control proposal was not found.",
      });
    case "AgentControlProposalExpiredError":
      return new AgentControlRpcError({
        code: "expired",
        message: "Proposal expired before the decision could apply.",
        status: "expired",
      });
    case "AgentControlInvalidTransitionError":
      return new AgentControlRpcError({
        code: "conflict",
        message: "Decision no longer applies to the proposal's current state.",
        ...(isProposalStatus(error.from) ? { status: error.from } : {}),
      });
    case "AgentControlDuplicateRequestError":
      return new AgentControlRpcError({
        code: "conflict",
        message: "Request id was already used with a different plan.",
      });
    default:
      return new AgentControlRpcError({
        code: "storage",
        message: "Agent Control storage failed.",
      });
  }
};

export const makeAgentControlHandlers = (ctx: WsRpcContext) => {
  const { agentControlProposals, ownerEffect, ownerStreamEffect } = ctx;

  const withService = <A, E>(
    use: (
      service: Option.Option.Value<typeof agentControlProposals>,
    ) => Effect.Effect<A, E | AgentControlRpcError>,
  ) =>
    Option.match(agentControlProposals, {
      onNone: () =>
        Effect.fail(
          new AgentControlRpcError({
            code: "storage",
            message: "Agent Control is unavailable.",
          }),
        ),
      onSome: use,
    });

  return defineWsHandlers({
    [AGENT_CONTROL_WS_METHODS.listProposals]: (input) =>
      observeRpcEffect(
        AGENT_CONTROL_WS_METHODS.listProposals,
        ownerEffect(
          AGENT_CONTROL_WS_METHODS.listProposals,
          withService((service) =>
            service
              .getQueue({ activeLimit: input.activeLimit, recentLimit: input.recentLimit })
              .pipe(Effect.mapError(toAgentControlRpcError)),
          ),
        ),
        { "rpc.aggregate": "agent-control", "rpc.operation": "list" },
      ),
    [AGENT_CONTROL_WS_METHODS.getProposal]: (input) =>
      observeRpcEffect(
        AGENT_CONTROL_WS_METHODS.getProposal,
        ownerEffect(
          AGENT_CONTROL_WS_METHODS.getProposal,
          withService((service) =>
            service.getProposal(input.proposalId).pipe(
              Effect.map((proposal) => ({ proposal: Option.getOrNull(proposal) })),
              Effect.mapError(toAgentControlRpcError),
            ),
          ),
        ),
        { "rpc.aggregate": "agent-control", "rpc.operation": "get" },
      ),
    [AGENT_CONTROL_WS_METHODS.acceptProposal]: (input) =>
      observeRpcEffect(
        AGENT_CONTROL_WS_METHODS.acceptProposal,
        ownerEffect(
          AGENT_CONTROL_WS_METHODS.acceptProposal,
          withService((service) =>
            service
              .accept({ proposalId: input.proposalId, decidedAt: new Date().toISOString() })
              .pipe(Effect.mapError(toAgentControlRpcError)),
          ),
        ),
        { "rpc.aggregate": "agent-control", "rpc.operation": "accept" },
      ),
    [AGENT_CONTROL_WS_METHODS.rejectProposal]: (input) =>
      observeRpcEffect(
        AGENT_CONTROL_WS_METHODS.rejectProposal,
        ownerEffect(
          AGENT_CONTROL_WS_METHODS.rejectProposal,
          withService((service) =>
            service
              .reject({ proposalId: input.proposalId, decidedAt: new Date().toISOString() })
              .pipe(Effect.mapError(toAgentControlRpcError)),
          ),
        ),
        { "rpc.aggregate": "agent-control", "rpc.operation": "reject" },
      ),
    [AGENT_CONTROL_WS_METHODS.subscribeProposals]: (_input) =>
      observeRpcStreamEffect(
        AGENT_CONTROL_WS_METHODS.subscribeProposals,
        ownerStreamEffect(
          AGENT_CONTROL_WS_METHODS.subscribeProposals,
          withService((service) =>
            Effect.succeed(
              service.subscribeQueue({}).pipe(Stream.mapError(toAgentControlRpcError)),
            ),
          ),
        ),
        { "rpc.aggregate": "agent-control" },
      ),
  });
};
