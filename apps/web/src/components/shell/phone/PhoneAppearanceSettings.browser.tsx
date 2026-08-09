// The material and motion tokens are CSS, and the 44px rows are a class, so
// the production stylesheet is part of the behaviour under test.
import "../../../index.css";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { cdpSession } from "../../../../test/browserPointer";
import { syncDocumentPresentationTier } from "../../../lib/presentationTier";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  applyAppearancePreferencesToDocument,
  syncAppearancePreferenceEnvironment,
} from "../../../themes/appearancePreferences";
import { PhoneAppearanceSettings } from "./PhoneAppearanceSettings";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

function groupRows(): HTMLButtonElement[] {
  const group = document.querySelector('[aria-label="Phone appearance"]');
  return [...(group?.querySelectorAll<HTMLButtonElement>('[data-slot="mobile-list-row"]') ?? [])];
}

function groupRow(label: string): HTMLButtonElement {
  const row = groupRows().find((candidate) => candidate.textContent?.startsWith(label));
  expect(row, `missing "${label}" row`).toBeDefined();
  return row!;
}

/** The rows inside the open option sheet, which portals outside the group. */
function sheetRows(): HTMLButtonElement[] {
  const sheet = document.querySelector("[data-mobile-sheet]");
  return [...(sheet?.querySelectorAll<HTMLButtonElement>('[data-slot="mobile-list-row"]') ?? [])];
}

async function openSheet(label: string): Promise<void> {
  groupRow(label).click();
  await vi.waitFor(() => {
    expect(sheetRows().length).toBeGreaterThan(0);
  });
}

async function chooseOption(label: string): Promise<void> {
  const option = sheetRows().find((candidate) => candidate.textContent?.startsWith(label));
  expect(option, `missing "${label}" option`).toBeDefined();
  option!.click();
  await vi.waitFor(() => {
    expect(document.querySelector("[data-mobile-sheet]")).toBeNull();
  });
}

function storedPreferences(): Record<string, string> {
  return JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY) ?? "{}");
}

function rootVariable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function setEmulatedMedia(features: Array<{ name: string; value: string }>): Promise<void> {
  await cdpSession().send("Emulation.setEmulatedMedia", { features });
}

