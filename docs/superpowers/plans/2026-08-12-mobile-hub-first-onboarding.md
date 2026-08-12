# Ryco Mobile Native Identity Blocker Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-12-mobile-hub-first-onboarding-design.md`

**Status:** design approved; ready for staged implementation

**Public working branch:** `codex/mobile-hub-onboarding`

**Hub counterpart:** maintained separately in the Hub repository so private implementation and
operational details never enter this public plan

**Objective:** replace the current first-run sheet/browser handoff with an authoritative full-screen
startup gate and a complete native Hub identity experience, while preserving browser identity v1,
native passkey v1, direct-node authorization, and relay/E2EE boundaries.

## Delivery topology

This is three sequential delivery phases, not one deployable diff:

1. **Public protocol/runtime PR.** Reuse the current public PR branch, remove the obsolete sheet
   implementation, and land additive native identity v2 contracts plus reusable runtime methods.
2. **Private Hub PR.** After the public contract commit is merged and reachable from public `main`,
   update the Hub pin and implement v2 behind a dark capability.
3. **Public mobile PR.** Branch from the merged public protocol revision only after the configured
   Hub can advertise v2; implement and enable the root blocker there.

The mobile gate must not merge before the Hub dependency. The public contract package is canonical;
Hub never copies schemas or fixtures. Public and private commits, reviews, evidence, and PR text stay
separate.

## Cross-cutting rules

- Add a failing focused test before each behavior change and keep every checkpoint runnable.
- Never run `bun test`; use `bun run test` or focused package scripts.
- Use the Bun version pinned by the applicable repository and frozen installs.
- Never commit a real Hub origin, private issue/deployment identifier, email, username tied to a
  real account, password, TOTP/email/recovery code, DPoP proof, token, callback, provider assertion,
  or private qualification evidence.
- Keep `packages/contracts` schema-only and `packages/client-runtime` free of DOM, React Native,
  Expo, and Node dependencies.
- Preserve browser cookie/CSRF and native DPoP transports as disjoint API paths and response types.
- Keep hosted and direct credentials independent. No hosted change touches the direct catalog or
  direct SecretKV keys.
- No software DPoP key fallback, embedded Hub login website, or generalized WebView.
- Before every commit: run focused checks, `git diff --check`, inspect the staged diff, and scan for
  secrets/private identifiers.

## Phase P — public protocol and runtime

### P0 — Remove the superseded sheet implementation

**Revert behavior introduced by these commits, in reverse order, without rewriting branch history:**

- `92733a464` — onboarding form-sheet render fix
- `088a2b53c` — sheet/browser onboarding documentation
- `c0a51a384` — browser recovery-code consent change
- `0b9d78fd6` — Hub-first sheet
- `61004f936` — browser-handoff onboarding phases
- `43d3f97d3` — sheet-driven Hub profile extraction
- `174161fe3` — completion-preference onboarding model

Use a single reviewed revert checkpoint. Retain the approved replacement design and this plan.
After the revert, the branch diff against `origin/main` must contain no `OnboardingRouteScreen`,
`FirstRunOnboardingCoordinator`, onboarding-progress KV, browser recovery-consent, or unrelated
mobile documentation change.

**Tests before/after:** existing mobile onboarding/route tests and the focused hosted native
authorization browser test must return to the `origin/main` baseline.

**Commit:** `revert: remove superseded onboarding sheet`

### P1 — Extend the canonical capability and identity schemas

**Modify:**

- `packages/contracts/src/nativeHandoff.ts`
- `packages/contracts/src/nativeHandoff.test.ts`
- `packages/contracts/src/hostedIdentity.ts`
- `packages/contracts/src/hostedIdentity.test.ts`

**Work:**

1. Extend the existing exact Hub capability document with an additive `nativeIdentity` member:
   version 2, signup state, verified-email policy, primary credentials, login/recovery methods,
   password-factor policy, reset support, and bounded anti-bot presentation.
2. Keep native handoff v1 members unchanged so old clients continue to decode capability documents.
   Update strict schema tests to prove supported additive v2 and reject partial/unknown policy.
3. Add exact v2 native paths and strict request/response schemas for:
   - email-first signup config/start/verify/username claim;
   - signup passkey options/finish and password finish;
   - identifier/email mailbox routing;
   - password login start/finish;
   - recovery-code login;
   - password-reset request/verify/finish; and
   - explicit attempt cancellation where server cleanup is required.
4. Define a native identity/session projection that contains bounded public account/session/space
   data plus one native token and optional recovery codes, and can never contain CSRF material.
5. Preserve all browser v1 schemas and paths byte-for-byte except shared primitive extraction.
6. Reject excess fields, browser/native response mixing, malformed identifiers/timestamps, invalid
   method combinations, overlong provider payloads, and inconsistent account/session/space data.
