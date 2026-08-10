# Usage and Activity Statistics Implementation Plan

**Goal:** Implement the approved standalone Statistics experience with machine-wide Claude/Codex transcript usage, API-equivalent cost estimates, safe multi-environment aggregation, and a separate Ryco-observed Activity view.

**Design spec:** `docs/superpowers/specs/2026-08-10-usage-and-activity-statistics-design.md`

**Status:** Ready for implementation

**Execution:** Sequential, with focused validation at each commit boundary.

<!-- plan-revision: 101 -->

## Scope constraints

- Usage and Activity remain separate data paths. Transcript usage is never guessed onto Ryco projects.
- Transcript tokens are provider-recorded; only cost and cache savings are estimates.
- Raw transcript content and absolute transcript paths stay on the server node.
- Claude and Codex are the only transcript adapters in the first delivery.
- Statistics RPCs remain owner-only in hosted mode.
- The existing `apps/web` phone Settings statistics surface remains behaviorally unchanged.
- No hosted lifecycle, relay, reconnect, service-worker, or mutation-readiness behavior changes.

## Execution plan

### 1. Establish the baseline and add transport contracts

**Files**

- Add `packages/contracts/src/usage.ts`
- Add `packages/contracts/src/usage.test.ts`
- Update `packages/contracts/src/statistics.ts`
- Update `packages/contracts/src/index.ts`
- Update `packages/contracts/src/ipc.ts`
- Update `packages/contracts/src/rpc.ts`
- Update `packages/contracts/src/rpc.test.ts`

**Work**

- Install the pinned Bun dependencies with `bun install --frozen-lockfile` and record the clean baseline.
- Add schemas for:
  - `UsageSummaryRequest` with optional start date, required end date, IANA time zone, and contract version;
  - provider kind, token totals, daily source bucket, cost source, source coverage, pricing status, summary, and typed read error;
  - non-negative finite token/count fields and finite non-negative optional monetary fields;
  - source `deduplicationKind` and opaque `sourceId`; and
  - the client-visible contract version constant.
- Add `StatisticsRecentPullRequest` and an optional/defaulted `recentPullRequests` array to `StatisticsSnapshot` so older persisted/test fixtures remain decodable.
- Register `server.getUsageSummary` in `WS_METHODS`, `WsRpcGroup`, the typed IPC/local API shape, and RPC contract tests.
- Make the usage RPC payload the request schema and its error the union of `UsageReadError` and `AuthRpcError`.
- Keep `server.getStatistics` backward compatible.

**Focused verification**

```sh
bun run --cwd packages/contracts test -- src/usage.test.ts src/rpc.test.ts
bun run --cwd packages/contracts typecheck
```

**Commit boundary:** `feat(usage): add usage summary contracts`

### 2. Implement provider-neutral parsing and aggregation primitives

**Files**

- Add `apps/server/src/usage/usageRecord.ts`
- Add `apps/server/src/usage/usageAggregation.ts`
- Add `apps/server/src/usage/usageAggregation.test.ts`
- Add `apps/server/src/usage/claudeTranscript.ts`
- Add `apps/server/src/usage/claudeTranscript.test.ts`
- Add `apps/server/src/usage/codexTranscript.ts`
- Add `apps/server/src/usage/codexTranscript.test.ts`
- Add fixtures under `apps/server/src/usage/testFixtures/`

**Work**

- Define one internal normalized record with timestamp, provider, model, hashed session/response/dedupe keys, non-overlapping token categories, optional provider cost delta, and parser version.
- Keep internal record types server-only; do not add transcript-record schemas to contracts.
- Implement a streaming-line Claude decoder that:
  - accepts supported assistant usage records;
  - separates uncached, cache-read, cache-creation, output, and reasoning tokens;
  - deduplicates repeated content blocks by message/request identity;
  - keeps equal-token records with distinct identities;
  - validates provider cost as a per-response delta; and
  - skips irrelevant/malformed lines with categorized counters.
- Implement a stateful Codex line reducer that:
  - carries the latest `turn_context` model;
  - consumes `last_token_usage`, never cumulative `total_token_usage` as an independent delta;
  - suppresses repeated token events for the same update;
  - suppresses copied history at tested fork/subagent boundaries;
  - retains equal-token distinct turns; and
  - normalizes reasoning as an output subset.
