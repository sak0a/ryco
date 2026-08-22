# GitHub Identity Design

**Status:** Approved

**Date:** 2026-08-22

## Summary

Ryco will support GitHub as an external Hub identity across the hosted web app, Desktop, and the
native mobile app. A person can use GitHub to create a Ryco account, sign in to an account already
linked to that GitHub identity, or explicitly connect and disconnect GitHub from an authenticated
Ryco account.

The Hub owns the entire GitHub OAuth exchange. Browser clients receive only the existing Ryco
session cookie. Desktop and mobile reuse the existing system-browser, PKCE, one-time-code, and
DPoP-bound native handoff; they receive only a Ryco native session. A GitHub access token never
crosses into a client, node, relay payload, diagnostic, or log, and is discarded after the Hub has
read the bounded identity response it needs.

GitHub identity and GitHub repository authorization remain different security domains. This design
adds an identity credential only. It does not replace the node-local `gh` CLI credentials used by
source-control operations, install the GitHub App on repositories, or grant repository, organization,
webhook, or Git permissions.

## Decisions

- Use a GitHub App's user-authorization web flow, not a classic OAuth App or a personal access
  token.
- Request only the GitHub user permissions needed for identity and a verified email. Request no
  repository or organization permission.
- Keep OAuth state, PKCE, code exchange, and the GitHub client secret inside the Hub.
- Use GitHub's immutable numeric user id, encoded as a bounded decimal string, as the provider
  subject. The mutable GitHub login is display metadata only.
- Never auto-link accounts by email, even when GitHub reports the email as verified.
- Let an unlinked GitHub identity create an account only when public signup is enabled and the
  GitHub account has a verified primary email.
- Require an authenticated Ryco session and the existing credential step-up policy to connect or
  disconnect GitHub.
- Refuse disconnect when GitHub is the account's final primary login credential.
- Reuse the existing native authorization platform adapters and custom schemes. Do not add an
  embedded web view or a client-specific OAuth implementation.
- Advertise availability through a new additive external-identity policy endpoint. Do not change
  the strict `/.well-known/ryco-hub` capability document and thereby break older native clients.
- Keep the feature unavailable when GitHub configuration is absent. Partial production
  configuration is a startup error, not a degraded mode.

GitHub recommends GitHub Apps over OAuth Apps because Apps offer finer permissions, repository
selection, and short-lived credentials:
<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps>.
The authorization flow uses state and S256 PKCE as recommended by GitHub:
<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>.

## Goals

- Offer **Continue with GitHub** on the hosted browser login/signup surface.
- Offer the same choice in Desktop and mobile through the system browser.
- Create a new personal Ryco account and space after explicit username confirmation.
- Sign in a returning account by its already-linked GitHub provider subject.
- Show GitHub connection status and bounded provider metadata in account settings on web, Desktop,
  and mobile.
- Connect GitHub to an existing authenticated Ryco account without relying on email equality.
- Disconnect GitHub when another primary credential remains.
- Preserve browser cookie/CSRF policy and native bearer/DPoP policy.
- Preserve passkey, password, recovery-code, email, TOTP, native identity, relay, and node
  authorization behavior.
- Make every provider HTTP boundary injectable and testable without contacting GitHub.
- Keep provider secrets, OAuth codes, access tokens, PKCE verifiers, attempt secrets, and email
  addresses out of logs and diagnostics.

## Non-goals

- Repository installation or selected-repository authorization.
- Replacing `gh auth login` or sending GitHub credentials to a Ryco node.
- Git clone/push credential brokering.
- GitHub Enterprise Server or configurable provider hosts in the first version.
- Organization membership as a Ryco authorization signal.
- Importing GitHub organizations, teams, repository roles, avatars, SSH keys, or signing keys.
- Account merging, identity transfer between Ryco accounts, or admin-assisted unlink recovery.
- More external identity providers in this change. Shared contracts use provider terminology, but
  the only accepted provider value is `github`.
- Production configuration, deployment, or secret installation from the public repository work.

## Current boundary

The Hub is already the authoritative identity service. Shared contracts live in
`packages/contracts`; `packages/client-runtime` owns cookie and bearer transports plus account
state; the hosted web app renders browser account flows; Desktop supplies a system-browser/custom-
protocol adapter; and mobile supplies the equivalent Expo system-browser/custom-scheme adapter.

Desktop and mobile already use a native handoff with all of the properties this feature needs:

