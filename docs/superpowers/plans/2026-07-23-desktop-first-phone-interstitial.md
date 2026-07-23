# Desktop-first phone interstitial implementation plan

**Goal:** Behind a build-time flag that defaults off, show a full-screen "Ryco is
better as an app" overlay on qualifying phone-tier visits, latched at first
render above the unchanged app shell, dismissible in one tap to the existing
web experience. The responsive phone tier is frozen, not modified.

**Design spec:**
`docs/superpowers/specs/2026-07-23-desktop-first-phone-interstitial-design.md`

## Execution rules

- Work only on `docs/desktop-first-phone-interstitial-spec` in the public
  repository (spec, plan, and implementation ship as one PR).
- The overlay is additive presentation. `computeTier()`, the tier override dev
  tooling, `data-tier`, `components/shell/phone/*`, the PWA stack, the hosted
  lifecycle, and the acceptance matrix are untouched; the matrix must pass
  unmodified.
- With both flags unset (the default in every dev, test, and CI build) the
  application renders byte-for-byte as today.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, URL, or operational
  details to the public repository, tests, commits, or the pull request.
- Stage only named paths (`git add <file>...`, never `-A`); run
  `git diff --check` before every commit.

## Task 1 — Build-time flags and typed readers

**Files:** `apps/web/vite.config.ts`, `apps/web/src/env.ts`,
`apps/web/src/viteConfig.test.ts`.

- Extend `createWebViteConfig` with explicit parameters
  `phoneAppInterstitial` and `mobileAppUrl` (mirroring how `clientMode`
  parameterizes the hosted PWA plugin), sourced at module scope from
  `process.env.VITE_RYCO_PHONE_APP_INTERSTITIAL` /
  `process.env.VITE_RYCO_MOBILE_APP_URL`, and stamp both into the `define`
  block as `import.meta.env.*` strings: `"enabled" | "disabled"` (anything
  but `"enabled"` normalizes to `"disabled"`) and the raw URL string
  (default `""`).
- `env.ts`: `isPhoneAppInterstitialEnabled(): boolean` — true only when the
  define is `"enabled"` **and** `readMobileAppUrl()` returns a value.
  `readMobileAppUrl(): string | null` — parses the define with `new URL`,
  requires `https:`, returns `null` otherwise.
- `viteConfig.test.ts`: defaults are `"disabled"`/`""` when parameters are
  absent; configured parameter values pass through to the define block;
  normalization of unexpected flag values.

**Acceptance:** unit tests above; `bun typecheck` clean.

## Task 2 — Gate predicate and dismissal store

**Files:** new `apps/web/src/components/shell/phone/phoneAppInterstitial.ts`,
new `apps/web/src/components/shell/phone/phoneAppInterstitial.test.ts`.

- `shouldShowPhoneAppInterstitial(deps)` — pure predicate over injected
  `{ enabled, isElectron, tier, dismissed }`; no imports of env or tier
  modules inside the predicate (callers inject), so the truth table is
  directly testable.
- Dismissal store honoring the hosted storage convention: in hosted-hub mode
  an in-memory module latch only; in standard mode `sessionStorage` key
  `ryco:phone-app-interstitial-dismissed:v1` = `"1"`, every access wrapped in
  try/catch falling back to the in-memory latch. Expose
  `readInterstitialDismissed()`, `markInterstitialDismissed()`, and a
  test-only reset.
- Unit tests: full predicate truth table; storage write/read; hosted mode
  never touches storage (spy); storage-throwing fallback still dismisses.

**Acceptance:** each new assertion demonstrated falsifiable (invert a
condition, watch it fail), then `bun run test` clean.

## Task 3 — Interstitial component and browser suite

**Files:** new
`apps/web/src/components/shell/phone/PhoneGetAppInterstitial.tsx`, new
`apps/web/src/components/shell/phone/PhoneGetAppInterstitial.browser.tsx`.

- Full-screen fixed overlay (`inset-0`, above shell z-index), self-contained;
  props: `{ appUrl: string; onDismiss: () => void }` — no store, RPC, or
  lifecycle access. Brand mark, headline, one line of copy; primary anchor
  `href={appUrl}` `target="_blank"` `rel="noreferrer"`; secondary "Continue
  in browser" button calling `onDismiss`; `role="dialog"`,
  `aria-modal="true"`, focus moved into the dialog on mount and trapped
  between its two controls, `Escape` triggers `onDismiss`. Styling from the
  existing phone conventions: `GlassSurface`, safe-area insets,
  reduced-motion compliance, ≥44 px touch targets.
- Browser suite (phone viewport via the existing CDP emulation helpers):
  renders above a host probe that stays mounted; dismissal removes only the
  overlay; link attributes; dialog semantics, focus trap, `Escape`; touch
  target measurement; reduced-motion pass.

**Acceptance:** suite green under `bun run --cwd apps/web test:browser`;
acceptance matrix suite passes unmodified.

## Task 4 — Root gate wiring

**Files:** `apps/web/src/routes/__root.tsx`.

- In `RootRouteView`, for the `authenticated` / `hosted-static` /
  `hosted-hub` branches only (after the unchanged `/pair` and Outlet
  returns): lazy `useState` initializer latching
  `shouldShowPhoneAppInterstitial` fed from `isPhoneAppInterstitialEnabled()`,
  `isElectron`, `getPresentationTier()`, `readInterstitialDismissed()`;
  render the overlay as a sibling **above** the existing `Suspense` branch,
  which stays byte-for-byte unchanged. Dismiss handler marks the dismissal
  and clears the latch. Lazy-load the component so the default-off bundle
  cost is nil.
- No `beforeLoad` involvement; no other file changes.

**Acceptance:** with flags unset, `rg`-verifiable that `__root.tsx` renders
the identical branch structure; browser suite from Task 3 exercises the
overlay-above-host behavior; full gate set.

## Task 5 — Gates, evidence, PR

- Full public gate set: `bun install --frozen-lockfile`, `bun fmt`,
  `bun run fmt:check`, `bun lint`, `bun typecheck`,
  `bun run typecheck:effect`, `bun run test`, `bun run build`,
  `bun run build --filter=@ryco/web`, `bun audit`, and **three consecutive
  clean full runs** of `bun run --cwd apps/web test:browser`.
- Review the complete diff for scope creep, secrets, and generated drift.
- Push the branch and open the PR against `sak0a/ryco` `main`
  (`gh -R sak0a/ryco`), containing spec + plan + implementation; PR body
  records the gate evidence and the flag-off no-behavior-change guarantee.
