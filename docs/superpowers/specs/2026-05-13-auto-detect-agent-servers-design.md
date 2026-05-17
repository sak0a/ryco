# Auto-Detect Agent-Spawned Servers

## Goal

When a coding agent (Codex, Claude/ACP, OpenCode) or a local terminal PTY
spawns a dev server (Vite, Next, Nuxt, Astro, Remix, Wrangler, Vitest UI,
Webpack-DevServer, generic Express, HTTP/SSE MCP servers), surface it in the
web UI with:

1. An "Active Servers" list scoped to the current thread.
2. The server's canonical URL, clickable to open in the browser.
3. A live, xterm.js-style tail of the server's log output.
4. A toolbar badge showing the number of running servers, pulsing while any
   detection is still tentative.

The user wants to know what their agent has running without leaving the
chat.

## Non-goals

- **stdio MCP servers** (those that talk JSON-RPC over stdin/stdout without
  listening on any port). They warrant a different UI affordance and a
  dedicated data model; deferred.
- **NODE_OPTIONS / LD_PRELOAD injection** for low-latency detection.
  Skipped — too fragile across Bun/Deno/Python/Go runtimes.
- **Persistence across `apps/server` restart.** Registry is in-memory only;
  PTY-sourced servers also vanish when the server restarts, so this is
  mostly natural.
- **Cross-thread aggregation.** Servers are scoped to the thread they were
  spawned in.
- **Sidebar route / dedicated full-page view.** Drawer tab is enough.
- **LAN-share URL surfacing** (Vite's `Network:` URL on `0.0.0.0` binds).
  Recorded but not displayed in v1.
- **Auto-open browser on `live`.** Too invasive without user consent.
- **User-extensible regex/framework table.** Hardcoded list only.
- **Server-side log file persistence.** Terminals persist; detected-server
  logs do not.
- **Granular stop for agent-internal servers.** Only "interrupt the turn".
  By design — the agent owns the lifecycle.

## Scope

In scope:

- New backend module `apps/server/src/detectedServers/` (Effect Services +
  Layers) covering detection state machine, OS socket probing, stdout
  sniffing, argv hinting, and liveness heartbeat.
- Schema-only additions to `packages/contracts/src/detectedServers.ts`.
- New WS push channel `detectedServers.event` and streaming RPC
  `subscribeDetectedServerEvents`; new request RPCs `detectedServers.stop`
  and `detectedServers.openInBrowser`.
- Read-only taps into three existing modules to feed the detector:
  - `CodexSessionRuntime.ts` — Codex agent commands
  - `AcpSessionRuntime.ts` — Claude/Cursor agent commands
  - `terminal/Layers/Manager.ts` — local PTYs (user terminal + OpenCode)
- New web UI components: toolbar badge, "Servers" tab inside the existing
  `ThreadTerminalDrawer`, per-server log view (xterm.js), list rows with
  Open / Stop / Copy URL controls.
- New Zustand slice `detectedServerStore.ts`.
- Shared `packages/shared/src/lineBuffer.ts` extracted from the existing
  terminal line-cap logic; reused by both terminals and detected servers.
- Unit + OS-adapter + integration test coverage as outlined in the Testing
  section.

Out of scope: everything in Non-goals.

## Architecture

### Module layout

```
apps/server/src/detectedServers/
  Services/
    DetectedServerRegistry.ts   // public Service tag + API surface
  Layers/
    Registry.ts                 // in-memory map, event publisher, state machine
    ArgvHinter.ts               // tokenize argv + package.json scripts → framework guess
    StdoutSniffer.ts            // ANSI-strip + ordered framework regex table
    SocketProbe.ts              // OS-agnostic facade
    SocketProbe.Linux.ts        // /proc/<pid>/net/tcp parser, pure JS
    SocketProbe.Darwin.ts       // lsof -nP -iTCP -sTCP:LISTEN -a -p <pidlist>
    SocketProbe.Windows.ts      // netstat -ano filtered by pid
    LivenessHeartbeat.ts        // fetch HEAD probe with AbortSignal.timeout
    DetectedServersIngress.ts   // composes provider/PTY taps
  __fixtures__/                 // captured stdout from real frameworks
```

`DetectedServersIngress` is added to the application's layer graph in
`apps/server/src/serverLayers.ts`. The existing provider/terminal modules
expose new emitter taps (event-emit only — no behavior change).

### Data flow

```
Agent tool call (Codex/ACP)        Local PTY (terminal/OpenCode)
        |                                       |
        v                                       v
  outputDelta notification              drainProcessEvents
   + requestApproval                     + pty.pid
        |                                       |
        +-------+               +---------------+
                |               |
                v               v
            ArgvHinter      StdoutSniffer  ← strip-ansi + framework regex
                |               |
                +---+   +-------+
                    |   |
                    v   v
                  Registry  ← state machine, identity keying
                    |
                    +-- SocketProbe (PTY path only, pidtree expansion)
                    +-- LivenessHeartbeat (post-confirmed)
                    |
                    v
        publishes detectedServers.event on ServerPushBus
                    |
                    v
              wsServer → Browser → detectedServerStore
                                  → BranchToolbar badge
                                  → ThreadTerminalDrawer "Servers" tab
                                  → xterm.js log view
```

### State machine

```
predicted → candidate → confirmed → live → (restarting → live | exited | crashed)
predicted → exited    (one-shot build that never opened a socket)
candidate → exited    (URL printed but process exited before confirmation)
```

Transition rules (enforced in `Registry.registerOrUpdate`):

- `predicted`: ArgvHinter says this command is likely a server. No URL yet.
- `candidate`: StdoutSniffer extracted a URL. Source `codex`/`acp` stops
  here — there's no real pid to probe.
- `confirmed`: SocketProbe sees a `LISTEN` socket on the matching port (or
  any port for silent servers without a sniffed URL).
- `live`: LivenessHeartbeat got any response from `fetch(url, { method:
"HEAD" })`. Most servers reach `live` ~100–500 ms after this.
- `restarting`: previously `live`, socket disappeared briefly but pid still
  alive (Vite HMR restart).
- `exited` / `crashed`: terminal state.

Exit triggers per source:

- `pty`: the existing PTY `onExit` callback (`exitCode === 0` → `exited`,
  non-zero → `crashed`), or sustained `lost-socket` from SocketProbe while
  the pid is still alive (rare; treat as `exited` with `exitReason:
"lost-socket"`).
- `codex` / `acp`: the matching command-execution completion notification
  on the provider's event stream. Without a process-exit signal we cannot
  distinguish clean exit from crash; we record both as `exited` with
  `exitReason` derived from the provider's reported result (success →
  `"stopped"`, error → `"crashed"`).

