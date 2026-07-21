# Hosted Hub client

Ryco's web application has an explicit `hosted-hub` mode for interoperating with a compatible Hub.
It is the same React client, RPC client, stores, and feature UI used by direct-browser and desktop
sessions. Hub mode changes authentication, node selection, and the WebSocket transport only; the
selected Ryco node remains authoritative for projects, files, terminals, conversations, providers,
orchestration, attachments, approvals, and relay payloads.

This mode is separate from the hosted-static pairing client. It is opt-in and does not change direct
LAN, desktop-local, saved remote, or desktop-managed SSH behavior.

## Topology and configuration

Build the web application with:

```sh
VITE_RYCO_CLIENT_MODE=hosted-hub bun --cwd apps/web run build
```

A compatible Hub serves the resulting assets from its own public origin. The page, authentication
HTTP APIs, node directory, relay-ticket endpoint, and `/v1/relay/client` WebSocket therefore share
one origin:

```text
https://hub.example/
  web assets
  /api/auth/*
  /api/nodes
  /api/relay/tickets
  /v1/relay/client
```

That topology is required. Ryco does not add permissive CORS, alternate browser tokens, or a second
session format. The Hub's configured public origin and WebAuthn RP ID must cover the browser origin.
Hub continues to validate `Host` and `Origin`; WebAuthn validates RP ID; mutation requests carry the
Hub-issued CSRF value in `X-Ryco-CSRF`. Requests use relative paths, `credentials: "same-origin"`,
and `cache: "no-store"`. The browser never reads the HttpOnly session cookie.

For local development, set `VITE_WS_URL` to the local Hub backend as well as
`VITE_RYCO_CLIENT_MODE=hosted-hub`. Vite proxies `/api` and `/v1/relay` without rewriting the public
Host. Configure the Hub public origin/RP ID for that exact local browser origin. Do not use this
proxy arrangement to bypass production origin policy.

## Authentication and registration

Sign-in uses the existing Hub passkey options and verification endpoints. The client converts the
Hub's JSON WebAuthn options into the browser API and returns the standard WebAuthn response shape.
It does not create a bearer token or alternate transcript. Invitation redemption uses the existing
closed-invitation registration ceremony. A new Hub's first owner can explicitly select the bootstrap
flow and use the operator-provided bootstrap credential with the existing credential-gated WebAuthn
registration endpoints. The server remains authoritative for whether bootstrap is available; the
client does not probe or publish account state. Invitation secrets and bootstrap credentials are
submitted in an HTTPS request body, cleared from the form immediately, and never added to a URL or
browser storage. One-time recovery codes are memory-only and are cleared when dismissed.

Only the CSRF value is readable by client code, and it is kept in memory. Sign-out uses the existing
session-bound logout endpoint. A `401` or `session_invalid` result clears account, role, node,
transport, and Ryco-session state before closing the selected channel. Duplicate or cancelled
ceremonies abort the earlier browser operation. Denial, malformed options/responses, expired
challenges, revoked sessions, and network loss surface bounded messages that do not reflect response
bodies.

## Independent state models

Hosted mode deliberately does not expose one ambiguous `connected` flag.

| Model           | States                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Account         | signed out, authenticating, authenticated, signing out, session expired, unavailable                                   |
| Directory       | idle, loading, ready, stale                                                                                            |
| Selection       | no selection, online, offline, incompatible, revoked, authorization removed                                            |
| Relay transport | idle, requesting ticket, connecting, authenticating, opening channel, online, reconnecting, draining, terminal failure |
| Ryco session    | synchronizing, ready, stale, replaying, delivery unknown, closed                                                       |

Directory refresh runs on a bounded 20-second visible-page cadence. Failures retain the last bounded
directory as stale, clear role authority, disable selection/actions, and retry with a capped delay.
Selection is preserved only while both node ID and environment ID match. Authorization removal or an
identity change clears it.

## Directory, roles, and switching nodes

The selector renders only the Hub's authorized directory response. It shows online/offline presence
and the effective Viewer, Operator, or Owner role. Revocation, authorization removal, and version
incompatibility are distinct terminal selection states; the client does not display fingerprints,
grant internals, or unbounded operations metadata.

The shared RPC access table drives both the server RPC principal and hosted client affordances.
Viewer can read supported projections, Operator can run node mutations, approvals, and terminals,
and Owner can use owner-only configuration/statistics APIs. Missing or stale role state fails closed.
The server remains authoritative, including for legacy RPC aliases and `direct_owner` APIs that are
never available through Hub relay sessions.

Switching nodes performs an ordered teardown before connecting the replacement:

1. cancel ticket/reconnect work and close the previous relay channel;
2. unsubscribe shell, thread-detail, lifecycle, config, and terminal listeners;
3. clear request queues, terminal references, drafts, pending actions, UI selections, query/Atom
   caches, timers, and the previous environment projection;
4. install the new environment descriptor and start one new connection generation.

