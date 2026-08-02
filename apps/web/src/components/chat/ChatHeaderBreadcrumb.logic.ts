export type WorktreeOriginLike = "main" | "branch" | "pr" | "issue" | "manual" | null | undefined;

const MAIN_BRANCH_NAMES: ReadonlySet<string> = new Set(["main", "master"]);

export function shouldShowWorktreeBreadcrumbSegment(input: {
  origin: WorktreeOriginLike;
  branch: string | null | undefined;
}): boolean {
  if (input.origin === "main") return false;
  if (input.origin && input.origin !== null) return true;
  const branch = input.branch?.trim() ?? "";
  if (branch.length === 0) return false;
  if (MAIN_BRANCH_NAMES.has(branch)) return false;
  return true;
}
