# GitHub Identity Implementation Plan

## Objective

Implement the approved
`docs/superpowers/specs/2026-08-22-github-identity-design.md` across public Ryco and the private
Hub so web, Desktop, and mobile can:

1. create a Ryco account with GitHub;
2. sign in through an already-linked GitHub identity;
3. explicitly connect GitHub to an authenticated Ryco account; and
4. disconnect GitHub only while another primary login credential remains.

The Hub remains the OAuth and identity owner. Clients retain only Ryco sessions. GitHub repository
authorization and the node-local `gh` credential remain out of scope.

## Baseline and repository boundaries

Public Ryco:

- checkout:
  `/Users/laurinfrank/Library/CloudStorage/Dropbox/Code/ryco`;
- base: public `main` at `8212f1669`;
- working branch: `codex/github-identity`;
- approved design commit: `ccb90441a`; and
- pre-existing user change: `apps/mobile/uniwind-types.d.ts`, which stays unstaged and is never
  included in this work.

Private Hub:

- checkout: `/Users/laurinfrank/Dropbox/Code/ryco-hub`;
- begin from current private `main` after a read-only fetch/ancestry check;
- create `codex/github-identity` before edits; and
- keep production, deployment, Coolify, flags, and real secrets untouched.

The Hub consumes canonical public contracts and the hosted web build through its `vendor/ryco`
gitlink. Public contracts and clients land first. Hub development may test against a local fetch of
the exact public feature commit, but the committed Hub pin may move only after that public commit is
reachable from the reviewed public default branch. The gitlink, `src/contractsPin.ts`, and pin
guards move together in their own private commit.

## Invariants

- Use Bun 1.3.14 everywhere.
- In public Ryco, never run `bun test`; use package `bun run ... test` scripts.
- Run `bun install --frozen-lockfile` before implementation validation in each checkout.
- Use strict Effect schemas in `packages/contracts`; put no runtime logic there.
- Keep DOM and React Native imports out of `packages/client-runtime`.
- Keep mobile decision logic in pure modules. No React component tests.
- Load native modules inside functions through existing platform seams, never at module scope.
- Preserve cookie/Origin/CSRF for browser mutations and bearer/DPoP for native mutations.
- Preserve current passkey/password/recovery/TOTP step-up vocabulary and error narrowing.
- Store no GitHub access token, authorization code, raw state, raw PKCE verifier, attempt secret, or
  pending email in plaintext persistence.
- Log no provider token, code, state, verifier, subject, login, display name, or email.
- Make provider HTTP injectable; automated tests never need a GitHub credential or live network.
- Do not broaden consent into repository, organization, webhook, SSH, or Git access.
- Do not add Co-Authored-By trailers.

## Delivery shape

The implementation uses reviewable commits, not one cross-repository sweep.

| Phase | Repository | Commit intent                                    |
| ----- | ---------- | ------------------------------------------------ |
| 1     | public     | strict external-identity contracts               |
| 2     | public     | shared external-identity runtime                 |
| 3     | public     | hosted web GitHub surfaces                       |
| 4     | public     | Desktop/mobile provider actions                  |
| 5     | private    | pin canonical public feature commit              |
| 6     | private    | external-identity persistence                    |
| 7     | private    | GitHub provider/configuration boundary           |
| 8     | private    | browser authenticate/signup flows                |
| 9     | private    | connect/disconnect and native handoff            |
| 10    | both       | full gates, development credential, E2E evidence |

Phases may be combined only where separating them would leave a commit uncompilable. Public and
private repository changes never share a commit or PR.

## Phase 1 — Canonical public contracts

Files:

- `packages/contracts/src/hostedIdentity.ts`
- `packages/contracts/src/hostedIdentity.test.ts`
- `packages/contracts/src/nativeHandoff.ts`
- `packages/contracts/src/nativeHandoff.test.ts`
- explicit package exports only if required

Steps:

1. Add `ExternalIdentityProvider = "github"` plus strict bounded schemas for provider policy,
   pending signup, external identity summary, authorization start, signup finish, browser connect,
   and disconnect.
2. Add exact route constants:
   - `/api/auth/external/config`;
   - `/api/auth/external/start`;
   - `/api/auth/external/pending`;
   - `/api/auth/external/signup/finish`;
   - `/api/account/external-identities/github/connect`;
   - `/api/account/external-identities/github/disconnect`; and
   - `/api/auth/external/github/callback`.
3. Extend the account-security response with `externalIdentities`. Expose bounded presentation
   metadata only.
4. Extend native handoff with optional typed purposes:
   - absent/default sign-in;
   - sign-in with a `github` provider hint; and
   - connect `github`.
5. Keep old sign-in request/response bytes valid. Use strict response unions so link redemption
   cannot be decoded as a session.
6. Add negative tests for extra fields, provider subject/token-shaped fields, non-canonical URLs,
   malformed timestamps, unknown providers, and purpose/result mismatch.

Focused validation:

    npx -y bun@1.3.14 run --cwd packages/contracts test -- hostedIdentity nativeHandoff
    npx -y bun@1.3.14 run --cwd packages/contracts typecheck

Commit: `feat(contracts): define GitHub external identity flows`

## Phase 2 — Shared client runtime

Files:

- `packages/client-runtime/src/authorization/types.ts`
- `packages/client-runtime/src/authorization/api.ts`
- `packages/client-runtime/src/authorization/api.test.ts`
- `packages/client-runtime/src/authorization/nativeHandoff.ts`
- `packages/client-runtime/src/authorization/nativeHandoff.test.ts`
- `packages/client-runtime/src/authorization/state.ts`
- `packages/client-runtime/src/authorization/state.test.ts`
- `packages/client-runtime/src/authorization/index.ts`

Steps:

1. Add strict API methods to read provider policy, start browser authentication, read/finish
   pending signup, finish browser connect, disconnect, and decode the external summaries carried by
   account security.
2. Keep transport rules explicit:
   - public policy/start and browser signup are cookie transport;
   - browser connect/disconnect carry Origin + CSRF;
   - native connect/disconnect carry DPoP with `ath`; and
   - native sign-in continues to use DPoP mint.
3. Generalize only the internal native-handoff coordinator needed to support typed sign-in and link
   redemption. Preserve `runNativeHandoff` as the sign-in wrapper.
4. Add `signInWithExternalProvider("github")` and `connectExternalIdentity("github", stepUp?)`.
   Neither method infers purpose from current UI state.
5. Extend account state with provider policy/loading and external-identity summaries. Fence every
   result by account/session generation and clear it on sign-out.
6. Reuse `HostedAccountOutcome`, `STEP_UP_REQUIRED_CODE`, and the current cancellation semantics.
7. Prove a pending native link can retry final redemption with TOTP without reopening GitHub.

Focused validation:

    npx -y bun@1.3.14 run --cwd packages/client-runtime test -- authorization
    npx -y bun@1.3.14 run --cwd packages/client-runtime typecheck

Commit: `feat(client-runtime): add external identity authorization`

## Phase 3 — Hosted web presentation

Files:

- `apps/web/src/components/hostedHub/PublicAccountFlows.tsx`
- `apps/web/src/components/hostedHub/HubAccountPage.tsx`
- hosted shell/gateway files only where routing requires it
- `apps/web/src/hostedHub/api.ts` and `state.ts` only if they do not already re-export the shared
  runtime
- browser fixtures colocated under `apps/web/src/components/hostedHub`
- focused logic tests in pure modules

Steps:

1. Read public provider policy once through the shared runtime and render **Continue with GitHub**
   only when advertised.
2. Start authentication through a same-origin POST, then assign only the strictly decoded canonical
   GitHub authorization URL.
