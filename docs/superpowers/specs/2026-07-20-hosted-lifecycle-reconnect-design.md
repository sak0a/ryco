# Hosted lifecycle reconnect ownership design

**Status:** Approved design

**Date:** 2026-07-20

## Summary

Hosted Hub mode must recover from browser offline/online and background/foreground transitions
without a refresh or node reselection. Recovery remains fail-closed: the browser must validate its
account session and authorized directory entry, establish a fresh relay attempt, and accept a
current shell snapshot before any mutation becomes available.

The current client has overlapping reconnect owners. The hosted lifecycle controller performs the
required access revalidation and connection-generation replacement, while generic WebSocket UI and
environment-runtime listeners can independently force the existing environment connection to
reconnect on online, focus, visibility, or pageshow events. Those generic reconnects are valid for
direct and saved environments, but in hosted mode they can race the hosted teardown. A relay
channel may then belong to a different connection or generation than the shell subscription that
must publish readiness.

Hosted mode will have one lifecycle owner. Suspension will invalidate hosted authority and enqueue
an idempotent transport-only teardown. Resume will be coalesced and will run the complete hosted
access, relay, and snapshot sequence. Generic forced-reconnect paths will remain enabled for
non-hosted environments and will not run in hosted mode.

## Evidence and failure boundary

The failure is reproducible after an established hosted session is made browser-offline and then
returned online. The UI remains on its connecting surface beyond the synchronization deadline even
though the node-side connector is online with one relay channel. A new browser connection can
synchronize the same node promptly.

The code has three browser-lifecycle recovery paths:

1. `HostedHubRoot` calls `HostedHubController.suspendBrowser()` and `resumeBrowser()`.
2. `WebSocketConnectionCoordinator` forces the primary environment connection to reconnect on
   online and focus events.
3. The environment runtime reconnects heartbeat-stale connections on visibility and pageshow.

The hosted controller increments its generation when suspending. Existing environment handlers
capture the generation from their creation. A generic reconnect can therefore open transport work
through an environment whose shell handlers are already obsolete, while hosted resume concurrently
replaces that environment. Unit tests currently cover each transition in isolation or mock
`activateHostedNode`; they do not compose lifecycle events, environment replacement, relay
callbacks, and a fresh shell snapshot.

## Considered approaches

### Single hosted lifecycle owner with serialized transport teardown (selected)

Hosted suspension explicitly queues a transport-only disconnect, and hosted resume remains the
only path that can create the replacement environment connection. The generic UI and environment
resume listeners continue to observe or report connection state but do not force reconnects in
hosted mode.

This approach directly enforces the security order, makes physical connection ownership
deterministic, and leaves non-hosted recovery behavior unchanged. It also gives integration tests
one authoritative lifecycle to drive.

### Suppress only generic hosted reconnect listeners

Mode guards around the generic online, focus, visibility, and pageshow reconnect calls would remove
the observed race with a small diff. This does not make stale physical connection teardown an
explicit suspension invariant and leaves more behavior dependent on eventual socket failure or the
later resume path. It is insufficient for deterministic background handling.

### Add a global environment reconnect mutex

A global mutex could serialize every `EnvironmentConnection.reconnect()` and environment
replacement. It would affect direct and saved environments, and it would still permit a hosted
reconnect before session and grant revalidation unless additional policy were embedded in the
generic layer. The broader coupling is unnecessary.

## Architecture

### Hosted state controller

`HostedHubController` remains authoritative for browser suspension and resume.

Suspension will:

- invalidate the browser lifecycle and selected connection generation;
- abort in-flight resume, directory, retry, and synchronization work;
- publish explicit suspended or offline state and stale session state;
- clear current mutation authority immediately; and
- request an idempotent hosted transport suspension without clearing same-node UI state.

Resume will continue to coalesce concurrent callers. It will:

1. restore and validate the current account session;
2. refresh the directory and effective grant for the selected node;
3. terminate if the session expired or selection is no longer authorized;
4. start one fresh selected-node generation;
5. activate one fresh environment/relay attempt; and
6. remain synchronizing until the current generation accepts a shell snapshot.

### Hosted environment transition

`hostedHub/environment.ts` will expose a transport-only suspension boundary distinct from full node
deactivation. It will reuse the existing serialized transition queue and will:

- reset attempt-local relay ticket and request state;
- remove and dispose the current primary environment connection;
- preserve the selected node descriptor, active environment identity, drafts, projections, queued
  UI state, and terminal presentation needed for same-node recovery; and
- become a no-op when the same hosted transport is already absent.

Full deactivation for sign-out, authorization removal, revocation, or node switching will keep its
existing node-scoped cleanup behavior.

Activation will run behind any queued suspension. It will check the caller's abort signal before
creating a connection, create at most one current primary connection, and use the current hosted
generation for all environment handlers.

### Generic connection recovery

