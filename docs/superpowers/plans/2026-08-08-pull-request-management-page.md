# Pull Request Management Page Implementation Plan

**Design:** [2026-08-08-pull-request-management-page-design.md](../specs/2026-08-08-pull-request-management-page-design.md)

**Goal:** Ship a canonical, repository-aware, many-to-many pull request domain and a dedicated
desktop Pull Requests inbox/detail page across all connected Ryco environments.

**Architecture:** Each server environment owns verified PR records, access targets, associations,
and per-viewer read state in event-driven SQLite projections. A new client-runtime domain
subscribes to and federates those environment snapshots. The web route consumes only that domain;
existing contextual PR surfaces migrate to the same selectors.

**Initial scope:** Read-only provider detail, five existing source-control providers, durable
unread state, explicit Ryco relationship management, focused keyboard controls, neutral liquid
glass, and a repository-scoped Project Explorer quick view. AI, notifications, remote comments,
reviews, approvals, merges, and phone UI are deferred.

## Execution Rules

- Use Bun 1.3.14 from `package.json`.
- Install once with `bun install --frozen-lockfile` before validation.
- Never run `bun test`; use `bun run test` or package-scoped equivalents.
- Use test-first increments for identity, persistence, projection, refresh, federation, and route
  state logic.
- Keep provider payloads out of `packages/contracts`; contracts remain schema-only.
- Keep DOM/React imports out of `packages/client-runtime`.
- Do not hand-edit `apps/web/src/routeTree.gen.ts`; let the TanStack Router plugin regenerate it.
- Commit after each green task using the suggested commit boundary.
- Do not remove legacy scalar worktree PR fields in this change.

## Task 1: Establish the Baseline

**Files:** None

1. Run `bun install --frozen-lockfile`.
2. Record the current branch and clean-worktree status.
3. Run the focused pre-change checks that cover the seams being replaced:

   ```sh
   bun run --cwd packages/contracts test -- src/sourceControl.test.ts src/worktree.test.ts
   bun run --cwd packages/shared test -- src/sourceControl.test.ts
   bun run --cwd apps/server test -- src/sourceControl/SourceControlProviderRegistry.test.ts src/persistence/Layers/ProjectionWorktrees.test.ts
   bun run --cwd packages/client-runtime test -- src/state/threads/store.test.ts
   bun run --cwd apps/web test -- src/rpc/sourceControlAtoms.test.ts src/components/sourceControl/stateBadgeVariants.test.ts
   ```

4. If a baseline test fails, document it before changing implementation code. Do not fold an
   unrelated baseline repair into this feature.

## Task 2: Add Canonical PR Contracts and Identity Codec

**Create:**

- `packages/contracts/src/pullRequest.ts`
- `packages/contracts/src/pullRequest.test.ts`
- `packages/shared/src/pullRequestIdentity.ts`
- `packages/shared/src/pullRequestIdentity.test.ts`

**Modify:**

- `packages/contracts/src/index.ts`
- `packages/shared/package.json`

1. Add failing contract tests for:
   - canonical ID, provider, host, nested repository path, and positive PR number;
   - PR record, repository metadata, freshness, review/check summary, and capability schemas;
   - access targets, repository coverage, relationships, association evidence, and view state;
   - distinct IDs for every environment/provider/host/repository/number collision dimension;
   - malformed hosts, paths, numbers, associations, and timestamps.
2. Define branded `PullRequestId` and schema-only domain types in `pullRequest.ts`.
3. Define relationship literals exactly as `created`, `opened-existing`, `current-branch`,
   `explicitly-attached`, `mentioned`, and `inspected`.
4. Define closed evidence sources exactly as structured provider result, branch reconciliation,
   user attachment, structured thread context, verified textual reference, and verified legacy
   backfill.
5. Implement the identity codec in `@ryco/shared/pullRequestIdentity` as a versioned canonical-CBOR
   tuple encoded with unpadded base64url. Normalize provider host and repository path before
   encoding. Do not use delimiter concatenation.
6. Export the schemas from the contracts root and the codec through a new shared subpath export.
7. Run:

   ```sh
   bun run --cwd packages/contracts test -- src/pullRequest.test.ts
   bun run --cwd packages/shared test -- src/pullRequestIdentity.test.ts
   bun run --cwd packages/contracts typecheck
   bun run --cwd packages/shared typecheck
   ```

