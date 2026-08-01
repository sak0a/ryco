# Sidebar Inbox Visual Density

## Goal

Give the web Inbox a clearer, denser visual hierarchy at every supported desktop sidebar width.
Threads should read as distinct objects against a darker sidebar, filters should consume less
vertical and horizontal space, local thread search should be optically centered, and the active
Workspace or Inbox view should be immediately recognizable.

This is a focused presentation refinement of the existing Inbox. It preserves settlement
classification, filtering dependencies, global Search, navigation, hover details, provider and
model metadata, and all server contracts. It does not extend the frozen web phone surface.

## Approved direction

Use Option A, **Inset thread cards**, from the approved visual comparison.

The sidebar remains visually quiet while each thread receives a darker inset surface. Active work
uses the strongest card treatment, settled history uses a slimmer muted version of the same shape,
and the routed thread receives a stronger border and surface than hover alone. This creates clear
scan boundaries without adding permanent labels, decorative rails, or additional card layers.

## Thread surfaces and hierarchy

The Inbox list retains its existing active and settled sections. Inside each section:

- rows have a small vertical gap instead of touching on a transparent background;
- every row owns a rounded, darker inset surface in both resting and hovered states;
- hover changes color and border treatment only, without changing dimensions or moving metadata;
- the current row uses a visibly stronger surface and border than either rest or hover;
- keyboard focus keeps the existing ring and receives the same visual emphasis as hover;
- active rows keep their three-band information hierarchy and settled rows remain one-line rows;
- provider icons, resting status, and settle or unsettle actions retain their fixed layout slots.

The list viewport keeps the semantic sidebar background, while resting, hovered, and current rows
use progressively stronger `sidebar-accent` surface and `sidebar-border` composition. The exact
opacity is calibrated in live QA, but the ordering is fixed: list background, resting card, hovered
card, then current card. Styling uses existing theme tokens and opacity composition so light and
dark themes remain coherent; no hard-coded dark palette is introduced.

## View switcher

`SidebarViewToggle` keeps its two-tab keyboard and ARIA behavior. Its visual selection becomes more
explicit:

- the containing track is quieter and has a clear boundary from surrounding sidebar chrome;
- the selected tab receives an opaque semantic fill, stronger foreground, subtle inset border, and
  restrained shadow;
- the inactive tab remains readable but visibly secondary;
- hover never resembles the selected state;
- icon, label, height, and layout remain stable while switching.

This change increases state contrast without introducing a new accent color or changing persisted
view-mode behavior.

## Compact Inbox controls

`SidebarInboxFilters` retains local thread Search above one row of Environment, Project, and
Worktree comboboxes. The controls become denser:

- closed filter triggers use a 24px visual height, tighter horizontal padding, and smaller internal
  gaps;
- artwork keeps a fixed slot, with project favicon artwork favored over a generic folder icon;
- the label truncates when partially constrained and disappears when its individual trigger becomes
  narrower than 5.25rem (84px);
- artwork and chevron remain visible in icon-only mode;
- each trigger decides its compact state from its own available width through CSS container queries,
  rather than a single viewport breakpoint;
- the complete category and selected value remain available through `aria-label` and tooltip/title
  text in both labeled and icon-only states;
- touch target expansion for coarse pointers remains handled by the existing control primitives and
  does not inflate the desktop visual height.

The three-column filter row remains balanced. Collapsing text must not cause a trigger to widen,
reorder, or push its neighbors.

## Combobox popup layout

The current Base UI-backed combobox behavior, optional option search, filtering, and focus
restoration remain authoritative. Only option composition changes:

- item artwork begins at the normal content inset;
- item text follows the artwork without a permanent selection gutter;
- the selected checkmark occupies a compact slot at the far right of the item;
- unselected items reserve only the same small right-side action slot needed for alignment;
- long labels truncate before the check slot;
- popup width, viewport collision handling, keyboard navigation, typeahead, Escape dismissal, empty
  results, and selection semantics remain unchanged.

The shared `ComboboxItem` receives an optional end-indicator layout while retaining its current
start-indicator layout as the default. Inbox filter options opt into the end layout. This keeps the
selection primitive semantic, avoids duplicating Base UI item behavior, and leaves unrelated
comboboxes visually unchanged.

## Thread search alignment

The local `Search threads` control keeps its current purpose and accessible name. Its icon and text
are vertically centered using explicit input height, line-height, and symmetric vertical padding.
The browser-native search affordance must not introduce an asymmetric inset. Placeholder and typed
text share the same baseline, and focus styling does not change the control's geometry.

Global Search remains directly above the Workspace / Inbox switcher and is not altered by this
refinement.

## Component boundaries

- `SidebarInboxRow` owns card-surface states while preserving navigation and settlement actions.
- `SidebarInbox` owns section spacing and the list-level background treatment.
- `SidebarInboxFilters` owns compact grid and thread-search geometry.
- `InboxFilterCombobox` owns per-trigger container responsiveness and right-aligned selection
  indicators.
- `SidebarViewToggle` owns the stronger selected-tab presentation.

No new dependency is added. Prefer Tailwind utilities, semantic theme tokens, Base UI capabilities,
and localized CSS container-query utilities. Shared helpers should be extracted only when the same
state composition is genuinely reused.

## Accessibility and reliability

- Current thread, selected view, and selected filter option remain represented semantically, not
  only by color.
- Keyboard navigation, focus visibility, popover focus restoration, and row actions remain intact.
- Icon-only filter triggers retain complete accessible names and discoverable hover text.
- Hover, focus, selection, and popup-open states cause no width or height shift.
- Reduced-motion users receive immediate state changes without animated transforms.
- Long project, environment, worktree, branch, provider, and model names cannot cause horizontal
  overflow.
- Disconnected, mixed-version, empty-option, and missing-artwork fallbacks remain usable.

## Verification

Browser component coverage will verify:

- Inbox rows render distinct resting card surfaces and a stronger current-row state;
- hovering or focusing rows does not change row geometry or provider/action slot placement;
- Workspace and Inbox expose clearly different selected and unselected classes while preserving tab
  semantics and arrow-key navigation;
- filter triggers use the compact height and hide only their label at the compact container width;
- icon-only triggers retain artwork, chevron, accessible name, and full-value title;
- combobox options render artwork and text at the left and the selected checkmark at the right;
- thread-search placeholder and typed text use centered input geometry;
- existing filter selection and dependent-reset behavior continues to pass.

Live browser QA will inspect normal and narrow supported desktop sidebar widths in both themes. It
will cover card contrast, current and hover states, global-versus-local Search hierarchy, all three
filter popups, compact icon-only transitions, hover detail cards, settlement actions, keyboard
focus, and console errors.

Completion requires the repository backstop from `AGENTS.md`, the explicit web build, and the full
browser suite.