- Implement aggregation by `(sourceId, local day, provider, model)` with cross-file dedupe, distinct response/session sets, token invariants, and deterministic ordering.
- Hash provider identifiers before a record is eligible for durable caching. Never hash or inspect prompt/response text for deduplication.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/usage/claudeTranscript.test.ts src/usage/codexTranscript.test.ts src/usage/usageAggregation.test.ts
```

**Commit boundary:** `feat(usage): parse Claude and Codex transcripts`

### 3. Add transcript source discovery, bounded reading, and the durable scan cache

**Files**

- Add `apps/server/src/usage/usageSourceDiscovery.ts`
- Add `apps/server/src/usage/usageSourceDiscovery.test.ts`
- Add `apps/server/src/usage/usageTranscriptReader.ts`
- Add `apps/server/src/usage/usageTranscriptReader.test.ts`
- Add `apps/server/src/usage/usageScanCache.ts`
- Add `apps/server/src/usage/usageScanCache.test.ts`
- Reuse `apps/server/src/provider/Drivers/ClaudeHome.ts`
- Reuse `apps/server/src/provider/Drivers/CodexHomeLayout.ts`
- Reuse `apps/server/src/atomicWrite.ts`

**Work**

- Resolve every unique configured Claude and Codex home from legacy driver settings plus enabled provider instances; canonicalize and deduplicate roots before walking.
- Discover Claude project JSONL files and Codex active/archived session JSONL files only under known provider directories.
- Treat absent default roots as `not-found`; treat an explicit unreadable override as a user-visible source failure.
- Stream files line-by-line with bounded concurrency. Apply the range's file-mtime prefilter with the approved 36-hour slack, then use each record timestamp for final inclusion.
- Compute a versioned opaque physical source ID from server hostname, provider, canonical root, and directory device/inode. When filesystem identity is unavailable, generate the environment-scoped fallback and report `environment-only` deduplication.
- Store a versioned cache at `ServerConfig.stateDir/usage/scan-cache.json` keyed by canonical path hash, provider, size, mtime, and parser version.
- Cache only normalized token metadata and hashed identifiers. Never cache raw transcript lines.
- Reparse changed files, recover from a corrupt cache, avoid caching read failures as empty, write atomically, and prune entries not seen for 90 days after a successful scan.
- Ensure deleting the cache and performing a cold scan returns the same summary as a warm scan.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/usage/usageSourceDiscovery.test.ts src/usage/usageTranscriptReader.test.ts src/usage/usageScanCache.test.ts
```

**Commit boundary:** `feat(usage): discover and cache transcript usage`

### 4. Add validated pricing and cache-savings estimation

**Files**

- Add `apps/server/src/usage/usagePricing.ts`
- Add `apps/server/src/usage/usagePricing.test.ts`
- Add `apps/server/src/usage/usageCost.ts`
- Add `apps/server/src/usage/usageCost.test.ts`
- Reuse `apps/server/src/atomicWrite.ts`

**Work**

- Fetch and validate LiteLLM's public pricing JSON through Effect `HttpClient`.
- Reduce the downloaded table to the supported input, cached-input, cache-creation, and output rate fields instead of persisting an unchecked response.
- Store the last valid table at `ServerConfig.stateDir/usage/pricing-cache.json` with source/fetch metadata and a 24-hour TTL.
- Make pricing refresh process-shared and single-flight.
- Resolve exact normalized models first, then only explicitly tested provider/model aliases. Do not use family averages or nearest-model guesses.
- Apply provider-reported cost first when the adapter produced a trustworthy response delta; fill only remaining records from LiteLLM.
- Preserve priced/unpriced token counts and `provider-reported`, `litellm`, `mixed`, or `unpriced` provenance.
- Estimate cache savings only when both the cached/cache-creation rate and equivalent uncached input rate exist. Clamp negative savings to zero and emit a privacy-safe diagnostic.
- On live-fetch failure use the last valid cache; without either, return tokens with unavailable monetary values.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/usage/usagePricing.test.ts src/usage/usageCost.test.ts
```

**Commit boundary:** `feat(usage): estimate API-equivalent cost`

### 5. Build the Effect Usage service

**Files**

- Add `apps/server/src/usage/Services/UsageService.ts`
- Add `apps/server/src/usage/Layers/UsageService.ts`
- Add `apps/server/src/usage/Layers/UsageService.test.ts`
- Add `apps/server/src/usage/usageDate.ts`
- Add `apps/server/src/usage/usageDate.test.ts`
- Update `apps/server/src/server.ts`

**Work**

- Define `UsageService.getSummary(request)` as the single server orchestration point for discovery, cache reuse, parsing, aggregation, pricing, and coverage.
- Validate real calendar dates and IANA time zones before filesystem work.
- Bucket timestamps into the requested zone with tests for DST changes and day boundaries.
- Keep each source independent until the response so the client can remove duplicate physical sources safely.
- Return a successful partial summary when at least one source is usable; reserve `scan-failed` for a node-level failure with no meaningful result.
- Report scan/cache/malformed/skipped counts without private paths.
- Derive summary session totals from per-source distinct sets rather than adding daily bucket session counts.
- Provide the live layer once in the server runtime so scan/pricing caches and single-flight refresh state are shared across clients.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/usage/usageDate.test.ts src/usage/Layers/UsageService.test.ts
bun run --cwd apps/server typecheck
```

