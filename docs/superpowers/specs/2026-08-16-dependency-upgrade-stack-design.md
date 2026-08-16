# Repository Dependency Upgrade Stack

## Goal

Upgrade every currently outdated direct, development, catalog, and internal peer dependency to
the latest stable release while preserving Ryco's behavior across server, web, desktop, shared
runtime, provider, cryptographic, and native-mobile boundaries.

Deliver the work as one ordered stack of eight draft pull requests. Each pull request owns one
cohesive compatibility boundary, includes any required source migration or patch port, and must
pass its proportional validation gate before work proceeds upstack.

## Current State

The working tree already contains the completed security upgrade that will form the bottom layer:

- Electron `40.9.3` to `43.4.0`.
- sharp `0.34.5` to `0.35.3`, providing libvips `8.18.3`.
- Next pinned to `16.3.1` as a transitive override so Geist cannot retain sharp `0.34.5`.
- A regenerated Bun lockfile with no vulnerable sharp/libvips resolution.

That change has passed desktop and server typechecks, 179 desktop tests, sharp avatar-processing
tests, the desktop/server/web bundled build, and the Electron launch smoke test.

## Constraints

- Use Bun `1.3.14`, the version pinned by the repository.
- Regenerate `bun.lock` only through Bun and verify it with `bun install --frozen-lockfile` on every
  layer.
- Target the latest stable package versions available when each layer is implemented.
- Do not silently retain an old version, downgrade a target, or skip a listed package. Resolve
  compatibility in the owning layer or report a concrete upstream blocker.
- Keep `@types/node` on the Node 24 line. Ryco's supported Node runtime and Electron 43 both use
  Node 24; adopting Node 26 types without an intentional runtime migration would create a false
  API surface.
- Keep `packages/contracts` schema-only and preserve all hosted lifecycle, PWA, mobile-runtime,
  provider-runtime, and public-repository boundaries from `AGENTS.md`.
- Preserve user-visible behavior unless an upstream dependency requires a deliberate migration.
  Any such behavior change must be explained and tested in the owning pull request.
- Existing version-bound patches must either be ported to their upgraded package version or
  removed only after confirming the upstream release contains the patched behavior.

## Stack Topology

The stack is rooted at `main` and ordered as follows:

| Position | Branch                               | Responsibility                                                         |
| -------- | ------------------------------------ | ---------------------------------------------------------------------- |
| 1        | `deps/security-runtime-upgrades`     | Electron, sharp/libvips, and transitive sharp removal                  |
| 2        | `deps/tooling-compatible-upgrades`   | Toolchain, compatible library updates, and desktop packaging           |
| 3        | `deps/effect-ecosystem-refresh`      | Effect-adjacent beta packages, compiler integration, and patches       |
| 4        | `deps/provider-sdk-upgrades`         | Claude, Anthropic, Copilot, OpenCode, and external opener SDKs         |
| 5        | `deps/crypto-serialization-upgrades` | Noble cryptography and CBOR majors                                     |
| 6        | `deps/web-library-upgrades`          | Web editor, charting, icons, animation, routing, and diff libraries    |
| 7        | `deps/expo-57-react-native-87`       | Expo SDK 57, React Native 0.87, React, native modules, and peer ranges |
| 8        | `deps/mobile-ecosystem-upgrades`     | Remaining mobile libraries and post-SDK compatibility work             |

Every branch is based on the branch immediately below it. A lower-layer correction is made on its
own branch, followed by `gh stack rebase --upstack`; compatibility fixes are never placed in an
unrelated upper layer.

## Layer 1: Security Runtime Upgrades

This layer contains only the already implemented security work:

- `electron` `40.9.3` to `43.4.0`.
- `sharp` `^0.34.5` to `^0.35.3`.
- `next` transitive override at `16.3.1` to eliminate the optional sharp `0.34.5` copy brought in
  by Geist.
- The generated lockfile changes for Electron, sharp, libvips, and their platform artifacts.

