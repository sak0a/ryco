type VisibleTickerListener = (nowMs: number) => void;

interface VisibleTickerWindow {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(id: unknown): void;
}

interface VisibleTickerDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface VisibleTickerOptions {
  intervalMs: number;
  windowTarget?: VisibleTickerWindow | null | undefined;
  documentTarget?: VisibleTickerDocument | null | undefined;
  now?: (() => number) | undefined;
}

export interface VisibleTicker {
  subscribe(listener: VisibleTickerListener): () => void;
}

function getDefaultWindowTarget(): VisibleTickerWindow | null {
  return typeof window === "undefined" ? null : window;
}

function getDefaultDocumentTarget(): VisibleTickerDocument | null {
  return typeof document === "undefined" ? null : document;
}

export function createVisibleTicker({
  intervalMs,
  windowTarget = getDefaultWindowTarget(),
  documentTarget = getDefaultDocumentTarget(),
  now = Date.now,
}: VisibleTickerOptions): VisibleTicker {
  const listeners = new Set<VisibleTickerListener>();
  let intervalId: unknown = null;
  let listeningForVisibility = false;

  const isVisible = () => documentTarget?.visibilityState !== "hidden";

  const emit = () => {
    const nowMs = now();
    for (const listener of listeners) {
      listener(nowMs);
    }
  };

  const stopInterval = () => {
    if (intervalId === null || !windowTarget) {
      return;
    }
    windowTarget.clearInterval(intervalId);
    intervalId = null;
  };

  const startInterval = () => {
    if (intervalId !== null || !windowTarget || listeners.size === 0 || !isVisible()) {
      return;
    }
    intervalId = windowTarget.setInterval(emit, intervalMs);
  };

  const handleVisibilityChange = () => {
    if (!isVisible()) {
      stopInterval();
      return;
    }
    emit();
    startInterval();
  };

  const ensureVisibilityListener = () => {
    if (listeningForVisibility || !documentTarget) {
      return;
    }
    documentTarget.addEventListener("visibilitychange", handleVisibilityChange);
    listeningForVisibility = true;
  };

  const cleanupVisibilityListener = () => {
    if (!listeningForVisibility || !documentTarget) {
      return;
    }
    documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
    listeningForVisibility = false;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      ensureVisibilityListener();
      listener(now());
      startInterval();

      let unsubscribed = false;
      return () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopInterval();
          cleanupVisibilityListener();
        }
      };
    },
  };
}

export const visibleSecondTicker = createVisibleTicker({ intervalMs: 1000 });