### Identity keying

- Source `pty`: identity = `(threadId, pty.pid, port)`. Stable across Vite
  HMR self-restarts.
- Source `codex` / `acp`: identity = `(threadId, turnId, itemId)`.

### Push channel

New channel `detectedServers.event` published via `ServerPushBus` (same
ordered delivery as `terminal.event`). Event union:

```
DetectedServerEvent =
  | { type: "registered"; server: DetectedServer }
  | { type: "updated";    serverId: string; patch: Partial<DetectedServer> }
  | { type: "log";        serverId: string; data: string }
  | { type: "removed";    serverId: string }
```

## Schema

`packages/contracts/src/detectedServers.ts` (Effect Schema, schema-only):

```
ServerStatus = "predicted" | "candidate" | "confirmed" | "live"
             | "restarting" | "exited" | "crashed"

ServerSource = "codex" | "acp" | "pty"

ServerFramework = "vite" | "next" | "nuxt" | "remix" | "astro" | "wrangler"
                | "webpack" | "vitest-ui" | "storybook" | "mcp-http"
                | "express" | "unknown"

DetectedServer = {
  id: string                      // ulid
  threadId: string
  source: ServerSource
  framework: ServerFramework
  status: ServerStatus
  url?: string                    // canonical click-through
  port?: number
  host?: string                   // "localhost" | "127.0.0.1" | "0.0.0.0" | "[::1]"
  pid?: number                    // present only when source = "pty"
  argv?: ReadonlyArray<string>
  cwd?: string
  startedAt: Date                 // first predicted/candidate signal
  liveAt?: Date                   // first time fetch returned anything
  lastSeenAt: Date
  exitedAt?: Date
  exitReason?: "stopped" | "crashed" | "lost-socket"
}
```

New RPC methods on `NativeApi`:

- `subscribeDetectedServerEvents(threadId)` — streaming
- `detectedServers.stop(serverId)` — request/response; returns
  `{ kind: "stopped" } | { kind: "not-stoppable"; hint: "interrupt-turn" }`
- `detectedServers.openInBrowser(serverId)` — request/response; routes
  through existing `apps/server/src/open.ts`

## Detection pipeline

### ArgvHinter

Pure synchronous + one cached `package.json` read per cwd.

- Token table → framework hint: `vite`, `next`, `nuxt`, `astro`, `remix`,
  `wrangler dev`, `bun run dev`, `npm run dev`, `pnpm dev`, `yarn dev`,
  `vitest --ui`, `storybook dev`, etc.
