/**
 * Read-only tool catalog for the internal Agent Control MCP endpoint.
 *
 * Every tool is capability-checked against the caller's session grants and
 * scoped by the server-authoritative policy; results are bounded, redacted
 * projections — titles, identifiers, statuses, and bounded transcript text.
 * Workspace paths, provider configuration, secrets, raw activity payloads,
 * and full diagnostics never cross this boundary. No mutation tool exists
 * in this catalog, and none may be added outside the proposal-backed
 * thread-actions slice.
 *
 * @module agentControl/Mcp/tools
 */
import {
  AGENT_CONTROL_MCP_LIST_LIMIT_DEFAULT,
  AGENT_CONTROL_MCP_LIST_LIMIT_MAX,
  AGENT_CONTROL_MCP_MESSAGE_LIMIT_DEFAULT,
  AGENT_CONTROL_MCP_MESSAGE_LIMIT_MAX,
  AGENT_CONTROL_MCP_MESSAGE_TEXT_MAX_CHARS,
  AGENT_CONTROL_MCP_MODELS_PER_INSTANCE_MAX,
  AGENT_CONTROL_MCP_TOOLS,
  AGENT_CONTROL_MCP_TOOL_NAMES,
  AGENT_CONTROL_MCP_WAIT_TIMEOUT_MS_DEFAULT,
  AGENT_CONTROL_MCP_WAIT_TIMEOUT_MS_MAX,
  AGENT_CONTROL_CAPABILITIES,
  AGENT_CONTROL_TERMINAL_PROPOSAL_STATUSES,
  AgentControlMcpCapabilitiesResult,
  AgentControlMcpContextResult,
  AgentControlMcpControlRequestResult,
  AgentControlMcpListProjectsInput,
  AgentControlMcpListProjectsResult,
  AgentControlMcpListThreadsInput,
  AgentControlMcpListThreadsResult,
  AgentControlMcpReadControlRequestInput,
  AgentControlMcpReadThreadInput,
  AgentControlMcpReadThreadResult,
  AgentControlMcpWaitForControlRequestInput,
  OrchestrationThreadHistoryCursor,
  type AgentControlMcpMessage,
  type AgentControlMcpProviderInstanceSummary,
  type AgentControlMcpThreadSummary,
  type AgentControlProposal,
  type AgentControlProposalStatus,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationThreadHistoryPageInfo,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@ryco/contracts";
import { Duration, Effect, Option, Schema, Stream } from "effect";

import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { AgentControlPolicyShape } from "../Services/AgentControlPolicy.ts";
import type { AgentControlProposalEventsShape } from "../Services/AgentControlProposalEvents.ts";
import type { AgentControlProposalServiceShape } from "../Services/AgentControlProposalService.ts";
import { toAgentControlProposalReceipt } from "../Services/AgentControlProposalService.ts";
import type { AgentControlSessionRecord } from "../Services/AgentControlSessionRegistry.ts";

export interface AgentControlMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface AgentControlMcpToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

export interface AgentControlMcpToolDeps {
  readonly policy: AgentControlPolicyShape;
  readonly proposals: Pick<AgentControlProposalServiceShape, "getProposal">;
  readonly proposalEvents: Pick<AgentControlProposalEventsShape, "subscribe">;
  readonly projections: ProjectionSnapshotQueryShape;
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;
}

export interface AgentControlMcpTools {
  readonly descriptors: ReadonlyArray<AgentControlMcpToolDescriptor>;
  readonly hasTool: (name: string) => boolean;
  readonly callTool: (
    session: AgentControlSessionRecord,
    name: string,
    args: unknown,
  ) => Effect.Effect<AgentControlMcpToolResult>;
}

/** Bounded, presentation-safe tool failure. Never carries internals. */
class ToolFailure {
  readonly _tag = "ToolFailure";
  readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}

const failTool = (reason: string) => Effect.fail(new ToolFailure(reason));

const cursorSchemaProperty = { type: "string", maxLength: 1_024 } as const;
const limitSchemaProperty = (maximum: number) =>
  ({ type: "integer", minimum: 1, maximum }) as const;

const TOOL_DESCRIPTORS: ReadonlyArray<AgentControlMcpToolDescriptor> = [
  {
    name: AGENT_CONTROL_MCP_TOOLS.context,
    description:
      "Identify this session's Ryco thread, project, provider instance, and granted Agent Control capabilities.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: AGENT_CONTROL_MCP_TOOLS.capabilities,
    description:
      "List the Agent Control tool catalog (read-only in this build) and the configured Ryco provider instances with their current model availability.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: AGENT_CONTROL_MCP_TOOLS.listProjects,
    description: "List Ryco projects (bounded page; cursor-based).",
    inputSchema: {
      type: "object",
      properties: {
        limit: limitSchemaProperty(AGENT_CONTROL_MCP_LIST_LIMIT_MAX),
        cursor: cursorSchemaProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: AGENT_CONTROL_MCP_TOOLS.listThreads,
    description:
      "List Ryco threads with status, optionally filtered by project (bounded page; cursor-based; archived threads excluded unless requested).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", maxLength: 256 },
        includeArchived: { type: "boolean" },
        limit: limitSchemaProperty(AGENT_CONTROL_MCP_LIST_LIMIT_MAX),
        cursor: cursorSchemaProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: AGENT_CONTROL_MCP_TOOLS.readThread,
    description:
      "Read one thread's status header and a bounded, newest-first page of its conversation messages (cursor pages older history).",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", maxLength: 256 },
        messageLimit: limitSchemaProperty(AGENT_CONTROL_MCP_MESSAGE_LIMIT_MAX),
        cursor: cursorSchemaProperty,
      },
      required: ["threadId"],
      additionalProperties: false,
    },
  },
  {
    name: AGENT_CONTROL_MCP_TOOLS.readControlRequest,
    description:
      "Read the lifecycle receipt of an Agent Control request this session created (status, decision, terminal result).",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string", maxLength: 256 } },
      required: ["proposalId"],
      additionalProperties: false,
    },
  },
  {
    name: AGENT_CONTROL_MCP_TOOLS.waitForControlRequest,
    description:
      "Wait (bounded) until an Agent Control request this session created is decided or reaches a terminal outcome, then return its receipt.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string", maxLength: 256 },
        waitFor: { type: "string", enum: ["decided", "terminal"] },
        timeoutMs: limitSchemaProperty(AGENT_CONTROL_MCP_WAIT_TIMEOUT_MS_MAX),
      },
      required: ["proposalId"],
      additionalProperties: false,
    },
  },
];

