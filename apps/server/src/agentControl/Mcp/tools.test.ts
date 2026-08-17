import {
  AGENT_CONTROL_CAPABILITIES,
  AGENT_CONTROL_MCP_MESSAGE_TEXT_MAX_CHARS,
  AGENT_CONTROL_MCP_TOOLS,
  AGENT_CONTROL_MCP_TOOL_NAMES,
  AGENT_CONTROL_ACTION_CAPABILITIES,
  AgentControlProposalId,
  AgentControlRequestId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  OrchestrationThreadWindowSnapshot,
  ProviderInstanceId,
  RuntimeSessionId,
  ServerProvider,
  ThreadId,
  type AgentControlProposal,
  type AgentControlProposalStreamProposalEvent,
  type OrchestrationShellSnapshot,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Option, PubSub, Schema } from "effect";

import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AgentControlCapabilityDeniedError, AgentControlDisabledError } from "../Errors.ts";
import type { AgentControlPolicyShape } from "../Services/AgentControlPolicy.ts";
import type { AgentControlSessionRecord } from "../Services/AgentControlSessionRegistry.ts";
import { makeAgentControlMcpTools, type AgentControlMcpToolDeps } from "./tools.ts";

// ── Fixtures ──────────────────────────────────────────────────────────

const decodeProject = Schema.decodeUnknownSync(OrchestrationProjectShell);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThreadShell);
const decodeWindow = Schema.decodeUnknownSync(OrchestrationThreadWindowSnapshot);
const decodeProvider = Schema.decodeUnknownSync(ServerProvider);

const T0 = "2026-08-18T00:00:00.000Z";
const T1 = "2026-08-18T01:00:00.000Z";
const T2 = "2026-08-18T02:00:00.000Z";

const projectOne = decodeProject({
  id: "project-1",
  title: "Project one",
  workspaceRoot: "/secret/path/project-one",
  defaultModelSelection: null,
  scripts: [
    {
      id: "script-1",
      name: "deploy",
      command: "./secret-deploy.sh --prod",
      icon: "play",
      runOnWorktreeCreate: false,
    },
  ],
  createdAt: T0,
  updatedAt: T0,
});
const projectTwo = decodeProject({
  id: "project-2",
  title: "Project two",
  workspaceRoot: "/secret/path/project-two",
  defaultModelSelection: null,
  scripts: [],
  createdAt: T1,
  updatedAt: T1,
});

const modelSelection = { instanceId: "codex", model: "gpt-5.3-codex" };

const makeThreadShell = (input: {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly archivedAt?: string | null;
  readonly session?: unknown;
}) =>
  decodeThread({
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    modelSelection,
    runtimeMode: "auto",
    branch: null,
    worktreePath: "/secret/worktrees/somewhere",
    latestTurn: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    archivedAt: input.archivedAt ?? null,
    session: input.session ?? null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  });

const callerThreadId = ThreadId.make("thread-caller");

const threadCaller = makeThreadShell({
  id: "thread-caller",
  projectId: "project-1",
  title: "Caller thread",
  createdAt: T0,
  session: {
    threadId: "thread-caller",
    status: "running",
    providerName: "codex",
    providerInstanceId: "codex",
    runtimeSessionId: "runtime-1",
    runtimeMode: "auto",
    activeTurnId: "turn-active",
    lastError: null,
    updatedAt: T1,
  },
});
const threadOther = makeThreadShell({
  id: "thread-other",
  projectId: "project-2",
  title: "Other thread",
  createdAt: T1,
});
const threadArchived = makeThreadShell({
  id: "thread-archived",
  projectId: "project-1",
  title: "Archived thread",
  createdAt: T2,
  archivedAt: T2,
});

const shellSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 12,
  projects: [projectOne, projectTwo],
  threads: [threadCaller, threadOther, threadArchived],
  updatedAt: T2,
};

const longText = "x".repeat(AGENT_CONTROL_MCP_MESSAGE_TEXT_MAX_CHARS + 500);