The layer resolves the Electron sandboxed-iframe and `ProtocolResponse.url` session-cache
advisories plus the four inherited libvips vulnerabilities.

## Layer 2: Tooling and Compatible Upgrades

This layer takes the low-risk and toolchain updates that do not require a product migration:

- `oxfmt` `0.62.0` to `0.63.0`.
- `oxlint` `1.77.0` to `1.78.0`.
- `turbo` `2.10.9` to `2.10.10`.
- `vite-plus` and `@voidzero-dev/vite-plus-core` `0.2.8` to `0.2.9`.
- `zustand` `5.0.14` to `5.0.15` across web, mobile, and client runtime.
- `@tanstack/react-router` `1.170.25` to `1.170.29` and
  `@tanstack/router-plugin` `1.168.29` to `1.168.32`.
- `msw` `2.12.11` to `2.15.0`.
- `electron-builder` `26.8.1` to `26.15.3`.

If a nominally compatible update changes generated output or lint/format rules, the mechanical
repository updates belong in this layer.

## Layer 3: Effect Ecosystem Refresh

This layer updates the coupled Effect tooling packages:

- `@effect/atom-react` `4.0.0-beta.106` to `4.0.0-beta.107`.
- `@effect/openapi-generator` `4.0.0-beta.106` to `4.0.0-beta.107`.
- `@effect/tsgo` `0.36.1` to `0.36.5`.

The repository's `effect@4.0.0-beta.106` patch must be checked against the selected dependency
graph. If Effect itself remains on beta.106, the patch stays. If peer requirements require a newer
Effect build, the patch is ported and all catalog entries move together. Compiler diagnostics and
required API migrations are fixed in this layer rather than suppressed.

## Layer 4: Provider SDK Upgrades

This layer updates provider and process-opening dependencies everywhere they are declared:

- `@anthropic-ai/claude-agent-sdk` `0.3.226` to `0.3.233` in server and scripts.
- `@anthropic-ai/sdk` `0.100.1` to `0.117.1` in server and scripts.
- `@github/copilot-sdk` `0.3.0` to `1.0.11`.
- `@opencode-ai/sdk` `1.18.15` to `1.18.18`.
- `open` `10.x` to `11.0.1`.

Driver API migrations remain inside the existing provider architecture. The layer may update
driver adapters, provider registry construction, session lifecycle handling, and tests, but must
not introduce a second orchestration path or duplicate shared provider logic.

## Layer 5: Cryptography and Serialization Upgrades

This layer owns the security-sensitive major upgrades:

- `@noble/ciphers` `1.3.0` to `2.3.0`.
- `@noble/curves` `1.9.7` to `2.3.0`.
- `@noble/hashes` `1.8.0` to `2.3.0`.
- `cborg` `5.1.7` to `6.1.1`.

All call sites are migrated to the new APIs without changing protocol semantics. Existing E2EE,
relay, identity, and deterministic fixture bytes remain compatible unless the repository explicitly
versions a new wire representation. A fixture change requires a demonstrated protocol reason and
must retain backwards-compatibility coverage where persisted or remote data can outlive a process.

## Layer 6: Web Library Upgrades

This layer updates the web-facing packages and aligned pairs:

- `@formkit/auto-animate` `0.9.0` to `0.10.0`.
- `lexical` and `@lexical/react` `0.41.0` to `0.49.0` together.
- `@tanstack/react-pacer` `0.19.4` to `0.23.0`.
- `lucide-react` `0.564.0` to `1.31.0`.
- `recharts` `2.15.4` to `3.10.1`.
- Catalog `@pierre/diffs` `1.1.20` to `1.3.5`.

Editor state, serialized conversation content, routing, statistics charts, source-control diffs,
and icon rendering must retain their existing behavior. Lexical packages move as one atomic unit.

`@legendapp/list` is deferred to the mobile ecosystem layer because its exact version is patched
and shared with the native app; moving it once avoids maintaining two patch transitions.

