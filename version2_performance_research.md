# version 2: Ryco Performance Improvement Research — 2026-06-03

## Scope

This document records a project-wide performance review focused on faster load times, predictable behavior under load, load balancing, energy efficiency, reduced GPU/render work, and related reliability improvements.

Research covered:

- `apps/web`: React/Vite load path, route splitting, bundle shape, React render churn, timeline/markdown/terminal/sidebar cost, CSS/font/GPU work.
- `apps/server`: provider runtime/session lifecycle, orchestration queues, SQLite/event projection hot paths, WebSocket reconnect/replay behavior, load placement.
- `apps/desktop`: Electron startup, backend readiness/restart behavior, shell-environment sync, logging, update timers, GPU/animation behavior.
- External references: Vite build/modulepreload docs, React Compiler docs, MDN `content-visibility`/CSS containment docs, and Electron GPU/background-throttling docs.

The findings below intentionally prioritize improvements that are compatible with Ryco's current architecture: Codex-first provider sessions, server-authoritative orchestration events, React/Vite UI, Electron packaged boot shell, and shared schema-only contracts.

## Executive summary

The strongest opportunities are not micro-optimizations. They are structural load-path and overload-control changes:

1. **Split the initial web JavaScript graph.** The generated route tree eagerly imports route modules, and chat routes synchronously import `ChatView`/right-panel code. This likely increases parse/evaluate time even on non-chat routes. The best first web win is route-level lazy splitting, then lazy settings/command-palette/terminal/sidebar feature islands.
2. **Add explicit backpressure and queue limits on server hot paths.** Multiple queues/PubSubs are unbounded. Under slow SQLite, slow clients, or high provider output, Ryco should prefer explicit overload behavior over memory growth.
3. **Fix desktop backend crash-loop energy behavior.** Desktop restart backoff is calculated, but the attempt counter is reset on process spawn rather than readiness, so early-exit crash loops can retry at the minimum delay indefinitely.
4. **Make WebSocket subscription handoff replayable.** Snapshot-then-live streams can miss events committed between snapshot read and PubSub subscription attachment. Use snapshot sequence cursors plus persisted replay/dedupe.
5. **Reduce high-frequency event payloads and writes.** Provider deltas currently move through queues/logs/orchestration/projection/WebSocket paths with duplicated raw payload data. Coalescing and raw-payload policy can reduce CPU, SQLite writes, network bytes, and client renders.
6. **Reduce GPU/main-thread churn.** Preserve virtualization and streaming plain-text code blocks, but gate auto-animate/DnD/terminal/markdown work and consider `content-visibility`/containment for large offscreen or inactive panels.

## Current strengths worth preserving

- The root route already lazy-loads `RootAppShell` after root auth/static handling, reducing pre-auth shell cost (`apps/web/src/routes/__root.tsx`).
- Root `beforeLoad` caches successful ready contexts to avoid repeated auth/setup work (`apps/web/src/routes/__root.tsx`).
- Heavy diff and preview panels are already lazy-loaded from `ChatRightPanel` (`apps/web/src/components/ChatRightPanel.tsx`).
- `MessagesTimeline` uses `LegendList`, stable row keys/render functions, and row structural sharing (`apps/web/src/components/chat/MessagesTimeline.tsx`).
- Streaming markdown deliberately avoids Shiki highlighting while the message is still streaming (`apps/web/src/components/ChatMarkdown.tsx`).
- Desktop packaged startup already shows a lightweight boot page before backend readiness and keeps Electron `backgroundThrottling: true` (`apps/desktop/src/main.ts`).
- Auto-updates are delayed and do not auto-download/install, which is already energy-conscious (`apps/desktop/src/main.ts`, `apps/desktop/src/updateState.ts`).

## Priority 1 — Web initial-load and bundle splitting

### 1.1 Route modules are eager; split chat route components lazily

**Evidence**

- `routeTree.gen.ts` is generated and imports route modules up front.
- Chat thread/draft route files synchronously import `ChatView`, `ChatRightPanel`, and route-layout dependencies.
- `ChatView` imports a very broad feature set: terminal drawer, composer, dialogs, worktree dialogs, timeline, branch toolbar, provider banners, source-control discovery, server config, etc.

**Why it matters**

Even lightweight routes like pairing/auth can pay parse/evaluate cost for the chat route graph if the route tree imports modules that import chat UI synchronously. This harms cold load and Electron boot-to-interactive time.

