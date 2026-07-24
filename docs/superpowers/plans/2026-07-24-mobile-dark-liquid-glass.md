# Ryco Mobile — Dark + Liquid-Glass design pass (implementation plan)

**Status:** Draft for owner review; not yet approved. Iterative — build a first cut, refine on the Simulator with the owner before locking each phase.

**Date:** 2026-07-24

**Target repository:** Public `sak0a/ryco`, new branch (suggest `feat/mobile-dark-liquid-glass`), all work under `apps/mobile/`. This is public work: follow the public dependency workflow (real branch, public gates, no private issue numbers/infra/policy in commits or PRs). The design content below is inherently public-safe (a visual system, no secrets).

**Grounded in:** the Cursor-for-iOS visual reference report and the Ryco-mobile current-styling inventory. Where the two disagree, this plan states the deliberate choice.

---

## 1. Premise and the one correction that shapes everything

The brief calls for **dark + Liquid Glass to match Cursor closely**. The design reference establishes two facts we must reconcile:

1. **Cursor's shipped mobile chrome is light-first**, not dark. There is no sourced dark-chrome screenshot. So "match Cursor's dark" means: **take Cursor's structure, shape language, restraint, and glass discipline exactly, and render them in a dark palette derived from Cursor's desktop brand.** The dark palette is a reconstruction (reference §8) — treat every dark hex as a first proposal to tune on-device with the owner, not a fixed truth.
2. **Glass is reserved for floating chrome only.** In Cursor, content surfaces (workspace list, PR cards, deployment rows, settings groups) are **flat opaque**; blur appears only on nav circles, the bottom input capsule, modal sheets, and overlay pills. **This overrides the inventory's touch-list suggestion to wrap Home/Settings/Connections cards in glass.** We will *not* glass-ify content cards. Doing so would read as generic "frosted everything," the opposite of Cursor's editorial calm.

Everything below follows from those two points.

Ryco's existing dark tokens are already close to the target (near-black `#0a0a0a` ground, `#171717` cards, `#f5f5f5` ink, inverted white primary button). The bulk of the work is therefore: **flip dark to default, retune tokens to Cursor's restrained accent set, tokenize the hardcoded palette classes, introduce glass on exactly the right floating surfaces, and re-lay-out each screen to Cursor's rhythm.**

---

## 2. Design principles (the rules every task obeys)