8. Commit: `contracts: add canonical pull request domain`

## Task 3: Add PR Orchestration and RPC Schemas

**Modify:**

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/orchestration.test.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/rpc.test.ts`
- `packages/shared/src/rpcAccessPolicy.ts`
- `packages/shared/src/rpcAccessPolicy.test.ts`

1. Add failing tests for replay-safe PR commands/events and RPC schema decoding.
2. Extend `OrchestrationAggregateKind` and aggregate ID with `pull-request` and
   `PullRequestId`.
3. Add server-dispatched commands and matching events for:
   - verified PR observation/upsert;
   - relationship recording;
   - temporal relationship ending;
   - explicit relationship removal;
   - viewed state;
   - mark-unread state.
4. Keep viewer keys server-derived. Client RPC inputs must never accept an arbitrary viewer key.
5. Add RPC method constants and schemas for:
   - `pullRequests.listInbox`;
   - `pullRequests.getDetail`;
   - `pullRequests.refresh`;
   - `pullRequests.markViewed`;
   - `pullRequests.markUnread`;
   - `pullRequests.attachRelationship`;
   - `pullRequests.removeExplicitRelationship`;
   - `pullRequests.subscribeInbox` as a replayable stream.
6. Model the inbox stream as snapshot then generation-tagged deltas or refresh invalidations. It
   must carry repository coverage and last-success metadata.
7. Add access-policy entries matching existing source-control read authority. Relationship and
   read-state mutations require operator authority; no method bypasses hosted capability policy.
8. Run:

   ```sh
   bun run --cwd packages/contracts test -- src/orchestration.test.ts src/rpc.test.ts
   bun run --cwd packages/shared test -- src/rpcAccessPolicy.test.ts
   bun run --cwd packages/contracts typecheck
   bun run --cwd packages/shared typecheck
   ```

9. Commit: `contracts: define pull request events and rpc`

## Task 4: Create Migration 044 and Projection Repository

**Create:**

- `apps/server/src/persistence/Migrations/044_PullRequestInbox.ts`
- `apps/server/src/persistence/Migrations/044_PullRequestInbox.test.ts`
- `apps/server/src/persistence/Services/ProjectionPullRequests.ts`
- `apps/server/src/persistence/Layers/ProjectionPullRequests.ts`
- `apps/server/src/persistence/Layers/ProjectionPullRequests.test.ts`

**Modify:**

- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/server.ts`

1. Write the migration test first. Require these tables:
   - `projection_pull_requests`;
   - `projection_pull_request_access_targets`;
   - `projection_pull_request_associations`;
   - `projection_pull_request_view_state`.
2. Assert primary/foreign keys, uniqueness, check constraints, and indexes for environment,
   repository, state, provider update time, subject, relationship, active temporal association,
   and viewer unread queries.
3. Store bounded normalized JSON fields only when a relational column would add no query value.
   Decode every JSON field through Effect Schema at the persistence boundary.
4. Define the projection repository interface with atomic methods for:
   - generation-aware PR upsert;
   - access-target upsert/list;
   - relationship record/end/remove-explicit;
   - view/mark-unread;
   - list/filter snapshot;
   - get canonical record/detail access target;
   - find associations by PR, thread, and worktree.
5. Implement repository methods with `SqlSchema` and transactions where one event touches several
   tables.
6. Test idempotency, same-number cross-repository rows, many-to-many associations, simultaneous
   relationship kinds, ended branch history, per-viewer isolation, and stale generation rejection.
7. Wire the live layer into the server dependency graph without changing startup behavior.
8. Run:

   ```sh
   bun run --cwd apps/server test -- src/persistence/Migrations/044_PullRequestInbox.test.ts src/persistence/Layers/ProjectionPullRequests.test.ts
   bun run --cwd apps/server typecheck
   ```

9. Commit: `server: persist canonical pull requests`

## Task 5: Project PR Events into the New Tables

**Create:**

- `apps/server/src/orchestration/Layers/PullRequestProjection.ts`
- `apps/server/src/orchestration/Layers/PullRequestProjection.test.ts`

**Modify:**

- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`
- `apps/server/src/orchestration/runtimeLayer.ts`

1. Add failing decider tests showing that each validated command emits exactly one normalized
   event and rejects impossible relationship/view-state transitions.
2. Add the command decisions without allowing client-supplied provider truth to pass through the
   generic orchestration dispatcher.
3. Add a focused PR projection handler instead of growing unrelated worktree projection methods.
4. Apply PR events transactionally through `ProjectionPullRequestRepository`.
5. Ensure shell/thread snapshot projectors explicitly tolerate PR events without embedding the
   entire inbox in every shell snapshot.
6. Test duplicate event delivery, replay order, stale provider generations, current-branch end,
   explicit-only removal, and view-state isolation.
7. Run:

   ```sh
   bun run --cwd apps/server test -- src/orchestration/Layers/PullRequestProjection.test.ts src/orchestration/Layers/ProjectionPipeline.test.ts
   bun run --cwd apps/server typecheck
   ```

8. Commit: `server: project pull request events`

## Task 6: Add Provider Target, Capability, and Viewer Normalization

**Create:**

- `apps/server/src/sourceControl/PullRequestProviderNormalization.ts`
- `apps/server/src/sourceControl/PullRequestProviderNormalization.test.ts`

**Modify:**

- `packages/contracts/src/sourceControl.ts`
- `packages/contracts/src/sourceControl.test.ts`
- `apps/server/src/sourceControl/SourceControlProvider.ts`
- `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`
- `apps/server/src/sourceControl/GitLabSourceControlProvider.ts`
- `apps/server/src/sourceControl/BitbucketSourceControlProvider.ts`
- `apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.ts`
- `apps/server/src/sourceControl/ForgejoSourceControlProvider.ts`
- the five matching provider test files

1. Extend provider-facing `ChangeRequest` summaries with optional normalized reviewers and review
   disposition fields needed by the inbox. Keep canonical identity out of this provider DTO.
2. Add static provider capability metadata and an optional verified viewer identity operation to
   `SourceControlProviderShape`.
3. Implement viewer identity only where it can be verified. Providers that cannot map the viewer
   to review/assignment data declare the related inbox views unsupported.
4. Implement a normalization function that combines:
   - a verified `ChangeRequest`;
   - resolved `RepositoryIdentity` or verified external provider context;
   - environment ID;
   - access target;
   - refresh generation.
5. Reject mismatched hosts, repository paths, provider kinds, invalid URLs, and responses that do
   not match the requested canonical identity.
6. Update all five provider adapters and fixtures to populate reviewer/check/capability data only
   when supported.
7. Run:

   ```sh
   bun run --cwd packages/contracts test -- src/sourceControl.test.ts
   bun run --cwd apps/server test -- src/sourceControl/PullRequestProviderNormalization.test.ts src/sourceControl/GitHubSourceControlProvider.test.ts src/sourceControl/GitLabSourceControlProvider.test.ts src/sourceControl/BitbucketSourceControlProvider.test.ts src/sourceControl/AzureDevOpsSourceControlProvider.test.ts src/sourceControl/ForgejoSourceControlProvider.test.ts
   bun run --cwd apps/server typecheck
   ```

8. Commit: `server: normalize provider pull requests`

## Task 7: Add Bounded Provider Pagination and Coverage

**Modify:**

- `apps/server/src/sourceControl/SourceControlProvider.ts`
- `apps/server/src/sourceControl/GitHubCli.ts`
- `apps/server/src/sourceControl/GitLabCli.ts`
- `apps/server/src/sourceControl/BitbucketApi.ts`
- `apps/server/src/sourceControl/AzureDevOpsCli.ts`
- `apps/server/src/sourceControl/ForgejoApi.ts`
- the five matching CLI/API test files
- the five matching source-control provider files and tests

1. Add an optional paged listing operation that accepts provider-opaque cursor, state, and a page
   size capped at 100, returning items, next cursor, and coverage metadata.
2. Preserve the existing `listChangeRequests` operation for repository-local dialogs during
   migration; implement it as a bounded compatibility wrapper rather than breaking every caller.
3. Implement native pagination for providers that expose it.
4. For a provider/CLI mode that can only return one bounded list, return explicit partial coverage
   and no fabricated next cursor.
5. Test empty, one-page, multi-page, 500-record stop, invalid cursor, rate-limit, and partial-first-
   page behavior for all five providers.
6. Run:

   ```sh
   bun run --cwd apps/server test -- src/sourceControl/GitHubCli.test.ts src/sourceControl/GitLabCli.test.ts src/sourceControl/BitbucketApi.test.ts src/sourceControl/AzureDevOpsCli.test.ts src/sourceControl/ForgejoApi.test.ts
   bun run --cwd apps/server typecheck
   ```

7. Commit: `server: page pull request discovery`

## Task 8: Build Repository Synchronization

**Create:**

- `apps/server/src/sourceControl/PullRequestInboxSynchronizer.ts`
- `apps/server/src/sourceControl/PullRequestInboxSynchronizer.test.ts`
- `apps/server/src/sourceControl/Services/PullRequestInboxSynchronizer.ts`

**Modify:**

- `apps/server/src/server.ts`
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`

