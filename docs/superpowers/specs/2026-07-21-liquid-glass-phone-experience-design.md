# Liquid Glass phone experience design

**Status:** Proposed 2026-07-21; awaiting implementation

**Date:** 2026-07-21

## Summary

The focused mobile workspace gave Ryco a real phone presentation tier: a tier signal, a `phone:`
Tailwind variant, a phone shell with Home and a thread stack, touch action parity, full-screen work
surfaces, and a browser acceptance matrix. It made the phone usable. It did not make it feel like a
phone application.

This design closes that gap. It introduces a **translucent layered material system**, a **shared
mobile primitives layer**, and a **bottom-anchored interaction model** in which primary navigation
and actions live within thumb reach and chrome recedes behind content. It also corrects a
keyboard-blocking defect in the collapsed composer that no automated test in the current suite could
observe.

This design **extends** `2026-07-20-focused-mobile-workspace-design.md`. That document remains
binding: one application, one route tree, one state layer, one security model. Nothing here forks
authentication, relay transport, hosted lifecycle, readiness, or feature state.

## Relationship to the 2026-07-20 design

Everything in the prior design remains in force except two presentation decisions this document
supersedes:

- **Bottom chrome.** The prior design ruled out a bottom tab bar on the grounds that the product has
  one primary object and vertical space belongs to content and the keyboard. That reasoning holds
  and is preserved: this design does **not** add a tab bar. It adds a _contextual floating dock_
  whose contents change per surface — progressive disclosure rendered at the bottom of the screen
  rather than the top. Sibling navigation is still not a phone concept in Ryco.
- **Touch target sizing.** The prior design required ≥44 px primary touch targets. The audit below
  shows this was not achieved in the shipped chrome. This document treats ≥44 px as a measured,
  test-asserted property rather than a styling intention.

The prior design's information architecture (Home → Thread → work surfaces, bottom sheets, full-screen
settings), its keyboard adapter, its stable node routes, its bounded state vocabulary, and its
desktop compatibility guarantees are unchanged.

## Goals

- A phone user can reach every primary and frequent action without shifting grip.
- Tapping the collapsed composer once focuses the editor and raises the software keyboard.
- Overlays are real mobile sheets: detents, grabber, swipe-to-dismiss, stacking rather than nesting.
- Selects and pickers use large rows, explicit selected state, and momentum scrolling — not desktop
  dropdown behaviour rendered small.
- The model and session-policy controls have purpose-built phone surfaces.
- The hosted connection indicator is minimal at rest and complete on expansion.
- Phone surfaces are built from one shared primitives layer, so the phone tier is coherent rather
  than improvised per screen.
- The translucent material system never trades away WCAG AA contrast, and its cost is a user choice.
- Desktop and tablet behaviour does not regress; every desktop-affecting change is deliberate and
  covered by a regression test.

## Non-goals

- A second application, route tree, install surface, PWA, or mobile fork.
- A second authentication, relay, lifecycle, readiness, or feature-state implementation.
- Changes to relay framing, tickets, authentication policy, canonical schemas, or fixtures.
- A broad desktop redesign. Desktop changes are limited to the shared primitive floor bump and four
  named pre-existing defects.
- Offline data caching, background sync, or push notifications.
- Deep terminal touch ergonomics, which remain deferred.
- A tablet tier. The tier signal stays `phone | desktop`.

## Current state (audit summary)

A live phone-viewport audit was run against a deployed hosted build at 390×844 CSS px with **true
CDP touch emulation** (`pointer: coarse`, `hover: none`, `maxTouchPoints: 5`, `data-tier="phone"`),
alongside a source audit at commit `565cd0c9`. Input-modality emulation mattered: with width-only
emulation the page reports `pointer: fine`, and every coarse-gated finding would have been wrong.

### Reachability

- **Home places 16 of 16 interactive controls in the top third of the viewport. Zero sit in the
  middle third or lower third.** Below them roughly 650 px is dead space. The connection pill,
  search, settings, and new-thread controls all occupy the top-right corner.
- On Thread, the back affordance, connection pill, workspace toggle, and thread-actions kebab all
  sit in the top row; the workspace toggle and kebab are in the top-right corner specifically.

