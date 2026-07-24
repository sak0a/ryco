# Hosted account management in the shared client runtime

**Status:** draft for owner approval. Not a plan; no implementation until approved.

**Problem in one line:** the Hub serves password, email, TOTP, recovery-code, and passkey-management endpoints today, and neither client can call any of them, because `HostedHubApi` has no methods for them.

---

## 1. Why this is the crux

`packages/client-runtime/src/authorization/api.ts` exposes exactly twelve methods:

```
clearSessionMaterial   getBootstrapAvailability   restoreSession   signIn
redeemInvitation       bootstrapOwner             signOut          listNodes
lookupNodeEnrollment   approveNodeEnrollment      denyNodeEnrollment
issueRelayTicket
```

Account management is absent. That single gap explains three separate symptoms already observed:

- The hosted **web app** shows no settings for password, 2FA, or email.
- The **mobile** account surfaces (L3 Task 6) route "add this device" and "get recovery codes" to the fallback webview rather than calling the Hub.
- The L3 plan's §0.3 claimed both were "natively reachable" — true of the Hub, false of the client.

Because `HostedHubApi` is the _shared_ client for web and mobile, adding the methods once unblocks both surfaces simultaneously. Building them in either app instead would fork proof construction, URL derivation, and session handling out of the runtime — the one thing the architecture exists to prevent.

**Confirmed live on `staging.ryco.space` at the time of writing** (HTTP 405 = route registered, wrong method; 401 = registered, needs auth):

| Path                          | Status |
| ----------------------------- | ------ |
| `/api/account/password`       | 405    |
| `/api/account/recovery-codes` | 405    |
| `/api/account/passkeys`       | 401    |
| `/api/auth/password`          | 405    |
| `/api/auth/email/verify`      | 405    |

TOTP routes exist per the C2 workstream but are not at the paths probed; **step 1 of implementation is to enumerate the exact routes and methods from the Hub's router rather than guess them.**

## 2. Scope

Add account-management methods to `HostedHubApi`, corresponding controller actions and state slots to `hostedHubController` / `hostedHubStore`, and nothing else. Both clients then consume them.

Capability groups, in the order they unblock user value:

1. **Passkey management** — list credentials, add a passkey to the current session's account, revoke one. Highest value: it is what turns a webview-recovered session into a real device passkey, and it is the only registration ceremony a native client may perform.
2. **Recovery codes** — fetch/regenerate, and the once-only display contract.
3. **Password** — set, change, remove. Note a password is a _fallback_ credential; it must never be presentable as equivalent to a passkey.
4. **TOTP** — enrol, verify, revoke. Enrolment itself requires a passkey-authenticated session.
5. **Email** — add, verify, remove.

## 3. Security constraints (non-negotiable, inherited)

These are the same invariants the L3 branch was reviewed against and must not be relaxed:

- **Bearer/native requests carry `Authorization: DPoP <token>` plus a proof, never a cookie.** Any endpoint that is browser-transport-only on the Hub must **fail closed in bearer mode with a clear "not available on this transport" error**, not fall through to an unexplained 404. This is called out in the L3 plan as a desirable improvement and should land here.
- **No secret material into view models, logs, errors, analytics, or persisted stores.** Recovery codes are the deliberate exception: they are the surface's purpose, are shown once, and must not be persisted by the client.
- **Never build a native shortcut around a step-up the browser flow enforces.** TOTP enrolment requires a passkey-authenticated session; a session minted from password or recovery code must still satisfy a TOTP step-up wherever TOTP is enrolled.
- **Never present a fallback session as equivalent to a passkey session** in any copy on either client.
- Every new method reuses the existing `#request` path so proof construction, `ath` binding, single-use `jti`, and error mapping are inherited rather than reimplemented.

## 4. Non-goals

- No new Hub endpoints. This is client-side only; the server already serves these.
- **Email delivery.** The Hub's mail provider is a no-op, so verification and recovery mails are generated and discarded. These flows will be code-complete and undeliverable until an operator wires a transport (and SPF/DKIM/DMARC). That is an operator decision, not a code gap, and it should be stated in the UI copy rather than hidden.
- No change to the relay, node directory, or session lifecycle.
- No mobile or web UI in this change — those follow, in parallel, against the contract this establishes.

## 5. Open questions for the owner

1. **Scope of the first slice.** All five capability groups, or passkey management + recovery codes first? Recommendation: **the first two only.** They unblock the "recover on the web, then enrol this device" loop, which is the flow that currently dead-ends, and they carry the least step-up complexity.
2. **Should bearer mode fail closed loudly on browser-only endpoints?** Recommendation: **yes**, and in the same change — it converts a confusing 404 into an actionable message and is a small addition.
3. **Email transport.** Worth deciding before or after this slice? It does not block the code, but it does determine whether the email UI ships enabled or disabled.

## 6. Acceptance

- Every added method is exercised by runtime unit tests, including the bearer/cookie transport split and the fail-closed branch.
- No secret material reaches a view model, asserted by test, matching the pattern already used on the mobile hosted surfaces.
- `apps/web` and `apps/mobile` are untouched by this change; both consume it afterwards.
- Full public gate set green, plus `/security-review` and a cross-model review before merge — this is auth surface, and the L3 experience is that a cross-model pass catches defects the same-model pass misses.
- Owner sign-off before merge.

## 7. Sequencing

```
this spec → approval → plan → runtime methods (+ security review)
                                      │
                          ┌───────────┴───────────┐
                     web UI                  mobile screens
                    (parallel)                 (parallel)
```

Mobile screens already exist in shape from L3 Task 6; they currently hand off to the webview and would switch to native calls.
