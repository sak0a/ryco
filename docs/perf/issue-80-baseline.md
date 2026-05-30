# Issue #80 Performance Baseline

Phase 0 adds opt-in local instrumentation for issue #80. It is disabled by default.

## Enable Profiling

Use both flags when running the full desktop or web stack so the server and renderer are both
instrumented:

```sh
RYCO_PERF_PROFILE=1 VITE_RYCO_PERF_PROFILE=1 bun dev
```

Useful narrower runs:

```sh
RYCO_PERF_PROFILE=1 bun dev:server
VITE_RYCO_PERF_PROFILE=1 bun dev:web
RYCO_PERF_PROFILE=1 VITE_RYCO_PERF_PROFILE=1 bun dev:desktop
```

Profiling emits `[perf]` summaries every 5 seconds. Server summaries are written to the server
process console. Renderer summaries are written to the browser or Electron DevTools console.

Renderer render marks are also available from DevTools:

```js
performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("s3:render:"));
```

## Instrumentation Labels

| Area                     | Labels                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Renderer hot surfaces    | `web.render.ChatView`, `web.render.Sidebar`, `web.render.MessagesTimeline`, `web.render.DiffPanel`, `web.render.ChatMarkdown` |
| Client WebSocket streams | `web.ws.stream.<method>`                                                                                                      |
| Client store application | `web.store.orchestration.event.apply`, `web.store.orchestration.events.apply`, `web.store.orchestration.shell.apply`          |
| Client terminal          | `web.terminal.store.events.record`, `web.terminal.store.events.apply`, `web.terminal.drawer.events.apply`                     |
| Server WebSocket streams | `server.ws.orchestration.subscribeShell`, `server.ws.orchestration.subscribeThread`, `server.ws.terminal.events`              |
| Server terminal          | `server.terminal.events`, `server.terminal.output`                                                                            |

Each summary reports count, rate per second, approximate payload bytes, bytes per second, duration
sample count, average duration, and max duration for the current window.

## Measurement Workflow

Use the same machine, power mode, app mode, and data set for before/after comparisons. Record the
Ryco commit, whether the run is dev or packaged, and whether DevTools is open.

1. Start Ryco with profiling enabled.
2. Open DevTools Performance for the renderer. Enable screenshots and memory when useful.
3. Open Activity Monitor or Instruments. Record Ryco/Electron CPU, GPU, energy impact, and memory.
4. Run one scenario for the full duration below.
5. Save the DevTools trace and copy the `[perf]` summary windows that overlap the scenario.
6. Repeat each scenario at least twice if numbers are noisy.

### Scenarios

| Scenario                                     | Duration      | Steps                                                                                                  | Primary numbers                                                                           |
| -------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Idle active chat                             | 5 minutes     | Open an existing chat thread. Do not type or switch tabs. Keep terminal and diff closed.               | CPU, GPU, energy, memory, render commits/sec                                              |
| Long assistant response with markdown/code   | One full turn | Ask for a long markdown answer with multiple fenced code blocks. Keep the active thread visible.       | `ChatView`, `MessagesTimeline`, `ChatMarkdown`, store apply rates                         |
| Terminal output burst                        | 60 seconds    | Open the terminal drawer and run a high-output command such as `yes ryco-perf \| head -n 20000`.       | `server.terminal.output`, `server.ws.terminal.events`, `web.terminal.drawer.events.apply` |
| Large diff open plus search                  | 2 minutes     | Open a large turn diff, switch render modes if useful, then search for a frequent token.               | `DiffPanel` commits, diff search responsiveness, CPU, memory                              |
| Sidebar with many projects/threads/worktrees | 2 minutes     | Use a workspace with many projects, threads, and worktrees. Expand/collapse groups and switch threads. | `Sidebar` commits, shell event apply rates, CPU                                           |

## Local Baseline Notes

Collected on 2026-05-29 05:21 CEST.

| Item         | Value               |
| ------------ | ------------------- |
| macOS        | 26.4.1 build 25E253 |
| Architecture | arm64               |
| CPU          | Apple M5 Max        |
| Memory       | 64 GiB              |
| Bun          | 1.3.11              |
| Node         | v24.15.0            |

No interactive desktop/web scenario was captured in this coding session, so CPU, GPU, energy,
memory, and live `[perf]` rates are still measurement gaps. The instrumentation is in place for a
repeatable local run with the workflow above.

## Suspected Hotspots To Confirm

These are hypotheses from the issue plan and instrumentation targets, not measured conclusions yet:

| Surface                           | Why it is suspect                                                     | Evidence to collect                                                            |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ChatMarkdown`                    | Streaming markdown and code highlighting can re-render frequently.    | Commit rate, average/max render duration during long code-heavy responses.     |
| `MessagesTimeline` and `ChatView` | Streaming thread events can churn derived arrays and list rows.       | Store apply rate correlated with timeline commits/sec.                         |
| Terminal drawer                   | xterm writes can arrive in bursts and trigger renderer work.          | Server output bytes/sec, WebSocket terminal events/sec, drawer apply duration. |
| `DiffPanel`                       | Large patches plus search highlighting can be CPU and memory heavy.   | DiffPanel render duration, search latency, memory delta.                       |
| `Sidebar`                         | Many projects, threads, and worktrees can stress broad subscriptions. | Shell event rate, Sidebar commits/sec, CPU while expanding and switching.      |
