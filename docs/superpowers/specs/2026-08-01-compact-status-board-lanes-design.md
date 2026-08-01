# Compact Status Board lanes

## Goal

Reduce the vertical footprint of the right-side Status Board while preserving its familiar lane
model, current data, and existing Git action control. The collapsed panel should be faster to scan,
with enough information in each row to decide whether it needs to be opened.

## Scope

This change applies only to the `board` overview layout. The `stack` and `hybrid` layouts, panel
width and presentation modes, branch selector, header status, and `GitActionsControl` footer remain
unchanged.

The web phone presentation tier is not extended. The same Status Board component may continue to
render in existing sidebar, floating, and sheet presentations without forking its state or behavior.

## Compact lane geometry

Collapsed Status Board lanes use one 36px row:

- a 20px leading icon frame
- a single-line title with truncation
- a trailing summary for counts, status, or progress
- a disclosure chevron
- the existing hover, pressed, focus-visible, and open-state treatments

Permanent subtitle lines are removed from collapsed rows. When a lane opens, its existing subtitle
is rendered as a compact context line above the lane body so information such as the active plan
step, CI target, subagent names, pull request title, and environment remains available.

Multiple lanes may remain open. Only Changes opens by default when that lane is present. Pull
Request no longer opens by default; its state and conflicts remain visible in the collapsed
summary.

## Changes summary

The Changes lane always shows its file count when the lane exists. When diff totals are available,
the summary reads from left to right as:

`5 files | +184 -42`

The separator is visual rather than part of the accessible text. Counts use tabular figures and
existing addition/deletion colors. Singular copy uses `1 file`; all other counts use `files`.

The previous file-count subtitle is omitted from the expanded context line to avoid repeating the
same metric. The expanded Changes content and review action remain unchanged.

## Direct pull request link

When `pullRequest.url` exists, the Pull Request lane shows an external-link control in its collapsed
header. The link:

- opens the pull request in a new tab with `rel="noreferrer"`
- has an accessible label that includes the pull request number when available
- has its own focus-visible and hover states
- does not expand or collapse the lane when activated
- is omitted when no pull request URL is available

The expand/collapse button and external link are sibling interactive elements; an anchor is never
nested inside the lane button. The link receives a desktop-appropriate visible icon and a larger
invisible hit area that fits within the 36px row.

## Component design

`SectionLane` remains the owner of uncontrolled expansion state. Its header becomes a small
container with:

1. the lane toggle button, containing the icon, title, summary, and chevron;
2. an optional structured external-link action rendered as a sibling; and
3. the conditional expanded context line and body.

The optional action should use a narrow typed shape such as `href` plus `ariaLabel`, rather than an
arbitrary React node. This keeps interaction semantics, spacing, and security attributes consistent
for future lane actions.

`StatusBoardLayout` supplies the file-count summary for Changes and the conditional pull request
link. No contracts, RPC data, runtime state, or provider behavior change.

## Accessibility and responsive behavior

- Lane toggles retain `aria-expanded` and native button keyboard behavior.
- The pull request link is independently reachable by keyboard and announces its destination.
- Long titles and summaries truncate without pushing the link or chevron out of the row.
- Visible focus indicators remain inside the lane bounds.
- Reduced motion continues to work through existing global preferences.
- The compact grid must fit the current 340px sidebar and existing narrower sheet constraints.

## Testing

Add or update unit coverage to verify:

- the board renders compact lane headers and only Changes starts open;
- the Changes summary includes the correctly pluralized file count and diff totals;
- the Pull Request lane renders an external link only when a URL exists;
- the pull request link has the expected target, relation, and accessible label;
- activating the pull request link does not change the lane's expansion state;
- the other overview layouts and the existing Git action footer remain unchanged.

Because this changes web interaction and responsive layout, run the full repository backstop and
the required web build and browser suite from `AGENTS.md`.

## Non-goals

- Changing the panel width, position, animation, or presentation breakpoints
- Redesigning or replacing `GitActionsControl`
- Changing expanded lane content or source-control workflows
- Adding urgency sorting, tabs, single-open accordion behavior, or persistent expansion state
- Extending the frozen web phone tier or changing the native mobile overview
- Introducing new icons, packages, colors, contracts, or RPC fields
