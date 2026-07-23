# Mobile B1: scaffold, platform adapters, and direct-node auth

**Goal:** Stand up `apps/mobile` — the Expo/React Native app — copied and stripped from the
upstream MIT scaffold, with every `@ryco/client-runtime` platform adapter and runtime seam
wired, proving a **direct-node bearer pairing → connected → thread-list-loads** loop on the
iOS Simulator against a local node. No MVP screens beyond what the loop needs; those are B2.

**Design spec:** `docs/superpowers/specs/2026-07-23-native-mobile-app-design.md` (workstream
B; §4 platform adapters, §8 auth planes, §"Bundling", §"Publishing and local testing" are
authoritative here).

## Execution rules

- Work only on `feat/mobile-scaffold` in `sak0a/ryco`. New `apps/mobile` package + the
  four copied native modules under `apps/mobile/modules/`.
- **Retain the T3 Tools MIT notice** on every copied file, and copy each module's LICENSE /
  UPSTREAM.md / notices verbatim (spec §"Licensing"). No copied file loses its notice.
- **Strip every T3-proprietary identifier** per the spec §"Strip list" — EAS project/owner/
  slug, bundle IDs and schemes, appleTeamId/ascAppId, the entire Clerk/cloud plane, env
  namespaces, brand assets, the repo-root `scripts/lib/*` imports, and (for B1) all deferred
  features. `rg -i 't3tools|t3code|clerk|pingdotgg|ARK85ZXQ4Z|6787819824|d763fcb8|axiom'`
  over `apps/mobile` must return only intentional, documented residue (if any) by the end.
- **No forked runtime logic** (the "no second implementation" invariant): the app wires
  runtime A's contracts and factories; it does not reimplement auth/transport/state.