### Touch target sizing

- **On Thread, 16 of 18 interactive controls measure below 44 px on their smaller axis.** Measured:
  workspace toggle 32×32, back 36×36, thread-actions kebab 36×36, send 36×36, connection pill height
  36, model trigger 113×28, composer overflow 28×28, add-context 28×28, context-window indicator
  24×24, copy-response 24×24, scroll-to-bottom height 24, branch select height 28.
- This is not rescued by hit-slop. The base control's `::before` resolves to `inset: 0px`, and
  probing outward from each control's centre yields zero additional hit reach. Effective touch size
  equals visual size.
- Home's list rows and their kebabs are correctly 44×44. The failure is concentrated in chrome,
  composer, and overlays.
- `ui/toggle.tsx:9` carries a mis-anchored hit-slop expansion.

### Desktop-pattern leakage

- The model picker renders a desktop combobox and listbox on phone: option rows measure **35 px**,
  and **all eight `⌘1`–`⌘8` shortcut hints are rendered under `pointer: coarse`**, which the prior
  design explicitly requires be hidden on coarse-pointer devices.
- The picker's search input autofocuses on open (`ModelPickerContent.tsx:127-139`), raising the
  keyboard immediately over an already height-capped list.
- The branch selector renders as a native-style combobox beneath the composer.
- Update and lifecycle notices render as a floating card near the top of the viewport, overlapping
  the timeline, with its actions in the top-right.

### Composer focus

Confirmed by two independent methods. Live probe, single tap on the collapsed pill:

```
editor while collapsed  : 0×0, offsetParent === null
document.activeElement  : BODY          (synchronously, same task as the tap)
document.activeElement  : DIV[contenteditable=true]   (one frame later)
```

Source: `ChatComposer.tsx:1409` sets the expanded state and `:1412` calls `focusAtEnd()` inside a
`requestAnimationFrame`; the editor wrapper carries `hidden` at `ComposerPromptShell.tsx:156` while
collapsed. So there is **one cause** — `focus()` runs outside the user-activation task, and iOS
Safari raises the keyboard only for a synchronous focus inside that task — and **one blocker on the
naive fix**: the editor is `display: none` at the moment of the tap, so hoisting `focus()` into the
click handler focuses nothing.

Two aggravating facts:

- It is a **per-turn tax**, not a first-tap curiosity. `blurMobileComposerAfterSend()`
  (`ChatComposer.tsx:1388-1396`) collapses the composer after every send, so each follow-up costs
  two taps again.
- `ComposerPromptEditor.tsx:1647` and `:1658` set `text-[16px] sm:text-[14px]`. The phone tier is not
  bounded by `sm` (640 px): `PHONE_TIER_MEDIA_QUERY` (`presentationTier.ts:12-13`) extends to 767 px
  and covers coarse landscape. So at 640–767 px portrait and on **every coarse landscape phone** the
  editor renders at 14 px and iOS zooms the page on focus.

Sibling `requestAnimationFrame`-deferred focus sites share the defect, including the command and
mention menu selection path (`ChatComposer.tsx:1153-1155`), `addTerminalContext` (`:1612-1614`),
`insertTriggerAtCursor` (`:1640-1642`), and `scheduleComposerFocus` (`ChatView.tsx:1721-1725`, ~12
call sites).

### Overlay substrate

- Every "sheet" today is `@base-ui/react/dialog` re-skinned (`ui/sheet.tsx`). There is **no detent,
  grabber, or swipe-to-dismiss anywhere** in `apps/web/src`.
- `ui/sheet.tsx:50` gives the bottom viewport a fixed 48 px top gutter and no height policy;
  `:89` provides no top corner radius; and the primitive does **not** apply `pb-safe` — all six
  bottom-sheet call sites add it by hand.
- `ui/alert-dialog.tsx:55` omits the keyboard inset that its siblings consume.
- The same touch-row class string is duplicated at **seven sites across five files**
  (`PhoneThreadAppBar.tsx:171`, `:182`, `:204`; `ContextMenuActionSheetHost.tsx:101`, `:120`;
  `HostedConnectionControls.tsx:265`; `MessageActionsSheet.tsx:21`), with a near-duplicate at
  `PhoneThreadActionsSheet.tsx:65`.
