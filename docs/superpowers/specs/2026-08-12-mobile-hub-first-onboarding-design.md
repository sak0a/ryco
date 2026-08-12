# Ryco Mobile Hub-First Onboarding Design

- **Status:** Owner-approved, 2026-08-12
- **Scope:** `apps/mobile`, plus the public web native-authorization route in `apps/web`
- **Target:** one focused public pull request against `main`
- **Protocol:** existing native handoff v1, unchanged

## Goal

Make a fresh Ryco mobile install begin with a polished, Hub-first setup instead of exposing
Home's empty state. A first-run user chooses and verifies a Hub, then chooses the honest account
path presented by that Hub, completes authentication in the OS system browser, returns through the
reviewed native callback, and reaches the authenticated mobile experience. Direct-node pairing
remains a deliberate escape route and an independent authorization plane.

The development build receives its default Hub and relying-party values from the repository-root,
uncommitted `.env.local` through the existing `EXPO_PUBLIC_RYCO_HUB_URL` and
`EXPO_PUBLIC_RYCO_RELYING_PARTY` configuration seams. No deployment hostname, identifier, account
detail, credential, or private operational evidence belongs in committed source, comments, tests,
screenshots, or documentation.

## Current state

- `RootStack` starts at `Home`.
- The existing `Onboarding` route is a form sheet whose screen renders only `HostedSignIn`; nothing
  presents it automatically.
- Hub Settings already provides strict origin normalization, capability discovery, bounded public
  profile persistence, and a safe domain-reset plan.
- `hostedHubController.signIn()` already owns the native public-client flow: PKCE, state, native
  callback validation, DPoP, one-time-code redemption, token adoption, session bootstrap, and
  directory refresh.
- The Hub's signed-out browser surface already offers passkey sign-in and conditionally offers public
  account creation, invitation redemption, owner bootstrap, and fallback login methods.
- The native handoff v1 start contract has no account-intent member.
- Public signup can produce one-shot recovery codes. The general Hub root gives those codes
  full-screen precedence, but `HostedNativeAuthorizationRoute` currently advances an authenticated
  signup directly to device consent. That route can therefore skip acknowledgement of newly issued
  recovery codes.

## Product decisions

### Hub-first, not Hub-only

The onboarding sheet is the default first-run experience. It explains that a Hub connects the app
to the nodes authorized for an account, while “Pair a device instead” exits onboarding and opens the
existing direct pairing route. Choosing direct pairing explicitly completes first-run onboarding;
the Hub setup remains available later from Settings.

Hosted and direct credentials remain separate. A Hub change must never delete or rewrite the direct
catalog or its secrets.

### Honest account actions without a protocol change

The native account-choice screen shows two actions:

1. **Create account** — enabled only when a fresh public signup configuration probe returns
   `status: "enabled"`.
2. **Sign in** — available whenever hosted mode can perform the existing reviewed system-browser
   handoff.

Both actions invoke the same `hostedHubController.signIn()` transaction and therefore open the same
Hub-owned native-authorization page. The browser visibly presents the methods the deployment truly
supports. The native choice controls local explanatory copy only; it is not persisted, logged, put
in a URL, or added to the handoff request.

If public signup is disabled, “Create account” stays visible but disabled with an invitation/owner
availability explanation. If the availability probe fails, it stays disabled with bounded retry
copy. “Sign in” remains usable in both cases. This avoids presenting aliases as different remote
operations while keeping the intended path clear.

No public or private protocol change is needed. The native handoff schemas, Hub public pins, callback
shape, PKCE flow, and private Hub implementation remain unchanged.

## User experience

The existing `Onboarding` form sheet contains four internal screens. No new root route is added.

### 1. Choose your Hub

- Ryco identity and a short explanation of the hosted connection model.
- A strict URL field prefilled from the build-configured Hub when present.
- Optional bounded Hub label behavior inherited from the existing profile model.
- Primary action checks the exact origin's mobile capability document.
- Compatible results are summarized before the profile is saved.
- Invalid, incompatible, and unreachable results retain the draft and expose a retry.
- “Pair a device instead” exits to the existing direct flow.

The UI follows the app's current dark, restrained, native-sheet language: one clear heading, one
primary task, rounded controls, no nested card stack, and compact bounded status copy. It supports
keyboard avoidance, scrolling at compact phone widths, Dynamic Type-compatible layout, explicit
accessibility labels, and the configured appearance system.

### 2. Choose an account path

- Shows the saved Hub's bounded public label/origin.
- Shows “Create account” with live enabled, disabled, checking, or retry state.
- Shows “Sign in” as an active action.
- Explains that credentials, passkeys, email, anti-bot checks, and recovery happen in the system
  browser owned by the Hub.
- Allows returning to Hub selection. A different saved origin uses the safe change flow.

