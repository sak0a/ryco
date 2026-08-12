import { resolveThreadWorkspaceRoot } from "@ryco/client-runtime/state/files";
import type { Project, SidebarWorktreeSummary, Thread } from "@ryco/client-runtime/state/threads";
import { useMemo } from "react";

/**
 * The `cwd` both file screens hand to the node.
 *
 * Memoized because it is a cache-key input: the query hooks re-subscribe on a
 * changed key, and recomputing an identical string per render would be fine
 * while an identical-but-new object would not — keeping the resolution in one
 * place is what stops that distinction from being rediscovered per screen.
 */
export function useThreadWorkspaceRoot(input: {
  readonly thread: Pick<Thread, "worktreePath"> | null | undefined;
  readonly worktree: Pick<SidebarWorktreeSummary, "worktreePath"> | null;
  readonly project: Pick<Project, "cwd"> | null;
}): string | null {
  const { thread, worktree, project } = input;
  return useMemo(
    () => resolveThreadWorkspaceRoot({ thread: thread ?? null, worktree, project }),
    [project, thread, worktree],
  );
}
