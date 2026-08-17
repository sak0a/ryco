import {
  AGENT_CONTROL_CAPABILITIES,
  ApprovalRequestId,
  CodexSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  type ProviderApprovalDecision,
  type ProviderEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
} from "@ryco/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Redacted,
  Schema,
  Scope,
  Stream,
} from "effect";
import * as CodexErrors from "effect-codex-app-server/errors";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type {
  AgentControlIssuedLease,
  IssueAgentControlLeaseInput,
} from "../../agentControl/Services/AgentControlSessionRegistry.ts";
import type { CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  buildAgentControlThreadConfig,
  CODEX_AGENT_CONTROL_SERVER_NAME,
  type CodexSessionRuntimeOptions,
  type CodexSessionRuntimeSendTurnInput,
  type CodexSessionRuntimeShape,
  type CodexThreadSnapshot,
} from "./CodexSessionRuntime.ts";
import {
  CODEX_AGENT_CONTROL_INSTRUCTIONS,
  makeCodexAdapter,
  type CodexAgentControlBridge,
} from "./CodexAdapter.ts";

class CodexAdapter extends Context.Service<CodexAdapter, CodexAdapterShape>()(
  "test/CodexAdapterAgentControl",
) {}

const RAW_TOKEN = `rycoac_${"T".repeat(43)}`;
const ENDPOINT_URL = "http://127.0.0.1:46123/mcp";
const threadId = ThreadId.make("thread-ac");
const runtimeSessionId = RuntimeSessionId.make("runtime-ac-1");

class FakeRuntime implements CodexSessionRuntimeShape {
  private readonly eventQueue = Effect.runSync(Queue.unbounded<ProviderEvent>());
  private readonly now = new Date().toISOString();
  readonly options: CodexSessionRuntimeOptions;
  readonly closeImpl = vi.fn(() => Promise.resolve(undefined));

  constructor(options: CodexSessionRuntimeOptions) {
    this.options = options;
  }

  start() {
    return Effect.promise(() => this.sessionPromise());
  }

  getSession = Effect.suspend(() => Effect.promise(() => this.sessionPromise()));

  private sessionPromise(): Promise<ProviderSession> {
    return Promise.resolve({
      provider: ProviderDriverKind.make("codex"),
      status: "ready" as const,
      runtimeMode: this.options.runtimeMode,
      threadId: this.options.threadId,
      cwd: this.options.cwd,
      createdAt: this.now,
      updatedAt: this.now,
    } satisfies ProviderSession);
  }

  sendTurn(_input: CodexSessionRuntimeSendTurnInput) {
    return Effect.succeed({
      threadId: this.options.threadId,
      turnId: TurnId.make("turn-1"),
    } satisfies ProviderTurnStartResult);
  }

  interruptTurn(_turnId?: TurnId) {
    return Effect.void;
  }

  readThread = Effect.succeed<CodexThreadSnapshot>({ threadId: "provider-thread", turns: [] });

  rollbackThread(_numTurns: number) {
    return Effect.succeed<CodexThreadSnapshot>({ threadId: "provider-thread", turns: [] });
  }

  respondToRequest(_requestId: ApprovalRequestId, _decision: ProviderApprovalDecision) {
    return Effect.void;
  }

  respondToUserInput(_requestId: ApprovalRequestId, _answers: ProviderUserInputAnswers) {
    return Effect.void;
  }

  get events() {
    return Stream.fromQueue(this.eventQueue);
  }

  close = Effect.promise(() => this.closeImpl());

  emit(event: ProviderEvent) {
    return Queue.offer(this.eventQueue, event).pipe(Effect.asVoid);
  }
}

const makeBridge = (input?: { readonly withLease?: boolean }) => {
  const issueLease = vi.fn((_input: IssueAgentControlLeaseInput) =>
    Effect.succeed(
      input?.withLease === false
        ? Option.none<AgentControlIssuedLease>()
        : Option.some<AgentControlIssuedLease>({
            sessionId: "session-ac",
            endpointUrl: ENDPOINT_URL,
            credential: Redacted.make(RAW_TOKEN),
          }),
    ),
  );
  const revokeLease = vi.fn((_input: { sessionId: string; reason: string }) => Effect.void);
  const bridge: CodexAgentControlBridge = {
    issueLease: (leaseInput) => issueLease(leaseInput),
    // Suspend so the spy counts revocation *executions*, not the eager
    // construction of the finalizer effect at registration time.
    revokeLease: (revokeInput) => Effect.suspend(() => revokeLease(revokeInput)),
  };
  return { bridge, issueLease, revokeLease };
};

