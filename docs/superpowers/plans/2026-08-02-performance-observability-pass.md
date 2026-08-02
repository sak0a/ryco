# Performance and Observability Pass Implementation Plan

**Goal:** Implement the approved focused performance pass: reduce permanent browser work, consolidate demand-gated diagnostics, bound trace-write failure behavior, and remove targeted snapshot, context, and Git overhead.

**Design spec:** `docs/superpowers/specs/2026-08-02-performance-observability-pass-design.md`

## Tasks

- [ ] Install the pinned Bun dependencies with `bun install --frozen-lockfile` and record the clean baseline status.

- [ ] Reduce browser idle paint and animation work.
  - Remove the fixed full-screen noise pseudo-element from `apps/web/src/index.css`.
  - Add reduced-motion-safe, low-duty-cycle status animation utilities.
  - Restrict shimmer/pulse/ping to states that are actively changing.
  - Add focused CSS/status tests without altering interaction or readiness semantics.

- [ ] Make trace persistence failure-safe and observable.
  - Add a bounded pending byte/record budget to `TraceSink`.
  - Add capped retry backoff, reset-on-success behavior, and a privacy-safe health snapshot.
  - Preserve deterministic flush/close behavior.
  - Test sustained failures, dropping, recovery, and shutdown.

- [ ] Make server resource diagnostics demand-gated.
  - Replace the permanent one-second process sampler with one sample per requested diagnostics snapshot.
  - Use an on-demand bounded event-loop delay sample.
  - Retain capped histories and make optional metric-read failures non-fatal.
  - Add tests proving no permanent interval is installed and history grows only with demand.

- [ ] Extend the diagnostics snapshot with existing operational evidence.
  - Include local turn-quiescence, checkpoint, and reconnect metrics in the consolidated response.
  - Aggregate queue/replay pressure and trace-sink health only while building a requested snapshot.
  - Record bounded snapshot/replay timing where an existing boundary permits it without duplicate serialization.
  - Add schema, redaction, and aggregation tests.

- [ ] Consolidate the two web diagnostics surfaces.
  - Reuse one shared implementation from both Settings and the standalone route.
  - Add concise `Performance now` and evidence-based `Why was this slow?` sections.
  - Preserve log/debug-bundle tools, environment/WebSocket state, push sequence, provider/terminal detail, failures, traces, histories, and slow client RPCs.
  - Keep advanced sections collapsed and stop polling when paused or unmounted.
  - Add focused logic/component/browser coverage.

- [ ] Bound legacy orchestration snapshot consumers.
  - Change the HTTP snapshot endpoint and offline CLI project reads to `getCommandReadModel()`.
  - Preserve the required response shape.
  - Add tests that fail if the full snapshot projection is invoked.

- [ ] Prune stale context-window snapshot activities.
  - Extract a pure projection helper that retains the latest valid context-window activity while preserving all other activity kinds.
  - Keep live stream behavior unchanged.
  - Test invalid-newer and no-context cases.

- [ ] Reduce Git statistics subprocess work.
  - Use one `git diff HEAD --numstat` for tracked worktree/index totals.
  - Fall back to the current separate commands for unborn repositories.
  - Preserve error classification, noninteractive environment, and parsing.
  - Add command/fallback tests.

- [ ] Run focused tests after each subsystem, then the complete required validation:
  - `bun fmt`
  - `bun run fmt:check`
  - `bun lint`
  - `bun typecheck`
  - `bun run typecheck:effect`
  - `bun run test`
  - `bun run build`
  - `bun run build --filter=@ryco/web`
  - `bun run --cwd apps/web test:browser` (install the pinned browser runtime first if needed)

- [ ] Produce the final audit mapping, exact changed-file list, available before/after evidence, validation results, explicit deferrals, and later native-monitor recommendation.
