# Client runtime slice 1: packaging and platform contracts

**Goal:** Turn `@ryco/client-runtime` into the per-subpath, platform-neutral package the
extraction targets — contracts and packaging only, no behavior moves. Relocate
`advertisedEndpoint` to `@ryco/shared` so the server and desktop bundlers stop resolving
`@ryco/client-runtime` entirely.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 1; the spec's "Platform contract surface" section is the authoritative contract list).

## Execution rules

- Work only on `feat/client-runtime-platform-contracts`.
- No behavior moves in this slice. Every existing test passes **unmodified**; web, server,
  and desktop behavior is byte-for-byte unchanged.
- Never run `bun test`; use `bun run test`.
- No private issue, deployment, account, node, URL, or operational detail anywhere.
- Stage only named paths; `git diff --check` before every commit; conventional commits, no
  AI-attribution trailers.

## Task 1 — Move `advertisedEndpoint` to `@ryco/shared`

- Move `packages/client-runtime/src/advertisedEndpoint.ts` + its test to
  `packages/shared/src/advertisedEndpoint.ts` (+ test), add the `./advertisedEndpoint`
  subpath to `packages/shared/package.json` exports (follow the existing per-module
  pattern), and remove the module from `client-runtime`.
- Repoint every importer: `apps/server/src/remote/AdvertisedEndpointRegistry.ts`,
  `apps/desktop/src/serverExposure.ts`, `apps/desktop/src/tailscaleEndpointProvider.ts`,
  plus any `apps/web` importers `rg` finds. Then remove the now-unused
  `@ryco/client-runtime` devDependency from `apps/server/package.json` and
  `apps/desktop/package.json` (verify nothing else imports it first; add `@ryco/shared`
  where missing).
- **Acceptance:** `rg "@ryco/client-runtime" apps/server apps/desktop` returns nothing;
  `bun run build`, `bun run build:desktop`, and the moved test pass.

## Task 2 — Per-subpath exports and neutrality discipline

- Give the three remaining modules their own exports entries — `./scoped`,
  `./knownEnvironment`, `./sourceControlDiscoveryState` — pointing at `./src/*.ts`
  (copy `@ryco/shared`'s exports style), and delete the `src/index.ts` barrel and the
  root `"."` export.
- Rewrite every `@ryco/client-runtime` root-barrel import in `apps/web` (~40 files) to the
  matching subpath import. Mechanical; no symbol renames.
- `packages/client-runtime/tsconfig.json`: set `types: []` and an explicit non-DOM `lib`
  (match the ES level the base config targets); confirm the package still typechecks.
- Add the boundary lint enforcement using the repo's existing lint mechanism: inside
  `packages/client-runtime`, imports of `react`, `react-dom`, any `node:` builtin, and
  `@effect/atom-react` are errors; adding a barrel back is prevented (no `src/index.ts`).
  Investigate how this repo scopes lint rules per package and follow that pattern.
- **Acceptance:** `bun typecheck`, `bun run typecheck:effect`, `bun lint`, full
  `bun run test` green; `rg -F '@ryco/client-runtime"' apps packages` shows no remaining
  root-specifier imports.

## Task 3 — `./platform` contracts and injected config

New `packages/client-runtime/src/platform/` with its `./platform` subpath export. Define,
as Effect `Context` service tags with small documented shapes (the spec section
"Platform contract surface" is the source of truth — implement it exactly, including the
file:line-grounded semantics):

`Endpoint`, `Socket` (WebSocket-constructor seam), `AppLifecycle`, `KV`, `SecretKV`
(separate services), `PasskeyCeremony`, `SessionCredentials`, `PairingCredentialSource`
(take-once), `AttachmentCodec`, `Clock` + `FrameScheduler`, `Observability` (no-op
default via `Context.Reference`), and `ClientRuntimeConfig` (injected config value:
`clientMode`, optional base URLs, hosted app URL, dev server URL, perf profile).

- Contracts only — no implementations inside the package beyond no-op defaults.
- Unit tests per contract against in-memory fakes proving the shapes are implementable and
  the defaults behave (e.g. Observability default is a no-op, `PairingCredentialSource`
  take-once semantics expressed in the type's contract test).
- **Acceptance:** package tests green; no new deps beyond `@ryco/contracts` + `effect`.

## Task 4 — Web platform adapter (first provider)

New `apps/web/src/platform/` directory implementing every contract from Task 3 as thin
wrappers over today's seams, changing none of them: Endpoint over
`environments/primary/target.ts` resolution, Socket over `globalThis.WebSocket`,
AppLifecycle over `visibilitychange`/`online`/`pageshow` + `navigator.onLine`, KV over
`lib/storage.ts`'s `StateStorage`, SecretKV over `clientPersistenceStorage`'s
bearer-token operations, SessionCredentials declaring cookie mode, PairingCredentialSource
over `pairingUrl` take-and-strip, AttachmentCodec over `File`/dataURL, Clock/FrameScheduler
over `performance.now`/`requestAnimationFrame`, Observability wrapping
`ClientTracingLive` + the perf recorder, PasskeyCeremony over
`hostedHub/webauthn.ts`'s ceremony calls (the fail-closed option validation stays where it
is — the wrapper delegates, it does not duplicate).

- Nothing consumes these yet (Slice 2 does); the conformance tests are the consumers:
  each adapter gets a focused test (with browser-global stubs where needed) proving it
  satisfies its contract.
- **Acceptance:** adapter tests green; zero changes to the wrapped modules themselves.

## Task 5 — Install-filter and workspace hygiene

- Check `apps/web/vercel.json`'s install/filter list; add `@ryco/shared` if absent (it is
  now a web dependency path for `advertisedEndpoint` consumers, if any web importers
  exist) and confirm `@ryco/client-runtime` remains listed.
- **Acceptance:** `bun install --frozen-lockfile` clean; lockfile diff contains only the
  intended dependency edges (advertisedEndpoint move, shared additions).

## Task 6 — Gates, evidence, PR (orchestrator)

Full public gate set: install, fmt, fmt:check, lint, typecheck, typecheck:effect,
`bun run test`, `bun run build`, `bun run build --filter=@ryco/web`,
`bun run build:desktop` (Task 1 touches the desktop pipeline), `bun audit`
(baseline-compare: this slice edits manifests, so diff the advisory set against main),
and one full `bun run --cwd apps/web test:browser` run (import rewrites touch web-shipped
modules; three runs if any browser suite behavior is even indirectly affected).
PR against `main`, stating the no-behavior-move guarantee and the dependency-edge change.
