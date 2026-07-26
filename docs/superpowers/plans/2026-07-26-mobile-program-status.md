# Ryco native mobile — program status

**Verified at `180e340a` (main, 2026-07-26).** Everything below was checked against the tree
and the commands were run; where a claim could not be verified from this repository it says
so explicitly and names what would settle it. This document supersedes the "current state"
sections of the B1/B2/glass/L3 plans and of the mobile design spec wherever they disagree.

Read §1 first. The two constraints in it shaped every decision in the program and will shape
the next person's; several defects have already been caused by not knowing them.

---

## 1. Two structural constraints

### 1.1 There is no React renderer in the mobile test suite

`react-native` ships untranspiled Flow that the test bundler cannot parse. Verified by
adding a test that does nothing but `import { View } from "react-native"`:

```
RolldownError: Parse failure: Parse failed with 1 error:
Flow is not supported
At file: node_modules/react-native@0.85.3/react-native/index.js:1:0
```

The runner is `vp test run` (vite-plus / rolldown) — `bun run --cwd apps/mobile test`.
**Never `bun test`.** There is no Babel/Metro transform in that path, so nothing can mount a
React Native component. Consequences, all load-bearing:

- **Screen logic lives in pure model modules** driven from fake store snapshots, not in the
  `.tsx`. `hostedAuthModel.ts` (566 lines) and `hostedAccountModel.ts` (1112 lines) are the
  pattern: the `.tsx` reads the store, hands the snapshot to a derivation, and lays out the
  result. `HubNodeSection.test.ts:159-161` goes further and hand-rolls a depth-first
  "renderer" that invokes function components directly.
- **`.tsx` files have zero executable coverage.** 68 `.tsx` files in `apps/mobile/src`; zero
  `*.test.tsx` files exist and none can.
- **Native modules must be lazily imported _inside_ functions.** `requireNativeModule` /
  `requireNativeView` reach the RN bridge as an import side effect and break unrelated
  suites. See `deviceKey.ts:31-34` and `passkeyCeremony.ts:33-36` for the memoized
  `import()`-inside-a-function shape, and `platform.test.ts:21-42` for the `vi.mock`
  counterpart.

**Lifecycle bugs live precisely in that gap, and it has bitten twice.**

1. `useHostedAppLifecycle` was written and never mounted, so backgrounding never suspended
   the hosted browser. Caught by adversarial review, not by a test (recorded in PR #232's
   security-review list, item 7). It is now mounted as `<HostedAppLifecycle />` at `App.tsx:86` (the hook itself at `App.tsx:65-67`).
