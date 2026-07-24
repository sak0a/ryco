import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import {
  createEnvironmentConnection,
  createEnvironmentConnectionSupervisor,
  SavedEnvironmentConnectionCancelledError,
  type EnvironmentConnection,
  type EnvironmentConnectionSupervisor,
  type EnvironmentStateSink,
  type PushSequenceMonitor,
  type SavedEnvironmentRecord,
  type SavedEnvironmentRuntimeState,
} from "@ryco/client-runtime/connection";
import { createKnownEnvironment } from "@ryco/client-runtime/knownEnvironment";
import { scopeThreadRef } from "@ryco/client-runtime/scoped";

import { createWsRpcClient, type WsRpcClient } from "../rpc/wsRpcClient";
import { WsTransport } from "../rpc/wsTransport";
import {
  selectSidebarThreadSummaryByRef,
  selectThreadByRef,
  useStore,
} from "../state/threadsRuntime";
import { subscribeAppStateResume } from "./appStateResume";
import { createMobileEnvironmentStateSink } from "./environmentStateSink";
import type { MobileRemoteEnvironmentApi } from "./remoteApi";

// §4 stub closure: the supervisor evicts idle thread-detail subscriptions; a
// subscription is non-idle while the thread has pending approvals/user-input, an
// actionable proposed plan, a non-idle orchestration status, a running latest
// turn, or a pending source proposed plan. Straight port of the web predicate
// (apps/web/src/environments/runtime/service.ts:231-277) over runtime-A selectors.
export function isThreadDetailSubscriptionNonIdle(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): boolean {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const state = useStore.getState();
  const sidebarThread = selectSidebarThreadSummaryByRef(state, threadRef);

  if (sidebarThread) {
    if (
      sidebarThread.hasPendingApprovals ||
      sidebarThread.hasPendingUserInput ||
      sidebarThread.hasActionableProposedPlan
    ) {
      return true;
    }
    const orchestrationStatus = sidebarThread.session?.orchestrationStatus;
    if (orchestrationStatus && orchestrationStatus !== "idle" && orchestrationStatus !== "stopped") {
      return true;
    }
    if (sidebarThread.latestTurn?.state === "running") {
      return true;
    }
  }

  const thread = selectThreadByRef(state, threadRef);
  if (!thread) return false;

  const orchestrationStatus = thread.session?.orchestrationStatus;
  return (
    Boolean(
      orchestrationStatus && orchestrationStatus !== "idle" && orchestrationStatus !== "stopped",
    ) ||
    thread.latestTurn?.state === "running" ||
    thread.pendingSourceProposedPlan !== undefined
  );
}

// Bound wrappers for every injected timer/lifecycle seam (the slice-3b lesson:
// unbound globals throw "Illegal invocation").
const boundNow = (): number => Date.now();
const boundSetTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> =>
  globalThis.setTimeout(callback, delayMs);
const boundClearTimeout = (timeoutId: ReturnType<typeof setTimeout>): void =>
  globalThis.clearTimeout(timeoutId);

// The push-sequence monitor is diagnostics-only; B1 has no monitor UI.
const noopPushSequenceMonitor: PushSequenceMonitor = {
  recordEvent: () => undefined,
  recordSnapshot: () => undefined,
};

