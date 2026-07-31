# Sidebar Inbox Control and Row Polish

## Goal

Refine the new sidebar Inbox so it uses the available width efficiently, keeps metadata stable
during hover, and replaces native filter selects with compact icon-led controls. Move the existing
command-palette Search control into shared sidebar chrome so it remains available in both Workspace
and Inbox views.

This is a focused web presentation change. It preserves settlement semantics, Inbox classification,
filter dependencies, navigation behavior, keyboard shortcuts, project grouping, and server data.

## Approved direction

Use the approved Option A, Anchored metadata. It keeps the current Ryco visual system and the dense,
scan-friendly hierarchy inspired by T3 Code Sidebar V2.

The sidebar has three persistent layers below its chrome header:

1. Global Search, which opens the existing command palette.
2. The Workspace and Inbox view switcher on desktop.
3. The active view's contextual controls and content.

The visual target is a compact developer-tool sidebar with low-variance composition, restrained
motion, and high information density. Existing theme tokens, radii, typography, focus treatment,
and icon family remain authoritative.

## Shared global Search

The Search row currently rendered inside `SidebarProjectsContent` moves to a small shared component
owned by `Sidebar`. It renders directly above `SidebarViewToggle`, uses the existing
`CommandDialogTrigger`, retains the command-palette shortcut hint, and opens the same command palette
with identical behavior.

The shared Search is visible in Workspace and Inbox. On the existing mobile presentation, where the
view switcher is hidden, Search remains visible above Workspace content. This relocates an existing
capability and does not extend the frozen web phone feature set.

Inbox's `Search threads` field remains separate because it is a live list filter, not global search.
Its placeholder and accessible name must continue to make that local scope explicit. The visual
separation created by the view switcher prevents the two controls from reading as duplicate inputs.

## Inbox filter controls

`SidebarInboxFilters` keeps a compact full-width `Search threads` field followed by one row of three
custom selector triggers:

- Environment uses an environment glyph and the selected environment label.
- Project uses `ProjectFavicon` artwork and the selected logical project label.
- Worktree uses a branch glyph and the selected worktree or branch label.

Each trigger is the same height and follows the sidebar radius and border language. It contains a
fixed artwork slot, one truncated text label, and a small chevron. The trigger exposes its full
selection through accessible naming and a tooltip where truncation makes the visible label
insufficient. The `All` state uses the filter category glyph and a short label such as `Environment`,
`Project`, or `Worktree`, avoiding three long `All ...` labels in the closed controls.

Each trigger opens a Base UI-backed combobox popup aligned below the trigger. The popup is wide
enough for readable labels even when the trigger is narrow, caps its height, and scrolls long lists.
It includes:

- an `All` option first;
- the same artwork used to identify each option;
- a selected check state;
- keyboard navigation, typeahead, Escape dismissal, and focus restoration;
- an inline search field only when the available option count is greater than six;
- an empty result message when search finds no matches.

Project options use a representative member project for their favicon while preserving the existing
logical-project value and grouping behavior. Environment and worktree options carry presentation
metadata alongside their current value and label. Option data remains local to the web component
layer and adds no contract fields.

The established dependencies remain unchanged:

- selecting an environment resets project and worktree to `all`;
- selecting a project resets worktree to `all`;
- invalidated project or worktree selections reset automatically;
- changing any local filter clears thread selection;
- `All` is the per-control clearing mechanism, so no separate Clear button is added.

## Inbox row composition

Active rows use three stable bands without permanent padding for a floating action:

1. Project favicon and project name at the left; a fixed-width status/action slot at the right.
2. Thread title across the full available row width.
3. Branch or worktree context at the left; PR, remote environment, and provider indicators in a
   compact metadata rail at the right.

The metadata rail uses content-sized columns with small consistent gaps. The provider icon remains
anchored inside this rail and never moves or disappears when the row is hovered. Metadata with no
value occupies no space. The branch or worktree label is the only flexible item and truncates before
the right rail.

The top-right slot reserves only the width needed by its largest state. In the resting state it shows
relative time or semantic status. On hover or keyboard focus it crossfades to Settle. The transition
changes only opacity and a subtle transform inside the slot, so the project label, title, provider,
and row width never shift. Reduced-motion mode swaps the content without animation.

Settled rows keep their compact one-line presentation. Their provider indicator sits directly before
the fixed time/action slot. Hover or keyboard focus crossfades that slot from settlement time to Move
to Active without reflow.

## Hover detail card

The existing rich detail card remains the supplementary source for full thread context. Its content
and placement stay stable while the row layout is tightened. It continues to show project artwork,
environment, workspace or worktree, branch, provider and model, pull request, and blocking or error
state when available.

The row hover transition and detail-card opening are independent. Moving onto the action or provider
indicator must not produce a second layout animation. No essential state or action is available only
through hover.

## Component boundaries and data flow

- A shared `SidebarGlobalSearch` component owns the relocated command-palette trigger and shortcut
  presentation. `Sidebar` renders it once; `SidebarProjectsContent` no longer owns Search.
- `SidebarInboxFilters` owns local thread-search layout and composes three reusable
  `InboxFilterCombobox` controls.
- `InboxFilterCombobox` owns popup state, optional option search, keyboard behavior, and generic
  option rendering. It receives already-derived option presentation data and does not read stores.
- `SidebarInbox` continues to own filter state and dependency resets. It enriches the existing option
  arrays with project, environment, and worktree artwork metadata.
- `SidebarInboxRow` keeps navigation and settlement actions. Layout helpers may be extracted when
  they make the fixed status slot or metadata rail easier to test, but no settlement logic moves into
  presentation components.

Existing Base UI-backed combobox, tooltip, and sidebar primitives are reused. No third-party
dependency is added.

## Accessibility and reliability

- Global Search retains its existing command-palette shortcut, label, and focus behavior.
- Combobox triggers have category-specific accessible names that include the current selection.
- Popup options expose selection semantically and remain fully keyboard operable.
- Touch targets retain the repository's pointer-coarse expansion behavior without increasing the
  desktop visual height.
- Long project, environment, worktree, branch, provider, and model names truncate without causing
  horizontal overflow.
- Popups remain inside the available viewport and do not widen the sidebar.
- Action capability, lifecycle blockers, and failure reporting remain unchanged.
- Loading, disconnected, mixed-version, empty-option, and empty-result states remain non-mutating
  and render useful fallback labels.
- Both light and dark themes use existing semantic tokens. Motion honors `prefers-reduced-motion`.

## Verification

Browser component coverage will verify:

- global Search is present and opens the command palette in both Workspace and Inbox;
- the Workspace copy of Search is removed without changing its shortcut hint;
- each custom selector opens, renders icons, selects an option, and restores the `All` state;
- keyboard navigation and optional option search work;
- environment and project changes preserve the established dependent reset behavior;
- active and settled row actions appear without changing the positions of anchored metadata;
- provider indicators remain visible and stationary during row hover;
- long labels truncate without horizontal overflow;
- reduced-motion behavior removes the status-slot animation.

Live browser QA will cover the normal desktop width and narrow supported sidebar widths in light and
dark themes. It will inspect the global Search hierarchy, popup alignment, hover detail-card
placement, Settle and Move to Active behavior, keyboard focus, and browser console errors.

The full repository backstop, explicit web build, and browser suite are required before completion.
