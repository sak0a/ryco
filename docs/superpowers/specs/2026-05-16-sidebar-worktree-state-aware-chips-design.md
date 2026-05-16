# Sidebar Worktree State-Aware Chips

## Goal

Make the linked-issue and linked-PR chips on each worktree row in the sidebar
reflect the **current lifecycle state** of the artifact they point to, and
suppress the chat-activity dot when a worktree is idle.

Today the chip is flat: it shows `#N` with a generic icon, regardless of
whether the issue is open or closed, or whether the PR is a draft, open,
merged, or closed. The user has to open the dialog (or guess from the badge
color, which only encodes "issue vs PR") to know where the work stands.

This spec turns the chip into a small status pill: icon + color + `#N`,
with one variant per `(kind, state)`, drawn from the same vocabulary as the
existing `StateBadge` component in `apps/web/src/components/projectExplorer`.

It also hides the chat-activity dot on the left of the worktree row when the
worktree's aggregate status is `idle`, so the row only carries that signal
when something is actually happening.

## Non-goals

- **CI / review / mergeability indicators.** No green/red CI dot on the PR
  chip, no "changes requested" or "approved" overlay. Those belong to a
  later spec.
- **Background polling.** No periodic server-side fetch of issue/PR state.
  State refreshes only on activity (see Refresh sources below).
- **Non-GitHub providers.** GitLab, Forgejo, Bitbucket, and Azure DevOps
  follow the same shape but are out of scope here. The contract change is
  provider-agnostic; populating state for those providers will land in
  separate work.
- **A "closed, not planned" issue variant.** GitHub distinguishes "closed
  completed" from "closed not planned"; the chip collapses both into a
  single `closed` variant.
- **Manual refresh affordance** (a "refresh" button on the chip or row).
  Refresh happens automatically on the activity sources listed below.

## User-visible behaviour

### State-aware chips

`WorktreeSourceControlBadges` in
`apps/web/src/components/sidebar/SidebarWorktreeList.tsx` continues to
render zero, one, or two chips per worktree. Each chip is now styled per
`(kind, state)`:

| Kind / state           | Icon                      | Color tone | Tooltip                    |
| ---------------------- | ------------------------- | ---------- | -------------------------- |
| Issue — open           | `CircleDotIcon`           | emerald    | `Issue #N — Open`          |
| Issue — closed         | `CheckCircle2Icon`        | violet     | `Issue #N — Closed`        |
| Issue — unknown state  | `CircleDotIcon`           | emerald    | `Issue #N`                 |
| PR — draft             | `GitPullRequestDraftIcon` | zinc       | `Pull request #N — Draft`  |
| PR — open              | `GitPullRequestIcon`      | emerald    | `Pull request #N — Open`   |
| PR — merged            | `GitMergeIcon`            | violet     | `Pull request #N — Merged` |
| PR — closed (unmerged) | `XCircleIcon`             | rose       | `Pull request #N — Closed` |
| PR — unknown state     | `GitPullRequestIcon`      | blue       | `Pull request #N`          |

`unknown state` is the fallback when:

- The worktree was created before this feature shipped and has never been
  refreshed, or
- A refresh attempt failed and we never persisted a state.

It renders with today's chip styling (emerald for issues, blue for PRs)
so existing rows degrade gracefully.

The chip preserves its current sidebar dimensions (height 4, font 9px,
horizontal padding 1, icon 2.5). It continues to:

- Show `#N` after the icon.
- Open `LinkedWorktreeItemDialog` on click (no change to click handler).
- Apply to both active and archived worktree rows (`ArchivedWorktreeRow`
  uses the same `WorktreeSourceControlBadges` component).

The variant resolver and color/icon map move into a shared module
`apps/web/src/components/sourceControl/stateBadgeVariants.ts`. Both the
new compact sidebar chip and the existing `StateBadge` in
`projectExplorer/` consume that map so the two surfaces can't drift.

### Hidden idle dot

The status dot on the left of each worktree row (rendered around lines
317–330 of `SidebarWorktreeList.tsx`) is suppressed when
`worktree.aggregateStatus === "idle"`. The surrounding `<span>` keeps its
`size-3` footprint so the row's gap and alignment don't shift; only the
inner colored `<span>` is removed.

The dot remains visible (and animated for `in_progress`) for the three
non-idle buckets: `in_progress`, `review`, `done`.

### Origin label deduplication

