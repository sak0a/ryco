# Performance and Observability Pass Design

**Date:** 2026-08-02
**Status:** Approved for implementation

## Purpose

Improve Ryco's perceived and actual performance during normal use, idle periods, reconnects, and long-lived sessions while making operational slowdowns understandable from one concise diagnostics experience.

This pass is deliberately narrower than a direct port of T3Code's performance work. It implements missing changes whose behavior can be verified in Ryco's current architecture and records higher-risk upstream ideas for later measurement.

## Goals

- Stop avoidable continuous browser compositing and animation work.
- Make diagnostics answer what is slow now and what recent evidence could explain a slowdown.
- Ensure diagnostics and histories are bounded and active only while a client requests them.
- Bound observability memory and disk retry behavior during persistent write failures.
- Reduce avoidable snapshot memory, stale context payload, and Git subprocess work.
- Preserve replay, reconnect, hosted Hub, provider, and terminal lifecycle ownership.
- Keep diagnostic output privacy-safe and separate from usage statistics.

## Non-goals

- A cross-platform native resource-monitor sidecar.
- A browser GPU-utilization metric.
- New reconnect, hosted recovery, or mutation-readiness ownership.
- Broad WebSocket or HTTP compression without Ryco-specific measurements and compatibility testing.
- Broad activity-payload projection without a complete web and mobile field-usage audit.
- Arbitrary performance severity thresholds.

## Existing Ryco Coverage

The June performance pass already provides lazy loading, streaming Markdown throttling, shared tickers, provider-start admission controls, bounded provider logs, stable chat selectors, and bounded snapshot/live replay handoff. This design retains those mechanisms.

In particular:

- `apps/server/src/ws/context/orchestrationStreams.ts` attaches the live stream before replay, captures a replay boundary, bounds the live queue, deduplicates the handoff, and forces resynchronization on overflow.
- `apps/server/src/ws/wsReplayMetrics.ts` and `apps/server/src/observability/QueueMetrics.ts` already collect bounded queue and replay pressure signals.
- `apps/server/src/vcs/VcsStatusBroadcaster.ts` refreshes only for active subscribers and applies failure backoff.
- Provider event logs are batched, queue-bounded, and rotated.
- Diagnostics already expose backend resources, histories, providers, terminals, failures, traces, and slow client RPCs, but across two interfaces.

## Design

### 1. Browser idle and rendering work

Remove the fixed full-viewport noise pseudo-element from `apps/web/src/index.css`. Its visual contribution does not justify permanent compositing over the application.

Replace indefinitely running status animation with status-specific behavior:

- Animate only states that are actively changing, such as connecting or processing.
- Use a low-duty-cycle status pulse or ping rather than a continuously active animation.
- Do not shimmer approval, review, plan-ready, awaiting-input, or other stable states.
- Keep finite transition and loading animation where it communicates active work.
- Disable nonessential animation under `prefers-reduced-motion: reduce`.

The change must not alter status meaning, stream rendering, or interaction readiness.

### 2. One shared diagnostics experience

The Settings entry and standalone diagnostics route become shells around one shared implementation. The shared view preserves capabilities that currently exist in only one surface, including debug-bundle copy, log access, connection state, push-sequence visibility, and hosted lifecycle state.

The first section is **Performance now** and shows, without severity coloring:

- backend CPU, RSS, heap, and event-loop delay;
- active provider and terminal counts;
- rolling turn-quiescence average and checkpoint p95;
- WebSocket state and reconnect count;
- latest slow client RPC, slow server trace, or recent failure;
- short bounded resource histories where useful.

The next section is **Why was this slow?**. It presents recent evidence rather than claiming a definitive cause:

- time to first provider event when already available or cheaply measurable;
- snapshot/replay duration;
- current and high-water queue depth plus overflow counts;
- slowest relevant server stage;
- reconnect, replay-gap, and resume state;
- trace-write pressure or failures.

Advanced traces, histories, providers, terminals, and failure detail remain collapsed by default. Usage statistics remain in the statistics feature and are not mixed into operational diagnostics.

### 3. Demand-gated collection and data flow

The diagnostics view keeps its existing low-frequency polling behavior, but polling is the demand signal:

1. Mounting the view requests a diagnostics snapshot and then polls at the existing five-second interval.
2. Each server request samples process resources once and appends one point to bounded history.
3. Pausing or unmounting the view stops requests, so server resource history and event-loop sampling also stop.
4. The server snapshot combines backend resource data, existing Effect metric aggregates, local diagnostic timings, trace health, failures, providers, and terminals.
5. The browser merges current connection and replay state from existing client-runtime stores. It does not publish readiness or own recovery.

This removes the permanent one-second server resource sampler and avoids a replacement renderer timer. Event-loop delay is sampled on demand with a bounded one-shot delay measurement rather than a continuously enabled histogram.

All rolling histories and recent-item collections remain explicitly capped. Metric aggregation happens only while constructing a requested diagnostics snapshot.

### 4. Trace and logging failure containment

The trace file sink gains a bounded pending-record or byte budget, write-failure counters, dropped-record counters, and capped retry backoff.

On repeated write failure:

- buffered data never exceeds the configured cap;
- newly dropped data increments a counter instead of growing memory without bound;
- retries back off to avoid repeated disk churn;
- a later successful write resets the retry delay;
- flush and close retain deterministic behavior;
- health reports counts and sizes, never record contents or private paths.

The existing provider-log queue and rotation remain unchanged unless tests reveal a specific gap. Their current bounded behavior is surfaced through existing metrics where practical rather than duplicated.

