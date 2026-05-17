import { useEffect } from "react";
import type { DetectedServerEvent, EnvironmentId, ThreadId } from "@ryco/contracts";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime";
import { readEnvironmentConnection } from "../environments/runtime/service.ts";
import { useDetectedServerStore } from "../detectedServerStore.ts";

interface ConnectionLike {
  client: {
    detectedServers: {
      onEvent: (
        input: { threadId: string },
        listener: (event: DetectedServerEvent) => void,
      ) => () => void;
    };
  };
}

/**
 * Pure subscription helper extracted for unit testing. Returns the unsubscribe
 * function (or `undefined` if no subscription was opened).
 */
export const subscribeDetectedServers = (
  environmentId: string | null,
  threadId: string | null,
  dispatch: (threadKey: string, event: DetectedServerEvent) => void,
  connect: (envId: string) => ConnectionLike | null,
): (() => void) | undefined => {
  if (!environmentId || !threadId) return undefined;
  const connection = connect(environmentId);
  if (!connection) return undefined;
  const threadKey = scopedThreadKey(
    scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId),
  );
  return connection.client.detectedServers.onEvent({ threadId }, (event) => {
    dispatch(threadKey, event);
  });
};

/**
 * Subscribes to detected-server events for the active server-thread and
 * dispatches them into useDetectedServerStore. Tearing down: when the active
 * thread (environmentId or threadId) changes, the previous subscription is
 * disposed and a fresh one opened on the new thread, so events from a stale
 * thread cannot leak into the new thread's store entry.
 */
export const useDetectedServersSubscription = (
  environmentId: string | null,
  threadId: string | null,
): void => {
  useEffect(() => {
    return subscribeDetectedServers(
      environmentId,
      threadId,
      (key, event) => useDetectedServerStore.getState().handleEvent(key, event),
      (envId) => readEnvironmentConnection(envId as EnvironmentId) as ConnectionLike | null,
    );
  }, [environmentId, threadId]);
};