- Indirect invocations: `npm/bun/pnpm/yarn run <name>` → read
  `<cwd>/package.json` `scripts.<name>` and re-tokenize (one level only).
- Build/test denylist: `build`, `test`, `tsc`, `eslint`, `prettier`,
  `vitest run` (without `--ui`), `playwright test` → `isLikelyServer =
false`.
- Unknown but `dev`/`serve`/`start`/`watch` token → `framework = "unknown",
isLikelyServer = true`.

### StdoutSniffer

- Buffer chunks until `\n` or 64KB.
- Strip ANSI with inline regex `\x1b\[[0-9;]*[a-zA-Z]` (avoids a new
  dependency).
- Collapse whitespace within each line.
- Run ordered regex table (Vite → Next → Nuxt → Astro → Remix → Wrangler →
  Webpack-DevServer → generic loopback).
- First match per line wins; emit `updated` with `status = "candidate"`,
  `url`, `port`, `host`, `framework`.

Generic loopback regex:

```
\bhttps?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:/\S*)?\b
```

### SocketProbe

`probe(pids: number[]): Effect<ProbeResult[]>` returning rows of `{ pid,
port, host }` for sockets in `LISTEN` state owned by any pid in the set.
Process-tree expansion via `pidtree` library (new dep) so Vite's esbuild
worker and Next's worker pool are covered.

OS adapters (selected at layer construction):

- **Linux**: `/proc/<pid>/fd/*` symlink scan for `socket:[<inode>]`,
  cross-referenced against `/proc/<pid>/net/tcp` + `tcp6` rows with `st =
0A`. Pure JS, ~5 ms per pid.
- **Darwin**: shell out to `lsof -nP -iTCP -sTCP:LISTEN -a -p <pidlist>`
  and parse. ~150–400 ms.
- **Windows**: shell out to `netstat -ano` and filter pid column. ~300–800
  ms.

If the per-OS binary is absent at layer init, log once and `probe()`
returns `[]` forever. Detection degrades to stdout-regex only.

Polling cadence: 250 ms during the first 30 s of a `predicted`/`candidate`
server, then 2 s once `live`. Stops on `exited`/`crashed`. Fibers owned by
the registry, interrupted by the layer finalizer.

Debugger-port denylist: `9229`, `9230`, plus any port matched by
`--inspect(-brk|-wait)?=([0-9]+)` regex in argv.

### LivenessHeartbeat

After `confirmed`: `fetch(url, { signal: AbortSignal.timeout(500), method:
"HEAD" })` every 5 s. Any response (2xx/3xx/4xx/5xx) → `live`. Failure:
re-run SocketProbe; if socket gone → `exited` (`exitReason: "lost-socket"`);
if still present → leave as-is (HEAD-unsupported server).

### Registry

Owns `Map<serverId, DetectedServer>`. Single mutation entry point
`registerOrUpdate(input)`. Enforces:

- Only legal state transitions.
- Identity-keying rules (recognise restart vs new identity).
- Per-server probe-fiber lifecycle.
- Event emission on every mutation.

Public reads: `subscribe(threadId)`, `getCurrent(threadId)` (used to replay
state to newly-subscribing clients).

### Per-provider wiring

- **Codex** (`CodexSessionRuntime.ts`):
  - On `item/commandExecution/requestApproval` with `requestKind:
"command"` → `ArgvHinter.hint(payload.argv, payload.cwd)`; if
    `isLikelyServer`, register with `source: "codex"`, `status:
"predicted"`.
  - On `item/commandExecution/outputDelta` for the matching `(turnId,
itemId)` → feed `StdoutSniffer`.
  - No SocketProbe (no real pid).

- **ACP** (`AcpSessionRuntime.ts`): mirrors the Codex hooks on the ACP
  event shape.

- **PTY** (`terminal/Layers/Manager.ts`):
  - On PTY spawn → `ArgvHinter` from `terminalState.argv`.
  - On each output chunk in `drainProcessEvents` → feed `StdoutSniffer`.
  - Pass `pty.pid` to `SocketProbe`; begin polling.
  - All four signals (hint, stdout, socket, heartbeat) active.

## Web UI

### Toolbar badge

`apps/web/src/components/BranchToolbar/DetectedServersBadge.tsx` (new),
slotted into the existing `BranchToolbar.tsx` to the right of the terminal
toggle.

- Hidden when no detected servers for the current thread.
- Lucide `Server` icon + numeric count.
- Pulse-dot styling reused from `ChatSessionTabs` `in_progress` while any
  server is `predicted` or `candidate`.
