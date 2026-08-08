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

Use the composer's liquid-glass material rather than a solid status plate: a 52% light-theme plate,
a 40% dark-theme plate, 24px backdrop blur, and 185% saturation. Each semantic toast keeps the
existing shadow, radius, motion, and neutral readable typography.

Mix the semantic color into the plate at a restrained 8%, with a 32% semantic border. Success,
error, warning, and info therefore remain visibly distinct without turning the full toast into a
strongly colored block. The existing semantic icon remains the strongest color accent. Loading
toasts use the same glass material without a semantic tint.

Add the composer's two masked specular bezel rings to the toast surface. The rings follow each
toast's radius and do not intercept pointer events. The floating dismiss orb inherits the toast
tone and glass treatment so it reads as part of the same material.

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
