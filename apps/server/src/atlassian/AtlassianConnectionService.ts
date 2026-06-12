import {
  AtlassianConnectionError,
  AtlassianConnectionId,
  AtlassianConnectionSummary,
  AtlassianProjectLink,
  AtlassianResourceId,
  AtlassianResourceSummary,
  type AtlassianDisconnectInput,
  type AtlassianGetProjectLinkInput,
  type AtlassianListResourcesInput,
  type AtlassianRefreshInput,
  type AtlassianSaveManualBitbucketTokenInput,
  type AtlassianSaveManualJiraTokenInput,
  type AtlassianSaveProjectLinkInput,
  type AtlassianStartOAuthInput,
  type AtlassianStartOAuthResult,
} from "@ryco/contracts";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import {
  AtlassianConnectionRepository,
  type AtlassianConnectionRecord,
} from "../persistence/Services/AtlassianConnections.ts";
import { AtlassianResourceRepository } from "../persistence/Services/AtlassianResources.ts";
import { ProjectAtlassianLinkRepository } from "../persistence/Services/ProjectAtlassianLinks.ts";

const textEncoder = new TextEncoder();

export interface AtlassianConnectionServiceShape {
  readonly listConnections: Effect.Effect<
    ReadonlyArray<AtlassianConnectionSummary>,
    AtlassianConnectionError
  >;
  readonly startOAuth: (
    input: AtlassianStartOAuthInput,
  ) => Effect.Effect<AtlassianStartOAuthResult, AtlassianConnectionError>;
  readonly saveManualBitbucketToken: (
    input: AtlassianSaveManualBitbucketTokenInput,
  ) => Effect.Effect<AtlassianConnectionSummary, AtlassianConnectionError>;
  readonly saveManualJiraToken: (
    input: AtlassianSaveManualJiraTokenInput,
  ) => Effect.Effect<AtlassianConnectionSummary, AtlassianConnectionError>;
  readonly disconnect: (
    input: AtlassianDisconnectInput,
  ) => Effect.Effect<void, AtlassianConnectionError>;
  readonly refresh: (
    input: AtlassianRefreshInput,
  ) => Effect.Effect<AtlassianConnectionSummary, AtlassianConnectionError>;
  readonly listResources: (
    input: AtlassianListResourcesInput,
  ) => Effect.Effect<ReadonlyArray<AtlassianResourceSummary>, AtlassianConnectionError>;
  readonly getProjectLink: (
    input: AtlassianGetProjectLinkInput,
  ) => Effect.Effect<AtlassianProjectLink | null, AtlassianConnectionError>;
  readonly saveProjectLink: (
    input: AtlassianSaveProjectLinkInput,
  ) => Effect.Effect<AtlassianProjectLink, AtlassianConnectionError>;
}

export class AtlassianConnectionService extends Context.Service<
  AtlassianConnectionService,
  AtlassianConnectionServiceShape
>()("ryco/atlassian/AtlassianConnectionService") {}

function atlassianError(
  operation: string,
  detail: string,
  cause?: unknown,
): AtlassianConnectionError {
  return new AtlassianConnectionError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function mapError(operation: string, detail: string) {
  return (cause: unknown) => atlassianError(operation, detail, cause);
}

function nowIso(): string {
  return new Date().toISOString();
}

function dateTime(value: string) {
  return DateTime.makeUnsafe(value);
}

function nullableDateTime(value: string | null) {
  return value === null ? null : dateTime(value);
}

function isManualTokenConnection(record: AtlassianConnectionRecord | null): boolean {
  return record === null || record.kind === "bitbucket_token" || record.kind === "jira_token";
}

export const manualBitbucketTokenSecretName = (connectionId: AtlassianConnectionId): string =>
  `atlassian/bitbucket-token/${connectionId}`;

export const manualJiraTokenSecretName = (connectionId: AtlassianConnectionId): string =>
  `atlassian/jira-token/${connectionId}`;

function normalizeSiteUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(normalizeSiteUrl(value)).origin;
  } catch {
    return null;
  }
}

