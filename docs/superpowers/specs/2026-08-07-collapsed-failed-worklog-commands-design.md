# Collapsed Failed Worklog Commands Design

## Goal

Keep failed commands compact in the worklog instead of automatically expanding their output.
Failures must remain immediately recognizable without making the entire row visually dominant.

## Behavior

All expandable worklog entries default to closed, including entries with an error tone or a
non-zero exit code. Explicit session-local user expansion state continues to take precedence, so a
failure that the user opens remains open until they close it or the thread UI state is cleared.

## Failure Indicator

A failed entry uses the existing `CircleAlertIcon` with the destructive red foreground color.
Only the leading icon receives the error color; the label, metadata, and disclosure chevron keep
their normal neutral worklog styling. Failure detection covers both an error tone and any non-zero
exit code.

## Validation

Add focused coverage for the default expansion decision and failed-entry presentation. Run only
the affected web tests, web typecheck, and targeted formatting checks.
