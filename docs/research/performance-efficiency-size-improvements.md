# Performance, Efficiency, And Size Improvement Research

## Executive Summary

The strongest opportunities are in runtime reliability under bursty streaming and reconnect load:
bounded queue/backpressure policy, reduced projection fanout, narrower thread-detail snapshots, and
deprecation of the legacy replay RPC, or making its implicit 1,000-event cap explicit with page
metadata. These are well supported by local code evidence and align with Ryco's priorities:
predictable behavior under load and failures first.

The strongest size opportunities need one measurement pass before implementation. Local evidence
confirms large favicon/icon assets, eager font declarations, broad desktop staging of server runtime
dependencies, and `sharp` as a native dependency used only for avatar processing. This verification
pass found a dev `node_modules` install and a stale v0.1.3 kept mac stage in `$TMPDIR`, but no
current in-worktree `dist`, `dist-electron`, release output, or current kept desktop stage. Current
package and chunk byte savings are therefore not directly measured yet.

Major rewrites such as Tauri, native sidecars, framework replacement, or protocol replacement should
not be next. They may be justified later if packaged measurements prove shell, Node, framework, or
serialization overhead dominates after the incremental fixes.

## Best Options

1. **Bound live queues and define backpressure policy**
   - Expected impact: High reliability improvement under slow clients, reconnect storms, and
     provider/terminal bursts.
   - Risk: Medium.
   - Effort: Medium.
   - Confidence: High.
   - Why it is recommended: `apps/server/src/ws.ts` allocates unbounded live queues per shell/thread
     subscription, and provider/orchestration layers also use unbounded queues or pubsubs. This is a
     direct memory growth and predictability risk.

2. **Reduce projection fanout and thread shell summary rescans**
   - Expected impact: High for long active threads and high event-rate streaming.
   - Risk: Medium.
   - Effort: Medium.
   - Confidence: High.
   - Why it is recommended: every event currently runs 10 projectors sequentially, each with its own
     transaction/state upsert, and hot thread events refresh shell summary by rereading per-thread
     messages, plans, activities, and pending approvals.

3. **Make thread detail snapshots selective or paged**
   - Expected impact: Medium-high for reconnect/resubscribe latency, memory, and first useful render
     on long threads.
   - Risk: Medium.
   - Effort: Medium-high.
   - Confidence: High.
   - Why it is recommended: `subscribeThread` loads full thread detail including all messages,
     plans, activities, checkpoints, latest turn, and session before streaming.

4. **Deprecate legacy `orchestration.replayEvents`**
   - Expected impact: Medium for memory predictability.
   - Risk: Low.
   - Effort: Low-medium.
   - Confidence: High.
   - Why it is recommended: the legacy method still uses `Stream.runCollect`. The underlying event
     store read is implicitly limited to 1,000 events, but the RPC does not return `nextSequence` or
     `hasMore`; `replayEventsPage` already does. No active web caller was found.

5. **Narrow active chat route store subscriptions**
   - Expected impact: Medium renderer CPU reduction during active streams in large environments.
   - Risk: Low.
   - Effort: Low-medium.
   - Confidence: High.
   - Why it is recommended: `ChatThreadRouteView` subscribes to the full environment state and
     iterates all environment thread IDs when that object changes. WeakMap caches mitigate object
     reconstruction, but not the broad subscription and iteration.

6. **Run a kept desktop-stage size audit, then prune runtime dependencies**
   - Expected impact: High measurement value; potentially high packaged-size impact if current
     stage attribution matches the stale stage.
   - Risk: Medium.
   - Effort: Medium.
   - Confidence: High for the need to measure; Medium for savings until stage sizes are known.
   - Why it is recommended: desktop staging merges all server production dependencies plus desktop
     runtime dependencies before `bun install --production`; Copilot wrapper/platform packages are
     explicitly pruned.

