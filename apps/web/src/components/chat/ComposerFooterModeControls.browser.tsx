import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { useUiStateStore } from "../../uiStateStore";
import { ComposerFooterModeControls } from "./ChatComposer";

const baseProps = {
  showInteractionModeToggle: true,
  interactionMode: "default" as const,
  runtimeMode: "full-access" as const,
  tokenMode: "balanced" as const,
  showPlanToggle: true,
  planSidebarLabel: "Plan",
  planSidebarOpen: false,
  onToggleInteractionMode: vi.fn(),
  onRuntimeModeChange: vi.fn(),
  onTokenModeChange: vi.fn(),
  onTogglePlanSidebar: vi.fn(),
};

function expectSelectPopupClosed() {
  const popup = document.querySelector<HTMLElement>('[data-slot="select-popup"]');
  expect(popup === null || popup.hasAttribute("data-closed")).toBe(true);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

describe("ComposerFooterModeControls", () => {
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
    useUiStateStore.getState().setWideComposerControlsAutoCollapse(true);
    useUiStateStore.getState().setTokenModeControlStyle("icon-text");
  });

  it("collapses all wide mode labels by default", async () => {
    useUiStateStore.getState().setWideComposerControlsAutoCollapse(true);

    mounted = await render(<ComposerFooterModeControls {...baseProps} />);

    await vi.waitFor(() => {
      const controls = document.querySelectorAll(
        '[data-composer-expandable-label-control="true"][data-collapsed="true"]',
      );
      expect(controls.length).toBe(4);
    });
  });

  it("overrides token mode style while auto-collapse is enabled", async () => {
    useUiStateStore.getState().setWideComposerControlsAutoCollapse(true);
    useUiStateStore.getState().setTokenModeControlStyle("text");

    mounted = await render(<ComposerFooterModeControls {...baseProps} />);

    await vi.waitFor(() => {
      const tokenTrigger = document.querySelector('[aria-label="Token mode: Balanced"]');
      const tokenControl = tokenTrigger?.querySelector(
        '[data-composer-expandable-label-control="true"]',
      );
      expect(tokenControl?.getAttribute("data-collapsed")).toBe("true");
      expect(tokenTrigger?.textContent).toContain("Balanced");
    });
  });

  it("preserves token mode style when auto-collapse is disabled", async () => {
    useUiStateStore.getState().setWideComposerControlsAutoCollapse(false);
    useUiStateStore.getState().setTokenModeControlStyle("icon");

    mounted = await render(<ComposerFooterModeControls {...baseProps} />);

    await vi.waitFor(() => {
      const tokenTrigger = document.querySelector('[aria-label="Token mode: Balanced"]');
      expect(
        tokenTrigger?.querySelector('[data-composer-expandable-label-control="true"]'),
      ).toBeNull();
      expect(tokenTrigger?.textContent).not.toContain("Balanced");
    });
  });

  it("closes runtime mode popup after selecting a different value", async () => {
    const onRuntimeModeChange = vi.fn();
    mounted = await render(
      <ComposerFooterModeControls {...baseProps} onRuntimeModeChange={onRuntimeModeChange} />,
    );

    await page.getByLabelText("Runtime mode: Full access").click();
    await page.getByRole("option", { name: /Supervised/ }).click();

    await vi.waitFor(() => {
      expect(onRuntimeModeChange).toHaveBeenCalledWith("approval-required");
    });
    await vi.waitFor(() => {
      expectSelectPopupClosed();
    });
    await wait(350);
    expectSelectPopupClosed();
  });

  it("closes token mode popup after selecting the current value again", async () => {
    mounted = await render(<ComposerFooterModeControls {...baseProps} />);

    await page.getByLabelText("Token mode: Balanced").click();
    await page.getByRole("option", { name: /Balanced/ }).click();

    await vi.waitFor(() => {
      expectSelectPopupClosed();
    });
    await wait(350);
    expectSelectPopupClosed();
  });
});
