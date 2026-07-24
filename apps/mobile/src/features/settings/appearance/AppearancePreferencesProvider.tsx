import { createContext, use, useCallback, useEffect, useMemo, type ReactNode } from "react";

import { Uniwind } from "uniwind";

import {
  resolveAppearance,
  resolveAppearancePreferences,
  resolveTextScaleVariables,
  type AppearancePreferences,
  type ResolvedAppearance,
} from "../../../lib/appearancePreferences";
import {
  hydratePreferences,
  updatePreferences as persistPreferences,
  useIsPreferencesHydrated,
  usePreferences,
} from "../../../state/preferencesStore";

interface AppearancePreferencesContextValue {
  /** Effective values with base-size derivation applied. Use this for rendering. */
  readonly appearance: ResolvedAppearance;
  readonly isReady: boolean;
  readonly setBaseFontSize: (value: number) => void;
  /** Pass null to clear the override and follow the base font size. */
  readonly setTerminalFontSize: (value: number | null) => void;
  /** Pass null to clear the override and follow the base font size. */
  readonly setCodeFontSize: (value: number | null) => void;
  readonly setCodeWordBreak: (value: boolean) => void;
}

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

/**
 * Injects the scaled `--text-*` variables into Uniwind so every
 * className-based text size (`text-sm`, `text-base`, ...) re-resolves live.
 * Updates the current theme last so the active stylesheet settles correctly.
 */
function applyTextScaleVariables(baseFontSize: number) {
  const variables = resolveTextScaleVariables(baseFontSize);
  const currentTheme = Uniwind.currentTheme;

  for (const theme of ["light", "dark"] as const) {
    if (theme !== currentTheme) {
      Uniwind.updateCSSVariables(theme, variables);
    }
  }
  Uniwind.updateCSSVariables(currentTheme, variables);
}

// Rewritten onto the device-local preferences store (§3-2). Upstream read the
// Effect/atom `mobilePreferencesAtom`; B2 reads `usePreferences()` +
// `useIsPreferencesHydrated()` and writes through `persistPreferences`. The
// terminal font-size cache (`cacheTerminalFontSize`) is dropped — the terminal is
// v1.1 and has no surface to consume it in the MVP.
export function AppearancePreferencesProvider(props: { readonly children: ReactNode }) {
  useEffect(() => {
    hydratePreferences();
  }, []);

  const storedPreferences = usePreferences();
  const hydrated = useIsPreferencesHydrated();
  const preferences = useMemo(
    () => resolveAppearancePreferences(storedPreferences),
    [storedPreferences],
  );
  const isReady = hydrated;

  useEffect(() => {
    applyTextScaleVariables(preferences.baseFontSize);
  }, [preferences]);

  const updatePreferences = useCallback((patch: Partial<AppearancePreferences>) => {
    persistPreferences(patch);
  }, []);

  const setBaseFontSize = useCallback(
    (value: number) => {
      updatePreferences({ baseFontSize: value });
    },
    [updatePreferences],
  );

  const setTerminalFontSize = useCallback(
    (value: number | null) => {
      updatePreferences({ terminalFontSize: value });
    },
    [updatePreferences],
  );

  const setCodeFontSize = useCallback(
    (value: number | null) => {
      updatePreferences({ codeFontSize: value });
    },
    [updatePreferences],
  );

  const setCodeWordBreak = useCallback(
    (value: boolean) => {
      updatePreferences({ codeWordBreak: value });
    },
    [updatePreferences],
  );

  const value = useMemo(
    (): AppearancePreferencesContextValue => ({
      appearance: resolveAppearance(preferences),
      isReady,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
    }),
    [preferences, isReady, setBaseFontSize, setTerminalFontSize, setCodeFontSize, setCodeWordBreak],
  );

  return (
    <AppearancePreferencesContext.Provider value={value}>
      {props.children}
    </AppearancePreferencesContext.Provider>
  );
}

export function useAppearancePreferences(): AppearancePreferencesContextValue {
  const context = use(AppearancePreferencesContext);
  if (!context) {
    throw new Error("useAppearancePreferences must be used within AppearancePreferencesProvider");
  }
  return context;
}