**Commit boundary:** `feat(usage): add transcript usage service`

### 6. Wire the owner-gated usage RPC through server and clients

**Files**

- Update `apps/server/src/ws/context.ts`
- Update `apps/server/src/ws/statisticsRpc.ts`
- Update `apps/server/src/ws/RpcAccessPolicy.test.ts`
- Update `apps/server/src/server.test.ts`
- Update `packages/shared/src/rpcAccessPolicy.ts`
- Update `packages/shared/src/rpcAccessPolicy.test.ts`
- Update `packages/client-runtime/src/rpc/wsRpcClient.ts`
- Update `packages/client-runtime/src/authorization/capabilities.test.ts`
- Update `apps/web/src/localApi.ts`
- Update `apps/web/src/localApi.test.ts`

**Work**

- Add `UsageService` to `WsRpcContext` and expose `server.getUsageSummary` from the existing statistics handler module.
- Wrap it with the same owner authorization and RPC instrumentation as `server.getStatistics`.
- Mark the method `owner` in the shared RPC access policy and test owner/operator behavior at shared, client-runtime, and server layers.
- Add the typed method to `WsRpcClient.server` and the web local API without weakening existing no-argument helpers.
- Update server/local API test harness mocks so missing usage services cannot accidentally reach production wiring.
- Add an RPC-level test proving only aggregate usage fields cross the boundary and typed date/time-zone errors remain recoverable RPC failures.

**Focused verification**

```sh
bun run --cwd packages/shared test -- src/rpcAccessPolicy.test.ts
bun run --cwd packages/client-runtime test -- src/authorization/capabilities.test.ts src/rpc/wsRpcClient.test.ts
bun run --cwd apps/server test -- src/ws/RpcAccessPolicy.test.ts src/server.test.ts
bun run --cwd apps/web test -- src/localApi.test.ts
```

**Commit boundary:** `feat(usage): expose owner-gated usage RPC`

### 7. Add deterministic multi-environment merge logic

**Files**

- Add `packages/client-runtime/src/usage/merge.ts`
- Add `packages/client-runtime/src/usage/merge.test.ts`
- Add `packages/client-runtime/src/usage/index.ts`
- Update `packages/client-runtime/package.json`

**Work**

- Define client-only environment terminal states and merged source presentation types.
- Claim physical `sourceId` values in deterministic order, prefer complete over partial and newer scans, and mark excluded duplicates without mutating server responses.
- Never deduplicate `environment-only` fingerprints across environments; return a warning flag instead.
- Merge included buckets by `(day, provider, model)`, preserving optional cost, priced/unpriced counts, source provenance, and deterministic ordering.
- Keep failures, stale contracts, unavailable environments, and duplicate counts alongside the aggregate.
- Add a generation helper that rejects responses from a superseded selection/request.
- Export the pure module through the package's explicit subpath exports.

**Focused verification**

```sh
bun run --cwd packages/client-runtime test -- src/usage/merge.test.ts
bun run --cwd packages/client-runtime typecheck
```

**Commit boundary:** `feat(usage): merge connected environment usage`

### 8. Extend Activity with bounded projected pull-request rows

**Files**

- Update `apps/server/src/statistics/StatisticsQuery.ts`
- Update `apps/server/src/statistics/StatisticsQuery.test.ts`

**Work**

- Extend the worktree query to join project title and select existing worktree title/branch, PR number/title/state/draft flag, and lifecycle timestamps.
- Build at most 20 `recentPullRequests`, ordered by projected `updated_at` descending with a deterministic worktree ID tie-break.
- Exclude worktrees without PR numbers.
- Keep the existing worktree totals and every existing daily/token-attribution field unchanged.
- Test missing optional PR metadata, active/archived rows, ordering, limit, and backward-compatible totals.