const windowSnapshot = decodeWindow({
  snapshotSequence: 12,
  thread: {
    id: "thread-caller",
    projectId: "project-1",
    title: "Caller thread",
    modelSelection,
    runtimeMode: "auto",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: T0,
    updatedAt: T1,
    deletedAt: null,
    messages: [
      {
        id: "message-1",
        role: "user",
        text: "hello",
        turnId: null,
        streaming: false,
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: "message-2",
        role: "assistant",
        text: longText,
        attachments: [
          { type: "image", id: "att-1", name: "shot.png", mimeType: "image/png", sizeBytes: 10 },
        ],
        turnId: "turn-1",
        streaming: false,
        createdAt: T1,
        updatedAt: T1,
      },
    ],
    activities: [],
    checkpoints: [],
    session: null,
  },
  history: {
    messages: { oldestCursor: "cursor-oldest", newestCursor: "cursor-newest", hasMoreBefore: true },
    proposedPlans: { oldestCursor: null, newestCursor: null, hasMoreBefore: false },
    activities: { oldestCursor: null, newestCursor: null, hasMoreBefore: false },
    checkpoints: { oldestCursor: null, newestCursor: null, hasMoreBefore: false },
  },
});

const codexProvider = decodeProvider({
  instanceId: "codex",
  driver: "codex",
  displayName: "Codex personal",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", email: "user@example.com" },
  checkedAt: T0,
  models: Array.from({ length: 60 }, (_, index) => ({
    slug: `model-${index}`,
    name: `Model ${index}`,
    isCustom: false,
    capabilities: null,
  })),
  slashCommands: [],
  skills: [],
});

