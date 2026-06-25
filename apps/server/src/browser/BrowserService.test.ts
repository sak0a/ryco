import {
  BrowserCommandId,
  BrowserServiceError,
  BrowserTabId,
  ProjectId,
  ThreadId,
  type BrowserCommandResult,
  type BrowserHostCommand,
  type BrowserSessionSnapshot,
} from "@ryco/contracts";
import { Effect, Exit, Layer, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { makeTestServerConfig } from "../test/serverConfigFixtures.ts";
import { BrowserHostRegistry, type BrowserHostRegistryShape } from "./BrowserHostRegistry.ts";
import { BrowserPolicy, type BrowserPolicyShape } from "./BrowserPolicy.ts";
import { BrowserService, BrowserServiceLive } from "./BrowserService.ts";

const now = "2026-06-24T10:00:00.000Z";
type BrowserCommandSuccessPayload = Extract<BrowserCommandResult, { ok: true }>["result"];

function makeRegistryLayer(
  commands: Array<BrowserHostCommand> = [],
  resultForCommand?: (command: BrowserHostCommand) => BrowserCommandSuccessPayload | undefined,
) {
  const registry = {
    register: () => Effect.die("register not implemented in BrowserService tests"),
    heartbeat: () => Effect.void,
    disconnect: () => Effect.void,
    snapshot: Effect.succeed({ host: null, sessions: [] }),
    sendCommand: ({ command }) =>
      Effect.sync(() => {
        commands.push(command);
        const result =
          resultForCommand?.(command) ??
          (command.kind === "open_session"
            ? {
                session: {
                  ...command.session,
                  status: "ready" as const,
                  updatedAt: now,
                },
              }
            : {});

        return {
          ok: true,
          commandId: BrowserCommandId.make(`browser-command:test-${commands.length}`),
          result,
        } satisfies BrowserCommandResult;
      }),
    completeCommand: () => Effect.void,
    publishHostEvent: () => Effect.void,
    commandStream: () => Stream.empty,
    eventStream: Stream.empty,
  } satisfies BrowserHostRegistryShape;

  return Layer.succeed(BrowserHostRegistry, registry);
}

const allowPolicyLayer = Layer.succeed(BrowserPolicy, {
  decideNavigation: ({ rawUrl }) =>
    Effect.succeed({
      url: rawUrl,
      origin: rawUrl.startsWith("http") ? new URL(rawUrl).origin : null,
      decision: { decision: "allow" as const },
    }),
} satisfies BrowserPolicyShape);

const denyPolicyLayer = Layer.succeed(BrowserPolicy, {
  decideNavigation: ({ rawUrl }) =>
    Effect.succeed({
      url: rawUrl,
      origin: "https://denied.example",
      decision: { decision: "deny" as const, reason: "blocked by test policy" },
    }),
} satisfies BrowserPolicyShape);

function makeServiceLayer(input?: {
  readonly commands?: Array<BrowserHostCommand>;
  readonly resultForCommand?: (
    command: BrowserHostCommand,
  ) => BrowserCommandSuccessPayload | undefined;
  readonly policy?: Layer.Layer<BrowserPolicy>;
  readonly mode?: "desktop" | "web";
}) {
  return BrowserServiceLive.pipe(
    Layer.provide(makeRegistryLayer(input?.commands, input?.resultForCommand)),
    Layer.provide(input?.policy ?? allowPolicyLayer),
    Layer.provide(
      Layer.succeed(ServerConfig, makeTestServerConfig({ mode: input?.mode ?? "desktop" })),
    ),
  );
}

const findFailure = (exit: Exit.Exit<unknown, unknown>) =>
  exit._tag === "Failure" ? exit.cause.reasons.find((reason) => reason._tag === "Fail") : undefined;

function latestReadySession(commands: ReadonlyArray<BrowserHostCommand>): BrowserSessionSnapshot {
  const open = commands.find(
    (command): command is Extract<BrowserHostCommand, { kind: "open_session" }> =>
      command.kind === "open_session",
  );
  if (!open) throw new Error("Expected open_session command.");
  return {
    ...open.session,
    status: "ready",
    updatedAt: now,
  };
}

describe("BrowserService", () => {
  it("keeps browser sessions desktop-local", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        return yield* service.openSession({
          threadId: ThreadId.make("thread-remote"),
        });
      }).pipe(Effect.provide(makeServiceLayer({ mode: "web" }))),
    );

    const failure = findFailure(exit);
    expect(failure?.error).toBeInstanceOf(BrowserServiceError);
    expect(failure?.error).toMatchObject({ code: "unsupported_capability" });
  });

  it("locks persistent project profiles to one active thread session", async () => {
    const commands: Array<BrowserHostCommand> = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        const first = yield* service.openSession({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          profileMode: "project",
        });
        const second = yield* Effect.exit(
          service.openSession({
            threadId: ThreadId.make("thread-2"),
            projectId: ProjectId.make("project-1"),
            profileMode: "project",
          }),
        );
        return { first, second };
      }).pipe(Effect.provide(makeServiceLayer({ commands }))),
    );

    expect(result.first.status).toBe("ready");
    expect(commands).toHaveLength(1);
    const failure = findFailure(result.second);
    expect(failure?.error).toBeInstanceOf(BrowserServiceError);
    expect(failure?.error).toMatchObject({ code: "profile_locked" });
  });

  it("does not queue navigation commands denied by policy", async () => {
    const commands: Array<BrowserHostCommand> = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        const session = yield* service.openSession({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
        });
        const beforeNavigateCommands = commands.length;
        const denied = yield* Effect.exit(
          service.navigate({
            sessionId: session.sessionId,
            url: "https://denied.example/",
          }),
        );
        return { denied, beforeNavigateCommands, afterNavigateCommands: commands.length };
      }).pipe(Effect.provide(makeServiceLayer({ commands, policy: denyPolicyLayer }))),
    );

    expect(result.beforeNavigateCommands).toBe(1);
    expect(result.afterNavigateCommands).toBe(1);
    const failure = findFailure(result.denied);
    expect(failure?.error).toMatchObject({ code: "origin_denied", retryable: false });
  });

  it("does not open browser sessions with initial URLs denied by policy", async () => {
    const commands: Array<BrowserHostCommand> = [];
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        return yield* service.openSession({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          initialUrl: "https://denied.example/",
        });
      }).pipe(Effect.provide(makeServiceLayer({ commands, policy: denyPolicyLayer }))),
    );

    expect(commands).toHaveLength(0);
    const failure = findFailure(result);
    expect(failure?.error).toBeInstanceOf(BrowserServiceError);
    expect(failure?.error).toMatchObject({ code: "origin_denied", retryable: false });
  });

  it("dispatches storage inspection through the browser host", async () => {
    const commands: Array<BrowserHostCommand> = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        const session = yield* service.openSession({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
        });
        const inspection = yield* service.inspectStorage({ sessionId: session.sessionId });
        return { session, inspection };
      }).pipe(
        Effect.provide(
          makeServiceLayer({
            commands,
            resultForCommand: (command) => {
              if (command.kind !== "inspect_storage") return undefined;
              const session = latestReadySession(commands);
              return {
                storageInspection: {
                  session,
                  tabId: command.tabId,
                  profileId: session.profileId,
                  url: "https://example.test/",
                  origin: "https://example.test",
                  cookies: [],
                  localStorage: [{ key: "theme", valueBytes: 4 }],
                  sessionStorage: [],
                  cookieCounts: { currentOrigin: 0, profile: 2 },
                  inspectedAt: now,
                },
              };
            },
          }),
        ),
      ),
    );

    expect(result.inspection.cookieCounts.profile).toBe(2);
    expect(commands.map((command) => command.kind)).toEqual(["open_session", "inspect_storage"]);
    expect(commands[1]).toMatchObject({
      kind: "inspect_storage",
      sessionId: result.session.sessionId,
      tabId: result.session.selectedTabId,
    });
  });

  it("dispatches scoped storage clear through the browser host", async () => {
    const commands: Array<BrowserHostCommand> = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        const session = yield* service.openSession({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
        });
        const clear = yield* service.clearStorage({
          sessionId: session.sessionId,
          scope: "profile",
          dataTypes: ["cookies", "localStorage", "httpCache"],
        });
        return { clear, session };
      }).pipe(
        Effect.provide(
          makeServiceLayer({
            commands,
            resultForCommand: (command) => {
              if (command.kind !== "clear_storage") return undefined;
              return {
                storageClear: {
                  session: latestReadySession(commands),
                  scope: command.scope,
                  origin: null,
                  clearedDataTypes: command.dataTypes,
                  clearedAt: now,
                },
              };
            },
          }),
        ),
      ),
    );

    expect(result.clear.clearedDataTypes).toEqual(["cookies", "localStorage", "httpCache"]);
    expect(commands[1]).toMatchObject({
      kind: "clear_storage",
      scope: "profile",
      dataTypes: ["cookies", "localStorage", "httpCache"],
      tabId: result.session.selectedTabId,
    });
  });

  it("dispatches individual cookie deletion through the browser host", async () => {
    const commands: Array<BrowserHostCommand> = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        const session = yield* service.openSession({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
        });
        const deleted = yield* service.deleteCookie({
          sessionId: session.sessionId,
          name: "sid",
          domain: ".example.test",
          path: "/app",
          secure: true,
        });
        return { deleted, session };
      }).pipe(
        Effect.provide(
          makeServiceLayer({
            commands,
            resultForCommand: (command) => {
              if (command.kind !== "delete_cookie") return undefined;
              return {
                cookieDelete: {
                  session: latestReadySession(commands),
                  deleted: true,
                  cookie: {
                    name: command.name,
                    domain: command.domain,
                    path: command.path,
                    secure: command.secure,
                  },
                  deletedAt: now,
                },
              };
            },
          }),
        ),
      ),
    );

    expect(result.deleted.deleted).toBe(true);
    expect(commands[1]).toMatchObject({
      kind: "delete_cookie",
      name: "sid",
      domain: ".example.test",
      path: "/app",
      secure: true,
      tabId: result.session.selectedTabId,
    });
  });

  it("does not queue storage commands for missing tabs", async () => {
    const commands: Array<BrowserHostCommand> = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        const session = yield* service.openSession({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
        });
        const beforeInspectCommands = commands.length;
        const failed = yield* Effect.exit(
          service.inspectStorage({
            sessionId: session.sessionId,
            tabId: BrowserTabId.make("browser-tab:missing"),
          }),
        );
        return { failed, beforeInspectCommands, afterInspectCommands: commands.length };
      }).pipe(Effect.provide(makeServiceLayer({ commands }))),
    );

    expect(result.beforeInspectCommands).toBe(1);
    expect(result.afterInspectCommands).toBe(1);
    const failure = findFailure(result.failed);
    expect(failure?.error).toBeInstanceOf(BrowserServiceError);
    expect(failure?.error).toMatchObject({ code: "tab_not_found" });
  });
});
