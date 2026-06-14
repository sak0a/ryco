# Diagnostics Settings Page Implementation Plan

**Goal:** Implement the approved Settings Diagnostics page with a bounded
diagnostics snapshot covering current-session runtime data plus capped
persisted trace/log tails.

**Design spec:** `docs/superpowers/specs/2026-06-14-diagnostics-settings-page-design.md`

## Tasks

- [ ] Add diagnostics contracts and RPC method definitions.
- [ ] Add a bounded server diagnostics service with redaction, resource
  sampling, trace aggregation, and capped file tail parsing.
- [ ] Wire diagnostics into observability so local/server/browser trace
  records populate the in-memory ring.
- [ ] Expose read-only terminal session summaries without terminal history.
- [ ] Add owner-only WebSocket RPC and web/local API client wiring.
- [ ] Add the lazy-loaded Diagnostics Settings panel with overview cards,
  resource charts, tracing/failure tables, live activity, slow client RPCs,
  warnings, and expandable redacted raw details.
- [ ] Add focused tests for contracts, redaction/aggregation, resource/file
  collectors, client display logic, and settings-panel smoke coverage.
- [ ] Run required verification: `bun fmt`, `bun lint`, and `bun typecheck`.
- [ ] Browser-verify the settings Diagnostics panel after frontend changes.
