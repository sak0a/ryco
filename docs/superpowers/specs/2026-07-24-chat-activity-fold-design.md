# Chat activity fold redesign

## Summary

Replace the standalone dotted working indicator and independently grouped work-log rows with a
turn-scoped activity fold. The fold follows the current `pingdotgg/t3code` “Worked for…” design
while extending the same visual and interaction model to a running turn.

A running turn starts expanded and may be collapsed by the user. Incoming activity respects that
choice. When the turn settles, its fold automatically collapses and changes from a live
`Working for …` label to a completed `Worked for …` label. The terminal assistant response remains
visible outside the fold.

This is a focused adaptation of upstream commit `41a430a88e8dde9c428f59d54dd328aa6a66a8fd`,
primarily its turn-fold derivation in `apps/web/src/components/chat/MessagesTimeline.logic.ts` and
the associated timeline rows in `MessagesTimeline.tsx`. It is not a wholesale upstream merge.

## Goals

- Give active and completed activity one consistent visual hierarchy.
- Group assistant commentary and tool activity by provider turn.
- Keep the current activity visible by default without preventing users from collapsing it.
- Collapse the activity automatically when the turn settles.
- Show only the latest tool row initially, with a compact disclosure for earlier tool calls.
- Preserve Ryco-specific timeline behavior: virtualization, search targeting, copy/revert actions,
  file-edit presentation, persistent tool-detail expansion, mobile interaction, and low-churn live
  timers.

## Non-goals

- Replacing the timeline or `LegendList`.
- Porting unrelated upstream message metadata, minimap, composer, or theme changes.
- Changing provider events, orchestration contracts, or server persistence.
- Redesigning final assistant messages, user bubbles, or changed-file summaries.

## Interaction design

### Running turn

The activity fold appears at the first foldable entry for the active turn and starts expanded:

```text
Working for 24s ⌄
────────────────────────────────────────
Assistant commentary

Latest tool row

⌄ +7 previous tool calls
```

The header is a keyboard-accessible button with `aria-expanded`. Selecting it collapses or expands
the turn. A user-collapsed running fold stays collapsed as new commentary or tool entries arrive.
The elapsed label uses the existing self-ticking timer so the entire timeline does not commit once
per second.

### Settled turn

When a turn changes from running to a settled state, its activity fold automatically resets to
collapsed even if it was expanded during execution:

```text
Worked for 40s ›
────────────────────────────────────────
Final assistant response remains visible
```

Expanding the header reveals the turn’s commentary and tool history. Completed folds remain
independently user-expandable for the remainder of the mounted thread view.

An interrupted latest turn uses `You stopped after …`. Without valid timing data, a running fold
uses `Working…`, a completed fold uses `Worked`, and an interrupted fold uses
`You stopped this response`.

### Tool rows

Within an expanded turn, consecutive visible work entries use the existing compact work-row
components. When more than one entry is present:

- the latest entry is visible;
- earlier entries are hidden behind `+N previous tool calls` or `+N previous log entries`;
- selecting the disclosure inserts the earlier rows without replacing the latest row;
- the expanded disclosure reads `Show fewer tool calls` or `Show fewer log entries`;
- individual tool output panels keep their existing persisted expansion state;
- errored entries retain their existing error treatment and default-open details;
- file-edit entries keep their specialized active/completed presentation.

## Architecture

### Timeline row derivation

Extend `MessagesTimeline.logic.ts` with two row variants:

- `turn-fold`: the active/completed turn header and its expanded state;
- `work-toggle`: the disclosure for earlier work entries.

Derivation groups entries by `turnId`, finds the terminal assistant message for each response, and
computes which commentary/work entries belong inside the fold. The final assistant message remains
outside the hidden set.

The current turn must be treated as unsettled using both the running turn identifier and latest-turn
lifecycle. This avoids folding the previous turn incorrectly during the short interval after a user
sends a message but before the server publishes the new turn.

Unlike upstream, the running turn also receives a fold row. Its expanded state defaults to `true`.
Settled folds default to `false`, which provides the required automatic collapse without an effect
that races timeline updates.

### Duration

Use authoritative `latestTurn.startedAt` and `latestTurn.completedAt` when available. For historical
turns, fall back to the user-message boundary through the last foldable entry or terminal assistant
completion. Clamp negative durations and use the shared `formatDuration`.

The live fold uses `activeTurnStartedAt` and the existing visible-second ticker.

### UI state

Keep turn-fold and work-group expansion session-only and scoped by `routeThreadKey`.

Use separate keys for:

- running turn folds: `turn-fold:running:<turnId>`;
- settled turn folds: `turn-fold:settled:<turnId>`;
- work groups: `work-group:<anchorEntryId>`;
- existing individual work entries: unchanged.

