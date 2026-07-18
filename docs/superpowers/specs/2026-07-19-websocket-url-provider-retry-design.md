# WebSocket URL-provider reconnect design

**Status:** Approved design

**Date:** 2026-07-19

## Summary

`WsTransport` accepts either a static WebSocket URL or an asynchronous provider. Hosted Hub mode
uses the provider to request a fresh, single-use relay ticket before every physical connection.
During a real service drain, the provider received a transient HTTP 503. The provider rejection was
reported to lifecycle state and then converted to an Effect defect before the existing WebSocket
retry schedule could run. The already-connected browser remained in reconnecting state even after
the service and node connector recovered; a fresh browser transport connected immediately.

The repair will apply the existing bounded WebSocket retry schedule to asynchronous URL resolution
as well as socket failures. Each retry re-invokes the provider. Hosted mode therefore requests a
fresh ticket after transient ticket-preflight failure, while terminal hosted failures still stop
through the existing `shouldReconnect` predicate. Static URLs, relay framing, authentication,
request delivery semantics, and private deployment policy remain unchanged.

## Evidence and failure boundary

`HostedRelayAttemptFactory.nextUrl()` requests a memory-only relay ticket and records bounded hosted
failure state. `createWsRpcProtocolLayer()` turns that promise into an Effect, normalizes the
returned URL, reports provider errors, and currently calls `Effect.orDie`. The Effect RPC protocol's
retry schedule surrounds `socket.runRaw()`, but a defect raised while acquiring the URL/socket
escapes that typed socket-error retry path.

This was observed during a controlled staging redeployment:

- readiness withdrew and the relay endpoint returned a transient unavailable response;
- the node connector recovered automatically after the new service became ready;
- the existing browser stayed on its first reconnect indication beyond the complete backoff window;
- a fresh browser transport obtained a new ticket, opened a relay channel, and synchronized the
  same node state immediately.

The evidence isolates the failure to browser transport acquisition. It is reusable public behavior:
any asynchronous URL provider can reject transiently before a WebSocket object exists.

## Considered approaches

### Retry asynchronous URL resolution with the transport schedule (selected)

Move construction of the existing retry schedule before URL resolution and apply it to the provider
Effect before its final infallible boundary. The same schedule definition remains authoritative for
provider and socket retry timing. This is generic, preserves fresh-provider semantics, and makes the
smallest change to the established transport.

Effect 4's `Socket.layerWebSocket` requires its URL Effect to be statically infallible. Therefore the
implementation cannot simply delete `Effect.orDie` or pass an arbitrary provider error through the
socket layer without changing or casting the dependency API. Instead, the provider Effect retries
with the transport schedule and reaches `orDie` only after the schedule stops or is exhausted. At
that point no automatic retry remains available, so the terminal conversion does not suppress a
valid retry.

### Retry inside the hosted ticket provider

`HostedRelayAttemptFactory.nextUrl()` could own a separate retry loop. That would repair this one
consumer but duplicate timing and cancellation policy, leave other asynchronous URL providers
vulnerable, and blur the provider/transport boundary. This approach is rejected.

### Rebuild the complete transport session after provider rejection

The UI or environment coordinator could dispose and replace `WsTransport`. That is substantially
broader, can churn streams and request state, and would work around rather than repair the shared
transport failure. This approach is rejected.

## Component design

### Shared retry schedule

`createWsRpcProtocolLayer()` will construct one immutable schedule description before resolving the
URL. Each application of an Effect schedule receives its own driver state. The schedule continues
to use:

- the configured reconnect maximum;
- the caller's delay function or canonical direct-client backoff;
- the existing `shouldReconnect` predicate.

The same schedule value will be applied independently to asynchronous provider resolution and to
the Effect RPC socket loop. Hosted mode's `HostedReconnectPolicy` remains the mutable source of
backoff progression and `Retry-After` handling across both failure phases.

### Asynchronous URL provider

For a dynamic provider, each attempt will:

1. invoke the provider once;
2. normalize and validate the returned `ws:` or `wss:` URL;
3. report a fixed provider-failure message through the existing lifecycle handler on rejection;
4. consult the same retry schedule;
5. re-invoke the provider after the scheduled delay when reconnect remains allowed.

