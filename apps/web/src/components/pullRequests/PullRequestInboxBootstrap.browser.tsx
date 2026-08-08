import {
  resetPullRequestStore,
  usePullRequestStore,
} from "@ryco/client-runtime/state/pullRequests";
import { EnvironmentId, type PullRequestInboxSnapshot } from "@ryco/contracts";
import { Option } from "effect";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  connections: [] as Array<unknown>,
  connectionListener: null as (() => void) | null,
  snapshotListener: null as ((snapshot: PullRequestInboxSnapshot) => void) | null,
  onError: null as (() => void) | null,
  unsubscribeInbox: vi.fn(),
}));

vi.mock("~/environments/runtime", () => ({
  listEnvironmentConnections: () => harness.connections,
  subscribeEnvironmentConnections: (listener: () => void) => {
    harness.connectionListener = listener;
    return () => {
      harness.connectionListener = null;
    };
  },
}));

import { PullRequestInboxBootstrap } from "./PullRequestInboxBootstrap";

describe("PullRequestInboxBootstrap", () => {
  beforeEach(() => {
    resetPullRequestStore();
    harness.connections = [];
    harness.connectionListener = null;
    harness.snapshotListener = null;
    harness.onError = null;
    harness.unsubscribeInbox.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("warms every connected environment and marks a failed stream stale", async () => {
    const environmentId = EnvironmentId.make("environment-local");
    const subscribeInbox = vi.fn(
      (
        listener: (snapshot: PullRequestInboxSnapshot) => void,
        options: { onError?: () => void },
      ) => {
        harness.snapshotListener = listener;
        harness.onError = options.onError ?? null;
        return harness.unsubscribeInbox;
      },
    );
    harness.connections = [
      {
        environmentId,
        client: { pullRequests: { subscribeInbox } },
      },
    ];

    const mounted = await render(<PullRequestInboxBootstrap />);
    await vi.waitFor(() => expect(subscribeInbox).toHaveBeenCalledOnce());

    harness.snapshotListener?.({
      generation: 7,
      items: [],
      coverage: [],
      lastSuccessAt: Option.none(),
    });
    expect(usePullRequestStore.getState().environmentById[environmentId]?.generation).toBe(7);
    expect(usePullRequestStore.getState().environmentById[environmentId]?.stale).toBe(false);

    harness.onError?.();
    expect(usePullRequestStore.getState().environmentById[environmentId]?.stale).toBe(true);

    await mounted.unmount();
    expect(harness.unsubscribeInbox).toHaveBeenCalledOnce();
  });
});
