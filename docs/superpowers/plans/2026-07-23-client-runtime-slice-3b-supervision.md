# Client runtime slice 3b: the supervision relocation

**Goal:** Complete Slice 3 of the extraction spec: relocate `service.ts`'s supervision
machinery — the connection registry maps, thread-detail subscription cache with
eviction, saved-environment sync, and resume-reconnect policy — into
`@ryco/client-runtime/connection`, reducing `apps/web`'s
`environments/runtime/service.ts` to thin wiring over the package. Slice 3a (#218)
already landed the foundations and the live `EnvironmentStateSink`; this slice moves the
machinery that calls it. Web behavior is byte-for-byte unchanged.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 3). Single concern: nothing else moves in this slice.

## Execution rules

- Work only on `feat/client-runtime-supervision`.
- Behavior-preserving: no assertion changes anywhere; connect/reconnect ordering,
  subscription-cache eviction, projection versioning application, saved-env sync
  scheduling, and resume-reconnect staleness policy preserved exactly.
- Hosted semantics untouched: `createEnvironmentConnectionHandlers(hostedGeneration)`
  fencing, `markHostedSessionReady/Replaying` publication, the hosted swap-in of the
  relay attempt factory, and the hosted NOOPs of generic sync/resume keep their exact
  behavior; `hostedHub/*` changes are import specifiers at most. The hosted lifecycle
  handlers remain injected FROM the web side exactly as they plug in today.
- The desktop-SSH bootstrap and `window.desktopBridge` reads stay web-side, injected as
  the optional capability they already are; `@tanstack/react-pacer`'s Throttler must not
  enter the package — invert it behind the existing Clock/FrameScheduler contracts or an
  injected throttle factory with identical timing.
- Module-level supervision singletons (connection maps, subscription caches, projection
  trackers, scheduler state) move home atomically with all importers (Decision c).
- The runtime package gains no react/DOM/node imports; all boundaries stay green.
- Never `bun test`; use `bun run test`. Pre-installed worktree; no `bun install`.
- Stage only named paths; `git diff --check` before commits; no AI trailers; no private
  detail.

## Task 1 — Relocate the supervision core

Move from `apps/web/src/environments/runtime/service.ts` into
`packages/client-runtime/src/connection/` (shapes per the spec): the connection
registry (primary + saved maps and lifecycle), the thread-detail subscription cache
with eviction, projection snapshot/event versioning application (the tracker moved in
3a — now its call sites), saved-environment sync, and the resume-reconnect policy.
Inject: the state sink (already), hosted lifecycle handlers (web-supplied), the
throttle/clock seams, the ws URL/token providers (3a's endpoint/auth surfaces), and the
optional desktop-SSH capability. The web `service.ts` becomes wiring: adapters in,
package supervisor out, same exported surface for the rest of the app.

## Task 2 — Web wiring and rewrites

Rewrite importers of anything that moved; keep the web-facing exports of
`environments/runtime` stable so consumers (components, hostedHub, tests) need
specifier-level changes at most.

## Task 3 — Validation (agent, offline)

`bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run typecheck:effect`,
`bun run test`, `bun run build`. Falsifiability: neuter one eviction/staleness condition
in the moved cache or resume policy and observe the covering test fail, restore. Report
everything run.

## Task 4 — Gates, evidence, PR (orchestrator)

Full gate set, audit baseline, **three consecutive clean** browser runs, diff review,
PR against `main`.
