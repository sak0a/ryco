/**
 * Pure Agent Control proposal-queue state: hydration from queue snapshots,
 * revision-deduplicated change-event application, and selectors.
 *
 * The server is the only policy authority — this module never decides
 * anything; it renders what the server published. Every change event
 * carries the full proposal document, so applying state is an upsert
 * keyed by `proposalId`, deduplicated by the event `revision`:
 *
 *   - A snapshot replaces the environment's state wholesale and resets the
 *     dedupe baseline (server revisions are per-process, not durable).
 *   - A proposal event at or below the baseline is a replay and is dropped.
 *   - Terminal proposals stay as bounded history; the oldest are pruned.
 */
import {
  AGENT_CONTROL_QUEUE_RECENT_LIMIT_DEFAULT,
  AGENT_CONTROL_TERMINAL_PROPOSAL_STATUSES,
  type AgentControlProposal,
  type AgentControlProposalStatus,
  type AgentControlProposalStreamEvent,
  type ThreadId,
} from "@ryco/contracts";

export interface AgentControlQueueState {
  /** Whether a snapshot has been applied since (re)subscribing. */
  readonly hydrated: boolean;
  /** Dedupe baseline: the highest applied event revision. */
  readonly revision: number;
  readonly proposalsById: Readonly<Record<string, AgentControlProposal>>;
}

export const EMPTY_AGENT_CONTROL_QUEUE_STATE: AgentControlQueueState = {
  hydrated: false,
  revision: 0,
  proposalsById: {},
};

/** Terminal proposals kept as local history before pruning the oldest. */
export const AGENT_CONTROL_CLIENT_HISTORY_LIMIT = AGENT_CONTROL_QUEUE_RECENT_LIMIT_DEFAULT;

const TERMINAL_STATUSES: ReadonlySet<AgentControlProposalStatus> = new Set(
  AGENT_CONTROL_TERMINAL_PROPOSAL_STATUSES,
);

export function isTerminalAgentControlStatus(status: AgentControlProposalStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function pruneTerminalHistory(
  proposalsById: Readonly<Record<string, AgentControlProposal>>,
): Readonly<Record<string, AgentControlProposal>> {
  const terminal = Object.values(proposalsById).filter((proposal) =>
    isTerminalAgentControlStatus(proposal.status),
  );
  if (terminal.length <= AGENT_CONTROL_CLIENT_HISTORY_LIMIT) {
    return proposalsById;
  }
  const dropped = terminal
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(AGENT_CONTROL_CLIENT_HISTORY_LIMIT);
  const next = { ...proposalsById };
  for (const proposal of dropped) {
    delete next[proposal.proposalId];
  }
  return next;
}

export function applyAgentControlStreamEvent(
  state: AgentControlQueueState,
  event: AgentControlProposalStreamEvent,
): AgentControlQueueState {
  if (event.type === "snapshot") {
    const proposalsById: Record<string, AgentControlProposal> = {};
    for (const proposal of [...event.queue.active, ...event.queue.recent]) {
      proposalsById[proposal.proposalId] = proposal;
    }
    return {
      hydrated: true,
      revision: event.queue.revision,
      proposalsById,
    };
  }

  // Change events before the first snapshot have no baseline to order
  // against; the snapshot that follows will cover them.
  if (!state.hydrated) {
    return state;
  }
  if (event.revision <= state.revision) {
    return state;
  }
  return {
    hydrated: true,
    revision: event.revision,
    proposalsById: pruneTerminalHistory({
      ...state.proposalsById,
      [event.proposal.proposalId]: event.proposal,
    }),
  };
}

/** Non-terminal proposals, oldest first — the live queue. */
export function selectActiveAgentControlProposals(
  state: AgentControlQueueState,
): ReadonlyArray<AgentControlProposal> {
  return Object.values(state.proposalsById)
    .filter((proposal) => !isTerminalAgentControlStatus(proposal.status))
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.proposalId.localeCompare(right.proposalId),
    );
}

/** Terminal proposals, most recently updated first — the history. */
export function selectRecentAgentControlProposals(
  state: AgentControlQueueState,
): ReadonlyArray<AgentControlProposal> {
  return Object.values(state.proposalsById)
    .filter((proposal) => isTerminalAgentControlStatus(proposal.status))
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.proposalId.localeCompare(left.proposalId),
    );
}

/**
 * Live proposals raised from inside `threadId` — the thread-local card
 * shows the caller thread its own outstanding requests.
 */
export function selectAgentControlProposalsForThread(
  state: AgentControlQueueState,
  threadId: ThreadId,
): ReadonlyArray<AgentControlProposal> {
  return selectActiveAgentControlProposals(state).filter(
    (proposal) =>
      proposal.principal.kind === "provider-session" && proposal.principal.threadId === threadId,
  );
}
