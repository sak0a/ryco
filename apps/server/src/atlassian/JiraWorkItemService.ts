import {
  WorkItemProviderError,
  type WorkItemAddCommentInput,
  type WorkItemDetail,
  type WorkItemGetInput,
  type WorkItemListInput,
  type WorkItemListProjectsInput,
  type WorkItemSearchInput,
  type WorkItemProject,
  type WorkItemSummary,
  type WorkItemTransition,
  type WorkItemTransitionInput,
  type WorkItemListTransitionsInput,
  WORK_ITEM_DETAIL_BODY_MAX_BYTES,
  WORK_ITEM_DETAIL_COMMENT_BODY_MAX_BYTES,
  WORK_ITEM_DETAIL_MAX_COMMENTS,
} from "@ryco/contracts";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { AtlassianConnectionRepository } from "../persistence/Services/AtlassianConnections.ts";
import { ProjectAtlassianLinkRepository } from "../persistence/Services/ProjectAtlassianLinks.ts";
import { manualJiraTokenSecretName } from "./AtlassianConnectionService.ts";

export interface JiraWorkItemServiceShape {
  readonly list: (
    input: WorkItemListInput,
  ) => Effect.Effect<ReadonlyArray<WorkItemSummary>, WorkItemProviderError>;
  readonly listProjects: (
    input: WorkItemListProjectsInput,
  ) => Effect.Effect<ReadonlyArray<WorkItemProject>, WorkItemProviderError>;
  readonly search: (
    input: WorkItemSearchInput,
  ) => Effect.Effect<ReadonlyArray<WorkItemSummary>, WorkItemProviderError>;
  readonly get: (input: WorkItemGetInput) => Effect.Effect<WorkItemDetail, WorkItemProviderError>;
  readonly addComment: (
    input: WorkItemAddCommentInput,
  ) => Effect.Effect<WorkItemDetail, WorkItemProviderError>;
  readonly listTransitions: (
    input: WorkItemListTransitionsInput,
  ) => Effect.Effect<ReadonlyArray<WorkItemTransition>, WorkItemProviderError>;
  readonly transition: (
    input: WorkItemTransitionInput,
  ) => Effect.Effect<WorkItemDetail, WorkItemProviderError>;
}

export class JiraWorkItemService extends Context.Service<
  JiraWorkItemService,
  JiraWorkItemServiceShape
>()("ryco/atlassian/JiraWorkItemService") {}

const textDecoder = new TextDecoder();

const JiraUserSchema = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  emailAddress: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

const JiraStatusCategorySchema = Schema.Struct({
  key: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

const JiraIssueSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    status: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          name: Schema.String,
          statusCategory: Schema.optional(Schema.NullOr(JiraStatusCategorySchema)),
        }),
      ),
    ),
    issuetype: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    priority: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    assignee: Schema.optional(Schema.NullOr(JiraUserSchema)),
    reporter: Schema.optional(Schema.NullOr(JiraUserSchema)),
    labels: Schema.optional(Schema.Array(Schema.String)),
    created: Schema.optional(Schema.NullOr(Schema.String)),
    updated: Schema.optional(Schema.NullOr(Schema.String)),
    description: Schema.optional(Schema.NullOr(Schema.Unknown)),
    parent: Schema.optional(Schema.NullOr(Schema.Struct({ key: Schema.String }))),
    customfield_10014: Schema.optional(Schema.NullOr(Schema.String)),
  }),
});

const JiraSearchSchema = Schema.Struct({
  issues: Schema.Array(JiraIssueSchema),
});

const JiraProjectSchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  projectTypeKey: Schema.optional(Schema.String),
  simplified: Schema.optional(Schema.Boolean),
  avatarUrls: Schema.optional(Schema.Unknown),
});

const JiraProjectSearchSchema = Schema.Struct({
  values: Schema.Array(JiraProjectSchema),
});

const JiraCommentSchema = Schema.Struct({
  author: Schema.optional(Schema.NullOr(JiraUserSchema)),
  body: Schema.optional(Schema.NullOr(Schema.Unknown)),
  created: Schema.optional(Schema.String),
});

const JiraCommentListSchema = Schema.Struct({
  comments: Schema.Array(JiraCommentSchema),
});

const JiraTransitionSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  to: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.String,
        statusCategory: Schema.optional(Schema.NullOr(JiraStatusCategorySchema)),
      }),
    ),
  ),
});

const JiraTransitionsSchema = Schema.Struct({
  transitions: Schema.Array(JiraTransitionSchema),
});

const ISSUE_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "created",
  "updated",
  "description",
  "parent",
  "customfield_10014",
] as const;

interface JiraProjectContext {
  readonly siteUrl: string;
  readonly email: string;
  readonly token: string;
  readonly projectKeys: ReadonlyArray<string>;
}

interface JiraConnectionContext {
  readonly siteUrl: string;
  readonly email: string;
  readonly token: string;
}

function responseError(
  operation: string,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, WorkItemProviderError> {
  return response.text.pipe(
    Effect.catch(() => Effect.succeed("")),
    Effect.flatMap((body) =>
      Effect.fail(
        workItemError(
          operation,
          body.trim().length > 0
            ? `Jira returned HTTP ${response.status}: ${body.trim().slice(0, 300)}`
            : `Jira returned HTTP ${response.status}.`,
        ),
      ),
    ),
  );
}

function workItemError(operation: string, detail: string, cause?: unknown): WorkItemProviderError {
  return new WorkItemProviderError({
    provider: "jira",
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function mapError(operation: string, detail: string) {
  return (cause: unknown) => workItemError(operation, detail, cause);
}

function issueProjectKey(key: string): string | null {
  const [projectKey] = key.trim().toUpperCase().split("-", 1);
  return projectKey && /^[A-Z][A-Z0-9]{1,9}$/u.test(projectKey) ? projectKey : null;
}

function requireProjectKeys(
  context: JiraProjectContext,
  operation: string,
): Effect.Effect<void, WorkItemProviderError> {
  return context.projectKeys.length > 0
    ? Effect.void
    : Effect.fail(
        workItemError(operation, "No Jira project keys are configured for the linked project."),
      );
}

function requireAllowedIssueKey(
  context: JiraProjectContext,
  key: string,
  operation: string,
): Effect.Effect<void, WorkItemProviderError> {
  const projectKey = issueProjectKey(key);
  if (projectKey && context.projectKeys.includes(projectKey)) {
    return Effect.void;
  }
  return Effect.fail(
    workItemError(
      operation,
      `Issue key ${key} is outside the linked Jira project keys: ${context.projectKeys.join(", ")}.`,
    ),
  );
}

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function originOf(value: string): string | null {
  try {
    return new URL(trimSlash(value)).origin;
  } catch {
    return null;
  }
}

function displayName(
  user:
    | {
        readonly displayName?: string | undefined;
        readonly emailAddress?: string | undefined;
        readonly name?: string | undefined;
      }
    | null
    | undefined,
): string | null {
  return user?.displayName?.trim() || user?.emailAddress?.trim() || user?.name?.trim() || null;
}

function stateFromStatusCategory(
  statusCategory:
    | {
        readonly key?: string | undefined;
        readonly name?: string | undefined;
      }
    | null
    | undefined,
): WorkItemSummary["state"] {
  const key = statusCategory?.key?.toLowerCase();
  const name = statusCategory?.name?.toLowerCase();
  if (key === "done" || name === "done") return "done";
  if (key === "indeterminate" || name === "in progress") return "in_progress";
  if (key === "new" || name === "to do") return "open";
  return "unknown";
}

function optionDate(value: string | null | undefined): WorkItemSummary["updatedAt"] {
  if (!value) return Option.none();
  return Option.some(DateTime.fromDateUnsafe(new Date(value)));
}

function truncateText(
  value: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
  let size = 0;
  let result = "";
  for (const char of value) {
    const charSize = new TextEncoder().encode(char).byteLength;
    if (size + charSize > maxBytes) break;
    size += charSize;
    result += char;
  }
  return { text: result.trimEnd(), truncated: true };
}

function adfToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as {
    readonly type?: unknown;
    readonly text?: unknown;
    readonly content?: unknown;
  };
  const ownText = typeof node.text === "string" ? node.text : "";
  const children = Array.isArray(node.content) ? node.content.map(adfToText).filter(Boolean) : [];
  if (children.length === 0) return ownText;
  const separator =
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "bulletList" ||
    node.type === "orderedList" ||
    node.type === "listItem"
      ? "\n"
      : "";
  return children.join(separator);
}

function adfFromText(value: string) {
  return {
    type: "doc",
    version: 1,
    content: value.split(/\n{2,}/u).map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }],
    })),
  };
}

function jqlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function sanitizeLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? fallback)));
}

function stateClause(state: WorkItemListInput["state"]): string | null {
  switch (state) {
    case "open":
      return "statusCategory != Done";
    case "in_progress":
      return 'statusCategory = "In Progress"';
    case "done":
    case "closed":
      return "statusCategory = Done";
    case "all":
      return null;
  }
}

function buildJql(input: {
  readonly projectKeys: ReadonlyArray<string>;
  readonly state: WorkItemListInput["state"];
  readonly query?: string | undefined;
}): string {
  const clauses: string[] = [];
  if (input.projectKeys.length === 1) {
    const [projectKey] = input.projectKeys;
    if (projectKey) clauses.push(`project = ${jqlString(projectKey)}`);
  } else if (input.projectKeys.length > 1) {
    clauses.push(`project in (${input.projectKeys.map(jqlString).join(", ")})`);
  }
  const state = stateClause(input.state);
  if (state) clauses.push(state);
  const query = input.query?.trim();
  if (query) clauses.push(`text ~ ${jqlString(query)}`);
  return `${clauses.length > 0 ? clauses.join(" AND ") : "ORDER BY updated DESC"}${
    clauses.length > 0 ? " ORDER BY updated DESC" : ""
  }`;
}

function mapIssueSummary(
  siteUrl: string,
  issue: Schema.Schema.Type<typeof JiraIssueSchema>,
): WorkItemSummary {
  return {
    provider: "jira",
    key: issue.key,
    id: issue.id,
    title: issue.fields.summary,
    url: `${siteUrl}/browse/${encodeURIComponent(issue.key)}`,
    state: stateFromStatusCategory(issue.fields.status?.statusCategory),
    ...(issue.fields.issuetype?.name ? { issueType: issue.fields.issuetype.name } : {}),
    ...(issue.fields.priority?.name ? { priority: issue.fields.priority.name } : {}),
    assignee: displayName(issue.fields.assignee),
    ...(displayName(issue.fields.reporter)
      ? { reporter: displayName(issue.fields.reporter)! }
      : {}),
    ...(issue.fields.labels && issue.fields.labels.length > 0
      ? { labels: issue.fields.labels }
      : {}),
    createdAt: optionDate(issue.fields.created),
    updatedAt: optionDate(issue.fields.updated),
  };
}

