# End-to-End Performance and Load Hardening Implementation Plan

**Goal:** Implement the approved compatibility-first performance program across provider refresh, orchestration projection, bounded thread hydration, event delivery, client rendering, queues, caches, polling, logging, bundles, and validation tooling.

**Design spec:** `docs/superpowers/specs/2026-08-11-end-to-end-performance-hardening-design.md`

**Status:** Approved for implementation

**Execution:** Sequential by runtime boundary, with focused tests and a coherent commit at each checkpoint. Do not start a later stage while the current stage's focused checks are red.

## Scope and invariants

- Preserve complete thread history through lazy cursor pagination and server-side search.
- Keep the legacy full-snapshot path available while bounded clients migrate.
- Keep event append, projection, summary updates, and cursor advancement atomic.
- Never publish live orchestration events before persistence commits.
- Never silently drop lossless provider or orchestration events.
- Preserve hosted lifecycle, authorization, relay, mutation-readiness, and service-worker boundaries.
- Keep `packages/contracts` schema-only and `packages/client-runtime` free of DOM and React Native imports.
- Prefer shared runtime logic over parallel web/mobile implementations.
- Degrade optional visual effects before input or rendering responsiveness.
- Add explicit item or byte bounds to every long-lived queue and dynamic cache touched by this work.
- Use the Bun version pinned in `package.json`; invoke tests through `bun run test`, never `bun test`.

## 0. Re-establish the post-rebase baseline

**Files**

- `package.json`
- `bun.lock`
- Existing performance docs under `docs/research/` and `apps/web/src/perf/`

**Work**

- Run `bun install --frozen-lockfile` after the final rebase.
- Record `git status`, `origin/main...HEAD`, Bun version, and current focused baseline failures.
- Preserve the existing status-animation commits and the approved design/plan commits.
- Do not regenerate or commit profiler output, screenshots, Vite caches, or trace files.

**Focused verification**

```sh
bun --version
bun install --frozen-lockfile
git status --short
git rev-list --left-right --count origin/main...HEAD
```

## 1. Coalesce provider refresh and remove reconnect amplification

### 1.1 Add managed-provider refresh state and tests

**Files**

- Update `apps/server/src/provider/makeManagedServerProvider.ts`
- Update `apps/server/src/provider/makeManagedServerProvider.test.ts`
- Update provider snapshot types only if internal freshness metadata requires it

**Work**

- Separate a cheap cached `getSnapshot` from refresh initiation.
- Track the last successful refresh time, settings fingerprint/generation, current in-flight refresh, and last refresh failure per managed provider.
- Add a configurable freshness TTL; default to the driver's existing refresh interval when present and a conservative shared TTL otherwise.
- Join all callers for the same in-flight generation.
- Let manual refresh bypass freshness while still joining a running refresh.
- Prevent a refresh started for an old settings generation from publishing.
- Retain the last good enriched snapshot on refresh failure.
- Keep disabled-provider reads process-free.
- Ensure timer-driven refresh calls the same single-flight coordinator.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/provider/makeManagedServerProvider.test.ts
```

### 1.2 Make registry refresh concurrency explicit

**Files**

- Update `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts`
- Update `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts`
- Update `apps/server/src/provider/Layers/ProviderRegistry.ts` if the service interface needs a cached-revalidate operation

**Work**

- Revalidate affected instances through their managed single-flight boundary.
- Bound registry-wide refresh concurrency.
- Refresh only instances whose configuration generation changed during hot reload.
- Preserve manual single-instance and all-instance maintenance commands.
- Keep status publication debounced and generation-safe.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderInstanceRegistryLive.test.ts
```

### 1.3 Serve config subscriptions from cache

**Files**

- Update `apps/server/src/ws/providerRpc.ts`
- Update `apps/server/src/server.test.ts`
- Update provider RPC-specific tests if extracted

**Work**

