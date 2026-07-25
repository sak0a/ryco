import { EnvironmentId } from "@ryco/contracts";

import type {
  DpopSignerService,
  EndpointService,
  HttpClientService,
  PasskeyCeremonyService,
  SessionCredentialsService,
} from "../platform/index.ts";

import type {
  HostedAddPasskeyResult,
  HostedHubNode,
  HostedHubPasskey,
  HostedHubSessionResponse,
  HostedNodeEnrollment,
  HostedRelayTicket,
  HostedTotpEnrollment,
} from "./types.ts";
import {
  validatePasskeyAuthenticationOptions,
  validatePasskeyRegistrationOptions,
} from "../relay/webauthn.ts";

const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" } as const;

const MAX_BEARER_TOKEN_LENGTH = 4096;
const MAX_PASSKEY_LABEL_LENGTH = 256;
const MAX_PASSKEYS = 256;

/**
 * Bounds for the *newly added* recovery-code route only, set well clear of any
 * plausible real format. They are deliberately not applied to the pre-existing
 * session paths — see {@link recoveryCodesValue}.
 */
const MAX_RECOVERY_CODES = 256;
const MAX_RECOVERY_CODE_LENGTH = 512;

/**
 * Bounds the identifier a malformed Hub response may project into a view model.
 * Deliberately permissive: this is the *projection* constraint, and rejecting a
 * legitimately-shaped credential here would blank the whole passkey list.
 *
 * It is emphatically **not** what makes {@link HostedHubApi.revokePasskey} safe
 * to build a URL path from — that method re-validates its caller-supplied
 * argument against the narrower {@link PASSKEY_CREDENTIAL_ID_PATTERN} at the
 * call boundary, so an id that reached a view model through a looser check can
 * still never be interpolated into a request path.
 */
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * The Hub's passkey-credential identifier: a `pkey_` prefix and 22 base64url
 * characters, the same shape the Hub's own route matcher enforces. This is the
 * gate on the one account path built by interpolation, so it is checked before
 * a URL is constructed and before any I/O — an id that does not match never
 * reaches the wire in any form.
 */
const PASSKEY_CREDENTIAL_ID_PATTERN = /^pkey_[A-Za-z0-9_-]{22}$/;

/** Bounds on the passkey revocation reason a malformed Hub may project. */
const MAX_REVOCATION_REASON_LENGTH = 256;

/**
 * Bounds on the TOTP enrolment response. Both members are **sensitive**: the
 * base32 secret *is* the shared key, and the provisioning URI embeds it. They
 * are returned to the caller for a single enrolment display and are never
 * logged, persisted, or placed in an error by this client.
 */
const MAX_TOTP_SECRET_LENGTH = 256;
const MAX_TOTP_PROVISIONING_URI_LENGTH = 2048;

/**
 * The provisioning URI is an `otpauth://` key URI (RFC-style, what authenticator
 * apps consume). Requiring the scheme fails closed on a malformed Hub handing
 * back something a surface might render as a link or navigate to.
 */
const TOTP_PROVISIONING_URI_SCHEME = "otpauth://";

/**
 * Hub routes that only accept a browser transport: they require an `Origin` in
 * the Hub's configured WebAuthn origin list, which a native socket cannot
 * present. The bearer branch below still derives these paths for owner
 * bootstrap and invitation redemption, so without an explicit guard a native
 * caller gets an unexplained 404 instead of an actionable message. Prefixes are
 * matched against the parsed, normalized pathname.
 *
 * The native passkey *login* pair (`/api/auth/native/passkey/…`) is served and
 * is deliberately absent from this list.
 */
const BROWSER_ONLY_BEARER_PATH_PREFIXES: ReadonlyArray<string> = [
  "/api/auth/native/bootstrap/registration/",
  "/api/auth/native/invitations/registration/",
];

/**
 * Matched case-insensitively so a differently-cased path cannot slip past the
 * guard. Percent-encoded pathnames are rejected outright by `#request` before
 * this runs, so an encoded separator cannot evade the prefix comparison either.
 */
function isBrowserOnlyPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return BROWSER_ONLY_BEARER_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export class HostedHubApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(code: string, status: number, retryAfterMs?: number) {
    super(messageForCode(code));
    this.name = "HostedHubApiError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function messageForCode(code: string): string {
  switch (code) {
    case "authentication_failed":
      return "The passkey could not be verified.";
    case "registration_unavailable":
      return "The invitation or registration challenge is unavailable or expired.";
    case "session_invalid":
    case "unauthorized":
      return "Your Hub session has expired.";
    case "csrf_rejected":
      return "The request could not be verified. Refresh and try again.";
    case "forbidden":
    case "authorization_failed":
      return "You are not authorized to perform this action.";
    case "not_found":
      return "The requested item is no longer available.";
    case "conflict":
    case "ticket_consumed":
      return "The request has already been used.";
    case "rate_limited":
    case "node_rate_limited":
      return "Too many attempts. Wait briefly and try again.";
    case "enrollment_unavailable":
      return "The node enrollment is unavailable or expired.";
    case "node_offline":
      return "The selected node is offline.";
    case "server_draining":
      return "Hub is temporarily draining relay connections.";
    case "unsupported_version":
      return "The selected node or Hub uses an incompatible relay version.";
    case "invalid_request":
      return "The response was malformed or expired.";
    case "browser_only_transport":
      return "This action is only available in a browser.";
    default:
      return "Hub is temporarily unavailable.";
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostedHubApiError("invalid_response", 502);
  }
  return value as Record<string, unknown>;
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value));
}

