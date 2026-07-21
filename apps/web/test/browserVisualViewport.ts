/**
 * Typed `window.visualViewport` stub for browser tests. The Chromium test
 * runtime never shows a software keyboard, so keyboard-driven visual-viewport
 * geometry (iOS Safari keeps the layout viewport and shrinks the visual
 * viewport) is simulated by masking `window.visualViewport` with a stub whose
 * geometry the test controls. Callers must `restore()` before the test ends so
 * later tests observe the browser's real visual viewport again.
 */

export interface VisualViewportStubGeometry {
  readonly width?: number;
  readonly height?: number;
  readonly offsetLeft?: number;
  readonly offsetTop?: number;
  readonly pageLeft?: number;
  readonly pageTop?: number;
  readonly scale?: number;
}

export interface InstalledVisualViewportStub {
  /** Applies geometry and dispatches a `resize` event. */
  readonly resizeTo: (geometry: VisualViewportStubGeometry) => void;
  /** Applies geometry and dispatches a `scroll` event (visual viewport pan). */
  readonly scrollTo: (geometry: VisualViewportStubGeometry) => void;
  /**
   * Simulates a software keyboard overlapping the bottom of the layout
   * viewport by `insetPx` (0 hides the keyboard again). Recomputes from the
   * current `window.innerHeight`, so it stays correct across viewport and
   * orientation changes, and dispatches a `resize` event.
   */
  readonly setKeyboardInset: (insetPx: number) => void;
  /** Removes the stub, restoring the browser's real `window.visualViewport`. */
  readonly restore: () => void;
}

class VisualViewportStub extends EventTarget {
  width = window.innerWidth;
  height = window.innerHeight;
  offsetLeft = 0;
  offsetTop = 0;
  pageLeft = 0;
  pageTop = 0;
  scale = 1;
  onresize: ((event: Event) => void) | null = null;
  onscroll: ((event: Event) => void) | null = null;

  apply(geometry: VisualViewportStubGeometry): void {
    this.width = geometry.width ?? this.width;
    this.height = geometry.height ?? this.height;
    this.offsetLeft = geometry.offsetLeft ?? this.offsetLeft;
    this.offsetTop = geometry.offsetTop ?? this.offsetTop;
    this.pageLeft = geometry.pageLeft ?? this.pageLeft;
    this.pageTop = geometry.pageTop ?? this.pageTop;
    this.scale = geometry.scale ?? this.scale;
  }
}

/**
 * Masks `window.visualViewport` with a controllable stub. The stub starts at
 * the current window geometry (no keyboard inset) unless `initial` overrides
 * it. Install the stub before starting the visual-viewport adapter under test
 * so the adapter subscribes to the stub instead of the real viewport.
 */
export function installVisualViewportStub(
  initial: VisualViewportStubGeometry = {},
): InstalledVisualViewportStub {
  const stub = new VisualViewportStub();
  stub.apply(initial);
  // `visualViewport` is an own configurable accessor on `window`; capture it
  // so restore() can reinstate the native accessor instead of deleting it.
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport");
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    get: () => stub as unknown as VisualViewport,
  });
  return {
    resizeTo: (geometry) => {
      stub.apply(geometry);
      stub.dispatchEvent(new Event("resize"));
    },
    scrollTo: (geometry) => {
      stub.apply(geometry);
      stub.dispatchEvent(new Event("scroll"));
    },
    setKeyboardInset: (insetPx) => {
      stub.apply({
        width: window.innerWidth,
        height: window.innerHeight - insetPx,
        offsetTop: 0,
        scale: 1,
      });
      stub.dispatchEvent(new Event("resize"));
    },
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(window, "visualViewport", originalDescriptor);
      } else {
        Reflect.deleteProperty(window, "visualViewport");
      }
    },
  };
}
