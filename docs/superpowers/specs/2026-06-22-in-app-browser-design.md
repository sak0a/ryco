# Built-In In-App Browser Design

## Goal

Add a fully functioning Ryco-owned browser that can sit in the right workspace
panel next to chat and can be used by supported provider instances through
explicit shared runtime-tool integrations.

The browser must be isolated from the user's normal system browsers. It should
have its own cache, cookies, permissions, downloads, and profile lifecycle, so
users can sign into services inside Ryco without leaking those sessions into
Chrome, Safari, Firefox, or the Electron shell that renders Ryco itself.

The end state is:

- A `Browser` workspace tab in the existing right panel beside `Files`,
  `Review`, `Terminal`, and agent tabs.
- Real browser profile persistence with cookies/cache/local storage.
- Temporary and persistent isolated profiles.
- A provider-neutral browser control plane that Codex, Claude, Copilot,
  OpenCode, and future supported drivers can use through thin adapters. Cursor
  joins once Ryco has ACP MCP/tool injection.
- Durable browser tool events in Ryco's thread timeline and approvals.
- A security model for origins, credentials, downloads, uploads, permissions,
  and optional developer/CDP access.

## MVP Scope

The first implementation is desktop-local only:

- The Electron desktop process hosts the browser.
- The hosted browser registers only with the local desktop-managed backend child
  process started by `apps/desktop`.
- Browser-only web clients and remote/SSH environments show an explicit
  unsupported state.
- Provider browser tools are available only for sessions running on that local
  desktop backend and only while a desktop BrowserHost is connected.

Remote/headless browser hosts are future work. The contracts should allow them,
but the first implementation must not imply that one desktop BrowserHost can
serve arbitrary remote Ryco environments.

## Research Baseline

The public OpenAI Codex app browser design is the closest product reference,
but not a complete implementation reference. The public docs describe a shared
in-app browser view optimized for local, file-backed, and public pages, while
signed-in/default-browser state is handled through a separate Chrome extension
path. The docs also expose origin allow/block policies and a developer mode
that enables deeper browser control.

Ryco should copy the architectural split, not the exact product constraints:

- Use an in-app isolated browser first.
- Treat access to signed-in pages and persistent credentials as higher risk.
- Keep an explicit origin policy and permission surface.
- Keep deep browser/CDP powers behind a separate developer-mode setting.

Additional implementation references:

- Electron `session` supports isolated persistent or in-memory sessions by
  partition/path, including independent cookies and cache.
- Electron `WebContentsView` is the modern native embedding primitive for
  showing Chromium content inside the app window.
- Electron `<webview>` is explicitly discouraged for many app designs; it also
  pushes too much lifecycle and permission handling into renderer markup.
- Playwright BrowserContext/persistent context and Playwright MCP validate the
  profile model: isolated contexts, persistent user data dirs, single-writer
  profile locks, `--isolated`, `--storage-state`, and host allow/block lists.
- The local OpenAI Browser plugin API exposes a useful agent-facing shape:
  browser list/get, tabs, navigation, screenshots, DOM snapshots, locators,
  keyboard/mouse actions, console/devtools access, and capability flags.

## Current Ryco State

Ryco has most of the shell needed for the UX, but no real browser runtime.

- `apps/web/src/components/ThreadWorkspacePanel.tsx` already has a disabled
  `Browser` launcher card with `GlobeIcon`.
- `apps/web/src/workspaceRouteSearch.ts` and
  `apps/web/src/rightPanelRouteSearch.ts` currently model only `review`,
  `files`, `terminal`, and `agent` workspace modes.
- `apps/web/src/components/ChatRightPanel.tsx` already mounts the right panel as
  a resizable sibling next to chat, with sheet behavior on narrow screens.
- `apps/desktop/src/main.ts` creates a hardened Electron main window with
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a
  denied `window.open` policy.
- `apps/desktop/src/preload.ts` exposes a narrow `desktopBridge`, currently
  limited to shell, settings, SSH, update, context menu, and file-dialog APIs.
- `apps/server/src/ws/index.ts` composes WebSocket RPC handlers for
  orchestration, provider, source control, project, git, and terminal. There is
  no browser RPC aggregate.
- `packages/contracts/src/rpc.ts` and `packages/contracts/src/ipc.ts` expose no
  browser schemas or APIs.
