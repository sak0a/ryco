# Hub Node Naming

**Status:** Approved design

**Date:** 2026-07-29

## Summary

Ryco will give every Hub-enrolled execution node a useful, stable display name without changing
the identifiers used for routing or authorization. A node that has no operator-supplied name will
propose a label such as `Laurin's MacBook · 7K2F`, where the short tag is derived from that Ryco
environment's persistent identifier. Two Ryco nodes on one physical machine therefore receive
different default labels when they use different state directories.

Desktop and headless startup configuration control only the label proposed by a new enrollment.
After approval, the Hub's stored label is canonical. A Hub owner can rename an enrolled node from
the hosted node-detail surface; a node, viewer, or operator cannot rename it.

This is a display-name feature. Node IDs, environment IDs, signing keys, grants, relay tickets,
connection routing, and mutation authority remain unchanged.

## Problem

`ServerEnvironment` currently resolves a friendly machine label from the operating system and the
Hub connector sends that label in enrollment metadata. Separate Ryco nodes on the same device have
different persistent environment IDs and identity keys, but normally report the same friendly
machine label. The Hub directory can therefore show multiple indistinguishable rows even though
their security identities are distinct.

The Hub persistence and owner service already treat `nodes.label` as mutable metadata and expose
the owner-authenticated `POST /api/admin/nodes/:nodeId/rename` route. The public hosted client does
not currently call that route, and its node-detail sheet has no rename control.

A client-local alias would solve the problem on only one surface and could disagree between web,
desktop, and mobile. Allowing a node to rename itself after enrollment would also broaden the
current authority model: a compromised node could change the owner-visible inventory label. The
design instead keeps one Hub-owned label after enrollment.

## Goals

- Make automatically proposed labels distinguish separate Ryco nodes on the same machine.
- Let a Desktop user choose a name before enrollment.
- Let a headless operator choose the same value through startup configuration.
- Let a Hub owner rename an enrolled node from the hosted directory.
- Show one canonical enrolled-node label consistently to hosted web and mobile consumers.
- Preserve current identity, authorization, relay, and reconnect behavior.

## Non-goals

- Renaming a physical operating-system machine or its hostname.
- Renaming direct, saved, or SSH execution-environment descriptors.
- Adding per-client aliases.
- Letting the enrolled node, a viewer, or an operator rename Hub inventory.
- Requiring Hub node labels to be globally unique.
- Migrating or silently renaming existing Hub records.
- Adding directory names, workspace paths, or `RYCO_HOME` paths to enrollment metadata.

## Considered approaches

### Hub-specific canonical label with a node-proposed initial value (selected)

Desktop or headless startup configuration supplies an optional enrollment label. When it is absent,
the server builds a stable disambiguated default. The Hub stores the approved value and owns later
renames. This matches the current authority boundary, keeps all hosted clients consistent, and does
not affect direct environment naming.

### Rename the general execution environment

Adding a configurable `ExecutionEnvironmentDescriptor.label` would also rename direct, saved, and
SSH connection surfaces. That is broader than the Hub inventory problem and would still leave the
post-enrollment Hub authority question unresolved. It is rejected for this change.

### Client-local aliases

Aliases in browser or desktop persistence would require independent synchronization and conflict
semantics. Mobile, web, and desktop could display different names for the same node, and approval
screens would still use the original enrollment label. This approach is rejected.

## Naming ownership and lifecycle

The name has two phases:

1. **Before approval:** the node proposes an enrollment label from explicit startup configuration
   or the automatic fallback.
2. **After approval:** the Hub's persisted `nodes.label` is canonical. Only a Hub owner can change
   it through the existing owner mutation.

The local configured value is not a synchronization source after approval. Restarting an enrolled
node, changing an environment variable, or modifying a desktop settings file cannot overwrite a
Hub rename. No node-authenticated rename route or relay frame will be added.

A pending enrollment keeps the exact label included when the ceremony began. Naming controls are
locked while identity state is `pending`, `active`, or `unknown`. To change a pending proposal, the
operator cancels the ceremony first. Leaving a Hub erases local identity but retains the configured
proposal; once local identity is confirmed absent, the operator may edit or clear it before a new
enrollment.

Existing Hub records retain their labels until an owner renames them. The automatic fallback is
applied only when constructing enrollment metadata for a ceremony that has not yet started.

## Automatic label resolution

