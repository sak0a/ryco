# Full-width overview branch selector

## Goal

Make the overview panel's branch selector feel like part of the compact Status Board rather than a
small control floating above it. The selector should use the full available panel width, match the
36px lane rhythm, and preserve all existing source-control behavior.

This is the approved **Integrated selector row** direction. It is a focused follow-up to the compact
Status Board design and intentionally supersedes that design's earlier decision to leave the branch
selector unchanged.

## Scope

The change applies to the branch selector rendered in `PlanSidebar` through
`useOverviewPanelControls`. It affects the existing sidebar, floating, and sheet presentations of
the overview panel.

The composer `BranchToolbar`, the frozen web phone tier, native mobile UI, source-control data,
branch operations, and the Git action footer remain unchanged.

## Row geometry and hierarchy

The overview branch selector becomes a borderless 36px row spanning all space available before the
header's trailing controls:

- a 20px leading repository/provider icon frame
- a single-line monospaced branch name that expands and truncates as needed
- the existing ahead/behind counts when they apply to the displayed checkout
- a dropdown chevron
- independent refresh and close controls, when present, at the far right of the panel header

The header drops the inset pill treatment, rounded outline, 200px width cap, and vertical padding.
Its bottom divider remains, so the branch row reads as the first peer in the lane stack. Typography,
icon scale, horizontal spacing, hover feedback, and focus treatment should align with the compact
Status Board lanes without implying that the branch row expands inline.

## Interaction design

The branch name, metrics, and chevron form one full-height combobox trigger that opens the existing
branch picker. Branch search, pagination, selection, branch creation, worktree reuse, pull-request
checkout, optimistic updates, disabled states, and keyboard behavior do not change.

When the repository has a web URL, the leading provider icon remains a separate link-like button
that opens the remote repository. It must not open the branch picker. The icon and combobox trigger
remain sibling interactive elements; neither is nested inside the other.

Refresh and close controls remain independent siblings outside the branch selector. Clicking them
must not open the branch picker. The existing Git actions control and its split-button menu remain
unchanged in the panel footer.

## Component design

`BranchToolbarBranchSelector` gains an overview-specific appearance, named `panelRow`, alongside
the existing `default` and `pill` appearances. `panelRow` reuses the same data, state, popup, and
action logic as the other appearances; only trigger composition and styling differ.

`useOverviewPanelControls` requests `panelRow` and removes its `max-w-[200px]` cap. The control's
root fills its flex container.

`PlanSidebar` changes the branch header container to a 36px, edge-to-edge row. The branch-control
slot becomes `min-w-0 flex-1`, while `HeaderTrailing` and the optional close button remain a
shrink-free trailing group. No branch behavior is moved into `PlanSidebar`.

## Responsive and accessibility behavior

- The branch combobox retains its native trigger semantics and keyboard operation.
- The remote-repository action keeps a descriptive accessible label and title.
- Long branch names truncate before ahead/behind counts, the chevron, or trailing header controls
  are displaced.
- Disabled and pending states remain visible and non-interactive as they are today.
- Focus-visible rings stay within the 36px header bounds.
- The layout must fit the 340px sidebar and narrower floating/sheet widths without horizontal
  overflow.

## Testing

Add or update browser coverage to verify:

- the overview branch selector renders as a 36px full-width row;
- the previous 200px width cap and pill outline are absent in the overview appearance;
- clicking the main trigger opens the existing branch picker;
- the remote-repository action, refresh action, and close action remain independent;
- long branch names truncate without moving metrics or controls outside the row;
- the Git action footer is unchanged.

Run the complete repository backstop and the required web build and browser suite from `AGENTS.md`
because this changes web interaction and responsive layout.

## Non-goals

- Changing branch picker contents, positioning, search, or source-control behavior
- Changing the branch selector in the composer toolbar
- Redesigning `GitActionsControl` or the pull-request link
- Adding a second line, a permanent `Branch` label, or a taller context row
- Changing panel width, lane expansion, ordering, or responsive presentation policy
- Adding packages, contracts, RPC fields, persistence, or mobile-specific behavior