const clampLimit = (value: number | undefined, fallback: number, max: number): number =>
  Math.min(value ?? fallback, max);

// ── List cursors ──────────────────────────────────────────────────────
//
// Opaque `acp1.<base64url json>` cursors over the stable
// `(createdAt, id)` ascending ordering of the shell snapshot.

interface ListCursorOrder {
  readonly createdAt: string;
  readonly id: string;
}

const LIST_CURSOR_PREFIX = "acp1.";

const encodeListCursor = (kind: "projects" | "threads", after: ListCursorOrder): string =>
  `${LIST_CURSOR_PREFIX}${Buffer.from(JSON.stringify({ v: 1, kind, after }), "utf8").toString("base64url")}`;

const decodeListCursor = (kind: "projects" | "threads", cursor: string): ListCursorOrder | null => {
  if (!cursor.startsWith(LIST_CURSOR_PREFIX)) return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor.slice(LIST_CURSOR_PREFIX.length), "base64url").toString("utf8"),
    );
    if (typeof decoded !== "object" || decoded === null) return null;
    const record = decoded as Record<string, unknown>;
    const after = record.after as Record<string, unknown> | undefined;
    if (
      record.v !== 1 ||
      record.kind !== kind ||
      typeof after?.createdAt !== "string" ||
      typeof after?.id !== "string"
    ) {
      return null;
    }
    return { createdAt: after.createdAt, id: after.id };
  } catch {
    return null;
  }
};

