# Ryco Mobile Hub-First Native Identity Blocker Design

- **Visual design status:** owner-approved, 2026-08-12
- **Written specification status:** owner-approved, 2026-08-12
- **Public scope:** `apps/mobile`, `packages/contracts`, and `packages/client-runtime`
- **Hub scope:** the canonical Hub identity contracts, persistence, HTTP routes, security controls,
  and operator documentation
- **Delivery:** staged public protocol/runtime, Hub, and public mobile changes, kept in separate
  commits and pull requests
- **Protocol:** additive native identity protocol v2; browser identity v1 remains compatible

## Goal

Make Ryco mobile start behind a complete, full-screen access blocker whenever the device has neither
an authoritative native Hub session nor a saved direct-node connection. The blocker takes its visual
direction from a restrained Patreon-style login screen: Ryco's letter-only `R` mark, one centered
identity task, strong typography, and no visible workspace, sheet, grabber, or dismiss gesture.

The default path is the build-configured official **Ryco Hub**. The initial screen does not ask a new
user to understand Hub infrastructure or expose the configured deployment origin. A small “Use a
custom Hub” action opens the explicit origin editor. Direct device pairing remains available as a
separate authorization plane and unlocks the app only after a node is actually saved.

The official public Hub requires a verified email address for every new account. Signup, mailbox
verification, username selection, passkey or password creation, password login, second-factor
entry, password reset, recovery-code login, and recovery-code acknowledgement all run in the native
mobile flow. The OS passkey sheet and an anti-bot provider challenge are the only external system or
provider-owned surfaces. A Hub website is not part of normal mobile authentication.

The build pipeline continues to inject the official origin through the existing public configuration
seam. No deployment hostname, private repository reference, account detail, credential, or
qualification evidence is committed to the public repository.

## Required outcomes

1. A locked launch mounts only the blocker, never the Inbox, Home, workspace navigator, or a sheet
   over those surfaces.
2. A restored and revalidated native Hub session bypasses the blocker.
3. At least one successfully saved direct connection with readable credential material bypasses the
   blocker independently of Hub state.
4. A Hub profile, a preference, a dismissed screen, or a partially completed ceremony can never
   unlock the app.
5. The official Hub is selected from build configuration and is presented to the user only as
   “Ryco Hub.”
6. A small custom-Hub action permits a strict, explicit origin check without making infrastructure
   selection the primary task.
7. Public-Hub signup verifies the mailbox before username and credential creation.
8. A new account creates one primary credential: passkey is recommended; password is available.
9. Existing accounts can sign in with an identifier and password, identifierless passkey, or a
   recovery code. Password sign-in uses TOTP when enrolled and verified-email proof otherwise.
10. Password reset and email-link/code handling stay inside the blocker and do not mint a session
    implicitly.
11. Native identity completions mint hardware-DPoP-bound native sessions, never browser cookies.
12. One-shot recovery codes survive a crash until acknowledged, then are erased before workspace
    access.
13. Custom Hubs use the same native flow only when they advertise a compatible native identity
    capability and their own policy.
14. GitHub login remains a future extension point, not part of this release.

## Current state and why it must be replaced

- `RootStack` exposes Home before authentication.
- `Onboarding` is configured as an iOS `formSheet` and can be dismissed independently of
  authorization state.
- `FirstRunOnboardingCoordinator` and `onboardingProgress.ts` use a persisted completion concept.
  That concept cannot prove access and is therefore not an acceptable root gate.
- `OnboardingRouteScreen` is a multi-step sheet built around Hub selection and an OS-browser
  handoff. It is not the approved full-screen identity surface.
- `HostedHubApi` already supports native DPoP session transport and native passkey login, but public
  signup, password login, password reset, and recovery methods deliberately reject bearer mode with
  `browser_only_transport`.
- `packages/contracts/src/hostedIdentity.ts` already defines strict browser public-signup,
  password-login, and reset contracts. Public signup v1 claims the username before mailbox proof and
  returns a browser session with CSRF material.
- The Hub already owns verified email, password, TOTP, recovery, abuse controls, durable email
  delivery, and native DPoP primitives. Extending those ceremonies to native mint transport is a
  security-sensitive protocol change, not a presentation-only mobile edit.