1. Add tests for deduplicating project repositories by environment-local canonical identity and
   retaining external access targets.
2. Have the synchronizer render the persisted snapshot before refresh work begins.
3. Enforce four concurrent repositories per environment, two calls per provider host, page size
   100, and 500 records per full repository refresh.
4. Prioritize open and previously associated PRs. Re-verify known associated closed/merged PRs
   without deleting history when listing omits them.
5. Dispatch verified observations through the orchestration engine. Never write projection tables
   directly from the synchronizer.
6. Track repository coverage, last success, retry-after, current generation, and bounded failure
   details.
7. Stop scheduled polling when no inbox subscriber exists. Coalesce concurrent manual and timer
   refreshes for the same environment/repository.
8. Test disconnected repositories, missing directories, invalid credentials, rate limits, partial
   pagination, cancellation, and stale-generation completion.
9. Run:

   ```sh
   bun run --cwd apps/server test -- src/sourceControl/PullRequestInboxSynchronizer.test.ts
   bun run --cwd apps/server typecheck
   ```

10. Commit: `server: synchronize pull request inbox`

## Task 9: Record Create and Opened-existing Attribution

**Modify:**

- `packages/contracts/src/git.ts`
- `packages/contracts/src/git.test.ts`
- `apps/server/src/git/GitManager.ts`
- `apps/server/src/git/GitManager.test.ts`
- `apps/server/src/ws/gitRpc.ts`
- `apps/server/src/server.test.ts`

1. Extend the structured PR workflow result with verified canonical target context while preserving
   the current `created | opened_existing` status.
2. Carry originating thread ID and optional worktree ID through the server-owned PR action context.
   Do not infer the thread from a currently selected web route.
3. After the existing provider re-query succeeds, dispatch a verified PR observation and direct
   thread relationship:
   - `created` for a new PR;
   - `opened-existing` for an already-open PR.
4. Record a worktree relationship only when a real worktree participated.
5. Preserve the scalar worktree update as a compatibility dual-write.
6. Test several PRs from one thread, the same number in different repositories, external-directory
   creation with no worktree, provider verification failure, and idempotent retry.
7. Run:

   ```sh
   bun run --cwd packages/contracts test -- src/git.test.ts
   bun run --cwd apps/server test -- src/git/GitManager.test.ts src/server.test.ts
   bun run --cwd apps/server typecheck
   ```

8. Commit: `server: attribute created pull requests`

## Task 10: Record Branch, Mention, Inspection, and Legacy Evidence

**Create:**

- `apps/server/src/sourceControl/PullRequestAttribution.ts`
- `apps/server/src/sourceControl/PullRequestAttribution.test.ts`
- `apps/server/src/sourceControl/PullRequestLegacyBackfill.ts`
- `apps/server/src/sourceControl/PullRequestLegacyBackfill.test.ts`

**Modify:**

- `apps/server/src/sourceControl/refreshWorktreeSourceControlState.ts`
- `apps/server/src/sourceControl/refreshWorktreeSourceControlState.test.ts`
- `apps/server/src/ws/context.ts`
- `apps/server/src/ws/context/worktreeOperations.ts`
- the structured source-control context ingestion seam used by composer/thread turns

1. Add one attribution service that accepts typed evidence and performs provider verification
   before dispatching events.
2. Reconcile active `current-branch` relationships and end only prior temporal branch evidence for
   the same subject/repository.
