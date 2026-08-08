# Desktop Collapsed Sidebar Controls Design

## Goal

Restore pointer interaction for the collapsed app-sidebar chrome in the Electron desktop app.
The visible Ryco mark, Settings button, and Show sidebar button must remain usable while preserving
their current positions, appearance, accessibility labels, and collapse/expand transitions.

## Root Cause

`CollapsedAppSidebarChrome` is a fixed overlay above the active workspace title bar. In Electron,
that title bar is an application drag region. Electron suppresses pointer events for controls that
overlap a drag region unless the overlapping area is explicitly excluded with
`-webkit-app-region: no-drag`.

The existing global rule only excludes buttons and links that are descendants of `.drag-region`.
The collapsed chrome is a sibling overlay, so its controls do not match that rule. They render over
the drag region but Electron treats the same screen area as draggable instead of clickable.

## Design

Mark the collapsed chrome's interactive footprint as an Electron no-drag region in
`apps/web/src/components/AppSidebarLayout.tsx`. Keep the change local to
`CollapsedAppSidebarChrome`; do not broaden the global drag-region rules or change the title-bar
geometry.

The outer collapsed-chrome row is the appropriate boundary because the whole row is reserved for
the mark and its two controls. Its existing `pointer-events-none` behavior remains in place so
transparent gaps do not shadow ordinary web content, while the existing `pointer-events-auto`
controls remain the only DOM pointer targets. The no-drag declaration changes Electron's native
hit-testing for that reserved rectangle and does not alter web layout or animation.

## Behavior

- With the sidebar collapsed, clicking Settings opens the existing settings dialog.
- With the sidebar collapsed, clicking Show sidebar expands the existing sidebar and persists the
  open state through the current callback.
- The Ryco mark remains a working link to the thread overview.
- The window remains draggable through the rest of each title bar.
- Expanded-sidebar behavior is unchanged. The always-mounted collapsed chrome stays inert and
  hidden while the sidebar is open.
- Phone presentation and non-Electron web presentation are unchanged.

## Alternatives Rejected

- Moving the controls into every workspace title bar would duplicate shell behavior across the
  chat, empty, diff, and maximized-workspace surfaces.
- Carving per-surface holes out of each drag region would couple title-bar geometry to the floating
  chrome and be more fragile across macOS traffic lights and Window Controls Overlay layouts.
- Removing drag behavior from the complete title bar would unnecessarily reduce the desktop
  window's draggable area.

## Verification

- Add regression coverage for the collapsed chrome's no-drag boundary and its interactive
  controls.
- Exercise Settings and Show sidebar from the collapsed state in the desktop/browser interaction
  path.
- Run the full repository backstop required by `AGENTS.md`.
- Because this changes web interaction and desktop behavior, also build `@ryco/web`, run the web
  browser suite, and run `bun run build:desktop`.

## Out of Scope

- Visual redesign of the sidebar header or collapsed chrome.
- Changes to sidebar persistence, resizing, transition timing, or responsive tiers.
- Changes to authenticated state, provider lifecycle, or workspace content.
