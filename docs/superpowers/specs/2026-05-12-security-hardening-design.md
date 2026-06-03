# Security Hardening Design

## Goal

Close the security gaps found in the May 12, 2026 review by making server authority explicit and enforceable. The priority is to prevent a paired non-owner client, browser-origin attacker, or compromised remote browser session from reaching owner-grade actions such as terminal control, arbitrary file access, settings mutation, and pairing-token disclosure.

## Security Outcomes

1. WebSocket RPC methods enforce the same role boundaries as HTTP routes.
2. WebSocket handshakes no longer rely on ambient browser cookies.
3. Project file APIs operate on server-resolved project/worktree roots, not caller-chosen roots.
4. Auth access streams do not expose pairing credentials or client metadata to non-owner sessions.
5. User-controlled process arguments are separated from tool options and platform shell quoting is minimized.

## Non-goals

- Replacing the current auth/session system.
- Introducing multi-tenant project ACLs beyond `owner` vs `client`.
- Removing remote environments or browser pairing flows.
- Sandboxing agent/provider execution. This plan narrows Ryco control-plane authority; it does not make arbitrary agent code safe.
- Implementing a full browser secret vault. Browser token storage gets hardening and documentation, but desktop secret storage remains the preferred secure path.

## Scope

In scope:

- Add a central WebSocket authorization layer keyed by `AuthSessionRole`.
- Classify every WebSocket RPC method as owner-only or client-safe.
- Require short-lived `wsToken` authentication for WebSocket upgrades.
- Validate WebSocket `Origin` for browser-origin handshakes.
- Split auth access streams into owner-only management data and minimal current-session data.
- Change project read/write/list APIs to derive workspace roots from server projection data where feasible.
- Keep explicit owner-only escape hatches for arbitrary filesystem browse and arbitrary `cwd` operations where the UI still needs them.
- Harden `git clone` by inserting `--` before user-controlled repository arguments and validating clone URL schemes.
- Harden Windows editor launch by avoiding `shell: true` for user-controlled path arguments or by using a dedicated Windows argument escaping helper.
- Add regression tests for the new boundaries.

Out of scope:

- Changing provider runtime behavior or Codex app-server protocol handling.
- Redesigning the desktop pairing UX.
- Encrypting browser `localStorage`.
- Removing terminal history persistence. A separate follow-up can add opt-out or retention controls.

## Threat Model

The server runs with the local user's privileges and can read/write local files, spawn terminals, invoke source-control tools, and start provider processes. Any authenticated control-plane caller should be treated as powerful unless role-limited.

Primary attackers:

- A paired `client` session that should not have owner management authority.
- A malicious website trying to reach a locally authenticated Ryco server from the browser.
- A remote browser profile or extension that can read browser `localStorage`.
- A malicious repository URL or local path entered into Ryco.

Trusted:

- The desktop main process and its bootstrap handoff.
- Owner sessions created through the desktop bootstrap or owner-approved pairing.
- Server-side projection state for known projects/worktrees.

## Architecture

### 1. WebSocket Authorization

`apps/server/src/ws.ts` should pass the full authenticated session into the RPC layer, not only the session id. Add a small authorization helper in the server auth area, for example:

```ts
type WsRpcAccess = "owner" | "authenticated";

function authorizeWsRpc(session: AuthenticatedSession, access: WsRpcAccess, method: string) {
  if (access === "owner" && session.role !== "owner") {
    return Effect.fail(
      new AuthError({ status: 403, message: `Only owner sessions can call ${method}.` }),
    );
  }
  return Effect.void;
}
```

Keep the method policy close to the WebSocket method definitions so reviewers can see the security posture in one place.

Owner-only methods include:

- `orchestration.dispatchCommand`
- server config/settings/keybinding mutation
- auth access management streams
- source-control clone/publish actions
- project create/update/archive/delete operations
- project read/write/list by arbitrary `cwd`
- filesystem browse
- terminal open/write/restart/resize/clear/close
- shell open in editor
- VCS mutation operations

Authenticated client-safe methods are limited to read-only state needed by a paired client UX, such as server config, provider metadata, orchestration snapshot subscriptions, and current-session state. Any read that exposes filesystem paths, client metadata, pairing credentials, terminal output, or project file contents remains owner-only until a narrower use case is designed.

### 2. WebSocket Handshake Hardening

WebSocket upgrades should require `wsToken`. Remove the fallback from `authenticateWebSocketUpgrade` to cookie/bearer request auth. Clients already have `/api/auth/ws-token` flows for remote and SSH environments; the primary browser path should use the same short-lived token flow.

Add an Origin check before the upgrade is accepted:

- Accept no `Origin` only for non-browser clients using `wsToken`.
- Accept configured desktop/dev origins.
- Accept same-origin loopback origins for loopback servers.
- Accept configured remote app origins if the hosted app flow needs them.
- Reject everything else with 403.

