import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { useUiStateStore } from "../../uiStateStore";
import { ComposerFooterModeControls } from "./ComposerFooter";

const baseProps = {
  showInteractionModeToggle: true,
  askModeSupported: true,
  interactionMode: "default" as const,
  runtimeMode: "full-access" as const,
  tokenMode: "balanced" as const,
  showPlanToggle: true,
  planSidebarLabel: "Plan",
  planSidebarOpen: false,
  onInteractionModeChange: vi.fn(),
  onRuntimeModeChange: vi.fn(),
  onTokenModeChange: vi.fn(),
  onTogglePlanSidebar: vi.fn(),
};

// Must exceed ChatComposer's select reopen suppression window.
const POPUP_CLOSE_VERIFICATION_DELAY_MS = 350;

function expectSelectPopupClosed() {
  const popup = document.querySelector<HTMLElement>('[data-slot="select-popup"]');
  expect(popup === null || popup.hasAttribute("data-closed")).toBe(true);
}

function expectExpandableLabelExpanded(triggerLabel: string, expanded: boolean) {
  const label = document.querySelector<HTMLElement>(
    `[aria-label="${triggerLabel}"] [data-composer-expandable-label="true"]`,
  );
  expect(label?.classList.contains("max-w-40")).toBe(expanded);
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

  it("renders the composer mode controls without visual dividers", async () => {
    mounted = await render(<ComposerFooterModeControls {...baseProps} />);

    expect(document.querySelector('[data-slot="separator"]')).toBeNull();
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

  it("keeps select labels expanded while popups are open and close suppression is active", async () => {
    mounted = await render(<ComposerFooterModeControls {...baseProps} />);

    await page.getByLabelText("Runtime mode: Full access").click();
    await vi.waitFor(() => {
      expectExpandableLabelExpanded("Runtime mode: Full access", true);
    });
    await page.getByRole("option", { name: /Supervised/ }).click();
    await vi.waitFor(() => expectSelectPopupClosed());
    expectExpandableLabelExpanded("Runtime mode: Full access", true);
    await wait(POPUP_CLOSE_VERIFICATION_DELAY_MS);
    expectExpandableLabelExpanded("Runtime mode: Full access", false);

    await page.getByLabelText("Token mode: Balanced").click();
    await vi.waitFor(() => {
      expectExpandableLabelExpanded("Token mode: Balanced", true);
    });
    await page.getByRole("option", { name: /Balanced/ }).click();
    await vi.waitFor(() => expectSelectPopupClosed());
    expectExpandableLabelExpanded("Token mode: Balanced", true);
    await wait(POPUP_CLOSE_VERIFICATION_DELAY_MS);
    expectExpandableLabelExpanded("Token mode: Balanced", false);
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
    await wait(POPUP_CLOSE_VERIFICATION_DELAY_MS);
    expectSelectPopupClosed();
  });

  it("selects ask mode from the interaction mode popup when supported", async () => {
    const onInteractionModeChange = vi.fn();
    mounted = await render(
      <ComposerFooterModeControls
        {...baseProps}
        onInteractionModeChange={onInteractionModeChange}
      />,
    );

    await page.getByLabelText("Interaction mode: Build").click();
    await page.getByRole("option", { name: /Ask/ }).click();

    await vi.waitFor(() => {
      expect(onInteractionModeChange).toHaveBeenCalledWith("ask");
    });
    await vi.waitFor(() => {
      expectSelectPopupClosed();
    });
  });

  it("disables the ask option with an explanation when unsupported", async () => {
    const onInteractionModeChange = vi.fn();
    mounted = await render(
      <ComposerFooterModeControls
        {...baseProps}
        askModeSupported={false}
        onInteractionModeChange={onInteractionModeChange}
      />,
    );

    await page.getByLabelText("Interaction mode: Build").click();
    await vi.waitFor(() => {
      const askOption = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
      ).find((item) => item.textContent?.includes("Ask"));
      expect(askOption?.hasAttribute("data-disabled")).toBe(true);
      expect(askOption?.textContent).toContain("Not supported by this provider.");
    });
    expect(onInteractionModeChange).not.toHaveBeenCalled();
  });

  it("closes token mode popup after selecting the current value again", async () => {
    mounted = await render(<ComposerFooterModeControls {...baseProps} />);

    await page.getByLabelText("Token mode: Balanced").click();
    await page.getByRole("option", { name: /Balanced/ }).click();

    await vi.waitFor(() => {
      expectSelectPopupClosed();
    });
    await wait(POPUP_CLOSE_VERIFICATION_DELAY_MS);
    expectSelectPopupClosed();
  });
});
