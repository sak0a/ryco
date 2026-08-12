# Ryco Mobile Hub-First Onboarding Implementation Plan

**Goal:** Ship the approved first-run Hub selection, honest account-choice handoff, automatic
callback completion, authorized-node summary, and browser recovery-code precedence fix without
changing native handoff v1 or the private Hub.

**Design spec:** `docs/superpowers/specs/2026-08-12-mobile-hub-first-onboarding-design.md`

**Status:** Ready for implementation

**Execution:** Sequential and test-first, with a focused verification and commit boundary after
each behavior slice.

## Execution rules

- Work only in the fresh `codex/mobile-hub-onboarding` worktree and leave unrelated worktrees and
  the private Hub repository untouched.
- Create the required repository-root `.env.local` from the owner-supplied development values,
  verify it is ignored, and never stage or print its contents.
- Never commit a deployment hostname, account detail, credential, callback, recovery code, or
  operational identifier.
- Add or update a failing focused test before each behavior change.
- Keep React Native imports out of node-tested model modules. Manually inspect every changed
  `.tsx` mount/focus effect because the mobile Node runner cannot render React Native.
- Reuse `hostedHubController`, `hubProfile`, `hubCapability`, the direct catalog, the Hub node
  model, and the safe reset plan. Do not create alternate auth, token, relay, or directory state.
- Keep direct saved environments and direct credentials outside every Hub mutation.
- Keep native handoff v1, Hub public pins, PKCE, DPoP, callback validation, and token adoption
  unchanged.
- Never run `bun test`; use package-scoped scripts.
- Before every commit, run `git diff --check`, inspect the full staged diff, and verify that
  `.env.local` and QA secrets are not staged.

## Task 0: Establish the implementation baseline

**Files**

- Create ignored repository-root `.env.local` only; do not stage it

**Work**

- Verify the branch starts from the latest intended `origin/main` plus the approved spec commit.
- Create the development configuration through the existing environment-variable seams and prove
  `git check-ignore` recognizes `.env.local`.
- Install the pinned workspace with `bun install --frozen-lockfile`.
- Record clean baseline results for mobile tests, mobile typecheck, the focused native-authorization
  browser suite, and Expo development config.
- Confirm the installed app/simulator baseline without performing account ceremonies.

**Verification**

```sh
bun install --frozen-lockfile
bun run --cwd apps/mobile test
bun run --cwd apps/mobile typecheck
bun run --cwd apps/web test:browser -- src/components/hostedHub/HostedNativeAuthorizationRoute.browser.tsx
cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config
git diff --check
```

No commit: `.env.local` remains ignored and baseline evidence stays in the task record.

## Task 1: Add durable progress and the pure onboarding model

**Files**

- Add `apps/mobile/src/features/onboarding/onboardingProgress.ts`
- Add `apps/mobile/src/features/onboarding/onboardingProgress.test.ts`
- Add `apps/mobile/src/features/onboarding/onboardingModel.ts`
- Add `apps/mobile/src/features/onboarding/onboardingModel.test.ts`

**Work**

- Implement the strict version-1 `in-progress` / `completed` KV codec, cache/hydration fencing, and
  explicit write helpers. Malformed and unknown versions decode as absent, never completed.
- Define the React-free startup snapshot and migration rule for stored Hub profile, direct saved
  environments, and restored hosted session.
- Model the six rendering-precedence tiers, screen transitions, local-only account intent, fixed
  bounded errors, action labels, accessibility labels, and completion effects.
- Derive the resume screen from authoritative profile/runtime state rather than persisting a wizard
  step.
- Make direct pairing, Inbox, and Nodes the only explicit completion events.
- Exhaustively test fresh install, build-default prefill, existing-user migration, in-progress
  resume, invalid state, account choices, authenticated completion, recovery precedence, directory
  states, accessibility labels, and bounded copy.

**Focused verification**

