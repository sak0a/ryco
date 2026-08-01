# Remove About Attribution

**Status:** Approved design

**Date:** 2026-08-02

## Summary

Remove the visible `Created by Laurin (saka)` attribution from the web Settings
About header.

## Scope

- Delete the attribution paragraph and its linked creator name from
  `apps/web/src/components/settings/SettingsPanels.tsx`.
- Remove the now-unused creator URL constant.
- Retain the app name, logo, repository link, version information, and every
  other Settings and About behavior unchanged.

## Rationale

The attribution is a standalone presentation element. Removing it directly
avoids leaving hidden markup, a blank row, an unused external-link target, or
any changes to About navigation and update behavior.

## Validation

Run the repository-required formatter, formatting check, lint, both typechecks,
test suite, and build after the implementation.