The existing sheet implementation and its completion record are removed or replaced. Reusing its
Hub-profile checking and direct-pairing controllers is appropriate; preserving its authorization
semantics is not.

## Root access gate

### Authoritative predicate

The application derives one access predicate:

```ts
type AppAccess =
  | { readonly status: "hydrating" }
  | { readonly status: "locked" }
  | { readonly status: "unlocked"; readonly via: "hosted-session" | "direct-node" | "both" };
```

`unlocked` is true only when at least one of these facts is authoritative:

- hosted session hydration completed and `restoreSession()` revalidated the native session against
  the selected Hub; or
- direct catalog hydration completed and contains at least one saved direct node whose required
  credential material is present and readable.

A bearer token merely existing in secure storage does not unlock the app. A Hub profile does not
unlock the app. No `completed`, `skipped`, `dismissed`, or equivalent preference exists.

While access is `hydrating`, Ryco shows a neutral full-screen launch surface with the `R` mark. While
it is `locked`, only the blocker navigator mounts. The workspace navigator and its data effects do
not mount behind, underneath, or before the blocker. This prevents visual flashes, background
workspace traffic, and deep-link bypasses.

### Transitions

- A native Hub session unlocks only after its token is durably committed and the returned identity
  is strictly decoded.
- Direct pairing unlocks only after the direct catalog confirms the new environment and its secret
  have been saved and can be read back.
- Signing out returns to the blocker when no direct node remains.
- Removing the final direct node returns to the blocker when no valid Hub session remains.
- Session restoration failure, revocation, expiry, or account disablement disconnects the hosted
  plane and returns a hosted-only device to the blocker.
- Hosted and direct credentials remain separate. Hub switching and hosted sign-out never delete or
  rewrite direct nodes or secrets.

### Navigation and deep links

The locked navigator contains only native identity screens and a reusable direct-pair flow. It is
not a modal route in the workspace stack and has no dismiss action.

Workspace deep links are validated and held as one bounded pending destination while locked. They
cannot mount or navigate the workspace. After an authoritative unlock, the destination is resolved
against the now-authorized environment set and opened only if still valid.

Mailbox verification, password-reset, and direct-pair links are handled inside the locked
navigator. Raw bearer values are parsed out of the incoming link immediately, removed from route
state/history, and transferred to the secure auth transaction owner. Query-string delivery is
rejected; a six-digit manual-code path always remains available.

## Full-screen user experience

### Visual language

The entry screen is deliberately sparse:

- white or appearance-appropriate flat background;
- centered Ryco letter-only `R` logo, never a Patreon mark or generic avatar;
- “Log in or sign up” heading;
- one “Email or username” field;
- full-width primary “Continue” action;
- divider and “Continue with a passkey” action;
- compact “Using Ryco Hub · Use a custom Hub” annotation;
- low-emphasis “Pair a device directly” action.

There is no sheet radius, grabber, translucent workspace, carousel, marketing page, or nested card
stack. Each subsequent step keeps the same frame and changes only the focused form. Back is
available where it can safely cancel or rewind a transaction; closing the blocker is not.

The keyboard must leave the active field and primary action visible on a compact phone. Layout,
focus order, validation announcements, reduced motion, Dynamic Type, dark mode, and minimum touch
targets are verified in Simulator. Sensitive values are excluded from screenshots and accessibility
diagnostics.

### Official Hub and custom Hub

The official origin comes from `EXPO_PUBLIC_RYCO_HUB_URL` and its existing relying-party
configuration. Public source and tests use injected fake origins; they do not hardcode a real
deployment. The entry screen renders the bounded label “Ryco Hub,” not the raw origin.

“Use a custom Hub” opens a dedicated full-screen editor. It:

1. normalizes the candidate with the existing strict Hub-origin rules;
2. checks the exact origin's mobile capability with credentials omitted and caching disabled;
3. requires a compatible native identity protocol when hosted identity is requested;
4. displays the Hub's bounded public label and relevant advertised policy;
5. persists the replacement only after explicit confirmation; and
6. preserves the current Hub, session, and every direct node when checking or saving fails.

