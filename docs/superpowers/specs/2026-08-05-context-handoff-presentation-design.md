# Context handoff presentation

## Goal

Make a model handoff understandable before the user sends it and readable afterward. A staged
provider-instance or model change on an already-started thread shows a non-blocking informational
chip above the composer. Completed, failed, and delivery-uncertain timeline dividers use the same
friendly model names as the provider/model picker instead of raw model slugs.

## Scope

- The existing desktop and tablet web handoff flow.
- Friendly, historically stable provider/model presentation in context-handoff timeline markers.
- A pending-handoff chip above the composer.
- Focused unit, component, browser, and real-flow verification.

The frozen web phone provider flow remains unchanged. This work does not add a confirmation modal,
a dismissal action, a new RPC, a new persistence format, or a second handoff state machine.

## Interaction design

Selecting a different provider instance or model on an already-started, idle thread immediately
shows a compact floating chip above the composer, even before the composer contains sendable
content. Its content follows this structure:

> Next message hands off context · [source provider icon] GPT-5.6 → [target provider icon] Fable 5

The chip is informational only. It has no close, confirm, or revert action. Selecting the canonical
provider/model again removes it. A successful send removes it when the server commits the new
selection. An options-only change, such as reasoning effort, is an ordinary continuation turn and
does not show the chip.

The provider icon or configured instance badge carries provider identity. The text therefore avoids
redundant labels such as `Claude Fable 5` when the picker presents `Fable 5`. Long labels truncate
without forcing the composer wider, while the full transition remains available to assistive
technology and pointer hover.

## Friendly model labels

Model presentation uses one shared fallback order:

1. Compose the optional sub-provider with the preferred model title when the picker does so.
2. Prefer a non-empty `shortName` for the model title.
3. Otherwise use a non-empty `name`.
4. Use the model slug only when the provider catalog has no friendly label.

This resolver is shared by the picker, pending chip, and server-side handoff presentation so their
copy cannot drift.

## Components and data flow

### Shared model presentation

`@ryco/shared/model` owns the pure friendly-label resolver over the schema-only model fields. The web
picker delegates its trigger label to that resolver, preserving its current presentation while
making the same behavior available to the server.

### Persisted timeline presentation

When `ContextHandoffCoordinator` builds a terminal handoff activity, it reads the authoritative
source and target provider snapshots from `ProviderRegistry`. It resolves each selected model
against that exact instance's model catalog and writes the resulting `modelDisplayName` into the
existing `ContextHandoffEndpointSnapshot` fields. The activity therefore preserves the label shown
at handoff time even if provider settings or catalogs later change.

If an instance or model is missing from the live catalog, the coordinator keeps the existing driver
and slug fallbacks. Presentation lookup must never weaken server-side handoff validation or prevent
a terminal failure marker from being recorded.

### Pending composer presentation

`ChatComposer` already holds both the canonical thread selection and the staged selection. It uses
the existing `modelSelectionRequiresContextHandoff` predicate, which compares instance and model but
ignores options, to derive a pending handoff. A focused `PendingContextHandoffChip` receives resolved
source and target endpoint presentation and renders immediately above the composer surface.

The chip is not a source of handoff authority. `selectionAllowedAtSendBoundary` and the atomic
`thread.turn.start` path remain authoritative. If the thread becomes ineligible between selection
and send, the existing guard rejects the send and preserves the staged message/selection for a
predictable retry.

## Accessibility and responsive behavior

- The chip exposes a single descriptive status label containing the full source-to-target
  transition.
- Decorative icons and the visual arrow do not duplicate accessible text.
- The chip is not focusable because it has no action.
- Source and target labels may truncate visually, but the accessible label and title remain complete.
- The chip is absent from the frozen web phone presentation tier.

## Error behavior

- Unknown or removed models render their bounded slug rather than an empty label.
- A missing source snapshot falls back to the canonical thread/session driver metadata already used
  by handoff presentation.
- A missing target presentation never grants dispatch authority; the existing provider service and
  orchestration validation remain authoritative.
- Failed and delivery-uncertain timeline markers retain their current status treatment and error
  copy. Only endpoint names change.

## Verification

- Unit-test friendly-label preference, sub-provider composition, whitespace handling, and slug
  fallback.
- Extend coordinator tests to prove a terminal handoff persists friendly source and target model
  names, including `Fable 5` for `claude-fable-5`, while retaining fallbacks for missing models.
- Add focused web tests for immediate pending-chip appearance, source/target content, informational
  semantics, options-only changes, canonical-model reselection, responsive truncation, and absence
  from the web phone tier.
- Run the repository backstop required by `AGENTS.md`.
- Because this changes web interaction and responsive presentation, also build `@ryco/web` and run
  the browser suite.
- Start the development server and use agent-browser to change the model on a real started thread,
  observe the pre-send chip, send the message, and verify the friendly timeline divider.