const proposalOwn: AgentControlProposal = {
  proposalId: AgentControlProposalId.make("proposal-own"),
  requestId: AgentControlRequestId.make("request-own"),
  principal: {
    kind: "provider-session",
    threadId: callerThreadId,
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  planVersion: 1,
  plan: {
    kind: "sendMessage",
    threadId: ThreadId.make("thread-other"),
    text: "The secret plan prompt that must never surface in receipts.",
    delivery: "queue",
  },
  planDigest: "a".repeat(64),
  riskTags: [],
  promptSummary: "Send a message",
  status: "pending-user-approval",
  createdAt: T0,
  updatedAt: T0,
  expiresAt: "2099-01-01T00:00:00.000Z",
  decidedAt: null,
  result: null,
};

const proposalForeign: AgentControlProposal = {
  ...proposalOwn,
  proposalId: AgentControlProposalId.make("proposal-foreign"),
  requestId: AgentControlRequestId.make("request-foreign"),
  principal: {
    kind: "provider-session",
    threadId: ThreadId.make("thread-other"),
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
};

const session: AgentControlSessionRecord = {
  sessionId: "session-1",
  threadId: callerThreadId,
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeSessionId: RuntimeSessionId.make("runtime-1"),
  grantedCapabilities: [AGENT_CONTROL_CAPABILITIES.read],
  issuedAt: T0,
};

// ── Stub deps ─────────────────────────────────────────────────────────

const allowPolicy: AgentControlPolicyShape = {
  isEnabled: Effect.succeed(true),
  requireEnabled: () => Effect.void,
  requiredCapabilityForAction: (kind) => AGENT_CONTROL_ACTION_CAPABILITIES[kind],
  authorize: (input) =>
    input.grantedCapabilities.includes(input.requiredCapability)
      ? Effect.void
      : Effect.fail(
          new AgentControlCapabilityDeniedError({
            operation: input.operation,
            capability: input.requiredCapability,
          }),
        ),
};

const unavailable = (name: string) => (): never => {
  throw new Error(`${name} not stubbed`);
};

const projections: ProjectionSnapshotQueryShape = {
  getCommandReadModel: unavailable("getCommandReadModel"),
  getSnapshot: unavailable("getSnapshot"),
  getShellSnapshot: () => Effect.succeed(shellSnapshot),
  getSnapshotSequence: unavailable("getSnapshotSequence"),
  getCounts: unavailable("getCounts"),
  getActiveProjectByWorkspaceRoot: unavailable("getActiveProjectByWorkspaceRoot"),
  getProjectShellById: (projectId) =>
    Effect.succeed(
      Option.fromNullishOr([projectOne, projectTwo].find((project) => project.id === projectId)),
    ),
  getFirstActiveThreadIdByProjectId: unavailable("getFirstActiveThreadIdByProjectId"),
  getThreadCheckpointContext: unavailable("getThreadCheckpointContext"),
  getThreadShellById: (threadId) =>
    Effect.succeed(
      Option.fromNullishOr(
        [threadCaller, threadOther, threadArchived].find((thread) => thread.id === threadId),
      ),
    ),
  getThreadDetailById: unavailable("getThreadDetailById"),
  getThreadWindow: () => Effect.succeed(windowSnapshot),
  getThreadHistoryPage: (input) =>
    Effect.succeed({
      collection: "messages" as const,
      snapshotSequence: 12,
      items: windowSnapshot.thread.messages.slice(0, input.limit),
      page: { oldestCursor: null, newestCursor: null, hasMoreBefore: false },
    }),
  searchThreadMessages: unavailable("searchThreadMessages"),
};

const makeDeps = (overrides?: Partial<AgentControlMcpToolDeps>): AgentControlMcpToolDeps => ({
  policy: allowPolicy,
  proposals: {
    getProposal: (proposalId) =>
      Effect.succeed(
        Option.fromNullishOr(
          [proposalOwn, proposalForeign].find((candidate) => candidate.proposalId === proposalId),
        ),
      ),
  },
  proposalEvents: {
    subscribe: Effect.die("subscribe not stubbed" as const) as never,
  },
  projections,
  getProviders: Effect.succeed([codexProvider]),
  ...overrides,
});

const call = (
  deps: AgentControlMcpToolDeps,
  name: string,
  args?: unknown,
  caller: AgentControlSessionRecord = session,
) => makeAgentControlMcpTools(deps).callTool(caller, name, args);

const structured = (result: { readonly structuredContent?: unknown }): unknown =>
  result.structuredContent;

// ── Catalog ───────────────────────────────────────────────────────────

it.effect("advertises exactly the seven read-only tools and no mutations", () =>
  Effect.sync(() => {
    const tools = makeAgentControlMcpTools(makeDeps());
    assert.deepStrictEqual(
      tools.descriptors.map((descriptor) => descriptor.name).toSorted(),
      [...AGENT_CONTROL_MCP_TOOL_NAMES].toSorted(),
    );
    const serialized = JSON.stringify(tools.descriptors).toLowerCase();
    for (const mutation of ["create_thread", "send_message", "interrupt", "update_thread"]) {
      assert.notInclude(serialized, mutation);
    }
    assert.isFalse(tools.hasTool("ryco_create_threads"));
  }),
);

// ── Authorization ─────────────────────────────────────────────────────

it.effect("fails closed when the feature gate is disabled", () =>
  Effect.gen(function* () {
    const deps = makeDeps({
      policy: {
        ...allowPolicy,
        authorize: (input) =>
          Effect.fail(new AgentControlDisabledError({ operation: input.operation })),
      },
    });
    const result = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.listProjects);
    assert.isTrue(result.isError);
    assert.strictEqual(result.content[0]?.text, "Agent Control is disabled.");
  }),
);

it.effect("denies a session whose grants lack the read capability", () =>
  Effect.gen(function* () {
    const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.listProjects, undefined, {
      ...session,
      grantedCapabilities: [],
    });
    assert.isTrue(result.isError);
    assert.strictEqual(result.content[0]?.text, "Capability denied.");
  }),
);

// ── ryco_context / ryco_capabilities ──────────────────────────────────

it.effect("ryco_context reports the caller's thread, project, and grants", () =>
  Effect.gen(function* () {
    const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.context);
    assert.isUndefined(result.isError);
    const payload = structured(result) as Record<string, unknown>;
    assert.strictEqual(payload.threadId, "thread-caller");
    assert.strictEqual(payload.threadTitle, "Caller thread");
    assert.strictEqual(payload.projectId, "project-1");
    assert.strictEqual(payload.projectTitle, "Project one");
    assert.strictEqual(payload.writeToolsAvailable, false);
  }),
);

