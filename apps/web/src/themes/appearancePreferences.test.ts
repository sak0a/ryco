import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID,
  DEFAULT_APPEARANCE_PREFERENCES,
  applyAppearancePreferencesToDocument,
  getAppearancePreferences,
  hasAppearancePreferenceOverride,
  resetAppearancePreference,
  setAppearancePreference,
} from "./appearancePreferences";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function installLocalStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}

function uninstallLocalStorage() {
  Reflect.deleteProperty(globalThis, "localStorage");
}

describe("appearance preferences", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    uninstallLocalStorage();
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "HTMLStyleElement");
  });

  it("returns defaults when no overrides are stored", () => {
    expect(getAppearancePreferences()).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    expect(hasAppearancePreferenceOverride("fontFamilySans")).toBe(false);
    expect(hasAppearancePreferenceOverride("fontFamilyMono")).toBe(false);
    expect(hasAppearancePreferenceOverride("fontSizeBase")).toBe(false);
    expect(hasAppearancePreferenceOverride("radius")).toBe(false);
    expect(hasAppearancePreferenceOverride("surfaceTransparency")).toBe(false);
  });

  it("persists only non-default values and removes defaults", () => {
    setAppearancePreference("fontSizeBase", "18px");
    expect(getAppearancePreferences().fontSizeBase).toBe("18px");
    expect(hasAppearancePreferenceOverride("fontSizeBase")).toBe(true);
    expect(localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY)).toContain("18px");

    setAppearancePreference("fontSizeBase", DEFAULT_APPEARANCE_PREFERENCES.fontSizeBase);
    expect(getAppearancePreferences().fontSizeBase).toBe(
      DEFAULT_APPEARANCE_PREFERENCES.fontSizeBase,
    );
    expect(localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it("ignores invalid stored values and invalid writes", () => {
    localStorage.setItem(
      APPEARANCE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        fontFamilySans: "Comic Sans MS",
        fontFamilyMono: "Papyrus",
        fontSizeBase: "500px",
        radius: "url(javascript:alert(1))",
        surfaceTransparency: "invisible",
      }),
    );
    expect(getAppearancePreferences()).toEqual(DEFAULT_APPEARANCE_PREFERENCES);

    setAppearancePreference("fontFamilySans", "serif");
    setAppearancePreference("radius", "999rem");
    setAppearancePreference("surfaceTransparency", "opaque");
    expect(getAppearancePreferences().fontFamilySans).toBe(
      DEFAULT_APPEARANCE_PREFERENCES.fontFamilySans,
    );
    expect(getAppearancePreferences().radius).toBe(DEFAULT_APPEARANCE_PREFERENCES.radius);
    expect(getAppearancePreferences().surfaceTransparency).toBe(
      DEFAULT_APPEARANCE_PREFERENCES.surfaceTransparency,
    );
  });

  it("resets a single preference without touching the other", () => {
    setAppearancePreference(
      "fontFamilySans",
      '"Geist", "Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    setAppearancePreference("fontSizeBase", "18px");
    setAppearancePreference("radius", "0rem");
    setAppearancePreference("surfaceTransparency", "high");

    resetAppearancePreference("radius");

    expect(getAppearancePreferences()).toEqual({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      fontFamilySans:
        '"Geist", "Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSizeBase: "18px",
      surfaceTransparency: "high",
    });
  });

  it("applies preferences through a dedicated style tag", () => {
    class FakeStyle {
      id = "";
      textContent = "";
    }
    const appended: FakeStyle[] = [];
    Object.defineProperty(globalThis, "HTMLStyleElement", {
      configurable: true,
      value: FakeStyle,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementById: (id: string) => appended.find((node) => node.id === id) ?? null,
        createElement: () => new FakeStyle(),
        head: {
          append: (node: FakeStyle) => {
            const existingIndex = appended.indexOf(node);
            if (existingIndex >= 0) appended.splice(existingIndex, 1);
            appended.push(node);
          },
        },
      },
    });

    setAppearancePreference("fontSizeBase", "18px");
    setAppearancePreference("radius", "0rem");
    setAppearancePreference("surfaceTransparency", "high");
    applyAppearancePreferencesToDocument();

    const style = appended.find((node) => node.id === APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID);
    expect(style?.textContent).toContain(
      '--font-family-sans: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;',
    );
    expect(style?.textContent).toContain(
      '--font-family-mono: "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;',
    );
    expect(style?.textContent).toContain("--radius: 0rem;");
    expect(style?.textContent).toContain("--radius-sm: 0px !important;");
    expect(style?.textContent).toContain("--radius-4xl: 0px !important;");
    expect(style?.textContent).toContain("--font-size-base: 18px;");
    expect(style?.textContent).toContain("--app-surface-opacity: 76%;");
    expect(style?.textContent).toContain("--app-dialog-viewport-light-alpha: 32.4%;");
  });
});