**Recommended design**

- Convert heavy route components to TanStack Router lazy route modules or `lazy()` components.
- Keep route guards, search validation, redirects, and other cheap route metadata in the eager route file.
- Move `ChatView`, `ChatRightPanel`, and route rendering code to lazy route modules.
- Validate that `beforeLoad`, `validateSearch`, `retainSearchParams`, and auth redirects continue to run before lazy component loading.

**Expected benefit**

- Lower initial JS parse/evaluate time.
- Faster `/pair` and hosted-static startup.
- Smaller authenticated shell startup until a chat route is actually rendered.

**Compatibility**: Medium risk / high payoff. It follows the router's intended splitting model, but generated route conventions must be respected.

### 1.2 Split `RootAppShell` into eager coordinators plus lazy UI islands

**Evidence**

`RootAppShell` is lazy-loaded, which is good. Once loaded, however, it imports and renders the command palette, sidebar layout, SSH password dialog, provider update notification, WebSocket connection surfaces, toast provider, environment bootstraps, and orchestration side-effect components.

**Recommended design**

Keep eagerly mounted:

- Environment/runtime bootstrap coordinators that must subscribe immediately.
- Minimal global hotkey listeners.
- Minimal app layout frame.

Lazy-load:

- Settings dialog body.
- SSH password prompt body.
- Provider update notification details.
- Command palette dialog body and heavy search/result rendering.
- Rarely opened source-control/project explorer panels.

**Compatibility**: Low-to-medium risk. Preserve global listeners and stores; lazy-load only dialog/panel bodies.

### 1.3 Lazy-load settings dialog and individual settings panels

**Evidence**

`AppSidebarLayout` imports and always mounts `SettingsDialog`; `SettingsDialog` imports all major settings panels whether or not settings are opened.

**Recommended design**

- Replace eager `SettingsDialog` import with `lazy(() => import(...))`, or
- Keep an eager dialog frame and lazy-load the selected section panel.

The second option has better ongoing interaction performance because Appearance/Providers/MCP/Connections/Source Control can become independent chunks.

**Compatibility**: Low risk. Preserve `useSettingsDialogStore` state and show a small skeleton while loading.

### 1.4 Split command palette hotkeys from command palette UI/search

**Evidence**

`RootAppShell` wraps the app in `CommandPalette`. The component gates expensive body rendering while closed, but the large module and its dependencies remain in the shell chunk.

**Recommended design**

- `CommandPaletteHotkeyProvider` eager: global keydown, store open/close, composer handle lookup.
- `LazyCommandPaletteDialog` lazy: project/thread subscriptions, search indexing/filtering, result rendering, browse mode.

**Compatibility**: Low-to-medium risk. Confirm prompt insertion still has access to `ComposerHandleContext` after lazy loading.

### 1.5 Extract sidebar DnD and large optional sidebar branches

**Evidence**

`Sidebar.tsx` is large and eagerly imports DnD, auto-animate, router/query/store, many icons, and all sidebar feature branches. The manual sorting branch mounts `DndContext`/`SortableContext` only when manual sorting is enabled, but the libraries are still imported with the sidebar module.

**Recommended design**

- Extract manual sorting into `SortableProjectList` loaded only when manual project sorting is active.
- Split provider/worktree sections and context menus into smaller components.
- Keep the minimal sidebar tree and selection behavior eager.
- Add threshold-based animation disablement for very large thread/project lists.

**Compatibility**: Medium risk / high payoff. Sidebar behavior is core UX, so split incrementally and use existing sidebar tests.

### 1.6 Lazy-load terminal view and xterm CSS after first terminal open

**Evidence**

The app globally imports xterm CSS in `main.tsx`, `ChatView` imports `ThreadTerminalDrawer`, and `ThreadTerminalDrawer` imports `@xterm/addon-fit`/`@xterm/xterm` eagerly.

**Recommended design**

- Keep terminal store and event buffering eager.
- Lazy-load only the xterm React view on first open.
- Move xterm CSS into the lazy terminal module if Vite CSS splitting works correctly in both browser and Electron builds.
- Use a lightweight fallback while the terminal module loads.

**Compatibility**: Medium risk. Validate persistent hidden terminals, event replay, focus behavior, and terminal hotkeys.

### 1.7 Re-evaluate `build.modulePreload: false` after introducing lazy chunks

**Evidence**