- **Bound wrappers** for every injected timer/socket/lifecycle seam; **no import-time side
  effects** in wiring modules; singletons single-homed; the relay socket honors the
  buffer no-retain rule. (These are the concrete lessons from A's slices 3b/4.)
- Pin the **identical** effect version (catalog `4.0.0-beta.59`); the mobile package joins
  the workspace so it resolves the same `@ryco/*` and `effect` instances.
- Toolchain: use the repo's Bun; `apps/mobile` scripts use `vp` (vite-plus test) as upstream
  does. Never `bun test`. Do not upgrade the workspace toolchain.
- No private detail anywhere (public repo); conventional commits; `git diff --check` before
  each commit; stage only named paths.

## Task 1 — Workspace scaffold (copy + strip, no wiring yet)

- Copy `apps/mobile`'s scaffold files from `upstream/main` and rewrite identifiers to Ryco:
  `app.config.ts` (three variants; Ryco slug/bundle/scheme; `runtimeVersion: fingerprint`;
  strip Clerk plugin + cloud extras + widgets/share/quick-actions/camera-showcase; keep
  expo-secure-store/sqlite/font/splash/build-properties/notifications), `eas.json`
  (Ryco channels; strip ascAppId/appleTeamId placeholders to env), `metro.config.js`
  (monorepo watchFolders + shiki `extraNodeModules` + uniwind), `babel.config.js`
  (`unstable_transformImportMeta`), `index.ts`, `global.css` + uniwind config (Ryco tokens),
  `package.json` (Ryco name, joined to the workspace, deps pinned to upstream versions;
  effect via catalog).
- Create Ryco replacements for the repo-root `scripts/lib/{brand-assets,public-config}`
  imports the config expects (a local mobile config/env loader + placeholder brand assets).
- **Acceptance:** `bun install --frozen-lockfile` resolves; `expo config` / prebuild dry-run
  succeeds; the strip grep is clean; typecheck of the (empty-app) package passes.

## Task 2 — Copy the four native modules

- Copy `modules/t3-composer-editor`, `t3-review-diff`, `t3-markdown-text`,
  `t3-native-controls` with their native sources, `expo-module.config.json`, podspecs,
  codegen specs, and JS wrappers; retain each LICENSE/UPSTREAM.md. Rename `T3*` view/module
  names and `@t3tools/*` package names to Ryco identifiers **consistently** across podspecs,
  Kotlin package paths, `expo-module.config.json`, and codegen spec names (this is the
  error-prone part — do it module-by-module and grep-verify each).
- The vendored `react-native-nitro-markdown` tarball + pnpm/bun override that
  `t3-markdown-text` needs (upstream vendors it under `apps/mobile/deps/`).
- **Acceptance:** the modules typecheck and their JS wrappers import cleanly; an EAS
  `--local` prebuild (or `expo prebuild` config check) resolves the modules; the rename grep
  finds no stray `T3`/`@t3tools` identifiers.

## Task 3 — Platform adapters (spec §4)

`apps/mobile/src/platform/*` — one file per contract, each modeled on its `apps/web`
template: `endpoint`, `socket`, `appLifecycle` (AppState + NetInfo, with the aggressive
resume/reconnect drive from the spec's iOS-backgrounding finding), `kv` (expo-sqlite/kv),
`secretKv` (expo-secure-store, key sanitization, `set→boolean`), `httpClient` (RN fetch
resolving relative pathnames against the configured origin), `passkeyCeremony` (stubbed for
B1 — throws "hosted mode not available", real native passkeys land with C), `sessionCredentials`,
`pairingCredentialSource` (deep-link/QR take-once), `attachmentCodec`, `clock`/`frame`,
`observability` (NOOP), `config`. Unit/contract tests per adapter against fakes where the
web templates have them.

**Acceptance:** each adapter `satisfies` its contract type; adapter tests pass;
`typecheck` clean.

## Task 4 — Runtime wiring and React bindings

- `apps/mobile/src/state/*` + `src/connection/*`: register `configureThreadsRuntime`,
  `configureHostedRuntime` (present but hosted-inert for B1), the composer store factory
  (File-free image type + injected MMKV/SQLite storage), `createTerminalStateStore`,
  `createMessageQueueStore`, `createEnvironmentConnectionSupervisor` (with
  `subscribeBrowserResume` bound to AppState), `createSavedEnvironmentCatalog`,
  `createPrimaryAuth`, `createRemoteEnvironmentApi`, `WsTransport`/`createWsRpcClient`,
  `seedWsConnectionOnlineStatus`, and the state-sink adapter — each with its `apps/web` file
  as the template, registered lazily (no import-time side effects).
- React bindings: `useSyncExternalStore` over the zustand stores; `@effect/atom-react`
  `RegistryContext` over `appAtomRegistry` for the atom/keyed-query state; the app root
  provider stack (RegistryContext → SafeArea → Keyboard → navigation), copied from upstream
  and stripped of Clerk/cloud providers.

**Acceptance:** `typecheck` clean; `vp test run` green (the wiring's unit-testable pieces);
a headless bootstrap test that constructs the runtime with fake adapters and asserts the
connection registry initializes without error.

## Task 5 — The direct-node pairing loop (the B1 deliverable)

- A minimal pair-and-connect surface (not the full Connections UI — B2): accept a pairing
  URL / host+code, run `createRemoteEnvironmentApi`'s bearer bootstrap, store the token in
  SecretKV via the catalog, open the ws with the `wsToken`, and show connection status +
  the sidebar thread list from `state/threads`. Enough to prove the runtime loop end-to-end.
- **Acceptance (owner-run, local):** on the iOS Simulator via a dev-client build + Metro,
  pairing to a local node connects, the thread list loads, and reconnect works across an
  AppState background/foreground cycle. A runnable "launch the dev client + connect to a
  local/staging node" checklist ships with B1. (Agents cannot drive the Simulator — this
  acceptance is the owner's; agents gate `typecheck`/`vp test run`/prebuild.)

## Task 6 — Agent gates, evidence, PR (orchestrator)

Agent-runnable gates: `bun install --frozen-lockfile`, `bun typecheck` (mobile package
included), `bun run --cwd apps/mobile test` (`vp test run`), an `expo prebuild`/EAS
`--local` config-and-native-resolution check, and the strip/rename grep sweeps. State
clearly in the report that interactive Simulator QA (Task 5's runtime acceptance) is the
owner's, and provide the checklist. PR against `main`; do **not** fabricate device evidence.
