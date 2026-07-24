# Chat activity fold implementation plan

**Goal:** Replace the standalone working indicator and independent work rows with a turn-scoped,
collapsible activity block matching upstream’s “Worked for…” presentation, including a collapsible
active state and automatic collapse on completion.

**Design spec:**
`docs/superpowers/specs/2026-07-24-chat-activity-fold-design.md`

## Execution rules

- Adapt the focused upstream behavior; do not merge or replace the divergent timeline wholesale.
- Keep `LegendList`, message search, scroll anchoring, mobile interaction, tool-detail persistence,
  file-edit presentation, and self-ticking timers intact.
- Add tests before or with each behavior change.
- Never run `bun test`; use `bun run test`.
- Inspect the complete diff and run `git diff --check` before committing.

## Task 1: Add thread-scoped activity expansion state

**Files:** `apps/web/src/uiStateStore.ts`, `apps/web/src/uiStateStore.test.ts`.

- [ ] Add session-only per-thread records for turn folds and work-group disclosures.
- [ ] Use lifecycle-specific turn keys so running defaults expanded and settled defaults collapsed.
- [ ] Preserve state through virtualization unmounts, thread pruning, and thread deletion.
- [ ] Keep individual work-entry expansion unchanged.

## Task 2: Derive turn folds and compact work groups

**Files:** `apps/web/src/components/chat/MessagesTimeline.logic.ts`,
`apps/web/src/components/chat/MessagesTimeline.logic.test.ts`.

- [ ] Add `turn-fold` and `work-toggle` timeline row variants.
- [ ] Group commentary and work by turn while keeping the terminal assistant response visible.
- [ ] Emit an expanded fold for the running turn and collapsed folds for settled turns.
- [ ] Use authoritative latest-turn timing with historical boundary fallback.
- [ ] Render only the latest work entry until the previous-entry disclosure is expanded.
- [ ] Cover interrupted, steer-superseded, pending-new-turn, missing-timestamp, and stable-row cases.

## Task 3: Wire lifecycle and toggle state into the timeline

**Files:** `apps/web/src/components/ChatView.tsx`,
`apps/web/src/components/chat/MessagesTimeline.tsx`.

- [ ] Pass the latest-turn lifecycle into row derivation.
- [ ] Read thread-scoped fold/disclosure state without broadening streaming context churn.
- [ ] Update expansion state through narrow callbacks.
- [ ] Ensure incoming activity respects a user-collapsed active fold.
- [ ] Ensure completion selects a fresh, collapsed settled key.

## Task 4: Render the shared active/completed design

**Files:** `apps/web/src/components/chat/MessagesTimeline.tsx`,
`apps/web/src/components/chat/MessagesTimeline.browser.tsx`,
`apps/web/src/components/chat/MessagesTimeline.test.tsx`.

- [ ] Add one shared fold header for live and settled labels.
- [ ] Match the screenshot’s divider, typography, chevron, compact work row, and previous-tools
      disclosure hierarchy.
- [ ] Preserve tool-output expansion, copy actions, errored rows, and file-edit rows.
- [ ] Add keyboard, `aria-expanded`, narrow-width, and no-horizontal-overflow coverage.

## Task 5: Validate

- [ ] `bun install --frozen-lockfile`
- [ ] Targeted timeline, UI-state, component, and browser tests.
- [ ] `bun fmt`
- [ ] `bun run fmt:check`
- [ ] `bun lint`
- [ ] `bun typecheck`
- [ ] `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] Inspect the rendered active and completed states in a real browser.
