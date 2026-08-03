# @ryco/mobile

The Ryco iOS-first native app (Expo / React Native), consuming
`@ryco/client-runtime`. It ships the scaffold, platform adapters, direct-node
bearer pairing loop, and hosted Hub system-browser authorization handoff.

## Prerequisites

- The repo's pinned Bun (`bun --version` must match `package.json`'s
  `packageManager`) and `bun install --frozen-lockfile` from the repo root.
- Xcode + an iOS 18 Simulator (native modules; **Expo Go is not supported** —
  a dev client is required).
- A reachable Ryco node (a local desktop node or a staging node) on the same
  LAN / tailnet. The scaffold ships the ATS local-network entitlement.

## Agent-runnable gates (CI-independent)

These run without driving the Simulator:

```sh
bun install --frozen-lockfile
bun run --cwd apps/mobile typecheck        # tsc --noEmit
bun run --cwd apps/mobile test             # vp test run (NEVER `bun test`)
cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config  # config resolves
```

A native `expo prebuild` / EAS `--local` build additionally needs Xcode + the
CocoaPods toolchain (see the runbook below); it cannot be validated in a
headless CI container.

## Launch the dev client + connect to a local/staging node (owner, on a Mac)

Simulator QA uses the development client. Hosted sign-in itself uses the system
browser and the app's custom callback scheme.

1. **Install deps** (repo root): `bun install --frozen-lockfile`.
2. **Prebuild the native iOS project** (first run, or after native-dep/plugin
   changes): `cd apps/mobile && APP_VARIANT=development bun run ios:dev`.
   This runs `expo prebuild --clean --platform ios` and `expo run:ios`, building
   the dev client into the Simulator. A physical device can use a free Apple
   Personal Team — set `RYCO_IOS_PERSONAL_TEAM=1` and
   `RYCO_IOS_PERSONAL_TEAM_BUNDLE_ID`. This omits associated-domain
   entitlements but still supports Hub sign-in through
   `ryco-dev://hosted/complete`; no paid Apple Developer membership is required
   for development.
3. **Start Metro** (if not already running): `bun run --cwd apps/mobile dev:client`.
4. **Start a Ryco node** on the LAN/tailnet and open its **Pair a device**
   screen to produce a pairing URL (`ryco://pair?host=…#token=…`, or an
   `https://…/pair` link). The token is single-use.
5. **Pair** in the app: paste the pairing URL and tap **Pair and connect**. The
   app exchanges the credential for a bearer session token
   (`/api/auth/bootstrap/bearer`), stores it in the iOS Keychain (SecureStore),
   and upserts the environment into the catalog. That upsert fires the
   environment-connection driver: the supervisor opens the live WebSocket with a
   freshly issued ws-token (`/api/auth/ws-token`), subscribes the node's shell
   stream, and syncs it into `state/threads`.
6. **Verify the loop** (the B1 runtime acceptance):
   - **Pairing** shows `paired to <node label>`; **Socket** reaches `connected`.
   - The **thread list** populates from the node stream.
   - Background the app, then foreground it: the connection reconnects. The
     supervisor's `subscribeBrowserResume` seam is bound to RN AppState, so every
     background -> foreground transition re-drives reconnect for any connection
     whose heartbeat went stale while iOS suspended the socket.

## Relay E2EE runtime acceptance (owner, on a physical device)

The relay E2EE protocol (`docs/relay-e2ee-protocol.md`) puts three requirements
on the mobile runtime that no Node test can discharge, because Hermes is the only
engine the app ships and no Node test runs on it:

- §14.5 randomness. Hermes has no `crypto.getRandomValues`, and the pinned
  primitives capture `globalThis.crypto` when their module evaluates — so the
  adapter has to be installed before the first import, not checked later.
- §3.6 canonical CBOR. `cborg` builds a `TextEncoder` at module scope, and React
  Native provides none. Its string codec builds a `TextDecoder` at module scope
  too — Expo's winter runtime supplies that one — and `encode.js` imports it, so
  encoding a transcript needs both.
- §14.2's curve, AEAD, and hash implementations, which are BigInt- and
  typed-array-heavy pure JavaScript.

**There is no Detox/Maestro/e2e infrastructure in this repository and Phase 3 is
not building one.** The evidence below is this written procedure plus the in-app
runner (`src/devtools/e2eeVectorRunner.ts`), run by the owner on hardware. It is
**partial** evidence: §16.4's complete-corpus physical-device gate is not
satisfied by it, and remains open (see below).