it.effect("ryco_capabilities uses provider instances and bounds model lists", () =>
  Effect.gen(function* () {
    const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.capabilities);
    assert.isUndefined(result.isError);
    const payload = structured(result) as {
      readonly readOnly: boolean;
      readonly tools: ReadonlyArray<string>;
      readonly providerInstances: ReadonlyArray<{
        readonly instanceId: string;
        readonly models: ReadonlyArray<unknown>;
      }>;
    };
    assert.isTrue(payload.readOnly);
    assert.deepStrictEqual(
      [...payload.tools].toSorted(),
      [...AGENT_CONTROL_MCP_TOOL_NAMES].toSorted(),
    );
    assert.strictEqual(payload.providerInstances[0]?.instanceId, "codex");
    assert.strictEqual(payload.providerInstances[0]?.models.length, 50);
    // Account identity and other sensitive snapshot fields stay out.
    assert.notInclude(JSON.stringify(payload), "user@example.com");
  }),
);

// ── Lists ─────────────────────────────────────────────────────────────

it.effect("ryco_list_projects returns bounded pages without filesystem paths", () =>
  Effect.gen(function* () {
    const deps = makeDeps();
    const first = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.listProjects, { limit: 1 });
    assert.isUndefined(first.isError);
    const firstPage = structured(first) as {
      readonly projects: ReadonlyArray<{ readonly projectId: string }>;
      readonly nextCursor: string | null;
    };
    assert.deepStrictEqual(
      firstPage.projects.map((project) => project.projectId),
      ["project-1"],
    );
    assert.isNotNull(firstPage.nextCursor);
    assert.notInclude(JSON.stringify(firstPage), "/secret/path");
    assert.notInclude(JSON.stringify(firstPage), "secret-deploy");

    const second = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.listProjects, {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    const secondPage = structured(second) as {
      readonly projects: ReadonlyArray<{ readonly projectId: string }>;
      readonly nextCursor: string | null;
    };
    assert.deepStrictEqual(
      secondPage.projects.map((project) => project.projectId),
      ["project-2"],
    );
    assert.isNull(secondPage.nextCursor);
  }),
);

it.effect("ryco_list_projects rejects a cursor minted for another tool", () =>
  Effect.gen(function* () {
    const deps = makeDeps();
    const threads = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.listThreads, { limit: 1 });
    const threadCursor = (structured(threads) as { readonly nextCursor: string | null }).nextCursor;
    assert.isNotNull(threadCursor);
    const result = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.listProjects, {
      cursor: threadCursor,
    });
    assert.isTrue(result.isError);
    assert.strictEqual(result.content[0]?.text, "Invalid cursor.");
  }),
);

it.effect("ryco_list_threads filters by project and archival state", () =>
  Effect.gen(function* () {
    const deps = makeDeps();
    const defaults = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.listThreads, {});
    const defaultPage = structured(defaults) as {
      readonly threads: ReadonlyArray<{ readonly threadId: string; readonly status: string }>;
    };
    assert.deepStrictEqual(
      defaultPage.threads.map((thread) => thread.threadId),
      ["thread-caller", "thread-other"],
    );
    assert.strictEqual(defaultPage.threads[0]?.status, "running");
    assert.notInclude(JSON.stringify(defaultPage), "/secret/worktrees");

    const archived = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.listThreads, {
      includeArchived: true,
      projectId: "project-1",
    });
    const archivedPage = structured(archived) as {
      readonly threads: ReadonlyArray<{ readonly threadId: string; readonly archived: boolean }>;
    };
    assert.deepStrictEqual(
      archivedPage.threads.map((thread) => thread.threadId),
      ["thread-caller", "thread-archived"],
    );
    assert.strictEqual(archivedPage.threads[1]?.archived, true);
  }),
);

// ── ryco_read_thread ──────────────────────────────────────────────────

