# Overview Changes Default-Closed Design

## Goal

Make the Overview panel's **Changes** disclosure start closed whenever it is first rendered,
matching the other informational lanes. Apply the behavior consistently across the stack, hybrid,
and status-board layouts.

## Behavior

- The Changes section is collapsed on initial render even when changes are present.
- The existing summary remains visible so file counts and diff statistics are still glanceable.
- Clicking the Changes header continues to toggle the disclosure normally.
- In the hybrid layout, activating the Changes metric tile continues to open and scroll to the
  section.
- Existing user-controlled open overrides remain unchanged for the lifetime of the mounted panel.
- No expansion state is persisted between panel mounts.

## Implementation

Set the shared Changes section descriptor's `defaultOpen` value to `false`. Remove the explicit
`defaultOpen` flag from the status-board Changes lane so it uses the lane component's existing
closed default. Avoid special-case state or new persistence.

## Validation

Update the focused overview layout and browser assertions to expect the Changes disclosure to be
closed initially. Run only the focused overview tests and the web package typecheck.
