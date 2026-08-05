# Context Handoff Provider Boundary Design

## Context

Context handoff currently treats any model-selection change as a provider transition. That causes a
handoff chip, fresh-session context transfer, and timeline divider when a user changes only the model
inside the same configured provider instance, such as Claude Fable 5 to Claude Opus 5. The inspectable
timeline divider also became shrink-wrapped when it changed from a non-interactive row to a button.

## Goals

- Trigger context handoff only when a started thread moves to a different configured provider
  instance.
- Keep model-only changes inside one provider instance on the ordinary turn path.
- Preserve handoff behavior between separately configured instances, even when both use the same
  driver, because their credentials and runtime configuration may differ.
- Restore the timeline divider to its previous full-width, visually centered presentation while
  retaining inspection, hover, and keyboard behavior.

## Selected Design

The shared web predicate and the server command decider will compare provider instance identity only.
A model slug change with the same `instanceId` is not a context handoff. The requested model selection
still travels with the normal turn-start request, so provider-specific session reuse or restart logic
continues to apply without synthesizing a cross-provider context artifact.

The interactive and non-interactive marker roots will explicitly occupy the available row width. The
existing symmetric flex divider lines remain responsible for centering the label; no new wrapper or
layout system is introduced.

## Alternatives Considered

1. Hide only the pending chip and divider for model-only changes. Rejected because the server would
   still create and deliver a handoff invisibly, making UI and runtime semantics disagree.
2. Treat every instance using the same driver as one provider. Rejected because two configured Claude
   or Codex instances can have different credentials, environment, or runtime ownership.
3. Use configured provider-instance identity as the boundary. Selected because it matches the routing
   key already used throughout provider lifecycle handling and gives client and server one consistent
   rule.

## Data Flow and Failure Behavior

For a started thread, selection staging derives the handoff chip from the instance-only predicate. At
send time the web rechecks the same boundary. The server independently applies the instance-only rule
before emitting context-handoff events. Same-instance model changes emit the normal message and
turn-start request; cross-instance changes retain the existing idle guard, coordinator, persistence,
delivery, and failure handling.

## Verification

- Unit-test that same-instance model changes do not require or present a handoff and remain allowed at
  the constrained send boundary.
- Server-test that a started-thread same-instance model change emits no context-handoff request while
  preserving the requested model on the turn-start event.
- Browser-test that the marker occupies the available timeline width and its label remains centered.
- Browser-test that a same-instance model change shows no pending handoff chip, while an instance
  change still does.
- Run the repository backstop, the web build, the browser suite, and headed local browser QA.