const compareOrder = (a: ListCursorOrder, b: ListCursorOrder): number =>
  a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

interface ListPage<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}

const paginate = <T>(input: {
  readonly kind: "projects" | "threads";
  readonly rows: ReadonlyArray<T>;
  readonly order: (row: T) => ListCursorOrder;
  readonly limit: number;
  readonly cursor: string | undefined;
}): ListPage<T> | null => {
  let after: ListCursorOrder | null = null;
  if (input.cursor !== undefined) {
    after = decodeListCursor(input.kind, input.cursor);
    if (after === null) return null;
  }
  const sorted = input.rows.toSorted((a, b) => compareOrder(input.order(a), input.order(b)));
  const startFrom = after;
  const filtered =
    startFrom === null
      ? sorted
      : sorted.filter((row) => compareOrder(input.order(row), startFrom) > 0);
  const items = filtered.slice(0, input.limit);
  const last = items.at(-1);
  const nextCursor =
    filtered.length > input.limit && last !== undefined
      ? encodeListCursor(input.kind, input.order(last))
      : null;
  return { items, nextCursor };
};

// ── Result mapping ────────────────────────────────────────────────────

const toThreadSummary = (shell: OrchestrationThreadShell): AgentControlMcpThreadSummary => ({
  threadId: shell.id,
  projectId: shell.projectId,
  title: shell.title,
  status: shell.session?.status ?? "idle",
  activeTurnId: shell.session?.activeTurnId ?? null,
  providerInstanceId: shell.session?.providerInstanceId ?? null,
  archived: shell.archivedAt !== null,
  createdAt: shell.createdAt,
  updatedAt: shell.updatedAt,
});

const toMcpMessage = (message: OrchestrationMessage): AgentControlMcpMessage => {
  const truncated = message.text.length > AGENT_CONTROL_MCP_MESSAGE_TEXT_MAX_CHARS;
  return {
    messageId: message.id,
    role: message.role,
    text: truncated
      ? message.text.slice(0, AGENT_CONTROL_MCP_MESSAGE_TEXT_MAX_CHARS)
      : message.text,
    truncated,
    turnId: message.turnId,
    attachmentCount: message.attachments?.length ?? 0,
    createdAt: message.createdAt,
  };
};

const toInstanceSummary = (provider: ServerProvider): AgentControlMcpProviderInstanceSummary => ({
  instanceId: provider.instanceId,
  driver: provider.driver,
  displayName: provider.displayName ?? null,
  enabled: provider.enabled,
  status: provider.status,
  availability: provider.availability ?? "available",
  models: provider.models
    .slice(0, AGENT_CONTROL_MCP_MODELS_PER_INSTANCE_MAX)
    .map((model) => ({ slug: model.slug, name: model.name })),
});

/**
 * A proposal is visible to a provider-session caller iff it was created by
 * a provider-session principal of the same thread. Everything else reads
 * as not-found — absence and authorization failure stay indistinguishable.
 */
const proposalVisibleToSession = (
  proposal: AgentControlProposal,
  session: AgentControlSessionRecord,
): boolean =>
  proposal.principal.kind === "provider-session" &&
  proposal.principal.threadId === session.threadId;

const waitConditionMet = (
  status: AgentControlProposalStatus,
  waitFor: "decided" | "terminal",
): boolean =>
  waitFor === "terminal"
    ? AGENT_CONTROL_TERMINAL_PROPOSAL_STATUSES.includes(status)
    : status !== "pending-user-approval";

// ── Factory ───────────────────────────────────────────────────────────

