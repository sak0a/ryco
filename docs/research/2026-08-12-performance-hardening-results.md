# End-to-End Performance Hardening Results

Date: 2026-08-12

## Outcome

The approved performance sequence is implemented across provider refresh, orchestration
projection, bounded thread hydration, live event delivery, client rendering, queues, caches,
polling, logging, startup, bundles, mobile detail loading, and validation tooling.

The main production-build results are:

| Measure                         |       Baseline |      Result |      Change |
| ------------------------------- | -------------: | ----------: | ----------: |
| Web build                       |         65.1 s |     14.44 s | 77.8% lower |
| Bootstrap static JS graph, raw  | about 3.02 MiB | 1,535.9 KiB | 50.3% lower |
| Bootstrap static JS graph, gzip |  about 952 KiB |   497.4 KiB | 47.8% lower |

The final graph contains 76 statically imported JavaScript files, totaling 1,572,783 raw bytes,
509,327 gzip bytes, and 447,759 Brotli bytes. The tiny HTML entry loader is intentionally excluded
from Vite's eager preload graph; it starts the main graph after the first shell can paint.

A local development smoke run reached the server command gate in 12 ms, the HTTP listener in
13 ms, and the complete startup phase in 19 ms. These are one-machine development observations,
not production latency guarantees.

## What changed

### Provider refresh and reconnect load

- Provider snapshots now have one managed refresh owner with freshness tracking, single-flight
  joining, generation checks, and last-good-state retention.
- Server-config subscriptions serve cached state immediately and request stale revalidation in the
  background instead of synchronously repeating provider discovery for every subscriber.
- Registry-wide maintenance has explicit concurrency, while settings changes invalidate only the
  affected provider generation.
- Slow or failed probes no longer remove a usable snapshot. Stale generations cannot publish over
  a newer configuration.

This removes provider-discovery amplification from reconnect bursts without weakening manual
refresh or provider hot reload.

### Orchestration write and projection load

- Events are routed only to relevant projectors instead of visiting every projector.
- Event append, relevant projections, incremental shell-summary changes, and batched projection
  cursor advancement share the orchestration transaction.
- Live events remain unpublished until the transaction commits.
- Thread shell summaries are maintained from the affected event rather than repeatedly rescanning
  complete message, activity, plan, approval, and user-input history.
- Full summary recomputation remains available for rebuild and integrity checks.

The randomized parity and failure-injection coverage verifies that incremental summaries match
full recomputation, replay remains idempotent, rollback is atomic, and failed events are not
published.

### Thread hydration, history, and live delivery

- The additive bounded thread-window protocol loads at most 150 messages, 30 proposed plans,
  150 activities, and 30 checkpoints in current web/runtime subscriptions. Server-owned ceilings
  are 200, 50, 200, and 50 respectively.
- Opaque versioned cursors support older pages and around-message loading. Cursor scope, version,
  and boundary failures return typed recovery errors.
- Page requests coalesce by thread, generation, collection, cursor, and limit. Late results from an
  invalidated generation cannot mutate the current thread.
- Complete history is preserved: unloaded rows stay available through pagination and indexed
  server-side message search.
- Per-thread live streams filter the global committed stream before enqueueing unrelated payloads.
- The legacy full-thread protocol remains as a compatibility fallback.
- Mobile consumes bounded thread detail and no longer rebuilds its full visible thread list every
  second.

Client detail subscriptions now idle-evict after five minutes and are capped at 32 retained
subscriptions or 12 MiB of estimated detail data.

### Queueing, overload, and protocol safety

- Shared queue policies now distinguish lossless backpressure, latest-state coalescing, and bounded
  recoverable streams. Metrics expose capacity, depth, high-water mark, blocked time, coalescing,
  overflow, and recovery.
- Orchestration reactors and provider ingestion use bounded backpressure/coalescing policies rather
  than unbounded accumulation.
- ACP and Codex protocol queues are capped at 256 items, frames are capped at 8 MiB, and overloads
  use typed failures instead of uncontrolled memory growth.
- Terminal process buffering is capped at 2,048 events and 2 MiB of output. The terminal manager
  retains at most 128 inactive sessions.
- Git, VCS, source-control discovery, workspace, and provider-ingestion caches touched by this pass
  have explicit capacities and eviction behavior.

Lossless ordered work backpressures instead of being silently dropped. State-like work coalesces by
key. Recoverable subscriber/session streams fail with an explicit resync or restart path.

### Cache and request lifetime

- Shared keyed queries join duplicate in-flight requests, reject stale completions, index cleanup
  by environment/family, idle-evict after a default five minutes, and cap the registry at 256
  entries by default.
- The web query cache applies the same request joining and stale-result protection, with garbage
  collection and a default 512-entry cap.
- Source-control query controllers are capped at 192 entries. Large detail responses are separately
  capped at 48 entries or 8 MiB and garbage-collected after two idle minutes.
- Project preview and liquid-glass caches now have explicit LRU/item/byte limits.
- Sidebar thread prewarming is limited to the ten useful candidates rather than growing with every
  project row.

### Polling and background work

- A shared poller now runs only while its owning surface is subscribed and the app is foregrounded.
- It uses one completion-scheduled timer, joins overlapping manual/automatic refreshes, cancels
  hidden timers, and refreshes once on foreground/resume/online events.
