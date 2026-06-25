import { describe, expect, it } from "vite-plus/test";

import {
  buildOpenBrowserSearch,
  parseWorkspaceRouteSearch,
  stripWorkspacePanelSearchParams,
} from "./workspaceRouteSearch";

describe("workspaceRouteSearch browser tab", () => {
  it("builds a browser workspace search and clears legacy panel state", () => {
    expect(
      buildOpenBrowserSearch({
        workspaceOpen: "1",
        workspaceTab: "review",
        workspaceAgentKey: "subagent:old",
        diff: "1",
        diffTurnId: "turn-1",
        diffFilePath: "src/app.ts",
        preview: "1",
        keep: "value",
      }),
    ).toEqual({
      workspaceOpen: "1",
      workspaceTab: "browser",
      workspaceAgentKey: undefined,
      diff: undefined,
      diffTurnId: undefined,
      diffFilePath: undefined,
      preview: undefined,
      keep: "value",
    });
  });

  it("parses browser as a concrete workspace tab", () => {
    expect(parseWorkspaceRouteSearch({ workspaceTab: "browser" })).toEqual({
      workspaceOpen: "1",
      workspaceTab: "browser",
    });
  });

  it("strips browser workspace keys with other panel keys", () => {
    expect(
      stripWorkspacePanelSearchParams({
        workspaceOpen: "1",
        workspaceTab: "browser",
        workspaceAgentKey: "subagent:old",
        diff: "1",
        preview: "1",
        keep: "value",
      }),
    ).toEqual({ keep: "value" });
  });
});
