# Desktop Hub connection design

**Status:** Proposed design — owner approval required

**Date:** 2026-07-26

## Summary

The outbound Hub connector ships and works, but only from a terminal. This design gives the desktop
app a first-class surface for it: a **Hub** section in Settings → Connections that configures the
connector, drives enrollment, renders every connector state, and offers the two recovery actions the
node genuinely owns.

The desktop remains a **node**. It never holds a human Hub account session. Approval stays on the
Hub, where the counterpart review screen already exists in this repository
(`apps/web/src/components/hostedHub/HostedNodeEnrollment.tsx`), and the node-side panel is designed
as its mirror rather than as a parallel invention.

Delivering this honestly requires four small server additions before any pixel is worth shipping.
Three of them close defects that exist today and are reachable from the CLI as well as from a GUI:
an enrollment ceremony that cannot be recovered after the terminal scrolls, a `resume()` operation
that is implemented but unrouted, and no exit at all from `revoked`. The GUI is what makes them
unavoidable; it does not create them.

Nothing here assumes a Ryco-operated Hub, a fixed domain, or Ryco-controlled accounts.

## Scope and boundaries

In scope:

- A `Hub` section in `apps/web/src/components/settings/ConnectionsSettings.tsx`.
- Desktop-owned persistence of the connector's enabled flag and Hub origin, delivered to the backend
  over the existing bootstrap-fd envelope.
- Four owner-gated local HTTP operations: enrollment read, resume, identity summary, and leave.
- One extension to `HubEnrollmentStartResult` so field-for-field comparison is possible.
- A pure presentation module mapping connector status to copy and available action.

Out of scope, and named as such:

- **Multiple Hubs.** `LocalHubIdentityState` is `version: 1` with a single `activeNode`
  (`apps/server/src/hubIdentity/LocalHubIdentityState.ts:36-42`). Multi-Hub needs a state-schema
  revision plus per-Hub connection generation, reconnect timer, and queue ownership.
