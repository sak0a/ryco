# End-to-End Performance and Load Hardening Design

## Summary

Improve Ryco's performance across provider discovery, orchestration persistence,
WebSocket delivery, thread hydration, client state, rendering, background work,
logging, bundles, and test execution. The work follows a compatibility-first,
staged design: remove systemic server amplification before optimizing client
rendering, then add hard memory bounds and reduce startup cost.

The current branch already reduces status-animation frame work through
duty-cycled motion. This design extends that focused improvement into the major
runtime paths identified by profiling and code audit. It preserves complete
thread history through cursor pagination, keeps reconnect and replay semantics
authoritative, and degrades optional visual effects before interaction or
correctness.

The implementation will be split into independently reviewable commits on the
same feature branch. Each stage has focused correctness and performance checks.
The full repository and browser backstops run after all cross-runtime stages are
integrated.

## Goals

- Make reconnect and server-config subscriptions cheap and independent of slow
  provider probes.
- Remove unnecessary transaction, query, and write amplification from the
  orchestration projection hot path.
- Bound initial thread hydration without hiding or discarding older history.
- Prevent unrelated orchestration traffic from filling thread-specific queues.
- Keep provider, terminal, orchestration, logging, and client caches within
  explicit memory bounds under burst and slow-consumer conditions.
- Reduce main-thread long tasks, broad React fanout, timeline recomputation,
  unnecessary animation frames, initial JavaScript, and build-transform cost.
- Make polling subscriber-owned, visibility-aware where appropriate, and
  non-overlapping.
- Make unit and browser validation reliable under realistic workstation load.
- Preserve hosted lifecycle ownership, authorization rules, event ordering,
  terminal recovery, and provider-session correctness.

## Non-goals

- Replacing the event-sourced orchestration architecture.
- Forking lifecycle, authentication, or synchronization logic for mobile.
- Extending or removing the frozen web phone tier.
- Discarding old messages, activities, plans, or checkpoints to obtain bounded
  snapshots.
- Changing provider protocols or provider-visible behavior beyond refresh and
  overload handling.
- Hiding overload by silently dropping lossless events.
- Raising test timeouts globally to mask CPU or memory contention.
- Replacing the current router, virtualized transcript, state library, or build
  system solely for performance.

## User decisions

- Implement the full program in the recommended order: provider refreshes;
  projections, snapshots, and event routing; UI rendering; queue and cache
  bounds; bundle and test-runner work.
- Use a compatibility-first staged approach rather than a single event-system
  rewrite or isolated tactical patches.
- Preserve complete history through lazy cursor pagination. The newest bounded
  window loads first, older pages load automatically when the user approaches
  the top, and unloaded history remains searchable.
- Serve cached provider state immediately and revalidate it in the background.
- Prefer correctness and deterministic recovery over dropping ordered runtime
  data.
- Treat optional visual fidelity as degradable when it competes with input or
  rendering responsiveness.

## Baseline and observed pressure points

The design responds to the following measured or structurally proven costs:

- Every `subscribeServerConfig` subscription currently triggers a full provider
  registry refresh. Managed-provider semaphores serialize refreshes but do not
  coalesce them, so reconnect bursts queue repeated probes. A live run repeatedly
  reached Grok's 15-second ACP discovery timeout.
- Every orchestration event currently visits ten projectors sequentially. Each
  visit opens a transaction and writes a projection cursor even when the event
  is irrelevant. The pipeline itself runs inside the command transaction.
- Thread shell-summary refreshes load and scan all messages, plans, activities,
  and approvals on hot event types.
- Thread detail subscriptions enqueue all global events and apply the thread
  filter after the per-subscription queue.
- Initial thread snapshots load every message, plan, activity, and checkpoint;
  client retention limits are applied after database, encoding, and transfer
  costs have already occurred.
- Provider, protocol, orchestration, shared worker, and some WebSocket delivery
  queues are unbounded.