- **`@base-ui/react` 1.3.0 is already installed** while `apps/web/package.json:16` declares
  `^1.2.0`. The installed version ships a complete `drawer/` module — `snapPoints`
  (`drawer/root/DrawerRoot.d.ts:88`), `snapPoint` `:97`, `onSnapPointChange` `:105`,
  `swipeDirection` `:81`, `modal` `:34`, plus `SwipeArea`, nested-drawer stacking, and
  `--drawer-swipe-progress`. It is **entirely unused**.

### Hosted entry surfaces

- The sign-in and node-selection surfaces render as a centred desktop card floating in a full-height
  viewport. At 320×568 the primary **"Sign in with passkey" action falls below the fold**, and the
  surfaces are not scrollable (`HostedHubRoot.tsx:125` against `index.css:348`, `:357`).
- Sign-out is an icon-only control in the top-right corner of the node directory.

### Mutation gating

`ProviderModelPicker` exposes a `disabled` prop that **no production call site passes**
(`ComposerFooter.tsx:588-605`, `ProvidersSettingsPanel.tsx:428-434`), and the traits side has no
disabled prop at all. Model and option selection is therefore not gated by mutation capability today.

### Test coverage

The browser suite is 48 files and 368 tests, but `AcceptanceMatrix.browser.tsx` is largely a
documentation index (672 lines, 6 `it` blocks). Two helpers actively mask the composer defect:
`expandPhoneComposerIfCollapsed()` (`ChatView.browser.tsx:1614-1633`) clicks the collapsed pill in a
`vi.waitFor` loop until the editor is visible, tolerating N taps by construction; and
`composerHasFocus()` (`:8262-8267`) asserts only that _something_ inside the composer form holds
focus, which any button in that subtree satisfies.

## Considered approaches

### Bottom chrome

**A. Contextual floating dock (selected).** A glass capsule floating over full-bleed content, 16 px
above the safe area, whose contents change per surface. Content scrolls underneath it.

_Pros:_ it is not a tab bar, so the prior design's reasoning holds unamended; chrome visibly recedes,
which is the core of the target aesthetic; it costs overlay space rather than layout space, so the
content region keeps full height. _Cons:_ content can pass behind the dock, so surfaces need bottom
scroll padding and the dock needs a material that guarantees separation.

**B. Full-width bottom command bar.** Rejected: it reads as a tab bar even when it is not one
semantically, inviting sibling-navigation expectations the product does not support, and it would
require amending the prior design's explicit no-tab-bar decision rather than upholding it. It also
reserves real layout height on every surface.

**C. Single primary action plus swipe-up drawer.** Rejected: it yields the most content area and the
strongest single-hand affordance, but secondary actions lose any on-screen entry point, which
violates the prior design's requirement that every shortcut have a button-path equivalent.

### Contrast over translucent material

Translucency makes text contrast a function of whatever content happens to scroll beneath a surface —
prose, light code blocks, diff hunks, pasted images.

**A. Opacity floor.** Each glass tier carries a minimum background alpha chosen so a worst-case white
backdrop still clears AA. Deterministic, cheap to assert, and single-layer — but it barely reads as
glass.

**B. Scrim beneath text, thin material.** The material stays genuinely translucent and a gradient
scrim sits between the blur and the text layer, so content reads through the surface while text sits
on a guaranteed base. This is the technique the reference platform uses. Cost: two stacked layers per
glass surface, and stacked `backdrop-filter` plus a gradient is the combination most likely to drop
frames while scrolling a long thread.

**C. Runtime backdrop sampling.** Rejected outright: no clean web API, per-frame cost, contrast
becomes non-deterministic and therefore untestable, and the surface visibly changes under the reader.

**Selected: A and B both ship, as user-selectable Material steps.** A is the `Standard` step and the
default, because it is the cheap single-layer path and a first run on a mid-range device is where a
dropped-frame impression is most costly. B is the `Glass` step, one tap away for users who want the
full reference aesthetic and can afford it. Both clear AA by construction; they differ in how, and in
what they cost. See _Phone appearance settings_.

## Visual system

### Material tiers

