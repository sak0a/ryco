import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// Native modules are stubbed so the sink (which imports the composer/terminal
// stores and mobileKV) loads under the Node runner.
vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) } }));
vi.mock("expo-network", () => ({ addNetworkStateListener: () => ({ remove: () => {} }), getNetworkStateAsync: async () => ({ isConnected: true }) }));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock("expo-sqlite/kv-store", () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
vi.mock("expo-linking", () => ({ getInitialURL: async () => null }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

import { createMobileEnvironmentStateSink } from "./environmentStateSink";
import { useComposerDraftStore } from "../state/composerDraftStore";
import { useTerminalStateStore } from "../state/terminalStateStore";

const ENV_ID = "env-1" as EnvironmentId;
const THREAD_ID = "thread-1" as ThreadId;

function fakeSupervisor() {
  return {
    disposeThreadDetailSubscription: vi.fn(() => true),
    evictIdleThreadDetailSubscriptionsToCapacity: vi.fn(),
    reconcileThreadDetailSubscriptionEvictionForThread: vi.fn(),
  };
}

describe("createMobileEnvironmentStateSink.afterShellEventApplied", () => {
  it("reconciles + evicts detail subscriptions on a thread-upserted event", () => {
    const supervisor = fakeSupervisor();
    const sink = createMobileEnvironmentStateSink({ supervisor: () => supervisor });

    const event = {
      kind: "thread-upserted",
      thread: { id: THREAD_ID, archivedAt: null },
    } as unknown as Parameters<typeof sink.afterShellEventApplied>[1];

    const context = sink.prepareShellEvent(ENV_ID, event);
    sink.afterShellEventApplied(ENV_ID, event, context);

    expect(supervisor.reconcileThreadDetailSubscriptionEvictionForThread).toHaveBeenCalledWith(
      ENV_ID,
      THREAD_ID,
    );
    expect(supervisor.evictIdleThreadDetailSubscriptionsToCapacity).toHaveBeenCalledTimes(1);
    expect(supervisor.disposeThreadDetailSubscription).not.toHaveBeenCalled();
  });

  it("disposes the detail subscription + clears draft/terminal state on thread-removed", () => {
    const supervisor = fakeSupervisor();
    const sink = createMobileEnvironmentStateSink({ supervisor: () => supervisor });
    const clearDraft = vi
      .spyOn(useComposerDraftStore.getState(), "clearDraftThread")
      .mockImplementation(() => undefined);
    const removeTerminal = vi
      .spyOn(useTerminalStateStore.getState(), "removeTerminalState")
      .mockImplementation(() => undefined);

    const event = {
      kind: "thread-removed",
      threadId: THREAD_ID,
    } as unknown as Parameters<typeof sink.afterShellEventApplied>[1];

    const context = sink.prepareShellEvent(ENV_ID, event);
    sink.afterShellEventApplied(ENV_ID, event, context);

    expect(supervisor.disposeThreadDetailSubscription).toHaveBeenCalledWith(ENV_ID, THREAD_ID);
    expect(clearDraft).toHaveBeenCalledTimes(1);
    expect(removeTerminal).toHaveBeenCalledTimes(1);

    clearDraft.mockRestore();
    removeTerminal.mockRestore();
  });
});
