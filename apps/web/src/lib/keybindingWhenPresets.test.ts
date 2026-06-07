import { describe, expect, it } from "vitest";
import { WHEN_PRESETS, describeWhen, presetForWhen } from "./keybindingWhenPresets";

describe("keybindingWhenPresets", () => {
  it("maps undefined to the Always preset", () => {
    expect(presetForWhen(undefined)).toEqual({
      id: "always",
      label: "Always",
      value: undefined,
    });
  });

  it("matches the canonical preset strings", () => {
    expect(presetForWhen("terminalFocus")?.id).toBe("terminalFocus");
    expect(presetForWhen("!terminalFocus")?.id).toBe("notTerminalFocus");
    expect(presetForWhen("terminalOpen")?.id).toBe("terminalOpen");
    expect(presetForWhen("!terminalOpen")?.id).toBe("notTerminalOpen");
  });

  it("tolerates whitespace differences", () => {
    expect(presetForWhen("! terminalFocus")?.id).toBe("notTerminalFocus");
    expect(presetForWhen(" terminalOpen ")?.id).toBe("terminalOpen");
  });

  it("returns undefined for custom expressions", () => {
    expect(presetForWhen("terminalOpen && !terminalFocus")).toBeUndefined();
  });

  it("describeWhen falls back to the raw expression for custom values", () => {
    expect(describeWhen(undefined)).toBe("Always");
    expect(describeWhen("terminalFocus")).toBe("Terminal focused");
    expect(describeWhen("terminalOpen && !terminalFocus")).toBe("terminalOpen && !terminalFocus");
  });

  it("exports presets in canonical order", () => {
    expect(WHEN_PRESETS.map((p) => p.id)).toEqual([
      "always",
      "terminalFocus",
      "notTerminalFocus",
      "terminalOpen",
      "notTerminalOpen",
      "modelPickerOpen",
      "commandPaletteOpen",
      "composerFocus",
      "notComposerFocus",
    ]);
  });

  it("matches the new modal/composer preset values", () => {
    expect(presetForWhen("modelPickerOpen")?.id).toBe("modelPickerOpen");
    expect(presetForWhen("commandPaletteOpen")?.id).toBe("commandPaletteOpen");
    expect(presetForWhen("composerFocus")?.id).toBe("composerFocus");
    expect(presetForWhen("!composerFocus")?.id).toBe("notComposerFocus");
  });
});