The small grey origin label (`"PR"` / `"Issue"` / `"Manual"`) rendered by
`WorktreeOriginLabel` is suppressed when a state-aware chip is already
showing the same artifact kind:

- A worktree with `origin === "pr"` and a `prNumber` chip: omit the origin label.
- A worktree with `origin === "issue"` and an `issueNumber` chip: omit the origin label.
- A worktree with `origin === "manual"`: continue to show the `"Manual"` label.

This removes the duplicate "PR PR #123" effect that today's UI has.

## Data model

### Contract changes

Extend `Worktree` in `packages/contracts/src/worktree.ts`:

```ts
export const PullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestState = typeof PullRequestState.Type;

export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

export const Worktree = Schema.Struct({
  // ...existing fields...
  prState: Schema.NullOr(PullRequestState),
  prIsDraft: Schema.NullOr(Schema.Boolean),
  issueState: Schema.NullOr(IssueState),
});
```

All three fields are nullable. `null` means "unknown" and renders the
fallback chip. Combined invariant the projector must uphold:

- `prState`, `prIsDraft` may be non-null only if `prNumber` is non-null.
- `issueState` may be non-null only if `issueNumber` is non-null.

`SidebarWorktree` in
`apps/web/src/components/sidebar/hooks/useSidebarTree.ts` mirrors these
fields and `composeSidebarTree` carries them through verbatim. The merge
logic in `mergeWorktree` prefers the most recently updated source for each
state field (same `updatedAt`-based rule used for `title`).

### Projection table

Migration adds three columns to `projection_worktrees`:

- `pr_state TEXT NULL` — one of `"open" | "closed" | "merged" | NULL`
- `pr_is_draft INTEGER NULL` — `0 | 1 | NULL`
- `issue_state TEXT NULL` — one of `"open" | "closed" | NULL`

Existing rows default to `NULL` for all three. The next free migration
number is `037` (current head is `036_AtlassianConnections.ts`).

`ProjectionWorktreeRepository.upsert` and `getById` / `listByProjectId`
SQL is updated to read/write the new columns.

### Domain event

Add `WorktreeSourceControlStateUpdatedPayload` in
`packages/contracts/src/orchestration.ts`, modelled on the existing
`WorktreeMetaUpdatedPayload`:

```ts
export const WorktreeSourceControlStateUpdatedPayload = Schema.Struct({
  worktreeId: WorktreeId,
  prState: Schema.NullOr(PullRequestState),
  prIsDraft: Schema.NullOr(Schema.Boolean),
  issueState: Schema.NullOr(IssueState),
  updatedAt: IsoDateTime,
});
```

Handled by the orchestration projector
(`apps/server/src/orchestration/projector.ts` + `ProjectionPipeline.ts`)
to update the row and emit through the existing WebSocket push so the
client sidebar re-renders.

## Refresh sources

State is refreshed only on activity. Four triggers, in order of likely
firing:

1. **At link time** — `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`
   (and the equivalent path for issue worktrees) already queries GitHub
   for `prTitle` / `issueTitle` when a worktree is created from a PR or
   issue. The same query response carries `state` and `isDraft`. Capture
   and emit `WorktreeSourceControlStateUpdatedPayload` immediately
   following the worktree-created event for that worktree.

2. **On detail fetch** — the server RPC handlers that back
   `PullRequestDetail` and `IssueDetail` (the queries opened by
   `LinkedWorktreeItemDialog`) opportunistically update the projection
   row whenever they successfully fetch detail for a number that maps to
   a known worktree. The client doesn't have to do anything special: the
   detail response carries `state` / `isDraft`, and the handler emits
   `WorktreeSourceControlStateUpdatedPayload` if the values differ from
   what's currently projected.

3. **On thread turn finished** — `ProviderCommandReactor` (or whichever
   reactor terminates the turn lifecycle in
   `apps/server/src/orchestration/Layers/`) calls
   `refreshWorktreeSourceControlState(worktreeId)` when a turn completes
   on a thread attached to a worktree with a non-null `prNumber` or
   `issueNumber`. Deduplicated per `worktreeId` with a short trailing
   debounce (~2s) so a flurry of finishing turns produces one refresh.

4. **On app start** — once per project per WebSocket session, the server
   walks the project's non-archived worktrees with a linked PR/issue and
   calls `refreshWorktreeSourceControlState` for each, with a
   per-project concurrency cap of 4. (`gh pr view` / `gh issue view` take
   a single number, so no GraphQL batching attempted in v1.)