- Remove the unconditional `providerRegistry.refresh()` from `subscribeServerConfig`.
- Emit the current config/provider snapshot immediately.
- Request stale background revalidation through the registry without awaiting it.
- Add a burst test with twenty subscriptions and a slow provider probe; assert immediate first snapshots and one probe per stale instance.
- Test refresh failure, reconnect, settings generation change, and manual refresh.
- Add refresh join, skipped-fresh, stale-discard, duration, and failure metrics without provider payloads.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/server.test.ts src/provider/makeManagedServerProvider.test.ts src/provider/Layers/ProviderInstanceRegistryLive.test.ts
bun run --cwd apps/server typecheck
```

**Commit boundary:** `perf(server): coalesce provider snapshot refreshes`

## 2. Remove orchestration projection amplification

### 2.1 Make projector routing explicit

**Files**

- Update `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- Update `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`
- Update projector-name or event-type helpers under `apps/server/src/orchestration/`

**Work**

- Add a handled-event predicate or exhaustive event-type set to every projector definition.
- Assert in tests that every orchestration event is handled by the intended projectors and that new event types require an explicit routing decision.
- Execute projection logic only for matching projectors.
- Preserve per-projector last-applied sequence semantics for replay compatibility.
- Record relevant-projector count and skipped-projector count in existing performance instrumentation.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/orchestration/Layers/ProjectionPipeline.test.ts
```

### 2.2 Consolidate transaction and cursor writes

**Files**

- Update `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- Update `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- Update the projection-state repository and tests under `apps/server/src/persistence/`
- Update orchestration replay tests

**Work**

- Remove projector-owned `sql.withTransaction` calls.
- Keep one orchestration-engine transaction around append, projection, summary, and cursor updates.
- Add a projection-state batch upsert for all cursor advances associated with one event.
- Publish committed events only after the transaction succeeds.
- Add failure injection at append, each matching projector, summary, and cursor batch; assert rollback and no publication.
- Add transaction-count instrumentation tests.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/orchestration/Layers/ProjectionPipeline.test.ts src/orchestration/Layers/OrchestrationEngine.test.ts
```

### 2.3 Incrementally maintain thread shell summaries

**Files**

- Add a focused helper such as `apps/server/src/orchestration/threadShellSummaryProjection.ts`
- Add corresponding tests
- Update `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- Update affected projection repositories if atomic transition helpers are needed

**Work**

- Update latest-user-message time monotonically from the affected message.
- Adjust pending approvals from idempotent status transitions.
- Update pending user-input count from affected activity transitions.
- Update actionable-plan state from the affected plan and latest-turn context.
- Avoid reading complete message, plan, activity, or approval collections on normal events.
- Retain full recomputation as a named repair/rebuild operation.
- Generate randomized event histories and assert incremental summaries equal full recomputation after every prefix and replay.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/orchestration/threadShellSummaryProjection.test.ts src/orchestration/Layers/ProjectionPipeline.test.ts
bun run --cwd apps/server typecheck
```

**Commit boundary:** `perf(server): route and batch orchestration projections`

## 3. Bound thread hydration and live event delivery

### 3.1 Add versioned bounded-history contracts

**Files**

- Update orchestration schemas under `packages/contracts/src/`
- Update `packages/contracts/src/rpc.ts`
- Update `packages/contracts/src/rpc.test.ts`
- Update exports from `packages/contracts/src/index.ts`

**Work**

- Add opaque, versioned thread-history cursor schemas.
- Add bounded snapshot request/response schemas with collection page information and snapshot sequence.
- Add before/around page request modes and typed stale-cursor errors.
- Add thread-history search request/results with safe snippets and anchor cursors.
- Register additive RPC methods; keep the legacy full-detail RPC unchanged.
- Apply strict positive limits and server-owned maximums.
- Cover malformed, cross-thread, unsupported-version, and oversized requests.

**Focused verification**

```sh
bun run --cwd packages/contracts test -- src/rpc.test.ts
bun run --cwd packages/contracts typecheck
```

**Commit boundary:** `feat(history): add bounded thread history contracts`

### 3.2 Add projection indexes and page queries

**Files**