- Composer liquid-glass generation produced a 215ms main-thread task. Sidebar
  profiling showed broad row and closed-dialog fanout. A 2,000-message timeline
  derivation had a 10.97ms p95 and a 103.7ms maximum in a synthetic run.
- The initial static JavaScript graph measured about 3.02MB raw and 952KB gzip.
  The web build took 65.1 seconds; Babel transforms consumed 60.1 seconds.
- Full test runs are load-sensitive, while the implicated files pass in
  isolation. The browser suite reached roughly 4.5GB combined runner/browser
  RSS and currently has reproducible ChatView failures plus a router optimizer
  import failure.

Development-mode profiles are directional rather than production latency
claims. Acceptance measurements will use repeated runs and report the median
and tail, not a single best result.

## Stage 1: Provider snapshot refresh coordination

### Refresh ownership

Provider instances remain the owners of their snapshots. Add a shared refresh
coordinator to the managed-provider boundary rather than creating refresh logic
inside individual WebSocket handlers or drivers. The coordinator tracks, per
provider instance:

- the last completed snapshot and completion time;
- the currently running refresh, if any;
- the snapshot generation and settings fingerprint;
- the last refresh failure for status and diagnostics;
- whether an explicit invalidation requires revalidation.

Normal snapshot reads never force a probe. They return the current snapshot and
schedule background revalidation only when the configured freshness TTL has
expired. Multiple callers awaiting or scheduling the same stale generation
join one in-flight refresh. A manual provider refresh bypasses the TTL but still
joins an already running refresh for that provider. Registry-wide refresh runs
instances concurrently within an explicit concurrency limit.

Settings changes compare stable driver-specific fingerprints. Only affected
instances invalidate; display-only registry changes must not reprobe unrelated
providers. The existing driver refresh interval remains a maximum-staleness
backstop, not a second independent probe path.

### Subscription behavior

`subscribeServerConfig` emits the cached config and provider snapshot without
waiting for provider discovery. It subscribes to provider status changes and
may request stale revalidation through the coordinator, but it never calls an
unconditional registry refresh. Reconnect bursts therefore produce one cached
read and at most one refresh per stale provider generation.

Refresh failures retain the last good snapshot. Status metadata may expose that
the refresh failed and when the last good snapshot was checked, but a transient
probe failure must not remove models, block a reconnect, or replace a usable
snapshot with an empty one. Disabled providers remain cheap and do not spawn
discovery processes.

## Stage 2: Projection, snapshot, and event-stream efficiency

### One atomic projection transaction

Keep the existing invariant that event persistence and projections commit
atomically. Remove projector-owned nested transactions. The orchestration
engine opens one transaction around event append, relevant projection updates,
incremental shell-summary changes, and projection-cursor advancement.

Each projector definition declares the event types or predicates it handles.
Only matching projectors execute projection logic. The existing per-projector
cursor model is retained for recovery compatibility, but cursor advancement is
written as one batch operation rather than ten independent upserts. Cursors for
nonmatching projectors still advance atomically so replay does not revisit
irrelevant events.

Any append, projection, summary, or cursor failure rolls back the complete
event. No live event is published until commit succeeds. Replay calls the same
routing and transaction-safe projection functions.

### Incremental thread shell summaries

Replace the normal full-history summary refresh with event-specific updates:

- a user-message event updates `latestUserMessageAt` using a monotonic maximum;
- approval creation and settlement adjust the pending-approval count through
  idempotent current-state transitions;
- user-input activity changes update the pending-input count from the affected
  activity state;
- plan changes update actionable-plan state from the affected plan and latest
  turn state;
- unrelated messages and activities do not touch shell-summary fields.

Projection handlers read the previously projected row when transition context
is required. They must remain idempotent under replay. A full recomputation
function remains available for projection rebuilds, integrity repair, and
tests. Diagnostics compare incremental and rebuilt summaries on fixtures.

### Bounded snapshots and history pages

