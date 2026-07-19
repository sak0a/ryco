# Hosted Retry State Ownership Repair

## Context

The hosted relay UI can remain stuck in `reconnecting` while its WebSocket and relay channel are
healthy. `HostedRelayAttemptFactory.getReconnectDelayMs()` currently changes the hosted transport
status as a side effect. That callback supplies the Effect RPC retry schedule, which is shared by
socket reconnection and non-socket protocol or stream retries. A routine protocol retry can
therefore publish a socket-level state transition even though no socket lifecycle event occurred;
because the socket stays open, no later open event restores `online`.

## Decision

Make hosted transport status follow concrete relay lifecycle events, not the generic retry clock.
`getReconnectDelayMs()` will calculate and consume backoff inputs only. Actual socket closure,
socket failure, and relay-ticket provider failure already have generation-scoped paths that update
hosted state and remain the only owners of reconnecting or failure transitions.

The shared RPC retry policy and its delay callback remain unchanged. This avoids changing retry
timing or behavior for direct, desktop, or other WebSocket consumers while repairing the hosted
state projection at its source.

## Changes

1. Remove the hosted `transportStatus(..., "reconnecting")` side effect from the attempt factory's
   reconnect-delay callback.
2. Preserve delay calculation, one-shot `Retry-After` consumption, reconnect limits, ticket
   freshness, generation checks, request delivery-unknown handling, and authorization policy.
3. Keep actual relay lifecycle ownership on the existing paths:
   - a non-intentional socket close invokes the generation-scoped connection-closed transition;
   - a socket failure publishes its classified hosted failure;
   - a relay-ticket provider failure publishes its classified hosted failure;
   - a successful relay handshake and channel open restores `online`.
4. Replace the test that expects the delay callback to publish `reconnecting` with focused state
   ownership coverage.

## Verification

Focused tests must prove all of the following:

- invoking the generic retry-delay callback while the relay is online leaves hosted transport state
  online;
- the callback still returns reconnect backoff and consumes a server-provided retry delay once;
- a non-intentional close still transitions the active generation to reconnecting and permits a
  fresh-ticket reconnect;
- socket and ticket-provider failures still publish their classified retryable or terminal state;
- delayed callbacks from an obsolete or reset generation cannot change current hosted state.

Run the affected web tests, formatting, lint, both required typecheck paths for touched Effect code,
the repository test command, and the normal build or package gates used by CI.

## Security and Compatibility

No relay schema, ticket policy, authentication, Origin, RP-ID, cookie, CSRF, role, or authorization
boundary changes. Tickets remain single-use and memory-only. Pending non-idempotent requests remain
delivery-unknown after a genuine connection failure and are not silently replayed. The change is
backward-compatible because it corrects local UI state ownership without changing the wire
protocol.

## Non-Goals

This repair does not add persistent node selection, redesign hosted connection controls, change
retry intervals, broaden reconnect or load qualification, or modify deployment infrastructure.
