# Hub proof-preflight retry classification design

**Status:** Approved design

**Date:** 2026-07-18

## Summary

The outbound Hub connector currently treats every failure while creating a node relay
authentication frame as `authentication_failed`. That includes local identity failures and real Hub
authentication rejection, but also transient HTTPS proof-preflight failures such as a timeout,
network interruption, rate limit, service drain, or other 5xx response. Because
`authentication_failed` deliberately requires operator action, an ordinary Hub deployment can
leave an otherwise valid enrolled node offline until its Ryco process restarts.

The repair will preserve a small bounded failure classification from the proof-preflight HTTP
transport through the node-proof client and connector session. Transient service availability
failures will enter the existing bounded reconnect policy. Explicit identity rejection will remain
terminal. No relay protocol, authentication transcript, key-custody rule, Hub policy, or private
deployment behavior will change.

## Evidence and failure boundary

Relay session authentication begins by asking `HubIdentityRuntime` to create the canonical node
authentication frame. That operation first calls the credential-free HTTPS node-challenge route,
validates the returned challenge, and signs the established transcript with the protected local
key.

Today, `fetchBoundedJson` invokes one caller-supplied failure function for transport exceptions,
timeouts, oversized bodies, malformed JSON, and invalid responses. `HubNodeProofClient` also
collapses non-success HTTP statuses, challenge validation failures, state failures, key-selection
failures, and signing failures into `node_proof_failed`. `RelayConnectionSession.authenticate()`
then catches the combined error and throws `authentication_failed`.

The connector correctly retries canonical `server_draining`, network, timeout, rate-limit, and
isolated internal failures once those reasons reach its state machine. The defect is therefore the
loss of reason information before the WebSocket opens, not the reconnect policy itself.

## Considered approaches

### Preserve bounded proof-preflight failure categories (selected)

Classify transient HTTP availability separately from explicit authentication rejection and invalid
successful responses. Carry only a stable enum through the existing public runtime boundaries.
This restores deployment recovery while retaining fail-closed identity behavior.

### Retry every proof creation failure

Mapping all `node_proof_failed` results to a transient network failure would be smaller, but it
would also retry missing protected keys, origin mismatch, revoked nodes, stale key identifiers, and
malformed proof material. That could hide operator-action conditions and create indefinite retry
loops. This approach is rejected.

### Special-case one Hub deployment or response body

A deployment-specific workaround could recognize one service's drain response or restart the node
process externally. That would couple reusable public connector behavior to private infrastructure
and would not cover generic network, timeout, or 5xx failures. This approach is rejected.

## Failure taxonomy

The proof-preflight boundary will expose only stable bounded categories and will never retain a URL,
response body, remote error message, credential, challenge, signature, key, or filesystem path.

| Condition                                                                             | Connector classification  | Disposition                                              |
| ------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| Fetch exception, abort, timeout, or connection loss                                   | `network`                 | Bounded automatic retry                                  |
| HTTP 429                                                                              | `rate_limited`            | Bounded automatic retry using the existing local backoff |
| HTTP 503                                                                              | `server_draining`         | Bounded automatic retry                                  |
| Other HTTP 500–599                                                                    | `network`                 | Bounded automatic retry                                  |
| Explicit 400–499 identity/key rejection other than 429                                | `authentication_failed`   | Operator action                                          |
| Successful response with malformed JSON, invalid bounds, or invalid challenge binding | `protocol_invalid`        | Existing one-retry-then-operator policy                  |
| Missing/corrupt local state, protected-key failure, or origin mismatch                | Existing identity failure | Operator action                                          |
| Signing failure after a valid challenge                                               | Existing identity failure | Operator action                                          |

Status classification must not parse or expose arbitrary remote text. A completed non-success
response is classified from its numeric HTTP status after its body is cancelled or consumed under
the existing byte bound. Malformed JSON in a non-success response does not override the status
classification. This repair does not accept remote retry metadata; the connector's existing local
bounded backoff remains authoritative.

## Component design

### Bounded HTTP transport

The node-challenge transport will distinguish a fetch/timeout failure from a completed HTTP
response. It will retain only the bounded internal failure reason derived from the numeric status.
Existing response-size, redirect, credential omission, cache, referrer, and timeout controls remain
unchanged.

### Node-proof client and runtime

`HubNodeProofClientError` will carry exactly one of `network`, `rate_limited`,
`server_draining`, `authentication_failed`, `protocol_invalid`, or `identity_unavailable`.
Challenge validation, state binding, key selection, and signing continue to fail closed.
`HubIdentityRuntime` will preserve a recognized bounded node-proof reason instead of replacing it
with an undifferentiated `node_proof_failed` error.

The public `HubIdentityRuntimeShape` will continue returning either a canonical authentication
frame or a rejected promise. No security material will be added to the result or error.

### Relay connection session

`RelayConnectionSession.authenticate()` will translate the preserved proof reason to the existing
`ConnectorFailureKind` set. Once translated, the current state machine remains authoritative for
retry versus operator action. The WebSocket authentication error path is unchanged: an explicit
relay `authentication_failed` frame remains terminal.

## Data flow

1. The connector begins a connection generation.
2. The node-challenge transport attempts the bounded credential-free HTTPS request.
3. A transient transport or service-availability failure returns a bounded retryable reason.
4. The session maps that reason into the existing reconnect state machine without opening a
   WebSocket or creating more than one reconnect timer.
5. A later generation requests a fresh challenge and creates a fresh signature; no challenge or
   proof is replayed.
6. Explicit rejection or local identity failure enters the existing operator-action state.
7. A successful challenge follows the unchanged transcript, signature, WebSocket authentication,
   ready-frame, heartbeat, and channel paths.

## Security and compatibility

The repair preserves:

- canonical relay protocol 1.2 schemas, fixtures, framing, and close reasons;
- the exact node authentication transcript and fresh single-use challenge;
- protected local private-key custody and no-export interfaces;
- credential-free proof preflight with no cookies or Authorization header;
- exact Hub origin binding and production HTTPS requirements;
- terminal handling for explicit authentication rejection, revocation, origin mismatch, and local
  identity failure;
- bounded exponential backoff, jitter, stability reset, and one reconnect generation/timer;
- payload-, credential-, origin-, and path-free status and diagnostics.

The change does not add retries around signing, reuse authentication frames, weaken Hub
authorization, or change the meaning of a canonical relay error.

## Testing

Focused tests will prove:

- proof-preflight network rejection maps to bounded automatic retry;
- proof-preflight timeout maps to bounded automatic retry;
- Hub 5xx/draining response maps to bounded automatic retry;
- HTTP 429 maps to bounded rate-limit retry using local backoff only;
- explicit identity rejection remains terminal `authentication_failed`;
- malformed successful challenge response remains fail-closed as `protocol_invalid`;
- protected-state and signing failures remain operator-action failures;
- a transient failure followed by service recovery requests a fresh challenge and reaches `online`;
- repeated failures retain exactly one connection generation and one reconnect timer;
- no response body or sensitive canary appears in errors or status.

Affected public gates are the focused hub-identity and hub-connector suites followed by
`bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run typecheck:effect`,
`bun run test`, `bun run build`, browser tests, and release smoke as required by the repository.
Canonical relay schemas and fixtures must have no diff.

## Completion boundary

The public repair is complete when the focused regressions fail on the prior behavior, pass with
the typed classification, all required public gates pass, review finds no security or compatibility
regression, and the public pull request merges. Pinning the resulting immutable public commit into
a private deployment and performing live drain/reconnect qualification remain separate operations.
