# Phone connection indicator implementation plan

**Goal:** Shrink the hosted connection control to a minimal always-visible indicator that expands on
tap, without weakening what it conveys.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Delivery step 7. Steps 1–6 are merged (#205–#210).

## The measured baseline

From the live audit at 390×844: the connection pill measures **176×36** and is the largest element in
the phone app bar, rendering `MacBook Pro M5… On…` — **both halves truncated**, so neither the node
name nor the state is actually readable. On Home it crowds the title out entirely at 320 px.

## Decisions already taken with the owner

**Collapsed keeps icon + a short status word.** Icon-only was rejected: the icon vocabulary is two
glyphs against eighteen bounded status strings, so it cannot distinguish states without new glyphs.

## Invariants — none of these may weaken

- State is conveyed by **text and icon, never colour alone**, at both sizes.
- The accessible label retains **node identity and state** at collapsed size.
- **Both live regions stay mounted while collapsed** — polite for connection state, assertive for
  approvals and delivery-unknown.
- The bounded state vocabulary is unchanged. No raw errors, identifiers, tickets, or payloads.
- Fail-closed rules in the expanded sheet are unchanged: node switching and directory-dependent
  actions stay disabled while the directory is stale, role state is missing, or the browser is
  suspended. Sign out remains available.

## Scope

Ships here: `MobileStatusChip`, the last primitive with a consumer.

## Execution rules

- Work only on `feat/phone-connection-indicator` in the public repository.
- Presentation only. The status derivation, its vocabulary, the lifecycle, and the fail-closed rules
  are consumed unchanged.
- Primitives stay presentation-only: props in, callbacks out, no store, RPC, or lifecycle access in
  `apps/web/src/components/mobile/`.
- Desktop must not change.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: `MobileStatusChip`

**Files:** add `apps/web/src/components/mobile/MobileStatusChip.tsx` and its browser test.

- [ ] Icon plus a short status word, on the `chip` material tier.
- [ ] ≥44 px effective target. **Measure with an outward `elementFromPoint` walk, not a bounding
      box** — a bounding box cannot see `::after` slop, and ancestors clip slop, so prefer sizing the
      real box. See the accessibility section of the spec.
- [ ] Accessible label is a prop, so the caller supplies node identity and state.
- [ ] Truncation is bounded and never truncates the status word to ambiguity: if space is short, the
      node name yields first.

## Task 2: The collapsed indicator

**Files:** `apps/web/src/components/hostedHub/HostedConnectionControls.tsx`,
`apps/web/src/components/shell/phone/PhoneThreadAppBar.tsx`,
`apps/web/src/components/shell/phone/PhoneHome.tsx`, and their tests.

- [ ] Replace the 176 px pill on the phone tier with `MobileStatusChip`.
- [ ] The app bar title must be readable at 320 px — the current layout drops it entirely.
- [ ] Both live regions remain mounted while collapsed. Assert this: it is the invariant most likely
      to be lost when an element shrinks.
- [ ] The accessible label still carries node identity and state.

## Task 3: Assertions

- [ ] Every bounded state renders a distinguishable text label at collapsed size — enumerate the
      vocabulary from the status selector rather than hardcoding a subset, so a new state cannot be
      added without coverage.
- [ ] Text and icon both present in every state; no state distinguished by colour alone.
- [ ] Polite and assertive live regions mounted collapsed and expanded.
- [ ] The accessible label contains node identity and state at collapsed size.
- [ ] ≥44 px by hit test.
- [ ] Title readable and no horizontal overflow at 320 px on both Home and Thread.
- [ ] Desktop unchanged.

**Every assertion must be proven falsifiable** by neutering production and observing failure. Six
assertions in this workstream have shipped unable to fail; do not add a seventh. In particular a
"live region is mounted" assertion passes trivially if it queries a selector that matches something
else — pin it to the specific region and its `aria-live` value.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build` / `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] `bun audit`, distinguishing a proven pre-existing baseline from a regression.
- [ ] Revert generated `scripts/lib/*.d.ts` drift.

## Explicitly deferred to physical qualification

- Screen-reader announcement order and timing for the two live regions on a real device.