function roleValue(value: unknown): value is "viewer" | "operator" | "owner" {
  return value === "viewer" || value === "operator" || value === "owner";
}

function platformOsValue(value: unknown): value is "darwin" | "linux" | "windows" | "unknown" {
  return value === "darwin" || value === "linux" || value === "windows" || value === "unknown";
}

function platformArchValue(value: unknown): value is "arm64" | "x64" | "other" {
  return value === "arm64" || value === "x64" || value === "other";
}

/** The bounded native session token, or `null` when the value is not one. */
function bearerTokenValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_BEARER_TOKEN_LENGTH
    ? value
    : null;
}

/**
 * A recovery-code list, or `null` when the value is not one.
 *
 * Deliberately unbounded: this runs on the pre-existing sign-in, bootstrap,
 * invitation and restore paths, where the Hub's real code count and code length
 * are not known. A mis-guessed cap here would reject a legitimate response —
 * and on bootstrap that happens *after* the account already exists server-side,
 * stranding the user. Bounds belong on the newly added route only, where a
 * rejection costs nothing but a retry; see {@link boundedRecoveryCodesValue}.
 */
function recoveryCodesValue(value: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(value) || value.some((code) => typeof code !== "string")) return null;
  return value as ReadonlyArray<string>;
}

/** The bounded form required of the newly added recovery-code route. */
function boundedRecoveryCodesValue(value: unknown): ReadonlyArray<string> | null {
  const codes = recoveryCodesValue(value);
  if (!codes || codes.length === 0 || codes.length > MAX_RECOVERY_CODES) return null;
  return codes.some((code) => code.length === 0 || code.length > MAX_RECOVERY_CODE_LENGTH)
    ? null
    : codes;
}

/**
 * Project a Hub passkey record onto the bounded {@link HostedHubPasskey} view,
 * or `null` when it is not one. Only the known members are copied, so no
 * unexpected Hub metadata can reach a view model, and each is bounded or typed
 * independently: a member the Hub omits — or returns in a shape this client does
 * not recognise — becomes `null` rather than rejecting the whole record, so one
 * unfamiliar field cannot blank a list the user needs in order to revoke.
 *
 * Callers choose the strictness of the *identity* check: `listPasskeys` rejects
 * an entry with no usable id, while the add-passkey verify (whose body is not
 * required to describe the credential at all) tolerates its absence.
 */
function passkeyValue(value: unknown): HostedHubPasskey | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !CREDENTIAL_ID_PATTERN.test(record.id)) return null;
  return {
    id: record.id,
    label:
      typeof record.label === "string" && record.label.length <= MAX_PASSKEY_LABEL_LENGTH
        ? record.label
        : null,
    createdAt: nullableNumber(record.createdAt) ? record.createdAt : null,
    lastUsedAt: nullableNumber(record.lastUsedAt) ? record.lastUsedAt : null,
    backupEligible: typeof record.backupEligible === "boolean" ? record.backupEligible : null,
    backupState: typeof record.backupState === "boolean" ? record.backupState : null,
    revokedAt: nullableNumber(record.revokedAt) ? record.revokedAt : null,
    revocationReasonCode:
      typeof record.revocationReasonCode === "string" &&
      record.revocationReasonCode.length > 0 &&
      record.revocationReasonCode.length <= MAX_REVOCATION_REASON_LENGTH
        ? record.revocationReasonCode
        : null,
  };
}

/**
 * The optional fallback-session step-up code.
 *
 * A session minted from a password, a recovery code, or an email recovery link
 * must present a current TOTP code to change credentials wherever TOTP is
 * enrolled. A **passkey session ignores it entirely**, and the Hub — not this
 * client — is what decides which of those applies. The client's only job is to
 * pass a code through when the caller has one, and to never present a fallback
 * session as though it were equivalent to a passkey one.
 */
export interface HostedAccountStepUp {
  readonly totpCode?: string;
}

/**
 * The step-up member of a request body, or nothing.
 *
 * An absent or empty code omits the member rather than sending `""`: the Hub's
 * bodies are strict, an untouched input field is not a submitted code, and the
 * distinction is what lets the Hub answer "a code is required" instead of "that
 * code is wrong".
 */
function stepUpBody(input: HostedAccountStepUp | undefined): { readonly totpCode?: string } {
  const totpCode = input?.totpCode;
  return typeof totpCode === "string" && totpCode.length > 0 ? { totpCode } : {};
}

/** The bounded TOTP enrolment secret, or `null` when the value is not one. */
function totpSecretValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOTP_SECRET_LENGTH
    ? value
    : null;
}

