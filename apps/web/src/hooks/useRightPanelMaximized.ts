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
  available: boolean;
}): boolean {
  return (
    input.available &&
    input.maximizedThreadKey !== null &&
    input.maximizedThreadKey === input.threadKey
  );
}

/**
 * Maximize state for the inline workspace panel, shared by the server-thread
 * and draft-thread route views.
 *
 * Session-only and scoped to a thread key: maximizing is a "what am I doing
 * right now" choice, so it neither persists across reloads nor follows you to
 * another thread — but coming back to the thread restores it. When the panel
 * stops being maximizable at all (closed, or narrow enough that the panel
 * presents as a sheet) the state is dropped so re-opening starts from the
 * normal split.
 */
export function useRightPanelMaximized(input: {
  threadKey: string | null;
  /** Whether maximizing is possible at all — inline presentation, panel open. */
  available: boolean;
}): RightPanelMaximizedState {
  const { available, threadKey } = input;
  const [maximizedThreadKey, setMaximizedThreadKey] = useState<string | null>(null);

  useEffect(() => {
    if (!available && maximizedThreadKey !== null) {
      setMaximizedThreadKey(null);
    }
  }, [available, maximizedThreadKey]);

  const toggleMaximized = useCallback(() => {
    if (!available) {
      return;
    }
    setMaximizedThreadKey((current) => nextMaximizedThreadKey(current, threadKey));
  }, [available, threadKey]);

  return {
    maximized: isRightPanelMaximized({ available, maximizedThreadKey, threadKey }),
    toggleMaximized,
  };
}