If the app terminates after a compatible profile is saved but before authentication completes,
first-run state remains in progress and resumes here.

### 3. Continue in browser

- Presents bounded opening and waiting states from a secret-free native authorization phase model.
- Provides cancellation while the runtime transaction is active.
- Presents bounded cancellation, expiry, supersession, callback rejection, and unreachable errors
  with safe retry.
- Never renders, persists, or logs handoff parameters, browser callbacks, PKCE material, tokens,
  proofs, cookies, challenges, email addresses, or recovery codes.

The actual account and authorization ceremony remains in `openAuthSessionAsync` with a reusable OS
browser session. An embedded WebView is never used.

### 4. Connected

- Shows only bounded account and Hub display metadata already projected by the runtime.
- Refreshes and displays the existing authorized Hub node directory.
- Supports loading, empty, offline, and retry presentation.
- Offers explicit “Go to Inbox” and “View Nodes” exits; either completes onboarding.
- Does not choose a preferred node, cache nodes for offline authority, or claim automatic
  reconnection policy.

The completion marker changes only when the user explicitly finishes to Inbox/Nodes or explicitly
chooses direct pairing. Merely checking or saving a Hub does not complete onboarding.

## First-run persistence and migration

Persist one versioned, non-secret onboarding record in the existing mobile KV store:

```ts
type OnboardingProgress =
  | { readonly version: 1; readonly status: "in-progress" }
  | { readonly version: 1; readonly status: "completed" };
```

Unknown versions and malformed values fail safely to “absent”; they are never interpreted as
completion. The record stores no route, origin, account, node, or authentication material. The
screen is derived from authoritative profile/runtime state, which avoids persisting a stale wizard
step.

On cold start, a single coordinator waits for a coherent snapshot of:

- the onboarding record;
- the stored Hub profile;
- direct saved-environment catalog hydration; and
- hosted session bootstrap/restoration.

Those reads run concurrently and use the existing bounded runtime requests. The coordinator must not
present the fresh-install path until migration inputs are known, preventing a transient first-run
sheet for an existing user.

When no onboarding record exists:

- a stored Hub profile, at least one direct saved environment, or a restored authenticated hosted
  session migrates to `completed`;
- otherwise the coordinator persists `in-progress` and presents onboarding automatically.

Auto-presentation occurs only after navigation is ready and only on a neutral root launch. An
incoming deep link takes precedence for that launch; onboarding remains `in-progress` and appears on
the next neutral launch. The coordinator never replaces a valid deep-linked route.

Existing `completed` users are never auto-presented. Existing `in-progress` users resume from the
screen derived from current authoritative state.

## State model

`onboardingModel.ts` is a React- and React-Native-free pure projection/reducer. It receives bounded
snapshots and events and returns the screen, copy keys, action availability, accessibility labels,
and effects for the controller to execute.

Important states are:

- startup: `hydrating`, `migration-required`, `ready`;
- profile: `editing`, `checking`, `compatible`, `invalid`, `incompatible`, `unreachable`, `saving`;
- signup availability: `idle`, `checking`, `enabled`, `disabled`, `unreachable`;
- account intent: `create-account`, `sign-in`, or `null`, in memory only;
- native authorization phase: `idle`, `opening`, `waiting`, `cancelled`;
- session: the existing hosted runtime account/session/directory states;
- completion: `ready`, `finishing`, `completed`.

Rendering precedence is strict:

1. one-shot recovery codes already held by the native hosted runtime;
2. active browser handoff;
3. Hub validation/save or hosted-mode failure;
4. authenticated completion;
5. account choice;
6. Hub selection.

The model never re-derives authentication, relay, mutation readiness, or node authority owned by
`@ryco/client-runtime`.

## Hub profile editing and replacement

The onboarding flow and Settings must share one implementation of profile checking and replacement.
The current behavior in `HubDomainEditor` and `SettingsHubRouteScreen` is refactored into reusable,
injected, pure/testable units rather than copied.

### Compatibility checking

Each check receives an incrementing generation plus the normalized draft origin. Starting a new
check aborts the previous request. A result can update the model only when its generation and origin
still match the current draft. Editing either field invalidates the checked profile. This fences a
late compatible response from enabling save for a newer URL.

The existing strict origin rules and `createHubCapabilityClient` remain authoritative. Only an exact
compatible result can construct a compatible `HubProfile`.

### Saving and safe switching

A new profile is persisted only after compatibility succeeds. Profile replacement uses one shared
service called by both onboarding and Settings:

1. build the existing domain reset plan;
2. obtain the existing destructive confirmation when the origin changes;
3. attempt remote Hub sign-out when applicable;
4. expire local hosted state;
5. clear only the old Hub's native session token and E2EE trust records;
6. persist the replacement profile;
7. invalidate and re-bootstrap the hosted runtime.