Vite config sets `modulePreload: false`. Vite docs describe module preload as a build feature that helps preload dependency chunks for module graphs. With more lazy chunks, disabling this may create request waterfalls.

**Recommended design**

- Add bundle analysis first.
- Test browser and Electron packaged startup with `modulePreload` enabled.
- If Electron file-backed boot motivated disabling modulepreload, use environment-specific build config instead of disabling it for every target.

**Compatibility**: Medium risk. Browser deployments likely benefit; Electron packaged loading needs validation.

### 1.8 Add bundle-size and startup-trace gates

**Recommended design**

- Add an opt-in bundle analyzer script for `apps/web`.
- Track initial JS/CSS bytes, largest chunks, route chunks, markdown/diff/xterm/dnd-kit chunk sizes.
- Use existing web startup instrumentation to compare before/after route splitting.

**Compatibility**: Low risk. Analysis tooling should not affect runtime behavior.

## Priority 2 — Web render, GPU, and energy efficiency

### 2.1 Keep timeline virtualization; optimize markdown as the next hotspot

**Evidence**

`MessagesTimeline` already uses virtualization and stable row derivation. `ChatMarkdown` still eagerly imports `react-markdown`, `remark-gfm`, and highlighter integration; streaming code blocks are plain text, but finalized markdown parsing/highlighting can still be expensive.

**Recommended design**

- Lazy-load markdown rendering for non-streaming assistant messages, with a plain-text or skeleton fallback on first paint.
- Keep streaming code blocks plain text.
- Profile long visible messages and code-heavy chats before replacing markdown libraries.
- Consider a fast path for simple messages with no markdown syntax, links, or code fences.

**Compatibility**: Medium risk. Preserve file links, skill rendering, code copy, code highlighting, and sanitization expectations.

### 2.2 Apply CSS containment/content visibility carefully

External research: MDN documents `content-visibility` as allowing the browser to skip rendering offscreen content and recommends pairing it with intrinsic sizing/containment for layout stability.

**Recommended candidates**

- Inactive right-panel sheet content.
- Large settings panels not currently selected.
- Large project/source-control explorer panels.
- Non-visible sidebar subsections if they have stable dimensions.

**Avoid**

- Virtualized timeline rows unless tested carefully; virtualization libraries already manage visibility and may rely on measured sizes.
- Live terminal viewport internals; xterm has its own layout assumptions.

**Compatibility**: Low-to-medium risk. Best applied to isolated panels, not measurement-sensitive virtual lists.

### 2.3 Disable or degrade auto-animate under load

**Evidence**

Sidebar attaches `autoAnimate` controllers to list nodes. Under large thread/project counts, list reordering or reconnect snapshots can generate layout/paint/composite work.

**Recommended design**

- Disable auto-animate above a configurable item threshold.
- Disable during initial shell snapshot application, reconnect recovery, or bulk sidebar updates.
- Respect `prefers-reduced-motion` explicitly if the library option does not already do so.
- Keep transform/opacity animations for small fixed UI only.

**Compatibility**: Low risk. Data behavior is unchanged; only animation is reduced in heavy contexts.

### 2.4 Reduce font critical path

**Evidence**

`index.css` declares many font faces globally. `font-display: swap` helps, but the CSS still contains many declarations and alternate font assets can load when selected.

**Recommended design**

- Keep only default UI font and default mono font in critical CSS.
- Put alternate fonts in secondary CSS chunks loaded when appearance settings select them.
- Use system fonts for the boot shell and app loading states unless branding requires custom fonts.

**Compatibility**: Low-to-medium risk. Appearance settings must continue to work; lazy font loading may introduce a one-time font swap when changing preferences.

## Priority 3 — Server backpressure, load balancing, and event hot paths

### 3.1 Replace unbounded queues/PubSubs with bounded policies

**Evidence**

Several server hot paths use unbounded queues/PubSubs: Codex runtime events, Codex adapter runtime queue, ProviderService runtime PubSub, OrchestrationEngine command queue/event PubSub, startup command gate, and shared drainable/coalescing workers.

**Why it matters**

Under slow SQLite, slow WebSocket clients, high provider output, or a stalled provider child, unbounded queues convert throughput problems into memory-growth problems.

**Recommended design**

Create shared bounded worker primitives in `packages/shared`:

- Bounded queue with depth/high-water metrics.
- Sliding/coalescing queue for progress/delta/telemetry.
- Timeout/reject policy for commands and session lifecycle operations.
- Drop-with-counter policy for best-effort logs/telemetry.

