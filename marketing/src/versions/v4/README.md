# v4 — "Kinetic" (the chosen direction)

The marketing site's active landing page, served at `/` and `/4`. A motion-led,
scroll-driven showcase where **motion is the headline feature** — chosen over the
five other directions (now archived in `.archive/`).

> Status: **working draft.** The bones are solid and verified; there's polish and
> a few real-content upgrades still to do (see [TODO](#todo)).

---

## Recap — how we got here

1. **First attempt (rejected).** Six generic "AI-design-skill" directions
   (aurora / terminal / neon / bento / editorial / glass) with faux UI mockups and
   weak hand-drawn provider icons. Too templated.
2. **Reset.** We:
   - Booted the **real Ryco app** headless (`apps/server/dist/bin.mjs` with
     `RYCO_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1`), paired via a one-time token, and
     **captured real product screenshots** across situations (workspace, model
     picker, command palette, terminal, project overview, providers, appearance).
     Account identities are blurred (PII). → `public/shots/`.
   - Swapped in the **authentic provider marks** the app itself ships
     (`apps/web/src/components/Icons.tsx`) → `src/assets/brands.tsx`.
   - Rebuilt all six directions to a higher bar (real screenshots + real icons,
     no generic themes), led by a t3.codes-inspired flagship.
3. **Pick.** v4 "Kinetic" was chosen as the best-feeling direction. The other five
   moved to `.archive/versions/` (gitignored, restorable — see `.archive/README.md`),
   and the router was slimmed to v4 only.

## Art direction

- **Canvas:** charcoal `#0a0b0d`; high-contrast white type; faint grid + a single
  lime glow backdrop (`KineticBackground`).
- **Accent:** electric lime `#c6ff3a`, used sparingly as kinetic punctuation.
- **Type:** Space Grotesk (display) · Inter (body) · JetBrains Mono (labels/code).
- **Imagery:** real **dark-mode** product captures framed in `ScreenshotFrame`
  (chrome-less, ringed) floating on the dark canvas. `ScreenshotFrame` can lock an
  `aspect` + `fit` so differently-sized captures present at a consistent height.

## Structure (`Version4.tsx` + `process-icons.tsx` + `feature-icons.tsx`)

`constants` (ICONS, MARQUEE_ITEMS, SHOWCASE steps) → `hooks`
(`useReducedMotion`, `useMagnetic`, shared `useTilt`) → `primitives` (`Copyable`,
`Eyebrow`, `SectionHeading`, `Stat`, `FaqRow`, `KineticBackground`,
`KineticTerminal`) → `Version4` (one `useGsapContext` motion block + JSX).

Shared v4 pieces live in their own files so the page, nav and deck stay readable:
`theme.ts` (the `ACCENT` + `focusRing` tokens), `MagneticButton.tsx` (the one
button primitive — sheen + press), `ProviderCard.tsx` (one provider tile, with a
`deck` variant), `SiteNav.tsx` (the floating navigation), `AgentDeck.tsx` (the
3D agent coverflow) and `Gallery.tsx` (the "under the hood" 3D scroll fly-in). The bespoke How-it-works step icons live in `process-icons.tsx`;
the always-on toolkit feature icons in `feature-icons.tsx` (both keyed off
`content.ts`). Their CSS loops + the terminal caret are in `src/index.css`
(`.ryco-proc*` / `.ryco-feat*`).

Sections, in order: **nav → hero → marquee → agents → model providers → showcase
→ features → deep dive ("under the hood") → pillars+stats → how-it-works →
download → FAQ → final CTA → footer.**

## Motion devices (mostly GSAP via `useGsapContext`; a few hand-rolled)

| Device | Where |
| ------ | ----- |
| Hero line clip-reveal + fade + accent underline draw | hero |
| Hero screenshot clip-reveal on load + scroll parallax | `heroShotRef` |
| Velocity-reactive marquee (speeds up with scroll, decays back) | `[data-marquee]` |
| Section heading line-mask reveals | `[data-line-reveal]` |
| **3D agent coverflow** — pinned horizontal scroll; the five providers tilt/scale/dim by distance from centre as they pan past | `AgentDeck.tsx` |
| **Sticky scrollytelling** — screenshot swaps + step focus + counter | `[data-shot-step]`, `activeShot` |
| Timeline progress draw | `[data-timeline-progress]` |
| **Bespoke concept step-icons** (CSS loops: trace / bob / pulse / spin) | `process-icons.tsx`, How-it-works |
| **Always-on toolkit feature icons** (CSS loops: pulse / trace / scan / flow / blink) | `feature-icons.tsx`, six grouped features |
| **Kinetic terminal** — real commands type in on scroll + blinking caret | `KineticTerminal`, download |
| Numeric stat count-ups | `[data-count]` |
| Pillar icon stroke draw-on (on reveal) + re-trace on card hover | `[data-draw-icon]` |
| **FAQ +/− morph** (a bar rotates a quarter-turn) | `FaqRow` |
| **Magnetic** CTAs (pointer pull, eased return) | `[data-magnetic]` via `useMagnetic` |
| **Floating nav** — sliding active indicator (scroll-spy), scroll-progress hairline, animated mobile menu | `SiteNav.tsx` |
| **Button sheen** — light sweep on hover + press scale | `MagneticButton.tsx` |
| **3D card tilt + glare** — hero shot, feature & platform cards lean toward the pointer | `[data-tilt]` / `[data-glare]` via `useTilt` |
| **3D gallery fly-in** — deep-dive captures swing in from alternating sides (rotateY + depth), scrubbed to scroll | `Gallery.tsx` (`[data-fly]`) |
| Generic on-scroll reveals | `[data-reveal]` |

> A few devices are intentionally **not** GSAP: the terminal (`IntersectionObserver`
> + `setTimeout`) and `useMagnetic` (pointer events) are plain client hooks; the
> process + feature icons and the FAQ morph run in pure CSS.

## Reduced motion

`useReducedMotion()` gates the **motion-only layouts** (the 3D agent deck and the
sticky scrollytelling are *never constructed* — agents fall back to a clean static
grid, showcase to a stacked layout, so there's never a blank frame). All
`useGsapContext` animation no-ops under `prefers-reduced-motion`. The hand-rolled
additions gate too: `useTilt` and `useMagnetic` early-return (also skipping coarse
pointers), the `AgentDeck` engine never starts (touch/narrow get a scroll-snap
carousel), the `SiteNav` indicator snaps instead of sliding, the terminal renders
**all** lines instantly, and the CSS process/feature icons + FAQ morph rely only on
default base values (dashoffset 0, opacity 1, no transform) so the global
reduced-motion guard freezes them fully drawn. Nothing is CSS-hidden up front, so the
static layout is always complete.

## Content

All copy/data comes from `src/data/content.ts` (SITE, PROVIDERS, MODEL_PROVIDERS,
PLATFORMS, FEATURES, STATS, PILLARS, STEPS, FAQ). Keep it factually grounded in the
real product.

## Run & verify

```bash
cd marketing
bun run dev                         # http://localhost:5174  (v4 at / and /4)
bunx tsc --noEmit && bunx vite build
node scripts/errcheck.mjs           # loads route with motion on, reports console errors
MOTION=off ROUTES=/4 node scripts/shoot.mjs   # settled (reduced-motion) capture
```

> Note: the kinetic motion (the pinned 3D agent coverflow, scrollytelling) only shows
> live in a browser — static captures show the reduced-motion fallback. Scroll the
> page in `bun run dev`, through the pinned agent section, to judge it.

## TODO

- [x] **Real, populated dark-mode captures** — the hero, showcase, agent finale and
  "under the hood" gallery now use focused dark screenshots (overview, model picker,
  terminal, diff, files, themes, diagnostics, providers, instances, plugins, CI,
  project). A streaming agent thread mid-run would still be a nice hero upgrade.
- [ ] Tune the 3D agent-deck radius/auto-spin on very wide and very short viewports;
  validate the sticky scrollytelling hand-off on real devices.
- [ ] Consider a proper pinned hero transition (currently a load-entrance + parallax).
- [ ] Mobile motion pass (the agent deck is desktop-only; touch gets a scroll-snap
  carousel — confirm that reads well, or design a touch-native deck interaction).
- [ ] Optimize screenshot weight (PNGs are ~1 MB each; consider WebP/AVIF + sizes).
- [ ] Copy: a light wit pass consistent with Ryco's honest "very early" tone.