The existing `executeHubDomainResetPlan` ordering remains the contract. Direct environments and
direct credentials are outside every step. A failed change reports bounded copy and keeps the
current profile active.

After a successful save, signup availability is fetched from the selected origin's public,
cache-bypassed configuration endpoint through an injected mobile HTTP client and decoded with the
shared hosted-identity contract. The request uses `credentials: "omit"`, persists nothing, and is
generation-fenced like capability discovery. It does not create a second authentication API.

## Browser recovery-code precedence

`HostedNativeAuthorizationRoute` must use the existing one-shot browser recovery-code takeover when
all of these are true:

- the browser account is authenticated;
- the hosted store contains recovery codes; and
- no existing surface holds the recovery-code display lease.

That check occurs before device consent is rendered. The existing “I saved the codes” action clears
the codes through `hostedHubController.dismissRecoveryCodes()`. Only then may the route show the
requesting device, signed-in account, and Continue/Use another account/Cancel consent actions.

Unacknowledged codes survive unmount/remount in the existing runtime slot. The route must not copy
them into component state, navigation state, URLs, logs, or test snapshots. Browser tests use obvious
canary values and assert only controlled DOM presence/absence.

This is a public web presentation correction, not a handoff contract or private deployment change.

## Component and module ownership

### New focused mobile units

- `features/onboarding/FirstRunOnboardingCoordinator.tsx` — startup snapshot, migration, and guarded
  automatic presentation of the existing route.
- `features/onboarding/OnboardingRouteScreen.tsx` — one form-sheet controller/presentation for the
  four internal screens.
- `features/onboarding/onboardingModel.ts` — pure state/event projection and bounded copy.
- `features/onboarding/onboardingProgress.ts` — versioned KV codec and persistence.
- `features/onboarding/nativeAuthorizationState.ts` — secret-free observable phase only.
- `features/onboarding/publicSignupCapability.ts` — injected, abortable, strictly decoded public
  availability probe.

### Refactored shared units

- Extract the pure Hub editor/check model used by both onboarding and `HubDomainEditor`.
- Extract the safe Hub-profile replacement service currently embedded in
  `SettingsHubRouteScreen`; both surfaces call that service.
- Keep `hubProfile.ts`, `hubCapability.ts`, `hostedHubController`, `HostedRecoveryCodes`, the hosted
  store, and the node directory model authoritative for their existing domains.
- Instrument the existing native authorization adapter with phase notifications; do not move PKCE,
  state, callback validation, redemption, or token adoption out of the runtime.

### Public web unit

- `HostedNativeAuthorizationRoute.tsx` reuses/exports the existing recovery-code takeover before
  consent.
- `HostedNativeAuthorizationRoute.browser.tsx` adds the precedence and acknowledgement cases.
- `HostedAuthenticationSurface` otherwise remains unchanged.

`mvpRouteConfig.ts` remains unchanged because the work adds no route. Its exact-list test remains a
guard against accidental route churn.

## Data ownership and security boundaries

Mobile KV may hold only:

- the versioned onboarding completion status;
- the existing bounded public Hub profile; and
- existing non-secret display preferences.

In-memory onboarding state may hold only drafts, generations, local intent, public signup status,
secret-free browser phase, and bounded display metadata.

`@ryco/client-runtime` continues to own PKCE, state, DPoP, callback validation, one-time-code
redemption, bearer-token adoption, session state, relay lifecycle, and directory authority. Secret
storage remains behind the injected secure credential seams. The OS browser owns cookies,
credentials, email/password/passkey and anti-bot ceremonies, invitation/bootstrap credentials, and
browser-issued recovery-code display.

The mobile app must not:

- use an embedded WebView;
- construct direct node HTTP URLs from Hub data;
- persist or log auth/browser secrets or callback parameters;
- add React, React Native, DOM, or Node dependencies to `packages/client-runtime`;
- import React Native into node-tested view models;
- weaken the hardware-backed-key fail-closed rule, relay E2EE, or physical-device release gates;
- treat a legacy relay channel as verified E2EE; or
- change Hub public pins or native handoff contracts.

If a hardware-backed key cannot be created, hosted authentication remains unavailable with bounded
explanation and the direct-pair escape. There is no software-key fallback.

## Failure behavior