2. The hosted account screen shipped without the `useEffect` that takes a recovery-code
   display lease. The runtime publishes a rotation's codes only if a lease was live when the
   user asked, so the destructive half succeeded — every code the user had saved stopped
   working — and the surface could not show the replacement. Fixed in `b8b5f61b` (#241). The
   test file records the residue at `hostedAccountModel.test.ts:831-837`: everything the
   effect _does_ is asserted; _that it is called_ is not, and cannot be.

If you change a mount effect on a mobile screen, no test will catch you. Review it by hand.

### 1.2 `tsc` writes ANSI codes between "error" and "TS"

`grep 'error TS'` silently matches nothing and reports a false clean. Verified by
introducing one deliberate error and piping raw:

```
^[[96msrc/lib/__tserr.ts^[[0m:^[[93m1^[[0m:^[[93m14^[[0m - ^[[91merror^[[0m^[[90m TS2322: ^[[0m…
```

`… | grep -c 'error TS'` → **0**. `… | sed -e $'s/\x1b\\[[0-9;]*m//g' | grep -c 'error TS'`
→ **1**.

This already shipped four type errors to main; see `35756079` ("repair type errors shipped
with the L3 T2 device key"), whose message documents the same mechanism. **Always ANSI-strip
or use the exit code.**

---

## 2. Gate status at `180e340a`

| Gate         | Command                          | Result                                      |
| ------------ | -------------------------------- | ------------------------------------------- |
| Mobile tests | `bun run --cwd apps/mobile test` | **54 files / 470 tests, all pass** (~1.4 s) |
| Typecheck    | `bun typecheck` (ANSI-stripped)  | 12/12 tasks successful, **0 `error TS`**    |

File shape in `apps/mobile/src`: 68 `.tsx`, 109 non-test `.ts`, 54 `.test.ts`, 0 `.test.tsx`.

---

## 3. What shipped

### 3.1 Direct-node plane (B1 #225, B2 #227, glass #230)

Pairing → bearer token in SecureStore → ws-token → supervisor → thread list. MVP screens:
Home, Thread, Review, Connections, Settings. Dark-by-default with the uniwind token system
in `global.css`. This plane is untouched by the hosted work and is the fallback everywhere
hosted mode is unavailable.

**Two-plane isolation is intact and deliberate.** Both flags are still false —
`environmentDriver.ts:329` `isHostedMode: () => false` and `threadsRuntime.ts:19`
`isHostedHubMode: () => false`. Flipping either would disable the direct plane's registry
sync and resume-reconnect. The hosted plane instead enters through
`environmentDriver.ts:344-345`, where `createPrimaryConnection` now returns
`createHostedPrimaryConnection(...)` — which returns `null` when no hosted node is selected,
keeping direct-only builds byte-identical.

### 3.2 Hosted relay plane (L3 #232) and account management (#233, #235, #237, #238, #241)

**Platform seams — `apps/mobile/src/platform/`**

| File                               | What it is                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passkeyCeremony.ts`               | Native ceremony over `react-native-passkey@3.5.0`, lazily imported. The plan named `react-native-passkeys` (plural) first; it was rejected — see PR #232. |
| `passkeyTranscript.ts` (362 lines) | Pure encode/normalize/error-bounding layer, no native imports, unit-tested against fixtures.                                                              |
| `deviceKey.ts`                     | Memoized `DpopSigningKey` over the hardware module. Rejects any backing not in `{secure-enclave, strongbox}`. **No software fallback, ever.**             |
| `ecdsa.ts`                         | DER↔raw signature and X9.63↔JWK conversion. Differential-fuzzed against OpenSSL P-256 (`ecdsa.fuzz.test.ts`).                                             |
| `dpopSigner.ts`                    | The runtime's `DpopSignerService` over the enclave key.                                                                                                   |
| `sessionCredentials.ts`            | Bearer-mode credentials: token in `SecretKV` plus a synchronous in-memory holder.                                                                         |
| `config.ts`                        | Fail-closed hosted config read from `expoConfig.extra`. Anything unparseable, insecure, or origin-impure yields `null` and hosted mode simply stays off.  |

**The device key — `apps/mobile/modules/ryco-device-key/`** (iOS Swift + Android Kotlin, a
local Expo module, package `@ryco/mobile-device-key`). Non-exportable P-256; the module
exposes `ensureKey` / `sign` / `hasKey` / `deleteKey` and **no export or extract path**. iOS
residency is three-valued (`RycoDeviceKeyModule.swift`): replace a key proven software-backed,
but _refuse without destroying_ one whose residency cannot be measured — an earlier version
deleted possibly-valid enclave keys on every launch.

**Runtime wiring — `apps/mobile/src/hostedHub/`**

- `runtime.ts` — `configureMobileHostedRuntime()`; resolves the DPoP signer _before_
  `configureHostedRuntime` (the API constructor throws at bootstrap otherwise), bound timer
  wrappers, once-only foreground seam. `ensureMobileHostedSession()` is the single memoized
  entry point and hydrates the token before `hostedHubController.bootstrap()`.
- `relaySocket.ts` — `wss://<hub-origin>/v1/relay/client`, byte-stable, empty query. Supplies
  a `WebSocket`-shaped facade plus the `RelaySocket` seam; `HostedRelayEngine` still owns
  framing, the CBOR auth frame, flow control. RN has no reliable `EventTarget`/`MessageEvent`,
  so the facade has its own listener registry.
- `primaryConnection.ts` — the node connection _through the relay_; target is the Hub's relay
  endpoint, never a node address.
- `useHostedAppLifecycle.ts` — foreground/background/online/offline → `suspendBrowser` /
  `resumeBrowser`. Mounted once as `<HostedAppLifecycle />` at `App.tsx:86`.
- `state.ts`, `runtimeConfig.ts`, `nodeLifecycle.ts`, `primaryEnvironment.ts`.

**Surfaces — `apps/mobile/src/features/hostedHub/`**

- `HostedSignIn.tsx` — rendered by `OnboardingRouteScreen.tsx`; sign-in, cancel, session
  expired, hosted-unavailable, recovery-code display, delivery-unknown acknowledgement.
- `HostedAccountRouteScreen.tsx` — the `SettingsAccount` nested route: passkey list, add
  passkey, revoke passkey, rotate recovery codes, password set/remove, TOTP enrol/verify/
  revoke, email verification, sign out. All native DPoP calls; **nothing here opens a browser**.
- `HubNodeSection.tsx` — Hub nodes as a second labelled section inside the existing
  `Connections` sheet, fail-closed disabled unless `directoryStatus === "ready" &&
browserStatus === "current" && !revokedAt`.
- `HostedFallbackSession.ts` — `expo-web-browser`'s `openAuthSessionAsync` (ephemeral). Used
  only for the **no-passkey login** path. Ships no in-app WebView at all, deliberately: on
  Android an in-app WebView writes to the app-global cookie jar that OkHttp and the RN
  WebSocket share, and a Hub-origin `Cookie` on the relay upgrade is a hard 403.
- `hostedAuthModel.ts`, `hostedAccountModel.ts`, `hostedTotpQr.ts` — the testable logic.

**Configuration — `app.config.ts`.** `relyingParty` is now env-driven
(`EXPO_PUBLIC_RYCO_RELYING_PARTY`, defaulting to `app.ryco.dev`) with build-time validation
that it equals the Hub host or a registrable parent of it (`app.config.ts:143-157`), so a
staging Hub on its own domain no longer needs a code change. A hosted build also fails at
config time without `RYCO_IOS_APPLE_TEAM_ID`, and refuses the personal-team bundle-id
override (both would make the `webcredentials` association unresolvable). Associated domains
and an `autoVerify` App Links intent filter are emitted for the RP host.

**Routing.** Exactly one route was added anywhere: `SettingsAccount`, nested in
`MVP_SETTINGS_SHEET_ROUTES`. The root route set is unchanged.

---

## 4. Device verification: nothing in this program has run on real hardware

**No passkey ceremony, no Secure Enclave / StrongBox key generation, and no relay data path
has ever executed on a device.** The Simulator physically cannot do any of them: there is no
Secure Enclave, no Credential Manager, and no camera. Everything claimed above is
model-level and gate-level. No device evidence is claimed anywhere in the branch history,
and none should be added without an actual run.

**All nine rows of the L3 owner acceptance matrix are open** (plan §"Task 9", repeated in
PR #232's body): enclave key creation and persistence; native passkey sign-in and
`restoreSession` across restart; `/api/nodes` populating with presence; `selectNode` → ticket
→ relay upgrade → `ready` → thread list through the relay; background/foreground resumption;
node switching teardown; the C2 webview round trip; the Android post-webview relay upgrade;
and direct-plane regression with and without hosted mode.

The only agent-checkable half of any row is row 1's negative: with no hardware backing
reported, `ensureKey` fails closed and no hosted session is configured.

**Prerequisites before any of it can be attempted:**

1. An **Apple Developer Program membership**, for `RYCO_IOS_APPLE_TEAM_ID`. Without it the
   hosted build refuses to configure, because `webcredentials:` resolves against
   `TEAMID.BUNDLEID`.
2. A **Hub deployed on a real domain**, serving `/.well-known/apple-app-site-association` as
   `application/json` with no redirect, and `/.well-known/assetlinks.json` with
   `delegate_permission/common.get_login_creds` for the Android package and its
   **uppercase** colon-separated SHA-256 fingerprints.
3. **`EXPO_PUBLIC_RYCO_RELYING_PARTY` matching the Hub's `RYCO_HUB_WEBAUTHN_RP_ID`.** The
   build-time check only proves the RP covers the Hub host; that it equals the Hub's
   configured RP id is a deployment fact this repo cannot see.
4. **`EXPO_PUBLIC_RYCO_HUB_URL` = the Hub public origin**, not the RP-ID host. Every DPoP
   `htu` is signed against that origin.
5. A **live enrolled node** for the relay path (rows 4–6). Ticket issuance returns 409
   `node_offline` otherwise.

Separately: the **C2 email flows are code-complete on the Hub but deliver nothing** until an
operator wires a sending domain. "No email arrived" is not a client bug.

---

## 5. Outstanding — audited today, not copied from the old list

### 5.1 The de-hardcode sweep is not done

Glass-plan task T2.7 ("remove every `dark:` variant… grep proves no stray hardcoded
amber/sky/rose/violet"). Three files still carry both a `dark:` prefix and a raw Tailwind
palette colour:

| File                       | Line    | What is there                                                                   |
| -------------------------- | ------- | ------------------------------------------------------------------------------- |
| `PendingUserInputCard.tsx` | 63-64   | `border-sky-500/40 bg-sky-500/10`, `text-sky-700 dark:text-sky-300`             |
| `PendingApprovalCard.tsx`  | 39-40   | `border-amber-500/40 bg-amber-500/10`, `text-amber-700 dark:text-amber-300`     |
| `ThreadDetailScreen.tsx`   | 172-174 | `border-violet-500/40 bg-violet-500/10`, `text-violet-700 dark:text-violet-300` |

`rg -c 'dark:'` is `1` for each. Two other `dark:` hits in `apps/mobile/src` are **not**
token classes and should not be swept: `Stack.tsx:46` (`DynamicColorIOS({light, dark})`) and
`shikiReviewHighlighter.ts:59` (a shiki theme key). The intended replacements are already
named in the glass plan §5: `--color-accent`, `--color-warning`, and a violet/plan token that
does not yet exist.

### 5.2 The user-message bubble is unresolved, and code and tokens disagree

`global.css` defines `--color-user-bubble` (`#007aff` light / `#0a84ff` dark),
`--color-user-bubble-foreground`, and `--color-user-bubble-foreground-muted`, commented
"iMessage-style user bubble". **All three have zero consumers** anywhere in `apps/mobile`.

What actually renders is `ThreadDetailScreen.tsx:154-161`: `bg-primary` /
`text-primary-foreground` — i.e. white-on-black in dark, black-on-white in light. So the
owner decision is still pending _and_ the tokens are dead code that will mislead the next
person. Settling it means either deleting the tokens or wiring them.

### 5.3 Unwired vendored modules and dependencies

Real consumers counted across `apps/mobile/src`:

| Thing                                                        | Consumers                                                                                       | Status             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------ |
| `ryco-device-key`                                            | `platform/deviceKey.ts`                                                                         | **wired**          |
| `ryco-composer-editor`                                       | `native/ComposerEditor.{ios,native}.tsx` → `components/ComposerEditor.tsx`                      | **wired**          |
| `ryco-review-diff`                                           | `features/review/ReviewSheet.tsx` (registered at `Stack.tsx:273`)                               | **wired**          |
| `ryco-native-controls` — iOS `RycoKeyboardCommands`          | `native/KeyboardCommands.ios.tsx` → `HardwareKeyboardCommandProvider` (mounted `Stack.tsx:213`) | **wired**          |
| `ryco-native-controls` — Android `RycoHeaderButtonView`      | `native/HeaderButton.android.tsx`, which **nothing imports**                                    | **zero consumers** |
| `ryco-markdown-text` — native renderer                       | `native/SelectableMarkdownText.{tsx,ios.tsx}`, which **nothing imports**                        | **zero consumers** |
| `ryco-markdown-text` — JS submodules `/file-icons`, `/links` | the composer (`ComposerEditor.{ios,native}.tsx`)                                                | wired              |
| `@legendapp/list@3.2.0`                                      | none                                                                                            | **zero consumers** |
| `react-native-webview@^13.16.1`                              | none                                                                                            | **zero consumers** |

Notes on the last three:

- The **native markdown renderer is dark**: assistant messages render as a plain
  `<Text className="font-sans text-base …">` (`ThreadDetailScreen.tsx:159-163`). No markdown,
  no shiki, no selection. The whole `RycoMarkdownText` Fabric component, its shadow nodes,
  and its 60-odd file icons are compiled and shipped for nothing today.
- **`@legendapp/list` is unused because both feeds are plain `ScrollView`s**
  (`HomeScreen.tsx:119`, `ThreadDetailScreen.tsx:127`). The design spec calls for
  `KeyboardAwareLegendList` with the iOS-26 content-inset math. Nothing is virtualized; long
  threads will be a problem.
- **`react-native-webview` is unused by design**, not by oversight — `HostedFallbackSession.ts`
  documents at length why the in-app WebView path is refused on Android. It should be dropped
  from `package.json` unless something else wants it.

### 5.4 WCAG AA contrast audit — not done

The glass plan §6 states the targets (normal ≥ 4.5:1, large ≥ 3:1, graphical ≥ 3:1) and
T3.1 requires "a documented ratio table, all AA". **No ratio table exists anywhere in the
repository.** The palette hexes in §3.1 are described by that plan itself as "a derived
reconstruction", so the numbers quoted there (`~17:1`, `~4.5:1`) are design intent, not
measurements. This is a mechanical job — the tokens are all in `global.css` — and nothing
blocks it.

### 5.5 Android QA — none

No Android device or emulator evidence appears in any PR body or plan acceptance. The B2 plan
already said "Android divergences implemented, but no Android QA — iOS ships first" and
nothing since has changed that. What exists on the Android side: Kotlin implementations of
all four native modules, five `withAndroid*` config plugins, `AndroidScreenHeader` /
`AndroidAnchoredMenu`, and the App Links intent filter — all unexercised. Acceptance row 8
(the post-webview relay upgrade, the cookie-jar hazard) is Android-only and is the highest-
risk untested path in the program.

### 5.6 Tablet / adaptive layout — not built

`Stack.tsx:208-211` records the divergence: upstream wraps children in
`AdaptiveWorkspaceLayout` (the tablet split view) and this app does not. `lib/adaptive-
navigation.ts` exists with tests, but no layout consumes it. `ios.supportsTablet: true` is set
in `app.config.ts:183`, so an iPad today gets the phone layout scaled up.

### 5.7 Camera QR pairing — **done**, contrary to older lists

`ConnectionsNewRouteScreen.tsx:89-93` renders `CameraView` with
`barcodeScannerSettings={{ barcodeTypes: ["qr"] }}` and an `onBarcodeScanned` handler, behind
a "Scan QR code" affordance with a permission request; the URL / host+code manual paths are
the fallback. `expo-camera` is registered in `app.config.ts` with a permission string. It has
never been exercised — the Simulator has no camera.

### 5.8 App icons, adaptive icon, splash — still B1 placeholders

`icon.png`, `adaptive-icon.png`, `android-icon-mark.png`, and `splash-icon.png` are **the same
file** (md5 `7abae4ab08c136279eecb1e5cc24e3dd` for all four), unchanged since the B1 scaffold
`173034df`. `android-notification-icon.png` is a separate placeholder. Real Ryco branding was
explicitly out of scope for L3.

### 5.9 B3 (EAS / TestFlight) — no plan exists

- **No plan file.** `docs/superpowers/plans/` contains nothing for B3, EAS, or TestFlight.
- **`app.config.ts:178-180`** — `updates: { enabled: false }`, with the comment "no EAS project
  id is baked in. B3 wires the Ryco EAS project + update URL". There is no `extra.eas` block
  and no project id anywhere.
- **`eas.json` exists from B1** with `development`, `preview`, `preview:dev`, and `production`
  build profiles and `runtimeVersion.policy: fingerprint`. Its `submit` block has **only**
  `production.android.track: internal` — no iOS submit configuration, and no `ascAppId`
  (which needs an App Store Connect record, which needs the Developer Program membership from
  §4).

So B3 is: write the plan, create the ASC record, wire the EAS project id + update URL, turn
`updates.enabled` on, and add the iOS submit profile.

---

## 6. Stale claims corrected elsewhere, and why

These are the corrections applied to the existing docs in the same change as this file.

### 6.1 L3 plan §0.3 — "natively reachable" was aspirational, and the account routes are not browser-only

§0.3 said adding a passkey to an existing account and fetching recovery codes were natively
reachable, and framed the account routes as an exception carved out of a browser-only
surface. Both parts were wrong at the time of writing.

- **At the time, `HostedHubApi` had no method for either.** `addPasskey` and
  `regenerateRecoveryCodes` first appear in `513abe4b` (#233), which landed _after_ the L3
  plan itself (`c152e4cc`, #232). §0.3 described a capability that did not exist yet.
- **All `/api/account/*` routes are DPoP-native.** The runtime's own browser-only allow-list,
  `BROWSER_ONLY_BEARER_PATH_PREFIXES` (`packages/client-runtime/src/authorization/api.ts:98-101`),
  contains exactly two entries — `/api/auth/native/bootstrap/registration/` and
  `/api/auth/native/invitations/registration/` — and no account path. Every other path,
  account routes included, takes the bearer branch at `api.ts:1367-1384`:
  `Authorization: DPoP <token>` + a proof, `credentials: "omit"`, no CSRF header. Only the
  fallback _login_ routes under `/api/auth/*` are same-origin-gated. Mobile does credential
  management natively; the webview is only the no-passkey login path, which is exactly what
  `HostedAccountRouteScreen.tsx` and `HostedFallbackSession.ts` implement.

**Not verifiable from this repository:** the Hub's `authorizePresentedSession` — the function
that takes the DPoP branch whenever `Authorization: DPoP` is present and applies no
same-origin check — is **not in this repo** (`apps/` is desktop, mobile, server, web; the Hub
is workstream C, private). `rg authorizePresentedSession` returns nothing. The evidence above
is the client's model of the Hub, corroborated by the bearer-mode account tests in
`api.test.ts`, not a read of the server. A read of the Hub's request-authorization path would
settle it outright.

### 6.2 "First-run onboarding never presents — the route exists but nothing navigates to it"

Stale. `OnboardingRouteScreen.tsx` is now ten lines that render `<HostedSignIn />`, and two
call sites navigate to it: `HubNodeSection.tsx:328` and `HostedAccountRouteScreen.tsx:88`,
both the "Sign in" affordance. `HubNodeSection.test.ts:307` pins it.

**What is true now:** `Onboarding` is the hosted sign-in sheet, reached on demand from the
Hub-nodes section or the account screen. **There is still no first-run welcome for a new
direct-plane user** — nothing navigates to `Onboarding` (or anywhere else) on launch. A user
with no saved environments lands on Home's `EmptyState` with a "Pair a device" button →
`ConnectionsNew` (`HomeScreen.tsx:127-136`). That is the current first-run experience, and it
is a deliberate consequence of the route being repurposed rather than a bug; but the B2 plan's
"presented on first run when the catalog has no saved environments" never shipped and is not
going to from this route.

### 6.3 `getRecoveryCodes` is `regenerateRecoveryCodes`, and it is a mutation

The Hub handler calls `service.regenerateRecoveryCodes`. The client method is
`POST /api/account/recovery-codes` (`api.ts:753-770`) and its own doc comment is explicit:
"This is a mutation, not a read: it mints a fresh set and invalidates any codes the user
previously saved. Run it only from an explicit, confirmed user action — never on mount,
focus, retry, or reconnect." **It also rotates the session.**

Any doc describing it as a read — including L3 §0.3's "returns codes over a DPoP session" and
Task 6's "Get recovery codes" — is wrong and dangerous: calling it to _display_ codes destroys
the user's saved set. This is not hypothetical; it is exactly the defect fixed in `b8b5f61b`
(#241), where the destructive half succeeded and the replacement could not be shown.

### 6.4 Mobile design spec — the hosted plane is no longer blocked on workstream C

The spec's §"Auth story" states `HostedHubApi` "hardcodes `credentials: "same-origin"` with no
bearer branch (`authorization/api.ts:485`)". That has not been true since the L2 DPoP work
(`a3f6ec93`, #229): `api.ts:1366-1394` picks `"omit"` + `Authorization: DPoP` in bearer mode
and `"same-origin"` + CSRF otherwise. The hosted plane is implemented; what remains is
deployment and device verification (§4), not client work.

The spec is also stale in three smaller ways, corrected in place:

- `userInterfaceStyle: automatic` — the app ships `"dark"` (`app.config.ts:175`), by the
  dark-by-default decision in the glass plan §4.
- The chat feed / assistant markdown / native header buttons described in §"Per-screen data"
  are the three unwired paths in §5.3 above.
- The delivery slices list B3 and workstream C as future; C has landed and B3 has not started.

---

## 7. Things this document does not cover, and known doc debt elsewhere

- **`apps/mobile/README.md` is stale** — it still says "hosted passkey login arrives with
  workstream C". Out of scope for this change (which is confined to `docs/superpowers/**`),
  but it is the first file a new contributor opens.
- **The L3 plan's per-task bodies** are left as the historical record of how the work was
  planned; only §0.3, the section that would actively mislead someone acting on it today, is
  corrected in place. Where a task's "current state" description has since been overtaken,
  this document is authoritative.
- **Nothing here is a security assessment.** Two adversarial reviews were run against the L3
  branch and found ten real defects (PR #232 lists them ranked); a third pass found the
  one-shot-secret lifetime defects fixed in #241. Neither is a substitute for reviewing what
  lands next.