Suggested policy by event type:

| Work type                           | Policy                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| Approvals, interrupts, session stop | High priority, bounded wait, explicit timeout/busy error           |
| Session start/resume                | Semaphore + queue depth metrics                                    |
| Assistant deltas/progress           | Sliding/coalescing bounded queue                                   |
| Logs/telemetry                      | Bounded best-effort queue, drop low-priority records on overload   |
| WebSocket per-client streams        | Bounded backlog; disconnect slow consumers after warning threshold |

**Compatibility**: High for metrics/internal queueing; medium if RPCs start returning explicit overload errors. Prefer high default limits initially.

### 3.2 Reduce command volume before adding concurrent orchestration execution

**Evidence**

OrchestrationEngine uses one global worker. Each command appends events, projects them, writes receipts, and publishes events before the next command is processed.

**Recommended design**

- Batch/coalesce assistant deltas before dispatching orchestration commands.
- Add priority lanes without breaking global sequence invariants: high-priority lifecycle/approval commands should not sit behind low-priority content deltas.
- Batch projection work for multiple events produced by one command.
- Avoid aggregate-concurrent command processing until cross-aggregate invariants are audited.

**Compatibility**: Medium. Delta coalescing should preserve final message text and event order semantics.

### 3.3 Split projection into minimal command-read-model projection and async UI projection

**Evidence**

Projection is on the command critical path. Live projection applies projectors serially; bootstrap also replays serially.

**Recommended design**

- Identify fields required for command decision correctness.
- Keep those in a synchronous command read model.
- Move UI/read-model projections async where read-after-write timing can tolerate it.
- If async projection is too large a change, batch all events from one command into one projection transaction per projector.
- Add per-projector latency metrics.

**Compatibility**: Medium. Async UI projection changes timing. Internal projection batching is safer.

### 3.4 Add per-thread/session lifecycle locks and provider startup semaphores

**Evidence**

Codex adapter stores sessions in a plain `Map`, checks/stops/creates/starts/sets sessions without an obvious per-thread lock. Codex session runtime spawns and initializes a new app-server runtime for start/resume.

**Recommended design**

- Add keyed locks around `startSession`, `stopSession`, `sendTurn`, `interruptTurn`, and rollback operations.
- Add per-provider-instance startup semaphore.
- Re-check session state inside locks before mutating session maps.
- Add spawn/init/resume timing spans.

**Compatibility**: High. This should make existing behavior more deterministic.

### 3.5 Consider an opt-in warm provider runtime pool

**Recommended design**

- Pre-spawn initialized provider app-server runtimes per provider instance.
- Assign a warm runtime to `thread/start`/`thread/resume`.
- Recycle or kill after idle timeout.
- Gate behind config until validated with Codex app-server assumptions for cwd/env/CODEX_HOME/session isolation.

**Compatibility**: Medium. Good startup-latency upside, but session isolation must be proven.

### 3.6 Add provider-instance placement/load balancing

**Evidence**

Provider APIs already include `providerInstanceId`, but server-side start validation requires callers to choose an instance. There is no automatic least-loaded/healthy placement policy.

**Recommended design**

Introduce `ProviderPlacementService`:

- Explicit instance ID still wins.
- If omitted, select among eligible provider instances by active sessions, running turns, recent errors, queue depth, and rate-limit/maintenance state.
- Preserve protocol compatibility by making omission opt-in or versioned.

**Compatibility**: Medium. Existing clients remain unchanged if they pass explicit instance IDs.

### 3.7 Slim raw provider payloads on hot live paths

**Evidence**

Codex runtime events include native payloads plus extracted deltas; mapped runtime/orchestration events can carry raw payloads again.

**Recommended design**

- Keep full native payload in native NDJSON logs.
- Send/persist minimal canonical runtime fields for high-frequency delta/progress events.
- Include raw payloads for errors, approvals, lifecycle, and low-frequency debugging events.
- Make slim live stream mode versioned/configurable if any client inspects `raw.payload`.

**Compatibility**: Medium. Safer as an opt-in/protocol-versioned stream mode.

## Priority 4 — WebSocket reconnect/replay correctness and load behavior

### 4.1 Fix snapshot/live handoff gaps

**Evidence**

`subscribeShell`/`subscribeThread` load a snapshot and then attach to a fresh live PubSub stream. Events committed in the handoff window can be missed because live PubSub is not replayable.