function avatarUrlFromProject(
  avatarUrls: Schema.Schema.Type<typeof JiraProjectSchema>["avatarUrls"],
): string | undefined {
  if (!avatarUrls || typeof avatarUrls !== "object") return undefined;
  const values = avatarUrls as Record<string, unknown>;
  for (const key of ["48x48", "32x32", "24x24", "16x16"]) {
    const value = values[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function mapProject(
  siteUrl: string,
  project: Schema.Schema.Type<typeof JiraProjectSchema>,
): WorkItemProject {
  const avatarUrl = avatarUrlFromProject(project.avatarUrls);
  return {
    provider: "jira",
    key: project.key,
    name: project.name,
    url: `${siteUrl}/jira/software/projects/${encodeURIComponent(project.key)}`,
    ...(project.projectTypeKey ? { projectTypeKey: project.projectTypeKey } : {}),
    ...(project.simplified !== undefined ? { simplified: project.simplified } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function mapTransitions(
  transitions: ReadonlyArray<Schema.Schema.Type<typeof JiraTransitionSchema>>,
): ReadonlyArray<WorkItemTransition> {
  return transitions.map((transition) => ({
    id: transition.id,
    name: transition.name,
    toState: stateFromStatusCategory(transition.to?.statusCategory),
  }));
}

export const make = Effect.fn("makeJiraWorkItemService")(function* () {
  const connections = yield* AtlassianConnectionRepository;
  const projectLinks = yield* ProjectAtlassianLinkRepository;
  const secretStore = yield* ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;

  const resolveConnection = Effect.fn("JiraWorkItemService.resolveConnection")(function* (
    input: WorkItemListProjectsInput,
  ) {
    const connection = yield* connections.getById({ connectionId: input.connectionId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              workItemError(
                "workItems.resolveConnection",
                "The selected Jira connection was not found.",
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError(
        mapError("workItems.resolveConnection", "Failed to load the Jira connection."),
      ),
    );
    if (connection.status !== "connected") {
      return yield* workItemError(
        "workItems.resolveConnection",
        `The Jira connection is ${connection.status.replace("_", " ")}.`,
      );
    }
    if (!connection.products.includes("jira")) {
      return yield* workItemError(
        "workItems.resolveConnection",
        "The selected connection is not a Jira connection.",
      );
    }
    if (!connection.accountEmail) {
      return yield* workItemError(
        "workItems.resolveConnection",
        "The Jira connection is missing its account email.",
      );
    }

    const connectionSiteUrl = trimSlash(connection.baseUrl ?? "");
    const requestedSiteUrl = trimSlash(input.siteUrl ?? connectionSiteUrl);
    if (!requestedSiteUrl) {
      return yield* workItemError(
        "workItems.resolveConnection",
        "The Jira connection is missing its site URL.",
      );
    }
    if (
      input.siteUrl !== undefined &&
      connectionSiteUrl &&
      originOf(input.siteUrl) !== originOf(connectionSiteUrl)
    ) {
      return yield* workItemError(
        "workItems.resolveConnection",
        "The Jira site URL must match the selected Jira connection.",
      );
    }

    const tokenBytes = yield* secretStore
      .get(manualJiraTokenSecretName(input.connectionId))
      .pipe(
        Effect.mapError(
          mapError("workItems.resolveConnection", "Failed to read the saved Jira API token."),
        ),
      );
    if (!tokenBytes) {
      return yield* workItemError(
        "workItems.resolveConnection",
        "The saved Jira API token is missing.",
      );
    }

    return {
      siteUrl: requestedSiteUrl,
      email: connection.accountEmail,
      token: textDecoder.decode(tokenBytes).trim(),
    } satisfies JiraConnectionContext;
  });

  const resolveProject = Effect.fn("JiraWorkItemService.resolveProject")(function* (input: {
    readonly projectId?: WorkItemListInput["projectId"];
    readonly projectKeys?: ReadonlyArray<string> | undefined;
  }) {
    if (!input.projectId) {
      return yield* workItemError(
        "workItems.resolveProject",
        "Jira work item calls require a project link. Open the project explorer and configure Jira for this project.",
      );
    }
    const link = yield* projectLinks.getByProjectId({ projectId: input.projectId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              workItemError("workItems.resolveProject", "This project is not linked to Jira yet."),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError(
        mapError("workItems.resolveProject", "Failed to read the Jira project link."),
      ),
    );
    if (!link.jiraConnectionId) {
      return yield* workItemError(
        "workItems.resolveProject",
        "This project link does not have a Jira connection selected.",
      );
    }
    const connection = yield* connections.getById({ connectionId: link.jiraConnectionId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              workItemError("workItems.resolveProject", "The saved Jira connection was not found."),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.mapError(mapError("workItems.resolveProject", "Failed to load the Jira connection.")),
    );
    if (connection.status !== "connected") {
      return yield* workItemError(
        "workItems.resolveProject",
        `The Jira connection is ${connection.status.replace("_", " ")}.`,
      );
    }
    if (!connection.accountEmail) {
      return yield* workItemError(
        "workItems.resolveProject",
        "The Jira connection is missing its account email.",
      );
    }
    const tokenBytes = yield* secretStore
      .get(manualJiraTokenSecretName(link.jiraConnectionId))
      .pipe(
        Effect.mapError(
          mapError("workItems.resolveProject", "Failed to read the saved Jira API token."),
        ),
      );
    if (!tokenBytes) {
      return yield* workItemError(
        "workItems.resolveProject",
        "The saved Jira API token is missing.",
      );
    }
    const siteUrl = trimSlash(link.jiraSiteUrl ?? connection.baseUrl ?? "");
    if (!siteUrl) {
      return yield* workItemError(
        "workItems.resolveProject",
        "The project link is missing the Jira site URL.",
      );
    }
    const projectKeys = (
      input.projectKeys && input.projectKeys.length > 0 ? input.projectKeys : link.jiraProjectKeys
    )
      .map((key) => key.trim())
      .map((key) => key.toUpperCase())
      .filter(Boolean);
    return {
      siteUrl,
      email: connection.accountEmail,
      token: textDecoder.decode(tokenBytes),
      projectKeys,
    };
  });

  const request = <S extends Schema.Top>(
    operation: string,
    schema: S,
    context: {
      readonly siteUrl: string;
      readonly email: string;
      readonly token: string;
      readonly path: string;
      readonly method?: "GET" | "POST";
      readonly body?: unknown;
      readonly urlParams?: Record<string, string>;
    },
  ): Effect.Effect<S["Type"], WorkItemProviderError, S["DecodingServices"]> => {
    const url = `${context.siteUrl}${context.path}`;
    const base =
      context.method === "POST"
        ? HttpClientRequest.post(url, { urlParams: context.urlParams })
        : HttpClientRequest.get(url, { urlParams: context.urlParams });
    const withBody =
      context.body === undefined ? base : base.pipe(HttpClientRequest.bodyJsonUnsafe(context.body));
    return httpClient
      .execute(
        withBody.pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.basicAuth(context.email, context.token),
        ),
      )
      .pipe(
        Effect.mapError(mapError(operation, "Jira request failed.")),
        Effect.flatMap((response) =>
          HttpClientResponse.matchStatus({
            "2xx": (success) =>
              HttpClientResponse.schemaBodyJson(schema)(success).pipe(
                Effect.mapError(
                  mapError(operation, "Jira returned invalid JSON for the requested resource."),
                ),
              ),
            orElse: (failed) => responseError(operation, failed),
          })(response),
        ),
      );
  };

  const searchIssues = Effect.fn("JiraWorkItemService.searchIssues")(function* (
    input: WorkItemListInput | WorkItemSearchInput,
  ) {
    const context = yield* resolveProject(input);
    yield* requireProjectKeys(context, "workItems.search");
    const jql = buildJql({
      projectKeys: context.projectKeys,
      state: "state" in input ? input.state : "all",
      query: "query" in input ? input.query : undefined,
    });
    const result = yield* request("workItems.search", JiraSearchSchema, {
      ...context,
      path: "/rest/api/3/search/jql",
      method: "POST",
      body: {
        jql,
        maxResults: sanitizeLimit(input.limit, 50),
        fields: ISSUE_FIELDS,
      },
    });
    return result.issues.map((issue) => mapIssueSummary(context.siteUrl, issue));
  });

  const listProjects = Effect.fn("JiraWorkItemService.listProjects")(function* (
    input: WorkItemListProjectsInput,
  ) {
    const context = yield* resolveConnection(input);
    const result = yield* request("workItems.listProjects", JiraProjectSearchSchema, {
      ...context,
      path: "/rest/api/3/project/search",
      urlParams: {
        maxResults: "100",
      },
    });
    return result.values.map((project) => mapProject(context.siteUrl, project));
  });

  const getTransitions = Effect.fn("JiraWorkItemService.getTransitions")(function* (
    context: JiraProjectContext,
    key: string,
  ) {
    const result = yield* request("workItems.listTransitions", JiraTransitionsSchema, {
      ...context,
      path: `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    });
    return mapTransitions(result.transitions);
  });

  const getDetail = Effect.fn("JiraWorkItemService.getDetail")(function* (input: WorkItemGetInput) {
    const context = yield* resolveProject(input);
    yield* requireProjectKeys(context, "workItems.get");
    yield* requireAllowedIssueKey(context, input.key, "workItems.get");
    const [issue, comments, transitions] = yield* Effect.all(
      [
        request("workItems.get", JiraIssueSchema, {
          ...context,
          path: `/rest/api/3/issue/${encodeURIComponent(input.key)}`,
          urlParams: {
            fields: ISSUE_FIELDS.join(","),
          },
        }),
        request("workItems.comments", JiraCommentListSchema, {
          ...context,
          path: `/rest/api/3/issue/${encodeURIComponent(input.key)}/comment`,
          urlParams: {
            maxResults: String(WORK_ITEM_DETAIL_MAX_COMMENTS),
            orderBy: "-created",
          },
        }),
        getTransitions(context, input.key),
      ],
      { concurrency: 3 },
    );
    const body = truncateText(adfToText(issue.fields.description), WORK_ITEM_DETAIL_BODY_MAX_BYTES);
    const mappedComments = comments.comments
      .slice(0, WORK_ITEM_DETAIL_MAX_COMMENTS)
      .map((comment) => {
        const text = truncateText(adfToText(comment.body), WORK_ITEM_DETAIL_COMMENT_BODY_MAX_BYTES);
        return {
          author: displayName(comment.author) ?? "unknown",
          body: text.text,
          createdAt: DateTime.fromDateUnsafe(new Date(comment.created ?? new Date().toISOString())),
        };
      });
    return {
      ...mapIssueSummary(context.siteUrl, issue),
      description: body.text,
      comments: mappedComments,
      transitions,
      linkedChangeRequests: [],
      ...(issue.fields.parent?.key ? { parentKey: issue.fields.parent.key } : {}),
      ...(issue.fields.customfield_10014 ? { epicKey: issue.fields.customfield_10014 } : {}),
      truncated: body.truncated || comments.comments.length > mappedComments.length,
    } satisfies WorkItemDetail;
  });

  const requestVoid = (
    operation: string,
    context: {
      readonly siteUrl: string;
      readonly email: string;
      readonly token: string;
      readonly path: string;
      readonly method: "POST";
      readonly body?: unknown;
    },
  ) => {
    const base = HttpClientRequest.post(`${context.siteUrl}${context.path}`);
    const withBody =
      context.body === undefined ? base : base.pipe(HttpClientRequest.bodyJsonUnsafe(context.body));
    return httpClient
      .execute(
        withBody.pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.basicAuth(context.email, context.token),
        ),
      )
      .pipe(
        Effect.mapError(mapError(operation, "Jira request failed.")),
        Effect.flatMap((response) =>
          HttpClientResponse.matchStatus({
            "2xx": () => Effect.void,
            orElse: (failed) => responseError(operation, failed),
          })(response),
        ),
      );
  };

  return JiraWorkItemService.of({
    listProjects,
    list: (input) => searchIssues(input),
    search: (input) => searchIssues(input),
    get: (input) => getDetail(input),
    addComment: (input) =>
      Effect.gen(function* () {
        const context = yield* resolveProject(input);
        yield* requireProjectKeys(context, "workItems.addComment");
        yield* requireAllowedIssueKey(context, input.key, "workItems.addComment");
        yield* requestVoid("workItems.addComment", {
          ...context,
          path: `/rest/api/3/issue/${encodeURIComponent(input.key)}/comment`,
          method: "POST",
          body: {
            body: adfFromText(input.body),
          },
        });
        return yield* getDetail(input);
      }),
    listTransitions: (input) =>
      Effect.gen(function* () {
        const context = yield* resolveProject(input);
        yield* requireProjectKeys(context, "workItems.listTransitions");
        yield* requireAllowedIssueKey(context, input.key, "workItems.listTransitions");
        return yield* getTransitions(context, input.key);
      }),
    transition: (input) =>
      Effect.gen(function* () {
        const context = yield* resolveProject(input);
        yield* requireProjectKeys(context, "workItems.transition");
        yield* requireAllowedIssueKey(context, input.key, "workItems.transition");
        if (input.comment) {
          yield* requestVoid("workItems.transitionComment", {
            ...context,
            path: `/rest/api/3/issue/${encodeURIComponent(input.key)}/comment`,
            method: "POST",
            body: {
              body: adfFromText(input.comment),
            },
          });
        }
        yield* requestVoid("workItems.transition", {
          ...context,
          path: `/rest/api/3/issue/${encodeURIComponent(input.key)}/transitions`,
          method: "POST",
          body: {
            transition: {
              id: input.transitionId,
            },
          },
        });
        return yield* getDetail(input);
      }),
  });
});

export const layer = Layer.effect(JiraWorkItemService, make());
