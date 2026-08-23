# Unified cross-node workspace

Ryco presents work from every eligible machine as one workspace. Inbox, Projects, search, and new
work are workspace views; choosing a machine is not a prerequisite for using them. A machine stays
visible as the provenance and execution location of each physical project, worktree, and thread.

The Hub is not an aggregation service. Relay payload encryption keeps project and thread content
node-owned, so Mobile, Desktop, and hosted Web build the unified view from environment-scoped node
snapshots and their own metadata-only caches.

## Physical ownership and logical projects

Every physical resource is keyed by at least `(environmentId, resourceId)`. Two machines may use
the same project, worktree, or thread ID without colliding. Routes, subscriptions, leases, outbox
entries, and mutations keep that environment identity through to RPC.

Projects with the same unambiguous canonical repository identity may be grouped as one logical
project for presentation. Every physical copy remains visible and independently owns its path,
worktrees, threads, trust, role, presence, and connection state. Repository identity ambiguity
keeps copies separate. A logical project key or repository identity is never an RPC target.

Opening an existing thread navigates directly to its owning machine. Ryco may render cached metadata
while it acquires that environment; it never silently sends an existing thread mutation to a
different copy of the repository.

## New work

New work chooses an eligible physical copy automatically. The ranking is deterministic:

1. the user's explicit pre-send override;
2. the most recently used eligible copy;
3. the local Desktop copy when otherwise tied; and
4. stable environment ordering.

The chosen machine is visible beside provider and model before the first send. Changing it preserves
the authored prompt, attachments, provider, model, and interaction settings. After the first send,
the created thread remains owned by that machine. If no online, authorized, eligible copy exists,
Ryco keeps the draft and reports **No verified machine available** instead of guessing.

## Demand-driven connections

Cached lists do not connect to machines. Mounted work retains only the live streams it consumes:

- thread detail;
- VCS status; and
- provider status.

Those scopes are refcounted and released on unmount. Mobile and Desktop use the assessed absolute
limit of three concurrent environments. Hosted Web uses a lower qualified limit of one because a
browser can also carry the sustained full-PNG simulator fallback. Demand beyond the platform limit
waits; retained work is not evicted and the limit is never exceeded.

LRU recency may keep an unretained connection warm until capacity is needed. Backgrounding a native
client, or hiding hosted Web, releases non-retained connections. Foreground or visibility recovery
restores retained demand only and staggers reconnects; there is no reconnect-all-cached-machines
path.

## Cache and failure behavior

The client cache contains bounded workspace metadata only: project, worktree, thread-shell, and
status summaries. It never stores messages, provider events, terminals, files, attachments,
screenshots, detailed diffs, credentials, or secrets. A cache namespace includes Hub origin,
account, and environment. Only a complete settled snapshot replaces cached state.

Failures stay with their owning environment:

- an offline machine marks only its rows stale or unavailable;
- a failed acquisition does not create a workspace-wide disconnected state;
- delivery uncertainty is recorded per environment and row;
- revocation, removal, or loss of eligibility releases that machine's demand and applies its cache
  purge or lock policy;
- an identity conflict locks the affected history until explicit re-verification; and
- ambiguous repository identity leaves physical projects separate.

## Security tiers

Eligibility is client-tier specific and never inferred from presence alone.

| Client     | Machine identity and workspace policy                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile     | Native account credentials and signed native relay identity. Each machine is verified or re-verified independently; unknown, unverified, conflicted, revoked, or unauthorized machines cannot contribute normal workspace metadata or mutation authority.         |
| Desktop    | The Desktop client identity and a colocated node identity are separate principals. Native Hub trust, credentials, keys, tickets, proofs, and handshake material remain in the Desktop main process; the renderer receives opaque handles and bounded projections. |
| Hosted Web | The browser uses the unsigned ephemeral relay tier. It never labels itself natively verified. Machines that require a native client stay locked with **Open in Desktop/Mobile** and contribute no private workspace metadata.                                     |

Viewer, Operator, and Owner remain independent from trust and reachability. A connected Viewer can
read only what its role allows; an online but unverified native machine is still ineligible.

## Navigation and administration

Mobile uses the cross-node Inbox and Projects views. Desktop and Web offer full-height Inbox and
Projects sidebar modes over the same workspace projection. Changing modes or applying a machine
filter changes presentation only; it does not reconnect, refetch, or retarget mutations.

Machines is an administration surface. It can verify an exact machine, inspect identity and channel
security, retry a connection, or perform role-appropriate account actions. There is no global
selected-machine application mode.

For the browser-specific authentication, transport, and encryption boundary, see
[Hosted Hub client](./hosted-hub-client.md). For the native delivery ledger and remaining unrelated
mobile slices, see [Native mobile delivery status](./mobile-native-status.md).