// B1 has no provider caches to invalidate, so the throttle is inert.
function createNoopThrottle() {
  return { maybeExecute: () => undefined, cancel: () => undefined };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** The catalog surface the driver needs (the mobile saved-environment catalog). */
export interface MobileCatalogLike {
  readonly registryStore: {
    readonly subscribe: (listener: () => void) => () => void;
    readonly getState: () => {
      readonly markConnected: (environmentId: EnvironmentId, connectedAt: string) => void;
    };
  };
  readonly runtimeStore: {
    readonly getState: () => {
      readonly ensure: (environmentId: EnvironmentId) => void;
      readonly patch: (
        environmentId: EnvironmentId,
        patch: Partial<SavedEnvironmentRuntimeState>,
      ) => void;
    };
  };
  readonly hasHydrated: () => boolean;
  readonly waitForHydration: () => Promise<void>;
  readonly list: () => ReadonlyArray<SavedEnvironmentRecord>;
  readonly get: (environmentId: EnvironmentId) => SavedEnvironmentRecord | null;
  readonly readBearerToken: (environmentId: EnvironmentId) => Promise<string | null>;
}

export interface MobileEnvironmentDriverDeps {
  readonly catalog: MobileCatalogLike;
  readonly remoteApi: Pick<MobileRemoteEnvironmentApi, "resolveRemoteWebSocketConnectionUrl">;
  readonly stateSink?: EnvironmentStateSink;
  readonly subscribeResume?: (listener: (reason: string) => void) => () => void;
  /**
   * Overrides the real saved-environment connect (which opens a live socket) —
   * used only by headless tests to drive the supervisor without a real WebSocket.
   */
  readonly connectSavedEnvironment?: (
    record: SavedEnvironmentRecord,
    isCancelled: () => boolean,
  ) => Promise<EnvironmentConnection>;
}

export interface MobileEnvironmentDriver {
  readonly supervisor: EnvironmentConnectionSupervisor;
  readonly start: () => () => void;
  readonly connectSavedEnvironment: (
    record: SavedEnvironmentRecord,
    isCancelled?: () => boolean,
  ) => Promise<EnvironmentConnection>;
}

/**
 * Wires the shared `createEnvironmentConnectionSupervisor` factory (no forked
 * runtime logic) to the mobile adapters/stores, modeled on the web
 * environments/runtime/service.ts. On a paired environment the supervisor opens
 * the live WsTransport with the ws-token, subscribes the shell stream (which
 * flows into `state/threads` via the sink), and reconnects on AppState resume.
 * Fully injectable so a headless test can drive it with fakes.
 */
export function createMobileEnvironmentDriver(
  deps: MobileEnvironmentDriverDeps,
): MobileEnvironmentDriver {
  const stateSink = deps.stateSink ?? createMobileEnvironmentStateSink();
  const subscribeResume = deps.subscribeResume ?? subscribeAppStateResume;
  const { catalog, remoteApi } = deps;

  // Assigned immediately below; the input closures only read it once the
  // supervisor is running, so the forward reference is safe.
  let supervisor: EnvironmentConnectionSupervisor;
  const getSupervisor = () => supervisor;

  const patchRuntime = (
    environmentId: EnvironmentId,
    patch: Partial<SavedEnvironmentRuntimeState>,
  ) => catalog.runtimeStore.getState().patch(environmentId, patch);

  const setRuntimeConnecting = (environmentId: EnvironmentId) =>
    patchRuntime(environmentId, {
      connectionState: "connecting",
      lastError: null,
      lastErrorAt: null,
    });
  const setRuntimeConnected = (environmentId: EnvironmentId) => {
    const connectedAt = nowIso();
    patchRuntime(environmentId, {
      connectionState: "connected",
      authState: "authenticated",
      connectedAt,
      disconnectedAt: null,
      lastError: null,
      lastErrorAt: null,
    });
    catalog.registryStore.getState().markConnected(environmentId, connectedAt);
  };
  const setRuntimeDisconnected = (environmentId: EnvironmentId, reason: string | null) =>
    patchRuntime(environmentId, {
      connectionState: "disconnected",
      disconnectedAt: nowIso(),
      ...(reason && reason.trim().length > 0 ? { lastError: reason, lastErrorAt: nowIso() } : {}),
    });
  const setRuntimeError = (environmentId: EnvironmentId, error: unknown) =>
    patchRuntime(environmentId, {
      connectionState: "error",
      lastError: error instanceof Error ? error.message : String(error),
      lastErrorAt: nowIso(),
    });

  function createSavedEnvironmentClient(
    environmentId: EnvironmentId,
    bearerToken: string,
  ): WsRpcClient {
    catalog.runtimeStore.getState().ensure(environmentId);
    return createWsRpcClient(
      new WsTransport(
        async () => {
          const record = catalog.get(environmentId);
          if (!record) throw new Error(`Saved environment ${environmentId} not found.`);
          return remoteApi.resolveRemoteWebSocketConnectionUrl({
            wsBaseUrl: record.wsBaseUrl,
            httpBaseUrl: record.httpBaseUrl,
            bearerToken,
          });
        },
        {
          getConnectionLabel: () => catalog.get(environmentId)?.label ?? null,
          onAttempt: () => setRuntimeConnecting(environmentId),
          onOpen: () => setRuntimeConnected(environmentId),
          onError: (message) => setRuntimeError(environmentId, new Error(message)),
          onClose: (details, context) => {
            if (!context.intentional) setRuntimeDisconnected(environmentId, details.reason);
          },
        },
      ),
    );
  }

  async function connectSavedEnvironment(
    record: SavedEnvironmentRecord,
    isCancelled: () => boolean = () => false,
  ): Promise<EnvironmentConnection> {
    const bearerToken = await catalog.readBearerToken(record.environmentId);
    if (!bearerToken) {
      patchRuntime(record.environmentId, {
        authState: "requires-auth",
        connectionState: "disconnected",
        lastError: "Saved environment is missing its saved credential. Pair it again.",
        lastErrorAt: nowIso(),
      });
      throw new Error("Saved environment is missing its saved credential.");
    }

    const client = createSavedEnvironmentClient(record.environmentId, bearerToken);
    const knownEnvironment = createKnownEnvironment({
      id: record.environmentId,
      label: record.label,
      source: "manual",
      target: { httpBaseUrl: record.httpBaseUrl, wsBaseUrl: record.wsBaseUrl },
    });
    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: { ...knownEnvironment, environmentId: record.environmentId },
      client,
      pushSequenceMonitor: noopPushSequenceMonitor,
      applyShellEvent: (event, environmentId) =>
        getSupervisor().applyShellEvent(event, environmentId),
      syncShellSnapshot: (snapshot, environmentId) =>
        getSupervisor().syncShellSnapshot(snapshot, environmentId),
      // Terminal streaming is deferred to v1.1.
      applyTerminalEvent: () => undefined,
    });

    try {
      if (isCancelled()) {
        await connection.dispose().catch(() => undefined);
        throw new SavedEnvironmentConnectionCancelledError(record.environmentId);
      }
      getSupervisor().register(connection);
      return connection;
    } catch (error) {
      if (!(error instanceof SavedEnvironmentConnectionCancelledError)) {
        setRuntimeError(record.environmentId, error);
        await connection.dispose().catch(() => undefined);
      }
      throw error;
    }
  }

  supervisor = createEnvironmentConnectionSupervisor<SavedEnvironmentRecord>({
    isHostedMode: () => false,
    now: boundNow,
    setTimeout: boundSetTimeout,
    clearTimeout: boundClearTimeout,
    createInvalidationThrottle: createNoopThrottle,
    resetProviderInvalidation: () => undefined,
    // Mobile has no window-origin/primary environment; direct-node uses saved
    // environments only.
    createPrimaryConnection: () => null,
    listSavedEnvironmentRecords: () => catalog.list(),
    hasSavedEnvironmentRegistryHydrated: () => catalog.hasHydrated(),
    waitForSavedEnvironmentRegistryHydration: () => catalog.waitForHydration(),
    subscribeSavedEnvironmentRegistry: (listener) => catalog.registryStore.subscribe(listener),
    connectSavedEnvironment: (record, isCancelled) =>
      (deps.connectSavedEnvironment ?? connectSavedEnvironment)(record, isCancelled),
    disconnectSavedEnvironment: async (environmentId) => {
      await getSupervisor().remove(environmentId);
    },
    waitForPrimaryShellSnapshotApplied: () => Promise.resolve(),
    subscribeBrowserResume: (listener) => subscribeResume(listener),
    isThreadDetailSubscriptionNonIdle,
    syncThreadDetailSnapshot: (environmentId, snapshot) =>
      useStore
        .getState()
        .syncServerThreadDetail((snapshot as { readonly thread: never }).thread, environmentId),
    applyThreadDetailEvent: () => undefined,
    stateSink,
    onShellSnapshotReceived: () => undefined,
    onShellSnapshotCurrent: () => undefined,
    onShellSnapshotApplied: () => undefined,
    onShellSnapshotReady: () => undefined,
  });

  return {
    supervisor,
    start: () => supervisor.start(),
    connectSavedEnvironment,
  };
}