- the client creates state and an S256 PKCE verifier;
- the start request is bound to the device DPoP key;
- the system browser visits a canonical Hub-owned HTTPS presentation route;
- the callback carries a one-time code to an allow-listed Ryco scheme; and
- redemption mints a native session bound to the same DPoP key.

GitHub repository access has a different owner today. `apps/server` runs provider operations on the
node and discovers the node's local `gh` authentication. A Hub-held identity token cannot replace
that credential without a separate installation-token broker, E2EE delivery policy, and Git
credential-helper design. This change leaves that boundary intact.

## Considered approaches

### Hub-owned GitHub App identity (selected)

The Hub performs the user authorization flow, stores a durable provider-subject link, and mints the
same Ryco sessions every other login method mints. All clients consume one shared contract and
never handle a GitHub token. A future repository-installation design can use the same GitHub App
registration without widening login consent.

This approach has the smallest credential surface and fits the existing identity owner.

### Hub-owned classic OAuth App

A classic OAuth App would implement login with fewer GitHub App concepts, but its scopes are
coarser and it provides no safe path to selected-repository installations. It would either become
a dead-end registration or encourage a later migration of provider subjects and credentials.

### Client-specific OAuth or device flows

Web, Desktop, and mobile could each run their own flow. That duplicates state, PKCE, callback,
token-storage, cancellation, and replay logic; makes the native clients public OAuth clients; and
creates multiple places where a GitHub token can leak. GitHub also recommends authorization code
with PKCE over device flow when a browser callback is available. This approach is rejected.

## Terminology and credential separation

- **GitHub App client id:** public OAuth application identifier. It may be ordinary configuration.
- **GitHub App client secret:** Hub-only production secret used for authorization-code exchange. It
  is read from a restrictive secret file and is never returned by an API.
- **Provider subject:** the immutable GitHub numeric user id. It is an identifier, not a credential.
- **Provider metadata:** the current GitHub login and optional display name. It is bounded,
  refreshable presentation data and never authorization authority.
- **GitHub access token:** short-lived exchange result used in memory to read `/user` and, only
  when account creation needs it, `/user/emails`. It is never persisted.
- **Ryco external identity:** the durable account-to-provider-subject link.
- **OAuth transaction:** short-lived Hub state for state/PKCE, continuation, and replay defense.
- **Ryco session:** the only credential clients retain after GitHub authentication.

The implementation must not accept a personal access token, installation token, GitHub App private
key, or webhook secret as a substitute for the client secret. None of those credentials is needed
for this identity-only scope.

## Shared contracts and policy discovery

`packages/contracts/hosted-identity` gains strict schemas and route constants for:

- `GET /api/auth/external/config`;
- `POST /api/auth/external/start`;
- `GET /api/auth/external/pending`;
- `POST /api/auth/external/signup/finish`;
- `POST /api/account/external-identities/github/connect` to finish a browser link after provider
  authorization and any required step-up;
- `POST /api/account/external-identities/github/disconnect`; and
- the callback path `GET /api/auth/external/github/callback`, whose redirect response is
  Hub-owned rather than client-decoded JSON.

The public configuration response is versioned and contains an array of strict provider policies.
For v1 the only possible item is:

    {
      "provider": "github",
      "login": true,
      "signup": true | false,
      "link": true
    }

`signup` mirrors the existing public-signup admission switch. Disabling new signup must not prevent
an already-linked account from logging in. An empty provider array is a valid, supported response
and hides all GitHub affordances.

This policy is separate from the strict native capability document. Old native clients continue to
decode the same capability and simply never fetch or render the new provider policy.

The account-security projection gains bounded external-identity summaries:

    {
      "provider": "github",
      "login": "octocat",
      "displayName": "The Octocat" | null,
      "connectedAt": 1787360000000,
      "lastUsedAt": 1787361000000 | null
    }

It exposes no provider subject, email, token, scope, transaction id, internal link id, or revocation
record. The shared runtime owns refresh, stale-result fencing, and action outcomes just as it does
for passkeys, password, email, and TOTP. The existing account-security read is the only list owner;
there is no second external-identity list endpoint.

## Hub components

### Provider client

A focused `GitHubIdentityProvider` interface owns:

