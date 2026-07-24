# Ryco Native Mobile App — iOS MVP Design

- **Status:** Owner-approved, 2026-07-23
- **Scope:** `apps/mobile` (public, `sak0a/ryco`). New Expo/React Native app consuming
  the completed `@ryco/client-runtime`. No changes to `apps/web`, the runtime package,
  the node, or the Hub in this workstream — except the one external dependency called out
  in §8, which is workstream C.
- **Depends on:** workstream A (merged: `@ryco/client-runtime` slices 1–6, public main
  `08ba0c14`) and the MIT reference `pingdotgg/t3code` (`upstream/main`).

## Goal

An iOS-first native app — chat/threads, review/diff, and connection/settings — that
consumes runtime A unchanged, feels native (real Liquid Glass, native diff canvas, native
composer), and reaches TestFlight. Terminal and file browser are v1.1. The app provides
platform adapters; it forks **no** authentication, transport, synchronization, state, or
mutation-readiness logic — those stay in runtime A per the "no second implementation"
invariant.

## Non-goals

- Terminal (`t3-terminal`) and the file browser/editor — v1.1.
- Android — v1.1 (the scaffold and modules are cross-platform, but iOS ships first).
- Any change to the runtime package, the node protocol, or `apps/web`.
- The Hub-side bearer session — that is workstream C (§8); this spec depends on it for
  hosted passkey login but is otherwise built to consume it when it lands.
- Cloud/managed-relay, agent-awareness push, widgets, share extension, showcase rig —
  all upstream T3 features omitted from the MVP.

## Approach

**Copy the upstream scaffold and native modules (MIT), rebind onto runtime A, strip the
T3 cloud plane.** Upstream's `apps/mobile` is architecturally what we want — the native
modules (`t3-composer-editor`, `t3-review-diff`, `t3-markdown-text`, `t3-native-controls`),
the navigation shell, the Liquid Glass system, and the EAS scaffold are directly reusable.
Its state layer is `@effect/atom-react` over an Effect `connectionAtomRuntime`; **Ryco's
runtime A is the substitute for upstream's `@t3tools/client-runtime`** — so the mobile
app's `src/connection/*`, `src/state/*` wrappers are rewritten to wire runtime A's seams
(§4) instead of upstream's, while the screens and native modules are adapted, not rebuilt.

Rejected: a from-scratch RN app (throws away proven native modules and the iOS-26
navigation/keyboard/glass work); a webview shell (the locked decision is native).

## Architecture

Three layers, mirroring both upstream and `apps/web`:

1. **Platform adapters** (`apps/mobile/src/platform/*`) — RN implementations of every
   runtime-A contract (§4), each modeled on its `apps/web/src/platform/*` template.
2. **Runtime wiring** (`apps/mobile/src/connection/*`, `src/state/*`) — the app's
   configurators and store bindings that hand the adapters to runtime A's factories, plus
   the React bindings (`useSyncExternalStore` over the zustand stores; `@effect/atom-react`
   `RegistryContext` over `appAtomRegistry` for the atom-based rpc/query state). This is
   the mobile analogue of `apps/web/src/{store,environments,rpc,hostedHub}`.
3. **Screens + native modules** (`apps/mobile/src/features/*`, `modules/*`) — presentation
   only, reading runtime A state through the bindings.

Dependency direction is unchanged from A: adapters satisfy contracts → connection composes
rpc/authorization/relay → state exposes stores/atoms → screens render. React lives only in
the app (runtime A is React-free and boundary-locked).

## Screens and navigation (MVP subset)

Static native-stack tree (`createNativeStackNavigator` + `createStaticNavigation`), copied
from upstream's `Stack.tsx` and pruned to the MVP. Flat thread routes (not a nested
navigator — required for the iOS-26 shared-header morph between Home and Thread). Sheet
routes are excluded from the adaptive-layout pathname so opening a sheet never disturbs the
active thread.