| Failure | User-visible result | State/data rule |
| --- | --- | --- |
| Invalid Hub URL | Inline bounded validation message | Draft retained; no request |
| Incompatible capability | Specific bounded incompatibility message | Draft retained; profile not saved |
| Hub offline/unreachable | Retryable reachability message | Draft/current profile retained |
| Stale capability/signup result | No visible state change | Result discarded by generation/origin fence |
| Signup disabled | Create visible and disabled with explanation | Sign in remains active |
| Signup probe unavailable | Create visible and disabled with Retry | Nothing persisted |
| Profile switch fails | Current Hub remains active | Direct plane unchanged |
| Hardware key unavailable | Hosted path unavailable; pair-device escape | Fail closed |
| Browser dismissed/cancelled | Bounded cancelled state and Retry | Runtime transaction aborted |
| Handoff expired/superseded/rejected | Runtime's bounded error and Retry | No manual replay or token write |
| Callback validation fails | Bounded failure and Retry | Runtime rejects before redemption/adoption |
| Directory refresh fails | Authenticated offline/retry presentation | No invented node authority |

All model-owned errors have fixed bounded vocabulary. Arbitrary response bodies, origins beyond the
already selected public profile, account identifiers, and callback data are never interpolated into
error copy.

## Test strategy

### Pure and integration tests

Add React-Native-free tests for:

- fresh first-run Hub selection and versioned progress persistence;
- build-default prefill without a committed deployment hostname;
- migration for an existing Hub profile, direct environment, or restored hosted session;
- invalid, incompatible, offline, and unreachable Hub states;
- compatibility checking, compatible profile construction, and save;
- cancellation and retry;
- signed-out, create-account, and sign-in presentation;
- enabled, disabled, failed, stale, and retried signup-availability probes;
- authenticated completion and explicit completion-marker writes;
- native recovery-code precedence;
- existing-profile resume behavior;
- safe Hub switching and preservation of direct credentials;
- stale async capability and signup responses;
- browser opening, waiting, cancellation, expiry, supersession, and retry projection;
- directory loading, empty, offline, and retry presentation;
- accessibility labels and bounded model-owned error copy.

Retain and extend the existing Hub profile/capability, native authorization, hosted auth, and Settings
tests rather than duplicating their assertions.

### Browser test

Extend `HostedNativeAuthorizationRoute.browser.tsx` to prove:

1. a newly authenticated account with recovery codes sees “Save your recovery codes” rather than
   device consent;
2. approve/cancel APIs and callback navigation are not called while codes are pending;
3. acknowledgement clears the codes and reveals the original explicit consent surface; and
4. the existing no-codes sign-in and account-switching cases remain unchanged.

### Static validation

Run the repository-required install and focused validation:

```text
bun install --frozen-lockfile
bun run --cwd apps/mobile test
bun run --cwd apps/mobile typecheck
cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config
git diff --check
```

Run the focused web browser test and any affected package checks discovered during implementation.
Never run the repository-wide `bun test` command.

### Simulator QA

Manually exercise:

- fresh install/no saved Hub profile;
- build-default prefill;
- custom compatible and incompatible URLs;
- keyboard and scrolling behavior;
- system-browser opening and cancellation;
- callback return and successful sign-in;
- authenticated restart;
- offline and reconnect behavior;
- Hub domain-change confirmation;
- preservation of direct saved connections;
- supported configured appearance; and
- compact-phone-width screenshots.

Because Node tests do not provide real React Native renderer coverage for `.tsx` files, manually
inspect mount/focus effects and actual Simulator layout. If login, passkey, recovery-code, anti-bot,
or email interaction is required, stop for the owner to perform it. Public signup is not enabled or
destructively tested as part of routine QA.

## Documentation and evidence

Update the mobile README and native-status documentation to describe:

- first-run auto-presentation and migration behavior;
- the build-configured default and custom compatible Hub path;
- system-browser ownership of account ceremonies;
- disabled/unavailable signup behavior;
- the direct-pair escape;
- completion and authorized-node refresh; and
- the unchanged security/protocol boundaries.

Save compact-width onboarding screenshots and a concise, secret-free QA record as deliverable
artifacts. Screenshots must exclude owner account details, recovery codes, credentials, private
operational data, and callback parameters.

## Non-goals

- A new native handoff intent or protocol version.
- A private Hub change or PR.
- Native credential, email, password, passkey, invitation, owner-bootstrap, anti-bot, or recovery
  forms.
- Automatic preferred-node selection, reconnect preference, or offline node authority.
- Generalized inspector, terminal, VCS, notifications, inbox redesign, or unrelated composer work.
- Changes to direct-node authorization semantics, relay E2EE, or release qualification.

## Acceptance criteria

The design is complete when a clean install automatically shows the Hub-first sheet, the configured
default and custom compatible Hub paths behave as specified, account choices are honest about live
signup availability, all authentication remains in the reviewed OS-browser handoff, browser signup
cannot bypass recovery-code acknowledgement, completion reaches the existing authenticated mobile
experience, existing users migrate without interruption, direct connections survive every Hub
operation, required tests and Simulator QA pass, documentation/evidence are present, and the focused
public PR contains no private deployment or account information.
