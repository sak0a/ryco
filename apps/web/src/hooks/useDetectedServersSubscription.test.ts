import { describe, expect, it, vi } from "vitest";
import type { DetectedServerEvent, EnvironmentId, ThreadId } from "@ryco/contracts";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime";
import { subscribeDetectedServers } from "./useDetectedServersSubscription.ts";

interface FakeConnection {
  client: {
    detectedServers: {
      onEvent: ReturnType<typeof vi.fn>;
    };
  };
}

const makeFakeConnection = () => {
  const unsub = vi.fn();
  const onEvent = vi.fn().mockReturnValue(unsub);
  const conn = {
    client: { detectedServers: { onEvent } },
  } as unknown as FakeConnection;
  return { conn, onEvent, unsub };
};

const keyFor = (envId: string, threadId: string): string =>
  scopedThreadKey(scopeThreadRef(envId as EnvironmentId, threadId as ThreadId));

describe("subscribeDetectedServers", () => {
  it("opens a subscription scoped to the given thread", () => {
    const { conn, onEvent } = makeFakeConnection();
    const dispatch = vi.fn();
    subscribeDetectedServers("env-A", "thread-1", dispatch, () => conn as never);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0]).toEqual({ threadId: "thread-1" });
  });

  it("dispatches events with the scoped thread key", () => {
    const { conn, onEvent } = makeFakeConnection();
    const dispatch = vi.fn();
    subscribeDetectedServers("env-A", "thread-1", dispatch, () => conn as never);
    const handler = onEvent.mock.calls[0]![1] as (e: DetectedServerEvent) => void;
    const event: DetectedServerEvent = {
      type: "removed",
      threadId: "thread-1",
      serverId: "s-1",
      createdAt: new Date().toISOString(),
    };
    handler(event);
    expect(dispatch).toHaveBeenCalledWith(keyFor("env-A", "thread-1"), event);
  });

  it("returns an unsubscribe function which the caller invokes when the thread changes", () => {
    const { conn, onEvent, unsub } = makeFakeConnection();
    const dispatch = vi.fn();

    // Mount A
    const unsubA = subscribeDetectedServers("env-A", "thread-A", dispatch, () => conn as never);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0]).toEqual({ threadId: "thread-A" });

    // Switch to B: caller invokes the previous unsubscribe and re-subscribes.
    unsubA?.();
    const unsubB = subscribeDetectedServers("env-A", "thread-B", dispatch, () => conn as never);

    expect(unsub).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[1]![0]).toEqual({ threadId: "thread-B" });
    expect(typeof unsubB).toBe("function");
  });

  it("returns undefined and does not call onEvent when environmentId or threadId is missing", () => {
    const { conn, onEvent } = makeFakeConnection();
    const dispatch = vi.fn();
    expect(
      subscribeDetectedServers(null, "thread-A", dispatch, () => conn as never),
    ).toBeUndefined();
    expect(subscribeDetectedServers("env-A", null, dispatch, () => conn as never)).toBeUndefined();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("returns undefined when the connection lookup yields null", () => {
    const dispatch = vi.fn();
    const result = subscribeDetectedServers("env-A", "thread-A", dispatch, () => null);
    expect(result).toBeUndefined();
  });
});
