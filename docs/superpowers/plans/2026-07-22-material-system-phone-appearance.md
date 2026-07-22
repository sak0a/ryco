# Material system and phone appearance settings implementation plan

**Goal:** Give the phone tier a translucent layered material system that cannot fall below WCAG AA,
and a phone appearance settings group that lets the owner of the device choose how much of it they
want.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Delivery step 3. Steps 1 (composer focus, PR #205) and 2 (primitives layer, PR #206) are merged.

## Two corrections to the spec, decided here

**1. `surfaceTransparency` already has five steps, not three.**
`appearancePreferences.ts:108-114` defines Solid 0% / Light 8% / Medium 16% / High 22% / Glass 28%,
and `buildSurfaceTransparencyCssVariables` (`:304-318`) already derives a family of `--app-glass-*`,
`--app-surface-opacity`, and backdrop-alpha variables from it, with `Math.max` floors.

The spec described a phone Material control with three steps. It must not become a second scale.
The phone control therefore exposes a **three-option subset of the existing five**, writing the
**same key**:

| Phone label | Stored `surfaceTransparency` value |
| ----------- | ---------------------------------- |
| Solid       | `default`                          |
| Standard    | `medium`                           |
| Glass       | `glass`                            |

Desktop keeps all five options unchanged.

**2. A phone-tier default, not a floor over explicit choices.**
The spec said `max(userStep, phoneMinimum)`. That would override a deliberate Solid choice made on
desktop, which is the opposite of respecting the preference. Instead:

- When **no** override is stored, the effective value on the phone tier is `medium` ("Standard").
  Desktop's unstored default stays `default` (Solid), unchanged.
- Any **explicit** user selection is honoured exactly, on both tiers.
- `prefers-reduced-transparency` forces the effective value to `default` on both tiers while
  **preserving the stored value**, so the choice returns if the OS setting changes.

This gives the phone a visible default without overriding anybody, and needs no floor hack.

**3. Scope: `dock` tier and Dock density are deferred.**
The spec's material tiers are `chip`, `dock`, `sheet`, and its settings group includes Dock density.
There is no dock until delivery step 5, so the `dock` tier and the Dock density control ship there,
with their consumer. Same rule the primitives step applied.

## Execution rules

- Work only on `feat/phone-material-system` in the public repository.
- One preference key. Do **not** add a second transparency preference.
- No component hardcodes a blur radius, alpha, radius, or shadow — all come from tokens.
- Desktop and tablet must not change. Desktop's five options, its unstored default, and every
  existing `--app-*` variable keep their current values.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: `GlassSurface` and the material tokens

**Files:** add `apps/web/src/components/mobile/GlassSurface.tsx`; modify `apps/web/src/index.css`.

- [ ] Two tiers only: `sheet` and `chip`. Each resolves to a token triple — backdrop blur radius,
      backdrop saturation, background alpha — defined beside the existing theme tokens.
- [ ] Reuse the existing `--app-glass-*` and `--app-surface-opacity` variables where they already
      express the right thing rather than adding parallel ones. Report what you reused vs added.
- [ ] The `Glass` step composes thin material with a scrim beneath text content. The `Standard` step
      is a single layer at the opacity floor and applies no scrim. `Solid` is opaque, no blur.
- [ ] Light and dark both. The alpha floors will differ.

## Task 2: The contrast guarantee

**Files:** the token definitions, plus a browser test file.

- [ ] Text and icon colours on a glass tier must clear **WCAG AA against the tier's guaranteed
      base** — the composite of the tier's own alpha plus its scrim where one applies, over the
      **worst-case backdrop** (white in light, and the lightest content surface in dark), not over
      the page background.
- [ ] Assert it: compute the composited contrast ratio for every tier × every Material step × light
      and dark, and fail below 4.5:1 for body text and 3:1 for large text and icons. This is the
      assertion that makes the whole material system safe to ship, so it must be a real computation
      over resolved values, not a class-name check.

## Task 3: Motion tokens

**Files:** `apps/web/src/index.css`, `apps/web/src/components/mobile/MobileSheet.tsx`.

- [ ] One house curve `cubic-bezier(0.16, 1, 0.3, 1)` and the durations from the spec — 200 ms sheet
      present/dismiss, 260 ms stack push, 120 ms chip and pill state changes — as tokens.
- [ ] `MobileSheet` consumes the tokens instead of its inline curve and duration.
- [ ] `prefers-reduced-motion` collapses every transition to an instantaneous state change, and no
      correctness depends on a transition completing.

## Task 4: Phone appearance settings

**Files:** `apps/web/src/components/shell/phone/PhoneSettingsSurface.tsx`,
`apps/web/src/themes/appearancePreferences.ts`, and their tests.

Three controls this step. Dock density defers to step 5.

- [ ] **Material** — Solid / Standard / Glass, writing `surfaceTransparency` per the mapping above.
      Built from `MobileListRow` and `MobileSheet`, not a desktop select.
- [ ] **Text size** — a phone type scale. The 200% scaling requirement already forces the layout to
      survive this range, so verify no control is hidden and no page-level horizontal overflow
      appears at the largest step.
- [ ] **Motion** — reduce sheet and stack-push animation beyond the OS setting.
- [ ] Implement the phone-tier unstored default (`medium`) and the `prefers-reduced-transparency`
      override, both with tests. The override must preserve the stored value.
- [ ] Confirm the preference still persists in hosted mode. `appearancePreferences.ts` writes
      `localStorage` directly (`:1`, `:208-215`) rather than through the in-memory shim, which is
      intentional: the value is presentation-only and must resolve before first paint. Do not route
      it through the hosted in-memory storage.

## Task 5: Apply the material

**Files:** `apps/web/src/components/mobile/MobileSheet.tsx`, and the connection pill in
`apps/web/src/components/hostedHub/HostedConnectionControls.tsx`.

- [ ] `MobileSheet` renders on the `sheet` tier. Its backdrop contract is unchanged — opaque while
      modal, fading only on enter and exit. Do **not** reintroduce swipe-driven backdrop opacity;
      see the comment at its definition for why.
- [ ] The connection pill renders on the `chip` tier.
- [ ] Nothing else adopts glass in this step.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build` / `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] `bun audit`, distinguishing a proven pre-existing advisory baseline from a regression.
- [ ] Revert generated `scripts/lib/*.d.ts` drift from `build`/`typecheck`.
- [ ] Desktop regression: assert the five desktop options, the unstored desktop default, and the
      existing `--app-*` variable values are unchanged.

## Explicitly deferred to physical qualification

- WebKit `backdrop-filter` scroll performance with stacked material on a real device. This is the
  specific risk the `Glass` step carries and the reason `Standard` is the phone default.
- True rendering of translucent layers over real content on an OLED phone display.
