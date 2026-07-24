# Chat tool-row density implementation plan

**Goal:** Remove the obsolete completion divider and give every collapsed tool entry one compact,
consistent alignment system, with filename chips as the sole second line for multi-file edits.

**Design spec:**
`docs/superpowers/specs/2026-07-25-chat-tool-row-density-design.md`

## Execution rules

- Preserve turn folding, work grouping, tool-detail expansion, diff statistics, and mobile access.
- Keep the change inside the existing React and Tailwind component system.
- Do not include unrelated generated declaration-file changes.
- Never run `bun test`; use `bun run test`.
- Inspect the complete diff and run `git diff --check` before committing.

## Task 1: Remove completion-divider plumbing

**Files:** `apps/web/src/components/ChatView.tsx`,
`apps/web/src/components/chat/MessagesTimeline.tsx`,
`apps/web/src/components/chat/MessagesTimeline.logic.ts`, related tests.

- [ ] Stop computing and passing completion-divider state from `ChatView`.
- [ ] Remove divider fields from timeline props, streaming state, and message rows.
- [ ] Remove the divider render branch and update focused tests.
- [ ] Keep the settled turn fold and final assistant response ordering unchanged.

## Task 2: Unify collapsed tool-row geometry

**File:** `apps/web/src/components/chat/MessagesTimeline.tsx`.

- [ ] Define a shared 30px base row shell with fixed icon, content, and trailing slots.
- [ ] Move expandable-entry chevrons to the trailing slot.
- [ ] Apply matching height, padding, typography, hover, and focus treatment to previous-tool
      disclosure.
- [ ] Preserve truncation, tooltips, output panels, errors, and active state.

## Task 3: Compact file-edit rows

**File:** `apps/web/src/components/chat/MessagesTimeline.tsx`.

- [ ] Replace the bordered file-edit card with the shared row shell.
- [ ] Keep single-file edits on one line.
- [ ] Add one compact filename-chip line only for multi-file edits.
- [ ] Keep aggregate and per-file diff statistics.

## Task 4: Test and visually verify

**Files:** `apps/web/src/components/chat/MessagesTimeline.browser.tsx`,
`apps/web/src/components/chat/MessagesTimeline.logic.test.ts`,
`apps/web/src/components/chat/MessagesTimeline.test.tsx`.

- [ ] Assert that the completion divider is absent.
- [ ] Compare the bounding geometry of a standard tool row and a single-file edit row.
- [ ] Verify the multi-file chip line and previous-tool disclosure.
- [ ] Verify keyboard expansion and final-response visibility.
- [ ] Inspect the rendered result in a browser at desktop and narrow widths.

## Task 5: Validate

- [ ] Targeted timeline unit and browser tests.
- [ ] `bun fmt`
- [ ] `bun run fmt:check`
- [ ] `bun lint`
- [ ] `bun typecheck`
- [ ] `bun run typecheck:effect`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] `bun run build --filter=@ryco/web`
- [ ] `bun run --cwd apps/web test:browser`
- [ ] `git diff --check`