Changing an active Hub uses the existing safe profile-replacement ordering: remote sign-out where
possible, local hosted-state expiry, removal of only the old origin's hosted token and trust state,
profile persistence, then runtime bootstrap. Direct state is outside that transaction.

If the build has no valid official configuration, the Ryco Hub action reports a bounded
configuration failure and offers Retry, custom Hub, and direct pairing. It never guesses or embeds a
fallback hostname.

### Account flow routing

The initial field accepts a canonical username or normalized email:

- **Username:** usernames are public identifiers, so the Hub may proceed to the existing-account
  credential flow while still performing equivalent password work for unknown input.
- **Email:** the Hub returns the same mailbox-challenge presentation for eligible, existing,
  suppressed, unavailable, and unknown addresses. Only successful mailbox proof permits an
  existence-sensitive branch to existing-account login or new-account signup.
- **Passkey button:** invokes identifierless native passkey authentication for the selected Hub and
  does not require email or username entry.

When an email proof is already bound to the same native login attempt and the account's required
password second factor is `email_code`, that proof may satisfy the email factor after the password
is accepted. It cannot satisfy TOTP, cross origins, cross devices, expired attempts, or a different
purpose. This prevents a duplicate email-code prompt without weakening the required two factors.

### New account

The official Hub flow is:

1. submit normalized email and the Hub-required anti-bot assertion;
2. enter the six-digit mailbox code or follow the app link;
3. after successful proof, claim a unique canonical lowercase username;
4. choose one primary credential:
   - create a passkey through the native OS sheet (recommended); or
   - create a password that meets the shared bounded password contract;
5. atomically activate the account, personal space, verified address, credential, recovery set,
   and DPoP-bound native session;
6. show the one-shot recovery codes until the user acknowledges custody; and
7. erase the local recovery-code copy before unlocking the workspace.

Email is mandatory and verified on the official public Hub. A custom Hub can advertise a different
signup or verification policy; the native UI follows only a recognized compatible policy and never
pretends unsupported methods exist.

TOTP is offered after entry as an account-security action and remains optional. It is not required
to clear the startup blocker. GitHub OAuth is not shown.

### Existing account

- Identifierless passkey uses the current native passkey ceremony and mints a native session.
- Username/password performs password verification and then confirmed TOTP when enrolled, otherwise
  a verified-email code.
- Email/password first proves mailbox ownership before the existence-sensitive branch; password and
  any required TOTP then complete the bound attempt.
- Successful completion returns a native bearer token bound to the device's hardware DPoP key,
  strictly decoded public identity, active-space state, and no CSRF value.
- Cancellation or passkey unavailability returns to credential choice without destroying unrelated
  Hub or direct state.

### Recovery and password reset

- “Use a recovery code” accepts one existing one-time recovery code through a DPoP-mint request.
  Success rotates the recovery set, creates a native session, and reuses the same mandatory
  recovery-code acknowledgement boundary as signup.
- “Forgot password” always returns a generic accepted result, sends a single-use mail code/link when
  allowed, requires fresh TOTP when enrolled, replaces the password, and revokes existing browser
  and native sessions after commit.
- Password-reset completion does **not** create or adopt a session. It returns to native login with a
  bounded success message.
- Disabled accounts, invalid/used/expired codes, and concurrent losers return the same stable
  authentication failure family.

## Native identity protocol v2

### Compatibility advertisement

The Hub's existing public mobile capability gains an additive `nativeIdentity` member. Its shared
strict schema advertises:

- protocol version `2`;
- public-signup availability;
- verified-email policy;
- supported primary credentials (`passkey`, `password`);
- supported login and recovery methods;
- password second-factor policy (`totp` with verified-email fallback);
- password-reset support;
- anti-bot provider requirements and public site key where applicable; and
- bounded attempt and resend timing needed for native presentation.

Absence or an unsupported version means native identity is incompatible. Existing capability
members, browser identity protocol v1, and native handoff v1 remain unchanged for old clients.
Clients must not infer support from individual endpoint responses.

### Contract ownership