**Recommended design**

Use a sequence-cursor handshake:

1. Read snapshot and snapshot sequence.
2. Attach live stream or record live-start sequence.
3. Replay persisted events from snapshot sequence.
4. Merge/dedupe by event sequence.
5. Continue live stream.

**Compatibility**: High. This should only reduce missed events. Dedupe server-side to avoid duplicate client work.

### 4.2 Paginate `replayEvents`

**Evidence**

The WebSocket replay handler collects `readEvents(fromSequenceExclusive)` with no explicit limit, while the event store has a default read limit.

**Recommended design**

- Add `replayEventsPage({ fromSequenceExclusive, limit }) -> { events, nextSequence, hasMore }`.
- Keep existing method for compatibility, or have clients call repeatedly until `hasMore === false`.
- Add metrics for replay page count and max lag.

**Compatibility**: Medium. Additive API is safer than changing the existing method shape.

### 4.3 Protect startup command gate

**Evidence**

Startup gating queues commands while readiness is pending. The queue is unbounded.

**Recommended design**

- Add max pending commands during startup.
- Allow idempotent reads where safe; gate writes.
- Reject/timeout writes after threshold with a typed busy/startup error.
- Surface startup state to clients so the UI can back off instead of retrying aggressively.

**Compatibility**: Medium. Explicit errors beat unbounded memory use.

## Priority 5 — Desktop startup and energy efficiency

### 5.1 Fix backend crash-loop backoff reset

**Evidence**

Desktop calculates exponential restart delay but resets `restartAttempt` on child `spawn`, not on backend readiness. If the backend repeatedly spawns then exits before listening/HTTP readiness, it can retry at the minimum delay indefinitely.

**Recommended design**

- Reset `restartAttempt` only after backend readiness is proven (`listening` or HTTP ready, preferably structured ready).
- Keep immediate first retry behavior for transient failures.
- Add a maximum retry window/visible boot error after sustained failures.

**Compatibility**: Low risk / high energy benefit.

### 5.2 Add structured backend-ready signal

**Evidence**

Desktop races HTTP readiness against a log-fragment detector searching for `Listening on http://`. This is fast but brittle.

**Recommended design**

- Keep HTTP readiness fallback.
- Add a structured readiness line or structured IPC/pipe event from backend startup.
- Include readiness stage: process spawned, HTTP listening, environment/auth endpoint ready, static assets available.
- Use structured readiness for window navigation and for resetting crash-loop backoff.

**Compatibility**: Medium. Additive if HTTP fallback remains.

### 5.3 Make packaged boot window failure/retry state explicit

**Evidence**

Packaged boot page is static. Backend failure/retry state is only in logs.

**Recommended design**

- Send boot/retry state to the boot page via IPC or query params.
- Show retry count and next retry delay after a threshold.
- Stop/pause boot animation after prolonged waiting.
- Keep existing Linux/Wayland reveal fallback; do not regress the `ready-to-show` workaround.

**Compatibility**: Low risk.

### 5.4 Tighten shell-environment cache validation and refresh policy

**Evidence**

Desktop uses a shell-env cache to avoid expensive login-shell startup. Cache hits schedule a refresh later. Cache validation records shell/platform/timestamp but should also validate current shell/user/home context more directly.

**Recommended design**

- Validate cache shell against current shell and user/home context.
- Skip deferred refresh if cache is fresh and no local provider session has been started.
- Trigger refresh lazily before first local provider runtime that needs current shell environment.
- Keep correctness over speed if shell profile changed.

**Compatibility**: Medium-low. More validation can increase cache misses but improves correctness.

### 5.5 Batch noisy desktop/backend logging after early startup

**Evidence**

Packaged desktop logging uses synchronous rotating file writes. Backend stdout/stderr chunks are also synchronously written/scanned.

**Recommended design**

- Keep synchronous writes for early startup headers, fatal errors, and readiness markers.
- After boot, batch backend log chunks in an async bounded buffer.
- Drop/summarize low-priority repeated log lines under overload.
- Preserve crash diagnostics by flushing on fatal paths and app quit.

**Compatibility**: Medium. Logging is observability, but crash-loop diagnostics must remain reliable.

### 5.6 Preserve current Electron energy choices; expose GPU fallback as a setting only if needed

**Evidence**

