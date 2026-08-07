# Desktop Toast Interactions

## Problem

Desktop toasts are positioned 12px from the top of the Electron window, overlapping the draggable
title-bar region. Toasts are rendered through a portal, so they are not descendants of the existing
`.drag-region` selector that marks nested controls as non-draggable. Electron can therefore consume
pointer input intended for visible toast controls, including the dismiss, provider-update, settings,
copy, and disclosure controls.

## Design

Treat each rendered toast card as an interactive window-chrome exclusion by applying
`-webkit-app-region: no-drag` to the shared toast root. Apply the same contract to standard and
anchored toast roots so every notification variant remains interactive if its placement overlaps a
draggable area.

The change is intentionally made at the shared card boundary instead of on individual buttons. This
covers current controls, swipe handling, and controls added later without changing toast position,
appearance, stacking, timing, dismissal persistence, or provider-update behavior.

## Error and Lifecycle Behavior

Dismissal continues through the existing toast manager. Provider-update prompts still invoke their
existing `onClose` callback before closing, preserving the notification-key dismissal in local
storage. No new state or failure path is introduced.

## Verification

Add browser regression coverage that mounts a persistent top toast, verifies the rendered toast root
computes to `-webkit-app-region: no-drag`, clicks the dismiss control, and confirms the toast is
removed. Existing provider-update dismissal tests continue to cover persistence independently.

Run the focused browser test, the web browser suite, the web build, the desktop build, and the full
repository backstop required by `AGENTS.md`.