3. Record `inspected` from verified structured thread context.
4. Record `mentioned` only after parsing a provider URL/reference, resolving target repository,
   and verifying it. Never treat arbitrary number text or command output as canonical evidence.
5. Add lazy legacy backfill for scalar worktree PRs. Resolve project repository identity, verify
   the provider PR, then record `verified legacy backfill` evidence. Leave unresolved scalars
   untouched and visible through compatibility selectors.
6. Test branch drift, closed/merged preservation, ambiguous number-only references, invalid URLs,
   external directories, archived worktrees, and backfill credential failure.
7. Run:

   ```sh
   bun run --cwd apps/server test -- src/sourceControl/PullRequestAttribution.test.ts src/sourceControl/PullRequestLegacyBackfill.test.ts src/sourceControl/refreshWorktreeSourceControlState.test.ts
   bun run --cwd apps/server typecheck
   ```

8. Commit: `server: reconcile pull request associations`

## Task 11: Implement Inbox RPCs and Replayable Subscription

**Create:**

- `apps/server/src/ws/pullRequestRpc.ts`
- `apps/server/src/ws/pullRequestRpc.test.ts`
- `apps/server/src/ws/context/pullRequestStreams.ts`
- `apps/server/src/ws/context/pullRequestStreams.test.ts`

**Modify:**

- `apps/server/src/ws/context.ts`
- `apps/server/src/ws/index.ts`
- `packages/client-runtime/src/rpc/wsRpcClient.ts`
- `packages/client-runtime/src/rpc/wsRpcClient.test.ts`
- `packages/client-runtime/src/connection/environmentApi.ts`
- `packages/client-runtime/src/connection/environmentApi.test.ts`

1. Implement list/detail/refresh/read-state/relationship handlers against the projection query,
   synchronizer, attribution service, and orchestration engine.
2. Derive viewer key from authenticated session metadata or stable local installation identity.
3. Resolve canonical detail through a verified access target and reject target identity mismatch.
4. Implement snapshot-first replayable subscription. On reconnect, publish a fresh authoritative
   snapshot before accepting later deltas for that generation.
5. Expose typed pull-request methods through the client-runtime environment API; web code must not
   reach into the raw WS client for this domain.
6. Test authorization, viewer isolation, stream replay, reconnect, slow subscriber handling,
   stale-generation rejection, partial failures, and explicit-only relationship removal.
7. Run:

   ```sh
   bun run --cwd apps/server test -- src/ws/pullRequestRpc.test.ts src/ws/context/pullRequestStreams.test.ts
   bun run --cwd packages/client-runtime test -- src/rpc/wsRpcClient.test.ts src/connection/environmentApi.test.ts
   bun run --cwd apps/server typecheck
   bun run --cwd packages/client-runtime typecheck
   ```

8. Commit: `rpc: expose pull request inbox`

## Task 12: Build the Authoritative Client-runtime Domain

**Create:**

- `packages/client-runtime/src/state/pullRequests/index.ts`
- `packages/client-runtime/src/state/pullRequests/types.ts`
- `packages/client-runtime/src/state/pullRequests/store.ts`
- `packages/client-runtime/src/state/pullRequests/store.test.ts`
- `packages/client-runtime/src/state/pullRequests/selectors.ts`
- `packages/client-runtime/src/state/pullRequests/selectors.test.ts`
- `packages/client-runtime/src/state/pullRequests/runtime.ts`
- `packages/client-runtime/src/state/pullRequests/runtime.test.ts`

**Modify:**

- `packages/client-runtime/package.json`
- `packages/client-runtime/src/connection/supervision.ts`
- `packages/client-runtime/src/connection/supervision.test.ts`

1. Define per-environment snapshot, repository coverage, selected-detail cache, and federation
   state without React or platform UI imports.
2. Index canonical records by ID and relationships by PR/thread/worktree.
3. Federate connected and stale-disconnected environments without deduplicating identities across
   environments.
4. Keep the last snapshot on disconnect, mark it stale, and reject updates from retired
   generations.
5. Subscribe only after environment lifecycle readiness and require a new authoritative snapshot
   after reconnect.
6. Add selectors for inbox rows, repository filters, unread counts, contextual badges, related
   work, and canonical detail target.