Introduce additive versioned RPCs for bounded thread detail and history pages.
The legacy full-snapshot RPC remains available during client migration. Updated
clients explicitly request the bounded protocol.

The initial response contains:

- the thread shell, session, and latest-turn state;
- the newest bounded message and activity windows;
- current or recent proposed plans required for the active experience;
- checkpoint metadata within a separate small window;
- independent page information for collections that have older rows;
- the snapshot sequence used for replay handoff.

Page cursors are opaque, versioned, and deterministic. Database queries use
immutable ordering fields plus stable-id tie-breakers and matching composite
indexes. Cursor decoding validates the thread, collection, order version, and
boundary. A missing or pruned boundary returns a typed stale-cursor result that
causes a fresh bounded snapshot rather than a silent gap.

The client normalizes rows by stable id, merges pages idempotently, and retains
the existing caps as a final memory guard. Approaching the top requests the next
page and restores the visible anchor after prepend. Concurrent requests for the
same cursor coalesce. A stale response from an older subscription generation
cannot mutate current state.

### Search across unloaded history

Move thread-history search to a server query backed by indexed projection data.
Search results return stable row identity, a short safe snippet, ordering
metadata, and an opaque anchor cursor. Selecting a result fetches a bounded page
around that anchor, merges it, and navigates to the row. Existing loaded-client
highlighting remains presentation-only.

Search is scoped to an authorized environment and thread. It never broadens
filesystem or hosted authorization. Empty and rapidly changing queries use
client debouncing, in-flight cancellation by generation, and a bounded result
limit.

### Filter before per-thread queueing

Retain the global committed-event stream initially, but move the thread and
event-kind predicate into the producer before `Queue.offer`. The replay-boundary
tracker may observe the global sequence watermark without storing unrelated
payloads. Only matching thread-detail events consume queue capacity.

This targeted change removes queue amplification without introducing a second
topic registry. A keyed PubSub can be considered later only if global dispatch
CPU remains material after measurement.

## Stage 3: Main-thread and React work

### Liquid-glass worker and cache

Move displacement-map pixel generation into a dedicated web worker using
`OffscreenCanvas` where supported. The worker returns a blob or transferable
bitmap-derived resource; the main thread only applies the completed map.
Quantize dimensions to a small grid so minor resize changes reuse the same key.
Share a promise-aware, byte-bounded LRU cache across composer and generic glass
surfaces. Revoke object URLs when their cache entry is evicted and no consumer
retains it.

Resize requests are generation-tagged and coalesced. Older results cannot
replace a map for a newer size. The initial composer is interactive before the
map is ready. Unsupported workers, worker failure, or a deadline breach uses a
simple cached non-refractive effect; it must not synchronously run the original
full-resolution loop on the input path.

### Sidebar containment

Extract a memoized project-row boundary with stable primitive props and scoped
selectors. Project-list state changes must not recreate callbacks or aggregate
objects for every row. DnD state is separated so only the active row, current
target, and necessary ancestors update.

Render project explorer, settings, rename, grouping, and new-worktree dialogs
once at sidebar scope. Row actions store a selected project reference and open
the shared dialog; closed dialogs are not mounted per project.

Virtualize the outer project/worktree list using the repository's existing list
technology. Dynamic expanded heights are measured and keyed by stable project
identity. Keyboard navigation, drag handles, selection, context menus, and
expanded-thread state remain accessible when offscreen rows are recycled. For
small lists, virtualization may use the same component with conservative
overscan rather than a separate implementation.

### Incremental timeline view model

Move timeline derivation behind a stateful, DOM-free incremental model in
`packages/client-runtime`. It indexes source rows by stable identity and updates
only affected derived entries for append, replacement, settlement, and bounded
prepend operations. Stable derived entries retain referential identity so the
virtualized list can skip unchanged rows.

Ordering uses stable timestamps and ids. Out-of-order replacement, cursor-page
merge, projection resync, or violated assumptions triggers a full deterministic
rebuild. The full derivation remains the oracle in property and parity tests.
React components consume the derived model and keep presentation-only work
local.