Desktop supports `RYCO_DESKTOP_DISABLE_GPU=1` and sets `backgroundThrottling: true`. Electron docs confirm `app.disableHardwareAcceleration()` disables hardware acceleration for the current app, and background throttling affects frame drawing behavior.

**Recommended design**

- Keep hardware acceleration enabled by default; disabling GPU can reduce GPU use but often increases CPU/power for complex rendering.
- Keep environment override for driver issues.
- If users report GPU problems, expose a persisted “disable hardware acceleration” setting requiring restart.
- Avoid `powerSaveBlocker` unless a user explicitly needs long-running foreground work to keep the display/system awake.

**Compatibility**: Low risk if default remains unchanged.

## Cross-cutting instrumentation plan

Before large changes, add metrics and traces so improvements can be verified:

| Area             | Metrics                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Web startup      | boot import start/end, root beforeLoad, shell loaded, route chunk loaded, first thread content paint               |
| Bundle           | initial JS/CSS gzip/brotli, largest chunks, lazy route chunks, markdown/xterm/dnd-kit chunks                       |
| React render     | timeline commit duration, markdown parse/highlight duration, sidebar render duration under snapshot/reconnect      |
| Server queues    | depth/high-water/drops/time-in-queue for command, provider, ingestion, logging, startup queues                     |
| Persistence      | event append latency by type, payload bytes, projection latency by projector/event type                            |
| Provider startup | process spawn, protocol initialize, thread start/resume, warm-pool hit/miss                                        |
| WebSocket        | subscription snapshot time, replay lag, replay pages, per-client backlog, disconnects for slow consumers           |
| Desktop          | launch-to-window, shell-cache hit/miss cost, backend spawn-to-ready, retry delay/attempt count, boot fallback time |

## Suggested implementation order

1. **Add measurement and bundle analysis.** This de-risks all later work.
2. **Web semantic splitting:** route lazy components, settings, command palette body, terminal view/CSS.
3. **Low-risk server overload protection:** queue metrics, bounded logging, startup gate cap, provider startup semaphore.
4. **Desktop crash-loop fix:** reset restart attempts on readiness and show boot retry state.
5. **WebSocket handoff/replay correctness:** snapshot sequence replay/dedupe and paginated replay API.
6. **Event hot-path reduction:** slim raw payloads and improve delta batching/coalescing.
7. **Sidebar/markdown deeper refactors:** DnD extraction, auto-animate thresholds, markdown lazy/fast path.
8. **Provider load placement and optional warm pools:** after metrics reveal real startup/load pain.

## Compatibility matrix

| Improvement                          |       Risk | Compatibility notes                                                         |
| ------------------------------------ | ---------: | --------------------------------------------------------------------------- |
| Bundle analyzer/startup metrics      |        Low | No runtime behavior change                                                  |
| Route lazy splitting                 |     Medium | Preserve eager guards/search validation; follow generated route conventions |
| Settings/command palette lazy bodies | Low-medium | Keep stores and hotkeys eager                                               |
| Lazy xterm view/CSS                  |     Medium | Validate terminal buffering/focus/persistence                               |
| Sidebar DnD extraction               |     Medium | Existing manual sorting branch gives a clear split point                    |
| Auto-animate thresholds              |        Low | Changes only animation under load/reduced motion                            |
| Bounded queue metrics                |        Low | Internal only                                                               |
| Queue rejection/overload errors      |     Medium | Behavior change; use high defaults and typed errors                         |
| Per-thread provider locks            |        Low | Makes lifecycle deterministic                                               |
| Provider warm pool                   |     Medium | Must validate session isolation                                             |
| Provider load placement              |     Medium | Keep explicit `providerInstanceId` as current behavior                      |
| Snapshot/live replay fix             | Low-medium | Server-side dedupe avoids client duplicate work                             |
| Replay pagination                    |     Medium | Additive API preferred                                                      |
| Raw payload slimming                 |     Medium | Version/config gate if clients use `raw.payload`                            |
| Desktop crash-loop backoff fix       |        Low | Resetting on readiness is more correct and more energy efficient            |
| Structured backend readiness         |     Medium | Additive with HTTP fallback                                                 |
| Async/batched desktop logs           |     Medium | Preserve early fatal diagnostics                                            |

## External references used

