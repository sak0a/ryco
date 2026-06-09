import type {
  AtlassianConnectionId,
  AtlassianProjectLink,
  AtlassianSaveProjectLinkInput,
  ProjectId,
} from "@ryco/contracts";

const DEFAULT_BRANCH_TEMPLATE = "{issueKey}-{titleSlug}";
const DEFAULT_COMMIT_TEMPLATE = "{issueKey}: {summary}";

export function buildJiraProjectLinkInput(input: {
  readonly projectId: ProjectId;
  readonly existing: AtlassianProjectLink | null | undefined;
  readonly jiraConnectionId: AtlassianConnectionId | null;
  readonly jiraSiteUrl: string | null;
  readonly jiraProjectKeys: ReadonlyArray<string>;
}): AtlassianSaveProjectLinkInput {
  return {
    projectId: input.projectId,
    jiraConnectionId: input.jiraConnectionId,
    bitbucketConnectionId: input.existing?.bitbucketConnectionId ?? null,
    jiraCloudId: input.existing?.jiraCloudId ?? null,
    jiraSiteUrl: input.jiraSiteUrl,
    jiraProjectKeys: [...input.jiraProjectKeys],
    bitbucketWorkspace: input.existing?.bitbucketWorkspace ?? null,
    bitbucketRepoSlug: input.existing?.bitbucketRepoSlug ?? null,
    defaultIssueTypeName: input.existing?.defaultIssueTypeName ?? null,
    branchNameTemplate: input.existing?.branchNameTemplate ?? DEFAULT_BRANCH_TEMPLATE,
    commitMessageTemplate: input.existing?.commitMessageTemplate ?? DEFAULT_COMMIT_TEMPLATE,
    pullRequestTitleTemplate: input.existing?.pullRequestTitleTemplate ?? DEFAULT_COMMIT_TEMPLATE,
    smartLinkingEnabled: input.existing?.smartLinkingEnabled ?? true,
    autoAttachWorkItems: input.existing?.autoAttachWorkItems ?? true,
  };
}

export function buildJiraProjectUnlinkInput(input: {
  readonly projectId: ProjectId;
  readonly existing: AtlassianProjectLink | null | undefined;
}): AtlassianSaveProjectLinkInput {
  return {
    ...buildJiraProjectLinkInput({
      projectId: input.projectId,
      existing: input.existing,
      jiraConnectionId: null,
      jiraSiteUrl: null,
      jiraProjectKeys: [],
    }),
    jiraCloudId: null,
  };
}
