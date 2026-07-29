# Hosted project and relay hardening design

**Status:** Approved design

**Date:** 2026-07-27

## Summary

Hosted project creation, repository cloning, and filesystem browsing currently fail in two
independent ways.

First, the web filesystem-browse controller treats a temporarily unavailable environment API as a
successful empty result. It caches that result, does not retry when the hosted environment
connection returns, and renders an empty directory list. The add-project action has a related
silent return when the API is unavailable. Repository lookup can succeed immediately before this
race, while the destination picker still shows no directories.

Second, relay message chunking merged in public PR #251 fixes responses above the 256 KiB data-frame
limit only when both endpoints run the new implementation. Both old and new endpoints still
advertise relay protocol 1.2, so a new sender can emit a NUL-prefixed chunk to an old JSON receiver.
The browser receiver also excludes partially reassembled bytes from negotiated queue accounting,
and the assembler allocates the complete declared message before receiving its contents.

The repair will make filesystem browsing connection-aware, remove silent project-action failures,
negotiate chunk support inside legacy-compatible JSON payloads, and make reassembly memory and flow
control match negotiated limits. The Hub will remain an opaque relay and will not change.

## Evidence and failure boundary

A focused controller reproduction established the client race:

1. request a filesystem browse while `readEnvironmentApi()` returns no API;
2. observe a completed state with `data: null`, no error, and `isPending: false`;
3. make the API available; and
4. request the same fresh cache key again.

The API receives zero calls because the missing-API result was recorded as fresh data.

The two unresolved PR #251 review findings are also reproducible:

- a 262,156-byte JSON message becomes two NUL-prefixed chunks, and an old JSON receiver throws on
  the first chunk; and
- a browser with a negotiated 2,048-byte inbound queue accepts and delivers a 3,000-byte chunked
  message when frames drain to the assembler one microtask at a time. It emits no flow pause.

A nine-byte first chunk can additionally declare a 4 MiB message. The current assembler allocates
the 4 MiB destination buffer while reporting one held byte. `HostedRelayEngine` does not reset that
partial assembler when the channel closes.

## Scope

This design changes only the public `ryco` repository:

- the web add-project filesystem browser;
- project creation and clone-to-add action handling;
- shared relay message framing helpers;
- hosted browser relay receive/send accounting;
- node-side relay session framing and accounting; and
- focused unit, browser, and client-to-node integration coverage.

The following are explicitly out of scope:

- relay intermediary, deployment, or vendored-bundle changes;
- relay ticket, authentication, authorization, grant, role, or snapshot-readiness policy;
- authenticated API caching or service-worker behavior;
- source-control provider setup and credential UX; and
- changing the server's existing best-effort handling of protected filesystem locations.

## Considered approaches

### Legacy-compatible capability advertisement plus connection-aware browsing (selected)

New endpoints advertise chunk support by prefixing ordinary unchunked JSON RPC payloads with a
fixed sequence made exclusively from JSON whitespace bytes. A legacy JSON decoder accepts the
payload unchanged. A new receiver recognizes and strips the prefix before decoding, records that
the peer supports chunk reassembly, and permits outbound chunking only after observing the peer's
advertisement.

The browse hook will subscribe to environment-connection changes. Missing API state will remain
retryable rather than becoming cached empty data, and the picker will show an explicit unavailable
or browse-error row until a successful retry.

This preserves protocol 1.2 and Hub opacity, supports independently upgraded client and node
bundles, and repairs the observed project workflow without broad lifecycle changes.

### Relay protocol minor bump

A protocol 1.3 frame or capability field could negotiate chunk support explicitly. Relay
intermediaries validate protocol versions and frame schemas, so this requires a coordinated
control-plane rollout. This approach is rejected for the current scope.

### Receiver-first feature flag rollout

Chunk receivers could ship with senders disabled, followed by a later global sender enablement once
all endpoints are upgraded. This can work for a tightly controlled deployment but does not protect
saved clients, stale browser assets, or independently updated nodes. It recreates the same
compatibility risk on every future rollout and is rejected.

## Component design

### Environment-aware filesystem browsing

`useFilesystemBrowse` will observe the environment supervisor through its existing connection
subscription. The connection object or an equivalent stable revision becomes a fetch dependency.
When a connection appears or is replaced, an active browse scope attempts another fetch.

`runBrowseController` will classify a missing API as unavailable:

