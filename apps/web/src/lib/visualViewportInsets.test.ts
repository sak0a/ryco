import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  KEYBOARD_INSET_CSS_VAR,
  VISIBLE_VIEWPORT_HEIGHT_CSS_VAR,
  syncDocumentVisualViewportInsets,
} from "./visualViewportInsets";

class FakeStyle {
  private readonly properties = new Map<string, string>();
  setPropertyCallCount = 0;

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
    this.setPropertyCallCount += 1;
  }

  removeProperty(name: string): string {
    const previous = this.properties.get(name) ?? "";
    this.properties.delete(name);
    return previous;
  }

  getPropertyValue(name: string): string {
    return this.properties.get(name) ?? "";
  }
}

class FakeVisualViewport extends EventTarget {
  width = 390;
  height = 844;
  offsetLeft = 0;
  offsetTop = 0;
  pageLeft = 0;
  pageTop = 0;
  scale = 1;
  listenerCounts = new Map<string, number>();

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    super.addEventListener(type, listener);
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) + 1);
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    super.removeEventListener(type, listener);
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) - 1);
  }
}

let style: FakeStyle;
let viewport: FakeVisualViewport;
let pendingFrames: Map<number, (time: number) => void>;
let nextFrameId: number;

function flushFrames(): void {
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  for (const callback of callbacks) {
    callback(0);
  }
}

function stubEnvironment(options: { withVisualViewport?: boolean } = {}): void {
  const { withVisualViewport = true } = options;
  style = new FakeStyle();
  viewport = new FakeVisualViewport();
  pendingFrames = new Map();
  nextFrameId = 0;
  vi.stubGlobal("document", { documentElement: { style } });
  vi.stubGlobal("window", {
    innerHeight: 844,
    innerWidth: 390,
    visualViewport: withVisualViewport ? viewport : null,
    requestAnimationFrame: (callback: (time: number) => void) => {
      nextFrameId += 1;
      pendingFrames.set(nextFrameId, callback);
      return nextFrameId;
    },
    cancelAnimationFrame: (frameId: number) => {
      pendingFrames.delete(frameId);
    },
  });
}

beforeEach(() => {
  stubEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncDocumentVisualViewportInsets", () => {
  it("returns a no-op teardown when the browser exposes no visual viewport", () => {
    stubEnvironment({ withVisualViewport: false });
    const teardown = syncDocumentVisualViewportInsets();
    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("");
    expect(style.setPropertyCallCount).toBe(0);
    teardown();
  });

  it("publishes no variables while the visual viewport reports no inset", () => {
    const teardown = syncDocumentVisualViewportInsets();
    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("");
    expect(style.setPropertyCallCount).toBe(0);

    viewport.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(style.setPropertyCallCount).toBe(0);
    teardown();
  });

  it("clears stale keyboard variables when a fresh adapter starts without an inset", () => {
    style.setProperty(KEYBOARD_INSET_CSS_VAR, "313px");
    style.setProperty(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR, "531px");

    const teardown = syncDocumentVisualViewportInsets();

    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("");
    teardown();
  });

  it("publishes rounded bounded pixel variables while a keyboard inset exists", () => {
    const teardown = syncDocumentVisualViewportInsets();

    viewport.height = 543.6;
    viewport.dispatchEvent(new Event("resize"));
    flushFrames();

    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("300px");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("544px");
    teardown();
  });

  it("subtracts the visual viewport offset from the keyboard inset", () => {
    const teardown = syncDocumentVisualViewportInsets();

    viewport.height = 500;
    viewport.offsetTop = 44;
    viewport.dispatchEvent(new Event("resize"));
    flushFrames();

    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("300px");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("500px");
    teardown();
  });

  it("removes the variables when the keyboard closes again", () => {
    const teardown = syncDocumentVisualViewportInsets();

    viewport.height = 544;
    viewport.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("300px");

    viewport.height = 844;
    viewport.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("");
    teardown();
  });

  it("treats a pinch-zoomed viewport as keyboard-free", () => {
    const teardown = syncDocumentVisualViewportInsets();

    viewport.height = 422;
    viewport.scale = 2;
    viewport.dispatchEvent(new Event("resize"));
    flushFrames();

    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("");
    teardown();
  });

  it("coalesces event bursts into a single style update per frame", () => {
    const teardown = syncDocumentVisualViewportInsets();

    viewport.height = 544;
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    viewport.dispatchEvent(new Event("resize"));
    expect(pendingFrames.size).toBe(1);

    flushFrames();
    expect(style.setPropertyCallCount).toBe(2);
    teardown();
  });

  it("returns the active teardown instead of subscribing a second time", () => {
    const first = syncDocumentVisualViewportInsets();
    const second = syncDocumentVisualViewportInsets();

    expect(second).toBe(first);
    expect(viewport.listenerCounts.get("resize")).toBe(1);
    expect(viewport.listenerCounts.get("scroll")).toBe(1);

    first();
    expect(viewport.listenerCounts.get("resize")).toBe(0);

    // A fresh activation after teardown subscribes again.
    const third = syncDocumentVisualViewportInsets();
    expect(third).not.toBe(first);
    expect(viewport.listenerCounts.get("resize")).toBe(1);
    third();
  });

  it("removes listeners and variables on teardown", () => {
    const teardown = syncDocumentVisualViewportInsets();

    viewport.height = 544;
    viewport.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("300px");

    teardown();
    expect(style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe("");
    expect(style.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR)).toBe("");
    expect(viewport.listenerCounts.get("resize")).toBe(0);
    expect(viewport.listenerCounts.get("scroll")).toBe(0);

    viewport.dispatchEvent(new Event("resize"));
    expect(pendingFrames.size).toBe(0);
  });
});