Only a successfully resolved URL reaches the WebSocket constructor and records a socket connection
attempt. A provider rejection cannot create a socket or consume a pending hosted ticket. URL values
and ticket material retain their current custody and logging rules.

Static URL handling remains synchronous and unchanged.

### Hosted attempt factory

No hosted-only retry loop or new state is required. `nextUrl()` continues to classify HTTP failures,
store only bounded failure metadata, and update hosted transport state. A retryable failure leaves
`shouldReconnect()` true and can supply `Retry-After` to the existing hosted delay policy. A later
provider invocation requests a completely fresh ticket.

An authorization, revocation, incompatibility, session-expiry, or selection-generation failure
continues to set terminal or inactive state before rejecting. `shouldReconnect()` then stops the
provider schedule. No WebSocket is opened and no credential is reused.

## Data flow

1. An active transport starts or loses its physical WebSocket.
2. The URL provider requests the next connection URL; hosted mode also requests a fresh ticket.
3. A transient provider failure updates bounded lifecycle/hosted state and yields to the configured
   reconnect delay.
4. Cancellation, disposal, generation replacement, or terminal hosted state stops further attempts.
5. Otherwise the provider runs again and obtains fresh attempt material.
6. A valid URL reaches the unchanged WebSocket constructor and Effect RPC socket loop.
7. Successful open, authentication, channel creation, heartbeat, RPC, and stream synchronization
   follow existing behavior.

## Error handling and delivery safety

The repair does not make every failure retryable. Retry eligibility remains controlled by the
caller's existing state classification and `shouldReconnect()` predicate. Provider errors continue
to call `onError` and clear tracked request latency state, but the shared layer will no longer
reflect an arbitrary provider exception message into client-visible state. It will use one fixed
provider-failure message. Hosted terminal failures update their already bounded state before the
schedule evaluates continuation.

`retryTransientErrors: false` in hosted mode remains unchanged. It controls whether a socket-open
error is broadcast to Effect RPC clients while retrying; it does not classify ticket-preflight
failures. The new provider retry path does not replay RPC requests, revive relay channels, or clear
delivery-unknown state. Every physical hosted connection still requires a fresh ticket and channel.

If retries are exhausted, the provider Effect reaches the existing terminal defect boundary. If the
transport is disposed or replaced while waiting, scoped Effect interruption cancels the delay and
prevents another provider call.

## Security and compatibility

The repair preserves:

- canonical relay protocol 1.2 schemas, fixtures, framing, and ticket policy;
- one fresh, memory-only ticket for every hosted physical connection attempt;
- Passkey session, CSRF, Origin, RP-ID, cookie, role, and grant boundaries;
- terminal handling for session expiry, revocation, authorization removal, and incompatibility;
- bounded queues, flow control, request non-replay, and delivery-unknown semantics;
- URL validation and path-preservation behavior;
- payload-, credential-, ticket-, response-body-, provider-exception-, and private-identifier-free
  diagnostics.

No Hub-specific endpoint, private infrastructure detail, or deployment policy is added to the
public transport.

## Testing

Focused transport tests will prove:

- an async provider that rejects once and then succeeds is invoked again and opens one socket;
- a connected socket that closes can encounter a transient provider rejection and then recover with
  a newly resolved URL;
- each provider retry follows the configured delay function and bounded retry count;
- `shouldReconnect()` becoming false prevents another provider call;
- disposal during backoff prevents another provider call;
- static URL behavior and normal socket reconnect remain unchanged;
- lifecycle errors remain bounded and do not include supplied sensitive canaries.

Focused hosted integration tests will prove:

- transient ticket-preflight failure is followed by a fresh ticket request and successful socket
  construction;
- terminal ticket failure stops without opening a socket;
- a ticket is consumed at most once and no request is replayed.

Affected public gates are focused WebSocket and hosted transport tests followed by `bun fmt`,
`bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run typecheck:effect`, `bun run test`,
`bun run build`, browser tests, and release smoke as required by the repository. Canonical relay
schemas and compatibility fixtures must have no diff.

## Completion boundary

The public repair is complete when the regression fails on prior behavior, passes with provider
retry, all required public gates pass, review finds no security or compatibility regression, and
the public pull request merges. Updating the private Hub gitlink and repeating the approved live
drain qualification remain separate private operations with their own exact change packet.
