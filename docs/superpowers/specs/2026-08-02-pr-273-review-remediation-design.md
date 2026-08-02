# PR 273 Review Remediation Design

## Context

Codex reported two unresolved issues on PR 273:

1. The expanded diagnostics presentation is reachable from the frozen web phone tier because
   `PhoneSettingsSurface` renders the same `DiagnosticsSettings` component as desktop.
2. Replay metric state is inserted into a process-global map before the returned stream attaches
   its cleanup, leaving a cancellation window during `Stream.unwrap` construction.

Both findings are current and actionable. This follow-up addresses only those review threads.

## Frozen phone diagnostics

`DiagnosticsSettings` will accept an explicit presentation mode. Desktop settings and the
standalone diagnostics route will use the expanded performance presentation by default.
`PhoneSettingsSurface` will explicitly request a `phone-legacy` presentation.

The phone presentation will retain the pre-PR diagnostics section inventory and labels. It will
not expose the new `Performance now`, `Why was this slow?`, or collapsed `Advanced diagnostics`
presentation. The development-only tier preview remains available because it was already part of
the phone surface.

Both presentations will share the same snapshot state, visibility-aware polling, pause/refresh
controls, resource-series derivation, warnings, and formatting helpers. This preserves the new
demand-gated behavior without introducing a second polling owner or duplicating data acquisition.
The presentation mode comes from the owning surface rather than viewport or tier inference, so the
development tier override cannot accidentally change which product surface is rendered.

## Scoped replay metric registration

Replay metric state will be registered with `Effect.acquireRelease` at the map insertion point.
The release action will remove the entry only when it still refers to the same state and will then
republish the stream aggregate. Registration and finalizer installation will therefore be
uninterruptible as one scoped acquisition.

The existing `reset` operation and stream-level `Stream.ensuring` cleanup will remain as eager,
idempotent cleanup. Scope finalization is the correctness backstop for interruption or failure
before the stream is returned. Metric labels remain bounded to `shell` and `thread`, and no new
subscription identifiers are published.

## Tests

- Extend the phone settings browser test to assert the legacy overview remains visible and the
  three expanded desktop diagnostics labels are absent.
- Keep the desktop presentation-tier test asserting the expanded diagnostics presentation.
- Add a replay metrics test that registers state inside a scope, records nonzero pressure, closes
  the scope without calling `reset`, and verifies aggregate gauges return to zero.
- Run focused server and browser tests first, followed by the repository backstop required by
  `AGENTS.md` because the changes affect web interaction and reconnect cleanup.

## Non-goals

- No changes to hosted reconnect ownership, mutation readiness, service-worker behavior, or the
  native mobile application.
- No new diagnostics metrics or visual redesign.
- No GitHub replies, thread resolution, commit, or push of implementation changes unless separately
  authorized.
