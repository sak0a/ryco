# Outbound Hub Connector Implementation Plan

**Goal:** Add a production, outbound-only Hub connector to the Ryco server so an enrolled node can
authenticate with canonical relay protocol 1.2, host isolated logical Ryco RPC channels, and
reconnect without unbounded resources or duplicated application services.

**Architecture:** A scoped `HubConnector` layer owns one configured Hub generation, a deterministic
state machine, one injectable WebSocket transport, and an aggregate bounded relay queue. Each
accepted `ryco.rpc` channel receives an isolated adapter into a transport-neutral extraction of the
existing Effect RPC/WebSocket session boundary. Existing Hub identity clients own enrollment,
proofs, rotation, and protected key custody. The connector adds no listener and persists no relay
payload.

**Design spec:**
`docs/superpowers/specs/2026-07-16-outbound-hub-connector-design.md`

## Execution rules

- Work only on `feat/outbound-hub-connector` in the public repository.
- Do not modify relay schemas, relay fixtures, node-proof transcripts, or node-identity fixtures.
- Do not add a Hub dependency, Hub policy, deployment hostname, or non-public compatibility copy.
- Write tests before or with each behavior and run focused tests after every task.
- Never run `bun test`; use `bun run test` and optional file filters.
- Keep secrets, URLs, identifiers, frames, payloads, and arbitrary remote reasons out of logs and
  errors throughout implementation, not as a final cleanup.
- Use small conventional commits at the checkpoints below. Before every commit, run
  `git diff --check` and inspect the staged diff for private or sensitive material.

---

## Task 1: Add bounded connector configuration and status contracts

**Files:**

- Create: `packages/contracts/src/hubConnector.ts`
- Create: `packages/contracts/src/hubConnector.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/cli.ts`
- Modify: `apps/server/src/cli-config.test.ts`

- [ ] Define connector state, degraded mode, stable failure code, and bounded status schemas. Allow
      only the approved state/timestamp/retry/protocol/channel/queued-byte fields.
- [ ] Add compile-time and runtime tests that reject unknown states, negative counters, oversized
      values, identifiers, URLs, raw errors, and arbitrary strings.
- [ ] Add an internal `HubConnectorConfig` to `ServerConfigShape`: enabled, canonical origin,
      reconnect base/max/stable durations, jitter ratio, and explicit file-store fallback permission.
- [ ] Parse `RYCO_HUB_CONNECTOR_ENABLED`, `RYCO_HUB_ORIGIN`,
      `RYCO_HUB_RECONNECT_BASE_MS`, `RYCO_HUB_RECONNECT_MAX_MS`,
      `RYCO_HUB_RECONNECT_STABLE_MS`, `RYCO_HUB_RECONNECT_JITTER_RATIO`, and
      `RYCO_HUB_ALLOW_FILE_SECRET_STORE` with the approved ranges and disabled defaults.
- [ ] Canonicalize the origin through the existing public node-identity helper. Reject credentials,
      paths, queries, fragments, non-HTTPS production origins, and active-identity origin mismatch.
- [ ] Add `hubIdentityStatePath` beneath the existing server state directory without placing it in
      exported server settings.
- [ ] Ensure enabled-but-invalid configuration produces a bounded connector failure without
      selecting a default service or preventing the normal local listener from starting.
- [ ] Add config tests for defaults, every bound, invalid origins, no exported origin, and
      environment values that contain sensitive canaries.
- [ ] Run `bun run test packages/contracts/src/hubConnector.test.ts apps/server/src/cli-config.test.ts`.

**Checkpoint commit:** `feat(hub): add connector configuration and status contracts`

## Task 2: Assemble protected identity custody as a scoped runtime service

**Files:**

- Create: `apps/server/src/hubConnector/HubIdentityRuntime.ts`
- Create: `apps/server/src/hubConnector/HubIdentityRuntime.test.ts`
- Modify: `apps/server/src/hubIdentity/ProtectedSecretStore.ts`
- Modify: `apps/server/src/hubIdentity/ProtectedSecretStore.test.ts`
- Modify if required: `apps/server/package.json`

