import { AtlassianConnectionId } from "@ryco/contracts";
import { assert, it, vi } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { AtlassianConnectionRepository } from "../persistence/Services/AtlassianConnections.ts";
import type { AtlassianConnectionRecord } from "../persistence/Services/AtlassianConnections.ts";
import { ProjectAtlassianLinkRepository } from "../persistence/Services/ProjectAtlassianLinks.ts";
import { JiraWorkItemService, layer as JiraWorkItemServiceLive } from "./JiraWorkItemService.ts";
import { manualJiraTokenSecretName } from "./AtlassianConnectionService.ts";

const textEncoder = new TextEncoder();

function connectedJiraConnection(connectionId: AtlassianConnectionId): AtlassianConnectionRecord {
  const timestamp = "2026-06-08T00:00:00.000Z";
  return {
    connectionId,
    kind: "jira_token",
    label: "Jira",
    status: "connected",
    products: ["jira"],
    capabilities: ["jira:read", "jira:write"],
    accountName: null,
    accountEmail: "jira@example.com",
    avatarUrl: null,
    baseUrl: "https://ryco-app.atlassian.net",
    expiresAt: null,
    lastVerifiedAt: null,
    readonly: false,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function basicAuthorization(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
}

function makeLayer(input: {
  readonly connection: AtlassianConnectionRecord;
  readonly token: string;
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, input.response(request))),
  );

  const layer = JiraWorkItemServiceLive.pipe(
    Layer.provide(
      Layer.mock(AtlassianConnectionRepository)({
        getById: ({ connectionId }) =>
          Effect.succeed(
            connectionId === input.connection.connectionId
              ? Option.some(input.connection)
              : Option.none(),
          ),
        list: () => Effect.succeed([input.connection]),
        upsert: () => Effect.void,
        disconnect: () => Effect.succeed(false),
        deleteById: () => Effect.void,
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectAtlassianLinkRepository)({
        getByProjectId: () => Effect.die("unexpected project link lookup"),
        upsert: () => Effect.die("unexpected project link upsert"),
        deleteByProjectId: () => Effect.die("unexpected project link delete"),
      }),
    ),
    Layer.provide(
      Layer.mock(ServerSecretStore)({
        get: (name) =>
          Effect.succeed(
            name === manualJiraTokenSecretName(input.connection.connectionId)
              ? textEncoder.encode(input.token)
              : null,
          ),
        set: () => Effect.void,
        getOrCreateRandom: (_name, bytes) => Effect.succeed(new Uint8Array(bytes)),
        remove: () => Effect.void,
      }),
    ),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => execute(request)),
      ),
    ),
  );

  return { execute, layer };
}

it.effect("lists Jira projects from a saved manual Jira token", () => {
  const connectionId = AtlassianConnectionId.make("atl-jira-1");
  const connection = connectedJiraConnection(connectionId);
  const { execute, layer } = makeLayer({
    connection,
    token: "jira-secret",
    response: () =>
      Response.json({
        values: [
          {
            key: "KAN",
            name: "Mein Software-Team",
            projectTypeKey: "software",
            simplified: true,
            avatarUrls: {
              "48x48": "https://avatar.test/KAN.png",
            },
          },
        ],
      }),
  });

  return Effect.gen(function* () {
    const service = yield* JiraWorkItemService;
    const projects = yield* service.listProjects({
      connectionId,
      siteUrl: "https://ryco-app.atlassian.net/",
    });

    assert.deepStrictEqual(projects, [
      {
        provider: "jira",
        key: "KAN",
        name: "Mein Software-Team",
        url: "https://ryco-app.atlassian.net/jira/software/projects/KAN",
        projectTypeKey: "software",
        simplified: true,
        avatarUrl: "https://avatar.test/KAN.png",
      },
    ]);
    assert.strictEqual(execute.mock.calls.length, 1);
    const request = execute.mock.calls[0]?.[0];
    assert.ok(request);
    const url = new URL(request.url);
    assert.strictEqual(url.origin, "https://ryco-app.atlassian.net");
    assert.strictEqual(url.pathname, "/rest/api/3/project/search");
    assert.deepStrictEqual(request.urlParams.params, [["maxResults", "100"]]);
    assert.strictEqual(
      request.headers.authorization,
      basicAuthorization("jira@example.com", "jira-secret"),
    );
  }).pipe(Effect.provide(layer));
});
