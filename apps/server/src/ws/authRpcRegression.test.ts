import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import {
  AuthSessionId,
  CommandId,
  ORCHESTRATION_WS_METHODS,
  ThreadId,
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  WS_METHODS,
} from "@ryco/contracts";

import { ServerConfig } from "../config.ts";
import type { AuthenticatedSession } from "../auth/Services/ServerAuth.ts";
import { authorizeWsRpc, type WsRpcAccess } from "../auth/wsAuthorization.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import type { SourceControlProviderShape } from "../sourceControl/SourceControlProvider.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionWorktreeRepository,
  type ProjectionWorktreeRepositoryShape,
} from "../persistence/Services/ProjectionWorktrees.ts";
import {
  SourceControlProviderRegistry,
  type SourceControlProviderRegistryShape,
} from "../sourceControl/SourceControlProviderRegistry.ts";
import type { WsRpcContext } from "./context.ts";
import { makeOrchestrationHandlers } from "./orchestrationRpc.ts";
import { makeSourceControlHandlers } from "./sourceControlRpc.ts";

const normalizationLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "ryco-ws-auth-rpc-test-" }),
  WorkspacePathsLive,
).pipe(Layer.provideMerge(NodeServices.layer));

const sourceControlHandlerLayer = Layer.mergeAll(
  Layer.succeed(OrchestrationEngineService, {} as OrchestrationEngineShape),
  Layer.succeed(ProjectionWorktreeRepository, {} as ProjectionWorktreeRepositoryShape),
  Layer.succeed(SourceControlProviderRegistry, {} as SourceControlProviderRegistryShape),
);

const makeSession = (role: AuthenticatedSession["role"]): AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${role}`),
  subject: role,
  method: "browser-session-cookie",
  role,
});

const makeAccessGuards = (role: AuthenticatedSession["role"]) => {
  const session = makeSession(role);

  const withAccess = <A, E, R>(
    access: WsRpcAccess,
    method: string,
    effect: Effect.Effect<A, E, R>,
  ) => authorizeWsRpc(session, access, method).pipe(Effect.flatMap(() => effect));

  const ownerEffect = <A, E, R>(method: string, effect: Effect.Effect<A, E, R>) =>
    withAccess("owner", method, effect);

  return { ownerEffect, withAccess };
};

const dispatchCommand: ClientOrchestrationCommand = {
  type: "thread.manual-position.set",
  commandId: CommandId.make("cmd-dispatch"),
  threadId: ThreadId.make("thread-dispatch"),
  position: 10,
  changedAt: "2026-01-01T00:00:00.000Z",
};

const makeOrchestrationContext = (role: AuthenticatedSession["role"]) => {
  const dispatched: OrchestrationCommand[] = [];
  const ctx = {
    ...makeAccessGuards(role),
    dispatchNormalizedCommand: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: 7 };
      }),
    projectionSnapshotQuery: {
      getThreadShellById: () => Effect.succeed(Option.none()),
    },
    terminalManager: {
      close: () => Effect.void,
    },
  } as unknown as WsRpcContext;

  return { ctx, dispatched };
};

it.effect("allows owner sessions to dispatch orchestration commands", () =>
  Effect.gen(function* () {
    const { ctx, dispatched } = makeOrchestrationContext("owner");
    const handlers = makeOrchestrationHandlers(ctx);
    const result = yield* handlers[ORCHESTRATION_WS_METHODS.dispatchCommand](dispatchCommand).pipe(
      Effect.provide(normalizationLayer),
    );

    expect(result).toEqual({ sequence: 7 });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("thread.manual-position.set");
  }),
);

it.effect("rejects client sessions from orchestration dispatch", () =>
  Effect.gen(function* () {
    const { ctx, dispatched } = makeOrchestrationContext("client");
    const handlers = makeOrchestrationHandlers(ctx);
    const error = yield* Effect.flip(
      handlers[ORCHESTRATION_WS_METHODS.dispatchCommand](dispatchCommand).pipe(
        Effect.provide(normalizationLayer),
      ),
    );

    if (error._tag !== "AuthRpcError") {
      throw new Error(`Expected AuthRpcError, received ${error._tag}`);
    }
    expect(error.status).toBe(403);
    expect(error.message).toBe("Only owner sessions can call orchestration.dispatchCommand.");
    expect(dispatched).toHaveLength(0);
  }),
);

const makeSourceControlContext = (role: AuthenticatedSession["role"]) => {
  let resolveCalls = 0;
  let refreshCalls = 0;
  let listCalls = 0;
  const provider = {
    kind: "github",
    listChangeRequests: (input) =>
      Effect.sync(() => {
        listCalls += 1;
        expect(input).toEqual({
          cwd: "/tmp/project",
          headSelector: "",
          state: "open",
          limit: 5,
        });
        return [];
      }),
    searchChangeRequests: () => Effect.die("searchChangeRequests should not be called"),
  } satisfies Pick<
    SourceControlProviderShape,
    "kind" | "listChangeRequests" | "searchChangeRequests"
  >;

  const ctx = {
    ...makeAccessGuards(role),
    sourceControlRegistry: {
      resolve: () =>
        Effect.sync(() => {
          resolveCalls += 1;
          return provider as unknown as SourceControlProviderShape;
        }),
    },
    refreshLinkedWorktreeSourceControlStates: () =>
      Effect.sync(() => {
        refreshCalls += 1;
      }),
  } as unknown as WsRpcContext;

  return {
    ctx,
    getState: () => ({ listCalls, refreshCalls, resolveCalls }),
  };
};

it.effect("allows owner sessions to list source-control change requests", () =>
  Effect.gen(function* () {
    const { ctx, getState } = makeSourceControlContext("owner");
    const handlers = makeSourceControlHandlers(ctx);
    const result = yield* handlers[WS_METHODS.sourceControlListChangeRequests]({
      cwd: "/tmp/project",
      state: "open",
      limit: 5,
    }).pipe(Effect.provide(sourceControlHandlerLayer));

    expect(result).toEqual([]);
    expect(getState()).toEqual({ listCalls: 1, refreshCalls: 1, resolveCalls: 1 });
  }),
);

it.effect("rejects client sessions from source-control change-request listing", () =>
  Effect.gen(function* () {
    const { ctx, getState } = makeSourceControlContext("client");
    const handlers = makeSourceControlHandlers(ctx);
    const error = yield* Effect.flip(
      handlers[WS_METHODS.sourceControlListChangeRequests]({
        cwd: "/tmp/project",
        state: "open",
        limit: 5,
      }).pipe(Effect.provide(sourceControlHandlerLayer)),
    );

    if (error._tag !== "AuthRpcError") {
      throw new Error(`Expected AuthRpcError, received ${error._tag}`);
    }
    expect(error.status).toBe(403);
    expect(error.message).toBe("Only owner sessions can call sourceControl.listChangeRequests.");
    expect(getState()).toEqual({ listCalls: 0, refreshCalls: 0, resolveCalls: 0 });
  }),
);