- **Black paper, near-white ink, one steel-blue + emerald/crimson.** Accents are small dots, glyphs, and tinted pills — never large fills. The single strong brand fill is the primary CTA.
- **Primary CTA is inverted on dark:** a **white capsule with black label** (Cursor flips primary contrast the same way; Ryco's dark `--color-primary` already does this).
- **Glass = floating chrome only.** Nav headers, the bottom composer capsule, circular icon buttons, modal sheets, and overlay pills. Content cards stay **opaque** `bg-card`.
- **Airy, editorial density.** ~20pt gutters, generous vertical rhythm, thin hairlines, quiet small metadata, high contrast between ink and ground. "Notion/Linear-adjacent minimal."
- **One token system, no forked logic.** Dark is the *resolved default*, not a code fork. Token classes (`bg-card`, `text-foreground`) resolve per theme via Uniwind's `@variant` blocks — **no `dark:` prefixes** on token classes. The only permitted capability branch is `GlassSurface`'s existing iOS-26-vs-fallback split, already encapsulated.
- **Uniwind CSS-first.** All tokens live in `global.css` `:root` `@variant light/@variant dark` blocks; runtime reads go through `useThemeColor("--color-*")`. New tokens require regenerating `uniwind-types.d.ts`.

---

## 3. Target design system

### 3.1 Palette — dark tokens (`apps/mobile/global.css`, dark `@variant` block)

Retune the existing dark values toward Cursor's derivation and **add** a restrained semantic accent set. `Current` = today's dark value from the inventory; `Target` = this pass.

**Ground and surfaces (keep content opaque)**

| Token | Current | Target | Rationale |
|---|---|---|---|
| `--color-screen` | `#0a0a0a` | `#0a0a0a` | keep — Cursor near-black ground |
| `--color-sheet` | `rgba(14,14,14,.98)` | `rgba(13,13,13,.98)` | keep opaque sheet fallback |
| `--color-card` | `#171717` | `#141414` | Cursor low-elevation card |
| `--color-card-alt` | `#1c1c1c` | `#1f1f1f` | second elevation |
| `--color-card-translucent` | `rgba(17,17,17,.8)` | `rgba(20,20,20,.8)` | align to new card |
| `--color-border` | `rgba(255,255,255,.06)` | `rgba(255,255,255,.10)` | Cursor hairlines (~`#262626`) read slightly more |
| `--color-border-subtle` | `rgba(255,255,255,.04)` | `rgba(255,255,255,.06)` | inset row dividers |
| `--color-separator` | `rgba(255,255,255,.03)` | `rgba(255,255,255,.05)` | |

**Ink**

| Token | Current | Target | Notes |
|---|---|---|---|
| `--color-foreground` | `#f5f5f5` | `#ededed` | Cursor primary ink |
| `--color-foreground-secondary` | `#a3a3a3` | `#a3a3a3` | keep |
| `--color-foreground-muted` | `#8e8e93` | `#949494` | bumped for AA on `#141414` (see §8) |
| `--color-foreground-tertiary` | `#636366` | `#6b6b6b` | timestamps/quiet metadata |
| `--color-placeholder` | `#8e8e93` | `#5a5a5a` | Cursor placeholder (decorative) |

**Primary / secondary buttons**

| Token | Current | Target | Notes |
|---|---|---|---|
| `--color-primary` | `#f5f5f5` | `#ffffff` | white CTA capsule (strongest brand mark) |
| `--color-primary-foreground` | `#0a0a0a` | `#0a0a0a` | black label |
| `--color-secondary` | `rgba(255,255,255,.04)` | `rgba(255,255,255,.05)` | ghost/outline fill |
| `--color-secondary-foreground` | `#f5f5f5` | `#ededed` | |
| `--color-secondary-border` | `rgba(255,255,255,.06)` | `rgba(255,255,255,.12)` | visible hairline outline |

**Accents — add these semantic tokens (light + dark values), replacing hardcoded amber/sky/rose/violet/emerald**

| New token | Dark value | Light value | Use |
|---|---|---|---|
| `--color-accent` | `#3b82c4` | `#1567a0` | streaming/agent text, links, active status |
| `--color-accent-strong` | `#4a90cf` | `#12629b` | small accent text/links, status dots on card |
| `--color-success` | `#2fa37a` | `#00764a` | passed/merged/additions glyph + text |
| `--color-success-bg` | `rgba(47,163,122,.14)` | `#b7d6cb` | tinted status pill fill ("Open") |
| `--color-success-border` | `rgba(47,163,122,.22)` | `rgba(0,118,74,.18)` | pill hairline |
| `--color-warning` | `#c99a3a` | `#9a6b12` | pending/approval only — use sparingly |
| `--color-warning-bg` | `rgba(201,154,58,.14)` | `rgba(201,154,58,.14)` | |
| `--color-warning-border` | `rgba(201,154,58,.22)` | `rgba(201,154,58,.22)` | |
| `--color-diff-add` | `#2fa37a` | `#00764a` | `+80` counters (tabular) |
| `--color-diff-del` | `#e0455f` | `#c7113f` | `-230` counters (tabular) |

**Retune existing danger to Cursor crimson**

| Token | Current | Target |
|---|---|---|
| `--color-danger` | `rgba(239,68,68,.14)` | `rgba(224,69,95,.12)` |
| `--color-danger-border` | `rgba(248,113,113,.18)` | `rgba(224,69,95,.22)` |
| `--color-danger-foreground` | `#fca5a5` | `#e0455f` |

**User bubble — deliberate divergence (flag for owner)**
Cursor's *user prompt* bubble is a neutral gray, right-aligned — **not** blue; blue is reserved for agent/streaming. Ryco currently uses iOS system blue (`#0a84ff`). Recommend switching to a neutral elevated surface; hold behind owner approval in Phase 2 since it changes a familiar element.

| Token | Current | Target (proposed) |
|---|---|---|
| `--color-user-bubble` | `#0a84ff` | `#1f1f1f` |
| `--color-user-bubble-foreground` | `#ffffff` | `#ededed` |

**Glass materials**

| Token | Current | Target | Notes |
|---|---|---|---|
| `--color-glass-surface` | `rgba(23,23,23,.78)` | `rgba(18,18,18,.64)` | dark ultra-thin material fallback fill (~60–70% opacity) |
| `--color-glass-tint` | `rgba(23,23,23,.24)` | `rgba(255,255,255,.05)` | faint white specular tint (Cursor dark glass has white edge, not dark) |
| `--color-glass-specular` *(add)* | `rgba(255,255,255,.12)` | — | top-edge highlight for the non-glass fallback rim |
| `--color-header` | `rgba(10,10,10,.97)` | `rgba(10,10,10,.80)` | fallback header only; glass path stays transparent |
| `--color-header-border` | `rgba(255,255,255,.06)` | `rgba(255,255,255,.08)` | |
| `--color-status-bar` | `#0a0a0a` | `#0a0a0a` | keep; `light-content` bar style |
| `--color-backdrop` | `rgba(0,0,0,.48)` | `rgba(0,0,0,.55)` | scrim behind glass sheets (Cursor dims + scales page) |

Also tokenize the hardcoded plan/skill/markdown accents that currently duplicate palette hues (`--color-inline-skill-*`, `--color-md-*`) toward `--color-accent`/`--color-success`/`--color-danger` where they overlap, so the whole surface coheres. Keep the light `@variant` block intact and fully valid (a future toggle must be able to restore light).

### 3.2 Typography

- **Keep DMSans** (`--font-sans`/`--font-medium`/`--font-bold`). DMSans is a geometric grotesk — a faithful stand-in for Cursor's default "Grotesk" (double-story a/g, even width). No family change; the marketed screens confirm a neutral grotesk, not a serif or rounded face. The appearance screen's Typography options map cleanly onto Ryco's existing font-var mutation path.
- **Weights:** Bold/Semibold for large titles; Medium for row titles and button labels; Regular for body/secondary.
- **Large-title pattern:** left-aligned large title *below* the transparent nav bar (~28pt bold), not a centered inline title. Use native `headerLargeTitle` where the stack supports it.
- **Sizes** (map to existing `--text-*` scale): row title ~17pt medium, subtitle ~15pt regular, section header ~13–15pt regular in `--color-foreground-muted` (**not** uppercased), nav actions ~17pt.
- **Monospace is reserved strictly for code and file diffs** (Review diff body). Diff *counts* use the proportional UI font, tabular figures.
- Preserve the `AppearancePreferencesProvider` `--text-*` live-mutation path unchanged — Dynamic Type / user font-scale must keep working.

### 3.3 Shape language (radii)

| Element | Radius | Ryco expression |
|---|---|---|
| Circular icon buttons | full circle, 44pt | `rounded-full`, 44×44 |
| Pills / CTAs / status pills | capsule (½ height) | `rounded-full` |
| Content cards | ~16pt | `rounded-2xl` (keep existing recipe) |
| Message bubble | ~20pt | `rounded-[20px]` |
| Modal / compose sheet top | ~28–32pt | sheet radius 28 (expose as `GlassSurface` prop; today it hardcodes 32) |

Parameterize `GlassSurface`'s hardcoded `borderRadius: 32` into a `radius` prop so capsules (composer, icon circles) and sheets can share the component.

### 3.4 Spacing / density

- **~20pt horizontal gutters** — move screen roots from `px-4` to `px-5` where they currently use 16.
- Two-line rows **64–72pt** tall: `[leading status dot 10–12pt] [title (ink) / subtitle (muted · repo · ✓status · +add −del)]`. Row dividers **inset** to the text (leave the status-dot gutter empty).
- Section grouping: large title → muted section header → rows, with ~16–20pt gaps between groups.
- **No bottom tab bar** — navigation stays push/stack + the bottom composer capsule, matching Cursor. Do not introduce a 5-tab layout.

### 3.5 Glass materials spec

Rendering path (reuse existing infra, do not add libraries):

- **Capability flag:** `NATIVE_LIQUID_GLASS_SUPPORTED` (`src/native/native-glass.ts`, from `@callstack/liquid-glass`) and the iOS-only guard `src/lib/native-glass-capability.ts`.
- **Component:** `GlassSurface` (`expo-glass-effect` `<GlassView>` on iOS 26, plain `<View>` fallback) and `GlassSafeAreaView`. Both are currently **dead code** — this pass gives them their first consumers.
- **Fallback (Android / pre-iOS-26):** opaque fill from `--color-glass-surface` + a 1px top rim from `--color-glass-specular` to fake depth. Header fallback keeps `SHEET_BACKGROUND_COLOR` (`Stack.tsx`). No blur is faked with heavy shadows.

Glass surfaces (and *only* these):
1. **Nav headers** — already glass via `GLASS_HEADER_OPTIONS` (`Stack.tsx`), gated on iOS 26 with `scrollEdgeEffects`. Keep; extend the glass preset to any stack route that should float.
2. **Bottom composer capsule** (`ThreadComposer`) — the marquee surface; content fades faintly beneath it. Currently deferred by an in-file comment; this pass ships it.
3. **Circular icon buttons** — nav actions and `ControlPill`'s icon variant become translucent glass circles (dark tint on content, invert on dark-image annotation surfaces if/when present).
4. **Modal / compose sheets** (`ReviewSheet`, any voice/compose sheet) — glass sheet that **dims + scales** the page behind (`--color-backdrop`), with a grab handle; sheet body near-opaque.
5. **Overlay pills on media** — translucent-white glass pill (e.g. a "Learn"-style control) where media backdrops occur.

Explicitly **not** glass: Home list cards, PR/deployment cards, Settings groups, Connections list, EmptyState cards, WorkspaceConnectionStatus banner — all stay opaque `bg-card`.

---

## 4. Dark-by-default wiring (appearance path intact)

Flip the resolved default to dark **without** deleting the light theme or forking logic:

1. `app.config.ts:105` — `userInterfaceStyle: "automatic"` → `"dark"`.
2. Splash (`app.config.ts:196–199`) — promote the dark background to the default: light `backgroundColor` `#ffffff` → `#0a0a0a` so first paint is dark (dark variant already `#0a0a0a`).
3. `App.tsx:54,74` — replace the raw `useColorScheme()` reads with a single **resolved app scheme** helper that returns `"dark"` today, but is written as a resolver (so a future appearance preference can override it). Pass `DarkTheme` to `@react-navigation/native`. `StatusBar` already switches to `light-content` for dark.
4. **Uniwind active theme** — ensure Uniwind resolves the `dark` `@variant`. With `userInterfaceStyle: "dark"` + navigation `DarkTheme`, RN reports dark and token classes resolve; if Uniwind needs an explicit nudge, force the active theme through the resolver, not per-component.
5. **Keep `AppearancePreferencesProvider` unchanged** for font/code prefs. Do **not** add a color toggle in this pass; the resolver is the seam a future light/dark switch plugs into. No user-facing theme toggle ships here.

Net effect: one resolver drives RN scheme, navigation theme, and Uniwind together — dark by default, light fully intact behind the seam.

---

## 5. Per-screen restyle (concrete token/class changes)

All paths under `apps/mobile/src/`. Content surfaces stay opaque; only the surfaces named as glass in §3.5 change material.

- **Home** (`features/home/HomeScreen.tsx`) — root `bg-screen`; grouped list stays `rounded-2xl border border-border bg-card`; gutters `px-4`→`px-5`. Replace `Connect`/`Settings` text buttons with **glass icon circles** in the header. Retune status pills at `:17–40` (hardcoded amber/sky/rose) to semantics: active/queued = `--color-accent` solid dot, idle = `--color-foreground-tertiary` hollow dot, passed/merged = `--color-success`, error = `--color-danger`. Large left-aligned title; muted non-uppercased `Pinned/Today/<workspace>` section headers; rows 64–72pt with inset dividers.
- **Thread** (`features/threads/ThreadDetailScreen.tsx`) — user bubble → `--color-user-bubble` neutral, right-aligned `rounded-[20px]` (owner-gated); assistant text plain on `bg-screen` with streaming text in `--color-accent`; proposed-plan card `:172–174` (hardcoded violet) → `--color-accent`-tinted card (`--color-success-bg`-style tint token, or add `--color-accent-bg`). Compaction divider `bg-border`.
- **Thread composer** (`features/threads/ThreadComposer.tsx`) — rebuild the bar as a **floating glass capsule** (`GlassSurface`, `rounded-full`), content fading under it; input placeholder in `--color-placeholder`; Send = **primary white** circle/pill with black icon; add a model-picker capsule if a model selector belongs here. Remove the "deferred" comment when shipped.
- **Review** (`features/review/ReviewSheet.tsx`) — present as a **glass sheet** (dim+scale backdrop) or keep `sheet-solid` fallback; diff body stays opaque `bg-card` **mono**; `+/−` counts use `--color-diff-add`/`--color-diff-del`, tabular; primary "merge"-style CTA = white pill; secondary review action = ghost outline (`--color-secondary` + `--color-secondary-border`).
- **Connections** (`features/connection/ConnectionsRouteScreen.tsx`) — list opaque `bg-card`; pair button primary white; Remove `:85–87` (hardcoded rose) → `--color-danger` ghost; retune `connectionTone.ts:23–54` (emerald/amber/sky/rose) to `--color-success`/`--color-warning`/`--color-accent`/`--color-danger`. A floating connection pill, if present, becomes glass.
- **Settings** (`features/settings/SettingsRouteScreen.tsx` + `components/SettingsSection.tsx`/`SettingsRow.tsx`/`SettingsSwitchRow.tsx`) — grouped-list stays opaque `bg-card`, `border-t border-border`, `active:bg-subtle`; destructive row `SettingsRow.tsx:20` (rose) → `--color-danger`; switch-active keep green (`--color-switch-active`). Appearance sub-screen (Typography/App Icon tiles) unchanged in behavior.
- **Onboarding** (`features/onboarding/OnboardingRouteScreen.tsx`) — `bg-screen` dark; primary CTA = white pill.
- **Empty states** (`components/EmptyState.tsx`) — opaque card variant, muted copy; no glass.
- **Shared components** — `StatusPill` routes to the new semantic tokens; `ControlPill` gains a glass icon-circle variant; `ErrorBanner.tsx:6–7` (rose) → `--color-danger`; `PendingUserInputCard.tsx:63–64` (sky) → `--color-accent`; `PendingApprovalCard.tsx:39–40` (amber) → `--color-warning`; `WorkspaceConnectionStatus` banner stays opaque; `RycoWordmark` uses `--color-wordmark`.

**De-hardcode checklist (each currently carries its own `dark:` variant — remove the variants once tokenized):** `HomeScreen.tsx:17–40`, `connectionTone.ts:23–54`, `ErrorBanner.tsx:6–7`, `ConnectionsRouteScreen.tsx:85–87`, `PendingUserInputCard.tsx:63–64`, `PendingApprovalCard.tsx:39–40`, `ThreadDetailScreen.tsx:172–174`, `SettingsRow.tsx:20`.

---

## 6. Accessibility & contrast (WCAG AA on the dark palette)

- Verify **AA** for every text-on-surface pair: normal text ≥ 4.5:1, large (≥ ~18pt / 14pt bold) ≥ 3:1, graphical/UI (dots, borders, icons) ≥ 3:1. Targets designed to this: `#ededed` on `#0a0a0a` (~17:1), muted `#949494` on `#141414` card (~4.5:1 — the reason muted was bumped from `#8e8e93`), `--color-accent-strong #4a90cf` reserved for **small** accent text/links (base `#3b82c4` only for ≥large text or graphical dots).
- **Status is never color-alone**: dot shape (solid/hollow), glyph, and label all encode state.
- Touch targets ≥ 44pt (glass icon circles are 44). Placeholder `#5a5a5a` is decorative and exempt; entered text must render at `--color-foreground`.
- A dedicated task computes exact ratios for the final palette and fixes any failures before owner sign-off — do not assume the proposed hexes pass; verify.

---

## 7. Iterative delivery (build a cut, refine on the Simulator with the owner)

Four phases, each producing a Simulator build the owner reviews before the next begins. Nothing is "locked" until the owner approves that phase on-device.

- **Phase 0 — Foundation:** tokens (§3.1) + dark-default wiring (§4) + `GlassSurface` radius prop. No screen re-layout yet. Owner reviews the base palette, the already-glass header, and dark first-paint.
- **Phase 1 — Glass chrome:** composer capsule, glass icon circles, glass sheet + dim/scale backdrop. Owner reviews the floating-chrome feel.
- **Phase 2 — Screens + de-hardcode:** §5 screen-by-screen, tokenize the hardcoded palette, the owner-gated user-bubble change. Owner reviews each screen against the Cursor reference caption it maps to.
- **Phase 3 — Accessibility + fallback + polish:** contrast pass (§6), non-iOS-26 / Android fallback verification, motion/quiet-state polish, final gate.

---

## 8. Ordered tasks with per-task acceptance

Acceptance vocabulary: **typecheck** = `bun typecheck` clean; **vp** (visual-parity self-check) = Simulator screenshot of the touched surface compared side-by-side against the mapped Cursor reference screenshot, structure/rhythm/accents matching; **owner-check** = owner approves the surface live on the Simulator. The **full gate** (`bun install --frozen-lockfile`, `bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run test`, `bun run build`, `bun audit`) plus `vendor/ryco` public gates runs before the PR and after any review-driven change.

**Phase 0**
- **T0.1 Palette tokens.** Apply §3.1 to the dark `@variant` block; add the new accent/diff/glass tokens to **both** light and dark blocks; regenerate `uniwind-types.d.ts`. *Accept:* typecheck; token classes resolve at runtime.
- **T0.2 Dark-by-default wiring.** §4 (config, splash, resolver, navigation theme, Uniwind). *Accept:* typecheck; app boots dark from splash through first screen; light block still compiles.
- **T0.3 GlassSurface radius prop.** Parameterize `borderRadius`. *Accept:* typecheck; existing header glass unchanged.
- **T0.4 Owner review — foundation.** *Accept:* vp (Home/Thread at token level); owner-check on base palette + first-paint.

**Phase 1**
- **T1.1 Glass composer capsule** (`ThreadComposer`). *Accept:* typecheck; vp vs "Ship code / Talk to Cursor" bottom bar; owner-check.
- **T1.2 Glass icon circles** (nav actions + `ControlPill` variant). *Accept:* typecheck; vp; owner-check.
- **T1.3 Glass sheet + backdrop** (`ReviewSheet`, compose sheets). *Accept:* typecheck; vp vs voice/compose sheet; owner-check.
- **T1.4 Owner review — chrome.** *Accept:* owner-check across all Phase-1 surfaces on-device.

**Phase 2**
- **T2.1 Home** — layout + status semantics + glass header buttons. *Accept:* typecheck; vp vs "Kick off new agents"; owner-check.
- **T2.2 Thread** — bubbles, streaming accent, plan-card tokenize. Includes owner-gated user-bubble change. *Accept:* typecheck; vp; owner-check (explicit yes/no on the bubble color).
- **T2.3 Review** — diff tokens, CTA taxonomy. *Accept:* typecheck; vp vs "focused diff before merging"; owner-check.
- **T2.4 Connections** — tokenize `connectionTone.ts`, danger ghost. *Accept:* typecheck; vp; owner-check.
- **T2.5 Settings** — destructive/switch tokens, grouped-list. *Accept:* typecheck; vp; owner-check.
- **T2.6 Onboarding + Empty states + shared banners.** *Accept:* typecheck; vp; owner-check.
- **T2.7 De-hardcode sweep** — remove every `dark:` variant listed in §5; grep proves no stray hardcoded amber/sky/rose/violet/emerald remains. *Accept:* typecheck; `rg` clean.

**Phase 3**
- **T3.1 Contrast audit** (§6) — compute ratios for the final palette; fix failures. *Accept:* documented ratio table, all AA; owner-check.
- **T3.2 Fallback verification** — Android + a pre-iOS-26 iOS Simulator: glass degrades to the opaque `--color-glass-surface` + specular-rim treatment, no broken chrome. *Accept:* screenshots on both; typecheck.
- **T3.3 Motion/quiet-state polish** — animated blue "Working" cluster, recording waveform/timer, native spring sheet depth; keep motion quiet. *Accept:* vp; owner-check.
- **T3.4 Full gate + PR** — run the complete Hub-adjacent public gate set and `vendor/ryco` gates; open a public PR on `sak0a/ryco`. *Accept:* all gates green; PR opened; owner sign-off on the assembled build.

---

## 9. Process notes (public branch)

- Public implementation on a real `sak0a/ryco` branch; keep public commits/PRs free of private issue numbers, infra, and policy. Any canonical primitive/fixture change goes through public Ryco's own repo commands first.
- Confirm the pinned Bun version (`package.json`) before installs; do not upgrade the toolchain incidentally.
- Migrations/persistence are untouched by this pass — it is presentation-only.
- Do not claim completion until the requested acceptance criteria and required tests pass, and the owner has signed off the assembled Simulator build per phase.
- The dark palette hexes are a **derived reconstruction** (reference §8): treat §3.1 as the starting proposal and let the owner-review loop (T0.4 → T3.3) tune them against the live app.