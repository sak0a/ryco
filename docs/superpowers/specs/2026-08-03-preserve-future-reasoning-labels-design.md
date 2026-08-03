# Preserve Future Reasoning Effort Labels Design

## Goal

Ensure the composer reasoning chip never presents a known fallback label for an unknown provider
effort ID. When a provider advertises a future effort such as `ultra-deep` with the label
`Ultra Deep`, the chip must display `Ultra Deep` while continuing to submit `ultra-deep`.

## Presentation Resolution

Split effort resolution into known and unknown paths:

- Known effort IDs keep their current abbreviated labels, tint classes, and Ultra/Ultrathink
  sparkle behavior.
- An unknown effort ID uses the exact label from the matching descriptor option and a neutral slate
  tint.
- If an unknown current value has no matching descriptor option, display the raw current value so
  the UI never falsely claims a different selection.
- If no current value exists, preserve the existing Medium label and tint fallback.

The resolved display label must be shared by visible text, `aria-label`, and `title` so visual and
assistive presentation cannot disagree.

## Scope

Change only the web `ReasoningChip` presentation logic and its browser tests. Provider model
discovery, descriptor contracts, selected/submitted effort values, menus, persisted state, and the
special Ultra/Ultrathink presentation remain unchanged.

## Verification

- Add browser coverage for an advertised `ultra-deep` option whose current value is `ultra-deep`.
- Assert that visible text, accessible name, and title use `Ultra Deep`, and that `Med` is absent.
- Assert that the unknown effort uses no special icon and retains normal menu behavior.
- Keep existing coverage for known abbreviated levels and the Ultra/Ultrathink sparkle.
- Run the repository backstop plus the required web build and browser suite.
