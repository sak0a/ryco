# Semantic Liquid-Glass Toasts Design

## Goal

Make toast severity immediately recognizable by tinting the complete liquid-glass surface, not only
the icon. Apply the treatment consistently to success messages such as PR creation, commits, and
pushes, as well as every other toast already carrying a semantic type.

## Semantic Mapping

- `success`: green
- `error`: red
- `warning`: amber/orange
- `info`: blue
- `loading`: neutral

## Visual Treatment

Use a balanced translucent color wash rather than a solid status plate. Each semantic toast keeps
the existing blur, saturation, shadow, radius, motion, and neutral readable typography. The tint
affects the glass background and border, while the existing semantic icon remains the strongest
color accent. The floating dismiss orb inherits the toast tone so it reads as part of the same
material.

The toast plate uses 60% opacity in both light and dark themes. This keeps the semantic color
recognizable while allowing substantially more of the underlying interface to show through.

Both standard stacked toasts and anchored toasts receive the same treatment. Call sites do not need
changes because they already provide the toast `type`.

## Accessibility and Fallbacks

Reduced-transparency and browsers without backdrop-filter support use an opaque semantic mixture
instead of discarding the status color. Forced-colors mode remains system-controlled with Canvas
and CanvasText colors. Loading toasts retain the current neutral appearance.

## Validation

Add focused browser coverage that renders success, error, warning, info, and loading toasts and
verifies the semantic surface colors are distinct while loading remains neutral. Run that browser
test, the web typecheck, and targeted formatting checks only.