- it will clear the in-flight flag;
- it will not set `hasData`, `lastFetchedAt`, or `lastResult`;
- it will retain prior successful data only when such data exists; and
- it will publish a bounded error indicating that the environment is unavailable.

Because the controller remains without fresh data, the next environment-connection notification
triggers a normal deduplicated fetch. Existing stale-time behavior still applies after successful
responses. Scope cleanup and fetch tokens continue to prevent superseded responses from
publishing.

The command palette will render a non-actionable filesystem status row when browse state has an
error. It will distinguish an unavailable environment from a server browse error using bounded
client messages. The manual path field remains usable, but submitting while the environment API is
unavailable produces a visible error instead of doing nothing.

### Project creation and repository cloning

The add-project path will no longer silently return when the target environment API is absent.
It will publish the existing error toast with a stable environment-unavailable description.

The internal add operation will accept an explicit target environment and API. A clone operation
will pass the same API instance that successfully performed the clone into the subsequent
project-create step instead of immediately looking it up again. This avoids a second readiness race
between successful clone completion and project registration while keeping transport failures
observable through the existing command error path.

Existing-path detection, path normalization, relative-path policy, workspace-root creation, default
model selection, project dispatch, and new-thread behavior remain unchanged.

### Legacy-compatible relay capability advertisement

The shared relay message module will define one fixed capability prelude:

```text
20 09 0d 0a 20 09 0d 0a
```

These are only JSON whitespace bytes: space, tab, carriage return, and line feed, repeated once.
The Effect JSON RPC decoder accepts leading JSON whitespace, while its canonical encoder does not
produce this prelude naturally.

For every unchunked message with sufficient frame headroom, a new sender prefixes the prelude. A
new receiver strips it before RPC decoding and records `peerSupportsChunking = true`. A legacy
receiver passes the prefixed bytes directly to its JSON decoder and decodes the same message.
Messages that fit the frame but lack prelude headroom remain raw and unadvertised rather than being
chunked solely because of the advertisement.

Outbound chunking is permitted only after the endpoint has observed the peer's prelude on the
current channel:

- a new client advertises on its first ordinary small request;
- a new server detects that advertisement before dispatching the request, so it may safely chunk
  the corresponding large response;
- a new client detects the prelude on a small server response before sending a later large
  request;
- an old sender remains readable by a new receiver; and
- a new sender talking to an old receiver sends compatible small messages but closes an oversized
  message with `transfer_limit` instead of emitting undecodable chunk bytes.

Capability state is channel-local and resets on every channel replacement. Chunk receivers remain
able to decode valid chunk frames regardless of whether they previously observed an advertisement;
the advertisement gates senders, not receiver safety. Receiving a valid chunk is itself sufficient
evidence that the sender supports chunking, so a receiver records peer support at that point as
well.

The prelude and chunk-header parsing, advertisement insertion/removal, peer-capability tracking, and
outbound preparation will live in the shared relay message module so browser and server behavior
cannot drift.

### Reassembly memory ownership

`RelayMessageAssembler` will retain received chunk bodies rather than allocating the complete
declared destination on the first chunk. It will:

- validate the declared total before retaining data;
- reject unsupported flag bits and nonzero reserved bytes;
- retain owned chunk bytes in arrival order;
- report the exact retained body-byte count through `heldBytes`;
- allocate and concatenate the final message only after the final chunk proves the received length
  equals the declared total; and
- zero every retained partial chunk on reset or failure.

The number of retained chunks remains bounded by the 4 MiB message ceiling and the minimum relay
chunk size. Completed messages retain their existing ownership contract with the RPC decoder.

`HostedRelayEngine.#finish` and node session finalization will reset the assembler so a partial
message cannot survive channel closure.

### Negotiated message and queue limits

Each endpoint will derive an effective logical-message ceiling:

```text
min(4 MiB, maxQueuedBytes - maxControlFrameBytes)
```

An outbound message above that ceiling fails with `transfer_limit` before any chunk is queued.

Browser inbound checks, high-water pause decisions, low-water resume decisions, and buffered amount
reporting will include both queued frame bytes and `assembler.heldBytes`. The incoming frame is
checked against the remaining aggregate budget before ownership transfers to the assembler.

The node byte session already exposes queued frame bytes plus assembler-held bytes. Its lazy
assembler will make that accounting reflect actual retained allocation. The relay channel registry
will continue to aggregate session byte counts across channels before accepting another frame.