- `packages/contracts/src/providerRuntime.ts` has generic tool lifecycle types
  such as `dynamic_tool_call`, `mcp_tool_call`, `web_search`, and `image_view`,
  but no browser-specific item type or request type.
- Provider adapters map provider-specific tool and approval events into
  canonical runtime events, but MCP support is uneven across providers.
- `apps/server/src/open.ts` opens URLs externally in the user's normal browser;
  it is not an isolated browser runtime.

The UI slot exists, and the provider runtime has the right concept of tool
lifecycle events. The missing piece is an explicit browser service, host bridge,
contract surface, and provider tool bridge.

## Core Decision

Use a desktop-hosted native Electron browser surface for the first complete
implementation, with a server-side browser control plane in front of it.

The browser itself should live in the Electron main process as a
`WebContentsView` backed by dedicated Electron `session` objects. The server
child process should own provider-neutral browser commands, policy, approvals,
tool events, and persistence metadata. The desktop main process registers as a
`BrowserHost` with the local backend over a dedicated authenticated local
bridge.

This gives Ryco all three required properties:

- Real embedded browser UX in the right pane.
- Isolation from system browsers and the Ryco app renderer.
- Provider-neutral server access for every adapter.

Do not build the feature as a React `iframe`. Arbitrary sites block framing,
cookies and permissions cannot be controlled well, and provider automation would
not have a robust target. Do not build the first implementation directly around
Electron `<webview>`; Electron recommends alternatives for many apps and the
main process should own permission and lifecycle policy.

## Architecture

### Components

#### Browser Contracts

Add a schema-only module:

- `packages/contracts/src/browser.ts`
- `packages/contracts/src/browserHostRpc.ts` if the host RPC group is kept
  separate from user-facing browser RPC declarations.

Suggested schema groups:

- IDs: `BrowserHostId`, `BrowserProfileId`, `BrowserSessionId`,
  `BrowserTabId`, `BrowserCommandId`, `BrowserPermissionRequestId`.
- Profile model: `BrowserProfile`, `BrowserProfileMode`,
  `BrowserProfileScope`, `BrowserProfileStorageStats`.
- Session/tab snapshots: `BrowserSessionSnapshot`, `BrowserTabSnapshot`,
  `BrowserNavigationState`.
- Commands: open/close session, tab operations, navigation, input, DOM snapshot,
  screenshot, console/network reads, download/upload operations, profile data
  clearing.
- Events: host connected/disconnected, session opened/closed, tab created,
  selected, navigated, title changed, loading state, crashed, permission
  requested/resolved, download started/progress/completed, command progress,
  command completed/failed.
- Policy: `BrowserOriginPolicy`, `BrowserPermissionPolicy`,
  `BrowserToolAccessDecision`.
- Errors: host unavailable, profile locked, tab not found, navigation blocked,
  origin denied, permission denied, command timed out, unsupported capability.

Keep this package schema-only. Put URL normalization, profile-path sanitization,
and origin matching in `packages/shared/browser` if they need to be used by
server and desktop. Because `packages/shared` uses explicit subpath exports,
adding this helper module also requires a `./browser` export in
`packages/shared/package.json`.

#### Server Browser Control Plane

Add server services:

- `apps/server/src/browser/BrowserHostRegistry.ts`
- `apps/server/src/browser/BrowserService.ts`
- `apps/server/src/browser/BrowserPolicy.ts`
- `apps/server/src/browser/BrowserArtifactStore.ts`
- `apps/server/src/browser/BrowserToolBridge.ts`
- `apps/server/src/ws/browserRpc.ts`
- `apps/server/src/browserHost/browserHostRpc.ts`
- `apps/server/src/auth/Services/BrowserHostAuth.ts`

Responsibilities:

- Track connected browser hosts and their capabilities.
- Allocate browser sessions and tabs for a thread/profile.
- Enforce origin, permission, download, upload, and developer-mode policy.
- Serialize commands per tab with bounded queues and cancellation.
- Correlate host events with RPC responses and provider tool events.
- Persist policy/profile metadata in server settings or a dedicated persistence
  table.
- Provide provider-neutral tool definitions and execute browser tool calls.
- Store browser screenshots, large DOM snapshots, and download metadata as
  bounded browser artifacts instead of unbounded provider event payloads or
  project files.

