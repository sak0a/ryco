# Desktop Hub advanced settings and relay atlas design

**Status:** Approved design

**Date:** 2026-07-29

**Amendment (2026-08-05):** The trust-boundary content this document requires of
`docs/relay-architecture.html` is superseded by
[relay payload encryption](../../relay-e2ee-protocol.md) §2.2, §2.4, and §2.5. The relay now
carries an application-level encryption layer inside `data.payload`, so the two "direct statement"
bullets in section 5 below — and the non-goal that named a new encryption protocol — are rewritten
here rather than left as a mandate to restore a claim the shipped clients have outgrown. Everything
else in this design remains authoritative. The page is not doc-only: `apps/web` imports it as a
Vite `?url` asset and the desktop app bundles it, so a regeneration against a stale requirement
ships the stale claim to users.

## Summary

Ryco will update the desktop Hub settings added by pull request 243 to cover the current Hub launch
flags without turning the normal settings panel into a server console. Connection, address,
enrollment, recovery, and leave remain the primary surface. A collapsed advanced section adds the
explicit permissioned-file secret-store fallback, explains desktop ownership of startup
configuration, shows equivalent CLI flags, and opens a bundled relay architecture guide.

Ryco will also add `docs/relay-architecture.html`, a standalone, dependency-free interactive
explainer for the complete relay workflow. It will show how a hosted or self-hosted Hub relates to
the hosted web client, native mobile app, desktop GUI node, and CLI node. It will make capabilities,
prohibitions, authorization, enrollment, connection, recovery, persistence, and trust boundaries
visible without exposing private Hub deployment information.

The implementation will reconcile pull request 243 with the Hub flags and lifecycle hardening now
on `main`. In particular, Hub startup configuration will use one consistent precedence:

```text
explicit CLI flag > environment variable > desktop bootstrap envelope > default
```

The desktop child process strips the three Hub environment variables it owns, so its bootstrap
envelope remains authoritative. Headless `ryco serve` has no desktop bootstrap envelope and keeps
normal flag and environment behavior.

## Development renderer origin addendum

In `dev:desktop`, Electron loads the renderer from the configured Vite development URL while Vite
proxies node HTTP requests to the desktop-scoped backend. Vite rewrites the proxied request host,
so a legitimate state-changing request has the configured development renderer in `Origin` and the
backend in `Host`. Production does not have this split because the packaged renderer and node API
are same-origin.

The mutation-origin guard will accept the exact origin of `ServerConfig.devUrl` in addition to the
request's own host. The exception exists only while a development URL is explicitly configured.
It does not accept another loopback port, a related hostname, or an arbitrary origin. Requests with
no `Origin` remain available to authenticated non-browser clients such as the CLI. Regression tests
will prove that the configured development origin succeeds, an unconfigured cross-origin request
fails, and a different origin still fails when development mode is configured.

## Goals

- Expose every current operator-relevant Hub launch setting in the desktop app.
- Keep routine Hub setup understandable for people who do not operate servers.
- Put exceptional and CLI-oriented detail behind an explicit advanced disclosure.
- Preserve one startup owner and one connector generation.
- Keep protected key custody fail-closed across restarts and credential-store availability changes.
- Explain the relay architecture accurately enough for developers and operators to reason about
  actors, trust, roles, and recovery.
- Produce a public-safe HTML artifact that works from `file://` and when bundled with the web app.

## Non-goals

- Reconnect timing controls in the desktop UI.
- A general environment-variable editor.
- Editing `--restrict-to-cwd` from the Hub panel. It is workspace confinement for CLI servers, not
  Hub connector configuration.
- Multi-Hub enrollment.
- Hub account, node grant, or role administration from the node.
- A generic tunnel, remote desktop, SSH replacement, or peer discovery. (2026-08-05 amendment: this
  non-goal also read "or a new encryption protocol". The relay payload encryption layer of
  `relay-e2ee-protocol.md` has since shipped; it was out of scope for this delivery, not forbidden
  to the product, and the atlas is expected to describe it.)
- Extending the frozen `apps/web` phone presentation tier.
- Copying private Hub source, private issue links, deployment identifiers, infrastructure policy, or
  qualification evidence into this public repository.

## Baseline and reconciliation

Pull request 243 already provides:

- desktop-owned `hubConnectorEnabled` and `hubOrigin` launch settings;
- a bootstrap channel from Electron main to the desktop-scoped server;
- local Hub status, identity-summary, enrollment, resume, cancellation, and leave routes;
- a desktop Hub settings section with origin validation and restart semantics;
- browser coverage for the primary settings states.

