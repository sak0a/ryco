import { describe, expect, it } from "vite-plus/test";

import { buildHomeChromeModel, HOME_LIST_PADDING_BOTTOM, HOME_MODE_TITLE } from "./homeChromeModel";
import type { HomeMode } from "./homeMode";

const MODES: ReadonlyArray<HomeMode> = ["inbox", "projects"];

describe("home chrome", () => {
  it("titles each mode", () => {
    expect(MODES.map((mode) => buildHomeChromeModel({ mode, searchVisible: false }).title)).toEqual(
      ["Inbox", "Projects"],
    );
  });

  it("always points the mark at Inbox, from every mode", () => {
    for (const mode of MODES) {
      const model = buildHomeChromeModel({ mode, searchVisible: false });
      expect(model.headerLeftTargetMode).toBe("inbox");
      expect(model.headerLeft.accessibilityLabel).toBe("Open Inbox");
    }
  });

  it("puts Search and Settings on the right, in that order", () => {
    const model = buildHomeChromeModel({ mode: "inbox", searchVisible: false });
    expect(model.headerRight.map((button) => button.id)).toEqual(["search", "settings"]);
    expect(model.headerRight.map((button) => button.accessibilityLabel)).toEqual([
      "Search Inbox",
      "Settings",
    ]);
  });

  it("names the search target after the visible mode and flips when expanded", () => {
    expect(
      buildHomeChromeModel({ mode: "projects", searchVisible: false }).headerRight[0]
        .accessibilityLabel,
    ).toBe("Search Projects");
    expect(
      buildHomeChromeModel({ mode: "projects", searchVisible: true }).headerRight[0]
        .accessibilityLabel,
    ).toBe("Hide search");
    expect(buildHomeChromeModel({ mode: "projects", searchVisible: true }).searchExpanded).toBe(
      true,
    );
  });

  it("offers new task from every mode, matching the reach of the header + it replaces", () => {
    for (const mode of MODES) {
      expect(buildHomeChromeModel({ mode, searchVisible: false }).newTask).toEqual({
        id: "new-task",
        accessibilityLabel: "New Task",
      });
    }
  });

  it("never puts new task in the header", () => {
    for (const mode of MODES) {
      const ids = buildHomeChromeModel({ mode, searchVisible: false }).headerRight.map(
        (button) => button.id,
      );
      expect(ids).not.toContain("new-task");
    }
  });

  it("clears the floating button with the list padding", () => {
    // 34 home indicator + 16 gap + 56 button + 18 breathing room.
    expect(HOME_LIST_PADDING_BOTTOM).toBe(124);
    expect(HOME_LIST_PADDING_BOTTOM).toBeGreaterThan(34 + 16 + 56);
  });

  it("keeps the mode-title table aligned with the model", () => {
    for (const mode of MODES) {
      expect(buildHomeChromeModel({ mode, searchVisible: false }).title).toBe(
        HOME_MODE_TITLE[mode],
      );
    }
  });
});
