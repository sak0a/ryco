import { describe, expect, it } from "vite-plus/test";

import type { ThemeDefinition } from "../../themes/types";
import { setThemeDescription, setThemeName, setTokenValue } from "./ThemeEditor";

const BASE: ThemeDefinition = {
  id: "test",
  name: "Test",
  builtIn: false,
};

describe("setTokenValue", () => {
  it("sets a token on the requested variant without mutating the source", () => {
    const next = setTokenValue(BASE, "dark", "primary", "#ff0000");
    expect(next).not.toBe(BASE);
    expect(next.dark).toEqual({ primary: "#ff0000" });
    expect(BASE.dark).toBeUndefined();
  });

  it("removes a token when the value is empty", () => {
    const seeded: ThemeDefinition = {
      ...BASE,
      light: { primary: "#abc", background: "#fff" },
    };
    const next = setTokenValue(seeded, "light", "primary", "");
    expect(next.light).toEqual({ background: "#fff" });
  });

  it("merges into the same variant only", () => {
    const seeded: ThemeDefinition = {
      ...BASE,
      light: { primary: "#abc" },
      dark: { primary: "#def" },
    };
    const next = setTokenValue(seeded, "light", "background", "#fff");
    expect(next.light).toEqual({ primary: "#abc", background: "#fff" });
    expect(next.dark).toEqual({ primary: "#def" });
  });

  it("stores legacy global appearance tokens with the same shape as colors", () => {
    const withFont = setTokenValue(BASE, "light", "font-family-sans", "Inter, sans-serif");
    expect(withFont.light).toEqual({ "font-family-sans": "Inter, sans-serif" });
    const withSize = setTokenValue(withFont, "light", "font-size-base", "18px");
    expect(withSize.light).toEqual({
      "font-family-sans": "Inter, sans-serif",
      "font-size-base": "18px",
    });
  });
});

describe("setThemeName", () => {
  it("returns a new theme with the updated name", () => {
    const next = setThemeName(BASE, "Renamed");
    expect(next.name).toBe("Renamed");
    expect(BASE.name).toBe("Test");
  });
});

describe("setThemeDescription", () => {
  it("sets the description when non-empty", () => {
    const next = setThemeDescription(BASE, "A theme");
    expect(next.description).toBe("A theme");
  });

  it("removes the description when empty", () => {
    const seeded: ThemeDefinition = { ...BASE, description: "old" };
    const next = setThemeDescription(seeded, "");
    expect(next.description).toBeUndefined();
    expect("description" in next).toBe(false);
  });
});
