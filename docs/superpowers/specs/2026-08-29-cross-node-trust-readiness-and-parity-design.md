# Cross-node trust, readiness, and client-parity design

## Summary

Ryco's hosted workspace already has the core pieces for secure multi-node use: a Hub node directory,
node-scoped relay environments, native client keys, node identity pins, signed cross-device approval,
workspace metadata snapshots, and demand-driven connections. The remaining problems come from those
pieces being exposed through separate client-specific flows:

- native E2EE onboarding makes the user perform a long manual ceremony even when another trusted Ryco
  client can authorize the new device safely;
- a newly selected hosted node can be displayed before its current snapshot and mutation authority are
  ready, allowing a new-task action to retain the previous node as its target;
- the Desktop workspace client is present but is not connected to the primary Inbox, Projects, task,
  file, review, and source-control routes;
- provider notifications and settings surfaces do not consistently identify the node they belong to;
- the browser node popover repeats several paragraphs of security disclosure directly below the
  session code;
- `ryco hub status` does not print the enrollment fingerprint that the UI tells users to read there;
- the native mobile app can inspect tasks, files, and task diffs, but lacks the source-control and pull
  request operations available in the shared product.

This design treats these as one product boundary: every operation has an explicit node, every mutation
requires current authority for that node, trusted clients can authorize new clients with one signed QR
scan, and Web, Desktop, and mobile use the same runtime decisions while presenting platform-appropriate
UI.

## Goals

1. Make the normal native E2EE setup flow one approval plus one QR scan, followed by automatic
   reconnection. Fingerprint entry and the 60-bit safety number remain available only as recovery.
2. Prevent every cross-node mutation from using stale selection, stale snapshots, or authority derived
   for another environment.
3. Make hosted nodes first-class, actionable environments in the Desktop app's existing workspace UI.
4. Make settings and notifications explicitly browser-, device-, account-, or node-scoped.
5. Reduce the browser node popover to the session code, its current channel state, Copy, and a compact
   Security details link. Put the full disclosure in Settings -> Security.
6. Make the node identity fingerprint discoverable through `ryco hub status`.
7. Add native mobile source-control and pull-request parity for operations supported by the selected
   node.
8. Qualify the result against two live nodes in Web, Desktop, and mobile without mutating existing
   production repositories during testing.

## Non-goals

- Account login alone does not silently authorize a new native client key.
- The Hub does not store native client private keys, node private keys, safety numbers, approval
  payloads, repository content, or plaintext application payloads.
- The browser does not become a durable native identity tier. Its unsigned browser-channel security
  ceiling remains unchanged.
- Settings that are inherently local are not synchronized merely to make the UI appear uniform.
- The frozen phone presentation tier in `apps/web` is not extended; native mobile owns new phone UX.

## Approach selection

### Rejected: keep the manual ceremony and shorten its copy

This preserves the current security model but does not solve the setup problem. A user still copies a
fingerprint, compares twelve groups, approves the client separately, confirms again, and reconnects.

### Rejected: trust every client authenticated to the same Hub account

This is easy, but it converts account-session compromise into persistent node access. Native client
authorization is deliberately a second gate and must remain one.

### Selected: node-signed, client-bound, one-scan approval

An already trusted owner approves a pending client key and receives a short-lived node-signed QR
envelope bound to the exact Hub origin, account, node identity, client fingerprint, authority, nonce,
and expiry. The new device scans it, verifies it locally, stores the node pin, and reconnects using its
own private key. This uses the existing cross-device approval protocol while removing redundant manual
steps from the default UX.

## Architecture

### 1. Shared native trust onboarding state machine

`packages/client-runtime` owns a platform-neutral `NativeTrustOnboarding` state machine. Web does not
instantiate it as a native client. Desktop and mobile provide camera/QR, secure-key, deep-link, and
presentation adapters.

The public states are:

1. `idle`
2. `requesting-approval`
3. `waiting-for-approval`
4. `approval-ready`
5. `scanning`
6. `verifying`
7. `reconnecting`
8. `ready`
9. `recovery-required`
10. `failed`

The default user flow is:

1. The new client selects an unverified node and chooses **Verify this device**.
2. The runtime publishes a bounded pending-client request for its existing hardware-backed client key.
3. An already authorized owner sees the device label, platform, requested role, and creation time,
   chooses the granted role, and selects **Approve**.
4. The node durably records the exact client authorization before signing the approval envelope.
5. The owner-facing client displays one QR code. The new client scans it once.
6. The new client validates the envelope, pins the node identity, confirms that the attested client
   fingerprint equals its own key, and reconnects.
7. The first successful IK channel advances the flow to `ready`. The UI does not require a second
   checkbox or confirmation.

The QR expires after five minutes, is single-client and single-node, and grants no access without the
new device's private key. Replays may re-establish only the already approved client's authority; they
cannot authorize a different key.

If no trusted owner client is available, **Use recovery setup** exposes the existing fingerprint and
safety-number ceremony. Recovery continues to compare all groups and never auto-accepts advertised
identity. The normal flow never asks the user to type a fingerprint.

