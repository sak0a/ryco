/**
 * Pure presentation model for Agent Control proposal cards.
 *
 * Renders only what the server published: origin, exact action and target,
 * risk, runtime/worktree conditions, expiry, and terminal outcome. The
 * audit-safe prompt summary is the default text; full prompts appear only
 * in `detailSections`, which the card reveals through deliberate expansion.
 */
import type {
  AgentControlProposal,
  AgentControlProposalId,
  AgentControlProposalStatus,
  ThreadId,
} from "@ryco/contracts";

export type AgentControlStatusTone = "pending" | "info" | "success" | "danger" | "muted";

export interface AgentControlDetailSection {
  readonly heading: string;
  readonly lines: ReadonlyArray<string>;
}

export interface AgentControlProposalCardModel {
  readonly proposalId: AgentControlProposalId;
  readonly status: AgentControlProposalStatus;
  readonly statusLabel: string;
  readonly statusTone: AgentControlStatusTone;
  readonly originLabel: string;
  readonly originThreadId: ThreadId | null;
  readonly actionLabel: string;
  readonly targetLabel: string;
  readonly runtimeLabel: string | null;
  readonly riskLabels: ReadonlyArray<string>;
  readonly summary: string | null;
  readonly expiresAt: string;
  readonly isPending: boolean;
  readonly outcomeLabel: string | null;
  readonly detailSections: ReadonlyArray<AgentControlDetailSection>;
}

const STATUS_PRESENTATION: Record<
  AgentControlProposalStatus,
  { readonly label: string; readonly tone: AgentControlStatusTone }
> = {
  "pending-user-approval": { label: "Awaiting approval", tone: "pending" },
  approved: { label: "Approved · awaiting executor", tone: "info" },
  executing: { label: "Executing", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  rejected: { label: "Rejected", tone: "muted" },
  expired: { label: "Expired", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

const shortId = (value: string): string => (value.length > 10 ? `${value.slice(0, 8)}…` : value);

const riskLabelFromTag = (tag: string): string => tag.replaceAll("-", " ");

function originPresentation(proposal: AgentControlProposal): {
  readonly label: string;
  readonly threadId: ThreadId | null;
} {
  const principal = proposal.principal;
  if (principal.kind === "provider-session") {
    return {
      label: `Agent in thread ${shortId(principal.threadId)} (${principal.providerInstanceId})`,
      threadId: principal.threadId,
    };
  }
  return {
    label: `External integration ${principal.label ?? shortId(principal.integrationId)}`,
    threadId: null,
  };
}

function planPresentation(proposal: AgentControlProposal): {
  readonly actionLabel: string;
  readonly targetLabel: string;
  readonly runtimeLabel: string | null;
  readonly detailSections: ReadonlyArray<AgentControlDetailSection>;
} {
  const plan = proposal.plan;
  switch (plan.kind) {
    case "createThreads": {
      const count = plan.entries.length;
      const projectIds = [...new Set(plan.entries.map((entry) => String(entry.projectId)))];
      const runtimes = [
        ...new Set(plan.entries.map((entry) => `${entry.runtimeMode} · ${entry.envMode}`)),
      ];
      return {
        actionLabel: count === 1 ? "Create 1 thread" : `Create ${count} threads`,
        targetLabel:
          projectIds.length === 1
            ? `project ${shortId(projectIds[0]!)}`
            : `${projectIds.length} projects`,
        runtimeLabel: runtimes.length === 1 ? runtimes[0]! : "mixed runtime modes",
        detailSections: plan.entries.map((entry, index) => ({
          heading: `Thread ${index + 1}: ${entry.title}`,
          lines: [
            `Project: ${entry.projectId}`,
            `Model: ${entry.modelSelection.instanceId} · ${entry.modelSelection.model}`,
            `Runtime: ${entry.runtimeMode} · ${entry.envMode}`,
            ...(entry.baseRef !== undefined ? [`Base ref: ${entry.baseRef}`] : []),
            `Prompt: ${entry.prompt}`,
          ],
        })),
      };
    }
    case "sendMessage":
      return {
        actionLabel: plan.delivery === "steer" ? "Steer thread" : "Queue message",
        targetLabel: `thread ${shortId(plan.threadId)}`,
        runtimeLabel: null,
        detailSections: [{ heading: "Message", lines: [plan.text] }],
      };
    case "interruptThread":
      return {
        actionLabel: "Interrupt thread",
        targetLabel: `thread ${shortId(plan.threadId)}`,
        runtimeLabel: null,
        detailSections: [
          {
            heading: "Interrupt",
            lines: [
              `Thread: ${plan.threadId}`,
              ...(plan.turnId !== undefined ? [`Only turn: ${plan.turnId}`] : []),
            ],
          },
        ],
      };
    case "updateThread": {
      const changes: string[] = [];
      if (plan.title !== undefined) changes.push(`Title: ${plan.title}`);
      if (plan.archived !== undefined) {
        changes.push(plan.archived ? "Archive thread" : "Unarchive thread");
      }
      if (plan.persistentGoal !== undefined) {
        changes.push(
          plan.persistentGoal === null ? "Clear persistent goal" : `Goal: ${plan.persistentGoal}`,
        );
      }
      return {
        actionLabel: "Update thread",
        targetLabel: `thread ${shortId(plan.threadId)}`,
        runtimeLabel: null,
        detailSections: [{ heading: "Changes", lines: changes }],
      };
    }
  }
}

function outcomeLabel(proposal: AgentControlProposal): string | null {
  const result = proposal.result;
  if (result === null) return null;
  if (result.outcome === "completed") {
    const created = result.createdThreadIds?.length ?? 0;
    const detail = result.detail !== undefined ? ` · ${result.detail}` : "";
    return created > 0
      ? `Completed · created ${created} thread${created === 1 ? "" : "s"}${detail}`
      : `Completed${detail}`;
  }
  return `${result.error.code}: ${result.error.message}`;
}

export function buildAgentControlProposalCardModel(
  proposal: AgentControlProposal,
): AgentControlProposalCardModel {
  const status = STATUS_PRESENTATION[proposal.status];
  const origin = originPresentation(proposal);
  const plan = planPresentation(proposal);
  return {
    proposalId: proposal.proposalId,
    status: proposal.status,
    statusLabel: status.label,
    statusTone: status.tone,
    originLabel: origin.label,
    originThreadId: origin.threadId,
    actionLabel: plan.actionLabel,
    targetLabel: plan.targetLabel,
    runtimeLabel: plan.runtimeLabel,
    riskLabels: proposal.riskTags.map((tag) => riskLabelFromTag(String(tag))),
    summary: proposal.promptSummary,
    expiresAt: proposal.expiresAt,
    isPending: proposal.status === "pending-user-approval",
    outcomeLabel: outcomeLabel(proposal),
    detailSections: plan.detailSections,
  };
}