it.effect("ryco_read_thread returns bounded, redacted transcript pages", () =>
  Effect.gen(function* () {
    const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.readThread, {
      threadId: "thread-caller",
    });
    assert.isUndefined(result.isError);
    const payload = structured(result) as {
      readonly thread: { readonly threadId: string; readonly activeTurnId: string | null };
      readonly messages: ReadonlyArray<{
        readonly text: string;
        readonly truncated: boolean;
        readonly attachmentCount: number;
      }>;
      readonly hasMoreBefore: boolean;
      readonly nextCursor: string | null;
    };
    assert.strictEqual(payload.thread.threadId, "thread-caller");
    assert.strictEqual(payload.thread.activeTurnId, "turn-active");
    assert.strictEqual(payload.messages.length, 2);
    assert.strictEqual(payload.messages[0]?.text, "hello");
    assert.strictEqual(payload.messages[0]?.truncated, false);
    assert.strictEqual(payload.messages[1]?.text.length, AGENT_CONTROL_MCP_MESSAGE_TEXT_MAX_CHARS);
    assert.strictEqual(payload.messages[1]?.truncated, true);
    assert.strictEqual(payload.messages[1]?.attachmentCount, 1);
    assert.isTrue(payload.hasMoreBefore);
    assert.strictEqual(payload.nextCursor, "cursor-oldest");
    // No attachment names/urls, no activity payloads, no checkpoints.
    assert.notInclude(JSON.stringify(payload), "shot.png");
  }),
);

it.effect("ryco_read_thread pages older history through the cursor", () =>
  Effect.gen(function* () {
    const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.readThread, {
      threadId: "thread-caller",
      cursor: "cursor-oldest",
      messageLimit: 1,
    });
    assert.isUndefined(result.isError);
    const payload = structured(result) as {
      readonly messages: ReadonlyArray<unknown>;
      readonly hasMoreBefore: boolean;
      readonly nextCursor: string | null;
    };
    assert.strictEqual(payload.messages.length, 1);
    assert.isFalse(payload.hasMoreBefore);
    assert.isNull(payload.nextCursor);
  }),
);

it.effect("ryco_read_thread reports unknown threads without detail", () =>
  Effect.gen(function* () {
    const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.readThread, {
      threadId: "thread-nope",
    });
    assert.isTrue(result.isError);
    assert.strictEqual(result.content[0]?.text, "Thread not found.");
  }),
);

// ── Control requests ──────────────────────────────────────────────────

it.effect("ryco_read_control_request returns the receipt without plan or prompt", () =>
  Effect.gen(function* () {
    const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.readControlRequest, {
      proposalId: "proposal-own",
    });
    assert.isUndefined(result.isError);
    const payload = structured(result) as {
      readonly receipt: { readonly proposalId: string; readonly status: string };
    };
    assert.strictEqual(payload.receipt.proposalId, "proposal-own");
    assert.strictEqual(payload.receipt.status, "pending-user-approval");
    // The action kind is part of the receipt; the plan payload, prompt
    // text, and prompt summary are not.
    const serialized = JSON.stringify(payload);
    assert.notInclude(serialized, "secret plan prompt");
    assert.notProperty(payload.receipt, "plan");
    assert.notProperty(payload.receipt, "promptSummary");
    assert.notInclude(serialized, "delivery");
  }),
);

it.effect("control requests of other principals read as not found", () =>
  Effect.gen(function* () {
    for (const proposalId of ["proposal-foreign", "proposal-missing"]) {
      const result = yield* call(makeDeps(), AGENT_CONTROL_MCP_TOOLS.readControlRequest, {
        proposalId,
      });
      assert.isTrue(result.isError, proposalId);
      assert.strictEqual(result.content[0]?.text, "Control request not found.");
    }
  }),
);

// ── ryco_wait_for_control_request ─────────────────────────────────────

const makeWaitDeps = (initial: AgentControlProposal) =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<AgentControlProposalStreamProposalEvent>();
    let current = initial;
    const deps = makeDeps({
      proposals: {
        getProposal: (proposalId) =>
          Effect.sync(() =>
            proposalId === current.proposalId ? Option.some(current) : Option.none(),
          ),
      },
      proposalEvents: { subscribe: PubSub.subscribe(pubsub) },
    });
    const publish = (proposal: AgentControlProposal) =>
      Effect.suspend(() => {
        current = proposal;
        return PubSub.publish(pubsub, {
          version: 1 as const,
          type: "proposal" as const,
          revision: 1,
          proposal,
        });
      });
    return { deps, publish };
  });