7. Test same-number collisions, partial environment failure, reconnect, stale deltas, unread
   derivation, relationship indexes, and stable selection through reorder.
8. Export the new `@ryco/client-runtime/state/pullRequests` subpath.
9. Run:

   ```sh
   bun run --cwd packages/client-runtime test -- src/state/pullRequests/store.test.ts src/state/pullRequests/selectors.test.ts src/state/pullRequests/runtime.test.ts
   bun run --cwd packages/client-runtime typecheck
   ```

10. Commit: `client-runtime: federate pull request state`

## Task 13: Add Route Search State and Sidebar Navigation

**Create:**

- `apps/web/src/pullRequestRouteSearch.ts`
- `apps/web/src/pullRequestRouteSearch.test.ts`
- `apps/web/src/routes/pull-requests.tsx`
- `apps/web/src/components/sidebar/SidebarPullRequestsLink.tsx`

**Modify:**

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/Sidebar.logic.test.ts`

1. Add pure route-search parsing/building tests for view, query, filters, selected canonical ID,
   detail tab, focus mode, and list width.
2. Clamp list width to preserve the shell's 640px main-content minimum and reject malformed IDs or
   filter values.
3. Add an authenticated route outside `_chat` so chat-global shortcuts are not mounted.
4. Render the page root through `SidebarInset` with full-height flex/overflow boundaries.
5. Add the sidebar link directly after `SidebarNewThreadButton` and before
   `SidebarProjectsContent`. Match current sidebar focus/hover typography and provide an active
   state without a violet wash.
6. Do not modify phone navigation or `PhoneHome`.
7. Let the router plugin regenerate `routeTree.gen.ts` through the normal build/dev command.
8. Run:

   ```sh
   bun run --cwd apps/web test -- src/pullRequestRouteSearch.test.ts src/components/Sidebar.logic.test.ts
   bun run --cwd apps/web typecheck
   ```

9. Commit: `web: add pull requests route`

## Task 14: Build Inbox View-model, Search, and Filters

**Create:**

- `apps/web/src/components/pullRequests/pullRequestInboxViewModel.ts`
- `apps/web/src/components/pullRequests/pullRequestInboxViewModel.test.ts`
- `apps/web/src/components/pullRequests/PullRequestInboxHeader.tsx`
- `apps/web/src/components/pullRequests/PullRequestInboxViews.tsx`
- `apps/web/src/components/pullRequests/PullRequestInboxFilters.tsx`

1. Derive Latest, Requires review, Assigned, Authored, Changes requested, Failing checks, Drafts,
   Merged, Closed, By repository, and Related Ryco Work from canonical records and capabilities.
2. Omit Priority entirely in v1.
3. Implement normalized search across title, number, repository, host, branches, author, reviewer,
   thread title, worktree name, and worktree branch.
4. Compose provider, repository, state, author, reviewer, and check filters without losing coverage
   errors hidden by row filters.
5. Sort Latest strictly by verified provider update time with stable canonical-ID tie breaking.
   Unread is a signal, not an implicit priority reorder.
6. Add tests for capability absence, partial coverage, ambiguous repositories, search normalization,
   composed filters, and stable sort.
7. Run:

   ```sh
   bun run --cwd apps/web test -- src/components/pullRequests/pullRequestInboxViewModel.test.ts
   bun run --cwd apps/web typecheck
   ```

8. Commit: `web: model pull request inbox views`

## Task 15: Build the Split Inbox Page and Neutral Liquid Glass

**Create:**

- `apps/web/src/components/pullRequests/PullRequestsPage.tsx`
- `apps/web/src/components/pullRequests/PullRequestInboxList.tsx`
- `apps/web/src/components/pullRequests/PullRequestInboxRow.tsx`
- `apps/web/src/components/pullRequests/PullRequestSplitPane.tsx`
- `apps/web/src/components/pullRequests/PullRequestsPage.browser.tsx`

**Modify:**

- `apps/web/src/routes/pull-requests.tsx`
- `apps/web/src/index.css` only for reusable material variables or reduced-transparency media rules
  that cannot live in component classes

1. Mount the client-runtime federation controller and render cached rows plus independent
   environment/repository coverage states.
2. Build the approved top-view split layout with a resizable list and stable detail mount.
3. Use `@legendapp/list` only after 200 rows; keep the same semantic listbox/option model below and
   above the threshold.
4. Show repository, number, title, state, author, update time, review/check status, unread dot, and
   related-work count on every applicable row. Add environment/provider labels only when needed to
   disambiguate.
5. Implement neutral liquid glass:
   - no decorative violet tint;
   - clear content planes;
   - selective frost on header, filters, selected row, and readiness modules;
   - neutral refractive borders/highlights;
   - existing semantic PR/check colors only.
6. Add reduced-transparency opaque fallbacks and reduced-motion behavior.
7. Add actionable empty, partial, stale, unauthorized, and refresh-failure states.
8. Test geometry, overflow, active sidebar state, theme rendering, reduced-transparency styles,
   selection stability, and 200-row virtualization transition.
9. Run:

   ```sh
   bun run --cwd apps/web test -- src/components/pullRequests/pullRequestInboxViewModel.test.ts
   bun run --cwd apps/web test:browser -- src/components/pullRequests/PullRequestsPage.browser.tsx
   bun run --cwd apps/web typecheck
   ```

10. Commit: `web: build pull request inbox`

## Task 16: Add Read-only Detail, Relationships, Unread, and Keyboard Flow

**Create:**

- `apps/web/src/components/pullRequests/PullRequestDetailWorkspace.tsx`
- `apps/web/src/components/pullRequests/PullRequestRelationships.tsx`
- `apps/web/src/components/pullRequests/PullRequestReadiness.tsx`
- `apps/web/src/components/pullRequests/pullRequestInboxKeyboard.ts`
- `apps/web/src/components/pullRequests/pullRequestInboxKeyboard.test.ts`

**Modify:**

- `apps/web/src/components/projectExplorer/PullRequestDetail.tsx`
- `apps/web/src/components/pullRequests/PullRequestsPage.tsx`
- `apps/web/src/components/pullRequests/PullRequestsPage.browser.tsx`

1. Refactor the existing rich PR detail body into a toolbar-independent workspace shared by the
   dialog and page. Keep the existing contextual wrapper operational.
2. Remove provider mutation controls from the page workspace. Conversation, Reviews, Checks,
   Commits, Files, and Related Ryco Work are read-only provider surfaces.
3. Resolve detail by canonical ID through the new client-runtime API, not `cwd + number` in page
   components.
4. Mark viewed only after successfully loading verified detail. Add mark-unread and optimistic
   rollback on RPC failure.
5. Add explicit thread/worktree attachment picker. Allow removal only when the selected
   relationship kind is `explicitly-attached`.
6. Add focused detail mode and browser-history restoration of split state, selected row, active
   tab, and a history-state list scroll anchor.
7. Implement keyboard controls with text-input/modal guards:
   - Up/Down and J/K move selection;
   - Enter focuses detail;
   - `/` focuses search;
   - Escape returns focus to the list.
8. Do not move focus or selection because a background refresh reorders rows.
9. Test detail failure/retry, unread timestamps, attach/remove rules, related route links, focused
   history, scroll restoration, keyboard guards, and accessibility names.
10. Run:

   ```sh
   bun run --cwd apps/web test -- src/components/pullRequests/pullRequestInboxKeyboard.test.ts
   bun run --cwd apps/web test:browser -- src/components/pullRequests/PullRequestsPage.browser.tsx
   bun run --cwd apps/web typecheck
   ```

11. Commit: `web: add pull request detail workspace`

## Task 17: Move Project Explorer and Contextual Surfaces to Canonical Selectors

**Modify:**

- `apps/web/src/components/projectExplorer/ProjectExplorerDialog.tsx`
- `apps/web/src/components/projectExplorer/PullRequestsTab.tsx`
- `apps/web/src/components/projectExplorer/PullRequestList.tsx`
- `apps/web/src/components/projectExplorer/ProjectOverviewTab.tsx`
- `apps/web/src/components/chat/ChatOverviewPanel.tsx`
- `apps/web/src/components/chat/ChatOverviewPanel.logic.ts`
- `apps/web/src/components/ThreadStatusIndicators.tsx`
- `apps/web/src/components/worktrees/WorktreeSourceControlBadges.tsx`
- `apps/web/src/components/sidebar/SidebarThreadRow.tsx`
- relevant unit and browser tests beside those files

1. Replace `${provider}:${number}` list keys and number-only selection with canonical PR IDs.
2. Keep Project Explorer repository-scoped and compact. Add “Open in Pull Requests” with canonical
   selection and repository filter search state.
3. Replace overview fallback synthesis with canonical selectors plus the documented unresolved-
   legacy compatibility path.
4. Make header, thread, worktree, sidebar, and overview surfaces consume the same association and
   state selectors.
5. Keep `stateBadgeVariants` authoritative for open/draft/merged/closed colors across every
   surface.
6. Assert that same-number PRs across repositories cannot select, badge, or refresh one another.
7. Run:

   ```sh
   bun run --cwd apps/web test -- src/components/chat/ChatOverviewPanel.test.ts src/components/sourceControl/stateBadgeVariants.test.ts src/rpc/sourceControlAtoms.test.ts
   bun run --cwd apps/web test:browser -- src/components/sidebar/SidebarWorktreeList.browser.tsx src/components/pullRequests/PullRequestsPage.browser.tsx
   bun run --cwd apps/web typecheck
   ```

8. Commit: `web: unify pull request surfaces`

## Task 18: Add Whole-route and Failure-path Browser Coverage

**Modify:**

- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/components/pullRequests/PullRequestsPage.browser.tsx`
- `apps/web/src/components/WebSocketConnectionSurface.logic.test.ts` if lifecycle presentation
  coverage needs an explicit PR snapshot case

