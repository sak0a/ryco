import type { RightPanelMode } from "./rightPanelRouteSearch";
import {
  deriveSubagentAccentColor,
  findThreadSubagent,
  type ThreadSubagentStatus,
  type ThreadSubagentView,
} from "./threadWorkspaceViewModel";

export type WorkspaceTab =
  | {
      key: "files" | "review" | "terminal";
      label: string;
      mode: Exclude<RightPanelMode, "agent">;
    }
  | {
      key: string;
      label: string;
      mode: "agent";
      agentKey: string;
      accentColor: string;
      status: ThreadSubagentStatus;
    };

export function buildTabs(input: {
  subagents: ReadonlyArray<ThreadSubagentView>;
  activeAgentKey: string | null;
  openedAgentKeys: ReadonlyArray<string>;
  openedPanelModes: ReadonlyArray<RightPanelMode>;
}): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = [];
  const openedModes = new Set(input.openedPanelModes);
  if (openedModes.has("files")) {
    tabs.push({ key: "files", label: "Files", mode: "files" });
  }
  if (openedModes.has("review")) {
    tabs.push({ key: "review", label: "Review", mode: "review" });
  }
  if (openedModes.has("terminal")) {
    tabs.push({ key: "terminal", label: "Terminal", mode: "terminal" });
  }

  const visibleAgentKeys = [
    ...new Set([...input.openedAgentKeys, ...(input.activeAgentKey ? [input.activeAgentKey] : [])]),
  ];

  for (const agentKey of visibleAgentKeys) {
    const subagent = findThreadSubagent(input.subagents, agentKey) ?? {
      key: agentKey,
      name: "Subagent",
      accentColor: deriveSubagentAccentColor(agentKey),
      status: "idle" as const,
      tool: null,
      detail: null,
      providerThreadIds: [],
      startedAt: "",
      updatedAt: "",
      entries: [],
      messages: [],
    };
    tabs.push({
      key: subagent.key,
      label: subagent.name,
      mode: "agent",
      agentKey: subagent.key,
      accentColor: subagent.accentColor,
      status: subagent.status,
    });
  }

  return tabs;
}