- Hub, node-security, settings, git branches, source-control detail, and workflow polling use this
  lifecycle. Failure backoff is bounded where repeated failures are expected.
- Closed or unobserved detail surfaces no longer keep independent polling loops alive.
- A five-second idle smoke observation on the pairing route recorded no XHR/fetch traffic and no
  React commits.

### Main-thread rendering and animation

- Liquid-glass displacement-map pixel generation moved to a worker, with bounded caching and a
  cheaper fallback when worker/offscreen support is unavailable.
- Timeline derivation uses an indexed view instead of repeatedly sorting and reconstructing the
  entire history during streaming updates.
- Chat and sidebar store subscriptions were narrowed, closed project dialogs were moved out of
  row render ownership, and dialog state preservation was retained across close/reopen.
- Live orchestration events are prefiltered before reaching detail reducers.
- Status animation work is duty-cycled and honors reduced motion. Optional visual work yields to
  responsiveness.

### Logging and long-running processes

- Provider event logs and trace output use asynchronous rotating writers with byte limits.
- Rotation no longer holds an ever-growing in-memory history, and low-priority trace work cannot
  crowd out required runtime work.
- Shutdown drains accepted work within the existing lifecycle instead of abandoning queued output.

### Startup, bundles, and validation load

- Statistics, diagnostics, pairing, native authorization, and the phone home surface are lazy route
  boundaries.
- The React compiler transforms web React source rather than the complete workspace dependency
  graph.
- Unit-test workers are capped at four locally and two in CI. Browser tests use one worker to avoid
  multiplying the large application module graph and browser memory.
- Bundle tests guard the route boundaries and compiler scope.

The production build completed in 14.44 seconds (15.29 seconds wall clock) and used about 2.78 GiB
maximum resident memory on the measured machine. Babel still accounts for most transform time, but
it processed 528 scoped calls instead of dominating the full workspace graph.

## Live browser observations

The local app was exercised through a real Chromium session with React instrumentation at desktop
and 390 x 844 phone viewports.

| View                  |   TTFB |    FCP |    LCP | CLS |
| --------------------- | -----: | -----: | -----: | --: |
| Desktop pairing route | 6.1 ms | 136 ms | 544 ms |   0 |
| Phone pairing route   |   3 ms |  76 ms | 424 ms |   0 |

There were no page errors. The route kept two expected lazy Suspense boundaries. A five-second idle
render capture observed no React commits and the network capture observed no fetch/XHR polling.

The complete serialized Chromium behavior suite passed 81 files and 731 tests, with one additional
test marked as an expected failure. The suite covers desktop and phone lifecycle, reconnect,
streaming, long-thread, workspace, source-control, modal, responsive-layout, and PWA behavior.

A follow-up external harness now launches the production server and Chromium from outside the app,
measures browser/network/WebSocket and process-tree behavior, and can compare two Git revisions in
isolated worktrees. Its one-iteration smoke run validates the mechanism but is not used as statistical
evidence for the performance claims above. See `docs/performance-testing.md`.

## Validation status

- All topic files are formatted, and lint, TS7/Effect typechecking, the complete repository test
  suite, the repository build, and the explicit web production build pass. Lint retains
  pre-existing repository warnings but reports no errors. The repository-wide format check on the
  final rebased tree reports six files that are byte-for-byte identical to `origin/main`; they were
  intentionally not reformatted in this topic branch.
- Focused tests for the modified server, runtime, polling, queue, cache, projection, hydration,
  bundle, and browser surfaces pass. The complete browser backstop passes as recorded above.

## Residual opportunities

The next work should be measurement-led rather than reopening the runtime architecture:

1. Split `ChatRightPanel` (743.6 KiB raw, 225.6 KiB gzip) and `ThreadWorkspacePanel` (549.0 KiB
   raw, 152.0 KiB gzip) at stable feature boundaries. They are async, so they no longer block the
   bootstrap graph, but remain expensive on first use.
2. Reduce or regenerate the 967 KiB favicon SVG. It dominates static image size even though it is
   not part of the initial JavaScript graph.
3. Load optional font families on selection. Fourteen emitted fonts total 454.6 KiB.
4. Continue isolating syntax-language/theme payloads and the 814.1 KiB editor worker. They are
   already asynchronous; the remaining goal is first-use cost and cache footprint.
5. Profile LegendList convergence under real long-thread data. Browser fixtures still emit bounded
   convergence and zero-height warnings, although the behavior suite passes and the warnings do
   not represent an unbounded retry loop.
6. Run a kept desktop-stage attribution before pruning native/provider dependencies. This pass did
   not make speculative desktop packaging changes without a current platform artifact.
7. Collect sustained slow-consumer/reconnect/provider-burst measurements from the new queue,
   refresh, projection, and snapshot metrics. Structural bounds and deterministic recovery are in
   place; production p95/p99 claims require representative workloads.

## Measurement notes

- Baselines come from the approved design's pre-change local profile.
- The static bootstrap graph follows the HTML module entry, its immediate main import, and all
  static JavaScript imports recursively. It intentionally excludes later dynamic imports.
- Compressed sizes are generated locally with Node's gzip and Brotli implementations.
- Development and local production-build measurements are directional. They should not be treated
  as hosted-service SLOs or cross-machine benchmarks.
