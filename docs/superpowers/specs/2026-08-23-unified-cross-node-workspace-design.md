# Unified Cross-Node Workspace Design

Status: approved design for implementation planning.

## Objective

Ryco presents one workspace across every machine enrolled in the user's Hub account. Projects,
worktrees, threads, providers, and activity remain owned by the node where they run, but no primary
surface requires the user to select that node before finding or opening the work.

The product rule is:

> A machine is provenance and an execution location, not an application mode.

This design extends the native mobile node-provenance model in
`docs/superpowers/plans/2026-08-19-mobile-node-provenance-model.md` across the shared runtime,
Desktop, and hosted Web. It also replaces the remaining selected-node dependency in native
verification with an independent action for every machine.

## Decisions

1. The Hub stays blind to node-owned workspace content. Aggregation is client-side.
2. Desktop is dual-role: its local server remains a node, while its UI shell is a separate native
   Hub client.
3. Hosted Web offers the same unified navigation under its existing, explicitly weaker unsigned
   browser security tier.
4. Workspace visibility does not imply keeping every node connected. Metadata is cached locally,
   and live connections are demand-driven and bounded.
5. Native Desktop and Mobile do not load a node's workspace content until that client has verified
   the node.
6. Copies of the same repository on different nodes form one logical project with explicit machine
   variants.
7. New work selects an execution node automatically and exposes a visible override before the first
   send.
8. Only workspace metadata persists locally. Full messages, files, terminals, attachments, and
   detailed VCS state remain node-owned and load on demand.
9. Pins, project folders, recency ordering, drafts, outbox state, and UI preferences remain
   device-local in the first release.
10. Desktop and Web gain an optional full-height Inbox sidebar. The complete current Projects
    sidebar remains a first-class mode.
11. Existing Desktop/Web profiles retain Projects as their sidebar default. Fresh profiles default
    to Inbox. The choice then persists locally.

## Non-goals

- Moving an existing thread or worktree between nodes.
- Synchronizing full conversation history for offline reading.
- Synchronizing drafts, outboxes, pins, project folders, or UI settings between clients.
- Making the Hub index, inspect, search, or persist project and thread metadata.
- Claiming native verification or active-Hub protection for ordinary hosted Web pages.
- Removing machine filters or machine administration.
- Changing provider context handoff semantics. Provider handoff remains within one node-owned
  thread.
- Automatically trusting a remote node on first contact.
- Remotely changing a node's local connector configuration through the Hub. Existing node-local
  administration boundaries remain authoritative.

## Trust and ownership model

### Node-owned authority

Nodes remain authoritative for:

- projects, repository identity, paths, worktrees, and VCS state;
- threads, messages, turns, approvals, inputs, and delivery state;
- provider availability, models, sessions, and runtime activity;
- terminals, files, attachments, and screenshots;
- node identity, native-client authorization records, and connector policy.

The Hub remains authoritative only for account identity, node directory membership, account roles,
presence, relay tickets, and opaque relay transport. It cannot aggregate workspace content because
end-to-end encrypted node payload is intentionally opaque to it.

### Native trust gate

On native Desktop and Mobile, an enrolled node that has not been verified is visible as a machine
needing verification, not as a source of workspace data. The client may run the bounded pairing
ceremony, but it releases no project, conversation, terminal, or provider payload until both the
client's node pin and the node's client-authorization record are durable.

If a previously verified node presents a conflicting identity, the client:

1. closes its channels to that environment;
2. releases its connection leases;
3. retains prior metadata only as locked stale history;
4. reports the identity conflict on that machine; and
5. requires explicit re-verification before live data or mutations resume.

It never silently adopts the new identity or treats a legacy fallback as equivalent to verified
native access.

### Hosted Web tier

Hosted Web consumes the same workspace projections, but it does not claim native verification. Its
unsigned ephemeral browser channel protects against passive and retroactive relay reading only
while the served code is honest; it cannot protect against the Hub operator that serves the page.
The existing disclosure vocabulary in `docs/hosted-hub-client.md` remains mandatory.

A node configured to require approved native clients is visible in Web as a locked machine. Web
shows no private cached metadata for that node and offers **Open in Desktop/Mobile**. Web never
labels its own channel as verified.

## Shared runtime architecture

`packages/client-runtime` owns a new Unified Workspace domain. UI packages consume its projections
and commands rather than reimplementing connection, trust, cache, or routing policy.

The domain is split into five units.

### 1. Machine catalog

The machine catalog combines the Hub node directory with client-local state. Each entry is keyed by
`EnvironmentId` and carries:

- directory identity and display label;
- presence and last-seen observation;
- effective account role;
- revocation state;
- platform and capability summary;
- client-tier eligibility;
- native trust state when the platform can hold native trust;
- per-environment connection and delivery state.

