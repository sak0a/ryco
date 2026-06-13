# Wide Composer Auto-Collapse Implementation Plan

**Goal:** Implement the approved default-on setting that collapses wide composer mode labels to icons at rest and expands each control independently on hover, focus, or open select state.

**Design spec:** `docs/superpowers/specs/2026-06-13-wide-composer-auto-collapse-design.md`

## Tasks

- [x] Add `wideComposerControlsAutoCollapse` to `uiStateStore` with default `true`, sanitization, persistence, setter, and tests.
- [x] Add an Appearance Settings row under "Composer controls"; clarify that "Token mode style" applies when auto-collapse is off.
- [x] Add a reusable composer expandable-label primitive for icon + label content inside buttons/select triggers.
- [x] Wire the primitive into wide composer mode controls: Build/Plan, runtime/security, token mode, and plan sidebar.
- [x] Preserve compact composer behavior and preserve `tokenModeControlStyle` whenever auto-collapse is disabled.
- [x] Add browser/component coverage for settings, token-style override, wide/compact behavior, and focus/hover expansion hooks.
- [x] Run verification: targeted `bun run test` suites, `bun fmt`, `bun lint`, and `bun typecheck`.
- [x] Browser-verify the local app after the frontend change.