`packages/contracts/src/hostedIdentity.ts` remains the canonical public home for strict request and
response schemas. Native v2 adds distinct paths and types instead of changing browser v1 bodies in
place. The semantic groups are:

- native public-signup config/start/verify/username-claim;
- native signup passkey options/finish and password finish;
- native identifier/mailbox routing;
- native password login start/finish;
- native recovery-code login;
- native password-reset request/verify/finish; and
- native auth-attempt cancellation where server state needs explicit cleanup.

Public signup v2 starts with email, not username. Username claim occurs only after mailbox proof and
before credential completion. Existing browser signup can continue using v1 until it is separately
migrated.

Every schema is exact and bounded. Unknown members, malformed timestamps, invalid identifiers,
unbounded provider payloads, mixed browser/native response fields, and inconsistent session/account
relationships fail closed before state adoption.

### Native session response

Native completion returns a transport-specific response containing:

- the existing bounded public account, session, active-space, and spaces projection;
- one opaque native session token; and
- recovery codes only on operations that create or rotate them.

It never contains a browser CSRF token or cookie instruction. Browser responses continue to return
browser session/CSRF state and never return a native bearer token. The runtime has separate strict
decoders so a server cannot cause cookie/DPoP credential confusion through a union-shaped response.

### DPoP mint rules

Every unauthenticated native identity transaction begins with a mint-time DPoP proof:

- no `Authorization` header;
- no `Cookie` header;
- no `ath` claim;
- exact public origin, HTTP method, and route in `htu`/`htm`;
- approved algorithm and public JWK;
- bounded `iat`; and
- a single-use `jti`.

The Hub calculates the JWK thumbprint and binds the attempt to that `dpop_jkt`, purpose, and public
origin. Every later leg must use the same hardware-backed key and attempt secret. Completion creates
a native session with the same thumbprint. Authenticated requests then require both
`Authorization: DPoP <token>` and a request proof whose `ath` matches the token.

Browser-only routes reject DPoP/Authorization. Native-only routes reject cookies, CSRF transport,
and mixed credential inputs. The HTTP gate establishes credential-kind precedence before a route
handler sees request data.

### Idempotency and dropped responses

Credential and recovery completions require a caller-generated bounded idempotency key. A committed
retry returns the same still-live native session/recovery result through the existing encrypted
retry-envelope pattern; it never creates a second account, space, credential, recovery set, or
session. Attempt secrets and raw completion material are stored only as hashes or server-encrypted
envelopes with bounded retention.

## Mobile state and secret ownership

### Pure coordinator

A React- and React-Native-free access/identity model projects authoritative runtime snapshots into
screens, bounded copy, action availability, focus targets, and effects. It does not perform network
or secret storage itself. One controller serializes effects and fences every result by transaction
generation, selected origin, attempt identifier, and component lifetime.

Starting a new attempt, editing the origin, signing out, or switching Hub aborts the previous
request. A late response can update state only when all fences still match.

### Secure transaction record

Short-lived resumable state lives in a dedicated SecretKV record, not general KV, React state,
navigation params, analytics, or logs. It may contain only the versioned ceremony kind and step,
selected origin, opaque attempt identifiers/secrets, idempotency key, expiry, safe masked
presentation, and hardware-key reference/thumbprint. It does not persist passwords, TOTP values,
email codes, anti-bot assertions, raw mail tokens, raw email addresses, or passkey payloads.

The record is removed on completion, explicit cancellation, expiry, incompatible Hub response,
origin change, or failed key binding. Expired records restart at the nearest safe public step.

Password, TOTP, recovery-code input, and manual email-code input live only in the focused native
field and request body. They are cleared after submit, unmount, background privacy transition, or
error handling. Errors never interpolate them.

### Crash-safe completion journal

SecureStore exposes atomic replacement of one item but not a multi-key transaction. The mobile auth
transaction service therefore uses one versioned completion-journal item:

1. after strict response decoding, write
   `recovery-pending { origin, token, identity, recoveryCodes }` in one secret item;
2. while that phase exists, always render recovery-code acknowledgement and never mount workspace;
3. on acknowledgement, atomically overwrite the same item with
   `credential-committed { origin, token, identity }`, thereby deleting the codes first;