The current `main` branch additionally provides:

- `--hub-connector-enabled` and canonical `--no-hub-connector-enabled`;
- `--hub-origin <origin>`;
- `--hub-allow-file-secret-store` and canonical
  `--no-hub-allow-file-secret-store`;
- explicit CLI-over-environment precedence;
- protocol 1.2 multi-frame RPC messages within bounded relay frames;
- stricter hosted connection ownership, environment identity, and mutation readiness;
- `--restrict-to-cwd`, which remains separate from Hub configuration.

The branch will adopt those current contracts rather than recreate them. Where pull request 243
adds a desktop bootstrap source that `main` did not know about, the final resolver will keep CLI
flags first, environment second, and bootstrap third.

## Desktop launch configuration

### Contract

`DesktopHubLaunchConfig` will contain:

```ts
interface DesktopHubLaunchConfig {
  readonly enabled: boolean;
  readonly origin: string | null;
  readonly allowFileSecretStore: boolean;
  readonly fileSecretStoreFallbackSupported: boolean;
}
```

`setHubLaunchConfig` will accept optional `enabled`, `origin`, and `allowFileSecretStore` fields.
`fileSecretStoreFallbackSupported` is informational and cannot be written by the renderer.

The persisted desktop settings add `hubAllowFileSecretStore`, defaulting to `false`. Legacy
settings files read as `false`. Corrupt settings retain the existing fail-safe behavior and are not
silently overwritten.

Electron main validates every write. The file fallback can be enabled only on a supported POSIX
host. Windows reports it as unsupported and rejects a forged renderer request to enable it.
Changing any launch setting persists it atomically and relaunches the app. No Hub origin or secret
path is written to logs, diagnostics, telemetry, or support bundles.

The desktop bootstrap envelope adds `hubAllowFileSecretStore`. `backendChildEnv()` removes:

- `RYCO_HUB_CONNECTOR_ENABLED`;
- `RYCO_HUB_ORIGIN`;
- `RYCO_HUB_ALLOW_FILE_SECRET_STORE`.

The server resolver applies CLI flag, environment, then bootstrap precedence independently to all
three values. Reconnect settings remain environment-only advanced server configuration.

### Protected-store affinity

The file fallback switch grants permission to use the existing hardened permissioned-file store
when the OS credential store is unavailable. It does not force file storage and does not migrate
keys. A fresh identity still prefers the OS credential store.

The local identity state will persist a bounded, non-secret custody class immediately before the
first Hub secret create:

```text
os | permissioned-file
```

The marker is not a key identifier, path, or credential. It is cleared only when `leave` completes
and resets the local Hub identity. On restart:

- an `os` identity must reopen the OS credential store and never fall through to files;
- a `permissioned-file` identity must reopen the permissioned-file store and requires the explicit
  fallback permission to remain enabled;
- unavailable, corrupt, ambiguous, or split custody fails closed as
  `identity_store_unavailable`;
- a node never creates a replacement signing key automatically.

Legacy identity state without a custody marker is migrated by inspecting only the protected entry
names already referenced by local state. Exactly one eligible store must contain the required
identity material. The runtime binds that custody class before continuing. Material found in both
stores, split between stores, or absent from every eligible store is an operator-action failure.
Secret values are never exported or compared.

The marker is committed before protected material is written, so a crash cannot create material in
one backend and later select another. If the create fails or the process stops before identity state
references the new entry, retries remain bound to the same backend. The marker uses the same
locked, atomic, fsynced state machinery as the rest of local identity state. Enrollment, rotation,
cancellation, teardown, and crash recovery preserve the existing two-store safety properties.

The desktop toggle is editable only while `HubIdentitySummary.enrolled` is `none`. It is disabled
for `pending` and `active`. The fail-safe `unknown` state permits only the recovery direction:
unchecked may be enabled on a supported host, while checked may not be disabled. A file-backed node
therefore cannot strand itself through the normal UI by turning off access to its own key, and a
legacy file-backed node can restore permission after a failed start. CLI operators who remove the
flag from a file-backed identity receive the explicit store-unavailable status and can restore the
flag.

## Desktop Hub settings experience

### Default surface

The existing `Settings > Connections > Hub` section remains the everyday surface. It keeps:

- current connection state and stale-snapshot handling;
- enable, disable, enroll, cancel, open Hub, retry, restart, and leave actions;
- the full approval comparison ceremony;
- editable canonical Hub address while no identity exists;
- the explanation that user grants and roles are managed on the Hub.