/** The bounded `otpauth://` provisioning URI, or `null` when the value is not one. */
function totpProvisioningUriValue(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= MAX_TOTP_PROVISIONING_URI_LENGTH &&
    value.toLowerCase().startsWith(TOTP_PROVISIONING_URI_SCHEME)
    ? value
    : null;
}

async function responseJson(response: {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new HostedHubApiError("invalid_response", response.status);
  }
  const body = objectValue(parsed);
  if (!response.ok) {
    const retryAfterMs =
      typeof body.retryAfterMs === "number" &&
      Number.isSafeInteger(body.retryAfterMs) &&
      body.retryAfterMs >= 0 &&
      body.retryAfterMs <= 300_000
        ? body.retryAfterMs
        : undefined;
    throw new HostedHubApiError(
      typeof body.error === "string" ? body.error : "unavailable",
      response.status,
      retryAfterMs,
    );
  }
  return body;
}

export interface HostedHubApiDependencies {
  readonly endpoint: EndpointService;
  readonly httpClient: HttpClientService;
  readonly passkeyCeremony: PasskeyCeremonyService;
  readonly sessionCredentials: SessionCredentialsService;
  /** Required when `sessionCredentials.mode` is `"bearer"`; unused in cookie mode. */
  readonly dpopSigner?: DpopSignerService;
}

export class HostedHubApi {
  readonly #endpoint: EndpointService;
  readonly #httpClient: HttpClientService;
  readonly #passkeyCeremony: PasskeyCeremonyService;
  readonly #sessionCredentials: SessionCredentialsService;
  readonly #dpopSigner: DpopSignerService | undefined;

  constructor(dependencies: HostedHubApiDependencies) {
    this.#endpoint = dependencies.endpoint;
    this.#httpClient = dependencies.httpClient;
    this.#passkeyCeremony = dependencies.passkeyCeremony;
    this.#sessionCredentials = dependencies.sessionCredentials;
    this.#dpopSigner = dependencies.dpopSigner;
    if (this.#sessionCredentials.mode === "bearer") {
      // Fail closed: a bearer (native) session cannot be presented without a
      // DPoP signer and a token holder, so a misconfigured adapter must not
      // silently fall back to an unauthenticated or cross-transport request.
      if (
        !this.#dpopSigner ||
        !this.#sessionCredentials.readBearerToken ||
        !this.#sessionCredentials.writeBearerToken
      ) {
        throw new Error(
          "Bearer session credentials require a DPoP signer and a bearer-token holder.",
        );
      }
    }
  }

