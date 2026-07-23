# Client runtime slice 3: connection and environment registry

**Goal:** Move the environment connection layer — targets, catalog, auth flows, the
connection registry, and the supervision half of `service.ts` — into
`@ryco/client-runtime` behind the Slice-1 contracts, inverting every app-store write
through an explicit `EnvironmentStateSink`. Web connect, reconnect, auth, and hosted
behavior is byte-for-byte unchanged.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 3 is authoritative, including the enumerated `EnvironmentStateSink` operations;
Decision (c) singleton rule applies). This is the spec's declared riskiest slice: the
sink inversion cuts through a hot call path.

## Execution rules

- Work only on `feat/client-runtime-connection-registry`.
- Behavior-preserving extraction: existing tests keep their assertions (specifier
  updates only), except `authBootstrap.test.ts`, whose **behavioral coverage is
  re-landed against platform-contract fakes in the same change** (same behaviors: silent
  desktop bootstrap, manual pairing, transient-retry timing, single-flight memoization,
  strip-before-use — the spec's Testing strategy names them).
- Hosted single-owner semantics are untouched: the generation-guarded handlers, the
  hosted NOOP of generic reconnect/sync (`service.ts:1921,1934` semantics), and
  `hostedHub/*` stay exactly as they are — Slice 4 moves the hosted unit, not this one.
- Singleton discipline (Decision c): each moved module-level singleton (connection maps,
  subscription caches, projection versions, the memoized primary auth gate, catalog
  stores) moves home atomically with every importer; no dual-home window.
- The runtime package gains no react/DOM/node imports; the Slice-1/2 compiler and lint
  boundaries stay green. zustand becomes a package dependency only if a moved store
  requires it (Decision d keeps zustand) — if so, verify zustand has no DOM/node deps
  and record the lockfile consequence.
- Never run `bun test`; use `bun run test`. Worktree is pre-installed; do not run
  `bun install` unless a package.json dependency edit requires a lockfile update — if it
  does, keep the diff minimal and report it.
- Stage only named paths; `git diff --check` before every commit; conventional commits,
  no AI-attribution trailers. No private detail anywhere.

## Task 1 — `./connection` foundations (low-risk 80%)

Move to `packages/client-runtime/src/connection/` with a `./connection` subpath:

- `environments/runtime/savedEnvironmentConnectionScheduler.ts` (+ test) — pure, as-is.
- `environments/runtime/connection.ts` — `createEnvironmentConnection` with
  `pushSequenceMonitor` inverted to an injected interface (the web keeps its zustand
  monitor store and passes it in).
- `environments/remote/api.ts` + `environments/remote/target.ts` — the bearer-session
  flows; the single `window.location.origin` relative-URL bases become explicit
  base-origin parameters supplied by the web `Endpoint` adapter.
- `environments/primary/context.ts` + the auth-flow half of `environments/primary/auth.ts`
  (session state, bootstrap credential exchange, ws-token issuance, pairing links/client
  sessions CRUD, transient-retry policy, single-flight memoization) — behind
  `SessionCredentials` (cookie mode declared by web), `PairingCredentialSource`
  (take-once; the web adapter keeps the URL-hash strip), and `Endpoint`. The
  `window.desktopBridge` bootstrap-credential read stays web-side, supplied through the
  existing adapter surface.
- `environments/runtime/catalog.ts` — registry + runtime stores behind `KV`/`SecretKV`
  (bearer tokens through `SecretKV` only); the dev-origin rewrite stays web-side in the
  `Endpoint` adapter.
- `environmentApi.ts` — near-as-is (drop the SSR guard behind a capability check).
- **Stays in `apps/web`:** `environments/primary/target.ts` source resolution (it becomes
  the web `Endpoint` implementation), `localApi` dispatch, `WebSocketConnectionSurface`,
  `hostedPairing`/`pairingUrl` call sites that are web-navigation-specific.

## Task 2 — The supervision split of `service.ts` with `EnvironmentStateSink`

- Extract the supervision half (connection registry, projection snapshot/event
  versioning, thread-detail subscription cache with eviction, saved-env sync,
  resume-reconnect policy) into the package; the web keeps a thin
  `environments/runtime/service.ts` that wires it.
- Define `EnvironmentStateSink` in the package exactly as the spec enumerates, grounded
  in the current writes: `applyOrchestrationEvents`, `syncServerShellSnapshot`,
  `syncProjects`/`syncThreads`, `clearThreadDraft`/`clearProjectDraftThread`,
  `clearTerminalState`, `markProviderInvalidationNeeded`/`flushProviderInvalidation`.
  The web adapter maps each operation onto today's zustand stores **unchanged and in the
  same order**. Hosted readiness callbacks stay on the separate hosted handler interface,
  generation guards intact.
- The desktop-SSH bootstrap paths (`window.desktopBridge`) remain web-side, injected as
  an optional capability exactly as the code branches today.
- No behavioral reordering: event application order, coalescing, throttling
  (`@tanstack/react-pacer` Throttler — verify it is platform-neutral; if not, invert it
  behind Clock/FrameScheduler), and store-write sequencing are preserved.

## Task 3 — `rpc/client.ts` (AtomRpc) joins the package

Deferred from Slice 2: move it behind an injected primary-target/readiness service (from
`./connection`) plus the in-package registry. Web keeps a binding exporting the same
`runRpc` surface.

## Task 4 — Web rebinding, fakes, and import rewrites

- App-side binding modules; rewrite every importer of moved modules.
- Re-land `authBootstrap.test.ts` behavior against platform fakes (an in-memory
  `Endpoint`, `SessionCredentials`, `PairingCredentialSource`, `KV`/`SecretKV`, fetch
  fake) in the package or app tests as appropriate — same behaviors, no
  `vi.stubGlobal(window/document)` in the new tests.
- `hostedHub/environment.ts`, `hostedHub/transport.ts`, `hostedHub/state.ts` update
  import specifiers only.

## Task 5 — Validation (agent, offline)

`bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run typecheck:effect`,
`bun run test`, `bun run build`. Prove falsifiable: one sink operation (neuter the web
adapter mapping, watch a store-sync test fail), one auth-fake behavior (e.g.
strip-before-use), and the take-once pairing semantics. Report exactly what ran.

## Task 6 — Gates, evidence, PR (orchestrator)

Full public gate set, audit baseline comparison, **three consecutive clean** full
browser-suite runs (connect/reconnect/hosted lifecycle are directly exercised), diff
review, PR against `main`.
