import { describe, expect, it } from "vite-plus/test";

import type { ThreadSubagentView } from "../threadWorkspaceViewModel";
import { buildTabs } from "../threadWorkspaceTabs";

function makeSubagent(overrides: Pick<ThreadSubagentView, "key" | "name">): ThreadSubagentView {
  return {
    key: overrides.key,
    name: overrides.name,
    status: "running",
    origin: null,
    capability: null,
    tool: null,
    detail: null,
    providerThreadIds: [],
    providerSessionIds: [],
    childThreadIds: [],
    startedAt: "2026-06-04T10:00:00.000Z",
    updatedAt: "2026-06-04T10:00:00.000Z",
    entries: [],
    messages: [],
  };
}

describe("buildTabs", () => {
  it("only opens explicitly opened or active subagent tabs", () => {
    const tabs = buildTabs({
      subagents: [
        makeSubagent({ key: "subagent:first", name: "First" }),
        makeSubagent({ key: "subagent:second", name: "Second" }),
      ],
      activeAgentKey: "subagent:first",
      openedAgentKeys: ["subagent:first"],
      openedPanelModes: [],
    });

    expect(tabs.map((tab) => tab.key)).toEqual(["subagent:first"]);
  });

  it("keeps a missing active subagent tab addressable", () => {
    const tabs = buildTabs({
      subagents: [],
      activeAgentKey: "subagent:missing",
      openedAgentKeys: [],
      openedPanelModes: [],
    });

    expect(tabs).toEqual([
      expect.objectContaining({
        key: "subagent:missing",
        label: "Subagent",
        mode: "agent",
        agentKey: "subagent:missing",
      }),
    ]);
  });
});