**Focused verification**

```sh
bun run --cwd apps/server test -- src/statistics/StatisticsQuery.test.ts
```

**Commit boundary:** `feat(statistics): expose recent projected pull requests`

### 9. Add route state, environment coordination, and the standalone page shell

**Files**

- Add `apps/web/src/routes/statistics.tsx`
- Add `apps/web/src/components/statistics/StatisticsPage.tsx`
- Add `apps/web/src/components/statistics/statisticsSearch.ts`
- Add `apps/web/src/components/statistics/statisticsSearch.test.ts`
- Add `apps/web/src/components/statistics/useUsageSummary.ts`
- Add `apps/web/src/components/statistics/useUsageSummary.test.tsx`
- Add `apps/web/src/components/statistics/useActivityStatistics.ts`
- Update `apps/web/src/environments/runtime/index.ts`
- Update generated `apps/web/src/routeTree.gen.ts`

**Work**

- Add the validated `/statistics` search shape from the specification, defaulting to Usage and 30 days.
- Canonicalize arrays and remove unknown IDs after environment/activity metadata is available while retaining inactive-tab filters.
- Render inside `SidebarInset` with the shared desktop page header, date label, tabs, filters, refresh, and scroll behavior.
- Gate the route presentation with the existing hosted capability state; server authorization remains authoritative.
- Export/subscribe to the environment connection list and request selected connected environments concurrently through each connection's own `WsRpcClient`.
- Wait for every selected environment to reach a terminal state before publishing the first aggregate.
- Preserve the last aggregate while refreshing and ignore stale request generations.
- Resolve Activity through the authoritative active/current environment only and show that environment's label.
- Generate the TanStack route tree through the existing Vite router integration rather than hand-maintaining generated types.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/components/statistics/statisticsSearch.test.ts src/components/statistics/useUsageSummary.test.tsx
bun run --cwd apps/web typecheck
```

**Commit boundary:** `feat(statistics): add standalone statistics route`

### 10. Implement the Usage dashboard

**Files**

- Add `apps/web/src/components/statistics/usage/UsageView.tsx`
- Add `apps/web/src/components/statistics/usage/UsageSummary.tsx`
- Add `apps/web/src/components/statistics/usage/UsageProviderChart.tsx`
- Add `apps/web/src/components/statistics/usage/UsageMetrics.tsx`
- Add `apps/web/src/components/statistics/usage/UsageBreakdown.tsx`
- Add `apps/web/src/components/statistics/usage/UsageCoverage.tsx`
- Add `apps/web/src/components/statistics/usage/selectors.ts`
- Add `apps/web/src/components/statistics/usage/selectors.test.ts`
- Reuse `apps/web/src/lib/statisticsFormat.ts`

**Work**

- Implement range, environment, and provider controls bound to route search state.
- Add the asymmetric cost summary/provider area chart layout with Cost/Tokens toggle.
- Use stable provider colors, shared zero baseline, translucent fills, sparse grid lines, monotone rendering, and raw daily values in tooltips.
- Show Raw API-equivalent cost, the billing disclaimer, priced/unpriced share, and cache savings without substituting `$0` for unavailable values.
- Add the five-metric rail with reasoning/output labeling.
- Add model/day breakdown with deterministic cost-or-token sorting and explicit unpriced rows.
- Add coverage counts, pricing freshness, scan age/duration, duplicate exclusions, environment-only warnings, and partial environment notices.
- Implement distinct empty states for no sources and no records in range, plus stable initial skeleton and stale refresh visuals.
- Keep selectors pure and test zero-filled dates, provider filters, pricing gaps, totals, and sort selection.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/components/statistics/usage/selectors.test.ts
```

**Commit boundary:** `feat(statistics): add usage dashboard`

### 11. Implement the Ryco-observed Activity dashboard

**Files**

- Add `apps/web/src/components/statistics/activity/ActivityView.tsx`
- Add `apps/web/src/components/statistics/activity/ActivityMetrics.tsx`
- Add `apps/web/src/components/statistics/activity/ActivityHeatmap.tsx`
- Add `apps/web/src/components/statistics/activity/ProjectActivityChart.tsx`
- Add `apps/web/src/components/statistics/activity/CodeChangesChart.tsx`
- Add `apps/web/src/components/statistics/activity/SourceControlActivity.tsx`
- Add `apps/web/src/components/statistics/activity/selectors.ts`
- Add `apps/web/src/components/statistics/activity/selectors.test.ts`
- Reuse behavior from `apps/web/src/components/settings/statistics/`