### 5. Transport and replay evidence

Reuse existing replay and queue metrics rather than adding another event path. Diagnostics reads current depth, high-water marks, overflow counts, and replay lag from the server's metric state on demand.

Snapshot and replay duration are recorded at existing boundaries using monotonic timing and a bounded recent history. Exact serialized payload bytes are added only if they can be captured at the existing serializer boundary without serializing the payload a second time. Otherwise this pass explicitly reports that byte attribution is unavailable.

Existing queue overflow, stale generation rejection, snapshot acceptance, and reconnect behavior are unchanged. Diagnostics observes those mechanisms; it does not participate in them.

### 6. Targeted workload reductions

#### Lightweight orchestration snapshots

The legacy HTTP snapshot endpoint and offline CLI consumers that need project or command state use `ProjectionSnapshotQuery.getCommandReadModel()` instead of hydrating full message and activity bodies. Full thread-detail RPCs retain their current data path.

This directly bounds avoidable memory work without changing the public snapshot shape required by those consumers.

#### Stale context-window records

Thread-detail snapshot projection retains only the newest valid context-window activity needed to derive the current context gauge. Other activity kinds and live events remain unchanged. Invalid newer records must not hide the newest valid record.

The pruning happens in the server projection so all clients receive the same bounded snapshot semantics. It does not enter `packages/contracts` as runtime logic.

#### Git status statistics

Tracked worktree and index line statistics use one `git diff HEAD --numstat` call. Repositories without `HEAD` fall back to the existing separate worktree and cached-index commands. Error and noninteractive environment handling remain unchanged.

Default-branch and remote-existence caching are deferred until mutation-driven invalidation can be shared safely across all Git operations.

## Error Handling and Lifecycle Boundaries

- A diagnostics request failure preserves the last successful snapshot with its collection time and exposes the error; it does not trigger reconnect logic.
- Browser and hosted connection state remains sourced from the existing authoritative runtime.
- Queue overflow continues to terminate the affected stream and require normal resynchronization.
- Trace failure health is observational and cannot block provider, terminal, orchestration, or shutdown work.
- Metric read failures degrade the affected optional field rather than failing the full diagnostics snapshot.
- No diagnostic field contains credentials, raw commands, trace payload bodies, private paths, or hosted infrastructure details.

## Contract and Package Boundaries

- `packages/contracts` receives schema additions only when server/client transport requires them.
- Metric reading, scheduling, aggregation, and pruning logic live in server or shared runtime modules, not contracts.
- `packages/client-runtime` remains free of DOM and React Native imports.
- Web-only presentation and reduced-motion styling stay in `apps/web`.
- Hosted Hub and PWA recovery rules remain unchanged.

## Testing and Measurement

Focused tests will cover:

- diagnostics resource history advancing only on requested snapshots;
- no permanent resource-sampling interval;
- bounded histories and metric aggregation;
- trace buffer caps, dropped counts, retry backoff, recovery, flush, and close;
- shared diagnostics rendering and preservation of legacy tools/state;
- stable statuses receiving no infinite animation and reduced-motion behavior;
- lightweight HTTP and offline snapshots avoiding the full projection path;
- latest-valid context-window pruning;
- combined Git numstat and unborn-repository fallback;
- replay/reconnect behavior remaining compatible with existing tests.

Repeatable evidence will include static assertions for removal of the fixed overlay and permanent status animation, unit tests for bounded work, and the existing browser lifecycle suite. Exact before/after CPU or GPU percentages will not be claimed without a repeatable profiler environment.

The complete repository backstop and web browser validation required by `AGENTS.md` will run before handoff.

## Upstream Audit Mapping

| T3Code reference                                       | Ryco conclusion                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #3978 GPU idle and animation reduction                 | Missing in part; implement overlay removal, status duty cycling, and reduced-motion coverage.                                                                              |
| #2679 native diagnostics and bounded background policy | Partially present through Node diagnostics, bounded provider logs, and demand-aware VCS. Implement demand-gated sampling and trace failure bounds; defer a native sidecar. |
| #4177 snapshot/live replay handoff                     | Already functionally present in Ryco's bounded live-first handoff; retain and expose its metrics.                                                                          |
| #4622 redundant activity payload pruning               | Intentionally deferred pending a complete web/mobile field-consumption audit. Context-window pruning is implemented separately.                                            |
| #4705, #4788, #4798 transport compression              | Intentionally deferred pending Ryco payload measurements and compatibility validation across browser, desktop, hosted, server, and mobile clients.                         |
| #4791 stale context trimming                           | Missing; implement latest-valid context-window snapshot pruning.                                                                                                           |
| #4843 Git refresh improvement                          | Missing; implement the combined tracked-file numstat call with unborn fallback.                                                                                            |
| #5008 Git caching                                      | Partially present through upstream-status TTL/cooldown and subscriber-driven refresh; defer additional branch/remote caches until safe mutation invalidation exists.       |
| #5147 bounded resource handling                        | Replay/startup/log bounds are already present; implement lightweight legacy HTTP and offline snapshot consumers plus trace failure bounds.                                 |

## Later Native Monitor Phase

A native sidecar should be considered only if users still cannot attribute CPU, memory, or I/O reliably among the backend, provider children, terminals, and Electron after this pass.

If later justified, it must be one supervised persistent collector with bounded histories, demand-aware streaming, explicit collector-overhead health, process-tree attribution, and privacy-safe metadata. It must not scan by repeatedly spawning `ps` or PowerShell, become a renderer data plane, or bypass hosted lifecycle ownership.