Desktop-local trusted introduction remains zero-scan for the Desktop app and its colocated node,
because the authenticated loopback control plane already proves that relationship. It cannot be used
to trust a remote node.

### 2. Node-scoped mutation readiness

The client runtime introduces an immutable `NodeMutationLease`:

```ts
interface NodeMutationLease {
  readonly environmentId: EnvironmentId;
  readonly selectionGeneration: number;
  readonly snapshotGeneration: number;
  readonly effectiveRole: HostedRole;
  readonly directoryReady: true;
  readonly relayReady: true;
  readonly shellReady: true;
}
```

The lease is derived only by the authoritative hosted lifecycle owner after the selected node has:

- a current account session;
- a current directory record and permitted directory scope;
- a fresh relay generation;
- a current node shell/workspace snapshot;
- an effective role that permits the requested operation.

Changing node, account, Hub origin, relay generation, directory authorization, role, node identity,
or shell snapshot invalidates the lease synchronously. Stale generations cannot publish a lease.

All mutation entry points accept the target environment and obtain a lease at action time. New Task,
new project, settings writes, file writes, terminal commands, Git mutations, PR mutations, task
attention changes, provider actions, and credential changes fail closed when the lease does not match
the visible target. Navigation may show cached read-only content while reconnecting, but mutation
controls remain disabled with a concise **Connecting to <node>...** status.

New-task drafts store an explicit target selected from the current workspace index. They never inherit
the primary or previously active environment. When a node selection changes, an unsent empty draft is
retargeted only after the new lease is ready; a non-empty draft keeps its visible target and requires an
explicit user choice to move.

### 3. Desktop unified workspace integration

The existing `DesktopWorkspaceClient` remains the Desktop-native owner of Hub identity, trust pins,
metadata cache, demand leases, and relay connection limits. The Electron bridge exposes typed,
environment-scoped operations for:

- catalog refresh and workspace snapshot subscription;
- verification request and approval-envelope consumption;
- retain, renew, and release connection scopes;
- connection state and errors;
- environment activation for shared application routes.

`apps/web`, when hosted inside Desktop, merges Desktop workspace snapshots with the colocated backend
through the same unified workspace index used by hosted Web and mobile. Inbox, Projects, task routes,
Files, Review, Agents, settings, and source control resolve their APIs by the row's environment ID.

Workspace machine rows become actionable:

- **Verify** starts the one-scan or recovery flow;
- **Connect** retains an explicit interactive demand scope;
- **Open** selects the environment after connection readiness;
- **Disconnect** releases explicit scopes while retaining safe cached metadata.

Automatic metadata demand may connect up to the shared runtime limit. Interactive task/file/review
scopes outrank background metadata. A directory refresh failure preserves the last safe catalog and
labels it stale; it does not remove a currently valid local environment or sign the user out.

### 4. Settings ownership

Every settings section declares one of four scopes in the settings registry:

- `browser`: theme, density, and other browser-local presentation state;
- `device`: Desktop/mobile client preferences and local secure-key state;
- `account`: Hub account security and account-wide identity metadata;
- `node`: providers, credentials, provider update checks, Git/source-control integrations, server
  policy, diagnostics, terminals, and node authorization.

The settings header renders the scope. Node-scoped pages show **Node: <label>** and require a current
mutation lease for writes. The route includes the environment ID; it does not read a global primary
environment implicitly. When a node disconnects, values may remain visible from the last snapshot but
controls become read-only until a fresh lease arrives.

### 5. Notification provenance

Provider updates and node-originated errors use a shared origin descriptor:

```ts
interface EnvironmentNotificationOrigin {
  readonly environmentId: EnvironmentId;
  readonly nodeLabel: string;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly providerLabel?: string;
}
```

Notification text includes the node and, where relevant, provider. Dedupe keys include environment,
provider instance, event kind, and version or stable error fingerprint. Seen-state is never shared
between two environments accidentally.

Selecting an action first selects the notification's environment, waits for current read or mutation
readiness as appropriate, and then opens the destination. If the node is offline, the UI opens cached
read-only context and explains that the action will become available after reconnecting.

### 6. Browser node popover and security disclosure

The node popover shows:

- active node label and connection state;
- **Browser encrypted**, **Connecting**, or **Plaintext fallback** status;
- the session code and Copy action when available;
- a compact **Security details** link.

No explanatory paragraphs render beneath the code. The complete browser-channel limitations remain in
Settings -> Security and in the protocol documentation. The compact status must not claim that a
browser channel pins node identity or protects against a malicious Hub operator. Plaintext fallback
continues to use an explicit warning state.

The verification view model separates required state from placement copy so the node-menu placement
can intentionally return no prose while the Settings placement returns the full disclosure. Tests
assert both placements rather than scanning every surface for identical paragraphs.

### 7. Hub status fingerprint

The Hub identity runtime exposes a bounded public status descriptor containing the active node's
formatted identity fingerprint. `ryco hub status` prints `Fingerprint: SHA256:...`; JSON adds a
validated `fingerprint` field. It never returns raw public keys, private keys, protected-store names,
local paths, enrollment polling secrets, or internal identifiers.

