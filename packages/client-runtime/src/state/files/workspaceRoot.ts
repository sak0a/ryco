import type { Project, SidebarWorktreeSummary, Thread } from "../threads/types.ts";

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

/**
 * Directory the file browser lists. The worktree wins when the thread runs in
 * one, but its path is nullable (the node manages some worktrees without
 * exposing a path), and threads started outside a worktree only have the
 * project's checkout — so the chain falls through to `project.cwd`.
 */
export function resolveThreadWorkspaceRoot(input: {
  readonly thread: Pick<Thread, "worktreePath"> | null;
  readonly worktree: Pick<SidebarWorktreeSummary, "worktreePath"> | null;
  readonly project: Pick<Project, "cwd"> | null;
}): string | null {
  return input.worktree?.worktreePath ?? input.thread?.worktreePath ?? input.project?.cwd ?? null;
}