## Layer 7: Expo 57 and React Native 0.87

This layer is a coordinated SDK migration rather than a set of independent npm bumps. It uses the
Expo SDK 57 compatibility matrix and `expo install` resolution for the following family:

- `expo` `56.0.19` to `57.0.13`.
- `@expo/metro-runtime` to `57.0.10` and `@expo/ui` to `57.0.11`.
- `expo-asset`, `expo-blur`, `expo-build-properties`, `expo-camera`, `expo-clipboard`,
  `expo-constants`, `expo-crypto`, `expo-dev-client`, `expo-file-system`, `expo-font`,
  `expo-glass-effect`, `expo-haptics`, `expo-image`, `expo-image-picker`, `expo-linking`,
  `expo-modules-core`, `expo-network`, `expo-notifications`, `expo-secure-store`,
  `expo-splash-screen`, `expo-sqlite`, `expo-symbols`, `expo-updates`, and `expo-web-browser` to
  their SDK 57-compatible releases.
- `babel-preset-expo` to the SDK 57-compatible `57.0.7` release.
- React and React DOM `19.2.3` to `19.2.8`.
- React Native `0.85.3` to `0.87.0`.
- `@ryco/mobile-device-key` peer `expo-modules-core` to `57.0.11`.
- `@ryco/mobile-markdown-text` peers `expo-asset` to `57.0.11`, `expo-clipboard` to
  `57.0.1`, `expo-haptics` to `57.0.1`, `expo-symbols` to `57.0.2`, React to `19.2.8`, and React
  Native to `0.87.0`.

The following exact-version patches are reviewed and ported here when they are required for the
SDK transition:

- `expo-modules-jsi`.
- `react-native-screens`.
- `react-native-keyboard-controller`.
- `react-native-gesture-handler`.
- `react-native-nitro-modules`.
- `@react-navigation/native-stack`.

Generated `ios` and `android` projects remain untracked. Clean prebuilds validate the app config,
plugins, autolinking, native compilation inputs, and custom modules without committing generated
native trees.

## Layer 8: Mobile Ecosystem Upgrades

On top of the validated SDK 57 baseline, this layer upgrades the remaining mobile ecosystem:

- `@callstack/liquid-glass` `0.7.1` to `0.8.0`.
- `@legendapp/list` `3.3.3` to `3.3.6`.
- Mobile `@pierre/diffs` `1.3.0-beta.5` to `1.3.5`.
- `@react-navigation/elements` `2.9.26` to `2.9.38`.
- `@react-navigation/native` `7.3.4` to `7.3.16`.
- `@react-navigation/native-stack` `7.17.6` to `7.18.8`.
- Shiki packages and `shiki` `4.2.0` to `4.4.3`.
- `diff` `8.0.3` to `9.0.0`.
- `expo-paste-input` `0.1.15` to `0.2.2`.
- `react-native-gesture-handler` `2.31.x` to `3.2.1`.
- `react-native-keyboard-controller` `1.21.13` to `1.22.3`.
- `react-native-nitro-modules` `0.35.9` to `0.36.5`.
- `react-native-passkey` `3.5.0` to `3.6.1`.
- `react-native-reanimated` `4.3.1` to `4.5.3`.
- `react-native-safe-area-context` `5.7.0` to `5.9.0`.
- `react-native-screens` `4.25.2` to `4.27.0`.
- `react-native-svg` `15.15.4` to `15.15.5`.
- `react-native-webview` `13.17.x` to `14.0.1`.
- `react-native-worklets` `0.8.3` to `0.11.4`.
- `@pierre/trees` `1.0.0-beta.4` to `1.0.0-beta.6`.
- Internal `react-native-nitro-markdown` peer range `0.8.1` to `0.10.0`.

The local Nitro Markdown tarball is treated as repository-owned source: its declared/runtime
version and internal module integration must be reconciled with the new peer range rather than
replaced blindly from npm.