The server should not render browser content. It should broker control and
policy so every provider sees the same browser surface.

Wire these services through the normal server layer graph in `apps/server/src/server.ts`
and expose them through `apps/server/src/ws/context.ts` where user RPC handlers
need them.

#### Browser Host Authentication

Do not reuse the existing desktop bootstrap token for BrowserHost registration.
That token is seeded as a one-use owner bootstrap grant and may already be
consumed by the desktop renderer/user session.

Add a separate desktop-host credential flow:

- Desktop main generates a high-entropy `desktopHostToken` and passes it to the
  backend child over the existing private bootstrap fd payload.
- The backend stores it only in memory with a role such as
  `desktop-browser-host`.
- The token is never exposed through `preload.ts`, `desktopBridge`, URL search
  params, local storage, or renderer process state.
- The token is scoped to loopback/local desktop operation, expires on backend
  restart, and can be rotated if the BrowserHost reconnects.
- `BrowserHostAuth` validates this token on the host-only WebSocket route and
  rejects normal owner/user WebSocket tokens on that route.

This keeps the browser host trusted enough to execute native browser commands
without giving the renderer a reusable privileged host token.

#### Browser Host RPC Channel

Use a separate host route and RPC group rather than overloading `/ws`:

- User/UI RPC: existing `/ws`, `WsRpcGroup`, owner session auth, methods such as
  `browser.openSession` and `browser.navigate`.
- Host RPC: new `/browser-host/ws` or equivalent local-only route,
  `BrowserHostRpcGroup`, `desktop-browser-host` auth, host registration,
  heartbeat, command stream, command results, and browser events.

The host channel should be local-only for MVP and reject unexpected origins,
non-loopback hosts, missing host tokens, and owner/user tokens. Commands are
correlated by `BrowserCommandId`, and reconnects use a `BrowserHostRunId` so
the server can distinguish stale events from a previous desktop process.

#### Desktop Browser Host

Add desktop main-process modules:

- `apps/desktop/src/browser/BrowserHost.ts`
- `apps/desktop/src/browser/BrowserKernel.ts`
- `apps/desktop/src/browser/BrowserProfiles.ts`
- `apps/desktop/src/browser/BrowserSurfaceManager.ts`
- `apps/desktop/src/browser/BrowserHostConnection.ts`

Responsibilities:

- Connect to the local backend with the dedicated desktop BrowserHost token, not
  the one-use owner bootstrap token.
- Register host capabilities and send heartbeats.
- Create Electron `session` objects using isolated persistent paths or
  in-memory partitions.
- Create and own `WebContentsView` instances for tabs.
- Attach/detach/position native browser views based on renderer-provided panel
  bounds.
- Own `setWindowOpenHandler`, permission handlers, downloads, context menus,
  crash handling, and optional devtools/CDP access.
- Emit normalized browser events back to the server.

The existing Ryco app renderer remains sandboxed. The embedded browser content
must not get Node integration and must not share the Ryco renderer session.

#### Web Browser Panel

Add web modules:

- `apps/web/src/components/BrowserPanel.tsx`
- `apps/web/src/browser/browserStateStore.ts`
- `apps/web/src/browser/useBrowserSession.ts`
- `apps/web/src/browser/browserUrl.ts`

Extend existing route state:

- `WorkspacePanelTab`: add `"browser"`.
- `RightPanelMode`: add `"browser"`.
- Add `buildOpenBrowserSearch`.
- Enable the existing Browser launcher card.
- Add a browser tab entry in `threadWorkspaceTabs.ts`.
- Extend route-view mount state in both chat and draft route views so `browser`
  is tracked like `review`, `files`, and `terminal`.

The panel renders:

- Toolbar: back, forward, reload/stop, address field, profile menu, origin
  policy indicator, open-external button, optional devtools button.
- Native surface placeholder: a measured div whose bounds are sent through
  `desktopBridge.browser.setSurfaceBounds`.
- Status overlays: no host, profile locked, permission pending, crashed,
  unsupported in browser-only web clients.

The toolbar and state should come from server RPC. Only native view geometry
goes directly through desktop IPC.

#### Provider Tool Bridge

Add a shared provider runtime tool layer rather than hard-coding browser logic
inside every adapter:

- `apps/server/src/provider/tools/ProviderRuntimeToolRegistry.ts`
- `apps/server/src/provider/tools/BrowserRuntimeTool.ts`

Responsibilities:

- Expose browser tool definitions in provider-native format.
- Execute normalized tool calls through `BrowserService`.
- Emit canonical browser tool lifecycle events.
- Convert provider-specific approval/user-input callbacks into shared browser
  approval requests where possible.
- Extend `ProviderAdapterShape` or adjacent adapter construction inputs with
  explicit runtime-tool capabilities before wiring concrete providers. The
  current adapter contract has no generic custom-tool definition/executor hook.

Each adapter then needs only a thin integration:

- Codex: prefer MCP or app-server dynamic tools if supported in the current
  app-server path. Map browser-origin approvals to canonical requests.
- Claude: expose SDK tools and route `tool_use` through the shared executor.
- Copilot: replace the current plain "Chromium is available" hint with actual
  tool definitions or the closest supported custom-tool bridge.
- OpenCode: expose browser tools through its native tool/MCP layer where
  possible and map permission events.
- Cursor/ACP: keep browser tools explicitly unsupported until Ryco can inject
  MCP/tool definitions into ACP sessions. Current ACP sessions start with empty
  `mcpServers`.

MCP is a good adapter path where a provider supports it, but it should not be
the Ryco control plane. Current Ryco MCP management is Codex-centric and Cursor
starts sessions with empty `mcpServers`, so a server-owned browser service is
the durable provider-neutral abstraction.

## Browser Profiles

### Profile Modes

Use explicit modes:

- `temporary`: in-memory, deleted on close. Good for untrusted browsing or quick
  local testing.
- `thread`: persistent per thread. Good when an agent needs continuity during a
  task but not across unrelated work.
- `worktree`: persistent per worktree/project checkout. Good for app testing.
- `project`: persistent per project. Good default for manual user workflows.
- `named`: user-created persistent profile for a specific account or site.

Default recommendation:

- Manual Browser panel: `project` profile.
- Agent-created session: `thread` profile unless the user selects another.
- Sensitive or unknown origin: offer `temporary` profile.

### Storage Location

Desktop browser profile data should live under the desktop app data directory,
not inside the user's normal browser profile and not inside project source:

```text
<electron app userData>/browser-profiles/<profile-id>/
```

The server stores metadata and policy, but the actual Chromium cookie/cache data
is owned by the active browser host. This matches the desktop-local MVP. A
future server/headless host can use the same contracts with different storage.

### Locks and Cleanup

Persistent Chromium profiles are single-writer. Add an explicit lock per
profile:

- Opening a profile that is already attached returns `profile_locked`.
- UI should offer "focus existing session" instead of silently creating a
  second browser.
- Locks include `BrowserHostRunId`, lease expiry, and last heartbeat so stale
  locks can be recovered after a desktop crash.
- Temporary profiles are deleted when their owning session closes.
- Persistent profiles can be cleared or deleted from settings/profile menu.
- Add storage stats and "clear cookies/cache/site data" controls.

## Provider-Facing Tool Surface

Start with a small deterministic tool set. Add raw CDP later behind developer
mode.

Required tools:

- `browser_open`: create or focus a browser session for the current thread.
- `browser_navigate`: navigate a tab to a URL.
- `browser_back`, `browser_forward`, `browser_reload`, `browser_stop`.
- `browser_snapshot`: return title, URL, loading state, visible text, accessible
  DOM/role snapshot, focused element, and stable node ids.
- `browser_click`: click by node id, selector, or coordinates.
- `browser_type`: type into active element or node id.
- `browser_key`: send a keyboard shortcut or key.
- `browser_scroll`: scroll page or node.
- `browser_screenshot`: return a bounded screenshot reference, not raw unlimited
  base64 in thread history.
- `browser_wait_for`: wait for URL, text, selector, load state, or network idle.
- `browser_console`: read recent console entries.
- `browser_network`: read recent request/response summary.

Optional phase-2 tools:

- `browser_select`: choose tab/profile.
- `browser_downloads`: inspect and approve downloads.
- `browser_upload`: request user-approved file upload.
- `browser_evaluate_readonly`: inspect page state with constrained JavaScript.
- `browser_cdp`: developer-mode-only CDP method calls.

