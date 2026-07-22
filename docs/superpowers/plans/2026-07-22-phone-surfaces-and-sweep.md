# Phone work surfaces, hosted entry, and accessibility sweep implementation plan

**Goal:** Finish the phone tier — full-screen work surfaces, hosted entry surfaces that put their
primary action in reach, and the accessibility and rhythm sweep the design closes on.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Delivery step 8. Steps 1–6 are merged (#205–#210). Step 7 (connection indicator)
is in review on a parallel branch and does not overlap these files.

## Two tracks, disjoint by file

Run in parallel. **Neither track edits `apps/web/src/index.css`** — if a token is genuinely needed,
stop and report rather than both editing it.

### Track A — work surfaces

`ChatView.tsx` work-surface composition, `DiffPanel*.tsx`, `PreviewPanel*.tsx`,
`ThreadWorkspacePanel*.tsx`, `ThreadTerminalDrawer.tsx`, `shell/phone/PhoneWorkSurface.tsx`.

- [ ] Review, Files, and Terminal render full-screen on the phone tier with an explicit back
      affordance, driven by the existing URL search params. Links stay interchangeable between tiers.
- [ ] Files becomes single-pane: tree, then a file view pushed on top. The audit found a two-pane
      split leaving a ~130 px preview pane.
- [ ] Diffs default to wrapped lines on phone, editor-open taps are suppressed, and horizontal
      scrolling is contained within the diff surface — never the page.
- [ ] Every control ≥44 px, **measured by outward `elementFromPoint` hit test, not bounding box**.
- [ ] Surfaces clear the dock: bottom scroll padding so no content is permanently obscured.

### Track B — hosted entry surfaces and the sweep

`hostedHub/HostedHubRoot.tsx`, `auth/PairingRouteSurface.tsx`,
`shell/phone/PhoneSettingsSurface.tsx`, `settings/SettingsPanels.tsx`.

- [ ] Sign-in, invitation, recovery codes, and node directory fill the viewport instead of floating a
      centred desktop card, and **bottom-anchor their primary action**. At 320×568 the primary
      "Sign in with passkey" action currently falls below the fold.
- [ ] Sign-out leaves the top-right corner of the node directory.
- [ ] Gating order is untouched: account → recovery codes → node selection → session establishment →
      shell. That order is security-load-bearing.
- [ ] Settings is a full-screen labelled list; every icon-only control has an accessible label.
- [ ] Live regions: polite for connection state, assertive for approval arrival and delivery-unknown.
- [ ] `prefers-reduced-motion` honoured on every new transition; correctness never depends on a
      transition completing.
- [ ] 200 % text scaling hides no control and causes no page-level horizontal overflow at 320 px.

## Execution rules

- Presentation only. Authentication, relay, lifecycle, readiness, and mutation policy are consumed
  unchanged.
- Desktop and tablet must not change.
- Primitives in `apps/web/src/components/mobile/` stay presentation-only.
- Reuse `MobileSheet`, `MobileListRow`, `MobileSelectSheet`, `MobileSegmentedControl`, `GlassSurface`,
  `MobileDock`. Add no new resize listeners.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.

## Falsifiability — the binding requirement

**Prove every assertion by neutering production and observing the failure.** Nine assertions in this
workstream shipped unable to fail, and each cost a review round. The recurring shapes, all seen here:

- A bounding-box assertion cannot see `::after` hit-slop. Use an outward `elementFromPoint` walk.
- A harness that does not mirror production sizing measures the wrong thing — one measured a 151 px
  column where production is 390 px, making a corner assertion unfalsifiable.
- Fixtures that exercise only the shortest or default state hide every bound.
- A hardcoded viewport literal goes vacuous if the viewport differs. Measure `window.innerWidth`.
- Coarse-pointer gating asserted under `pointer: fine` proves nothing. Assert the media query live.
- A formatter can silently undo a fixture edit. Re-read what you assert against.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build` / `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser` — **three consecutive clean full runs**, not one. A single
      green run on one base has repeatedly proven nothing.
- [ ] `bun audit`, distinguishing a proven pre-existing baseline from a regression.

## Explicitly deferred to physical qualification

- Terminal touch ergonomics, which remain out of scope by design.
- Real safe-area insets and software-keyboard behaviour on the entry surfaces.
