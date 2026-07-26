# Native system-browser Hub handoff

- **Status:** Approved, 2026-07-26.
- **Scope:** public protocol contracts, hosted web authorization, shared
  client-runtime behavior, and the Expo mobile adapter.
- **Canonical schema:** `@ryco/contracts/native-handoff`.

## Purpose

Ryco mobile connects to a Hub whose HTTPS origin is selected at runtime. The
Hub can therefore be self-hosted on a domain that was not known when the app
was signed. Requiring a native passkey ceremony for every such domain would
also require an associated-domain entitlement and matching site association
for each app/domain combination.

The primary mobile login is instead an OAuth-style authorization-code handoff:

1. mobile discovers the Hub's capability;
2. mobile creates fresh PKCE S256 and state values and proves possession of its
   hardware DPoP key;
3. mobile opens the Hub in `ASWebAuthenticationSession`;
4. the browser authenticates with any Hub-supported browser method and asks
   the user for explicit consent;
5. the browser returns a one-time code through Ryco's variant custom scheme;
6. mobile validates the callback and redeems the code with PKCE and the same
   DPoP key; and
7. the resulting native session uses the existing directory, relay-ticket,
   WebSocket, and revocation paths.

The browser cookie never enters the mobile process. The callback never carries
an account session token.

## Product decisions

- Version 1 stores one Hub profile and supports multiple nodes within it.
- The selected Hub domain is an HTTPS origin, not a path or API key.
- A Safari session may be reused, but consent is never automatic.
- The consent screen always offers **Continue as …**, **Use another account**,
  and **Cancel**.
- Browser passkey, password plus TOTP, recovery code, and email recovery all
  lead to the same explicit consent step.
- Mobile holds the verifier, state, handoff ID, and callback code only in the
  active in-memory attempt.
- Direct/LAN/tailnet connections and their credentials are separate from Hub
  account/relay state and survive a Hub-domain change.
- Existing entitled native-passkey endpoints remain compatible, but the
  system-browser flow is the primary self-hostable login.

## Discovery

The mobile app fetches:

```http
GET /.well-known/ryco-hub
Accept: application/json
```

The exact version-1 shape is defined by `NativeHandoffCapability`. A compatible
document identifies:

- `service: "ryco-hub"`;
- protocol version 1;
- native handoff mode `system-browser`, version 1; and
- a bounded relying-party ID/display name.

The client requires the selected Hub hostname to equal or be below the
advertised RP ID. Discovery is credential-free, `no-store`, at most 16 KiB,
and fails closed on an invalid or unsupported document.

## Fixed callbacks

Version 1 accepts exactly:

```text
ryco-dev://hosted/complete
ryco-preview://hosted/complete
ryco://hosted/complete
```

No wildcard, HTTP(S) callback, alternate path/host, credential, port, query,
or fragment is accepted as a start redirect. The callback response itself has
exactly one of:

```text
?code=…&state=…&handoff_id=…
?error=access_denied&state=…&handoff_id=…
```

The public schema rejects missing, duplicate, and unexpected callback fields.
The client additionally compares state and handoff ID to its in-memory attempt
before sending any code to the Hub.

## HTTP flow

The canonical paths, field bounds, encoded types, and response shapes are
exported from `@ryco/contracts/native-handoff`.

### Start

`POST /api/auth/native/handoff/start` carries the exact
`NativeHandoffStartRequest`. It has:

- fixed callback URI;
- PKCE S256 challenge;
- random state;
- bounded plain-text device label; and
- a mint-time DPoP proof with no access token or `ath`.

It returns a random handoff ID, a same-origin HTTPS authorization URL, and a
five-minute expiry.

### Browser presentation and consent

`GET /api/auth/native/handoff/:handoffId` returns only pending status, device
label, and expiry. Account identity comes from the existing browser session
endpoint, not the handoff presentation.

`POST /api/auth/native/handoff/:handoffId/approve` and `/cancel` are normal
same-origin browser mutations using the existing cookie and CSRF transport.
Approval returns one validated custom-scheme URL carrying a 60-second code.
Cancel returns only the fixed `access_denied` callback.