```sh
bun run --cwd apps/mobile test -- \
  src/features/onboarding/onboardingProgress.test.ts \
  src/features/onboarding/onboardingModel.test.ts
bun run --cwd apps/mobile typecheck
```

**Commit:** `feat(mobile): model first-run Hub onboarding`

## Task 2: Share compatibility checking and safe Hub replacement

**Files**

- Add `apps/mobile/src/hostedHub/hubProfileEditor.ts`
- Add `apps/mobile/src/hostedHub/hubProfileEditor.test.ts`
- Add `apps/mobile/src/hostedHub/hubProfileReplacement.ts`
- Add `apps/mobile/src/hostedHub/hubProfileReplacement.test.ts`
- Update `apps/mobile/src/features/settings/HubDomainEditor.tsx`
- Update `apps/mobile/src/features/settings/SettingsHubRouteScreen.tsx`
- Update `apps/mobile/src/features/settings/SettingsHubRouteScreen.test.tsx`

**Work**

- Extract strict origin-error projection, draft/check state, compatible profile construction, and
  the async generation/origin fence from `HubDomainEditor` into a React-free model/coordinator.
- Abort the previous capability request on every new check or relevant draft change. Accept a result
  only for the current generation and normalized origin.
- Preserve the existing capability client and profile codec as the only compatibility authorities.
- Extract Settings' domain replacement sequence into one injected service over
  `buildHubDomainResetPlan` / `executeHubDomainResetPlan`.
- Keep confirmation in the calling surface, but make sign-out, local Hub cleanup, old-origin trust
  cleanup, profile persistence, runtime invalidation, and re-bootstrap one shared ordered operation.
- Refactor Settings to use both shared units without changing its rendered behavior.
- Prove same-origin replacement, confirmed origin change, failure behavior, stale results, and
  direct catalog/credential non-interaction in tests.

**Focused verification**

```sh
bun run --cwd apps/mobile test -- \
  src/hostedHub/hubProfile.test.ts \
  src/hostedHub/hubCapability.test.ts \
  src/hostedHub/hubProfileEditor.test.ts \
  src/hostedHub/hubProfileReplacement.test.ts \
  src/features/settings/SettingsHubRouteScreen.test.tsx
bun run --cwd apps/mobile typecheck
```

**Commit:** `refactor(mobile): share Hub profile setup`

## Task 3: Model public signup availability and browser handoff phase

**Files**

- Add `apps/mobile/src/features/onboarding/publicSignupCapability.ts`
- Add `apps/mobile/src/features/onboarding/publicSignupCapability.test.ts`
- Add `apps/mobile/src/features/onboarding/nativeAuthorizationState.ts`
- Add `apps/mobile/src/features/onboarding/nativeAuthorizationState.test.ts`
- Update `apps/mobile/src/platform/nativeAuthorization.ts`
- Update `apps/mobile/src/platform/nativeAuthorization.test.ts`

**Work**

- Implement an injected, abortable public signup configuration probe against the shared hosted
  identity path and strict response schema.
- Send a cache-bypassed GET with omitted credentials. Persist no response; project only checking,
  enabled, disabled, or bounded unavailable state.
- Fence results by generation and exact selected origin, including retry and origin-change cases.
- Add a tiny secret-free observable phase store for `idle`, `opening`, `waiting`, and `cancelled`.
- Instrument the existing `openAuthSessionAsync` adapter at lifecycle boundaries while leaving its
  result, callback URI, reusable system-browser session, abort semantics, and runtime ownership
  unchanged.
- Test signup enabled/disabled/malformed/unreachable/stale behavior and browser open/success/
  dismiss/cancel/abort/locked behavior without exposing URLs or callback parameters through state.

**Focused verification**

```sh
bun run --cwd apps/mobile test -- \
  src/features/onboarding/publicSignupCapability.test.ts \
  src/features/onboarding/nativeAuthorizationState.test.ts \
  src/platform/nativeAuthorization.test.ts
bun run --cwd apps/mobile typecheck
```

