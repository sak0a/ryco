import { describe, expect, it } from "vite-plus/test";
import { shouldShowWorktreeBreadcrumbSegment } from "./ChatHeaderBreadcrumb.logic";

describe("shouldShowWorktreeBreadcrumbSegment", () => {
  it("hides for the main worktree origin", () => {
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: "main", branch: "main" })).toBe(false);
  });

  it("hides when origin is missing but branch is main/master", () => {
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: null, branch: "main" })).toBe(false);
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: null, branch: "master" })).toBe(false);
  });

  it("shows for branch/pr/issue/manual origins", () => {
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: "branch", branch: "feature/x" })).toBe(
      true,
    );
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: "pr", branch: "pr-12-branch" })).toBe(
      true,
    );
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: "issue", branch: "issue-7" })).toBe(true);
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: "manual", branch: "scratch" })).toBe(true);
  });

  it("shows when branch is non-main even if origin is missing", () => {
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: null, branch: "feature/foo" })).toBe(true);
  });

  it("hides when nothing identifies the worktree", () => {
    expect(shouldShowWorktreeBreadcrumbSegment({ origin: null, branch: null })).toBe(false);
  });
});
