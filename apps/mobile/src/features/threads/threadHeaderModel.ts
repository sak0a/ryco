import { resolveThreadWorkspaceRoot } from "@ryco/client-runtime/state/files";
import type { Project, SidebarWorktreeSummary, Thread } from "@ryco/client-runtime/state/threads";

import { buildChangeRequestBadge, type ChangeRequestBadge } from "../../lib/changeRequestBadge";

/**
 * Worktree matching lives in client-runtime so the file browser can resolve a
 * workspace root without depending on the thread header. Re-exported here to
 * keep the existing import sites intact.
 */
export { findThreadWorktree } from "@ryco/client-runtime/state/files";

export type ThreadMoreAction = "rename" | "archive" | "unarchive" | "stop" | "details";

export interface ThreadHeaderModel {
  readonly title: string;
  readonly nodeLabel: string;
  readonly projectLabel: string;
  readonly worktreeLabel: string;
  readonly statusLabel:
    | "Ready"
    | "Running"
    | "Needs approval"
    | "Input needed"
    | "Archived"
    | "Offline";
  readonly contextAccessibilityLabel: string;
  readonly reviewVisible: boolean;
  /**
   * Whether the file browser has a directory to list. A thread whose worktree,
   * own path and project checkout are all unknown has nothing to browse, so the
   * action is withheld rather than opening onto an empty screen.
   */
  readonly filesVisible: boolean;
  readonly moreActions: ReadonlyArray<ThreadMoreAction>;
  /** Last known pull request / work item for the thread's worktree, if any. */
  readonly changeRequest: ChangeRequestBadge | null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
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
  readonly project: Pick<Project, "name" | "cwd"> | null;
  readonly worktree: Pick<
    SidebarWorktreeSummary,
    | "title"
    | "branch"
    | "worktreePath"
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
  /**
   * The thread's content is cache provenance, so none of the status this model
   * would otherwise derive is live. Same precedence the inbox uses for a stale
   * environment's rows (`inboxModel.ts` `threadState`): staleness outranks
   * every cached field, because a snapshot captured mid-turn keeps claiming
   * "Running" long after the node stopped answering.
   */
  readonly forcedOffline?: boolean;
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
  const statusLabel = input.forcedOffline
    ? "Offline"
    : input.thread.archivedAt !== null
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
    filesVisible:
      resolveThreadWorkspaceRoot({
        thread: input.thread,
        worktree: input.worktree,
        project: input.project,
      }) !== null,
    moreActions,
    changeRequest: buildChangeRequestBadge(input.worktree),
  };
}