- **A Hub account in the desktop.** See [Decision 1](#decision-1--the-desktop-is-a-node-not-a-hub-account).
- **Grant administration.** Who may reach this machine is Hub state, not node state.
- **A `hub.*` WebSocket RPC family.** Deferred, not forbidden — see
  [Decision 3](#decision-3--who-may-manage-the-connector).
- **A temporary non-destructive "pause" that keeps the socket down but the identity warm** beyond
  the enabled toggle itself.
- **`apps/mobile`.** Untouched. Read for precedent only.

## Decision 1 — the desktop is a node, not a Hub account

**Decision: Option A. The desktop app is a node. It never holds a human Hub session.**

The Hub separates human identity (passkey, browser session) from node identity (a local Ed25519 key
with no human credential). The arguments below are ordered by how much weight they actually carry.

**1. Identity separation is the load-bearing reason.** The node machine already holds the Ed25519
signing key that *is* this node's identity. Adding a human Hub owner session to the same machine
means a single compromise yields both "I am this node" and "I am the human who governs this node" —
including the authority to approve enrollments and grant other people access to it. That collapse is
the thing the Hub's two-identity model exists to prevent. Node-only is a least-authority decision:
it bounds the blast radius of an Electron compromise to the node, not to the account.

**2. RP-ID scoping blocks it in the near term anyway.** The packaged renderer loads
`backendHttpUrl` (`apps/desktop/src/main.ts:795`, `:2723`), which is `http://127.0.0.1:<port>`. A
WebAuthn RP ID must be the caller's effective domain or a registrable domain suffix of it, and no
loopback origin can be a registrable-domain suffix of a remote Hub domain. Note precisely what this
does and does not say: Electron *can* open a `BrowserWindow` on the Hub and run a ceremony there —
what it cannot do is assert the Hub's RP ID *from the Ryco renderer's own origin*. Any real
desktop account feature would therefore be a browser handoff, and the desktop registers no
`setAsDefaultProtocolClient`, no `open-url` handler, and no `second-instance` handler today, so the
return leg is unbuilt.

**3. Cost, not a barrier.** Client mode is compile-time (`VITE_RYCO_CLIENT_MODE`), and
`hostedSettingsSectionAllowed` returns `false` for `"connections"`
(`apps/web/src/components/settings/SettingsDialog.tsx:73`), so the hosted and standard bundles are
mutually exclusive by construction today. `packages/client-runtime` already owns `HostedHubApi` and
DPoP bearer mode, so this is a bounded cost rather than a wall. It is listed for completeness; it is
not why we are choosing A.

**What this decision does not claim.** It does not claim self-approval is prevented. A solo operator
will click *Open Hub*, land in Safari on the same Mac, and approve with Touch ID. That is the
expected path and it is fine. It also does not claim host-compromise resistance: a browser session
on the same machine is still on the same machine. The separation this buys is process, storage, and
origin isolation against a renderer-scoped compromise — real, but narrower than "the key and the
account are on different devices."

**The honest recommendation to the operator**, stated in the UI: when the node host itself is in your
threat model, approve from another device.

## Decision 2 — how the Hub origin is configured

**Decision: the enabled flag and Hub origin become desktop-owned launch configuration, persisted in
`desktop-settings.json` and delivered over the existing bootstrap-fd envelope. They never enter
`ServerSettings`.**

### This is new wiring, and the spec says so

Hub configuration is **env-only today**. `BootstrapEnvelopeSchema` (`apps/server/src/cli.ts:75-89`)
has no Hub keys, there are no Hub CLI flags, and `resolveHubConnectorConfig` is fed purely from
`env.hub*`. The `resolveOptionPrecedence` chain at `cli.ts:395-399` governs host, port, and
Tailscale — not Hub. This design adds:

- two optional keys on `BootstrapEnvelopeSchema` (`hubConnectorEnabled`, `hubOrigin`);
- one precedence resolution in the Hub block of `resolveServerConfig`;
- `hubConnectorEnabled` / `hubOrigin` on `DesktopSettings`.

### The desktop becomes the single owner of these two values

`backendChildEnv()` (`apps/desktop/src/main.ts:402-419`) is a deny-list clone of `process.env`, and
`RYCO_HUB_*` currently passes through. **Add `RYCO_HUB_ORIGIN` and `RYCO_HUB_CONNECTOR_ENABLED` to
that deny-list**, exactly as `RYCO_TAILSCALE_SERVE` and `VITE_DEV_SERVER_URL` already are.

This deletes an entire class of problem rather than rendering UI for it. Without the strip, the GUI
needs a read-only "Managed by environment" state — and that state would be a lock icon any same-user
process can forge with `launchctl setenv`, guarding a toggle that would then silently no-op. With
the strip, desktop config is authoritative inside the desktop, `ryco serve` remains fully
env-configurable for headless operators, and the precedence question disappears.

The remaining five `RYCO_HUB_RECONNECT_*` / `RYCO_HUB_ALLOW_FILE_SECRET_STORE` variables are **not**
stripped and **not** surfaced in the GUI. They are tuning and custody-posture knobs for operators who
already know what they are; leaving them env-only keeps the GUI's surface to the two values a person
actually configures.

### Why not `ServerSettings` — the argument, stated accurately

The tempting argument is that a relayed owner could re-point the node's Hub via
`serverUpdateSettings`. **That argument is dead and this spec does not make it.** A relayed
*operator* already holds `projectsWriteFile` and `terminalOpen`/`terminalWrite`
(`packages/shared/src/rpcAccessPolicy.ts`), so `desktop-settings.json` is a file such a session can
already rewrite. At operator and above, the Hub is a fully trusted control plane. Any design that
pretends otherwise is decoration.

The real, smaller delta is confidentiality at the **viewer** tier: `serverGetSettings` is classified
`"viewer"`, and a relayed viewer cannot read files. Putting the Hub origin in `ServerSettings` would
make it readable by every relayed viewer, contradicting the connector's standing rule that status
and errors omit origins (`docs/hub-connector.md:164`). Keeping it out preserves that.

The stronger justification is ordinary engineering: the connector is constructed during server
startup from `ServerConfig`, so its origin must be known *before* the settings store is usable.
Launch configuration belongs on the launch channel. The bootstrap fd is already exactly that
channel, schema-validated, and — unlike the environment — not inherited by every provider subprocess
the backend later spawns.

### Persistence hardening (required, not optional)

`writeDesktopSettings` (`apps/desktop/src/desktopSettings.ts:117-125`) writes with default modes,
leaving the file world-readable, while `secrets/` is `0700` and hub-identity state hard-fails unless
`0600`/`0700`. And `readDesktopSettings` (`:78-116`) catches every error and returns defaults, which
the next write then persists. A corrupt settings file would therefore **silently and permanently
disable the Hub connection with no operator signal**.

- Write the file `0600` in a `0700` directory.
- Surface a parse failure as an error state; never silently revert to defaults and re-persist.
- The Hub origin is excluded from desktop logs, diagnostics, crash reports, and support bundles, and
  is added to the sensitive-value canary scan. `writeDesktopLogHeader` already logs
  settings-derived values verbatim, so this needs an explicit rule and a test, not an intention.

### Origin input must survive real typing

`canonicalizeHubOrigin` is a strict equality validator (`value !== url.origin`), so a trailing
slash, a `/nodes` path, a missing scheme, an explicit `:443`, uppercase, or stray whitespace all
collapse into one flat rejection. That is correct for a protocol validator and unusable as a form
validator.

- The desktop main process **canonicalizes before validating**: trim, lowercase scheme and host,
  strip a lone trailing slash.
- It returns a **discriminated reason**, so the field can say which rule failed, and offers a
  one-click fix when the only problem was a path.
- Validation is exposed as `desktopBridge.validateHubOrigin(raw)` for on-blur feedback. The renderer
  cannot import `@ryco/shared/nodeIdentity` directly — it pulls in `node:crypto`.

### Changing the origin, and the trap this closes

`activeNode.hubOrigin` is persisted and compared, producing `identity_origin_mismatch`. **No
non-test code path clears `activeNode`** outside `makeInitialState()`. So today, changing the origin
after enrollment is a permanent dead end with no in-product recovery.

The origin field is therefore **read-only whenever a local identity exists**, and changing it
requires an explicit *Leave this Hub* first. Enforcing that needs a signal the current contract does
not carry — see [Decision 7](#decision-7--the-server-surface). Applying a change relaunches the app,
reusing the existing confirmation dialog and `relaunchDesktopApp()` (`main.ts:588-613`).

## Decision 3 — who may manage the connector

**Rule: connector management is reachable only over a direct connection to the node's own HTTP
listener, by an owner session. It is never reachable through the Hub.**

### What actually enforces it

**One structural layer.** The relay accepts only protocol 1.2 `channel.open` frames with capability
`ryco.rpc` (`docs/hub-connector.md:109`). `/api/hub/*` are HTTP routes. There is no HTTP tunnel over
the relay, so `authenticateOwner` can never even run on a relayed request. This is the enforcement.

**One defence-in-depth check.** `authenticateOwner` (`apps/server/src/hubConnector/http.ts:8-18`)
rejects non-owner sessions on the routes themselves.

**One client-side UX filter that is explicitly not a security control.**
`hostedSettingsSectionAllowed` hides Connections, and `resolvePrimaryEnvironmentHttpUrl` throws in
hosted mode. Both constrain the bundle Ryco ships; neither constrains a modified client. Earlier
drafts of this design called these "three independent layers." They are not, and this spec does not
claim the margin.

### A correction worth stating plainly

`authenticateOwner` checks `session.role` only. It does **not** check locality. An owner paired over
LAN or Tailscale who can reach the node's listener can call these routes today. The accurate rule is
therefore *any directly-connected owner*, not *any local owner*.

That is defensible — such an owner was explicitly paired and already holds full node authority — but
it is not what the phrase "direct local owner" implies, and identity-erasing operations deserve a
tighter boundary than ordinary owner methods. **Owner decision required:** restrict the mutating
Hub routes (`enrollment`, `enrollment/cancel`, `resume`, `leave`) to a loopback peer address in
addition to owner authentication. `readRemoteAddressFromSource` already extracts peer addresses
(`apps/server/src/auth/utils.ts:113`). This narrows access that exists today, so it is the owner's
call, not the design's.

### Why not an RPC family in phase 1

The merged connector design already sanctions a direct-local control RPC
(`docs/superpowers/specs/2026-07-16-outbound-hub-connector-design.md:138`, `:529`), and
`direct_owner` is an existing fail-closed classification —
`relayRpcPrincipal` hardcodes `canManageLocalAccess: false`
(`apps/server/src/ws/RpcPrincipal.ts:29`), `authorizeRpcPrincipal` requires
`role === "owner" && canManageLocalAccess` (`apps/server/src/auth/wsAuthorization.ts:27`), and
`hostedRoleAllows` returns `false` for it (`packages/shared/src/rpcAccessPolicy.ts:143`).

Phase 1 nonetheless uses the **existing owner-gated HTTP routes**, because the panel's data need is
already served by them, because `HubConnectorService` is not in the context the relay channel
factory builds, and because HTTP gets the relay-unreachability property for free. This is a **scope
deferral, not a prohibition**. If a `hub.*` family is added later, every method is classified
`direct_owner`, and `RPC_ACCESS_POLICY`'s `satisfies Record<RpcMethod, RpcAccess>` makes omitting a
classification a compile error.

### What the panel can honestly say about roles

Very little, and it should say so rather than invent. `HubConnectorStatus` carries `activeChannels`
and `queuedBytes` — a count and a byte total. There is no per-channel role breakdown, no account
identity, and no grant list, and obtaining one would require a Hub account credential a node-only
desktop does not hold.

The Hub section therefore shows:

- an authored, static explainer of what each effective role can do to *this machine*, derived from
  the real policy: `viewer` reads, `operator` performs ordinary workspace mutations including file
  writes and terminals, `owner` additionally changes credentials, providers, integrations, and
  server policy;
- the live count of active relay sessions;
- one honest sentence: **"Who can reach this machine through the Hub is managed on the Hub, not
  here."**
- the one lever the node genuinely owns: turning the connector off, which works without the Hub.

A future bounded `activeChannelsByRole` breakdown would turn "3 sessions" into "1 owner, 2 viewers"
without naming any identifier. It is a status-schema amendment and is listed as an open question,
not designed in.

## Decision 4 — the enrollment and fingerprint flow

**Decision: mirror the counterpart screen field-for-field. Do not invent a fingerprint treatment.**

This is a reversal of the obvious first instinct, and the reason matters.

### The counterpart screen already exists, in this repository

`apps/web/src/components/hostedHub/HostedNodeEnrollment.tsx:149-179` is the Hub-side approval
review. It renders exactly six fields through the shared `DataList` primitive — **Label, Platform,
Version (mono), Algorithm, Fingerprint (mono), Expires** — under the instruction *"Compare every
field, especially the fingerprint, with the node or a trusted operator channel before approving."*

The primitive's own documentation settles the typography question
(`apps/web/src/components/ui/data-list.tsx:5-18`, `:52-56`):

> The identifier treatment is the part that matters — a fingerprint that wraps one way on one screen
> and another way on the next is a security-review finding, not a cosmetic one, so `mono` owns the
> whole mono/`break-all` decision rather than leaving it to each call site.

A node-side treatment that chunks the fingerprint into groups, or varies weight across it, would
have the operator comparing two differently-typeset renderings of the same string — the precise
failure the primitive exists to prevent. **The node uses `DataList`/`DataListItem` with the same
fields, in the same order, with `mono` on the same fields.**

### The device code is transported; the fingerprint is compared

The Hub's entry point is a device-code field: `maxLength={16}`, `font-mono uppercase`
(`HostedNodeEnrollment.tsx:236-245`). There is no fingerprint paste target anywhere in the flow.

So the task model is: **carry the device code across, compare the fingerprint by eye.** This inverts
the intuition that the device code should be visually demoted.

- **Copy sits on the device code**, using `DataListItem`'s existing `action` slot.
- **The fingerprint gets no copy action.** There is nowhere to paste it, and offering one invites
  pasting it somewhere that proves nothing.
- The device code keeps a caption stating it only routes the request and does not prove which
  machine is being approved. Subordination is achieved by that sentence, not by hiding it.

Requires extending `HubEnrollmentStartResult` with `label`, `platformOs`, `platformArch`,
`clientVersion`, and `algorithm`. All are already computed node-side and already sent to the Hub
(`apps/server/src/hubConnector/HubConnectorLive.ts:110-114`,
`apps/server/src/hubIdentity/HubEnrollmentClient.ts:13-18`). This is plumbing what already exists to
the surface that needs it.

### The ceremony expands in place, and stays

Not a dialog. The Hub row expands into its own `children` via `AnimatedHeight` — already the file's
idiom.

This is not a stylistic preference. A dialog can be dismissed, and today the device code, fingerprint,
and expiry exist **only in the 201 enrollment-start body**: `HubConnectorStatus` carries none of
them, `PendingHubEnrollmentState` persists none of them, and `enroll()` throws when
`pendingEnrollment !== null` (`apps/server/src/hubConnector/HubConnector.ts:172-173`), surfacing as
`"Hub enrollment operation failed."`. One <kbd>Cmd-W</kbd> destroys a live ceremony while the
connector keeps polling `awaiting_approval` and the panel offers no way back in.

Expanding in place plus the persisted-ceremony read (Decision 7) makes "the comparison stays
available for the whole approval window" structurally true rather than aspirational.

### Actions

- **Primary: Open Hub** — `shell.openExternal(canonicalizeHubOrigin(origin))`, the **origin root
  only**. The node derives exactly one route from the origin (the relay endpoint); synthesizing an
  approval path would invent a Hub routing detail the node has no contract for.
- **Copy device code** — on the device-code row.
- **Cancel enrollment** — `destructive-outline`, adjacent to a warning line reading: *if the
  fingerprint on the Hub differs by even one character, deny it there and cancel here.*
- **No "Done — I compared this" button.** It writes nothing, gates nothing, and is self-attestation
  theatre. The affirmative act happens on the Hub.
- **Never** auto-copy, and **never** surface the fingerprint in a toast.

### QR, honestly

Deferred, with the real reason: **the approval surface cannot scan and diff a fingerprint today, so
a QR code would be a picture nobody verifies.** The earlier rationale — that machine-readability
defeats the human check — does not survive contact with the Copy button on the device code, which is
equally machine-mediated. If the Hub ever gains a scan-and-compare capability, QR becomes a genuine
improvement over eye-comparison, not a regression.

## Decision 5 — states, failures, and what the panel offers

**Decision: one `SettingsRow`, driven by one pure exhaustive function.**

```
(status: HubConnectorStatus, identity: HubIdentitySummary, now: number)
  => { dot, ping, headline, detail, action, note, retrying }
```

It lives in `apps/web/src/components/settings/hubStatus.ts`, matching the
`AccountSettings.logic.ts` / `pairingUrls.ts` extraction convention. No status sentence is
hand-written in JSX — the same rule the hosted client already enforces for its status vocabulary.
The switch is exhaustive over `HUB_CONNECTOR_FAILURE_CODES` (a `const` tuple), so adding a failure
code fails the typecheck until copy exists for it.

### The state matrix

`transitionedAt` is present on every row. `nextRetryAt` is present **only** with
`degradedMode: "backing_off"`, which the schema enforces.

| State | Degraded mode | Retrying? | What the operator is told | Action offered |
| --- | --- | --- | --- | --- |
| `disabled`, no identity | — | no | Not connected to a Hub. | Configure + **Enable** |
| `disabled`, identity present | — | no | Turned off. This machine stays enrolled. | **Enable**, **Leave this Hub** |
| `enrolling` | — | no | **Ready to enroll — waiting for you.** | **Start enrollment** |
| `awaiting_approval` | — | no | Waiting for approval on the Hub. | **Open Hub**, **Copy device code**, **Cancel** |
| `connecting` | — | n/a | Connecting. | — |
| `authenticating` | — | n/a | Authenticating. | — |
| `online` | — | n/a | Connected. *N* active sessions. | **Turn off** |
| `degraded` | `backing_off` | **yes** | Reconnecting — next attempt in *T*. | **Retry now** |
| `degraded` | `operator_action_required` | **no** | Per failure code, below. | Per failure code |
| `revoked` | — | **no** | **Revoked at the Hub. This will not retry.** | **Leave this Hub** |
| `version_incompatible` | — | **no** | **Incompatible relay version. This will not retry.** | Update guidance |
| `stopping` | — | n/a | Shutting down. | — |

Three corrections this table encodes, each of which an earlier draft got wrong:

- **`online` is a state**, not an absence of one.
- **`enrolling` is not self-driving.** Startup enters it when no identity exists and then waits
  indefinitely for an explicit enrollment call. It is a *waiting-on-a-human* state and its row must
  contain a button.
- **The failure code alone can never drive the button.** `protocol_invalid` and
  `authentication_failed` each appear in both a retrying and a non-retrying form
  (`apps/server/src/hubConnector/HubConnectorState.ts:35-77`), and `revoked` is reported *as*
  `authentication_failed` with a terminal state. Presentation keys on `(state, degradedMode)`;
  remedy keys on `failure` plus identity phase.

### Operator-action failures, and their differing remedies

Seven failure codes reach `degraded` / `operator_action_required`, and they do not share a remedy.
Offering a blanket "Enroll" is actively harmful: in the origin-mismatch case it throws and surfaces
`"Hub enrollment operation failed."`

| Failure | What it means | Action |
| --- | --- | --- |
| `configuration_invalid` | The Hub configuration this backend launched with is invalid. | Edit origin → relaunch |
| `identity_unavailable` | The system keychain is locked or unavailable. | **Retry now**; restart guidance |
| `identity_origin_mismatch` | Enrolled against a different Hub. | **Leave this Hub** |
| `enrollment_unavailable` | The ceremony expired, or was denied or cancelled at the Hub. | **Start enrollment** |
| `authentication_failed` | The Hub rejected this node's key. | **Open Hub**; **Leave this Hub** |
| `connection_replaced` | Another process connected as this node. | **Retry now** |
| `protocol_invalid` (post-stability) | Repeated protocol violations. | Update guidance |

Two of these deserve splitting, and this design asks for it as a **contract refinement, gated on
owner approval**:

- `enrollment_unavailable` currently conflates **expired** (locally known —
  `now() >= pending.expiresAt`) with **denied at the Hub**. The panel must give opposite instructions
  for these — "start a new one" versus "someone rejected this; check with them first" — and today
  cannot tell them apart.
- `identity_unavailable` conflates a **transient locked keychain** (which `resume()` can fix) with a
  **construction failure at startup**, which is swallowed into a process-lifetime unavailable-identity
  stub that no retry can repair (`apps/server/src/hubConnector/HubConnectorLive.ts:57-67`). Showing a
  Retry button that provably cannot work is worse than showing none.

Neither split leaks anything: both name a condition, not a value.

`configuration_invalid` stays a single opaque sentence. `resolveHubConnectorConfig` collapses every
distinct misconfiguration into one flag (`apps/server/src/config.ts:104-140`), and with the origin
now validated in the desktop *before* it is persisted, this code should be unreachable from the GUI
path. A bounded field-naming detail enum is an open question, not a slice.

### Polling

- **One cadence** while Settings is open, reusing the diagnostics interval constant.
- **No faster polling during `awaiting_approval`.** It cannot surface an approval sooner: the
  server's enrollment poll runs at the Hub-dictated `pollIntervalMs` (bounded 1,000–60,000 ms), and
  the local status snapshot only reflects what that poll has already found. A faster local poll adds
  load and buys nothing.
- **A failed poll marks the panel stale** — retain the last snapshot, render it explicitly as
  "Last checked *N* ago" with a muted dot. Never keep rendering "Online" over a dead control plane.
- A `nextRetryAt` in the past clamps to "retrying now".

### Nothing outside the settings panel

**No tray, no global chrome, and no dot on the settings-nav item.** The nav dot was proposed and is
cut: `ConnectionsSettings` is lazily mounted per section, so a panel-owned poller cannot update a
nav item while the operator is on another section, and driving it would require a second poller
running outside the panel — contradicting the polling rule above and adding a background HTTP poll
for a decoration. There are also two settings navs to keep in sync.

The row's own status dot carries the state, using the file's existing semantics: `bg-success` +
ping when online, `bg-warning` + ping while connecting or retrying, `bg-destructive` when stopped,
`bg-muted-foreground/40` when off.

## Decision 6 — one Hub, and process contention

**One Hub, presented as a singular noun.** One row. No list, no "Add Hub". A list of one invites a
plus button that cannot work, because `LocalHubIdentityState` has exactly one `activeNode` slot.

**Process contention: the earlier framing was wrong and is corrected here.** `withLock`
(`LocalHubIdentityState.ts:316-383`) is a per-operation advisory lock with `finally`-release that
reclaims locks whose recorded PID is gone. Lock contention is therefore transient, not the permanent
state an earlier draft described.

The genuinely permanent-until-relaunch cases are different:

- **`connection_replaced`** — another process authenticated as this node. Classified
  `{action: "operator"}` with **no retry scheduled**, so it never self-heals even after the other
  process exits. This is the real duplicate-process symptom, and the copy should name it.
- **Keychain unavailable at construction** — swallowed into a process-lifetime stub whose every
  method throws.

Both are fixed by the resume route (Decision 7), not by a single-instance lock.

`app.requestSingleInstanceLock()` is still worth adding — the desktop has none — as **its own
slice**, for the UX of a second launch. It is explicitly not the fix here: it coordinates only
instances of one Electron app identity, and does nothing about a headless `ryco serve`, a dev build,
or any other process sharing `RYCO_HOME`.

## Decision 7 — the server surface

Four operations. Three of them close defects that exist today independently of any GUI.

### 1. `POST /api/hub/resume` — ship first

`connector.resume()` is already implemented and already on `HubConnectorServiceShape`
(`apps/server/src/hubConnector/HubConnectorLive.ts:20`, `:126`) with **zero non-test callers**. The
route is a ~12-line copy of the existing cancel route.

This replaces the relaunch hammer entirely. `relaunchDesktopApp()` tears down every provider
session, terminal, and orchestration run to retry one outbound socket — and it does not even work
for `revoked`, where `resume()` early-returns and a fresh `start()` re-authenticates straight back
into the same terminal state.

Returns `HubConnectorStatus`.

### 2. `GET /api/hub/enrollment` — equally blocking

Persist `deviceCode` in `PendingHubEnrollmentState` and return the bounded ceremony metadata:
`deviceCode`, `fingerprint`, `label`, `platformOs`, `platformArch`, `clientVersion`, `algorithm`,
`expiresAt`, `pollIntervalMs`.

The fingerprint needs no new persistence — `PendingHubEnrollmentState.keySecretName` already
references the pending key, and `NodeSigningIdentity` exposes public-descriptor lookup, so it is
recomputable without exporting private material.

This is a **deliberate, reviewed change to the one-shot display policy** for the device code, and it
must be called out as such at security review. The argument for it: today the ceremony is
unrecoverable the moment its output scrolls away, which is a CLI defect as much as a GUI one, and
the recovery path — cancel and re-enroll — silently destroys key custody.

### 3. `GET /api/hub/identity` — a sibling schema, not a status field

```ts
HubIdentitySummary = { enrolled: "none" | "pending" | "active" }
```

No origin. No node, key, or environment identifier. No fingerprint.

**It must not be a field on `HubConnectorStatus`.** That schema is declared closed
(`2026-07-16-outbound-hub-connector-design.md:510`) and carries a cross-field `.check()` encoding
every legal field combination; a new field with no invariant weakens that property. A sibling schema
plus a canary test asserting the status schema's field set is the compatible shape.

Without this, Decision 2's "the origin field is read-only whenever an identity exists" is
**uncomputable**: `state: "disabled"` is returned both when nothing was ever enrolled and when an
identity exists with the connector off (`start()` returns before reading identity state when the
connector is disabled or misconfigured). The origin-mismatch trap would remain reachable in slice 1
exactly as designed.

### 4. `POST /api/hub/leave` — a connector operation, crash-safe

**Two distinct operations, never conflated in the UI:**

| | Turn off Hub connection | Leave this Hub |
| --- | --- | --- |
| Reversible | yes | **no** |
| Local key | retained | **erased** |
| Mechanism | `hubConnectorEnabled: false` + relaunch | this route |
| Confirmation | none | destructive `AlertDialog` |

Rationale, corrected: **leave is the only exit from `revoked` and from a corrupt or orphaned
identity.** `resume()` returns immediately on `revoked`, `enroll()` throws because `activeNode` is
non-null, and restarting re-runs into the same dead end. Justifying it by "so you can change the
origin" is circular with Decision 2 and understates it.

Implementation constraints, all load-bearing:

- **Model it on `cancelEnrollment`, never on `stop()`.** `stop()` sets `#stopping = true`
  (`HubConnector.ts:245`) and nothing ever sets it back — the only assignment to `false` is the field
  declaration at `:51`. Both `start()` (`:85`) and `resume()` (`:126`) early-return on it for the
  rest of the process lifetime, so a leave built on `stop()` would make re-enrollment impossible
  without a relaunch. Leave must invalidate the connection generation, close the channel registry and
  socket, then transition to `enrolling`.
- **Deleting the key does not close an authenticated socket.** An established relay session is never
  revalidated against identity state, so it would keep serving relayed RPC until the next transport
  failure. Channel teardown must precede custody mutation.
- **Crash-safe, idempotent, resumable.** Mirror `clearPending`'s three-phase state → secrets →
  state-clear ordering (`HubEnrollmentClient.ts:204-229`) and add a teardown marker to
  `ActiveHubNodeState`, which today has only `cleanupPollingSecretName`. A `stagedRotation` holds a
  second key secret and must be erased too. A partial leave that loses the secret reference before
  clearing state is unrecoverable in-product.
- **Implement against the file store directly**, so it still works when the identity runtime has
  already degraded to the unavailable stub — which is exactly when an operator needs it.

Returns `HubConnectorStatus`.

The confirmation dialog states plainly: this erases this machine's Hub key; reconnecting requires a
new approval; and **it does not revoke anything at the Hub** — the node record survives there until
an owner removes it.

**It must additionally state that this machine cannot rejoin the same Hub until that record is
removed there**, for the reason given in Hub obligation 3. Without the Hub-side capability that
obligation names, this dialog is describing a one-way door, and the copy has to say so in those
words rather than implying a reversible action.

### Client access

Add these calls to the existing `createPrimaryAuth` factory in
`packages/client-runtime/src/connection/primaryAuth.ts` and re-export through
`apps/web/src/environments/primary`.

Not a new module, and not a panel-local `fetch`. That factory already owns the cookie-versus-bearer
credential ternary, `retryTransientBootstrap`, and `readErrorMessage`
(`primaryAuth.ts:86-106`) — the exact three things a hand-rolled fetch would re-implement, which
`AGENTS.md`'s no-fork rule forbids. **No HTTP client in the Electron main process.**

The routes respond with `HttpServerResponse.jsonUnsafe` and never encode through the contract, so
the client must `Schema.decodeUnknown(HubConnectorStatus)`. A decode failure is treated as
unknown/stale, not as a distinct error state.

### Access classification

| Operation | Transport | Auth | Relay-reachable |
| --- | --- | --- | --- |
| `GET /api/hub/status` | node HTTP | owner | no — no HTTP over relay |
| `GET /api/hub/enrollment` | node HTTP | owner | no |
| `GET /api/hub/identity` | node HTTP | owner | no |
| `POST /api/hub/enrollment` | node HTTP | owner | no |
| `POST /api/hub/enrollment/cancel` | node HTTP | owner | no |
| `POST /api/hub/resume` | node HTTP | owner | no |
| `POST /api/hub/leave` | node HTTP | owner | no |

If any of these ever becomes a WebSocket RPC, its classification is `direct_owner`.

## Screen design

Placement: a new `SettingsSection title="Hub"` in `ConnectionsSettings.tsx`, after **Authorized
clients** and before **Remote environments** — reachability of this machine, grouped with the other
reachability controls, before the list of other machines.

The section uses only the file's existing vocabulary: `SettingsSection`, `SettingsRow`,
`ConnectionStatusDot`, `Button` (`size="xs"`, `variant="outline"` / `"destructive-outline"`),
`AnimatedHeight`, `AlertDialog`, and `DataList`. Warnings use the established
`text-warning` / `text-destructive` + `TriangleAlertIcon` idiom, not an `Alert` primitive — this
file uses none. No badges, no pills, no cards inside cards, no icon that carries no information.

### Not connected — empty state

```
HUB ─────────────────────────────────────────────────────────────
  Hub                                                  [ Enable ]
  Reach this Mac from anywhere — including behind NAT or CGNAT —
  without opening a port. Requires a Hub account.
  ● Not connected

  Hub address                          [ https://…            ]
  The address of the Hub you or your team operate.
```

The description names the differentiator rather than the mechanism, and it also names the honest
alternative: if the phone is on the same Wi-Fi or tailnet, the pairing link above is faster. Saying
so costs a sentence and prevents the section from overselling itself.

Enable is disabled until the origin validates. Toggling it opens the existing relaunch confirmation.

### Enrolling — the comparison, expanded in place

```
  Hub                                       [ Open Hub ] [ Cancel ]
  ● Waiting for approval on the Hub · expires in 8m 12s

  ┌────────────────────────────────────────────────────────────┐
  │ Compare every field on the Hub's approval screen before     │
  │ approving.                                                  │
  │                                                             │
  │ Label        Laurin's MacBook Pro                           │
  │ Platform     darwin · arm64                                 │
  │ Version      0.0.17                                         │
  │ Algorithm    Ed25519                                        │
  │ Fingerprint  SHA256:9f2b…                          (mono)   │
  │ Expires      26 Jul 2026, 14:32                             │
  │ Device code  K7P2-N4QX                        [ Copy ]      │
  │              Only routes the request. It does not prove     │
  │              which machine you are approving.               │
  │                                                             │
  │ ⚠ If the fingerprint on the Hub differs by even one         │
  │   character, deny it there and cancel here.                 │
  └────────────────────────────────────────────────────────────┘
```

Same primitive, same fields, same order, same `mono` treatment as the Hub screen. The instruction
sentence is deliberately near-identical to the Hub's, so an operator holding both reads one
instruction twice rather than two instructions once.

### Online

```
  Hub                                              [ Turn off ]
  ● Connected · 2 active sessions

  Who can connect          Managed on the Hub, not here.
  Sessions arriving through the Hub carry a role: viewer reads,
  operator edits files and runs terminals, owner also changes
  credentials and server policy.
```

### Stopped permanently

```
  Hub                                       [ Leave this Hub ]
  ● Revoked at the Hub. This will not retry.
  This machine's access was revoked. Leaving erases its Hub key
  so you can enrol again; it does not remove the node record on
  the Hub.
```

### Retrying

```
  Hub                                            [ Retry now ]
  ● Reconnecting — next attempt in 24s (attempt 5)
```

## Hub obligations

Named as obligations, with no private detail:

1. **Approval-screen rendering parity.** The node and Hub renderings of the fingerprint must remain
   identical in font, wrapping, and casing. Either side changing its identifier treatment
   unilaterally degrades the comparison. This is a joint obligation, and the node is the follower.
2. **Orphan node records.** After a local leave, the Hub-side record persists, bound to a key that no
   longer exists. Only a Hub owner can remove it. The node cannot signal its departure.
3. **Re-enrollment against the same Hub is currently impossible, and this blocks slice 4.**
   Investigated and resolved on 2026-07-26, stated here without Hub internals: the Hub binds **one
   node record per environment identifier**, that binding is unique, it **survives revocation**, and
   there is **no node-removal operation** on the Hub today. A local leave preserves `environmentId` —
   the local store forbids changing it (`LocalHubIdentityState.ts:394-399`) — so a fresh enrollment
   from the same machine to the same Hub collides with the orphaned record.

   Two consequences, both serious:

   - The failure lands at **approval time**, after the operator has already compared the fingerprint
     and clicked Approve. It is the worst available moment to fail.
   - Combined with obligation 2, **`revoked` has no in-product recovery path at all today**, even
     with the leave route: leave erases the local key, and re-enrollment then fails.

   The Hub must therefore provide **either** a node-removal operation **or** a key-replacement flow
   that preserves the existing node and environment identifiers. Until one exists, shipping the leave
   button would permanently prevent a machine from rejoining that Hub — a one-way door per machine,
   per Hub. **Slice 4 does not ship before this lands.**
4. **An approval deep link** would let *Open Hub* land on the approval screen rather than the origin
   root. It requires a Hub-supplied absolute URL in the enrollment start response — a contract and
   Hub-protocol change, explicitly out of scope here.
5. **Enrollment denial versus expiry** must be distinguishable in the poll response for the
   `enrollment_unavailable` split described in Decision 5.

## Delivery slices

Each slice is independently reviewable and independently revertable. Slices 1–3 are server-only and
carry no UI risk. **Slices 1–4 are `/security-review`-gated with owner sign-off** — they touch
identity, credentials, or relay transport.

| # | Slice | Gate |
| --- | --- | --- |
| 1 | `POST /api/hub/resume` + route tests. Fixes `connection_replaced` and transient `identity_unavailable` without a relaunch. Independently useful to CLI users. | security-review |
| 2 | Persist `deviceCode`; `GET /api/hub/enrollment`; extend `HubEnrollmentStartResult` with label/platform/version/algorithm. Makes a ceremony recoverable. | security-review |
| 3 | `GET /api/hub/identity` returning `HubIdentitySummary` + closed-status canary test. | security-review |
| 4 | `POST /api/hub/leave` as a crash-safe connector operation, with the teardown marker and resume-at-boot. **Hard-blocked on Hub obligation 3** — shipping it before the Hub can remove or re-key a node makes leaving a one-way door. | security-review |
| 5 | Desktop config: `DesktopSettings` fields, bootstrap-envelope keys, `backendChildEnv` strip, `0600`/`0700` hardening, surfaced parse failure, `validateHubOrigin` bridge. | standard |
| 6 | `hubStatus.ts` pure module + exhaustive unit tests over every state × degradedMode × failure code. No UI. | standard |
| 7 | The Hub section: status row, enable/disable, origin field, relaunch confirmation. | standard |
| 8 | Enrollment expansion, `DataList` comparison, copy device code, Open Hub, cancel. | standard |
| 9 | Leave dialog and its destructive confirmation copy. | standard |
| 10 | `app.requestSingleInstanceLock()`. Independent. | standard |
| 11 | Contract refinements: split `enrollment_unavailable` and `identity_unavailable`. Requires owner approval to touch the failure enum. | security-review |

Slices 1–3 can land in parallel. Slice 7 depends on 3, 5, and 6. Slice 8 depends on 2.

## Test strategy

- **Pure unit** — `hubStatus.ts` over every `(state, degradedMode, failure)` combination, asserting
  headline, offered action, and the retrying flag. Exhaustiveness enforced by the const tuple.
- **Server route tests** — owner gating on all seven routes; resume idempotence; leave crash-safety
  with an injected failure between each of the three phases; leave while a channel is open, asserting
  the channel closes before custody is mutated; leave while the identity runtime is the unavailable
  stub.
- **Contract canary** — asserts `HubConnectorStatus`'s field set is unchanged, so a future field
  addition is a deliberate review event.
- **Desktop unit** — origin canonicalization and its discriminated rejection reasons; settings file
  mode assertions; parse-failure surfacing rather than silent default.
- **Browser** — `SettingsPanels.browser.tsx` renderings for not-connected, enrolling,
  awaiting-approval, online, retrying, operator-action, and revoked.
- **Leak canary** — the Hub origin must not appear in desktop logs, diagnostics, or support bundles.

`apps/mobile` has no component tests and none are added here.

## What cannot be verified without a deployed Hub

Stated plainly, because nothing in the native/hosted stack has run on real hardware and the deployed
Hub predates the current identity work:

- **Every end-to-end enrollment path.** Approval, denial, and expiry all require a live Hub. Slices
  1–4 can only be tested against fakes.
- **Fingerprint rendering parity in practice** — that the two screens wrap identically at real
  window widths on real displays.
- **`identity_origin_mismatch` and `revoked`** as lived states, and therefore whether the leave route
  actually restores a node from them.
- **Relay-session role reporting** — `activeChannels` has never been observed non-zero against a real
  Hub.
- **Keychain behaviour in a signed, packaged, notarized build.** The `@github/keytar` path differs
  from the development Bun-secrets path, and slice 5 should carry a packaging smoke test asserting it
  loads from the built app.

## Open questions for the owner

1. **Loopback restriction.** Should the mutating Hub routes require a loopback peer in addition to
   owner authentication (Decision 3)? This narrows access that exists today. Recommendation: yes for
   `leave`, and decide `enrollment` alongside it.
2. **Device-code persistence.** Slice 2 changes a deliberate one-shot display policy. Recommendation:
   accept — the current behaviour makes a ceremony unrecoverable and pushes operators toward
   cancel-and-re-enroll, which destroys key custody.
3. **Failure-code splits.** Approve touching `HUB_CONNECTOR_FAILURE_CODES` for the two splits in
   slice 11? Recommendation: yes; the panel currently gives opposite advice under one code.
4. **`activeChannelsByRole`.** Worth a status-schema amendment to show "1 owner, 2 viewers"?
   Recommendation: defer until relay sessions have been observed on real hardware.
5. **Empty-state prominence.** The Hub section is invisible to anyone who never opens Connections.
   Should first-run onboarding mention it? Recommendation: not until slice 4 has run against a live
   Hub.
6. **Hub obligation 3 is now answered, and it needs Hub work.** Same-Hub re-enrollment after a leave
   is blocked, and `revoked` consequently has no in-product recovery at all. The Hub needs a node
   removal or key-replacement capability. Recommendation: schedule that Hub work now and treat slices
   1–3 as the shippable set until it exists — they are useful on their own and unblocked. The
   alternative, shipping leave with copy that admits it is irreversible per Hub, is worse than not
   shipping the button.

## Known limitations

- One Hub per state directory. Multi-Hub is a state-schema revision.
- The panel cannot show who is connected through the Hub, only how many.
- Leave does not revoke at the Hub, and until Hub obligation 3 is met it also prevents the machine
  from ever rejoining that Hub. `revoked` therefore has no in-product recovery path today.
- The bootstrap-envelope shape is duplicated between `apps/server/src/cli.ts` and
  `apps/desktop/src/main.ts` with no shared type. This design adds two keys to that duplication.
  Accepted debt; extracting the envelope to `packages/contracts` is a separate slice.
- A non-destructive temporary pause that keeps the socket down but the identity warm is out of scope;
  the enabled toggle is the whole vocabulary.
