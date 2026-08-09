# Pull Request AI Intelligence Design

**Date:** 2026-08-09
**Status:** Approved design, pending written-spec review
**Scope:** Advisory AI prioritization and pull request analysis for the dedicated Pull Requests page

## Goal

Add an explainable, model-selectable AI intelligence layer to the canonical Pull Request inbox.
The feature ranks the user's current inbox scope, deeply analyzes the most important pull requests,
and provides concise implementation summaries, attention reasons, review hotspots, suggested next
actions, and an evidence-backed merge-readiness score.

The feature is advisory. It never approves, merges, comments on, edits, closes, or otherwise mutates
a pull request.

## Product Principles

1. Provider truth and AI judgment remain separate.
2. Every AI result names its model, source freshness, confidence, and reasoning.
3. Expensive analysis is bounded, cancellable, cached, and skipped when inputs have not changed.
4. Manual analysis works before background scheduling is enabled.
5. Background analysis is opt-in and targets only actively relevant pull requests.
6. A model failure cannot prevent normal pull request browsing.
7. Pull request content is untrusted input and receives no mutation or tool authority.

## User Experience

### Priority Workspace

The Pull Requests page gains a first-class `Priority` inbox view. It appears as a purposeful
first-run state before the first analysis and becomes a ranked list after results exist.

The first-run state contains:

- the selected environment/model plan;
- the current view and PR count that will be analyzed;
- the configured shallow and deep analysis limits;
- an `Analyze current view` action;
- a short privacy explanation that PR content may be sent to the selected model provider.

After analysis, the PR list shows:

- priority rank;
- `urgent`, `high`, `normal`, or `low` priority;
- one short reason for the position;
- analysis freshness and stale state;
- the existing repository, PR number, provider state, checks, review, author, and unread signals.

Selecting a row preserves the ranked-list context. The selected PR detail begins with an AI
briefing containing:

- a two-to-three sentence implementation summary;
- implementation phase;
- why the PR needs attention;
- suggested next action;
- risk and confidence;
- merge readiness with its factor breakdown;
- review hotspots linked to the Files workspace when a provider can supply file data.

Overview, checks, commits, files, review activity, and related Ryco work remain available. AI
supplements these surfaces rather than replacing them. Deterministically ordered inbox views such
as Latest and Assigned may display a quiet cached priority marker, but AI does not reorder them.

### Manual Actions

The page exposes:

- `Analyze current view`;
- `Analyze this PR`;
- `Stop analysis` while the current user-owned run is active;
- model selection using enabled Ryco provider instances and models;
- progress for ranking, deep analysis, cached/skipped items, completed items, and failures.

`Analyze current view` freezes the current filtered PR IDs before starting. Later route, search, or
filter changes do not silently change the in-flight scope. A manual single-PR run always performs a
deep analysis unless a current matching cache entry already exists and the user did not request a
forced refresh.

### Model Selection Across Environments

Provider instance IDs and model availability are environment-local. Each connected environment
therefore owns its PR-analysis model selection and execution policy.

For a view spanning multiple environments, Ryco shows the run plan before execution. Each
environment uses its configured model and analyzes only its canonical PR IDs. When every target
environment has the same display model, the header shows one model label. Otherwise it shows the
number of models/environments and provides the per-environment mapping in a disclosure.

Federated ranking consumes the normalized result schema from each environment and retains the
model label on each result. A server never sends private PR content to another Ryco environment for
analysis.

## Analysis Outputs

Each cached per-PR result contains:

- canonical pull request ID;
- priority score from 0 through 100;
- priority category;
- priority explanation;
- risk level and evidence;
- concise implementation summary;
- implementation phase;
- attention reason;
- suggested next action;
- zero or more review hotspots, each with an optional file path and explanation;
- merge-readiness score, confidence, factors, and caps applied;
- overall confidence;
- selected model identity;
- prompt and result-schema versions;
- source fingerprint and provider update time;
- creation and expiration timestamps.

Implementation phase is one of:

- `early-work`;
- `active-implementation`;
- `validation-cleanup`;
- `review-ready`;
- `blocked`;
- `uncertain`.