- construction of the canonical `https://github.com/login/oauth/authorize` URL;
- code exchange against the canonical GitHub token endpoint;
- bounded reads from `https://api.github.com/user` and `/user/emails`;
- strict response parsing and size/time limits; and
- normalization of provider subject, login, display name, and verified primary email.

The live implementation uses fixed HTTPS origins, explicit request methods, an explicit GitHub API
version header, redirect refusal on server-to-server requests, bounded response bodies, and bounded
timeouts. It never follows a URL returned by GitHub. Tests inject a deterministic fake provider;
no unit or integration suite needs a real GitHub credential or network request.

The access token remains a function-local value. Error objects, audit details, response validation,
and provider fakes must not include it. After the bounded provider reads finish, the implementation
drops all references to it.

### External identity service

A transport-neutral `ExternalIdentityService` owns:

- starting an authenticate or link transaction;
- consuming the GitHub callback exactly once;
- resolving a linked provider subject;
- staging an eligible new-account confirmation;
- atomically creating an account, personal space, verified email, external identity, recovery
  codes, and session;
- atomically linking an identity to the authenticated account;
- enforcing credential step-up;
- disconnecting a link only when another primary credential remains; and
- producing security-audit events with bounded reason codes.

HTTP routes own Origin, CSRF, cookie, DPoP, rate-limit, content-type, and response projection policy.
The service receives already-authorized context and never inspects ambient headers.

### Persistence

Forward-only Hub migrations add two tables.

`external_identities` contains:

- an internal id;
- provider, fixed to `github` in v1;
- provider subject as a bounded canonical decimal string;
- account id;
- bounded login and nullable display name;
- created, updated, last-authenticated, and nullable revoked timestamps; and
- revocation actor/reason fields consistent with other credential records.

The active provider subject is globally unique. One Ryco account can have at most one GitHub link.
A revoked provider subject cannot be attached automatically to a different Ryco account; reconnect
may reactivate it only for the same account. Identity transfer is an explicit non-goal.

`external_identity_attempts` contains:

- an opaque attempt id;
- provider and intent (`authenticate` or `link`);
- continuation kind (`browser` or `native_handoff`);
- hashes/bindings for state and the browser/native continuation;
- encrypted PKCE verifier;
- encrypted pending email when a new-account confirmation is required;
- bounded pending provider subject/login/display metadata;
- optional initiating account/session ids for link;
- state, failure counters, creation/expiry/terminal timestamps; and
- a hash of the one-time pending-signup cookie secret.

Raw state, PKCE verifier, authorization code, access token, and pending-signup secret are never
stored. PKCE verifier encryption uses an AEAD key derived from the existing high-entropy Hub
session secret with a GitHub-OAuth-specific domain label. Rotation invalidates only the few
short-lived transactions in flight. Pending email uses the existing PII protection boundary and is
cleared at terminal transition.

Every transition is compare-and-update or transactionally guarded. Concurrent callbacks, signup
finishes, link redeems, and disconnects have one winner and deterministic replay responses.

### Authentication provenance

`github` becomes a session-authentication method beside passkey/password/recovery methods. A
GitHub-authenticated browser session carries that provenance, and a native session minted from it
preserves it.

The browser/native session-authentication records gain a nullable external-identity id. Their
database constraint requires it exactly when method is `github`, just as passkey provenance
requires a passkey credential id. An index by external-identity id lets disconnect revoke every
session minted from that link without relying on mutable login metadata.

For durable credential changes, GitHub provenance follows the existing fallback-session rule:

- passkey-authenticated sessions are already strong;
- fallback or GitHub sessions must present a fresh, non-reused TOTP code when TOTP is enrolled; and
- when TOTP is not enrolled, the authenticated provider/session assurance is sufficient.

This same rule gates connect and disconnect. The implementation does not introduce a second
step-up vocabulary or UI.

## Browser authentication flow

1. The client reads external-identity policy and renders **Continue with GitHub** only when GitHub
   is advertised.
2. A same-origin `POST /api/auth/external/start` requests `authenticate`. The Hub creates a
   short-lived transaction, state, and S256 PKCE challenge, then returns one canonical GitHub URL.
3. The browser navigates to GitHub. `prompt=select_account` is used so an existing GitHub browser
   session does not silently choose the wrong account.
4. GitHub redirects to the one configured Hub callback. The Hub hashes and matches state,
   atomically claims the attempt, exchanges the code with the verifier, and reads the bounded
   provider profile.
