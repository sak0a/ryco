import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  ACTIVE_THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  THEME_STYLE_ELEMENT_ID,
} from "../../themes/registry";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID,
  FONT_FAMILY_MONO_OPTIONS,
  FONT_FAMILY_SANS_OPTIONS,
} from "../../themes/appearancePreferences";
import { AppearanceSettingsPanel } from "./AppearanceSettings";

describe("AppearanceSettingsPanel", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.getElementById(THEME_STYLE_ELEMENT_ID)?.remove();
    document.getElementById(APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID)?.remove();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = "";
    document.documentElement.className = "";
    document.getElementById(THEME_STYLE_ELEMENT_ID)?.remove();
    document.getElementById(APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID)?.remove();
  });

  it("lists built-in themes and applies a selected built-in theme", async () => {
    mounted = await render(<AppearanceSettingsPanel />);

    await expect.element(page.getByRole("radio", { name: /Default/ })).toBeInTheDocument();
    await expect.element(page.getByText("Solarized Dark", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Nord", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("One Dark Pro", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Dracula", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("GitHub", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Catppuccin", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Tokyo Night", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Monokai", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Gruvbox Material", { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByText("Cursor Dark Inspired", { exact: true }))
      .toBeInTheDocument();

    await page.getByRole("radio", { name: /Nord/ }).click();

    expect(localStorage.getItem(ACTIVE_THEME_STORAGE_KEY)).toBe("nord");
    await vi.waitFor(() => {
      expect(document.getElementById(THEME_STYLE_ELEMENT_ID)?.textContent).toContain("#2e3440");
    });

    await page.getByRole("radio", { name: /One Dark Pro/ }).click();

    expect(localStorage.getItem(ACTIVE_THEME_STORAGE_KEY)).toBe("one-dark-pro");
    await vi.waitFor(() => {
      expect(document.getElementById(THEME_STYLE_ELEMENT_ID)?.textContent).toContain("#282c34");
    });
  });

  it("adds, duplicates, and deletes custom themes", async () => {
    mounted = await render(<AppearanceSettingsPanel />);

    await page.getByRole("button", { name: "Create a new theme" }).click();
    await expect.element(page.getByRole("radio", { name: /New theme/ })).toBeInTheDocument();
    expect(localStorage.getItem(ACTIVE_THEME_STORAGE_KEY)).toBe("custom-new");

    await page.getByRole("button", { name: /Duplicate Default/ }).click();
    await expect.element(page.getByRole("radio", { name: /Default \(Copy\)/ })).toBeInTheDocument();

    await page.getByRole("button", { name: "Delete New theme" }).click();
    await expect.element(page.getByText("Delete custom theme?")).toBeInTheDocument();
    await page.getByRole("button", { name: "Delete theme" }).click();

    await expect.element(page.getByRole("radio", { name: /New theme/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY)).not.toContain("custom-new");
  });

  it("persists global interface controls outside the active theme", async () => {
    mounted = await render(<AppearanceSettingsPanel />);

    const interfaceFontLabel = "Geist";
    const codeFontLabel = "Geist Mono";
    const interfaceFontValue = FONT_FAMILY_SANS_OPTIONS.find(
      (option) => option.label === interfaceFontLabel,
    )?.value;
    const codeFontValue = FONT_FAMILY_MONO_OPTIONS.find(
      (option) => option.label === codeFontLabel,
    )?.value;

    await expect.element(page.getByText("Interface controls")).toBeInTheDocument();
    await page.getByRole("radio", { name: `Use ${interfaceFontLabel} for interface font` }).click();
    await page.getByRole("radio", { name: `Use ${codeFontLabel} for code font` }).click();
    await page.getByRole("button", { name: "Set text size to Large" }).click();
    await page.getByRole("button", { name: "Set corner radius to Square" }).click();

    await vi.waitFor(() => {
      expect(interfaceFontValue).toBeDefined();
      expect(codeFontValue).toBeDefined();
      expect(JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY) ?? "{}")).toEqual(
        expect.objectContaining({
          fontFamilySans: interfaceFontValue,
          fontFamilyMono: codeFontValue,
          fontSizeBase: "18px",
          radius: "0rem",
        }),
      );
    });

    const style = document.getElementById(APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID);
    expect(style?.textContent).toContain('--font-family-sans: "Geist"');
    expect(style?.textContent).toContain('--font-family-mono: "Geist Mono"');
    expect(style?.textContent).toContain("--font-size-base: 18px");
    expect(style?.textContent).toContain("--radius: 0rem");

    await expect
      .element(page.getByRole("button", { name: "Reset interface font to default" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Reset code font to default" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Reset text size to default" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Reset corner radius to default" }))
      .toBeInTheDocument();
  });
});