const makeRuntimeFactory = (options?: { readonly failConstruction?: boolean }) => {
  const runtimes: Array<FakeRuntime> = [];
  const factory = vi.fn((runtimeOptions: CodexSessionRuntimeOptions) =>
    options?.failConstruction
      ? Effect.fail(
          new CodexErrors.CodexAppServerSpawnError({
            command: `${runtimeOptions.binaryPath} app-server`,
            cause: new Error("construction failed"),
          }),
        )
      : Effect.sync(() => {
          const runtime = new FakeRuntime(runtimeOptions);
          runtimes.push(runtime);
          return runtime;
        }),
  );
  return {
    factory,
    get lastRuntime(): FakeRuntime | undefined {
      return runtimes.at(-1);
    },
  };
};

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () => Effect.die(new Error("getProvider unused")),
  getBinding: () => Effect.succeed(Option.none()),
  listThreadIds: () => Effect.succeed([]),
  listBindings: () => Effect.succeed([]),
});

const makeAdapterLayer = (input: {
  readonly bridge: CodexAgentControlBridge;
  readonly runtimeFactory: ReturnType<typeof makeRuntimeFactory>;
  readonly environment?: NodeJS.ProcessEnv;
}) =>
  Layer.effect(
    CodexAdapter,
    Effect.gen(function* () {
      const codexConfig = Schema.decodeSync(CodexSettings)({});
      return yield* makeCodexAdapter(codexConfig, {
        makeRuntime: input.runtimeFactory.factory,
        agentControl: input.bridge,
        ...(input.environment ? { environment: input.environment } : {}),
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "codex-ac-test-" })),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  );

const startInput = {
  runtimeSessionId,
  provider: ProviderDriverKind.make("codex"),
  threadId,
  runtimeMode: "full-access",
} as const;

it.effect("injects the MCP connection into runtime options, never the environment", () =>
  Effect.gen(function* () {
    const { bridge, issueLease } = makeBridge();
    const runtimeFactory = makeRuntimeFactory();
    const environment = { PATH: "/usr/bin", HOME: "/home/user" };

    yield* Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession(startInput);

      assert.strictEqual(issueLease.mock.calls.length, 1);
      assert.deepStrictEqual(issueLease.mock.calls[0]?.[0], {
        threadId,
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeSessionId,
        capabilities: [AGENT_CONTROL_CAPABILITIES.read],
      });

      const options = runtimeFactory.lastRuntime?.options;
      assert.ok(options);
      assert.ok(options.agentControl);
      assert.strictEqual(options.agentControl.serverName, CODEX_AGENT_CONTROL_SERVER_NAME);
      assert.strictEqual(options.agentControl.endpointUrl, ENDPOINT_URL);
      assert.strictEqual(Redacted.value(options.agentControl.authorization), RAW_TOKEN);
      assert.strictEqual(options.agentControl.instructions, CODEX_AGENT_CONTROL_INSTRUCTIONS);

      // The credential must be unavailable to the codex process environment
      // (and therefore to every shell subprocess codex spawns).
      assert.notInclude(JSON.stringify(options.environment ?? {}), RAW_TOKEN);
      assert.isUndefined(
        Object.entries(options.environment ?? {}).find(([, value]) =>
          String(value).includes(RAW_TOKEN),
        ),
      );
      assert.notInclude(JSON.stringify(process.env), RAW_TOKEN);

      yield* adapter.stopSession(threadId);
    }).pipe(Effect.provide(makeAdapterLayer({ bridge, runtimeFactory, environment })));
  }),
);

it.effect("starts without Agent Control when no lease is issued", () =>
  Effect.gen(function* () {
    const { bridge, revokeLease } = makeBridge({ withLease: false });
    const runtimeFactory = makeRuntimeFactory();

    yield* Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession(startInput);
      const options = runtimeFactory.lastRuntime?.options;
      assert.ok(options);
      assert.isUndefined(options.agentControl);
      yield* adapter.stopSession(threadId);
      // Nothing to revoke: no lease existed.
      assert.strictEqual(revokeLease.mock.calls.length, 0);
    }).pipe(Effect.provide(makeAdapterLayer({ bridge, runtimeFactory })));
  }),
);

