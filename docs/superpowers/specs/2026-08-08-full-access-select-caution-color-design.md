# Full Access Select Caution Color Design

## Goal

Make Full Access visually consistent wherever the runtime mode is shown or selected.

## Treatment

The Full Access label and open-lock icon in the desktop runtime-mode dropdown use the same orange
caution colors as the selected composer trigger: orange 700 with orange 800 on hover in light mode,
and orange 400 with orange 300 on hover in dark mode. The explanatory description remains muted,
and all other runtime modes remain unchanged.

Expose this treatment as one shared presentation class used by the composer trigger, dropdown item,
and existing phone trigger so the caution color cannot drift between surfaces.

## Validation

Add or update focused presentation coverage, then run the affected web test, web typecheck, and
targeted formatting checks only.
