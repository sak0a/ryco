# Pull Request Management Page Design

**Date:** 2026-08-08

**Status:** Approved

**Scope:** Canonical read-only pull request domain and full-page desktop inbox

## Summary

Ryco will add a dedicated Pull Requests application page at `/pull-requests`. It will be the
authoritative place to discover and inspect pull requests across every repository known to every
connected Ryco environment, plus verified pull requests associated from external directories.

The page is not an enlarged Project Explorer dialog. It uses its own route, navigation entry,
inbox views, global search and filters, compact list, integrated detail workspace, focused detail
mode, keyboard controls, and durable unread state.

The implementation introduces an event/projection-first canonical pull request domain. Pull
requests are repository-aware and environment-aware. Threads and worktrees can have many typed
pull request associations, and a pull request can relate to many threads and worktrees. Provider
results are verified before persistence, association evidence is recorded separately from current
branch state, and closed or merged records remain part of Ryco history.

Version one is read-only with respect to source-control providers. It displays provider comments,
reviews, checks, commits, and files, but it does not comment, react, approve, request changes,
merge, close, or otherwise mutate remote pull requests. Ryco metadata operations such as marking
an item unread or explicitly attaching a thread remain available.

## Goals

- Add `Pull Requests` directly below `New Thread` in the desktop application sidebar.
- Leave the chat route and open a dedicated authenticated application page.
- Display pull requests from all repositories known to all connected environments.
- Include verified external-directory pull requests even when no Ryco project or worktree exists
  for their repository.
- Use a canonical identity that cannot collide by PR number, repository, host, provider, or
  environment.
- Support many-to-many, typed thread/worktree associations.
- Preserve created, opened-existing, explicit, mentioned, inspected, and historical branch
  evidence independently.
- Provide repository labels, provider status, review/CI state, durable unread state, and links to
  related Ryco work on every relevant surface.
- Provide a proper full-page detail mode within the Pull Requests route.
- Remember semantic view state through validated URL search parameters.
- Make one client-runtime domain authoritative for the page and existing contextual PR surfaces.
- Remain provider-generic across GitHub, GitLab, Bitbucket, Azure DevOps, and Forgejo according to
  each provider's declared capabilities.

## Non-goals

- AI prioritization, summaries, scheduling, model selection, or resource policy.
- Desktop/browser notifications or configurable notification rules.
- Remote comments, reactions, approvals, change requests, merges, closes, or edits.
- Extending the frozen `apps/web` phone presentation tier.
- Removing contextual PR badges or quick-access dialogs.
- Removing the Project Explorer PR tab.
- Removing legacy scalar worktree PR columns in this change.
- Pretending provider coverage is complete when pagination, authorization, or rate limits prevent
  a full refresh.

## Existing Constraints

Today Ryco has two disconnected PR paths:

1. A worktree projection stores one PR using `prNumber`, `prTitle`, `prState`, and `prIsDraft`.
2. Git status infers one PR from the current repository and branch.

The header and worktree badge use the persisted scalar. Thread indicators use the inferred PR.
The overview chooses one source through fallback rules. Repository lists can show several PRs but
carry implicit repository context and use keys equivalent to `provider:number`. None of these
forms can safely represent multiple repositories with the same number, several PRs produced by
one thread, or a PR in an external directory.

The existing `ChangeRequest` source-control contract contains useful provider data but lacks the
target repository, host, environment, and canonical identity. Existing provider RPCs address a PR
through `cwd + reference`. The new domain must wrap and normalize these provider results rather
than expose their implicit identity to application UI.

## Architectural Choice

The approved approach is an event/projection-first canonical domain.

Each environment owns the pull request records and associations that it discovers. The server
normalizes verified provider responses, emits orchestration events, and maintains SQLite
projections. `packages/client-runtime` requests a snapshot from every connected environment and
federates those environment-owned snapshots for web, desktop, and future mobile consumers.

The web page never fans out directly to project-scoped source-control atoms and never joins raw
provider responses itself. This preserves environment lifecycle ownership and prevents stale
connections from publishing new readiness or PR state.

## Canonical Identity

A canonical PR ID is an opaque, schema-validated encoding of this tuple:

```text
environmentId
sourceControlProviderKind
normalizedProviderHost
targetRepositoryCanonicalPath
positivePullRequestNumber
```

The target repository path is provider-native after normalization. It supports nested GitLab
namespaces and Azure DevOps organization/project/repository paths; it is not constrained to a
GitHub-style two-segment owner/repository string.