describe("PhoneAppearanceSettings", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;
  let stopEnvironment: (() => void) | null = null;

  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    // The production wiring: the effective preferences are republished when the
    // tier or a media input changes, never by writing a stored value.
    stopEnvironment = syncAppearancePreferenceEnvironment();
  });

  afterEach(async () => {
    stopEnvironment?.();
    stopEnvironment = null;
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    await setEmulatedMedia([
      { name: "prefers-reduced-transparency", value: "" },
      { name: "prefers-reduced-motion", value: "" },
    ]);
    await page.viewport(1_280, 720);
    applyAppearancePreferencesToDocument();
  });

  it("defaults Material to Standard on the phone tier without storing anything", async () => {
    mounted = await render(<PhoneAppearanceSettings />);

    expect(groupRows()).toHaveLength(4);
    for (const row of groupRows()) {
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(groupRow("Material").textContent).toContain("Standard");
    // A tier default, not a stored value.
    expect(storedPreferences().surfaceTransparency).toBeUndefined();
    // …and it is what actually renders.
    expect(rootVariable("--app-surface-opacity")).toBe("87.2%");
  });

  it("writes the one transparency key from the three-option Material sheet", async () => {
    mounted = await render(<PhoneAppearanceSettings />);

    await openSheet("Material");
    expect(sheetRows().map((row) => row.textContent?.replace(/([a-z])([A-Z])/gu, "$1|$2"))).toEqual(
      ["Solid|Opaque, no blur", "Standard|Single layer", "Glass|Thin material"],
    );

    await chooseOption("Glass");
    expect(storedPreferences()).toEqual({ surfaceTransparency: "glass" });
    await vi.waitFor(() => {
      expect(groupRow("Material").textContent).toContain("Glass");
    });
    // The sheet tier's material tokens follow the step.
    expect(rootVariable("--app-glass-sheet-filter")).toContain("blur(");
    expect(rootVariable("--app-glass-sheet-dark-scrim-alpha")).not.toBe("0%");

    // Solid equals the desktop default, so it must still persist: otherwise the
    // phone tier's own default would immediately override the choice.
    await openSheet("Material");
    await chooseOption("Solid");
    expect(storedPreferences()).toEqual({ surfaceTransparency: "default" });
    await vi.waitFor(() => {
      expect(groupRow("Material").textContent).toContain("Solid");
    });
    expect(rootVariable("--app-glass-sheet-filter")).toBe("none");
  });

  it("shows the selection and reports the system override, and never writes it back", async () => {
    mounted = await render(<PhoneAppearanceSettings />);
    await openSheet("Material");
    await chooseOption("Glass");
    expect(storedPreferences()).toEqual({ surfaceTransparency: "glass" });

    await setEmulatedMedia([{ name: "prefers-reduced-transparency", value: "reduce" }]);
    // The row keeps showing the real choice and states the override, rather
    // than substituting the forced step as though it had been selected.
    await vi.waitFor(() => {
      expect(groupRow("Material").textContent).toContain("System reduce transparency is on");
    });
    expect(groupRow("Material").textContent).toContain("Glass");

    // The forced step is therefore not what a tap writes: re-selecting the
    // displayed selection is a no-op, and tapping the row that *renders* while
    // the override is on cannot silently overwrite the stored choice.
    await openSheet("Material");
    const checked = sheetRows().filter((row) => row.getAttribute("aria-pressed") === "true");
    expect(checked.map((row) => row.textContent?.startsWith("Glass"))).toEqual([true]);
    await chooseOption("Glass");
    expect(storedPreferences()).toEqual({ surfaceTransparency: "glass" });

    // The material is still forced opaque — in CSS, where the override lives.
    const surface = document.createElement("div");
    surface.className = "app-glass-surface app-glass-surface-sheet";
    document.body.append(surface);
    const style = getComputedStyle(surface);
    expect(style.backdropFilter).toBe("none");
    expect(style.backgroundColor.match(/[\d.]+/gu)?.length ?? 3).toBe(3);
    surface.remove();

    await setEmulatedMedia([{ name: "prefers-reduced-transparency", value: "" }]);
    await vi.waitFor(() => {
      expect(groupRow("Material").textContent).not.toContain("System reduce transparency is on");
    });
    expect(groupRow("Material").textContent).toContain("Glass");
    expect(storedPreferences()).toEqual({ surfaceTransparency: "glass" });
  });

  it("names a stored step the phone does not offer, and checks none of its own", async () => {
    // `light` and `high` are reachable from the Appearance panel that the phone
    // settings surface also renders, so the three-option projection must state
    // the real step instead of rendering blank.
    for (const [value, label] of [
      ["light", "Light"],
      ["high", "High"],
    ] as const) {
      localStorage.setItem(
        APPEARANCE_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ surfaceTransparency: value }),
      );
      applyAppearancePreferencesToDocument();
      await mounted?.unmount();
      mounted = await render(<PhoneAppearanceSettings />);

      await vi.waitFor(() => {
        expect(groupRow("Material").textContent).toContain(label);
      });
      await openSheet("Material");
      expect(sheetRows().filter((row) => row.getAttribute("aria-pressed") === "true")).toEqual([]);
      // The sheet says why nothing is checked.
      expect(document.querySelector("[data-mobile-sheet]")?.textContent).toContain(
        `Currently ${label}.`,
      );
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() => {
        expect(document.querySelector("[data-mobile-sheet]")).toBeNull();
      });
      // Opening and dismissing the sheet never rewrote the off-subset step.
      expect(storedPreferences()).toEqual({ surfaceTransparency: value });
    }
  });

  it("writes Dock density as its own key and moves only the capsule padding", async () => {
    mounted = await render(<PhoneAppearanceSettings />);
    // Comfortable is the unstored default, and it is what renders.
    expect(groupRow("Dock density").textContent).toContain("Comfortable");
    expect(storedPreferences().dockDensity).toBeUndefined();
    expect(rootVariable("--app-dock-padding")).toBe("8px");
    // The control floor is a fixed pixel minimum, so no density touches it.
    const controlSize = rootVariable("--app-dock-control-size");
    expect(controlSize).toBe("44px");

    await openSheet("Dock density");
    await chooseOption("Compact");
    // One key, no second scale: nothing else moved.
    expect(storedPreferences()).toEqual({ dockDensity: "compact" });
    await vi.waitFor(() => {
      expect(groupRow("Dock density").textContent).toContain("Compact");
    });
    expect(rootVariable("--app-dock-padding")).toBe("4px");
    expect(rootVariable("--app-dock-control-size")).toBe(controlSize);
  });

  it("collapses the motion durations beyond the OS setting", async () => {
    mounted = await render(<PhoneAppearanceSettings />);
    expect(rootVariable("--app-motion-duration-sheet")).toBe("200ms");
    expect(rootVariable("--app-motion-ease")).toBe("cubic-bezier(0.16, 1, 0.3, 1)");

    await openSheet("Motion");
    await chooseOption("Reduced");
    expect(storedPreferences()).toEqual({ motion: "reduce" });
    expect(rootVariable("--app-motion-duration-sheet")).toBe("0ms");
    expect(rootVariable("--app-motion-duration-stack")).toBe("0ms");
    expect(rootVariable("--app-motion-duration-chip")).toBe("0ms");
  });

  it("survives the largest text size with no hidden control and no horizontal overflow", async () => {
    await page.viewport(320, 568);
    mounted = await render(<PhoneAppearanceSettings />);

    await openSheet("Text size");
    await chooseOption("Display");
    expect(storedPreferences()).toEqual({ fontSizeBase: "20px" });
    await vi.waitFor(() => {
      expect(rootVariable("--font-size-base")).toBe("20px");
    });

    expect(groupRows()).toHaveLength(4);
    for (const row of groupRows()) {
      const rect = row.getBoundingClientRect();
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.right).toBeLessThanOrEqual(320 + 0.5);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });
});