The active fold’s default derives from lifecycle rather than being written eagerly. Explicit user
choices override that default only while the lifecycle is unchanged. Once the turn settles, the
completed fold resolves to collapsed, satisfying automatic collapse. Later user expansion of the
completed fold remains stable.

The new records in the existing UI state store must:

- survive virtualization unmount/remount during the mounted thread view;
- remain scoped to one thread;
- avoid persisting transient running-state choices across application restarts;
- not mix turn-fold state with individual tool-output expansion.

Extend the existing session-only UI state store with thread-scoped turn-fold and work-group records.
This store already survives virtualized row unmounts without persisting the transient choices to
disk.

Turn-fold keys include lifecycle:

- `turn-fold:running:<turnId>` defaults to expanded;
- `turn-fold:settled:<turnId>` defaults to collapsed.

The lifecycle-key change makes completion collapse deterministic even when the user explicitly
expanded the running fold. Expanding the completed fold writes only the settled key. Work-group
keys remain lifecycle-independent because their disclosure state does not control automatic turn
collapse.

### Rendering

`MessagesTimeline.tsx` renders the new row variants through focused components:

- `TurnFoldTimelineRow`;
- `WorkGroupToggleTimelineRow`;
- the existing `WorkGroupSection` and work-entry row components.

The completed and active headers share the same component, spacing, border, typography, chevron,
focus treatment, and responsive behavior. Only label text, timer source, and default expansion
differ.

Row padding is tightened between commentary, tools, and disclosures so an expanded activity block
reads as one sequence. Message search and scroll targeting continue to address real message rows;
fold headers are ignored as message targets.

## Data flow

1. `ChatView` passes latest-turn lifecycle and the running turn identifier to `MessagesTimeline`.
2. `deriveMessagesTimelineRows` groups turn entries and emits a fold header at each turn’s first
   foldable entry.
3. The row derivation omits fold contents when the fold is collapsed.
4. Expanded work groups emit the latest work row plus a disclosure row; expanding the disclosure
   emits earlier rows in chronological order.
5. User toggles update thread-scoped session UI state under the current lifecycle key.
6. A running-to-settled lifecycle change selects the unset `settled` key, so the completed fold
   deterministically appears collapsed.

## Reliability and edge cases

- Entries without a `turnId` keep their existing rendering and are not incorrectly absorbed.
- Streaming assistant messages prevent a historical turn from being treated as settled.
- A steer-superseded turn uses the last trailing work entry when it ends after its last commentary.
- A just-sent user message does not temporarily unfold the preceding settled turn.
- Missing or invalid timestamps yield a label without a duration.
- Context-compaction markers and proposed plans remain independent timeline rows.
- Empty or neutral lifecycle work entries are not rendered as blank activity rows.
- Stable-row comparison includes the new row fields so virtualization updates only affected rows.
- Toggle controls expose focus-visible styling, button semantics, and accurate `aria-expanded`.

## Testing

### Logic tests

- Running turns emit an expanded live fold.
- User-collapsed running turns remain collapsed as new activity arrives.
- Settled turns emit a collapsed `Worked for …` fold.
- Expanded settled folds reveal commentary and work while leaving the final response visible.
- A lifecycle transition resets an active fold to collapsed.
- Authoritative and fallback duration calculations are correct.
- Interrupted turns use the stopped label.
- The previous turn stays folded while a new sent message awaits its server turn.
- Work groups show the latest entry and the correct hidden count.
- Stable-row comparison recognizes fold and toggle changes.

### Component and browser tests

- Active and completed headers share structure and styling.
- Fold and work-group controls toggle with pointer, Enter, and Space.
- `aria-expanded` updates correctly.
- New live activity does not force a user-collapsed fold open.
- Individual command output and file-edit rows retain current behavior.
- Narrow/mobile layouts truncate command previews without horizontal overflow.
- Timeline search, scroll-to-message, and at-end anchoring continue to work.

### Repository validation

Run the required repository backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
```

Because this changes web interaction and responsive timeline layout, also run:

```sh
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Install the pinned browser runtime first if required:

```sh
bun run --cwd apps/web test:browser:install
```

## Acceptance criteria

- The active status uses the same activity-fold design as completed `Worked for …` rows.
- A running fold starts expanded and can be collapsed.
- Incoming activity respects a collapsed running fold.
- Completion automatically produces a collapsed completed fold.
- The final assistant answer stays visible outside the fold.
- Expanded folds show commentary, the latest tool, and a disclosure for earlier tools.
- Existing Ryco-specific timeline features remain functional.
- All required repository and browser checks pass.
