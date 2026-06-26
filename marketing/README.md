# Ryco — Marketing Site

A standalone marketing site for **Ryco** (a fast local workspace for coding agents),
shipping **six distinct, premium art directions** of the same landing page so the
team can pick a direction. Every version is **led by real product screenshots**
(captured from the running app) and uses the **authentic provider marks** the app
itself ships.

| Route | Direction        | Vibe                                   | Animation          |
| ----- | ---------------- | -------------------------------------- | ------------------ |
| `/`   | Overview         | Neutral gallery / picker               | —                  |
| `/1`  | **Precision**    | Linear/Vercel-grade dark product       | GSAP ScrollTrigger |
| `/2`  | **Datasheet**    | Technical monospace spec-sheet (light) | GSAP, mechanical   |
| `/3`  | **Editorial**    | Swiss serif magazine (light)           | anime.js v4        |
| `/4`  | **Kinetic**      | Motion-led scroll storytelling (dark)  | GSAP pin + scrub   |
| `/5`  | **Brutalist**    | High-contrast typographic (B/W + blue) | anime.js v4        |
| `/6`  | **Control Plane**| t3.codes-style, screenshot-led (light) | GSAP ScrollTrigger |

## Stack

- **React 19** + **react-router-dom** (routes `/1`…`/5`, lazy-loaded & code-split)
- **Tailwind v4** (`@tailwindcss/vite`)
- **GSAP** (+ ScrollTrigger) and **anime.js v4** for motion
- **Vite 6**, TypeScript strict
- Inline SVG brand/OS icons (`src/assets/brands.tsx`) — no icon CDN
- `lucide-react` for UI glyphs

It lives outside the monorepo workspace globs on purpose, so its dependency tree
never disturbs the pinned Effect/Bun catalog used by `apps/web`.

## Develop

```bash
cd marketing
bun install      # or npm install
bun run dev      # http://localhost:5174  (try /1 … /5)
```

## Build

```bash
bun run build    # → marketing/dist
bun run preview  # serve the production build on :4173
```

## Structure

```
src/
  data/content.ts            # single source of truth (features, providers, platforms, copy)
  assets/brands.tsx          # authentic provider + OS icons (the app's own marks, themeable)
  assets/RycoLogo.tsx        # vector wordmark + raster app mark
  components/shared/         # ScreenshotFrame (window chrome for real captures), VersionSwitcher
  lib/                       # cn(), GSAP motion helpers
  versions/Index.tsx         # the "/" gallery
  versions/v1..v6/           # the six self-contained landing pages
```

All five versions share `data/content.ts` so the copy stays factually consistent
with the real product while the layouts diverge hard.

## Real product screenshots

The screenshots in `public/shots/` are **real captures of the running Ryco app**
(not mockups). To regenerate them:

```bash
# from the repo root — build + boot the server with this repo as a project
bunx turbo run build --filter=ryco-cli
RYCO_HOME=/tmp/ryco-shots RYCO_PORT=13773 RYCO_HOST=127.0.0.1 RYCO_MODE=web \
  RYCO_NO_BROWSER=1 RYCO_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1 \
  node apps/server/dist/bin.mjs            # prints a one-time /pair#token=… URL

# then, with that token:
cd marketing
RYCO_TOKEN=<token> node scripts/app-shots.mjs   # → marketing/app-screenshots/
```

`app-shots.mjs` pairs once, drives the live app (composer, model picker, command
palette, terminal, providers, appearance) and blurs account identities (PII).
Copy the chosen frames into `public/shots/`.

## Page screenshots

`node scripts/shoot.mjs` boots a preview server and captures `/` and `/1`…`/6`
to `screenshots/`. `MOTION=off` captures the fully-settled (reduced-motion) state;
`ROUTES=/4 node scripts/shoot.mjs` limits to specific routes. Requires Playwright
(`bunx playwright install chromium`). `scripts/errcheck.mjs` loads every route with
motion on and reports console errors.