4. durably adopt the token into the normal hosted-session credential key and verify persistence;
5. remove the journal; and
6. unlock only after step 4 succeeds.

A crash at any boundary deterministically resumes the phase encoded by the one item. A
`credential-committed` journal can safely retry normal token adoption without displaying deleted
codes. Login completions that have no recovery codes begin at `credential-committed`.

Failure to persist either the journal or final session token is a blocking, retryable error. The app
does not claim success with an in-memory-only credential.

### Non-secret persistence

General mobile KV may contain only the existing bounded Hub profile, appearance/preferences, and
non-secret direct catalog metadata. It does not contain an onboarding completion marker, auth step,
account identifier, email, token, proof, code, password, recovery material, or provider assertion.

## Hub server responsibilities

The Hub implementation remains authoritative for account policy and must:

- add an email-first native signup state machine without weakening browser v1;
- bind signup, login, reset, and recovery attempts to DPoP key and purpose;
- create only native sessions on native completion and preserve authentication provenance;
- keep public signup behind its existing emergency switch and anti-bot admission policy;
- preserve generic email/login/reset responses and equivalent password work for unknown users;
- enforce peer, address, username, account, and ceremony rate limits with bounded storage;
- retain TOTP replay prevention, password lockout, Argon2 policy, session caps, recovery-code single
  consumption, and account-disable checks;
- redact email, password, codes, tokens, DPoP proofs, passkey payloads, and dynamic secret-bearing
  paths from logs and audits;
- make all attempt transitions and account/session/recovery mutations transactional and
  concurrency-safe; and
- expose the v2 capability only after the complete implementation and required security gates are
  present.

If username reservation requires persistence before activation, a migration adds nullable username
claim state to the signup attempt and preserves uniqueness transactionally. The account still does
not exist until verified mailbox, username, and credential completion commit together.

Turnstile or a future compatible anti-bot provider is hosted in a narrowly scoped provider
challenge view inside the native blocker. It receives only the public site key and challenge
context, no Hub cookie or account credential. The returned assertion is single-use, purpose-bound,
short-lived, and cleared immediately after the start request. Provider failure leaves the user on
the same native screen.

## Module boundaries

### Public contracts and runtime

- Extend hosted identity contracts with native v2 capability, requests, responses, and exact paths.
- Add transport-aware `HostedHubApi` methods that use `dpop: "mint"` before a session and
  `dpop: "session"` only after token adoption.
- Keep browser methods cookie-only and preserve `browser_only_transport` for unsupported browser
  APIs rather than silently routing them to native endpoints.
- Add a runtime-owned native identity transaction service for strict decoding, platform passkey
  ceremonies, cancellation, and token handoff.
- Keep React, React Native, DOM, Expo, and Node dependencies out of shared runtime packages.

### Mobile

- Replace `FirstRunOnboardingCoordinator` with a root `AppAccessGate` above the workspace navigator.
- Replace `OnboardingRouteScreen` and its sheet route with a locked full-screen native identity
  stack.
- Remove `onboardingProgress.ts` and its persisted completion key/migration logic.
- Reuse strict Hub profile/capability and safe replacement services rather than duplicating them.
- Reuse the direct-pair controller inside the locked stack; do not expose the workspace route as an
  escape.
- Add native screens/models for entry, custom Hub, mailbox proof, username claim, credential choice,
  password/TOTP, recovery code, reset, recovery-code custody, and bounded failures.
- Add the secure transaction/completion journal adapter over the existing mobile SecretKV.
- Keep the real Ryco `assets/logo_letter_only.svg` as the identity source; do not rasterize or
  recreate the mark.

### Hub

- Add v2 persistence/service/route changes behind the capability switch.
- Keep browser v1 and native passkey v1 working throughout rollout.
- Use the public contract package/pin as the only wire-schema source.
- Document configuration, migrations, security invariants, canary steps, rollback, backup/restore,
  and session revocation without placing private operator evidence in the public repository.

## Failure behavior

