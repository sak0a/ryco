import { describe, expect, it } from "vite-plus/test";
import {
  SIDEBAR_EXPAND_MARK_PREFIX,
  TAB_SWITCH_MARK_PREFIX,
  makeSidebarExpandMarkName,
  makeTabSwitchMarkName,
} from "./tabSwitchInstrumentation";

describe("makeTabSwitchMarkName", () => {
  it("encodes phase and key", () => {
    expect(makeTabSwitchMarkName("click", "env:thr_1")).toBe(
      `${TAB_SWITCH_MARK_PREFIX}click:env:thr_1`,
    );
    expect(makeTabSwitchMarkName("first-paint", "env:thr_1")).toBe(
      `${TAB_SWITCH_MARK_PREFIX}first-paint:env:thr_1`,
    );
  });

  it("rejects unsafe keys (no colons in key suffix)", () => {
    expect(() => makeTabSwitchMarkName("click", "")).toThrow();
  });
});

describe("makeSidebarExpandMarkName", () => {
  it("encodes phase and key", () => {
    expect(makeSidebarExpandMarkName("click", "project-a")).toBe(
      `${SIDEBAR_EXPAND_MARK_PREFIX}click:project-a`,
    );
    expect(makeSidebarExpandMarkName("first-paint", "project-a")).toBe(
      `${SIDEBAR_EXPAND_MARK_PREFIX}first-paint:project-a`,
    );
  });

  it("rejects empty keys", () => {
    expect(() => makeSidebarExpandMarkName("click", "")).toThrow();
  });
});