The ID encoder must be unambiguous. It may use a structured opaque token or a length-prefixed
encoding, but it must not rely on concatenating delimiter-separated unescaped strings.

`cwd`, project ID, worktree ID, branch, title, and PR URL are not identity components. They are
mutable access, display, or association data.

Two environments that can access the same hosted PR retain distinct canonical IDs because the
environment is part of the identity requested by this design. The federated UI may indicate that
their provider URLs match, but it must not merge their histories or mutation authority.

## Contract Model

`packages/contracts` gains a schema-only pull request module with these conceptual types.

### PullRequestIdentity

- `id`: opaque canonical ID
- `environmentId`
- `provider`
- `host`
- `repositoryCanonicalPath`
- `number`

### PullRequestRepository

- `canonicalPath`
- `displayName`
- `ownerOrNamespace`, when the provider exposes one
- `url`, when available
- `provider`
- `host`

### PullRequestRecord

- `identity`
- `repository`
- `title`
- `url`
- `state`: `open | closed | merged`
- `isDraft`
- `baseRefName`
- `headRefName`
- `headSha`, when available
- `author`, assignees, reviewers, participants, and labels, when supported
- review summary
- check summary and bounded check rollup
- mergeability
- additions, deletions, changed-file count, and comment count, when available
- provider `updatedAt`
- `lastVerifiedAt`
- freshness: `current | stale | inaccessible`
- the latest bounded provider failure summary, when stale or inaccessible

Provider-specific payloads do not enter the shared contract. Provider adapters normalize their
responses into this record and capability metadata.

### PullRequestAccessTarget

Access targets are environment-local hints, not identity:

- canonical PR ID
- zero or more project IDs
- last verified directory
- remote name and normalized remote URL
- explicit provider context needed to address the target repository
- last successful access timestamp

An external-directory PR can therefore remain stored and attributable without creating a Ryco
project or worktree. If its directory disappears, the record remains readable as stale history.

### PullRequestAssociation

An association contains:

- canonical PR ID
- subject kind: `thread | worktree`
- scoped subject ID
- relationship kind
- evidence source
- `createdAt`
- `lastConfirmedAt`
- `endedAt`, only for temporal evidence

Evidence sources are closed and explicit: structured provider result, branch reconciliation,
user attachment, structured thread context, verified textual reference, or verified legacy
backfill. Free-form command text is never itself an evidence source.

Relationship kinds are:

```text
created
opened-existing
current-branch
explicitly-attached
mentioned
inspected
```

The uniqueness boundary is PR, subject, and relationship kind. Several relationship kinds may
coexist for the same pair. Ending `current-branch` never removes `created`, explicit, mention, or
inspection history.

Only explicit attachments are user-removable. Automatic and historical evidence is immutable
apart from ending a temporal branch association.

### PullRequestViewState

- canonical PR ID
- viewer key
- `lastViewedAt`, nullable
- `updatedAt`

An authenticated principal supplies the viewer key on shared environments. A stable installation
identity supplies it for a local single-user environment. A PR is unread when the verified
provider `updatedAt` is newer than `lastViewedAt`. Successfully loading the canonical detail
records the view. “Mark unread” clears or rewinds the marker without changing provider data.

## Persistence and Events

An additive migration creates normalized projection tables equivalent to:

- `projection_pull_requests`
- `projection_pull_request_access_targets`
- `projection_pull_request_associations`
- `projection_pull_request_view_state`

Tables use canonical IDs, foreign keys, uniqueness constraints, timestamps, and indexes for
environment, repository, state, provider update time, subject association, and viewer unread
queries.

The orchestration domain gains idempotent commands/events equivalent to:

- verified PR observed/upserted
- PR association recorded
- temporal PR association ended
- explicit PR association removed
- PR viewed
- PR marked unread

Provider refresh data and association evidence are separate events. Replaying the same verified
provider result or association evidence must not duplicate rows. An older refresh generation must
not overwrite a record with a newer verification generation or provider timestamp.

## Discovery and Repository Coverage

On page entry, client-runtime requests the persisted inbox snapshot from every connected
environment concurrently. Cached records render before provider refresh completes.

Within an environment, repository synchronization:

1. Enumerates project repositories.
2. Deduplicates them by environment-local canonical repository identity.
3. Adds access targets retained by externally associated PRs.
4. Resolves provider and capability information.
5. Refreshes repositories independently with bounded concurrency.
6. Upserts verified PRs and reports repository-level coverage or failure.