All remaining version-bound patches are ported or removed with upstream-equivalence evidence:

- `@legendapp/list`.
- `@pierre/diffs`.
- `@react-native-menu/menu` if its installed version changes transitively.
- Navigation, screens, keyboard, gesture, and Nitro patches not already finalized in layer 7.

## Validation Strategy

Each branch must pass `bun install --frozen-lockfile`, formatting for touched manifests/source,
`git diff --check`, and focused tests for the affected package. Additional gates are:

| Layer            | Required validation                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Security         | Server/desktop typechecks; desktop tests; avatar-store tests; `build:desktop`; Electron smoke       |
| Tooling          | Full format, lint, typecheck, test, and build backstop; desktop build and release smoke             |
| Effect           | Full typecheck and test backstop; builds for contracts, protocol packages, server, web, and desktop |
| Providers        | Server typecheck/build; provider adapter, session, registry, reaper, and process lifecycle tests    |
| Crypto/CBOR      | Shared/client/server tests; E2EE and relay fixture tests; attacker/interoperability suites; builds  |
| Web              | Web typecheck/tests/build; Playwright browser suite; affected consumer tests                        |
| Expo/RN          | Expo Doctor; dev/preview/prod config; mobile tests/typecheck; clean iOS and Android prebuilds       |
| Mobile ecosystem | Mobile tests/typecheck; clean prebuilds; native-module checks; complete repository backstop         |

For high-risk web interaction changes, install the pinned Playwright runtime if necessary and run
the browser suite. For desktop packaging changes, run `build:desktop` and `release:smoke`. Native
prebuild validation must not leave generated directories or unrelated artifacts in the commit.

## Failure Handling

- Fix source incompatibilities and type errors in the same layer as their dependency.
- Port a patch by first determining whether the upstream release already includes it. Do not apply
  obsolete hunks simply to preserve a patch file.
- When a lower-layer fix is discovered from an upper branch, check out the owning branch, commit
  the fix there, and run `gh stack rebase --upstack`.
- If the latest stable release has a genuine upstream blocker, record the failing version, exact
  reproduction, affected platforms, and upstream reference in that PR. Stop that layer rather than
  claiming completion with an unreported old version.
- Do not change authentication, hosted lifecycle ownership, relay readiness, or mobile runtime
  policy merely to accommodate an upgrade.

## Publication Workflow

1. Configure Git rerere and `remote.pushDefault=origin` to keep stack operations non-interactive.
2. Initialize `deps/security-runtime-upgrades` as the bottom branch rooted at `main`.
3. Stage and commit only the files owned by the current layer.
4. Validate the layer locally.
5. Add the next named branch with `gh stack add <branch>` and repeat.
6. Submit the complete stack with `gh stack submit --auto`, creating draft PRs.
7. Give every PR a body that states stack position, parent PR, exact dependency changes, migrations,
   validation evidence, and compatibility considerations.
8. Use `gh stack view --json` to verify branch order, bases, PR URLs, and draft state.
9. Mark a PR ready only after its local gate and GitHub checks pass.

## Completion Criteria

- Eight correctly based draft PRs exist as one GitHub stack.
- Each incremental PR diff contains only its declared dependency group, migrations, patches, and
  validation-supporting changes.
- Every local validation gate passes.
- The top branch passes the full repository backstop plus browser, desktop, release, and native
  validation required by `AGENTS.md`.
- `bun outdated --recursive --force --no-cache` reports no remaining direct, development, catalog,
  or internal peer upgrade candidates except `@types/node` versions beyond the supported Node 24
  runtime.
- GitHub CI passes before the stack is presented as ready for merge.

## Out of Scope

- Migrating Ryco's supported Node runtime from 24 to 26.
- Unrelated feature, UI, architecture, or provider behavior changes.
- Merging the stack. The deliverable is an implemented, validated, reviewable draft stack; merge
  remains a separate user decision.
