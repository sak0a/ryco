import { ProjectId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { AtlassianConnectionRepositoryLive } from "../persistence/Layers/AtlassianConnections.ts";
import { AtlassianResourceRepositoryLive } from "../persistence/Layers/AtlassianResources.ts";
import { ProjectAtlassianLinkRepositoryLive } from "../persistence/Layers/ProjectAtlassianLinks.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  AtlassianConnectionService,
  layer as AtlassianConnectionServiceLive,
  manualBitbucketTokenSecretName,
  manualJiraTokenSecretName,
} from "./AtlassianConnectionService.ts";

const secrets = new Map<string, Uint8Array>();

const layer = it.layer(
  AtlassianConnectionServiceLive.pipe(
    Layer.provideMerge(AtlassianConnectionRepositoryLive),
    Layer.provideMerge(AtlassianResourceRepositoryLive),
    Layer.provideMerge(ProjectAtlassianLinkRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(
      Layer.mock(ServerSecretStore)({
        get: (name) => Effect.succeed(secrets.get(name) ?? null),
        set: (name, value) =>
          Effect.sync(() => {
            secrets.set(name, value);
          }),
        getOrCreateRandom: (name, bytes) =>
          Effect.sync(() => {
            const existing = secrets.get(name);
            if (existing) return existing;
            const value = crypto.getRandomValues(new Uint8Array(bytes));
            secrets.set(name, value);
            return value;
          }),
        remove: (name) =>
          Effect.sync(() => {
            secrets.delete(name);
          }),
      }),
    ),
  ),
);

layer("AtlassianConnectionService", (it) => {
  it.effect("stores manual Bitbucket token in the secret store and returns redacted metadata", () =>
    Effect.gen(function* () {
      secrets.clear();
      const service = yield* AtlassianConnectionService;

      const summary = yield* service.saveManualBitbucketToken({
        label: "Acme Bitbucket",
        email: "alice@example.com",
        token: "app-password-secret",
        isDefault: true,
      });

      assert.equal(summary.kind, "bitbucket_token");
      assert.equal(summary.accountEmail, "alice@example.com");
      assert.equal(summary.status, "connected");
      assert.isFalse(JSON.stringify(summary).includes("app-password-secret"));
      assert.isTrue(secrets.has(manualBitbucketTokenSecretName(summary.connectionId)));

      const connections = yield* service.listConnections;
      assert.equal(connections.length, 1);
      assert.equal(connections[0]?.connectionId, summary.connectionId);
    }),
  );

  it.effect("stores manual Jira token and registers the Jira site resource", () =>
    Effect.gen(function* () {
      secrets.clear();
      const service = yield* AtlassianConnectionService;

      const summary = yield* service.saveManualJiraToken({
        label: "Acme Jira",
        email: "jira@example.com",
        siteUrl: "https://acme.atlassian.net/",
        token: "jira-api-token",
      });

      assert.equal(summary.kind, "jira_token");
      assert.equal(summary.baseUrl, "https://acme.atlassian.net");
      assert.deepStrictEqual(summary.products, ["jira"]);
      assert.isFalse(JSON.stringify(summary).includes("jira-api-token"));
      assert.isTrue(secrets.has(manualJiraTokenSecretName(summary.connectionId)));

      const resources = yield* service.listResources({
        connectionId: summary.connectionId,
        product: "jira",
      });
      assert.equal(resources.length, 1);
      assert.equal(resources[0]?.url, "https://acme.atlassian.net");
    }),
  );

  it.effect("saves and reads a project Atlassian link", () =>
    Effect.gen(function* () {
      const service = yield* AtlassianConnectionService;
      const connection = yield* service.saveManualBitbucketToken({
        label: "Project Bitbucket",
        email: "project@example.com",
        token: "project-secret",
      });

      const saved = yield* service.saveProjectLink({
        projectId: ProjectId.make("project-1"),
        jiraConnectionId: null,
        bitbucketConnectionId: connection.connectionId,
        jiraCloudId: null,
        jiraSiteUrl: null,
        jiraProjectKeys: ["RYCO"],
        bitbucketWorkspace: "acme",
        bitbucketRepoSlug: "ryco",
        defaultIssueTypeName: "Task",
        branchNameTemplate: "{key}-{summary}",
        commitMessageTemplate: "{key}: {summary}",
        pullRequestTitleTemplate: "{key}: {summary}",
        smartLinkingEnabled: true,
        autoAttachWorkItems: true,
      });
      const loaded = yield* service.getProjectLink({ projectId: ProjectId.make("project-1") });

      assert.equal(saved.bitbucketConnectionId, connection.connectionId);
      assert.deepStrictEqual(loaded?.jiraProjectKeys, ["RYCO"]);
      assert.equal(loaded?.bitbucketRepoSlug, "ryco");
    }),
  );

  it.effect("derives a project Jira site URL from the selected Jira connection", () =>
    Effect.gen(function* () {
      secrets.clear();
      const service = yield* AtlassianConnectionService;
      const connection = yield* service.saveManualJiraToken({
        label: "Derived Jira",
        email: "jira@example.com",
        siteUrl: "https://derived.atlassian.net/",
        token: "jira-secret",
      });

      const saved = yield* service.saveProjectLink({
        projectId: ProjectId.make("project-derived-jira"),
        jiraConnectionId: connection.connectionId,
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
      });

      assert.equal(saved.jiraSiteUrl, "https://derived.atlassian.net");
      assert.deepStrictEqual(saved.jiraProjectKeys, ["KAN"]);
    }),
  );
});