This design does not increase negotiated limits. Flow-control frames, sequence handling, control
lane reservation, and close reasons remain unchanged.

## Data flow

### Filesystem browse

```text
open add-project picker
  -> resolve target environment
  -> read current environment connection
  -> API unavailable
       -> publish bounded unavailable state
       -> do not cache an empty success
       -> wait for environment-supervisor change
  -> API available
       -> issue filesystem.browse
       -> publish directory entries or bounded browse error
       -> cache only a successful result
```

### Relay negotiation and large response

```text
new client sends small JSON request with whitespace prelude
  -> Hub forwards opaque data payload
  -> new node detects and strips prelude
  -> node records client chunk support
  -> RPC handler produces response above one frame
  -> node verifies negotiated logical-message budget
  -> node splits response into ordered chunk payloads
  -> Hub forwards opaque data frames
  -> client reassembles within aggregate queue budget
  -> client decodes one complete JSON RPC response
```

With an old node, the same small request decodes normally because the prelude is legal JSON
whitespace. The new client has not observed server support, so a later oversized client request
fails cleanly rather than sending chunks.

## Error handling

- Missing environment APIs produce a stable unavailable state and remain automatically retryable.
- Filesystem RPC failures retain prior successful entries when available and render a bounded error
  row.
- Project creation and clone completion never silently disappear because of an absent API.
- Unknown chunk versions, flags, reserved bytes, totals, overflow, truncation, or interleaving fail
  the channel with the existing protocol/transfer classification.
- Oversized logical messages and chunk attempts without negotiated peer support fail with
  `transfer_limit`.
- Queue exhaustion remains `slow_consumer`.
- Channel close zeroes queued, partial, ticket-bearing, and authentication buffers already owned by
  the endpoint.

No diagnostic will include filesystem results, RPC payloads, relay tickets, credentials, private
node identifiers, or provider exception bodies.

## Compatibility and security

The Hub continues to validate and forward protocol 1.2 frames without parsing `data.payload`. No
relay frame schema, fixture, ticket, proof, channel capability, or version changes.

The compatibility matrix is:

| Sender | Receiver | Small message              | Oversized message                     |
| ------ | -------- | -------------------------- | ------------------------------------- |
| old    | old      | unchanged                  | existing `transfer_limit` behavior    |
| old    | new      | unchanged                  | old sender does not chunk             |
| new    | old      | whitespace-compatible JSON | clean `transfer_limit`, never chunked |
| new    | new      | whitespace-compatible JSON | negotiated chunking                   |

Capability evidence comes only from a payload form that an old endpoint can safely decode. It does
not grant authorization, raise limits, or bypass role checks. All peer-provided totals and bodies
remain bounded by receiver-owned negotiated limits.

## Testing

Focused web state tests will prove:

- a missing environment API is not cached as a successful empty browse;
- connection registration or replacement automatically retries an active browse;
- stale fetch results cannot overwrite the recovered result;
- a browse error retains prior successful data and is visible in the picker;
- project add reports unavailable state instead of silently returning; and
- clone-to-add reuses the successful target API and registers the cloned directory.

Shared relay tests will prove:

- the capability prelude is valid leading whitespace for the legacy JSON decoder;
- new receivers detect and strip the exact prelude;
- old/new compatibility follows the matrix above;
- senders do not chunk before peer support is observed;
- unsupported chunk flag bits are rejected;
- a tiny first chunk does not allocate the declared total;
- reset zeroes and releases every partial body; and
- UTF-8 sequences split across chunks still decode only after complete reassembly.

Browser relay tests will prove:

- assembler-held bytes count toward max, high-water, and low-water decisions;
- the prior 3,000-byte-through-2,048-byte-queue reproduction fails safely;
- partial assembly is reset on close;
- oversized sends before capability negotiation close with `transfer_limit`; and
- negotiated peers exchange a multi-frame message successfully.

Node integration tests will exercise a real `RpcByteSession`, relay channel registry, and browser
relay engine with a response above 256 KiB. They will also cover a new endpoint paired with a
legacy-compatible peer mode so the regression cannot return unnoticed.

After focused tests, the complete required validation is:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

## Completion boundary

The public repair is complete when the reported symptoms have deterministic regressions, mixed
relay versions fail compatibly, negotiated large RPC responses pass end to end, all required public
gates pass, and review finds no payload, authorization, lifecycle, or queue regression.

Deployment and relay-intermediary changes remain outside this completion boundary.
