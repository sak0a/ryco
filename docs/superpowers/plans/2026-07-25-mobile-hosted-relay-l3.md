# Mobile hosted relay (Layer 3): native passkey login, C2 fallback webview, env/node switcher, relay data channel

**Goal:** Activate the hosted plane in `apps/mobile` end to end — a hardware-key-bound native passkey session against the Hub, the Hub node directory, and reaching a node **through the Hub relay** — plus the env/node switcher that presents direct saved devices and hosted Hub nodes from one entry point. The direct-node plane (B1/B2) keeps working, unchanged, throughout.

**Design spec:** `docs/superpowers/specs/2026-07-23-native-mobile-app-design.md` — §"Auth story (two planes) and the workstream-C dependency" and §"Platform adapters" are authoritative for the plane model; the hosted plane it defers is exactly what this plan builds. The **client contract** is the merged Layer-2 runtime in this repo (`packages/client-runtime/src/{platform,authorization,relay}`) plus the wire contract in §"Wire contract" below. Read those before writing code — the runtime already owns proof construction, ticket consumption, framing, and the state machine; L3 supplies platform seams only.

**Repo/branch:** public `sak0a/ryco`, one branch (suggest `feat/mobile-hosted-relay-l3`), all work under `apps/mobile/` except where noted. Nothing in this plan changes `packages/client-runtime` — if you believe it must, stop and report instead of forking runtime logic.

---

## 0. Read this first — what is real, what is blocked, what the design got wrong

### 0.1 Current state (verified at `d85eae51`)

The hosted plane is inert at exactly five points, and nothing else in `apps/mobile` references hosted mode:

| File                                              | Line     | Current state                                                                                      |
| ------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/platform/config.ts`              | 36       | `clientMode: "standard"` hardcoded; `extra` read covers only `node.httpBaseUrl` / `node.wsBaseUrl` |
| `apps/mobile/src/platform/passkeyCeremony.ts`     | 9–12     | both methods reject with `"hosted mode not available"`                                             |
| `apps/mobile/src/platform/sessionCredentials.ts`  | 8–17     | `mode: "bearer"` with **only** the CSRF slots                                                      |
| `apps/mobile/src/connection/environmentDriver.ts` | 328, 341 | `isHostedMode: () => false`, `createPrimaryConnection: () => null`                                 |
| `apps/mobile/src/state/threadsRuntime.ts`         | 19       | `isHostedHubMode: () => false`                                                                     |

`configureHostedRuntime` is never called on mobile (`rg 'configureHostedRuntime' apps/` finds only `apps/web/src/hostedHub/runtime.ts` and runtime tests). There is no DPoP signer adapter, no `relayUrl`, no `createRelaySocket`, and no passkey native dependency in `apps/mobile/package.json`.

### 0.2 Blocking bootstrap bug you must fix before anything else runs

`HostedHubApi`'s constructor (`packages/client-runtime/src/authorization/api.ts:149-162`) throws

> `Bearer session credentials require a DPoP signer and a bearer-token holder.`

when `mode === "bearer"` and either `dpopSigner` is missing **or** `readBearerToken`/`writeBearerToken` are absent. `configureHostedRuntime` constructs the API **eagerly** (`runtime.ts:105`), so a bad adapter throws at bootstrap, not at first request. Today's `sessionCredentials.ts` is exactly that throwing shape. Task 2 fixes it; do not call `configureHostedRuntime` before then.

### 0.3 Reconciliation — the deployed Hub serves fewer native endpoints than the runtime can call

The runtime's bearer branch routes owner-bootstrap and invitation registration to `/api/auth/native/bootstrap/registration/*` and `/api/auth/native/invitations/registration/*` (`api.ts:237-254`). **The deployed Hub does not serve those.** The only `/api/auth/native/*` pair it serves is the passkey **login** pair (`…/passkey/options`, `…/passkey/verify`). The four registration endpoints and every password/email/TOTP/recovery route are **browser-transport-only**: they require a browser `Origin` matching the Hub's configured WebAuthn origins, with `Sec-Fetch-Site` absent or `same-origin` — conditions a native socket cannot satisfy.

**Decisions that follow, and that this plan builds to:**

1. **The native app can only _log in_ with an already-enrolled passkey.** Do **not** ship native owner-bootstrap or invitation-redemption screens that call `hostedHubController.bootstrapOwner(...)` / `redeemInvitation(...)` in bearer mode — they would hit endpoints that are not served. Task 6 ships sign-in + recovery-code display only; Task 7's webview is the registration and account-recovery path.
2. **Adding a passkey to an _existing_ account _is_ natively reachable** (`/api/account/passkeys/registration/*` accepts the DPoP session) — that is the "add this phone" flow, and it is the only registration ceremony the native app performs.
3. `hostedHubController.dismissRecoveryCodes()` and the `recoveryCodes` state slot are still reachable natively, because `/api/account/recovery-codes` returns codes over a DPoP session. Task 6 renders them.

### 0.4 Owner-only / not-agent-verifiable realities — state these plainly, never fabricate around them

- **Passkeys, associated domains, and the relay data path cannot be proven on the Simulator.** They need a **real device**, a **deployed Hub** on a real domain serving the association documents, and (for the relay) a **live enrolled node**. Every acceptance below marked **(owner, device)** is the owner's; agents gate `bun typecheck`, `bun run --cwd apps/mobile test` (`vp test run`), and an `expo prebuild` config/native-resolution check. **Do not fabricate device evidence, screenshots, or "verified on device" claims.**
- **Secure Enclave / StrongBox key generation does not work on the iOS Simulator** (no enclave) and is unavailable on many Android emulators. The fail-closed path (Task 2) is what the Simulator exercises; the success path is device-only.
- **The C2 email flows (email verification, email recovery) are blocked on Hub-side mail transport.** They are code-complete on the Hub but deliver nothing until an operator wires a sending domain. Document them as reachable-but-undeliverable; do not treat "no email arrived" as a client bug.
- **App icon, adaptive icon, and splash assets are still the upstream placeholders** (`apps/mobile/assets/`). Real Ryco branding is out of scope here; do not swap them in this branch.

---

## Execution rules

- **No forked runtime logic.** L3 supplies platform seams and screens. Proof construction (`createDpopProofSigner`), ticket lifecycle (`HostedRelayAttemptFactory`), relay framing/auth/flow-control (`HostedRelayEngine`), and the hosted state machine (`hostedHubController`) are consumed, never reimplemented or bypassed. If a fail-closed guard in the runtime blocks you, fix your adapter — do not relax the guard.
- **Hardware-backed key is mandatory.** A non-exportable Secure Enclave / StrongBox P-256 key or **no hosted session at all**. Never fall back to a software key: that collapses DPoP to bare bearer assurance.
- **No token, proof, private key, challenge, or credential in any view model, log, error message, analytics event, crash report, or persisted store.** The session token lives only in `SecretKV`; the private key never leaves the enclave; proof JWSs are minted, sent, and dropped. View models expose session _status_.
- **Transport separation.** Native requests present `Authorization: DPoP <token>` + a `DPoP` proof and **never** a cookie. Webview requests are cookie-only and **never** carry a DPoP header or the native token. A webview cookie must never reach a native request (see Task 7 — this is a real, platform-level hazard on Android, not a theoretical one).
- **Two-plane isolation.** The hosted plane gets its own endpoint + HTTP client instances. Enabling hosted mode must not disturb the direct plane's stores, catalog, bearer tokens, or supervisor behavior. Never let a direct bearer token reach a hosted request or a DPoP proof reach a direct connection.
- **Bound wrappers for every injected timer/socket/lifecycle seam** (`HostedRuntimeTimers` comment at `runtime.ts:41` requires it; unbound RN globals throw "Illegal invocation"). Copy the `boundNow`/`boundSetTimeout`/`boundClearTimeout` pattern already in `apps/mobile/src/connection/environmentDriver.ts:76-82`.
- **No import-time side effects** in wiring modules. The single permitted module-scope call is `setHostedRuntimeConfigurator(() => …)`, mirroring `apps/web/src/hostedHub/state.ts:22`. Singletons stay single-homed (lazily memoized, one owner, plus a `resetForTests`).
- **Tests: `vp test run` only** (`bun run --cwd apps/mobile test`). **NEVER `bun test`.** Repo-wide gates per `AGENTS.md`: `bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run typecheck:effect`, `bun run test`, `bun run build`.
- Native modules must be `vi.mock`ed in tests, following `apps/mobile/src/platform/platform.test.ts:21-37`. Every new pure helper (encoders, decoders, transcript normalizers) lives in its own module so it is testable **without** a native binary.
- Public repo: conventional commits, no AI co-author trailers, no private infrastructure/policy/issue references, `git diff --check` before each commit, stage only named paths.

---

## Wire contract the client must satisfy (compact reference)

Everything below is enforced server-side. A client that violates any line fails closed with a bounded error; nothing degrades silently.

**DPoP proof (RFC 9449).** Header `{typ:"dpop+jwt", alg, jwk}`, `alg ∈ {ES256, RS256}` (allow-list; `none`/`HS*` rejected), `jwk` public members only. Payload `{htm, htu, iat, jti}` plus `ath` **only when a token is presented**. Rules:

- `htu` is compared against a **server-derived** URL: the Hub's configured public origin + the request pathname (query/fragment stripped on both sides). The signer must therefore build `htu` from the same configured Hub origin the HTTP client targets. `createDpopProofSigner` already strips query/fragment (`dpop.ts:90-96`).
- `iat` must sit inside **−60 s … +5 s** of server clock.
- `ath` = base64url(SHA-256(ascii(token))). **Required** on every authenticated request; **must be absent** on the login/mint call. The runtime drives this off whether `token` is passed (`dpop.ts:125-127`) — supply the token, and only the token, from the bearer holder.
- `jti` is burned (single-use, ~65 s window) on **every mutation** and on the **relay WS upgrade**. Generate a fresh one per request regardless.
- The login proof's JWK thumbprint becomes the session's binding; every later proof's thumbprint must match it. One enclave key per install ⇒ this holds automatically.
- Proof header total length ≤ 4096 bytes.

**Endpoints the native app calls** (bearer branch of `api.ts`; the app never constructs these URLs itself):

| Controller call            | Method + path                                                                                       | Proof                      |
| -------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------- |
| `getBootstrapAvailability` | `GET /api/auth/bootstrap-status`                                                                    | mint (no `ath`)            |
| `signIn`                   | `POST /api/auth/native/passkey/options` → ceremony → `POST /api/auth/native/passkey/verify`         | mint, both                 |
| `restoreSession`           | `GET /api/auth/session`                                                                             | session                    |
| `signOut`                  | `POST /api/auth/logout`                                                                             | session (single-use `jti`) |
| `listNodes`                | `GET /api/nodes`                                                                                    | session                    |
| `issueRelayTicket`         | `POST /api/relay/tickets`, body `{nodeId, capability:"ryco.rpc", protocolMajor:1, protocolMinor:2}` | session (single-use `jti`) |

Bearer verify responses carry `{account, session, token, recoveryCodes?}`; the runtime writes `token` through `writeBearerToken` and **never** returns it in `HostedHubSessionResponse` (`api.ts:289-298`). `restoreSession` rotates the token only when the response carries a non-empty one. Bearer mode always sends `credentials: "omit"` and no `X-Ryco-CSRF`.

**Relay ticket:** 32 random bytes base64url, **TTL 60 000 ms**, single-use, bound to the issuing session **and** node; issuance returns 409 `node_offline` when the node is not connected.

**Relay WS upgrade:** `wss://<hub-public-origin-host>/v1/relay/client`. Path exact-match, **query string must be empty**, method GET, total headers ≤ 16 KiB. Required headers: `Authorization: DPoP <token>` and `DPoP: <proof>` with `htm=GET` and `htu` = the full `wss://…/v1/relay/client` URL, `ath` bound to the token, `jti` single-use. **A `Cookie` header on this upgrade is a hard 403.** `Origin`/`Sec-Fetch-Site` are deliberately not checked on this branch.

**After upgrade:** within **5 000 ms** the client sends exactly one **binary** frame — deterministic CBOR `{type:"auth", peer:"client", protocolMajor:1, protocolMinor:2, relayTicket:<32 bytes>}` (`packages/contracts/src/relay.ts:249-255`), `protocolMinor` must be ≥ 2. **`HostedRelayEngine` builds and sends this frame itself** (`relayEngine.ts:160-172`, `#open()` at `:219-232`) — the mobile adapter must **not** construct it. Server replies `ready` with negotiated limits, then pings; the engine answers. Close codes: 4401 auth failed · 4403 authorization failed · 4406 protocol unsupported · 4408 auth timeout · 4410 node offline · 4411 revoked · 4412 channel rejected · 4429 rate limited/slow consumer · 4430 transfer limit · 1009 frame too large · 1012 replaced/draining.

---

## Task 1 — Native passkey ceremony

Replace the throw stub with a real ceremony satisfying `PasskeyCeremonyService` (`packages/client-runtime/src/platform/index.ts:124-130`).

**Add the native dependency.** No WebAuthn dep exists. Add a Credential-Manager/AuthenticationServices module — evaluate `react-native-passkeys` (Expo module, iOS `ASAuthorizationPlatformPublicKeyCredentialProvider` + Android Credential Manager) first, `react-native-passkey` as the alternate. **Verify the installed version's actual API shape from its typings before writing the adapter** — do not code against the shape described here. Register its Expo config plugin in `app.config.ts` `plugins` if it ships one; autolinking handles the rest under `expo prebuild`. iOS deployment target is already `18.0`; confirm the module's Android `minSdk` against `expo-build-properties`.

**Files:**

- `apps/mobile/package.json` — the passkey dependency, version-pinned like its neighbours.
- `apps/mobile/app.config.ts` — plugin entry (if any).
- `apps/mobile/src/platform/passkeyTranscript.ts` **(new, pure, no native imports)** — the encode/normalize layer.
- `apps/mobile/src/platform/passkeyTranscript.test.ts` **(new)**.
- `apps/mobile/src/platform/passkeyCeremony.ts` — rewrite; imports the native module and delegates all shaping to `passkeyTranscript.ts`.
- `apps/mobile/src/platform/platform.test.ts:112-117` — **rewrite** the B1 test `"stubs the hosted passkey ceremony as unavailable in B1"`; it currently asserts both methods reject.

**What `passkeyTranscript.ts` owns (all unit-tested against fixtures, zero native):**

- **Encode direction.** The runtime validates and **decodes** options before the seam (`api.ts:215-218`, `269-272`), so the adapter receives `challenge`, `user.id`, `allowCredentials[].id`, `excludeCredentials[].id` as **`Uint8Array`** (proof: `api.test.ts:152-159`). Base64url-encode each with `encodeBase64Url` from `@ryco/client-runtime/relay`. Pass `rpId` / `rp.id`, `timeout`, `userVerification`, `authenticatorSelection`, `attestation`, `extensions` through **verbatim** — never override the server's RP ID.
- **Normalize direction.** Produce exactly `AuthenticationResponseJson` / `RegistrationResponseJson` (`packages/client-runtime/src/relay/webauthn.ts:66-96`), every binary field base64url:
  - auth: `{id, rawId, response:{clientDataJSON, authenticatorData, signature, userHandle?}, type:"public-key", clientExtensionResults, authenticatorAttachment?}`
  - register: `{id, rawId, response:{clientDataJSON, attestationObject, transports?, publicKeyAlgorithm?, publicKey?, authenticatorData?}, type:"public-key", clientExtensionResults, authenticatorAttachment?}`
  - `transports` filtered through `AUTHENTICATOR_TRANSPORTS` (`webauthn.ts:98`); `authenticatorAttachment` narrowed to `"platform" | "cross-platform"` or omitted; `clientExtensionResults` defaults to `{}` when the native module omits it; **optional keys omitted, never `undefined`**.
  - A `null`/cancelled native result throws `new Error("Passkey ceremony was cancelled.")`. Never return a partial transcript.
  - Behavioral template: `apps/web/src/hostedHub/webauthn.ts` (same output, different ceremony call) and its test `apps/web/src/hostedHub/webauthn.test.ts`.
- **Abort.** `authenticate(options, signal?)` / `register(options, signal?)` must reject immediately when `signal?.aborted`, and reject on a later `abort` event (this is what `hostedHubController.cancelAuthentication()` drives). If the native module cannot dismiss its sheet, document that in a code comment — but the promise must still settle.

**Acceptance**

- `passkeyTranscript.test.ts` covers: `Uint8Array` → base64url for challenge/user.id/allow+exclude credential ids; a full auth transcript matching the target shape byte-for-byte; a register transcript with and without the optional `response` members; transport filtering drops unknown values; unknown `authenticatorAttachment` is omitted; missing `clientExtensionResults` becomes `{}`; a null native result throws; a pre-aborted signal rejects without invoking native.
- `platform.test.ts` no longer asserts the throw stub; it asserts `mobilePasskeyCeremony satisfies PasskeyCeremonyService` and that a mocked native module round-trips through the adapter.
- `bun typecheck` and `bun run --cwd apps/mobile test` green. `expo prebuild` (dry config check) resolves the new native module.
- **(owner, device)** `authenticate` succeeds against the deployed Hub RP with the association document served — deferred to the Task 9 owner matrix.

---

## Task 2 — The enclave DPoP signer and the bearer-token holder

**Files:**

- `apps/mobile/modules/ryco-device-key/` **(new local Expo module)** — mirror the existing local-module layout (`apps/mobile/modules/ryco-markdown-text`, `ryco-review-diff`): `expo-module.config.json`, podspec, iOS Swift, Android Kotlin, `index.ts` wrapper, `package.json`; add to `apps/mobile/package.json` as `"@ryco/mobile-device-key": "file:./modules/ryco-device-key"`.
- `apps/mobile/src/platform/ecdsa.ts` **(new, pure)** + `ecdsa.test.ts` — DER↔raw signature and public-point↔JWK conversion.
- `apps/mobile/src/platform/deviceKey.ts` **(new)** — builds a `DpopSigningKey` over the native module.
- `apps/mobile/src/platform/dpopSigner.ts` **(new)** — `createMobileDpopSigner()` via `createDpopProofSigner`.
- `apps/mobile/src/platform/sessionCredentials.ts` — add the two bearer accessors + SecretKV mirroring.
- `apps/mobile/src/platform/index.ts` — export the new adapters.

**The native module contract** (`ensureKey(): Promise<{publicKeyDer|publicKeyRaw, backing}>`, `sign(bytes): Promise<signature>`, `hasKey()`, `deleteKey()`):

- **iOS:** `SecKeyCreateRandomKey` with `kSecAttrTokenID = kSecAttrTokenIDSecureEnclave`, `kSecAttrKeyType = kSecAttrKeyTypeECSECPrimeRandom`, 256 bits, `kSecAttrIsPermanent = true`, a stable `kSecAttrApplicationTag`, and a `SecAccessControl` of `.privateKeyUsage` with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. **Do not add `.biometryAny` / `.userPresence`** — a DPoP proof is minted on _every_ authenticated request, so a user-presence-gated key would prompt Face ID continuously. Sign with `SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data)` (hashes internally). Public key via `SecKeyCopyExternalRepresentation` → X9.63 uncompressed point `0x04 ‖ X(32) ‖ Y(32)`.
- **Android:** `KeyPairGenerator("EC", "AndroidKeyStore")` with `KeyGenParameterSpec` `PURPOSE_SIGN`, `setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))`, `setDigests(DIGEST_SHA256)`, `setUserAuthenticationRequired(false)`, and `setIsStrongBoxBacked(true)`. Sign with `Signature.getInstance("SHA256withECDSA")`.
- **Fail closed:** if the enclave/StrongBox is unavailable, `ensureKey` **rejects** with a stable, bounded error. There is no software fallback. Report the backing (`"secure-enclave" | "strongbox" | "unavailable"`) so the app can render an accurate unavailable state — but if you choose to accept a non-StrongBox Android hardware keystore, that is a **deliberate, documented** decision the owner must approve; the default in this plan is StrongBox-or-nothing on Android and enclave-or-nothing on iOS.
- The private key never enters JS. The module exposes no export/extract path.

**`ecdsa.ts` — the two conversions that are easy to get wrong (both unit-tested):**

1. **DER → raw.** Both platforms return an ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }`. JWS ES256 requires **raw `r ‖ s`, 64 bytes**, each left-zero-padded to 32. `createDpopProofSigner` base64url-encodes **exactly the bytes you return** (`dpop.ts:129-130`, asserted at `dpop.test.ts:59`) — returning DER produces a proof the Hub rejects with a signature failure. Handle DER's leading-`0x00` sign padding and short integers.
2. **X9.63 point → JWK.** `{kty:"EC", crv:"P-256", x: base64url(X), y: base64url(Y)}` with X and Y **left-padded to exactly 32 bytes**. Trimming a leading zero byte breaks the thumbprint and every proof after login. The JWK must carry **no** private members — `createDpopProofSigner` throws `"DPoP proof JWK must not carry private key material."` on any of `d,p,q,dp,dq,qi,k,oth` (`dpop.ts:32,62-67`), and only whitelisted members are copied, so a `toJSON()` smuggle is already defeated (`dpop.ts:74-87`).

**`dpopSigner.ts`:**

```ts
createDpopProofSigner(
  { algorithm: "ES256", publicJwk, sign },      // DpopSigningKey, dpop.ts:39-43
  { now, randomJti, sha256 },                    // DpopProofContext, dpop.ts:46-53
): DpopSignerService
```

- `now` — a **bound** `() => Date.now()`.
- `randomJti` — `Crypto.randomUUID()` from `expo-crypto` (already a dependency). Fresh per proof.
- `sha256` — `expo-crypto`'s async digest returning bytes. RN has **no `crypto.subtle`**; do not reach for it.
- `encodeBase64Url`/`decodeBase64Url` (`packages/client-runtime/src/relay/base64url.ts`) use `atob`/`btoa`. The design spec already flags these as possibly-missing Hermes globals — add a startup assertion in the hosted bootstrap that both exist and polyfill if not; a missing global must surface as a clear hosted-unavailable state, not a mystery failure inside the signer.
- Build the signer **once per key**, memoized; never per request.

**`sessionCredentials.ts`:**

```ts
mode: "bearer",
readCsrfToken, writeCsrfToken,          // keep (contract requires them; unused in bearer)
readBearerToken: () => string | null,   // NEW
writeBearerToken: (token: string | null) => void,  // NEW
```

The accessors are **synchronous** while `SecretKV` is async, so the token is held in an in-memory cache and mirrored to `mobileSecretKV` (`apps/mobile/src/platform/secretKv.ts`) under a stable key (e.g. `"ryco.hostedHub.sessionToken"` — `sanitizeSecretKey` handles the dots). Export an async `hydrateMobileHostedSessionToken(): Promise<void>` that reads SecretKV **once** into the cache. `writeBearerToken(null)` clears cache **and** SecretKV. The token is never logged, never returned from any function that feeds a view model, and never included in an error message.

**Acceptance**

- `ecdsa.test.ts`: DER→raw for a signature with leading-zero `r`, with a high-bit `s` (DER sign padding), and with short integers, each producing exactly 64 bytes; malformed DER throws; point→JWK left-pads a 31-byte X to 32; a point with the wrong length or a non-`0x04` prefix throws.
- A signer test builds `createDpopProofSigner` with a **fake** `DpopSigningKey` and asserts: the proof header is `{typ:"dpop+jwt", alg:"ES256", jwk}` with public members only; `htm` is uppercased; `htu` has query and fragment stripped; `ath` is **present** when a token is passed and **absent** when it is not; `jti` differs across two calls.
- A `sessionCredentials` test proves: constructing `new HostedHubApi({endpoint, httpClient, passkeyCeremony, sessionCredentials, dpopSigner})` **does not throw** (this is the direct regression guard for §0.2), and that the same construction **throws** when `dpopSigner` is omitted.
- A hydration test: after `writeBearerToken("t")`, a fresh holder that runs `hydrateMobileHostedSessionToken()` against a fake SecretKV returns `"t"`; after `writeBearerToken(null)` the SecretKV entry is removed.
- A redaction test: `JSON.stringify` of the session-credentials adapter and of the signer contains no token substring.
- **(owner, device)** a real enclave key is created, `hasKey()` is stable across app restarts, and `ensureKey()` **rejects** on the Simulator (fail-closed path) — the Simulator half **is** agent-runnable and must be asserted.

---

## Task 3 — Hosted-mode configuration and associated domains

**Files:** `apps/mobile/src/platform/config.ts`, `apps/mobile/src/platform/config.test.ts` (new or extend `platform.test.ts`), `apps/mobile/app.config.ts`, `apps/mobile/config/env.ts` (only if a new env name needs plumbing — `loadMobileEnv` already merges repo-root `.env`/`.env.local`).

**`app.config.ts`:**

- Add to `extra` (alongside the existing `node` block at `:222-230`):
  ```ts
  hosted: {
    hubBaseUrl: repoEnv.EXPO_PUBLIC_RYCO_HUB_URL ?? null,   // the Hub public origin: API + relay host
    appUrl: repoEnv.EXPO_PUBLIC_RYCO_HUB_APP_URL ?? null,   // the hosted web app the C2 webview opens
    relyingParty: variant.relyingParty,                     // already per-variant at :34-73
  },
  ```
- `associatedDomains` (`:119-123`) is already `applinks:` + `webcredentials:` on `variant.relyingParty` — **keep it and delete the "inert for B1" comment**.
- **Fail closed at config time:** when `extra.hosted.hubBaseUrl` is set, require `RYCO_IOS_APPLE_TEAM_ID` (`:88-90`) — the `webcredentials` association resolves against `TEAMID.BUNDLEID`, so a hosted build without a team id can never associate. Also **reject the personal-team escape hatch in hosted builds**: `RYCO_IOS_PERSONAL_TEAM_BUNDLE_ID` overrides the bundle identifier (`:76-78`), which breaks the association↔bundle binding. Throw a clear `ConfigurationError`-style message from `app.config.ts` in both cases.
- **Android:** add an `intentFilters` block for the RP host (`https://<relyingParty>`, `autoVerify: true`) so App Links verify against the served `assetlinks.json`. Credential Manager wiring comes from the Task 1 module.

**`platform/config.ts`:**

- Extend `MobileExtraConfig` with the `hosted` block and read it through the existing `trimmed()` runtime type guard (`:19-23`) — `Constants.expoConfig.extra` is untrusted; never trust the TS annotation, never call a method off an unguarded value.
- `readMobileClientRuntimeConfig()` now derives `clientMode: hosted ? "hosted-hub" : "standard"` and populates `hostedAppUrl` from `extra.hosted.appUrl` (`ClientRuntimeConfigService` at `platform/index.ts:272-281`). `httpBaseUrl`/`wsBaseUrl` keep meaning **direct-node default** and must not be overwritten by the hosted origin.
- Add `readMobileHostedConfig(): MobileHostedConfig | null` returning `{hubOrigin, appUrl, relyingParty}` — `null` when `hubBaseUrl` is absent or not a valid `https:` origin. Validate: absolute URL, `https:` in production variants, origin-only (no path/query/fragment).

**Deployment prerequisites the owner must satisfy (write these into the branch's PR body, not into code):**

- The RP host must serve `/.well-known/apple-app-site-association` as `application/json` with **no redirect**, containing `{"webcredentials":{"apps":["TEAMID.BUNDLEID"]}}` for the shipping bundle id. It **404s** until the Hub deployment is configured with that app id.
- The RP host must serve `/.well-known/assetlinks.json` with a `delegate_permission/common.get_login_creds` entry for the Android package and its signing-cert SHA-256 fingerprints (uppercase colon-hex). Package and fingerprints are all-or-nothing on the Hub side.
- **The app signs `htu` against the Hub's public origin, never the RP-ID host.** Only the two association documents are reachable at the RP-ID host when it differs from the public origin; `/api/nodes` and the relay upgrade at the RP-ID host are rejected as an invalid host. `EXPO_PUBLIC_RYCO_HUB_URL` must therefore be the **public origin**.

**Acceptance**

- Config tests (with `expo-constants` mocked, per `platform.test.ts:36`): absent `hosted` ⇒ `clientMode === "standard"` and `readMobileHostedConfig() === null`; a valid hosted block ⇒ `clientMode === "hosted-hub"`, `hostedAppUrl` set; a non-string / empty / whitespace / `http:`-in-production / path-bearing `hubBaseUrl` ⇒ `null` (fail closed, no throw at read time); the direct `node.httpBaseUrl` is unchanged in every case.
- A **two-plane guard test**: `apps/mobile/src/connection/environmentDriver.ts` still passes `isHostedMode: () => false` and `apps/mobile/src/state/threadsRuntime.ts` still passes `isHostedHubMode: () => false`, **regardless of `clientMode`**. This is load-bearing: `createEnvironmentConnectionSupervisor` reads `isHostedMode()` at `start()` and, when true, **disables** saved-environment registry syncing and resume-driven reconnect (`packages/client-runtime/src/connection/supervision.ts:496-506`). Flipping it would silently kill the direct plane.
- `APP_VARIANT=production expo config` fails with the clear error when a hosted URL is set without a team id, and when the personal-team bundle override is combined with a hosted URL; it succeeds for a direct-only build with no hosted block.

---

## Task 4 — `configureMobileHostedRuntime` and the hosted state binding

**New directory `apps/mobile/src/hostedHub/`:**

- `runtimeConfig.ts` — lazily memoized hosted `EndpointService` + `HttpClientService` built from `readMobileHostedConfig()`, **separate instances** from `apps/mobile/src/connection/runtimeConfig.ts` (which stays the direct plane's). Reuse `createMobileEndpoint` / `createMobileHttpClient`; the hosted endpoint's `origin()` must return the Hub public origin, since `api.ts:562-587` builds every bearer request URL from it and signs that exact origin into `htu`. Include `resetMobileHostedRuntimeConfigForTests()`.
- `primaryEnvironment.ts` — a tiny descriptor store: `writePrimaryEnvironmentDescriptor(descriptor | null)`, `readPrimaryEnvironmentDescriptor()`, `subscribe(listener)`, `resetForTests()`. The runtime hands it `ExecutionEnvironmentDescriptor`s built from the selected node (`packages/client-runtime/src/authorization/environment.ts:6-14`).
- `nodeLifecycle.ts` — the `HostedNodeLifecycle` implementation (see below).
- `runtime.ts` — `configureMobileHostedRuntime()`.
- `state.ts` — the configurator registration + React binding.
- `useHostedAppLifecycle.ts` — the mobile analogue of `apps/web/src/hostedHub/useHostedBrowserLifecycle.ts`.
- `relaySocket.ts` — Task 5.

**Reference wiring to copy structurally:** `apps/web/src/hostedHub/runtime.ts:19-60`. Minimal fixture showing every field: `packages/client-runtime/src/authorization/state.test.ts:83-119`.

**Every `HostedRuntimeConfiguration` field** (`packages/client-runtime/src/authorization/runtime.ts:47-75`):

| Field                      | Mobile supplies                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`                 | hosted endpoint from `hostedHub/runtimeConfig.ts`                                                                                                                                                                                                                                                                                                                                                              |
| `httpClient`               | hosted HTTP client (same module)                                                                                                                                                                                                                                                                                                                                                                               |
| `passkeyCeremony`          | `mobilePasskeyCeremony` (Task 1)                                                                                                                                                                                                                                                                                                                                                                               |
| `sessionCredentials`       | `mobileSessionCredentials` **with** both bearer accessors (Task 2)                                                                                                                                                                                                                                                                                                                                             |
| `dpopSigner`               | `createMobileDpopSigner()` (Task 2) — **required**, or the API constructor throws                                                                                                                                                                                                                                                                                                                              |
| `nodeLifecycle`            | see below                                                                                                                                                                                                                                                                                                                                                                                                      |
| `timers`                   | `{now, setTimeout, clearTimeout, queueMicrotask}` — **all bound wrappers**; `queueMicrotask` falls back to `Promise.resolve().then(cb)` if the Hermes build lacks it                                                                                                                                                                                                                                           |
| `isForeground`             | `() => mobileAppLifecycle.isForeground()`                                                                                                                                                                                                                                                                                                                                                                      |
| `subscribeForeground`      | subscribe to `mobileAppLifecycle`, invoke the listener on the **first** `"foreground"` event, return an idempotent unsubscribe (web's `{once:true}` semantics, `apps/web/src/hostedHub/runtime.ts:46-52`). This drives resumption of the 20 s directory poll (`state.ts:747-760`). Note `mobileAppLifecycle` emits both `"foreground"` and `"resume"` per transition (`appLifecycle.ts:31-34`) — de-duplicate. |
| `hasPendingRelayRequests`  | `hasHostedRelayPendingRequests` from `@ryco/client-runtime/relay`, passed straight through                                                                                                                                                                                                                                                                                                                     |
| `resetRelayAttemptFactory` | `resetHostedRelayAttemptFactory`, straight through                                                                                                                                                                                                                                                                                                                                                             |
| `relayUrl`                 | `mobileHostedRelayUrl` (Task 5)                                                                                                                                                                                                                                                                                                                                                                                |
| `createRelaySocket`        | `(input) => new MobileHostedRelaySocket(input)` (Task 5)                                                                                                                                                                                                                                                                                                                                                       |

**`nodeLifecycle` (`runtime.ts:22-37`).** The runtime owns teardown/turn-up ordering (`environment.ts:30-83`) — the app must not second-guess it:

- `writePrimaryEnvironmentDescriptor` → the `primaryEnvironment.ts` store.
- `setActiveEnvironmentId(environmentId)` → `useStore.getState().setActiveEnvironmentId(environmentId)` (the same store `HomeScreen.tsx` already drives).
- `connectPrimaryEnvironment()` → `driver.supervisor.connectPrimary()`; `disconnectPrimaryEnvironment()` → `driver.supervisor.disconnectPrimary()` (both exposed at `packages/client-runtime/src/connection/supervision.ts:90-91`).
- `clearNodeScopedState(environmentId)` → clear the mobile per-environment caches (thread detail subscriptions, composer drafts scoped to that environment, keyed-query caches) the way `apps/web/src/hostedHub/environment.ts` does for web. Do **not** touch the direct plane's catalog or bearer tokens.
- `activate` / `suspend` / `deactivate` → `async () => undefined` no-ops, matching web (`apps/web/src/hostedHub/runtime.ts:29-31`); the descriptor + connect path does the work.

**`state.ts`:**

```ts
setHostedRuntimeConfigurator(() => configureMobileHostedRuntime());   // the ONE import-time call
export function ensureMobileHostedRuntimeConfigured(): void { configureMobileHostedRuntime(); }
export const useHostedHubStore = /* zustand useStore over hostedHubStore, per apps/web/src/hostedHub/state.ts:41-45 */;
```

Re-export `hostedHubController`, `hostedHubStore`, `markHostedSessionReady`, `markHostedSessionReplaying`, `reportHostedShellSnapshotFailure`, `HOSTED_SESSION_SYNC_FAILURE_MESSAGE` so screens import from one place.

**`configureMobileHostedRuntime()` must be idempotent and fail closed:**

1. If `readMobileHostedConfig()` is `null` → do nothing; `isMobileHostedModeAvailable()` returns `false`.
2. `await`-free at call time, but the **bearer token must be hydrated before `hostedHubController.bootstrap()` runs**, because `readBearerToken()` is synchronous and a null read makes `restoreSession` fail with `session_invalid`/401 and drop the user to the bootstrap-availability probe. Expose `ensureMobileHostedSession(): Promise<void>` = hydrate token → ensure the enclave key (or mark unavailable) → configure → `hostedHubController.bootstrap()`. Screens call **that**, never `configureHostedRuntime` directly.
3. If the enclave key is unavailable, **do not configure** — surface a hosted-unavailable state.

**`useHostedAppLifecycle.ts`:** while `accountStatus === "authenticated"`, drive `hostedHubController.suspendBrowser("hidden")` on background, `suspendBrowser("offline")` on offline, and `resumeBrowser()` on foreground/online, from `mobileAppLifecycle.subscribe`. Mount it **once**, above the hosted surfaces. iOS backgrounding kills sockets — the design spec calls this out as the mobile analogue of the web hosted lifecycle.

**Acceptance**

- A wiring test with every native module `vi.mock`ed constructs the configuration and asserts: **every** `HostedRuntimeConfiguration` field is present and of the right type; `configureHostedRuntime` is called exactly once across repeated `ensureMobileHostedRuntimeConfigured()` calls; `getHostedRuntimeConfiguration()` then returns it.
- A no-side-effects test: importing `apps/mobile/src/hostedHub/state.ts` does **not** call `configureHostedRuntime` and does **not** touch SecureStore, `expo-constants`, or the device-key module. (Mirror the existing lazy-configurator pattern in `apps/mobile/src/state/threadsRuntime.ts:12-23`.)
- A bound-wrapper test: each `timers` member is a wrapper function, not a raw platform method reference (`timers.setTimeout !== globalThis.setTimeout`), and calling each works under the test runner.
- A fail-closed test: with `readMobileHostedConfig()` returning `null`, or with the device-key module rejecting, `ensureMobileHostedSession()` resolves without configuring and `isMobileHostedModeAvailable()` is `false`.
- A hydration-order test: `ensureMobileHostedSession()` hydrates the token **before** `hostedHubController.bootstrap()` is invoked.
- The Task 3 two-plane guard still passes; the direct plane's `bun run --cwd apps/mobile test` suites (`connection/environmentDriver.test.ts`, `connection/environmentActions.test.ts`) are unmodified and green.

---

## Task 5 — The relay data-channel adapter

**Files:** `apps/mobile/src/hostedHub/relaySocket.ts` (new) + `relaySocket.test.ts` (new); `apps/mobile/src/hostedHub/primaryConnection.ts` (new) + test; `apps/mobile/src/connection/environmentDriver.ts` (the `createPrimaryConnection` seam only).

**`mobileHostedRelayUrl(): string`** — from the hosted Hub origin: swap `https:`→`wss:`, set pathname `/v1/relay/client`, **no query, no fragment** (the upgrade rejects any query string). Return the same string every call (`HostedRelayAttemptFactory.nextUrl()` returns it verbatim, `transport.ts:120`). Do **not** reuse the direct plane's `resolveRemoteWebSocketConnectionUrl` — it is a different scheme (`environmentDriver.ts:257`).

**`MobileHostedRelaySocket`** — port of `apps/web/src/hostedHub/relaySocket.ts:62-177`. Two shapes are involved and both matter:

_(a) The outward facade._ `HostedRelayAttemptFactory.createSocket` casts the return of `createRelaySocket` to `WebSocket` (`transport.ts:179`) and Effect's socket layer then calls `addEventListener("open"|"error"|"close", …, {once:true})`, reads `event.code`/`event.reason` on close and `event.data` on message, and uses `send`, `close`, `readyState`, `bufferedAmount`, `binaryType` (`packages/client-runtime/src/rpc/protocol.ts:206-241`). **Do not depend on a global `EventTarget`/`MessageEvent`/`CloseEvent`/`DOMException`** — those are not reliably present in this RN/Hermes build and are absent under the Node test runner. Implement a ~30-line listener registry (`Map<type, Set<{listener, once}>>`) and emit plain objects `{type, data}` / `{type, code, reason, wasClean}`. Provide `on{open,message,error,close}` properties, `url`, `binaryType`, the `CONNECTING/OPEN/CLOSING/CLOSED` numeric constants, and `readyState` reflecting the **facade's** state. **Before writing this, read `protocol.ts:206-241` and the installed `effect` version's `Socket.layerWebSocket` to confirm the exact member set**, and prove the facade satisfies it with a test.

_(b) The inward `RelaySocket` seam handed to `HostedRelayEngine`_ (`packages/client-runtime/src/relay/relayEngine.ts:32-45`): `{bufferedAmount, readyState, send, close, onOpen, onBinaryMessage, onClose, onError}`. Construct `new HostedRelayEngine({ticket, ticketExpiresAt, socket, timers, callbacks, events})` (`relayEngine.ts:64-71`, `:135`) — **the engine builds and sends the CBOR auth frame and owns framing, auth, channel negotiation, flow control, and sequence numbers. Do not reimplement any of it.**

**Obligations, each of them load-bearing:**

- **Fail closed before opening.** Assert `input.url === mobileHostedRelayUrl()` and `input.ticketExpiresAt > now()` and throw `new Error("Relay attempt is no longer valid.")` otherwise (mirrors `relaySocket.ts:83-85`; the engine repeats the expiry check at `relayEngine.ts:158-159`). If the engine constructor throws, close the underlying socket before rethrowing (`relaySocket.ts:135-142`).
- **Fresh ticket per attempt is already enforced upstream** — `createSocket` consumes the pending ticket and throws `"A fresh relay ticket is required for every connection attempt."` on a reused/expired one (`transport.ts:135-142`; tests at `transport.test.ts:245-251`, `:326-327`). **Never cache, retry, or re-open with the same ticket.** One `createRelaySocket` call ⇒ at most one underlying WS.
- **DPoP on the upgrade.** Open the RN socket as `new WebSocket(url, undefined, { headers: { Authorization: \`DPoP ${token}\`, DPoP: proof } })`. The proof comes from `dpopSigner.sign({ method: "GET", url, token })`—`htm=GET`, `htu`= the full`wss://…/v1/relay/client`URL (the signer strips query/fragment, so the value is exactly what the Hub recomputes),`ath`bound to the token, single-use`jti`. **Set no `Cookie`header. Set no`Origin` override.\*\*
- **The proof mint is async; construction is synchronous.** Build the engine synchronously (it needs the ticket immediately) but create the RN socket after the mint resolves. The facade starts in `CONNECTING`, the inward `RelaySocket`'s `readyState` reports `CONNECTING` until the socket exists, and the engine only sends after its `onOpen` fires. **On mint failure: fail closed within the ticket's 60 s life** — emit `error` then `close` on the facade with a bounded reason, never hang, never log the proof or token, and make later engine callbacks no-ops.
- **Buffer no-retain.** The engine zeroes every buffer immediately after `send` returns (`relayEngine.ts:225-227`, `:398`, `:416`) — enqueueing the same `Uint8Array` for async transmission transmits zeros. **Copy synchronously inside `send`**: `ws.send(Uint8Array.from(bytes).buffer)` (web: `relaySocket.ts:95`). Never store, re-send, or hand out the passed buffer.
- **Undecodable inbound must not be dropped.** Set `binaryType = "arraybuffer"`; classify each message (`ArrayBuffer` → copy; typed-array view → copy; anything else → fail) and call `engine.reportUndecodableMessage("frame_too_large" | "protocol_invalid")` for the failures (`relayEngine.ts:215`; classifier template at `apps/web/src/hostedHub/relaySocket.ts:38-47`).
- **`bufferedAmount` proxies `engine.bufferedAmount`** (`relayEngine.ts:185-187`), not the raw socket's.
- **Map engine send errors.** `engine.send` throws `"RPC payload exceeds the negotiated relay limit."` / `"Relay channel is not open."` / `"Relay send queue is full."` (`relayEngine.ts:191-199`, `:365`). RN has no `DOMException`; throw plain `Error`s with those messages preserved, and document the divergence from the web facade's DOMException mapping.
- **Bound timers** for the engine's `RelayTimers`, same wrappers as Task 4.

**`primaryConnection.ts` — how the relay becomes the node's transport.** `nodeLifecycle.connectPrimaryEnvironment()` → `supervisor.connectPrimary()` → `input.createPrimaryConnection()` (`supervision.ts:331-334`). So change `apps/mobile/src/connection/environmentDriver.ts:341` from `() => null` to a call into `primaryConnection.ts` that:

- returns `null` when `readPrimaryEnvironmentDescriptor()` is `null` (this is the normal state, including at supervisor `start()` — direct-only behavior is unchanged);
- otherwise builds `createWsRpcClient(new WsTransport(() => attemptFactory.nextUrl(), { ...attemptFactory.lifecycleHandlers(), getConnectionLabel, onAttempt/onOpen/onError/onClose }))` — the consumption pattern from `apps/web/src/environments/runtime/service.ts:720-733`, using `getHostedRelayAttemptFactory()` from `@ryco/client-runtime/relay`. `apps/mobile/src/rpc/wsTransport.ts:14-16` already accepts `WsProtocolLifecycleHandlers`, so the handlers plug in directly;
- wraps it in `createEnvironmentConnection({ kind: "primary", knownEnvironment: attachEnvironmentDescriptor(createKnownEnvironment({...}), descriptor), client, … })` — **`kind` must be `"primary"`**, because `disconnectPrimary` finds the connection by `entry.kind === "primary"` (`supervision.ts:336-338`). Model the surrounding shape on `connectSavedEnvironment` (`environmentDriver.ts:276-325`), including the `applyShellEvent` / `syncShellSnapshot` wiring;
- **leaves `isHostedMode: () => false` at `environmentDriver.ts:328` untouched** (see Task 3's guard).

**Acceptance**

- `relaySocket.test.ts` (no native, no real WS — inject a fake socket factory and a fake signer):
  - constructing with a mismatched `url` or an already-expired `ticketExpiresAt` throws `"Relay attempt is no longer valid."` and **never** creates a socket;
  - the upgrade headers contain exactly `Authorization: DPoP <token>` and `DPoP: <proof>`, and **no** `Cookie`;
  - the signed proof input is `{method:"GET", url: <the wss relay url>, token: <bearer>}`;
  - the buffer handed to `send` is copied — mutating/zeroing the caller's array after `send` returns does not change what the socket received;
  - a non-binary inbound message calls `reportUndecodableMessage("frame_too_large")`; a string/unknown type is never silently dropped;
  - `bufferedAmount` reflects the engine, not the fake socket;
  - a rejected proof mint emits `error` then `close` on the facade and never opens a socket;
  - the facade satisfies the members `protocol.ts:206-241` uses, including `{once:true}` listener semantics and `event.code`/`event.reason` on close.
- `primaryConnection.test.ts`: returns `null` with no descriptor; with a descriptor, produces a `kind:"primary"` connection whose transport URL provider delegates to the attempt factory; the direct plane's saved-environment connect path is untouched.
- A no-secrets test: nothing in the adapter's thrown errors or any exposed value contains the ticket, token, or proof.
- **(owner, device + deployed Hub + live node)** the full reach: `selectNode` on an online node → ticket → upgrade → `ready` → the node's thread list loads through the relay; switching nodes tears down cleanly; backgrounding/foregrounding reconnects.

---

## Task 6 — Hosted login and account surfaces

Bind to `hostedHubController` / `hostedHubStore` (`packages/client-runtime/src/authorization/state.ts`); never re-derive state the runtime already computes.

**Route strategy — deliberately zero root-route churn.** `Onboarding` is already registered as an overlay `formSheet` with detents `[0.6, 0.95]` + grabber on both platforms, title "Connect" (`apps/mobile/src/navigation/mvpRouteConfig.ts:88-98`, `Stack.tsx:291-295`), and its screen is a 17-line `EmptyState` placeholder. Build the hosted sign-in surface **inside** `OnboardingRouteScreen` — the root route set in `mvpRouteConfig.test.ts:11-38` stays untouched. The Settings account surface adds **one nested** route (`SettingsAccount`) to `MVP_SETTINGS_SHEET_ROUTES` (`mvpRouteConfig.ts:112-118`) plus a screen in `SettingsSheetStack` (`Stack.tsx:97-131`) — **that nested set is pinned exactly** by `mvpRouteConfig.test.ts:95-106` (`toEqual` over sorted keys), so update the expected array in the same commit.

**Files:**

- `apps/mobile/src/features/onboarding/OnboardingRouteScreen.tsx` — replace the placeholder.
- `apps/mobile/src/features/hostedHub/HostedSignIn.tsx`, `HostedRecoveryCodes.tsx`, `HostedAccountRouteScreen.tsx` (new).
- `apps/mobile/src/features/settings/SettingsRouteScreen.tsx` — add the Account row (and drop the "inert until workstream C" comment at `:7-8`), rendered only when `isMobileHostedModeAvailable()`.
- `apps/mobile/src/navigation/mvpRouteConfig.ts` + `mvpRouteConfig.test.ts`, `apps/mobile/src/Stack.tsx`.

**Surfaces and their controller calls:**

| Surface                | State read                                                                      | Action                                                                              |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Sign in with passkey   | `accountStatus`, `errorMessage`                                                 | `signIn()` / `cancelAuthentication()`                                               |
| Authenticating         | `accountStatus === "authenticating"`                                            | Cancel → `cancelAuthentication()`                                                   |
| Session expired        | `accountStatus === "session-expired"`                                           | Sign in again                                                                       |
| Hosted unavailable     | `isMobileHostedModeAvailable() === false`, or `accountStatus === "unavailable"` | Explain (no hardware key / not configured); offer the direct-node path              |
| First run / no account | `bootstrapAvailable`                                                            | **Open the webview (Task 7)** — native registration endpoints are not served (§0.3) |
| Recovery codes         | `recoveryCodes`                                                                 | `dismissRecoveryCodes()`                                                            |
| Account (Settings)     | `account`, `session`, connection status                                         | `signOut()`; add-this-device passkey; "Get recovery codes"                          |
| Delivery-unknown ack   | `sessionStatus === "delivery-unknown"`                                          | `acknowledgeDeliveryUnknown()` — **mandatory**, do not auto-dismiss                 |

**Status rendering:** do not hand-roll status strings. Use `deriveHostedConnectionStatusText({browserStatus, sessionStatus, selectionStatus, transportStatus})` (`connectionStatus.ts:126`) and `deriveHostedConnectionStatusIndicator(...)` → `{shortLabel, connected}` (`:222`). Gate action affordances with `resolveHostedRpcCapability` (`capabilities.ts:10`).

**Styling — the merged design system is authoritative** (`apps/mobile/global.css`, dark resolved by `src/lib/appScheme.ts`):

- Token classNames only (`bg-screen`, `bg-card`, `text-foreground`, `text-foreground-muted`, `border-border`) — **no `dark:` prefixes**, no hardcoded hexes. Runtime color reads go through `useThemeColor("--color-…")`.
- **Glass is floating chrome only.** Content cards stay opaque `bg-card`. `GlassSurface`/`GlassIconButton` are for nav chrome and overlay pills, not sign-in cards.
- Reuse the existing components: `AppText`/`AppTextInput`, `EmptyState`, `StatusPill`, `ErrorBanner`, `LoadingScreen`, `CopyTextButton` (for recovery codes), `SettingsRow`/`SettingsSection`, `ControlPill`, `ConfirmDialogHost` (for sign-out confirmation). Primary CTA = white capsule + black label (`bg-primary` / `text-primary-foreground`), matching `ConnectionsRouteScreen.tsx:32-37`.
- Screen shell: `ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-screen" contentContainerStyle={{paddingVertical: 12}}`.
- **Any new SF Symbol must be added to `AppSymbol.tsx`'s `ANDROID_ICON_BY_SF_SYMBOL` / `ANDROID_ICON_BY_MATERIAL_NAME` maps (`:77-172`) or it renders nothing on Android.**

**Acceptance**

- Component tests drive each surface from a fake `hostedHubStore` state and assert the correct controller method is called (`signIn`, `cancelAuthentication`, `dismissRecoveryCodes`, `signOut`, `acknowledgeDeliveryUnknown`).
- A **no-secrets** test: render every hosted surface with a store state that includes an authenticated session, and assert the rendered tree contains no bearer token, no proof, and no `ath`-like material — view models expose status only.
- `mvpRouteConfig.test.ts` updated for the one nested route and green; the **root** route key set and every linking string are unchanged.
- No hosted surface is reachable when `isMobileHostedModeAvailable()` is false.
- The direct plane's screens (Home, Thread, Review, Connections, Settings) are visually and behaviorally unchanged.

---

## Task 7 — The C2 fallback webview

**Purpose, precisely:** get a user who has no device passkey (first run, new device, lost device, password/recovery/email/TOTP user) back to a **device passkey**, then hand control to the native passkey login. The app **never implements** those flows itself.

**Why a webview at all:** every fallback endpoint (password sign-in, email verification, email recovery, TOTP enrollment/verify/revoke, recovery-code redemption, and the owner-bootstrap / invitation-redemption registrations) is **browser-transport-only** on the Hub — it requires a browser `Origin` in the Hub's WebAuthn origin list with a matching `Host` and `Sec-Fetch-Site` absent-or-`same-origin`. A native socket cannot satisfy that. The app opens the **Hub's own hosted web app** at the configured `hostedAppUrl` and lets it drive them.

**Files:** `apps/mobile/src/features/hostedHub/HostedFallbackSession.ts` (new) + test; call sites in `HostedSignIn.tsx` / `HostedAccountRouteScreen.tsx`.

**Implementation:**

- **Prefer `expo-web-browser`'s `openAuthSessionAsync(url, redirectUrl, { preferEphemeralSession: true })`** (already a dependency). Rationale: the browser session's cookies live in an ephemeral store the app cannot read and that is discarded on completion — the strongest possible transport separation — and Safari-backed WebAuthn is far more reliable than in-app WKWebView WebAuthn. Use `react-native-webview` (also already a dependency) only if a controlled in-app surface proves necessary, and then with `incognito` and iOS `sharedCookiesEnabled={false}`.
- **URL construction is fail-closed:** the URL comes **only** from the validated `hostedAppUrl` in config. Never from a deep link, a QR code, user input, or a server-supplied redirect. Require `https:` and that its host matches the configured Hub/RP host. **Never append the bearer token, a proof, or any credential to the URL or a fragment.**
- **Return handoff:** resolve on redirect to the app scheme (e.g. `ryco://hosted/complete`) or on user dismissal. In **both** cases the next step is the same: call `hostedHubController.signIn()` — a native passkey login that mints the app's own DPoP session. **The app never adopts the webview's session.** Do not require Hub-side changes for this handoff; dismissal must work.
- **Step-up rules the surface must not undermine:** a session created by password / recovery-code / email-recovery must satisfy a TOTP step-up wherever TOTP is enrolled, and **TOTP enrollment itself requires a passkey-authenticated session**. The hosted web app enforces all of this. The native app's job is to (a) never build a shortcut that skips a step-up the web flow enforces, and (b) never present a fallback session as equivalent to a passkey session in its copy. A native session is always passkey-derived and therefore never needs a TOTP code — do not add a TOTP field to any native screen.
- **Email flows are undeliverable until the Hub deployment has mail transport.** Say so in the UI copy for the email-recovery entry point, or omit that entry point until it works.

**The Android cookie hazard — treat as blocker-class.** On Android, RN's HTTP stack (OkHttp) and its WebSocket share a cookie jar backed by the app-global `CookieManager`, which is the same store an in-app WebView writes to. A Hub-origin browser cookie left behind by the fallback flow will be attached to subsequent native requests and to the **relay WS upgrade — which rejects any `Cookie` header with a hard 403**. Consequently:

- Use the ephemeral `openAuthSessionAsync` path (no app-visible cookie jar) as the default.
- If any in-app WebView path is used, purge Hub-origin cookies from the app-global store when the flow ends, before any native hosted request.
- Note that bearer requests already pass `credentials: "omit"` (`api.ts:587`), which RN maps to disabling cookie handling on the underlying request — **verify this holds on both platforms** rather than assuming it.

**Acceptance**

- Unit tests: URL validation rejects `http:`, a host mismatch, a path-bearing or query-bearing override, and any URL not derived from config; the constructed URL contains no token/proof substring; both the redirect and the dismissal path call `hostedHubController.signIn()` and never write a bearer token from webview data.
- A transport-separation test: the fallback module exposes no way to move a cookie, session, or CSRF token into the native session-credentials adapter.
- **(owner, device)** password / recovery-code / TOTP sign-in works in the sheet; enrolling a device passkey (with the TOTP step-up where enrolled) succeeds; returning to the app and signing in natively yields a DPoP session; **and — the falsifiable one — after completing the webview flow, the relay upgrade still succeeds (no `Cookie`-related 403) on Android.**

---

## Task 8 — The env/node switcher

**Owner's model:** the top-left Ryco brand mark opens a switcher listing **both** direct saved devices and hosted Hub nodes; selecting one connects.

**Entry point.** Home has only a `headerRight` today (`apps/mobile/src/features/home/HomeScreen.tsx:68-93`). Add a `headerLeft` `Pressable` in the same `useLayoutEffect(navigation.setOptions{...})` block rendering `RycoWordmark` in `compact` mode (`apps/mobile/src/components/RycoWordmark.tsx:13`, currently used only by `LoadingScreen`), with `accessibilityRole="button"`, an accessible label, and `hitSlop`.

**Surface — reuse the existing `Connections` route.** It is already an overlay `formSheet` titled "Environments" (`mvpRouteConfig.ts:66-72`, `Stack.tsx:276-280`). Extending it means **no root-route change and no churn in `mvpRouteConfig.test.ts:11-53`**. Widen its iOS detents from `[0.55, 0.7]` to `[0.6, 0.95]` to fit two sections (the test pins the key set and linking strings, not these detents — but re-run it). If you decide a distinct route is genuinely better, you must also update the exact expected array at `mvpRouteConfig.test.ts:13-24` and the overlay assertions at `:72-88`.

**Two labeled sections, not one merged list.** The planes have different selection models, guards, and refresh cadence; merging them would hide that.

- **Devices (direct plane)** — rows from `useSavedEnvironments()` / actions from `useConnectionActions()` (`apps/mobile/src/features/connection/useConnectionController.ts:29,37`), exactly as `ConnectionsRouteScreen.tsx` renders today, with per-row Reconnect/Remove and the "Pair a device" CTA → `ConnectionsNew`. Connect = the existing supervisor over `WsTransport`. Multi-connect; no 20 s refresh. **This section keeps working with hosted mode entirely absent.**
- **Hub nodes (hosted plane)** — rows from `useHostedHubStore((s) => s.nodes)` with `presence.online`, `effectiveRole`, and `revokedAt`. Row is **disabled unless** `directoryStatus === "ready" && browserStatus === "current" && !node.revokedAt` (the fail-closed guard the controller itself enforces at `state.ts:485-487`). Connect = `hostedHubController.selectNode(node.id)`. Plus: "All nodes" → `returnToDirectory()`, "Refresh" → `refreshDirectory()`, "Retry" → `retrySelectedNode()` when a selection failed. The 20 s directory refresh runs while the sheet is open and is suspended while backgrounded (the runtime handles this via the foreground seam from Task 4).
- Section status text uses `deriveHostedConnectionStatusText` / `…Indicator`, not hand-written strings.
- **When hosted mode is unavailable or signed out, the Hub-nodes section renders an explicit empty/disabled state with a "Sign in" affordance — never a tappable-but-broken row.**

**Files:** `apps/mobile/src/features/home/HomeScreen.tsx`, `apps/mobile/src/features/connection/ConnectionsRouteScreen.tsx`, a new `apps/mobile/src/features/hostedHub/HubNodeSection.tsx`, `apps/mobile/src/navigation/mvpRouteConfig.ts` (detents only).

**Acceptance**

- The brand mark opens the sheet (navigation test / component test asserting `navigate("Connections")`).
- `HubNodeSection` tests over a fake store: rows disabled when `directoryStatus !== "ready"`, when `browserStatus !== "current"`, and when `node.revokedAt` is set; an enabled row calls `selectNode(node.id)`; "All nodes" calls `returnToDirectory()`; "Refresh" calls `refreshDirectory()`; signed-out renders the sign-in affordance and no tappable node rows.
- **Cross-contamination test:** rendering and interacting with the Hub-nodes section performs **zero** reads/writes against the direct catalog, the direct registry store, or `SecretKV` bearer-token keys — and vice versa: the Devices section never touches `hostedHubStore` or the hosted endpoint.
- The existing `ConnectionsRouteScreen` behavior (pair, reconnect, remove) is unchanged; `mvpRouteConfig.test.ts` green.
- **(owner, device)** with hosted mode configured and a live node, selecting a Hub node connects through the relay and the thread list loads; with hosted mode unconfigured, the sheet is Devices-only and B2 behavior is identical.

---

## Task 9 — Gates, security review, evidence, PR (orchestrator)

**Agent-runnable gates — run all, report every failure, and distinguish a proven pre-existing baseline from a regression:**

```sh
bun install --frozen-lockfile
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
bun run --cwd apps/mobile test          # vp test run — NEVER `bun test`
APP_VARIANT=development bun run --cwd apps/mobile config:dev
APP_VARIANT=production  bun run --cwd apps/mobile config:prod
```

Plus an `expo prebuild` (or EAS `--local`) config-and-native-resolution check proving the passkey module and `ryco-device-key` resolve on both platforms, and these sweeps:

- `rg -n 'bun test' apps/mobile` → no hits.
- Secret sweep: no `console.log`/`console.warn` of a token, proof, JWT, challenge, or private key anywhere under `apps/mobile/src/hostedHub`, `apps/mobile/src/platform/{dpopSigner,deviceKey,sessionCredentials,passkeyCeremony}.ts`.
- Two-plane sweep: `apps/mobile/src/connection/environmentDriver.ts` still has `isHostedMode: () => false`; `apps/mobile/src/state/threadsRuntime.ts` still has `isHostedHubMode: () => false`.
- `rg -n 'dark:' apps/mobile/src` on new files → no token-class `dark:` prefixes.
- Confirm `packages/client-runtime` and `apps/web` are **unchanged** in the diff (`git diff --stat main -- packages/ apps/web/`).

**Run `/security-review` on the branch** and resolve every blocker-class finding before requesting merge. The invariants below are acceptance criteria, not advisories.

**Owner-only acceptance matrix — ship this checklist in the PR body; agents must not claim any row:**

| #   | Requires                               | Check                                                                                                                        |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | device                                 | Enclave/StrongBox key created; survives restart; **Simulator fails closed with no hosted session** (agent-checkable half)    |
| 2   | device + deployed Hub with AASA served | Native passkey sign-in yields an authenticated hosted session; `restoreSession` survives an app restart; `signOut` clears it |
| 3   | device + Hub                           | `/api/nodes` populates the Hub-nodes section with presence                                                                   |
| 4   | device + Hub + live node               | `selectNode` → ticket → relay upgrade → `ready` → thread list loads **through the relay**                                    |
| 5   | device                                 | Background ≥ 60 s, foreground: directory refresh resumes and the relay reconnects                                            |
| 6   | device                                 | Switching nodes tears down cleanly; "All nodes" returns to the directory with the Hub session intact                         |
| 7   | device                                 | C2 webview: password/recovery/TOTP sign-in, device-passkey enrollment, then native sign-in succeeds                          |
| 8   | device, **Android**                    | After the webview flow, the relay upgrade still succeeds (no cookie-induced 403)                                             |
| 9   | device                                 | The direct plane is unchanged: pair, connect, reconnect, thread list — with and without hosted mode configured               |

Also record in the PR body: the deployment prerequisites from Task 3 (association documents, app id, Android package + fingerprints, `EXPO_PUBLIC_RYCO_HUB_URL` = the Hub **public origin**), that the C2 email flows are blocked on Hub-side mail transport, and that the app icon/adaptive icon/splash remain upstream placeholders pending real Ryco branding.

**PR:** against `main`, scoped to this branch, conventional commits, no AI co-author trailers, no private infrastructure/policy/issue references. **Do not claim completion until the agent gates pass and the owner has signed off on the device matrix. Never fabricate device evidence.**

---

## Security invariants (blocker-class — carried through every task)

1. **Hardware-backed key or no hosted session.** Non-exportable Secure Enclave / StrongBox P-256 only. No software fallback, ever. Fail closed and say so in the UI.
2. **No secret material anywhere but where it belongs.** The session token lives only in `SecretKV` and the in-memory sync holder; the private key never leaves the enclave; proof JWSs are minted, sent, and dropped. Nothing — token, proof, `ath`, challenge, credential id blob, ticket — enters a view model, log, error message, analytics event, crash report, or any persisted store.
3. **Transport separation.** Native requests: `Authorization: DPoP` + proof, no cookie. Webview: cookie only, no DPoP header, no native token in the URL or fragment. A webview cookie must never reach a native request — including via the platform's shared cookie jar (Task 7).
4. **No forked runtime logic.** Proof construction, ticket lifecycle, relay framing/auth/flow-control, and the hosted state machine are consumed from `@ryco/client-runtime`. Do not weaken or route around any fail-closed guard: the asymmetric-alg allow-list, the private-JWK rejection, the fresh-ticket-per-attempt rule, the ticket-expiry checks, the bearer-credentials constructor assertion, or the directory/selection guards.
5. **Buffer no-retain.** Every buffer passed to the platform socket's `send` is copied synchronously and never retained, re-sent, or stored — the engine zeroes it immediately after the call returns.
6. **Fresh ticket per attempt.** One `createRelaySocket` call ⇒ at most one socket. Never cache, replay, or reuse a ticket; never open the relay socket to any URL other than the pinned `relayUrl()`.
7. **Two-plane isolation.** The direct plane keeps its own endpoint, HTTP client, catalog, stores, and bearer tokens. `isHostedMode` / `isHostedHubMode` stay `false` (flipping them disables the direct plane's registry sync and resume reconnect). No direct bearer into a hosted request; no DPoP proof into a direct connection.
8. **Do not build a native shortcut around a step-up the fallback flow enforces**, and never present a fallback session as equivalent to a passkey session.
9. **Bound wrappers, no import-time side effects, single-homed singletons** — the recurring RN failure modes; each is separately tested.