**Work**

- Extract/reuse existing statistics aggregation logic instead of duplicating it between the frozen Settings panel and the route.
- Bind range/project/model and heatmap metric controls to route search state.
- Render the five Activity KPIs from projection data.
- Add turns/active-time/files heatmap modes with exact keyboard-accessible cell values, active days, current streak, and busiest day.
- Rank projects by the selected Activity metric, never transcript usage.
- Preserve additions as positive and deletions as negative in the divergent code chart.
- Label worktree totals as all-time and render bounded projected PR rows without issuing GitHub network calls.
- Keep the UTC-day semantics of the existing Activity snapshot visible and consistent.
- Display the approved scope note separating Ryco-observed Activity from machine-wide Usage.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/components/settings/statistics/selectors.test.ts src/components/statistics/activity/selectors.test.ts
```

**Commit boundary:** `feat(statistics): separate Ryco activity dashboard`

### 12. Add desktop navigation and preserve Settings/phone compatibility

**Files**

- Update `apps/web/src/components/sidebar/SidebarChrome.tsx`
- Update `apps/web/src/components/AppSidebarLayout.tsx`
- Update `apps/web/src/components/CommandPaletteDialog.tsx`
- Update `apps/web/src/components/settings/SettingsDialog.tsx`
- Add `apps/web/src/components/settings/StatisticsMovedPanel.tsx`
- Update `apps/web/src/components/settings/settingsSearchIndex.ts`
- Update `apps/web/src/components/settings/SettingsDialog.test.ts`
- Update `apps/web/src/components/shell/phone/PhoneSettingsSurface.browser.tsx` only to assert unchanged behavior if fixture updates are required

**Work**

- Add the Statistics link to expanded and collapsed desktop sidebar chrome, hidden when the usage capability is unavailable.
- Add a command-palette Statistics action that navigates to `/statistics` on desktop.
- Replace only the desktop Settings dialog's Statistics content with a concise moved message and route action.
- Keep `SettingsSectionId = "statistics"`, the mirrored section inventory, and the phone `LazyStatisticsPanel` unchanged.
- Make a desktop Settings search selection for Statistics navigate to the route; keep phone search/section behavior unchanged.
- Add regression assertions proving hosted operators cannot see/open the destination and the phone surface still renders its existing panel.

**Focused verification**

```sh
bun run --cwd apps/web test -- src/components/settings/SettingsDialog.test.ts src/components/Sidebar.logic.test.ts
bun run --cwd apps/web test:browser -- src/components/shell/phone/PhoneSettingsSurface.browser.tsx
```

**Commit boundary:** `feat(statistics): promote statistics to desktop navigation`

### 13. Add focused browser coverage and complete validation

**Files**

- Add `apps/web/src/components/statistics/StatisticsPage.browser.tsx`
- Update nearby browser fixtures only where the new route/RPC is required

**Browser scenarios**

- Usage/Activity tabs and canonical search state.
- Cost/Tokens and model/day toggles.
- Range/environment/provider/project/model controls.
- Exact chart tooltip data and keyboard-readable heatmap cells.
- Initial skeleton, stale refresh, no source, no records, partial environment, duplicate source, stale contract, pricing unavailable, and full failure.
- Owner route access and operator denial.
- Narrow desktop layout with no horizontal page overflow.
- Reduced-motion behavior.
- Desktop Settings migration action and unchanged phone Settings statistics panel.

**Focused verification during implementation**

```sh
bun run --cwd apps/web test:browser -- src/components/statistics/StatisticsPage.browser.tsx
```

**Final repository validation**

This feature crosses contracts, server filesystem/HTTP work, RPC authorization, client-runtime merging, routing, and responsive web interaction, so run the complete backstop required for a large cross-cutting change:

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

Install the pinned Playwright Chromium runtime first with `bun run --cwd apps/web test:browser:install` only if it is not already present.

**Final handoff evidence**

- Exact changed-file list and commit sequence.
- Parser/cache/pricing/merge invariant coverage.
- Owner/operator authorization evidence.
- Browser screenshots for Usage, Activity, partial coverage, and narrow desktop layouts.
- Full validation results and any explicitly deferred provider/mobile extensions.
