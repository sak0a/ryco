import type {
  Project,
  SidebarWorktreeSummary,
  Thread,
  ThreadInboxMutationBlocker,
} from "@ryco/client-runtime/state/threads";
import type { ThreadSettlementBlocker } from "@ryco/shared/threadSettlement";

import { buildChangeRequestBadge, type ChangeRequestBadge } from "../../lib/changeRequestBadge";

export type ThreadMoreAction = "rename" | "archive" | "unarchive" | "stop" | "details";

export interface ThreadSettlementActionModel {
  readonly kind: "settle" | "unsettle";
  readonly label: "Settle task" | "Move to Active";
  readonly detail: string;
  readonly disabled: boolean;
}

export interface ThreadHeaderModel {
  readonly title: string;
  readonly nodeLabel: string;
  readonly projectLabel: string;
  readonly worktreeLabel: string;
  readonly statusLabel: "Ready" | "Running" | "Needs approval" | "Input needed" | "Archived";
  readonly contextAccessibilityLabel: string;
  readonly reviewVisible: boolean;
  readonly moreActions: ReadonlyArray<ThreadMoreAction>;
  /** Last known pull request / work item for the thread's worktree, if any. */
  readonly changeRequest: ChangeRequestBadge | null;
  readonly settlementAction: ThreadSettlementActionModel | null;
}

function settlementDisabledReason(input: {
  readonly mutationEnabled: boolean;
  readonly mutationBlocker: ThreadInboxMutationBlocker | null;
  readonly canSettle: boolean;
  readonly settlementBlocker: ThreadSettlementBlocker | null;
}): string | null {
  if (!input.mutationEnabled) {
    switch (input.mutationBlocker) {
      case "unsupported":
        return "Update this node before changing attention state.";
      case "disconnected":
        return "Reconnect this node to change attention state.";
      case "read-only":
        return "This node is read-only.";
      case "shell-stale":
        return "Waiting for the latest task list from this node.";
      case "client-draft":
        return "Send the first message before settling this task.";
      case null:
        return "This task cannot be changed right now.";
    }
  }
  if (input.canSettle) return null;
  switch (input.settlementBlocker) {
    case "pending-approval":
      return "Resolve the pending approval first.";
    case "pending-user-input":
      return "Answer the pending question first.";
    case "session-starting":
    case "session-running":
      return "Wait for the agent to finish.";
    case "queued-turn":
    case "local-queue":
      return "Send or remove queued work first.";
    case "delivery-unknown":
      return "Reconnect to confirm delivery first.";
    case "unsupported":
      return "Update this node before settling tasks.";
    case "thread-archived":
    case "thread-deleted":
    case "worktree-archived":
      return "Archived work is managed separately.";
    case null:
      return "This task cannot be settled right now.";
  }
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function findThreadWorktree(
  thread: Pick<Thread, "environmentId" | "projectId" | "worktreeId" | "worktreePath" | "branch">,
  worktrees: ReadonlyArray<SidebarWorktreeSummary>,
): SidebarWorktreeSummary | null {
  const candidates = worktrees.filter(
    (worktree) =>
      worktree.environmentId === thread.environmentId && worktree.projectId === thread.projectId,
  );
  if (thread.worktreeId) {
    const byId = candidates.find((worktree) => worktree.id === thread.worktreeId);
    if (byId) return byId;
  }
  if (thread.worktreePath) {
    const byPath = candidates.find((worktree) => worktree.worktreePath === thread.worktreePath);
    if (byPath) return byPath;
  }
  if (thread.branch) {
    return candidates.find((worktree) => worktree.branch === thread.branch) ?? null;
  }
  return null;
}

export function buildThreadHeaderModel(input: {
  readonly thread: Pick<
    Thread,
    | "title"
    | "archivedAt"
    | "latestTurn"
    | "session"
    | "turnDiffSummaries"
    | "branch"
    | "worktreePath"
  >;
  readonly project: Pick<Project, "name"> | null;
  readonly worktree: Pick<
    SidebarWorktreeSummary,
    | "title"
    | "branch"
    | "prNumber"
    | "prState"
    | "prIsDraft"
    | "issueNumber"
    | "issueState"
    | "workItemKey"
    | "workItemState"
    | "workItemStateName"
  > | null;
  readonly nodeLabel: string | null;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly settlement?:
    | {
        readonly attentionState: "active" | "settled";
        readonly canSettle: boolean;
        readonly settlementBlocker: ThreadSettlementBlocker | null;
        readonly mutationEnabled: boolean;
        readonly mutationBlocker: ThreadInboxMutationBlocker | null;
      }
    | undefined;
}): ThreadHeaderModel {
  const running =
    input.thread.latestTurn?.state === "running" || input.thread.session?.status === "running";
  const nodeLabel = input.nodeLabel?.trim() || "Node";
  const projectLabel = input.project?.name.trim() || "Project";
  const worktreeLabel =
    input.worktree?.title?.trim() ||
    input.worktree?.branch.trim() ||
    input.thread.branch?.trim() ||
    (input.thread.worktreePath ? basename(input.thread.worktreePath) : "Local workspace");
  const statusLabel =
    input.thread.archivedAt !== null
      ? "Archived"
      : input.hasPendingApproval
        ? "Needs approval"
        : input.hasPendingUserInput
          ? "Input needed"
          : running
            ? "Running"
            : "Ready";
  const moreActions: ThreadMoreAction[] = ["rename"];
  if (running) moreActions.push("stop");
  moreActions.push(input.thread.archivedAt === null ? "archive" : "unarchive", "details");
  const settlementDisabled = input.settlement ? settlementDisabledReason(input.settlement) : null;
  const settlementAction =
    input.thread.archivedAt !== null || !input.settlement
      ? null
      : input.settlement.attentionState === "settled"
        ? {
            kind: "unsettle" as const,
            label: "Move to Active" as const,
            detail: settlementDisabled ?? "Return this task to your active attention queue.",
            disabled: settlementDisabled !== null,
          }
        : {
            kind: "settle" as const,
            label: "Settle task" as const,
            detail: settlementDisabled ?? "Mark this task handled without archiving it.",
            disabled: settlementDisabled !== null,
          };

  return {
    title: input.thread.title.trim() || "Untitled task",
    nodeLabel,
    projectLabel,
    worktreeLabel,
    statusLabel,
    contextAccessibilityLabel: `Working in node ${nodeLabel}, project ${projectLabel}, worktree ${worktreeLabel}. ${statusLabel}.`,
    reviewVisible: input.thread.turnDiffSummaries.some((summary) => summary.files.length > 0),
    moreActions,
    changeRequest: buildChangeRequestBadge(input.worktree),
    settlementAction,
  };
}