| Failure                                | User-visible result                          | State and security rule                                  |
| -------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Startup hydration                      | Full-screen Ryco loading mark                | Workspace remains unmounted                              |
| Official Hub missing/misconfigured     | Bounded retryable configuration message      | No guessed origin; custom/direct remain available        |
| Invalid custom origin                  | Inline validation                            | No request and no profile mutation                       |
| Incompatible capability/version        | Explain required native identity support     | Current Hub/session/direct state unchanged               |
| Hub offline                            | Retry on current screen                      | Inputs retained except one-time secrets; no false unlock |
| Anti-bot unavailable/rejected          | Retry challenge                              | Assertion cleared; attempt not created                   |
| Mail delivery accepted/unknown address | Same “check your email” screen               | No account-existence disclosure                          |
| Expired attempt/code/link              | Explain expiry and restart nearest safe step | Secure attempt erased                                    |
| Wrong password/code/TOTP               | Stable bounded failure                       | No raw Hub detail or identifier in logs                  |
| Passkey cancelled/unavailable          | Return to credential choice                  | Password/direct path remains available                   |
| DPoP key changed or proof replayed     | Restart ceremony with security error         | Attempt/session mint denied                              |
| Completion journal write fails         | Blocking retry                               | No token adoption or unlock                              |
| Recovery acknowledgement write fails   | Remain on recovery screen                    | Codes remain in secure journal                           |
| Final token persistence fails          | Blocking retry                               | Credential-committed journal permits safe resume         |
| Password reset succeeds                | Return to login                              | No implicit session; old sessions revoked                |
| Hosted session revoked after unlock    | Disconnect hosted plane                      | Block only when no saved direct node remains             |
| Direct pairing save fails              | Retry pairing                                | Gate remains locked                                      |

All model-owned errors use a fixed bounded vocabulary. Arbitrary response bodies, stack traces,
SQL/storage detail, tokens, proofs, account identifiers, email addresses, dynamic paths, and
provider payloads are never displayed or logged.

## Testing and verification

### Contract and runtime tests

- strict native v2 capability and every request/response codec;
- browser/native response separation, including token-versus-CSRF confusion;
- excess fields, malformed time windows, invalid identifier normalization, and inconsistent
  account/session/space projections;
- native mint request headers and DPoP mode for every transaction leg;
- wrong key, origin, method, route, algorithm, `ath`, timestamp, and replayed `jti`;
- attempt generation/origin fences, cancellation, expiry, idempotent retry, and dropped response;
- passkey creation/authentication cancellation and bounded platform errors; and
- token adoption only after strict decoding and durable mobile handoff.

### Hub tests

- migration forward/rollback and persistence drift;
- email-first signup, username races, activation idempotency, and transaction rollback;
- native passkey and password account creation;
- password login with TOTP precedence and verified-email fallback;
- recovery-code single consumption/rotation and concurrent losers;
- password reset, TOTP requirement, and all-session revocation;
- public-signup kill switch and anti-bot success/failure/replay;
- equivalent unknown-identity work and enumeration-resistant response shapes/timing bounds;
- peer/address/account/username rate limits and bounded limiter retention;
- cookie/Authorization confusion, CSRF isolation, body/path bounds, and exact routing;
- DPoP mint/session binding, proof replay, session caps, revocation, and disablement;
- retry-envelope confidentiality/retention; and
- HTTP, application, audit, and email-worker log redaction canaries.

### Mobile model and integration tests

- fresh install stays locked and never mounts workspace;
- restored validated session, saved direct node, and both-authority bypass cases;
- Hub profile or former completion preference cannot bypass the gate;
- sign-out, session revocation, and final direct-node removal transitions;
- official injected profile and bounded “Ryco Hub” presentation without committed hostname;
- custom Hub validation, stale responses, compatibility, safe switching, and direct preservation;
- new-account, existing-account, passkey, password/TOTP/email-factor, recovery, and reset projections;
- secure transaction creation, expiry, cancellation, origin switch, and cleanup;
- every crash point in the completion-journal state machine;
- recovery codes removed before unlock and never copied to KV/navigation/log/error models;
- locked workspace deep links, auth/reset links, direct-pair links, and post-unlock resolution;
- offline/error/retry behavior; and
- fixed bounded copy and accessibility labels.