The generic WebSocket connection coordinator will keep browser online state and connection UI
current in every mode. Its forced online/focus retry, stalled-retry restart, and manual generic
reconnect action will not control the hosted primary environment. Hosted controls and the hosted
transport's bounded retry policy remain responsible for hosted retry.

The environment runtime's visibility/pageshow reconnect listener will be installed only for
non-hosted mode. Saved, direct-browser, desktop-local, and desktop-managed environments retain the
existing behavior.

### Relay and snapshot readiness

Every hosted activation uses a fresh `HostedRelayAttemptFactory` attempt and therefore a fresh
memory-only ticket. Relay status, role, request, close, and snapshot callbacks retain their
generation checks.

Opening a relay channel is not session readiness. Only a current shell snapshot can mark the
current selected environment and generation ready. Stream subscriptions required to obtain that
snapshot remain the only requests allowed while synchronizing. All mutations remain denied until
transport, browser, directory, role, and session state are simultaneously current.

## Lifecycle data flow

```text
browser offline/hidden
  -> invalidate hosted generation and mutation authority
  -> enqueue transport-only disconnect
  -> preserve same-node presentation state

browser online/visible/pageshow
  -> coalesce resume events
  -> validate account session
  -> refresh authorized directory entry and effective role
  -> await serialized stale-transport teardown
  -> create one current environment connection
  -> request a fresh relay ticket
  -> open and authenticate a fresh relay channel
  -> subscribe to the shell
  -> accept a current shell snapshot
  -> mark current generation ready
  -> enable role-authorized mutations
```

Repeated offline, hidden, online, visible, focus, or pageshow events cannot create another hosted
environment connection while suspension or resume is already active. A newer suspension aborts an
older resume, and all callbacks from superseded generations remain inert.

## Error handling

- Session expiry clears account, selection, role, transport, and node-scoped state through the
  existing account-expiry boundary. It does not open another relay.
- Directory failure leaves the browser stale, clears effective role authority, and uses the
  existing bounded directory retry. A later successful refresh restarts the full resume sequence.
- Authorization removal, revocation, and incompatibility remain terminal and perform full hosted
  deactivation.
- Retryable ticket and relay failures retain bounded backoff and request a fresh ticket for each
  attempt.
- Synchronization retains its 30-second generation-scoped deadline. Expiry produces the stable
  synchronization failure and a bounded hosted retry action.
- Non-idempotent pending requests retain delivery-unknown state and are never automatically
  replayed.
- Teardown and retry failures expose stable bounded messages and diagnostics without URLs,
  identifiers, response bodies, tickets, payloads, or provider exceptions.

## Testing

Tests will add a deterministic composed hosted lifecycle harness. It will use the real hosted
controller, hosted environment transition, environment connection shell bootstrap, generation
checks, and relay-attempt lifecycle. Only Hub HTTP responses, socket I/O, and the node snapshot
source will be controlled test boundaries. The test must fail on the prior behavior because a
generic reconnect overlaps hosted resume, rather than merely asserting that the controller calls a
mocked activation function.

Focused coverage will prove:

- offline to online performs one stale teardown, one fresh relay attempt, and one current snapshot;
- hidden/background to visible performs the same complete recovery;
- repeated and overlapping lifecycle events are coalesced without loops;
- callbacks and snapshots from a stale generation cannot publish role, readiness, or mutations;
- same-node reconnect preserves node-scoped presentation state while replacing transport state;
- opening a relay channel without a shell snapshot reaches the synchronization timeout;
- session expiry during resume clears authority and prevents another socket or ticket attempt;
- only one relay attempt and one environment connection exist after recovery;
- mutation authorization remains false until the current shell snapshot marks the session ready;
- delivery-unknown state survives recovery until explicit acknowledgement; and
- direct, saved, and desktop connection recovery retain their current online/focus/visibility
  behavior.

Existing hosted transport, relay socket, environment connection, state, browser lifecycle, and
connection-surface tests will remain. The complete public gate set will include formatting, lint,
TypeScript and Effect typechecks, the repository test command, web browser tests, build, and release
smoke.

## Security and compatibility

This repair changes client lifecycle ownership only. It does not change:

- relay protocol 1.2 schemas, fixtures, framing, compatibility, or queue limits;
- Hub endpoints, ticket creation or consumption, node proof, or relay authorization;
- passkey, cookie, CSRF, Origin, RP-ID, role, grant, or revocation policy;
- application request delivery, idempotency, or delivery-unknown semantics;
- service-worker caching or browser persistence policy; or
- Hub persistence, migrations, deployment, or operational configuration.

Tickets remain single-use and memory-only. Hosted payloads and node-owned data remain outside
browser persistence and Hub persistence. Direct and desktop clients remain wire-compatible because
the relay and RPC protocols are unchanged.

## Non-goals

This work does not add background execution guarantees, persistent hosted node selection, offline
node data, a new reconnect interval, a protocol change, a generic environment lifecycle rewrite,
deployment changes, or physical-device qualification evidence.
