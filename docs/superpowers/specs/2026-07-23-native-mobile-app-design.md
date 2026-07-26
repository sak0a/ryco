# Ryco Native Mobile App — iOS MVP Design

- **Status:** Owner-approved, 2026-07-23
- **Scope:** `apps/mobile` (public, `sak0a/ryco`). New Expo/React Native app consuming
  the completed `@ryco/client-runtime`. No changes to `apps/web`, the runtime package,
  the node, or the Hub in this workstream — except the one external dependency called out
  in §8, which is workstream C.
- **Depends on:** workstream A (merged: `@ryco/client-runtime` slices 1–6, public main
  `08ba0c14`) and the MIT reference `pingdotgg/t3code` (`upstream/main`).

> **Currency note (2026-07-26).** B1, B2, the dark/glass pass, and the hosted relay plane
> (L3) have all merged; B3 has not started. Statements below marked **[stale]** were true when
> this spec was approved and are corrected in place. For the current state of the program —
> including what has never run on hardware — read
> **`docs/superpowers/plans/2026-07-26-mobile-program-status.md`**, which is authoritative
> wherever it disagrees with this file.

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

| Route                            | Purpose                                                 | Presentation                                             | Runtime-A data                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Home**                         | Project/thread list                                     | card, glass header                                       | `state/threads` selectors (`selectSidebarThreadsAcrossEnvironments`, `selectProjectByRef`), `bootstrapComplete`; connection status                                                                                                                                                                                                                                                                     |
| **Thread**                       | Chat detail                                             | card, glass header                                       | `state/threads` store + `selectThreadByRef`; `state/session` derivations (timeline, work-log, approvals, plan); `state/composer` (draft store + send engine); `state/message-queue`; `state/user-input`; the supervisor's `retainThreadDetailSubscription` while mounted                                                                                                                               |
| **ThreadReview**                 | Review/diff                                             | card, solid header                                       | `TurnDiffSummary` from state/threads; full diffs via `client.orchestration.getTurnDiff`/`getFullThreadDiff`; an app-side keyed-query/atom cache (§6)                                                                                                                                                                                                                                                   |
| **ThreadReviewComment**          | Comment on selection                                    | formSheet [0.55, 0.92] (iOS) / fullScreenModal (Android) | composer draft (`appendReviewCommentToDraft`)                                                                                                                                                                                                                                                                                                                                                          |
| **Connections / ConnectionsNew** | Environment list / pair                                 | formSheet / card                                         | `createSavedEnvironmentCatalog`, `createPrimaryAuth` pairing, `resolveRemotePairingTarget`; QR via `expo-camera`                                                                                                                                                                                                                                                                                       |
| **SettingsSheet** (nested)       | Settings hub                                            | formSheet                                                | server settings/config RPC (`client.server.*`, `serverState` atoms); local appearance prefs; hosted account surface (`hostedHubController`) when hosted mode is enabled                                                                                                                                                                                                                                |
| **Onboarding / SignIn**          | Hosted passkey sign-in **[stale: "first-run connect"]** | formSheet                                                | `hostedHubController.bootstrap/signIn`, `PasskeyCeremony` — shipped. The route is now the hosted sign-in sheet only (`OnboardingRouteScreen.tsx` → `HostedSignIn`), reached on demand from the Hub-nodes section and the account screen. **Nothing presents it on first run**, so a new direct-plane user gets Home's empty state → "Pair a device" → `ConnectionsNew`; there is no first-run welcome. |

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
  (upstream's patched config, incl. the iOS-26 content-inset math) **[stale — not built: both
  Home and Thread are plain `ScrollView`s (`HomeScreen.tsx:119`, `ThreadDetailScreen.tsx:127`)
  and `@legendapp/list` has zero imports; nothing is virtualized]**; composer is the native
  `ryco-composer-editor` view bound to `createComposerDraftStore` (shipped); assistant markdown
  via `ryco-markdown-text` (`SelectableMarkdownText`, iOS native, JS fallback elsewhere) with
  shiki highlight **[stale — not wired: the wrappers at `src/native/SelectableMarkdownText*.tsx`
  have zero importers and assistant text renders as a plain `<Text>`; only the module's
  JS-only `/file-icons` and `/links` submodules are consumed, by the composer]**; keyboard via
  `react-native-keyboard-controller` (shipped, `AppProviders.tsx`). Approvals/
  user-input cards read `state/session` + `state/user-input`; sends go through the runtime
  send engine + `message-queue` (offline outbox drains on reconnect via `AppLifecycle`).
- **Review/diff:** the whole diff is one native canvas (`t3-review-diff`,
  `T3ReviewDiffSurface`) fed `rowsJson`/`tokensJson`; JS supplies rows from the diff parser
  (`@pierre/diffs`) and shiki tokens patched into the visible range; `TurnDiffSummary` comes
  from state, full content from `getTurnDiff`/`getFullThreadDiff` RPC, cached in an app-side
  keyed-query layer (§6). Comment composer appends to the thread draft.