Tabs do not share tickets, sockets, queues, reconnect timers, or store instances. Closing a hosted
channel cannot close direct clients or another tab.

## Stable node routes

The selected node is a stable URL segment: hosted browser URLs take the shape
`/node/<node id>` for the node root and `/node/<node id>/<environmentId>/<threadId>` (plus the
existing panel search parameters) for nested views. The segment value is the bounded node
identifier the authorized directory already renders to signed-in users — directory metadata, never
node-owned content or authentication material. The mapping lives in the history layer of the
hosted build only; the shared logical route tree is unchanged and direct-browser, desktop-local,
and SSH-assisted routing keep their current URL shapes.

Refresh, deep links, and history restore the routed node strictly through the ordered fail-closed
pipeline: restore the Hub session → refresh the authorized directory → validate the routed node id
against the directory → issue a fresh one-use relay ticket → establish the relay channel →
synchronize canonical node state → only then enable mutations. The UI stays on read-only blocked
surfaces until each stage completes. Possession of a node URL grants nothing.

Absent, revoked, unauthorized, removed, offline, or incompatible routed nodes and malformed
segments fail closed to the node directory with a bounded explanation. A signed-out or expired
session shows the normal passkey surface; the routed node resumes only after re-authentication and
revalidation. Back and Forward navigate between the directory and selected-node views: returning
to the directory tears down exactly the browser relay session using the switching-nodes order
above, and Forward re-enters through the restore pipeline with a fresh ticket. Legacy hosted URLs
without the node segment redirect to the node-scoped shape when the directory can identify the
node, otherwise to the directory. No session, ticket, credential, challenge, or signature material
appears in URLs, history state, or browser storage, and node selection is never persisted outside
the URL itself.

## Relay transport and ticket custody

The existing `WsTransport` and Effect RPC client accept a WebSocket-compatible hosted adapter. RPC
feature components do not know whether their ordered bytes use the direct WebSocket, desktop-local
transport, or Hub relay.

For every connection attempt the adapter requests a new short-lived ticket over authenticated Hub
HTTP. A ticket exists only in a per-tab in-memory attempt object, is consumed once, and is discarded
before another attempt. The relay WebSocket has no query credentials, cookies added by application
code, or Authorization header. Its first binary frame is canonical protocol 1.2 client
authentication and must complete within five seconds.

The adapter consumes canonical `ready`, authorized `channel.open`, `channel.accept/reject`, data,
flow pause/resume, ping/pong, error, and close frames. RPC payload bytes and ordering are unchanged.
Inbound and outbound queues honor negotiated chunk/control/queue limits, include native
`bufferedAmount`, pause at negotiated pressure, resume below the low-water mark, and close a slow
consumer rather than growing without bound. No TCP forwarding, SSH, WebRTC, peer discovery, or new
encryption protocol is part of the client.

## Reconnect, replay, and delivery uncertainty

One selected node has at most one active connection attempt in a tab. Reconnect uses exponential
backoff from one second to 60 seconds with bounded ±20% jitter and bounded Hub `retryAfterMs` input.
The delay resets only after a session remains stable for 60 seconds. Every retry obtains a fresh
ticket.

Retryable cases include generic browser network failure, node offline, Hub draining, connection
replacement, rate limiting, slow-consumer closure, and retryable ticket expiry. Revocation,
authorization removal, unsupported protocol, invalid protocol, and authentication-required failure
are terminal. Browser WebSocket APIs intentionally do not reveal whether a pre-handshake network
failure was DNS or TLS, so the hosted UI reports those cases as a bounded network failure; direct
and node-side diagnostics retain their more specific classification.

On reconnect, the existing shell and thread subscriptions resubscribe. Ryco marks the session
`replaying`, accepts the authoritative shell snapshot, discards duplicate/older projection versions,
reconciles thread subscriptions, and then marks it ready. Conversations, running tasks, approvals,
and terminal projections recover from the node, never from Hub.

RPC reads may be retried by their existing subscription behavior. An unacknowledged request is
conservatively treated as uncertain, and a non-idempotent request is never automatically replayed
merely because the relay disconnected. If no response chunk or exit made delivery known, the
session becomes `delivery unknown`; the UI does not claim that the command was accepted. After the
authoritative replay finishes, the user can explicitly acknowledge the warning.

## Browser capability adaptation

Hosted mode keeps the shared feature UI and uses the selected node's RPC capabilities:

- terminal input/resize, approvals, remote project/filesystem operations, source control, and
  attachment uploads continue over RPC when allowed by role;
- browser downloads and clipboard actions use normal browser APIs;
- historical attachment preview URLs are not sent to Hub because node HTTP paths are not a relay
  transport; the attachment name remains visible with an explicit preview-unavailable explanation;
- auto-detected project favicons and project-image upload/preview are disabled with an explanation
  because those legacy node HTTP routes are not relayed; removing an existing image remains an
  authorized RPC operation;