Three tiers, each a `GlassSurface` variant. A tier describes _where_ a surface sits in the elevation
model; the active Material step decides _how_ that tier guarantees contrast — by alpha floor
(`Standard`), by scrim over thin material (`Glass`), or by being opaque (`Solid`).

| Tier    | Used by                                   | Behaviour                                              |
| ------- | ----------------------------------------- | ------------------------------------------------------ |
| `chip`  | connection indicator, context-strip pills | Smallest blur radius, tightest scrim                   |
| `dock`  | floating dock, composer capsule           | Mid blur, full-width scrim beneath the text row        |
| `sheet` | bottom sheets, full-screen surfaces       | Largest blur; scrim only behind header and action rows |

Each tier resolves to a token triple — backdrop blur radius, backdrop saturation, and background
alpha — selected by the active Material step. Tokens live beside the existing theme tokens in
`index.css`; no component hardcodes a blur, alpha, or shadow.

### Contrast rule

Text and icon colours on a glass tier must clear **WCAG AA against the tier's guaranteed base**,
where the guaranteed base is the composite of everything the tier contributes — its own background
alpha, plus its scrim where the active Material step applies one — over the **worst-case backdrop**,
not over the page background. Contrast is therefore a property of the material token and is
independent of whatever content scrolls beneath. This is asserted, not assumed — see _Verification_.

### Geometry

Radii follow a phone scale: chips fully rounded, dock capsule 22 px, sheets 16 px on their leading
corners only. The current bottom-sheet popup has **no top corner radius** (`ui/sheet.tsx:89`); the
new sheet primitive supplies one.

### Motion

One house curve, `cubic-bezier(0.16, 1, 0.3, 1)`, already the de-facto curve in the codebase and
currently contradicted by the sheet primitive's `ease-in-out` (`ui/sheet.tsx:84`). Durations: 200 ms
for sheet present/dismiss, 260 ms for stack pushes, 120 ms for chip and pill state changes.

`prefers-reduced-motion` collapses every transition to an instantaneous state change.
**Correctness never depends on animation completion:** detent state, focus movement, and dismissal
are committed on gesture resolution, not on transition end.

## Phone appearance settings

A phone-tier appearance group in the full-screen settings surface, containing four controls.

- **Material** — Solid / Standard / Glass. This is the **phone-tier expression of the existing
  `surfaceTransparency` axis, not a new preference key.** A second competing transparency setting is
  explicitly rejected. `Solid` is opaque with no blur; `Standard` is single-layer glass at the
  opacity floor and is the **default**; `Glass` is thin material plus scrim.
- **Text size** — a phone type scale independent of browser zoom. The 200 % scaling requirement
  already forces the layout to survive this range.
- **Dock density** — compact or comfortable, and which pills ride on the thread context strip.
- **Motion** — reduce sheet and stack-push animation beyond the OS setting.

`prefers-reduced-transparency` forces Material to `Solid` regardless of the stored value, and the
stored value is preserved so the choice returns if the OS setting changes.

`Standard` is the default deliberately: it is the cheap path, and a first run on a mid-range device is
where a dropped-frame impression is most costly. `Glass` is one tap away.

**Persistence note.** `appearancePreferences.ts` writes `ryco:appearance-preferences`
(`:1`) to `localStorage` directly (`:208-215`) rather than through the in-memory storage used for
drafts, terminal, and other generic UI state. This is intentional and remains so: the stored value is
presentation-only, contains no account, node-owned, session, ticket, or credential material, and must
resolve before first paint to avoid a flash of the wrong material. This exemption is stated here so
it reads as a decision rather than an oversight.

## Mobile primitives layer

New directory `apps/web/src/components/mobile/`. Extraction is justified by measured duplication, not
anticipated reuse.