Do not expose raw cookies, local storage, or credential stores to providers.
Providers can interact with pages as a user would, but should not get direct
secret dumps.

Browser observations can still leak secrets. DOM snapshots, accessible text,
console entries, network summaries, and screenshots must have payload caps,
origin metadata, retention limits, and redaction hooks before they are returned
to providers or persisted as artifacts.

## Runtime Events and Approvals

Add browser-specific canonical semantics instead of hiding everything under
`dynamic_tool_call`.

Recommended contract additions:

- Add `"browser_tool_call"` to `TOOL_LIFECYCLE_ITEM_TYPES`.
- Add request types:
  - `"browser_origin_approval"`
  - `"browser_permission_approval"`
  - `"browser_download_approval"`
  - `"browser_upload_approval"`
  - `"browser_developer_mode_approval"`
- Add raw sources:
  - `"ryco.browser.host"`
  - `"ryco.browser.tool"`

Provider event flow:

1. Adapter receives provider tool call.
2. Shared tool registry starts a canonical `browser_tool_call` item.
3. `BrowserService` checks profile, host, tab, and origin policy.
4. If approval is required, emit `request.opened` with browser request type.
5. User approves/denies from the normal Ryco approval UI.
6. Server sends command to `BrowserHost`.
7. Host executes and streams progress/events.
8. Tool item completes with a normalized result or fails with a typed error.

This preserves timeline fidelity: navigation, screenshots, downloads, and
permission decisions are visible and replayable at the event level.

## Security Model

### Origin Policy

Use a per-origin policy:

- `ask`: default for internet origins.
- `allow_session`: allow for the current browser session.
- `allow_profile`: allow for the selected browser profile.
- `allow_project`: allow for this project.
- `deny`: block.

Reasonable defaults:

- Auto-allow read/navigation only for loopback local development origins that
  Ryco can associate with the current project or worktree, for example through
  known dev-server metadata, terminal-launched URL detection, or explicit user
  selection.
- Ask for unknown `localhost`, private-network, link-local, and public internet
  origins.
- Ask before providers use browser tools on public internet origins.
- Ask before cross-origin navigation from an approved origin to a new public
  origin.
- Always block known unsafe schemes except controlled `file:` access to
  approved project files.

### Permissions

Electron permission handlers should default deny and ask only when needed:

- Camera, microphone, location, notifications, MIDI, clipboard, fullscreen,
  downloads, popups, file system, and media capture require explicit approval.
- Downloads go to a Ryco-controlled downloads directory first, with path
  sanitization, size limits, no automatic open/execute behavior, quarantine or
  origin metadata where available, and symlink race protection.
- Uploads require user file selection or explicit approval.
- Popups are opened as controlled tabs in the same browser profile or blocked.

### Credentials and Page Content

Treat page content as untrusted instructions. The browser tool should pass page
state to providers as observation data, not as authority to change Ryco policy.

Rules:

- Do not import default Chrome/Safari/Firefox profiles in MVP.
- Do not expose cookies/localStorage/sessionStorage directly.
- Do not allow a page to approve browser permissions or tool access.
- Do not persist origin allow rules from agent requests without explicit user
  action.
- Put CDP and arbitrary JavaScript behind developer mode.

### Native Surface Safety

Browser surface IPC is local-window geometry, but it still needs strict
validation:

- Only the owning Ryco renderer can attach/update/detach a browser surface for
  its window.
- Bounds must be finite, positive, and clipped to the owning BrowserWindow
  content bounds.
- Hidden panels, route changes, tab switches, window blur/minimize, and window
  destruction detach or hide the native view.
- IPC inputs must identify browser sessions/tabs by server-issued IDs, never by
  arbitrary file paths or renderer-supplied profile paths.
- Native browser views must stay below Ryco modal/approval UI or be detached
  while blocking approvals are shown.

### Browser Artifacts

Use a dedicated browser artifact store for screenshots, large DOM snapshots,
and downloads. Do not put these artifacts into project source directories or
unbounded provider event payloads.

Artifact records should include:

- Artifact id, kind, MIME type, byte size, hash, created time, retention expiry.
- Browser profile/session/tab ids.
- URL and origin at capture time.
- Redaction status and capture limits.
- Download final path only after path validation.

Provider tool results should return artifact references and small summaries.
Large bytes stay in the artifact store with retention and cleanup.

