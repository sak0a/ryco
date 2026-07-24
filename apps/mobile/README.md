# @ryco/mobile

The Ryco iOS-first native app (Expo / React Native), consuming
`@ryco/client-runtime`. B1 ships the scaffold, the platform adapters, the
runtime wiring, and the direct-node bearer pairing loop. MVP screens are B2;
EAS / TestFlight is B3; hosted passkey login arrives with workstream C.

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

Interactive Simulator QA is the owner's — agents cannot drive the Simulator.

1. **Install deps** (repo root): `bun install --frozen-lockfile`.
2. **Prebuild the native iOS project** (first run, or after native-dep/plugin
   changes): `cd apps/mobile && APP_VARIANT=development bun run ios:dev`.
   This runs `expo prebuild --clean --platform ios` and `expo run:ios`, building
   the dev client into the Simulator. (A physical device needs a free Apple
   Personal Team — set `RYCO_IOS_PERSONAL_TEAM=1` and
   `RYCO_IOS_PERSONAL_TEAM_BUNDLE_ID`.)
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

## Notes / boundaries

- Native passkeys and associated-domains (hosted login) are **inert in B1** and
  cannot be validated on the Simulator; validate on a real device once
  workstream C lands. Never fabricate device evidence.
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
  override applies by name to *both* `@pierre/diffs` copies — it would force
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
