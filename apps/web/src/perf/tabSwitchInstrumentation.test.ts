import { describe, expect, it } from "vitest";
import { TAB_SWITCH_MARK_PREFIX, makeTabSwitchMarkName } from "./tabSwitchInstrumentation";

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