For cookie-backed HTTP sessions, set `secure: true` whenever the request is HTTPS or the server is running behind a known HTTPS exposure such as Tailscale Serve. Keep `httpOnly` and `sameSite: "lax"`.

### 3. Auth Access Stream Split

Replace `subscribeAuthAccess` with explicit role behavior:

- Owner sessions receive the existing management snapshot and live events.
- Client sessions receive only their own session state, or a 403 if the current UI does not require the stream.

Do not send raw pairing credentials over a broad stream. If the UI needs to show a newly created pairing token, return it only from the owner-only create-pairing-token command and show it from that response.

### 4. Project and Filesystem Scope

The current file APIs use caller-provided `cwd` as the trust root. Introduce server-resolved workspace inputs for project file operations:

- Prefer `projectId` plus optional `worktreeId` or `threadId`.
- Resolve the root through `ProjectionSnapshotQuery` / projection repositories.
- Continue using `WorkspacePaths.resolveRelativePathWithinRoot` and realpath containment after the server root is resolved.

Keep a separate owner-only API for explicit arbitrary filesystem browse or ad hoc local paths. The method names should make this authority visible, for example `filesystem.browse` and `filesystem.readOwnerPath`, rather than hiding it behind `projects.*`.

### 5. Process and Tool Argument Hardening

`SourceControlRepositoryService.cloneRepository` should call Git with:

```ts
["clone", "--", remoteUrl, preparedDestination.directoryName];
```

Validate `remoteUrl` before execution. Allow `https://`, `ssh://`, `git@host:owner/repo.git` style SCP URLs, and local paths only if the caller is owner and the UI labels the operation as local-path cloning.

For editor opening on Windows, avoid spawning through the shell when a user-controlled path is an argument. Resolve command executables directly where possible. If a shell is unavoidable for a specific editor, centralize Windows argument escaping and cover embedded quotes, trailing backslashes, ampersands, pipes, and percent expansion in tests.

### 6. Browser Token Storage

Document browser saved environments as lower-trust than desktop-managed environments. Add UI text near remote/browser pairing that says bearer tokens are stored in browser storage for that browser profile. Prefer shorter bearer token TTLs for browser-only environments and make re-pairing predictable.

## Data Flow

1. HTTP session authenticates through cookie or bearer token.
2. Client requests `/api/auth/ws-token`.
3. Server verifies HTTP session and issues a short-lived WS token bound to the session id.
4. Client connects to `/ws?wsToken=...`.
5. Server validates origin, verifies the WS token, loads the session role, and builds the RPC layer with the full session.
6. Each RPC handler calls the authorization helper before executing side effects.
7. File handlers resolve server-owned workspace roots before path containment checks.

## Error Handling

- Unauthorized WS RPC calls return a typed 403 auth error, not a generic internal error.
- Origin failures are logged at info/warn level with the origin and host, but never log credentials or full query strings.
- Path scope failures keep the existing user-safe message: "path must stay within the project root."
- Git clone URL validation errors should explain the allowed URL forms without echoing secrets.

## Testing

Server unit tests:

- A `client` WS session cannot call owner-only methods.
- An `owner` WS session can call owner-only methods.
- `subscribeAuthAccess` returns owner data only for owner sessions.
- WS upgrade without `wsToken` is rejected.
- WS upgrade with unexpected `Origin` is rejected.
- WS upgrade with valid token and accepted origin succeeds.
- Project file APIs reject caller attempts to escape or override the server-resolved project root.
- `git clone` inserts `--` before `remoteUrl` and rejects leading-dash / unsupported scheme inputs.
- Windows editor launch escaping/resolution handles quote and metacharacter paths.

Browser/desktop tests:

- Primary and remote clients request a WS token before connecting.
- Pairing-management UI still receives pairing tokens from owner-only create responses.
- Remote environment reconnect works after WS cookie fallback removal.

Verification commands:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- Focused `bun run test ...` files for the changed server/web units

## Rollout

1. Add role checks with owner-only defaults, then loosen only methods proven client-safe.
2. Update clients to use `wsToken` universally.
3. Remove WS cookie fallback after client paths are updated.
4. Move project file APIs to server-resolved roots.
5. Harden Git/editor process handling.
6. Add browser-token UX copy and optional TTL follow-up.

## Risks

- Some existing paired-client workflows may currently rely on owner-grade WS access. The owner-only default may break them, but that break is preferable to silent privilege escalation.
- Removing WS cookie fallback can break stale clients until all connection paths request `wsToken`.
- Server-resolved project roots may require minor UI plumbing where only `cwd` is currently available.
- Windows editor launch behavior can be editor-specific; tests should cover each supported launch style.
