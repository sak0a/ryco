import type { EnvironmentId, ThreadId } from "@ryco/contracts";

import type { DeviceRpcClient } from "../../rpc/deviceRpcClient.ts";
import { useDeviceStateStore } from "./store.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error);
}

export interface DeviceConnectionBinding {
  readonly refreshInventory: () => Promise<void>;
  readonly refreshThread: (threadId: ThreadId) => Promise<void>;
  readonly reconnecting: () => void;
  readonly dispose: () => void;
}

/**
 * Owns one environment's event generation. Async responses and stream events
 * carry the generation captured at request time, so a replaced connection can
 * never publish state into the new environment session.
 */
export function bindDeviceConnection(
  environmentId: EnvironmentId,
  client: DeviceRpcClient,
): DeviceConnectionBinding {
  let active = true;
  let generation = useDeviceStateStore.getState().beginConnection(environmentId);
  const store = () => useDeviceStateStore.getState();

  const refreshInventory = async () => {
    const requestGeneration = generation;
    try {
      const result = await client.list({ includeShutdown: true });
      if (!active) return;
      store().applyInventory(environmentId, requestGeneration, result.devices, result.availability);
    } catch (error) {
      if (!active) return;
      store().markConnectionError(environmentId, requestGeneration, errorMessage(error));
    }
  };

  const refreshThread = async (threadId: ThreadId) => {
    const requestGeneration = generation;
    try {
      const snapshot = await client.getThreadState({ threadId });
      if (!active) return;
      store().applyThreadSnapshot(environmentId, requestGeneration, snapshot);
    } catch (error) {
      if (!active) return;
      store().markConnectionError(environmentId, requestGeneration, errorMessage(error));
    }
  };

  const unsubscribe = client.onEvent(
    (event) => {
      if (active) store().applyEvent(environmentId, generation, event);
    },
    {
      onResubscribe: () => {
        if (!active) return;
        generation = store().beginConnection(environmentId);
        void refreshInventory();
      },
      onError: () => {
        if (active) {
          store().markConnectionError(
            environmentId,
            generation,
            "Simulator event stream disconnected.",
          );
        }
      },
    },
  );
  void refreshInventory();

  return {
    refreshInventory,
    refreshThread,
    reconnecting: () => {
      if (!active) return;
      generation = store().beginConnection(environmentId);
    },
    dispose: () => {
      if (!active) return;
      active = false;
      unsubscribe();
      store().clearEnvironment(environmentId, generation);
    },
  };
}
