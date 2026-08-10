# Usage and Activity Statistics Design

**Date:** 2026-08-10
**Status:** Approved for implementation

## Purpose

Turn Ryco's existing Settings statistics panel into a focused, standalone statistics experience with two deliberately separate views:

- **Usage** reports provider-recorded token usage from Claude and Codex transcript files found on connected environments, including sessions that did not run through Ryco. It adds API-equivalent estimated cost, cache savings, provider/model trends, and explicit coverage information.
- **Activity** preserves and improves Ryco's existing project, conversation, worktree, code-change, and source-control statistics. It remains limited to activity observed by Ryco.

The split prevents machine-wide transcript usage from being falsely attributed to a Ryco project while retaining the project and GitHub-style activity signals that already make Ryco's dashboard useful.

## Goals

- Make statistics a first-class desktop/web destination instead of a dense page inside Settings.
- Count provider-recorded tokens from supported Claude and Codex transcript formats across connected environments.
- Clearly distinguish measured token counts from estimated monetary values.
- Estimate base-tier API-equivalent cost and cache savings without implying subscription billing accuracy.
- Reuse Ryco's current activity projections for project, model, turn, file, worktree, and pull-request insights.
- Present charts with a calmer, more legible visual hierarchy inspired by T3Code's latest usage design.
- Preserve privacy by keeping raw transcript contents on the environment where they were written.
- Remain reliable when transcripts, pricing, scan caches, or individual environments are unavailable.
- Keep parsing, normalization, pricing, caching, and multi-environment merge logic testable outside React.

## Non-goals

- Reconstructing prompts, responses, tool calls, commands, file contents, or other transcript content in the UI.
- Assigning machine-wide Claude or Codex transcript usage to Ryco projects, worktrees, or threads.
- Replacing provider billing portals or claiming that API-equivalent estimates equal invoice, credit, plan, or subscription charges.
- Supporting GitHub Copilot, OpenCode, Cursor, or future provider transcript formats in the first delivery.
- Fetching additional pull-request data directly from GitHub for the Activity page.
- Changing hosted lifecycle ownership, authorization readiness, relay behavior, PWA caching, or reconnect policy.
- Extending or removing the frozen `apps/web` phone presentation tier.
- Implementing the native `apps/mobile` statistics experience in this delivery.

## Reference Audit

### Existing Ryco statistics

Ryco currently returns one activity bucket per `(UTC date, project, provider, model)` from existing projection tables through `server.getStatistics`. The snapshot includes token fields, turns, active time, tool uses, files changed, additions, deletions, threads, and worktree/source-control totals. Exact per-turn token deltas are preferred; older or provider-limited threads fall back to cumulative thread totals.

The current `StatisticsPanel` renders this data inside Settings with KPI cards, token and code-change charts, provider/model/project breakdowns, a contribution-style heatmap, and worktree totals. That information remains valuable, but the Settings dialog constrains hierarchy and encourages token usage and project activity to be treated as one data set.

### T3Code usage implementation

T3Code's post-`v0.0.32` usage work on `main` and the `v0.0.33` nightly establishes the reference behavior for transcript scanning:

- scan local Claude and Codex JSONL transcripts instead of relying only on app-created sessions;
- deduplicate repeated Claude assistant usage records by provider message/request identity;
- interpret Codex `last_token_usage` as per-record deltas, carry the preceding turn model, ignore copied fork/subagent history bursts, and suppress identical duplicate token payloads;
- normalize uncached input, cached input, cache creation, output, reasoning, provider, model, session, and timestamp;
- cache per-file parse results by path, provider, file size, and modification time;
- price recognized models from the LiteLLM pricing table with a bounded cache;
- merge connected-environment buckets in the client while deduplicating shared transcript directories; and
- show partial coverage and pricing freshness rather than silently presenting incomplete totals.

Ryco adopts these principles while fitting them to its contracts, Effect server services, connected-environment runtime, existing owner-only statistics policy, and separate Activity data source.

References:

- [T3Code repository](https://github.com/pingdotgg/t3code)
- [T3Code usage pull request #5684](https://github.com/pingdotgg/t3code/pull/5684)
- [LiteLLM model pricing data](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)

## Product Model

### One destination, two scopes

The desktop/web application adds a standalone `/statistics` route. The page header contains a **Usage / Activity** segmented tab control. Usage is the default view.

The selected view and primary filters are encoded in validated route search state so reload, back/forward navigation, and copied links preserve the current analysis. The search shape is:

- `view=usage|activity`, default `usage`;
- `range=7d|30d|90d|all`, default `30d`;
- optional `environmentIds[]` and `providers[]`, with omission meaning all currently connected/supported values;
- optional `projectId`, `model`, and `modelProvider` for Activity;
- `usageMetric=cost|tokens`, default `cost`;
- `usageBreakdown=model|day`, default `model`; and
- `activityMetric=turns|activeMs|files`, default `turns`.

Inactive-view filters are preserved when switching tabs. Arrays are sorted before navigation so equivalent selections produce one canonical URL. Invalid enum values use the defaults; unknown environment/project/model IDs are ignored and the URL is replaced with its normalized form rather than failing the route.

The two views intentionally answer different questions:

| View | Question | Data scope | Main filters |
| --- | --- | --- | --- |
| Usage | How many provider-recorded tokens were processed, and what would comparable base API usage cost? | Supported transcript files on selected connected environments | Range, environments, providers |
| Activity | What work did I do through Ryco? | Ryco projection state on the current environment | Range, project, model |

Usage never exposes a project filter. Activity never claims machine-wide coverage. A persistent scope note appears in each view, not only in a tooltip.

### Navigation and Settings compatibility

- Add **Statistics** as a non-phone desktop/web sidebar destination near the existing update/footer controls.
- Add a corresponding collapsed-sidebar icon so the route remains reachable when the sidebar is hidden.
- Preserve the existing hosted role gate: statistics are available to local users and hosted owners, not hosted operators.
- Keep `SettingsSectionId = "statistics"` and the frozen phone Settings statistics surface intact. The phone tier is neither extended nor deleted by this work.
- On the desktop Settings dialog, the existing Statistics entry becomes a lightweight migration surface with an **Open Statistics** action instead of rendering a second full dashboard. Existing calls to `openSettings("statistics")` therefore remain valid.
- The command palette and settings search result for Statistics navigate to `/statistics` on the desktop tier. Phone behavior stays unchanged.

### Authorization

The route uses the same availability rule as the current Statistics Settings section:

- local and direct/saved-environment clients may read statistics from environments they are already authorized to use;
- hosted owners may read statistics;
- hosted operators cannot open the destination or invoke its RPCs; and
- the new RPC methods do not grant filesystem access beyond the existing authenticated server boundary.

Authorization is enforced in server RPC registration as well as navigation visibility. Hiding the route is not the security boundary.

## Data Architecture

### Deliberately separate server paths

Usage and Activity remain separate through transport and presentation:

```text
Claude/Codex transcript files
        │
        ▼
  Usage provider adapters ──► local parse cache ──► usage buckets
        │                                             │
        └── raw content stays on node                  ▼
                                            multi-environment merge
                                                       │
                                                       ▼
                                                   Usage view

Ryco projection tables ──► existing StatisticsQuery ──► Activity view
```

`UsageService` is a new server capability. `StatisticsQuery` remains the Activity source. Their buckets are not joined, and transcript session identifiers are not compared with Ryco thread identifiers.

### Package ownership

- `packages/contracts` owns schemas for the usage request, bucket, source coverage, pricing status, response, and typed read failures. It contains no scanning or pricing logic.
- `apps/server/src/usage` owns transcript discovery, provider adapters, normalization, deduplication, aggregation, pricing, the durable scan cache, and the `UsageService` Effect layer.
- `apps/server/src/statistics/StatisticsQuery.ts` continues to own projection-backed Activity queries. It is extended only for bounded source-control rows needed by the Activity presentation.
- `packages/client-runtime` owns typed usage RPC access and environment-neutral merge helpers. It remains free of DOM and React Native imports.
- `apps/web` owns routing, connected-environment request coordination, route search state, selectors, charts, loading/error presentation, and the Usage/Activity page.
- `packages/shared` receives a helper only if the same pure merge or pricing-normalization logic has a second runtime consumer. No duplicate server/web algorithm is introduced merely to create a shared module.

## Usage Contracts

The transport model reports normalized, already aggregated values. It does not transport transcript records.

### Request

`UsageSummaryRequest` contains:

- optional `startDate` and required `endDate`, inclusive local calendar dates in `YYYY-MM-DD` form;
- `timeZone`, the browser's IANA time-zone identifier; and
- `contractVersion`, allowing a client to identify incompatible environments before merging data.

The client derives these dates from the selected `7d`, `30d`, `90d`, or `all` range. For `all`, the request omits `startDate` and each node scans all retained/discoverable transcripts; the UI displays the earliest returned day. `endDate` defaults to today in the requested time zone.

The server validates calendar dates, ordering, and the time zone. It returns a typed `invalid-window` or `invalid-time-zone` failure instead of an empty success.

### Normalized totals

`UsageTokenTotals` contains non-negative finite numbers:

- `uncachedInputTokens`
- `cachedInputTokens`
- `cacheCreationInputTokens`
- `outputTokens`
- `reasoningTokens`
- `totalTokens`

`reasoningTokens` is always normalized as an informational subset of `outputTokens` and must not exceed it. If a provider reports reasoning separately, the adapter folds it into output exactly once. The UI labels this relationship explicitly and never adds reasoning to output a second time. `totalTokens` must equal `uncachedInputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens`.

### Daily buckets

`UsageDailyBucket` contains:

- opaque `sourceId`, retained until client merge so duplicate physical sources can be excluded before aggregation;
- `date`, expressed in the requested time zone;
- `provider`, initially `claude` or `codex`;
- normalized `model` plus the raw provider model string when normalization changed it;
- `tokens`;
- `responseCount` and `sessionCount`;
- `estimatedCostUsd` and `estimatedCacheSavingsUsd`, optional when pricing is unavailable;
- `pricedTokenCount` and `unpricedTokenCount`; and
- `costSource`, one of `provider-reported`, `litellm`, `mixed`, or `unpriced`.

Provider-reported cost is used when a transcript supplies a trustworthy cost for the same usage record. LiteLLM fills only records without provider cost. Mixed buckets retain both contributions and expose `costSource = "mixed"`.

An adapter treats provider cost as trustworthy only when it comes from a documented provider field, is a finite non-negative number, and can be normalized to the same response delta as the token record. A cumulative session cost is converted to a validated non-negative delta or ignored; it is never summed as though every cumulative value were independent.

### Coverage and pricing metadata

`UsageSourceCoverage` identifies a source without exposing a private absolute path. It contains:

- a stable opaque `sourceId` derived from a versioned hash of server hostname, provider, canonical transcript root, and filesystem identity;
- `deduplicationKind`, either `physical` when filesystem identity is available or `environment-only` when it is not;
- provider;
- status: `complete`, `not-found`, `partial`, or `failed`;
- transcript file count, reused cache file count, parsed file count, skipped line count, and malformed line count;
- distinct session/response counts;
- scan start/finish timestamps and duration; and
- a short user-safe diagnostic code/message when status is not complete.

`UsagePricingStatus` contains `live`, `cached`, or `unavailable`, the source revision/fetch timestamp when known, cache age, and the number of recognized/unrecognized models. It never includes the whole pricing table in the response.

`UsageSummary` contains the contract version, requested time zone/window, buckets, source coverage, pricing status, scan duration, and generation timestamp.

Client-runtime wraps each node response in a `UsageEnvironmentResult` with its environment ID/label and terminal status: `complete`, `partial`, `failed`, `unavailable`, or `stale-contract`. A merged source view adds `included` plus an optional client-derived exclusion reason such as `duplicate`. These coordination states are not fabricated as server source statuses.

`distinctSessions` in coverage is the value used for summary totals. Per-bucket session counts are informative for a single row but are not summed across days/models because one session may span several buckets.

### Typed failures

The usage RPC distinguishes:

- `invalid-window`
- `invalid-time-zone`
- `scan-failed`
- `unauthorized`

Individual source or file failures normally produce a successful partial summary with coverage metadata. `scan-failed` is reserved for a node-level failure that prevents a meaningful summary, such as an unreadable provider configuration root combined with no usable source.

## Transcript Discovery and Provider Adapters

### Discovery

Each adapter owns its supported default transcript locations and any provider-specific configuration/environment overrides. Discovery resolves paths on the server node and streams files rather than reading whole transcript trees into memory.

Before parsing, the scanner applies the requested date window using file modification time with a 36-hour slack on either boundary. The slack prevents time-zone offsets, delayed writes, and long-running sessions from excluding relevant records. A parsed record's timestamp remains authoritative for bucket inclusion.

Symlink/canonical path handling must not allow the same physical transcript root to be scanned repeatedly. File traversal is bounded to known provider transcript roots and supported JSONL file patterns; no general home-directory search is performed.

### Adapter interface

Each provider adapter implements one shared internal shape:

- provider kind and discovery roots;
- a streaming JSONL record decoder;
- provider-specific record deduplication;
- normalization into timestamp, model, session key, response key, token categories, optional cost, and a dedupe key;
- fork/history suppression where the format requires it; and
- parser/format version for cache invalidation.

Malformed JSON, unknown event kinds, and unsupported fields are skipped independently. They increment separate counters so format drift is visible without turning normal irrelevant transcript events into errors.

### Claude normalization

The Claude adapter:

- accepts assistant usage records from supported Claude Code JSONL formats;
- deduplicates repeated streamed assistant content by provider message ID plus request ID, with a deterministic fallback key only when those identifiers are absent;
- preserves distinct retries/responses even when their token totals are identical;
- separates uncached input, cache-read input, cache-creation input, output, and any explicit reasoning subset;
- carries the model reported on the assistant message; and
- treats a missing transcript directory as `not-found`, not as an error.

The fallback dedupe key is scoped to a transcript/source and based on stable metadata, never prompt or response text.

### Codex normalization

The Codex adapter:

- uses `token_count` events containing `last_token_usage`, not cumulative `total_token_usage`, as the per-event token source;
- uses the most recent preceding `turn_context` model for the record;
- suppresses copied token-history bursts at fork/subagent boundaries;
- drops repeated identical token payload events when they refer to the same turn/update;
- normalizes cached input, uncached input, output, and reasoning without double-counting reasoning inside output; and
- keeps distinct turns even when their token totals happen to match.

Tests, not filename assumptions, define the supported fork/history sequences. Unknown future event variants are skipped and counted until an adapter update adds support.

## Durable Scan Cache

The usage scanner stores a versioned local cache under the server's existing state directory. Raw JSONL lines and transcript text are never written into this cache.

Each entry is keyed by:

- canonical file path hash;
- provider kind;
- file size;
- nanosecond or highest available modification time; and
- adapter/cache schema version.

The value contains normalized records and local-only dedupe metadata needed to rebuild daily buckets. Provider message, request, and session identifiers are hashed before persistence. The RPC receives aggregate counts only.

Cache behavior:

- unchanged files reuse their cached parse;
- a size or modification-time change reparses the file;
- a read or parse failure is not cached as an empty success;
- a corrupt cache file is discarded and rebuilt;
- a cache write failure degrades performance only and does not fail the usage response;
- writes are atomic through a temporary file and rename in the same directory;
- cache entries not seen for 90 days are pruned after a successful scan; and
- changing an adapter or schema version invalidates only affected entries.

The cache is performance infrastructure, not the source of truth. Deleting it must produce the same summary after a cold rescan.

## Pricing and Cost Semantics

### Pricing source

The server fetches LiteLLM's public `model_prices_and_context_window.json` as the initial base pricing source. The response is validated and reduced to recognized provider/model rates before being cached locally for 24 hours.

Pricing resolution follows this order per normalized usage record:

1. use a trustworthy provider-reported cost for that record;
2. otherwise use a normalized exact model match in the validated LiteLLM table;
3. otherwise use an explicitly tested provider-prefix/model-alias match;
4. otherwise leave the record unpriced.

There is no nearest-model or family-average guess. Unknown models remain visible in tokens and contribute to the unpriced share.

### Cost formula

For LiteLLM-priced records, cost uses the source's per-token base rates for non-overlapping categories:

```text
estimated cost =
  uncached input × input rate
  + cached input × cache-read rate
  + cache creation input × cache-creation rate
  + output (including reasoning when reported as a subset) × output rate
```

If a pricing source lacks a distinct cache rate, the affected category is unpriced unless the source explicitly documents the fallback. Ryco does not silently apply ordinary input pricing to cache reads.

Cache savings estimates compare cached/cache-created input cost with the equivalent uncached input cost only where both required rates exist. A negative calculated saving is clamped to zero and recorded as a pricing anomaly in server diagnostics, not displayed as a saving.

### User-facing language

The primary monetary label is **Raw API-equivalent cost**. The summary always includes: “Estimate based on base API rates. Subscription, credits, batch, negotiated, and provider billing may differ.”

Tokens are described as **provider-recorded**, not estimated. Cost and cache savings are described as estimates. When some records are unpriced, totals use “priced portion” language and show the unpriced token percentage beside the value.

### Pricing failure behavior

- A live fetch failure falls back to the most recent valid cached table, labeled `cached` with its age.
- If no valid table exists, token statistics still load and pricing-dependent values render as unavailable.
- An invalid or partial download never overwrites the last valid cache.
- Pricing refresh is shared and single-flight per server process to avoid one fetch per client/environment request.

## Multi-environment Coordination

### Request lifecycle

The Usage view resolves the currently connected, authorized environments from the existing client runtime. It sends the same range and IANA time zone to selected environments concurrently through their existing RPC transports.

The UI keeps the prior successful aggregate visible during refresh, marks it stale, and replaces it only when every selected environment reaches a terminal state: success, partial success, incompatible, failed, or unavailable. On the initial load it shows a stable skeleton until terminal resolution, avoiding totals that jump as nodes finish at different times.

An environment response is not accepted after its selection/request generation becomes stale.

### Deduplication

Connected environments can expose the same physical transcript directory. The server derives an opaque fingerprint without transporting the private path:

```text
physical sourceId = SHA-256(version + hostname + provider + canonical root + device:inode)
```

The client compares `sourceId` values before merging buckets. The hostname and canonical root are server-local inputs and never appear in the RPC. Filesystem identity uses the best available device/inode or platform equivalent. It makes an accidental match across two hosts that share a hostname and home path impractical.

When filesystem identity cannot be read, the server derives an environment-scoped ID from `version + environmentId + provider + canonical root` and returns `deduplicationKind = "environment-only"`. The client does not deduplicate that source across environments and shows a coverage warning that duplicates could not be ruled out. This prefers a visible risk of double counting over silently dropping legitimate usage from a different host.

For duplicate sources, one deterministic winner contributes buckets and all other copies are marked `duplicate`. Winner selection sorts by complete over partial, newest scan completion, then environment ID. The coverage footer states how many duplicate sources were excluded.

### Merge invariants

Pure client-runtime merge helpers:

- include buckets only from compatible, selected, non-duplicate sources;
- sum only matching `(local day, provider, model)` buckets;
- preserve priced and unpriced token counts separately;
- never convert missing cost to zero;
- produce deterministic ordering independent of response timing;
- surface environment/source failures separately from a successful aggregate; and
- calculate displayed coverage from included sources, not requested-source count.

A stale contract environment is excluded with an update-required notice rather than decoded best-effort.

## Activity Data and Contract Changes

Activity continues to call the current environment's `server.getStatistics`. “Current” means the environment selected by the authoritative shell/client-runtime state, using the same fallback as existing project and thread surfaces. The Activity header shows that environment's label, and a shell environment change triggers a new Activity read. Activity does not fan out across connected environments in the first delivery because project IDs and projection ownership are node-local.

The existing `StatisticsSnapshot` remains backward compatible. The UI stops foregrounding its token charts because Usage is the authoritative machine-wide token view, but existing token fields and attribution remain in the contract for compatibility and possible diagnostics.

The snapshot is extended with at most 20 `recentPullRequests`, ordered by projected source-control update time descending. Each row contains data already present in `projection_worktrees` and its project join:

- worktree ID and display title/branch;
- project ID and title;
- PR number;
- optional PR title;
- optional PR state and draft flag;
- created/updated/archived timestamps; and
- whether the worktree is active.

No network request to GitHub is added. Rows with no PR number are not included. Missing titles or states render as absent metadata rather than guessed values.

Activity range filtering stays client-side over the returned daily buckets. Worktree summary counts remain lifetime/current-state figures and are labeled **All-time worktrees** so a selected 7/30/90-day range is not misapplied to them. Recent PR rows are current projected records, not claimed to be range-scoped.

## Interface Design

### Shared page frame

The standalone page uses the main content canvas rather than a modal:

- page title **Statistics** and a short scope-aware subtitle;
- right-aligned date/window label and refresh action;
- Usage/Activity segmented tabs immediately below the title;
- a restrained filter row beneath the tabs;
- a wide content grid with approximately 24 px desktop gutters and consistent 16–20 px card padding;
- flat, low-contrast panels with one border level and no card-inside-card nesting; and
- a maximum readable width while allowing the primary chart to use the available workspace.

Charts reuse the application theme and existing visualization dependencies. Provider colors are stable across the Usage chart, provider bars, rows, and tooltips. Activity charts reuse project colors only where they improve recognition; the heatmap stays a single sequential scale.

The first delivery targets the desktop presentation tier. At narrower non-phone desktop widths, two-column areas collapse to one column without hiding metrics or requiring horizontal page scrolling. The frozen phone tier remains unchanged.

### Usage view

The Usage filter row contains:

- range: `7 days`, `30 days`, `90 days`, `All time`;
- environment multi-select with **All connected** default; and
- provider multi-select for Claude and Codex.

The first content band is asymmetric:

- **Left summary:** large Raw API-equivalent cost, pricing disclaimer, estimated cache savings, priced/unpriced share, and compact provider contribution bars.
- **Right chart:** layered provider area chart with a `Cost / Tokens` metric toggle.

The chart uses a shared zero baseline, translucent non-gradient area fills, monotone line smoothing, sparse grid lines, and exact raw values in the hover tooltip. Smoothing is visual only; tooltips and aggregates use original daily buckets. Missing days are inserted as zero only between the selected window boundaries. A provider can be toggled through the filter, not by ambiguous chart-click state.

A metric rail follows with five metrics:

- processed tokens;
- cached input;
- uncached input;
- output, labeled **includes reasoning** when reasoning is present; and
- estimated cache savings.

The lower section contains a `Breakdown` control switching between **By model** and **By day**. The table displays model/day, provider, API-equivalent cost, share, processed tokens, response count, cache rate, and unpriced status. It uses deterministic sorting by cost when fully priced and by processed tokens when cost is incomplete. The sort basis is shown in the column header.

The coverage footer shows:

- included/selected environments;
- included sources and deduplicated sources;
- sessions and responses;
- parsed, cached, malformed, and skipped file/line counts;
- scan duration and completion time;
- pricing state and age; and
- unpriced token share.

Warnings are concise inline notices above this footer. The dashboard remains usable when a warning is present.

### Activity view

The Activity filter row contains:

- range: `7 days`, `30 days`, `90 days`, `All time`;
- project single-select with **All projects** default; and
- model single-select with **All models** default.

The top KPI rail contains:

- active time;
- turns;
- chats;
- tool uses; and
- files changed.

The contribution-style activity panel is the dominant element. It supports **Turns / Active time / Files** metric toggles. It shows weekday/month anchors, an accessible sequential legend, and summary values for active days, current streak, and busiest day. Every cell exposes its calendar date and exact metric value in keyboard-accessible tooltip/label text. Activity preserves the current snapshot's UTC-day semantics; changing Activity bucketing to browser-local days is outside this delivery.

Below the heatmap:

- **Project activity** uses horizontal bars ranked by turns. The selected metric may be changed to active time or files, but transcript tokens are not used for project ranking.
- **Code changes** uses a divergent daily chart with additions above the baseline and deletions below it, plus visible totals. Additions and deletions are never collapsed into a single unsigned magnitude.
- **Source control** shows all-time active, created, archived, and open-PR worktree totals, followed by the bounded projected recent-PR rows. Row copy names the project/worktree and PR number; it includes title/state only when projected.

A visible note reads: “Activity includes work observed by Ryco on this environment. Usage from other CLI sessions appears in the Usage tab and is not assigned to projects.”

### Empty, loading, and error presentation

- Initial Usage load uses stable page-shaped skeletons until all selected environments are terminal.
- Initial Activity load uses the existing statistics skeleton pattern.
- Refresh keeps the last successful snapshot visible, adds a stale/refreshing indicator, and never clears charts to zero.
- A complete empty state explains where Claude/Codex transcripts are expected and distinguishes `no records in range` from `no transcript source found`.
- Partial data shows results plus source/environment notices.
- A full usage failure names affected environments and offers retry without exposing filesystem paths.
- Pricing unavailable removes or marks monetary charts/columns; it does not replace them with `$0`.
- Activity query failure preserves its last success independently from Usage state.
- Unsupported providers are not silently listed with zero usage.

## Reliability and Failure Semantics

- Missing default transcript directories are normal `not-found` coverage.
- A malformed JSONL line is skipped and counted; it cannot fail its file or scan.
- A file read failure marks its source partial/failed and is never cached as zero records.
- A corrupt scan cache is discarded and rebuilt from transcripts.
- A scan cache write failure affects performance only.
- A pricing live-fetch failure uses the last valid cache; absence of both live and cached pricing leaves costs unavailable.
- A failed environment is excluded from totals and named in coverage.
- A stale-contract environment is excluded and shown as requiring an update.
- Duplicate physical roots contribute once.
- A refresh generation that is no longer current cannot publish buckets, coverage, or loading completion.
- Invalid range/time-zone input is an explicit typed error, not an empty result.
- An unreadable provider override/configuration is surfaced explicitly when it prevents discovery.
- A pricing or transcript failure cannot alter connection readiness, provider lifecycle, or mutation authority.

## Privacy and Security

- Raw transcript JSON, prompts, completions, tool arguments/results, commands, file contents, and private absolute paths never cross the usage RPC.
- Logs and coverage diagnostics use provider, counts, opaque source IDs, and user-safe error categories. They do not print transcript lines.
- Persisted scan-cache identifiers are hashed; normalized cache values contain token metadata only. Transport buckets carry only the opaque `sourceId` required for deduplication.
- The pricing cache contains only public pricing data and freshness metadata.
- Usage scanning is read-only and restricted to resolved supported-provider transcript roots.
- Existing RPC authentication, hosted owner authorization, and environment transport security apply unchanged.
- Statistics data is not written to the production service worker or any browser offline cache.
- No private Hub identifiers, paths, credentials, or operational evidence enter the public repository or UI payloads.

## Performance Requirements

- JSONL parsing is streaming and bounded; the scanner never loads the whole transcript tree into memory.
- File work is concurrency-limited to avoid saturating disk and the server event loop.
- Unchanged files use the durable cache.
- Pricing fetch is process-shared and single-flight.
- Client requests selected environments concurrently.
- Aggregation occurs while records are consumed; React receives daily buckets, not response-level records.
- The UI memoizes pure filter/selectors and virtualizes only if a measured table size warrants it; the bounded model/day table does not add virtualization by default.
- Chart animation is short and finite, disabled under reduced motion, and not replayed on unrelated filter-state changes.
- A representative warm-cache fixture must demonstrate that unchanged transcript files are not reopened for parsing.

No fixed timing target is claimed without repeatable fixture hardware. Regression tests assert bounded work and cache reuse rather than brittle wall-clock thresholds.

## Testing Strategy

### Provider parser fixtures

Claude fixtures cover:

- repeated assistant content blocks with the same message/request identity;
- distinct retries with equal token totals;
- cache-read and cache-creation tokens;
- model changes;
- missing identifiers and deterministic fallback dedupe;
- malformed and irrelevant lines; and
- provider-reported cost.

Codex fixtures cover:

- `last_token_usage` deltas versus cumulative totals;
- consecutive duplicate payloads;
- equal totals across distinct turns;
- preceding `turn_context` model changes;
- cached input and reasoning subsets;
- fork/subagent copied-history suppression;
- malformed and unknown event variants; and
- session boundaries.

### Aggregation and pricing tests

- Local-day bucketing across multiple IANA time zones, DST transitions, and midnight boundaries.
- Inclusive range behavior and the 36-hour file-mtime prefilter slack.
- Cross-file deduplication.
- Token invariants and no reasoning double count.
- Provider-reported cost precedence.
- Exact model and explicit alias pricing resolution.
- Unknown model behavior and unpriced percentages.
- Cached-input savings and no fabricated savings when rates are incomplete.
- Live, cached, invalid, expired, and unavailable pricing states.

### Cache tests

- Cold parse and warm reuse.
- File size/mtime invalidation.
- Adapter/schema version invalidation.
- Corrupt cache recovery.
- File read failure not cached as empty.
- Atomic-write failure degrading to a successful uncached response.
- 90-day pruning without deleting current entries.
- Equivalent cold and warm summaries.

### Service and RPC tests

- Temporary Claude/Codex transcript roots produce the expected `UsageSummary`.
- Missing roots return `not-found` coverage.
- Mixed usable and unreadable sources return partial success.
- Invalid date/time-zone input returns typed failures.
- Unauthorized operator access is rejected at the server boundary.
- Only aggregate schemas cross the RPC.
- Pricing refresh is single-flight.

### Client merge tests

- Duplicate source roots across environments contribute once.
- Same path on distinct hosts is not deduplicated.
- Winner selection is deterministic.
- Stale contracts and failed environments are excluded with notices.
- Response order does not change merged output.
- A superseded request generation cannot publish.
- Initial results publish only after every selected environment is terminal.
- Refresh preserves the last success.
- Priced and unpriced values merge without treating absence as zero.

### Activity regression tests

- Existing daily totals and token-attribution behavior remain valid.
- Heatmap selectors work for turns, active time, and files.
- Project/model/range filtering does not mutate source snapshots.
- Project activity ranks by the selected Activity metric, not transcript tokens.
- Divergent additions/deletions remain signed and correctly totaled.
- Worktree totals remain labeled all-time.
- Recent PR rows are bounded, projection-only, and correctly ordered.

### Focused browser tests

- Route access and owner/operator authorization.
- Usage/Activity tab and route-search persistence.
- Range, environment, provider, project, and model filters.
- Cost/Tokens chart toggle and table breakdown toggle.
- Tooltip exact values and heatmap keyboard labels.
- Stable initial loading, stale refresh, empty, partial, pricing-unavailable, and full-error states.
- Narrow desktop layout without horizontal page overflow.
- Reduced-motion chart behavior.
- Desktop Settings migration action and unchanged frozen phone Settings behavior.

## Rollout and Migration

1. Add usage schemas, adapters, cache, pricing, service, and focused server tests behind the new RPC without changing the current statistics panel.
2. Add client-runtime usage access, connected-environment coordination, merge helpers, and tests.
3. Add the standalone `/statistics` route and Usage view.
4. Refactor existing statistics components into the Activity view, add recent projected PR rows, and retain `StatisticsSnapshot` compatibility.
5. Add desktop navigation and the desktop Settings migration action while leaving the frozen phone surface unchanged.
6. Run focused type, unit, contract, and browser checks for affected packages. Expand validation only if implementation crosses additional runtime boundaries.

The transcript scan cache is additive and disposable, so it needs no user-data migration. Its schema version handles future parser changes.

## Acceptance Criteria

- `/statistics` is a first-class desktop/web route with Usage and Activity views.
- Usage defaults to all connected authorized environments and supported providers.
- Supported Claude and Codex transcripts outside Ryco sessions contribute to Usage.
- Provider-recorded token counts are deduplicated according to adapter fixtures.
- Monetary values are explicitly API-equivalent estimates with provider-reported cost precedence, pricing freshness, and unpriced share.
- Raw transcript content and absolute paths remain local to the server node.
- Shared transcript roots across environments contribute once.
- Partial, stale-contract, missing-source, pricing-unavailable, and failed-environment states are visible without converting missing values to zero.
- Activity preserves project/model/range analysis, heatmap, code changes, and worktree/source-control context from Ryco projections.
- Activity does not claim or display transcript-derived project attribution.
- Existing hosted owner/operator authorization remains enforced at the RPC boundary.
- The frozen web phone tier is unchanged.
- Focused parser, aggregation, pricing, cache, service, merge, Activity, and browser tests pass.

## Deferred Extensions

- Additional provider adapters after stable transcript formats and fixtures are available.
- Native `apps/mobile` Statistics screens built on the same contracts/client runtime.
- Server-side Activity range filtering if projection size makes the current snapshot materially expensive.
- Project attribution only if a future provider supplies an explicit, trustworthy project/workspace identity that can be joined without guessing.
- Direct provider billing integrations, negotiated pricing, subscription utilization, or credit accounting as separate, explicitly sourced cost modes.
