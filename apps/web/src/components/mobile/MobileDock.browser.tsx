// Production CSS is part of the behavior under test: the dock's anchoring, its
// 44px control floor and the density padding are all CSS.
import "../../index.css";

import { PlusIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import {
  cdpSession,
  resetPointerEmulation,
  setCoarsePointerEmulation,
} from "../../../test/browserPointer";
import { installVisualViewportStub } from "../../../test/browserVisualViewport";
import { syncDocumentVisualViewportInsets } from "../../lib/visualViewportInsets";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  applyAppearancePreferencesToDocument,
  setAppearancePreference,
} from "../../themes/appearancePreferences";
import { MobileDock, type MobileDockAction } from "./MobileDock";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
const NARROW_VIEWPORT = { width: 320, height: 568 } as const;

function dockElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="mobile-dock"]');
}

function dockLayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="mobile-dock-layer"]');
}

function dockActions(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-slot="mobile-dock-action"]')];
}

function actions(overrides: Partial<MobileDockAction> = {}): MobileDockAction[] {
  return [
    {
      id: "search",
      label: "Search threads",
      shortLabel: "Search",
      icon: <SearchIcon aria-hidden className="size-4 shrink-0" />,
      onSelect: () => {},
    },
    {
      id: "new",
      label: "New thread",
      icon: <PlusIcon aria-hidden className="size-4 shrink-0" />,
      onSelect: () => {},
      ...overrides,
    },
    {
      id: "settings",
      label: "Open settings",
      shortLabel: "Settings",
      icon: <SettingsIcon aria-hidden className="size-4 shrink-0" />,
      onSelect: () => {},
    },
  ];
}

