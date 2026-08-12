/**
 * Branding for the Hub website.
 *
 * Deliberately independent of `branding.ts`. That module resolves the *desktop
 * application's* identity — it reads `window.desktopBridge.getAppBranding()`
 * and falls back to `${APP_BASE_NAME} (${APP_STAGE_LABEL})` — so a Hub surface
 * consuming it renders "Ryco (Beta) Hub": the hosted website wearing the
 * desktop client's release-channel suffix. The Hub is a service with its own
 * release cadence and is never loaded inside Electron, so it does not inherit a
 * desktop stage label and never consults the desktop bridge.
 *
 * The stage suffix survives only for non-production builds, where telling a
 * local Hub from the deployed one is worth the noise.
 */

/** The Hub's product name. Shipped builds render exactly this. */
export const HUB_DISPLAY_NAME = "Ryco Hub";

/**
 * A build marker for development bundles, `null` in production.
 *
 * `import.meta.env.DEV` is a Vite define, so production compiles this to `null`
 * and the branch that renders it disappears.
 */
export const HUB_STAGE_LABEL: string | null = import.meta.env.DEV ? "Dev" : null;

/** The Hub wordmark: "Ryco Hub", plus a stage marker outside production. */
export const HUB_WORDMARK: string =
  HUB_STAGE_LABEL === null ? HUB_DISPLAY_NAME : `${HUB_DISPLAY_NAME} (${HUB_STAGE_LABEL})`;

/**
 * The document title for a Hub page.
 *
 * One title shape for the whole site, so browser history and password managers
 * see a stable, page-specific name instead of the single static
 * `APP_DISPLAY_NAME` the hosted build sets today. Pass no title for the Hub
 * home.
 */
export function hubPageTitle(pageTitle?: string): string {
  return pageTitle === undefined || pageTitle.length === 0
    ? HUB_WORDMARK
    : `${pageTitle} · ${HUB_WORDMARK}`;
}