**Commit:** `feat(mobile): expose onboarding handoff states`

## Task 4: Build the Hub-first sheet and automatic presentation coordinator

**Files**

- Add `apps/mobile/src/features/onboarding/FirstRunOnboardingCoordinator.tsx`
- Add `apps/mobile/src/features/onboarding/firstRunCoordinatorModel.ts`
- Add `apps/mobile/src/features/onboarding/firstRunCoordinatorModel.test.ts`
- Rebuild `apps/mobile/src/features/onboarding/OnboardingRouteScreen.tsx`
- Update `apps/mobile/src/Stack.tsx`
- Update `apps/mobile/src/App.tsx` only if the startup readiness owner must move above navigation
- Reuse components from `apps/mobile/src/features/hostedHub/HostedSurfaceParts.tsx`
- Reuse `apps/mobile/src/features/hostedHub/HostedRecoveryCodes.tsx`
- Reuse the Hub node projection from `apps/mobile/src/features/hostedHub/HubNodeSection.tsx`

**Work**

- Mount one coordinator inside the existing provider/navigation ownership boundary.
- Hydrate onboarding progress, Hub profile, direct catalog, and hosted session concurrently; apply
  migration exactly once and auto-present only when the neutral root route is current.
- Defer to an incoming deep link for that launch and keep `in-progress` for the next neutral launch.
- Guard against duplicate navigation across rerenders, Fast Refresh, and late async completion.
- Build the four internal sheet screens with the approved hierarchy, compact-width scrolling,
  keyboard avoidance, bounded errors, disabled states, and accessibility labels.
- Prefill the build default, check before save, and use the shared replacement service for every
  save/change.
- Probe signup after compatible save. Both account actions set local explanatory intent and call the
  same `hostedHubController.signIn()` transaction.
- Render runtime-owned recovery codes first, then browser phase/errors, then authenticated
  completion and the authorized-node directory summary.
- Make “Go to Inbox”, “View Nodes”, and “Pair a device instead” persist completion before navigating.
  A failed completion write stays on the sheet with retry rather than silently losing first-run
  state.
- Keep the existing `Onboarding` route and `mvpRouteConfig` exact list unchanged.
- Add pure tests for coordinator decisions and model transitions; manually inspect every mount/focus
  effect after the build runs.

**Focused verification**

```sh
bun run --cwd apps/mobile test -- \
  src/features/onboarding \
  src/features/hostedHub/hostedAuthModel.test.ts \
  src/features/hostedHub/HubNodeSection.test.ts \
  src/navigation/mvpRouteConfig.test.ts
bun run --cwd apps/mobile typecheck
git diff --check
```

**Commit:** `feat(mobile): add Hub-first onboarding flow`

## Task 5: Require browser recovery-code acknowledgement before consent

**Files**

- Update `apps/web/src/components/hostedHub/HostedHubRoot.tsx`
- Update `apps/web/src/components/hostedHub/HostedNativeAuthorizationRoute.tsx`
- Update `apps/web/src/components/hostedHub/HostedNativeAuthorizationRoute.browser.tsx`

**Work**

- Export/reuse the existing recovery-code takeover rather than creating a second code display or
  acknowledgement path.
- Read the existing recovery-code lease and store state in the native-authorization route.
- Render recovery codes after authentication but before device consent whenever codes exist and no
  other surface owns the lease.
- Keep codes only in the runtime slot. Do not copy them into route state, logs, URLs, snapshots, or
  callbacks.
- Prove consent and callback navigation cannot run while codes are pending; acknowledgement reveals
  the original consent surface; no-codes and account-switch behavior remain unchanged.

**Focused verification**

```sh
bun run --cwd apps/web test:browser -- \
  src/components/hostedHub/HostedNativeAuthorizationRoute.browser.tsx
bun run --cwd apps/web typecheck
git diff --check
```

