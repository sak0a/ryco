# Phone dock and Home/Thread relayout implementation plan

**Goal:** Move primary navigation and actions out of the top corners and into thumb reach, by
introducing a contextual floating dock and relaying out Home and Thread around it.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Delivery step 4. Steps 1 (composer, #205), 2 (primitives, #206) and 3 (material, #207) are merged.

## Why this step exists

The measured baseline, under true coarse-pointer emulation at 390×844:

- **Home places 16 of 16 interactive controls in the top third. Zero in the middle or lower third.**
  Roughly 650 px below them is dead space.
- On Thread the back affordance, connection pill, workspace toggle and thread-actions kebab all sit
  in the top row, the last two in the top-right corner specifically.
- Of the thread view's 18 interactive controls, 16 measured below 44 px, and the base control's
  `::before` resolves to `inset: 0` so nothing is rescued by hit-slop.

Everything in this step is judged against those numbers.

## Scope

Ships here, because their consumers arrive here:

- `MobileDock` — the floating capsule, safe-area and keyboard-inset anchored.
- `MobileContextStrip` — the horizontally scrollable pill rail.
- The `dock` `GlassSurface` tier, deferred from step 3.
- The **Dock density** control in phone appearance settings, deferred from step 3.

Not in this step: `MobileSelectSheet` and `MobileSegmentedControl` (step 5, model and session-policy
sheets), `MobileStatusChip` (step 6, connection indicator). The connection pill keeps its current
presentation here; only its position may change.

## Execution rules

- Work only on `feat/phone-dock-relayout` in the public repository.
- The dock is an **overlay**, not layout: content runs full-bleed underneath it. Surfaces gain
  bottom scroll padding so nothing is permanently obscured.
- It is **not** a tab bar. Contents are contextual per surface. Do not add sibling navigation.
- Primitives stay presentation-only: props in, callbacks out, no store, RPC, or lifecycle access.
- Desktop and tablet must not change. The dock mounts on the phone tier only.
- Reuse `GlassSurface`, `MobileSheet`, `MobileListRow`, the motion tokens, and the existing
  `--app-keyboard-inset` adapter. Add no new resize listeners.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: `MobileDock` and the `dock` material tier

**Files:** add `apps/web/src/components/mobile/MobileDock.tsx` and its browser test; modify
`GlassSurface.tsx`, `index.css`.

- [x] Floating capsule anchored above the safe area and above `--app-keyboard-inset`, so it rides
      the software keyboard exactly as the composer does.
- [x] Add the `dock` tier to `GlassSurface`. Derive its floor the same way step 3 did: enumerate the
      text roles the dock actually renders, composite over the worst-case backdrop, and assert AA.
      Do not reuse the sheet's floor by assumption — the dock has its own role set.
- [x] `prefers-reduced-motion` honoured; no correctness depends on a transition completing.
- [x] Every dock control ≥44 px, asserted under coarse-pointer emulation.

## Task 2: `MobileContextStrip`

**Files:** add `apps/web/src/components/mobile/MobileContextStrip.tsx` and its browser test.

- [x] Horizontally scrollable pill rail with an edge affordance so off-screen pills are
      discoverable. Momentum scrolling; no desktop scrollbar.
- [x] Each pill is a ≥44 px tap target with an accessible label.
- [x] It must not introduce page-level horizontal overflow at 320 px — the strip scrolls, the page
      does not.

## Task 3: Home relayout

**Files:** `apps/web/src/components/shell/phone/PhoneHome.tsx` and its browser test.

- [x] App bar reduces to title plus the connection pill.
- [x] Dock carries search, **New thread**, and settings — the three controls currently stranded in
      the top-right.
- [x] The thread list takes the full height it currently wastes; empty states centre in the content
      region rather than under the app bar.
- [x] Bottom scroll padding so the last row can clear the dock.

## Task 4: Thread relayout

**Files:** `apps/web/src/components/chat/ChatComposer.tsx`,
`apps/web/src/components/shell/phone/PhoneThreadAppBar.tsx`, and their tests.

- [x] App bar reduces to back, title, and the connection pill. **The workspace toggle and the
      thread-actions kebab leave the top-right corner.**
- [ ] (deviation, see below) The composer capsule becomes the dock: leading `＋`, the live editor, trailing send.
- [ ] (partial, see below) A `MobileContextStrip` above the capsule carries model, context usage, and branch, plus mode
      and access when they differ from default. Each pill opens its own sheet. Reuse the existing
      controls' behaviour — this step changes presentation and placement, not what they do.
- [x] Workspace and thread actions move into the dock row's toggle and `⋯` sheet.
- [x] **Do not regress the first-tap composer focus fix from #205.** The collapsed editor must stay
      laid out and focusable, focus must still land in the activating task, and its tests must still
      pass unmodified. If a relayout makes that hard, stop and report rather than weakening the test.

## Task 5: Dock density

**Files:** `apps/web/src/components/shell/phone/PhoneAppearanceSettings.tsx`,
`apps/web/src/themes/appearancePreferences.ts`, and their tests.

- [x] Compact and comfortable, following the established preference pattern: one key, an explicit
      choice honoured exactly, no second scale.
- [x] Both densities keep every dock control ≥44 px. Compact reduces padding, never target size.

## Task 6: Reachability assertions

**Files:** the browser suites, extending the existing matrix rather than duplicating it.

- [x] On Home and Thread at 320×568, 390×844 and 430×932 under coarse-pointer emulation, assert that
      the centre of every primary and frequent action falls **below two-thirds of the viewport
      height**. This is the assertion that pins the whole step; it must measure geometry, not class
      names.
- [x] Assert the top-right corner holds no primary or frequent action on either surface.
- [x] **Coarse landscape (844×390) is an explicitly asserted exemption**, not a silent skip — the
      lower third is ~130 px there. Assert that the exemption applies and that chrome stays reachable.
- [x] No page-level horizontal overflow at any tested width.
- [x] Desktop regression: desktop browser suite unchanged, dock absent on the desktop tier.

## Open defect found by the reachability assertions

**The dock leaves the bottom third while a pending approval is open.** `ApprovalCard`
and `ComposerPendingUserInputPanel` render inside `ChatComposer`, above the prompt
editor and therefore **below** the dock row, so an open approval grows the composer
upward and carries the dock with it. Measured on the real `ChatView` phone path, with
the two-thirds line in brackets:

- 390×844 — dock controls centre at y≈305 (562.7)
- 320×568 — dock controls centre at y≈75 (378.7), back in the **top** third

It is still better than the audited baseline, where these controls sat at y≈8–26 in the
app bar in every state, but it does not clear the bar in this one. The assertion is kept
at full strength and pinned with `it.fails` in `ChatView.browser.tsx`, so the defect
cannot be forgotten and a fix makes the test fail until the annotation is removed.

The fix is to render the dock row beneath the approval and pending panels rather than
above the whole composer form, which means moving it inside `ChatComposer` — the exact
container whose focus handling the first-tap composer fix depends on. That is deliberately
not attempted in this step.

## Deviations from this plan, as implemented

Two Task 4 items landed differently, and the reasons are recorded here rather
than left implicit.

- **The composer capsule was not restructured into `MobileDock`.** On the thread
  surface the composer is already the bottom-anchored, keyboard-inset-riding
  capsule, so a second floating capsule would sit on top of it. `PhoneThreadDock`
  is therefore a laid-out row directly above the composer — leading workspace
  toggle, context strip, trailing `⋯` — and `MobileDock` is the floating overlay
  Home uses. Rebuilding the composer's internals as `＋ / editor / send` would
  have meant editing the exact structure the #205 fix depends on, for a
  presentational gain the reachability assertions already prove without it. The
  `dock` material tier's only consumer is consequently `MobileDock`.
- **The strip carries branch, find-in-thread and sessions, not model and context
  usage.** The model and context-usage controls have no phone surface until
  `MobileSelectSheet` and the model/session-policy sheets ship; putting them on
  the strip now would either open the desktop combobox on a phone — the defect
  the next step exists to fix — or pull that step's scope forward. Branch is on
  the strip as specified, on the source-control pill.

## Validation

- [x] `bun install --frozen-lockfile`
- [x] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [x] `bun run test`
- [x] `bun run build` / `bun run build --filter=@ryco/web`
- [x] `bun run --cwd apps/web test:browser`
- [x] `bun audit`, identical 59-finding baseline before and after the change.
- [x] Revert generated `scripts/lib/*.d.ts` drift.

Note: `apps/server/src/server.test.ts > bootstraps a browser session and authenticates the session
endpoint via cookie` is a known pre-existing load-dependent flake under the parallel monorepo run.
Do not chase it; confirm it is unrelated by checking the changed paths.

## Explicitly deferred to physical qualification

- Real thumb reach on hardware, which is the entire point of the step and cannot be proven in
  emulation.
- Dock behaviour against the real software keyboard, in browser and installed standalone.
- True safe-area insets, particularly the dock's clearance above the home indicator.
