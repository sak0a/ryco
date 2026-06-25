import "../index.css";

import { render } from "vitest-browser-react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import ThreadWorkspacePanel, { AgentThreadPanel } from "./ThreadWorkspacePanel";
import type { ThreadSubagentView } from "../threadWorkspaceViewModel";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: vi.fn((options?: { select?: (params: Record<string, string>) => unknown }) => {
    const params = {};
    return options?.select ? options.select(params) : params;
  }),
  useSearch: vi.fn((options?: { select?: (search: Record<string, string>) => unknown }) => {
    const search = { workspaceOpen: "1" };
    return options?.select ? options.select(search) : search;
  }),
}));

vi.mock("../rpc/serverState", async () => {
  const actual = await vi.importActual<typeof import("../rpc/serverState")>("../rpc/serverState");
  return {
    ...actual,
    useServerKeybindings: () => [],
  };
});

describe("ThreadWorkspacePanel", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
  });

  it("stretches its root to the full right-panel width", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "620px";
    host.style.display = "flex";
    document.body.append(host);

    mounted = await render(
      <ThreadWorkspacePanel
        mode="sidebar"
        panelMode={null}
        openedPanelModes={[]}
        openedAgentKeys={[]}
        onClosePanelTab={vi.fn()}
      />,
      { container: host },
    );

    const workspaceRoot = host.firstElementChild as HTMLElement | null;
    const tabPanel = document.querySelector<HTMLElement>('[role="tabpanel"]');

    expect(workspaceRoot).not.toBeNull();
    expect(tabPanel).not.toBeNull();
    expect(workspaceRoot!.className).toContain("w-full");
    expect(workspaceRoot!.className).toContain("flex-1");
    expect(workspaceRoot!.getBoundingClientRect().width).toBeGreaterThan(890);
    expect(
      Math.abs(workspaceRoot!.getBoundingClientRect().width - host.clientWidth),
    ).toBeLessThanOrEqual(1);
  });

  it("scrolls long subagent transcripts inside the agent panel", async () => {
    const host = document.createElement("div");
    host.style.width = "420px";
    host.style.height = "320px";
    document.body.append(host);

    const subagent: ThreadSubagentView = {
      key: "subagent:researcher",
      name: "Researcher",
      status: "running",
      origin: null,
      capability: null,
      tool: "spawnAgent",
      detail: "Inspect the retry flow.",
      providerThreadIds: ["child-thread-1"],
      providerSessionIds: [],
      childThreadIds: [],
      startedAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      entries: [],
      messages: Array.from({ length: 24 }, (_, index) => ({
        id: `message-${index}`,
        createdAt: `2026-06-04T10:00:${String(index).padStart(2, "0")}.000Z`,
        providerThreadId: "child-thread-1",
        text: `Finding ${index + 1}: this is a deliberately long subagent transcript entry that should remain inside the scroll container rather than expanding the whole panel.`,
      })),
    };

    mounted = await render(
      <AgentThreadPanel subagent={subagent} agentKey="subagent:researcher" />,
      { container: host },
    );

    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');

    expect(viewport).not.toBeNull();
    expect(viewport!.clientHeight).toBeGreaterThan(0);
    expect(viewport!.scrollHeight).toBeGreaterThan(viewport!.clientHeight);

    viewport!.scrollTop = viewport!.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(viewport!.scrollTop).toBeGreaterThan(0);
  });
});
