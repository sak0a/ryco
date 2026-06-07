import { AtlassianConnectionId, ProjectId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectAtlassianLinkRepository } from "../Services/ProjectAtlassianLinks.ts";
import { ProjectAtlassianLinkRepositoryLive } from "./ProjectAtlassianLinks.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectAtlassianLinkRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectAtlassianLinkRepository", (it) => {
  it.effect("save + get round-trips a project link", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectAtlassianLinkRepository;
      const projectId = ProjectId.make("project-atlassian");

      yield* repo.upsert({
        projectId,
        jiraConnectionId: AtlassianConnectionId.make("atl-jira"),
        bitbucketConnectionId: AtlassianConnectionId.make("atl-bitbucket"),
        jiraCloudId: "cloud-1",
        jiraSiteUrl: "https://acme.atlassian.net",
        jiraProjectKeys: ["RYCO", "OPS"],
        bitbucketWorkspace: "acme",
        bitbucketRepoSlug: "ryco",
        defaultIssueTypeName: "Task",
        branchNameTemplate: "{key}-{summary}",
        commitMessageTemplate: "{key}: {summary}",
        pullRequestTitleTemplate: "{key}: {summary}",
        smartLinkingEnabled: true,
        autoAttachWorkItems: true,
        createdAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:00.000Z",
      });

      const row = yield* repo.getByProjectId({ projectId });
      assert.isTrue(Option.isSome(row));
      assert.deepStrictEqual(Option.getOrThrow(row).jiraProjectKeys, ["RYCO", "OPS"]);
      assert.equal(Option.getOrThrow(row).bitbucketRepoSlug, "ryco");
    }),
  );

  it.effect("deleteByProjectId removes a saved link", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectAtlassianLinkRepository;
      const projectId = ProjectId.make("project-atlassian-delete");

      yield* repo.upsert({
        projectId,
        jiraConnectionId: null,
        bitbucketConnectionId: null,
        jiraCloudId: null,
        jiraSiteUrl: null,
        jiraProjectKeys: [],
        bitbucketWorkspace: null,
        bitbucketRepoSlug: null,
        defaultIssueTypeName: null,
        branchNameTemplate: "{key}-{summary}",
        commitMessageTemplate: "{key}: {summary}",
        pullRequestTitleTemplate: "{key}: {summary}",
        smartLinkingEnabled: true,
        autoAttachWorkItems: false,
        createdAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:00.000Z",
      });

      yield* repo.deleteByProjectId({ projectId });
      const row = yield* repo.getByProjectId({ projectId });
      assert.isTrue(Option.isNone(row));
    }),
  );
});
