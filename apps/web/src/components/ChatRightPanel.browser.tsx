import "../index.css";

import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { syncDocumentPresentationTier } from "../lib/presentationTier";

import { RightPanelInlineSidebar } from "./ChatRightPanel";

const BASE_PROPS = {
  panelMode: null,
  openedPanelModes: [],
  openedAgentKeys: [],
  renderContent: false,
  maximized: false,
  reserveChromeInset: false,
} as const;

describe("RightPanelInlineSidebar", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  // The inline presentation only exists on the desktop tier — the phone tier
  // swaps the whole sidebar for a sheet with no inline geometry at all.
  beforeEach(async () => {
    await page.viewport(1_280, 800);
    syncDocumentPresentationTier();
  });

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
        {...BASE_PROPS}
        open
        onClosePanelTab={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onToggleMaximized={vi.fn()}
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
        {...BASE_PROPS}
        open={false}
        onClosePanelTab={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onToggleMaximized={vi.fn()}
      />,
    );

    const wrapper = document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]');

    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("w-0");
    expect(wrapper!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("fills the space it is given while maximized, dropping the resize rail", async () => {
    const host = document.createElement("div");
    host.style.display = "flex";
    host.style.width = "900px";
    document.body.append(host);

    mounted = await render(
      <RightPanelInlineSidebar
        {...BASE_PROPS}
        open
        maximized
        onClosePanelTab={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onToggleMaximized={vi.fn()}
      />,
      { container: host },
    );

    const wrapper = host.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]');
    const container = host.querySelector<HTMLElement>('[data-slot="sidebar-container"]');

    expect(wrapper).not.toBeNull();
    expect(container).not.toBeNull();
    // The fixed off-canvas geometry is gone: the panel is an ordinary flex
    // child sized by its parent rather than by `--sidebar-width`.
    expect(getComputedStyle(container!).position).not.toBe("fixed");
    expect(wrapper!.getBoundingClientRect().width).toBeCloseTo(900, 0);
    expect(container!.getBoundingClientRect().width).toBeCloseTo(900, 0);
    expect(host.querySelector('[data-slot="sidebar-rail"]')).toBeNull();
  });
});
