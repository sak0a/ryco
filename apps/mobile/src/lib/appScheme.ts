import { Uniwind } from "uniwind";

// Single seam that resolves the app's active color scheme (§4). Today it always
// resolves to "dark" (dark-by-default). A future appearance preference plugs in
// HERE — not per-component — so RN's Appearance, the React Navigation theme, and
// Uniwind's active `@variant` all follow one resolver. The light `@variant` block
// stays fully intact behind this seam.
export type AppColorScheme = "light" | "dark";

/** The resolved scheme. Written as a resolver so a preference can override later. */
export function resolveAppColorScheme(): AppColorScheme {
  return "dark";
}

/**
 * Force RN's `Appearance` (which drives `useColorScheme()` AND Uniwind's active
 * theme) to the resolved scheme. `Uniwind.setTheme` disables adaptive theming and
 * calls `Appearance.setColorScheme`, so one call settles tokens + native chrome.
 * Idempotent; safe to call at module load and on every mount / Fast Refresh.
 */
export function applyResolvedAppColorScheme(): AppColorScheme {
  const scheme = resolveAppColorScheme();
  if (Uniwind.currentTheme !== scheme) {
    Uniwind.setTheme(scheme);
  }
  return scheme;
}