- Tooltip lists each server: `framework · url · status`.
- Click → opens drawer with the Servers tab active.

### Drawer tab

`ThreadTerminalDrawer.tsx` (modified) gains a top-level **kind tabset**
(`Terminals` / `Servers`). The existing terminal tab system stays inside
the `Terminals` kind unchanged.

Inside the `Servers` kind: `apps/web/src/components/detectedServers/`:

- `DetectedServersPanel.tsx` — left rail (list) + main area (log view).
- `DetectedServerRow.tsx` — framework icon, URL (or `[stdio]` placeholder
  for non-URL), status pill, age. Hover-controls: Open, Stop, Copy URL.
- `DetectedServerLogView.tsx` — xterm.js mount, mirrors the existing
  terminal-drawer write pattern; subscribes to `log` events from the store.

Empty state: muted message "No servers detected yet. They'll appear here
when an agent runs `dev`/`serve` commands."

### State

New store `apps/web/src/detectedServerStore.ts` (Zustand):

```
{
  serversByThreadKey: Record<threadKey, Map<serverId, DetectedServer>>
  logBuffersByServerId: Map<serverId, string[]>   // 5000-line cap
  activeServerIdByThreadKey: Record<threadKey, serverId | null>
}
```

`terminalStateStore` gains one field per thread:
`terminalDrawerKind: "terminals" | "servers"` (default `"terminals"`),
persisted to localStorage alongside drawer height.

### WS subscription

`apps/web/src/rpc/wsRpcClient.ts` gains
`subscribeDetectedServerEvents(threadId, listener) → unsubscribe`,
mirroring the existing `terminal.onEvent` pattern. `ChatView` subscribes in
`useEffect` on the active thread, dispatches to `detectedServerStore`.

### Stop semantics

- Source `pty`: `Registry.stop` → `terminalManager.stopProcess(pid)`
  (SIGTERM→SIGKILL via existing escalation).
- Source `codex`/`acp`: RPC returns `{ kind: "not-stoppable", hint:
"interrupt-turn" }`. UI shows inline tooltip "This server is managed by
  the agent — interrupt the current turn to stop it" with a button calling
  `providers.interruptTurn`.

## Edge cases

- **Tunnel clients** (ngrok, cloudflared, Tailscale serve): SocketProbe
  filters strictly on `LISTEN`. StdoutSniffer URLs do not auto-promote to
  `live` for source `pty` without socket confirmation.
- **Debugger ports**: hard denylist + argv regex.
- **One-shot builds**: ArgvHinter denylist catches `build`/`test`/`tsc`
  up front; belt-and-braces: predicted + no socket + no URL after 15 s +
  exit → silently discard (no `removed` event published since nothing was
  ever surfaced beyond predicted).
- **Vite HMR self-restart**: same pid + same port → `live → restarting →
live` on the same `serverId`.
- **Page reload**: on `subscribeDetectedServerEvents`, the server first
  yields one synthetic `registered` event per current server in that
  thread (snapshot from `Registry.getCurrent(threadId)`), then streams
  incremental events. Mirrors how terminal `open()` returns a snapshot
  followed by event subscription. No backwards `log`-history replay in v1
  — late subscribers see only logs from the moment they connect.
- **Server restart**: registry wiped; PTYs also wiped → no orphans.
- **OS adapter absent**: graceful degradation to stdout-only detection.
- **URL canonicalization**: prefer the framework-printed host; fall back to
  `http://localhost:<port>` for socket-only discovery. `0.0.0.0` displayed
  as `http://localhost:<port>` with bind host recorded separately.
- **HTTP/SSE MCP**: detected via the same pipeline; `framework: "mcp-http"`
  if the URL path contains `/sse` or `/mcp`, or a `GET /` probe response
  carries `text/event-stream`. (The probe is part of LivenessHeartbeat for
  this framework only — avoids per-framework heartbeat sprawl.)

## Testing

Vitest. `bun run test` (per AGENTS.md — never `bun test`).

### Unit (no I/O)

- `ArgvHinter.test.ts` — table-driven coverage of all listed frameworks +
  build/test denylist + indirect `npm/bun run` re-scan path (using a
  `MemoryFileSystem` Effect layer for the package.json read).
- `StdoutSniffer.test.ts` — fixture-driven; real captured stdout in
  `__fixtures__/`. One fixture per framework. Verifies ANSI strip,
  split-across-chunk assembly, regex precedence.
- `Registry.test.ts` — state-machine transitions (legal and illegal);
  identity-keying for restart vs new identity.
