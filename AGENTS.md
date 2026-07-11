# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## TypeScript

Daily typecheck uses **TS7** (`bun typecheck`). Effect-specific rules still run via patched **TS6** — use `bun run typecheck:effect` when touching Effect code (also enforced in CI). See [docs/typescript.md](docs/typescript.md) for why both coexist.

## Project Snapshot

Ryco is a minimal web GUI for using coding agents including Codex, Claude, GitHub Copilot, OpenCode, and Cursor.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: HTTP/WebSocket backend and `ryco-cli` package. Serves the React app, owns provider sessions, orchestration, persistence, terminals, git/source-control operations, auth, and remote/pairing endpoints.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, settings, project/source-control views, and client-side state. Connects to one or more Ryco servers over WebSocket.
- `apps/desktop`: Electron shell. Starts a desktop-scoped backend process, wires desktop APIs such as file dialogs/updates/SSH prompts, and loads the shared web app.
- `packages/contracts`: Shared Effect Schema schemas and TypeScript contracts for RPC, provider events, orchestration, settings, model/session types, keybindings, source control, and work items. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@ryco/shared/git`) — no barrel index.
- `packages/client-runtime`: Client-side environment/endpoint helpers shared by web and desktop clients.
- `packages/effect-codex-app-server`: Effect-based Codex app-server JSON-RPC protocol/client wrapper.
- `packages/effect-acp`: Effect-based Agent Client Protocol schema/client/agent helpers used by ACP providers.
- `packages/ssh`: SSH config/auth/command/tunnel utilities for desktop-managed remote access.
- `packages/tailscale`: Tailscale endpoint and Serve helpers for remote access.

## Provider Runtime Architecture (Important)

Ryco supports multiple provider drivers: Codex, Claude, GitHub Copilot, OpenCode, and Cursor. Provider instances are configured through `ServerSettings.providerInstances`; each instance has a stable `ProviderInstanceId`, driver-specific config, optional environment variables, display name, accent color, and enabled state.

Current provider runtime shape:

- Built-in drivers are registered in `apps/server/src/provider/builtInDrivers.ts`.
- Driver-specific adapters live under `apps/server/src/provider/Drivers/*Driver.ts` and `apps/server/src/provider/Layers/*Adapter.ts`.
- Provider instance construction and hot reload are coordinated by `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts`.
- Turn/session lifecycle is brokered by `apps/server/src/provider/Layers/ProviderService.ts`.
- Provider runtime events are projected into orchestration by `apps/server/src/orchestration/Services/ProviderRuntimeIngestion.ts`, `ProviderCommandReactor.ts`, `CheckpointReactor.ts`, and `OrchestrationEngine.ts`.
- WebSocket RPC and push streams are routed in `apps/server/src/ws.ts`; orchestration updates are consumed by the web app through the RPC client in `apps/web/src/rpc/`.

Provider protocol notes:

- Codex uses `codex app-server` via JSON-RPC over stdio, wrapped by `packages/effect-codex-app-server`.
- Claude uses the Anthropic Claude Agent SDK.
- Copilot, OpenCode, and Cursor are implemented as first-party drivers; Cursor uses ACP, and shared ACP helpers live in `packages/effect-acp`.

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server
- Provider user guides: `docs/providers/codex.md`, `docs/providers/claude.md`

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
