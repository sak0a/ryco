import { EDITORS } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isEditorPreferenceEligible } from "./editorPreferences";

describe("isEditorPreferenceEligible", () => {
  it("keeps Terminal workspace-only and every other launcher preference-eligible", () => {
    for (const editor of EDITORS) {
      expect(isEditorPreferenceEligible(editor.id)).toBe(editor.id !== "terminal");
    }
  });
});