  get #isBearer(): boolean {
    return this.#sessionCredentials.mode === "bearer";
  }

  #readBearerToken(): string | null {
    return this.#sessionCredentials.readBearerToken?.() ?? null;
  }

  #writeBearerToken(token: string | null): void {
    this.#sessionCredentials.writeBearerToken?.(token);
  }

  get hasSessionMaterial(): boolean {
    return this.#isBearer
      ? this.#readBearerToken() !== null
      : this.#sessionCredentials.readCsrfToken() !== null;
  }

  clearSessionMaterial(): void {
    if (this.#isBearer) this.#writeBearerToken(null);
    else this.#sessionCredentials.writeCsrfToken(null);
  }

  async getBootstrapAvailability(signal?: AbortSignal): Promise<boolean> {
    const result = await this.#request("/api/auth/bootstrap-status", {
      dpop: "mint",
      ...(signal ? { signal } : {}),
    });
    if (Object.keys(result).length !== 1 || typeof result.available !== "boolean") {
      throw new HostedHubApiError("invalid_response", 502);
    }
    return result.available;
  }

  async restoreSession(signal?: AbortSignal): Promise<HostedHubSessionResponse> {
    const value = await this.#request("/api/auth/session", signal ? { signal } : {});
    if (this.#isBearer) return this.#restoreNativeSession(value);
    const result = this.#sessionResponse(value);
    this.#sessionCredentials.writeCsrfToken(result.csrfToken);
    return result;
  }

  async signIn(signal?: AbortSignal): Promise<HostedHubSessionResponse> {
    const base = this.#isBearer ? "/api/auth/native/passkey" : "/api/auth/passkey";
    const options = await this.#request(`${base}/options`, {
      method: "POST",
      body: {},
      dpop: "mint",
      ...(signal ? { signal } : {}),
    });
    const response = await this.#passkeyCeremony.authenticate(
      validatePasskeyAuthenticationOptions(options.options),
      signal,
    );
    return this.#finishLogin(
      await this.#request(`${base}/verify`, {
        method: "POST",
        body: { response },
        dpop: "mint",
        ...(signal ? { signal } : {}),
      }),
    );
  }

  async redeemInvitation(
    input: {
      readonly secret: string;
      readonly displayName: string;
      readonly passkeyLabel: string | null;
    },
    signal?: AbortSignal,
  ): Promise<HostedHubSessionResponse> {
    const base = this.#isBearer
      ? "/api/auth/native/invitations/registration"
      : "/api/auth/invitations/registration";
    return this.#registerPasskey(`${base}/options`, `${base}/verify`, input, {
      authenticated: false,
      ...(signal ? { signal } : {}),
      finish: (value) => this.#finishLogin(value),
    });
  }

  async bootstrapOwner(
    input: {
      readonly credential: string;
      readonly displayName: string;
      readonly passkeyLabel: string | null;
    },
    signal?: AbortSignal,
  ): Promise<HostedHubSessionResponse> {
    const base = this.#isBearer
      ? "/api/auth/native/bootstrap/registration"
      : "/api/auth/bootstrap/registration";
    return this.#registerPasskey(`${base}/options`, `${base}/verify`, input, {
      authenticated: false,
      ...(signal ? { signal } : {}),
      finish: (value) => this.#finishLogin(value),
    });
  }

  /**
   * List the passkeys registered against the signed-in account.
   *
   * `GET /api/account/passkeys` → `{ passkeys: [...] }`. Each record
   * is projected through {@link passkeyValue}, so an unexpected member can never
   * reach a view model, and the list itself is bounded.
   *
   * A revoked credential is **not** filtered out here: the Hub reports
   * `revokedAt` / `revocationReasonCode` and the surface needs them to explain
   * why a device the user remembers enrolling no longer works. Deciding what to
   * show is the caller's; hiding evidence of a revocation is not this client's
   * to do.
   */
  async listPasskeys(signal?: AbortSignal): Promise<ReadonlyArray<HostedHubPasskey>> {
    const result = await this.#request("/api/account/passkeys", signal ? { signal } : {});
    if (!Array.isArray(result.passkeys) || result.passkeys.length > MAX_PASSKEYS) {
      throw new HostedHubApiError("invalid_response", 502);
    }
    return result.passkeys.map((value) => {
      const passkey = passkeyValue(value);
      if (!passkey) throw new HostedHubApiError("invalid_response", 502);
      return passkey;
    });
  }

  /**
   * Register an additional passkey on the *already signed-in* account — the
   * "add this device" ceremony. Runs on the existing session (CSRF in cookie
   * mode, `Authorization: DPoP` + an `ath`-bound proof in bearer mode) rather
   * than the pre-session mint used by bootstrap and invitation redemption.
   *
   * `confirmed` reports whether the Hub's verify response positively described
   * the new credential. A non-2xx verify throws, so a resolved call means the
   * Hub accepted the ceremony — but `confirmed: false` means it returned no
   * evidence of what it enrolled, and the caller must confirm against a fresh
   * {@link listPasskeys} read rather than report success on the strength of the
   * ceremony alone.
   *
   * `totpCode` is the optional fallback-session step-up (see
   * {@link HostedAccountStepUp}); it rides the *verify* call only, never the
   * options call, and is omitted entirely when absent.
   */
  async addPasskey(
    input: { readonly passkeyLabel: string | null } & HostedAccountStepUp,
    signal?: AbortSignal,
  ): Promise<HostedAddPasskeyResult> {
    return this.#registerPasskey(
      "/api/account/passkeys/registration/options",
      "/api/account/passkeys/registration/verify",
      { passkeyLabel: input.passkeyLabel },
      {
        authenticated: true,
        verifyExtra: stepUpBody(input),
        ...(signal ? { signal } : {}),
        finish: (value) => this.#finishAddPasskey(value),
      },
    );
  }

  /**
   * **Rotate** the account's recovery codes and return the new set.
   *
   * This is a mutation, not a read. `/api/account/recovery-codes` is confirmed
   * registered and confirmed to reject `GET` (405), so the client issues
   * `POST`; the approved spec calls the capability "fetch/regenerate"; and the
   * `recoveryCodes` member matches the one the *registration verify* responses
   * carry, which are freshly minted codes. Every one of those points to a
   * regenerate, and the Hub's true semantics cannot be settled from outside an
   * authenticated session — so the client takes the mutating reading, which is
   * the only safe one on a recovery surface.
   *
   * Callers must treat this as **invalidating any codes the user previously
   * saved**: run it only from an explicit, confirmed user action, never on
   * mount, focus, retry, or reconnect.
   *
   * It is confirmed reachable over the bearer transport: a bare `POST` is
   * refused by the browser-origin gate (403), while the same `POST` carrying an
   * `Authorization: DPoP` header reaches authentication instead (401).
   *
   * The codes are returned to the caller and never persisted, logged, or placed
   * in an error by this client. Showing them once is the caller's contract; the
   * runtime does not and cannot enforce it.
   */
  async regenerateRecoveryCodes(
    input?: HostedAccountStepUp,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<string>> {
    const result = await this.#request("/api/account/recovery-codes", {
      method: "POST",
      body: stepUpBody(input),
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    const recoveryCodes = boundedRecoveryCodesValue(result.recoveryCodes);
    if (!recoveryCodes) throw new HostedHubApiError("invalid_response", 502);
    return recoveryCodes;
  }

  /**
   * Set (or replace) the account's fallback password.
   *
   * `POST /api/account/password` → `{ ok: true }`. A password is a **fallback**
   * credential: it is strictly weaker than a passkey, and no surface built on
   * this may present the two as equivalent.
   *
   * The password is sent once, in the request body, and is never persisted,
   * logged, echoed into an error, or placed in a URL by this client.
   */
  async setPassword(
    input: { readonly password: string } & HostedAccountStepUp,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#acknowledgedMutation(
      "/api/account/password",
      { password: input.password, ...stepUpBody(input) },
      signal,
    );
  }

  /**
   * Remove the account's fallback password, leaving the stronger credentials in
   * place. `POST /api/account/password/remove` → `{ ok: true }`.
   */
  async removePassword(input?: HostedAccountStepUp, signal?: AbortSignal): Promise<void> {
    await this.#acknowledgedMutation("/api/account/password/remove", stepUpBody(input), signal);
  }

  /**
   * Begin TOTP enrolment and return the secret to display once.
   *
   * `POST /api/account/totp/enrollment/options` → `{ secretBase32,
   * provisioningUri }`. **Both members are secret key material** — the base32
   * secret *is* the shared key and the provisioning URI embeds it. They are
   * returned to the caller for the enrolment screen and nothing else: this
   * client never logs, persists, or places either in an error, and a caller must
   * hold them in memory only and drop them the moment the screen is dismissed.
   *
   * Enrolment itself requires a passkey-authenticated session; the Hub enforces
   * that, and this method carries no step-up code because there is no fallback
   * path to step up from.
   */
  async beginTotpEnrollment(signal?: AbortSignal): Promise<HostedTotpEnrollment> {
    const result = await this.#request("/api/account/totp/enrollment/options", {
      method: "POST",
      body: {},
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    const secretBase32 = totpSecretValue(result.secretBase32);
    const provisioningUri = totpProvisioningUriValue(result.provisioningUri);
    if (!secretBase32 || !provisioningUri) throw new HostedHubApiError("invalid_response", 502);
    return { secretBase32, provisioningUri };
  }

  /**
   * Confirm TOTP enrolment with a code from the authenticator app.
   * `POST /api/account/totp/enrollment/verify` → `{ ok: true }`.
   *
   * `code` is the enrolment proof, not a step-up: it is required, and it is a
   * distinct member from the optional `totpCode` the fallback-session step-up
   * uses elsewhere.
   */
  async confirmTotpEnrollment(
    input: { readonly code: string },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#acknowledgedMutation(
      "/api/account/totp/enrollment/verify",
      { code: input.code },
      signal,
    );
  }

  /** Remove TOTP from the account. `POST /api/account/totp/revoke` → `{ ok: true }`. */
  async revokeTotp(input?: HostedAccountStepUp, signal?: AbortSignal): Promise<void> {
    await this.#acknowledgedMutation("/api/account/totp/revoke", stepUpBody(input), signal);
  }

  /**
   * Ask the Hub to send a verification mail for an address.
   * `POST /api/account/email/verification` → `{ ok: true }` (202).
   *
   * The 202 is deliberate and uniform: a caller learns that the request was
   * accepted, never whether an address is known. Confirming the mailed token is
   * a browser-transport login route and is not part of this surface.
   */
  async requestEmailVerification(
    input: { readonly email: string } & HostedAccountStepUp,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#acknowledgedMutation(
      "/api/account/email/verification",
      { email: input.email, ...stepUpBody(input) },
      signal,
    );
  }

  /**
   * Revoke one of the account's passkeys.
   * `POST /api/account/passkeys/{id}/revoke` → `{ ok: true }`.
   *
   * This is the only account path this client builds by interpolation, so the
   * id is validated against {@link PASSKEY_CREDENTIAL_ID_PATTERN} **before a URL
   * exists** and the call fails closed — no request, no proof minted, no session
   * material touched — on anything that does not match. Validating here rather
   * than trusting the looser list projection means an id that reached a view
   * model through a malformed response still cannot be interpolated into a path.
   *
   * Revoking the credential the current session was minted from is a decision
   * for the caller and the Hub, not something this client second-guesses; the
   * caller should re-read {@link listPasskeys} afterwards, since a revoke
   * changes the list.
   */
  async revokePasskey(credentialId: string, signal?: AbortSignal): Promise<void> {
    if (!PASSKEY_CREDENTIAL_ID_PATTERN.test(credentialId)) {
      throw new HostedHubApiError("invalid_request", 400);
    }
    await this.#acknowledgedMutation(`/api/account/passkeys/${credentialId}/revoke`, {}, signal);
  }

  /**
   * A session-authenticated account mutation whose entire success contract is
   * `{ ok: true }`. Validated exactly, so a body carrying anything else — an
   * error the Hub returned with a 2xx, or session material this route has no
   * business handing over — is a malformed response rather than a success.
   */
  async #acknowledgedMutation(
    pathname: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.#request(pathname, {
      method: "POST",
      body,
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    if (Object.keys(result).length !== 1 || result.ok !== true) {
      throw new HostedHubApiError("invalid_response", 502);
    }
  }

  async #registerPasskey<T>(
    optionsPath: string,
    verifyPath: string,
    input: unknown,
    options: {
      /**
       * `true` when the ceremony runs on an existing session (add-passkey):
       * cookie mode presents the session CSRF token and bearer mode presents
       * `Authorization: DPoP` plus an `ath`-bound proof. `false` is the
       * pre-session mint ceremony used by bootstrap and invitation redemption.
       */
      readonly authenticated: boolean;
      /**
       * Extra members merged into the *verify* body only. The pre-session mint
       * ceremonies pass nothing: their Hub bodies are strict `{ response }`, so
       * an unexpected member would be rejected outright.
       */
      readonly verifyExtra?: Record<string, unknown>;
      readonly signal?: AbortSignal;
      readonly finish: (value: Record<string, unknown>) => T;
    },
  ): Promise<T> {
    const transport = {
      csrf: options.authenticated,
      ...(options.authenticated ? {} : { dpop: "mint" as const }),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const challenge = await this.#request(optionsPath, {
      method: "POST",
      body: input,
      ...transport,
    });
    const response = await this.#passkeyCeremony.register(
      validatePasskeyRegistrationOptions(challenge.options),
      options.signal,
    );
    return options.finish(
      await this.#request(verifyPath, {
        method: "POST",
        body: { response, ...options.verifyExtra },
        ...transport,
      }),
    );
  }

  /**
   * Persist the session material returned by a login/registration verify and
   * return the account/session view. Cookie mode stores the CSRF token; bearer
   * mode stores the native token behind the session-credentials seam and never
   * surfaces it (or a proof) in the returned value.
   */
  #finishLogin(value: Record<string, unknown>): HostedHubSessionResponse {
    if (this.#isBearer) {
      const { response, token } = this.#nativeSessionResponse(value);
      this.#writeBearerToken(token);
      return response;
    }
    const result = this.#sessionResponse(value);
    this.#sessionCredentials.writeCsrfToken(result.csrfToken);
    return result;
  }

  #restoreNativeSession(value: Record<string, unknown>): HostedHubSessionResponse {
    const response = this.#accountAndSession(value);
    // A native restore may rotate the token; persist a fresh one if present,
    // otherwise the existing enclave-bound token stays in force.
    const token = bearerTokenValue(value.token);
    if (token) this.#writeBearerToken(token);
    return response;
  }

  /**
   * Complete an add-passkey ceremony on an already-authenticated session.
   *
   * Unlike bootstrap and invitation registration this must **not** mint a
   * session, and — on either transport — it **adopts no session material at
   * all**. It is never demanded, never cleared, and never rotated:
   *
   * - Demanding it (what `#finishLogin` does, via `#nativeSessionResponse` /
   *   `#sessionResponse`) would reject a valid Hub response as
   *   `invalid_response` and report a successful enrolment as a failure.
   * - Clearing it would sign the user out for adding a credential.
   * - **Rotating it would be worse than either.** The only verified way this
   *   client learns session material is a complete, *validated* account/session
   *   response — which is exactly what `restoreSession` and the login/register
   *   verifies deliver, and what this route's body is not required to contain.
   *   A bare `token` or `csrfToken` member here is part of no contract observed
   *   on this route, and a length bound does not make an unverified value
   *   correct: adopting a well-formed but wrong one replaces working session
   *   material and every later authenticated call fails — 401 in bearer mode,
   *   which `isSessionFailure` matches and which would expire a session that
   *   was perfectly valid a moment ago; 403 in cookie mode, which it does not
   *   match, wedging the session until a reload. Both are self-inflicted, and
   *   neither is diagnosable from the surface.
   *
   * Not adopting costs nothing in the case the Hub genuinely does rotate: the
   * next `restoreSession` re-establishes the correct material through the
   * validated path, and until then the failure is the Hub's own bounded error
   * rather than one this client manufactured.
   *
   * No token and no CSRF value is read or returned; the caller only ever sees
   * the bounded passkey view.
   */
  #finishAddPasskey(value: Record<string, unknown>): HostedAddPasskeyResult {
    const passkey = passkeyValue(value.passkey);
    return { passkey, confirmed: passkey !== null };
  }

  async signOut(signal?: AbortSignal): Promise<void> {
    await this.#request("/api/auth/logout", {
      method: "POST",
      body: {},
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    this.clearSessionMaterial();
  }

  async listNodes(signal?: AbortSignal): Promise<ReadonlyArray<HostedHubNode>> {
    const result = await this.#request("/api/nodes", signal ? { signal } : {});
    if (!Array.isArray(result.nodes)) throw new HostedHubApiError("invalid_response", 502);
    return result.nodes.map((value) => {
      const node = objectValue(value);
      const grant = objectValue(node.grant);
      const presence = objectValue(node.presence);
      if (
        typeof node.id !== "string" ||
        typeof node.environmentId !== "string" ||
        typeof node.label !== "string" ||
        !platformOsValue(node.platformOs) ||
        !platformArchValue(node.platformArch) ||
        typeof node.clientVersion !== "string" ||
        !nullableNumber(node.createdAt) ||
        node.createdAt === null ||
        !nullableNumber(node.updatedAt) ||
        node.updatedAt === null ||
        !nullableNumber(node.lastAuthenticatedAt) ||
        !nullableNumber(node.revokedAt) ||
        (node.revocationReasonCode !== null && typeof node.revocationReasonCode !== "string") ||
        typeof grant.id !== "string" ||
        !roleValue(grant.role) ||
        !roleValue(node.effectiveRole) ||
        typeof presence.online !== "boolean" ||
        !nullableNumber(presence.lastHeartbeatAt)
      ) {
        throw new HostedHubApiError("invalid_response", 502);
      }
      return {
        id: node.id,
        environmentId: EnvironmentId.make(node.environmentId),
        label: node.label,
        platformOs: node.platformOs,
        platformArch: node.platformArch,
        clientVersion: node.clientVersion,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        lastAuthenticatedAt: node.lastAuthenticatedAt,
        revokedAt: node.revokedAt,
        revocationReasonCode: node.revocationReasonCode,
        grant: { id: grant.id, role: grant.role },
        effectiveRole: node.effectiveRole,
        presence: {
          online: presence.online,
          lastHeartbeatAt: presence.lastHeartbeatAt,
        },
      } as unknown as HostedHubNode;
    });
  }

  async lookupNodeEnrollment(
    deviceCode: string,
    signal?: AbortSignal,
  ): Promise<HostedNodeEnrollment> {
    const result = await this.#request("/api/admin/node-enrollments/lookup", {
      method: "POST",
      body: { deviceCode },
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    const enrollment = objectValue(result.enrollment);
    if (
      typeof enrollment.id !== "string" ||
      !/^enr_[A-Za-z0-9_-]{22}$/.test(enrollment.id) ||
      typeof enrollment.label !== "string" ||
      enrollment.label.length < 1 ||
      enrollment.label.length > 100 ||
      !platformOsValue(enrollment.platformOs) ||
      !platformArchValue(enrollment.platformArch) ||
      typeof enrollment.clientVersion !== "string" ||
      enrollment.clientVersion.length < 1 ||
      enrollment.clientVersion.length > 64 ||
      enrollment.algorithm !== "ed25519" ||
      typeof enrollment.fingerprint !== "string" ||
      !/^SHA256:[A-Za-z0-9_-]{43}$/.test(enrollment.fingerprint) ||
      !Number.isSafeInteger(enrollment.createdAt) ||
      !Number.isSafeInteger(enrollment.expiresAt) ||
      Number(enrollment.expiresAt) <= Number(enrollment.createdAt)
    ) {
      throw new HostedHubApiError("invalid_response", 502);
    }
    return {
      id: enrollment.id,
      label: enrollment.label,
      platformOs: enrollment.platformOs,
      platformArch: enrollment.platformArch,
      clientVersion: enrollment.clientVersion,
      algorithm: enrollment.algorithm,
      fingerprint: enrollment.fingerprint,
      createdAt: enrollment.createdAt as number,
      expiresAt: enrollment.expiresAt as number,
    };
  }

  async approveNodeEnrollment(deviceCode: string, signal?: AbortSignal): Promise<void> {
    const result = await this.#request("/api/admin/node-enrollments/approve", {
      method: "POST",
      body: { deviceCode },
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    const node = objectValue(result.node);
    const grant = objectValue(result.grant);
    if (
      typeof node.id !== "string" ||
      !/^node_[A-Za-z0-9_-]{22,43}$/.test(node.id) ||
      typeof node.environmentId !== "string" ||
      !/^env_[A-Za-z0-9_-]{22}$/.test(node.environmentId) ||
      typeof grant.id !== "string" ||
      !/^grant_[A-Za-z0-9_-]{22}$/.test(grant.id) ||
      grant.role !== "owner"
    ) {
      throw new HostedHubApiError("invalid_response", 502);
    }
  }

  async denyNodeEnrollment(deviceCode: string, signal?: AbortSignal): Promise<void> {
    const result = await this.#request("/api/admin/node-enrollments/deny", {
      method: "POST",
      body: { deviceCode },
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    if (Object.keys(result).length !== 1 || result.ok !== true) {
      throw new HostedHubApiError("invalid_response", 502);
    }
  }

  async issueRelayTicket(nodeId: string, signal?: AbortSignal): Promise<HostedRelayTicket> {
    const result = await this.#request("/api/relay/tickets", {
      method: "POST",
      body: { nodeId, capability: "ryco.rpc", protocolMajor: 1, protocolMinor: 2 },
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    if (
      typeof result.ticket !== "string" ||
      !Number.isSafeInteger(result.expiresAt) ||
      result.protocolMajor !== 1 ||
      result.protocolMinor !== 2
    ) {
      throw new HostedHubApiError("invalid_response", 502);
    }
    return {
      ticket: result.ticket,
      expiresAt: result.expiresAt,
      protocolMajor: 1,
      protocolMinor: 2,
    } as HostedRelayTicket;
  }

  /**
   * Validate the account/session (and optional recovery codes) common to both
   * transports. Returns a bounded {@link HostedHubSessionResponse} with no
   * transport material attached.
   */
  #accountAndSession(value: Record<string, unknown>): HostedHubSessionResponse {
    const account = objectValue(value.account);
    const session = objectValue(value.session);
    const recoveryCodes =
      value.recoveryCodes === undefined ? undefined : recoveryCodesValue(value.recoveryCodes);
    if (
      typeof account.id !== "string" ||
      typeof account.displayName !== "string" ||
      !roleValue(account.role) ||
      !Number.isSafeInteger(account.createdAt) ||
      !nullableNumber(account.disabledAt) ||
      typeof session.id !== "string" ||
      typeof session.accountId !== "string" ||
      !Number.isSafeInteger(session.createdAt) ||
      !Number.isSafeInteger(session.expiresAt) ||
      !Number.isSafeInteger(session.lastSeenAt) ||
      !nullableNumber(session.revokedAt) ||
      (session.revocationReasonCode !== null && typeof session.revocationReasonCode !== "string") ||
      recoveryCodes === null
    ) {
      throw new HostedHubApiError("invalid_response", 502);
    }
    if (
      account.disabledAt !== null ||
      session.revokedAt !== null ||
      session.accountId !== account.id
    ) {
      throw new HostedHubApiError("session_invalid", 401);
    }
    return {
      account: {
        id: account.id,
        displayName: account.displayName,
        role: account.role,
        createdAt: account.createdAt,
        disabledAt: account.disabledAt,
      },
      session: {
        id: session.id,
        accountId: session.accountId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
        revokedAt: session.revokedAt,
        revocationReasonCode: session.revocationReasonCode,
      },
      ...(recoveryCodes === undefined ? {} : { recoveryCodes }),
    } as HostedHubSessionResponse;
  }

  #sessionResponse(
    value: Record<string, unknown>,
  ): HostedHubSessionResponse & { readonly csrfToken: string } {
    // Reject a malformed CSRF token before the account/session check; both an
    // invalid token and invalid account/session yield `invalid_response`, and
    // the only `session_invalid` path (disabled/revoked) is reached only once
    // both pass — so this preserves the exact error codes of the prior combined
    // validation.
    if (typeof value.csrfToken !== "string" || value.csrfToken.length === 0) {
      throw new HostedHubApiError("invalid_response", 502);
    }
    return { ...this.#accountAndSession(value), csrfToken: value.csrfToken };
  }

  #nativeSessionResponse(value: Record<string, unknown>): {
    readonly response: HostedHubSessionResponse;
    readonly token: string;
  } {
    const token = bearerTokenValue(value.token);
    if (!token) throw new HostedHubApiError("invalid_response", 502);
    return { response: this.#accountAndSession(value), token };
  }

  async #request(
    pathname: string,
    options: {
      readonly method?: "GET" | "POST";
      readonly body?: unknown;
      readonly csrf?: boolean;
      /** Bearer mode only: `"mint"` = login/public (no token, proof without `ath`). */
      readonly dpop?: "mint" | "session";
      readonly signal?: AbortSignal;
    },
  ): Promise<Record<string, unknown>> {
    const url = new URL(pathname, this.#endpoint.origin());
    // Every path this runtime issues is a literal with no percent-encoding, so
    // an encoded pathname is never legitimate — and an encoded separator would
    // otherwise let a path slip past the browser-only guard below.
    if (
      url.origin !== this.#endpoint.origin() ||
      url.search ||
      url.hash ||
      url.pathname.includes("%")
    ) {
      throw new HostedHubApiError("invalid_request", 400);
    }
    // Fail closed before any I/O — and before any passkey prompt — on routes the
    // Hub only serves to a browser transport. Reaching the wire here yields an
    // unexplained 404 the caller cannot act on.
    if (this.#isBearer && isBrowserOnlyPath(url.pathname)) {
      throw new HostedHubApiError("browser_only_transport", 400);
    }
    const method = options.method ?? "GET";
    const headers: Record<string, string> = { ...JSON_HEADERS };

    let target: string;
    let credentials: "include" | "omit" | "same-origin";
    if (this.#isBearer) {
      // Native/DPoP transport: no ambient cookie, no CSRF. Present
      // `Authorization: DPoP <token>` + a proof only on authenticated requests;
      // the mint/login ceremony (and the public status probe) carries a proof
      // without `ath` and no token.
      const signer = this.#dpopSigner;
      if (!signer) throw new HostedHubApiError("session_invalid", 401);
      const requestUrl = url.toString();
      let token: string | undefined;
      if (options.dpop !== "mint") {
        token = this.#readBearerToken() ?? undefined;
        if (!token) throw new HostedHubApiError("session_invalid", 401);
      }
      headers["DPoP"] = await signer.sign({ method, url: requestUrl, ...(token ? { token } : {}) });
      if (token) headers["Authorization"] = `DPoP ${token}`;
      target = requestUrl;
      credentials = "omit";
    } else {
      if (options.csrf) {
        const csrfToken = this.#sessionCredentials.readCsrfToken();
        if (!csrfToken) throw new HostedHubApiError("session_invalid", 401);
        headers["X-Ryco-CSRF"] = csrfToken;
      }
      target = url.pathname;
      credentials = "same-origin";
    }

    let response: Awaited<ReturnType<HttpClientService["fetch"]>>;
    try {
      response = await this.#httpClient.fetch(target, {
        method,
        credentials,
        cache: "no-store",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      )
        throw error;
      throw new HostedHubApiError("unavailable", 0);
    }
    return responseJson(response);
  }
}