The server will add one pure resolver for Hub enrollment labels. Its inputs are:

- the optional configured Hub node name;
- the existing friendly machine label;
- the Hub identity state's persistent `EnvironmentId`, which is the same value sent in enrollment.

Resolution follows these rules:

1. A supplied name is trimmed and must contain between 1 and 100 UTF-16 code units after trimming.
   A valid supplied name is used exactly and receives no automatic suffix.
2. Without a supplied name, the resolver derives a four-character uppercase Crockford Base32 tag
   from the first 20 bits of
   `SHA-256("ryco.hub-node-label.v1\0" + environmentId)`.
3. The automatic label is `<friendly machine label> · <tag>`.
4. The machine portion is trimmed and shortened as needed so the final label is at most 100 UTF-16
   code units. Truncation must not split a Unicode scalar. If no machine label is available, the
   existing `Ryco environment` fallback is used.

The tag is a human disambiguator, not an identifier or authorization input. A short-tag collision
does not merge nodes and cannot affect routing because the Hub-issued node ID and persistent
environment ID remain authoritative. An owner can rename either colliding display label.

The resolver belongs beside the Hub connector's enrollment-metadata construction rather than in
`ServerEnvironmentLabel`. The ordinary execution-environment label therefore keeps its current
semantics.

New pending-enrollment records persist the resolved label as bounded, non-secret ceremony
metadata. `HubIdentityRuntime.readPendingEnrollment` returns that persisted value, and
`HubConnector.readEnrollment` uses it rather than recomputing from current startup configuration.
The label is written in the initial pending record before the enrollment request is sent, so every
response, restart, and approval comparison refers to the same proposal.

For backward compatibility, a pending record created by an older Ryco version may have no stored
label. Such a record remains pollable and uses the pre-feature friendly machine label for display;
it does not adopt a newly configured name or automatic suffix. If that legacy reconstruction no
longer matches the Hub approval screen, the operator must cancel and begin a new ceremony. Active
records need no local-label migration because their canonical label already lives on the Hub.

Hub enrollment currently accepts labels through 100 characters while
`HubEnrollmentCeremonyDetail` permits 128. The public ceremony schema will be reduced to 100 so
startup validation, enrollment transport, approval display, and Hub persistence share one bound.

## Headless configuration

Headless startup adds:

| Surface                | Value                                      |
| ---------------------- | ------------------------------------------ |
| CLI flag               | `--hub-node-name <name>`                   |
| Environment variable   | `RYCO_HUB_NODE_NAME=<name>`                |
| Default when both omit | Automatic machine label plus stable suffix |

The value follows existing server precedence: explicit flag, then environment variable, then the
desktop bootstrap envelope. Supplying an empty, whitespace-only, or overlong flag/environment value
is a startup configuration error rather than a silent fallback. Omitting it selects the automatic
label.

Example:

```sh
ryco serve \
  --hub-connector-enabled \
  --hub-origin https://staging.ryco.space \
  --hub-node-name "MacBook · client-project"
```

`ryco hub enroll` continues to control the live server and uses the name fixed in that server's
startup configuration. It does not gain authority to rename an approved node.

## Desktop configuration and UX

The desktop-owned Hub launch configuration adds nullable `nodeName` state. `null` means automatic.
The Electron main process persists and validates it with the existing Hub launch settings, passes
it through the protected bootstrap pipe, and removes `RYCO_HUB_NODE_NAME` from the backend child
environment so a same-user exported variable cannot override the visible setting.

The Hub settings section adds a primary `Node name` row next to the existing Hub address controls:

- before enrollment, the input is editable;
- an empty saved input resets the value to automatic;
- the blank input uses an `Automatic: machine name · node code` placeholder;
- a changed value offers `Save and restart`, matching the Hub origin's launch ownership;
- pending, active, or unknown identity disables editing and explains that the name is managed on
  the Hub after enrollment; and
- the pending ceremony continues showing the exact proposed label for side-by-side approval.

The Desktop bridge extends `DesktopHubLaunchConfig` and `setHubLaunchConfig` with `nodeName`. The
Electron main process remains the validation boundary; the renderer cannot write the desktop
settings file directly.

The advanced CLI-equivalents example adds `--hub-node-name`, while preserving the existing
explanation that Desktop owns its bundled server's launch values.

## Hosted Hub rename UX

