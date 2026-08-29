# Hosted Cold-Route Bounded Retry Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-29-hosted-cold-route-bounded-retry-design.md`

**Baseline:** `main` at `74cff366e`

**Goal:** Preserve authorized hosted task deep links across a transient offline presence snapshot by
using the existing 30-second session synchronization lifecycle, while leaving every authorization,
generation, snapshot, and mutation-readiness gate intact.

## Execution rules

- Use Bun `1.4.0` and install with `bun install --frozen-lockfile`.
- Never run `bun test`; use the package scripts that invoke Vitest.
- Keep the hosted lifecycle singular: do not add a directory polling loop, retry timer, ticket
  owner, relay owner, or session owner.
- Do not change Hub presence semantics, contracts, relay close reasons, or private deployment code.
- Preserve immediate fail-closed behavior for malformed, absent, revoked, authorization-removed,
  incompatible, and environment-mismatched routes.
- Keep the production repository free of private identifiers and qualification evidence.

## Phase 1: Lock the route behavior with focused tests

Modify:

- `apps/web/src/hostedHub/nodeRouteOrchestrator.test.ts`

Replace the current expectation that an authorized offline URL restore immediately clears the route.
Add focused regressions proving:

1. an authorized offline deep link calls the existing activation path and preserves the route;
2. the same attempt succeeds when a current shell snapshot establishes readiness before the
   existing deadline;
3. a URL-originated terminal timeout that remains offline returns to the directory with the offline
   notice;
4. a non-offline terminal failure keeps its routed failure surface;
5. an interactive offline selection retains current behavior;
6. Back during pending restore tears down the selection and fences stale publications;
7. forward re-entry does not inherit stale interactive intent;
8. every existing authorization, revocation, compatibility, malformed-route, and environment
   mismatch test remains green.

Focused check:

```sh
bun run --cwd apps/web test src/hostedHub/nodeRouteOrchestrator.test.ts
```

## Phase 2: Route offline restores through the authoritative lifecycle

Modify:

- `apps/web/src/hostedHub/nodeRouteOrchestrator.ts`

Implementation steps:

1. Remove the URL-only presence fail-fast after all authoritative route validations have passed.
2. Keep `interactiveNodeId` solely as the marker that distinguishes explicit selection from URL
   restoration; continue setting `restoreOriginNodeId` only for URL-originated selection.
3. Let `hostedHubController.selectNode` select the authorized offline node. It already starts the
   30-second synchronization deadline and delegates activation to the singular hosted coordinator.
4. In the selected-node reconcile branch, detect a URL-originated terminal failure that is still
   classified as offline and has not established a session.
5. Clear the route and return to the directory through the existing exclusive teardown path, keeping
   the existing offline notice.
6. Do not redirect non-offline terminal failures. Do not change interactive selection behavior.
7. Clear restoration markers on success, route change, sign-out, and teardown exactly as existing
   paths require.

Run the focused test after each behavior change.

## Phase 3: Browser-level cold-route regression

Modify the smallest existing hosted browser suite that owns route restoration:

- `apps/web/src/components/hostedHub/HostedNodeRoutes.browser.tsx`

Add a browser regression that begins on a node-scoped task URL with an authorized node whose first
directory snapshot is offline. Prove that:

- the URL is not replaced by the node directory;
- the restoring/connecting surface or cached read-only task is rendered;
- mutation controls remain unavailable before readiness;
- an online/current snapshot before 30 seconds opens the exact routed task;
- the existing “Back to nodes” escape still works.

Do not add production-only hooks or timing exceptions. Use the existing fake runtime, store setup,
and browser test helpers.

## Phase 4: Validation and review

Run the risk-proportional hosted web gates:

```sh
bun install --frozen-lockfile
bun run --cwd apps/web test src/hostedHub/nodeRouteOrchestrator.test.ts
bun run --cwd apps/web typecheck
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser:install
bun run --cwd apps/web test:browser
```

The browser runtime install may be skipped only when the pinned Chromium runtime is already present.

Review the complete diff for:

- accidental second lifecycle ownership;
- weakened authorization or readiness gates;
- stale marker or generation leaks;
- unrelated formatting or generated drift;
- private production evidence.

Suggested implementation commit:

```text
fix(web): preserve hosted cold routes during node recovery
```

## Phase 5: Merge, hosted pin, and production qualification

1. Push the focused public branch and open a PR containing the design, plan, code, and validation
   evidence.
2. Merge only after the public checks required for the affected hosted web boundary pass.
3. Update the private Hub's immutable public-Ryco pin through its reviewed deployment workflow.
4. Build and qualify the exact candidate, retain the current image and rollback evidence, and deploy
   through the single-replica procedure.
5. Verify that the hosted client and node versions match.
6. Repeat production cold-load, read-only cached state, Files, Agents, Diffs, Review, checks,
   source-control, new task, subagent, and genuine-offline timeout qualification.
7. Confirm browser diagnostics and bounded Hub channel/queue health after recovery.

Production deployment and rollback require the private Hub runbook's explicit gates and must not be
represented as complete by local or public CI alone.
