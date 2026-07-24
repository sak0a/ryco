# Chat Timeline Minimap

Status: design ready for implementation plan
Date: 2026-07-24

## Summary

Ryco's desktop chat timeline will gain a compact navigation rail inspired by the
timeline minimap introduced in upstream T3 Code commit `fda64862` and hardened in
commit `946b8676`.

Each rail marker represents one user message. Markers whose message rows overlap
the visible timeline viewport use the foreground color; other markers remain
muted. Hovering or keyboard-focusing the rail previews the corresponding user
message and the final assistant response in that turn. Clicking a marker
smoothly scrolls the virtualized timeline to its user message.

The minimap is a desktop fine-pointer affordance. It is not rendered for touch
or phone interaction.

## Goals

- Make long conversations quickly navigable without replacing the existing
  scrollbar, message search, or scroll-to-bottom affordance.
- Preserve the upstream interaction model shown in the supplied reference:
  message-proportional dashes, visible-message highlighting, hover previews, and
  click-to-jump behavior.
- Integrate with LegendList's virtualized row positions instead of depending on
  off-screen DOM nodes.
- Avoid intercepting pointer events over message content at narrow desktop pane
  widths or under browser zoom.
- Keep geometry and selection behavior deterministic and unit-testable.

## Non-goals

- A touch, phone, or tablet gesture equivalent.
- A draggable scrollbar thumb or continuous scrubbing implementation.
- Changes to streaming follow, scroll anchoring, message search, or
  scroll-to-bottom behavior.
- Persisting the selected marker or scroll position.
- Showing assistant-only, work-log, compaction, or divider rows as markers.

## User experience

### Visibility

- The minimap is available only under a fine-pointer media query.
- It appears only when the timeline contains at least two user messages.
- It is positioned at the left edge of the timeline viewport, vertically
  centered within the usable chat height.
- When the centered message column leaves at least 48 px of side gutter, the
  rail stays visible. With a smaller positive gutter it rests at low opacity and
  becomes visible on hover or focus. With no safe gutter, its collapsed hit area
  is disabled.

### Markers

- There is one horizontal dash per user-message row.
- Dashes are distributed evenly from the first to the last marker. The rail's
  natural height grows by 8 px per interval and is capped at
  `calc(100vh - 18rem)`.
- The hovered marker widens to provide clear pointer feedback.
- A marker uses the foreground color when its virtual row overlaps the current
  LegendList viewport. Multiple markers may be active when multiple user
  messages are visible.

### Preview

- Moving over the rail selects the nearest marker based on the pointer's
  vertical position.
- The preview contains:
  - the compacted user-message text as the primary line;
  - the last non-empty assistant message before the next user message, when
    present, clamped to three lines.
- Whitespace is normalized and preview text is capped at 240 characters.
- The preview stays inside the usable vertical rail area and flips its
  translation near the top and bottom to avoid clipping.
- The preview itself permits text selection and remains interactive while open.
- Keyboard focus shows the currently selected marker and exposes an accessible
  “Jump to message” label.

### Navigation

- Clicking a marker calls LegendList `scrollToIndex` with the marker's real row
  index, smooth animation, and a small top offset.
- Navigation targets the user-message row even when intervening work and
  assistant rows are virtualized.
- The click does not create a separate highlighted-message state and does not
  alter search state.

## Architecture

### Pure minimap logic

`apps/web/src/components/chat/MessagesTimeline.logic.ts` will own constants and
pure helpers for:

- rail height;
- marker top percentage;
- pointer coordinate to marker index;
- persistent-gutter detection;
- safe collapsed hit-strip width;
- collapsed versus expanded interactive width.

Keeping these helpers outside the component lets unit tests cover boundary
conditions without mounting LegendList.

### Timeline integration

`MessagesTimeline` remains the owner of the row list and LegendList ref. It will:

1. derive minimap items from stable timeline rows;
2. wrap LegendList in a relative viewport container;
3. measure the viewport width with `ResizeObserver`;
4. update marker visibility from LegendList's position and size APIs inside the
   existing scroll callback;
5. render the overlay alongside, not inside, the scrollable list;
6. call `scrollToIndex` when an item is selected.

The existing message row renderer and timeline contexts do not gain minimap
state, preventing rail hover updates from re-rendering timeline rows.

### Item derivation

For every row whose kind is `message` and whose role is `user`, the derived item
contains:

- stable row id;
- actual LegendList row index;
- compacted displayed user text;
- compacted final assistant response for the turn.

Assistant preview lookup stops at the next user message. Work-log and structural
rows are skipped.

### Pointer safety

The centered content column is at most 768 px wide. The collapsed hover strip
starts 12 px from the viewport edge and is capped at 40 px, but it may use only
the available side gutter. If the gutter cannot contain the strip, its width is
zero and pointer events are disabled. Once a preview opens, the interactive
region expands to include the preview so users can select its text without it
closing.

## Failure and compatibility behavior

- Missing or temporarily unavailable LegendList row measurements leave a marker
  muted; they do not throw or guess visibility.
- A missing `ResizeObserver` is not expected in supported browsers or the
  Playwright runtime. Existing test setup will provide the same observer mock
  used by other responsive components when needed.
- An empty or single-user-message timeline renders no minimap.
- Empty user text uses the fallback label `User message`.
- Timeline scroll behavior continues to use the existing `isAtEnd` callback;
  minimap updates are additional work within that handler and do not publish
  readiness or lifecycle state.

## Testing

### Unit and component tests

- Rail height and top-position calculations, including zero and one item.
- Pointer index mapping, clamping above and below the rail.
- Persistent-gutter threshold and safe hit-strip widths.
- Expanded interactive width.
- Item derivation includes only user messages and chooses the final assistant
  response before the next user message.
- Fewer than two user messages omit the minimap.
- The rendered rail exposes an accessible jump label.

### Browser tests

- The minimap is present on a fine-pointer desktop viewport with multiple user
  messages.
- Hovering different dashes updates the preview.
- Visible user-message markers receive the active foreground state.
- Clicking a marker scrolls to the corresponding virtualized user-message row.
- The rail does not intercept pointer selection over the content column when
  the side gutter is too narrow.
- Phone/touch presentation does not show the minimap.

## Validation

Because this changes web interaction and responsive layout, completion requires:

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

If the pinned Playwright runtime is absent, run
`bun run --cwd apps/web test:browser:install` before the browser suite.

## Alternatives considered

### DOM `IntersectionObserver`

Observe rendered user-message elements and navigate with `scrollIntoView`.
Rejected because LegendList virtualizes off-screen rows, so the complete marker
set and distant navigation targets are not simultaneously available in the DOM.

### Replace the timeline scroller

Adopt a non-virtualized scroll container or a new virtualization layer with a
built-in minimap. Rejected because it expands scope and risks Ryco's established
streaming, anchoring, and search behavior.

### Separate independent scroll-spy store

Mirror timeline rows and scroll measurements into a global store. Rejected
because the state belongs to one mounted timeline and would add synchronization
work without improving reliability.

## Open questions

None. Desktop-only scope and upstream-compatible behavior are approved.