export const make = Effect.fn("makeAtlassianConnectionService")(function* () {
  const connections = yield* AtlassianConnectionRepository;
  const resources = yield* AtlassianResourceRepository;
  const projectLinks = yield* ProjectAtlassianLinkRepository;
  const secretStore = yield* ServerSecretStore;

  const toSummary = (record: AtlassianConnectionRecord): AtlassianConnectionSummary => ({
    connectionId: record.connectionId,
    kind: record.kind,
    label: record.label,
    status: record.status,
    products: record.products,
    capabilities: record.capabilities,
    accountName: record.accountName,
    accountEmail: record.accountEmail,
    avatarUrl: record.avatarUrl,
    baseUrl: record.baseUrl,
    expiresAt: nullableDateTime(record.expiresAt),
    lastVerifiedAt: nullableDateTime(record.lastVerifiedAt),
    readonly: record.readonly,
    isDefault: record.isDefault,
    createdAt: dateTime(record.createdAt),
    updatedAt: dateTime(record.updatedAt),
  });

  const toResourceSummary = (
    record: import("../persistence/Services/AtlassianResources.ts").AtlassianResourceRecord,
  ): AtlassianResourceSummary => ({
    resourceId: record.resourceId,
    connectionId: record.connectionId,
    product: record.product,
    name: record.name,
    url: record.url,
    capabilities: record.capabilities,
    cloudId: record.cloudId,
    workspaceSlug: record.workspaceSlug,
    avatarUrl: record.avatarUrl,
    updatedAt: dateTime(record.updatedAt),
  });

  const toProjectLink = (
    record: import("../persistence/Services/ProjectAtlassianLinks.ts").ProjectAtlassianLinkRecord,
  ): AtlassianProjectLink => ({
    projectId: record.projectId,
    jiraConnectionId: record.jiraConnectionId,
    bitbucketConnectionId: record.bitbucketConnectionId,
    jiraCloudId: record.jiraCloudId,
    jiraSiteUrl: record.jiraSiteUrl,
    jiraProjectKeys: record.jiraProjectKeys,
    bitbucketWorkspace: record.bitbucketWorkspace,
    bitbucketRepoSlug: record.bitbucketRepoSlug,
    defaultIssueTypeName: record.defaultIssueTypeName,
    branchNameTemplate: record.branchNameTemplate,
    commitMessageTemplate: record.commitMessageTemplate,
    pullRequestTitleTemplate: record.pullRequestTitleTemplate,
    smartLinkingEnabled: record.smartLinkingEnabled,
    autoAttachWorkItems: record.autoAttachWorkItems,
    createdAt: dateTime(record.createdAt),
    updatedAt: dateTime(record.updatedAt),
  });

  const cleanupSecretOnFailure = (secretName: string) =>
    Effect.tapError(() => secretStore.remove(secretName).pipe(Effect.ignore));

  const removeConnectionSecrets = (connectionId: AtlassianConnectionId) =>
    Effect.all(
      [
        secretStore.remove(manualBitbucketTokenSecretName(connectionId)),
        secretStore.remove(manualJiraTokenSecretName(connectionId)),
      ],
      { concurrency: 2 },
    ).pipe(Effect.asVoid);

  const vettedJiraSiteUrl = Effect.fn("AtlassianConnectionService.vettedJiraSiteUrl")(function* (
    input: AtlassianSaveProjectLinkInput,
  ) {
    if (!input.jiraConnectionId) return null;
    const connection = yield* connections.getById({ connectionId: input.jiraConnectionId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              atlassianError(
                "atlassian.saveProjectLink",
                "The selected Jira connection was not found.",
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    const connectionSiteUrl = normalizeSiteUrl(connection.baseUrl ?? "");
    if (!connectionSiteUrl || !connection.products.includes("jira")) {
      return yield* atlassianError(
        "atlassian.saveProjectLink",
        "The selected Jira connection does not have a vetted Jira site URL.",
      );
    }
    const connectionOrigin = normalizedOrigin(connectionSiteUrl);
    const inputOrigin = input.jiraSiteUrl ? normalizedOrigin(input.jiraSiteUrl) : null;
    if (!connectionOrigin || (input.jiraSiteUrl && inputOrigin !== connectionOrigin)) {
      return yield* atlassianError(
        "atlassian.saveProjectLink",
        "The Jira site URL must match the selected Jira connection.",
      );
    }
    return connectionSiteUrl;
  });

  return AtlassianConnectionService.of({
    listConnections: connections.list().pipe(
      Effect.map((items) => items.map(toSummary)),
      Effect.mapError(
        mapError("atlassian.listConnections", "Failed to list Atlassian connections."),
      ),
    ),
    startOAuth: (_input) =>
      Effect.fail(
        atlassianError(
          "atlassian.startOAuth",
          "Atlassian OAuth is not configured on this server. Use a manual Bitbucket token for now.",
        ),
      ),
    saveManualBitbucketToken: (input) => {
      const createdAt = nowIso();
      const connectionId = AtlassianConnectionId.make(`atl-conn-${crypto.randomUUID()}`);
      const record = {
        connectionId,
        kind: "bitbucket_token" as const,
        label: input.label,
        status: "connected" as const,
        products: ["bitbucket" as const],
        capabilities: ["bitbucket:read" as const, "bitbucket:write" as const],
        accountName: null,
        accountEmail: input.email,
        avatarUrl: null,
        baseUrl: "https://api.bitbucket.org/2.0",
        expiresAt: null,
        lastVerifiedAt: null,
        readonly: false,
        isDefault: input.isDefault ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      return secretStore
        .set(manualBitbucketTokenSecretName(connectionId), textEncoder.encode(input.token))
        .pipe(
          Effect.flatMap(() => connections.upsert(record)),
          cleanupSecretOnFailure(manualBitbucketTokenSecretName(connectionId)),
          Effect.as(toSummary(record)),
          Effect.mapError(
            mapError("atlassian.saveManualBitbucketToken", "Failed to save the Bitbucket token."),
          ),
        );
    },
    saveManualJiraToken: (input) => {
      const createdAt = nowIso();
      const connectionId = AtlassianConnectionId.make(`atl-conn-${crypto.randomUUID()}`);
      const siteUrl = normalizeSiteUrl(input.siteUrl);
      const record = {
        connectionId,
        kind: "jira_token" as const,
        label: input.label,
        status: "connected" as const,
        products: ["jira" as const],
        capabilities: ["jira:read" as const, "jira:write" as const],
        accountName: null,
        accountEmail: input.email,
        avatarUrl: null,
        baseUrl: siteUrl,
        expiresAt: null,
        lastVerifiedAt: null,
        readonly: false,
        isDefault: input.isDefault ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      const resource = {
        resourceId: AtlassianResourceId.make(`atl-resource-${crypto.randomUUID()}`),
        connectionId,
        product: "jira" as const,
        name: input.label,
        url: siteUrl,
        capabilities: ["jira:read" as const, "jira:write" as const],
        cloudId: null,
        workspaceSlug: null,
        avatarUrl: null,
        updatedAt: createdAt,
      };
      return secretStore
        .set(manualJiraTokenSecretName(connectionId), textEncoder.encode(input.token))
        .pipe(
          Effect.flatMap(() => connections.upsert(record)),
          Effect.flatMap(() =>
            resources.upsertForConnection({
              connectionId,
              resources: [resource],
            }),
          ),
          cleanupSecretOnFailure(manualJiraTokenSecretName(connectionId)),
          Effect.as(toSummary(record)),
          Effect.mapError(
            mapError("atlassian.saveManualJiraToken", "Failed to save the Jira API token."),
          ),
        );
    },
    disconnect: (input) =>
      connections.getById({ connectionId: input.connectionId }).pipe(
        Effect.flatMap((recordOption) => {
          const record = Option.getOrNull(recordOption);
          const updatedAt = nowIso();
          const cleanupLocalState = Effect.all(
            [removeConnectionSecrets(input.connectionId), resources.deleteForConnection(input)],
            { concurrency: 2 },
          ).pipe(Effect.asVoid);

          if (isManualTokenConnection(record)) {
            return cleanupLocalState.pipe(
              Effect.flatMap(() =>
                projectLinks.clearConnectionReferences({
                  connectionId: input.connectionId,
                  updatedAt,
                }),
              ),
              Effect.flatMap(() => connections.deleteById({ connectionId: input.connectionId })),
            );
          }

          return connections
            .disconnect({
              connectionId: input.connectionId,
              updatedAt,
            })
            .pipe(Effect.flatMap(() => cleanupLocalState));
        }),
        Effect.mapError(
          mapError("atlassian.disconnect", "Failed to disconnect the Atlassian connection."),
        ),
      ),
    refresh: (input) =>
      connections.getById({ connectionId: input.connectionId }).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                atlassianError(
                  "atlassian.refresh",
                  `Atlassian connection ${input.connectionId} was not found.`,
                ),
              ),
            onSome: (record) => Effect.succeed(toSummary(record)),
          }),
        ),
        Effect.mapError(
          mapError("atlassian.refresh", "Failed to refresh the Atlassian connection."),
        ),
      ),
    listResources: (input) =>
      resources.list(input).pipe(
        Effect.map((items) => items.map(toResourceSummary)),
        Effect.mapError(mapError("atlassian.listResources", "Failed to list Atlassian resources.")),
      ),
    getProjectLink: (input) =>
      projectLinks
        .getByProjectId(input)
        .pipe(
          Effect.map(Option.match({ onNone: () => null, onSome: toProjectLink })),
          Effect.mapError(
            mapError("atlassian.getProjectLink", "Failed to load the project Atlassian link."),
          ),
        ),
    saveProjectLink: (input) =>
      vettedJiraSiteUrl(input).pipe(
        Effect.flatMap((jiraSiteUrl) =>
          projectLinks.getByProjectId({ projectId: input.projectId }).pipe(
            Effect.flatMap((existing) => {
              const updatedAt = nowIso();
              const createdAt = Option.isSome(existing) ? existing.value.createdAt : updatedAt;
              const record = {
                ...input,
                jiraSiteUrl,
                createdAt,
                updatedAt,
              };
              return projectLinks.upsert(record).pipe(Effect.as(toProjectLink(record)));
            }),
          ),
        ),
        Effect.mapError((error) => {
          if (Schema.is(AtlassianConnectionError)(error)) return error;
          return mapError(
            "atlassian.saveProjectLink",
            "Failed to save the project Atlassian link.",
          )(error);
        }),
      ),
  });
});

export const layer = Layer.effect(AtlassianConnectionService, make());
