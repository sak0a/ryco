import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_INACTIVE_PANEL_CONTAIN_INTRINSIC_SIZE,
  DOCUMENT_MOTION_PAUSED_ATTRIBUTE,
  PREFERS_REDUCED_MOTION_QUERY,
  resolveInactivePanelContentVisibilityStyle,
  shouldEnableAutoAnimate,
  syncDocumentMotionVisibility,
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

  it("pauses decorative document motion while hidden", () => {
    let visibilityState: DocumentVisibilityState = "visible";
    const listener: { current: (() => void) | null } = { current: null };
    const attributes = new Set<string>();
    const release = syncDocumentMotionVisibility({
      get visibilityState() {
        return visibilityState;
      },
      documentElement: {
        toggleAttribute: (name, force) => {
          if (force) attributes.add(name);
          else attributes.delete(name);
          return force ?? false;
        },
      },
      addEventListener: (_type, nextListener) => {
        listener.current = nextListener;
      },
      removeEventListener: (_type, nextListener) => {
        if (listener.current === nextListener) listener.current = null;
      },
    });

    expect(attributes.has(DOCUMENT_MOTION_PAUSED_ATTRIBUTE)).toBe(false);
    visibilityState = "hidden";
    listener.current?.();
    expect(attributes.has(DOCUMENT_MOTION_PAUSED_ATTRIBUTE)).toBe(true);
    visibilityState = "visible";
    listener.current?.();
    expect(attributes.has(DOCUMENT_MOTION_PAUSED_ATTRIBUTE)).toBe(false);
    release();
    expect(listener.current).toBeNull();
  });
});