### Redeem

`POST /api/auth/native/handoff/redeem` carries the handoff ID, one-time code,
and original verifier plus a fresh proof from the same DPoP key. It has no
cookie, access token, `Authorization`, or `ath`.

Success returns one fresh, non-revoked native session and its bearer token. The
runtime validates the complete bounded response before writing the token to
the platform session-credential seam. A malformed response never replaces
working credentials.

## Shared runtime ownership

`packages/client-runtime` owns:

- strict protocol decoding;
- PKCE and state generation through injected secure-random/SHA-256 seams;
- byte-level constant-time state comparison;
- callback parsing;
- the in-memory attempt state machine;
- overlap/cancellation/stale-generation fencing;
- DPoP mint requests; and
- validated bearer-token adoption.

It imports no Expo, DOM, React Native, Secure Store, or native key module.

`apps/web` owns:

- the `/native/authorize/:handoffId` route;
- shared passkey/fallback browser sign-in presentation;
- explicit consent and account switching;
- same-origin approval/cancellation; and
- validated navigation to the returned callback.

`apps/mobile` owns:

- active variant callback resolution;
- `expo-web-browser` system-session presentation;
- `expo-crypto` random/SHA-256 primitives;
- hardware-backed DPoP signing;
- Secure Store token durability; and
- account/connection presentation.

Authentication, directory, relay, synchronization, and mutation readiness
remain shared client-runtime policy rather than a second mobile
implementation.

## Mobile states

The primary action is **Continue in browser**.

- `waiting-for-browser`: cancellable; no account authority exists.
- `securing-device`: callback validated; final exchange in progress.
- `authenticated`: token stored and directory refresh begins.
- `cancelled`: quiet terminal state with an explicit retry.
- `expired`: start a completely fresh attempt.
- `callback-rejected`: clear local attempt and do not redeem.
- `incompatible`: retain the domain only as an inactive draft.
- `unavailable`: direct connections remain usable.

No final exchange is automatically replayed after an ambiguous network loss.
Retry starts a new authorization transaction.

## Personal Team development

A free Apple Personal Team build:

- uses a developer-owned bundle identifier;
- keeps the active `ryco-dev`, `ryco-preview`, or `ryco` custom scheme;
- omits `applinks:` and `webcredentials:` associated-domain entitlements;
- can select a compatible HTTPS Hub at runtime; and
- still requires the custom native hardware-key module, so Expo Go is not a
  supported client.

Paid distribution and native associated-domain passkey testing may be added
later without changing the version-1 browser-handoff protocol.

## Security properties and limitation

- PKCE protects an intercepted custom-scheme code.
- DPoP binds redemption and the resulting session to the device key.
- State and handoff ID prevent callback substitution.
- Short expiry and single-use consumption bound stolen/replayed codes.
- Browser approval/cancel retain cookie-kind, same-origin, and CSRF checks.
- Start/redeem use credential-omitting native transport.
- All bodies and fields are bounded.
- Dynamic IDs and secret-bearing values must not enter logs or analytics.

Version 1 is a native public-client flow. A custom scheme and self-signed DPoP
key do not cryptographically attest that the transaction was started by the
official binary. The browser therefore tells the user to continue only after
they initiated the connection in Ryco and always requires a deliberate click.
Before broad public distribution, an official universal-link callback or
platform-attestation enhancement requires a fresh security decision.

## Acceptance

- A custom compatible Hub profile activates without build-time domain pinning.
- A reused Safari session still requires explicit consent.
- Every existing browser authentication method reaches consent.
- Callback mismatch, duplication, interception, expiry, replay, and
  cancellation fail closed.
- Successful redemption persists a native token without exposing it to view
  state.
- The app lists authorized nodes and reaches a selected node through the
  existing relay.
- Revoking the native session removes relay access.
- Changing Hub domains clears only Hub account/relay/workspace state and
  preserves direct saved connections.
- Personal Team Expo config contains no associated-domain entitlement.