1. Add one whole-app test for sidebar navigation from a thread to `/pull-requests` and back without
   losing the chat draft or remounting shared shell state.
2. Add focused page tests for:
   - two environments with same-number PRs;
   - one disconnected environment;
   - partial repository coverage;
   - stale snapshot followed by authoritative reconnect snapshot;
   - detail identity mismatch;
   - URL reload with filters, selection, focus mode, and split width;
   - narrow-desktop list/detail switching;
   - no new phone dock/sidebar entry.
3. Keep fixtures local to the focused page test. Do not grow production demo data.
4. Run:

   ```sh
   bun run --cwd apps/web test:browser -- src/components/pullRequests/PullRequestsPage.browser.tsx
   bun run --cwd apps/web test:browser -- src/components/ChatView.browser.tsx
   ```

5. Commit: `test: cover pull request workspace`

## Task 19: Final Migration Audit and Validation

**Files:** All changed files

1. Search for remaining unsafe UI identity and fallback usage:

   ```sh
   rg -n '\$\{[^}]*provider[^}]*\}:\$\{[^}]*number|provider.*number|prNumber|prTitle|prState|prIsDraft' apps/web/src packages/client-runtime/src apps/server/src packages/contracts/src
   ```

2. Classify every remaining scalar reference as one of:
   - migration compatibility;
   - legacy persistence dual-write;
   - provider DTO mapping;
   - test fixture intentionally covering legacy behavior.