The model must provide evidence for risk, implementation phase, and hotspots. The UI omits an
unsupported claim rather than fabricating content.

## Two-Stage Pipeline

### Candidate Planning

The client freezes the current view to canonical PR IDs and partitions them by environment. Each
server validates that the requested IDs exist in its owner-authorized inbox and enforces its local
resource limit.

Before model execution, the server calculates an input fingerprint and reuses an unexpired result
when all of the following match:

- canonical PR ID;
- viewer key;
- provider instance and model;
- model options that affect output;
- prompt version;
- result-schema version;
- source fingerprint.

### Stage One: Inbox Ranking

The server builds a bounded metadata packet for at most the configured inbox limit, 25 by default.
It includes canonical identity, title, description excerpt when already available, lifecycle and
draft state, viewer relationship, associations, recency/unread state, branches, labels, checks,
reviews, changed-file counts when known, and previous analysis freshness.

One or more bounded batch calls ask the selected model for the model-derived priority components,
risk, a shallow summary, implementation phase, attention reason, and suggested next action. A batch
never contains more than 25 PRs.

### Stage Two: Deep Analysis

Ryco chooses the top configured subset, eight PRs by default, after combining deterministic and
model-derived priority. For these PRs it fetches provider detail and supplies bounded content:

- PR description;
- commit subjects and authors;
- changed-file metadata;
- checks and reviews;
- recent review discussion;
- bounded diff hunks selected across the largest-risk files.

Per-PR deep calls produce the final summary, implementation phase, risk evidence, attention reason,
suggested next action, review hotspots, and the AI-controlled merge-readiness factors. Provider
content is truncated by field and by total encoded input size. Diff selection records which files
and hunks were omitted so the result can lower confidence.

PRs outside the deep subset retain their stage-one result. Opening one and selecting `Analyze this
PR` upgrades it to a deep result.

### Input Fingerprint and Staleness

The fingerprint hashes the normalized data actually sent to the model, including provider update
time, state, draft state, branch names, reviews, checks, labels, association/viewer signals, detail
revision identifiers, commit heads, and selected bounded content. It does not depend only on PR
number or update time.

When the canonical PR changes, the old analysis remains readable but becomes stale. Stale analysis
cannot be presented as current, cannot supply the sole readiness score, and is replaced on the next
manual or eligible scheduled run.

## Priority Calculation

Priority is explainable and versioned. Version one combines a deterministic component worth up to
60 points and model-derived attention worth up to 40 points.

The deterministic component is capped at 60 and awards:

- 18 points when the viewer's review is requested;
- 10 points when assigned to the viewer;
- 10 points for unread provider updates;
- 8 points for failing checks;
- 7 points for requested changes;
- 7 points for association with Ryco work active inside the configured window.

The model-derived component is capped at 40 and consists of:

- 15 points for evidenced implementation or regression risk;
- 10 points for an evidenced blocker;
- 10 points for review impact or breadth;
- 5 points for time sensitivity or unusual review effort.

Priority categories are:

- `urgent`: 80 through 100;
- `high`: 60 through 79;
- `normal`: 35 through 59;
- `low`: 0 through 34.

Closed and merged PRs are excluded from scheduled active priority analysis. A manual historical
analysis can summarize them but does not insert them into the active Priority view.

## Merge Readiness

The product label is `Merge readiness`, not `Mergeability`. Provider mergeability remains a
separate factual field.

For an open PR, readiness is calculated from six visible factors totaling 100 possible points:

- provider mergeability and conflicts: 25;
- checks: 25;
- review disposition: 20;
- lifecycle and draft state: 10;
- AI-assessed implementation completeness: 15;
- AI-assessed unresolved discussion and risk: 5.

Unknown factual inputs do not count as passing. The score includes a confidence level based on the
share and freshness of available evidence. The UI shows every factor's contribution and
explanation.

Hard caps prevent misleading scores:

- confirmed conflicts cap readiness at 35;
- failing checks cap it at 55;
- requested changes cap it at 60;
- draft state caps it at 70.

When more than half of factual provider weight is unknown, the UI labels readiness `insufficient
evidence` instead of elevating the numeric score. Merged and closed PRs show their outcome and do
not display a current readiness percentage.