- [ ] Build one factory that selects Bun secrets, packaged keytar, or the explicitly enabled
      permissioned-file fallback in the existing order and fails closed on unavailable custody.
- [ ] Construct `LocalHubIdentityStateStore`, `NodeSigningIdentity`, enrollment HTTP transport and
      client, proof HTTP transport and client, and rotation transport/client from the same state path
      and protected store.
- [ ] Keep the promise-based public identity clients behind a small Effect service boundary with
      abortable operations and stable local error codes.
- [ ] Confirm the runtime exposes signing operations but no private-key export or raw protected-store
      read to connector consumers.
- [ ] Revalidate active and staged key references on startup. Never generate a replacement for an
      enrolled node or fall back to an old key after staged-key activation.
- [ ] Add restart tests for active identity, pending enrollment, staged rotation, missing keys,
      corrupt keys, locked backends, wrong-key selection, and explicit fallback selection.
- [ ] Add sensitive-canary tests for backend failures, state serialization, and Effect causes.
- [ ] Run `bun run test apps/server/src/hubIdentity apps/server/src/hubConnector/HubIdentityRuntime.test.ts`.

**Checkpoint commit:** `feat(hub): assemble protected connector identity runtime`

## Task 3: Implement enrollment orchestration and local control commands

**Files:**

- Create: `apps/server/src/hubConnector/HubEnrollmentService.ts`
- Create: `apps/server/src/hubConnector/HubEnrollmentService.test.ts`
- Create: `apps/server/src/hubConnector/HubControlRoutes.ts`
- Create: `apps/server/src/hubConnector/HubControlRoutes.test.ts`
- Create: `apps/server/src/cliHub.ts`
- Create: `apps/server/src/cliHub.test.ts`
- Modify: `apps/server/src/cli.ts`
- Modify: `apps/server/src/server.ts`

- [ ] Add a serialized enrollment service that starts or resumes the exact-origin device ceremony,
      owns one polling fiber, and maps pending, approved, unavailable, cancellation, and cleanup states
      into the connector status machine.
- [ ] Store the polling secret before polling. Remove it only after approval is durably committed or
      terminal cleanup completes. Preserve cleanup references when protected deletion fails.
- [ ] Resume pending polling after restart, honoring the existing server-provided interval and
      client backoff bounds with no duplicate poller.
- [ ] Expose bounded authenticated control operations on the existing HTTP listener for status,
      enrollment start/resume, and local cancellation. Require a direct Ryco owner session and
      `Authorization` header; never accept control credentials in query parameters.
- [ ] Reuse the runtime-state discovery and temporary CLI session pattern so commands target a live
      server when present. Fall back to the same locked identity runtime only when no server is live.
- [ ] Add `ryco hub enroll --origin <origin>`,
      `ryco hub enrollment cancel --origin <origin>`, and `ryco hub status`.
- [ ] Print the short device code and expiry only as intentional enrollment output. Never print the
      polling secret. Keep JSON output bounded to the same public status/enrollment-result schemas.
- [ ] Add tests for start, approval, interval polling, denial, expiry, unavailable collapse, restart,
      lost approval response, explicit cancellation, live/offline routing, concurrent commands, and
      cleanup failure recovery.
- [ ] Add argv, URL, log, error, status, and persisted-state canary assertions proving no polling
      bearer or private key escapes.
- [ ] Run `bun run test apps/server/src/hubConnector/HubEnrollmentService.test.ts apps/server/src/hubConnector/HubControlRoutes.test.ts apps/server/src/cliHub.test.ts`.

**Checkpoint commit:** `feat(hub): add enrollment control workflow`

## Task 4: Introduce transport-neutral RPC principals and an explicit role matrix

**Files:**

- Create: `apps/server/src/ws/RpcPrincipal.ts`
- Create: `apps/server/src/ws/RpcPrincipal.test.ts`
- Modify: `apps/server/src/auth/wsAuthorization.ts`
- Modify: `apps/server/src/auth/wsAuthorization.test.ts`
- Modify: `apps/server/src/ws/context.ts`
- Modify: `apps/server/src/ws/index.ts`
- Modify: `apps/server/src/ws/*Rpc.ts`
- Modify: `apps/server/src/ws/authRpcRegression.test.ts`