- Add a forward database migration under the server persistence migrations
- Update projection repositories and query services
- Update `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- Update `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts`

**Work**

- Add composite indexes matching thread, immutable order, and stable-id tie-break queries for messages, activities, plans, and checkpoints.
- Encode opaque cursors without exposing database paths or implementation details.
- Query newest bounded windows, older pages, and pages around search anchors.
- Fetch checkpoint metadata separately from heavyweight diff payloads.
- Return typed stale-cursor errors for invalid or pruned boundaries.
- Prove no gaps or duplicates across equal timestamps, concurrent newer events, page retry, and resnapshot.
- Add row-count, encoded-byte, query-count, and duration metrics.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/orchestration/Layers/ProjectionSnapshotQuery.test.ts
```

### 3.3 Add authorized search and RPC handlers

**Files**

- Update `apps/server/src/ws/orchestrationRpc.ts`
- Update orchestration RPC/server tests
- Update access-policy tables if new method names require registration

**Work**

- Implement bounded snapshot, page, and search handlers through the existing environment/thread authorization boundary.
- Return safe snippets only; do not expose provider payloads or filesystem content.
- Preserve owner/viewer policy consistent with existing thread reads.
- Add cancellation and request-generation coverage.
- Keep the legacy full-detail handler for old clients.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/server.test.ts src/orchestration/Layers/ProjectionSnapshotQuery.test.ts
```

### 3.4 Merge pages in client-runtime

**Files**

- Update `packages/client-runtime/src/rpc/wsRpcClient.ts`
- Update `packages/client-runtime/src/state/threads/store.ts`
- Add a DOM-free pagination/controller module and tests
- Update `packages/client-runtime/src/connection/supervision.ts`

**Work**

- Request bounded detail for capable clients and retain a version-skew fallback.
- Normalize and merge pages idempotently by stable id.
- Track oldest loaded boundary, has-more state, in-flight cursor, retry state, and subscription generation.
- Coalesce identical cursor requests and ignore stale-generation responses.
- Keep active rows pinned while applying byte-aware final retention caps.
- Add server-search state and load-around-anchor behavior.
- Keep this package platform-neutral.

**Focused verification**

```sh
bun run --cwd packages/client-runtime test -- src/state/threads/store.test.ts
bun run --cwd packages/client-runtime typecheck
```

### 3.5 Integrate web and mobile history UX

**Files**

- Update `apps/web/src/components/chat/MessagesTimeline.tsx`
- Update ChatView and message-search integration
- Update focused web unit/browser tests
- Update `apps/mobile` thread-detail state/screens using shared runtime pagination

**Work**

- Fetch older history near the top, preserve the visible anchor, expose retry without clearing loaded rows, and prevent duplicate requests.
- Move unloaded-history search to the server while retaining loaded-row highlighting.
- Load around selected search results and navigate after the row is materialized.
- Preserve live-follow and minimap behavior.
- Provide equivalent native loading/retry behavior without forking pagination policy.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/components/chat/MessagesTimeline.test.tsx src/components/chat/MessagesTimeline.logic.test.ts
bun run --cwd apps/mobile test -- src/state/threadTimeline.test.ts
```

### 3.6 Filter before thread queues

**Files**

- Update `apps/server/src/ws/context/orchestrationStreams.ts`
- Update orchestration stream/replay tests

**Work**

- Apply thread id, aggregate kind, and detail-event filtering before offering to the per-thread live queue.
- Let replay-boundary tracking observe the global sequence watermark without retaining unrelated payloads.
- Preserve overflow/resnapshot behavior for relevant traffic.
- Add multi-thread burst tests proving unrelated traffic does not change queue depth or trigger overflow.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/ws/context/orchestrationStreams.test.ts
bun run --cwd apps/server typecheck
```

**Commit boundary:** `perf(history): page thread detail and prefilter live events`

## 4. Remove main-thread and React amplification

### 4.1 Offload and cache liquid-glass maps

**Files**

- Add `apps/web/src/workers/liquidGlass.worker.ts`
- Add a shared client such as `apps/web/src/lib/liquidGlassMapCache.ts`
- Update `apps/web/src/lib/liquidGlass.ts`
- Update `apps/web/src/components/chat/ComposerLiquidGlass.tsx`
- Add worker/cache tests and browser coverage

**Work**

- Move pixel generation to `OffscreenCanvas` in a dedicated worker.
- Quantize dimensions and share promise-aware, byte-bounded LRU entries.
- Tag requests by generation and ignore stale resize results.
- Revoke object URLs only after eviction and final consumer release.
- Make the composer interactive before the map resolves.
- Use a cheap non-refractive fallback on unsupported worker, timeout, or failure.
- Instrument request, worker, apply, cache-hit, fallback, and main-thread duration.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/lib/liquidGlassMapCache.test.ts
bun run --cwd apps/web test:browser -- src/components/ChatView.browser.tsx -t "liquid glass"
```

