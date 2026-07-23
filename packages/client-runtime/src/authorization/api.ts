import { EnvironmentId } from "@ryco/contracts";

import type {
  EndpointService,
  HttpClientService,
  PasskeyCeremonyService,
  SessionCredentialsService,
} from "../platform/index.ts";

import type {
  HostedHubNode,
  HostedHubSessionResponse,
  HostedNodeEnrollment,
  HostedRelayTicket,
} from "./types.ts";
import {
  validatePasskeyAuthenticationOptions,
  validatePasskeyRegistrationOptions,
} from "../relay/webauthn.ts";

const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" } as const;

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
}

export class HostedHubApi {
  readonly #endpoint: EndpointService;
  readonly #httpClient: HttpClientService;
  readonly #passkeyCeremony: PasskeyCeremonyService;
  readonly #sessionCredentials: SessionCredentialsService;

  constructor(dependencies: HostedHubApiDependencies) {
    this.#endpoint = dependencies.endpoint;
    this.#httpClient = dependencies.httpClient;
    this.#passkeyCeremony = dependencies.passkeyCeremony;
    this.#sessionCredentials = dependencies.sessionCredentials;
  }

  get hasSessionMaterial(): boolean {
    return this.#sessionCredentials.readCsrfToken() !== null;
  }

  clearSessionMaterial(): void {
    this.#sessionCredentials.writeCsrfToken(null);
  }

  async getBootstrapAvailability(signal?: AbortSignal): Promise<boolean> {
    const result = await this.#request("/api/auth/bootstrap-status", signal ? { signal } : {});
    if (Object.keys(result).length !== 1 || typeof result.available !== "boolean") {
      throw new HostedHubApiError("invalid_response", 502);
    }
    return result.available;
  }

  async restoreSession(signal?: AbortSignal): Promise<HostedHubSessionResponse> {
    const result = this.#sessionResponse(
      await this.#request("/api/auth/session", signal ? { signal } : {}),
    );
    this.#sessionCredentials.writeCsrfToken(result.csrfToken);
    return result;
  }

  async signIn(signal?: AbortSignal): Promise<HostedHubSessionResponse> {
    const options = await this.#request("/api/auth/passkey/options", {
      method: "POST",
      body: {},
      ...(signal ? { signal } : {}),
    });
    const response = await this.#passkeyCeremony.authenticate(
      validatePasskeyAuthenticationOptions(options.options),
      signal,
    );
    const result = this.#sessionResponse(
      await this.#request("/api/auth/passkey/verify", {
        method: "POST",
        body: { response },
        ...(signal ? { signal } : {}),
      }),
    );
    this.#sessionCredentials.writeCsrfToken(result.csrfToken);
    return result;
  }

  async redeemInvitation(
    input: {
      readonly secret: string;
      readonly displayName: string;
      readonly passkeyLabel: string | null;
    },
    signal?: AbortSignal,
  ): Promise<HostedHubSessionResponse> {
    return this.#registerPasskey(
      "/api/auth/invitations/registration/options",
      "/api/auth/invitations/registration/verify",
      input,
      signal,
    );
  }

  async bootstrapOwner(
    input: {
      readonly credential: string;
      readonly displayName: string;
      readonly passkeyLabel: string | null;
    },
    signal?: AbortSignal,
  ): Promise<HostedHubSessionResponse> {
    return this.#registerPasskey(
      "/api/auth/bootstrap/registration/options",
      "/api/auth/bootstrap/registration/verify",
      input,
      signal,
    );
  }

  async #registerPasskey(
    optionsPath: string,
    verifyPath: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<HostedHubSessionResponse> {
    const options = await this.#request(optionsPath, {
      method: "POST",
      body: input,
      ...(signal ? { signal } : {}),
    });
    const response = await this.#passkeyCeremony.register(
      validatePasskeyRegistrationOptions(options.options),
      signal,
    );
    const result = this.#sessionResponse(
      await this.#request(verifyPath, {
        method: "POST",
        body: { response },
        ...(signal ? { signal } : {}),
      }),
    );
    this.#sessionCredentials.writeCsrfToken(result.csrfToken);
    return result;
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

  #sessionResponse(value: Record<string, unknown>): HostedHubSessionResponse {
    const account = objectValue(value.account);
    const session = objectValue(value.session);
    const recoveryCodes = value.recoveryCodes;
    if (
      typeof value.csrfToken !== "string" ||
      value.csrfToken.length === 0 ||
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
      (recoveryCodes !== undefined &&
        (!Array.isArray(recoveryCodes) || recoveryCodes.some((code) => typeof code !== "string")))
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
      csrfToken: value.csrfToken,
      ...(recoveryCodes === undefined ? {} : { recoveryCodes }),
    } as HostedHubSessionResponse;
  }

  async #request(
    pathname: string,
    options: {
      readonly method?: "GET" | "POST";
      readonly body?: unknown;
      readonly csrf?: boolean;
      readonly signal?: AbortSignal;
    },
  ): Promise<Record<string, unknown>> {
    const url = new URL(pathname, this.#endpoint.origin());
    if (url.origin !== this.#endpoint.origin() || url.search || url.hash) {
      throw new HostedHubApiError("invalid_request", 400);
    }
    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (options.csrf) {
      const csrfToken = this.#sessionCredentials.readCsrfToken();
      if (!csrfToken) throw new HostedHubApiError("session_invalid", 401);
      headers["X-Ryco-CSRF"] = csrfToken;
    }
    let response: Awaited<ReturnType<HttpClientService["fetch"]>>;
    try {
      response = await this.#httpClient.fetch(url.pathname, {
        method: options.method ?? "GET",
        credentials: "same-origin",
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