The desktop remains a node identity, not a human Hub account. The panel never accepts a cookie,
DPoP key, relay ticket, node signing key, polling secret, or authorization token.

### Advanced disclosure

A full-width secondary button at the end of the section reads `Show advanced options`. It uses the
existing accessible `Collapsible` primitive, defaults closed on every panel mount, and changes to
`Hide advanced options` while open. A chevron rotates to communicate state. The trigger remains
reachable and understandable without motion.

The expanded panel contains four compact groups:

1. **Protected key fallback**
   - A switch labelled `Allow permissioned-file key storage`.
   - Supporting copy says Ryco still prefers the system credential store.
   - Enabling is an explicit opt-in for POSIX machines where the system store is unavailable.
   - The change requires an app restart.
   - Windows shows an unavailable state and does not render an actionable switch.
   - An enrolled or pending identity shows the configured value read-only with a note that leaving
     the Hub is required before changing key custody permission.
   - An unknown identity may enable a currently disabled fallback as a recovery action, but may not
     disable an already enabled fallback.

2. **Who owns startup**
   - The desktop app owns these values for its bundled server and restarts that server to apply
     them.
   - Exported Hub environment variables do not override the desktop panel.
   - The Hub address remains excluded from ordinary server settings and diagnostics.

3. **CLI equivalents**
   - A small monospace command recipe shows:

     ```sh
     ryco serve \
       --hub-connector-enabled \
       --hub-origin https://staging.ryco.space
     ```

   - A second line adds `--hub-allow-file-secret-store` as an explicit optional flag.
   - Copy explains the `--no-...` boolean forms and flag-over-environment precedence.
   - The recipe is documentation, not a second configuration path for the desktop child.
   - `--restrict-to-cwd` appears only in a separate CLI node safety note and is clearly described
     as workspace confinement.

4. **Relay diagnostics and guide**
   - Current protocol version while online, active channel count, queued byte count, retry attempt,
     and next retry time are derived only from the existing bounded status contract.
   - No URL, key, ticket, user, project, path, payload, or remote response text is added.
   - `Open relay architecture guide` opens the bundled standalone HTML in the system browser.

The advanced panel uses normal settings rows rather than nested cards. It has one subtle border and
background boundary, no gradient, no decorative dot field, and no duplicated Hub heading.

### Loading, saving, and errors

Launch configuration and runtime status load independently. The advanced trigger may render while
status loads, but controls that depend on identity remain disabled until the identity snapshot is
known. Failure to read launch configuration produces a local settings error instead of silently
rendering defaults.

Saving the fallback setting follows the existing native relaunch path. The renderer does not
optimistically claim the setting took effect. If validation or persistence fails, the current app
continues running and the panel displays a bounded local error.

The existing status poll remains authoritative for runtime state. A stale snapshot never displays
as a current connected state.

## Relay architecture atlas

### Artifact and packaging

`docs/relay-architecture.html` is the single source artifact. It contains all CSS, JavaScript, and
SVG inline and has no runtime dependencies, external fonts, analytics, network fetches, or build
requirement. It works when opened directly with `file://`.

The web package imports the document as a Vite `?url` asset for the desktop guide action. This emits
the same source file into the built static assets without maintaining a duplicate copy. The normal
web application does not add a route or extend its phone UI.

### Visual direction

The page uses Ryco's dark technical-editorial direction:

- graphite background with near-black structural surfaces;
- acid-lime as the single primary accent;
- warm white foreground and restrained grey secondary text;
- system sans and monospace stacks for offline reliability;
- 14-pixel section radii and 9-pixel control radii;
- thin borders, large type contrast, and generous section spacing;
- no gradients, glass effects, excessive pills, decorative dots, or scroll hijacking.

Motion is limited to topology path pulses, selected-state transitions, and small diagram changes.
`prefers-reduced-motion` removes all nonessential motion. The hero and primary topology fit on a
small laptop viewport without hiding the page's purpose below the fold.

### Page structure

The page is a hybrid atlas rather than a long linear article:

1. **Hero and topology**
   - A concise title and trust statement.
   - One topology diagram with clients above, the Hub in the middle, and nodes below.
   - Outbound arrows show who initiates network connections.
   - A persistent legend distinguishes control metadata, transient relay bytes, and node-owned
     application state.

2. **Actor lens**
   - Keyboard-accessible actor selectors update one detail panel.
   - Each actor view states what it is, what it can do, what it cannot do, how it authenticates,
     what it stores, and which connections it initiates.

