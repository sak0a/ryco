# Outbound Hub connector

Ryco can maintain one authenticated outbound WebSocket to a configured Hub. This lets a server
behind NAT or CGNAT receive authorized logical `ryco.rpc` channels without opening another inbound
listener. Direct LAN, desktop-local, SSH-assisted, and Tailscale access continue to use the existing
server listener and are independent of the connector.

The connector consumes relay protocol 1.2. It does not provide a generic tunnel and does not move
projects, files, terminals, conversations, provider sessions, orchestration state, attachments, or
payload persistence into Hub. The Ryco node remains authoritative for all application state.

## Configuration

The connector is disabled by default. Configure it through the server process environment:

| Variable                           | Default | Valid range or meaning                                |
| ---------------------------------- | ------- | ----------------------------------------------------- |
| `RYCO_HUB_CONNECTOR_ENABLED`       | `false` | Exact `true` or `false`                               |
| `RYCO_HUB_ORIGIN`                  | unset   | Exact HTTPS origin; loopback HTTP is development-only |
| `RYCO_HUB_NODE_NAME`               | unset   | Proposed enrollment label; trimmed, 1–100 characters  |
| `RYCO_HUB_RECONNECT_BASE_MS`       | `1000`  | 250–60,000 ms                                         |
| `RYCO_HUB_RECONNECT_MAX_MS`        | `60000` | 250–300,000 ms and not below the base                 |
| `RYCO_HUB_RECONNECT_STABLE_MS`     | `60000` | 5,000–600,000 ms                                      |
| `RYCO_HUB_RECONNECT_JITTER_RATIO`  | `0.2`   | 0–0.5                                                 |
| `RYCO_HUB_ALLOW_FILE_SECRET_STORE` | `false` | Explicit POSIX permissioned-file fallback             |

The four ordinary startup settings also have shared server CLI flags:

| CLI flag                        | Environment fallback               |
| ------------------------------- | ---------------------------------- |
| `--hub-connector-enabled`       | `RYCO_HUB_CONNECTOR_ENABLED`       |
| `--hub-origin <origin>`         | `RYCO_HUB_ORIGIN`                  |
| `--hub-node-name <name>`        | `RYCO_HUB_NODE_NAME`               |
| `--hub-allow-file-secret-store` | `RYCO_HUB_ALLOW_FILE_SECRET_STORE` |

Startup values resolve in this order: an explicit CLI flag, its corresponding environment variable,
the private desktop bootstrap envelope, then the default. A headless `ryco serve` process has no
desktop bootstrap envelope, so an omitted flag continues to fall back to the environment unchanged.
The boolean flags use standard presence syntax and support the canonical
`--no-hub-connector-enabled` and `--no-hub-allow-file-secret-store` forms for explicit `false`
overrides.

## Relay end-to-end encryption admission policy

Two further options govern which relay channels the node admits. They follow the same
flag → environment → bootstrap-envelope precedence, and are defined normatively in
`docs/relay-e2ee-protocol.md` §12.3, §12.4 and §12.6.

| CLI flag                             | Environment fallback                    | Default |
| ------------------------------------ | --------------------------------------- | ------- |
| `--hub-require-e2ee`                 | `RYCO_HUB_REQUIRE_E2EE`                 | `false` |
| `--hub-require-approved-client-e2ee` | `RYCO_HUB_REQUIRE_APPROVED_CLIENT_E2EE` | `false` |

Unlike the connector settings above, these two are **durable node state, not per-process
configuration**. A value given on a start is committed to the node's policy record; a value left
unset on a later start leaves the committed value exactly as it was. That is deliberate: an
operator who enables a policy in one shell must not have it silently withdrawn by the next start
from a launcher or a service manager. Only an explicit `false` widens the policy back.

`--hub-require-e2ee` accepts only end-to-end encrypted channels. It closes the plaintext
downgrade path; it still admits unsigned web sessions.

**`--hub-require-approved-client-e2ee` disables web and legacy access entirely.** Only approved
native clients reach application payload, and if every approved native client key is lost, remote
access to this node is stranded until it is recovered locally. Local node recovery never relaxes
the admission policy. This option implies `--hub-require-e2ee` even when that flag is false.

