# Focused mobile workspace design

**Status:** Approved 2026-07-20; implementation pending

**Date:** 2026-07-20

## Summary

Ryco's web application becomes a genuinely phone-first workspace without forking the app. One
shared route tree, one state layer, one security model — and a dedicated **phone presentation
tier** that replaces the desktop chrome (persistent sidebar, inline right panels, hover- and
keyboard-first affordances) with a drill-down navigation stack, full-screen work surfaces, bottom
sheets, and touch-complete actions.

The hosted mobile PWA foundation (install, service-worker cache boundary, fail-closed lifecycle,
serialized reconnect — public PRs #180 and #183) is complete and is preserved unchanged. The prior
design (`2026-07-19-hosted-mobile-pwa-experience-design.md`) delivered the PWA and lifecycle
contract; its planned responsive-layout adaptation was deliberately minimal. This design is the
follow-up product workstream: it defines the phone information architecture, navigation model,
screen-by-screen behavior, and the presentation-tier mechanism that makes the same application
adapt automatically.

First-class phone workflows: node, project, and thread selection; chat and composer; approvals;
connection status; readable diffs. Secondary via progressive disclosure: terminal, deeper file
browsing, file editing, source-control detail, orchestration detail, advanced settings. Basic
file inspection stays reachable as a first-line work surface.

## Relationship to the 2026-07-19 design

This design amends the "Responsive application shell" section of
`2026-07-19-hosted-mobile-pwa-experience-design.md` for the phone presentation: the
drawer-centric navigation direction, the node/environment selector placed directly below the
header, and the phone entry route are superseded by the navigation stack, connection pill and
sheet, and Home route defined here. Everything else in that design remains binding and
unchanged: the build-mode boundary, service-worker cache contract, installation experience,
hosted resume and mutation gate, user-visible state model, suspension-generation and
multi-client update addenda, and the desktop compatibility guarantees. The PR that lands this
document also adds a forward-pointing status note to the 2026-07-19 design.

## Goals

- A phone user can sign in, pick a node, find a thread, read and steer a conversation, respond to
  approvals, and review diffs comfortably with one hand on a 320–430 px viewport.
- Device adaptation is automatic. No separate mobile application, route, package, or install
  surface. Desktop and tablet behavior is unchanged except shared corrections.
- Every action reachable by hover, right-click, or keyboard shortcut on desktop has a touch path
  on phones.
- The composer, approval actions, and menus remain visible and operable with the software keyboard
  open, in portrait and landscape, inside and outside the installed PWA.
- Connection, authorization, synchronization, and delivery states stay visible and distinct on
  phones, following the established user-visible state model.
- Authentication, hosted lifecycle, relay transport, application state, routes, synchronization,
  and mutation-readiness policy remain shared with the existing application. No forks.
- Deep links, refresh, and browser history restore the selected node and view through the normal
  fail-closed authorization pipeline.

## Non-goals

- A second mobile codebase, route tree, install surface, or native wrapper.
- Offline data caching, offline queueing, background sync, or push notifications. Offline behavior
  remains: static offline document on cold navigation; stale read-only in-session state otherwise.
- Changes to relay framing, tickets, authentication policy, canonical schemas, or fixtures.
- Full mobile file editing, remote desktop control, or a touch-optimized terminal IME (terminal
  remains reachable but secondary; deep terminal ergonomics are follow-up work).
- A broad desktop redesign. Desktop changes are limited to shared fixes (overflow, accessibility,
  hosted-control placement) that the phone work surfaces anyway.
- A general user-facing "mobile mode" preference. The Auto / Phone preview / Desktop preview
  override ships behind development/diagnostics gating for QA only.

## Current state (audit summary)

A code and live-browser audit at 375×667, 390×844, 430×932, and 844×390 found the foundation
partially ready (viewport meta, safe-area utilities, `dvh`/`svh` shells, dialog bottom-sticking,
collapsed mobile composer, pointer-coarse hit-area expansion in the base button) and the
presentation layer not phone-usable:

- **Navigation drawer broken:** `SIDEBAR_WIDTH_MOBILE = "calc(100vw - var(--spacing(3)))"` is
  invalid CSS (`var(--spacing(3))` is not valid `var()` syntax), so the mobile sheet renders at
  ~175 px instead of near-full-width (`ui/sidebar.tsx:27`). Rows compress to ~159 px with 20×20 px
  actions.
- **No phone IA:** `/` redirects to the last thread; the only navigation surface is the (broken)
  drawer; there is no thread-list home screen.
- **Desktop panels at phone widths:** diff/files/terminal render in a right sheet capped at
  `min(88vw, 24rem)` leaving a dead sliver; Files keeps a two-pane split (~130 px preview pane);
  the overview panel has no close button and can trap the user.
- **Touch-incomplete actions:** message actions and code-copy are hover-revealed
  (`MessagesTimeline.tsx:505,607`); thread actions are right-click-only via a mouse-oriented DOM
  fallback menu (`contextMenuFallback.ts`); find-in-thread is keyboard-shortcut-only, and the
  command palette's only touch entry is a small Search row inside the broken drawer, with no
  entry point from the thread view; tooltips carry sole copies of command text.
- **Transient notices:** the disconnect/reconnect toast overlaps the session tab strip at phone
  widths, and stacked composer banners reveal their non-front entries only on hover.
- **Approvals:** the request detail renders as the disabled composer's placeholder — clipped,
  non-scrollable (`ComposerPromptShell.tsx:276`); the expanded action row does not wrap and can
  push buttons out of view (`ChatComposer.tsx:1920`).
- **Keyboard:** no `VisualViewport` handling exists; the layout relies solely on
  `interactive-widget=resizes-content`, which iOS Safari does not honor.
- **Breakpoints fragmented:** composer collapses <640, sidebar sheets <768, right panel sheets
  ≤980, plus an ad-hoc 760 override; width-only detection gives landscape phones (844×390) the
  full hover-dependent desktop layout.
- **Long content:** markdown tables have no horizontal-scroll wrapper inside `overflow-x-hidden`
  rows — wide tables are silently clipped.

## Considered approaches

### A. Presentation tier inside the shared app (selected)

Introduce one explicit presentation-tier signal (`phone` | `desktop`) derived from viewport and
pointer capabilities, exposed to JS through one hook and to CSS through a root data attribute with
a Tailwind custom variant (the pattern already used for `dark` and window-controls-overlay
variants). The shell composition root selects a `PhoneAppShell` or the existing desktop shell;
feature components stay shared, with phone-specific presentation variants only where the audit
proves the desktop presentation cannot adapt (navigation, panels, menus, approvals).

Pros: one app, one state layer, honest URLs, desktop untouched, preview override possible, smallest
security surface, aligns with the accepted single-tree constraint. Cons: requires migrating
layout-critical breakpoint classes to the tier variant and disciplined seam choices.

### B. Purely CSS-responsive adaptation (no tier signal)

Continue adapting inside components with media queries and `useIsMobile`. Rejected: the audit shows
this path has already produced four inconsistent thresholds and cannot express structural changes
(different navigation model, full-screen panel promotion, different menus) without a coherent
tier concept; landscape phones misclassify; a QA preview override is impossible.

### C. Separate mobile shell package or route

A `packages/mobile-ui` or dedicated mobile route tree. Rejected (and previously rejected in the
PWA design): duplicates navigation, readiness, authorization, and work-surface behavior; creates
drift and inconsistent security gates. No shared UI package exists today, so extraction has no
second consumer; a package boundary can be revisited once phone primitives stabilize.

## Presentation tier

- `presentationTier.ts` defines the single classification:
  `phone` when `(max-width: 767px)` OR (`(pointer: coarse)` AND `(max-height: 499px)`), else
  `desktop`. The second clause captures phone landscape without reclassifying tablets at or above
  768 px width; sub-768 portrait devices already receive the mobile presentation today. Devices
  near the boundary (narrow tablets, foldables) can change tier on rotation: a tier change must
  preserve route, node selection, drafts, panel state, and scroll position, verified by a
  rotating mid-size (600–800 px) viewport browser test. A distinct tablet tier is future work.
- `usePresentationTier()` is the only JS consumer API. Existing `useIsMobile` call sites migrate
  to it; `useMediaQuery` remains for cosmetic cases.
- The tier is mirrored as `data-tier="phone" | "desktop"` on the root element, with a Tailwind
  `@custom-variant phone` / `not-phone`. Layout-critical classes migrate to the variant (dialog
  bottom-sticking, header hamburger, sheet sizing, shell grid); purely cosmetic width classes stay
  media-query based.
- **Preview override (QA only):** a diagnostics-gated setting forces the tier to phone or desktop.
  Because layout-critical CSS keys off `data-tier`, the override produces a faithful preview;
  residual cosmetic media queries may differ slightly and this limitation is documented. The
  override never touches `prefers-color-scheme`, `display-mode`, PWA lifecycle, or capability
  logic, and it is excluded from production qualification evidence.
- Canonical breakpoints after this work: 640 (cosmetic density), 768 (tier boundary), 980
  (desktop right-panel inline threshold). The ad-hoc 760 sheet override is removed.

## Phone information architecture

A navigation stack of full-screen surfaces, URL-driven, with a persistent compact app bar. No
bottom tab bar: the product has one primary object (the thread); vertical space belongs to content
and the keyboard; secondary surfaces are progressive disclosure, not siblings.

```
Hosted entry (existing state machine, restyled):
  Sign in ─ Invitation ─ Recovery codes ─ Node directory ─ Connecting/Failure

L1  Home ("Threads")        project-grouped thread list; app bar: connection pill,
                            search, settings, new thread
L2  Thread                  timeline + composer; app bar: back, title/status, workspace, kebab
L3  Work surfaces           full-screen push: Review (diffs) · Files · Terminal
Sheets (bottom): connection/node controls · thread actions · model picker · add action ·
                 ref picker · message actions (long-press)
Full-screen: settings (labeled list nav) · search/palette
```

- **Hosted entry surfaces** keep their exact gating order (account → recovery codes → node
  selection → session establishment → shell); that order is security-load-bearing. They are
  restyled to the phone layout system (large touch rows, safe-area padding), not rewired.
- **Home** is a real route and the phone default after a node session is established (desktop
  keeps its current last-thread redirect). It renders the same project/worktree/thread data the
  desktop sidebar consumes (same stores and selectors). Rows are ≥44 px with always-visible
  status; per-row actions live in a long-press/kebab sheet, not 20 px hover icons.
- **Thread** is the existing chat view with phone presentation: back affordance, kebab menu
  exposing every action that desktop offers via right-click/hover/shortcuts (rename, archive,
  find-in-thread, copy links, session tabs list), and a workspace button opening L3 surfaces.
- **Work surfaces** reuse today's URL search-param panel state (`workspaceTab`, `diff`, `preview`)
  rendered full-screen on phone with an explicit back affordance. Files becomes single-pane
  (tree → file view push). Diffs default to wrapped lines on phone, editor-open taps are
  suppressed, horizontal scrolling is contained within the diff surface. Terminal renders
  full-screen with its existing toolbar; deep touch ergonomics remain follow-up work.
- **Hosted connection controls** move out of the floating fixed overlay into the app bar: a
  bounded status pill (node name + state) opens a connection sheet with node status/role, switch
  node, return to node directory (closing the browser relay session without stopping the node
  connector), directory refresh, install/update controls, trust disclosure, and sign out.
  Sheet actions follow the same fail-closed rules as the directory: node switching and
  directory-dependent actions are disabled while the directory is stale, role state is missing,
  or the browser is suspended; sign out remains available. The same relocation removes the
  desktop overlay-collision problem; on desktop these controls integrate into the workspace
  header instead of floating above it.
- **Stable node routes:** the selected node becomes a stable, non-sensitive URL segment wrapping
  the existing environment/thread routes, so refresh, deep links, and history restore node
  context through the ordered fail-closed pipeline (session → directory → node validation →
  fresh ticket → relay → snapshot → mutations). The node segment uses the bounded node
  identifier the authorized directory already renders to signed-in users — directory metadata,
  not node-owned content and not authentication material — which keeps it outside the ban on
  session, ticket, credential, and node-owned state in URLs and history. Possession of a node
  URL grants nothing: every restore runs the full fail-closed pipeline. Work-surface deep links
  reuse the search parameters hosted desktop URLs already carry (thread identifiers, panel
  state, and workspace-relative file paths as bounded workspace metadata); this design adds no
  new sensitive URL material, and no session, ticket, or credential value ever appears in URLs
  or browser storage. Non-hosted modes keep their current routes unchanged.

## Key screens and states

- **Sign-in:** single primary passkey action ≥44 px, invitation redemption and (when available)
  first-owner setup as secondary items, visible relay-trust disclosure, explicit cancel for an
  in-flight passkey ceremony, safe-area-aware. Session-expired renders the same surface with the
  expired heading; no stale content remains interactive behind it.
- **Node selection:** full-screen directory list; per-node presence, effective role, and bounded
  status as text+icon; owner-only enrollment entry; pull/refresh action with the bounded
  20-second visible cadence untouched; disabled states while directory is stale or the browser is
  suspended; the relay-trust disclosure stays visible on this surface (authentication,
  node-selection, and installation paths all show it).
- **Home:** grouped thread list, connection pill, empty states for no-projects and no-threads,
  new-thread flow (project picker sheet when multiple projects exist).
- **Thread / composer with keyboard:** collapsed composer pill expands on focus; the shell offsets
  the composer, approval card, and anchored menus by a keyboard inset published by a single
  `VisualViewport` adapter (`--app-keyboard-inset`); on coarse-pointer devices Enter inserts a
  newline and the send button submits; 16 px input font preserved to prevent iOS zoom; mention
  and command menus clamp to the visible viewport height.
- **Approvals:** a dedicated approval card above the composer replaces the placeholder trick —
  scrollable, wrap-enabled full detail (command, target, diff summary), expandable to a bottom
  sheet for long content; actions (Approve once, Always allow this session, Decline, Cancel turn)
  wrap and stay ≥44 px, pinned above the keyboard inset; an assertive live region announces
  arrival. Approval semantics, gating, and store logic unchanged.
- **Reconnecting / checking access / synchronizing (including replay):** status pill plus a
  one-line banner under the app bar; the internal `replaying` session state renders as
  Synchronizing, keeping the approved eight-state vocabulary intact; content remains visible,
  visibly stale, and read-only; mutations stay disabled by the existing readiness gate; banners
  never cover the composer or primary actions.
- **Offline:** in-session — "Offline — read-only" banner over stale content; cold navigation —
  the static offline document (unchanged, contains no user data). Delivery-unknown keeps its
  explicit acknowledgment flow as a distinct banner. Update-ready remains a non-disruptive,
  user-activated action in the connection sheet.
- **Settings / advanced tools:** full-screen paged list with labeled sections replacing the
  icon-only rail; terminal, diagnostics, and advanced items grouped under progressive disclosure;
  preview override lives here behind the development/diagnostics gate.

## Touch and input completeness

- Long-press (and a visible kebab where discoverability matters) replaces right-click; a shared
  touch action-sheet presenter replaces the mouse-only DOM context-menu fallback on phones.
- Message actions: long-press opens a message action sheet; code blocks get an always-visible
  compact copy button on phone; truncated tool/command rows become tap-to-expand instead of
  tooltip-only.
- Search/palette and find-in-thread get visible entry points (Home app bar; thread kebab).
- Markdown tables gain a horizontal-scroll wrapper (shared fix; desktop benefits).
- Hover-revealed stacked banners become swipe/tap-cyclable on phone.
- Keyboard-shortcut hints (`⌘K`, `⌘1`) are hidden on coarse-pointer devices; every shortcut has a
  button-path equivalent.

## Technical architecture

- **Shell seam:** the composition root keeps all headless bootstrap and coordinator components
  (server-state bootstrap, environment connection manager, event router, connection coordinator
  with its single hosted lifecycle recovery owner, slow-ack coordinator) mounted identically for
  both tiers, then selects `PhoneAppShell` or the existing desktop shell. Phone components live in
  `apps/web/src/components/shell/phone/`; no new package.
- **Hosted lifecycle extraction (shared, not forked):** the browser lifecycle wiring
  (visibilitychange/online/offline/pageshow → suspend/resume) moves from the hosted root
  component into a headless hook mounted exactly once at the hosted root, above the tier seam —
  hosted-mode-gated, active for every authenticated hosted state including the pre-session
  directory, recovery-code, connecting, and failure surfaces, and unaffected by tier changes.
  The tier shells mount no lifecycle listeners of their own; they consume derived state only.
  The hosted connection-status text derivation becomes a pure selector in `hostedHub/` so the
  phone pill, connection sheet, and desktop menu render identical state. Store-reset behavior on
  node switch is preserved (presentation store modules remain imported so reset paths stay
  valid).
- **Panel promotion seam:** the existing inline-vs-sheet fork in the thread route view gains a
  third, phone-tier presentation: full-screen work surfaces driven by the same URL search params.
  Links are interchangeable between tiers.
- **Keyboard adapter:** one `useVisualViewportCssVars` hook publishes bounded CSS custom
  properties (keyboard inset, visible height) from `VisualViewport`; no component adds its own
  resize listeners. The shell consumes the inset for composer, approval card, sheets, and
  anchored menus.
- **What is consumed unchanged (hard requirement):** all state stores, the hosted controller,
  transport, ticket, and reconnect stack, RPC clients and environment runtime, composer logic and
  draft/queue stores, PWA lifecycle and service-worker policy, theming, virtualized lists, role
  and capability gating. Feature components keep consuming the read-only mutation capability
  rather than sensing connectivity.
- **Error handling:** phone surfaces render only the established bounded state vocabulary
  (Connected, Reconnecting, Checking access, Synchronizing, Offline, Queued, Delivery unknown,
  Update ready) plus stable error codes; no raw errors, identifiers, tickets, or payloads. A
  layout failure must never bypass approvals, hide connection state, or misrepresent an uncertain
  mutation as success. Terminal relay failures and revocations return to the bounded hosted
  surfaces exactly as today, and absent, revoked, unauthorized, offline, incompatible, or
  malformed node routes fall back fail-closed to the node directory with a bounded explanation.

## Accessibility, safe areas, orientation, motion

- Primary phone touch targets ≥44×44 CSS px without growing desktop density (tier variant).
- All icon-only controls gain accessible labels; settings navigation is labeled text.
- Focus: sheets and full-screen surfaces trap and restore focus (base-ui primitives); opening and
  closing the drawer/sheets never drops composer focus or context; flow changes move focus
  intentionally.
- Live regions: polite announcements for connection-state changes; assertive for approval arrival
  and delivery-unknown.
- State is conveyed by text and icons, never color alone.
- Safe areas: app bar `pt-safe`, composer/sheets `pb-safe`, landscape `pl/pr-safe`; shell
  geometry uses dynamic viewport units; `viewport-fit=cover` retained.
- Portrait and landscape both supported without reload; rotation preserves node, thread, draft,
  panel, and scroll state.
- Browser text scaling up to 200% must not hide controls or cause page-level horizontal overflow.
- `prefers-reduced-motion` honored for all new transitions (stack pushes, sheets); correctness
  never depends on animation completion.

## Verification

### Automated

Full public gate set, plus the web build filter and the browser suite required for responsive/PWA
work. The automated matrix runs on the existing Chromium-based browser-test environment;
WebKit-specific behavior (real `VisualViewport` keyboard geometry, safe-area insets) is proven
only by the physical pass. Browser coverage extends the existing suite with a viewport matrix —
320×568, 390×844, 844×390 (phone landscape), a rotating mid-size 600–800 px viewport (tier-flip
state preservation), 768×1024 (tablet/desktop tier), and the desktop baseline — asserting:

- no document-level horizontal overflow on sign-in, invitation, recovery, directory, home,
  thread, composer-expanded, approval, diff, files, terminal, and settings surfaces;
- ≥44 px primary touch targets on phone; hidden shortcut hints on coarse pointers;
- composer, approval actions, and menus remain visible with a stubbed `VisualViewport` keyboard;
- long-press/kebab action parity for every hover- or context-menu-only desktop action;
- tier classification (including coarse-pointer landscape) and the QA override;
- rotation preserves route, draft, and panel state; reduced-motion and 200% text scaling hold;
- route restore: refresh, deep links, and Back/Forward across node root and nested thread/panel
  routes; absent, revoked, unauthorized, offline, incompatible, and malformed node routes fall
  back fail-closed to the directory with bounded explanations; assertions that no session,
  ticket, credential, or token material appears in URLs or browser persistence;
- connection controls: integration proof that returning to the directory closes exactly the
  browser relay session while the node connector stays online, plus header-collision regression
  coverage for the relocated hosted controls at desktop, tablet, and phone widths;
- desktop-tier snapshots unchanged on the desktop baseline viewport (regression guard).

Existing PWA, lifecycle, reconnect, cache-policy, and hosted-state suites must remain green and
unmodified in behavior.

### Physical devices

The existing hosted mobile PWA qualification checklist is re-run against the first deployed
revision containing the phone shell: iOS Safari and Android Chrome, browser and installed
standalone, covering install, sign-in, node selection, drawer/home navigation, composer with the
real software keyboard, approvals, diff review, rotation, background/foreground, offline/online,
session expiry, and update activation — with redacted evidence only.

## Compatibility and risks

- Desktop and tablet behavior is preserved; every desktop-affecting change (hosted control
  relocation, table scroll wrapper, breakpoint consolidation) ships with desktop browser-test
  coverage. The tier-variant CSS migration is limited to layout-critical classes to bound
  regression surface.
- iOS keyboard behavior cannot be proven in emulation; the `VisualViewport` adapter is the
  mitigation and physical qualification is the proof.
- The preview override is a faithful preview for layout-critical CSS only; residual cosmetic
  media queries may differ. Dev/QA gating keeps it out of user-facing scope.
- Terminal on phones remains functionally basic (xterm virtual-keyboard limitations); it stays a
  secondary surface and its deep touch work is explicitly deferred.
- Node-scoped routes change hosted URL shapes; legacy hosted URLs redirect, and non-hosted modes
  are untouched.
- Each landing PR keeps the app releasable: the phone shell mounts behind the tier signal, and
  desktop remains the fallback presentation at every stage.

## Delivery sequence (public)

1. **Spec PR:** this document.
2. **Foundation fixes** (small, independently valuable, also candidates if the current PWA
   qualification pass surfaces blockers): drawer width repair, approval detail
   scrollability + action wrapping, markdown table scroll wrapper, toast/tab-strip overlap.
3. **Keyboard adapter:** `useVisualViewportCssVars` + composer/menu/approval insets.
4. **Presentation tier:** classification, root attribute + custom variant, QA override,
   breakpoint consolidation.
5. **Stable node routes** with refresh/deep-link restore through the fail-closed pipeline.
6. **Phone navigation shell:** Home, thread stack, app bar, connection pill + sheet, hosted
   control relocation (desktop header integration included), hosted entry-surface restyle
   (sign-in, invitation, recovery codes, node directory), and the dedicated approval card
   replacing the composer-placeholder rendering.
7. **Touch action parity:** action-sheet presenter, long-press menus, message actions, visible
   search/find entries, tap-to-expand rows.
8. **Full-screen phone work surfaces:** review/diff, files single-pane, terminal container.
9. **Settings and accessibility polish:** full-screen settings, labels, live regions, motion.
10. **Acceptance matrix consolidation** and physical requalification.

Each step lands with its own tests and keeps every existing gate green. Steps 2–3 may be
accelerated independently of this design's approval if the remaining physical qualification of
the current implementation surfaces defects requiring minimal fixes.