The catalog never substitutes a default for missing trust or role evidence. Unknown, unverified,
offline, and revoked are distinct states.

### 2. Workspace metadata index

The index projects the last complete metadata snapshot for every eligible environment into one
read model. Every physical record retains its `environmentId`; resource IDs are never treated as
globally unique.

The persisted snapshot contains only:

- project identity, name, repository identity, and display path;
- worktree summary and branch/work-item summary;
- thread title, state, timestamps, current provider/model identity, and delivery marker;
- node provenance, role, trust, freshness, and last-seen presentation data.

It excludes message bodies, provider events, files, terminals, attachments, screenshots, detailed
diffs, and secrets.

Snapshots are versioned, bounded per environment and in total, and applied only after a complete
projection settle. A live refresh atomically replaces the last complete snapshot; partial refreshes
never blank a previously usable list.

Cache namespaces include Hub origin, account id, and environment id. Revocation, node removal, or a
client-tier eligibility change that makes an environment inaccessible purges that environment.
Account sign-out purges the account namespace and its client session. Production service workers do
not participate in this cache and remain static-shell-only.

### 3. Logical projects

Physical projects are grouped when their canonical repository identity matches. A logical project
contains one or more physical variants, each retaining:

- environment id;
- physical project id;
- path and worktree availability;
- presence, trust, and effective role;
- last-used and last-live timestamps.

Repository identity ambiguity fails open into separate logical projects. Paths, display names, or
folder similarity alone never merge projects. Grouping changes presentation only; threads,
worktrees, and mutations remain physical and environment-scoped.

### 4. Connection demand controller

Mounted live work produces refcounted scope leases. Initial scope kinds are:

- thread detail;
- VCS status;
- provider status.

Lease reports renew before their TTL and release on unmount. Cached list rendering does not acquire
a connection.

The absolute named ceiling is three concurrent unified node connections, as qualified by
`docs/relay-capacity-assessment-3b.md`. A platform may use a lower qualified ceiling. Native Mobile
and Desktop may use three after their existing lease and lifecycle requirements pass. Hosted Web
does not raise its hosted concurrency until its screenshot-stream and transfer load are measured
and mitigated; it may begin at one while still presenting cached cross-node metadata.

When demand exceeds capacity:

1. retained active scopes win;
2. non-retained slots are ordered by LRU recency;
3. a requested environment displaces the least-recent non-retained connection;
4. when all three slots have retained scopes, a fourth acquisition waits visibly until a retained
   slot releases rather than evicting active work or exceeding the bound;
5. no retained scope is silently evicted; and
6. every queued acquisition remains cancellable.

Backgrounding releases non-retained connections. Foregrounding reconnects retained demand only and
stagger-starts those reconnects. There is no reconnect-all path.

### 5. Execution target resolver

New work in a logical project receives a physical execution target without a blocking machine
picker. Candidate variants must be verified or otherwise eligible for the client tier, authorized
for the requested mutation, and currently online.

Ranking is deterministic:

1. an explicit draft override;
2. the most recently used eligible variant;
3. the local Desktop variant when otherwise tied;
4. stable environment-id ordering as the final tie-breaker.

The selected machine appears beside provider and model before the first send. Changing it retargets
the draft and clears only physical state that belongs to the previous copy, such as a worktree path.
Once the thread starts, the thread remains owned by its selected node.

When no eligible physical variant is online, the draft retains its logical project but has no
execution target. The composer reports **No verified machine available** and does not assign an
offline node or fall back to a different project. It resolves again when presence, trust, role, or
an explicit override changes.

## Scoped command and routing invariant

Every cache key, route, lease, subscription, draft target, outbox entry, and mutation carries an
explicit `EnvironmentId`. The scoped key is at least `(environmentId, resourceId)`.

Logical project ids and repository identities are never valid mutation targets. UI commands resolve
to a physical scoped reference before they reach RPC. A missing, unavailable, or ambiguous physical
target disables the command instead of falling back to a primary or active environment.

No shared API may infer mutation authority from the currently rendered sidebar, a machine filter,
the last socket to publish status, or a process-global active environment.

## Per-client composition

### Mobile

Mobile keeps its existing cross-environment Inbox, project grouping, snapshot cache, scoped outbox,
and demand-driven hosted connections. It migrates remaining verification and administration flows
from a selected-node dependency to an explicit machine reference.

The Home surface adds a **Needs verification** section. Each item opens security for that exact
machine and can request approval independently. The Machines route remains the complete
administration surface.

### Desktop dual role

Desktop contains two isolated security principals:

- the existing local server process and its node identity; and
- a native client shell with its own device identity and Hub account session.