Enabling either option — or removing a suite from the advertised registry — is a **policy
withdrawal**: before the change is acknowledged the node durably commits it, increments its policy
generation, and closes every live channel the narrowed policy no longer admits, reporting how many
it closed in each class and how many in-flight handshakes it aborted. Widening a policy takes
effect on channels admitted afterwards and never closes an open one.

### Capability advertisement

An E2EE-capable node tells clients so by advertising, never by being probed. On every relay channel
it accepts, the node emits one signed capability statement — its identity, agreement prekey
certificate, identity-continuity chain, suite registry, admission policy, policy generation, and a
bounded validity interval — as the **first** node-to-client payload, at relay data sequence 0,
through the same ordered send path as every other message. The carrier is a single reserved-tag
JSON object that existing clients demonstrably ignore, so a client that predates this protocol is
unaffected by it. Normative definition: `docs/relay-e2ee-protocol.md` §5.2–§5.5.

The statement is built and signed ahead of the channel, and it is rebuilt whenever anything it
carries changes — a policy change, a prekey rotation, an identity rotation, or the end of its
validity window. There is no way to advertise a stale one.

A node can fail to have an advertisement for a channel in exactly two ways, and neither is silent:

- **Undersized connection** — the relay asserted a `maxDataChunkBytes` too small to carry any
  conforming carrier. This is decided once per connection, from a value the relay operator chooses
  and neither endpoint can veto.
- **No conforming statement** — the node's own self-check failed: an over-long canonical Hub origin,
  a continuity chain past its bound, a refused signing call, or a continuity id the startup
  cross-check could not resolve.

Under an effective `--hub-require-e2ee` either condition is fatal: the affected channels are closed
with the ordinary `channel_rejected` reason, indistinguishable on the wire from every other
pre-key rejection, and the node logs an operator diagnostic naming the condition — and, for an
undersized connection, both the asserted limit and the minimum this protocol needs. Otherwise the
node suppresses the advertisement, serves the channel as an ordinary legacy channel, and records
one occurrence in the **advertisement-unavailable** class of its fallback counters. That class is
counted and displayed separately from genuine legacy peers on purpose: "this node could not
advertise" is a fact about the node, and letting a relay-asserted chunk limit inflate the
legacy-peer count would let the relay operator hold the rollout open indefinitely.

The node keeps three further state files beside its identity state for this: the durable admission
policy record, the bounded fallback counters, and the approved-client records the encrypted
handshake checks. None of them holds channel, session, key, or payload data, and the client
records hold key fingerprints rather than keys. The policy record is the operator's own and
survives leaving a Hub; the client records are Hub-scoped and are erased with the enrollment.

### What a channel does after the advertisement

Every accepted channel runs one receiver mode machine, created at `channel.accept` and destroyed
when the channel closes. It starts in `negotiating` and reaches exactly one of two settled modes,
one way only: `e2ee` through a complete authenticated handshake, or `legacy` when fallback policy
accepts the peer's first plaintext message. There is no mid-channel upgrade and no downgrade.
Normative definition: `docs/relay-e2ee-protocol.md` §4.3–§4.4, §8–§11.

Every inbound payload is classified **after** relay chunk reassembly and prelude stripping, never
on raw wire bytes, and what the class is allowed to be depends on the mode. The consequence worth
stating plainly is that on an `e2ee` channel the only route to the RPC parser is a successfully
authenticated encrypted record: a plaintext message arriving after encryption is established ends
the channel rather than being served. An unknown first byte — and an empty payload, which has none
— is fatal in every mode and is never treated as a harmless no-op.

Outbound, an RPC response on an `e2ee` channel is encrypted before it reaches the relay's chunking
layer, and **transmission admission for the whole record is obtained before the record's nonce is
assigned**. That ordering is not an optimization: a sender that encrypted first and rolled its
counter back when the send queue refused would reuse a nonce with different plaintext. A refused
send therefore consumes nothing, emits nothing, and leaves the channel usable — ordinary
backpressure, exactly as on a legacy channel.

Failures are deliberately uniform on the wire. Before session keys exist, every fatal condition
produces the same fixed-size rejection record and the same `channel_rejected` close reason,
whatever the cause was — an unknown client key, a signature failure, a policy refusal, or an owner
revocation landing mid-handshake are indistinguishable to whoever is on the other end. After keys
exist, it is one length-uniform encrypted error record and the same close reason. The node logs
which rule fired; the wire does not carry it. An orderly close is different from both: the two
ends exchange authenticated close records first, and only then does the channel close with no
reason at all.

