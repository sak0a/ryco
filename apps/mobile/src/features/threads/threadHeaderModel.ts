import type { Project, SidebarWorktreeSummary, Thread } from "@ryco/client-runtime/state/threads";

import { buildChangeRequestBadge, type ChangeRequestBadge } from "../../lib/changeRequestBadge";

export type ThreadMoreAction = "rename" | "archive" | "unarchive" | "stop" | "details";

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
  };
}
