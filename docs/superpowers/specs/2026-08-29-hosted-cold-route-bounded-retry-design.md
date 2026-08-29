# Hosted Cold-Route Bounded Retry Design

## Status

Approved design for implementation.

## Problem

The hosted web client restores a node-scoped URL only after restoring the Hub session, refreshing
the authorized node directory, validating the routed node, and activating the existing hosted
session lifecycle. Today the route orchestrator treats an initial `presence.online === false`
snapshot as terminal for URL-driven restoration. It clears the node route and sends the user to the
node directory immediately.

Presence is intentionally refreshed on an interval and can briefly lag a live node. An already
selected workspace tolerates that gap through the relay reconnect path, but a cold load or deep link
does not. The result is inconsistent recovery: the same node can recover automatically in an open
workspace while a refreshed task URL is discarded.

## Goals

- Preserve an authorized cold or deep-linked node route across a transient offline presence
  snapshot.
- Give the existing hosted activation and synchronization lifecycle up to its existing 30-second
  deadline to recover.
- Keep authentication, authorization, revocation, compatibility, E2EE negotiation, shell snapshot,
  generation fencing, and mutation-readiness rules unchanged.
- Fall back to the node directory with the existing offline notice when a URL-originated attempt
  reaches the deadline and is still classified as offline.
- Preserve the existing behavior of an explicit interactive node selection.

## Non-goals

- Changing Hub presence semantics, heartbeat intervals, directory APIs, or relay close reasons.
- Adding another retry loop, retry timer, ticket owner, relay owner, or session owner.
- Allowing cached or live mutations before the current shell snapshot establishes readiness.
- Changing direct, saved-environment, desktop, or native-mobile reconnect policy.
- Changing terminal handling for revocation, authorization removal, incompatibility, or an invalid
  routed environment.

## Chosen Approach

Use the authoritative hosted session lifecycle for the bounded retry.

Once the route orchestrator has an authenticated account, a fresh authorized directory, a current
browser lifecycle, a matching environment, and a non-revoked compatible node, it may call
`hostedHubController.selectNode` even when the directory's presence snapshot says offline. The
controller already starts the 30-second session-synchronization deadline. Activation already owns
fresh relay tickets, reconnect policy, E2EE setup, shell synchronization, generation fencing, and
mutation readiness.

This is preferred to polling the directory because polling would introduce a second recovery loop
outside the lifecycle owner. It is preferred to a server-side presence grace because that would
weaken the meaning of `online` for every client rather than fixing URL restoration.

## State and Ownership

The route orchestrator already distinguishes URL-originated restoration from interactive selection:

- `restoreOriginNodeId` identifies a selection initiated by restoring the URL.
- `interactiveNodeId` identifies a selection initiated by an explicit user action.
- the hosted controller owns the lifecycle generation and synchronization deadline.

No new persisted state is required. The implementation uses those existing markers and store state:
`selectedNode`, `selectionStatus`, `transportStatus`, `sessionEstablished`, and `generation`.

## Data Flow

1. Restore the authenticated Hub session and refresh the authorized node directory.
2. Parse the node-scoped URL and reject malformed routes.
3. Validate that the node exists in the authorized directory, is not revoked, is compatible with
   the hosted web client, and owns the routed environment.
4. Wait until the browser lifecycle is current.
5. Select the routed node even if its current presence snapshot says offline. Mark the selection as
   URL-originated.
6. Let the existing activation path obtain a fresh one-use ticket, establish the relay/E2EE channel,
   and synchronize the current shell snapshot.
7. Until synchronization succeeds, render cached task data read-only when available; otherwise
   render the existing connection surface. Mutation authority remains unavailable.
8. On a current shell snapshot, clear the URL-origin marker and continue normally.
9. If the existing 30-second synchronization deadline produces a terminal failure while the
   URL-originated selection remains classified as offline, clear the route, tear down the selection,
   and show the existing offline notice in the node directory.

## Error Handling

Malformed, absent, revoked, authorization-removed, incompatible, or environment-mismatched targets
continue to fail closed immediately through their existing paths.

The 30-second directory fallback applies only when all of the following remain true:

- the attempt originated from URL restoration;
- the same routed node is still selected;
- no session snapshot established readiness;
- the transport reached terminal failure; and
- the selection is still classified as offline.

Other terminal failures remain on the existing detailed failure surface. This preserves actionable
diagnostics instead of relabeling every synchronization problem as offline. Interactive selections
also retain their existing failure surface and retry controls.

Back navigation, “Back to nodes,” sign-out, route replacement, revocation, and node switching use the
existing teardown paths. Generation fences prevent an abandoned attempt from publishing readiness,
role, snapshots, or mutation authority afterward.

## Presentation

No new page is required. Before selection, the existing “Restoring your node” surface remains valid.
After selection, the existing connecting surface is used and offers “Back to nodes.” A cached routed
thread may remain visible in read-only mode during synchronization. The directory uses its existing
offline notice if the bounded URL-originated attempt expires.

## Testing

Focused route-orchestrator tests must prove:

- an authorized offline deep link selects the node instead of clearing the route;
- the deep link remains unchanged while the existing synchronization deadline is pending;
- a shell-ready publication preserves the route and clears restoration ownership;
- a URL-originated offline terminal timeout returns to the directory with the offline notice;
- a non-offline terminal failure keeps the routed failure surface;
- an interactive offline selection retains its current behavior;
- Back during the pending attempt tears down the selection and prevents stale publication;
- forward re-entry does not inherit stale interactive intent;
- revoked, unauthorized, incompatible, malformed, and environment-mismatched routes remain
  immediately fail-closed.

The hosted browser suite must cover a cold node-scoped load with an initially offline directory
snapshot that becomes online before the deadline. It must verify that the exact thread route and
cached workspace state survive and that mutation controls remain disabled until synchronization.

Validation is proportional to the hosted lifecycle risk:

```sh
bun install --frozen-lockfile
bun run --cwd apps/web test src/hostedHub/nodeRouteOrchestrator.test.ts
bun run --cwd apps/web typecheck
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Before browser tests, install the repository-pinned Playwright runtime when it is not already
available.

## Release and Production Qualification

The public web change must merge with green repository CI. A hosted deployment must consume the
exact reviewed public commit through its existing immutable pinning process; changing only the
displayed client version is insufficient.

After deployment, qualify at least these flows against the hosted production origin:

- cold-load a known task while the first directory snapshot reports the node offline, then observe
  automatic recovery without losing the URL;
- confirm that cached content is read-only until the current shell snapshot arrives;
- confirm Files, Agents, Diffs, Review, checks, and source-control state reload after recovery;
- create and complete a read-only task with one subagent;
- confirm a genuinely offline URL falls back after the bounded deadline;
- confirm browser console diagnostics and Hub queue/connection health remain clean.

Deployment, backup, rollback, and private qualification records remain in the private Hub
repository. No private identifiers, credentials, infrastructure details, or production evidence
belong in this public design document.