All four sources funnel through a single
`refreshWorktreeSourceControlState(worktreeId)` server-side helper that:

- Reads the projection to look up `(prNumber, issueNumber)`.
- Calls the appropriate provider methods.
- Emits the domain event only if any of `prState`, `prIsDraft`, or
  `issueState` actually changed (cheap shallow compare against the last
  projected values).

Errors are swallowed at the helper level (the chip just stays at its
last known state) and logged; one transient `gh` failure must not break
the sidebar.

## Architecture and component changes

### Files added

- `apps/server/src/sourceControl/refreshWorktreeSourceControlState.ts` —
  the shared helper described above.
- `apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.ts`
  (+ test) — adds the three columns.

### Files modified

- `packages/contracts/src/worktree.ts` — schema additions.
- `packages/contracts/src/orchestration.ts` — new payload.
- `apps/server/src/persistence/Services/ProjectionWorktrees.ts` and
  `apps/server/src/persistence/Layers/ProjectionWorktrees.ts` — read/write
  the new columns.
- `apps/server/src/orchestration/projector.ts`,
  `apps/server/src/orchestration/decider.ts`,
  `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`,
  `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` —
  handle the new event and surface the new columns.
- `apps/server/src/sourceControl/GitHubSourceControlProvider.ts` and
  `apps/server/src/sourceControl/GitHubCli.ts` — capture state at link
  time and expose a `getIssueState`/`getPullRequestState` lookup the
  helper can call.
- `apps/web/src/components/sidebar/hooks/useSidebarTree.ts` — extend
  `SidebarWorktree`, plumb new fields through `composeSidebarTree` and
  `mergeWorktree`.
- `apps/web/src/components/sidebar/SidebarWorktreeList.tsx` — replace the
  hard-coded `tone: "issues" | "pullRequests"` chip with the variant
  table; suppress idle dot; dedupe origin label.
- The RPC handlers in `apps/server/src/ws.ts` (or wherever
  `getPullRequest` / `getIssue` are routed) call into
  `refreshWorktreeSourceControlState` after a successful detail fetch.
  `PullRequestDetail.tsx` and `IssueDetail.tsx` themselves are unchanged.

## Testing

### Unit

- `useSidebarTree.test.ts` — `composeSidebarTree` propagates `prState`,
  `prIsDraft`, `issueState` from input worktrees through the tree, and
  `mergeWorktree` picks the freshest state values by `updatedAt`.
- A new test for the chip variant resolver: for every
  `(kind, state, isDraft)` combination, the right `StateBadgeKind` and
  classes are returned. The unknown-state fallback returns today's
  neutral classes.
- `ProjectionPipeline.worktrees.test.ts` — the new event updates the
  projection row, and the projector skips emit when nothing changed.

### Browser / snapshot

`SidebarWorktreeList.browser.tsx` adds rows fixture'd to each of:

- Issue open (`#42` emerald `CircleDot`)
- Issue closed (`#42` violet `CheckCircle2`)
- PR draft (`#100` zinc `GitPullRequestDraft`)
- PR open (`#100` emerald `GitPullRequest`)
- PR merged (`#100` violet `GitMerge`)
- PR closed unmerged (`#100` rose `XCircle`)
- Unknown state fallback (today's neutral chip)
- Idle worktree with no dot, in-progress worktree with animated dot, all
  in one snapshot to lock in the layout.

### Backend

- `037_WorktreeSourceControlState.test.ts` — migration adds columns,
  existing rows are left at `NULL`, round-trip insert/read works.
- `GitHubSourceControlProvider.test.ts` — link-time path persists state
  alongside title.
- A test for `refreshWorktreeSourceControlState` that mocks the GitHub
  CLI: fresh state emits the event; unchanged state is a no-op; CLI
  error is logged and swallowed.

## Rollout

- Migration is forward-only and idempotent (`ADD COLUMN IF NOT EXISTS`).
- Worktrees that pre-date the feature render the neutral chip until the
  next activity trigger refreshes them. The on-app-start batch covers the
  common case after one open.
- No feature flag; the change is additive and the fallback is the
  pre-feature chip.

## Open questions

None at design time. Provider parity (GitLab, Forgejo, Bitbucket, Azure)
is acknowledged in non-goals.