it.effect("revokes the lease on stopSession (runtime teardown)", () =>
  Effect.gen(function* () {
    const { bridge, revokeLease } = makeBridge();
    const runtimeFactory = makeRuntimeFactory();

    yield* Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession(startInput);
      assert.strictEqual(revokeLease.mock.calls.length, 0);
      yield* adapter.stopSession(threadId);
      // Eager revocation inside stopSessionInternal plus the session-scope
      // backstop finalizer both fire; both target the same unique lease id
      // (idempotent against the real registry).
      assert.isAtLeast(revokeLease.mock.calls.length, 1);
      for (const call of revokeLease.mock.calls) {
        assert.deepStrictEqual(call[0], {
          sessionId: "session-ac",
          reason: "runtime-teardown",
        });
      }
      assert.ok(runtimeFactory.lastRuntime?.closeImpl.mock.calls.length);
    }).pipe(Effect.provide(makeAdapterLayer({ bridge, runtimeFactory })));
  }),
);

it.effect("revokes the lease when runtime construction fails", () =>
  Effect.gen(function* () {
    const { bridge, revokeLease } = makeBridge();
    const runtimeFactory = makeRuntimeFactory({ failConstruction: true });

    yield* Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const exit = yield* Effect.exit(adapter.startSession(startInput));
      assert.isTrue(exit._tag === "Failure");
      assert.strictEqual(revokeLease.mock.calls.length, 1);
      assert.deepStrictEqual(revokeLease.mock.calls[0]?.[0], {
        sessionId: "session-ac",
        reason: "runtime-teardown",
      });
    }).pipe(Effect.provide(makeAdapterLayer({ bridge, runtimeFactory })));
  }),
);

it.live("revokes the lease when the codex process exits without a stop call", () =>
  Effect.gen(function* () {
    const { bridge, revokeLease } = makeBridge();
    const runtimeFactory = makeRuntimeFactory();

    yield* Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession(startInput);
      const runtime = runtimeFactory.lastRuntime;
      assert.ok(runtime);

      yield* runtime.emit({
        id: crypto.randomUUID(),
        provider: ProviderDriverKind.make("codex"),
        method: "session/exited",
        threadId,
        createdAt: new Date().toISOString(),
        payload: { message: "process exited" },
      } as unknown as ProviderEvent);

      // The event fiber consumes asynchronously; poll briefly.
      for (let attempt = 0; attempt < 100 && revokeLease.mock.calls.length === 0; attempt += 1) {
        yield* Effect.sleep("10 millis");
      }
      assert.strictEqual(revokeLease.mock.calls.length, 1);
      yield* adapter.stopSession(threadId);
    }).pipe(Effect.provide(makeAdapterLayer({ bridge, runtimeFactory })));
  }),
);

it.effect("adapter release (stopAll) revokes every active lease", () =>
  Effect.gen(function* () {
    const { bridge, revokeLease } = makeBridge();
    const runtimeFactory = makeRuntimeFactory();
    const scope = yield* Scope.make("sequential");
    const context = yield* Layer.build(makeAdapterLayer({ bridge, runtimeFactory })).pipe(
      Scope.provide(scope),
    );
    const adapter = Context.get(context, CodexAdapter);
    yield* adapter.startSession(startInput);
    assert.strictEqual(revokeLease.mock.calls.length, 0);

    yield* Scope.close(scope, Exit.void);
    assert.isAtLeast(revokeLease.mock.calls.length, 1);
    for (const call of revokeLease.mock.calls) {
      assert.deepStrictEqual(call[0], { sessionId: "session-ac", reason: "runtime-teardown" });
    }
  }),
);

it.effect("thread-start config carries the bearer inline and nothing env-backed", () =>
  Effect.sync(() => {
    const config = buildAgentControlThreadConfig({
      serverName: CODEX_AGENT_CONTROL_SERVER_NAME,
      endpointUrl: ENDPOINT_URL,
      authorization: Redacted.make(RAW_TOKEN),
      instructions: CODEX_AGENT_CONTROL_INSTRUCTIONS,
    });
    const servers = config.mcp_servers as Record<string, Record<string, unknown>>;
    const entry = servers[CODEX_AGENT_CONTROL_SERVER_NAME];
    assert.ok(entry);
    assert.strictEqual(entry.url, ENDPOINT_URL);
    assert.deepStrictEqual(entry.http_headers, { Authorization: `Bearer ${RAW_TOKEN}` });
    // Never env-var-backed: that would put the bearer into the codex
    // process env, where agent shell commands inherit it.
    assert.notProperty(entry, "bearer_token_env_var");
    assert.notProperty(entry, "env");
    assert.notProperty(entry, "env_http_headers");
  }),
);