Enable explicit LegendList recycling where row behavior supports it. Fix
bootstrap convergence and zero-height paths rather than suppressing warnings.
Scroll-follow and prepend-anchor behavior get browser coverage.

### Remaining animation work

Apply the existing duty-cycle and reduced-motion helpers to sidebar status
shimmer, file-edit shimmer, and background liveness pulse. Decorative effects
pause when the document is hidden. Active progress remains understandable from
static text and accessible state; animation is never the sole status signal.

## Stage 4: Queue, cache, polling, and logging bounds

### Queue policy classes

Every long-lived queue declares a capacity, overflow policy, and metric. Use
three policy classes:

1. **Lossless/backpressured:** orchestration commands and persisted ordered
   events. Producers wait within the owning lifecycle; shutdown interrupts
   waiting offers cleanly.
2. **Latest-state/coalescing:** provider snapshots, settings, liveness, and
   replaceable status updates. Repeated keys collapse to the newest value.
3. **Bounded/recoverable stream:** provider protocol notifications, terminal
   delivery, and similar streams whose owner can restart or resnapshot.

Provider protocol queues use generous byte- and item-aware bounds. If enqueue
cannot complete within a deadline, terminate and recover the affected provider
session with a typed overload reason. Do not leave stdio parsing blocked
indefinitely or silently drop ordered notifications.

Terminal subscriber queues use a fixed capacity. Overflow terminates only the
slow subscriber stream with a resync reason. Reconnect obtains the terminal
manager's bounded running-session snapshot and buffered output. Git progress
streams follow the same slow-consumer principle where a current snapshot is
available.

Queue metrics include current depth, high-water mark, blocked-offer duration,
coalesced count, overflow count, and recovery count without logging payloads.

### Client cache lifecycle

Implement `gcTime` in the local query client and add subscriber-aware TTL/LRU
eviction to keyed-query registries. Active subscribers and in-flight requests
pin entries. When the final subscriber leaves, the entry becomes eligible for
TTL eviction. Global byte or entry caps evict the least-recent inactive entry.

Eviction cancels poll timers, invalidates fetch generations, removes controller
and known-key bookkeeping, and releases retained payloads. Dynamic search,
diff, job-log, file-preview, and source-control detail keys use tighter caps
than small stable environment keys. Invalidation indexes by environment and
query family so it does not scan every historical key.

Thread-detail subscription caching retains the existing warm behavior but adds
a byte-aware cap alongside count and idle time. Active subscriptions are never
evicted.

### Polling and retries

Keep subscriber-owned polling intervals that are already scoped correctly.
Add foreground awareness to mounted Hub status, PR/workflow detail, branch
picker, and node-security polling. Resume performs one immediate refresh and
then restarts the interval. Poll scheduling occurs after completion, so a slow
request cannot overlap itself.

Forced refresh joins a matching in-flight request unless the caller explicitly
requests cancellation and replacement. Retry remains bounded with exponential
backoff and jitter. Manual UI actions surface their result instead of spawning
hidden parallel retries.

Move the mobile running-turn elapsed clock to a leaf subscription so a one-second
tick updates only visible elapsed text, not the complete timeline model.

### Asynchronous trace sink

Replace synchronous append and rotation on application fibers with a dedicated
bounded writer. Batch records by bytes and time, write asynchronously in order,
and rotate within the writer's serialized ownership. Reserve capacity for
warnings and errors. Under extreme pressure, drop debug/info records first,
increment a dropped-record metric, and emit one rate-limited warning when the
sink recovers. Shutdown performs a bounded flush.

Tracing remains bounded by the existing file-count and file-size policy. No
payload, credential, or private hosted data is added to diagnostics.

## Stage 5: Startup, bundle, and validation tooling

### Route and asset splitting

