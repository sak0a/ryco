import { EDITORS, type EditorId } from "@ryco/contracts";
import { describe, expect, it } from "vitest";

import { EDITOR_ICONS, getEditorLabel } from "./SettingsPanels.editor";

describe("getEditorLabel", () => {
  it("uses platform-native names for the file manager editor", () => {
    expect(getEditorLabel("file-manager", "MacIntel")).toBe("Finder");
    expect(getEditorLabel("file-manager", "iPhone")).toBe("Finder");
    expect(getEditorLabel("file-manager", "Win32")).toBe("Explorer");
    expect(getEditorLabel("file-manager", "Linux x86_64")).toBe("Files");
  });

  it("uses the contract label for every non-file-manager editor", () => {
    for (const editor of EDITORS) {
      if (editor.id === "file-manager") continue;
      expect(getEditorLabel(editor.id, "MacIntel")).toBe(editor.label);
      expect(getEditorLabel(editor.id, "Win32")).toBe(editor.label);
      expect(getEditorLabel(editor.id, "Linux x86_64")).toBe(editor.label);
    }
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