### 4.2 Contain and virtualize the sidebar

**Files**

- Update `apps/web/src/components/Sidebar.tsx`
- Update `apps/web/src/components/sidebar/SidebarProjectItem.tsx`
- Add shared sidebar-dialog ownership
- Update sidebar selectors, logic tests, and browser tests

**Work**

- Introduce memoized project-row boundaries with stable primitive props and scoped subscriptions.
- Separate DnD state so only active/target rows update.
- Hoist explorer, settings, rename, grouping, and new-worktree dialogs to one sidebar owner.
- Virtualize the outer list with stable keys, dynamic measurement, and conservative overscan.
- Preserve keyboard navigation, selection, drag/drop, context menus, expansion, and accessible labels.
- Add render-count instrumentation tests for 100 projects.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/components/Sidebar.logic.test.ts src/components/sidebar/hooks/useSidebarTree.test.ts
bun run --cwd apps/web test:browser -- src/components/ChatView.browser.tsx -t "sidebar"
```

### 4.3 Incrementally derive timeline rows

**Files**

- Add a client-runtime timeline index/model with tests
- Update `packages/client-runtime/src/state/session/session-logic.ts`
- Update `apps/web/src/components/ChatView.tsx`
- Update `apps/web/src/components/chat/MessagesTimeline.logic.ts`
- Update browser and parity tests

**Work**

- Index sources and derived entries by stable id.
- Incrementally handle append, replacement, settlement, bounded prepend, and deletion.
- Preserve referential identity for unchanged derived rows.
- Fall back to the full deterministic derivation on resync or ordering violation.
- Property-test incremental results against the full oracle.
- Enable explicit list recycling where row cleanup supports it.
- Fix bootstrap convergence and zero-height warnings at their source.

**Focused verification**

```sh
bun run --cwd packages/client-runtime test -- src/state/session/session-logic.test.ts
bun run --cwd apps/web test -- src/components/chat/MessagesTimeline.logic.test.ts src/components/chat/MessagesTimeline.test.tsx
bun run --cwd apps/web test:browser -- src/components/ChatView.browser.tsx
```

### 4.4 Finish motion throttling

**Files**

- Update `apps/web/src/index.css`
- Update status/file-edit/sidebar components as needed
- Update `apps/web/src/perf/statusAnimations.test.ts`
- Update reduced-motion browser coverage

**Work**

- Apply shared duty-cycle utilities to sidebar shimmer, file-edit shimmer, and background liveness pulse.
- Pause decorative animation while hidden.
- Preserve static, accessible status meaning.
- Measure idle frame requests with normal and reduced motion.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/perf/statusAnimations.test.ts src/lib/perf/motion.test.ts
```

**Commit boundary:** `perf(web): remove renderer hot paths`

## 5. Bound queues, caches, polling, and trace persistence

### 5.1 Introduce shared queue policies

**Files**

- Update or replace `packages/shared/src/DrainableWorker.ts`
- Update `packages/shared/src/KeyedCoalescingWorker.ts`
- Add shared bounded queue policy helpers and tests
- Update server queue metrics

**Work**

- Define lossless/backpressured, latest-state/coalescing, and bounded/recoverable queue constructors.
- Require capacity, component name, and overflow/recovery behavior at construction.
- Record depth, high-water mark, blocked duration, coalesced count, overflow, and recovery.
- Preserve drain/shutdown correctness.

**Focused verification**

