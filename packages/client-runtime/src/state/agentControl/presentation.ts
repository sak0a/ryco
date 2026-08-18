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
  readonly isDestructive: boolean;
  readonly summary: string | null;
  readonly expiresAt: string;
  readonly isPending: boolean;
  readonly outcomeLabel: string | null;
  readonly executionLabel: string | null;
  readonly affectedThreadIds: ReadonlyArray<ThreadId>;
  readonly affectedProjectIds: ReadonlyArray<string>;
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
        detailSections: [{ heading: "Message", lines: [`Thread: ${plan.threadId}`, plan.text] }],
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
        detailSections: [{ heading: "Changes", lines: [`Thread: ${plan.threadId}`, ...changes] }],
      };
    }
    case "createProject":
      return {
        actionLabel: "Create project",
        targetLabel: `project ${shortId(plan.projectId)}`,
        runtimeLabel: null,
        detailSections: [
          { heading: "Before", lines: ["No Ryco project record with this ID."] },
          {
            heading: "After",
            lines: [
              `Project ID: ${plan.projectId}`,
              `Display name: ${plan.title}`,
              `Workspace path: ${plan.workspaceRoot}`,
              `Metadata directory: ${plan.projectMetadataDir}`,
              `Repository identity: ${plan.repositoryIdentityKey ?? "none"}`,
              "Workspace must already exist; no directory is created by this action.",
            ],
          },
        ],
      };
    case "updateProject":
      return {
        actionLabel: "Update project metadata",
        targetLabel: `project ${shortId(plan.projectId)}`,
        runtimeLabel: null,
        detailSections: [
          {
            heading: "Before",
            lines: [
              `Display name: ${plan.before.title}`,
              `Workspace path: ${plan.before.workspaceRoot}`,
              `Repository identity: ${plan.before.repositoryIdentityKey ?? "none"}`,
              `Expected revision: ${plan.before.updatedAt}`,
            ],
          },
          {
            heading: "After",
            lines: [
              `Display name: ${plan.after.title}`,
              `Workspace path: ${plan.after.workspaceRoot}`,
              `Repository identity: ${plan.after.repositoryIdentityKey ?? "none"}`,
            ],
          },
        ],
      };
    case "removeProject":
      return {
        actionLabel: "Unlink project",
        targetLabel: `project ${shortId(plan.projectId)}`,
        runtimeLabel: null,
        detailSections: [
          {
            heading: "Before · destructive Ryco record removal",
            lines: [
              `Project ID: ${plan.projectId}`,
              `Display name: ${plan.expected.title}`,
              `Workspace path: ${plan.expected.workspaceRoot}`,
              `Expected revision: ${plan.expected.updatedAt}`,
              `Force removal: ${plan.force ? "yes" : "no"}`,
              ...(plan.expectedThreadIds.length === 0
                ? ["Ryco thread records removed: none"]
                : plan.expectedThreadIds.map(
                    (threadId) => `Ryco thread record removed: ${threadId}`,
                  )),
              "Workspace files and repository contents will be retained.",
            ],
          },
          {
            heading: "After",
            lines: [
              "The Ryco project record and the exact listed Ryco thread records are unlinked.",
              "The workspace directory and repository are unchanged.",
            ],
          },
        ],
      };
    case "changeSettings":
      return {
        actionLabel: "Change setting",
        targetLabel: plan.change.kind,
        runtimeLabel: null,
        detailSections: [
          {
            heading: "Exact setting change",
            lines: [
              `Setting: ${plan.change.kind}`,
              `Before: ${String(plan.change.before)}`,
              `After: ${String(plan.change.after)}`,
              "Fresh owner reauthentication is required at approval and execution.",
            ],
          },
        ],
      };
  }
}

function outcomeLabel(proposal: AgentControlProposal): string | null {
  const result = proposal.result;
  if (result === null) return null;
  if (result.outcome === "completed") {
    const created = result.createdThreadIds?.length ?? 0;
    const createdProjects = result.createdProjectIds?.length ?? 0;
    const detail = result.detail !== undefined ? ` · ${result.detail}` : "";
    return createdProjects > 0
      ? `Completed · created ${createdProjects} project${createdProjects === 1 ? "" : "s"}${detail}`
      : created > 0
        ? `Completed · created ${created} thread${created === 1 ? "" : "s"}${detail}`
        : `Completed${detail}`;
  }
  return `${result.error.code}: ${result.error.message}`;
}

function executionPresentation(proposal: AgentControlProposal): {
  readonly label: string | null;
  readonly affectedThreadIds: ReadonlyArray<ThreadId>;
  readonly affectedProjectIds: ReadonlyArray<string>;
} {
  const execution = proposal.result?.execution;
  if (execution === undefined) {
    return { label: null, affectedThreadIds: [], affectedProjectIds: [] };
  }
  const parts = [
    `Operation ${shortId(execution.operationId)}`,
    `${execution.commands.length} command${execution.commands.length === 1 ? "" : "s"}`,
  ];
  if (execution.worktreeIds.length > 0) {
    parts.push(
      `${execution.worktreeIds.length} worktree${execution.worktreeIds.length === 1 ? "" : "s"}`,
    );
  }
  if (execution.delivery !== undefined) parts.push(`delivery: ${execution.delivery}`);
  if (execution.interrupt !== undefined) {
    parts.push(`interrupt settled: ${execution.interrupt.settledStatus}`);
  }
  if (execution.compensation !== undefined) {
    parts.push(execution.compensation.completed ? "cleanup completed" : "cleanup needs attention");
  }
  return {
    label: parts.join(" · "),
    affectedThreadIds: execution.affectedThreadIds,
    affectedProjectIds: execution.affectedProjectIds ?? [],
  };
}

export function buildAgentControlProposalCardModel(
  proposal: AgentControlProposal,
): AgentControlProposalCardModel {
  const status = STATUS_PRESENTATION[proposal.status];
  const origin = originPresentation(proposal);
  const plan = planPresentation(proposal);
  const execution = executionPresentation(proposal);
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
    isDestructive: proposal.plan.kind === "removeProject",
    summary: proposal.promptSummary,
    expiresAt: proposal.expiresAt,
    isPending: proposal.status === "pending-user-approval",
    outcomeLabel: outcomeLabel(proposal),
    executionLabel: execution.label,
    affectedThreadIds: execution.affectedThreadIds,
    affectedProjectIds: execution.affectedProjectIds,
    detailSections: plan.detailSections,
  };
}
