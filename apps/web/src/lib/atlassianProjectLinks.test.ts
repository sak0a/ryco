import type { AtlassianConnectionId, AtlassianProjectLink, ProjectId } from "@ryco/contracts";
import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { buildJiraProjectLinkInput, buildJiraProjectUnlinkInput } from "./atlassianProjectLinks";

const projectId = "project-1" as ProjectId;
const jiraConnectionId = "atl-jira" as AtlassianConnectionId;
const bitbucketConnectionId = "atl-bitbucket" as AtlassianConnectionId;

const existing = {
  projectId,
  jiraConnectionId,
  bitbucketConnectionId,
  jiraCloudId: "cloud-1",
  jiraSiteUrl: "https://ryco.atlassian.net",
  jiraProjectKeys: ["KAN"],
  bitbucketWorkspace: "ryco",
  bitbucketRepoSlug: "app",
  defaultIssueTypeName: "Story",
  branchNameTemplate: "{issueKey}-{titleSlug}",
  commitMessageTemplate: "{issueKey}: {summary}",
  pullRequestTitleTemplate: "{issueKey}: {summary}",
  smartLinkingEnabled: true,
  autoAttachWorkItems: true,
  createdAt: DateTime.fromDateUnsafe(new Date("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.fromDateUnsafe(new Date("2026-01-02T00:00:00.000Z")),
} satisfies AtlassianProjectLink;

describe("atlassianProjectLinks", () => {
  it("builds a Jira link while preserving Bitbucket project settings", () => {
    const input = buildJiraProjectLinkInput({
      projectId,
      existing,
      jiraConnectionId,
      jiraSiteUrl: null,
      jiraProjectKeys: ["APP"],
    });

    expect(input.jiraConnectionId).toBe(jiraConnectionId);
    expect(input.jiraProjectKeys).toEqual(["APP"]);
    expect(input.bitbucketConnectionId).toBe(bitbucketConnectionId);
    expect(input.bitbucketWorkspace).toBe("ryco");
    expect(input.bitbucketRepoSlug).toBe("app");
    expect(input.branchNameTemplate).toBe("{issueKey}-{titleSlug}");
  });

  it("unlinks only Jira fields from an existing project link", () => {
    const input = buildJiraProjectUnlinkInput({ projectId, existing });

    expect(input.jiraConnectionId).toBeNull();
    expect(input.jiraCloudId).toBeNull();
    expect(input.jiraSiteUrl).toBeNull();
    expect(input.jiraProjectKeys).toEqual([]);
    expect(input.bitbucketConnectionId).toBe(bitbucketConnectionId);
    expect(input.bitbucketWorkspace).toBe("ryco");
    expect(input.bitbucketRepoSlug).toBe("app");
  });
});