- [ ] Define a transport-neutral principal containing only direct/relay transport, viewer/operator/
      owner access, ephemeral scope reference, optional direct session ID, and direct-access-admin flag.
- [ ] Map existing direct `client` sessions to viewer and direct `owner` sessions to owner without
      changing current direct authentication or session connection tracking.
- [ ] Add viewer, operator, and owner authorization guards. A higher role satisfies lower access;
      access-administration methods additionally require a direct principal.
- [ ] Classify every `WsRpcGroup` method in one exhaustive policy table. Fail compilation or tests
      when the group gains an unclassified method.
- [ ] Keep read/snapshot/subscription methods at viewer unless they reveal credentials, diagnostics,
      local settings, or access metadata.
- [ ] Allow ordinary task, approval, terminal, project, worktree, file, source-control, and
      orchestration mutations to operator.
- [ ] Keep provider configuration, local settings, diagnostics, and local credential/access
      administration at owner; require direct transport for pairing/session credential operations and
      connector-control methods.
- [ ] Replace ambient `AuthenticatedSession` assumptions in RPC context construction with the new
      principal. Preserve `currentSessionId` only for direct sessions and keep relay sessions away from
      local session registries.
- [ ] Add an exhaustive matrix test for viewer/operator/owner/direct-only decisions plus regression
      tests proving current direct owner flows stay allowed and current direct clients do not gain
      mutation authority.
- [ ] Run `bun run test apps/server/src/auth/wsAuthorization.test.ts apps/server/src/ws/RpcPrincipal.test.ts apps/server/src/ws/authRpcRegression.test.ts`.

**Checkpoint commit:** `refactor(rpc): add transport-neutral role principals`

## Task 5: Extract the existing WebSocket RPC server into a byte session

**Files:**

