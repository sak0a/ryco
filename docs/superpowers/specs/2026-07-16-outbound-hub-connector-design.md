# Outbound Hub connector design

**Status:** Approved design

**Date:** 2026-07-16

## Summary

Ryco will provide a production outbound Hub connector in `apps/server`. An enrolled server can
authenticate to one configured Hub, keep one bounded outbound WebSocket, accept authorized
protocol 1.2 `ryco.rpc` channels, and adapt each channel to the existing Ryco RPC session services.
The connector does not open another listener and does not duplicate project, provider, terminal,
orchestration, attachment, or persistence behavior.

The connector is an in-process scoped service. A loopback connection to Ryco's own `/ws` route was
considered, but it would add an authentication hop, another WebSocket queue, and unnecessary byte
copies for every logical channel. A separate connector process was also considered, but it would
split key custody, startup, shutdown, and access to the in-process RPC services. A transport-neutral
RPC byte-session adapter gives direct and relayed sessions one application boundary without those
extra ownership layers.

This work consumes the existing public relay protocol 1.2 schemas, deterministic codec, canonical
fixtures, node identity transcript, local signing-key custody, enrollment client, proof client, and
rotation client. It does not change the canonical relay protocol or its fixtures.

## Scope and boundaries

The execution node remains authoritative for:

- projects, worktrees, repositories, source files, and attachments;
- provider credentials, provider processes, and provider sessions;
- terminals and their output;
- conversations, orchestration state, commands, snapshots, and replay;
- all application payloads carried through a relay channel.

The connector owns only:

- one configured Hub origin and bounded reconnect policy;
- local enrollment and node-identity integration;
- one outbound WebSocket and its negotiated relay state;
- ephemeral logical-channel adapters, sequence counters, and bounded byte queues;
- bounded local lifecycle status.

The connector will not persist relay payloads or duplicate node-owned records. It will not provide
generic tunneling, arbitrary TCP forwarding, SSH, remote desktop, WebRTC, peer discovery, or a new
encryption protocol.

## Component ownership

New runtime code lives under `apps/server/src/hubConnector/`. The directory has focused components:

- `HubConnector` owns the public control and status interface.
- `HubConnectorRuntime` owns the scoped state machine and single connection generation.
- `HubRelayTransport` wraps the runtime WebSocket implementation behind an injectable interface.
- `ReconnectPolicy` calculates deterministic bounded delay decisions.
- `RelayConnectionSession` authenticates one physical connection and routes canonical frames.
- `RelayChannelRegistry` owns channel identifiers, per-direction sequences, and terminal cleanup.
- `RelaySendQueue` owns aggregate encoded-byte and native-buffer accounting.
- `RelayChannelAdapter` owns bounded inbound/outbound queues and one RPC session scope.
- `RpcByteSession` is the transport-neutral adapter shared by direct `/ws` and relay channels.
- `HubConnectorStatus` owns a bounded snapshot and status stream.

The names may be split into smaller files during implementation, but these ownership boundaries
must remain explicit. A component may not acquire provider, terminal, orchestration, project, or
persistence implementations independently of the existing server runtime layer.

`HubConnectorLive` is a scoped Effect layer provided inside the existing server runtime. It starts
after the RPC dependencies and local identity stores are ready. Network unavailability does not
block the local HTTP listener or local command readiness. Layer finalization stops the connector
before shared RPC services and process resources are released.

Enabling the connector never changes `host`, `port`, HTTP routes, Tailscale behavior, or listener
count.

## Configuration

The connector is process configuration rather than ordinary exported server settings. The runtime
accepts:

| Configuration                      | Default | Rule                                                      |
| ---------------------------------- | ------: | --------------------------------------------------------- |
| `RYCO_HUB_CONNECTOR_ENABLED`       | `false` | No outbound enrollment, proof, or socket work when false  |
| `RYCO_HUB_ORIGIN`                  |  absent | Required when enabled; exact canonical HTTPS origin       |
| `RYCO_HUB_RECONNECT_BASE_MS`       |  `1000` | Integer from 250 through 60,000                           |
| `RYCO_HUB_RECONNECT_MAX_MS`        | `60000` | Normal exponential cap; integer from base through 300,000 |
| `RYCO_HUB_RECONNECT_STABLE_MS`     | `60000` | Integer from 5,000 through 600,000                        |
| `RYCO_HUB_RECONNECT_JITTER_RATIO`  |   `0.2` | Number from 0 through 0.5                                 |
| `RYCO_HUB_ALLOW_FILE_SECRET_STORE` | `false` | Explicitly allows the existing hardened POSIX fallback    |

Equivalent non-secret startup flags may be supported. No flag, environment variable, bootstrap
envelope, or persisted settings field accepts a private key, polling secret, challenge, signature,
ticket, cookie, or authorization value.

The origin validator accepts the same exact secure origins as the public node-identity primitives.
Loopback HTTP remains development-only. Credentials, paths, queries, fragments, and noncanonical
spellings are rejected. Enabled configuration without an origin fails connector initialization but
does not silently select a production service. An active local identity whose origin differs from
configuration enters an operator-required failure and never sends a proof.

The Hub origin is not returned by the ordinary server settings RPC, configuration exports,
diagnostics, or connector status. Reconnect numbers are safe to expose only where existing process
configuration is already available locally.

Only one Hub may be configured. A future multi-Hub design would require independent identity,
status, queue, and connection ownership and is outside this scope.

## Local identity and key custody

The server derives a permissioned Hub identity-state path beneath its existing state directory. The
existing `LocalHubIdentityStateStore` persists only bounded non-bearer metadata and protected-store
entry names with atomic, fsynced replacement and local writer exclusion.

Private Ed25519 keys and enrollment polling secrets use the existing protected store selection:

1. Bun secrets when available under Bun;
2. keytar and the operating-system credential store for the packaged Node runtime;
3. the existing permissioned POSIX file store only when explicitly enabled.

Windows continues to fail closed when its operating-system credential store is unavailable. The
POSIX fallback retains its owned `0700` directory, owned regular `0600` files, no-symlink,
single-link, exclusive-create, fsync, and revalidation requirements.

The connector accesses signing keys only through `generate`, `getPublicDescriptor`, `sign`, and
`delete`. It never gains a private-key export path. Missing, locked, unavailable, or corrupt custody
is operator-required. An enrolled node never generates a replacement key automatically.

## Enrollment control

Enrollment uses the existing device-code client and native bounded HTTPS transport. Production
control is exposed through explicit local commands:

- `ryco hub enroll --origin <origin>` starts a ceremony or resumes the pending ceremony for that
  exact origin;
- `ryco hub enrollment cancel --origin <origin>` performs the existing local cancellation and
  deterministic custody cleanup;
- `ryco hub status` prints only the bounded connector status.

When a server process is running, the commands use a direct local control RPC so the live connector
owns the operation. When the server is stopped, the enrollment command may use the same identity
store and protected store directly. It must acquire the existing writer lock and must not start a
second connector or WebSocket.

The enrollment start command may print the short device code and expiry once as intentional
operator output. The device code is never sent through logging, diagnostics, telemetry, status, or
configuration export. The independent polling secret is never printed. It is stored in protected
custody before polling begins and cleared after approval or terminal cleanup.

Polling honors the server-provided interval, never polls faster than the existing client bound, and
survives process restart. Pending state becomes `awaiting_approval`; approval persists the stable
node and active-key identifiers before protected polling custody is removed. A lost approval
response is resumed using the existing recovery behavior.

