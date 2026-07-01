import { useCallback, useSyncExternalStore } from "react";

import {
  APPEARANCE_PREFERENCES_CHANGE_EVENT,
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  getAppearancePreferences,
  type AppearancePreferenceKey,
} from "../themes/appearancePreferences";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_PREFERENCES_STORAGE_KEY) onChange();
  };
  window.addEventListener(APPEARANCE_PREFERENCES_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(APPEARANCE_PREFERENCES_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

/**
 * Reactively read a single appearance preference. Updates whenever the
 * preference changes in this tab (via {@link APPEARANCE_PREFERENCES_CHANGE_EVENT})
 * or another tab (via the `storage` event). Returns the resolved string value,
 * which falls back to the default when no override is stored.
 */
export function useAppearancePreference(key: AppearancePreferenceKey): string {
  const getSnapshot = useCallback(() => getAppearancePreferences()[key], [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