- `LineBuffer.test.ts` (in `packages/shared`) — cap behavior, head-trim,
  multi-byte safety.

### OS adapters (mocked)

- `SocketProbe.Linux.test.ts` — fixture `/proc/<pid>/net/tcp` and
  `tcp6` text, inode → fd cross-reference.
- `SocketProbe.Darwin.test.ts` — mocked `lsof` output strings.
- `SocketProbe.Windows.test.ts` — mocked `netstat -ano` output strings.

### Integration

- `apps/server/integration/detectedServersPty.integration.test.ts` — spawn
  a real tiny Node HTTP server inside `TerminalManager`; assert the
  pipeline produces `predicted → candidate → confirmed → live` via the WS
  push channel.
- `apps/server/integration/detectedServersCodex.integration.test.ts` —
  drive `TestProviderAdapter` with synthetic `outputDelta` notifications
  mimicking Vite output; assert `predicted → candidate` (no `live` is
  correct for agent-internal).

### Web

- `detectedServerStore.test.ts` — reducer-style tests for event handling.
- `DetectedServersBadge.test.tsx` — 0 / 1 / many; pulsing class.

### Excluded

- Real-network LivenessHeartbeat tests.
- Cross-OS native SocketProbe (each adapter tested via mocks; native runs
  only in whatever runner is current).
- xterm.js DOM correctness (covered by existing terminal tests).

### Gate

`bun fmt`, `bun lint`, `bun run typecheck`, `bun run test` all green.

## Dependencies

- New runtime dep: `pidtree` (~30 KB, no native code).
- No new web deps.
- No new dev deps.

## File-level summary

```
apps/server/src/detectedServers/
  Services/DetectedServerRegistry.ts                       (new)
  Layers/Registry.ts                                       (new)
  Layers/ArgvHinter.ts                                     (new)
  Layers/StdoutSniffer.ts                                  (new)
  Layers/SocketProbe.ts                                    (new)
  Layers/SocketProbe.Linux.ts                              (new)
  Layers/SocketProbe.Darwin.ts                             (new)
  Layers/SocketProbe.Windows.ts                            (new)
  Layers/LivenessHeartbeat.ts                              (new)
  Layers/DetectedServersIngress.ts                         (new)
  __fixtures__/*                                           (new)
  ArgvHinter.test.ts, StdoutSniffer.test.ts, Registry.test.ts (new)
  SocketProbe.{Linux,Darwin,Windows}.test.ts               (new)

apps/server/src/
  serverLayers.ts                                          (modified: + ingress)
  ws.ts                                                    (modified: + RPC handlers)
  provider/Layers/CodexSessionRuntime.ts                   (modified: + emitter taps)
  provider/acp/AcpSessionRuntime.ts                        (modified: + emitter taps)
  terminal/Layers/Manager.ts                               (modified: + emitter taps)

apps/server/integration/
  detectedServersPty.integration.test.ts                   (new)
  detectedServersCodex.integration.test.ts                 (new)

packages/contracts/src/
  detectedServers.ts                                       (new)
  rpc.ts                                                   (modified: + 3 RPCs)
  ws.ts                                                    (modified: + 1 channel)

packages/shared/src/
  lineBuffer.ts                                            (new — extracted shared util)
  lineBuffer.test.ts                                       (new)

apps/web/src/
  detectedServerStore.ts                                   (new)
  detectedServerStore.test.ts                              (new)
  rpc/wsRpcClient.ts                                       (modified: + subscribe)
  components/BranchToolbar.tsx                             (modified: + badge slot)
  components/BranchToolbar/DetectedServersBadge.tsx        (new)
  components/BranchToolbar/DetectedServersBadge.test.tsx   (new)
  components/ThreadTerminalDrawer.tsx                      (modified: + kind tabset)
  components/detectedServers/DetectedServersPanel.tsx      (new)
  components/detectedServers/DetectedServerRow.tsx         (new)
  components/detectedServers/DetectedServerLogView.tsx     (new)
```

## Open questions

None blocking — all design forks resolved during brainstorming.

## References

- Architecture: `.docs/architecture.md`
- Provider architecture: `.docs/provider-architecture.md`
- Existing terminal infrastructure: `apps/server/src/terminal/`,
  `apps/web/src/components/ThreadTerminalDrawer.tsx`
- Existing process detection primitives:
  `apps/server/src/terminal/Services/Manager.ts` (subprocess polling)
- Push channel pattern: `packages/contracts/src/ws.ts`,
  `apps/server/src/wsServer/pushBus.ts`