| Primitive                | Replaces                                  | Responsibility                                                                                                     |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GlassSurface`           | ad-hoc blur utilities                     | Material tier, scrim, Material-step resolution                                                                     |
| `MobileSheet`            | six `SheetPopup side="bottom"` call sites | Base UI `Drawer`: detents, grabber, swipe-to-dismiss, nested stacking; applies safe-area and keyboard inset itself |
| `MobileListRow`          | the seven-site touch-row class string     | ≥44 px row: leading icon, label, secondary text, trailing state, disabled presentation with a bounded reason       |
| `MobileSelectSheet`      | desktop popover/combobox on phone         | Large rows, explicit selected state, momentum scrolling, optional search focused only on explicit tap              |
| `MobileSegmentedControl` | dropdowns for small enumerations          | Mode and access axes                                                                                               |
| `MobileDock`             | —                                         | Floating capsule anchored above the safe area and keyboard inset                                                   |
| `MobileContextStrip`     | —                                         | Horizontally scrollable pill rail with an edge affordance                                                          |
| `MobileStatusChip`       | the connection pill                       | Icon plus short text, full accessible label                                                                        |

**Boundary rule.** Primitives are presentation-only: no store access, no RPC, no lifecycle
subscription, no connectivity sensing. Props in, callbacks out. This makes the prohibition on a
second authentication, relay, readiness, or feature-state implementation enforceable by inspection.

`ui/sheet.tsx` is retained unchanged as the **desktop side-panel primitive**. The two do not merge.

Adopting `Drawer` requires raising the declared floor at `apps/web/package.json:16` from `^1.2.0` to
`^1.3.0`. The runtime is already 1.3.0, so this is a declaration correction, not an upgrade.

## Per-screen layouts

### Home

App bar reduces to title plus the connection indicator. Dock carries search, **New thread**, and
settings. The thread list takes the full height it currently wastes; empty states centre in the
content region rather than under the app bar.

### Thread

App bar reduces to back, title, and the connection indicator. The **workspace toggle and
thread-actions kebab leave the top-right corner** and move into the dock's `＋` and `⋯` sheets.

The dock is a composer capsule — leading `＋`, the live editor, trailing send — with a
`MobileContextStrip` above it carrying model, context usage, and branch, plus mode and access when
they differ from default. Each pill is a ≥44 px target opening its own sheet. The strip scrolls, so
narrow viewports never need to fit every pill.

Branch is deliberately on the strip rather than hidden: changing branch is consequential and sits one
tap from send, so it is shown and guarded by its own sheet rather than concealed behind an overflow.

### Work surfaces

Full-screen. Dock carries back, a surface switcher, and done.

### Hosted entry surfaces

Sign-in, invitation, recovery codes, and node directory fill the viewport instead of floating a
centred card, become scrollable, and bottom-anchor their primary action. The current layout puts the
primary sign-in action below the fold at 320×568. Sign-out leaves the top-right corner for the
connection sheet. Gating order is untouched.

### Settings

Full-screen list, with the phone appearance group added.

## Composer focus correction

The collapsed composer stops being a button that swaps in an editor and becomes a **CSS collapse
state of the real editor**.

- Remove `isComposerCollapsedMobile && "hidden"` (`ComposerPromptShell.tsx:156`) and both collapsed
  pill branches (`ChatComposer.tsx:1830-1848`, `:1792-1806`).
- Collapsed presentation becomes `phone:` classes on the always-mounted `ContentEditable`
  (`ComposerPromptEditor.tsx:1645-1654`): single-line height, `overflow-hidden`, ellipsised.
- The tap therefore lands on the contenteditable and the browser focuses it natively inside the
  activation task. **No JS focus call remains on this path.**
- Cascading removals: `expandMobileComposer` (`:1397-1418`), its three frame refs (`:655-658`), its
  cleanup effect (`:1527-1539`), the in-flight guards (`:1500`, `:1508`), and the `pointerdown`
  `preventDefault` calls (`:1840`, `:1801`).

Two consequences this design resolves explicitly:

- **Inline tokens.** Collapsed now renders Lexical inline nodes (mentions, skills, terminal
  contexts) rather than a raw string. Collapsed truncation ellipsises at the line box and must not
  reflow token nodes.
- **Placeholder with terminal contexts.** No change is required, contrary to an earlier reading of
  `ComposerPromptEditor.tsx:1657`. Attaching a terminal context writes a marker into the prompt, so
  the editor is never empty when contexts are present and Lexical's placeholder never renders in
  that state at all. The collapsed editor therefore shows the clipped inline context chips, not an
  empty line. A bounded context-count placeholder would be unreachable code and must not be added.

The `onFocusCapture` early return at `ChatComposer.tsx:1710-1718` — which skips setting focus state
when the target is inside `[data-chat-composer-collapsed-controls="true"]`, the container holding the
pending-input pill — is revisited as part of this change rather than left to fail silently.

Related correction: `sm:text-[14px]` becomes `not-phone:text-[14px]` at
`ComposerPromptEditor.tsx:1647` and `:1658`, so the editor keeps a 16 px type size across the whole
phone tier including coarse landscape.

The sibling `requestAnimationFrame`-deferred focus sites are brought onto the same rule: any focus
intended to raise the keyboard runs synchronously in the activation task.

## Model and session-policy sheets

Two sheets, not one. Model and provider options open from the model pill; session policy — mode,
access, and token budget — opens from its own control.

The separation is deliberate: `full-access` is a security-relevant selection carrying a warning
treatment (`ComposerFooter.tsx:294-295`). Burying it beneath a model list is the wrong affordance.

The model sheet opens at a **partial detent, browse-first, with search unfocused**. Tapping search
expands to the full detent so the keyboard has somewhere to go. Desktop keeps its existing two-pane
popover and its autofocus behaviour unchanged, so existing picker tests continue to hold.

Rows use `MobileListRow`. Keyboard shortcut hints are hidden on coarse-pointer devices.

**Mutation gating.** Model and option changes are gated by the existing mutation-readiness
capability. Both sheets render a disabled presentation with a bounded reason when mutations are
unavailable. This requires wiring the unused `disabled` prop at `ComposerFooter.tsx:588-605` and
adding the equivalent on the traits side. Feature components continue to consume the read-only
mutation capability rather than sensing connectivity.

## Connection indicator

Collapsed, the indicator is a `MobileStatusChip`: an icon plus a **short status word**. Expanded, it
presents the full bounded state text and the connection sheet's actions.

Invariants, all test-pinned:

- State is conveyed by **text and icon, never colour alone**, at both sizes.
- The accessible label retains node identity and state at collapsed size
  (`HostedConnectionControls.tsx:369`).
- Both live regions remain mounted while collapsed — polite for connection state, assertive for
  approvals and delivery-unknown.
- The bounded state vocabulary is unchanged. No raw errors, identifiers, tickets, or payloads.
- Fail-closed disable rules in the expanded sheet are unchanged: node switching and
  directory-dependent actions stay disabled while the directory is stale, role state is missing, or
  the browser is suspended; sign out remains available.

Icon-only was rejected: the icon vocabulary is two glyphs against eighteen bounded status strings,
so icon-only cannot distinguish states without new glyphs.

## Accessibility, safe areas, orientation

- ≥44 px effective touch targets for every phone control, measured as the composite of border box and
  any hit-slop, without changing desktop density.
- Safe-area padding on every surface. `MobileSheet` and `MobileDock` apply it themselves rather than
  relying on call sites, correcting the current pattern where all six bottom-sheet call sites
  hand-roll `pb-safe`.
- Keyboard insets come from the existing single `VisualViewport` adapter. **No new resize listeners.**
  `ui/alert-dialog.tsx:55` is brought onto the same inset as its siblings.
- Every icon-only control carries a label.
- 200 % text scaling hides no control and causes no page-level horizontal overflow.
- Portrait and landscape both supported without reload; rotation preserves node, thread, draft, panel,
  and scroll state.

**Landscape exemption.** At 844×390 the lower third is roughly 130 px. Bottom-anchored navigation is
**explicitly exempt in coarse landscape**, which keeps top-anchored chrome there. This is an asserted
exemption in the reachability test family, not a silent skip.

## Pre-existing defects folded in

Four defects are adjacent to this work, are a few lines each, and will otherwise be misattributed to
the redesign. They ship with the primitives change:

- `ui/toggle.tsx:9` — mis-anchored hit-slop.
- `ComposerPromptEditor.tsx:1647`, `:1658` — the `sm:text-[14px]` iOS zoom bug.
- `HostedHubRoot.tsx:125` against `index.css:348`, `:357` — unscrollable hosted entry surfaces.
- `ui/alert-dialog.tsx:55` — missing keyboard inset.

## Verification

### Automated

Full public gate set, plus the web build filter and the browser suite. New assertion families extend
the existing acceptance matrix rather than duplicating it:

- **Reachability** — on each phone surface, the centre of every primary and frequent action falls
  below two-thirds of the viewport height, with coarse landscape asserted as an explicit exemption.
- **Touch sizing** — every interactive control on the phone tier measures ≥44 px on its smaller axis
  under coarse-pointer emulation, computed as border box plus resolved hit-slop.
- **Composer focus** — the collapsed editor's computed `display` is never `none`; and a `focusin`
  ordering token proves focus arrives in the same task as the activating gesture, with no interleaved
  animation frame.
- **Sheet behaviour** — detent snap positions, swipe-to-dismiss via synthesised pointer sequences,
  stacking depth, focus trap and restore, scroll lock.
- **Material** — each glass tier's resolved background alpha meets its floor, and computed contrast
  of text on each tier clears AA against the guaranteed base over a set of known worst-case
  backdrops.
- **Coarse-pointer gating** — keyboard shortcut hints are absent under `pointer: coarse`.
- **Mutation gating** — both option sheets render their disabled presentation and bounded reason
  when mutation capability is absent.
- **Connection indicator** — text-and-icon at both sizes, accessible label retains node and state
  collapsed, both live regions mounted collapsed.
- **Desktop regression** — desktop-tier snapshots unchanged on the desktop baseline viewport, plus
  explicit coverage for the four folded-in defects.

**Two existing helpers are tightened**, because the current forms would let the composer defect pass:
`expandPhoneComposerIfCollapsed()` (`ChatView.browser.tsx:1614-1633`) must stop clicking in a
retry loop and assert a single activation; `composerHasFocus()` (`:8262-8267`) must assert the editor
specifically rather than any focusable node inside the composer form.

**Emulation requirement.** Phone browser tests must run with input-modality emulation, not viewport
width alone. Width-only emulation reports `pointer: fine`, under which coarse-gated assertions are
meaningless.

### Deferred to physical qualification

Chromium emulation cannot prove these, and this design does not claim otherwise:

- Real iOS software-keyboard raise on first tap, and real `VisualViewport` keyboard geometry.
- True safe-area insets on hardware.
- WebKit `backdrop-filter` scroll performance with stacked material, which is the specific risk the
  `Glass` Material step carries.

These join the existing hosted mobile PWA qualification checklist. No physical evidence is
fabricated or inferred from emulation.

## Compatibility and risks

- **Desktop.** Primitives are phone-only. Desktop-affecting changes are the Base UI declared-floor
  correction and the four folded-in defects, each covered by desktop browser tests. Desktop keeps its
  two-pane model popover and `ui/sheet.tsx` unchanged.
- **Stacked material performance** is the principal risk. Mitigated by shipping `Standard` as the
  default, making `Glass` an explicit opt-in, and treating scroll performance as physical-qualification
  evidence rather than an emulated claim.
- **Contrast** is mitigated by making the guaranteed base a property of the material token and
  asserting it, rather than depending on what scrolls beneath.
- **Composer restructure** changes what the collapsed state renders. Bounded by the two explicit
  decisions above and by tightened focus tests.
- **Releasability.** Each PR leaves the application releasable; the phone tier remains behind the
  existing tier signal and desktop stays the fallback presentation at every stage.

## Delivery sequence (public)

1. **Spec PR:** this document.
2. **Mobile primitives layer** — `components/mobile/`, Base UI declared floor `^1.3.0`, and the four
   folded-in pre-existing defects.
3. **Material system and phone appearance settings** — tokens, `GlassSurface`, the Material axis on
   the existing preference key, and the contrast assertions.
4. **Composer focus correction** — the structural change, the type-size fix, the sibling focus sites,
   and the tightened focus tests.
5. **Dock and context strip** — Home and Thread relayout, chrome reduction, reachability assertions.
6. **Model and session-policy sheets** — including mutation gating on both.
7. **Connection indicator** — minimal chip and expanded sheet.
8. **Work surfaces, hosted entry surfaces, and settings** — full-screen layouts and the phone sweep.
9. **Acceptance matrix consolidation.**

Each step lands with its own tests and keeps every existing gate green.
