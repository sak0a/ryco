import { describe, expect, it } from "vitest";

import {
  buildWorktreeCheckoutDirectoryName,
  resolveAppManagedWorktreeCheckoutPath,
  resolveProjectWorktreeCheckoutPath,
  resolveWorktreeCheckoutPath,
} from "./worktreeCheckoutPaths.ts";
import { ProjectId } from "@ryco/contracts";

describe("worktree checkout paths", () => {
  it("builds checkout directory names from branch and a short word", () => {
    expect(buildWorktreeCheckoutDirectoryName("feature/My PR Branch", "pearl")).toBe(
      "feature-my-pr-branch__pearl",
    );
  });

  it("limits the random word segment to five letters", () => {
    expect(buildWorktreeCheckoutDirectoryName("task/demo", "silver")).toBe("task-demo__silve");
  });

  it("resolves worktrees under the project metadata worktrees directory", () => {
    expect(resolveProjectWorktreeCheckoutPath("/repo", ".ryco", "bug/fix")).toMatch(
      /^\/repo\/\.ryco\/worktrees\/bug-fix__[a-z]{5}$/,
    );
  });

  it("resolves app-managed worktrees under the app worktrees directory", () => {
    expect(
      resolveAppManagedWorktreeCheckoutPath(
        "/app/.ryco/worktrees",
        ProjectId.make("project-123"),
        "bug/fix",
      ),
    ).toMatch(/^\/app\/\.ryco\/worktrees\/project-123\/bug-fix__[a-z]{5}$/);
  });

  it("defaults to app-managed worktree paths", () => {
    expect(
      resolveWorktreeCheckoutPath({
        location: undefined,
        appWorktreesRoot: "/app/.ryco/worktrees",
        projectId: ProjectId.make("project-123"),
        workspaceRoot: "/repo",
        projectMetadataDir: ".ryco",
        branchName: "bug/fix",
      }),
    ).toMatch(/^\/app\/\.ryco\/worktrees\/project-123\/bug-fix__[a-z]{5}$/);
  });

  it("keeps project metadata worktree paths as a deprecated compatibility mode", () => {
    expect(
      resolveWorktreeCheckoutPath({
        location: "projectMetadata",
        appWorktreesRoot: "/app/.ryco/worktrees",
        projectId: ProjectId.make("project-123"),
        workspaceRoot: "/repo",
        projectMetadataDir: ".ryco",
        branchName: "bug/fix",
      }),
    ).toMatch(/^\/repo\/\.ryco\/worktrees\/bug-fix__[a-z]{5}$/);
  });
});
