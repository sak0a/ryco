# Workspace layout

- `/apps/server`: HTTP/WebSocket backend and `ryco-cli` package. Serves the built web app, owns orchestration, provider sessions, persistence, terminals, git/source-control operations, auth, and remote/pairing endpoints.
- `/apps/web`: React + Vite UI. Session control, conversation/event rendering, settings, source-control/project views, and client-side environment state. Connects to one or more Ryco servers over WebSocket.
- `/apps/desktop`: Electron shell. Spawns a desktop-scoped `ryco` backend process and loads the shared web app.
- `/apps/mobile`: Expo / React Native native app (iOS first). Consumes `/packages/client-runtime` and owns only its platform adapters, local native modules, and screens.
- `/packages/contracts`: Shared Effect Schema schemas and TypeScript contracts for RPC, provider events, orchestration, settings, model/session types, keybindings, source control, and work items. Keep runtime logic out of this package.
- `/packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@ryco/shared/git`, `@ryco/shared/DrainableWorker`) — no barrel index.
- `/packages/client-runtime`: The shared client runtime for web, desktop, and mobile — `platform` contracts, rpc transport, connection catalog/supervision, authorization (cookie and DPoP bearer modes), the relay client, and the `state/*` domains. Platform-agnostic: no DOM or React Native imports.
- `/packages/effect-codex-app-server`: Effect-based Codex app-server JSON-RPC protocol/client wrapper.
- `/packages/effect-acp`: Effect-based Agent Client Protocol schema/client/agent helpers.
- `/packages/ssh`: SSH config/auth/command/tunnel utilities for desktop-managed remote access.
- `/packages/tailscale`: Tailscale endpoint and Serve helpers for remote access.