3. Remove accidental number-only keys, selection, refresh matching, or canonical queries.
4. Confirm no private deployment, issue, or operational details entered the public repository.
5. Run focused changed-package checks once more.
6. Run the full cross-cutting backstop required by `AGENTS.md`:

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
   ```

7. If Chromium is unavailable, first run:

   ```sh
   bun run --cwd apps/web test:browser:install
   ```

8. Inspect the real page in dark and light themes, reduced transparency, reduced motion, a normal
   laptop viewport, and the narrow desktop breakpoint. Verify clear/frosted liquid-glass material,
   no decorative violet tint, visible focus, readable state colors, and stable scroll/focus.
9. Verify the worktree contains only intended changes and all migration compatibility references
   are documented in code.
10. Commit any validation-only corrections with a narrowly scoped message. Do not create a
    catch-all commit when earlier task commits can be amended safely.

## Completion Criteria

- All 15 acceptance criteria in the approved design are demonstrated by automated or explicit
  visual verification.
- Every provider returns either verified bounded results or explicit partial/unsupported coverage.
- The page and all contextual surfaces use canonical IDs and client-runtime selectors.
- No provider mutation controls appear on the new page.
- Closed/merged history and all relationship kinds survive refresh, replay, and reconnect.
- The full repository backstop, web build, and browser suite pass.
