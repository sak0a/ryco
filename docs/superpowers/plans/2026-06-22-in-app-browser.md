# Built-In In-App Browser Implementation Plan

> **For agentic workers:** this is a cross-cutting feature. Keep each task
> behind explicit contracts and fake-host tests before wiring real provider
> adapters. Do not hide browser behavior under provider-specific shortcuts.

**Goal:** Ship a Ryco-owned isolated browser that can be shown in the right
workspace panel and used by supported providers through a shared control plane
and explicit adapter integrations.

**Spec:** `docs/superpowers/specs/2026-06-22-in-app-browser-design.md`

## Task 1: Browser contracts and shared helpers

**Purpose:** Establish the stable schema surface before server, desktop, web,
and provider code diverge.

**Files likely touched:**

- `packages/contracts/src/browser.ts`
- `packages/contracts/src/browserHostRpc.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/shared/src/browser/*` or equivalent explicit subpath export
- `packages/shared/package.json`

**Steps:**

- [ ] Add browser IDs, profile/session/tab snapshots, commands, events, policy,
      and typed errors to a new contracts module.
- [ ] Add browser RPC method constants and Effect RPC declarations.
- [ ] Add a separate BrowserHost RPC group/schema for host registration,
      heartbeat, command stream, command results, and host events.
- [ ] Extend `EnvironmentApi` with a `browser` aggregate.
- [ ] Extend `DesktopBridge` only with browser-surface geometry methods.
- [ ] Add `browser_tool_call` and browser request types to provider runtime
      contracts.
- [ ] Add shared URL/origin/profile-key helpers outside contracts.
- [ ] Add an explicit `./browser` subpath export to `packages/shared/package.json`.

**Acceptance:**

- Contracts compile without runtime browser logic in `packages/contracts`.
- Origin/profile helper tests cover invalid URLs, local origins, path
  traversal, and long names.
- BrowserHost RPC contracts are distinct from user-facing browser RPC contracts.

## Task 2: Server browser service with fake host

**Purpose:** Build the provider-neutral control plane before real Electron
embedding.

**Files likely touched:**

- `apps/server/src/browser/BrowserHostRegistry.ts`
- `apps/server/src/browser/BrowserService.ts`
- `apps/server/src/browser/BrowserPolicy.ts`
- `apps/server/src/browser/BrowserArtifactStore.ts`
- `apps/server/src/browser/BrowserToolBridge.ts`
- `apps/server/src/auth/Services/BrowserHostAuth.ts`
- `apps/server/src/browserHost/browserHostRpc.ts`
- `apps/server/src/ws/browserRpc.ts`
- `apps/server/src/ws/index.ts`
- `apps/server/src/ws/context.ts`
- `apps/server/src/server.ts`

**Steps:**

- [ ] Implement `BrowserHostRegistry` with host capabilities, heartbeat,
      disconnect handling, and command correlation.
- [ ] Add a dedicated host-auth path using a desktop-host token, not the one-use
      owner desktop bootstrap token.
- [ ] Mount a host-only RPC route such as `/browser-host/ws` with
      `BrowserHostRpcGroup` and local-only auth.
- [ ] Implement `BrowserService` open/close/session/tab/navigation operations
      against a fake host.
- [ ] Add bounded per-tab command queues and cancellation/timeouts.
- [ ] Add origin policy checks and typed approval decisions, including stricter
      handling for unknown localhost/private/link-local targets.
- [ ] Add bounded browser artifact storage for screenshots, large snapshots, and
      download metadata.
- [ ] Add browser RPC handlers following the existing terminal RPC pattern.
- [ ] Wire browser handlers into `makeWsRpcLayer`.
- [ ] Provide Browser services through the server layer graph in
      `apps/server/src/server.ts`.
- [ ] Add tests for host unavailable, profile locked, open/navigate,
      permission ask/deny, command timeout, disconnect, reconnect, and queue
      ordering.
- [ ] Add tests proving owner/user WebSocket auth cannot register a BrowserHost
      and the dedicated host token can register only on the host route.

**Acceptance:**

- WebSocket RPC can operate a fake host end to end.
- Browser policy decisions are server-owned and test-covered.
- The host route and user route have separate auth and schemas.

## Task 3: Desktop BrowserHost and BrowserKernel

**Purpose:** Provide a real isolated Chromium host and native right-panel
surface.

**Files likely touched:**

- `apps/desktop/src/browser/BrowserHostConnection.ts`
- `apps/desktop/src/browser/BrowserHost.ts`
- `apps/desktop/src/browser/BrowserKernel.ts`
- `apps/desktop/src/browser/BrowserProfiles.ts`
- `apps/desktop/src/browser/BrowserSurfaceManager.ts`
- `apps/desktop/src/main.ts` for backend child bootstrap payload, window
  lifecycle, and IPC registration