- Vite build options: module preload is a production build feature; disabling it should be re-tested after adding lazy chunks. <https://vite.dev/config/build-options.html>
- React Compiler docs: automatic memoization helps update performance but does not replace architectural code splitting or targeted profiling. <https://react.dev/learn/react-compiler>
- MDN `content-visibility`: can let browsers skip rendering offscreen content and should be paired with intrinsic sizing/containment where appropriate. <https://developer.mozilla.org/docs/Web/CSS/Reference/Properties/content-visibility>
- MDN `contain-intrinsic-size`: useful with `content-visibility` to reserve space and reduce reflow risk. <https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size>
- Electron app docs: `app.disableHardwareAcceleration()` disables hardware acceleration for the current app. <https://www.electronjs.org/docs/latest/api/app>
- Electron powerSaveBlocker docs: use only for explicit user-facing needs to keep the system/display awake. <https://www.electronjs.org/docs/latest/api/power-save-blocker/>

## Verification notes

These findings were cross-checked against the current codebase and compatibility constraints. They are intentionally framed as implementation opportunities rather than completed code changes. The recommended first PRs should be measurement-only or narrowly scoped changes with before/after startup and bundle data.

## Selected code evidence checked

The recommendations above were verified against these representative code locations:

- The generated TanStack route tree warns not to edit it manually and eagerly imports root, pair, chat, draft, and thread route modules (`apps/web/src/routeTree.gen.ts:7-16`). Chat thread routes synchronously import `ChatView` and right-panel modules (`apps/web/src/routes/_chat.$environmentId.$threadId.tsx:1-29`; `apps/web/src/routes/_chat.draft.$draftId.tsx:1-25`).
- `RootAppShell` imports and mounts command palette, sidebar layout, SSH prompt, provider update notification, WebSocket coordinators, and toast providers together (`apps/web/src/components/RootAppShell.tsx:7-16`, `53-81`).
- `AppSidebarLayout` imports `SettingsDialog` and always renders it next to the sidebar; `SettingsDialog` imports all major settings panels up front (`apps/web/src/components/AppSidebarLayout.tsx:1-10`, `57-75`; `apps/web/src/components/settings/SettingsDialog.tsx:21-28`).
- Sidebar imports `@formkit/auto-animate` and `@dnd-kit/*` eagerly, then uses auto-animate controllers and a manual sorting branch (`apps/web/src/components/Sidebar.tsx:41-63`, `339-360`, `5020-5064`).
- The web entry imports xterm CSS globally, and the terminal drawer imports xterm JS eagerly (`apps/web/src/main.tsx:6-7`; `apps/web/src/components/ThreadTerminalDrawer.tsx:1-10`).
- The web build disables `modulePreload` (`apps/web/vite.config.ts:112-116`).
- `index.css` globally declares many UI and mono font faces (`apps/web/src/index.css:7-129`).
- Orchestration uses an unbounded command queue and event PubSub, processes one command worker, appends/projects/publishes events in the command path, and exposes live events from a fresh PubSub subscription (`apps/server/src/orchestration/Layers/OrchestrationEngine.ts:119-120`, `181-248`, `320-343`).
- WebSocket shell/thread subscriptions concatenate a snapshot with a live stream created after snapshot work, which motivates snapshot-sequence replay/dedupe (`apps/server/src/ws.ts:1654-1667`, `1681-1731`).
- Event replay defaults to a 1,000 event limit with 500-row pages (`apps/server/src/persistence/Layers/OrchestrationEventStore.ts:65-66`, `209-258`).
- Startup command gating queues pending commands in an unbounded queue (`apps/server/src/serverRuntimeStartup.ts:82-123`).
- Desktop restart delay grows exponentially, but the attempt counter resets on child `spawn` rather than backend readiness (`apps/desktop/src/main.ts:1919-1929`, `1995-1998`).
- Desktop window creation already uses `show: false`, sandbox/context isolation, and `backgroundThrottling: true`, with a documented Linux/Wayland reveal fallback (`apps/desktop/src/main.ts:2511-2530`, `2608-2617`).
- Packaged desktop opens a boot shell before backend bootstrap and schedules a deferred shell-env refresh after a cache hit (`apps/desktop/src/main.ts:2731-2741`). The shell-env cache currently validates version/platform/timestamp/environment and returns the recorded shell without comparing it to the current shell (`apps/desktop/src/shellEnvironmentCache.ts:74-127`).
- The packaged boot page has an infinite logo pulse with `prefers-reduced-motion` fallback but no backend retry/error state (`apps/web/public/desktop-boot.html:49-80`).