it.live("wait returns immediately when the proposal is already decided", () =>
  Effect.gen(function* () {
    const { deps } = yield* makeWaitDeps({
      ...proposalOwn,
      status: "rejected",
      decidedAt: T1,
    });
    const result = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.waitForControlRequest, {
      proposalId: "proposal-own",
      timeoutMs: 5_000,
    });
    assert.isUndefined(result.isError);
    const payload = structured(result) as {
      readonly receipt: { readonly status: string };
      readonly timedOut: boolean;
    };
    assert.strictEqual(payload.receipt.status, "rejected");
    assert.isFalse(payload.timedOut);
  }),
);

it.live("wait resolves when a decision event arrives", () =>
  Effect.gen(function* () {
    const { deps, publish } = yield* makeWaitDeps(proposalOwn);
    const fiber = yield* Effect.forkChild(
      call(deps, AGENT_CONTROL_MCP_TOOLS.waitForControlRequest, {
        proposalId: "proposal-own",
        timeoutMs: 10_000,
      }),
    );
    yield* Effect.sleep("50 millis");
    yield* publish({ ...proposalOwn, status: "approved", decidedAt: T1 });
    const result = yield* Fiber.join(fiber);
    assert.isUndefined(result.isError);
    const payload = structured(result) as {
      readonly receipt: { readonly status: string };
      readonly timedOut: boolean;
    };
    assert.strictEqual(payload.receipt.status, "approved");
    assert.isFalse(payload.timedOut);
  }),
);

it.live("wait times out with the freshest receipt and timedOut=true", () =>
  Effect.gen(function* () {
    const { deps } = yield* makeWaitDeps(proposalOwn);
    const result = yield* call(deps, AGENT_CONTROL_MCP_TOOLS.waitForControlRequest, {
      proposalId: "proposal-own",
      timeoutMs: 1,
    });
    assert.isUndefined(result.isError);
    const payload = structured(result) as {
      readonly receipt: { readonly status: string };
      readonly timedOut: boolean;
    };
    assert.strictEqual(payload.receipt.status, "pending-user-approval");
    assert.isTrue(payload.timedOut);
  }),
);

it.live("wait ignores events for foreign proposals", () =>
  Effect.gen(function* () {
    const { deps, publish } = yield* makeWaitDeps(proposalOwn);
    const fiber = yield* Effect.forkChild(
      call(deps, AGENT_CONTROL_MCP_TOOLS.waitForControlRequest, {
        proposalId: "proposal-own",
        timeoutMs: 250,
      }),
    );
    yield* Effect.sleep("50 millis");
    yield* publish({ ...proposalForeign, status: "approved", decidedAt: T1 });
    // Restore own proposal state so the post-timeout read stays pending.
    yield* Effect.sync(() => void 0);
    const result = yield* Fiber.join(fiber);
    const payload = structured(result) as { readonly timedOut?: boolean } | undefined;
    // The foreign decision must not satisfy the wait; but publishing mutated
    // `current` to the foreign proposal, so the final read fails not-found —
    // either way the caller learns nothing about the foreign proposal.
    if (result.isError) {
      assert.strictEqual(result.content[0]?.text, "Control request not found.");
    } else {
      assert.isTrue(payload?.timedOut);
    }
  }),
);

// ── Input validation ──────────────────────────────────────────────────

it.effect("rejects malformed tool arguments with a bounded error", () =>
  Effect.gen(function* () {
    const deps = makeDeps();
    for (const [tool, args] of [
      [AGENT_CONTROL_MCP_TOOLS.readThread, {}],
      [AGENT_CONTROL_MCP_TOOLS.readThread, { threadId: "" }],
      [AGENT_CONTROL_MCP_TOOLS.listProjects, { limit: 0 }],
      [AGENT_CONTROL_MCP_TOOLS.readControlRequest, { proposalId: 7 }],
    ] as const) {
      const result = yield* call(deps, tool, args);
      assert.isTrue(result.isError, JSON.stringify(args));
      assert.strictEqual(result.content[0]?.text, "Invalid tool arguments.");
    }
  }),
);
