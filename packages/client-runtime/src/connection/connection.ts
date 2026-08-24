import type {
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  ServerConfig,
  ServerLifecycleWelcomePayload,
  TerminalEvent,
} from "@ryco/contracts";

import type { KnownEnvironment } from "../knownEnvironment.ts";
import type { WsRpcClient } from "../rpc/index.ts";
import { clearWsConnectionStatusForEnvironment } from "../rpc/wsConnectionState.ts";
import { bindDeviceConnection } from "../state/device/runtime.ts";

export interface PushSequenceMonitor {
  readonly recordEvent: (environmentId: EnvironmentId, sequence: number) => void;
  readonly recordSnapshot: (environmentId: EnvironmentId, sequence: number) => void;
}

export interface EnvironmentConnection {
  readonly kind: "primary" | "saved";
  readonly environmentId: EnvironmentId;
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly ensureBootstrapped: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

export interface OrchestrationHandlers {
  /**
   * Forget the previous stream's sequence baseline before accepting the first
   * authoritative snapshot from a replacement subscription. Node processes
   * may restart their in-memory projection sequence at a lower value.
   */
  readonly resetShellProjection: (environmentId: EnvironmentId) => void;
  readonly applyShellEvent: (
    event: OrchestrationShellStreamEvent,
    environmentId: EnvironmentId,
  ) => void;
  readonly syncShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  readonly applyTerminalEvent: (event: TerminalEvent, environmentId: EnvironmentId) => void;
}

export interface EnvironmentConnectionInput extends OrchestrationHandlers {
  readonly kind: "primary" | "saved";
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly pushSequenceMonitor: PushSequenceMonitor;
  readonly refreshMetadata?: () => Promise<void>;
  readonly onConfigSnapshot?: (config: ServerConfig) => void;
  readonly onWelcome?: (payload: ServerLifecycleWelcomePayload) => void;
  readonly onResubscribe?: (environmentId: EnvironmentId) => void;
  readonly onShellError?: (environmentId: EnvironmentId) => void;
}

function createBootstrapGate() {
  let resolve: (() => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;
  const createPendingPromise = () => {
    const pending = new Promise<void>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    // A push subscription can fail before a caller starts waiting for the
    // initial shell snapshot. Mark that early rejection as observed so native
    // development clients do not surface an uncaught-promise overlay. Returning
    // the original promise from `wait` still preserves the rejection for every
    // caller that needs to react to the failed bootstrap.
    void pending.catch(() => undefined);
    return pending;
  };
  let promise = createPendingPromise();

  return {
    wait: () => promise,
    resolve: () => {
      resolve?.();
      resolve = null;
      reject = null;
    },
    reject: (error: unknown) => {
      reject?.(error);
      resolve = null;
      reject = null;
    },
    reset: () => {
      promise = createPendingPromise();
    },
  };
}

export function createEnvironmentConnection(
  input: EnvironmentConnectionInput,
): EnvironmentConnection {
  const environmentId = input.knownEnvironment.environmentId;
  if (!environmentId) {
    throw new Error(
      `Known environment ${input.knownEnvironment.label} is missing its environmentId.`,
    );
  }

  let disposed = false;
  const bootstrapGate = createBootstrapGate();
  const shouldObserveLifecycle = input.kind === "saved" || input.onWelcome !== undefined;
  const shouldObserveConfig = input.kind === "saved" || input.onConfigSnapshot !== undefined;
  const observeEnvironmentIdentity = (nextEnvironmentId: EnvironmentId, source: string) => {
    if (environmentId !== nextEnvironmentId) {
      throw new Error(
        `Environment connection ${environmentId} changed identity to ${nextEnvironmentId} via ${source}.`,
      );
    }
  };

  const unsubLifecycle = shouldObserveLifecycle
    ? input.client.server.subscribeLifecycle((event) => {
        if (event.type !== "welcome") return;
        observeEnvironmentIdentity(
          event.payload.environment.environmentId,
          "server lifecycle welcome",
        );
        input.onWelcome?.(event.payload);
      })
    : () => undefined;
  const unsubConfig = shouldObserveConfig
    ? input.client.server.subscribeConfig((event) => {
        if (event.type !== "snapshot") return;
        observeEnvironmentIdentity(
          event.config.environment.environmentId,
          "server config snapshot",
        );
        input.onConfigSnapshot?.(event.config);
      })
    : () => undefined;
  const unsubShell = input.client.orchestration.subscribeShell(
    (item) => {
      if (item.kind === "snapshot") {
        input.pushSequenceMonitor.recordSnapshot(environmentId, item.snapshot.snapshotSequence);
        input.syncShellSnapshot(item.snapshot, environmentId);
        bootstrapGate.resolve();
        return;
      }
      input.pushSequenceMonitor.recordEvent(environmentId, item.sequence);
      input.applyShellEvent(item, environmentId);
    },
    {
      onResubscribe: () => {
        if (disposed) return;
        bootstrapGate.reset();
        input.resetShellProjection(environmentId);
        input.onResubscribe?.(environmentId);
      },
      onError: () => {
        if (disposed) return;
        bootstrapGate.reject(new Error("Shell snapshot synchronization failed."));
        input.onShellError?.(environmentId);
      },
    },
  );
  const unsubTerminalEvent = input.client.terminal.onEvent((event) =>
    input.applyTerminalEvent(event, environmentId),
  );
  const deviceBinding = input.client.device
    ? bindDeviceConnection(environmentId, input.client.device)
    : null;
  const cleanup = () => {
    disposed = true;
    unsubShell();
    unsubTerminalEvent();
    unsubLifecycle();
    unsubConfig();
    deviceBinding?.dispose();
  };

  return {
    kind: input.kind,
    environmentId,
    knownEnvironment: input.knownEnvironment,
    client: input.client,
    ensureBootstrapped: () => bootstrapGate.wait(),
    reconnect: async () => {
      bootstrapGate.reset();
      deviceBinding?.reconnecting();
      try {
        await input.client.reconnect();
        await deviceBinding?.refreshInventory();
        await input.refreshMetadata?.();
        await bootstrapGate.wait();
      } catch (error) {
        bootstrapGate.reject(error);
        throw error;
      }
    },
    dispose: async () => {
      cleanup();
      await input.client.dispose();
      // The transport drops close events once a session is inactive, so a
      // disposed environment's keyed WS status would otherwise stay "connected"
      // forever (e.g. across a hub node switch). No-op for sockets that never
      // recorded per-environment status.
      clearWsConnectionStatusForEnvironment(environmentId);
    },
  };
}