| Route                            | Purpose                                    | Presentation                                             | Runtime-A data                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Home**                         | Project/thread list                        | card, glass header                                       | `state/threads` selectors (`selectSidebarThreadsAcrossEnvironments`, `selectProjectByRef`), `bootstrapComplete`; connection status                                                                                                                                       |
| **Thread**                       | Chat detail                                | card, glass header                                       | `state/threads` store + `selectThreadByRef`; `state/session` derivations (timeline, work-log, approvals, plan); `state/composer` (draft store + send engine); `state/message-queue`; `state/user-input`; the supervisor's `retainThreadDetailSubscription` while mounted |
| **ThreadReview**                 | Review/diff                                | card, solid header                                       | `TurnDiffSummary` from state/threads; full diffs via `client.orchestration.getTurnDiff`/`getFullThreadDiff`; an app-side keyed-query/atom cache (§6)                                                                                                                     |
| **ThreadReviewComment**          | Comment on selection                       | formSheet [0.55, 0.92] (iOS) / fullScreenModal (Android) | composer draft (`appendReviewCommentToDraft`)                                                                                                                                                                                                                            |
| **Connections / ConnectionsNew** | Environment list / pair                    | formSheet / card                                         | `createSavedEnvironmentCatalog`, `createPrimaryAuth` pairing, `resolveRemotePairingTarget`; QR via `expo-camera`                                                                                                                                                         |
| **SettingsSheet** (nested)       | Settings hub                               | formSheet                                                | server settings/config RPC (`client.server.*`, `serverState` atoms); local appearance prefs; hosted account surface (`hostedHubController`) when hosted mode is enabled                                                                                                  |
| **Onboarding / SignIn**          | First-run connect + hosted passkey sign-in | formSheet                                                | `hostedHubController.bootstrap/signIn`, `PasskeyCeremony` — **gated on §8** for hosted mode; direct-node pairing works today                                                                                                                                             |

Deferred routes present in upstream, omitted here: `ThreadTerminal`, `ThreadFiles`/
`ThreadFile`, `Git*` sheets (source-control is reachable but secondary; MVP shows diffs,
not the full git action set), the cloud `ConnectOnboarding`/waitlist.

Linking prefixes use Ryco reverse-DNS schemes (§7). Deep links carry
`environmentId`/`threadId` params only — never credentials (the pairing token is consumed
once via `PairingCredentialSource` and cleared, matching the web take-once invariant).

## Platform adapters (the contract surface to implement)

Every contract below is implemented in `apps/mobile/src/platform/` from the RN primitive,
with the cited `apps/web` file as the behavioral template. Grouped by where the contract
lives in runtime A.

**Core platform services** (`packages/client-runtime/src/platform/index.ts`):
`Endpoint` (configured node/Hub origin — no `window.location`), `Socket` (RN global
`WebSocket`), `AppLifecycle` (`AppState` + `@react-native-community/netinfo`, mapping
`active`→foreground/resume and connectivity→online/offline), `KV`
(`expo-sqlite/kv-store`), `SecretKV` (`expo-secure-store`; keys are `EnvironmentId`s,
sanitized to the SecureStore charset; `set` returns `false` on failure), `HttpClient`
(RN `fetch`, **resolving relative pathnames against the configured origin** — the web
adapter relies on browser base-URL resolution the RN client must replicate),
`PasskeyCeremony` (native passkeys re-encoded to the base64url JSON transcript),
`SessionCredentials`, `PairingCredentialSource` (deep-link/QR take-once),
`AttachmentCodec` (expo-image-picker asset → `{uri}` or expo-file-system bytes →
`{bytes}`), `Clock`/`FrameScheduler` (`performance.now`/`requestAnimationFrame`),
`Observability` (`NOOP_OBSERVABILITY` for MVP), `ClientRuntimeConfig` (app config object).