- Create: `apps/server/src/ws/RpcByteSession.ts`
- Create: `apps/server/src/ws/RpcByteSession.test.ts`
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/server/src/ws/index.ts`
- Modify: `apps/server/src/server.test.ts`

- [ ] Wrap Effect RPC's protocol boundary in `RpcByteSession`, accepting a scoped ordered byte
      source, bounded byte sink, principal, and the existing shared handler dependencies.
- [ ] Move JSON RPC serialization and `WsRpcGroup` server execution behind that interface without
      changing application request/response bytes.
- [ ] Adapt the direct `/ws` upgrade to `RpcByteSession`; retain existing auth, origin, wsToken,
      `markConnected`/`markDisconnected`, push streams, cancellation, tracing, and error behavior.
- [ ] Ensure one session scope owns all Effect RPC fibers and subscriptions and can be interrupted
      independently without closing shared services.
- [ ] Add byte-harness tests for request/response, subscription, cancellation, malformed RPC input,
      sink failure, source close, and deterministic scope release.
- [ ] Compare direct-route request and response bytes before and after extraction.
- [ ] Run focused direct tests with
      `bun run test apps/server/src/ws/RpcByteSession.test.ts apps/server/src/server.test.ts`.
- [ ] Run the existing auth, orchestration, terminal, provider, project, and persistence RPC tests to
      catch boundary regressions before relay code uses the adapter.

**Checkpoint commit:** `refactor(rpc): extract scoped byte sessions`

## Task 6: Implement deterministic connector state and reconnect policy

**Files:**

- Create: `apps/server/src/hubConnector/HubConnectorState.ts`
- Create: `apps/server/src/hubConnector/HubConnectorState.test.ts`
- Create: `apps/server/src/hubConnector/ReconnectPolicy.ts`
- Create: `apps/server/src/hubConnector/ReconnectPolicy.test.ts`

- [ ] Implement the approved disabled, enrolling, awaiting approval, connecting, authenticating,
      online, degraded/backing-off, revoked, version-incompatible, and stopping transitions.
- [ ] Serialize transitions and require a monotonically increasing generation token on every async
      completion, timer, transport callback, channel callback, and enrollment callback.
- [ ] Define the stable failure mapping in one exhaustive function; never retain arbitrary thrown
      messages or causes in state.
- [ ] Calculate exponential windows without integer overflow, apply injected multiplicative jitter,
      enforce the 250 ms lower bound, normal configured cap, and 300-second absolute retry-after cap.
- [ ] Keep one optional retry timer and one optional stability timer. Reset attempts and protocol
      violation count only after the full stable-online interval.
- [ ] Retry DNS, network, TLS, abnormal loss, auth timeout, draining, rate limiting, bounded internal
      errors, and temporary HTTPS/send/heartbeat loss.
- [ ] Require operator action for fresh-proof authentication failure, missing custody, origin
      mismatch, rotation failure, connection replacement, explicit revocation, incompatible version,
      terminal enrollment failure, and the second canonical violation before stability.
- [ ] Test exact delay boundaries with fake clocks and fixed random values for 0, 0.5, and 1; cover
      overflow, retry-after, reset timing, cancellation, stale generations, and 10,000-attempt
      simulations with exactly one timer.
- [ ] Run `bun run test apps/server/src/hubConnector/HubConnectorState.test.ts apps/server/src/hubConnector/ReconnectPolicy.test.ts`.

**Checkpoint commit:** `feat(hub): add connector state and reconnect policy`

## Task 7: Add the credential-free WebSocket transport and authentication session

**Files:**

- Create: `apps/server/src/hubConnector/HubRelayTransport.ts`
- Create: `apps/server/src/hubConnector/HubRelayTransport.test.ts`
- Create: `apps/server/src/hubConnector/RelayConnectionSession.ts`
- Create: `apps/server/src/hubConnector/RelayConnectionSession.test.ts`

- [ ] Define a minimal injectable transport interface for open, binary message, close, error,
      `bufferedAmount`, send, and listener disposal. Provide the production implementation using the
      runtime WebSocket client.
- [ ] Derive only the fixed relay route from the canonical origin. Refuse query, fragment, Cookie,
      Authorization, Origin, credential subprotocol, redirects, or inherited ambient headers.
- [ ] Obtain a fresh proof frame before every socket open through `HubNodeProofClient`; never reuse a
      challenge, transcript, signature, auth frame, or socket after a failed attempt.
- [ ] Encode with the existing canonical relay codec. Send node `auth` synchronously as the first
      frame on open and release owned proof buffers after send.
- [ ] Enforce a five-second authentication/ready timer using the injected clock. Before `ready`,
      accept only canonical `ready` or fatal `error` and fail closed on text, malformed, oversized,
      trailing-byte, wrong-version, or out-of-order messages.
- [ ] Validate negotiated version and limits through existing public schemas. Confirm staged key
      activation only after successful `ready`.
- [ ] Map authentication failure, cold-start revocation collapse, version errors, replacement,
      draining, rate limiting, TLS/network loss, and malformed frames to the state classifier without
      logging input.
- [ ] Test first-frame ordering, headers, route construction, challenge freshness, proof replay,
      wrong key, copied node ID, key rotation confirmation/recovery, five-second boundaries, and
      listener disposal.
- [ ] Run `bun run test apps/server/src/hubConnector/HubRelayTransport.test.ts apps/server/src/hubConnector/RelayConnectionSession.test.ts apps/server/src/hubIdentity/HubNodeProofClient.test.ts apps/server/src/hubIdentity/HubKeyRotationClient.test.ts`.

**Checkpoint commit:** `feat(hub): authenticate outbound relay sessions`

## Task 8: Build aggregate bounded output scheduling and flow control

**Files:**

- Create: `apps/server/src/hubConnector/RelaySendQueue.ts`
- Create: `apps/server/src/hubConnector/RelaySendQueue.test.ts`
- Create: `apps/server/src/hubConnector/RelayFlowControl.ts`
- Create: `apps/server/src/hubConnector/RelayFlowControl.test.ts`

- [ ] Account encoded relay bytes, conservative WebSocket frame reserve, native
      `bufferedAmount`, queue-entry overhead, and a fixed control reserve under negotiated
      `maxQueuedBytes`.
- [ ] Keep control in a priority FIFO lane and data in per-channel FIFO lanes selected round-robin.
      Never allocate an emergency or unaccounted queue.
- [ ] Retain reservations while bytes move into native WebSocket buffering; release them only when
      native buffering drains or the connection closes.
- [ ] Start a drain poll only while native buffering is outstanding, use the injected scheduler,
      and cancel it when idle or closed.
- [ ] Implement outbound channel pause/resume without blocking control or unrelated channels.
      Bound RPC output while paused and close only that channel if its reservation cannot fit.
- [ ] Implement inbound 75% pause and 50% resume hysteresis, one in-flight grace data frame, and
      channel-only `slow_consumer` closure after another pre-resume frame.
- [ ] Reject payloads above negotiated `maxDataChunkBytes` before copying or parsing them.
- [ ] Add tests for exact accounting boundaries, native buffering, fairness, control priority,
      pause/resume, grace frame, ignored pause, slow consumer, maximum payload, zero-length payload,
      send failure, and close cleanup.
- [ ] Run `bun run test apps/server/src/hubConnector/RelaySendQueue.test.ts apps/server/src/hubConnector/RelayFlowControl.test.ts`.

**Checkpoint commit:** `feat(hub): add bounded relay flow control`

## Task 9: Bridge isolated logical channels into real Ryco RPC sessions

**Files:**

- Create: `apps/server/src/hubConnector/RelayChannelAdapter.ts`
- Create: `apps/server/src/hubConnector/RelayChannelAdapter.test.ts`
- Create: `apps/server/src/hubConnector/RelayChannelRegistry.ts`
- Create: `apps/server/src/hubConnector/RelayChannelRegistry.test.ts`

- [ ] Admit `channel.open` only while online and not stopping, for exact protocol 1.2,
      `ryco.rpc`, viewer/operator/owner, unique canonical ID, available negotiated channel slot, and
      reservable queue capacity.
- [ ] Construct and register the scoped `RpcByteSession`, sequence counters, queues, pause state,
      and exactly-once finalizer before sending `channel.accept`.
- [ ] Send one stable `channel.reject` for unsupported capability/role, duplicates, capacity,
      draining, construction failure, or authorization failure. Never reflect remote input.
- [ ] Forward incoming payload as opaque `Uint8Array` into the RPC byte source. Forward outgoing RPC
      bytes into canonical `data` frames without UTF-8 conversion, JSON inspection, payload logging,
      retry, or replay.
- [ ] Require sequence zero then exact increment in each direction. Handle gaps, duplicates, wrap,
      unknown channels, and data-before-accept according to the approved channel/connection boundary.
- [ ] Make local and remote close idempotent. Close only that session, queues, listeners, counters,
      reservations, and registry entry; never close the connector, direct clients, or another channel.
- [ ] Close all generation-owned channels before scheduling physical reconnect and never revive a
      channel across generations.
- [ ] Test viewer/operator/owner principals with real handlers, multiple concurrent channels,
      independent subscriptions/cancellation, accept/reject/close, duplicate IDs, reconnect churn,
      and local-client isolation.
- [ ] Test byte-exact ordered round trips using zero bytes, invalid UTF-8, JSON-like text, maximum
      bytes, mutable source buffers, and sensitive payload canaries.
- [ ] Run `bun run test apps/server/src/hubConnector/RelayChannelAdapter.test.ts apps/server/src/hubConnector/RelayChannelRegistry.test.ts apps/server/src/ws/RpcByteSession.test.ts`.

**Checkpoint commit:** `feat(hub): bridge relay channels to Ryco RPC`

## Task 10: Compose the connector runtime, heartbeat, and shutdown

**Files:**

- Create: `apps/server/src/hubConnector/HubConnector.ts`
- Create: `apps/server/src/hubConnector/HubConnector.test.ts`
- Create: `apps/server/src/hubConnector/HubConnectorLive.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/serverRuntimeStartup.ts`
- Modify: `apps/server/src/serverRuntimeStartup.test.ts`
- Modify: `apps/server/src/server.test.ts`

- [ ] Compose configuration, identity, enrollment, state, reconnect, connection session, send queue,
      and channel registry into one scoped service.
- [ ] Guarantee one proof/open/reconnect generation and at most one physical WebSocket for the one
      configured Hub. Disabled mode creates no poller, proof request, socket, timer, or channel.
- [ ] Start the connector only after shared RPC/application dependencies and identity stores are
      ready. Do not block the normal listener on network reachability or a backing-off connector.
- [ ] Respond to every canonical Hub `ping` with priority `pong` carrying the exact nonce. Track the
      last valid Hub heartbeat and enforce negotiated 20-second cadence/45-second offline behavior
      without a second periodic application ping.
- [ ] Handle connection frames exhaustively: ready, ping/pong, channel open/close, data, flow,
      error, and malformed/inappropriate frames. A stale generation cannot affect a replacement.
- [ ] Expose only the bounded status snapshot/stream and direct control operations. Keep status
      independent from logging and diagnostics sinks.
- [ ] On finalization: enter stopping, invalidate generation, cancel polling/proof/retry/stability/
      heartbeat/drain operations, reject new channels, close all channel scopes, clear queues and
      reservations, close the socket, detach listeners, and clear registries before shared services.
- [ ] Make repeated stop calls share one completion and use the server's bounded shutdown scope;
      no stop path may reconnect.
- [ ] Assert enabling the connector does not change host, port, HTTP routes except authenticated
      control routes, Tailscale behavior, or listener count.
- [ ] Run `bun run test apps/server/src/hubConnector/HubConnector.test.ts apps/server/src/serverRuntimeStartup.test.ts apps/server/src/server.test.ts`.

**Checkpoint commit:** `feat(hub): integrate scoped outbound connector`

## Task 11: Add full simulated-relay and adversarial lifecycle coverage

**Files:**

- Create: `apps/server/src/hubConnector/HubConnector.integration.test.ts`
- Create: `apps/server/src/hubConnector/HubConnector.security.test.ts`
- Create test helpers under: `apps/server/src/hubConnector/test/`
- Modify focused existing regression tests as needed

- [ ] Build a local canonical relay server using only public schemas/codecs. It must perform
      challenge/proof verification, ready negotiation, heartbeat, channel control, flow control, and
      connection close without importing or copying a service implementation.
- [ ] Run a real `WsRpcGroup` request/response, subscription, mutation, typed error, and cancellation
      through one simulated `ryco.rpc` channel.
- [ ] Cover enrollment start/poll/approval/denial/expiry/restart/cancel followed by authentication
      and online transition.
- [ ] Cover wrong key, copied node ID, challenge replay, rotation, cold-start authentication
      collapse, live revocation, connection replacement, draining, unsupported version, invalid
      limits, DNS/network/TLS failure, heartbeat timeout, and recovery classifications.
- [ ] Exercise multiple channels plus a real direct client while sockets reconnect repeatedly.
      Prove channel isolation, direct-client isolation, one physical socket, one retry timer, and fresh
      logical channels after reconnect.
- [ ] Exercise pause/resume, native slow consumer, maximum aggregate queue use, one grace frame,
      ignored pause, fairness, heartbeat boundaries, and shutdown during every connector state.
- [ ] Count open sockets, fibers/timers, listeners, queues, registry entries, reservations, RPC
      scopes, and retained channel references before and after restart/shutdown/churn; all return to
      zero.
- [ ] Run repeated channel/connection churn with `WeakRef`/finalizer-safe test hooks or explicit
      ownership counters to prove payload and channel references are released deterministically.
- [ ] Seed unique canaries for keys, polling secrets, challenges, nonces, signatures, URLs,
      authorization values, relay payloads, provider values, source, conversations, terminal output,
      files, and attachments. Scan logs, serialized errors/causes, diagnostics, status, configuration
      export, identity JSON, protected-store doubles, trace output, and SQLite.
- [ ] Verify the canonical relay fixtures directory and node-identity fixtures are byte-for-byte
      unchanged.
- [ ] Run `bun run test apps/server/src/hubConnector/HubConnector.integration.test.ts apps/server/src/hubConnector/HubConnector.security.test.ts`.

**Checkpoint commit:** `test(hub): cover relay lifecycle and leakage boundaries`

## Task 12: Document operation and public boundaries

**Files:**

- Create: `docs/hub-connector.md`
- Modify: `README.md`
- Modify: `PLAN.md`
- Modify: `docs/node-identity.md`
- Modify if clarification is needed: `docs/relay-protocol.md`

- [ ] Document disabled defaults, exact environment configuration, outbound-only networking, and
      proof that no additional listener opens.
- [ ] Document enrollment commands, approval polling, cancellation/restart, protected custody
      order, explicit POSIX fallback, rotation recovery, and intentional one-time device-code output.
- [ ] Document challenge preflight, first auth frame, five-second deadline, no Cookie/Authorization/
      Origin/query material, version/limit negotiation, and cold-start revocation indistinguishability.
- [ ] Document every connector state, local status field, retry/operator classification, backoff
      formula, retry-after cap, stability reset, replacement behavior, and troubleshooting action.
- [ ] Document channel capability/role admission, shared RPC boundary, opaque ordering, independent
      close, aggregate limits, pause/resume, slow-consumer behavior, heartbeat, and shutdown.
- [ ] State that Ryco remains authoritative for all application data and that connector payloads are
      neither persisted nor logged. Document known limitations from the design.
- [ ] Link the guide from README and update PLAN status without mentioning non-public issues,
      services, policy, infrastructure, or review history.
- [ ] Change relay-protocol prose only if needed for an already-existing public fact. Do not change
      schema constants, fixture generators, or fixtures.
- [ ] Run `bun run fmt:check` after documentation formatting.

**Checkpoint commit:** `docs(hub): document outbound connector operations`

## Task 13: Run complete regression and security gates

- [ ] Confirm the Bun version matches `package.json`.
- [ ] Run `bun install --frozen-lockfile`.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect` because connector and RPC Effect code changed.
- [ ] Run `bun run test`; never substitute `bun test`.
- [ ] Run `bun run build`.
- [ ] Run `bun audit` and record any proven pre-existing advisory separately from regressions.
- [ ] If a gate changes files, inspect the changes, rerun affected focused tests, and repeat the full
      relevant gate until clean.
