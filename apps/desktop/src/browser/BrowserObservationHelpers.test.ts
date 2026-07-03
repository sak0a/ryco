import { describe, expect, it } from "vite-plus/test";

import { mapConsoleLevel, parseConsoleMessage, pushBounded } from "./BrowserObservationHelpers.ts";

describe("BrowserObservationHelpers", () => {
  it("maps legacy console-message arguments", () => {
    const entry = parseConsoleMessage([{}, 2, "warn message", 12, "app.js"]);
    expect(entry).toMatchObject({
      level: "warning",
      message: "warn message",
      line: 12,
      source: "app.js",
    });
  });

  it("maps structured console-message events", () => {
    const entry = parseConsoleMessage([
      {
        level: 3,
        message: "boom",
        lineNumber: 4,
        sourceId: "bundle.js",
      },
    ]);
    expect(entry).toMatchObject({
      level: "error",
      message: "boom",
      line: 4,
      source: "bundle.js",
    });
  });

  it("keeps bounded buffers at the configured limit", () => {
    const buffer: number[] = [];
    pushBounded(buffer, 1, 2);
    pushBounded(buffer, 2, 2);
    pushBounded(buffer, 3, 2);
    expect(buffer).toEqual([2, 3]);
  });

  it("maps numeric console levels", () => {
    expect(mapConsoleLevel(0)).toBe("debug");
    expect(mapConsoleLevel(3)).toBe("error");
  });
});
