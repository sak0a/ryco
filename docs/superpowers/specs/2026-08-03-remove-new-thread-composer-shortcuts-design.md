# Remove New-Thread Composer Shortcuts

## Goal

Remove the shortcut controls displayed above the composer for a new thread, including **Reference
issue**, **Reference PR**, **Reference Jira**, and **Browse commands**. Preserve the existing vertical
spacing so the composer retains its current position.

## Design

`ChatView` will stop rendering `ComposerHintRow`. In the same new-thread-only location, it will render
an inert, `aria-hidden` spacer matching the row's vertical footprint. The spacer has no text,
interaction, focus target, provider-dependent behavior, or accessibility-tree presence.

Because no remaining surface will use the hint row, remove `ComposerHintRow`, its pill-resolution
logic, and their focused tests. Remove the corresponding imports and any values that become unused
at the call site. Slash commands and reference pickers remain available through their existing
composer input triggers; only the shortcut controls are removed.

## Scope

- Applies only to the shortcut row above the composer in new threads.
- Does not change composer input, picker behavior, thread state, RPC, or provider configuration.
- Does not extend or modify the frozen web phone presentation tier.

## Verification

- Confirm the web package typechecks and the relevant test suite passes.
- Build the web package and run the browser suite because the change affects web layout and
  interaction.
- Run the repository's full required formatting, linting, typechecking, test, and build backstop.