7. Add obvious canary values only inside negative decoder tests; never stringify a secret-bearing
   schema in diagnostics.

**Focused verification:**

```sh
bun run --cwd packages/contracts test -- src/nativeHandoff.test.ts src/hostedIdentity.test.ts
bun run typecheck --filter=@ryco/contracts
git diff --check
```

**Commit:** `feat(contracts): add native identity protocol v2`

### P2 — Add transport-safe client-runtime methods

**Add:**

- `packages/client-runtime/src/authorization/nativeIdentity.ts`
- `packages/client-runtime/src/authorization/nativeIdentity.test.ts`

**Modify:**

- `packages/client-runtime/src/authorization/api.ts`
- `packages/client-runtime/src/authorization/api.test.ts`
- `packages/client-runtime/src/authorization/index.ts`
- `packages/client-runtime/src/authorization/types.ts` only for public, secret-free state types

**Work:**

1. Add `HostedHubApi` methods for every native v2 leg. Pre-session calls use `dpop: "mint"`, omit
   credentials/cookies/Authorization/CSRF, and adopt no token during intermediate legs.
2. Keep browser v1 methods cookie-only. Calling them in bearer mode still returns
   `browser_only_transport`; native callers use distinct methods and paths.
3. Decode a native completion fully before exposing it. Separate decoding proves a response cannot
   substitute browser identity+CSRF for native token state or vice versa.
4. Add a platform-neutral transaction coordinator for generations, exact origin, attempt expiry,
   cancellation, idempotency keys, passkey ceremony delegation, and bounded secret-free phases.
   It holds transient request secrets only for the duration of one call; mobile durable storage is
   injected later and remains platform-owned.
5. Return completion material to the platform transaction owner instead of writing the bearer token
   directly. Mobile must durably journal recovery codes/token before normal credential adoption.
6. Preserve the current `signIn()` system-browser/native-passkey compatibility behavior until the
   later mobile PR explicitly calls v2. No startup behavior changes in this phase.
7. Test exact DPoP mint mode, missing token/`ath`, request cancellation, stale generations, wrong
   origin/attempt, strict completion decode, idempotent retry, malformed recovery sets, platform
   passkey cancellation, and proof that malformed responses never replace credentials.

**Focused verification:**

```sh
bun run --cwd packages/client-runtime test -- \
  src/authorization/nativeIdentity.test.ts src/authorization/api.test.ts
bun run typecheck --filter=@ryco/client-runtime
git diff --check
```

**Commit:** `feat(client-runtime): add native identity v2 transport`

### P3 — Public protocol documentation and PR gate

**Modify as required:**

- public mobile/auth documentation that currently describes only system-browser handoff
- the approved design status after its written approval
- this plan's checkpoint status

**Work:**

1. Document v2 as additive and disabled until advertised by a compatible Hub.
2. Document cookie/DPoP separation, token adoption boundary, absence of mobile UI change, and future
   mobile/Hub dependency order.
3. Scan the entire PR diff for the old sheet/completion behavior and private deployment leakage.
4. Run the proportional public gate; because this phase touches two shared packages, include their
   complete tests/typechecks plus formatting/linting required by the root guidance.
5. Push the public branch, update the existing draft PR to protocol/runtime scope, and wait for CI
   and review. Do not begin the Hub pin until the resulting immutable commit is on public `main`.

