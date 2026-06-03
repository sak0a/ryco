# version 1: Ryco performance opportunity research — faster load, lower load, and lower idle/GPU cost

Date: 2026-06-03

## Scope

This note records a project-wide performance research pass for Ryco. It focuses on changes that should improve one or more of:

- faster initial load and startup;
- faster thread/tab switching and streamed-message rendering;
- load management under reconnects, many WebSocket subscribers, and many provider sessions;
- lower idle CPU wakeups and lower energy use;
- lower renderer/GPU/compositor pressure;
- predictable behavior under overload and failure.

This is intentionally a findings document, not an implementation plan. Every item below was checked against current repo structure before inclusion. Some items need measurement before being promoted to implementation work, but they are included because the current code has a compatible path to improvement.

## External references used

These references are stable guidance that matches the codebase findings:

- [React `memo` reference](https://react.dev/reference/react/memo): memoization is useful when a component frequently re-renders with equal props and expensive render work; React Compiler can help, but prop identity and hot-path design still matter.
- [web.dev: script evaluation and long tasks](https://web.dev/articles/script-evaluation-and-long-tasks): reducing initial JavaScript and splitting large scripts reduces main-thread blocking during load.
- [web.dev: optimize long tasks](https://web.dev/articles/optimize-long-tasks): long JS tasks block input and rendering; expensive update work should be split, yielded, or moved off the main thread where possible.
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket): the browser `WebSocket` API has no built-in backpressure and can cause buffering, memory growth, or CPU saturation if messages outpace processing.
- [Node.js streams backpressure guide](https://nodejs.org/en/learn/modules/backpressuring-in-streams): bounded buffering and flow control are key to keeping memory predictable.
- [Chrome Developers: re-rastering composited layers](https://developer.chrome.com/blog/re-rastering-composite): `will-change` can help short animations, but it should be applied deliberately and removed when not needed to avoid unnecessary layer/GPU memory.
- [Vite build guide](https://vite.dev/guide/build): dynamic imports and build chunking are the standard path for production code splitting.

## Existing performance work to preserve

Ryco already has several strong performance foundations. Future changes should preserve these patterns rather than replace them blindly.

### Measurement hooks exist, but real packaged measurements are still missing

The repo already documents opt-in performance profiling through `RYCO_PERF_PROFILE=1` and `VITE_RYCO_PERF_PROFILE=1`, with server/browser summaries emitted every five seconds. The baseline doc also names the hot surfaces to measure: `ChatView`, `Sidebar`, `MessagesTimeline`, `DiffPanel`, `ChatMarkdown`, WebSocket streams, terminal events, and client store/event application.

However, the same docs state that no full interactive desktop/web scenario was captured in that session, so CPU, GPU, energy, memory, and live rates remain unmeasured. This matters because the repo already decided not to jump to Tauri/native sidecars until the packaged app shows shell-level or Node-level bottlenecks after app-layer fixes.

Relevant files:

- `docs/perf/issue-80-baseline.md`
- `docs/perf/issue-92-desktop-shell-decision.md`
- `apps/web/src/perf/tabSwitchInstrumentation.ts`
- `apps/web/src/perf/startupInstrumentation.ts`
- `apps/server/src/observability/PerfInstrumentation.ts`

### Chat timeline virtualization and stable row design are already in place

`MessagesTimeline` is virtualized with `LegendList`, uses memoized row derivation, stable row reuse, stable `renderItem`, and isolated row state. That is the right baseline for long conversations and should be kept.

Compatible follow-up work should optimize the active streaming row and markdown parsing, not replace the whole list with a non-virtualized approach.

Relevant files:

- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`

### Right panel lazy loading is a good pattern

`ChatRightPanel` already lazy-loads `DiffPanel` and `PreviewPanel` and only renders their content once the panel is opened or has previously been opened. This is exactly the pattern to extend to other optional surfaces such as settings, project explorer, worktree creation, and terminal UI.

Relevant files:

- `apps/web/src/components/ChatRightPanel.tsx`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`

### Existing idle-power fixes are real but distributed

Several idle-power improvements already exist: provider session reaping, no built-in provider refresh interval, default-off VCS remote refresh subscriptions, Git remote-refresh backoff, non-interactive Git fetch environment, and a gated Git progress toast interval.

The remaining maintainability gap is that these policies are distributed rather than exposed through one central idle/background policy surface.

Relevant files:

- `apps/server/src/provider/Layers/ProviderSessionReaper.ts`
- `apps/server/src/provider/makeManagedServerProvider.ts`
- `apps/server/src/provider/Drivers/CodexDriver.ts`
- `apps/server/src/vcs/VcsStatusBroadcaster.ts`
- `apps/server/src/vcs/GitVcsDriverCore.ts`
- `apps/web/src/components/GitActionsControl.tsx`

## Highest-value opportunities

### 1. Route-level code splitting for initial load

**Current state**

The generated route tree statically imports all route modules, including the chat thread route and draft route. Those route modules directly import `ChatView`, `ChatRightPanel`, thread sorting, store selectors, and right-panel search helpers. As a result, the app can pull a large chat-thread graph into startup even when the user is visiting `/pair`, an empty root state, or a path that only needs authentication/bootstrap.

Files checked:

- `apps/web/src/routeTree.gen.ts`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/routes/_chat.draft.$draftId.tsx`
- `apps/web/src/components/ChatView.tsx`

**Why this is likely high impact**

Initial JavaScript parse/evaluate is one of the most expensive load costs for Electron and web. The root route already lazy-loads `RootAppShell`, but static route module imports can reduce the benefit by keeping heavy modules in the entry graph. This is especially relevant because `ChatView` itself imports many feature surfaces, hooks, contracts, terminal/diff/sidebar-related helpers, and chat components.

**Compatible improvement**

Use TanStack Router route code splitting or move the heavy route components behind `React.lazy` boundaries in the route files. The minimal compatibility-preserving direction is:

1. keep route params/search validation synchronous and light;
2. lazy-load only `ChatThreadRouteView` and draft route view contents;
3. keep the root auth/pairing route fast and independent;
4. prefetch the chat route chunk only after auth/bootstrap if the initial route needs it.

**Risks / verification**

- Route splitting must not break `validateSearch`, retained search params, or the route type generator.
- Measure before/after with `vite build` output and browser/Electron startup traces.
- Verify `/pair` does not fetch chat-thread chunks before pairing UI is shown.

**Expected benefit**

- Faster cold load and first paint.
- Lower memory and parse/evaluate energy for pairing/static-hosted paths.
- Better chunk caching if route chunks change less frequently than the root.

### 2. Lazy-load settings, project explorer, worktree dialogs, and other optional modals

**Current state**

`AppSidebarLayout` imports and always renders `SettingsDialog`. `SettingsDialog` imports every settings panel up front, including providers, MCP servers, source-control settings, appearance/theme editor, connections, archived threads, and keybindings.

`Sidebar` also imports large secondary surfaces such as project explorer and new worktree dialogs at module load. Those flows are not needed for the initial chat surface.

Files checked:

- `apps/web/src/components/AppSidebarLayout.tsx`
- `apps/web/src/components/settings/SettingsDialog.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/projectExplorer/*`
- `apps/web/src/components/worktrees/NewWorktreeDialog.tsx`

**Why this is likely high impact**

Settings and project-explorer flows pull many UI widgets, provider/source-control logic, icons, markdown/diff views, and forms into the app shell. They are high-value targets because they are large and usually not needed on first paint.

**Compatible improvement**

Extend the existing right-panel lazy pattern:

1. replace eager `<SettingsDialog />` with a tiny store subscriber that only mounts a lazy `SettingsDialogContent` after the dialog has been opened;
2. split settings sections individually so opening “General” does not load source-control or MCP panels immediately;
3. lazy-load `ProjectExplorerDialog`, `NewWorktreeDialog`, and source-control detail panes;
4. add prefetch on likely intent, such as command-palette highlight, menu hover, or settings keyboard shortcut keydown.

**Risks / verification**

- Desktop menu action `open-settings` must still open the dialog immediately.
- Keyboard shortcuts should not block on a long chunk load without a visible loading state.
- Tests should cover initial shell render with settings closed and the first open path.

**Expected benefit**

- Smaller app-shell chunk.
- Faster shell render after auth.
- Less memory retained for rarely used panels.

### 3. Lazy-load xterm terminal JavaScript and CSS

**Current state**

The entry file imports `@xterm/xterm/css/xterm.css` globally. `ChatView` imports `ThreadTerminalDrawer` directly. `ThreadTerminalDrawer` imports `@xterm/xterm` and `@xterm/addon-fit` at top level.

Files checked:

- `apps/web/src/main.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`

**Why this is likely high impact**

Terminal support is important but secondary. Users can load Ryco, read threads, and send chat messages without opening a terminal drawer. xterm is a substantial dependency and should not be part of the critical path unless the terminal is open or likely to open.

**Compatible improvement**

1. Move `ThreadTerminalDrawer` behind `React.lazy`.
2. Move xterm CSS into the terminal drawer chunk or a terminal-specific CSS import loaded by that component.
3. Keep terminal event storage independent of the xterm view so events can be buffered even while the drawer chunk is not loaded.
4. Consider prefetching the terminal chunk when a thread has terminal activity or when the user hovers the terminal toggle.

**Risks / verification**

- Ensure terminal snapshots/events are not lost while the UI chunk is loading.
- Ensure xterm CSS is applied before the terminal becomes visible to avoid layout flash.
- Verify hidden/persistent terminal drawers still preserve expected state.

**Expected benefit**

- Faster initial bundle parse/evaluate.
- Lower memory before terminal use.
- Lower renderer work for users who do not open terminals.

### 4. Optimize streaming markdown as a specific hot path

**Current state**

`MessagesTimeline` already virtualizes and stabilizes rows, but assistant message rows still render `ChatMarkdown`. `ChatMarkdown` extracts markdown links, builds file-link metadata, builds component maps, and runs `ReactMarkdown` for the full text. It skips Shiki highlighting while streaming, which is good, but markdown parsing still occurs for every streamed text update.

Files checked:

- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/session-logic.ts`

**Why this is likely high impact**

During a streamed assistant response, the active assistant text may update many times per second. Even if only one virtualized row updates, reparsing the entire growing markdown string can create long tasks and block input/paint. This is one of the clearest CPU and energy opportunities because it touches the most common active-use path.

**Compatible improvement options**

Options can be staged from safest to deepest:

1. **Frame/interval throttle active streaming markdown.** Keep the latest text in a ref and re-render markdown at most once per animation frame or every 50–100ms while streaming.
2. **Streaming plain-text mode.** Render active streaming content as escaped text with lightweight linkification/code-block detection, then switch to full markdown on settlement.
3. **Segment-level memoization.** Split assistant text into stable completed blocks plus a mutable tail; only parse the tail while streaming.
4. **Worker-assisted preprocessing.** Offload markdown tokenization or code-block extraction to a worker for very large messages, while keeping React rendering on the main thread.

**Risks / verification**

- Markdown output should not visibly jump too much when the message settles.
- File-link chips and skill inline text need compatibility checks if the streaming path is simplified.
- Measure `ChatMarkdown` render marks during long responses before/after.

**Expected benefit**

- Lower CPU during active responses.
- Fewer long tasks and better input responsiveness.
- Lower energy use under long agent streams.

### 5. Add explicit WebSocket/backpressure and queue policies

**Current state**

The server has a correctness-first event architecture, but many hot paths are unbounded:

- orchestration command queue and domain event pubsub;
- provider runtime event pubsub;
- Codex adapter/runtime queues;
- low-level Codex app-server protocol queues;
- shared `DrainableWorker` queue used by provider runtime ingestion;
- stream callbacks for terminal/VCS events.

The WebSocket route delegates transport send buffering to Effect RPC. The browser `WebSocket` API itself has no built-in application-level backpressure, so slow consumers can still be a risk.

Files checked:

- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/ws.ts`
- `packages/shared/src/DrainableWorker.ts`
- `packages/effect-codex-app-server/src/protocol.ts`
- `apps/web/src/rpc/wsTransport.ts`

**Why this is likely high impact**

Unbounded queues make normal operation simple, but they hide overload until memory grows or latency spikes. This directly affects load balancing, reconnect robustness, energy, and reliability.

**Compatible improvement**

Do not replace all unbounded queues at once. Introduce event-class policies:

- **Lossless bounded with producer backpressure:** command envelopes, approval/user-input events, turn lifecycle, final assistant messages, persisted domain events.
- **Coalescible latest-by-key:** provider status snapshots, token usage/status updates, VCS status, shell summary updates, terminal-size updates.
- **Replayable:** orchestration events already have sequences and durable replay. WebSocket subscribers can use replay/snapshot rather than relying on large in-memory buffering.
- **Best-effort observability:** provider event logs and perf payloads can become bounded/drop-oldest with dropped-record counters.

Start with instrumentation first:

1. queue length/high-watermark metrics;
2. enqueue-to-process latency;
3. active WebSocket stream count by method;
4. outbound stream item rates and payload sizes;
5. active provider session/process count;
6. replay gap sizes.

**Risks / verification**

- Never drop events that are required for correctness or user-visible causality.
- Coalescing must preserve final values and sequence expectations.
- Add overload tests for high-rate provider deltas and slow consumers.

**Expected benefit**

- Predictable memory under slow consumers and provider bursts.
- Better overload behavior and fewer pathological reconnect cases.
- Lower wasted CPU from processing stale coalescible updates.

### 6. Add Codex provider session admission control and load balancing

**Current state**

Ryco starts one `codex app-server` child process per provider session/thread. `CodexAdapter` keeps sessions in a `Map<ThreadId, ...>`, and `startSession` immediately creates a runtime/scope after stopping an existing same-thread session. There is no visible global or per-provider-instance admission control for concurrent starting/running Codex processes.

Files checked:

- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderSessionReaper.ts`

**Why this is likely high impact**

The biggest server-side load and energy cost is likely provider child processes. Without admission control, a reconnect/recovery storm or many parallel thread starts can spawn many Codex processes, increasing CPU, memory, and battery use.

**Compatible improvement**

Add a provider session scheduler around `adapter.startSession`:

- `maxStartingSessionsPerInstance` to prevent spawn storms;
- `maxActiveSessionsPerInstance` and global `maxCodexProcesses`;
- priority for active user turns over speculative recovery;
- stop/reap idle sessions before admitting new ones;
- typed overload/queued status for the UI if capacity is exhausted;
- metrics for queue wait time, spawn time, and active process count.

This can live in `ProviderService` or adapter-specific layers without frontend protocol changes at first.

**Risks / verification**

- Admission delay must not break session resume semantics.
- Active approvals/user-input turns should not be reaped.
- The UI needs clear overload messaging if requests are queued or rejected.

**Expected benefit**

- Better CPU/memory/energy behavior under many threads.
- More predictable responsiveness for the active thread.
- Foundation for real load balancing across provider instances.

### 7. Fix snapshot/live race and paginate replay events

**Current state**

`subscribeShell` and `subscribeThread` load a snapshot first, then subscribe to live domain events. Events committed between snapshot load and live subscription can be missed unless the client separately replays. `replayEvents` reads from durable storage but collects all events into memory, converts to an array, enriches them, and returns them in one response.

Files checked:

- `apps/server/src/ws.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/web/src/environments/runtime/connection.ts`
- `apps/web/src/environments/runtime/service.ts`

**Why this is likely high impact**

This is primarily correctness/reconnect robustness, but it is performance-relevant because missed events cause extra recovery work, stale UI state, and potentially larger replays. Large replay gaps also risk large allocations and slow reconnects.

**Compatible improvement**

For subscriptions:

1. subscribe to the live pubsub first;
2. load snapshot and sequence;
3. filter live/buffered events to `sequence > snapshotSequence`;
4. emit snapshot followed by gap-free live events.

For replay:

- add `limit` and return `nextFromSequenceExclusive`/`hasMore`;
- optionally add streaming replay for large gaps;
- skip expensive enrichment for event kinds that a fresh snapshot supersedes.

**Risks / verification**

- Need tests that inject events between snapshot and live subscription.
- Pagination needs additive protocol design to avoid breaking existing clients.
- Filtering by sequence must be consistent across shell and thread streams.

**Expected benefit**

- More reliable reconnects.
- Lower peak memory for stale reconnects.
- Fewer expensive all-at-once replay/enrichment operations.

### 8. Virtualize or progressively render the sidebar project/thread tree

**Current state**

The chat timeline is virtualized, but the sidebar project/thread tree is rendered with ordinary `.map()` calls. The sidebar derives snapshots, maps, visible thread keys, sorted projects, and project worktree groups from full arrays. Existing preview limits and animation gates help, but large environments can still create substantial render and derivation work.

Files checked:

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/sidebar/*`
- `apps/web/src/sessionTabs.selectors.ts`

**Why this is likely high impact**

Ryco can accumulate many projects, worktrees, and threads. Sidebar work happens on the app shell and can affect startup, tab switching, and streaming if store updates cause broad recomputation.

**Compatible improvement**

Stage this carefully:

1. add measurement for many-project/many-thread sidebar render and derivation time;
2. virtualize the top-level project/worktree tree first;
3. render thread rows only for expanded/intersecting projects;
4. keep `THREAD_PREVIEW_LIMIT` and “show more” behavior;
5. ensure manual sorting/DnD mode can opt out of virtualization or use a virtualization-compatible DnD strategy.

**Risks / verification**

- DnD manual sorting and auto-animate may conflict with virtualization.
- Keyboard navigation/focus must still work.
- Collapsible state and source-control badges must stay stable.

**Expected benefit**

- Better large-workspace startup and shell responsiveness.
- Less DOM and layout work.
- Lower GPU/compositor pressure from fewer visible/animated nodes.

### 9. Reduce GPU/compositor work from overlays, animations, and hidden surfaces

**Current state**

The UI uses transition/translate/scale classes, overlays with backdrop blur, shadows, skeleton animations, pulsing dots, and persistent hidden terminal drawers. Some of this is appropriate for perceived quality, but not all animation/layer work is equal. `will-change-transform` appears on dialog/sheet surfaces and should remain scoped to active transitions.

Files checked:

- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`

**Why this is likely high impact**

GPU use is not only a performance problem; it is also an energy problem. Backdrop blur and many composited layers can keep the GPU active. Hidden but mounted terminal views can retain memory and continue processing output.

**Compatible improvement**

1. Gate nonessential animation with `prefers-reduced-motion` and an app “low power UI” setting.
2. Avoid backdrop blur on large full-screen overlays in low-power mode; use opacity-only overlays.
3. Ensure `will-change` is used only during active transitions, not permanently on mounted hidden surfaces.
4. Centralize pulse/skeleton animation policy so background/inactive windows stop animations.
5. Add hidden terminal parking: keep terminal data/state, but unmount or suspend old hidden xterm instances after an LRU threshold.

**Risks / verification**

- Visual regressions in dialogs/sheets.
- Terminal parking must preserve scrollback and process output expectations.
- Measure with Chrome/Electron Performance and process-level GPU/energy sampling.

**Expected benefit**

- Lower idle and background GPU activity.
- Lower memory for hidden terminal-heavy sessions.
- Better battery life on laptops.

### 10. Centralize visible timer/ticker behavior and pause on hidden documents

**Current state**

`WorkingTimer` and `LiveMessageMeta` update DOM text directly with `setInterval`, avoiding React commits. This is good. The remaining issue is that each visible timer owns its own one-second interval, and timers may continue when the document is hidden unless components unmount.

Files checked:

- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/WebSocketConnectionSurface.tsx`
- `apps/web/src/components/desktop/SshPasswordPromptDialog.tsx`

**Why this is likely high impact**

One-second wakeups are small individually but important for idle energy. A coding-agent GUI may sit open for hours with no active turn.

**Compatible improvement**

- Replace per-component one-second intervals with a shared visible ticker.
- Pause ticker work when `document.visibilityState === "hidden"`.
- Resume and update immediately when visible.
- Keep direct DOM text update for timer labels to avoid React commits.

**Risks / verification**

- Timers should display correct elapsed time immediately after resume.
- Avoid adding a global interval when no timer subscribers exist.
- Add unit tests for subscribe/unsubscribe and visibility changes.

**Expected benefit**

- Fewer idle CPU wakeups.
- Better battery behavior when app is backgrounded.

### 11. Make observability/logging explicitly async and bounded

**Current state**

Provider event logging is best-effort and batched, but event serialization and writer resolution still happen on hot paths before events are published/offered. Perf instrumentation also records payloads on stream paths.

Files checked:

- `apps/server/src/provider/Layers/EventNdjsonLogger.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/observability/PerfInstrumentation.ts`
- `apps/web/src/perf/perfInstrumentation.ts`

**Why this is likely high impact**

Instrumentation should not become the bottleneck during the event bursts it is trying to measure. Logging is lower priority than preserving provider/session correctness.

**Compatible improvement**

- Push log records into a bounded observability queue.
- Drop oldest/newest observability records under pressure and count drops.
- Pre-resolve writer handles at session start where possible.
- Avoid `JSON.stringify` when logging is disabled.
- Sample large payload summaries rather than full payloads for high-rate streams.

**Risks / verification**

- Ensure dropped logs are visible through counters.
- Keep enough data for debugging rare provider issues.
- Do not make correctness events lossy; only observability should be lossy.

**Expected benefit**

- Lower latency on provider event hot paths.
- More predictable behavior during bursts.

### 12. Add attachment limits and accounting before base64 conversion

**Current state**

Codex attachment resolution reads attachment files and converts them to base64 data URLs before sending to Codex. This likely matches the current Codex app-server protocol, but it duplicates memory and expands data size.

Files checked:

- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/attachmentStore.ts`
- `apps/server/src/attachmentPaths.ts`

**Why this is likely high impact**

Large image attachments can create memory spikes: file bytes, base64 string, request payload, and possibly serialized copies. This affects server memory and event-loop responsiveness.

**Compatible improvement**

- Stat files before reading them.
- Enforce max attachment count and max total bytes per turn.
- Record attachment byte totals in provider turn metrics.
- Prefer file references or streaming if Codex app-server supports them in the future.

**Risks / verification**

- Need clear user-facing rejection messages.
- Limits should be configurable or at least documented.
- Ensure existing small attachments keep working.

**Expected benefit**

- Lower memory spikes.
- More predictable provider turn submission latency.

## Measurement plan before implementation

The most important next step is to produce a fresh packaged-app baseline, because existing docs explicitly say the project lacks real CPU/GPU/energy/memory/live-rate numbers.

### Recommended scenarios

Reuse and extend `docs/perf/issue-80-baseline.md`:

1. cold packaged desktop startup to usable chat;
2. hosted/static web initial load to pairing/static environment screen;
3. authenticated web initial load to active thread;
4. long markdown/code streaming response;
5. 50-message thread tab switching across five tabs;
6. terminal output burst with drawer open and closed;
7. large diff/search in right panel;
8. sidebar with many projects/worktrees/threads;
9. no-active-turn idle after waiting past provider reaper grace;
10. reconnect after server restart and replay gap.

### Metrics to collect

- Bundle chunks and gzip/brotli sizes from `vite build`.
- Chrome/Electron Performance traces: scripting, rendering, painting, long tasks, layout shifts.
- `performance.measure` entries for startup and tab switching.
- `[perf]` summaries from server and browser with profiling env flags enabled.
- Process tree CPU/memory/energy, including provider children and Electron GPU/helper processes.
- WebSocket stream rates and payload sizes by method.
- Queue high-watermarks and active provider process count once instrumentation exists.

## Suggested implementation order

1. **Measure current packaged baseline.** Avoid debating shell/native migration until CPU/GPU/energy/memory numbers exist.
2. **Route and modal code splitting.** Lowest semantic risk and likely direct startup wins.
3. **Lazy terminal/xterm loading.** Clear optional-surface split with visible startup benefit.
4. **Streaming markdown throttling/simplification.** High active-use CPU/energy win.
5. **Queue/backpressure instrumentation.** Measure server load before changing delivery semantics.
6. **Codex process scheduler/admission control.** Biggest backend load-balancing and energy improvement.
7. **Snapshot/live race fix and replay pagination.** Reconnect correctness plus lower peak allocations.
8. **Sidebar virtualization/progressive rendering.** Large-workspace scalability.
9. **GPU/idle policy refinements.** Low-power UI mode, hidden terminal parking, shared visible ticker.
10. **Async bounded observability and attachment limits.** Robustness under bursty/high-memory paths.

## Findings intentionally not recommended yet

- **A full Electron-to-Tauri migration.** Existing docs correctly gate this on packaged measurements showing Electron shell/GPU/helper processes dominate after app-layer fixes.
- **A Rust/Go native sidecar rewrite.** Not justified until server-side Node/PTY/git/provider work is measured as the dominant bottleneck.
- **Replacing the chat timeline virtualization library.** The current `LegendList` design already addresses the main long-list issue; optimize markdown/streaming first.
- **Disabling all animations globally.** Prefer `prefers-reduced-motion`, low-power mode, scoped animation gates, and measured GPU traces.

## Verification summary

- Subagents independently reviewed frontend, backend/server, and existing performance docs.
- Findings were cross-checked against current code paths before inclusion.
- External guidance was used only where it matched observed architecture: code splitting, long-task reduction, WebSocket backpressure, Node flow control, and compositor/layer cost.
- No production code changes are included in this document.