## Persistence and Domain Boundaries

AI analysis is derived cache data, not provider truth and not orchestration history. It uses a
separate server-owned persistence service and SQLite migration rather than adding analysis events
to `OrchestrationEventStore`.

The persistence layer contains:

### `pull_request_ai_analyses`

One versioned cached result per viewer, canonical PR, model selection, prompt version, result-schema
version, and source fingerprint. It stores the validated structured result, timestamps, and stale
metadata. Replaced results may be retained for bounded diagnostics but only the newest matching
result is exposed as current.

### `pull_request_ai_runs`

Durable run metadata containing environment, viewer, frozen scope, model selection, resource
configuration, status, counts, start/end timestamps, cancellation state, and sanitized error
summaries. Raw PR content and raw model prompts are not written to the run table or normal logs.

The existing canonical PR projection remains authoritative for identity, provider state,
associations, access targets, and unread state. Deleting or expiring AI cache entries cannot delete
or alter canonical PR history.

## Contracts and RPC Surface

`packages/contracts` gains schema-only types for:

- analysis configuration;
- analysis result and readiness factors;
- analysis snapshot;
- run status and progress;
- analyze-view and analyze-one inputs;
- cancellation input;
- analysis errors encoded through the existing RPC error boundary.

The pull request RPC namespace gains owner-authorized operations equivalent to:

- list/subscribe analysis snapshot;
- analyze frozen inbox scope;
- analyze one PR;
- cancel the current run;
- update analysis configuration through normal settings persistence.

The client-runtime PR domain federates per-environment analysis snapshots beside canonical inbox
snapshots. It never joins results by PR number; all joins use the canonical PR ID and environment.

## Model Runtime

The existing `TextGeneration` abstraction gains a dedicated structured PR-analysis operation. It
resolves any enabled configured provider instance through `ProviderInstanceRegistry`, like existing
title, branch, commit, and PR content generation.

The operation is implemented by supported Codex, Claude, Grok, OpenCode, and Cursor text-generation
adapters. It accepts the shared bounded analysis packet and model selection, runs without mutation
tools, and returns text that the server decodes through the shared result schema. Provider-specific
transport remains inside each adapter; ranking and result semantics remain provider-neutral.

Analysis does not create visible threads or orchestration sessions. It uses the existing
short-lived text-generation lifecycle, with explicit cancellation and read-only provider policy.

## Configuration and Scheduling

Settings add a per-environment PR intelligence section with:

- background analysis enabled, default `false`;
- selected model, defaulting to the environment's text-generation selection;
- interval preset: 30 minutes, 1 hour, 3 hours, 6 hours, 12 hours, or 24 hours;
- maximum PRs per ranking run, default 25, range 1 through 100;
- maximum deep analyses, default 8 and never greater than the ranking limit;
- active-work window, default 14 days, range 1 through 90;
- include drafts, default `false`;
- resource mode: `economical`, `balanced`, or `thorough`, default `balanced`.

Resource modes tune content and concurrency without changing correctness:

- economical: one deep call at a time and smaller discussion/diff budgets;
- balanced: two concurrent provider-detail fetches and two deep calls;
- thorough: up to three concurrent deep calls and larger bounded inputs.

Only one PR intelligence run may execute per environment. A later scheduled tick does not overlap a
manual or scheduled run.

Scheduled candidate selection includes only open PRs with at least one of:

- viewer review requested;
- viewer assigned;
- unread provider updates;
- association with a thread or worktree active inside the configured window.

Drafts are included only when enabled. Unchanged fingerprints reuse the cache without invoking the
model. Disabled or unavailable model instances pause scheduling and surface a configuration state;
Ryco does not silently substitute a different model.

## Security and Privacy

Pull request text and code are untrusted model input. The analysis prompt treats titles,
descriptions, comments, commits, and diffs as delimited data and explicitly rejects instructions
found inside them. Prompt wording is not treated as the security boundary.

The execution boundary enforces:

- no source-control mutation methods;
- no comment, review, approval, or merge methods;
- no filesystem writes;
- no approval requests;
- no arbitrary tools supplied to the model;
- bounded input and output;
- owner authorization for every RPC;
- viewer-scoped cache reads;
- strict schema decoding before persistence;
- sanitized errors and no raw PR content in ordinary logs.