- **Connection/settings:** plain scroll lists over the catalog + primary-auth pairing;
  QR pairing via `expo-camera` (shipped — `ConnectionsNewRouteScreen.tsx:89-93`, never
  device-exercised because the Simulator has no camera); native header buttons via
  `ryco-native-controls` **[stale — the Android `RycoHeaderButtonView` wrapper
  (`src/native/HeaderButton.android.tsx`) has zero importers; only the module's iOS
  `RycoKeyboardCommands` half is wired, via `HardwareKeyboardCommandProvider`]**; settings
  read server config/settings RPC + local appearance prefs.

## Styling

uniwind (Tailwind-for-RN) with upstream's `global.css` token system re-themed to Ryco
brand colors; DM Sans (or Ryco's face) via `expo-font`. Liquid Glass gated behind the
single `NATIVE_LIQUID_GLASS_SUPPORTED` predicate (iOS + capability), three layers:
`@callstack/liquid-glass` (composer pill, popovers, nav), `expo-glass-effect` (glass
surfaces/safe-area bar), `expo-blur` (Android menu backdrops). Dark mode via
`userInterfaceStyle: automatic` **[stale — the app ships `"dark"` (`app.config.ts:175`) per
the dark-by-default decision in the glass plan §4, so first paint is dark before JS resolves;
`src/lib/appScheme.ts` is the seam a future appearance preference plugs into]**; safe areas
via `contentInsetAdjustmentBehavior: automatic` + transparent headers rather than manual
insets.

## Auth story (two planes) and the workstream-C dependency

Runtime A exposes **two** auth planes; the MVP ships the first now and the second when C
lands:

1. **Direct-node bearer (works today).** `createRemoteEnvironmentApi` implements the full
   bearer flow: exchange a pairing credential at `/api/auth/bootstrap/bearer` → bearer
   token in `SecretKV` (7-day usability window) → `wsToken` for the socket. This is the
   MVP's primary connection path: pair to a node (QR/manual), tokens in the Keychain, no
   cookies. Fully RN-viable against the runtime as-is.
2. **Hosted-Hub passkey. [stale — this is no longer blocked; it shipped.]** As written:
   "`HostedHubApi` hardcodes `credentials: "same-origin"` with no bearer branch
   (`authorization/api.ts:485`); `SessionCredentials.mode: "bearer"` is typed but
   unimplemented, and relay-ticket issuance requires the cookie session's CSRF token."

   **Correction (2026-07-26).** The bearer branch landed with L2 (`a3f6ec93`, #229) and the
   mobile plane with L3 (`c152e4cc`, #232), extended by #233/#235/#237/#238/#241. `api.ts:1366-1394`
   now selects `credentials: "omit"` + `Authorization: DPoP <token>` + an RFC-9449 proof in
   bearer mode, and `"same-origin"` + CSRF otherwise. Mobile supplies a Secure Enclave /
   StrongBox P-256 key (`modules/ryco-device-key/`), a DPoP signer, a native passkey
   ceremony, the relay data channel, and native account management — **every `/api/account/*`
   route is DPoP-native**; only the fallback _login_ routes under `/api/auth/*` (password,
   email, TOTP, recovery-code redemption, owner bootstrap, invitation redemption) are
   same-origin-gated, and those go through an ephemeral `openAuthSessionAsync` browser whose
   session the app never adopts.

   What remains is **not client work**: the app has never run on real hardware, and the
   deployment prerequisites (Apple Developer Program membership for the team id, a Hub on a
   real domain serving the association documents, a matching RP id, a live enrolled node)
   are all outstanding. See the status doc §4.

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
  switch (activates with C). — **merged (#225, #228).**
- **B2 — MVP screens:** Home, Thread (composer/feed/approvals via the copied native
  modules + Liquid Glass), Review/diff (native canvas), Connection/Settings — all on
  runtime A state. — **merged (#227), plus the dark/Liquid-Glass pass (#230). The glass
  plan's de-hardcode sweep (T2.7), contrast audit (T3.1), and Android fallback verification
  (T3.2) are still open.**
- **B3 — EAS + TestFlight:** dev/preview/production profiles, ASC app record, TestFlight,
  OTA channels; the launch/connect runbook. — **not started; no plan file exists.**
  `eas.json` carries the build profiles from B1 but has no iOS submit config and no
  `ascAppId`; `app.config.ts` still has `updates: { enabled: false }` and no EAS project id.
- **Fast-follow:** workstream C (hosted bearer session + associated domains) unblocks
  hosted passkey login; then v1.1 (terminal module, file browser, Android). — **C has landed
  and the mobile hosted plane with it (L3, #232 + #233/#235/#237/#238/#241); associated
  domains remain a deployment prerequisite, not a code one. Android is implemented but has
  had no QA of any kind.**

Each slice is regression-gated with `typecheck` + `vp test run` + the prebuild/EAS build;
interactive QA is the owner's on the Simulator/device.
