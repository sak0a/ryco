import { describe, expect, it } from "vite-plus/test";

import {
  isRightPanelMaximized,
  nextMaximizedThreadKey,
  shouldClearMaximizedThreadKey,
} from "./useRightPanelMaximized";

const THREAD_A = "env:thread-a";
const THREAD_B = "env:thread-b";

/**
 * Drives the same reduce-then-clear sequence the hook runs per render, so a
 * test can express a route history instead of a single predicate.
 */
function visit(
  maximizedThreadKey: string | null,
  route: { threadKey: string | null; open: boolean; canMaximize?: boolean; toggle?: boolean },
): { maximizedThreadKey: string | null; maximized: boolean } {
  const { threadKey, open } = route;
  const canMaximize = route.canMaximize ?? true;
  let next = maximizedThreadKey;
  if (route.toggle && open && canMaximize) {
    next = nextMaximizedThreadKey(next, threadKey);
  }
  if (shouldClearMaximizedThreadKey({ maximizedThreadKey: next, threadKey, open })) {
    next = null;
  }
  return {
    maximizedThreadKey: next,
    maximized: isRightPanelMaximized({ maximizedThreadKey: next, threadKey, open, canMaximize }),
  };
}

describe("nextMaximizedThreadKey", () => {
  it("maximizes the active thread when nothing is maximized", () => {
    expect(nextMaximizedThreadKey(null, THREAD_A)).toBe(THREAD_A);
  });

  it("restores when the active thread is already maximized", () => {
    expect(nextMaximizedThreadKey(THREAD_A, THREAD_A)).toBeNull();
  });

  it("moves the maximized thread when toggled from a different thread", () => {
    expect(nextMaximizedThreadKey(THREAD_A, THREAD_B)).toBe(THREAD_B);
  });
});

describe("isRightPanelMaximized", () => {
  it("is maximized for the thread that was toggled", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: THREAD_A,
        threadKey: THREAD_A,
        open: true,
        canMaximize: true,
      }),
    ).toBe(true);
  });

  it("is not maximized on another thread", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: THREAD_A,
        threadKey: THREAD_B,
        open: true,
        canMaximize: true,
      }),
    ).toBe(false);
  });

  it("is not maximized while the panel is closed", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: THREAD_A,
        threadKey: THREAD_A,
        open: false,
        canMaximize: true,
      }),
    ).toBe(false);
  });

  it("is not maximized where the presentation cannot maximize (sheet, phone)", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: THREAD_A,
        threadKey: THREAD_A,
        open: true,
        canMaximize: false,
      }),
    ).toBe(false);
  });

  it("never maximizes a route without a thread key", () => {
    expect(
      isRightPanelMaximized({
        maximizedThreadKey: null,
        threadKey: null,
        open: true,
        canMaximize: true,
      }),
    ).toBe(false);
  });
});

describe("shouldClearMaximizedThreadKey", () => {
  it("clears when the owning thread closes its panel", () => {
    expect(
      shouldClearMaximizedThreadKey({
        maximizedThreadKey: THREAD_A,
        threadKey: THREAD_A,
        open: false,
      }),
    ).toBe(true);
  });

  it("keeps another thread's state when this route has no panel open", () => {
    expect(
      shouldClearMaximizedThreadKey({
        maximizedThreadKey: THREAD_A,
        threadKey: THREAD_B,
        open: false,
      }),
    ).toBe(false);
  });
});

describe("maximize state across route changes", () => {
  it("restores thread A after visiting thread B with a closed panel", () => {
    const maximizedA = visit(null, { threadKey: THREAD_A, open: true, toggle: true });
    expect(maximizedA.maximized).toBe(true);

    // Thread B has no workspace panel open — that must not erase A's layout.
    const visitedB = visit(maximizedA.maximizedThreadKey, { threadKey: THREAD_B, open: false });
    expect(visitedB.maximized).toBe(false);
    expect(visitedB.maximizedThreadKey).toBe(THREAD_A);

    const backOnA = visit(visitedB.maximizedThreadKey, { threadKey: THREAD_A, open: true });
    expect(backOnA.maximized).toBe(true);
  });

  it("survives a narrow viewport that forces the sheet presentation", () => {
    const maximizedA = visit(null, { threadKey: THREAD_A, open: true, toggle: true });

    const narrow = visit(maximizedA.maximizedThreadKey, {
      threadKey: THREAD_A,
      open: true,
      canMaximize: false,
    });
    expect(narrow.maximized).toBe(false);

    const wideAgain = visit(narrow.maximizedThreadKey, { threadKey: THREAD_A, open: true });
    expect(wideAgain.maximized).toBe(true);
  });

  it("forgets the layout once the owning thread closes the panel", () => {
    const maximizedA = visit(null, { threadKey: THREAD_A, open: true, toggle: true });

    const closed = visit(maximizedA.maximizedThreadKey, { threadKey: THREAD_A, open: false });
    expect(closed.maximizedThreadKey).toBeNull();

    const reopened = visit(closed.maximizedThreadKey, { threadKey: THREAD_A, open: true });
    expect(reopened.maximized).toBe(false);
  });
});