### Procedure

1. Build and launch the **development** variant on a **physical device** — not
   the Simulator, whose entropy and native module hosting are the Mac's:
   `cd apps/mobile && APP_VARIANT=development bun run ios:dev`, with
   `RYCO_IOS_PERSONAL_TEAM=1` and `RYCO_IOS_PERSONAL_TEAM_BUNDLE_ID` set for a
   free Apple Personal Team.
2. **The app reaching its first screen is itself step 2.** `polyfills.ts` runs
   before `expo` and before `react-native/Libraries/Core/InitializeCore`; it
   reaches `expo-crypto` through a lazy `require` inside the installed function
   precisely so it does not pull `expo-modules-core` in that early. A white
   screen or an immediate native crash on launch is the signal that the ordering
   broke — check it here rather than assuming it.
3. Open the JS console for the running app (Metro's dev menu → **Open debugger**,
   or `j` in the Metro terminal — the JS keeps running in the device's Hermes,
   which is the point) and run:

   ```js
   await __rycoRunE2eeVectors();
   ```

4. Expect `ok: true` and five `ok: true` checks:

   ```
   { ok: true,
     checks: [ { name: 'runtime globals (§14.5)',           ok: true },
               { name: 'F15 Noise IK vector (§14.1)',       ok: true },
               { name: 'F6 record protection (§9.1)',       ok: true },
               { name: 'F4 node prekey certificate (§7.3)', ok: true },
               { name: 'X25519 agreement keygen (§6.2)',    ok: true } ],
     globals: { csprng: 'adapter', textEncoder: 'adapter' } }
   ```

5. **Record `globals`.** `adapter` means this app installed the implementation;
   `platform` means the Hermes build already had one. Which of the two Hermes
   provides is not knowable from the checked-in tree, and this line is the only
   place the answer is observed. Report it with the run.
6. If `runtime globals (§14.5)` is `false`, **every later case is `false` too and
   none of them ran**: §14.5 is fail-closed, so a runtime the preflight has
   condemned gets no handshake and no key generation, not even diagnostic ones.
   The suite reports the verdict and nothing else on purpose — the values that
   would explain it are key material. Separate the causes from the console
   directly:

   ```js
   typeof globalThis.crypto?.getRandomValues; // "function", or nothing is installed
   typeof globalThis.TextEncoder; // "function", or canonical CBOR cannot load
   typeof globalThis.TextDecoder; // "function", or canonical CBOR cannot load
   crypto.getRandomValues(new Uint8Array(32)); // throws, or comes back all zeros
   ```

   An all-zero return is `expo-crypto`'s native call silently no-opping — the
   failure that asserting the function merely _exists_ would have missed. A throw
   usually means its native module is not registered in this build. If a later
   check is `false` while this one passes, the primitives disagree with the
   corpus on Hermes; capture the failing case name and stop — do not ship E2EE.

### What this does and does not prove

It **does** prove, on the shipped engine: that the §14.5 source is installed
early enough and returns real bytes; that a full Noise IK handshake reproduces a
published upstream vector at both roles; that a §9.1 record protects to the exact
corpus envelope, round-trips, and rejects a one-byte tamper; that a §7.3
transcript re-encodes to bytes a strict Ed25519 signature still covers; and that
X25519 keygen off the live CSPRNG produces consistent, non-repeating keys.

It does **not** prove:

- **The production binary.** The runner is absent from a release bundle by
  construction — its only reference sits behind `if (__DEV__)`, which Metro folds
  away before it collects dependencies. What a development build shares with
  production is the code that matters: `polyfills.ts` and
  `src/platform/e2eeRuntime.ts` are the same source, and the primitives are the
  same pinned packages.
- **Any live channel.** There is no relay, no node, and no Hub in this procedure;
  it is the primitive and codec layer only.