`HostedHubApi` adds an owner mutation that sends
`POST /api/admin/nodes/:nodeId/rename` with `{ label }`, CSRF protection for browser sessions, and
the existing DPoP behavior for native sessions. It validates the node ID and trimmed 1–100
character label before sending and accepts only the bounded `{ ok: true }` response.

The hosted node-detail sheet receives the authenticated account role. For owners it provides a
`Rename` action:

- selecting it opens a focused dialog with the current label prefilled;
- Save is disabled for an unchanged or invalid label;
- success closes the dialog, refreshes the authorized node directory immediately, and retains the
  currently selected node by immutable node ID;
- failure keeps the dialog open and shows the bounded client error; and
- renaming remains available for offline or revoked inventory because it changes only owner-owned
  metadata.

Viewers and operators do not receive a disabled control; no rename affordance is rendered for
them. The server remains authoritative and still rejects unauthorized direct requests.

The private Hub service requires no behavior change because the owner-authenticated rename route,
transaction, persistence operation, and audit event already exist. Deployment pinning remains a
separate operation.

## Data flow

### New enrollment

1. Server startup resolves optional Hub node-name configuration.
2. `ServerEnvironment` resolves the existing friendly machine label, while local Hub identity
   state loads or creates the persistent Hub environment ID.
3. The Hub connector resolves the explicit or automatic enrollment label and commits it to the
   initial pending-enrollment record.
4. Enrollment start validates and sends that label with existing platform, version, public-key,
   and environment metadata.
5. The node and Hub approval surfaces read the same persisted ceremony label.
6. Approval persists the label on the Hub; later connector restarts do not update it.

### Owner rename

1. An owner opens a node detail sheet in the hosted directory.
2. The client validates and sends the rename mutation for the immutable node ID.
3. The Hub authenticates the owner, updates `nodes.label` transactionally, and writes the existing
   `node.renamed` audit event.
4. The client refreshes the directory and all node-label consumers render the new canonical value.
5. Active relay channels and selected-node routing remain attached to the unchanged node ID.

## Failure handling

- Invalid headless naming configuration fails startup with a bounded configuration error.
- Invalid Desktop input is rejected in the Electron main process and does not overwrite the last
  valid settings file.
- A failed desktop settings write does not restart Ryco.
- A failed Hub rename leaves the previous directory entry visible and the edit dialog recoverable.
- A directory refresh failure after a successful rename follows the existing stale-directory
  presentation; the next successful poll obtains the canonical label.
- Enrollment resumption reuses the persisted pending ceremony and never regenerates its label.
- No label, machine name, directory, environment ID, or Hub origin is added to connector status,
  diagnostics, telemetry, or support bundles by this change.

## Testing

Focused server tests will cover:

- deterministic automatic tags for fixed environment IDs;
- different environment IDs producing the expected different fixture tags;
- explicit-name precedence and trimming;
- Unicode-safe automatic-label truncation at 100 code units;
- CLI flag, environment, and desktop-bootstrap precedence;
- rejection of invalid supplied values;
- enrollment metadata using the resolved name; and
- new pending state persisting and retaining its original label across restart;
- migration with an absent persisted pending label; and
- legacy pending state retaining the pre-feature fallback without adopting new configuration.

Desktop tests will cover:

- settings migration with absent `nodeName`;
- persistence and reset-to-automatic behavior;
- main-process validation;
- child-environment removal and bootstrap propagation;
- editable versus locked identity states;
- save-and-restart behavior; and
- updated CLI-equivalent guidance.

Hosted client tests will cover:

- request path, payload, browser CSRF, native DPoP, response validation, and bounded failures;
- owner-only rename rendering;
- unchanged/invalid input behavior;
- successful rename with immediate directory refresh and stable selection by node ID;
- failure recovery; and
- desktop and phone sheet presentation.

Repository validation follows `AGENTS.md`:

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

The pinned Playwright runtime will be installed first if absent. No private Hub deployment,
credential, infrastructure identifier, or qualification evidence belongs in the public repository.

## Completion boundary

The public change is complete when a newly enrolled Desktop or CLI node receives either its
validated configured name or a stable disambiguated default, a Hub owner can rename it from the
hosted directory, non-owners cannot, existing records remain untouched, and all required public
validation gates pass.

Updating a private Hub deployment to consume the resulting public revision and performing live
multi-node enrollment qualification are separate operations.
