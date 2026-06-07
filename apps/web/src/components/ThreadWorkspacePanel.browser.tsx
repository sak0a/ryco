import "../index.css";

import { render } from "vitest-browser-react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import ThreadWorkspacePanel from "./ThreadWorkspacePanel";

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
});