7. **Optimize large icon assets and eager font assets**
   - Expected impact: Low-medium packaged/static asset size improvement; browser transfer impact for
     `favicon.svg` is unproven because `index.html` does not link it directly.
   - Risk: Low for icons, Medium for font-loading behavior.
   - Effort: Low-medium.
   - Confidence: High for asset sizes; Medium for browser download impact until a build is measured.
   - Why it is recommended: production favicon SVG is 990,247 bytes, dev/nightly SVGs are about
     2.1 MB each, desktop `icon.icns` is about 1.0 MB, and global CSS declares 14 `@font-face`
     blocks for optional families/weights.

8. **Add bundle analysis and retest chunk/preload choices**
   - Expected impact: Medium for startup and packaged client size if analysis shows large initial
     chunks.
   - Risk: Low-medium.
   - Effort: Low-medium.
   - Confidence: Medium.
   - Why it is recommended: route and feature lazy loading already exists, but no current
     analyzer/gzip/brotli data is available. `modulePreload` is disabled and should be retested
     after current chunk analysis.

## Agent Findings

### Coordinator Findings

Scope covered runtime performance, runtime efficiency/idle behavior, reliability under failure and
load, web bundle size, desktop packaged size, and larger architecture alternatives. The coordinator
used AGENTS.md, package manifests, existing performance docs, desktop build scripts, server/web hot
paths, and package metadata as evidence.

Cross-cutting themes:

- Several older suspected issues appear partly addressed: opt-in perf instrumentation exists,
  sourcemaps are opt-in, saved environments are delayed/concurrency-limited, VS Code icons are lazy
  imported, and previous docs recommend targeted optimization over Tauri migration.
- Remaining high-value work is concentrated around event fanout, snapshot breadth, store
  derivation churn, and packaged dependency attribution.
- Findings were deduplicated by the boundary where cost is created: avoid generating work before
  avoiding sending it; avoid sending work before optimizing rendering.

### Runtime Performance Researcher Findings

1. **Unbounded queues and pubsubs can grow under pressure**
   - Evidence: `apps/server/src/ws.ts:733` and `apps/server/src/ws.ts:788` allocate unbounded live
     queues for replayable shell/thread streams. `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
     uses unbounded command/event queues. Provider runtime paths also use unbounded queues/pubsubs.
   - Affected files: `apps/server/src/ws.ts`, `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`,
     `apps/server/src/provider/Layers/ProviderService.ts`, `apps/server/src/provider/Layers/CodexAdapter.ts`,
     `apps/server/src/provider/Layers/CodexSessionRuntime.ts`.
   - Expected impact: High reliability improvement under slow consumers and bursts.
   - Suggested next step: expose/use existing WebSocket replay depth, high-water, and lag metrics;
     add equivalent metrics plus bounded overflow policies for provider/runtime/reactor queues.

2. **Projection fanout performs avoidable per-event work**
   - Evidence: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1544` lists 10
     projectors; `:1596` wraps each projector in a transaction and updates projection state; `:1649`
     runs every projector sequentially for every event.
   - Affected files: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`.
   - Expected impact: Medium-high during streaming and replay.
   - Suggested next step: instrument per-event projector duration and transaction count, then route
     event types to relevant projectors and batch projection-state writes where safe.

3. **Thread shell summary refresh is O(thread history) on hot events**
   - Evidence: `ProjectionPipeline.ts:568` reloads messages, proposed plans, activities, and
     pending approvals; `:743-:828` triggers this path for message, activity, plan, approval,
     user-input, session, turn-diff-completed, and reverted events.
   - Affected files: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` plus projection
     repositories.
   - Expected impact: High for long active threads.
   - Suggested next step: benchmark with 100, 1,000, and 10,000 message/activity rows; replace
     rescans with incremental latest-user-message, pending-count, and actionable-plan state.

4. **Thread detail snapshots load full history**
   - Evidence: `apps/server/src/ws.ts:2061` calls `getThreadDetailById` for thread subscriptions;
     `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:1757` loads messages,
     proposed plans, activities, checkpoints, latest turn, and session, then decodes a full
     `OrchestrationThread`.
   - Affected files: `apps/server/src/ws.ts`, `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`,
     `apps/web/src/store.ts`.
   - Expected impact: Medium-high for reconnect and long-thread navigation.
   - Suggested next step: measure payload size and duration by thread length; design a latest-window
     snapshot plus paged historical detail.
   - Nuance: client-side retained detail subscriptions are capped and idle-evicted, but each
     attach/reconnect still transfers a full thread snapshot.