The desktop app deliberately owns these four values for its bundled server. It persists them in
desktop settings, removes matching `RYCO_HUB_*` variables from the backend child environment, and
passes the values over the private bootstrap channel. This keeps the visible desktop controls
authoritative. The Hub card keeps the address and pre-enrollment node name visible and puts key
fallback, startup ownership, CLI equivalents, and bounded relay counters behind **Show advanced
options**. Changing a desktop launch value restarts Ryco.

For example:

```bash
ryco serve \
  --hub-connector-enabled \
  --hub-origin https://hub.example.test \
  --hub-node-name "Build node" \
  --hub-allow-file-secret-store \
  --restrict-to-cwd \
  --host 127.0.0.1 \
  --port 3774 \
  --base-dir /path/to/node-state \
  /allowed/workspace
```

`--restrict-to-cwd` limits Ryco-managed browsing, project roots, clone destinations, terminal
starting directories, and generated worktrees to the final positional working directory. The
directory is resolved canonically at startup, and Ryco rejects direct traversal and symlink escapes.
The flag is optional and has no environment-variable fallback. If the existing node state contains
an active project or live worktree outside that root, restricted startup fails without changing the
persisted data; archive or remove the incompatible state in unrestricted mode, or select a fresh
`--base-dir`.

`--base-dir` remains the trusted location for node identity, database, logs, and other internal
state. It is not the accessible workspace root. This application-level restriction does not confine
commands after a terminal or coding-agent process starts: use a container or operating-system
sandbox when processes must be unable to read paths outside `/allowed/workspace`.

An invalid enabled configuration fails closed with `configuration_invalid`. There is no implicit
production origin. Credentials, keys, challenges, signatures, and polling secrets are never
accepted through command-line arguments, URLs, or exported server settings.

Enabling the connector starts no listener. It uses the existing Ryco HTTP server only for
authenticated local status and enrollment controls.

Connector state and identity state are reported separately, and the distinction matters: `disabled`
is reported both for a node that was never enrolled and for an enrolled node whose connector is
switched off. A caller that must not offer to re-point an already-enrolled node reads the bounded
identity summary — `none`, `pending`, `active`, or `unknown` — rather than inferring it from state.
`unknown` means key custody could not be read at all, and must be treated like `active`: refusing a
destructive action is the safe answer when an identity may exist.

### Operator commands

The encrypted relay layer's owner-facing state is reached through `ryco e2ee`, a sibling of
`ryco hub` rather than a subtree of it: `hub`'s subcommands are connector-lifecycle verbs, while
these are about node-owned security state that outlives any one connector. Every one of them
requires the running server, for the same reason the acknowledgements mean anything at all.

```bash
ryco e2ee client list                      # records, saturation, refusal count, pairing window
ryco e2ee client show <fingerprint>        # one record and its long-term safety number
ryco e2ee client approve <fingerprint> --max-role <role> --capability <capability>
ryco e2ee client narrow <fingerprint> [--max-role <role>] [--capability <capability>]
ryco e2ee client revoke <fingerprint>
ryco e2ee client purge <fingerprint>
ryco e2ee client clear-refusals            # zero the pending-cap refusal count
ryco e2ee client window open <fingerprint> # the discriminator is required
ryco e2ee client window close
ryco e2ee sessions                         # the advisory per-session code, for the web tier
ryco e2ee policy show
ryco e2ee policy set [--require-e2ee] [--require-approved-client-e2ee] [--suite <id>]
ryco e2ee policy recover                   # advance a rolled-back policy generation
ryco e2ee prekey show
ryco e2ee prekey rotate
ryco e2ee continuity show
ryco e2ee continuity recover --adopt <continuity-id> | --break
ryco e2ee continuity break
ryco e2ee fallback show
ryco e2ee fallback reset
```

`client list`, `show`, `approve`, `narrow`, `revoke`, and `purge` take the record key in full —
`--hub-origin`, `--account-id`, and the `SHA256:` fingerprint — because a key is all three fields
and a fingerprint alone names records in scopes the owner did not touch.

