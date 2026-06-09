import type { AtlassianConnectionSummary, AtlassianProjectLink, VcsRef } from "@ryco/contracts";
import { AtlassianConnectionId, ProjectId, WorktreeId } from "@ryco/contracts";
import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarWorktreeSummary } from "../types";
import {
  buildWorkItemBranchChoices,
  findLinkedWorkItemBranches,
  findLinkedWorkItemWorktrees,
  resolveJiraProjectOpenUrl,
  workItemKeyMatchesText,
} from "./workItemLocalLinks";

const timestamp = DateTime.fromDateUnsafe(new Date("2026-06-09T00:00:00.000Z"));

function ref(name: string, overrides: Partial<VcsRef> = {}): VcsRef {
  return {
    name,
    current: false,
    isDefault: false,
    isRemote: false,
    worktreePath: null,
    ...overrides,
  };
}

function worktree(overrides: Partial<SidebarWorktreeSummary>): SidebarWorktreeSummary {
  return {
    id: WorktreeId.make("worktree-test"),
    environmentId: "environment-test" as never,
    projectId: ProjectId.make("project-test"),
    branch: "main",
    worktreePath: null,
    origin: "branch",
    prNumber: null,
    issueNumber: null,
    prTitle: null,
    issueTitle: null,
    prState: null,
    prIsDraft: null,
    issueState: null,
    workItemProvider: null,
    workItemKey: null,
    workItemTitle: null,
    workItemState: null,
    workItemUrl: null,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    archivedAt: null,
    manualPosition: 0,
    ...overrides,
  };
}

describe("work item local links", () => {
  it("matches exact Jira key tokens in branch names", () => {
    expect(workItemKeyMatchesText("KAN-4", "feature/KAN-4-super-toll")).toBe(true);
    expect(workItemKeyMatchesText("KAN-4", "feature/kan-4-super-toll")).toBe(true);
    expect(workItemKeyMatchesText("KAN-4", "feature/KAN-42-super-toll")).toBe(false);
    expect(workItemKeyMatchesText("KAN-4", "feature/AKAN-4-super-toll")).toBe(false);
  });

  it("finds every matching local and remote branch for a Jira key", () => {
    const branches = findLinkedWorkItemBranches({
      key: "KAN-4",
      refs: [
        ref("feature/KAN-4-super-toll"),
        ref("origin/bugfix/kan-4-retry", { isRemote: true, remoteName: "origin" }),
        ref("feature/KAN-42-other"),
      ],
    });

    expect(branches.map((branch) => branch.name)).toEqual([
      "feature/KAN-4-super-toll",
      "origin/bugfix/kan-4-retry",
    ]);
  });

  it("finds linked worktrees by metadata and branch name", () => {
    const worktrees = findLinkedWorkItemWorktrees({
      key: "KAN-4",
      worktrees: [
        worktree({
          id: WorktreeId.make("worktree-meta"),
          branch: "task/no-key",
          workItemProvider: "jira",
          workItemKey: "KAN-4",
        }),
        worktree({
          id: WorktreeId.make("worktree-branch"),
          branch: "feature/KAN-4-branch-only",
        }),
        worktree({
          id: WorktreeId.make("worktree-other"),
          branch: "feature/KAN-42-other",
        }),
      ],
    });

    expect(worktrees.map((item) => item.id)).toEqual(["worktree-branch", "worktree-meta"]);
  });

  it("builds selectable choices for multiple matching branches", () => {
    const choices = buildWorkItemBranchChoices({
      branches: [
        ref("feature/KAN-4-super-toll"),
        ref("feature/KAN-4-follow-up", { worktreePath: "/tmp/follow-up" }),
      ],
      worktrees: [
        {
          id: WorktreeId.make("worktree-follow-up"),
          branch: "feature/KAN-4-follow-up",
          title: null,
          worktreePath: "/tmp/follow-up",
          archivedAt: null,
        },
      ],
    });

    expect(choices.map((choice) => choice.branchName)).toEqual([
      "feature/KAN-4-super-toll",
      "feature/KAN-4-follow-up",
    ]);
    expect(choices[1]?.hasWorktree).toBe(true);
  });

  it("resolves Jira project URLs only when a project link is configured", () => {
    const connectionId = AtlassianConnectionId.make("atl-jira");
    const link = {
      projectId: ProjectId.make("project-test"),
      jiraConnectionId: connectionId,
      bitbucketConnectionId: null,
      jiraCloudId: null,
      jiraSiteUrl: null,
      jiraProjectKeys: ["KAN"],
      bitbucketWorkspace: null,
      bitbucketRepoSlug: null,
      defaultIssueTypeName: null,
      branchNameTemplate: "{issueKey}-{titleSlug}",
      commitMessageTemplate: "{issueKey}: {summary}",
      pullRequestTitleTemplate: "{issueKey}: {summary}",
      smartLinkingEnabled: true,
      autoAttachWorkItems: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies AtlassianProjectLink;
    const connection = {
      connectionId,
      baseUrl: "https://ryco-app.atlassian.net/",
    } satisfies Pick<AtlassianConnectionSummary, "baseUrl" | "connectionId">;

    expect(resolveJiraProjectOpenUrl({ link, connections: [connection] })).toBe(
      "https://ryco-app.atlassian.net/jira/software/projects/KAN",
    );
    expect(resolveJiraProjectOpenUrl({ link: { ...link, jiraProjectKeys: [] } })).toBeNull();
  });
});