```sh
bun run --cwd packages/shared test -- src/DrainableWorker.test.ts src/KeyedCoalescingWorker.test.ts
bun run --cwd packages/shared typecheck
```

### 5.2 Apply policies to orchestration and providers

**Files**

- Update `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- Update ingestion/reactor workers
- Update provider adapters/session runtimes
- Update `packages/effect-acp` and `packages/effect-codex-app-server` protocol queues
- Update focused load and lifecycle tests

**Work**

- Bound orchestration command and internal worker queues with backpressure.
- Coalesce replaceable provider status/snapshot work.
- Apply item- and byte-aware bounds to provider protocol notifications.
- Add an enqueue deadline and typed overload shutdown for affected provider sessions.
- Ensure protocol responses cannot deadlock behind slow notification consumers.
- Test burst, shutdown while blocked, restart, ordering, and no silent loss.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/orchestration/Layers/OrchestrationEngine.test.ts
bun run --cwd packages/effect-acp test
bun run --cwd packages/effect-codex-app-server test
```

### 5.3 Bound terminal and progress subscribers

**Files**

- Update `apps/server/src/ws/terminalRpc.ts`
- Update `apps/server/src/ws/gitRpc.ts`
- Update terminal manager/RPC tests

**Work**

- Replace default unbounded callback queues with explicit bounded streams.
- On slow-consumer overflow, end only that subscriber with a typed resync reason.
- Confirm reconnect receives running-session snapshots and bounded buffered output.
- Use current-snapshot recovery for replaceable Git progress state.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/terminal src/ws
```

### 5.4 Implement cache GC and indexed invalidation

**Files**

- Update `packages/client-runtime/src/rpc/keyedQuery.ts`
- Update keyed query tests
- Update `apps/web/src/rpc/queryClient.ts`
- Update `apps/web/src/rpc/sourceControlAtoms.ts`
- Update connection supervision tests

**Work**

- Implement `gcTime` and subscriber-aware TTL/LRU eviction.
- Pin active and in-flight entries.
- Cancel timers, bump fetch generations, remove controller/known-key state, and release payloads on eviction.
- Add tighter budgets for search, diff, logs, preview files, and source-control details.
- Index invalidation by environment and query family.
- Add byte-aware limits to warm thread-detail subscription retention.

**Focused verification**

```sh
bun run --cwd packages/client-runtime test
bun run --cwd apps/web test -- src/rpc/sourceControlAtoms.test.ts src/environments/runtime/service.threadSubscriptions.test.ts
```

### 5.5 Make remaining polling visibility-aware and non-overlapping

**Files**

- Update Hub, node-security, PR/workflow, and branch-picker polling owners
- Reuse `apps/web/src/platform/appLifecycle.ts` or a shared DOM adapter
- Update mobile elapsed-time presentation
- Add timer/visibility tests

**Work**

- Pause nonessential polling while hidden and refresh once on foreground resume.
- Schedule the next poll after completion.
- Join matching forced refreshes; explicitly cancel-and-replace only when requested.
- Keep bounded exponential retry with jitter.
- Move the mobile one-second elapsed clock to a leaf update path.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/rpc/gitAtoms.test.ts src/components/settings/NodeSecuritySettings.logic.test.ts
bun run --cwd apps/mobile test -- src/state/threadTimeline.test.ts
```

### 5.6 Make rotating trace writes asynchronous

**Files**

- Update `packages/shared/src/logging.ts`
- Update `apps/server/src/observability/TraceSink.ts`
- Update corresponding tests

**Work**

- Give one bounded async writer ownership of batching, append, rotation, retry, and close.
- Reserve capacity for warning/error records and drop debug/info first under pressure.
- Record dropped counts and emit one rate-limited recovery warning.
- Preserve file size/count limits and bounded shutdown flush.
- Remove synchronous filesystem work from normal application fibers.

**Focused verification**

```sh
bun run --cwd packages/shared test
bun run --cwd apps/server test -- src/observability/TraceSink.test.ts
```

**Commit boundary:** `perf(runtime): bound background work and caches`

## 6. Reduce startup cost and stabilize validation