## UI Behavior

### Right Panel

The right panel should behave like current workspace tabs:

- Browser is opened from the workspace launcher or future chat/tool event
  affordances.
- It appears in the tab strip as a singleton `Browser` tab per thread.
- Closing the tab hides the surface but does not necessarily destroy a
  persistent profile.
- When the panel is hidden, browser execution may continue if a provider tool is
  actively using it, but the native view should be detached or bounds-set to
  avoid visual artifacts.

### Browser Toolbar

Controls:

- Back, forward, reload/stop.
- Address field with URL/search normalization.
- Profile picker with mode and profile name.
- Origin policy indicator.
- Tab controls if multi-tab support ships in the first UI pass.
- Open external in system browser.
- Devtools button only when developer mode is enabled.
- Clear profile data menu item.

The panel should not use cards nested in cards. It should be a compact tool
surface, similar to Terminal and Files.

### Non-Desktop Fallback

For browser-only Ryco web clients and non-local/remote environments, show a
clear unsupported state in MVP:

```text
Built-in browser is available for the local Ryco desktop backend.
```

Do not silently fall back to `iframe`. Future work can add a server/headless
browser host with screenshot streaming and DOM-based controls.

## Data Flow

### Manual Browser Open

1. User opens the Browser tab.
2. Web calls `browser.openSession` over environment RPC.
3. Server verifies the selected environment is the local desktop backend and a
   BrowserHost is connected.
4. Server selects/creates the profile and active session.
5. Server sends `openSession` to the registered desktop BrowserHost.
6. Desktop creates/focuses the Electron session and `WebContentsView`.
7. Web sends measured placeholder bounds through `desktopBridge.browser`.
8. Desktop validates ownership/bounds, then attaches and positions the native
   view.
9. Browser events update server state, then UI state.

### Provider Browser Use

1. Provider emits browser tool call.
2. Adapter forwards to `ProviderRuntimeToolRegistry`.
3. `BrowserRuntimeTool` calls `BrowserService`.
4. `BrowserService` resolves or opens a thread browser session.
5. Policy may request user approval.
6. Desktop BrowserHost executes the command.
7. Server returns normalized result to provider.
8. Thread timeline receives a `browser_tool_call` lifecycle item.

### Reconnect and Crash Recovery

- BrowserHost heartbeats to server.
- Server marks sessions degraded when host disconnects.
- On reconnect, host sends full profile/session/tab snapshots.
- In-flight commands fail with retryable `host_disconnected` unless the host
  confirms completion.
- Crashed tabs emit `tab.crashed` and can be reloaded by user or agent.
- Server-side command queues are bounded and per-tab to preserve order.

## RPC Sketch

Add browser methods to `WS_METHODS` and `WsRpcGroup`:

- `browser.listProfiles`
- `browser.createProfile`
- `browser.updateProfile`
- `browser.deleteProfile`
- `browser.clearProfileData`
- `browser.openSession`
- `browser.closeSession`
- `browser.getSnapshot`
- `browser.listTabs`
- `browser.newTab`
- `browser.selectTab`
- `browser.closeTab`
- `browser.navigate`
- `browser.back`
- `browser.forward`
- `browser.reload`
- `browser.stop`
- `browser.input`
- `browser.snapshotDom`
- `browser.screenshot`
- `browser.readConsole`
- `browser.readNetwork`
- `browser.resolvePermission`
- `browser.subscribeEvents`

Add a separate authenticated host channel. This can be a private WebSocket route
or an Effect RPC group mounted only for desktop hosts. Prefer a distinct route
such as `/browser-host/ws`:

- `browserHost.register`
- `browserHost.heartbeat`
- `browserHost.subscribeCommands`
- `browserHost.command.result`
- `browserHost.event`

Server-to-host commands are correlated by `BrowserCommandId` and guarded by
`BrowserHostRunId` leases so stale reconnects cannot complete newer commands.

## Desktop IPC Sketch

Extend `DesktopBridge` only for local window geometry and visible-surface
operations:

- `browser.attachSurface(input)`
- `browser.updateSurfaceBounds(input)`
- `browser.detachSurface(input)`
- `browser.focusSurface(input)`

Do not route provider commands through renderer IPC. Providers run in the server
child process and need a direct server-to-host channel that works even if the
React component is not currently mounted.