5. **Active chat route has a broad store subscription**
   - Evidence: `apps/web/src/components/routeViews/ChatThreadRouteView.tsx:45` selects full
     `EnvironmentState`; `:49` iterates all environment thread IDs and derives thread objects with
     `getThreadFromEnvironmentState`. WeakMap caches mitigate object reconstruction, but not the
     broad subscription and iteration.
   - Affected files: `apps/web/src/components/routeViews/ChatThreadRouteView.tsx`,
     `apps/web/src/threadDerivation.ts`.
   - Expected impact: Medium renderer CPU improvement in large environments.
   - Suggested next step: replace the remaining full environment selector with narrow selectors for
     thread IDs/order, counts, and current-thread navigation inputs; add render counts around this
     route.

6. **Perf payload serialization is not default overhead**
   - Evidence: `apps/web/src/perf/perfInstrumentation.ts:10` and
     `apps/server/src/observability/PerfInstrumentation.ts:10` gate instrumentation behind env
     flags; payload byte estimation returns early when disabled.
   - Expected impact: No default runtime concern.
   - Suggested next step: keep perf profile off for baseline user runs; measure its overhead
     separately when enabled.

### Bundle And Packaged App Size Researcher Findings

1. **Large favicon and icon assets are confirmed**
   - Evidence: `wc -c` reported `apps/web/public/favicon.svg` and
     `assets/prod/favicon/favicon.svg` at 990,247 bytes, `assets/dev/favicon/favicon.svg` at
     2,118,707 bytes, `assets/nightly/favicon/favicon.svg` at 2,138,839 bytes, and
     `apps/desktop/resources/icon.icns` at 1,045,779 bytes.
   - Affected files: `apps/web/public/favicon.svg`, `assets/*/favicon/favicon.svg`,
     `apps/desktop/resources/icon.icns`.
   - Expected impact: Low-medium packaged/static asset size. Browser transfer impact for
     `favicon.svg` is unproven because `apps/web/index.html` currently links PNG/ICO/manifest assets,
     not `/favicon.svg` directly; the boot image is the 37,785-byte `apple-touch-icon.png`.
   - Suggested next step: run SVGO or regenerate simplified SVG/raster favicons and visually diff
     outputs.

2. **Optional font faces are declared eagerly**
   - Evidence: `apps/web/src/index.css:7` through `:129` declares 14 `@font-face` blocks across 9
     named font families; `apps/web/src/themes/appearancePreferences.ts:23` exposes user-selectable
     sans options and `:56` exposes mono options. A stale v0.1.3 stage emitted all 14 WOFF2 files,
     totaling 465,468 bytes raw.
   - Affected files: `apps/web/src/index.css`, `apps/web/src/themes/appearancePreferences.ts`,
     `apps/web/package.json`.
   - Expected impact: Medium for built asset output and first-run cache footprint, pending build
     measurement.
   - Suggested next step: measure emitted font assets; load only defaults initially and lazy-load
     alternate font CSS when selected.

3. **Desktop staging includes broad server runtime dependencies**
   - Evidence: `scripts/build-desktop-artifact.ts:1054` reads server production dependencies;
     `:1212` writes them into the staged package; `:1227` runs `bun install --production`.
     `apps/server/package.json:28` includes provider SDKs, `:37` includes `node-pty`, and `:39`
     includes `sharp`.
   - Affected packages/configs: `apps/server/package.json`, `apps/desktop/package.json`,
     `scripts/build-desktop-artifact.ts`, `bun.lock`.
   - Expected impact: Potentially high packaged size, but actual savings require a kept stage.
   - Suggested next step: build with `RYCO_DESKTOP_KEEP_STAGE=true`, measure staged
     `node_modules` by package, and verify platform optional packages.

