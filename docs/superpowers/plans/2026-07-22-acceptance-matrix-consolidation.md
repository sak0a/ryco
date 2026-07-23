# Acceptance matrix consolidation implementation plan

**Goal:** Extend the acceptance matrix to cover the Liquid Glass steps, and make the cell → proving
test mapping **executable** so it can no longer go stale silently.

**Design spec:**
`docs/superpowers/specs/2026-07-21-liquid-glass-phone-experience-design.md`

Delivery step 9, the last. Steps 1–8 are merged (#204–#212).

## Why this is not bookkeeping

`AcceptanceMatrix.browser.tsx` maps every spec cell to the test that proves it — **in a doc block,
by test name**. Rename or delete a test and the mapping still reads as complete. It is a coverage
claim that cannot fail, which is the exact defect class this workstream found nine times in its own
assertions: a contrast suite that chose which roles to measure, a harness that measured a 151 px
column instead of 390, a bounding box that could not see hit-slop, a coarse-gated reading taken under
`pointer: fine`, a bound left vacuous by a formatter rewrap, and a distinctness guard that folded
away the one collision in its vocabulary.

Consolidating the matrix while leaving its mapping unverifiable would end the workstream on the same
mistake it spent nine steps learning to catch.

## Task 1: Make the mapping executable

**Files:** `apps/web/src/components/AcceptanceMatrix.browser.tsx`.

- [ ] Convert the doc-block mapping into a data structure: cell → `{ file, testName }`.
- [ ] Add a test that reads the suite's actual test names and asserts **every referenced name
      exists**. A referenced test that no longer exists must fail the suite.
- [ ] Assert the reverse where it is meaningful: every phone-tier acceptance test belongs to some
      cell, so coverage cannot be added without being mapped. If full bidirectionality is too noisy,
      scope it to the phone suites and say so.
- [ ] **Prove it falsifiable**: rename a referenced test and confirm the matrix fails.

## Task 2: Extend the matrix to the Liquid Glass steps

- [ ] Add cells for the properties these steps introduced, each pointing at its proving test:
      one-tap composer focus in the activating task; ≥44 px by outward hit test; sheet detents,
      swipe-to-dismiss and stacking; material contrast floors per tier and scheme; reachability in
      the lower third with the coarse-landscape exemption; model and session-policy sheet gating;
      connection indicator text-and-icon, distinct labels, and both live regions; hosted entry
      bottom-anchored actions; diff scroll containment.
- [ ] Include the four new step-8 test names the index is currently missing.
- [ ] Add no duplicate re-testing. The matrix maps to per-step suites; it only gap-fills.

## Task 3: Record the deferred set honestly

- [ ] One place listing what the automated matrix **cannot** prove and why, so physical
      qualification has a checklist rather than an inference: real iOS software-keyboard raise and
      `VisualViewport` geometry; true safe-area insets; WebKit `backdrop-filter` scroll performance
      with stacked material; real momentum, detent feel and swipe physics; screen-reader announcement
      order and timing for the two live regions; and real thumb reach.

## Execution rules

- Work only on `feat/acceptance-matrix-consolidation` in the public repository.
- No production behaviour change. This step is tests and documentation only. If you find a
  production defect, report it — do not fix it here.
- Never run `bun test`; use `bun run test`.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.

## Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun fmt` / `bun run fmt:check` / `bun lint` / `bun typecheck` / `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build` / `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser` — three consecutive clean full runs
- [ ] `bun audit`, distinguishing a proven pre-existing baseline from a regression.

Note: local full-suite runs on this machine intermittently abort with `Browser connection was closed`
/ `[birpc] rpc is closed` — the Chromium process dying mid-run, hitting an arbitrary different file
each time and producing no assertion failure. It is a harness flake, not a code defect; CI on the
Linux runners is unaffected. Distinguish it from a real failure by the absence of a `FAIL` line.
