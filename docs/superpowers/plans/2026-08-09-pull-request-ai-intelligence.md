# Pull Request AI Intelligence Implementation Plan

**Goal:** Add model-selectable, cached, explainable AI prioritization and PR briefings to the
canonical Pull Requests page without granting the model mutation authority.

**Architecture:** Extend the existing provider-neutral `TextGeneration` registry with a structured
PR-analysis operation. Store derived analysis and run state in dedicated SQLite cache tables, expose
owner-authorized pull-request intelligence RPCs, federate snapshots in client-runtime, and render a
first-class Priority inbox plus integrated per-PR briefing. Provider truth remains in the canonical
PR projection.

## Task 1: Contracts and pure scoring

- Extend `packages/contracts/src/pullRequest.ts` with analysis configuration, model output,
  readiness, cached result, run state, and snapshot schemas.
- Add RPC methods and client types in `packages/contracts/src/rpc.ts`.
- Add pure priority, readiness, cache-fingerprint, and stale-selection logic under
  `packages/shared/src/pullRequestIntelligence.ts`.
- Test schema round-trips, score boundaries, hard caps, unknown evidence, and stable fingerprints.

## Task 2: Derived cache persistence

- Add migration 045 for `pull_request_ai_analyses` and `pull_request_ai_runs`.
- Add a focused persistence service/layer with schema-validated JSON encoding, viewer-scoped reads,
  cache lookup, upsert, run transitions, cancellation, and change streaming.
- Test migration shape, viewer isolation, replacement behavior, and malformed-row handling.

## Task 3: Structured model operation

- Add `generatePullRequestAnalysis` to `TextGenerationShape`.
- Add one provider-neutral prompt builder with explicit untrusted-data boundaries and shared output
  schema.
- Wire Codex, Claude, Grok, OpenCode, and Cursor through their existing structured JSON runners.
- Preserve each adapter's existing read-only/deny-tool execution policy and timeouts.
- Test prompt bounds, injection-shaped content, and structured decoding.

## Task 4: Analysis service and scheduler

- Add a `PullRequestIntelligenceService` that validates frozen canonical IDs, reuses fingerprinted
  cache entries, performs stage-one ranking, fetches bounded detail for the top subset, computes
  final priority/readiness, and persists partial results.
- Enforce one run per environment, resource-mode concurrency, cancellation, and per-item failures.
- Add an opt-in scheduler using server settings, active-candidate selection, non-overlap, and
  unchanged-input skipping.
- Test limits, cache reuse, cancellation, partial provider failure, unavailable models, and
  scheduler candidate selection.

## Task 5: Server wiring and RPCs

- Add cache and intelligence services to the server layer graph and WS context.
- Add list/subscribe analysis snapshot, analyze view, analyze one, and cancel operations to
  `pullRequestRpc.ts`.
- Enforce owner authorization and canonical environment-local IDs.
- Extend WS harness fixtures and access-policy coverage.

## Task 6: Client-runtime federation

- Extend the pull-request state domain with per-environment analysis snapshots and selectors.
- Keep canonical joins keyed only by environment plus canonical PR ID.
- Add controller wiring for subscribe/reconnect/stale behavior.
- Test generations, cross-environment collisions, priority ordering, and stale environments.

## Task 7: Route and view model

- Add `priority` to validated PR route state.
- Extend the inbox view model so Priority uses analysis ordering while every existing view retains
  deterministic ordering.
- Build presentation models for first-run, running, partial, stale, and unavailable-model states.
- Test ordering and route compatibility.

## Task 8: Priority workspace and controls

- Add a first-class Priority view, model selector, `Analyze current view`, progress, cancellation,
  analysis scope, freshness, and per-environment model disclosure.
- Add priority rank/reason to Priority rows and quiet cached indicators elsewhere.
- Reuse existing provider/model derivation rather than inventing a second model catalog.
- Add the opt-in scheduling/resource configuration panel with explicit private-content notice.

## Task 9: Per-PR intelligence briefing

- Add the concise AI briefing to `PullRequestManagementDetail` with summary, phase, risk, attention
  reason, suggested next action, confidence, and model attribution.
- Add merge-readiness score/factors/caps and insufficient-evidence state.
- Link file-backed hotspots into the Files workspace.
- Add analyze/refresh-this-PR behavior and stale/failure states.

## Task 10: Focused validation and live verification

- Run contract/shared/server/client-runtime/web focused tests as each layer lands.
- Run affected package typechecks and Effect typecheck where the service layer changes.
- Run the focused Pull Requests browser test and add AI first-run/ranked/progress/stale cases.
- Build web/desktop boundaries and verify the Priority workspace in the dev Electron app.
- Finish with formatting, diff checks, and the full repository backstop because this crosses
  contracts, persistence, provider runtime, RPC, client runtime, and a major web route.

## Required Commands

```sh
bun run --cwd packages/contracts test -- src/pullRequest.test.ts
bun run --cwd packages/shared test -- src/pullRequestIntelligence.test.ts
bun run --cwd apps/server test -- <focused PR intelligence tests>
bun run --cwd packages/client-runtime test -- src/state/pullRequests/store.test.ts
bun run --cwd apps/web test -- src/components/pullRequests/pullRequestInboxViewModel.test.ts src/pullRequestRouteSearch.test.ts
bun run --cwd apps/web test:browser -- src/components/pullRequests/PullRequestsPage.browser.tsx
bun run --cwd apps/web typecheck
bun run --cwd apps/server typecheck
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
