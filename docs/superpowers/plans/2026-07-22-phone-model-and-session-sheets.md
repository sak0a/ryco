# Phone model and session-policy sheets implementation plan

**Goal:** Replace the desktop model popover and the shared overflow menu on the phone tier with two
purpose-built bottom sheets — one for model and provider options, one for session policy — both
gated by mutation capability.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Delivery step 6. Steps 1–5 and the dock relocation are merged (#205 – #209).

## The measured baseline

From the live audit at 390×844 under true coarse-pointer emulation:

- The model picker renders a desktop combobox and listbox on phone: option rows measure **35 px**,
  well under the 44 px requirement.
- **All eight `⌘1`–`⌘8` shortcut hints render under `pointer: coarse`**, which the 2026-07-20 design
  explicitly requires be hidden on coarse-pointer devices.
- The search input autofocuses on open, raising the keyboard immediately over an already
  height-capped list.

## Decisions already taken with the owner

- **Two sheets, not one.** Model and provider options open from the model pill; session policy —
  interaction mode, runtime mode, and token budget — opens from its own control. `full-access`
  (`ComposerFooter.tsx:58`, `:294`) is a security-relevant selection with a warning treatment;
  burying it beneath a model list is the wrong affordance.
- **Mutation gating is designed in, not retrofitted.** `ProviderModelPicker` exposes a `disabled`
  prop that no production call site passes, and the traits side has none at all. Both sheets render
  a disabled presentation with a bounded reason when mutation capability is absent.
- **The model sheet opens at a partial detent, browse-first, with search unfocused.** Tapping search
  expands to the full detent so the keyboard has somewhere to go. Desktop keeps its two-pane popover
  and its autofocus behaviour unchanged, so the existing picker tests continue to hold.

## Scope

Ships here, because their consumers finally arrive:

- `MobileSelectSheet` — large rows, explicit selected state, momentum scrolling, optional search
  focused only on explicit tap.
- `MobileSegmentedControl` — for the small enumerations (interaction mode, runtime mode).

Not in this step: `MobileStatusChip` and the connection indicator redesign, which is step 7.

## Execution rules

- Work only on `feat/phone-model-session-sheets` in the public repository.
- **Desktop keeps its two-pane popover unchanged.** Every existing model-picker test must pass
  unmodified. This step adds a phone presentation; it does not rewrite the control.
- Presentation and gating only. Model resolution, provider capabilities, session policy semantics,
  and the readiness gate are unchanged.
- Primitives stay presentation-only: props in, callbacks out, no store, RPC, or lifecycle access
  inside `apps/web/src/components/mobile/`.
- Reuse `MobileSheet`, `MobileListRow`, `GlassSurface` and the motion tokens. Add no new resize
  listeners.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: `MobileSelectSheet`

**Files:** add `apps/web/src/components/mobile/MobileSelectSheet.tsx` and its browser test.

- [ ] Built on `MobileSheet` and `MobileListRow`. Rows ≥44 px, explicit selected state exposed to
      assistive tech — not styling alone. Follow the `aria-pressed` precedent already set in
      `MobileListRow`.
- [ ] Optional search that is **never autofocused**; focusing it expands to the full detent.
- [ ] A disabled presentation carrying a bounded reason, since both consumers need it.
- [ ] Momentum scrolling, no desktop scrollbar, focus trap and restore inherited from `MobileSheet`.

## Task 2: `MobileSegmentedControl`

**Files:** add `apps/web/src/components/mobile/MobileSegmentedControl.tsx` and its browser test.

- [ ] For enumerations of three or so options where a sheet would be heavier than the choice.
      Each segment ≥44 px, labelled, with selected state exposed to assistive tech.
- [ ] Disabled presentation with a bounded reason.

## Task 3: The model sheet

**Files:** `apps/web/src/components/chat/ComposerFooter.tsx`, the phone presentation of
`ProviderModelPicker`, and their tests.

- [ ] On the phone tier the model trigger opens a `MobileSelectSheet` instead of the desktop
      popover. Desktop is untouched.
- [ ] Opens at the partial detent, browse-first, search unfocused.
- [ ] **Keyboard shortcut hints are hidden under `pointer: coarse`.** Assert it — the audit found all
      eight rendering.
- [ ] Provider grouping and favourites survive the translation; nothing reachable on desktop becomes
      unreachable on phone.
- [ ] Rows ≥44 px, asserted geometrically under coarse-pointer emulation.

## Task 4: The session-policy sheet

**Files:** `apps/web/src/components/chat/ComposerFooter.tsx`, `CompactComposerControlsMenu.tsx`, and
their tests.

- [ ] A separate sheet for interaction mode (Build / Plan / Ask), runtime mode (Supervised /
      Auto-accept / Full access), and token budget.
- [ ] `full-access` keeps its warning treatment and is not reachable by an accidental swipe past
      other options — it is a deliberate selection.
- [ ] Segmented controls for the two mode axes; the token budget follows whichever presentation
      fits its option count.

## Task 5: Mutation gating

**Files:** `ComposerFooter.tsx`, `ProvidersSettingsPanel.tsx`, both new sheets, and their tests.

- [ ] Wire the unused `disabled` prop and add its equivalent on the traits side.
- [ ] Both sheets render a disabled presentation and a **bounded** reason string when mutation
      capability is absent — no raw errors, identifiers, or payloads.
- [ ] Feature components keep consuming the read-only mutation capability rather than sensing
      connectivity.
- [ ] Assert that with capability absent, neither sheet can commit a change.

## Task 6: Assertions

- [ ] Rows and segments ≥44 px on phone, measured geometrically under coarse-pointer emulation.
- [ ] No `⌘N` hint rendered under `pointer: coarse`.
- [ ] Search is not focused on open; focusing it moves to the full detent.
- [ ] Disabled presentation appears and blocks commit when mutation capability is absent.
- [ ] Desktop regression: the two-pane popover, its autofocus, and its keyboard navigation are
      unchanged, and no phone sheet mounts on the desktop tier.
- [ ] No page-level horizontal overflow at 320 px with the longest model name in the fixture set.

**Every assertion must be falsifiable.** Before claiming a test proves something, neuter the
production change and confirm the test fails. Three earlier steps in this workstream shipped
assertions that could not fail — a contrast suite that chose which roles to measure, a harness that
measured a 151 px column, and a test that clicked a button in Chromium where clicking does not focus.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build` / `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] `bun audit`, distinguishing a proven pre-existing baseline from a regression.
- [ ] Revert generated `scripts/lib/*.d.ts` drift.

## Explicitly deferred to physical qualification

- Real momentum scrolling and detent feel on a touchscreen.
- The software keyboard's interaction with the search field's detent change.