4. **Copilot wrapper/platform pruning exists; Claude, node-pty, and Sharp need current stage attribution**
   - Evidence: `scripts/build-desktop-artifact.ts:755` excludes Copilot native package paths and
     `:766` lists externalized Copilot dependency paths; `:868` edits `@github/copilot-sdk/package.json`.
     `bun.lock` includes platform package families for Claude Agent SDK and Sharp/libvips.
   - Expected impact: Unknown, potentially medium-high. A stale v0.1.3 mac stage shows `@anthropic-ai`
     at 223 MB, `node-pty` at 63 MB, `@img`/Sharp/libvips at about 16 MB, and `@github` at 616 KB
     after pruning; a current stage is still required before changing packaging.
   - Suggested next step: inspect a current kept stage before adding pruning; avoid assuming Bun
     installs all optional packages on every platform.

5. **`sharp` is a narrow native dependency**
   - Evidence: only direct import found is `apps/server/src/project/Layers/ProjectAvatarStore.ts:3`,
     with image resize/conversion use at `:31`.
   - Expected impact: Medium if `sharp` and libvips are material in the current stage. They were
     material but not dominant in the stale v0.1.3 mac stage: about 16 MB for `@img`/Sharp/libvips
     versus 223 MB for `@anthropic-ai` and 63 MB for `node-pty`.
   - Suggested next step: measure staged `sharp` size; consider lazy/optional avatar processing,
     platform APIs, or smaller image tooling only if size is material.

6. **`geist` install impact differs between dev install and packaged stage**
   - Evidence: `apps/web/src/index.css:16` references `geist`; `bun.lock` contains `geist` with a
     `next` peer and `next@16.2.6`; `bun pm why next` reports `next -> peer geist -> @ryco/web`.
     The stale v0.1.3 desktop stage did not contain `geist`, `next`, or `@next` runtime packages, but
     did emit the Geist WOFF2 files.
   - Expected impact: Unknown for current packaged output; confirmed dev install footprint.
   - Suggested next step: measure a current production stage and decide whether replacing `geist`
     with direct WOFF2 assets simplifies installs without hurting appearance preferences.

7. **Web chunk claims need build analysis**
   - Evidence: lazy loading exists for route views, settings, command palette, terminal, and VS Code
     icon resolver. `apps/web/vite.config.ts:118` disables `modulePreload`.
   - Expected impact: Unknown until current production build analysis. The stale v0.1.3 staged
     client provides raw context only: 17 MB total, 14,753,216 bytes of JS, 338,888 bytes of CSS, and
     no gzip/brotli/analyzer output.
   - Suggested next step: add a current bundle analyzer run and compare initial JS/CSS/font/image
     assets, gzip/brotli, and modulepreload on/off.

### Architecture And Technology Alternatives Researcher Findings

Incremental options:

- Bound live queues and add explicit overflow/backpressure behavior before changing protocols.
- Prefer `replayEventsPage` and explicit page metadata over the legacy collect replay RPC.
- Make shell and thread snapshots more selective; keep the shell snapshot light and load history
  through paged detail endpoints.
- Continue route/feature chunk splitting, but make it measurement-driven.
- Retest `modulePreload` after chunk splitting.
- Benchmark Effect Schema decode cost on hot persistence reads before introducing trusted internal
  mappers.
- Keep the existing SQLite abstraction, including Bun SQLite under Bun and native `node:sqlite`
  under Node, and tune query/snapshot/index shape before replacing storage.
- Do package-size pruning before considering a desktop shell rewrite.

Larger alternatives:

- Tauri may reduce shell footprint, but it does not solve React render churn, event fanout,
  projection cost, markdown parsing, provider processes, updater/signing, terminal behavior, or
  backend lifecycle.
- Rust/Go sidecars can be justified for narrow process-bound work only if profiling shows Node
  process management, PTY output, git scans, or filesystem watching dominate.
- Protocol/schema replacement is high-risk and should wait until JSON/Effect Schema
  serialization/decode cost is measured as a top bottleneck.
- Splitting orchestration core and provider workers could isolate crashes and bursts, but raises
  IPC, ordering, recovery, and version-compatibility complexity.