Use router-supported lazy components for statistics, diagnostics, and other
heavy noninitial screens. Keep route guards and small search parsers in the
eager route module while dynamically loading screen implementations.

Audit Shiki grammar, theme, editor, diff, and workspace-panel imports. Load
language grammars and themes by explicit runtime demand instead of pulling
registries into the initial graph. Preserve predictable loading placeholders
and cache resolved modules.

Use bundle-graph tests to prevent lazy screens and bulk grammar registries from
returning to the initial graph. Measure raw and gzip sizes from a clean build.

### Build transform cost

Profile the Babel/React-compiler inclusion set and exclude generated contracts,
third-party code, workers, and modules that do not contain React components
where safe. Prefer a narrower include rule over parallel tooling paths. Verify
that compiler-required components retain behavior and that development and
production use one React runtime.

### Test-runner reliability

Root-cause the browser optimizer's `useBlocker` export mismatch by inspecting
dependency resolution and generated optimizer metadata. Do not patch around it
with production mocks. Pin or deduplicate router packages if resolution is
inconsistent, then add an import smoke test for the browser configuration.

Cap Vitest workers based on measured memory rather than logical CPU count, and
separate expensive integration groups when package-level parallelism still
causes starvation. Fix shared global state and missing cleanup revealed by
order-dependent assertions. Increase individual timeouts only for tests whose
intended operation is inherently longer than the default under the chosen
worker cap.

Browser tests remain file-sequential where required, but fixtures and mounted
applications must be disposed between cases. LegendList warnings and React
`flushSync` lifecycle warnings are treated as defects, not filtered output.

## Compatibility and rollout

Implement additive contracts before switching consumers:

1. Add cursor schemas, bounded snapshot/page/search RPCs, typed stale-cursor and
   overload errors, and optional freshness diagnostics.
2. Add database indexes and server implementations while retaining legacy RPCs.
3. Update client-runtime normalization, pagination, search, and generation
   guards.
4. Switch web, desktop-shared web, and mobile consumers to bounded hydration.
5. Exercise version-skew tests with old and new client behavior.
6. Remove compatibility code only in a separately approved future cleanup once
   supported clients no longer require it.

Projection changes do not alter persisted event formats. New indexes and any
projection columns use normal forward migrations with restart-safe application.
If incremental summary integrity checks fail, operators can rebuild summaries
from existing projections without losing events.

Each stage is a separate coherent commit or small commit group. A stage does
not proceed while its focused correctness checks are red. Performance changes
include before/after measurements in commit notes or the repository's existing
performance documentation.

## Error handling and recovery invariants

- Cached provider snapshots survive transient refresh failure.
- Stale refresh generations cannot publish after configuration changes.
- Event append, projections, summaries, and cursors either all commit or all
  roll back.
- Live events are published only after persistence commits.
- Pagination never silently skips or duplicates a row; stale cursors resnapshot.
- A page or search response from an old subscription generation is ignored.
- Queue overload is observable and follows the queue's declared recovery policy.
- Lossless events are never silently dropped.
- Slow terminal clients cannot grow server memory without bound.
- Optional glass and animation effects fail closed to a cheaper presentation.
- Cache eviction never removes active or in-flight state.
- Hidden documents do not continue nonessential animation or mounted-panel
  polling at foreground cadence.
- Hosted lifecycle ownership, mutation readiness, and authorization remain
  unchanged.

## Testing strategy

### Provider refresh

- Twenty simultaneous config subscriptions receive an immediate cached
  snapshot and cause at most one probe per stale provider instance.
- Manual refresh bypasses TTL but joins an existing in-flight refresh.
- A settings-generation change prevents the old refresh from publishing.
- Failure retains the last good snapshot and publishes degraded diagnostics.

### Projection and history

- Event-to-projector routing covers every event type and rejects unclassified
  types at test or construction time.
- Transaction instrumentation proves one enclosing transaction per event.
- Failure injection at append, projection, summary, and cursor stages proves
  complete rollback and no live publication.
