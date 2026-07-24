import { EnvironmentId } from "@ryco/contracts";

import type {
  DpopSignerService,
  EndpointService,
  HttpClientService,
  PasskeyCeremonyService,
  SessionCredentialsService,
} from "../platform/index.ts";

import type {
  HostedHubNode,
  HostedHubPasskey,
  HostedHubSessionResponse,
  HostedNodeEnrollment,
  HostedRelayTicket,
} from "./types.ts";
import {
  validatePasskeyAuthenticationOptions,
  validatePasskeyRegistrationOptions,
} from "../relay/webauthn.ts";

const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" } as const;

const MAX_BEARER_TOKEN_LENGTH = 4096;
const MAX_RECOVERY_CODES = 64;
const MAX_RECOVERY_CODE_LENGTH = 128;
const MAX_PASSKEY_LABEL_LENGTH = 256;

/**
 * WebAuthn credential ids are base64url. Constraining them here keeps a
 * credential id from ever widening a request path (no `/`, `.`, `?` or `#`
 * survives this test) and bounds what a malformed Hub response can project.
 */
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

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

function isBrowserOnlyPath(pathname: string): boolean {
  return BROWSER_ONLY_BEARER_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
 * A bounded recovery-code list, or `null` when the value is not one. Recovery
 * codes are the one deliberate secret-material exception in this client: they
 * are returned for a single display and are never persisted here.
 */
function recoveryCodesValue(value: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(value) || value.length > MAX_RECOVERY_CODES) return null;
  for (const code of value) {
    if (typeof code !== "string" || code.length === 0 || code.length > MAX_RECOVERY_CODE_LENGTH) {
      return null;
    }
  }
  return value as ReadonlyArray<string>;
}

/**
 * Project a Hub passkey record onto the bounded {@link HostedHubPasskey} view,
 * or `null` when it is not one. Only the four known members are copied, so no
 * unexpected Hub metadata can reach a view model. Callers choose the strictness:
 * `listPasskeys` rejects a malformed entry, while the add-passkey verify (whose
 * body shape is not part of the observed contract) tolerates its absence.
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
  };
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
   * `GET /api/account/passkeys` is confirmed registered (it answers 401 without
   * a session). The response member name and record shape are inferred by
   * symmetry with `/api/nodes` → `{ nodes: [...] }` and are projected through
   * {@link passkeyValue}, so an unexpected member can never reach a view model.
   */
  async listPasskeys(signal?: AbortSignal): Promise<ReadonlyArray<HostedHubPasskey>> {
    const result = await this.#request("/api/account/passkeys", signal ? { signal } : {});
    if (!Array.isArray(result.passkeys)) throw new HostedHubApiError("invalid_response", 502);
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
   */
  async addPasskey(
    input: { readonly passkeyLabel: string | null },
    signal?: AbortSignal,
  ): Promise<HostedHubPasskey | null> {
    return this.#registerPasskey(
      "/api/account/passkeys/registration/options",
      "/api/account/passkeys/registration/verify",
      input,
      {
        authenticated: true,
        ...(signal ? { signal } : {}),
        finish: (value) => this.#finishAddPasskey(value),
      },
    );
  }

  /**
   * Revoke one of the account's passkeys.
   *
   * The revoke shape is **not** part of the observed contract; `DELETE` on the
   * collection member is the least surprising reading of a registered
   * `/api/account/passkeys` collection, so that is what this issues. The
   * credential id is validated against {@link CREDENTIAL_ID_PATTERN} before it
   * is placed in the path, so a malformed id fails closed without reaching the
   * wire. The response body is deliberately not projected.
   */
  async revokePasskey(credentialId: string, signal?: AbortSignal): Promise<void> {
    if (!CREDENTIAL_ID_PATTERN.test(credentialId)) {
      throw new HostedHubApiError("invalid_request", 400);
    }
    await this.#request(`/api/account/passkeys/${encodeURIComponent(credentialId)}`, {
      method: "DELETE",
      csrf: true,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Fetch the account's recovery codes for a single display.
   *
   * `/api/account/recovery-codes` is confirmed registered and rejects `GET`
   * (405), so the client issues `POST`. The `recoveryCodes: string[]` member is
   * the shape the verify responses already use. The codes are returned to the
   * caller and never persisted, logged, or placed in an error by this client.
   */
  async getRecoveryCodes(signal?: AbortSignal): Promise<ReadonlyArray<string>> {
    const result = await this.#request("/api/account/recovery-codes", {
      method: "POST",
      body: {},
      csrf: true,
      ...(signal ? { signal } : {}),
    });
    const recoveryCodes = recoveryCodesValue(result.recoveryCodes);
    if (!recoveryCodes || recoveryCodes.length === 0) {
      throw new HostedHubApiError("invalid_response", 502);
    }
    return recoveryCodes;
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
        body: { response },
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
   * session. The caller is already signed in, and the Hub's verify response is
   * not required to carry session material, so session material is only
   * *rotated* here — never demanded, never cleared:
   *
   * - Demanding it (what `#finishLogin` does, via `#nativeSessionResponse` /
   *   `#sessionResponse`) would reject a valid Hub response as
   *   `invalid_response` and report a successful enrolment as a failure.
   * - Clearing it would sign the user out for adding a credential.
   * - Ignoring a token the Hub *did* return would leave the client presenting a
   *   token the Hub has rotated away from, so a well-formed one is persisted —
   *   the same rotation-tolerant contract as `#restoreNativeSession`.
   *
   * Neither the token nor the CSRF token is returned; the caller only ever sees
   * the bounded passkey view.
   */
  #finishAddPasskey(value: Record<string, unknown>): HostedHubPasskey | null {
    if (this.#isBearer) {
      const token = bearerTokenValue(value.token);
      if (token) this.#writeBearerToken(token);
    } else if (typeof value.csrfToken === "string" && value.csrfToken.length > 0) {
      this.#sessionCredentials.writeCsrfToken(value.csrfToken);
    }
    return passkeyValue(value.passkey);
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
      readonly method?: "GET" | "POST" | "DELETE";
      readonly body?: unknown;
      readonly csrf?: boolean;
      /** Bearer mode only: `"mint"` = login/public (no token, proof without `ath`). */
      readonly dpop?: "mint" | "session";
      readonly signal?: AbortSignal;
    },
  ): Promise<Record<string, unknown>> {
    const url = new URL(pathname, this.#endpoint.origin());
    if (url.origin !== this.#endpoint.origin() || url.search || url.hash) {
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
    // A successful 204 carries no body by definition. Every caller validates the
    // record it gets back, so an empty record is rejected by exactly the checks
    // that reject a malformed body today; only callers that project nothing
    // (`revokePasskey`) accept it.
    if (response.ok && response.status === 204) return {};
    return responseJson(response);
  }
}
