import { useCallback, useEffect, useState } from "react";

export interface RightPanelMaximizedState {
  /** True only while the panel can be and is maximized for the active thread. */
  maximized: boolean;
  toggleMaximized: () => void;
}

/** Toggling is per thread, so returning to a thread restores how you left it. */
export function nextMaximizedThreadKey(
  current: string | null,
  threadKey: string | null,
): string | null {
  return current === threadKey ? null : threadKey;
}

export function isRightPanelMaximized(input: {
  maximizedThreadKey: string | null;
  threadKey: string | null;
  open: boolean;
  canMaximize: boolean;
}): boolean {
  return (
    input.open &&
    input.canMaximize &&
    input.maximizedThreadKey !== null &&
    input.maximizedThreadKey === input.threadKey
  );
}

/**
 * Closing the panel forgets that the thread was maximized, so re-opening it
 * starts from the normal split.
 *
 * Scoped to the owning thread on purpose: visiting another thread that happens
 * to have no panel open must not erase the first thread's layout, and a
 * viewport narrow enough to force the sheet presentation is a temporary
 * condition rather than a decision to restore.
 */
export function shouldClearMaximizedThreadKey(input: {
  maximizedThreadKey: string | null;
  threadKey: string | null;
  open: boolean;
}): boolean {
  return (
    !input.open && input.maximizedThreadKey !== null && input.maximizedThreadKey === input.threadKey
  );
}

/**
 * Maximize state for the inline workspace panel, shared by the server-thread
 * and draft-thread route views.
 *
 * Session-only and scoped to a thread key: maximizing is a "what am I doing
 * right now" choice, so it neither persists across reloads nor follows you to
 * another thread — but coming back to the thread restores it.
 */
export function useRightPanelMaximized(input: {
  threadKey: string | null;
  /** Whether the workspace panel is open on this route. */
  open: boolean;
  /** Whether this presentation can maximize at all — inline, not phone. */
  canMaximize: boolean;
}): RightPanelMaximizedState {
  const { canMaximize, open, threadKey } = input;
  const [maximizedThreadKey, setMaximizedThreadKey] = useState<string | null>(null);

  useEffect(() => {
    if (shouldClearMaximizedThreadKey({ maximizedThreadKey, open, threadKey })) {
      setMaximizedThreadKey(null);
    }
  }, [maximizedThreadKey, open, threadKey]);

  const toggleMaximized = useCallback(() => {
    if (!open || !canMaximize) {
      return;
    }
    setMaximizedThreadKey((current) => nextMaximizedThreadKey(current, threadKey));
  }, [canMaximize, open, threadKey]);

  return {
    maximized: isRightPanelMaximized({ canMaximize, maximizedThreadKey, open, threadKey }),
    toggleMaximized,
  };
}
