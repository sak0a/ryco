import "../index.css";

import { render } from "vitest-browser-react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RightPanelInlineSidebar } from "./ChatRightPanel";

describe("RightPanelInlineSidebar", () => {
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

  it("reserves the configured inline width while open", async () => {
    mounted = await render(
      <RightPanelInlineSidebar
        open
        panelMode={null}
        openedPanelModes={[]}
        openedAgentKeys={[]}
        onClosePanelTab={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        renderContent={false}
      />,
    );

    const wrapper = document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]');

    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("w-(--sidebar-width)");

    const wrapperWidth = wrapper!.getBoundingClientRect().width;

    expect(wrapperWidth).toBeGreaterThan(300);
  });

  it("does not reserve inline space while closed", async () => {
    mounted = await render(
      <RightPanelInlineSidebar
        open={false}
        panelMode={null}
        openedPanelModes={[]}
        openedAgentKeys={[]}
        onClosePanelTab={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        renderContent={false}
      />,
    );

    const wrapper = document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]');

    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("w-0");
    expect(wrapper!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });
});
