# Diagnostics Settings Page

## Goal

Add a Diagnostics section to the Settings dialog that gives users a local,
read-only view into Ryco runtime health. The page should make failures and
performance issues inspectable without requiring an external telemetry stack.

The first version covers the current Ryco server/browser session plus a
bounded tail of persisted trace/log files from previous runs. Raw diagnostic
details are available behind expandable rows, with obvious secret-bearing
keys and values redacted before data crosses the RPC boundary.

## Non-goals

- **Full observability database.** Diagnostics will not persist every span,
  metric, or failure into SQLite in this pass.
- **External observability configuration.** OTLP trace/metric settings remain
  in existing settings/config surfaces.
- **Whole-machine process manager.** Live process data focuses on Ryco-owned
  activity such as the server process, provider/runtime summaries, and
  terminal sessions. It is not an OS task manager.
- **Unbounded trace/log browsing.** File reads and in-memory buffers are
  capped to preserve UI and server performance.
- **Raw secret exposure.** The page does not intentionally show environment
  secrets, auth tokens, API keys, or sensitive headers.

## Scope

In scope:

- New diagnostics contracts in `packages/contracts` for a snapshot RPC.
- New server diagnostics service that aggregates bounded runtime and file
  data.
- New WebSocket RPC method `server.getDiagnosticsSnapshot`.
- New `Diagnostics` settings nav item and lazy-loaded panel.
- Lightweight SVG/HTML charts for resource history, span durations, top span
  names, and failure frequency.
- Redacted expandable raw details for spans, span events/logs, failures, and
  parse warnings.
- Focused tests for aggregation, redaction, contract decoding, and UI display
  logic.

Out of scope:

- A long-term metrics schema in SQLite.
- Search across all rotated logs.
- User-configurable diagnostics retention knobs.
- A standalone diagnostics route outside Settings.
- Introducing a charting dependency.

## Architecture

### Contracts

Add a diagnostics contract module under `packages/contracts/src/diagnostics.ts`
and export it from `packages/contracts/src/index.ts`.

The snapshot shape should be explicit and bounded:

- `generatedAt`, `serverStartedAt`, `uptimeMs`.
- `observability` paths and enabled flags already exposed by server config.
- `resources` containing current server process usage and recent resource
  samples.
- `liveProcesses` containing Ryco-owned process/session summaries:
  terminal sessions, provider snapshots, and server process metadata.
- `tracing` containing recent spans, slowest spans, top span names, duration
  buckets, and recent span events/logs.
- `failures` containing latest failures and common failure signatures.
- `client` containing slow RPC acknowledgements reported by the browser when
  available.
- `warnings` for partial collection failures, unreadable files, truncated
  sections, and malformed trace/log records.

Use Effect Schema like the rest of `packages/contracts`. Prefer plain JSON
objects, string timestamps, primitive counters, and capped arrays over nested
class instances.

### Server Diagnostics Service

Add `apps/server/src/diagnostics/Services/Diagnostics.ts` as the service
interface and `apps/server/src/diagnostics/Layers/Diagnostics.ts` as the live
implementation.

Responsibilities:

- Maintain a bounded in-memory ring of recent trace records for the current
  process.
- Maintain bounded resource samples for the server process.
- Read capped tails from `config.serverTracePath`, `config.serverLogPath`, and
  provider event logs when a snapshot is requested.
- Normalize trace records into display-friendly span rows.
- Derive aggregates:
  - latest failures
  - most common failure signatures
  - slowest spans
  - top span names
  - duration histogram buckets
  - recent span events/logs
- Return partial snapshots with warnings instead of failing the whole RPC when
  one collector fails.

The existing observability layer already owns the trace sink. Extend that
path so each trace record can be pushed to both the rotating file sink and the
diagnostics in-memory ring. Browser OTLP traces accepted by
`BrowserTraceCollector` should flow through the same bounded buffer after
decode.

### Resource Sampling

The diagnostics service should sample local server process resources on a
modest interval while the server is alive.

Initial resource fields:

- RSS, heap used, heap total, external memory, and array buffer memory from
  `process.memoryUsage()`.
- CPU user/system deltas from `process.cpuUsage()` converted to a best-effort
  utilization value for the sample window.
- Event-loop delay from `node:perf_hooks` `monitorEventLoopDelay()`.
- Uptime from `process.uptime()`.

Samples are stored in a fixed ring. The UI can chart only the retained
history.

### Live Ryco Activity

Extend existing services only where a read-only diagnostics summary is
needed:

- `TerminalManager` will expose a redacted list of terminal session snapshots
  without terminal history contents.
- Provider activity can reuse current provider status snapshots from
  `ProviderRegistry.getProviders`.
- Slow RPC acknowledgements remain browser-side state and are added by the UI
  to the rendered page rather than persisted server-side.

