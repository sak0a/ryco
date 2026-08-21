import type { HostedHubNode, HostedHubState } from "@ryco/client-runtime/authorization";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  deriveHubSelectionRestore,
  deserializePersistedHubSelection,
  installHubSelectionPersistence,
  serializePersistedHubSelection,
  HUB_SELECTED_NODE_STORAGE_KEY,
} from "./selectionPersistence";

function node(nodeId: string, environmentId: string, revokedAt: number | null = null) {
  return {
    id: nodeId,
    environmentId,
    label: nodeId,
    effectiveRole: "operator",
    revokedAt,
    lastAuthenticatedAt: null,
    presence: { online: true, lastHeartbeatAt: null },
  } as unknown as HostedHubNode;
}

function hubState(overrides: Partial<HostedHubState>): HostedHubState {
  return {
    accountStatus: "authenticated",
    directoryStatus: "ready",
    browserStatus: "current",
    selectedNode: null,
    nodes: [],
    ...overrides,
  } as HostedHubState;
}

function createFakeStore(initial: HostedHubState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch: (next: Partial<HostedHubState>) => {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
  };
}

function createFakeKv(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("hub selection persistence", () => {
  it("round-trips the persisted selection and rejects other versions", () => {
    const raw = serializePersistedHubSelection({ nodeId: "n1", environmentId: "e1" });
    expect(deserializePersistedHubSelection(raw)).toEqual({ nodeId: "n1", environmentId: "e1" });
    expect(deserializePersistedHubSelection('{"version":2,"nodeId":"n1"}')).toBeNull();
    expect(deserializePersistedHubSelection("{corrupt")).toBeNull();
  });

  it("waits until the directory is authoritative, then selects the persisted node", () => {
    const persisted = { nodeId: "n1", environmentId: "e1" };
    expect(deriveHubSelectionRestore(hubState({ directoryStatus: "loading" }), persisted)).toEqual({
      kind: "wait",
    });
    expect(deriveHubSelectionRestore(hubState({ nodes: [node("n1", "e1")] }), persisted)).toEqual({
      kind: "select",
      nodeId: "n1",
    });
  });

  it("clears a persisted selection that is revoked or gone", () => {
    const persisted = { nodeId: "n1", environmentId: "e1" };
    expect(
      deriveHubSelectionRestore(hubState({ nodes: [node("n1", "e1", 42)] }), persisted),
    ).toEqual({ kind: "clear" });
    expect(
      deriveHubSelectionRestore(hubState({ nodes: [node("other", "e2")] }), persisted),
    ).toEqual({ kind: "clear" });
  });

  it("restores the persisted node once the directory becomes ready", async () => {
    const kv = createFakeKv({
      [HUB_SELECTED_NODE_STORAGE_KEY]: serializePersistedHubSelection({
        nodeId: "n1",
        environmentId: "e1",
      }),
    });
    const store = createFakeStore(hubState({ directoryStatus: "loading" }));
    const selectNode = vi.fn(async () => undefined);
    const uninstall = installHubSelectionPersistence({ kv, store, selectNode });
    await flush();
    expect(selectNode).not.toHaveBeenCalled();

    store.patch({ directoryStatus: "ready", nodes: [node("n1", "e1")] });
    await flush();
    expect(selectNode).toHaveBeenCalledExactlyOnceWith("n1");
    uninstall();
  });

  it("persists every selection change and clears on deselection", async () => {
    const kv = createFakeKv();
    const store = createFakeStore(hubState({}));
    const uninstall = installHubSelectionPersistence({
      kv,
      store,
      selectNode: async () => undefined,
    });
    await flush();

    store.patch({ selectedNode: node("n1", "e1") });
    await flush();
    expect(kv.store.get(HUB_SELECTED_NODE_STORAGE_KEY)).toContain('"n1"');

    store.patch({ selectedNode: null });
    await flush();
    expect(kv.store.has(HUB_SELECTED_NODE_STORAGE_KEY)).toBe(false);
    uninstall();
  });

  it("never restores over a selection the user already made this launch", async () => {
    const kv = createFakeKv({
      [HUB_SELECTED_NODE_STORAGE_KEY]: serializePersistedHubSelection({
        nodeId: "n1",
        environmentId: "e1",
      }),
    });
    const store = createFakeStore(hubState({ directoryStatus: "loading" }));
    const selectNode = vi.fn(async () => undefined);
    const uninstall = installHubSelectionPersistence({ kv, store, selectNode });
    await flush();

    // The user picks a different node before the directory settles.
    store.patch({ selectedNode: node("n2", "e2") });
    store.patch({ directoryStatus: "ready", nodes: [node("n1", "e1"), node("n2", "e2")] });
    await flush();
    expect(selectNode).not.toHaveBeenCalled();
    expect(kv.store.get(HUB_SELECTED_NODE_STORAGE_KEY)).toContain('"n2"');
    uninstall();
  });
});