5. If the provider subject is linked, the Hub rotates/mints the normal browser session cookie and
   redirects to the allow-listed relative Hub return path.
6. If the provider subject is unlinked and signup is disabled, the Hub renders the bounded
   signup-closed result. Login remains available for linked identities.
7. If signup is enabled, the Hub requires a verified primary GitHub email. It then checks whether
   that email already belongs to any Ryco account, including a disabled account.
8. An email collision never links and never reveals the Ryco account. The result instructs the
   person to sign in another way and use **Connect GitHub**.
9. With no collision, the Hub redirects to the same-origin confirmation surface. It proposes the
   canonicalized GitHub login as the username and the GitHub display name as presentation text.
10. The person can edit the username and must explicitly submit. The existing anti-bot policy is
    enforced on completion; GitHub authorization does not bypass public-signup admission.
11. One transaction creates the account, personal space/membership, verified account email,
    external identity, recovery codes, and browser session. Username/provider/email races return a
    bounded retry or collision result and never create a partial account.
12. The normal recovery-code acknowledgement appears before workspace access.

The suggested GitHub login is not reserved. Username validation, canonicalization, history, and
contention use the existing Ryco username owner.

## Desktop and mobile sign-in/signup

Desktop and mobile do not run GitHub OAuth directly.

1. The native identity screen reads the external-provider policy and offers **Continue with
   GitHub**.
2. The action calls a typed `HostedHubApi.signInWithExternalProvider("github")` wrapper over the
   existing native handoff.
3. The native-handoff start contract gains an optional sign-in provider hint. Its absence preserves
   the existing wire behavior. The GitHub hint lets the Hub-owned presentation start the selected
   provider flow directly; it grants no permission and is accepted only when policy advertises
   GitHub.
4. GitHub login or signup completes in the system browser. For signup, username confirmation,
   anti-bot, and recovery-code acknowledgement remain in that browser.
5. The authenticated browser presentation approves the existing handoff.
6. The custom-scheme callback returns only the existing one-time Ryco code/state/handoff id.
7. The device redeems with the original PKCE verifier and DPoP key, commits the Ryco native token
   through the platform credential seam, and refreshes the directory.

No new native module is required. The free Apple Personal Team build remains supported because the
flow uses the existing custom scheme rather than associated domains. Cancellation, expiration,
supersession, browser dismissal, secure-store failure, and stale callback behavior remain governed
by the existing native handoff model.

## Connecting GitHub to an existing account

The account page shows one GitHub row:

- **Connect GitHub** when no active link exists;
- **GitHub — @login** plus **Disconnect** when linked; or
- a bounded retry/error state when status is stale.

For browser sessions, connect is an authenticated CSRF-protected start. The transaction is bound to
the initiating account and session. The callback requires the same current session, stages the
provider result, and redirects to account settings. Final `POST .../connect` revalidates that
session, consumes the pending-link cookie secret, enforces any current TOTP step-up, and commits the
link. A TOTP code is never stored in an OAuth transaction or allowed to expire while the person is
at GitHub.

For Desktop/mobile bearer sessions, the native handoff contract gains an optional purpose. Absence
means the existing sign-in behavior byte-for-byte. The new purpose is
`connect_external_identity/github`:

- start requires the current DPoP session rather than a mint proof;
- the Hub binds account id, session id, DPoP thumbprint, and provider to the handoff;
- the system-browser presentation performs GitHub authorization without creating or adopting a
  browser Ryco session;
- approval produces the same allow-listed custom-scheme callback shape;
- DPoP/PKCE redemption revalidates the initiating native session, accepts the optional TOTP step-up
  only at that final request, and atomically commits the link;
  and
- the response contains only the bounded external-identity summary.

If final redemption returns `step_up_required`, the provider result and one-time code remain pending
for a short bounded retry. The native account model prompts for TOTP and retries redemption without
reopening GitHub. Any wrong code consumes the TOTP failure budget but not the OAuth result; expiry,
session replacement, cancellation, or successful redemption terminally clears it.

The shared native-handoff coordinator is extracted only as far as necessary to support distinct
typed redemption results. Sign-in and link remain separate public methods; neither infers purpose
from UI state.

If the GitHub subject is already active on another Ryco account, connect fails without revealing
that account. A revoked subject can reactivate only on its original account. Email equality is not
consulted during explicit connect.

## Disconnecting GitHub

Disconnect is a normal authenticated account mutation:

- browser uses cookie + Origin + CSRF;
- Desktop/mobile use bearer + DPoP; and
- fallback/GitHub sessions use the existing TOTP step-up prompt when required.

Inside one transaction the Hub counts active primary credentials. Active passkeys, a configured
password, and active external identities count. Recovery codes and verified email are recovery
mechanisms, not primary credentials. Disconnect is refused with a dedicated bounded
`last_primary_credential` error if no other primary credential would remain.

Disconnect revokes the link rather than deleting its audit history. It revokes current sessions
whose authentication provenance is that GitHub link so a disconnected credential cannot retain
account access. The session performing disconnect is also revoked when it was GitHub-authenticated;
the client presents the successful disconnect and transitions to signed out.

## Error handling and user copy

Machine-readable codes are bounded and provider-neutral where possible:

- `external_provider_unavailable`;
- `external_authorization_cancelled`;
- `external_authorization_expired`;
- `external_authorization_rejected`;
- `external_identity_already_linked`;
- `external_identity_email_conflict`;
- `external_identity_verified_email_required`;
- `signup_disabled`;
- `username_unavailable`;
- `step_up_required`; and
- `last_primary_credential`.

Clients switch on codes, never provider error descriptions. GitHub response bodies, OAuth error
descriptions, emails, provider subjects, codes, tokens, transaction ids, and callback queries are
not copied into user errors. Cancellation is not shown as a failure. Retriable network/provider
failure preserves the signed-in account and prior connection summary.

Provider unavailability does not disable passkey/password/recovery login. A malformed provider
response fails closed and cannot create, link, or authenticate an account.

## Logging, audit, and privacy

Security audit events cover start throttling, successful/failed provider authentication, signup,
connect, disconnect, collision, replay, expiry, and step-up denial. They use account/link targets
when those already exist and fixed reason codes otherwise. They do not contain GitHub login,
display name, email, provider subject, state, code, token, verifier, or callback URL.

The normal log redactor adds GitHub/OAuth credential field fragments and the live process leak tests
include canary client secrets, codes, tokens, state, verifier, and email. Request logs record the
callback path without its query string.

Account-facing metadata is PII-like presentation data: it stays in the account projection, is not
placed in relay diagnostics, and is cleared from client state on sign-out.

## Client presentation

### Web

- Add the GitHub action to the existing login/signup gateway rather than creating a competing auth
  page.
- Preserve passkey/password/email flows and their current ordering.
- Render pending-signup username confirmation and bounded collision/closed/error outcomes.
- Extend the existing Hub account/security page with the GitHub connection row and step-up dialog.
- Browser tests assert navigation URLs without visiting GitHub.

### Desktop

- Reuse the shared web presentation and `desktopHostedIdentity` runtime.
- Reuse the existing external-browser and `ryco[-variant]://hosted/complete` protocol adapter.
- Keep all GitHub and Ryco session secrets out of Electron IPC.
- Test system-browser launch, callback selection, cancellation, supersession, and typed link
  redemption with fakes.

### Mobile

- Add GitHub to the pure native identity/account view models; React Native components only render
  model actions.
- Call native modules through the existing lazy platform seams, never at module scope.
- Reuse `openAuthSessionAsync` and the existing custom callback URI.
- Add pure-model coverage for hidden/available/busy/cancelled/linked/last-credential/step-up states.
- No React component test is required or possible.

## Testing

### Contracts and shared runtime

- Strictly decode valid provider policy, pending signup, external summary, start, link, disconnect,
  and redemption responses.
- Reject unknown provider values, extra properties, malformed ids/URLs/timestamps, raw token-shaped
  additions, and provider subjects in client summaries.
- Prove cookie transport sends Origin/CSRF only where required.
- Prove bearer transport uses DPoP mint for sign-in and DPoP with `ath` for link/disconnect.
- Prove stale operations cannot publish an identity summary after account/session replacement.
- Prove sign-out clears external-identity presentation state.

### Hub unit and integration tests

- Configuration is disabled when absent and fails startup on every partial/unsafe production
  combination.
- Authorization URLs use exact callback, state, S256 challenge, minimal permission, and account
  selection.
- State mismatch, code replay, callback replay, expiry, malformed provider data, redirect response,
  timeout, and oversized response all fail closed.
- Provider access tokens and PKCE verifiers never appear in SQLite, audit, logs, thrown errors, or
  serialized responses.