Avoid exposing terminal scrollback, full provider environment, or raw
subprocess command environments.

### RPC

Add a unary WebSocket RPC:

- Method: `server.getDiagnosticsSnapshot`.
- Access: owner-only, matching other sensitive server inspection methods.
- Success: `DiagnosticsSnapshot`.
- Error: auth error plus a narrow diagnostics error only for unrecoverable
  snapshot failures.

The server implementation should call the diagnostics service and annotate the
RPC with existing RPC instrumentation.

## UI

### Settings Integration

Add `"diagnostics"` to `SettingsSectionId` in
`apps/web/src/settingsDialogStore.ts`.

Add a new nav item to `SettingsDialog.tsx` using lucide `ActivityIcon`. The
panel should be lazy-loaded like other heavier settings panels.

### Panel Layout

Add `apps/web/src/components/settings/DiagnosticsSettings.tsx`.

The panel uses existing `SettingsPageContainer` and `SettingsSection`
patterns, but the content is denser than ordinary settings rows because this
is an inspection dashboard.

Sections:

- **Overview:** compact status strip for uptime, retained trace count,
  latest failure, active provider count, active terminal count, and logs path.
- **Resource History:** memory and CPU/event-loop charts.
- **Tracing:** slowest spans, top span names, duration histogram, and recent
  span events/logs.
- **Failures:** latest failures and most common failure signatures.
- **Live Activity:** provider snapshots and terminal session/process
  summaries.
- **Raw Details:** expandable redacted JSON rows for selected spans, failures,
  log records, and warnings.

Controls:

- Manual refresh button.
- Pause/resume polling toggle.
- Compact time-window selector enabled when the snapshot has at least two
  retained resource samples.

Charts should be small local SVG/HTML components with stable dimensions. Do
not add a charting package for the first version.

### Data Flow

The panel fetches `server.getDiagnosticsSnapshot` through the existing RPC
client/local API path.

Polling:

- Poll on a modest interval only while the Diagnostics panel is mounted and
  not paused.
- Keep the last successful snapshot visible if a poll fails.
- Show collection warnings inline without replacing valid snapshot data.

Client-only diagnostics:

- Use `useSlowRpcAckRequests()` from `apps/web/src/rpc/requestLatencyState.ts`
  to display slow client RPC acknowledgements alongside the server snapshot.
- Client slow RPC rows are not sent back to the server.

### Redaction

Redaction is a server responsibility before returning the snapshot. The UI
should still avoid rendering hidden raw values from separate sources.

Mask values for keys matching common sensitive patterns:

- `token`
- `secret`
- `password`
- `authorization`
- `apiKey`
- `cookie`
- `session`
- `credential`

Keep enough surrounding metadata for debugging: key names, span names,
durations, timestamps, provider ids, and error categories remain visible.

## Error Handling

- Collection failures become `warnings` inside the snapshot when any other
  data can still be returned.
- File tail reads are capped and best-effort. Missing, rotated, or unreadable
  files produce warnings.
- Malformed trace/log lines are skipped and counted in warnings.
- Snapshot arrays are truncated with explicit warning metadata when limits
  are reached.
- Polling failures in the UI show a compact inline error while preserving the
  last successful snapshot.
- Empty states distinguish "no data yet" from "collector failed".

## Performance

- Use fixed-size rings for in-memory traces and resource samples.
- Use capped tail reads, not full-file reads.
- Parse only the retained file tail on demand.
- Avoid expensive process enumeration. Show Ryco-owned sessions and provider
  snapshots instead of scanning the whole OS process table.
- Keep graph rendering simple and dependency-free.
- Poll only while the panel is mounted and visible.

## Testing

Server/contracts:

- Contract decode/encode tests for representative diagnostics snapshots.
- Redaction tests for nested objects, arrays, and suspicious key names.
- Aggregation tests for latest failures, common failure signatures, slowest
  spans, top span names, and histogram buckets.
- File tail tests for capped reads, malformed lines, and rotated/missing
  files.
- Resource sampler tests with injectable clock/process readers.
- RPC wiring test for owner access and partial warnings.

Web:

- Display logic tests for formatters and chart data derivation.
- Diagnostics panel tests for empty, populated, warning, and polling-error
  states.
- Settings dialog smoke test confirming the Diagnostics nav item lazy-loads
  the panel.

Required final checks:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Per repository instructions, do not run `bun test`; use `bun run test` for
any targeted Vitest runs.

## Rollout

Implement in small slices:

1. Contracts and server diagnostics snapshot service.
2. Observability buffer integration and resource sampler.
3. RPC/local API/client wiring.
4. Settings panel with overview, tables, and lightweight charts.
5. Tests and final required checks.

The implementation should keep each collector independently optional so the
page remains useful even when traces are empty, logs are missing, or provider
activity is unavailable.
