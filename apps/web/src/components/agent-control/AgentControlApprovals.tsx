import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AGENT_CONTROL_WS_METHODS,
  type AgentControlProposalId,
  type EnvironmentId,
  type ThreadId,
} from "@ryco/contracts";
import {
  buildAgentControlProposalCardModel,
  selectActiveAgentControlProposals,
  selectRecentAgentControlProposals,
  startAgentControlProposalSync,
  useAgentControlStore,
} from "@ryco/client-runtime/state/agentControl";

import { readEnvironmentApi } from "../../environmentApi";
import { useHostedRpcCapability } from "../../hostedHub/capabilities";
import { useSettings } from "../../hooks/useSettings";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { AgentControlProposalCard } from "./AgentControlProposalCard";

export interface AgentControlApprovalsProps {
  readonly environmentId: EnvironmentId;
  readonly activeThreadId: ThreadId | null;
}

/**
 * The Agent Control approval surface for one environment: every live
 * proposal as a decidable card — proposals raised from the active thread
 * first — plus a collapsed history of recent terminal decisions. Renders
 * nothing while the Agent Control server setting is disabled; all policy
 * stays server-side, this surface only renders state and sends explicit
 * decisions.
 */
export function AgentControlApprovals({
  environmentId,
  activeThreadId,
}: AgentControlApprovalsProps) {
  const enabled = useSettings((settings) => settings.agentControl.enabled);
  const decisionCapability = useHostedRpcCapability(AGENT_CONTROL_WS_METHODS.acceptProposal);
  const [submittingIds, setSubmittingIds] = useState<ReadonlyArray<string>>([]);
  const [decisionErrorsById, setDecisionErrorsById] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const source = readEnvironmentApi(environmentId)?.agentControl;
    if (!source) return undefined;
    const store = useAgentControlStore.getState();
    return startAgentControlProposalSync({
      environmentId,
      source,
      sink: {
        applyStreamEvent: store.applyStreamEvent,
        clearEnvironment: store.clearEnvironment,
      },
    });
  }, [enabled, environmentId]);

  const queueState = useAgentControlStore(
    (state) => state.queueByEnvironmentId[environmentId] ?? null,
  );
  const active = useMemo(
    () => (queueState === null ? [] : selectActiveAgentControlProposals(queueState)),
    [queueState],
  );
  const recent = useMemo(
    () => (queueState === null ? [] : selectRecentAgentControlProposals(queueState)),
    [queueState],
  );
  const orderedActive = useMemo(() => {
    if (activeThreadId === null) return active;
    return active.toSorted((left, right) => {
      const leftLocal =
        left.principal.kind === "provider-session" && left.principal.threadId === activeThreadId;
      const rightLocal =
        right.principal.kind === "provider-session" && right.principal.threadId === activeThreadId;
      return Number(rightLocal) - Number(leftLocal);
    });
  }, [active, activeThreadId]);

  const decide = useCallback(
    async (proposalId: AgentControlProposalId, decision: "accept" | "reject") => {
      const api = readEnvironmentApi(environmentId)?.agentControl;
      if (!api) return;
      setSubmittingIds((current) =>
        current.includes(proposalId) ? current : [...current, proposalId],
      );
      setDecisionErrorsById(({ [proposalId]: _cleared, ...rest }) => rest);
      try {
        if (decision === "accept") {
          await api.acceptProposal({ proposalId });
        } else {
          await api.rejectProposal({ proposalId });
        }
      } catch (error) {
        // Stale/conflicting decisions surface here; the queue subscription
        // delivers the authoritative state alongside this message.
        setDecisionErrorsById((current) => ({
          ...current,
          [proposalId]:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "Failed to submit the decision.",
        }));
      } finally {
        setSubmittingIds((current) => current.filter((id) => id !== proposalId));
      }
    },
    [environmentId],
  );

  if (!enabled || (orderedActive.length === 0 && recent.length === 0)) {
    return null;
  }

  return (
    <div data-testid="agent-control-approvals">
      {orderedActive.map((proposal) => (
        <AgentControlProposalCard
          key={proposal.proposalId}
          model={buildAgentControlProposalCardModel(proposal)}
          isSubmitting={submittingIds.includes(proposal.proposalId)}
          decisionError={decisionErrorsById[proposal.proposalId] ?? null}
          disabledReason={decisionCapability.allowed ? null : (decisionCapability.reason ?? null)}
          onAccept={() => void decide(proposal.proposalId, "accept")}
          onReject={() => void decide(proposal.proposalId, "reject")}
        />
      ))}
      {recent.length > 0 ? (
        <div className="mb-2">
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((current) => !current)}
          >
            Recent Agent Control decisions · {recent.length}
          </Button>
          {historyOpen ? (
            <ul data-testid="agent-control-recent" className="mt-1 flex flex-col gap-0.5">
              {recent.map((proposal) => {
                const model = buildAgentControlProposalCardModel(proposal);
                return (
                  <li
                    key={proposal.proposalId}
                    className="flex min-w-0 items-baseline gap-2 px-2 text-xs text-muted-foreground"
                  >
                    <span className="shrink-0 font-medium text-foreground/80">
                      {model.statusLabel}
                    </span>
                    <span className="min-w-0 truncate">
                      {model.actionLabel} · {model.targetLabel} · {model.originLabel}
                    </span>
                    <span className="ml-auto shrink-0">
                      {formatRelativeTimeLabel(proposal.updatedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