3. Add pending-signup presentation with proposed username, explicit confirmation, existing
   anti-bot widget, bounded collision/closed/provider-error copy, and recovery-code takeover.
4. Add the account connection row with connected login/display name, connect, disconnect,
   last-primary-credential refusal, and existing TOTP step-up prompt.
5. Keep passkey/password/email flows and current ordering intact.
6. Add browser handlers that never contact GitHub: assert start URL navigation, callback result
   rendering, signup confirmation, connect/disconnect, cancellation, outage, and stale-result
   fencing.

Focused validation:

    npx -y bun@1.3.14 run --cwd apps/web test -- PublicAccountFlows HubAccountPage
    npx -y bun@1.3.14 run --cwd apps/web typecheck
    npx -y bun@1.3.14 run build --filter=@ryco/web

Commit: `feat(web): add GitHub identity surfaces`

## Phase 4 — Desktop and mobile presentation

Desktop files:

- `apps/desktop/src/desktopHostedIdentity.ts`
- `apps/desktop/src/desktopHostedIdentity.test.ts`
- `apps/desktop/src/nativeAuthorization.ts`
- `apps/desktop/src/nativeAuthorization.test.ts`

Mobile files:

- `apps/mobile/src/features/identity/NativeIdentityScreen.tsx`
- `apps/mobile/src/features/hostedHub/hostedAuthModel.ts`
- `apps/mobile/src/features/hostedHub/hostedAuthModel.test.ts`
- `apps/mobile/src/features/hostedHub/hostedAccountModel.ts`
- `apps/mobile/src/features/hostedHub/hostedAccountModel.test.ts`
- account/identity route components only for model rendering

Steps:

1. Add a provider action to the pure sign-in view model. It calls
   `signInWithExternalProvider("github")` and uses the existing system-browser adapter.
2. Add provider connection rows/actions and typed native-link outcomes to the pure account model.
3. Reuse current step-up prompts and cancellation/busy handling.
4. Prove provider policy absence hides every action.
5. Prove no GitHub token or provider subject enters Electron IPC, React Native props, persisted
   mobile state, or model diagnostics.
6. Preserve the current custom callback scheme, Personal Team build support, secure-store commit,
   and native module import boundaries.

Focused validation:

    npx -y bun@1.3.14 run --cwd apps/desktop test -- desktopHostedIdentity nativeAuthorization
    npx -y bun@1.3.14 run --cwd apps/desktop typecheck
    npx -y bun@1.3.14 run --cwd apps/mobile test -- hostedAuthModel hostedAccountModel
    npx -y bun@1.3.14 run --cwd apps/mobile typecheck

Commit: `feat(native): add GitHub identity actions`

## Phase 5 — Hub branch and canonical public pin

Preconditions:

1. Public phases 1–4 are committed, reviewed, and reachable from public `origin/main`.
2. Public focused/full gates are green.
3. Private `main` ancestry and the current gitlink are independently verified.

Steps:

1. Fetch private `origin/main` without modifying files.
2. Create private branch `codex/github-identity` from the verified current private main.
3. Fetch the reviewed public commit in `vendor/ryco` and prove it is an ancestor of public
   `origin/main`.
4. Move `vendor/ryco`, `src/contractsPin.ts`, and both pin guards together.
5. Install the pinned public workspace dependencies as required by the Hub runbook.
6. Run contract/pin conformance before adding Hub behavior.

Commit: `chore(deps): pin GitHub identity contracts`

If the public commit is not yet on public main, continue private implementation only in a local
uncommitted submodule checkout fetched from the public working repository. Do not commit an
unreachable gitlink.

## Phase 6 — Hub persistence and repository surface

Files:

- `src/persistence/migrations.ts`
- `src/persistence/types.ts`
- `src/persistence/repositories.ts`
- `src/persistence/retention.ts`
- `src/persistence/backup.ts` if explicit manifest handling is required
- persistence/typecheck tests