- desktop updater controls, native file dialogs, native notifications, deep-link pairing, local
  project discovery, desktop IPC, and editor/Finder launch affordances remain desktop-only;
- no local filesystem path or desktop bridge is exposed to the hosted page.

Production `hosted-hub` builds are installable mobile PWAs. Standard, desktop, hosted-static, and
development builds do not register the production service worker. The hosted worker precaches only
an explicit allowlist of immutable shell assets and a static offline document. Live HTML,
authentication, API, RPC, relay, WebSocket, attachment, project, file, terminal, conversation, and
other node-owned responses remain network-only.

## Mobile installation and updates

On Android Chrome, Ryco exposes **Install Ryco** when the browser supplies its native install
prompt. If the prompt is unavailable, use the browser menu and choose **Add to home screen** or
**Install app**. On iOS Safari, open the Share or browser menu, choose **Add to Home Screen**, enable
**Open as Web App** when offered, and confirm **Add**. Installation is optional; browser use remains
available without it.

Installed Ryco uses standalone display mode. A new service worker waits while an existing client is
active. Ryco shows **Update ready** and activates it only after the user confirms; finding an update
does not reload active work automatically.

Navigation remains network-first. If the network is unavailable, the worker returns a static
offline document containing no account, node, project, or conversation data. Returning online does
not make stale browser state authoritative: hosted mutations remain disabled until Ryco validates
the current session, refreshes the authorized node directory and grant, establishes a fresh relay
generation, and accepts the current node snapshot or replay point.

Installing Ryco does not change the relay trust boundary. Hosted connections use WSS transport
security, but they are not application-level end-to-end encrypted. The trusted relay can observe
forwarded bytes in memory and must not log or persist payloads. This limitation is shown in the
hosted authentication, node-selection, and installation paths.

## Security and browser persistence

Hosted mode keeps authentication material and node-owned state out of localStorage, sessionStorage,
IndexedDB, service-worker caches, URL/history state, configuration exports, and browser logs. Draft,
terminal, general UI, script-selection, and other generic local-storage hooks use in-memory storage.
The hosted root installs a fail-closed console sink before authentication because older local-client
feature paths may log caught values. Relay payloads are never persisted or sent to client analytics.

Do not add passwords, cookies, Authorization headers, CSRF values, WebAuthn challenges/responses,
invitation secrets, tickets, node proofs, provider data, source code, conversations, terminal output,
files, attachments, or relay payloads to errors, diagnostics, metrics, exports, or persistence.

## Accessibility and layout

Authentication, invitation, directory, and node menus use native keyboard controls, explicit labels,
focus-visible indicators, focus movement on flow changes, validation messages, and polite/assertive
live regions. Online, offline, stale, reconnecting, and delivery-unknown states use text and icons in
addition to color. The same shell adapts from narrow browser widths through tablet and desktop; there
is no second hosted feature UI.

## First-owner and node onboarding

The signed-out shell requests the Hub's bounded bootstrap-availability response before offering
first-owner setup. An unavailable, malformed, or failed response hides the setup action while
leaving passkey sign-in and invitation redemption available. Successful owner setup hides the
action immediately. The Hub remains authoritative for permanent bootstrap completion.

An authenticated owner can start **Enroll node** from the node directory after running `ryco hub
enroll` on the intended node. The owner enters the short device code, then compares the displayed
label, platform, client version, algorithm, expiry, and public-key fingerprint with the node or a
trusted operator channel before approving or denying. Approval creates the owner's explicit node
grant; the directory reports the node offline until its outbound connector polls the result and
authenticates.

Device codes remain only in the active onboarding component. They are not placed in URLs, global
stores, browser storage, diagnostics, telemetry, or logs. Polling secrets and private keys never
enter the browser. Session, role, same-origin, CSRF, expiry, rate-limit, and enrollment-state checks
remain server-enforced.

## Troubleshooting

- **Passkey unavailable or rejected:** verify the page origin is inside the Hub's configured RP ID
  and public-origin policy, then restart the ceremony. Do not relax RP ID or Origin validation.
- **Session expired:** sign in again. The client intentionally discards the selected node and role.
- **Directory is stale:** restore Hub HTTP reachability and use Refresh. Actions remain disabled
  until a fresh authorized response arrives.
- **Node offline:** confirm the node's outbound Hub connector is enrolled and online. The client will
  keep bounded retries with fresh tickets.
- **Authentication timeout:** check that the relay accepts the first binary frame within five
  seconds and both peers support canonical relay protocol 1.2.
- **Incompatible or revoked:** an administrator must restore compatible node access. The browser
  will not downgrade the protocol or bypass authorization.
- **Delivery unknown:** inspect the authoritative node state before issuing the command again.
- **Preview unavailable:** historical attachment previews require a future bounded RPC read; the
  client intentionally does not turn the relay into an HTTP tunnel.