Three of these carry guarantees rather than conveniences, and it is worth stating what they are.
**`client narrow` and `client revoke` do not return until every channel admitted under the withdrawn
authority is closed**, and they report how many they closed and how many in-flight handshakes they
aborted; an acknowledgement therefore means what an owner reads it to mean. **`policy set` warns
before it acts** — including the operator-lockout warning for `--require-approved-client-e2ee`,
which disables web and legacy access entirely and can strand remote access if every approved native
client key is lost — then runs the same ordered procedure and reports the closures broken out by
class. **`continuity recover` offers exactly two outcomes and defaults to neither**: re-adopting a
confirmed lineage id keeps every existing client verification, while breaking continuity mints a
fresh one and requires every paired client to verify this node again.

Two more are recovery paths rather than routine operations. **`policy recover`** is §5.7's command
for a node whose advertised policy generation is below its durable high-water mark — a restore
rolled the record back: it advances the generation past every value the node may have advertised,
warns that the jump is deliberate and that clients accept only a strictly higher value, and commits
the fail-closed policy rather than re-adopting restored values, so widening back is a separate
explicit `policy set`. **`prekey show`** reads the certificate the node holds without re-signing it,
which is the only surface on which an expired prekey — and §6.4's remedy for it — is visible at all.

`--json` emits one compact document on a single line, and that document is the whole of stdout:
logging is suppressed for the entire command, and answers that read as prose to a human ("no
enrollment is pending") are documents to a machine. Mandated warnings are not dropped under the
flag — they go to stderr and travel inside the document — because a flag that silenced a warning
would be the quiet way to skip one. Nothing on any of these surfaces carries a raw key, and the
fallback report carries no account, channel, session, or key identifier at all, because none is
stored. Normative definitions: `docs/relay-e2ee-protocol.md` §5.7, §6.4, §7.5, §12.3–§12.6,
§13.4–§13.6.

## Enrollment and key custody

Start Ryco with the connector enabled, then run these commands against the same Ryco state
directory:

```bash
ryco hub status
ryco hub enroll
ryco hub pending
ryco hub cancel
ryco hub resume
ryco hub leave
```

Add `--json` for bounded machine-readable output. The server must be running. The CLI obtains a
short-lived owner credential from the local auth control plane, uses it only in an Authorization
header to the existing local server, and revokes it after the operation. That credential is never a
Hub credential and never enters a Hub WebSocket.

`hub status` prints the active node's canonical `SHA256:<base64url>` identity fingerprint in both
human and JSON output whenever an active identity exists. This is the stable local recovery source
after enrollment has finished; it exposes no raw public key, private-key material, key-store name,
local path, Hub origin, or node identifier.

`hub enroll` prints the node label, platform, client version, key algorithm, the canonical
`SHA256:<base64url>` public-key fingerprint, expiry, and a short device code — the same fields the
Hub approval screen shows, so both can be compared item by item. `--json` returns the same bounded
fields. Compare every field, and the fingerprint exactly, with the Hub approval screen before
approving. Deny and investigate any mismatch; never approve by device code alone.

When no node name is configured, Ryco proposes `<machine label> · <node code>`. The four-character
Crockford Base32 node code is derived deterministically from the persistent EnvironmentId, so two
Ryco state directories on the same machine receive distinguishable, stable proposals. The complete
label is truncated without splitting a Unicode character and never exceeds 100 JavaScript UTF-16
code units. An explicit `--hub-node-name`, `RYCO_HUB_NODE_NAME`, or Desktop value replaces that
automatic proposal after trimming.

The exact proposal is persisted with a pending ceremony before the enrollment request is sent.
Restarting or changing launch configuration cannot silently change the label an owner is comparing
on the Hub. Once approved, the Hub's stored label is authoritative: a Hub owner can rename it from
the desktop/tablet node-detail surface, while node, viewer, and operator sessions cannot rename it.
The frozen web phone presentation displays refreshed names but does not expose node management.

`hub pending` reprints those fields for a ceremony that is already under way. The device code is
persisted as bounded non-bearer routing metadata so a comparison survives a lost terminal or a
restart; the polling secret is not, and stays in the protected store. A ceremony started before this
was persisted cannot be reprinted and reports as absent. Approval polling continues inside the running server and resumes from
protected local state after restart. `hub cancel` stops a pending ceremony and deletes its local key
and polling-secret custody. Denial or expiry requires starting a new ceremony.

The node creates its Ed25519 key locally. Private keys and enrollment polling secrets live in the
platform protected store described in [Node identity primitives](./node-identity.md). Local JSON
contains only bounded non-bearer metadata and protected-store references. The permissioned-file
fallback is opt-in, POSIX-only, and enforces `0700` directories and `0600` regular key files. An
enrolled node never silently replaces a missing, locked, or corrupt key.

The non-secret local identity state records the pending ceremony's exact proposed label and whether
its protected material belongs to the `os` or
`permissioned-file` custody class. Once material exists, Ryco reopens that same class on future
starts instead of silently switching because another backend became available. A legacy identity
without the marker is migrated only when all required material is found in exactly one eligible
store. Missing, split, or ambiguous custody fails closed as `identity_store_unavailable`.

The standalone [relay architecture atlas](./relay-architecture.html) shows enrollment, client relay
connection, hosted reconnect, actor capabilities, role intersection, and which data each component
retains.

## Authentication

For every connection attempt, Ryco first requests a fresh proof challenge over HTTPS. It signs the
canonical node-authentication transcript with the selected local key, then opens
`wss://<configured-origin>/v1/relay/node`. The signed `auth` frame is the first WebSocket frame and
must complete within the negotiated five-second deadline.

Node WebSockets do not use cookies, Authorization headers, URL credentials, query parameters, or
bearer subprotocols. A challenge is single-use and in memory only. Replayed proofs, copied node IDs,
wrong or rotated keys, and ordinary authentication failures require operator action. Successful
authentication with an activated staged key confirms rotation locally and removes superseded key
custody according to the node-identity rules.

Revocation enters `revoked` and requires re-enrollment or an approved recovery procedure. An
unsupported relay version enters `version_incompatible`. A replacement connection and repeated
pre-stability protocol violations fail closed for operator action; Ryco never enters a tight retry
loop for these conditions.

## Connector states and reconnect policy

Local status exposes only these bounded states:

| State                  | Meaning                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `disabled`             | No polling, socket, reconnect timer, or relay channel exists.              |
| `enrolling`            | Enabled and ready to start device-code enrollment.                         |
| `awaiting_approval`    | A protected enrollment ceremony is being polled.                           |
| `connecting`           | Proof preflight or network connection is in progress.                      |
| `authenticating`       | The auth frame was sent and Ryco is waiting for `ready`.                   |
| `online`               | Protocol 1.2 is negotiated; bounded channel and queue counts are included. |
| `degraded`             | Backing off automatically or waiting for operator action.                  |
| `revoked`              | The node was revoked; automatic reconnect is stopped.                      |
| `version_incompatible` | The peer version is unsupported; automatic reconnect is stopped.           |
| `stopping`             | New work is rejected while resources are closed.                           |

DNS, network, TLS, authentication timeout, Hub draining, rate limiting, heartbeat timeout, slow
consumer, and isolated internal transport failures retry automatically. Backoff is exponential,
uses bounded jitter, honors a bounded `retryAfterMs`, and caps at the configured maximum. The
attempt counter resets only after the connection remains online for the configured stable interval.
Only one connection generation and one reconnect timer can exist for the configured Hub.

Configuration, key custody, origin mismatch, enrollment failure, authentication rejection,
connection replacement, revocation, version incompatibility, and repeated early protocol failure
require operator action. Restarting the process does not make a revoked identity retry.

`ryco hub leave` erases this node's local Hub identity: the active signing key, any staged rotation
key, a pending ceremony's key, and any polling secret still awaiting cleanup. It is the only exit
from `revoked` and from a corrupt identity, because `resume` will not restart a revoked identity and
enrollment refuses to start while an active node exists.

It is destructive and distinct from turning the connector off, which is reversible and keeps the
key. Leaving mints a fresh EnvironmentId, so the node can enrol again — as a **new** node, needing a
new approval. It does **not** revoke anything at the Hub: the previous node record survives there
until an owner removes it.

The erase is crash-safe. A durable marker records the intent and every secret to remove before
either store is touched, so an interrupted leave is completed on the next start rather than
orphaning key material or leaving state that points at keys which are already gone.

`ryco hub resume` retries a connector that stopped without scheduling its own retry, and prints the
resulting status. Use it for `connection_replaced` and for a `identity_unavailable` caused by a
credential store that was locked and has since been unlocked; neither schedules a retry timer, so
neither recovers on its own. Resume is deliberately a no-op for `revoked`, for a stopping connector,
and for a disabled one — it reports the unchanged state rather than implying it acted.

## Relay channels, limits, and roles

Ryco explicitly accepts only protocol 1.2 `channel.open` frames with capability `ryco.rpc`, an
effective role, and room under the negotiated channel limit. Every other open is rejected. Each
accepted logical channel owns an isolated RPC byte-session scope and uses the same application
handlers and services as direct Ryco WebSocket clients. Provider, terminal, orchestration, project,
and persistence logic is not duplicated.

The channel's effective role is enforced by an exhaustive RPC access policy. `viewer` can perform
read-only operations, `operator` can run ordinary workspace mutations, and `owner` can change
credentials, providers, MCP or Atlassian configuration, diagnostics, and server policy. Local auth
credential subscription remains direct-owner-only even for a relayed owner channel. Methods without
an explicit classification fail closed.

Application bytes remain opaque to the relay adapter and are copied byte-for-byte in sequence.
Per-channel sequence violations, transfer limits, slow consumers, or application session closure
close only that channel. They do not close the connector, local clients, or unrelated channels
unless a bounded connector control frame can no longer be retained safely.

Negotiated `maxChannels`, `maxDataChunkBytes`, `maxQueuedBytes`, and control-frame limits are
enforced on both directions. Connector queues and RPC input queues are bounded. Control frames have
reserved capacity, channel data is scheduled fairly, and native WebSocket `bufferedAmount` counts
toward the owned byte budget. No relay payload is written to persistence, diagnostics, traces, or
logs.

`flow.pause` stops outbound scheduling for only the named channel; `flow.resume` restarts it in
order. Ryco emits the corresponding inbound pause before an RPC input queue reaches its high-water
mark, tolerates only the negotiated grace, and polls the bounded queue until it can resume. A peer
that continues beyond the grace is closed as a slow consumer.

## Heartbeat and shutdown

Hub sends a ping on the negotiated 20-second cadence. Ryco immediately queues a byte-exact pong and
uses the negotiated 45-second dead-connection timeout. Only a valid Hub ping refreshes that timer;
ordinary relay traffic does not mask a missing heartbeat.

Server shutdown invalidates the active connection generation before cleanup. It stops enrollment
and reconnect timers, rejects new channels, closes every channel scope and queue, closes the Hub
socket, removes socket listeners, and clears heartbeat, stability, and drain timers. Local clients
and the normal server listener follow their existing shutdown path.

## Troubleshooting

- `configuration_invalid`: check the exact boolean spellings, HTTPS origin, and reconnect ranges.
- `identity_unavailable`: unlock or restore the platform credential store, then `ryco hub resume`;
  do not copy a node ID or generate a replacement key manually.
- `identity_store_unavailable`: the credential store could not be opened at all when this process
  started, and no retry can repair it. Fix the store, then restart Ryco.
- `enrollment_expired`: the ceremony's own expiry passed. Start a new one.
- `identity_origin_mismatch`: use the origin to which the identity was enrolled or perform an
  approved re-enrollment.
- `enrollment_unavailable`: the ceremony was denied or cancelled at the Hub. Find out why before
  starting another; a denial is a human saying no.
- `authentication_failed` or `revoked`: verify approval, key rotation, and node status with the Hub
  operator; retries are intentionally stopped. `ryco hub resume` will not restart a revoked identity.
- `connection_replaced`: another process authenticated as this node. Stop it, then run
  `ryco hub resume`. No retry is scheduled for this failure, so it does not clear on its own.
- `protocol_invalid` or `version_incompatible`: upgrade the incompatible endpoint. Do not modify
  relay schemas or fixtures locally.
- Repeated `network_unavailable`, `tls_unavailable`, or `heartbeat_timeout`: check DNS, egress, TLS
  trust, and network policy. Status reports a bounded next-retry time without exposing the Hub URL.
- `slow_consumer`: reduce concurrent activity or investigate the receiving endpoint; connector
  buffering will not grow to absorb sustained overload.

Status and errors intentionally omit origins, hosts, routes, keys, challenges, nonces, signatures,
tickets, credentials, payloads, filesystem paths, and raw peer error text.