- [ ] Confirm direct LAN, desktop-local, SSH-assisted, provider, orchestration, terminal,
      persistence, build, and identity behavior remains green through the full suite.

## Task 14: Final boundary review and publication

- [ ] Compare the complete branch against public `main` and remove unrelated changes.
- [ ] Search the diff and commit messages for secrets, payload canaries, private links,
      infrastructure names, arbitrary remote text, Hub-only policy, and generated contract/fixture
      drift.
- [ ] Confirm no relay schema, node-proof transcript, compatibility fixture, migration, or public
      protocol version changed.
- [ ] Confirm all queues/timers/listeners/sockets/scopes/reference counters are zero in the final
      shutdown tests and that the local listener count is unchanged.
- [ ] Confirm the private parent repository's recorded public dependency pin was not changed as part
      of this public implementation.
- [ ] Squash only fixup commits if needed without rewriting shared/published history. Keep clear
      conventional commits for configuration, identity/enrollment, RPC extraction, connector runtime,
      tests, and docs.
- [ ] Push `feat/outbound-hub-connector` and open a public PR that contains architecture, state
      machine, key custody, channel bridge, reconnect policy, limits, tests, and known limitations, with
      no reference to non-public work.
- [ ] Wait for all CI checks and review. Resolve actionable comments, rerun affected focused and full
      gates, and report external-provider checks without guessing their logs.
- [ ] Do not declare the connector complete until the public PR is merged and every acceptance test
      and gate above is green.