3. **Workflow lens**
   - `Enroll`, `Connect`, and `Recover` tabs reuse the same topology.
   - Selecting a step highlights the active actors and path, updates the step explanation, and keeps
     the whole system visible for context.

4. **Role and capability lens**
   - A viewer, operator, and owner comparison.
   - An explicit node-grant rule.
   - A capability matrix for projects, files, conversations, terminals, provider settings, Hub
     grants, and machine enrollment.

5. **Persistence and trust boundary**
   - A three-column comparison of client, Hub, and node persistence.
   - A direct, tier-split statement of what payload encryption is worth (2026-08-05 amendment):
     relay WebSockets are transport-encrypted, and on a channel that negotiated payload encryption
     the Hub forwards ciphertext; the signed mobile tier reaches the stronger guarantee on channels
     resolved to an owner-verified pin, while the browser tier's ceiling is structural because the
     page pins no node identity and the Hub serves its code.
   - A direct statement that the Hub may observe transiently forwarded bytes — readable on a
     channel that negotiated no encryption — but does not persist or log relay payloads, and that
     the metadata of `relay-e2ee-protocol.md` §2.5 stays visible on every channel either way.

6. **Failure and recovery**
   - Client suspension and reconnect.
   - Node or Hub transport interruption.
   - Revocation and stale-generation rejection.
   - Large logical RPC messages split into bounded relay frames and reassembled only inside their
     channel.

7. **Configuration**
   - Desktop launch controls and restart behavior.
   - CLI flags and equivalent environment variables.
   - The separate role of `--restrict-to-cwd`.
   - A final checklist for choosing hosted versus self-hosted Hub deployment.

### Actors and relationships

#### Hosted web at `staging.ryco.space`

This is a browser or installed PWA client served by a Ryco Hub instance. It authenticates the human
with an HttpOnly same-origin session cookie. It can list explicitly granted nodes, request a
single-use relay ticket, open an authorized client relay channel, and perform actions within the
effective role.

It cannot connect to arbitrary addresses through the Hub, bypass a node grant, reuse a relay
ticket, retain mutation authority after its hosted session becomes stale, or become a node.

#### Native Ryco mobile app

This is the intended phone experience. It authenticates through a system-browser handoff and uses a
DPoP-bound native session. It consumes the shared client runtime and follows the same directory,
relay, snapshot, role, and mutation-readiness policy as the web and desktop clients.

It cannot fork authentication or lifecycle policy into a second mobile implementation, bypass
grants, or use a stale relay generation for mutations.

#### Ryco Hub instance

The Hub may be the hosted staging instance or a self-hosted deployment. It authenticates humans and
nodes, owns the authorized node directory, explicit grants, role ceilings, short-lived single-use
tickets, and bounded transient relay routing.

The Hub cannot run coding agents, own workspaces, become the source of truth for conversations,
persist relay payloads, turn a machine key into a human account, or provide a generic tunnel.

#### Ryco GUI node

The desktop app plus its local server is an execution node and a local client surface. Electron
main owns the bundled server's Hub launch configuration. The node enrolls a local Ed25519 key,
proves its identity, keeps one outbound relay connection, evaluates authorized logical channels,
and serves existing Ryco RPC behavior from node-owned state.

It cannot approve its own enrollment, assign human grants, grant a role above the Hub decision,
move execution state to the Hub, or expose arbitrary network forwarding.

#### Ryco CLI node

`ryco serve` is the headless form of the same execution node. Flags override environment values.
It uses local `ryco hub` control commands for enrollment and lifecycle operations and may apply
`--restrict-to-cwd` to constrain workspace discovery independently of relay configuration.

It has the same node authority and limitations as the GUI node. The CLI does not become a Hub
administrator and its signing key is not a human credential.

### Workflows

#### Enroll

1. The operator configures an exact Hub origin and enables the connector.
2. The node creates a local Ed25519 identity in protected custody.
3. The node requests a bounded enrollment ceremony and displays the device code, fingerprint,
   label, platform, version, algorithm, and expiry.
4. A signed-in owner opens the Hub approval surface and compares every displayed field.
5. Approval binds the stable node record and explicit owner grant.
6. The node removes polling custody and begins its authenticated outbound relay connection.

The device code routes the request but does not prove the machine. A fingerprint mismatch means the
request must be denied and cancelled.

#### Connect