Provider listing uses pages of at most 100 records and stops at 500 PRs per repository during one
full refresh. Open PRs and all previously associated PRs receive priority. Reaching a cap produces
an explicit partial-coverage result. Ryco does not label a capped, unauthorized, or rate-limited
repository as fully synchronized.

Provider adapters must either implement bounded pagination or declare that only a bounded first
page is available. The latter always produces partial coverage; the aggregate service cannot turn
a provider limitation into an implicit completeness claim.

Refresh concurrency is limited to four repositories per environment and two concurrent calls per
provider host. Retry-after and rate-limit responses override normal polling.

The list refreshes every 60 seconds only while the page is visible. A selected open PR detail may
refresh every 30 seconds. Hidden pages stop polling. Manual refresh covers all repositories
allowed by the current filters and coalesces duplicate requests.

## Attribution Rules

Attribution always follows successful provider verification.

### Structured create/open results

The existing create flow already distinguishes a new PR from an existing one and re-queries the
provider. It will also carry thread/worktree subject context and emit:

- `created` for a newly created PR
- `opened-existing` when the create workflow resolves an existing PR

The association is direct to the originating thread. A worktree association is additionally
recorded only when an actual worktree participated.

### Current branch

Branch reconciliation verifies the provider PR, records `current-branch`, and ends prior active
branch evidence for that subject and repository when the branch no longer matches. It does not
replace stronger or historical relationships.

### Explicit attachment

The Related Ryco Work section can attach an existing thread or worktree. The selected PR identity
and subject are both explicit. Removing the relationship only removes
`explicitly-attached`; it cannot erase automatic history.

### Mention and inspection

A thread-bound structured context selection records `inspected`. A textual reference tied to a
thread records `mentioned` after verification.

Command output is not trusted as provider truth. Ryco extracts a candidate provider URL or
reference, resolves its target repository identity, calls the provider, and persists only the
verified result. Failed or ambiguous candidates remain transient diagnostics.

Selecting a PR in the global inbox does not associate it with a previously active thread.

## Server Services and RPCs

The server separates these responsibilities:

- Provider normalization maps provider results plus resolved target context into canonical input.
- Repository synchronization performs bounded discovery and refresh.
- Attribution validates evidence and emits association events.
- Inbox queries read indexed projections and report partial repository coverage.
- Canonical detail resolution selects a valid access target and fetches bounded provider detail.

New RPCs cover:

- inbox snapshot/list
- canonical PR detail
- repository or filtered refresh
- mark viewed
- mark unread
- attach explicit Ryco relationship
- remove explicit Ryco relationship

All RPCs use the existing environment capability and lifecycle policy. A read-only page does not
gain authority to bypass current source-control access controls. Provider capability metadata
drives which review, check, detail, and identity-derived views are available.

## Client-runtime Domain

`packages/client-runtime/state/pullRequests` becomes the authoritative client PR domain. It owns:

- per-environment snapshots
- federated records and repository coverage
- generation-aware refresh state
- partial failures without global failure collapse
- unread derivation
- association indexes by PR, thread, and worktree
- canonical record selectors for contextual UI

The domain subscribes to projection updates and rejects stale environment generations. A
disconnected environment retains its last snapshot with disconnected/stale status. Reconnection
requests a current authoritative snapshot before accepting new mutations or refresh results.

Existing web source-control atoms may remain as provider-operation adapters during migration, but
the inbox, Project Explorer PR tab, overview, header, thread indicators, and worktree badges must
ultimately select canonical records from client-runtime. The implementation must not add a fourth
independent PR cache.

## Route and Navigation

The application adds an authenticated `/pull-requests` route beside the chat route group. It is
rendered inside `RootAppShell` and `AppSidebarLayout`, so the existing desktop sidebar, connection
surfaces, settings, and hosted lifecycle remain mounted.

The route must not inherit chat-only global shortcut behavior. The desktop sidebar adds an
active-aware `Pull Requests` row immediately after `SidebarNewThreadButton` and before the project
tree.

The frozen web phone tier receives no new navigation or PR implementation. A narrow desktop may
switch between list and focused detail, but it remains the same route and state model, never a
dialog.

## Page Information Architecture

The approved layout is a top-view split workspace:

- selectively frosted liquid-glass header
- global search and filters
- compact top-level inbox view switcher
- resizable PR list
- integrated detail workspace
- full-page focused detail mode

Primary views are:

- Latest updated
- Requires my review
- Assigned to me
- Authored by me

