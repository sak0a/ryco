# Performance, Efficiency, And Size Implementation Status

Last updated: 2026-06-12

## Scope

This pass turns `docs/research/performance-efficiency-size-improvements.md` into measurement and
follow-up tooling. It intentionally avoids major rewrites or speculative pruning until current
measurements identify a target.

## Status Legend

- **Finished**: Implemented or confirmed with code evidence in this pass.
- **In progress**: Actively being inspected or changed in this pass.
- **Todo**: Clear follow-up work with enough evidence to scope next.
- **Blocked**: Cannot be completed safely without missing input, an external artifact, or a design
  decision.
- **Needs measurement**: Existing code evidence shows a plausible issue, but current numbers are
  required before behavior or packaging changes.
- **Deferred / high-risk**: Rewrite-level or behavior-changing work that is intentionally out of
  scope for this pass.

## Live Checklist

### Coordination

- [x] **Finished**: Read `AGENTS.md` and confirmed required validation commands.
- [x] **Finished**: Read the research report and existing `docs/perf/` baseline docs.
- [x] **Finished**: Created this live status checklist.
- [x] **Finished**: Spawned coordinator, runtime reliability, runtime performance,
      packaging/bundle-size, and web-rendering subagents; incorporated their read-only findings.
- [x] **Finished**: Added `docs/perf/package-size-measurement.md` to make current size
      measurement flows reproducible.
- [x] **Finished**: Kept final claims aligned with code evidence and measurement gaps.
- [x] **Finished**: Ran final verifier review against changed files, claims, and checklist state;
      fixed the verifier finding by gating new projection/snapshot perf work behind
      `isServerPerfProfileEnabled()`.
- [x] **Finished**: Ran `bun fmt`, `bun lint`, and `bun typecheck`.
- [x] **Finished**: Ran targeted tests for queue metrics and web fallback selector with
      `bun run test`.

### Runtime Reliability

- [x] **Finished**: Inventoried unbounded WebSocket, orchestration, provider/runtime, and worker
      queues.
- [x] **Finished**: Confirmed existing WebSocket replay depth/high-water/lag metrics and tests in
      `apps/server/src/wsReplayMetrics.ts`.
- [x] **Finished**: Added shared server runtime queue metrics for enqueue/dequeue/depth/high-water
      in `apps/server/src/observability/QueueMetrics.ts`.
- [x] **Finished**: Wired queue metrics into the orchestration command queue and the single-consumer
      provider adapter runtime event queues for Codex, Claude, Copilot, and OpenCode.
- [ ] **Todo**: Add equivalent queue metrics to `DrainableWorker` reactors with a shared naming
      policy, or expose a metrics callback from `packages/shared/src/DrainableWorker.ts`.
- [ ] **Todo**: Add useful PubSub metrics for provider service and Cursor runtime event streams
      without reporting misleading global queue depth.
- [ ] **Todo**: Document explicit overflow policies by stream type before adding bounded behavior.
- [ ] **Needs measurement**: Collect queue depth/high-water under slow WebSocket clients, reconnect
      storms, provider bursts, terminal bursts, and long active turns.
- [ ] **Deferred / high-risk**: Enforce queue bounds that could drop, reorder, or disconnect streams
      without tests and product policy.

### Runtime Performance

- [x] **Finished**: Added opt-in projection fanout duration and projector transaction-attempt
      labels by event type.
- [x] **Finished**: Added opt-in `refreshThreadShellSummary` duration labels bucketed by total row
      count and message row count.
- [x] **Finished**: Added opt-in `subscribeThread` initial snapshot byte/duration measurement
      separate from mixed stream-item measurements.
- [x] **Finished**: Identified instrumentation points for projection fanout duration and
      transaction count by event type.
- [x] **Finished**: Identified measurement path for `refreshThreadShellSummary` cost by thread
      size.
- [x] **Finished**: Identified measurement path for `subscribeThread` snapshot bytes and latency.
- [ ] **Needs measurement**: Collect real numbers before rewriting projection routing, shell
      summaries, or thread snapshots.
- [ ] **Todo**: Add static projection fanout/event-count reporting against a copied state database
      if the opt-in runtime labels show projection as a top cost.
- [ ] **Deferred / high-risk**: Projection routing, incremental shell summaries, and paged thread
      detail snapshots remain design work unless current measurements isolate a safe small step.

### Packaging And Bundle Size

- [x] **Finished**: Added `scripts/measure-desktop-stage.ts` and root
      `bun run measure:desktop-stage` for current kept-stage section and package attribution.
- [x] **Finished**: Added `scripts/measure-web-bundle.ts` and root `bun run measure:web-bundle`
      for raw/gzip/brotli bundle attribution.
- [x] **Finished**: Defined current kept desktop-stage measurement flow with
      `RYCO_DESKTOP_KEEP_STAGE=true`.
- [x] **Finished**: Defined staged dependency `du` attribution by package.
- [x] **Finished**: Defined web bundle analysis for initial JS/CSS, async chunks, fonts, images,
      gzip, and brotli.
- [ ] **Needs measurement**: Run current production build/stage measurements before pruning
      dependencies or assets.
- [ ] **Blocked**: Current package-level size claims cannot use stale v0.1.3 kept-stage output as
      current evidence.
- [ ] **Deferred / high-risk**: Dependency pruning, native dependency replacement, and shell
      migration are out of scope until current measurements justify them.

### Web Rendering

- [x] **Finished**: Inspected `ChatThreadRouteView` subscriptions and WeakMap-backed derivation.
- [x] **Finished**: Added focused `web.render.ChatThreadRouteView` measurement through existing
      `usePerfMark`.
- [x] **Finished**: Replaced the missing-route fallback's full `EnvironmentState`/full-thread
      derivation with a cached narrow selector that uses sidebar summary data and shell fallback.
- [x] **Finished**: Added selector tests for stable identity, sidebar-summary sorting, and shell
      fallback.
- [ ] **Needs measurement**: Run before/after `VITE_RYCO_PERF_PROFILE=1` scenarios for long
      assistant output and large-environment missing-route fallback behavior.

## Current Evidence Rules

- Stale kept-stage output from v0.1.3 is context only, not current measurement output.
- Perf profiling remains opt-in and must be enabled explicitly for measurement runs.
- This pass should prefer scripts, docs, and observability over behavior changes.
