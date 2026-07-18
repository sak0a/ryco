# Hosted relay session readiness design

**Status:** Approved design

**Date:** 2026-07-18

## Summary

The hosted client can establish a logical relay channel while remaining indefinitely on its
session-synchronization surface. Subscription callback failures are intentionally swallowed to keep
long-lived streams alive, and the startup surface has no bounded failure transition when the
initial orchestration shell snapshot never becomes usable. Those behaviors allow the observed
failure to remain silent whether the snapshot is lost before delivery or fails during application.

The fix belongs in public Ryco because the hosted logical WebSocket, RPC client, node byte session,
orchestration subscription, and client readiness state are reusable public components. It will add
an end-to-end streamed-RPC regression across those components, repair the first failing boundary,
and make initial synchronization fail visibly instead of waiting forever. It will not change the
canonical relay protocol, schemas, fixtures, role policy, ticket behavior, or Hub policy.

## Evidence and current gap

The physical node connection and one logical channel can remain online with bounded queues, while
the hosted UI still waits for `sessionEstablished`. The UI sets that flag only after accepting and
applying the first `orchestration.subscribeShell` snapshot.

Existing tests prove these pieces independently:

- `RpcByteSession` carries a unary Effect RPC request;
- an isolated diagnostic confirms that it can emit a streamed chunk, accept its acknowledgment,
  and complete the stream;
- `HostedRelayRpcWebSocket` forwards arbitrary payload bytes;
- direct WebSocket tests cover orchestration shell subscriptions;
- hosted state tests cover explicit ready and replay transitions.

No test currently joins the hosted logical WebSocket, canonical relay frames, node
`RpcByteSession`, streamed RPC acknowledgment, shell snapshot application, and hosted readiness.
Consequently, a boundary failure can leave a healthy-looking relay channel and an endless spinner.

## Considered approaches

### End-to-end boundary repair (selected)

Add the missing integration harness, reproduce the stalled initial stream, and repair the first
failing boundary. Couple that with a bounded startup failure and explicit callback-failure handling.
This proves the actual data path and preserves existing security and transport contracts.

### UI timeout and blind retry

A timer could reconnect or render the application without proving that the snapshot arrived. This
would hide the defect, risk duplicate attempts, and could expose an application shell backed by
incomplete state. It is rejected.

### Private service workaround

The private service could special-case readiness or add a parallel snapshot endpoint. That would
duplicate public behavior, split compatibility ownership, and weaken the public/private boundary.
It is rejected.

## Integration boundary

The regression harness will exercise one in-memory connection with production components on both
sides:

1. The hosted client obtains a logical socket backed by `HostedRelayRpcWebSocket`.
2. The harness exchanges canonical authentication, ready, channel-open, and channel-accept frames.
3. Client RPC bytes cross canonical data frames to a real node `RpcByteSession`.
4. The node runs a real streamed RPC handler that emits an initial shell snapshot and a later event.
5. The first chunk crosses back to the client and the Effect RPC acknowledgment returns to the node.
6. The client applies the snapshot and marks the selected hosted environment ready.
7. The later event proves that the stream remains live after startup.

The harness will use public test identifiers and synthetic metadata only. It will not contain a
deployment hostname, private issue reference, ticket, cookie, device code, node key, or relay
payload taken from a real service.

## Readiness behavior

`sessionEstablished` continues to mean that the selected environment has an accepted shell
snapshot in the client store. A physical WebSocket open, relay channel acceptance, successful
unary RPC, or receipt of an unaccepted snapshot is insufficient.

For a valid initial snapshot, the startup sequence is ordered as follows:

1. validate and accept the projection version;
2. apply the shell snapshot to the selected environment;
3. record the accepted projection version;
4. mark the hosted session ready;
5. reconcile secondary UI-derived state.

Secondary reconciliation must not prevent a successfully applied core snapshot from releasing the
startup gate. If secondary reconciliation throws after the core snapshot is committed, readiness is
not rolled back. The client emits only a stable `hosted_snapshot_reconciliation_failed` diagnostic
code, without the exception, snapshot, environment identifier, or project metadata.

An unchanged snapshot received while replaying is also sufficient to restore readiness when its
environment matches the selected node and the previously applied version is still available. It is
not applied twice, but it confirms that the replay stream has reached the current projection.

## Failure behavior

The initial shell subscription receives a 30-second startup deadline owned by the hosted session
transition, not by the canonical relay protocol. If no usable snapshot arrives before the deadline,
the client leaves the synchronization surface and shows the stable message "Ryco state could not be
synchronized." The failure surface provides a Retry action. Retry increments the selection
generation, tears down the old logical session, requests a fresh one-use relay ticket, and activates
the same selected node through the normal connection path. It does not render the application shell
without a snapshot.

Stream transport failures retain the existing reconnect policy. A transport, decoding, validation,
or core snapshot-application failure during initial synchronization immediately enters the same
bounded failure surface. Its raw error is neither persisted nor rendered. A secondary derived-state
failure after core application follows the bounded diagnostic behavior above. Reconnects remain
generation-scoped so an old timer or callback cannot fail or ready a newer node selection.

The deadline is cleared when the session becomes ready, the node selection changes, the account is
cleared, or the hosted environment is deactivated. It does not introduce a second physical-socket
retry loop.

## Security and compatibility

The implementation preserves:

- exact same-origin hosted routing;
- relay-ticket issuance and one-use ticket behavior;
- viewer/operator/owner RPC authorization;
- canonical relay framing, sequencing, flow control, payload limits, and acknowledgments;
- bounded queues and slow-consumer handling;
- node ownership of projects, files, terminals, conversations, and relay payloads;
- existing direct-browser, desktop, SSH-assisted, and outbound-connector behavior.

No CORS, cookie, Origin, WebAuthn, CSRF, role, or relay policy is relaxed. No canonical schema or
fixture changes are required.

## Verification

Focused tests will cover:

- initial streamed shell snapshot across the complete hosted relay boundary;
- client acknowledgment and a subsequent streamed event;
- hosted readiness only after core snapshot application;
- unchanged snapshot readiness during replay without duplicate application;
- core snapshot decoding, validation, or application failure producing a bounded startup failure;
- explicit same-node retry using a fresh generation and relay ticket;
- the exact 30-second startup deadline boundary;
- startup deadline cancellation on ready, selection change, sign-out, and teardown;
- generation isolation for stale callbacks and timers;
- existing payload, flow-control, role, and reconnect limits.

The public quality gates are `bun fmt`, `bun lint`, `bun typecheck`,
`bun run typecheck:effect`, and `bun run test`. Existing hosted-client, direct-browser, desktop,
identity, and outbound-connector tests remain green. A staging qualification happens only after the
public change is merged and consumed through an immutable private dependency pin.

## Completion boundary

The public change is complete when the regression fails on the current implementation, passes with
the repair, all public gates pass, and the public PR merges without canonical relay drift. Private
dependency pinning, service deployment, and live qualification remain separate authorized work.