The More menu includes:

- Changes requested
- Failing checks
- Drafts
- Merged
- Closed
- By repository
- By related Ryco work

The Priority view is not rendered until advisory AI analysis exists. Version one does not show a
disabled or fabricated priority category.

“Requires my review,” Assigned, and Authored depend on verified provider viewer identity and
provider capability metadata. Missing capabilities are explained or omitted; local Git identity
is not used as a guess.

## Search and Filters

Search covers:

- title and PR number
- repository and provider host
- base and head branch
- author and reviewer
- related thread title
- related worktree name or branch

Filters compose across provider, repository, state, author, reviewer, and check status. Repository
coverage errors remain visible when a filter hides affected rows.

Every list row shows repository, number, title, state, author, provider update time, review/check
status, unread state, and related Ryco work count. Environment and provider labels appear whenever
the repository display name would be ambiguous.

The list virtualizes after 200 rows. Heavy detail data such as full conversation bodies and diffs
loads only when its tab is selected.

## Detail Workspace

Selecting a row keeps the list mounted and opens read-only detail with these sections:

- Summary and Conversation
- Reviews
- Checks
- Commits
- Files
- Related Ryco Work

The detail contains no provider mutation controls. Existing GitHub comment and reaction controls
are not exposed on this page in version one.

“Focus detail” expands detail to the entire route content area. Browser Back restores the split
layout, exact selection, filters, list scroll position, and detail tab.

Related threads and worktrees link back to their Ryco routes. An explicit attach picker may add
existing threads/worktrees. Historical automatic relationships are visible but cannot be deleted.

## Visual Direction

The selected direction is neutral liquid glass:

- no violet or other decorative accent wash
- colorless clear or frosted material
- refractive borders, edge highlights, depth, and selective backdrop blur
- frost on top chrome, filters, selected list row, and readiness modules
- clear content planes for long-form scanning
- no universal blur layer over lists or detail text

PR and CI semantic colors are the only chromatic signals. Existing shared state resolvers remain
authoritative: open emerald, draft neutral/zinc, merged violet, closed rose, and the established
check-state colors. Neutral selection must not repurpose one of those semantic colors.

The treatment must work in supported light and dark themes. Reduced-transparency mode replaces
blur with opaque tokenized surfaces and borders. Reduced-motion mode removes nonessential
material transitions without changing focus or selection visibility.

## Remembered State and Keyboard Controls

The route search schema owns:

- current inbox view
- search query
- filters
- selected canonical PR ID
- active detail tab
- split or focused detail mode
- split width

Divider movement updates the URL with history replacement after the drag completes. Semantic
actions such as selecting a new PR or entering focused detail create appropriate history entries.
This preserves state across navigation, reload, and hosted sessions without depending on unsafe
browser persistence.

Keyboard behavior is:

- Up/Down or J/K moves list selection.
- Enter focuses the selected detail.
- `/` focuses search when a text editor or dialog does not already own input.
- Escape returns focus from detail to the list.
- Standard Tab, Enter, and Space behavior remains available.

Focus is never moved merely because a background refresh reorders or updates data. Selection is
stable by canonical ID.

## Project Explorer and Contextual Surfaces

Project Explorer retains a compact repository-scoped PR tab for quick access. It uses the
canonical client-runtime domain and includes “Open in Pull Requests,” which navigates to the new
page with repository filter and selected canonical ID.

Existing PR badges and contextual dialogs remain shortcuts. They must display state through the
shared status resolver and canonical selector. The new page becomes authoritative without forcing
every quick interaction through a full-page navigation.

## Failure Behavior

- Environment and repository failures are isolated and shown with last-success timestamps.
- Cached verified records remain visible as stale when refresh fails.
- Provider pagination caps and unsupported capabilities are explicit coverage states.
- Missing external directories do not delete PR records or associations.
- Invalid canonical IDs produce a recoverable not-found detail state and preserve the inbox.
- A deleted or archived related thread/worktree remains represented as historical unavailable
  context rather than removing the PR relationship.
- Stale connection or refresh generations cannot publish newer-looking PR, association, unread,
  or readiness state.
- A provider response whose target repository does not match the requested canonical identity is
  rejected and never persisted.

## Migration and Rollout

The migration is additive and staged:

1. Add contracts, projection tables, indexes, and replay-safe events.
2. Dual-write verified create, opened-existing, and current-branch results into the new domain.
3. Lazily backfill scalar worktree PR references after resolving repository identity and verifying
   the provider result.
