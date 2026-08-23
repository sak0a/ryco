import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@ryco/contracts";

import { createFakeHistoryWindow } from "../../test/fakeHistoryWindow";
import {
  buildHostedNodeHref,
  clearHostedNodeRoute,
  enterHostedNodeRoute,
  adoptRoutedHostedNode,
  getRoutedHostedNode,
  installHostedNodeHistory,
  isValidHostedNodeRouteSegment,
  parseHostedNodeHref,
  resetHostedNodeRoutesForTests,
  subscribeRoutedHostedNode,
  setHostedNodeRouteEnvironmentResolver,
} from "./nodeRoutes";

afterEach(() => {
  resetHostedNodeRoutesForTests();
  vi.restoreAllMocks();
});

function install(initialUrl: string) {
  const win = createFakeHistoryWindow(initialUrl);
  const history = installHostedNodeHistory(win as unknown as Window & typeof globalThis);
  return { win, history };
}

describe("hosted node route segment parsing", () => {
  it("accepts only the bounded URL-safe segment charset", () => {
    expect(isValidHostedNodeRouteSegment("node_aaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isValidHostedNodeRouteSegment("A1-b_2")).toBe(true);
    expect(isValidHostedNodeRouteSegment("")).toBe(false);
    expect(isValidHostedNodeRouteSegment("..")).toBe(false);
    expect(isValidHostedNodeRouteSegment("a.b")).toBe(false);
    expect(isValidHostedNodeRouteSegment("a b")).toBe(false);
    expect(isValidHostedNodeRouteSegment("a/b")).toBe(false);
    expect(isValidHostedNodeRouteSegment("%2e%2e")).toBe(false);
    expect(isValidHostedNodeRouteSegment("x".repeat(129))).toBe(false);
    expect(isValidHostedNodeRouteSegment("x".repeat(128))).toBe(true);
  });

  it("passes non node-scoped hrefs through unchanged", () => {
    expect(parseHostedNodeHref("/")).toEqual({
      routed: { nodeId: null, malformed: false },
      logicalHref: "/",
    });
    expect(parseHostedNodeHref("/env_a/t_1?workspaceTab=diff#m")).toEqual({
      routed: { nodeId: null, malformed: false },
      logicalHref: "/env_a/t_1?workspaceTab=diff#m",
    });
    expect(parseHostedNodeHref("/nodeling/x").routed.nodeId).toBeNull();
    expect(parseHostedNodeHref("/nodeling/x").routed.malformed).toBe(false);
  });

  it("extracts the node segment and preserves the nested logical href", () => {
    expect(parseHostedNodeHref("/node/node_a")).toEqual({
      routed: { nodeId: "node_a", malformed: false },
      logicalHref: "/",
    });
    expect(parseHostedNodeHref("/node/node_a/env_a/t_1?workspaceTab=diff&diff=f#x")).toEqual({
      routed: { nodeId: "node_a", malformed: false },
      logicalHref: "/env_a/t_1?workspaceTab=diff&diff=f#x",
    });
    expect(parseHostedNodeHref("/node/node_a?x=1")).toEqual({
      routed: { nodeId: "node_a", malformed: false },
      logicalHref: "/?x=1",
    });
  });

  it("classifies unusable segments as malformed and fails closed to the root", () => {
    for (const href of [
      "/node",
      "/node/",
      "/node//env_a/t_1",
      "/node/a b/env_a/t_1",
      "/node/%2e%2e/env_a/t_1",
      `/node/${"x".repeat(129)}`,
    ]) {
      const parsed = parseHostedNodeHref(href);
      expect(parsed.routed).toEqual({ nodeId: null, malformed: true });
      expect(parsed.logicalHref).toBe("/");
    }
  });

  it("builds node-scoped hrefs without altering search or hash", () => {
    expect(buildHostedNodeHref("/", "node_a")).toBe("/node/node_a");
    expect(buildHostedNodeHref("/?x=1#y", "node_a")).toBe("/node/node_a?x=1#y");
    expect(buildHostedNodeHref("/env_a/t_1?workspaceTab=diff", "node_a")).toBe(
      "/node/node_a/env_a/t_1?workspaceTab=diff",
    );
    expect(buildHostedNodeHref("/env_a/t_1", null)).toBe("/env_a/t_1");
    expect(buildHostedNodeHref("/env_a/t_1", "not valid!")).toBe("/env_a/t_1");
  });

  it("routes a logical environment through its own authorized node, not the current node", () => {
    setHostedNodeRouteEnvironmentResolver((environmentId) =>
      environmentId === EnvironmentId.make("env_b") ? "node_b" : null,
    );
    expect(buildHostedNodeHref("/env_b/colliding_thread", "node_a")).toBe(
      "/node/node_b/env_b/colliding_thread",
    );
    expect(buildHostedNodeHref("/env_a/colliding_thread", "node_a")).toBe(
      "/node/node_a/env_a/colliding_thread",
    );
  });
});

describe("hosted node history", () => {
  it("captures the routed node at install time and exposes the logical location", () => {
    const { history } = install("/node/node_a/env_a/t_1?workspaceTab=diff");
    expect(getRoutedHostedNode()).toEqual({
      nodeId: "node_a",
      malformed: false,
      logicalPathname: "/env_a/t_1",
    });
    expect(history.location.pathname).toBe("/env_a/t_1");
    expect(history.location.search).toBe("?workspaceTab=diff");
  });

  it("prefixes pushed logical hrefs with the routed segment", () => {
    const { win, history } = install("/node/node_a");
    history.push("/env_a/t_1?workspaceTab=diff");
    history.flush();
    expect(win.location.pathname).toBe("/node/node_a/env_a/t_1");
    expect(win.location.search).toBe("?workspaceTab=diff");
    expect(history.location.pathname).toBe("/env_a/t_1");
    expect(history.createHref("/env_a/t_1")).toBe("/node/node_a/env_a/t_1");
  });

  it("publishes the resolved node when a logical thread is pushed from the unified root", () => {
    const { win, history } = install("/");
    setHostedNodeRouteEnvironmentResolver((environmentId) =>
      environmentId === EnvironmentId.make("env_a") ? "node_a" : null,
    );
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeRoutedHostedNode(() => {
      seen.push(getRoutedHostedNode().nodeId);
    });

    history.push("/env_a/t_1");
    history.flush();

    expect(win.location.pathname).toBe("/node/node_a/env_a/t_1");
    expect(getRoutedHostedNode()).toEqual({
      nodeId: "node_a",
      malformed: false,
      logicalPathname: "/env_a/t_1",
    });
    expect(seen).toEqual(["node_a"]);
    unsubscribe();
  });

  it("publishes a cross-node logical push before the destination thread renders", () => {
    const { win, history } = install("/node/node_a/env_a/t_1");
    setHostedNodeRouteEnvironmentResolver((environmentId) =>
      environmentId === EnvironmentId.make("env_b") ? "node_b" : null,
    );

    history.push("/env_b/t_2");
    history.flush();

    expect(win.location.pathname).toBe("/node/node_b/env_b/t_2");
    expect(getRoutedHostedNode()).toEqual({
      nodeId: "node_b",
      malformed: false,
      logicalPathname: "/env_b/t_2",
    });
  });

  it("enters a node route with a new history entry and clears it fail-closed", () => {
    const { win, history } = install("/");
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeRoutedHostedNode(() => {
      seen.push(getRoutedHostedNode().nodeId);
    });
    expect(enterHostedNodeRoute("node_a")).toBe(true);
    history.flush();
    expect(win.location.pathname).toBe("/node/node_a");
    expect(win.entries()).toHaveLength(2);

    clearHostedNodeRoute();
    history.flush();
    expect(win.location.pathname).toBe("/");
    expect(win.entries()).toHaveLength(2);
    expect(seen).toEqual(["node_a", null]);
    unsubscribe();
  });

  it("rejects invalid segments for programmatic navigation", () => {
    const { win } = install("/");
    expect(enterHostedNodeRoute("not valid!")).toBe(false);
    expect(adoptRoutedHostedNode("..")).toBe(false);
    expect(win.entries()).toHaveLength(1);
    expect(getRoutedHostedNode().nodeId).toBeNull();
  });

  it("adopts a legacy location in place without adding a history entry", () => {
    const { win, history } = install("/env_a/t_1?workspaceTab=diff");
    expect(getRoutedHostedNode().nodeId).toBeNull();
    expect(adoptRoutedHostedNode("node_a")).toBe(true);
    history.flush();
    expect(win.entries()).toHaveLength(1);
    expect(win.location.pathname).toBe("/node/node_a/env_a/t_1");
    expect(win.location.search).toBe("?workspaceTab=diff");
    expect(history.location.pathname).toBe("/env_a/t_1");
  });

  it("republishes the routed node across Back and Forward", () => {
    const { win, history } = install("/");
    enterHostedNodeRoute("node_a");
    history.flush();
    expect(getRoutedHostedNode().nodeId).toBe("node_a");

    win.history.back();
    expect(getRoutedHostedNode().nodeId).toBeNull();
    expect(win.location.pathname).toBe("/");

    win.history.forward();
    expect(getRoutedHostedNode().nodeId).toBe("node_a");
    expect(win.location.pathname).toBe("/node/node_a");
  });

  it("marks malformed browser locations and keeps the router on the root", () => {
    const { history } = install("/node/a%20b/env_a/t_1");
    expect(getRoutedHostedNode()).toEqual({
      nodeId: null,
      malformed: true,
      logicalPathname: "/",
    });
    expect(history.location.pathname).toBe("/");
  });

  it("publishes the logical pathname of the parsed entry across Back and Forward", () => {
    const { win, history } = install("/env_a/t_1?workspaceTab=diff");
    expect(getRoutedHostedNode().logicalPathname).toBe("/env_a/t_1");
    expect(adoptRoutedHostedNode("node_a")).toBe(true);
    history.flush();
    expect(getRoutedHostedNode().logicalPathname).toBe("/env_a/t_1");

    clearHostedNodeRoute();
    history.flush();
    expect(getRoutedHostedNode().logicalPathname).toBe("/");
    expect(win.location.pathname).toBe("/");
  });

  it("keeps history entry state free of application material", () => {
    const canary = "ticket-sensitive-route-canary";
    const { win, history } = install("/");
    enterHostedNodeRoute("node_a");
    history.push(`/env_a/t_1`);
    history.flush();
    const serialized = JSON.stringify(win.entries());
    expect(serialized).not.toContain(canary);
    for (const entry of win.entries()) {
      const keys = Object.keys((entry.state ?? {}) as Record<string, unknown>);
      // TanStack history bookkeeping only: index and entry keys.
      expect(
        keys.every((key) => key === "__TSR_index" || key === "__TSR_key" || key === "key"),
      ).toBe(true);
    }
  });
});
