# Client runtime slice 4: the hosted lifecycle unit

**Goal:** Move the hosted lifecycle unit — the single authoritative owner — into
`@ryco/client-runtime` as `./authorization` + `./relay`, **whole and indivisible**, with
its integration tests. Hosted behavior is byte-for-byte unchanged; the package-level
invariants from the spec's Slice 4 section are restated in code comments where they are
enforced.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 4 is authoritative, including the in/out lists and the five package-level
invariants). This is the security-critical slice: auth ceremonies, one-use relay
tickets, and the generation-fenced lifecycle owner move together.

## Execution rules

- Work only on `feat/client-runtime-hosted-unit`.
- **The unit moves whole or not at all** (spec invariant): `hostedHub/state.ts`
  controller + `types` + `transport.ts` attempt factory + `reconnectPolicy` +
  `connectionStatus` + `capabilities` + `logging` + the `environment.ts` transition
  queue (its app-UI-store clearing catalog injected as `clearNodeScopedState`, teardown
  ORDER owned by the core) + the relay protocol state machine from `relaySocket.ts`
  re-hosted on an injected socket (INVERT the browser-WebSocket/EventTarget/CloseEvent
  facade — do not port it; preserve ticket zeroization `.fill(0)` semantics exactly) +
  the WebAuthn option/response codecs (fail-closed validation stays in front of the
  platform seam) + pure base64url + `api.ts` validation/error mapping behind
  `SessionCredentials` + `PasskeyCeremony`.
- **Moves with its tests**: `lifecycle.integration.test.ts`,
  `nodeRouteRestore.integration.test.ts`, `returnToDirectory.integration.test.ts`, and
  every unit test of the moved modules — assertions unchanged.
- **Stays in `apps/web`:** `useHostedBrowserLifecycle` (web `AppLifecycle` impl),
  `nodeRoutes` + `nodeRouteOrchestrator` history wiring (extract only the fail-closed
  validation decision tree if cleanly separable — otherwise leave whole and note it),
  the CSRF-holding fetch implementation details that are genuinely browser-specific
  (behind `SessionCredentials`), and the app-UI-store clearing catalog.
- **Invariants (verbatim from the spec, enforced and cited):** single authoritative
  owner with cross-module generation fencing; no second auth/transport/readiness
  implementation; Hub session material, relay tickets, and proofs never persisted
  anywhere (saved-environment bearer tokens in SecretKV are legitimate by design);
  ticket zeroization preserved and the injected socket must not copy/retain/re-send
  buffers; generic reconnect never bypasses hosted ownership; the console boundary
  (`logging.ts`) still installs before `controller.bootstrap`.
- All timer/clock/socket injections use BOUND wrappers (see the slice-3b Illegal
  invocation incident) — audit every seam.
- Module-level singletons (`hostedHubController`, the CSRF-holding api instance, the
  relay attempt factory) move home atomically with all importers; no dual-home window.
- No react/react-pacer/DOM/node in the package; boundaries stay green. Never `bun test`.
  Pre-installed worktree; no `bun install`. Stage nothing; `git diff --check` at end;
  no AI trailers; no private detail.

## Task 1 — Move the unit

As above, incrementally: pure modules first (types, reconnectPolicy, connectionStatus,
base64url, webauthn codecs), then api.ts behind the contracts, then the relay engine
inversion, then transport.ts, then state.ts + environment.ts transition queue together,
validating between steps.

## Task 2 — Web rebinding

`apps/web/src/hostedHub/` becomes bindings: the browser socket implementation for the
relay (conforming to the injected socket contract), the web `SessionCredentials`/
`PasskeyCeremony`/lifecycle adapters, `RegistryContext`-side hooks, and specifier
rewrites everywhere else (`routes/__root.tsx` boot gate included — its ordering
guarantee preserved).

## Task 3 — Validation (agent, offline)

`bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run typecheck:effect`,
`bun run test` (the three integration tests are the single-owner gate — they must pass
with unchanged assertions), `bun run build`. Falsifiability: prove the ticket one-use
guard and one generation-fence check falsifiable (invert, observe the covering test
fail, restore). Report everything run.

## Task 4 — Gates, evidence, PR (orchestrator)

Full gate set, audit baseline, **three consecutive clean** browser runs (hosted
reconnect surfaces), diff review with a security lens, PR against `main`.
