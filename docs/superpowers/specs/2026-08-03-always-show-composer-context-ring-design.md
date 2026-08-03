# Always Show the Composer Context Ring

**Status:** Approved design

**Date:** 2026-08-03

## Summary

Always render the context-window ring in the web composer, including on a new
thread before its first message. The initial ring represents zero usage against
the currently selected provider/model context limit when that limit is exposed
by the model's option descriptors. Once the provider reports actual context
usage, the existing live snapshot remains authoritative.

## Behavior

- A composer with no `context-window.updated` activity shows a zero-usage ring.
- When the selected model exposes a context-window option such as `200k` or
  `1m`, the ring shows `0%` and its popover shows `0 / <selected limit>`.
- When the selected model does not expose a parseable limit, the ring remains
  visible in a neutral zero state. Its popover uses the same compact typography
  as the normal usage row and shows `0 context used`, without inventing a
  context limit.
- Changing the provider, model, or context-window option before the first
  message immediately updates the initial ring.
- The latest valid provider-reported context snapshot replaces the initial
  state without changing existing usage, compaction, or rate-limit behavior.

## Architecture and Data Flow

Keep the fallback entirely in the web client. The composer already resolves
the effective provider, model, option descriptors, and selected option values,
so it can derive a display-only initial context state without introducing a
server event or persisted thread activity.

Add focused context-window utilities that:

1. Parse supported compact context limits from provider option values,
   including plain positive integers and case-insensitive `k`/`m` suffixes.
2. Create a zero-usage display value with a known or unknown maximum.

The composer selects the latest real activity-derived snapshot when one
exists; otherwise it selects the zero-usage display value derived from the
current model configuration. The meter remains a presentation component and
receives a non-null display value.

Malformed, non-positive, or unsupported context-limit values are treated as
unknown. They must not hide the ring, throw during rendering, or invent a
maximum.

## Scope

- Update the web composer's context-window derivation and rendering path.
- Reuse the selected model's resolved option values, including descriptor
  defaults, rather than maintaining a separate provider/model lookup table.
- Preserve the existing meter visuals, popover, usage-limit rows, compact
  composer behavior, and provider-reported usage interpretation.
- Keep known- and unknown-limit zero states visually consistent. Do not add a
  larger prose-style empty-state message to the popover.
- Do not emit synthetic provider/runtime events, persist zero-usage activities,
  change server contracts, or extend the frozen web phone presentation tier.

## Validation

- Unit-test compact limit parsing, invalid/unknown limits, and zero-usage
  display derivation.
- Add browser coverage showing that the ring is visible before the first
  message, reflects a selected known limit, and uses the compact usage row when
  the selected model's limit is unknown.
- Verify that a real provider snapshot still wins over the fallback.
- Run the repository-required formatter, formatting check, lint, both
  typechecks, test suite, and build.
- Because this changes web interaction, also build `@ryco/web` and run the
  browser suite, installing the pinned Playwright runtime first if needed.
