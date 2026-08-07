# Workspace Launcher Grid Design

## Goal

Keep all six core window types fully visible in the right-side Workspace launcher on desktop and
tablet, including when the panel is narrow or vertically constrained.

## Scope

The core launcher contains Files, Side chat, Browser, Review, Terminal, and Agents. The frozen
phone presentation remains unchanged and continues using its scrollable single-column list.

## Layout

- Center the desktop/tablet launcher in the available panel.
- Arrange the six core cards in a two-column, three-row grid bounded to a square.
- Size the square against both the available width and height so the complete grid stays inside the
  visible workspace.
- Use compact card spacing and typography while preserving icons, labels, descriptions, keyboard
  shortcuts, disabled states, hover feedback, and keyboard focus.
- Keep dynamic individual-agent entries below the core launcher in a secondary scrollable area.

## Behavior

Existing card actions and disabled states do not change. The layout adapts without changing route,
tab, or workspace state. When the launcher is unusually small, its scroll container remains the
fallback rather than clipping content.

## Validation

Add focused browser coverage that mounts the desktop launcher in a narrow, short right panel and
verifies every core card remains within the visible launcher viewport. Preserve the existing phone
test that verifies its card list scrolls instead of clipping. Run the focused browser file, web
typecheck, and formatting checks.