- Framework replacement is not justified by current evidence; most current bottlenecks are
  architecture/load-shape issues that would follow the app.

### Verifier Findings

Confirmed:

- Unbounded queues/pubsubs are real and are plausible burst/slow-consumer risks.
- Legacy `orchestration.replayEvents` uses `Stream.runCollect`; its underlying event-store read is
  implicitly limited to 1,000 events, while `replayEventsPage` returns page metadata.
- Projection fanout and shell-summary rescans are directly supported by code.
- Thread detail subscription snapshots load full detail.
- `ChatThreadRouteView` has a broad environment-state subscription; WeakMap caching mitigates object
  reconstruction but not full-environment invalidation and iteration.
- Perf payload byte estimation is opt-in.
- Large favicon/icon byte sizes are confirmed.
- Desktop staging merges server runtime dependencies and prunes Copilot wrapper/platform packages.
- `sharp` is directly used only by project avatar processing.
- Current in-worktree build/release artifacts were absent. A dev `node_modules` install and a stale
  v0.1.3 kept mac stage exist, but neither is a current packaged-size measurement.

Weakened:

- Font claim should be phrased as 14 eager `@font-face` declarations across 9 families, not as 14
  separate font choices. Download impact needs current build/browser confirmation.
- The `favicon.svg` first-load impact is weaker than its byte size because `index.html` does not
  link it directly.
- WebSocket replay queue metrics already exist; remaining gaps are bounds/backpressure and matching
  metrics for provider/runtime/reactor queues.
- Size claims can use the stale v0.1.3 stage only as context, not current packaged-output evidence.

Needs measurement:

- `geist` / `next` current production-stage impact.
- Specific web chunk savings and gzip/brotli sizes.
- Exact current staged `node_modules` and packaged artifact savings.
- Effect Schema decode/serialization as a primary bottleneck.

Rejected:

- No major candidate was fully rejected, but the verifier rejected wording that implied
  `replayEvents` is an active web hot path, that it is uncapped at the event-store layer, or that
  perf payload serialization is default overhead.

## Recommendation Matrix

| Option                                   | Area                             | Impact                           | Effort      | Risk        | Confidence | First step                                                                 |
| ---------------------------------------- | -------------------------------- | -------------------------------- | ----------- | ----------- | ---------- | -------------------------------------------------------------------------- |
| Bound live queues/backpressure           | Runtime reliability              | High                             | Medium      | Medium      | High       | Use existing WS metrics; add provider/reactor metrics and overflow tests   |
| Reduce projection fanout                 | Runtime performance              | Medium-high                      | Medium      | Medium      | High       | Measure projector duration/transaction count by event type                 |
| Incremental thread shell summaries       | Runtime performance              | High                             | Medium      | Medium      | High       | Benchmark `refreshThreadShellSummary` by thread size                       |
| Paged/windowed thread detail snapshots   | Runtime performance/reconnect    | Medium-high                      | Medium-high | Medium      | High       | Measure `subscribeThread` snapshot bytes and latency                       |
| Deprecate legacy replay RPC              | Runtime reliability              | Medium                           | Low-medium  | Low         | High       | Audit non-test clients; route to `replayEventsPage` metadata               |
| Narrow active chat route selectors       | Web render performance           | Medium                           | Low-medium  | Low         | High       | Replace full environment selector and add render counters                  |
| Kept desktop-stage size audit            | Packaged size evidence           | High measurement value           | Low         | Low         | High       | Run `RYCO_DESKTOP_KEEP_STAGE=true` artifact build and `du` staged packages |
| Prune/lazy native/runtime deps           | Packaged size                    | Unknown; potentially medium-high | Medium      | Medium-high | Low-medium | Target Claude, `node-pty`, `sharp`/libvips, and provider SDKs from audit   |
| Optimize favicons/icons                  | Asset size                       | Low-medium                       | Low         | Low         | High       | Run SVGO/regenerate assets and compare visual output                       |
| Lazy alternate fonts                     | Web asset size/startup           | Medium                           | Medium      | Medium      | Medium     | Measure emitted fonts; keep defaults in initial CSS                        |
| Bundle analyzer and modulepreload retest | Web bundle/startup               | Medium                           | Low-medium  | Low-medium  | Medium     | Add analyzer output and compare `modulePreload` on/off                     |
| Trusted decode paths for hot reads       | Runtime CPU                      | Medium if measured               | Medium      | Medium      | Low-medium | First prove Effect Schema decode is material on large event pages          |
| Tauri shell prototype                    | Packaged size/baseline footprint | Unknown; high for shell only     | Very high   | Very high   | Low        | Only after artifact/idle measurements prove shell dominates                |
| Native sidecar for PTY/git/filesystem    | Runtime isolation/perf           | Unknown; medium-high if measured | High        | High        | Low        | Only after profiling isolates process-bound Node bottlenecks               |
| Protocol/schema replacement              | Serialization/CPU/bandwidth      | Unknown                          | Very high   | High        | Low        | Only if serialization/decode is a top measured bottleneck                  |