4. Add inbox/detail RPCs and the client-runtime PR domain.
5. Add the page and sidebar entry.
6. Move Project Explorer and contextual surfaces to canonical selectors.

Legacy scalar fields remain during this change. They are never treated as canonical without
verification. Ambiguous legacy values remain available through a compatibility display path and
can be resolved later. Removing scalar fields and compatibility selectors requires a separate
approved migration.

Startup never blocks on provider access or backfill. Closed and merged history is never deleted.

## Testing Strategy

### Contracts

- Canonical IDs differ across environment, provider, host, repository path, and number.
- Nested repository paths round-trip without delimiter ambiguity.
- Association and coverage schemas reject invalid states.
- Route search state round-trips and rejects malformed canonical IDs or widths.

### Persistence and orchestration

- Migrations create expected columns, constraints, and indexes.
- Provider upserts and association delivery are idempotent.
- Several PRs associate with one thread/worktree and one PR associates with several subjects.
- Relationship kinds coexist without overwriting one another.
- Ending current-branch evidence preserves history.
- Replay and out-of-order refresh generations preserve the newest verified record.
- Per-viewer unread state does not leak between principals.
- Legacy backfill requires provider verification and retains unresolved scalars.

### Server and providers

- All five provider adapters supply target repository identity and declared capabilities.
- Create/open attribution records the correct relationship kind.
- External-directory attribution does not create a project or worktree.
- Command-output candidates require URL/reference extraction and provider verification.
- Pagination, 500-record caps, rate limits, credential failures, and deleted directories produce
  correct partial coverage.
- Canonical detail cannot cross repository or environment identity.

### Client-runtime

- Connected environments federate without sharing mutation authority.
- A failed or disconnected environment does not fail the whole inbox.
- Snapshot and delta generations reject stale updates.
- Unread derivation follows provider update and last-viewed timestamps.
- Association indexes power PR, thread, and worktree selectors consistently.
- Reconnect retains stale snapshot until the current authoritative snapshot arrives.

### Web

- Search and composed filters cover all required fields.
- Sidebar navigation leaves chat and shows the active page state.
- Repository labels and ambiguous environment/provider labels appear correctly.
- List selection survives refresh and canonical reorder.
- Keyboard navigation and focus return behavior are accessible.
- Split/focused detail and browser Back restore route and scroll state.
- Project Explorer opens the canonical workspace with repository context.
- Reduced-transparency and reduced-motion modes remain legible and operable.
- Narrow desktop switches list/detail presentation without a dialog.

Development uses focused package and browser tests while iterating. Because this change crosses
contracts, persistence, RPC, client runtime, navigation, and a major web interaction boundary,
final validation runs the full repository backstop, the web build, and the browser suite required
by `AGENTS.md`.

## Acceptance Criteria

1. The desktop sidebar contains an active-aware Pull Requests entry directly below New Thread.
2. The route is a dedicated page, not a modal or enlarged existing dialog.
3. PR keys cannot collide by number, repository, host, provider, or environment.
4. One thread/worktree can relate to several PRs and one PR can relate to several threads/worktrees.
5. Created, opened-existing, current-branch, explicit, mentioned, and inspected relationships are
   independently preserved.
6. A verified external-directory PR can associate directly with a thread without creating a
   project or worktree.
7. All connected environments contribute persisted results without global failure collapse.
8. Every PR row clearly identifies its repository and shows state, review/check, unread, and
   related-work information when available.
9. The detail workspace is read-only with respect to providers and supports full-page focus mode.
10. Durable unread state follows verified provider updates and per-viewer last-viewed state.
11. Search, filters, selection, detail tab, focus mode, and split width survive route navigation
    and reload through validated URL state.
12. Project Explorer remains a repository-scoped quick view backed by the canonical domain.
13. Contextual PR surfaces use the same canonical selectors and state colors.
14. Partial coverage, stale data, unsupported capabilities, and provider failures are visible and
    do not discard verified history.
15. The UI follows the approved neutral, selectively frosted liquid-glass direction without a
    decorative violet accent treatment.

## Deferred Extensions

Advisory AI analysis will later store priority, risk, summary, attention rationale, review
hotspots, suggested order, model identity, source revision, explanation, and cache timestamps under
the canonical PR ID. It remains a separate versioned analysis projection so enabling or expiring
AI results never changes provider truth or relationship history.

Scheduling, AI resource policy, OS notifications, remote review mutations, merge controls, and a
native mobile PR experience each require separate designs.
