import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId } from "@ryco/contracts";

import { createHomeModeState, reduceHomeModeState } from "./homeMode";

describe("Home mode state", () => {
  it("starts in Inbox with independent empty state for every mode", () => {
    expect(createHomeModeState()).toEqual({
      mode: "inbox",
      queryByMode: { inbox: "", projects: "", nodes: "" },
      nodeScopeByMode: { inbox: null, projects: null, nodes: null },
      scrollOffsetByMode: { inbox: 0, projects: 0, nodes: 0 },
    });
  });

  it("preserves query, node scope, and scroll position when modes change", () => {
    const environmentId = "node-a" as EnvironmentId;
    let state = createHomeModeState();

    state = reduceHomeModeState(state, {
      type: "set-query",
      mode: "inbox",
      query: "auth",
    });
    state = reduceHomeModeState(state, {
      type: "set-node-scope",
      mode: "inbox",
      environmentId,
    });
    state = reduceHomeModeState(state, {
      type: "set-scroll-offset",
      mode: "inbox",
      offset: 418,
    });
    state = reduceHomeModeState(state, { type: "select-mode", mode: "projects" });
    state = reduceHomeModeState(state, { type: "select-mode", mode: "inbox" });

    expect(state.mode).toBe("inbox");
    expect(state.queryByMode.inbox).toBe("auth");
    expect(state.nodeScopeByMode.inbox).toBe(environmentId);
    expect(state.scrollOffsetByMode.inbox).toBe(418);
    expect(state.queryByMode.projects).toBe("");
  });

  it("normalizes negative scroll offsets and reuses unchanged state", () => {
    const state = createHomeModeState();
    const unchanged = reduceHomeModeState(state, { type: "select-mode", mode: "inbox" });
    const normalized = reduceHomeModeState(state, {
      type: "set-scroll-offset",
      mode: "nodes",
      offset: -20,
    });

    expect(unchanged).toBe(state);
    expect(normalized).toBe(state);
  });
});