- Incremental summaries match full recomputation across generated event
  sequences and replay.
- Cursor pagination has no gaps or duplicates with equal timestamps, concurrent
  new events, retry, cancellation, and stale boundaries.
- Search finds unloaded rows and loads a stable page around a selected match.
- Unrelated thread events do not increase another subscription's queue depth.

### Queue, cache, and logging load

- Burst tests fill each queue class and assert backpressure, coalescing, or typed
  recovery as designed.
- Slow provider and terminal consumers remain within fixed item and byte bounds.
- Cache churn returns entry count and retained bytes below budget after TTL.
- Eviction preserves active subscribers and invalidates stale response
  generations.
- Trace overload retains warning/error capacity, records drops, rotates in
  order, and flushes within the shutdown deadline.

### UI and browser

- Composer map generation creates no main-thread task over 50ms and targets a
  p95 below 16ms for main-thread application work.
- Worker failure immediately uses the cheap fallback.
- Sidebar updates rerender only affected rows and mount no closed per-project
  dialogs.
- A 100-project fixture preserves keyboard, drag, expansion, selection, and
  context-menu behavior under virtualization.
- Incremental and full timeline derivations remain identical under randomized
  append, update, prepend, and resync sequences.
- A 2,000-message streaming update targets derivation below 8ms p95.
- Prepending history preserves the visible anchor; live streaming does not
  steal scroll position.
- Reduced motion and hidden-document tests cover all decorative status effects.

### Bundle and tooling

- Bundle tests prove heavy settings/statistics screens and bulk syntax assets
  are absent from the initial graph.
- Repeated clean builds record total output, initial raw/gzip bytes, transform
  time, and peak RSS. Initial compressed JavaScript must fall materially from
  the approximately 952KB baseline.
- Browser router imports pass from a cold optimizer cache.
- The previously failing unit files pass together under the selected worker cap
  and in the full package run.
- The complete browser suite passes without unexpected console warnings.

## Validation sequence

Run focused package checks after each stage. Because the completed change is
large and crosses contracts, server, shared runtime, web, and mobile boundaries,
finish with the full repository backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
```

Also run the web build and browser suite after installing the pinned Chromium
runtime when necessary:

```sh
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Desktop packaging and release smoke checks are required only if implementation
changes their pipelines. The shared web application still receives browser
coverage when consumed through desktop.

## Acceptance criteria

- Provider reconnect bursts do not multiply provider probes or delay cached
  configuration delivery.
- Projection metrics show one event transaction, no irrelevant projector work,
  batched cursor advancement, and no full-history reads on normal summary
  updates.
- Initial thread hydration stays within configured row and byte budgets while
  complete history remains paginatable and searchable.
- Thread live queues contain only relevant events.
- All long-lived queues and dynamic caches have tested item or byte bounds.
- Composer, sidebar, timeline, and animation profiles meet the targets above or
  document a stricter correctness constraint with measured improvement.
- Initial JavaScript and clean-build transform cost improve materially from the
  recorded baseline without moving work into an eager worker or duplicate
  runtime.
- Polling does not overlap itself and pauses nonessential work while hidden.
- Full unit and browser validation is green, including the failures reproduced
  during the baseline audit.
- The worktree remains free of private Hub data, generated profiler artifacts,
  and unrelated edits.

## Recommended implementation order

1. Provider refresh coordinator and reconnect behavior.
2. Projector routing, transaction consolidation, and incremental summaries.
3. Bounded thread contracts, indexes, server pagination/search, client merge,
   and prequeue filtering.
4. Liquid-glass worker/cache, sidebar containment, timeline incrementality, and
   remaining animation duty cycles.
5. Queue policies, cache eviction, visibility-aware polling, and async logging.
6. Route/asset splitting, compiler-scope tuning, and test-runner stabilization.
7. Cross-stage profiling, full backstop, browser validation, and documentation
   of final before/after results.