### Simulator and real-device QA

Simulator QA covers compact and current phone sizes, light/dark mode, Dynamic Type, keyboard
avoidance, focus order, VoiceOver labels, reduced motion, offline/retry, custom Hub, direct pairing,
app termination at every resumable step, and proof that no Inbox/workspace frame appears while
locked.

Real-device qualification is mandatory for hardware-backed DPoP keys, passkey registration and
login, associated/universal links, background/foreground privacy, Turnstile, actual mailbox code and
link delivery, password/TOTP login, password reset, recovery-code rotation, session revocation, and
restore rehearsal. Owner interaction is requested only for credentials, mailbox, passkey, TOTP, or
provider challenges that cannot be automated safely.

Repository commands are taken from the applicable public and Hub `AGENTS.md`/package manifests in
the implementation plan. Public validation includes frozen install, focused package/mobile tests,
mobile typecheck, Expo configuration, affected browser/component tests, and `git diff --check`.
Use `bun run test`, never the repository-wide `bun test` command.

## Rollout

1. Land additive public v2 contracts and runtime support with compatibility tests. This changes no
   mobile startup behavior.
2. Pin those contracts in the Hub and land persistence/routes with the v2 capability dark.
3. Run Hub local gates, migration/restore rehearsal, and security review.
4. Deploy with public signup still disabled and prove browser v1/native passkey v1 regressions are
   absent.
5. Enable v2 capability for a controlled staging account and execute the complete native canary:
   email verification, passkey signup/login, password signup/login, TOTP, reset, recovery codes,
   revocation, and direct-plane preservation.
6. Close the signup switch after canary, review secret-free evidence, and obtain owner approval.
7. Land the separate public mobile root-blocker change only when its configured official Hub
   advertises compatible native identity v2.
8. Re-enable public signup according to the Hub's existing operational admission procedure.

The mobile client fails closed when v2 is absent. It does not silently open the Hub website or
reinterpret browser v1 as native support. Old mobile/browser clients continue through their existing
paths during the additive rollout.

## Documentation and evidence

Public documentation describes the root blocker, injected official Hub, custom compatible Hub,
native account flows, direct escape, access predicate, and unchanged DPoP/E2EE boundaries. It uses
fake example origins only.

Hub documentation describes the server state machine, capability switch, migrations, abuse and
redaction controls, provider/email configuration, canary, rollback, backup/restore, and incident
response. Private deployment identifiers and qualification evidence remain outside public commits
and pull requests.

User-facing evidence consists of compact-width screenshots and a secret-free QA record. Screenshots
must exclude emails, usernames tied to real accounts, passwords, TOTP/email/recovery codes, provider
assertions, tokens, callback parameters, private origins, and operator data.

## Non-goals

- GitHub or other social login and account linking.
- Replacing or weakening the existing browser identity flows.
- A software fallback for hardware-backed DPoP keys.
- An embedded Hub authentication website or a general-purpose WebView.
- Automatic preferred-node selection, cached offline authority, or changes to direct-node auth.
- Relay E2EE, workspace, Inbox, composer, inspector, terminal, VCS, or notification redesign.
- Enabling public signup without the existing operational and security qualification.

## Acceptance criteria

The work is complete only when all of the following are proven:

- a clean locked launch shows the approved full-screen `R`-branded identity page and no sheet or
  workspace frame;
- the only bypasses are a revalidated native Hub session or an actually saved direct node;
- the official injected Hub is the default and the custom-Hub action is small but functional;
- official-Hub signup verifies email before username and passkey/password creation;
- signup, login, passkey, password, TOTP/email factor, reset, and recovery operate natively and mint
  only DPoP-bound native sessions where appropriate;
- recovery-code custody and every documented crash boundary behave exactly as specified;
- browser v1, existing native passkey, custom compatible Hubs, and the independent direct plane
  remain correct;
- negative security, abuse, redaction, migration, package, mobile, Simulator, and real-device gates
  pass;
- rollout evidence is reviewed without leaking private deployment or account data; and
- the public and Hub changes are delivered in their correct repositories with no required work left
  hidden behind the earlier sheet-based implementation.