- `apps/desktop/src/preload.ts`

**Steps:**

- [ ] Generate a dedicated desktop BrowserHost token in Electron main and pass
      it to the backend child over the private bootstrap fd payload.
- [ ] Add an authenticated browser-host connection from Electron main to the
      local backend using that dedicated token.
- [ ] Implement host registration, heartbeat, command receive, result send, and
      event send.
- [ ] Implement profile creation with Electron `session.fromPath` or
      `session.fromPartition` using isolated profile directories/partitions.
- [ ] Implement one `WebContentsView` per tab or selected tab, with hardened web
      preferences.
- [ ] Implement navigation, tab lifecycle, screenshot, DOM/accessibility
      snapshot, click/type/key/scroll, console, and network-summary commands.
- [ ] Implement permission handlers, window-open handling, download handling,
      crash events, and cleanup.
- [ ] Implement profile leases with `BrowserHostRunId`, expiry, and stale-lock
      recovery after desktop crashes.
- [ ] Implement native surface attach/update/detach IPC methods with owner
      checks, bounds clipping, detach-on-hide, and detach-on-window-destroy.
- [ ] Implement download path sanitization, size limits, no auto-open behavior,
      and symlink race protection.
- [ ] Add desktop tests where Electron can be mocked, plus manual smoke
      scripts for persistent profile isolation.

**Acceptance:**

- A fake or real server can command the desktop BrowserHost.
- Two persistent profiles do not share cookies/localStorage.
- Temporary profiles are removed after close.
- Permission prompts default deny unless approved.
- Browser content never shares the Ryco app renderer session.
- Renderer IPC cannot attach a browser view outside its owning window bounds.

## Task 4: Web Browser workspace tab

**Purpose:** Expose the manual side-by-side workflow in the existing right
workspace panel.

**Files likely touched:**

- `apps/web/src/workspaceRouteSearch.ts`
- `apps/web/src/rightPanelRouteSearch.ts`
- `apps/web/src/threadWorkspaceTabs.ts`
- `apps/web/src/components/ThreadWorkspacePanel.tsx`
- `apps/web/src/components/routeViews/ChatThreadRouteView.tsx`
- `apps/web/src/components/routeViews/DraftChatThreadRouteView.tsx`
- `apps/web/src/components/BrowserPanel.tsx`
- `apps/web/src/browser/browserStateStore.ts`
- `apps/web/src/browser/useBrowserSession.ts`
- `apps/web/src/environmentApi.ts`
- `apps/web/src/rpc/wsRpcClient.ts`
- `apps/web/src/components/chat/useChatWorkspacePanels.ts`
- `apps/web/src/components/chat/useChatGlobalShortcuts.ts`

**Steps:**

- [ ] Add `"browser"` to workspace/right-panel route parsing and builders.
- [ ] Enable the existing Browser launcher card.
- [ ] Add Browser as a singleton workspace tab.
- [ ] Extend `ChatThreadRouteView` and `DraftChatThreadRouteView` mount state
      with `hasOpenedBrowser`, opened-mode tracking, close handling, and
      last-opened mode behavior.
- [ ] Add BrowserPanel toolbar and profile selector.
- [ ] Open/focus a browser session through environment RPC.
- [ ] Measure the native surface placeholder with `ResizeObserver`.
- [ ] Send attach/bounds/detach calls through `desktopBridge.browser`.
- [ ] Render unsupported state when the selected environment is not the local
      desktop backend, `desktopBridge.browser` is unavailable, or no browser
      host is connected.
- [ ] Add route-view, route parser, and component tests for
      open/select/close/responsive behavior.

**Acceptance:**

- Browser opens in the right panel next to chat.
- The panel survives route refresh and responsive sheet mode.
- Hiding/closing the panel does not corrupt the native browser surface.
- Remote and browser-only clients do not attempt iframe fallback.

## Task 5: Provider runtime tool registry

**Purpose:** Keep browser execution provider-neutral and avoid duplicate logic
inside each adapter.

**Files likely touched:**