Steps:

1. Add forward-only `external_identities` and `external_identity_attempts` migrations from the
   current schema version.
2. Add external-identity ids/brands, provider subject, attempt ids, hashes, and state unions.
3. Add repository methods for exact subject/account lookup, create/reactivate/revoke, metadata
   refresh, attempt claim/stage/complete/cancel/expire, and primary-credential counting.
4. Add external-identity id to session-authentication provenance with exact database constraints
   and lookup indexes.
5. Persist only encrypted PKCE verifier/pending email and hashes of state/attempt secrets.
6. Clear pending PII on every terminal transition; prune terminal/expired attempts.
7. Cover migration from the previous schema, repository concurrency, backup/restore, retention,
   and type boundaries.

Focused validation:

    npx -y bun@1.3.14 test --parallel=1 tests/persistence tests/typecheck
    npx -y bun@1.3.14 run typecheck

Commit: `feat(identity): persist external identities`

## Phase 7 — Hub configuration and GitHub provider client

Files:

- `src/config/config.ts`
- `src/config/validators.ts`
- `src/config/secretFiles.ts`
- `src/auth/githubIdentityProvider.ts`
- `src/auth/externalIdentityCrypto.ts`
- focused config/provider/crypto tests

Steps:

1. Add optional `RYCO_HUB_GITHUB_CLIENT_ID` and
   `RYCO_HUB_GITHUB_CLIENT_SECRET_FILE`.
2. Disable GitHub when both are absent. Reject every partial combination. In production, reject a
   raw secret and require the existing restrictive regular-file policy.
3. Derive the callback only from canonical `publicOrigin` plus the fixed callback path.
4. Domain-separate the OAuth transaction AEAD key from the existing session secret. Reuse the PII
   protection boundary for pending email.
5. Implement an injectable provider with canonical GitHub origins, S256 PKCE, no OAuth `scope`
   widening, `prompt=select_account`, explicit API version/User-Agent, bounded time/body, and
   redirect refusal.
6. Strictly decode token, user, and email responses. Require canonical numeric subject and, for new
   signup only, verified primary email.
7. Drop access-token references after provider reads and add canary leak tests.

Focused validation:

    npx -y bun@1.3.14 test --parallel=1 tests/config tests/auth/externalIdentityCrypto.test.ts tests/auth/githubIdentityProvider.test.ts
    npx -y bun@1.3.14 run typecheck

Commit: `feat(identity): add bounded GitHub provider`

## Phase 8 — Browser authenticate and signup

Files:

- `src/auth/externalIdentityService.ts`
- `src/http/externalIdentityRoutes.ts`
- `src/http/app.ts`
- `src/auth/audit.ts` and redaction policy
- focused auth/http/concurrency/smoke tests

Steps:

1. Add public policy/start and fixed callback routes with no-store responses and bounded
   peer/global rate limits.
2. Generate state and PKCE from CSPRNG; store only hashes/ciphertext; claim callback once.
3. Exchange code, read provider profile, and discard token.
4. Linked subject: refresh bounded metadata, mint browser session with `github` provenance, and
   redirect only to an allow-listed relative route.
5. Unlinked subject: enforce signup admission, verified primary email, and explicit no-auto-link
   collision policy.
6. Stage a pending signup behind one HttpOnly attempt cookie and same-origin JSON completion.
7. Reuse existing anti-bot, username, account/personal-space, verified-email, recovery-code, and
   session owners in one transaction.
8. Add deterministic collision/concurrency/replay/expiry/provider-failure tests and log/SQLite leak
   scans.

Focused validation:

    npx -y bun@1.3.14 test --parallel=1 tests/auth/githubIdentity.test.ts tests/http/external-identity.integration.test.ts tests/auth/concurrency.integration.test.ts

Commit: `feat(identity): add GitHub login and signup`

## Phase 9 — Connect, disconnect, and native handoff