### 6.1 Lazy-load routes and syntax assets

**Files**

- Update `apps/web/src/routes/statistics.tsx`
- Update `apps/web/src/routes/_settings.diagnostics.tsx`
- Update other heavy route modules identified by the bundle graph
- Update Shiki/editor loading helpers
- Update `apps/web/src/perf/webBundleSplitting.test.ts`

**Work**

- Keep route guards and small search parsers eager; dynamically load screen bodies.
- Load syntax grammars/themes by explicit runtime demand.
- Cache module promises and retain predictable loading/error UI.
- Assert heavy screens and bulk grammar registries are absent from the initial graph.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/perf/webBundleSplitting.test.ts
bun run build --filter=@ryco/web
```

### 6.2 Narrow Babel/React compiler work

**Files**

- Update `apps/web/vite.config.ts`
- Update Vite configuration tests
- Update build measurement documentation

**Work**

- Profile transform inclusion.
- Exclude generated contracts, workers, third-party modules, and verified non-React modules from React compiler transforms.
- Preserve compiler coverage for React components/hooks that depend on it.
- Compare repeated clean-build medians, initial graph bytes, and peak RSS.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/viteConfig.test.ts src/perf/webBundleSplitting.test.ts
bun run build --filter=@ryco/web
```

### 6.3 Fix browser optimizer and test load behavior

**Files**

- Update workspace dependency declarations or lockfile only if resolution proves inconsistent
- Update `apps/web/vitest.config.ts` and `apps/web/vitest.browser.config.ts`
- Update failing test fixtures/cleanup
- Add browser dependency import smoke coverage

**Work**

- Reproduce the cold-cache `useBlocker` optimizer failure and identify the mismatched package/resolution edge.
- Deduplicate or pin router packages if necessary; do not production-mock the missing export.
- Cap Vitest workers using measured per-worker memory.
- Isolate genuinely expensive integration groups where package worker caps are insufficient.
- Remove shared global-state leakage and dispose mounted apps/timers/transports between tests.
- Fix ChatView geometry/stash failures and LegendList/`flushSync` warnings.
- Increase only focused timeouts whose intended operation remains inherently long after contention is removed.

**Focused verification**

```sh
bun run --cwd apps/web test
bun run --cwd apps/web test:browser
```

**Commit boundary:** `perf(web): split startup work and stabilize validation`

## 7. Cross-stage benchmarks and final validation

### 7.1 Record before/after evidence

**Files**

- Update existing performance research/status documentation
- Add benchmark fixtures or scripts only where repeatable and repository-safe

**Measurements**

- Provider probe count and cached first-snapshot latency for reconnect bursts.
- Transactions, SQL statements, cursor writes, full-history reads, and duration per orchestration event.
- Initial snapshot rows/bytes, page query latency, search latency, and unrelated queue depth.
- Queue/cache high-water marks and retained memory after stress and TTL.
- Composer long tasks, sidebar render counts, timeline p50/p95/max, scroll stability, and idle animation frames.
- Initial raw/gzip JavaScript, total output, web build duration, Babel duration, and peak RSS.
- Unit/browser duration, peak RSS, worker count, failures, and unexpected warnings.

Use repeated runs and report median and tail values. Label development-mode React profiles as directional.

### 7.2 Run the complete backstop

Because the finished program changes contracts, persistence, server runtime, shared client state, web interaction, mobile consumption, and browser behavior, run:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Install the pinned browser runtime first only if it is no longer available:

```sh
bun run --cwd apps/web test:browser:install
```

Run `bun run build:desktop` only if implementation changes desktop pipeline code. Run `bun run release:smoke` only if release workflow code changes.

### 7.3 Final review

- Verify `git diff origin/main...HEAD` contains only topic commits and approved design/plan documentation.
- Verify every touched queue/cache has a declared policy and focused test.
- Verify old and new thread-detail clients remain version-skew compatible.
- Verify no profiler output, screenshots, local traces, generated caches, private Hub data, or unrelated edits are tracked.
- Summarize commits, measured improvements, residual risks, exact validation results, and any explicitly deferred cleanup.
