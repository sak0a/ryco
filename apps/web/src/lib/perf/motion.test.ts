import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_INACTIVE_PANEL_CONTAIN_INTRINSIC_SIZE,
  PREFERS_REDUCED_MOTION_QUERY,
  resolveInactivePanelContentVisibilityStyle,
  shouldEnableAutoAnimate,
} from "./motion";

describe("UI motion energy helpers", () => {
  it("uses the standard reduced-motion media query", () => {
    expect(PREFERS_REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });

  it("enables auto-animate only when inside thresholds and motion is allowed", () => {
    expect(shouldEnableAutoAnimate({ prefersReducedMotion: false, withinThreshold: true })).toBe(
      true,
    );
    expect(shouldEnableAutoAnimate({ prefersReducedMotion: true, withinThreshold: true })).toBe(
      false,
    );
    expect(shouldEnableAutoAnimate({ prefersReducedMotion: false, withinThreshold: false })).toBe(
      false,
    );
  });

  it("adds content-visibility only for inactive panels", () => {
    expect(resolveInactivePanelContentVisibilityStyle({ active: true })).toBeUndefined();
    expect(resolveInactivePanelContentVisibilityStyle({ active: false })).toEqual({
      contentVisibility: "hidden",
      containIntrinsicSize: DEFAULT_INACTIVE_PANEL_CONTAIN_INTRINSIC_SIZE,
    });
    expect(
      resolveInactivePanelContentVisibilityStyle({
        active: false,
        containIntrinsicSize: "28rem 100vh",
      }),
    ).toEqual({
      contentVisibility: "hidden",
      containIntrinsicSize: "28rem 100vh",
    });
  });
});