**Commit:** `fix(web): show recovery codes before native consent`

## Task 6: Update public documentation and run code gates

**Files**

- Update `apps/mobile/README.md`
- Update `docs/mobile-native-status.md`
- Update the approved spec/plan only for implementation discoveries that do not change the design

**Work**

- Document first-run auto-presentation, migration, build default/custom compatible Hub behavior,
  live signup eligibility, system-browser ownership, direct-pair escape, completion, directory
  refresh, and unchanged security boundaries.
- State Simulator/hardware limitations precisely and avoid claiming ceremonies not performed.
- Run formatting only on touched files if required by repository tooling; do not mechanically
  rewrite unrelated files.
- Run the full required mobile checks and affected web checks. Use command exit codes; never grep
  ANSI-formatted typecheck output as a substitute.
- Search the complete branch diff for forbidden deployment/account material.

**Verification**

```sh
bun run --cwd apps/mobile test
bun run --cwd apps/mobile typecheck
bun run --cwd apps/web test:browser -- src/components/hostedHub/HostedNativeAuthorizationRoute.browser.tsx
bun run --cwd apps/web typecheck
cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config
git diff --check
```

**Commit:** `docs(mobile): document Hub-first onboarding`

## Task 7: Perform Simulator qualification and capture evidence

**Files**

- Save user-facing screenshots and a concise Markdown QA record under the task `outputs/` directory
- Do not commit screenshots containing deployment or account information

**Work**

- Build or start the development client through the repository's documented Expo path.
- Use the designated compact-phone Simulator and the computer-control workflow for visual/keyboard
  QA; use clipboard paste for URLs on non-US host keyboard layouts.
- Exercise fresh install, default prefill, custom compatible/incompatible origins, keyboard/scroll,
  browser open/cancel, callback, successful sign-in, authenticated restart, offline/reconnect,
  domain confirmation, direct-connection preservation, configured appearance, and compact width.
- Start the existing enrolled QA node only if needed, using its existing identity and current LAN
  address. Never delete, move, reset, or recreate its identity.
- Stop for the owner whenever login, passkey, recovery-code, anti-bot, signup-email, or other account
  ceremony is required.
- Redact/avoid account names, node/project/thread details, private origins, callbacks, credentials,
  and recovery codes in evidence.
- Re-run affected gates after every QA-driven change.

**Acceptance evidence**

- A screenshot set showing Hub selection, account choice, browser waiting/cancelled behavior, and a
  secret-free connected state at compact width.
- A QA record mapping every requested row to pass, blocked-owner-ceremony, or not-applicable with
  exact non-sensitive evidence.
- Explicit manual review of every changed `.tsx` mount/focus effect.

No commit unless QA drives a source correction; output artifacts remain outside the repository.

## Task 8: Final branch audit and focused public PR

**Work**

- Rebase/merge only if needed and safe; never discard user work.
- Re-run the required gates on the final commit.
- Inspect `git diff origin/main...HEAD`, commit history, ignored-file status, and sensitive-string
  scans.
- Confirm no unrelated generalized inspector, terminal, VCS, notifications, inbox, or composer work
  entered the branch.
- Push `codex/mobile-hub-onboarding` and open one focused public draft PR targeting `main` with the
  design, implementation, test results, Simulator QA, limitations, and no private evidence.
- Do not create a private Hub PR unless implementation proves the approved browser behavior cannot
  be supported without a protocol/private change; stop for owner direction before expanding scope.

**Final verification**

```sh
bun run --cwd apps/mobile test
bun run --cwd apps/mobile typecheck
bun run --cwd apps/web test:browser -- src/components/hostedHub/HostedNativeAuthorizationRoute.browser.tsx
bun run --cwd apps/web typecheck
cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config
git diff --check
git status --short
```

**PR title:** `feat(mobile): add Hub-first onboarding`
