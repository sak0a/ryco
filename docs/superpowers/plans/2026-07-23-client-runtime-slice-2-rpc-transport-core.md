# Client runtime slice 2: RPC transport core

**Goal:** Move the WebSocket RPC transport core into `@ryco/client-runtime` behind the
Slice-1 platform contracts, splitting each React-coupled rpc module into a neutral core
(moves) and an app-side binding (stays). Web reconnect, heartbeat, and status behavior is
byte-for-byte unchanged.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 2 is authoritative, including the split lists; Decision (c) singleton rule applies).

## Execution rules

- Work only on `feat/client-runtime-rpc-core`.
- Behavior-preserving extraction: every existing test passes with unchanged assertions
  (import-specifier updates only). Reconnect/backoff constants, heartbeat timing, and the
  string-matched error classifications are preserved **verbatim**.
- Singleton discipline (Decision c): `appAtomRegistry` moves home atomically with every
  importer in this same change; no module may import it from both homes.
- The runtime package gains no react/DOM/node imports — the Slice-1 compiler + lint
  boundary must stay green.
- Never run `bun test`; use `bun run test`. No `bun install` needed (worktree is
  pre-installed); the lockfile must not change.
- Stage only named paths; `git diff --check` before every commit; conventional commits,
  no AI-attribution trailers. No private detail anywhere.

## Task 1 — `./errors`: transport error classification with pinning tests

- Move `apps/web/src/rpc/transportError.ts` (+ test) to
  `packages/client-runtime/src/errors/transportError.ts`, add the `./errors` subpath
  export, rewrite importers.
- Add **pinning tests** asserting the exact classification strings survive verbatim:
  the `SocketCloseError`/`SocketOpenError`/`ping timeout` patterns, the literal
  `"Unable to connect to the Ryco server WebSocket."` (kept in `protocol.ts` when it
  moves in Task 2 — pin it there), `THREAD_NOT_FOUND_ERROR_RE`, and
  `isSubscriptionStreamDoneError`'s `"SchemaError(Expected array"` fragment. Each pin
  proven falsifiable (mutate the string, watch the pin fail, restore).

## Task 2 — `./rpc`: the neutral transport core

Move to `packages/client-runtime/src/rpc/` with a `./rpc` subpath export:

- `protocol.ts`, `wsTransport.ts`, `wsRpcClient.ts`, `invalidation.ts`, `keyedQuery.ts`
  — whole modules.
- The **neutral halves** of the split modules, exactly per the spec:
  - `atomRegistry`: the `appAtomRegistry = AtomRegistry.make()` value (an
    `effect/unstable/reactivity` value) moves; the `RegistryContext.Provider` JSX and
    React context wiring stay in a new app-side `apps/web/src/rpc/atomRegistryBinding.tsx`
    (name to taste, match conventions) that imports the registry from the package.
  - `wsConnectionState`: status atoms, backoff constants + `getWsReconnectDelayMsForRetry`,
    and the lifecycle **recorder functions** move; `useWsConnectionStatus` stays app-side.
  - `requestLatencyState`: the request-tracking atoms + timer recorders move;
    `useSlowRpcAckRequests` stays app-side.
  - `serverState`: atoms + `applyServerConfigEvent` reducer + `startServerStateSync`
    move; the React selector hooks stay app-side.
- `queryClient.ts` does **not** move. Domain atoms (`gitAtoms`, `overviewAtoms`,
  `sourceControlAtoms`, `workItemsAtoms`, `atlassianAtoms`, `projectAtoms`,
  `projectPreviewAtoms`, `providerAtoms`, `desktopUpdateAtoms`) and their `use*` hooks
  stay in `apps/web` (Slice 3+); they import `keyedQuery`/the registry from the package.
- `rpc/client.ts` (AtomRpc) does **not** move (deferred to Slice 3 per the spec).

## Task 3 — Platform wiring (the only semantic edits, all injection-shaped)

- **Socket:** `protocol.ts`'s WebSocket construction goes through the Slice-1 `Socket`
  contract. The contract returns `unknown` while the seam needs `globalThis.WebSocket`
  (a known mismatch — spec review flagged it): add one explicit, commented bridging cast
  at the seam inside the package; the web adapter keeps supplying
  `new globalThis.WebSocket(...)` verbatim. The `webSocketConstructor` handler override
  (used by the hosted relay) keeps working unchanged — hosted transport is NOT touched.
- **Observability:** `wsTransport.ts` currently hard-imports `ClientTracingLive`
  (`~/observability/clientTracing`) and `recordWebPerfPayload` (`~/perf/perfInstrumentation`).
  Invert both through the Slice-1 `Observability` contract (no-op default): the package
  takes the tracing layer + perf recorder as injected inputs; the web transport
  construction site supplies today's implementations verbatim so web tracing/perf output
  is unchanged.
- **Online source:** `wsConnectionState`'s `navigator.onLine` seed moves behind the
  Slice-1 `AppLifecycle` contract (web adapter supplies `navigator.onLine`); the
  `setBrowserOnlineStatus` recorder keeps its exact semantics, driven by the existing
  web listeners (`WebSocketConnectionSurface` is untouched).

## Task 4 — Web rebinding and import rewrites

- New app-side binding modules for the stayed hooks/JSX, importing the moved cores from
  `@ryco/client-runtime/rpc` (and `/errors`).
- Rewrite every `~/rpc/*` importer of the moved modules across `apps/web` (components,
  hostedHub transport, environments runtime, tests) to the package subpaths or the
  binding modules. Specifier-only changes in tests.
- `apps/web/src/hostedHub/transport.ts` compiles against the moved
  `WsProtocolLifecycleHandlers` type unchanged; the hosted store gating, ticket flow,
  and relay socket are untouched.

## Task 5 — Validation (agent, offline)

`bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run typecheck:effect`,
`bun run test`, `bun run build`. Report every result. Prove the Task-1 pins and at least
one moved-recorder behavior falsifiable. The browser suite belongs to the orchestrator.

## Task 6 — Gates, evidence, PR (orchestrator)

Full public gate set plus **three consecutive clean** full browser-suite runs (status
atoms and reconnect surfaces are UI-adjacent), audit baseline comparison (lockfile must
be unchanged), diff review, PR against `main`.