**Configurator seams** (must all be wired, each with its web template):
`configureThreadsRuntime` (`apps/web/src/store.ts` template — clock/frame/observability/
`isHostedHubMode`/`resolveAttachmentPreviewUrl`), `configureHostedRuntime`
(`apps/web/src/hostedHub/runtime.ts` — endpoint/httpClient/passkeyCeremony/
sessionCredentials/`nodeLifecycle`/**bound** timers/foreground/relay factory/
`createRelaySocket`), the composer store factory
(`createComposerDraftStore<TImage>` with MMKV/SQLite storage, a `File`-free image type,
no-op `revokePreviewUrl`), `createTerminalStateStore` (required even without a terminal
screen — the state sink's `clearTerminalState` writes through it), `createMessageQueueStore`,
`createEnvironmentConnectionSupervisor` (the largest seam — timers, throttle, primary/
saved connection factories, `subscribeBrowserResume` driven by `AppState`, the
`EnvironmentStateSink`), `createSavedEnvironmentCatalog`, `createPrimaryAuth`,
`createPrimaryEnvironmentContext`, `createRemoteEnvironmentApi`, `WsTransport`/
`createWsRpcClient`, `seedWsConnectionOnlineStatus`, and the send-engine injections
(`commitSendTurnDispatch` with `api`/`newCommandId`/`beginLocalDispatch`/
`persistThreadSettingsForNextTurn`).

**Hard rules carried from A:** every injected timer/socket/lifecycle seam is a **bound**
wrapper (the slice-3b `Illegal invocation` lesson); the relay socket implementation must
satisfy the buffer **no-retain** rule (the engine zeroes ticket/frame buffers after use);
singletons stay single-homed; no import-time side effects in wiring modules.

## Per-screen data and the native modules

- **Chat/thread:** feed virtualized with `@legendapp/list` `KeyboardAwareLegendList`
  (upstream's patched config, incl. the iOS-26 content-inset math); composer is the native
  `t3-composer-editor` view bound to `createComposerDraftStore`; assistant markdown via
  `t3-markdown-text` (`SelectableMarkdownText`, iOS native, JS fallback elsewhere) with
  shiki highlight; keyboard via `react-native-keyboard-controller` (patched). Approvals/
  user-input cards read `state/session` + `state/user-input`; sends go through the runtime
  send engine + `message-queue` (offline outbox drains on reconnect via `AppLifecycle`).
- **Review/diff:** the whole diff is one native canvas (`t3-review-diff`,
  `T3ReviewDiffSurface`) fed `rowsJson`/`tokensJson`; JS supplies rows from the diff parser
  (`@pierre/diffs`) and shiki tokens patched into the visible range; `TurnDiffSummary` comes
  from state, full content from `getTurnDiff`/`getFullThreadDiff` RPC, cached in an app-side
  keyed-query layer (§6). Comment composer appends to the thread draft.
- **Connection/settings:** plain scroll lists over the catalog + primary-auth pairing;
  QR pairing via `expo-camera`; native header buttons via `t3-native-controls`; settings
  read server config/settings RPC + local appearance prefs.

## Styling

uniwind (Tailwind-for-RN) with upstream's `global.css` token system re-themed to Ryco
brand colors; DM Sans (or Ryco's face) via `expo-font`. Liquid Glass gated behind the
single `NATIVE_LIQUID_GLASS_SUPPORTED` predicate (iOS + capability), three layers:
`@callstack/liquid-glass` (composer pill, popovers, nav), `expo-glass-effect` (glass
surfaces/safe-area bar), `expo-blur` (Android menu backdrops). Dark mode via
`userInterfaceStyle: automatic`; safe areas via `contentInsetAdjustmentBehavior:
automatic` + transparent headers rather than manual insets.

## Auth story (two planes) and the workstream-C dependency

Runtime A exposes **two** auth planes; the MVP ships the first now and the second when C
lands:

1. **Direct-node bearer (works today).** `createRemoteEnvironmentApi` implements the full
   bearer flow: exchange a pairing credential at `/api/auth/bootstrap/bearer` → bearer
   token in `SecretKV` (7-day usability window) → `wsToken` for the socket. This is the
   MVP's primary connection path: pair to a node (QR/manual), tokens in the Keychain, no
   cookies. Fully RN-viable against the runtime as-is.
2. **Hosted-Hub passkey (blocked on C).** `HostedHubApi` hardcodes
   `credentials: "same-origin"` with no bearer branch
   (`authorization/api.ts:485`); `SessionCredentials.mode: "bearer"` is typed but
   unimplemented, and relay-ticket issuance requires the cookie session's CSRF token. So a
   native hosted client needs a **Hub-side bearer session + bearer ticket issuance** — new
   Hub control-plane work, which is **workstream C** (private, security-reviewed). The
   relay WebSocket itself is already cookie-free (in-band single-use ticket), and native
   passkeys additionally need the Hub's RP reachable via associated domains
   (apple-app-site-association) — an infra prerequisite. **The MVP is built so hosted mode
   is a configuration/adapter switch that activates when C ships; it does not block
   direct-node use.**

## Bundling and runtime environment

Metro must resolve the workspace packages' `exports` maps (raw-TS `import` condition),
transpile them from outside the app root (`watchFolders` + babel), and support
self-referencing imports. `babel-preset-expo` with `unstable_transformImportMeta: true`
(load-bearing for Effect). Pin the **identical** effect version (catalog `4.0.0-beta.59`)
so RPC/Schema stay wire-compatible with the node. Hermes polyfills, taken from the
package's own `contractsGlobals.d.ts` shim inventory: `react-native-url-polyfill` (URL +
searchParams), `atob`/`btoa` if the Hermes build lacks them, `TextEncoder`/`TextDecoder`,
and confirm ES2023 array methods (`toSorted`) exist or are downlevelled. shiki roots pinned
via `metro.config.js` `extraNodeModules` (upstream's pattern). zustand persisted stores use
injected storage (no localStorage).

**New design finding (not modeled in A or the web app):** iOS backgrounding kills the
WebSockets, and nothing in the runtime models suspension beyond `AppLifecycle` "resume" +
the supervisor's `reconnectAfterResume` heartbeat check. The mobile `AppLifecycle` adapter
must drive resume/reconnect aggressively from `AppState` foreground transitions, and the
connection UI must present reconnecting state clearly. This is the mobile analogue of the
web hosted-lifecycle's `useHostedBrowserLifecycle`.

## Publishing and local testing

- **EAS** profiles copied from upstream (development/preview/production) with Ryco slug,
  bundle IDs, and channels; `runtimeVersion.policy: fingerprint`; `expo-updates` OTA
  channels. `development` is a dev client (no Expo Go — native modules).
- **TestFlight** via EAS Submit (`ascAppId` once the App Store Connect record exists);
  Apple Developer Program ($99/yr) for TestFlight, associated domains, and native passkeys.
- **Local, no TestFlight:** iOS Simulator via a dev-client build + Metro fast-refresh; the
  full loop works against a **local or staging node over LAN** (the ATS local-network
  entitlement is in the scaffold). A physical device runs via a free Personal Team
  dev-client build (reduced capabilities).
- **Agent gates** (CI-independent, since agents can't drive the Simulator UI):
  `typecheck`, `vp test run` (unit/component), and the prebuild/EAS build. Interactive UI
  QA is the owner's, locally. **Native passkeys and associated-domains cannot be fully
  proven on the Simulator** — validate on a real device early; never fabricate device
  evidence.

## Licensing (MIT notices that must travel)

Copied files retain the T3 Tools MIT notice: the repo `LICENSE` (covers the app,
`t3-review-diff`, `t3-native-controls`); `t3-composer-editor/LICENSE` (Expo);
`t3-markdown-text/LICENSE` + `UPSTREAM.md` (Bluesky PBC, derived from
react-native-uitextview). `t3-terminal`'s notices apply only if/when it is copied in v1.1.

## Strip list (T3-proprietary — removed or replaced)

EAS project id / `owner: pingdotgg` / slug; `com.t3tools.*` bundles and `t3code://`
schemes; `appleTeamId`/`ascAppId`; the `clerk.t3.codes` RP and the entire Clerk/cloud
plane (`features/cloud/*`, `@clerk/expo`, Google client IDs, managed-relay, DPoP,
waitlist); `T3CODE_*`/`EXPO_PUBLIC_CLERK_*` env namespaces; the repo-root
`scripts/lib/{brand-assets,public-config}` imports (replaced with Ryco equivalents);
Axiom default endpoint; `T3Wordmark`/`BrandMark` and brand assets; and — for the MVP —
the showcase rig, widgets, agent-awareness push, share extension, quick actions, and
`t3-terminal`. Every `T3*` native view/module and `@t3tools/*` package is renamed to Ryco
identifiers (touches podspecs, `expo-module.config.json`, Kotlin package paths, codegen
spec names).

## Delivery slices (each its own spec-approved plan → PR cycle, per the program)

- **B1 — scaffold + adapters + auth:** copy and strip the Expo scaffold; implement all
  platform adapters and the runtime-A wiring; direct-node bearer pairing end-to-end on the
  Simulator against a local node. Native passkey auth stubbed behind the hosted-mode
  switch (activates with C).
- **B2 — MVP screens:** Home, Thread (composer/feed/approvals via the copied native
  modules + Liquid Glass), Review/diff (native canvas), Connection/Settings — all on
  runtime A state.
- **B3 — EAS + TestFlight:** dev/preview/production profiles, ASC app record, TestFlight,
  OTA channels; the launch/connect runbook.
- **Fast-follow:** workstream C (hosted bearer session + associated domains) unblocks
  hosted passkey login; then v1.1 (terminal module, file browser, Android).

Each slice is regression-gated with `typecheck` + `vp test run` + the prebuild/EAS build;
interactive QA is the owner's on the Simulator/device.