The value is available whenever an active node identity exists, not only during enrollment. The
Desktop Security page and recovery instructions use the same descriptor.

### 8. Native mobile source control and PR operations

Mobile adds a Source Control route scoped by environment, project, and worktree. It consumes existing
server contracts and shared client-runtime state rather than introducing a second Git implementation.

The first parity set includes:

- working-tree status and refresh;
- staged/unstaged file lists and diffs;
- stage, unstage, discard with confirmation, and commit;
- branch list, checkout, create, fetch, pull, and push;
- ahead/behind and upstream state;
- pull-request metadata, review/check status, and open-in-browser;
- create/update PR when the selected source-control provider supports it.

Read operations require current read readiness. Mutations require a matching `NodeMutationLease` and
preserve existing server-side preconditions. Destructive operations retain their existing explicit
confirmation requirements. Offline cached views never expose enabled mutation controls.

## Error handling and recovery

- Approval expiry returns to `waiting-for-approval` with **Request a new code**; it never silently
  falls back to manual trust.
- A QR for another client, node, account, Hub origin, or expired request fails locally without changing
  pins or authorization.
- An approved client whose first reconnect fails remains approved; retry creates a fresh relay attempt
  without repeating the ceremony.
- Node identity conflict locks mutation and offers only inspect, forget, or recovery verification.
- Selection changes cancel pending readiness work for the old generation.
- Desktop catalog, notification, and settings failures are environment-scoped and cannot poison other
  connected nodes.
- Source-control mutations surface server precondition failures and refresh before another attempt.

## Migration and compatibility

- Existing approved native client records and node pins continue to work unchanged.
- Existing manual pairing remains wire-compatible and moves behind the recovery action.
- Cross-device approval uses the current versioned signed envelope. Any additional authority field is
  added through a new version rather than changing v1 verification semantics.
- Browser relay protocol and cipher negotiation do not change.
- Desktop workspace cache schema changes, if required, use a new namespace version and discard stale
  incompatible entries rather than interpreting them loosely.

## Delivery sequence

The work lands in four reviewable waves while preserving this document's single acceptance boundary:

1. **Trust and identity:** shared one-scan onboarding, recovery UX, and Hub status fingerprint.
2. **Readiness and provenance:** mutation leases, new-task targeting, settings scope, notifications, and
   the compact browser node menu.
3. **Desktop parity:** Electron bridge integration and unified remote-node workspace routes.
4. **Mobile parity and qualification:** native source control/PR surfaces followed by the complete
   two-node, three-client validation.

Each wave must keep existing approved clients and direct/local environments working. The final goal is
not considered complete until all four waves and the end-to-end acceptance criteria pass.

## Testing strategy

### Unit and contract tests

- onboarding transition table, expiry, replay, wrong-client/node/account/origin rejection, and recovery;
- lease creation/invalidation for every generation and authority input;
- new-task targeting across rapid node switches;
- settings scope registry and node-bound writes;
- notification dedupe and navigation across two environments;
- Desktop catalog reconciliation, verification, connection demand, snapshot routing, and stale cache;
- browser node-menu zero-prose placement and full Settings disclosure;
- human and JSON Hub status fingerprint output and redaction bounds;
- mobile source-control read/mutation guards and provider capability handling.

### Package and integration checks

- focused `packages/client-runtime`, server, web, Desktop, and mobile tests;
- TypeScript and formatting checks for affected packages;
- web build and browser suite because hosted lifecycle and mutation readiness are high-risk;
- Desktop build because the Electron bridge and remote routing change;
- mobile iOS build and native test suite.

### End-to-end qualification

Using one isolated disposable node and one production node kept read-only:

1. Chrome selects both nodes, creates a task only on the isolated node, and verifies Files, Review,
   Agents, settings provenance, notification provenance, Git, and PR/check surfaces.
2. A rapid select-then-New-Task attempt cannot target the previous node.
3. Desktop discovers, verifies, connects, opens, and operates both nodes through the unified routes.
4. Mobile completes the one-scan ceremony, creates a task on the isolated node, and exercises native
   source-control and PR views.
5. Mobile opens production projects, files, diffs, Git, and PR/check state read-only.
6. Browser node menus contain no long disclosure beneath the session code; Settings -> Security retains
   the complete explanation.
7. `ryco hub status` prints the same public fingerprint shown by the recovery UI.
8. Production repository status before and after qualification is identical.

## Acceptance criteria

- The default native trust flow contains one owner approval, one scan, and no manual fingerprint or
  safety-number entry.
- No mutation can execute with a lease for a different environment or stale generation.
- Desktop can operate an online verified remote Hub node from its standard workspace UI.
- Every node-scoped setting and notification identifies its node.
- Provider notification dedupe never crosses environments.
- The browser node menu renders no security paragraphs beneath the session code.
- `ryco hub status` returns the canonical active node fingerprint in human and JSON modes.
- Mobile supports the source-control and PR parity set above through existing node APIs.
- Focused automated checks and the three-client two-node qualification pass.
- No production project content or Git state is changed by qualification.