- Linked login mints the correct browser provenance and native handoff preserves it.
- New signup requires admission, verified primary email, anti-bot, explicit username confirmation,
  and atomic account/space/email/link/session creation.
- Email equality never links; existing, disabled, and concurrent email collisions are covered.
- Explicit connect ignores email equality, requires the initiating account/session, and enforces
  provider-subject uniqueness and step-up.
- Disconnect enforces another primary credential and revokes sessions authenticated by the link.
- Two concurrent callbacks, signup finishes, link redeems, and disconnects each have one winner.
- Migration/backup/restore/retention tests cover both new tables and encrypted pending PII.

### Web, Desktop, and mobile

- Web browser fixtures cover GitHub login, signup confirmation, collision, signup closed, connect,
  disconnect, cancellation, and provider outage.
- Desktop tests prove the system browser is used and no token crosses IPC.
- Mobile pure tests prove the provider action launches the existing handoff, is hidden when policy
  is absent, and refreshes account state after link.
- Existing passkey, password, recovery, TOTP, native identity, hosted reconnect, and source-control
  tests remain green.

### Validation backstop

This is a large, cross-cutting authentication change. Run the full public-repository backstop from
`AGENTS.md`, the web build/browser suite, and the mobile command exactly as
`bun run --cwd apps/mobile test`. Run the complete Hub unit/integration/smoke suite and its
configuration, migration, backup, and log-leak checks. Trust `bun typecheck` exit codes.

Live qualification uses a development GitHub App and non-production Hub only. It covers:

- web signup, sign-out, and GitHub login;
- explicit connect to an existing password/passkey account;
- Desktop system-browser login and persisted DPoP session;
- physical-iPhone system-browser login and persisted DPoP session;
- cancellation and wrong-account selection;
- email collision with no auto-link;
- disconnect with another credential and refusal without one; and
- confirmation that existing node-local GitHub source-control authentication is unchanged.

Anything not observable on a physical device is reported plainly and backed by the model/runtime
tests above.

## Configuration and credential handoff

Implementation and fake-provider tests require no GitHub credential.

When real end-to-end configuration is ready, the user receives a short setup guide:

1. Create a development GitHub App with the Hub development origin as homepage and
   `/api/auth/external/github/callback` as its callback.
2. Grant only **Email addresses: read-only** as a user permission. Grant no repository or
   organization permission, disable device flow, and do not install the App on repositories.
3. Provide the nonsecret client id through `RYCO_HUB_GITHUB_CLIENT_ID`.
4. Put the client secret in a restrictive local file and point
   `RYCO_HUB_GITHUB_CLIENT_SECRET_FILE` at it. Do not paste the secret into source, chat, a shell
   command captured in history, or a tool result.
5. Restart only the local/development Hub and confirm `/api/auth/external/config` advertises
   GitHub.

The implementation asks for the client id/secret only at this stage. A personal access token,
installation token, App private key, and webhook secret are neither requested nor accepted.

Production follows the repository's existing secret-file policy in a separately authorized
operation. This feature task does not touch production, deploy, configure Coolify, or install
secrets.

## Delivery

Public and private changes remain independently reviewable:

1. Public Ryco: additive contracts, client runtime, web/Desktop/mobile presentation, tests, and
   documentation. UI remains hidden against a Hub that advertises no provider.
2. Hub: persistence, provider/service/routes/configuration, tests, and an updated public Ryco vendor
   pin in a separate private change.
3. Development qualification after both sides are merged or pinned together.

No public commit contains private Hub issue links, deployment identifiers, secret values, or
production qualification evidence.

## Acceptance criteria

- A new user can create a Ryco account with GitHub on web, Desktop, and mobile.
- A linked user can log in with GitHub on all three surfaces.
- An authenticated user can explicitly connect GitHub on all three surfaces.
- An authenticated user can disconnect GitHub only when another primary login credential remains.
- A verified-email match never auto-links or merges accounts.
- Desktop and mobile use the system browser and end with DPoP-bound Ryco sessions.
- Web ends with the normal Ryco cookie/CSRF session.
- No GitHub access token is stored or delivered to a client, node, relay, log, diagnostic, or error.
- GitHub identity consent grants no repository access and leaves node-local `gh` behavior unchanged.
- Provider absence/outage leaves every existing Ryco login and recovery method usable.
- Focused, full-backstop, browser, Hub integration, and available physical-device evidence pass.