Denial, server cancellation, expiry, and terminal unavailability remain intentionally collapsed by
the enrollment protocol. The local state is cleaned and status moves to an operator-required
`degraded` result with the stable `enrollment_unavailable` failure class. Explicit local
cancellation returns to `disabled` when the connector is disabled or to `enrolling` when enabled
and still awaiting a new ceremony.

## Authentication handshake

Each connection attempt performs these steps in order:

1. Confirm enabled configuration, exact identity-origin match, and available key custody.
2. Select the active key, or the approved staged key during rotation.
3. Obtain a fresh bounded HTTPS proof challenge with credentials omitted, caching disabled, and
   redirects rejected.
4. Build and sign the canonical `ryco.node-auth.proof.v1` transcript for protocol 1.2.
5. Derive `wss://<origin>/v1/relay/node` without a query string.
6. Open the WebSocket without Cookie, Authorization, Origin, or bearer subprotocol material.
7. On the `open` event, send the encoded node `auth` frame synchronously before any other frame.
8. Require a valid protocol 1.2 `ready` frame within five seconds.
9. Adopt the negotiated limits and transition online.

The proof is prepared before opening the socket so HTTPS latency does not consume the Hub's
five-second first-frame deadline. The challenge, transcript, signature, and encoded authentication
frame remain in memory only for that attempt and are zeroed or released after first send. A failed
upgrade or socket attempt never reuses them; the next attempt requests a fresh challenge.

The connector validates `ready` with the canonical public codec. It rejects unsupported major or
minor negotiation, invalid limit relationships, an authentication deadline above five seconds, or
limits outside the public contract.

After a staged key authenticates successfully, the connector calls the existing rotation client's
`confirmNewKeyAuthenticated`. Only then may old key custody be deleted. A failed staged-key proof
keeps available local recovery state and requires operator action; it does not fall back to an old
key that the service may already have revoked.

## Connector state machine

The externally visible states are:

```text
disabled
   | enable
   v
enrolling -> awaiting_approval -> connecting -> authenticating -> online
                                  ^               |              |
                                  |               v              v
                                  +------ degraded/backing_off <-+

online/authenticating -> revoked
online/authenticating -> version_incompatible
any active state      -> stopping -> disabled
```

State rules:

| State                  | Meaning and allowed transitions                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`             | Configuration is disabled. No polling, proof, socket, reconnect timer, or channel exists. Enabling moves to `connecting` for an active identity or `enrolling` otherwise.                     |
| `enrolling`            | Enabled but no active identity exists, or enrollment start is in progress. A persisted ceremony moves to `awaiting_approval`.                                                                 |
| `awaiting_approval`    | A resumable pending ceremony exists. Approval moves to `connecting`; explicit cancellation moves to `enrolling` or `disabled`; terminal unavailability moves to operator-required `degraded`. |
| `connecting`           | Challenge preflight, proof construction, DNS/TLS, or WebSocket opening is in progress. Only one generation may own this state.                                                                |
| `authenticating`       | The WebSocket is open, the auth frame was sent first, and the connector is waiting for `ready`.                                                                                               |
| `online`               | Negotiated limits are active, heartbeat is healthy, and new channels may be evaluated.                                                                                                        |
| `degraded`             | The connector has either one scheduled retry or an operator-required stable failure. Status distinguishes `backing_off` from `operator_action_required`.                                      |
| `revoked`              | A live connection received canonical `revoked`. No automatic retry occurs.                                                                                                                    |
| `version_incompatible` | The service reported an unsupported protocol or invalid negotiated version. No automatic retry occurs.                                                                                        |
| `stopping`             | New enrollment, connection, and channel work is rejected while resources are deterministically closed.                                                                                        |

Transitions are serialized. Every asynchronous callback carries the connection generation that
created it. A stale DNS result, timer, WebSocket callback, enrollment result, or channel callback
cannot mutate a newer generation.

## Failure classification

Automatic retry with backoff applies to:

- DNS resolution failure;
- network refusal, reset, or loss;
- TLS establishment failure;
- abnormal WebSocket loss;
- authentication timeout before `ready`;
- Hub `server_draining`;
- `rate_limited`, honoring bounded `retryAfterMs`;
- temporary HTTPS transport failure;
- temporary local send failure or heartbeat timeout;
- a remote `internal_error` that does not indicate a local invariant failure.

Operator action is required for:

- missing, locked, unavailable, or corrupt key custody;
- configured-origin and enrolled-origin mismatch;
- authentication failure after a fresh canonical proof;
- wrong key, copied node ID, or proof replay rejection;
- invalid or irrecoverable rotation state;
- `connection_replaced`;
- a second deterministic canonical-frame violation before a stable connection interval;
- terminal enrollment unavailability;
- explicit revocation;
- protocol incompatibility.

`connection_replaced` never immediately retries. Treating it as transient would let two valid
processes continually replace each other. An operator may stop the duplicate and explicitly resume
or restart the intended connector.

The service intentionally collapses cold-start revoked, wrong-key, and copied-ID proof failures to
the same authentication response. Without changing service policy, the connector can enter the
explicit `revoked` state only when a live connection receives `revoked`. A cold-start denial enters
non-retrying `degraded` with `authentication_failed`. The connector must not guess which security
condition caused a deliberately collapsed response.

## Reconnect policy

At most one connection or reconnect attempt exists for the configured Hub. The runtime owns one
attempt counter, one optional retry timer, and one connection generation.

For attempt `n`, the unjittered window is:

```text
window = min(maxDelayMs, baseDelayMs * 2^n)
```

The injected random source produces a multiplicative value in
`[1 - jitterRatio, 1 + jitterRatio]`. The jittered exponential delay is clamped between 250
milliseconds and the configured normal maximum. A protocol `retryAfterMs` then becomes a lower
bound and may extend that normal delay, but the absolute effective delay remains capped at the
protocol maximum of 300 seconds. It never causes more than one timer.

The attempt counter resets only after the connection remains continuously online for
`stableConnectionMs`. A socket that reaches `ready` and immediately fails therefore retains its
backoff history. Draining and replacement also do not reset history.

The first deterministic canonical-frame violation tears down the connection and uses normal
backoff. A second violation before a stable connection interval enters operator-required
`degraded` instead of retrying. The stable interval resets this protocol-violation count with the
ordinary attempt counter.

Clock, timeout scheduling, cancellation, and randomness are injected. Tests can assert exact
boundaries without sleeping or depending on real entropy.

Disabling or stopping increments the generation, cancels the timer, and prevents later callbacks
from reconnecting.

## Relay connection processing

Every WebSocket message must be binary and contain exactly one canonical relay frame. The public
codec applies the absolute message bound, deterministic CBOR validation, version validation, frame
schema, and negotiated-version match.

Before `ready`, any frame except `ready` or a fatal protocol error terminates authentication.
After `ready`, connection-level frames are handled as follows:

- `ping`: enqueue a priority `pong` carrying the exact nonce;
- `pong`: accept only if the connector later sends an implementation-owned ping;
- `channel.open`: evaluate and explicitly accept or reject;
- `flow.pause` and `flow.resume`: change only the named channel's outbound scheduling;
- `channel.close`: close only the named channel;
- `data`: validate channel ownership and per-direction sequence, then deliver opaque payload bytes;
- fatal `error`: classify the connection and close it;
- an unknown, malformed, out-of-order, or connection-inappropriate frame: fail closed with a stable
  bounded reason and no reflected input.

The connector does not send its own periodic application ping initially. The Hub owns the 20-second
ping cadence. Avoiding a second cadence reduces timers and nonce state while still allowing the
connector to enforce the negotiated dead-connection timeout.

## Channel admission and lifecycle

A `channel.open` is accepted only when all of these are true:

- the connector is `online` and not stopping;
- the frame uses the exact negotiated protocol;
- `capability` is exactly `ryco.rpc`;
- `effectiveRole` is `viewer`, `operator`, or `owner`;
- the channel ID is new and canonical;
- active channel count is below the negotiated maximum;
- connection and channel queue capacity can be reserved;
- a scoped RPC byte session has been constructed successfully.

The RPC session and every cleanup owner are registered before sending `channel.accept`. If any
admission step fails, the connector sends one `channel.reject` with a stable reason such as
`authorization_failed`, `channel_rejected`, `rate_limited`, or `server_draining`. It does not include
an arbitrary message.

Per-channel lifecycle is:

```text
received -> preparing -> accepted <-> paused -> closing -> removed
                    \-> rejected ----------------------^
