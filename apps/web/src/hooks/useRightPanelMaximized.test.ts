import { describe, expect, it } from "vite-plus/test";

import { isRightPanelMaximized, nextMaximizedThreadKey } from "./useRightPanelMaximized";

describe("nextMaximizedThreadKey", () => {
  it("maximizes the active thread when nothing is maximized", () => {
    expect(nextMaximizedThreadKey(null, "env:thread-a")).toBe("env:thread-a");
  });

  it("restores when the active thread is already maximized", () => {
    expect(nextMaximizedThreadKey("env:thread-a", "env:thread-a")).toBeNull();
  });

  it("moves the maximized thread when toggled from a different thread", () => {
    expect(nextMaximizedThreadKey("env:thread-a", "env:thread-b")).toBe("env:thread-b");
  });
});

describe("isRightPanelMaximized", () => {
  it("is maximized for the thread that was toggled", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: "env:thread-a",
        threadKey: "env:thread-a",
        available: true,
      }),
    ).toBe(true);
  });

  it("is not maximized on another thread", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: "env:thread-a",
        threadKey: "env:thread-b",
        available: true,
      }),
    ).toBe(false);
  });

  it("is not maximized when the layout cannot maximize (sheet, phone, closed panel)", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: "env:thread-a",
        threadKey: "env:thread-a",
        available: false,
      }),
    ).toBe(false);
  });

  it("never maximizes a route without a thread key", () => {
    expect(
      isRightPanelMaximized({ maximizedThreadKey: null, threadKey: null, available: true }),
    ).toBe(false);
  });
});