The UI requires explicit confirmation before enabling background analysis and explains that private
PR content may be sent to the selected configured model provider. Manual analysis uses the same
model attribution and safety boundary.

## Cancellation, Errors, and Partial Results

An analysis run is cancellable. Cancellation interrupts outstanding model work when the adapter
supports it and prevents queued deep calls from starting. Results decoded and persisted before
cancellation remain valid.

Each model response receives one repair attempt when it is malformed or violates the schema. A
second failure becomes a per-batch or per-PR failure. Previous valid cached results remain
available, marked with their true freshness.

Rate-limit responses honor provider retry timing. Authentication and unavailable-model errors pause
scheduled execution until configuration changes or the provider recovers. Provider-detail failures
reduce deep-analysis coverage but do not discard stage-one ranking.

Run progress reports:

- planned;
- ranking;
- deep-analysis;
- cancelling;
- completed;
- partially-completed;
- cancelled;
- failed.

Normal pull request browsing, refresh, unread state, and relationships continue working during every
analysis state.

## Testing Strategy

### Contracts and pure logic

- result and configuration schema decoding;
- priority weighting and category boundaries;
- merge-readiness factors, confidence, and hard caps;
- active-candidate selection;
- source fingerprint stability and invalidation;
- stale-result selection;
- cross-environment canonical joins.

### Server

- migration and cache persistence;
- viewer isolation;
- run state transitions and recovery;
- model resolution for enabled and unavailable instances;
- two-stage limits and cache reuse;
- bounded concurrency and cancellation;
- scheduler selection and non-overlap;
- provider-detail partial failure;
- malformed structured output and repair;
- prompt-injection-shaped provider content;
- RPC owner authorization;
- no mutation-capable provider surface exposed to analysis.

### Client runtime and web

- federated analysis snapshots;
- mixed per-environment model labels;
- Priority first-run and ranked states;
- manual view and single-PR analysis;
- progress and cancellation;
- stale and partial results;
- readiness factor disclosure;
- hotspot-to-file navigation;
- background configuration and privacy confirmation;
- deterministic inbox views retaining deterministic ordering.

## Rollout

The first release ships manual analysis and the complete cache/result/UI model. Background
scheduling ships behind its explicit per-environment setting but uses the same analysis service,
cache, resource limits, and progress model. There is no separate experimental data path.

Existing users start with background analysis disabled and no Priority results. Existing PR inbox
behavior is unchanged until the user initiates analysis.

## Out of Scope

- automatic approval, merge, comment, review, label, assignment, or PR mutation;
- OS notifications based on AI priority;
- arbitrary cron expressions;
- organization-wide shared scoring policy;
- model training or fine-tuning;
- web-phone or native-mobile PR intelligence UI;
- claiming certainty when provider or diff evidence is unavailable.

## Acceptance Criteria

1. A user can select any enabled configured model for each environment and manually analyze the
   frozen current inbox view.
2. Each environment ranks at most its configured number of canonical PRs and deeply analyzes only
   its configured top subset.
3. Results include explainable priority, risk, summary, implementation phase, attention reason,
   next action, optional hotspots, confidence, and source/model attribution.
4. Merge readiness is derived from visible factors, obeys hard blocker caps, and distinguishes
   provider mergeability from advisory readiness.
5. Results are cached by canonical identity, viewer, model, prompt/schema version, and actual input
   fingerprint; changed inputs visibly stale prior results.
6. Priority is a first-class inbox workspace and preserves the ranked context while viewing a PR.
7. Manual single-PR analysis can upgrade a shallow result to a deep result.
8. Optional scheduling analyzes only active open PRs, skips unchanged inputs, never overlaps a run,
   and remains disabled by default.
9. Multi-environment execution stays environment-local and displays the model used for every
   result.
10. Cancellation and partial failures preserve completed and previous valid results.
11. Analysis exposes no PR mutation or filesystem-write authority and persists only schema-valid
    output.
12. Normal PR inbox and detail functionality works when AI is disabled, unavailable, running, or
    failed.