## Quick Wins

- Use existing WebSocket replay high-water/lag metrics, and add matching metrics for provider and
  reactor queues.
- Audit non-test callers and deprecate legacy `orchestration.replayEvents` in favor of
  `replayEventsPage`.
- Replace the full `EnvironmentState` selector in `ChatThreadRouteView` with narrow selectors while
  preserving existing WeakMap-derived object reuse.
- Run SVGO or regenerate favicon SVGs; the current production SVG is almost 1 MB.
- Add a current bundle-size script/report and a desktop kept-stage `du` report before changing
  packaging.
- Keep perf profile disabled for normal benchmarks; enable it only for targeted rate/byte/duration
  runs.

## Medium-Term Improvements

- Route orchestration events only to relevant projectors, or group projector work safely.
- Replace thread shell summary table rescans with incremental projected counters/state.
- Introduce paged historical thread detail and latest-window snapshots.
- Lazy-load non-default font CSS and verify fallback/appearance behavior.
- Use current kept-stage measurements to decide whether Claude packages, `node-pty`, `sharp`/libvips,
  provider SDKs, or font packages should be optional, lazy, externalized, or replaced.
- Benchmark Effect Schema decode cost and add trusted internal row mappers only where a benchmark
  proves material CPU cost.
- Retest `modulePreload` and chunk boundaries after obtaining production bundle data.

## High-Risk / Rewrite-Level Options

- **Tauri shell:** justified only if packaged idle memory/GPU/energy or artifact size remains a
  product blocker after dependency and asset pruning. It requires parity for updater/signing,
  backend lifecycle, terminal behavior, native menus/windows, and WebView differences.
- **Rust/Go sidecars:** justified for narrow process-bound bottlenecks such as PTY supervision,
  git scans, filesystem watching, or diff indexing after profiling. Avoid broad sidecars without a
  measured target.
- **Provider worker process split:** useful if many provider sessions cause event-loop delay,
  memory pressure, or crash blast radius in the monolithic server. Requires IPC, ordering,
  recovery, and version compatibility design.
- **Protocol/schema replacement:** consider only if JSON/Effect Schema decode or bandwidth is a
  measured top-tier bottleneck after queue and snapshot fixes.
- **Storage replacement:** not justified by current evidence. First exhaust SQLite query/index/snapshot
  tuning and decode benchmarks.
- **Framework replacement:** not justified by current evidence. React/Vite is not the proven root
  cause, and the confirmed bottlenecks are mostly event/load-shape problems.

## Measurement Plan

Startup time:

- Use the existing startup timing hooks and `apps/desktop/scripts/startup-timing-smoke.mjs`.
- Measure packaged desktop cold start from app launch to backend listening, WebSocket connected,
  shell snapshot applied, and window usable.
- Compare dev server and packaged app separately.

Memory:

- Sample the whole process tree, not just the parent app: Electron main/renderer/GPU, server,
  provider children, git/PTY children.
- Record baseline idle, active stream, reconnect storm, terminal burst, and long-thread navigation.

CPU and idle power:

- Run the scenarios from `docs/perf/issue-80-baseline.md` with DevTools closed for packaged runs.
- Capture `RYCO_PERF_PROFILE=1 VITE_RYCO_PERF_PROFILE=1` runs separately from clean user runs.
- Track event-loop delay, provider child lifetime, VCS fetches, renderer commits, and process tree
  CPU/energy.

WebSocket throughput and backpressure:

- Use existing WebSocket replay high-water/lag metrics, and add equivalent metrics to provider
  runtime queues, reactor queues, and orchestration pubsubs where missing.
- Simulate slow WebSocket clients, disconnected/reconnecting clients, and high-output provider or
  terminal streams.
- Measure events/sec, bytes/sec, queue depth, replay lag, dropped/disconnected counts, and memory.

Render performance:

- Use existing labels from `docs/perf/issue-80-baseline.md`: `web.render.ChatView`,
  `web.render.Sidebar`, `web.render.MessagesTimeline`, `web.render.DiffPanel`,
  `web.render.ChatMarkdown`.
- Add focused counters around `ChatThreadRouteView` before narrowing selectors.
- Measure commits/sec and max render duration during long assistant output and large sidebar data.

Bundle size:

- Generate a current production web build and analyzer report with initial and async chunks, CSS,
  fonts, images, gzip, and brotli.
- Compare route chunk boundaries, markdown/diff/terminal/settings chunks, and `modulePreload`
  on/off.
- Track emitted font assets and whether alternate fonts are in the initial CSS/asset set.

Packaged app size:

- Build a current artifact with `RYCO_DESKTOP_KEEP_STAGE=true`.
- Measure staged `apps/server/dist`, bundled web client, desktop resources, `node_modules`, and
  final artifacts.
- Run package-level `du` attribution for provider SDKs, `sharp`/libvips, `node-pty`, Electron,
  font packages, and generated assets.
- Treat the stale v0.1.3 kept stage in `$TMPDIR` as context only; rerun for current HEAD before
  making pruning decisions.
- Compare against the existing `v0.1.2` artifact baselines in
  `docs/perf/issue-92-desktop-shell-decision.md`.

## Appendix

Commands run:

- `sed -n '1,240p' AGENTS.md`
- `git status --short`
- `rg --files -g 'package.json' -g 'vite.config.*' -g 'tsup.config.*' -g 'turbo.json' -g 'tsconfig*.json' -g '!node_modules'`
- `sed -n '1,260p' package.json`
- `sed -n '1,280p' apps/web/package.json`
- `sed -n '1,260p' apps/server/package.json`
- `sed -n '1,260p' apps/desktop/package.json`
- `sed -n '1,260p' apps/web/vite.config.ts`
- `rg -n 'orchestration\\.domainEvent|WebSocket|JSON\\.stringify|JSON\\.parse|replay|backpressure|bufferedAmount' apps/server/src apps/web/src packages/contracts/src packages/shared/src`
- `sed -n '640,860p' apps/server/src/ws.ts`
- `sed -n '1960,2120p' apps/server/src/ws.ts`
- `sed -n '1,320p' apps/web/src/rpc/wsTransport.ts`
- `sed -n '1,620p' apps/web/src/rpc/wsRpcClient.ts`
- `sed -n '1,260p' apps/web/src/store.ts`
- `sed -n '260,780p' apps/web/src/store.ts`
- `sed -n '1,240p' apps/web/src/threadDerivation.ts`
- `sed -n '1,95p' apps/web/src/components/routeViews/ChatThreadRouteView.tsx`
- `sed -n '1,140p' apps/web/src/index.css`
- `sed -n '1,120p' apps/web/src/themes/appearancePreferences.ts`
- `sed -n '1,120p' apps/web/src/perf/perfInstrumentation.ts`
- `sed -n '1,100p' apps/server/src/observability/PerfInstrumentation.ts`
- `sed -n '1,340p' apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `sed -n '1720,1935p' apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `sed -n '520,780p' apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `sed -n '1520,1668p' apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `sed -n '730,780p' scripts/build-desktop-artifact.ts`
- `sed -n '1038,1238p' scripts/build-desktop-artifact.ts`
- `wc -c apps/web/public/favicon.svg apps/web/public/web-app-manifest-512x512.png apps/web/src/vscode-icons-manifest.json apps/web/src/vscode-icons-language-associations.json`
- `wc -c assets/prod/favicon/favicon.svg assets/dev/favicon/favicon.svg assets/nightly/favicon/favicon.svg assets/prod/ryco-macos-1024.png assets/prod/ryco-windows.ico apps/desktop/resources/icon.icns apps/desktop/resources/icon.ico apps/desktop/resources/icon.png`
- `wc -c apps/web/public/apple-touch-icon.png apps/web/public/favicon.svg`
- `rg -n '^@font-face|font-family:' apps/web/src/index.css`
- `rg -n 'favicon|apple-touch|manifest' apps/web/index.html`
- `rg -n '@anthropic-ai/claude-agent-sdk|@anthropic-ai/sdk|@github/copilot-sdk|@opencode-ai/sdk|sharp|node-pty|geist|next@|@img/sharp|@github/copilot' bun.lock apps/*/package.json packages/*/package.json package.json`
- `rg -n 'from "sharp"|import\\("sharp"\\)|require\\("sharp"\\)|sharp\\(' apps packages scripts -g '!node_modules'`
- `find . -maxdepth 3 \\( -name dist -o -name dist-electron -o -name release -o -name out \\) -type d -print`
- `bun pm why next`
- `find "$TMPDIR" -maxdepth 1 -type d -name 'ryco-desktop-*-stage-*' -print`
- `du -sh "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/node_modules" "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/dist/Ryco-0.1.3-arm64.zip"`
- `du -sh "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/node_modules/@anthropic-ai" "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/node_modules/node-pty" "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/node_modules/effect" "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/node_modules/@img" "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/node_modules/sharp" "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/node_modules/@github"`
- `find "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/apps/server/dist/client" -type f -name '*.js' -print0 | xargs -0 wc -c`
- `find "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/apps/server/dist/client" -type f -name '*.woff2' -print0 | xargs -0 wc -c`
- `find "$TMPDIR/ryco-desktop-mac-stage-Cfk72O/app/apps/server/dist/client" -type f -name '*.css' -print0 | xargs -0 wc -c`

Important observations:

- A dev `node_modules` install exists in the worktree after validation/research, but it is not
  packaged-output evidence.
- No current in-worktree `dist`, `dist-electron`, or release artifact was present, so current
  production chunk sizes, installed dependency disk sizes, and final packaged size were not directly
  measured.
- A stale kept mac stage exists at `$TMPDIR/ryco-desktop-mac-stage-Cfk72O`; its staged package is
  v0.1.3 at commit `88a2f5ee0f63`, while current HEAD was `f40db6aa1027`. It is useful context but
  not current output.
- The stale stage measured 429 MB for staged `node_modules`, a 397 MB arm64 zip, `@anthropic-ai` at
  223 MB, `node-pty` at 63 MB, `@img`/Sharp/libvips at about 16 MB, and `@github` at 616 KB after
  pruning.
- The stale staged web client measured 17 MB total, 14,753,216 bytes of JS, 338,888 bytes of CSS,
  465,468 bytes of WOFF2 fonts, and no gzip/brotli/analyzer output.
- Web source did not reference `orchestration.replayEvents`; references found were server
  implementation, contracts, and server tests.
- Existing docs already provide a measurement workflow and older public artifact baselines, but no
  post-optimization packaged artifact measurement was present.

Unresolved questions:

- Which optional native packages survive `bun install --production` in the desktop stage on each
  target platform?
- How much of the initial web payload is CSS/fonts versus JavaScript chunks after production build?
- How large are shell and thread snapshot payloads for real long-running workspaces?
- Is Effect Schema decode a top CPU cost under replay/projection load, or is SQL/query shape the
  dominant cost?
- What overflow behavior is acceptable for each queue: disconnect, drop, coalesce, page, or block?