export const makeAgentControlMcpTools = (deps: AgentControlMcpToolDeps): AgentControlMcpTools => {
  const toolNames = new Set<string>(AGENT_CONTROL_MCP_TOOL_NAMES);

  const decodeArgs = <S extends Schema.Top>(schema: S, args: unknown) =>
    Schema.decodeUnknownEffect(schema)(args ?? {}).pipe(
      Effect.mapError(() => new ToolFailure("Invalid tool arguments.")),
    ) as Effect.Effect<S["Type"], ToolFailure>;

  const authorizeRead = (session: AgentControlSessionRecord, operation: string) =>
    deps.policy
      .authorize({
        principal: {
          kind: "provider-session",
          threadId: session.threadId,
          providerInstanceId: session.providerInstanceId,
          runtimeSessionId: session.runtimeSessionId,
        },
        grantedCapabilities: session.grantedCapabilities,
        requiredCapability: AGENT_CONTROL_CAPABILITIES.read,
        operation,
      })
      .pipe(
        Effect.mapError((error) =>
          error._tag === "AgentControlDisabledError"
            ? new ToolFailure("Agent Control is disabled.")
            : new ToolFailure("Capability denied."),
        ),
      );

  const readProposalForSession = (
    session: AgentControlSessionRecord,
    proposalId: AgentControlProposal["proposalId"],
  ) =>
    deps.proposals.getProposal(proposalId).pipe(
      Effect.mapError((error) =>
        error._tag === "AgentControlDisabledError"
          ? new ToolFailure("Agent Control is disabled.")
          : new ToolFailure("Control request read failed."),
      ),
      Effect.flatMap((proposal) =>
        Option.isSome(proposal) && proposalVisibleToSession(proposal.value, session)
          ? Effect.succeed(proposal.value)
          : failTool("Control request not found."),
      ),
    );

  const context = (session: AgentControlSessionRecord) =>
    Effect.gen(function* () {
      const threadShell = yield* deps.projections
        .getThreadShellById(session.threadId)
        .pipe(Effect.mapError(() => new ToolFailure("Context read failed.")));
      const projectShell = yield* Option.match(threadShell, {
        onNone: () => Effect.succeed(Option.none<OrchestrationProjectShell>()),
        onSome: (shell) =>
          deps.projections
            .getProjectShellById(shell.projectId)
            .pipe(Effect.mapError(() => new ToolFailure("Context read failed."))),
      });
      return Schema.encodeSync(AgentControlMcpContextResult)({
        threadId: session.threadId,
        threadTitle: Option.match(threadShell, {
          onNone: () => null,
          onSome: (shell) => shell.title,
        }),
        projectId: Option.match(threadShell, {
          onNone: () => null,
          onSome: (shell) => shell.projectId,
        }),
        projectTitle: Option.match(projectShell, {
          onNone: () => null,
          onSome: (shell) => shell.title,
        }),
        providerInstanceId: session.providerInstanceId,
        runtimeSessionId: session.runtimeSessionId,
        capabilities: session.grantedCapabilities,
        writeToolsAvailable: false,
      });
    });

  const capabilities = (session: AgentControlSessionRecord) =>
    Effect.gen(function* () {
      const enabled = yield* deps.policy.isEnabled;
      const providers = yield* deps.getProviders;
      return Schema.encodeSync(AgentControlMcpCapabilitiesResult)({
        enabled,
        readOnly: true,
        tools: [...AGENT_CONTROL_MCP_TOOL_NAMES],
        grantedCapabilities: session.grantedCapabilities,
        providerInstances: providers.map(toInstanceSummary),
      });
    });

  const listProjects = (_session: AgentControlSessionRecord, args: unknown) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(AgentControlMcpListProjectsInput, args);
      const limit = clampLimit(
        input.limit,
        AGENT_CONTROL_MCP_LIST_LIMIT_DEFAULT,
        AGENT_CONTROL_MCP_LIST_LIMIT_MAX,
      );
      const snapshot = yield* deps.projections
        .getShellSnapshot()
        .pipe(Effect.mapError(() => new ToolFailure("Project list read failed.")));
      const page = paginate({
        kind: "projects",
        rows: snapshot.projects,
        order: (project) => ({ createdAt: project.createdAt, id: project.id }),
        limit,
        cursor: input.cursor,
      });
      if (page === null) return yield* failTool("Invalid cursor.");
      return Schema.encodeSync(AgentControlMcpListProjectsResult)({
        projects: page.items.map((project) => ({
          projectId: project.id,
          title: project.title,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })),
        nextCursor: page.nextCursor,
      });
    });

  const listThreads = (_session: AgentControlSessionRecord, args: unknown) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(AgentControlMcpListThreadsInput, args);
      const limit = clampLimit(
        input.limit,
        AGENT_CONTROL_MCP_LIST_LIMIT_DEFAULT,
        AGENT_CONTROL_MCP_LIST_LIMIT_MAX,
      );
      const snapshot = yield* deps.projections
        .getShellSnapshot()
        .pipe(Effect.mapError(() => new ToolFailure("Thread list read failed.")));
      const rows = snapshot.threads.filter(
        (thread) =>
          (input.projectId === undefined || thread.projectId === input.projectId) &&
          (input.includeArchived === true || thread.archivedAt === null),
      );
      const page = paginate({
        kind: "threads",
        rows,
        order: (thread) => ({ createdAt: thread.createdAt, id: thread.id }),
        limit,
        cursor: input.cursor,
      });
      if (page === null) return yield* failTool("Invalid cursor.");
      return Schema.encodeSync(AgentControlMcpListThreadsResult)({
        threads: page.items.map(toThreadSummary),
        nextCursor: page.nextCursor,
      });
    });

  const readThread = (_session: AgentControlSessionRecord, args: unknown) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(AgentControlMcpReadThreadInput, args);
      const limit = clampLimit(
        input.messageLimit,
        AGENT_CONTROL_MCP_MESSAGE_LIMIT_DEFAULT,
        AGENT_CONTROL_MCP_MESSAGE_LIMIT_MAX,
      );
      const shell = yield* deps.projections
        .getThreadShellById(input.threadId)
        .pipe(Effect.mapError(() => new ToolFailure("Thread read failed.")));
      if (Option.isNone(shell)) return yield* failTool("Thread not found.");

      const getThreadWindow = deps.projections.getThreadWindow;
      const getThreadHistoryPage = deps.projections.getThreadHistoryPage;
      if (getThreadWindow === undefined || getThreadHistoryPage === undefined) {
        return yield* failTool("Thread history is unavailable.");
      }

      const mapHistoryError = (error: { readonly _tag: string; readonly reason?: string }) =>
        error._tag === "OrchestrationThreadHistoryError"
          ? error.reason === "thread-not-found"
            ? new ToolFailure("Thread not found.")
            : new ToolFailure("Invalid or stale cursor.")
          : new ToolFailure("Thread read failed.");

      let messages: ReadonlyArray<OrchestrationMessage>;
      let pageInfo: OrchestrationThreadHistoryPageInfo;
      if (input.cursor === undefined) {
        const window = yield* getThreadWindow({
          threadId: input.threadId,
          limits: { messages: limit, proposedPlans: 1, activities: 1, checkpoints: 1 },
        }).pipe(Effect.mapError(mapHistoryError));
        messages = window.thread.messages;
        pageInfo = window.history.messages;
      } else {
        const cursor = Schema.decodeUnknownOption(OrchestrationThreadHistoryCursor)(input.cursor);
        if (Option.isNone(cursor)) return yield* failTool("Invalid or stale cursor.");
        const historyPage = yield* getThreadHistoryPage({
          threadId: input.threadId,
          collection: "messages",
          mode: { kind: "before", cursor: cursor.value },
          limit,
        }).pipe(Effect.mapError(mapHistoryError));
        if (historyPage.collection !== "messages") {
          return yield* failTool("Thread read failed.");
        }
        messages = historyPage.items;
        pageInfo = historyPage.page;
      }

      return Schema.encodeSync(AgentControlMcpReadThreadResult)({
        thread: toThreadSummary(shell.value),
        messages: messages.map(toMcpMessage),
        hasMoreBefore: pageInfo.hasMoreBefore,
        nextCursor: pageInfo.hasMoreBefore ? pageInfo.oldestCursor : null,
      });
    });

  const readControlRequest = (session: AgentControlSessionRecord, args: unknown) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(AgentControlMcpReadControlRequestInput, args);
      const proposal = yield* readProposalForSession(session, input.proposalId);
      return Schema.encodeSync(AgentControlMcpControlRequestResult)({
        receipt: toAgentControlProposalReceipt(proposal),
      });
    });

  const waitForControlRequest = (session: AgentControlSessionRecord, args: unknown) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(AgentControlMcpWaitForControlRequestInput, args);
      const waitFor = input.waitFor ?? "decided";
      const timeoutMs = clampLimit(
        input.timeoutMs,
        AGENT_CONTROL_MCP_WAIT_TIMEOUT_MS_DEFAULT,
        AGENT_CONTROL_MCP_WAIT_TIMEOUT_MS_MAX,
      );

      return yield* Effect.scoped(
        Effect.gen(function* () {
          // Subscribe before the initial read so no transition between the
          // read and the stream start can be missed.
          const subscription = yield* deps.proposalEvents.subscribe;
          const current = yield* readProposalForSession(session, input.proposalId);
          if (waitConditionMet(current.status, waitFor)) {
            return Schema.encodeSync(AgentControlMcpControlRequestResult)({
              receipt: toAgentControlProposalReceipt(current),
              timedOut: false,
            });
          }

          const matched = yield* Stream.fromSubscription(subscription).pipe(
            Stream.filter(
              (event) =>
                event.proposal.proposalId === input.proposalId &&
                proposalVisibleToSession(event.proposal, session) &&
                waitConditionMet(event.proposal.status, waitFor),
            ),
            Stream.runHead,
            Effect.timeoutOption(Duration.millis(timeoutMs)),
            Effect.map(Option.flatten),
          );

          if (Option.isSome(matched)) {
            return Schema.encodeSync(AgentControlMcpControlRequestResult)({
              receipt: toAgentControlProposalReceipt(matched.value.proposal),
              timedOut: false,
            });
          }

          // Timed out (or the feed shut down): return the freshest state —
          // the read sweeps expiry first, so an overdue proposal converges.
          const latest = yield* readProposalForSession(session, input.proposalId);
          return Schema.encodeSync(AgentControlMcpControlRequestResult)({
            receipt: toAgentControlProposalReceipt(latest),
            timedOut: !waitConditionMet(latest.status, waitFor),
          });
        }),
      );
    });

  const callTool: AgentControlMcpTools["callTool"] = (session, name, args) => {
    const handler = (): Effect.Effect<unknown, ToolFailure> => {
      switch (name) {
        case AGENT_CONTROL_MCP_TOOLS.context:
          return context(session);
        case AGENT_CONTROL_MCP_TOOLS.capabilities:
          return capabilities(session);
        case AGENT_CONTROL_MCP_TOOLS.listProjects:
          return listProjects(session, args);
        case AGENT_CONTROL_MCP_TOOLS.listThreads:
          return listThreads(session, args);
        case AGENT_CONTROL_MCP_TOOLS.readThread:
          return readThread(session, args);
        case AGENT_CONTROL_MCP_TOOLS.readControlRequest:
          return readControlRequest(session, args);
        case AGENT_CONTROL_MCP_TOOLS.waitForControlRequest:
          return waitForControlRequest(session, args);
        default:
          return failTool("Unknown tool.");
      }
    };

    return authorizeRead(session, `mcp:${name}`).pipe(
      Effect.flatMap(handler),
      Effect.map((result): AgentControlMcpToolResult => ({
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      })),
      Effect.catch((failure) =>
        Effect.succeed<AgentControlMcpToolResult>({
          content: [{ type: "text", text: failure.reason }],
          isError: true,
        }),
      ),
      Effect.catchDefect(() =>
        Effect.succeed<AgentControlMcpToolResult>({
          content: [{ type: "text", text: "Tool execution failed." }],
          isError: true,
        }),
      ),
    );
  };

  return {
    descriptors: TOOL_DESCRIPTORS,
    hasTool: (name) => toolNames.has(name),
    callTool,
  };
};