**Verification:**

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
git diff --check
```

**Commit:** `docs: document native identity v2 transport`

## Phase M — mobile root blocker after Hub v2

Create a fresh public branch/worktree from the merged protocol revision. Do not stack mobile UI on
an unmerged Hub pin.

### M0 — Prove dependency and record baseline

- Prove the public v2 commit is reachable from public `main`.
- Prove the Hub v2 commit/pin is merged and its configured test/staging capability can advertise
  native identity v2 while public signup remains operator-controlled.
- Install frozen dependencies and record clean mobile tests/typecheck/Expo config.
- Confirm build configuration injects the official Hub and relying party without printing or
  staging `.env.local`.

### M1 — Implement the authoritative access model

**Add:**

- `apps/mobile/src/features/access/appAccessModel.ts`
- `apps/mobile/src/features/access/appAccessModel.test.ts`
- `apps/mobile/src/features/access/AppAccessGate.tsx`
- focused access-gate integration tests using platform/runtime fakes

**Modify:**

- `apps/mobile/src/App.tsx`
- `apps/mobile/src/Stack.tsx`
- direct catalog hydration/controller seams only as required to expose credential-readable status
- hosted session bootstrap only through existing shared runtime state

**Remove:**

- `apps/mobile/src/features/onboarding/FirstRunOnboardingCoordinator.tsx`
- `apps/mobile/src/features/onboarding/firstRunCoordinatorModel.ts`
- `apps/mobile/src/features/onboarding/onboardingProgress.ts`
- the `Onboarding` workspace route and its sheet presentation

**Work:**

1. Derive `hydrating | locked | unlocked(hosted-session|direct-node|both)` solely from revalidated
   hosted session and saved direct node with readable credential material.
2. Mount either the locked navigator or workspace navigator, never both. Move workspace bootstrap
   effects that could fetch protected data below the unlocked branch.
3. Prove stored token/profile/former completion values cannot unlock, and sign-out/revocation/final
   direct removal returns to locked state when appropriate.
4. Queue at most one bounded workspace deep link while locked. Route auth/reset/direct-pair links
   only into the blocker and resolve the workspace destination after unlock.

**Commit:** `feat(mobile): gate startup on authoritative access`

### M2 — Add secure identity transaction and completion journal

**Add:**

- `apps/mobile/src/features/identity/nativeIdentityTransaction.ts`
- `apps/mobile/src/features/identity/nativeIdentityTransaction.test.ts`
- `apps/mobile/src/features/identity/completionJournal.ts`
- `apps/mobile/src/features/identity/completionJournal.test.ts`

**Modify:**

- `apps/mobile/src/platform/secretKv.ts`
- `apps/mobile/src/platform/sessionCredentials.ts`
- platform deep-link/privacy adapters as required

**Work:**

1. Persist only the approved versioned attempt record in dedicated SecretKV; exclude email,
   password, TOTP/code, provider assertion, passkey payload, and raw mail token.
2. Implement generation/origin/attempt fences and cleanup for completion, cancellation, expiry,
   background privacy, key mismatch, and Hub switch.
3. Implement one-item journal transitions:
   `recovery-pending → credential-committed → normal session token → journal removed`.
4. Make secure persistence failure blocking and retryable. Require normal token read-back before
   hosted unlock. Test a simulated crash/failure at every write/remove boundary.
5. Parse auth/reset link fragments immediately into the transaction owner and scrub navigation
   state; reject bearer query parameters.

**Commit:** `feat(mobile): persist native identity transactions safely`

### M3 — Build the full-screen identity stack

**Add focused pure models and screens under:**

- `apps/mobile/src/features/identity/`

**Expected surfaces:**

- entry (`Email or username`, Continue, passkey, Ryco Hub annotation, custom Hub, direct pair)
- custom Hub validation and confirmation
- mailbox proof/resend
- username claim
- passkey/password credential choice
- password and second factor
- recovery code
- password reset
- recovery-code custody
- bounded loading/offline/error states

**Work:**

1. Use `assets/logo_letter_only.svg` as the real Ryco `R` source.
2. Match the approved sparse full-screen composition; no sheet, grabber, dismiss gesture, workspace
   backdrop, nested card stack, or browser handoff.
3. Show the build-configured origin only as “Ryco Hub.” Keep custom Hub and direct pairing visually
   secondary but reachable and accessible.
4. Route username, email-mailbox proof, identifierless passkey, signup, password/TOTP/email factor,
   reset, and recovery through the new shared runtime methods.
5. Reuse existing strict profile checking/safe replacement and direct-pair controller. A custom Hub
   must advertise compatible v2 policy before native identity forms appear.
6. Keep password/TOTP/email/recovery input in focused component state only and clear it on submit,
   unmount, privacy background, and failure.
7. Require recovery acknowledgement and journal transition before the workspace branch mounts.

**Commit:** `feat(mobile): add full-screen native Hub identity`

### M4 — Mobile tests, documentation, and Simulator QA

1. Run all focused access/identity/profile/direct/session tests, mobile typecheck, Expo development
   config, formatting, linting, and public backstop proportional to the cross-cutting root change.
2. Use Computer Use for fresh-install Simulator QA on compact/current devices: keyboard, focus,
   light/dark, Dynamic Type, VoiceOver labels, reduced motion, offline/retry, custom Hub, direct
   pairing, locked deep links, and termination/resume at every journal step.
3. Capture secret-free compact screenshots proving the full-screen `R` blocker and absence of any
   workspace frame.
4. Perform owner-assisted real-device ceremonies only after the Hub canary gate: hardware DPoP,
   passkey create/login, mailbox code/link, password/TOTP, reset, recovery rotation, background
   privacy, revocation, and direct-plane preservation.
5. Update public mobile/status docs without private origin or Hub operational evidence. Open a
   separate mobile PR and wait for CI/review.

**Verification:**

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run --cwd apps/mobile test
bun run --cwd apps/mobile typecheck
cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config
git diff --check
```

## Completion audit

Before claiming completion, map every numbered required outcome and acceptance criterion in the
design to authoritative evidence: exact source, focused negative test, full gate output, Simulator
screenshot/interaction record, real-device result, Hub capability response, deployment canary, or
PR/CI state. Missing or indirect evidence remains incomplete. GitHub OAuth is documented only as a
future seam and is not counted as delivered.