describe("MobileDock", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await cdpSession().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "" }],
    });
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    applyAppearancePreferencesToDocument();
    await page.viewport(1_280, 720);
  });

  it("measures at least 44px on both axes at every density under coarse-pointer emulation", async () => {
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
    mounted = await render(<MobileDock label="Home actions" actions={actions()} />);
    expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);

    for (const density of ["comfortable", "compact"] as const) {
      setAppearancePreference("dockDensity", density);
      applyAppearancePreferencesToDocument();
      const rendered = dockActions();
      expect(rendered).toHaveLength(3);
      for (const action of rendered) {
        const rect = action.getBoundingClientRect();
        expect(
          rect.width,
          `${density}: width of "${action.textContent?.trim()}"`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          rect.height,
          `${density}: height of "${action.textContent?.trim()}"`,
        ).toBeGreaterThanOrEqual(44);
      }
    }

    // Compact reduces the capsule's padding, never the target size — the two
    // densities differ by the capsule box alone.
    setAppearancePreference("dockDensity", "comfortable");
    applyAppearancePreferencesToDocument();
    const comfortable = dockElement()!.getBoundingClientRect().height;
    setAppearancePreference("dockDensity", "compact");
    applyAppearancePreferencesToDocument();
    const compact = dockElement()!.getBoundingClientRect().height;
    expect(compact).toBeLessThan(comfortable);
    expect(compact).toBeGreaterThanOrEqual(44);
  });

  it("floats above the safe area as an overlay and never introduces horizontal page overflow", async () => {
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    mounted = await render(
      <div style={{ height: "2000px" }}>
        <MobileDock label="Home actions" actions={actions()} />
      </div>,
    );

    const layer = dockLayer()!;
    const capsule = dockElement()!;
    // Overlay, not layout: the positioning layer is fixed and inert, so
    // content runs full-bleed underneath everywhere the capsule does not sit.
    expect(getComputedStyle(layer).position).toBe("fixed");
    expect(getComputedStyle(layer).pointerEvents).toBe("none");
    expect(getComputedStyle(capsule).pointerEvents).toBe("auto");

    const rect = capsule.getBoundingClientRect();
    // The design's 16px float above the (zero, in emulation) bottom safe area.
    expect(NARROW_VIEWPORT.height - rect.bottom).toBeGreaterThanOrEqual(15);
    expect(NARROW_VIEWPORT.height - rect.bottom).toBeLessThanOrEqual(17);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(NARROW_VIEWPORT.width + 0.5);

    // The strip inside the capsule scrolls; the page does not.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(NARROW_VIEWPORT.width);
    expect(document.body.scrollWidth).toBeLessThanOrEqual(NARROW_VIEWPORT.width);
  });

  it("rides the software keyboard from the shared visual-viewport adapter", async () => {
    const viewportStub = installVisualViewportStub();
    const stopAdapter = syncDocumentVisualViewportInsets();
    try {
      await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
      mounted = await render(<MobileDock label="Home actions" actions={actions()} />);
      const capsule = dockElement()!;
      const closedBottom = capsule.getBoundingClientRect().bottom;

      viewportStub.setKeyboardInset(300);
      await vi.waitFor(() => {
        expect(capsule.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          closedBottom - 300 + 0.5,
        );
      });

      viewportStub.setKeyboardInset(0);
      await vi.waitFor(() => {
        expect(capsule.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(closedBottom - 0.5);
      });
    } finally {
      stopAdapter();
      viewportStub.restore();
    }
  });

  it("takes the larger of the keyboard inset and the bottom safe area, never their sum", async () => {
    // Chromium reports a zero safe area, under which `max(a, b)` and `a + b`
    // are indistinguishable — which is exactly how a dock that floats a whole
    // home indicator too high on real hardware would ship unnoticed. The safe
    // area therefore travels through its own variable so a real device inset
    // can be substituted here.
    const SAFE_AREA = 34;
    const KEYBOARD = 300;
    const viewportStub = installVisualViewportStub();
    const stopAdapter = syncDocumentVisualViewportInsets();
    document.documentElement.style.setProperty("--app-dock-safe-area-bottom", `${SAFE_AREA}px`);
    try {
      await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
      mounted = await render(<MobileDock label="Home actions" actions={actions()} />);
      const capsule = dockElement()!;

      // Keyboard closed: the safe area alone, plus the design's 16px float.
      await vi.waitFor(() => {
        expect(PHONE_VIEWPORT.height - capsule.getBoundingClientRect().bottom).toBeCloseTo(
          SAFE_AREA + 16,
          0,
        );
      });

      // Keyboard open: the keyboard inset alone, because it is measured as
      // layout-viewport overlap and already spans the home indicator. Summing
      // would put the gap at 350 instead of 316.
      viewportStub.setKeyboardInset(KEYBOARD);
      await vi.waitFor(() => {
        expect(PHONE_VIEWPORT.height - capsule.getBoundingClientRect().bottom).toBeCloseTo(
          KEYBOARD + 16,
          0,
        );
      });

      // The scroll clearance a surface reserves is derived from the same
      // variable, so it moves with the dock rather than over-padding by a
      // whole safe area.
      const probe = document.createElement("div");
      probe.className = "app-dock-scroll-clearance";
      document.body.append(probe);
      const clearance = Number.parseFloat(getComputedStyle(probe).paddingBottom);
      probe.remove();
      // The inset, the 44px control floor, the density padding on both sides,
      // and the 8px visual gap — with the keyboard inset counted once, not
      // added to the safe area.
      expect(clearance).toBeCloseTo(KEYBOARD + 16 + 44 + 8 * 2 + 8, 0);
      // …and it genuinely clears the rendered capsule and the gap it floats
      // over, which is the property the arithmetic exists to deliver.
      const capsuleRect = capsule.getBoundingClientRect();
      expect(clearance).toBeGreaterThanOrEqual(
        capsuleRect.height + (PHONE_VIEWPORT.height - capsuleRect.bottom),
      );
    } finally {
      document.documentElement.style.removeProperty("--app-dock-safe-area-bottom");
      stopAdapter();
      viewportStub.restore();
    }
  });

  it("renders on the dock material tier and honours prefers-reduced-motion", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mounted = await render(<MobileDock label="Home actions" actions={actions()} />);
    const capsule = dockElement()!;

    setAppearancePreference("surfaceTransparency", "default");
    applyAppearancePreferencesToDocument();
    expect(getComputedStyle(capsule).backdropFilter).toBe("none");

    setAppearancePreference("surfaceTransparency", "glass");
    applyAppearancePreferencesToDocument();
    const glass = getComputedStyle(capsule);
    // The dock's own blur radius: between the chip's and the sheet's.
    expect(glass.backdropFilter).toContain("blur(21px)");

    await cdpSession().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await vi.waitFor(() => {
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    });
    // Nothing here waits on a transition, and the reduced setting collapses the
    // only one the dock has.
    expect(getComputedStyle(dockActions()[0]!).transitionProperty).toBe("none");
  });

  it("labels every control, announces toggle state, and reports a disabled action", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const onSelect = vi.fn();
    mounted = await render(
      <MobileDock
        label="Home actions"
        actions={[
          ...actions({ disabled: true }),
          {
            id: "workspace",
            label: "Toggle workspace panel",
            shortLabel: "Workspace",
            pressed: true,
            onSelect,
          },
        ]}
      />,
    );

    // Every control carries its accessible name, and the visible short label is
    // contained in it (WCAG 2.5.3).
    for (const [name, visible] of [
      ["Search threads", "Search"],
      ["Open settings", "Settings"],
      ["Toggle workspace panel", "Workspace"],
    ] as const) {
      const control = page.getByRole("button", { name }).element() as HTMLElement;
      expect(control.textContent?.trim()).toBe(visible);
      expect(name.toLowerCase()).toContain(visible.toLowerCase());
    }

    // A group name, not a navigation landmark: the dock is not a tab bar and
    // exposes no tablist, tab, or navigation role.
    expect(document.querySelector('[data-slot="mobile-dock"] [role="tablist"]')).toBeNull();
    expect(document.querySelector('[data-slot="mobile-dock"] [role="tab"]')).toBeNull();
    expect(document.querySelector('[data-slot="mobile-dock"] nav')).toBeNull();
    await expect.element(page.getByRole("group", { name: "Home actions" })).toBeVisible();

    const newThread = page.getByRole("button", { name: "New thread" }).element();
    expect((newThread as HTMLButtonElement).disabled).toBe(true);

    const workspace = page.getByRole("button", { name: "Toggle workspace panel" });
    expect((workspace.element() as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    await workspace.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
