# Composer and Timeline Chrome Design

## Goal

Reduce visual noise in the chat composer and keep the desktop message timeline minimap visible without requiring hover.

## Scope

- Remove every vertical divider rendered between controls in the standard composer footer.
- Keep the existing control order, spacing, responsive overflow, compact menu, and phone-specific session policy behavior.
- Render the existing timeline minimap rail at full opacity whenever the minimap is mounted on a fine-pointer device.
- Preserve minimap previews, keyboard navigation, click-to-jump behavior, width-aware hit targets, and the existing touch/mobile visibility policy.

## Implementation

`ComposerFooter.tsx` will stop rendering its five `Separator` components and remove the now-unused import. No replacement spacing will be added because the footer already uses control-level padding and container gaps.

`MessagesTimeline.tsx` will use an always-visible opacity class for the minimap wrapper. The viewport measurement and gutter calculation remain intact because they still inform interaction safety and expose useful state for testing.

## Verification

- Update focused browser coverage to assert that the minimap is fully visible without hover.
- Run formatting, linting, both TypeScript checks, unit tests, and the production build.
- Because this changes web interaction and responsive presentation, also build `@ryco/web` and run its browser suite.

## Non-goals

- Showing the minimap on coarse-pointer/touch devices.
- Redesigning composer controls or changing their behavior.
- Changing minimap sizing, placement, previews, or navigation.