Files:

- `src/auth/nativeHandoff.ts`
- `src/http/authRoutes.ts` and/or external identity routes
- `src/auth/service.ts` for provenance/credential count
- native-handoff, fallback-credential, HTTP, concurrency, and smoke tests

Steps:

1. Browser connect binds the initiating account/session, stages provider success, then finalizes
   through CSRF plus pending secret and current step-up.
2. Native connect uses the optional handoff purpose, current DPoP session/`ath`, provider result,
   and typed redemption. It accepts TOTP only on final redeem.
3. Preserve pending provider result for one bounded `step_up_required` retry; clear it on success,
   expiry, cancellation, session replacement, or terminal failure.
4. Enforce global provider-subject uniqueness and same-account-only reactivation.
5. Disconnect counts active passkeys/password/external identities; recovery mechanisms do not
   count. Refuse the final primary credential.
6. Revoke the link and every session whose provenance points at it. Return signed-out state if the
   current GitHub session was revoked.
7. Add audit events/reason codes without provider metadata or OAuth material.

Focused validation:

    npx -y bun@1.3.14 test --parallel=1 tests/auth/native-handoff.test.ts tests/http/native-handoff.integration.test.ts tests/auth/fallback-credentials.test.ts tests/http/external-identity.integration.test.ts

Commit: `feat(identity): connect GitHub across native sessions`

## Phase 10 — Full validation, credential handoff, and qualification

### Public full gate

    npx -y bun@1.3.14 run fmt
    npx -y bun@1.3.14 run fmt:check
    npx -y bun@1.3.14 run lint
    npx -y bun@1.3.14 run typecheck
    npx -y bun@1.3.14 run test
    npx -y bun@1.3.14 run build
    npx -y bun@1.3.14 run build --filter=@ryco/web
    npx -y bun@1.3.14 run --cwd apps/web test:browser

Install the pinned Playwright runtime first only when missing.

### Private Hub full gate

    npx -y bun@1.3.14 run fmt
    npx -y bun@1.3.14 run fmt:check
    npx -y bun@1.3.14 run lint
    npx -y bun@1.3.14 run typecheck
    npx -y bun@1.3.14 run test
    npx -y bun@1.3.14 run build

Run pin guards, migration/backup checks, and the repository's security/leak tests.

### Credential handoff

Only after every fake-provider gate passes, ask the user for the development GitHub App setup. Give
the short approved guide:

1. create a development GitHub App;
2. callback = the development Hub origin plus
   `/api/auth/external/github/callback`;
3. user permission = **Email addresses: read-only**;
4. no repository/organization permission, installation, device flow, private key, PAT, or webhook;
5. provide client id as ordinary local configuration; and
6. place client secret in a restrictive local file without pasting it into chat or a captured
   command.

### Non-production qualification

Use only a local/development Hub and development GitHub App. Verify:

- web signup, sign-out, linked login, recovery-code acknowledgement;
- email collision with no auto-link;
- connect to an existing password/passkey account;
- disconnect success and final-primary refusal;
- Desktop system-browser login and persisted DPoP session;
- physical-iPhone system-browser login and persisted DPoP session when the device is available;
- cancellation, wrong-account selection, callback replay, and provider outage; and
- unchanged node-local `gh` source-control behavior.

Report any unavailable device evidence plainly and substitute the specified pure/runtime coverage,
never an unsupported success claim.

## Completion audit

Before declaring completion, map every acceptance criterion in the design spec to:

- the exact implementation files;
- focused automated test names and green command output;
- full-gate output;
- credential/config evidence with secret values redacted; and
- live web/Desktop/mobile evidence where available.

Search both repositories for accidental token/provider-subject/email persistence, raw production
configuration, unrelated working-tree changes, private information in public commits, and
Co-Authored-By trailers. The goal remains active until every criterion has direct evidence or a
plainly reported device-only limitation backed by tests.