```

Each accepted channel owns:

- exact connection generation and negotiated version;
- exact capability and effective role;
- independent inbound and outbound sequence counters starting at zero;
- one scoped RPC session;
- bounded inbound and outbound queues;
- pause state and at most one grace-frame allowance;
- terminal cleanup registered exactly once.

Unknown channel data, sequence gaps, duplicates, wrap, or data before acceptance closes the affected
channel when ownership is unambiguous. A connection-level framing or ownership violation closes the
connector. The runtime never silently drops, retries, duplicates, or reorders application data.

`channel.close` is idempotent. It interrupts only that RPC session, discards only that channel's
queued data, clears its sequence and pause state, removes its listeners, and releases its byte
reservations. It cannot close the physical connector, HTTP server, direct clients, or unrelated
channels.

When the physical WebSocket closes, all channels tied to that connection generation close and are
removed before a reconnect attempt is scheduled. Channels are never revived across connections.

## Transport-neutral RPC session bridge

The existing `/ws` route currently combines HTTP upgrade authentication, Effect RPC transport, and
the application handler layer. It will be separated into:

1. principal construction and authorization;
2. the existing shared `WsRpcGroup` handler layer;
3. a byte-oriented session transport.

`RpcByteSession` accepts:

- a scoped byte source;
- a bounded byte sink;
- an RPC principal;
- the shared application handler layer.

The direct `/ws` route adapts its authenticated socket to that interface. A relay channel adapts
`data.payload` to the same interface. Both use the existing JSON RPC serialization and the same
handler constructors. The relay path does not call the local HTTP route or create a loopback socket.

Each relay channel receives its own Effect RPC server scope with client ID zero. The handler scope
captures that channel's principal while all provider, orchestration, terminal, project, repository,
and persistence services remain shared instances from the enclosing server runtime.

RPC serialization output is converted once to its WebSocket message bytes and becomes the opaque
relay payload. Incoming opaque payload bytes are passed directly to the same RPC parser. No UTF-8
round trip, JSON inspection, payload logging, or application-specific branching occurs in the
relay connector.

## RPC principal and effective roles

The RPC session boundary receives a transport-neutral principal rather than assuming every client
has a persisted local browser session. It records only bounded local authorization information:

- transport kind: direct or relay;
- effective RPC role;
- an ephemeral channel/session reference used only for scope ownership;
- whether direct-local access administration is permitted.

It does not invent a Hub account identifier because protocol 1.2 does not provide one to the node.

Handler authorization is normalized to three access levels:

- `viewer`: read operations, snapshots, existing non-sensitive server status, and subscriptions;
- `operator`: viewer operations plus normal task, approval, terminal, project, worktree, file,
  source-control, and orchestration mutations;
- `owner`: operator operations plus local settings, provider configuration, diagnostics, and local
  credential/access administration.

Relay principals receive the exact `effectiveRole` from `channel.open`. Direct principals retain
their existing local authorization behavior. Methods that administer local pairing/session
credentials additionally require a direct-local principal even if a relay principal has owner
role. This prevents Hub authorization metadata from becoming ambient authority over unrelated
local access credentials.

The RPC method audit must classify every method explicitly; an unclassified method fails closed in
tests. Existing typed `AuthRpcError` responses are used where authorization can fail. The relay
bridge does not implement provider or command authorization outside the common handler boundary.

## Ordered opaque forwarding

For each direction, the first `data.sequence` is zero and every next frame increments by one. The
connector rejects a gap, duplicate, or wrap before delivering the payload.

Incoming `payload` remains a `Uint8Array` and is offered to the RPC session without modification.
Outgoing RPC bytes are copied only as required to detach them from mutable serializer or WebSocket
storage, then are encoded as a canonical relay `data` frame. Within a channel, the connector sends
frames in FIFO order.

Tests use binary canaries containing zero bytes, invalid UTF-8, boundary byte values, and JSON-like
text. They compare the application WebSocket message bytes before relay framing and after channel
delivery. Logs and errors are scanned for every canary.

## Backpressure and bounded buffering

The connector has one authoritative connection-byte budget from negotiated `maxQueuedBytes`.
Admission charges:

- encoded relay-frame bytes;
- a conservative WebSocket framing reserve;
- native `WebSocket.bufferedAmount` not already represented by an owned reservation;
- bounded queue-entry overhead used by the implementation.

Reservations remain owned while data moves from a JavaScript queue into native WebSocket buffering
and are released only as native buffering drains or the connection closes. A periodic drain check
exists only while buffered data is outstanding and is cancelled when idle.

The control reserve is at least one negotiated maximum control frame. Control frames use a priority
FIFO lane. Data uses fair per-channel FIFO lanes selected round-robin, so one busy channel cannot
monopolize the physical connection.

The same aggregate hard bound applies to inbound channel delivery. Per-channel ownership prevents a
slow RPC consumer from retaining the complete connection budget indefinitely.

At 75% of available data capacity, an inbound channel sends one `flow.pause`. At or below 50%, it
sends one `flow.resume`. A producer may send one already-in-flight grace frame after pause. Another
data frame before resume closes that channel with `slow_consumer`.

When the Hub sends `flow.pause`, the connector stops scheduling data for that channel while
continuing control and unrelated channels. RPC output may wait only in the bounded channel queue.
Crossing the channel or connection hard bound closes that channel with `slow_consumer`; it never
grows memory and never drops a response silently.

If a priority pong, close, or connection error cannot fit in the reserved control capacity, the
physical connection fails closed. The connector must not grow a second emergency queue.

Negotiated `maxControlFrameBytes`, `maxDataChunkBytes`, `maxQueuedBytes`, and `maxChannels` are
authoritative when they are within the public protocol bounds. Payloads larger than
`maxDataChunkBytes` are rejected before an application allocation or parse.

## Heartbeat

The connector expects the negotiated 20-second Hub ping cadence and enforces the negotiated
45-second dead-connection timeout.

For every canonical `ping`, it enqueues a priority `pong` with an exact byte copy of the nonce. The
nonce is released after send. Heartbeats are not logged, persisted, audited, or included in status.

The dead timer is based on the last valid Hub heartbeat, not arbitrary traffic. A timeout closes the
physical connection, closes its channels, and enters reconnect backoff. A late callback carrying an
old connection generation cannot keep a replacement connection alive.

Timers and clock reads are injected for deterministic 20-second and 45-second boundary tests.

## Shutdown

Server shutdown executes this idempotent connector sequence:

1. transition to `stopping` and invalidate the current generation;
2. cancel enrollment polling, proof requests, reconnect timers, stability timers, and drain polls;
3. reject new `channel.open` with `server_draining` when the socket is still writable;
4. close every active RPC session and channel independently;
5. discard channel data queues and release all reservations;
6. send only bounded terminal control frames that already fit the reserve;
7. close the Hub WebSocket;
8. detach every WebSocket/event listener;
9. clear channel, queue, timer, and connection registries;
10. complete layer finalization before shared server services stop.

Shutdown does not wait indefinitely for native buffering. Its internal drain is bounded by the
existing server shutdown scope. Repeated stop calls share one completion operation. No shutdown
path can schedule reconnect.

## Local status

The public status schema contains only:

- connector state;
- state transition timestamp;
- `retrying` or `operator_action_required` mode when degraded;
- stable failure class from a fixed enum;
- optional reconnect attempt and next retry timestamp;
- negotiated protocol major/minor while online;
- active channel count;
- aggregate connector-owned queued bytes.

It does not contain:

- Hub origin, route URL, host, or private infrastructure detail;
- node, environment, key, connection, channel, or account identifiers;
- device code, polling secret, key material, challenge, nonce, transcript, signature, or ticket;
- cookies, Authorization values, headers, payloads, queue contents, or RPC values;
- raw runtime errors, stack traces, filesystem paths, or WebSocket reason text.

The same schema backs `ryco hub status`, a direct-local-only RPC, and internal tests. Relayed
sessions cannot call this connector-control endpoint. Status snapshots and streams are bounded and
retain only the current value.

## Errors, logging, diagnostics, and persistence

Connector errors expose stable local codes only. They do not retain request bodies, responses,
URLs, headers, WebSocket frames, parser causes, or security material. Transport and codec errors are
mapped before they reach status or logging.

Lifecycle logs may contain a fixed event name, fixed state or failure class, reconnect attempt,
duration, channel count, and aggregate byte count. They must not contain the Hub origin, raw URL,
identifiers, credentials, cryptographic values, encoded frames, application payloads, provider
data, source, conversations, terminal output, files, or attachments.

The connector adds no payload tracing and does not use the existing optional WebSocket traffic log
for relay frames. Diagnostics report only the bounded status fields. Configuration export excludes
the Hub origin and all local identity state.

No relay frame, payload, queue entry, heartbeat, connection, or channel record is written to Ryco
persistence. Existing node-owned application operations may persist through their normal services
after RPC decoding; the connector does not create another persistence path.

Sensitive-canary tests scan captured logs, error serialization, diagnostics, status, configuration
exports, identity JSON, protected-store test doubles, and SQLite. Identity JSON may contain only the
already approved bounded non-bearer state and protected-store references.

## Test strategy

### Enrollment and custody

- start, device-code return, bounded polling, approval, denial, expiry, cancellation, and cleanup;
- restart during pending polling and after a lost approval response;
- key and EnvironmentId persistence across restart;
- missing, wrong, corrupt, copied, rotated, and recovered key behavior;
- protected-store backend selection and explicit fallback requirements;
- no bearer or private key in command arguments, state JSON, output other than the intentional
  one-time device code, logs, status, or exports.

### Authentication and state machine

- exact challenge transcript and canonical node auth fixture;
- auth frame is first and sent before the five-second deadline;
- ready deadline, protocol negotiation, invalid limits, and unsupported version;
- wrong key, copied node ID, replay, rotation activation, revocation, replacement, and recovery;
- every explicit state transition and stale-generation callback rejection;
- cold-start authentication collapse remains non-retrying and is not mislabeled as revocation.

### Reconnect

- exact exponential windows and jitter bounds with injected randomness;
- maximum delay and bounded protocol retry-after behavior;
- reset only after the stable interval;
- DNS, network, TLS, timeout, draining, rate limit, authentication failure, replacement, revocation,
  incompatible version, enable/disable, and shutdown;
- repeated failures leave exactly one socket attempt or retry timer;
- burst simulations prove reconnect timing is distributed and bounded.

### RPC bridge and channel isolation

- a real `WsRpcGroup` request/response and subscription through a simulated canonical channel;
- viewer, operator, owner, and direct-local-only authorization matrices;
- accept, reject, decision failure, orderly close, remote close, malformed close, and reconnect;
- multiple simultaneous channels with independent RPC scopes and sequences;
- local direct clients remain connected while relay channels churn;
- one channel's slow consumer, RPC defect, cancellation, or closure cannot affect another channel,
  the physical connector, or the server;
- existing provider, orchestration, terminal, project, persistence, desktop-local, LAN, and
  SSH-assisted tests remain green.

### Byte integrity and bounds

- ordered byte-exact forwarding in both directions with binary payload canaries;
- zero-length and maximum negotiated payloads;
- gaps, duplicates, wrap, unknown channels, data before accept, and stale generations;
- pause/resume thresholds, one grace frame, ignored pause, and slow consumers;
- aggregate JavaScript plus native WebSocket buffering never exceeds the negotiated hard bound;
- fair scheduling across channels and priority control delivery;
- heartbeat response at 20 seconds and timeout at 45 seconds;
- malformed, oversized, text, and noncanonical WebSocket messages fail closed.

### Cleanup and leakage

- enrollment cancellation, channel close, socket loss, reconnect churn, restart, and shutdown leave
  zero sockets, retry timers, stability timers, heartbeat timers, drain polls, queues, listeners,
  channel entries, RPC scopes, and retained payload references;
- repeated channel and connection churn is measured for retained memory;
- payload, credential, key, challenge, nonce, signature, URL, provider, source, conversation,
  terminal, file, and attachment canaries are absent from logs, errors, diagnostics, status,
  configuration exports, and persistence.

Tests use both deterministic fake transports and a real local WebSocket test server implementing
the canonical public protocol. Tests never depend on a production Hub or copy compatibility
fixtures.

## Documentation

Public documentation will cover:

- enabling and disabling the connector;
- exact origin requirements and safe reconnect defaults;
- enrollment commands, approval polling, cancellation, and restart recovery;
- protected key custody and explicit fallback behavior;
- the connector state machine and operator-action failures;
- challenge preflight, first-frame authentication, negotiated limits, and key rotation;
- channel admission, effective roles, RPC bridging, byte ordering, and close isolation;
- flow pause/resume, slow consumers, heartbeat, and bounded queues;
- reconnect classification, replacement behavior, shutdown, status, and troubleshooting;
- the trusted relay boundary and the absence of payload persistence or logging.

The main README will list outbound Hub connectivity and link to the detailed connector guide. The
node identity guide will identify the production connector as the consumer of the existing
primitives. Relay-protocol documentation changes only if an existing statement needs clarification;
schemas and fixtures do not change.

## Known limitations

- One Ryco server connects to at most one Hub.
- Logical channels are not resumed. Every physical reconnect requires fresh proof, and clients must
  establish fresh channels through their deployment's authorization flow.
- The connector does not retry or replay application payloads. Durable snapshot and event replay
  remain inside Ryco RPC and orchestration behavior.
- Protocol 1.2 gives the node an effective role but not a human account identity. The connector
  cannot invent cross-device command identity.
- A cold-start revoked identity is deliberately indistinguishable from other fresh-proof failures;
  only a live canonical revocation signal produces explicit `revoked` status.
- Protected-store contents are machine/user scoped and are not a portable backup.
- This design adds no end-to-end payload encryption beyond WSS transport security.

## Acceptance conditions

The implementation is complete only when:

- an enrolled NAT-bound node needs only outbound DNS and HTTPS/WSS;
- enabling the connector opens no listener and creates at most one outbound WebSocket;
- credentials survive restart without entering logs, exports, command arguments, or ordinary
  persistence;
- authentication, reconnect, heartbeat, channel, backpressure, and shutdown behavior match this
  design under deterministic tests;
- a real Ryco RPC exchange succeeds through the canonical simulated relay;
- direct clients and relayed clients use the same application services and remain isolated;
- every queue, timer, listener, scope, and reference is released on terminal paths;
- no canonical relay schema or fixture change is required;
- all repository quality gates and the existing direct-mode regression suite pass.
