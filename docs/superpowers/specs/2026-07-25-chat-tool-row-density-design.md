# Chat tool-row density refinement

## Goal

Remove the completion divider made redundant by the turn activity fold and make collapsed tool
entries visually consistent, compact, and easier to scan.

## Completion divider

The `Response • Worked for …` divider is removed from the chat timeline. The settled
`Worked for …` turn fold is the only transition between hidden turn activity and the final
assistant response.

The web timeline no longer computes, passes, projects, or renders completion-divider state. Shared
runtime helpers may remain if they are part of a broader public API, but the web application must
not retain dead divider-specific state.

## Compact tool-row system

Every collapsed tool entry uses the same base geometry:

- 30px minimum height
- 8px horizontal padding
- fixed-width leading icon slot
- one-line, 11px primary text with truncation
- fixed trailing slot for disclosure or summary metadata
- matching hover and keyboard-focus surfaces

Expandable tool entries place their disclosure chevron in the trailing slot. This keeps icons and
labels aligned with non-expandable entries instead of adding variable leading indentation.

The `+N previous tool calls` disclosure uses the same horizontal grid, base height, and typography
as the tool rows above it.

## File-edit entries

File-edit entries reuse the shared compact base row and no longer use a larger bordered card.

- A single-file edit remains one line and has the same collapsed height as other tool entries.
- A multi-file edit adds one compact second line of filename chips.
- The second line is the only collapsed state allowed to exceed the base height.
- Aggregate additions and deletions remain visible in the trailing slot.
- Filename chips retain truncation and per-file diff stats.
- Active editing, completed, and error states remain distinguishable without changing row geometry.

## Preserved behavior

This refinement does not change:

- turn-fold lifecycle or expansion state
- individual tool-entry expansion state
- command output and error details
- file paths, diff statistics, or tooltips
- keyboard interaction and focus visibility
- phone-accessible detail behavior
- timeline virtualization or chronological ordering

## Testing

Update unit and browser coverage to verify:

- no completion divider is projected or rendered
- running and settled turn folds still expose the final answer correctly
- regular tool rows and single-file edit rows share the compact base height and left alignment
- multi-file edit rows use one additional chip line
- disclosure chevrons remain keyboard-operable
- previous-tool disclosure retains its behavior with the new geometry

Run the web unit suite, web browser suite, repository formatting, linting, typechecks, tests, and
production builds required by `AGENTS.md`.

## Non-goals

- Redesigning expanded command-output panels
- Changing activity-fold labels or timing
- Altering tool grouping or auto-collapse behavior
- Introducing new colors, icons, or dependencies
