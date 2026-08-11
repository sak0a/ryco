export const KEYBOARD_INSET_CSS_VAR = "--app-keyboard-inset";
export const VISIBLE_VIEWPORT_HEIGHT_CSS_VAR = "--app-visible-viewport-height";

/**
 * Software-keyboard geometry derived from `window.visualViewport`. Values are
 * bounded whole CSS pixels computed exclusively from viewport metrics — never
 * from page content.
 */
interface VisualViewportGeometry {
  readonly keyboardInsetPx: number;
  readonly visibleHeightPx: number;
}

/**
 * Pinch zoom also shrinks the visual viewport. Treat any meaningfully scaled
 * viewport as keyboard-free so zoomed layouts keep their CSS-only geometry
 * instead of misreading the zoom as a keyboard.
 */
const MAX_KEYBOARD_SCALE_DELTA = 0.02;

function readGeometry(viewport: VisualViewport): VisualViewportGeometry | null {
  const { innerHeight } = window;
  const { height, offsetTop, scale } = viewport;
  if (
    !Number.isFinite(innerHeight) ||
    !Number.isFinite(height) ||
    !Number.isFinite(offsetTop) ||
    !Number.isFinite(scale)
  ) {
    return null;
  }
  if (Math.abs(scale - 1) > MAX_KEYBOARD_SCALE_DELTA) {
    return null;
  }

  const boundedInnerHeight = Math.max(0, Math.round(innerHeight));
  const keyboardInsetPx = Math.min(
    Math.max(0, Math.round(innerHeight - height - offsetTop)),
    boundedInnerHeight,
  );
  if (keyboardInsetPx < 1) {
    return null;
  }

  return {
    keyboardInsetPx,
    visibleHeightPx: Math.min(Math.max(0, Math.round(height)), boundedInnerHeight),
  };
}

function setVarPx(style: CSSStyleDeclaration, name: string, value: number): void {
  const next = `${value}px`;
  if (style.getPropertyValue(name) !== next) {
    style.setProperty(name, next);
  }
}

let activeTeardown: (() => void) | null = null;

/**
 * The single `VisualViewport` subscription for the app (delivery step 3 of the
 * focused mobile workspace design). Publishes two bounded CSS custom
 * properties on `document.documentElement` while a software keyboard overlaps
 * the layout viewport — iOS Safari ignores `interactive-widget=resizes-content`,
 * so CSS alone cannot keep bottom-anchored surfaces above the keyboard:
 *
 * - `--app-keyboard-inset`: keyboard overlap in whole px, clamped to
 *   `[0, innerHeight]`.
 * - `--app-visible-viewport-height`: visible viewport height in whole px,
 *   clamped to `[0, innerHeight]`.
 *
 * Both variables are removed whenever there is no inset, so desktop and
 * keyboard-closed layouts resolve their existing `env()` fallbacks with zero
 * behavioral difference. Components must consume these variables from CSS
 * only and must not add their own `visualViewport`/resize listeners.
 *
 * The subscription is a singleton: while one activation is live, further
 * calls return its teardown instead of double-subscribing and corrupting the
 * shared document-level variables.
 */
export function syncDocumentVisualViewportInsets(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  if (activeTeardown) {
    return activeTeardown;
  }

  const viewport = window.visualViewport ?? null;
  if (!viewport) {
    return () => {};
  }

  const rootStyle = document.documentElement.style;
  let published = false;
  let frame: number | null = null;

  const clearVars = () => {
    if (
      !published &&
      rootStyle.getPropertyValue(KEYBOARD_INSET_CSS_VAR) === "" &&
      rootStyle.getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR) === ""
    ) {
      return;
    }
    rootStyle.removeProperty(KEYBOARD_INSET_CSS_VAR);
    rootStyle.removeProperty(VISIBLE_VIEWPORT_HEIGHT_CSS_VAR);
    published = false;
  };

  const update = () => {
    frame = null;
    const geometry = readGeometry(viewport);
    if (!geometry) {
      clearVars();
      return;
    }
    setVarPx(rootStyle, KEYBOARD_INSET_CSS_VAR, geometry.keyboardInsetPx);
    setVarPx(rootStyle, VISIBLE_VIEWPORT_HEIGHT_CSS_VAR, geometry.visibleHeightPx);
    published = true;
  };

  // Coalesce event bursts (keyboard show/hide animations emit many resize and
  // scroll events) into at most one style write per animation frame.
  const scheduleUpdate = () => {
    if (frame !== null) {
      return;
    }
    frame = window.requestAnimationFrame(update);
  };

  update();
  viewport.addEventListener("resize", scheduleUpdate);
  viewport.addEventListener("scroll", scheduleUpdate);
  const teardown = () => {
    viewport.removeEventListener("resize", scheduleUpdate);
    viewport.removeEventListener("scroll", scheduleUpdate);
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    clearVars();
    if (activeTeardown === teardown) {
      activeTeardown = null;
    }
  };
  activeTeardown = teardown;
  return teardown;
}
