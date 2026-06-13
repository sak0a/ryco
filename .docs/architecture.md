# Architecture

Ryco is an Effect/TypeScript local runtime with a React client. One Ryco server owns provider sessions, orchestration, git/source-control operations, terminals, filesystem access, auth, settings, and persistence. Clients connect to that server over HTTP/WebSocket.

```text
┌──────────────────────────────────────────────┐
│ React client (web or Electron renderer)      │
│ - RPC transport and typed subscriptions      │
│ - settings, project, thread, terminal UI     │
│ - saved environment connection state         │
└──────────────────────┬───────────────────────┘
                       │ HTTP + WebSocket
┌──────────────────────▼───────────────────────┐
│ apps/server                                  │
│ - HTTP routes and WebSocket RPC              │
│ - orchestration engine and projection layer  │
│ - provider registry/service/adapters         │
│ - git, VCS, source control, terminal layers  │
│ - SQLite persistence and observability       │
└──────────────────────┬───────────────────────┘
                       │ provider-specific protocols
┌──────────────────────▼───────────────────────┐
│ Provider runtimes                            │
│ - Codex app-server JSON-RPC over stdio       │
│ - Claude Agent SDK                           │
│ - Copilot SDK                                │
│ - OpenCode SDK/server                        │
│ - Cursor ACP runtime                         │
└──────────────────────────────────────────────┘
```

## Runtime Components

- **Client app**: `apps/web` renders thread state, settings, source-control/project views, terminals, and environment connection state. The RPC transport lives under `apps/web/src/rpc/`; multi-environment connection orchestration lives under `apps/web/src/environments/runtime/`.
- **Desktop shell**: `apps/desktop` starts a desktop-scoped backend process, exposes desktop APIs, handles app updates, and loads the same web app.
- **Server**: `apps/server/src/server.ts` builds the runtime layer graph. `apps/server/src/ws.ts` defines WebSocket RPC handlers and subscriptions.
- **Provider runtime**: provider instances are built from `apps/server/src/provider/builtInDrivers.ts` and routed through `ProviderInstanceRegistry`, `ProviderRegistry`, and `ProviderService`.
- **Orchestration**: `apps/server/src/orchestration/` owns command validation, event persistence, projection, provider command reaction, runtime ingestion, checkpointing, and thread deletion.
- **Persistence**: SQLite repositories under `apps/server/src/persistence/` store projects, threads, orchestration events, runtime bindings, worktrees, secrets metadata, and related state.

## Startup and Client Connect

1. The CLI or desktop shell resolves `ServerConfig`, ensures runtime directories, then runs `apps/server/src/server.ts`.
2. Startup services initialize persistence, keybindings, settings, provider instances, source-control discovery, and the orchestration runtime.
3. The web app creates a `WsRpcClient`, subscribes to server lifecycle/config and orchestration streams, and waits for an initial shell snapshot before treating the environment as bootstrapped.
4. Saved environments use the same HTTP/WebSocket protocol; only the endpoint and persisted auth secret differ.

## User Turn Flow

1. The composer dispatches an orchestration command through the WebSocket RPC client.
2. `apps/server/src/ws.ts` validates the RPC input and routes it to the orchestration engine.
3. Provider command reactors start or resume provider sessions through `ProviderService`.
4. Provider-native events are ingested by `ProviderRuntimeIngestion` and normalized into orchestration events.
5. The orchestration projector updates read models and streams shell/domain changes back to subscribed clients.
6. Checkpoint workers capture git state and turn diffs so the UI can show file changes and support revert/review workflows.

## Async Completion

Long-running flows run through queue-backed workers. Runtime receipts mark important milestones such as provider turn completion, checkpoint completion, diff finalization, and quiescence. Tests should wait on these receipts or worker drains instead of polling internal state.

## Key Source Files

- Server entry/layer graph: `apps/server/src/server.ts`
- WebSocket RPC and subscriptions: `apps/server/src/ws.ts`
- Provider drivers: `apps/server/src/provider/Drivers/`
- Provider instance registry: `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts`
- Provider service: `apps/server/src/provider/Layers/ProviderService.ts`
- Orchestration runtime: `apps/server/src/orchestration/runtimeLayer.ts`
- Web RPC transport: `apps/web/src/rpc/wsTransport.ts`
- Web RPC client: `apps/web/src/rpc/wsRpcClient.ts`
- Environment runtime: `apps/web/src/environments/runtime/`
- Shared contracts: `packages/contracts/src/`
