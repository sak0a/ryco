# Reasoning Chip Text-Label-Only Design

## Goal

Remove the configurable reasoning-chip presentation styles from web Appearance settings and make
the existing text-label presentation permanent. The `icon-dots` and `dots` variants must no longer
be selectable or renderable.

## Behavior

- Every ordinary reasoning effort renders its existing abbreviated, color-tinted text label.
- Ultra and Ultrathink retain the existing sparkle icon beside the `Ultra` label.
- The reasoning chip remains a menu trigger with unchanged selection, disabled-state, prompt
  injection, accessibility-label, and tooltip behavior.
- Mobile behavior is unchanged because the removed preference and variants exist only in the web
  client.

## State and Persistence

Remove `ReasoningIndicatorStyle`, `reasoningIndicatorStyle`, its default and sanitizer, and its
setter from the web UI state store. Stop writing the field to persisted UI state. Previously saved
`reasoningIndicatorStyle` keys are obsolete: hydration ignores the extra key, and the next UI-state
write omits it. No migration or compatibility switch is needed because text-label rendering is now
unconditional.

## UI and Components

Remove the complete **Reasoning chip style** row from Appearance settings, including its three
options, reset action, previews, and imports used only by that row. Simplify `ReasoningChip` by
removing the UI-state subscription, dot-scale calculation, dot markup, and style branches. Preserve
the existing Ultra/Ultrathink branch; render the abbreviation directly for every other level.

## Verification

- Replace store tests for reasoning-style defaults, updates, and persistence with coverage that
  confirms obsolete persisted values do not enter the active or newly persisted state.
- Replace browser tests for icon/dot variants with text-label assertions and an assertion that
  ordinary reasoning chips contain no icon or dot elements.
- Keep coverage for menu selection and Ultra, Ultracode, and Ultrathink behavior.
- Update Appearance settings browser tests so they no longer expect the removed controls.
- Run the repository backstop and, because this affects web interaction, the web build and browser
  suite required by `AGENTS.md`.

## Out of Scope

- Changing reasoning effort names, abbreviations, colors, or menu contents.
- Removing the Ultra/Ultrathink sparkle icon.
- Changing mobile reasoning labels or any provider protocol behavior.