For MVP, this bridge is only active when the renderer is connected to the local
desktop-managed backend. Remote environment Browser panels should render the
unsupported state.

## Alternatives Considered

### React iframe

Rejected. It cannot load many real sites, cannot own browser-level permissions
and cookies reliably, and gives providers no stable browser automation target.

### Electron webview tag

Not recommended for first implementation. Electron documents significant
behavioral and security caveats, and the main process should own permissions,
downloads, lifecycle, and host registration.

### Server-only Playwright browser

Viable later for headless/remote/web clients, but it does not directly provide
the desired native side-by-side browser UX in the desktop app. It also requires
screen streaming or a second browser window for user inspection.

### Provider-specific browser integrations

Rejected as the core approach. MCP or native SDK tools are useful adapter
mechanisms, but browser state, policy, profile locking, and events must be
shared across providers.

## Performance and Reliability

- Lazy-create browser sessions only when the Browser tab or a provider tool
  needs one.
- Reuse persistent profiles, but cap open tabs and background sessions.
- Detach hidden native views to avoid layout artifacts.
- Throttle DOM snapshots, screenshot capture, console reads, and network event
  buffers.
- Bound command queues and fail fast when the host is disconnected.
- Store large screenshots/downloads as managed browser artifacts, not unlimited
  event payloads or project files.
- Add storage-size visibility and profile cleanup.
- Keep browser runtime failures isolated from provider sessions when possible:
  a crashed tab should fail the browser tool, not the whole provider session.

## Verification Plan

Automated:

- Contract tests for browser schemas and RPC method payloads.
- Unit tests for origin policy matching and profile key/path sanitization.
- BrowserService tests with a fake BrowserHost: open, navigate, permission ask,
  deny, timeout, disconnect, reconnect, and queue ordering.
- BrowserHost auth tests: one-use desktop bootstrap token cannot register a
  host; dedicated host token can register only on the host route.
- Desktop BrowserKernel tests where feasible for profile isolation and event
  normalization.
- Web route tests for opening/selecting/closing the Browser workspace tab.
- Chat and draft route-view tests for `hasOpenedBrowser`, opened mode state,
  and close/focus behavior.
- Provider adapter tests using fake browser tools for Codex, Claude, Copilot,
  OpenCode, and Cursor/ACP capability handling.

Manual:

- Open Browser from the workspace launcher and navigate to a localhost app.
- Log into a public test site in a project profile, close/reopen Ryco, and
  verify cookies persist only inside Ryco's profile.
- Create a temporary profile and verify cookies/cache are deleted on close.
- Run the same site in two profiles and verify cookie isolation.
- Ask each supported provider to inspect a local web app through the browser.
- Trigger permission prompts, popup attempts, downloads, and denied origins.
- Kill/restart the desktop browser host and verify server/UI recovery.

Before implementation is considered done:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test` with relevant focused tests

## Open Questions

- Should the default persistent profile be `project` or `thread` for manual
  browsing? This spec recommends `project` for manual use and `thread` for
  agent-created sessions.
- What should the first remote/headless BrowserHost implementation look like
  after the desktop-local MVP ships?
- How much of the provider tool surface can Codex app-server accept as native
  dynamic tools versus MCP in the current integration?
- What retention, indexing, and cleanup policy should the dedicated browser
  artifact store use for screenshots, large snapshots, and downloads?
- How should local dev server discovery feed browser URL suggestions?

## References

- OpenAI Codex in-app browser docs:
  https://developers.openai.com/codex/app/browser
- OpenAI Codex Chrome extension docs:
  https://developers.openai.com/codex/app/chrome-extension
- OpenAI Codex app settings browser section:
  https://developers.openai.com/codex/app/settings
- OpenAI Codex app-server docs:
  https://developers.openai.com/codex/sdk
- Electron `session`:
  https://www.electronjs.org/docs/latest/api/session
- Electron `WebContentsView`:
  https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron `<webview>`:
  https://www.electronjs.org/docs/latest/api/webview-tag
- Playwright BrowserContext:
  https://playwright.dev/docs/api/class-browsercontext
- Playwright persistent context:
  https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context
- Playwright MCP:
  https://github.com/microsoft/playwright-mcp
- Playwright MCP user profile docs:
  https://playwright.dev/mcp/configuration/user-profile
