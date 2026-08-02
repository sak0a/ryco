import { EDITORS, type EditorId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EDITOR_ICONS, getEditorLabel, resolveEditorOptions } from "./SettingsPanels.editor";

describe("getEditorLabel", () => {
  it("uses platform-native names for the file manager editor", () => {
    expect(getEditorLabel("file-manager", "MacIntel")).toBe("Finder");
    expect(getEditorLabel("file-manager", "iPhone")).toBe("Finder");
    expect(getEditorLabel("file-manager", "Win32")).toBe("Explorer");
    expect(getEditorLabel("file-manager", "Linux x86_64")).toBe("Files");
  });

  it("uses the platform-native name for Terminal on Windows", () => {
    expect(getEditorLabel("terminal", "MacIntel")).toBe("Terminal");
    expect(getEditorLabel("terminal", "Win32")).toBe("Windows Terminal");
    expect(getEditorLabel("terminal", "Linux x86_64")).toBe("Terminal");
  });

  it("uses the contract label for every editor without a platform-specific label", () => {
    for (const editor of EDITORS) {
      if (editor.id === "file-manager" || editor.id === "terminal") continue;
      expect(getEditorLabel(editor.id, "MacIntel")).toBe(editor.label);
      expect(getEditorLabel(editor.id, "Win32")).toBe(editor.label);
      expect(getEditorLabel(editor.id, "Linux x86_64")).toBe(editor.label);
    }
  });
});

describe("resolveEditorOptions", () => {
  it("returns available editors in contract order with exhaustive display metadata", () => {
    const options = resolveEditorOptions("MacIntel", [
      "terminal",
      "android-studio",
      "windsurf",
      "file-manager",
    ]);

    expect(options.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "Windsurf", value: "windsurf" },
      { label: "Android Studio", value: "android-studio" },
      { label: "Terminal", value: "terminal" },
      { label: "Finder", value: "file-manager" },
    ]);
    for (const option of options) expect(option.Icon).toBeDefined();
  });
});

describe("EDITOR_ICONS", () => {
  it("has an entry for every editor id", () => {
    const icons: Record<EditorId, unknown> = EDITOR_ICONS;
    for (const editor of EDITORS) {
      expect(icons[editor.id]).toBeDefined();
    }
  });
});