- `apps/server/src/provider/tools/ProviderRuntimeToolRegistry.ts`
- `apps/server/src/provider/tools/BrowserRuntimeTool.ts`
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/provider/Layers/CopilotAdapter.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/acp/AcpSessionRuntime.ts`

**Steps:**

- [ ] Design the adapter contract/capability extension for runtime tool
      definition and execution injection. Do this before wiring concrete
      providers.
- [ ] Add a shared registry for runtime tool definitions and normalized
      execution.
- [ ] Implement browser tool definitions and result normalization.
- [ ] Emit `browser_tool_call` lifecycle events around executions.
- [ ] Wire Codex first using the best-supported current path, likely MCP or
      dynamic tools.
- [ ] Wire Claude through SDK tools and permission hooks.
- [ ] Wire Copilot/OpenCode through their native custom-tool or MCP-equivalent
      paths.
- [ ] Keep Cursor/ACP browser tooling unsupported until Ryco can inject
      MCP/tool definitions into ACP sessions.
- [ ] Add adapter tests for tool definition exposure, command execution,
      approvals, denied origin, and host unavailable.

**Acceptance:**

- At least Codex and Claude can use the same BrowserService-backed browser
  after the adapter contract extension lands.
- Unsupported providers fail explicitly instead of hallucinating a browser.
- No adapter owns browser policy or profile lifecycle locally.

## Task 6: Timeline rendering and approvals

**Purpose:** Make browser actions visible and controllable in the thread UX.

**Files likely touched:**

- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/web/src/components/*Tool*` rendering modules
- `apps/web/src/session-logic.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/browser/BrowserArtifactStore.ts`

**Steps:**

- [ ] Ingest `browser_tool_call` lifecycle events into thread activities.
- [ ] Render browser tool calls with title, URL/origin, action, status, and
      result summary.
- [ ] Render browser approval requests with origin, permission, profile, and
      requested action.
- [ ] Add affordances to open/focus the Browser tab from a browser tool event.
- [ ] Store screenshot/download/large snapshot references as browser artifacts,
      not project files or unbounded event payloads.
- [ ] Add redaction hooks and payload caps for DOM snapshots, console/network
      summaries, screenshots, and artifact previews.
- [ ] Add tests for rendering started/progress/completed/failed/denied states.

**Acceptance:**

- Users can see what the provider did in the browser.
- Browser-origin and permission approvals use the normal Ryco approval flow.
- Large or sensitive browser observations are bounded and artifact-backed.

## Task 7: Settings and profile management

**Purpose:** Give users control over persistence, isolation, and risk.

**Files likely touched:**

- `packages/contracts/src/settings.ts`
- `apps/server/src/serverSettings.ts`
- `apps/web/src/components/settings/*`
- `apps/web/src/components/BrowserPanel.tsx`
- `apps/desktop/src/browser/BrowserProfiles.ts`

**Steps:**

- [ ] Add browser settings: enabled, default manual profile mode, default agent
      profile mode, origin policies, developer mode, download directory, and
      profile cleanup controls.
- [ ] Add Browser profile list/clear/delete UI.
- [ ] Add per-origin allow/deny UI.
- [ ] Add developer mode warning and separate CDP capability gate.
- [ ] Add storage stats where practical.
- [ ] Add stale profile-lock recovery UI for crashed desktop hosts.

**Acceptance:**

- Users can inspect and delete browser profiles.
- Users can revoke origin allow rules.
- Developer mode is opt-in and visibly separate from normal browsing.

## Task 8: Remote and non-desktop follow-up

**Purpose:** Keep the first release honest while leaving a path for browser-only
and remote clients.

**Files likely touched:**

- `apps/server/src/browser/*`
- `apps/web/src/components/BrowserPanel.tsx`
- optional Playwright host package/module

**Steps:**

- [ ] Keep browser-only web clients on an explicit unsupported state for MVP.
- [ ] Keep remote/SSH environments on an explicit unsupported state for MVP.
- [ ] Design a server/headless `BrowserHost` implementation using Playwright
      contexts for remote environments.
- [ ] Add screenshot streaming or DOM-first control if native surface is not
      available.
- [ ] Reuse the same BrowserService, policy, profile, and provider contracts.

**Acceptance:**

- Desktop implementation does not block a future server/headless host.
- No iframe fallback is introduced as a shortcut.

## Validation Checklist

- [ ] `bun fmt`
- [ ] `bun lint`
- [ ] `bun typecheck`
- [ ] `bun run test` for contracts, server browser service, desktop browser
      helpers, web route/panel state, provider adapter integrations, and
      timeline rendering
- [ ] Manual desktop smoke: open right-panel Browser, navigate to local app,
      log in to test site, restart Ryco, verify persistent cookies.
- [ ] Manual isolation smoke: same test site in two profiles, verify cookies do
      not cross profiles.
- [ ] Manual temporary smoke: temporary profile deletes cookies/cache on close.
- [ ] Manual provider smoke: Codex and Claude inspect and click through a local
      app in the same browser panel.
- [ ] Manual security smoke: denied origin, popup, download, camera/microphone,
      and developer-mode gate.
