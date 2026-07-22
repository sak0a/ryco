# Mobile primitives layer implementation plan

**Goal:** Introduce `apps/web/src/components/mobile/` with the two primitives that have proven
consumers today — a Base UI `Drawer`-backed bottom sheet and a touch list row — migrate every
existing phone call site onto them, and fix the remaining folded-in defects.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Second implementation step of that design. The composer correction (step 1) merged as public PR #205.

## Scope correction against the spec

The spec lists eight primitives. Only two have consumers today:

- `MobileSheet` — six existing `SheetPopup side="bottom"` call sites.
- `MobileListRow` — the same touch-row class string duplicated at seven sites across five files.

`MobileDock`, `MobileContextStrip`, `MobileSelectSheet`, `MobileSegmentedControl`, and
`MobileStatusChip` have no consumer until delivery steps 5–7. Building them now would be speculative
scaffolding, which the spec itself rules out ("extract it only where boundaries are proven"). They
ship with their consumers. `GlassSurface` belongs to step 3 with the material system.

The spec's "four pre-existing defects" is also stale: the `sm:text-[14px]` iOS zoom bug shipped in
PR #205. Three remain.

## Execution rules

- Work only on `feat/mobile-primitives-layer` in the public repository.
- Presentation only. Primitives take props and emit callbacks — no store access, no RPC, no
  lifecycle subscription, no connectivity sensing. This is what makes the design's prohibition on a
  second authentication, relay, readiness, or feature-state implementation checkable by inspection.
- `ui/sheet.tsx` is retained unchanged as the desktop side-panel primitive. The two do not merge.
- Desktop and tablet behaviour must not change. Every desktop-affecting change needs a regression
  test.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: Correct the Base UI declared floor

**Files:** `apps/web/package.json`

- [ ] Raise `@base-ui/react` from `^1.2.0` to `^1.3.0`. The installed runtime is already 1.3.0, so
      this is a declaration correction, not an upgrade — confirm that before changing it.
- [ ] Confirm `bun install --frozen-lockfile` still succeeds and the lockfile is unchanged. If the
      lockfile does change, stop and report rather than committing a dependency resolution change.

## Task 2: Add `MobileSheet`

**Files:** add `apps/web/src/components/mobile/MobileSheet.tsx`, plus a browser test file.

Built on `@base-ui/react/drawer`, which is currently unused in the repository.

- [ ] Detents. Support at least a medium and a large snap point via `snapPoints` / `snapPoint` /
      `onSnapPointChange`, with the opening detent selectable per call site.
- [ ] Grabber, and swipe-to-dismiss via `swipeDirection`.
- [ ] Stacking rather than nesting when one sheet opens another.
- [ ] The primitive applies safe-area padding and `--app-keyboard-inset` **itself**. Today all six
      call sites hand-roll `pb-safe`; after this they must not.
- [ ] Leading-corner radius. The current bottom popup has none (`ui/sheet.tsx:89`).
- [ ] Use the house motion curve `cubic-bezier(0.16, 1, 0.3, 1)`, not the `ease-in-out` at
      `ui/sheet.tsx:84`. Honour `prefers-reduced-motion`, and ensure detent state, focus movement,
      and dismissal are committed on gesture resolution rather than on transition end.
- [ ] Preserve focus trap, focus restore, and scroll lock semantics.

## Task 3: Add `MobileListRow`

**Files:** add `apps/web/src/components/mobile/MobileListRow.tsx`, plus a browser test file.

- [ ] ≥44 px effective height. Leading icon, label, optional secondary text, optional trailing
      state, and a disabled presentation that carries a bounded reason string.
- [ ] Assert the ≥44 px property in a test under coarse-pointer emulation, not by inspection.

## Task 4: Migrate every existing call site

**Files:** `PhoneThreadActionsSheet.tsx`, `ContextMenuActionSheetHost.tsx`, `PhoneHome.tsx`,
`HostedConnectionControls.tsx`, `MessageActionsSheet.tsx`, `chat/ApprovalCard.tsx`,
`PhoneThreadAppBar.tsx`.

- [ ] Move all six `SheetPopup side="bottom"` call sites to `MobileSheet`.
- [ ] Replace the seven duplicated touch-row class strings (`PhoneThreadAppBar.tsx:171`, `:182`,
      `:204`; `ContextMenuActionSheetHost.tsx:101`, `:120`; `HostedConnectionControls.tsx:265`;
      `MessageActionsSheet.tsx:21`) and the near-duplicate at `PhoneThreadActionsSheet.tsx:65` with
      `MobileListRow`.
- [ ] Remove the now-redundant hand-rolled `pb-safe` from migrated call sites.
- [ ] Verify the in-sheet submenu stack in `ContextMenuActionSheetHost.tsx:67-106` still works, and
      decide explicitly whether it becomes real sheet stacking or stays an in-sheet view stack.
- [ ] Confirm the approval card's sheet keeps its assertive live region and its pinning above the
      keyboard inset.

## Task 5: Fix the remaining folded-in defects

**Files:** `apps/web/src/components/ui/toggle.tsx`, `apps/web/src/components/ui/alert-dialog.tsx`,
`apps/web/src/components/hostedHub/HostedHubRoot.tsx`.

- [ ] `toggle.tsx:9` — the `pointer-coarse:after:*` hit-slop sets `min-h-11`/`min-w-11` with no
      centring anchor, so the expanded area grows from the static position instead of around the
      control. Centre it. Verify with an outward hit-test from the control's centre, the same way
      the audit disproved hit-slop on the base button.
- [ ] `alert-dialog.tsx:55` — add the `--app-keyboard-inset` its `sheet.tsx:50` and `dialog.tsx:73`
      siblings consume.
- [ ] `HostedHubRoot.tsx:125` against `index.css:348`, `:357` — make the hosted entry surfaces
      scrollable. At 320×568 the primary "Sign in with passkey" action currently falls below the
      fold with no way to reach it.
- [ ] Cover each with a test. These are desktop-visible changes, so include desktop regression
      coverage.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build` / `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] `bun audit`, distinguishing a proven pre-existing advisory baseline from a regression.
- [ ] Revert generated `scripts/lib/*.d.ts` indentation drift produced by `build`/`typecheck`.

## Explicitly deferred to physical qualification

- Real swipe-to-dismiss and detent feel on a touchscreen.
- True safe-area insets on hardware.
- WebKit `backdrop-filter` behaviour, which arrives with the material system in step 3.
