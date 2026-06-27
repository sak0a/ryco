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
- **Imagery:** real light screenshots framed in `ScreenshotFrame`, floating on the
  dark canvas (the Linear/Vercel "light shot on dark" look).

## Structure (single component — `Version4.tsx`)

`constants` (ACCENT, ICONS, MARQUEE_ITEMS, SHOWCASE steps) → `primitives`
(`Copyable`, `Eyebrow`, `SectionHeading`, `ProviderCard`, `Stat`, `FaqRow`,
`KineticBackground`) → `Version4` (one `useGsapContext` motion block + JSX).

Sections, in order: **nav → hero → marquee → agents → model providers → showcase
→ features → pillars+stats → how-it-works → download → FAQ → final CTA → footer.**

## Motion devices (all GSAP, via `useGsapContext`)

| Device | Where |
| ------ | ----- |
| Hero line clip-reveal + fade + accent underline draw | hero |
| Hero screenshot clip-reveal on load + scroll parallax | `heroShotRef` |
| Velocity-reactive marquee (speeds up with scroll, decays back) | `[data-marquee]` |
| Section heading line-mask reveals | `[data-line-reveal]` |
| **Pinned horizontal agent gallery** (scrub) + its own progress bar | `hzPinRef`/`hzTrackRef` |
| **Sticky scrollytelling** — screenshot swaps + step focus + counter | `[data-shot-step]`, `activeShot` |
| Timeline progress draw | `[data-timeline-progress]` |
| Numeric stat count-ups | `[data-count]` |
| Feature & pillar icon stroke draw-on (on reveal) + re-trace on card hover | `[data-draw-icon]` |
| "Live" status-dot ping pulse (`animate-ping`, `motion-reduce:hidden`) | hero badge · footer |
| Generic on-scroll reveals | `[data-reveal]` |

## Reduced motion

`useReducedMotion()` gates the **motion-only layouts** (the pinned horizontal
gallery and the sticky scrollytelling are *never constructed* — they render clean
static stacks instead, so there's never a blank pinned frame). All `useGsapContext`
animation no-ops under `prefers-reduced-motion`; nothing is CSS-hidden up front, so
the static layout is always complete.

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

> Note: the kinetic motion (pinned horizontal scroll, scrollytelling) only shows
> live in a browser — static captures show the reduced-motion fallback. Scroll the
> page in `bun run dev` to judge it.

## TODO

- [ ] **Real, populated hero screenshots** — capture an actual agent thread mid-run
  (a streaming response + a real diff) instead of the empty-thread `home.png`, plus
  a populated terminal. Needs a live agent turn against an authed provider.
- [ ] Tune the pinned horizontal-scroll length/easing on very wide and very short
  viewports; validate the sticky scrollytelling hand-off on real devices.
- [ ] Consider a proper pinned hero transition (currently a load-entrance + parallax).
- [ ] Mobile motion pass (horizontal gallery is desktop-pinned; mobile gets the
  static stack — confirm that's the desired behavior or design a mobile-native motion).
- [ ] Optimize screenshot weight (PNGs are ~1 MB each; consider WebP/AVIF + sizes).
- [ ] Copy: a light wit pass consistent with Ryco's honest "very early" tone.