This supersedes only the earlier decision that the Desktop UI could never be a Hub account client.
It does not turn the local server process into a human account session.

Isolation requirements are:

- node identity keys never enter the renderer or client credential store;
- Hub account credentials and native client keys never enter the node process or provider
  subprocess environment;
- node and client state use separate storage namespaces;
- IPC exposes bounded commands and projections, not raw credentials or key material;
- signing out the client does not stop, leave, or unenroll the local node;
- leaving or disabling the local node's Hub connector does not sign out the client; and
- either plane may restart without adopting the other plane's authority.

The client shell uses the existing local-introduction protocol to establish trust with its
colocated node without a QR ceremony. Remote nodes retain explicit per-node verification.

### Hosted Web

Hosted Web uses the shared metadata index, logical projects, scoped routing, and connection demand
policy with a browser cache adapter. Browser cache data is account-namespaced and purged on sign-out;
it contains no secrets or full application documents.

The Web client keeps the unsigned browser security disclosure visible wherever the existing design
requires it. Native-only nodes remain locked, and their content is neither fetched nor fabricated.

## Product information architecture

### Home and Inbox

The default workspace scope is **All machines**. Inbox groups threads by urgency rather than node:

1. Active now;
2. Needs input;
3. Recent.

Every row shows provider identity plus quiet machine provenance. It adds role, delivery uncertainty,
offline/last-seen, or stale state only when relevant. No row-level control is a connection button.

Native Home displays **Needs verification** above normal work when at least one enrolled machine
requires verification. The section is actionable per machine and disappears as each machine is
verified. Web uses a locked/native-client-required treatment instead of claiming it can verify.

### Projects

Projects are logical repository rows. A row exposes its physical machine variants through a compact
variant list or menu. Threads and worktrees continue to display the machine that owns them.

### Thread and composer

Opening a thread navigates immediately using its scoped reference, renders cached metadata, and
acquires the owning environment. The machine is visible in the thread header and composer. Offline,
trust, role, or reconnect degradation is local to that thread.

The new-thread composer displays its automatic machine target beside provider and model. The user
may override it before the first send without losing prompt text, attachments, provider, model, or
effort selection.

Provider context handoff stays within the selected node-owned thread. Machine transfer of an active
thread is outside this design.

### Machines

Machines is administration, not primary navigation. Every row opens a detail route bound to that
machine. Available actions depend on role, client tier, reachability, and existing security
boundaries, and may include:

- verify or re-verify this machine;
- inspect identity and channel security;
- rename or revoke through authorized Hub account APIs;
- retry a client connection;
- inspect presence, role, capabilities, and last-seen state; and
- perform node-local connector administration only through an already authorized direct/local
  path.

There is no global selected machine. A machine filter is a presentation scope and never controls
connection ownership.

## Desktop and Web sidebar modes

Desktop and Web offer two full-height sidebar modes over the same Unified Workspace projections.

### Inbox mode

Inbox mode mirrors the native mobile hierarchy in desktop density:

- Active now, Needs input, and Recent groups;
- search and optional machine/status filters;
- provider mark at the row's lower trailing edge;
- machine provenance and relevant stale, role, trust, or delivery state; and
- direct scoped thread navigation.

### Projects mode

Projects mode is the complete current project-tree sidebar, updated only where required to consume
the shared cross-node logical-project and scoped-thread projections. Its folders, ordering,
expansion, drag behavior, shortcuts, actions, and responsive behavior remain supported.

### Switching and migration

The sidebar title is a view-name dropdown: **Inbox ▾** or **Projects ▾**. Each mode receives the
entire sidebar; they are not vertically combined. Command-palette actions and keyboard shortcuts
switch directly.

The choice is device-local and changes presentation only. It does not reconnect, refetch, reset
filters outside the sidebar, or remount the shared workspace owner.

Migration behavior is:

- the settings-schema migration for a persisted pre-feature profile materializes
  `sidebarMode: "projects"`;
- creation of a brand-new settings document defaults `sidebarMode` to `"inbox"`; and
- every subsequent launch restores the stored local choice.

The first version prioritizes correct information hierarchy and behavior. Further visual refinement
is compatible with the shared projection boundary and does not require connection or state changes.

## Failure and recovery behavior

Failures are environment-scoped:

- one offline node marks only its own physical variants and threads stale;
- one failed acquisition does not create a global disconnected state;
- delivery uncertainty is recorded per thread and environment;
- a cached snapshot survives reconnect until a complete live replacement settles;
- a revoked or removed node loses leases and cached metadata immediately;
- an unselectable or unauthorized node never falls back to another same-repository node for an
  existing thread mutation; and