- **§16.4's device gate.** §16.4 requires the **complete** corpus to pass on
  physical devices on **both** mobile platforms before the native client ships
  E2EE support, and calls it an explicit acceptance gate of the native rollout.
  This runner carries four transcribed families (F15 IK, F6, F4, F13 — the 844 KB
  corpus is not bundled, and `e2eeVectorRunner.test.ts` proves the transcribed
  bytes are still the real fixtures') — no NX pattern, no snow set, no
  F1/F2/F7/F8/F10/F16/F17, no P-256, and no CBOR **decode** or
  re-encode-equality case at all. Green here therefore does not satisfy §16.4.
  What remains: a device harness that can stream or side-load the corpus without
  bundling it, plus those families. **That gate is open and blocks the native
  E2EE rollout** — it is not a documented non-goal.
- **Anything about Android.** Run the same procedure per platform.

§14.5's startup verification is no longer open: `src/platform/e2eeAgreementKey.ts`
runs `assertE2eeRuntimeGlobals` before **every** operation that produces or uses
this device's static X25519 key — creating it, deriving its public half, and
lending the scalar to a handshake — and turns a refusal into
`agreement_key_runtime_unavailable`, with no key created and nothing written.
Gating creation alone would have verified the source on the one launch that mints
the key and on no other, so a runtime that lost its CSPRNG between launches would
have kept issuing §7.4 certificates and discovered the absence mid-handshake.
Destruction is the one ungated path: §6.3's purge must still run on a runtime
E2EE is refused on. The handshake that reaches this custody path — and the screen
state that surfaces the refusal — lands with the mobile E2EE client; until then
no launch calls it.

**§13.1.1's partial-loss surface is closed**, by the second of the two remedies
§13.1.1 offers rather than the first. The §7.4 certificate record no longer lives
in the plain KV: `src/platform/e2eeSecureStore.ts` holds it in the §6.3 namespace
beside the agreement key it names, so iOS iCloud backup and Android Auto Backup
carry neither and an OS migration to a new handset destroys both together. There
is then no "non-secret application state recording a prior E2EE association" to
survive the secure store, and §13.1.1's own rule applies instead — "a conforming
client that keeps none is a fresh install by the rule above". The record is not a
secret and never was; the class governs survival, not confidentiality. An entry an
earlier build left in the plain KV is removed once per process and never read.

One obligation the agreement-key slice created remains open:

- **The screen state for a refused runtime.** `agreement_key_runtime_unavailable`
  and `e2ee_prekey_custody_failed` have no owner-visible surface yet, because no
  launch calls this path.

## Relay E2EE client trust state (§12.1, §12.1.1, §13.1)

`src/platform/e2eeTrustModel.ts` is the §13.1 record model and the §12.1.1
classifier; `src/platform/e2eeTrustStore.ts` is their durable custody. Four
properties are structural rather than documented, because each of them is a
downgrade if it is only documented:

- **`verified` and `unverified` are separate types.** §13.1 states what an
  `unverified` record holds and that it holds "**no** verified fingerprint, **no**
  recorded continuity id, no accepted policy generation, no latch, and no approval
  state". Those fields are absent from the type, so a guard has no field to read
  first-contact display material out of, and the only constructor of a `verified`
  record is `promote`, which takes an owner decision whose minting re-derives the
  §13.4 safety number from **both** identity keys. A capability statement carries
  only the node's key, so "silently promote a self-signed first-contact key" has
  no code path.
- **A store that has not loaded cannot look like unset state.** The classifier
  consumes a four-variant snapshot — `latched`, `pinned-unlatched`, `none`,
  `unobtainable` — that is branded and constructible only from a completed load,
  and `unobtainable` classifies UNEXPECTED. There is no boolean anywhere in the
  classifier. This is §4.4's "MUST NOT treat unobtainable evidence as an unset
  latch or an unset marker", and the case it protects is the first channel after
  every cold start.
- **The §13.2 step 5 marker write is in the same durable write as the promotion.**
  The whole trust document is one secure-store entry, because neither platform
  store has a transaction across entries and §13.1 requires the two to be
  crash-atomic. The write is adopted in memory only after it lands.
- **Reconciliation runs from the classifier's own entry point.** §13.1 requires
  the marker to be reconciled against the pin set "before it evaluates any
  classification on that Hub origin", including for an install whose pins predate
  the marker, so `classify` does it rather than leaving it to a call site.

Hydration slots into the ordered bootstrap in `src/hostedHub/runtime.ts`, before
the call that installs the relay socket factory. Cleanup is registered by hand in
two places, because no generic secret-wipe path exists: the Hub-domain change in
`src/features/settings/SettingsHubRouteScreen.tsx` clears everything recorded
under the origin being left, and `removeSavedEnvironment` in
`src/connection/environmentActions.ts` clears the records for the node the owner
forgot. Both registrations have their own tests, since nothing else would catch
one going missing.

Not in this slice: the §4.4 mode machine that consults the classification, the
§13.2 pairing screen that mints the owner decision, and the §13.1.1 security-UI
surface for a device holding no verified pin on a connected Hub origin.

## Relay E2EE key custody (owner, on a physical device)

`docs/relay-e2ee-protocol.md` §6.3 puts two requirements on the native client that
only a device can confirm. Both are implemented — see `src/platform/e2eeSecureStore.ts`
and `plugins/withAndroidSecureStoreBackupExclusion.cjs` — and neither is proven by
the Node suite.

- **iOS reinstall must destroy the E2EE keychain namespace.** Keychain
  generic-password items survive app deletion for the same bundle id, so the app
  writes a first-run marker into the plain SQLite-backed KV, which does not. Pair
  the device, delete the app, reinstall it, and confirm that re-pairing is
  required — not that the previous install's key is silently reused. The marker
  check runs before any read of the namespace, so nothing of the old material is
  loaded on that launch.
- **Android backup must not carry `shared_prefs/SecureStore.xml`.** These rules are
  the whole of Android's §6.3 compliance: `keychainAccessible` is an iOS-only
  option and the Android native module publishes no constants at all, so the
  store passes only `keychainService` there and there is no accessibility class to
  assert. The generated manifest and rules were verified from a real
  `expo prebuild --platform android` in this repository: `<application>` carries
  `android:fullBackupContent="@xml/ryco_e2ee_backup_rules"` and
  `android:dataExtractionRules="@xml/ryco_e2ee_data_extraction_rules"`, both files
  exclude the SecureStore preferences file from `sharedpref`, and
  `android:allowBackup` stays `true` so the environment registry and hub profile
  keep their backup. **A device check must still confirm the effect**, because a
  build artifact cannot: back the device up, restore onto a second device (and
  run a device-to-device transfer), and confirm the restored app has no E2EE
  agreement key and demands re-pairing while the ordinary saved environments come
  back. The rules exclude both `SecureStore.xml` and `SecureStore`, so this check
  also settles which spelling the backup engine honours.

## Notes / boundaries

- Expo Go is not supported because hosted sessions use Ryco's custom
  hardware-backed device-key module. Use the generated development client.
- Paid/team builds may enable associated domains for native passkey account
  actions. Core Hub sign-in does not depend on that entitlement: it uses
  `ASWebAuthenticationSession` / a Custom Tab, explicit browser consent, and a
  one-time PKCE code returned through the variant's custom scheme.
- Bundle IDs/schemes are Ryco placeholders (`dev.ryco.app*`, `ryco*`); the EAS
  project, Apple Team id, and App Store Connect record are wired in B3.

## Dependency divergences (B2)

- **`@pierre/diffs` is pinned to `1.3.0-beta.5` for mobile only** (deliberate
  divergence). The workspace catalog pins `1.1.20` (shared with `apps/web`); the
  upstream review/diff patch and the review-canvas code the screens copy were
  written against `1.3.0-beta.5`. `apps/mobile/package.json` pins the version
  directly (replacing `catalog:`); `apps/web` stays on the catalog's `1.1.20`
  untouched. This is a version split inside the existing dependency set — no new
  npm packages are added for the MVP screens.
- **`@pierre/diffs>@shikijs/transformers` override was NOT ported.** Upstream
  (pnpm) forces `@pierre/diffs`'s `@shikijs/transformers` to `^4.2.0`. Bun does
  not honor pnpm's `parent>child` scoped-override syntax, and a name-scoped
  override applies by name to _both_ `@pierre/diffs` copies — it would force
  `apps/web`'s `@pierre/diffs@1.1.20` (which declares `@shikijs/transformers:
^3.0.0`) to an out-of-range `4.2.0`, violating the "nothing else touching
  `apps/web`" invariant. `@pierre/diffs@1.3.0-beta.5` declares
  `^3.0.0 || ^4.0.0` and resolves `@shikijs/transformers@3.23.0`; that dependency
  is inert on the mobile code path (the native review canvas is fed the app's own
  `@shikijs/core@4.2.0` tokens, not `@pierre/diffs`'s HTML/transformer render
  path), so leaving it at its declared resolution is the faithful, web-safe
  outcome.
- **`expo-modules-jsi` patch rebased onto `56.0.12`.** Upstream keys the patch at
  `56.0.10` (its exact pnpm pin); B1's lock resolves `56.0.12`. The patch applies
  cleanly against `56.0.12`, so the `patchedDependencies` entry is keyed
  `expo-modules-jsi@56.0.12` (no exact-pin override needed). The patch file keeps
  its upstream `@56.0.10` filename.
