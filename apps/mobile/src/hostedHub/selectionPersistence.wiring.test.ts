import type { HostedHubState } from "@ryco/client-runtime/authorization";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const acquireNode = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./acquireNode", () => ({ acquireMobileHostedNode: acquireNode }));

import {
  HUB_SELECTED_NODE_STORAGE_KEY,
  installHubSelectionPersistence,
  serializePersistedHubSelection,
} from "./selectionPersistence";

function createStore() {
  const node = {
    id: "node-1",
    environmentId: "env-1",
    revokedAt: null,
  };
  const state = {
    accountStatus: "authenticated",
    directoryStatus: "ready",
    browserStatus: "current",
    selectedNode: null,
    nodes: [node],
  } as unknown as HostedHubState;
  return { getState: () => state, subscribe: () => () => undefined };
}

describe("persisted Hub selection production wiring", () => {
  beforeEach(() => acquireNode.mockClear());

  it("restores through the bounded mobile acquisition actuator", async () => {
    const uninstall = installHubSelectionPersistence({
      kv: {
        getItem: async (key) =>
          key === HUB_SELECTED_NODE_STORAGE_KEY
            ? serializePersistedHubSelection({ nodeId: "node-1", environmentId: "env-1" })
            : null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
      store: createStore(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acquireNode).toHaveBeenCalledExactlyOnceWith("node-1");
    uninstall();
  });
});