- repository-identity ambiguity leaves projects separate.

Desktop client and node failures are independent. Web security-tier failure does not downgrade a
native node policy. Background and foreground lifecycle events act on retained demand rather than
the machine directory.

## Delivery program

This design is implemented as independent, reviewable waves. Each wave receives its own detailed
implementation plan and proportional validation.

### Wave 1: Shared workspace model

Add the machine catalog, metadata index, logical-project projection, scoped target resolver, and
platform cache contracts to `packages/client-runtime`. Existing user interfaces remain behaviorally
unchanged.

### Wave 2: Per-machine native trust UX

Remove verification's selected-node dependency. Add exact-machine verification actions and the
native Home **Needs verification** section. Gate native workspace eligibility on verified trust.

### Wave 3: Desktop dual role

Add the isolated native Hub client shell, local introduction, remote machine verification, and
cross-node metadata consumption without changing the local node process's security identity.

### Wave 4: Hosted Web convergence

Consume the shared workspace projections, add browser cache support, preserve unsigned-browser
disclosures, show native-only locked nodes, and qualify any increase in hosted Web connection
concurrency before enabling it.

### Wave 5: Sidebar modes

Add the full-height Inbox sidebar, migrate existing profiles to Projects and fresh profiles to
Inbox, and adapt the complete current Projects sidebar to the shared projections.

### Wave 6: Convergence cleanup

Remove remaining global selected-node assumptions from primary navigation and mutation paths while
retaining optional machine filters and explicit machine administration routes.

## Verification strategy

### Pure model and runtime tests

- A five-node fixture proves the absolute three-connection ceiling, retained-scope priority, LRU
  displacement, cancellation, background release, and staggered foreground reconnect.
- Cross-environment collision fixtures give two nodes identical resource ids and prove every read,
  route, outbox entry, and mutation reaches only its scoped environment.
- Cache fixtures cover cold start, complete-snapshot replacement, partial-refresh preservation,
  bounds and eviction, revocation, removal, sign-out, and identity change.
- Logical-project fixtures cover canonical matches, multiple variants, path differences, ambiguous
  identities, and deterministic non-merging.
- Target-resolution fixtures cover explicit overrides, recent use, local Desktop tie-breaking,
  offline nodes, roles, trust, and stable final ordering.

### Client integration tests

- Mobile tests cover independent verification requests for two nodes and native eligibility gates.
- Desktop tests prove client/node key and session isolation, independent sign-out/leave/restart, and
  local introduction.
- Hosted Web tests cover unsigned-browser disclosures, native-only locked nodes, sign-out cache
  purge, and a lower platform connection ceiling.
- Browser tests run identical project/thread fixtures through Inbox and Projects sidebar modes and
  assert the same navigation targets and commands.
- Migration tests start from an actual pre-feature persisted settings fixture and prove it gains
  Projects, prove a newly created settings document gains Inbox, and prove a mode switch causes no
  workspace refetch or connection churn.

### End-to-end evidence

- Two independently enrolled CLI nodes can each be requested, approved, and verified from native
  Machines without selecting either globally.
- Desktop and Mobile show both nodes' logical projects and threads together.
- Opening work on either node connects it automatically, while unrelated cached rows remain inert.
- A five-node fixture never exceeds the qualified platform connection bound.
- Backgrounding releases non-retained native connections; foregrounding produces no storm.
- An offline node retains metadata-only stale rows and does not degrade live work on another node.
- New work chooses an eligible physical project copy automatically and honors a visible override.
- Existing and Inbox sidebar modes remain behaviorally equivalent for navigation and mutations.
- Hosted Web transfer measurement examines the full-PNG screenshot fallback and other sustained
  scopes before its hosted connection bound is raised.

## Acceptance criteria

The program is complete when:

1. No Home, Inbox, Projects, search, or new-thread path requires choosing a machine first.
2. Desktop, Mobile, and eligible hosted Web sessions present one cross-node workspace.
3. Native unverified nodes expose per-machine verification but no node-owned workspace content.
4. Every visible physical record identifies its owning machine when provenance matters.
5. Every mutation and subscription is explicitly environment-scoped.
6. Logical projects group repository copies without merging node-owned thread or worktree identity.
7. No client exceeds the absolute three-connection ceiling, and each platform stays at or below its
   separately qualified bound.
8. Offline and failed nodes degrade only their own rows and actions.
9. Desktop's native client and local node identities remain isolated through sign-out, leave,
   restart, and failure.
10. Hosted Web never overclaims native trust and respects native-only node policy.
11. Both Desktop/Web sidebar modes work against the same projections and commands.
12. Existing profiles retain Projects on migration, fresh profiles begin in Inbox, and the local
    choice persists.
