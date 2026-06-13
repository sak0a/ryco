# Provider Architecture

The web app communicates with the server over WebSocket using Effect RPC groups from `@ryco/contracts`.

The current first-party provider drivers are:

- `codex`
- `claudeAgent`
- `copilot`
- `opencode`
- `cursor`

## Provider Instances

Runtime routing is instance-based, not driver-kind-based.

- `ProviderDriverKind` names the implementation (`codex`, `claudeAgent`, etc.).
- `ProviderInstanceId` is the stable user-configured routing key (`codex`, `codex_personal`, `claude_openrouter`, etc.).
- `ServerSettings.providerInstances` stores per-instance display name, accent color, enabled state, environment variables, and driver-specific config.
- Legacy `settings.providers.<driver>` values are still bridged into default instances for compatibility.

Built-in drivers are registered in `apps/server/src/provider/builtInDrivers.ts`. Each driver creates one `ProviderInstance` containing a live provider snapshot, session adapter, text-generation adapter, continuation identity, and metadata.

## Runtime Protocols

- Codex uses `codex app-server` over JSON-RPC stdio through `packages/effect-codex-app-server`.
- Claude uses `@anthropic-ai/claude-agent-sdk`.
- GitHub Copilot uses `@github/copilot-sdk`.
- OpenCode uses `@opencode-ai/sdk` and can either spawn OpenCode or connect to a configured server URL.
- Cursor uses the Cursor Agent ACP runtime, with shared ACP helpers in `packages/effect-acp`.

## Client Transport

The web client uses `apps/web/src/rpc/wsTransport.ts` and `apps/web/src/rpc/wsRpcClient.ts` for request/response calls and typed subscriptions. Environment runtime code under `apps/web/src/environments/runtime/` owns connection bootstrapping, reconnects, and multi-environment state.

Important stream families include:

- server lifecycle/config/keybinding/source-control updates
- orchestration shell snapshots and events
- terminal events

Payloads are decoded at the transport boundary using schemas from `@ryco/contracts`.

## Server-Side Orchestration

Provider runtime events flow through queue-based workers:

1. **ProviderRuntimeIngestion** — consumes provider runtime streams, emits orchestration commands
2. **ProviderCommandReactor** — reacts to orchestration intent events, dispatches provider calls
3. **CheckpointReactor** — captures git checkpoints on turn start/complete, publishes runtime receipts

These workers use `DrainableWorker` internally and expose deterministic drain/receipt paths for tests. `OrchestrationEngine` persists domain events and projects read models that the web app consumes.