1. The human signs in to the hosted web client or native mobile app.
2. The client lists only nodes with an explicit grant and selects one.
3. The Hub issues a short-lived, single-use relay ticket for that node and role.
4. The client opens its outbound relay WebSocket and the node already owns its outbound relay
   WebSocket.
5. The Hub binds one logical channel and forwards bounded opaque frames in memory.
6. Effective authority is the lower of the account role and explicit node grant.
7. The node supplies the current shell snapshot or replay before mutation capability becomes
   available.

#### Recover

For a suspended or reconnected hosted client:

1. Revalidate the human session.
2. Re-read the authorized node directory.
3. Request a fresh single-use ticket.
4. Create a fresh relay attempt.
5. Accept a current shell snapshot.
6. Only then publish readiness and mutation authority.

For a node or Hub transport interruption, the node keeps all work locally, discards the old
connection generation, obtains a fresh proof challenge, and reconnects through bounded backoff.
Revocation closes affected access and prevents new tickets. Stale generations cannot publish
readiness, role, snapshots, or mutation authority.

### Roles and terminal boundary

Every human needs an explicit grant to the selected node. The effective role is the lower of the
account role and node grant:

- `viewer` reads authorized state;
- `operator` may change workspaces and use terminals;
- `owner` additionally reaches owner-classified settings and credentials.

Owner status does not bypass an absent node grant.

The page must state plainly that a terminal is code execution on the node, not a Hub sandbox.
A relayed operator allowed to use a terminal may reach files and node-local commands with the
operating-system authority of the Ryco process. Hub roles classify application operations; they do
not provide operating-system isolation.

### Interaction and accessibility

- All actor selectors and workflow controls are native buttons with `aria-pressed` or tab semantics.
- Focus order follows visual order and focus indicators meet contrast requirements.
- Diagram meaning is also present as text, so SVG paths are not the only explanation.
- Color is never the only state signal.
- Actor and workflow selection works with keyboard, pointer, and touch.
- The URL gains no sensitive query or fragment state.
- At narrow widths, topology becomes a vertical client to Hub to node sequence, matrices become
  horizontally scrollable with labelled edges, and tap targets remain at least 44 pixels.
- JavaScript failure leaves all essential explanatory text visible.

## Testing

### Focused unit and contract coverage

- Desktop settings default and migration for `hubAllowFileSecretStore`.
- POSIX support reporting and Windows rejection in Electron main.
- IPC input validation and relaunch behavior.
- Bootstrap serialization includes the fallback permission.
- The desktop child environment strips all three owned Hub variables.
- CLI flag over environment over bootstrap precedence for each Hub launch value.
- Canonical `--no-...` boolean behavior remains intact.
- Protected-store affinity binds on first secret creation, survives restart, and resets on leave.
- OS identities never silently fall through to files.
- File identities never silently switch to an available OS store.
- Legacy identity migration handles OS, file, absent, split, and ambiguous material.
- Existing enrollment, rotation, teardown, and crash-recovery tests remain green.

### Web component and browser coverage

- Advanced options default closed and toggle accessibly.
- Fallback control states for supported, unsupported, loading, unenrolled, pending, active, and
  unknown identity.
- Saving confirms restart and sends only the requested bounded configuration.
- CLI recipe and diagnostics render without secrets or origins from runtime status.
- The bundled relay guide opens successfully.
- Existing Hub status, enrollment comparison, stale state, error, origin, and leave scenarios still
  pass.
- Settings layout remains usable at desktop and narrow responsive widths without extending the
  frozen web phone feature set.

### Standalone atlas coverage

- Open directly from disk and through the emitted Vite asset.
- No failed network requests or external runtime dependency.
- Actor and workflow controls operate by keyboard and pointer.
- Reduced-motion mode removes animated paths and transitions.
- Desktop, small laptop, tablet, and phone layouts preserve reading order and do not clip the
  topology or matrices.
- Automated browser checks assert the primary actor copy, three workflows, role ceiling, explicit
  grant rule, trusted-relay statement, terminal boundary, and hosted reconnect sequence.

### Repository gates

After focused tests, run the complete repository backstop:

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
bun run build:desktop
```

Install the pinned browser runtime first if it is absent. `release:smoke` is required only if
implementation changes the release workflow rather than ordinary desktop source or packaging.

## Completion boundary

The work is complete when the desktop panel exposes the current Hub launch controls with safe
restart and custody semantics, the standalone relay atlas accurately covers every actor and
workflow above, the HTML is bundled without duplication, browser QA finds no interaction or
responsive defects, and all required repository gates pass.
