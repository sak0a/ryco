import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  DpopProofInput,
  DpopSignerService,
  EndpointService,
  HttpClientService,
  PasskeyCeremonyService,
  SessionCredentialsService,
} from "@ryco/client-runtime/platform";

import { HostedHubApi, HostedHubApiError } from "./api";
import { encodeBase64Url } from "../relay/base64url";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** In-memory CSRF holder mirroring the web `SessionCredentials` adapter. */
function inMemorySessionCredentials(): SessionCredentialsService {
  let csrfToken: string | null = null;
  return {
    mode: "cookie",
    readCsrfToken: () => csrfToken,
    writeCsrfToken: (token) => {
      csrfToken = token;
    },
  };
}

/** Mirrors the web `HttpClient` adapter: promotes plain headers to `Headers`. */
const fakeHttpClient: HttpClientService = {
  fetch: (url, init) =>
    init === undefined
      ? globalThis.fetch(url)
      : globalThis.fetch(url, {
          ...init,
          ...(init.headers && typeof init.headers === "object"
            ? { headers: new Headers(init.headers as Record<string, string>) }
            : {}),
        } as RequestInit),
};

/** The promoted `Headers` of a recorded request, without unsafe optional chaining. */
function headersOf(init: RequestInit | undefined): Headers {
  return init?.headers as Headers;
}

const fakeEndpoint: EndpointService = {
  origin: () => (globalThis.window as unknown as { location: { origin: string } }).location.origin,
  readPrimaryTarget: () => null,
  resolveHttpUrl: (pathname) => pathname,
  resolveWsUrl: (wsBaseUrl) => wsBaseUrl,
};

function createApi(passkeyCeremony?: Partial<PasskeyCeremonyService>): HostedHubApi {
  return new HostedHubApi({
    endpoint: fakeEndpoint,
    httpClient: fakeHttpClient,
    sessionCredentials: inMemorySessionCredentials(),
    passkeyCeremony: {
      authenticate: vi.fn(async () => ({ id: "authenticate-not-used" }) as never),
      register: vi.fn(async () => ({ id: "register-not-used" }) as never),
      ...passkeyCeremony,
    },
  });
}

const session = {
  account: {
    id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
    displayName: "Ada",
    role: "owner",
    createdAt: 1_752_710_400_000,
    disabledAt: null,
  },
  session: {
    id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
    accountId: "acct_aaaaaaaaaaaaaaaaaaaaaa",
    createdAt: 1_752_710_400_000,
    expiresAt: 1_752_796_800_000,
    lastSeenAt: 1_752_710_400_000,
    revokedAt: null,
    revocationReasonCode: null,
  },
  csrfToken: "csrf-canary",
} as const;

/** The minimum registration challenge `validatePasskeyRegistrationOptions` accepts. */
const registrationOptions = {
  challenge: encodeBase64Url(new Uint8Array([7, 8, 9])),
  rp: { name: "Ryco Hub" },
  user: { id: encodeBase64Url(new Uint8Array([4, 5])), name: "ada", displayName: "Ada" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
} as const;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://hub.example.test" } },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  vi.restoreAllMocks();
});

describe("HostedHubApi", () => {
  it("validates the exact fail-closed bootstrap availability response", async () => {
    const api = createApi();
    globalThis.fetch = vi.fn(async () => response({ available: true }));
    await expect(api.getBootstrapAvailability()).resolves.toBe(true);

    globalThis.fetch = vi.fn(async () => response({ available: true, detail: "unexpected" }));
    await expect(api.getBootstrapAvailability()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("uses the existing same-origin first-owner WebAuthn registration endpoints", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const register = vi.fn(async () => ({ id: "passkey-response-canary" }) as never);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1
        ? response({
            options: {
              challenge: encodeBase64Url(new Uint8Array([1, 2, 3])),
              rp: { name: "Ryco Hub" },
              user: {
                id: encodeBase64Url(new Uint8Array([4, 5])),
                name: "ada",
                displayName: "Ada",
              },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            },
          })
        : response({ ...session, recoveryCodes: ["recovery-sensitive-canary"] }, 201);
    });

    const api = createApi({ register });
    const result = await api.bootstrapOwner({
      credential: "bootstrap-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: "Primary",
    });

    expect(requests.map(({ input }) => input)).toEqual([
      "/api/auth/bootstrap/registration/options",
      "/api/auth/bootstrap/registration/verify",
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      credential: "bootstrap-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: "Primary",
    });
    // The fail-closed codec runs in front of the platform ceremony seam: the
    // ceremony receives already-validated options with a decoded challenge.
    expect(register).toHaveBeenCalledOnce();
    const registeredOptions = register.mock.calls[0]![0] as {
      challenge: Uint8Array;
      rp: { name: string };
    };
    expect([...new Uint8Array(registeredOptions.challenge)]).toEqual([1, 2, 3]);
    expect(registeredOptions.rp.name).toBe("Ryco Hub");
    expect(register.mock.calls[0]![1]).toBeUndefined();
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      response: { id: "passkey-response-canary" },
    });
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(result.recoveryCodes).toEqual(["recovery-sensitive-canary"]);
    expect(requests.map(({ input }) => String(input)).join(" ")).not.toContain(
      "bootstrap-sensitive-canary",
    );
  });

  it("uses same-origin no-store cookie requests and session-bound CSRF", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1
        ? response(session)
        : response(
            {
              ticket: "ticket-sensitive-canary",
              expiresAt: Date.now() + 60_000,
              protocolMajor: 1,
              protocolMinor: 2,
            },
            201,
          );
    });
    const api = createApi();
    await api.restoreSession();
    const issued = await api.issueRelayTicket("node_aaaaaaaaaaaaaaaaaaaaaa");
    expect(issued.ticket).toBe("ticket-sensitive-canary");
    expect(requests[0]?.input).toBe("/api/auth/session");
    expect(requests[0]?.init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    expect(requests[1]?.input).toBe("/api/relay/tickets");
    const headers = requests[1]?.init?.headers as Headers;
    expect(headers.get("X-Ryco-CSRF")).toBe("csrf-canary");
    expect(JSON.stringify(requests)).not.toContain("ticket-sensitive-canary");
    expect(String(requests[1]?.input)).not.toContain("node_aaaaaaaaaaaaaaaaaaaaaa");
  });

  it("returns stable bounded errors without reflecting response details", async () => {
    globalThis.fetch = vi.fn(async () =>
      response({ error: "session_invalid", details: "sensitive-response-canary" }, 401),
    );
    const api = createApi();
    const error = await api.restoreSession().catch((cause) => cause);
    expect(error).toBeInstanceOf(HostedHubApiError);
    expect((error as Error).message).toBe("Your Hub session has expired.");
    expect((error as Error).message).not.toContain("sensitive-response-canary");
  });

  it("rejects disabled accounts and revoked sessions returned by a malformed Hub", async () => {
    const api = createApi();
    globalThis.fetch = vi.fn(async () =>
      response({
        ...session,
        account: { ...session.account, disabledAt: Date.now() },
      }),
    );
    await expect(api.restoreSession()).rejects.toMatchObject({ code: "session_invalid" });

    globalThis.fetch = vi.fn(async () =>
      response({
        ...session,
        session: { ...session.session, revokedAt: Date.now() },
      }),
    );
    await expect(api.restoreSession()).rejects.toMatchObject({ code: "session_invalid" });
  });

  it("rejects malformed directory and ticket responses", async () => {
    const api = createApi();
    globalThis.fetch = vi.fn(async () => response(session));
    await api.restoreSession();
    globalThis.fetch = vi.fn(async () => response({ nodes: [{ id: "node_bad" }] }));
    await expect(api.listNodes()).rejects.toMatchObject({ code: "invalid_response" });
    globalThis.fetch = vi.fn(async () => response({ ticket: "bad" }, 201));
    await expect(api.issueRelayTicket("node_aaaaaaaaaaaaaaaaaaaaaa")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects unsafe session and relay timestamps", async () => {
    const api = createApi();
    globalThis.fetch = vi.fn(async () =>
      response({ ...session, account: { ...session.account, createdAt: 1.5 } }),
    );
    await expect(api.restoreSession()).rejects.toMatchObject({ code: "invalid_response" });

    globalThis.fetch = vi.fn(async () => response(session));
    await api.restoreSession();
    globalThis.fetch = vi.fn(async () =>
      response({
        ticket: "ticket",
        expiresAt: Number.POSITIVE_INFINITY,
        protocolMajor: 1,
        protocolMinor: 2,
      }),
    );
    await expect(api.issueRelayTicket("node_aaaaaaaaaaaaaaaaaaaaaa")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("accepts the bounded directory contract and discards unexpected metadata", async () => {
    const api = createApi();
    globalThis.fetch = vi.fn(async () => response(session));
    await api.restoreSession();
    globalThis.fetch = vi.fn(async () =>
      response({
        nodes: [
          {
            id: "node_aaaaaaaaaaaaaaaaaaaaaa",
            environmentId: "env_aaaaaaaaaaaaaaaaaaaaaa",
            label: "Studio",
            platformOs: "linux",
            platformArch: "arm64",
            clientVersion: "0.9.0",
            createdAt: 1,
            updatedAt: 2,
            lastAuthenticatedAt: 2,
            revokedAt: null,
            revocationReasonCode: null,
            grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
            effectiveRole: "operator",
            presence: { online: true, lastHeartbeatAt: 3 },
            unexpectedSensitiveMetadata: "directory-sensitive-canary",
          },
        ],
      }),
    );
    const nodes = await api.listNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "Studio", effectiveRole: "operator" });
    expect(JSON.stringify(nodes)).not.toContain("directory-sensitive-canary");
  });

  it("looks up, approves, and denies enrollments with session-bound CSRF", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const enrollment = {
      id: "enr_aaaaaaaaaaaaaaaaaaaaaa",
      label: "Studio",
      platformOs: "darwin",
      platformArch: "arm64",
      clientVersion: "0.1.8",
      algorithm: "ed25519",
      fingerprint: `SHA256:${"a".repeat(43)}`,
      createdAt: 10,
      expiresAt: 20,
    } as const;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      if (requests.length === 1) return response(session);
      if (requests.length === 2) return response({ enrollment });
      if (requests.length === 3) {
        return response({
          node: {
            id: "node_aaaaaaaaaaaaaaaaaaaaaa",
            environmentId: "env_aaaaaaaaaaaaaaaaaaaaaa",
          },
          grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "owner" },
        });
      }
      return response({ ok: true });
    });

    const api = createApi();
    await api.restoreSession();
    await expect(api.lookupNodeEnrollment("ABCD-EFGH")).resolves.toEqual(enrollment);
    await expect(api.approveNodeEnrollment("ABCD-EFGH")).resolves.toBeUndefined();
    await expect(api.denyNodeEnrollment("ABCD-EFGH")).resolves.toBeUndefined();

    expect(requests.slice(1).map(({ input }) => input)).toEqual([
      "/api/admin/node-enrollments/lookup",
      "/api/admin/node-enrollments/approve",
      "/api/admin/node-enrollments/deny",
    ]);
    for (const request of requests.slice(1)) {
      const headers = request.init?.headers;
      expect(headers).toBeInstanceOf(Headers);
      expect((headers as Headers).get("X-Ryco-CSRF")).toBe("csrf-canary");
      expect(String(request.input)).not.toContain("ABCD-EFGH");
      expect(JSON.parse(String(request.init?.body))).toEqual({ deviceCode: "ABCD-EFGH" });
    }
  });

  it("lists account passkeys over the cookie transport and drops unexpected metadata", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1
        ? response(session)
        : response({
            passkeys: [
              {
                id: "credential-aaa",
                label: "Studio laptop",
                createdAt: 10,
                lastUsedAt: null,
                backupEligible: true,
                backupState: false,
                revokedAt: null,
                revocationReasonCode: null,
                unexpectedSensitiveMetadata: "passkey-sensitive-canary",
              },
            ],
          });
    });
    const api = createApi();
    await api.restoreSession();

    const passkeys = await api.listPasskeys();

    expect(requests[1]?.input).toBe("/api/account/passkeys");
    expect(requests[1]?.init).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(passkeys).toEqual([
      {
        id: "credential-aaa",
        label: "Studio laptop",
        createdAt: 10,
        lastUsedAt: null,
        backupEligible: true,
        backupState: false,
        revokedAt: null,
        revocationReasonCode: null,
      },
    ]);
    expect(JSON.stringify(passkeys)).not.toContain("passkey-sensitive-canary");
  });

  it("rejects malformed passkey lists", async () => {
    const api = createApi();
    globalThis.fetch = vi.fn(async () => response(session));
    await api.restoreSession();

    globalThis.fetch = vi.fn(async () => response({ passkeys: {} }));
    await expect(api.listPasskeys()).rejects.toMatchObject({ code: "invalid_response" });

    // The credential-id constraint is a response-projection bound: no request
    // path is built from an id, so this is about what may reach a view model.
    globalThis.fetch = vi.fn(async () => response({ passkeys: [{ id: "not a base64url id" }] }));
    await expect(api.listPasskeys()).rejects.toMatchObject({ code: "invalid_response" });

    // F7: an unbounded list is not a list.
    globalThis.fetch = vi.fn(async () =>
      response({
        passkeys: Array.from({ length: 257 }, (_value, index) => ({ id: `cred${index}` })),
      }),
    );
    await expect(api.listPasskeys()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("adds a passkey on the live session without minting or clobbering one", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const register = vi.fn(async () => ({ id: "added-passkey-canary" }) as never);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      if (requests.length === 1) return response(session);
      if (requests.length === 2) return response({ options: registrationOptions });
      // The Hub carries no session material on an add-passkey verify.
      return response({ passkey: { id: "credential-bbb", label: "Phone" } }, 201);
    });
    const api = createApi({ register });
    await api.restoreSession();

    const added = await api.addPasskey({ passkeyLabel: "Phone" });

    expect(requests.slice(1).map(({ input }) => input)).toEqual([
      "/api/account/passkeys/registration/options",
      "/api/account/passkeys/registration/verify",
    ]);
    for (const request of requests.slice(1)) {
      // An authenticated ceremony: the session CSRF token rides both calls.
      expect(headersOf(request.init).get("X-Ryco-CSRF")).toBe("csrf-canary");
      expect(request.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    }
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ passkeyLabel: "Phone" });
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      response: { id: "added-passkey-canary" },
    });
    expect(added).toEqual({
      passkey: {
        id: "credential-bbb",
        label: "Phone",
        createdAt: null,
        lastUsedAt: null,
        backupEligible: null,
        backupState: null,
        revokedAt: null,
        revocationReasonCode: null,
      },
      confirmed: true,
    });

    // The live session is untouched: a subsequent CSRF-bound call still
    // presents the token minted by restoreSession.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return response({ ok: true });
    });
    await api.denyNodeEnrollment("ABCD-EFGH");
    expect(headersOf(requests[3]?.init).get("X-Ryco-CSRF")).toBe("csrf-canary");
  });

  it("never adopts an unvalidated CSRF token from an add-passkey verify", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      if (requests.length === 1) return response(session);
      if (requests.length === 2) return response({ options: registrationOptions });
      // A bare csrfToken member is not a validated session response. Adopting it
      // would wedge every later CSRF-bound call in a 403 that isSessionFailure
      // does not match, with no way back but a reload.
      if (requests.length === 3) return response({ csrfToken: "csrf-unvalidated-canary" }, 201);
      return response({ ok: true });
    });
    const api = createApi({ register: vi.fn(async () => ({ id: "added" }) as never) });
    await api.restoreSession();

    await expect(api.addPasskey({ passkeyLabel: null })).resolves.toEqual({
      passkey: null,
      confirmed: false,
    });
    await api.denyNodeEnrollment("ABCD-EFGH");

    expect(headersOf(requests[3]?.init).get("X-Ryco-CSRF")).toBe("csrf-canary");
  });

  it("regenerates recovery codes as a mutation and rejects malformed lists", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1
        ? response(session)
        : response({ recoveryCodes: ["recovery-sensitive-canary"] });
    });
    const api = createApi();
    await api.restoreSession();

    await expect(api.regenerateRecoveryCodes()).resolves.toEqual(["recovery-sensitive-canary"]);

    expect(requests[1]?.input).toBe("/api/account/recovery-codes");
    expect(requests[1]?.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(headersOf(requests[1]?.init).get("X-Ryco-CSRF")).toBe("csrf-canary");
    // No code is ever echoed back to the Hub or placed in a URL.
    expect(JSON.stringify(requests)).not.toContain("recovery-sensitive-canary");

    globalThis.fetch = vi.fn(async () => response({ recoveryCodes: [] }));
    await expect(api.regenerateRecoveryCodes()).rejects.toMatchObject({ code: "invalid_response" });
    globalThis.fetch = vi.fn(async () => response({ recoveryCodes: [1, 2] }));
    await expect(api.regenerateRecoveryCodes()).rejects.toMatchObject({ code: "invalid_response" });
    globalThis.fetch = vi.fn(async () =>
      response({ recoveryCodes: Array.from({ length: 257 }, () => "code") }),
    );
    await expect(api.regenerateRecoveryCodes()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not apply the new recovery-code bounds to the pre-existing session paths", async () => {
    // A cap guessed for the new route must never reject a real registration
    // response: on bootstrap that would strand a user whose account already
    // exists server-side.
    const api = createApi({ register: vi.fn(async () => ({ id: "registered" }) as never) });
    const recoveryCodes = Array.from({ length: 300 }, () => "x".repeat(600));
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return call === 1
        ? response({ options: registrationOptions })
        : response({ ...session, recoveryCodes }, 201);
    });

    const result = await api.bootstrapOwner({
      credential: "bootstrap-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: null,
    });
    expect(result.recoveryCodes).toHaveLength(300);
  });

  it("keeps browser-only registration reachable on the cookie transport", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1
        ? response({ options: registrationOptions })
        : response(session, 201);
    });
    const api = createApi({ register: vi.fn(async () => ({ id: "registered" }) as never) });

    await expect(
      api.redeemInvitation({
        secret: "invitation-sensitive-canary",
        displayName: "Ada",
        passkeyLabel: null,
      }),
    ).resolves.toMatchObject({ account: session.account });
    expect(requests.map(({ input }) => input)).toEqual([
      "/api/auth/invitations/registration/options",
      "/api/auth/invitations/registration/verify",
    ]);
    // The pre-session mint ceremony carries no CSRF token.
    expect(headersOf(requests[0]?.init).get("X-Ryco-CSRF")).toBeNull();
  });

  it("rejects malformed enrollment lookup and approval responses", async () => {
    const api = createApi();
    globalThis.fetch = vi.fn(async () => response(session));
    await api.restoreSession();

    globalThis.fetch = vi.fn(async () => response({ enrollment: { id: "enr_bad" } }));
    await expect(api.lookupNodeEnrollment("ABCD-EFGH")).rejects.toMatchObject({
      code: "invalid_response",
    });

    globalThis.fetch = vi.fn(async () => response({ node: {}, grant: {} }));
    await expect(api.approveNodeEnrollment("ABCD-EFGH")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

const PASSKEY_ID = "pkey_aaaaaaaaaaaaaaaaaaaaaa";

describe("HostedHubApi account credential management", () => {
  /** A restored cookie session, and the recorder every case below asserts on. */
  async function authenticated(): Promise<{
    readonly api: HostedHubApi;
    readonly requests: Array<{ input: RequestInfo | URL; init?: RequestInit }>;
    readonly reply: (value: unknown, status?: number) => void;
  }> {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    let next: { body: unknown; status: number } = { body: { ok: true }, status: 200 };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1 ? response(session) : response(next.body, next.status);
    });
    const api = createApi();
    await api.restoreSession();
    return {
      api,
      requests,
      reply: (value, status = 200) => {
        next = { body: value, status };
      },
    };
  }

  it("posts every credential mutation to its Hub route with session-bound CSRF", async () => {
    const { api, requests } = await authenticated();

    await expect(
      api.setPassword({ password: "password-sensitive-canary" }),
    ).resolves.toBeUndefined();
    await expect(api.removePassword()).resolves.toBeUndefined();
    await expect(api.confirmTotpEnrollment({ code: "123456" })).resolves.toBeUndefined();
    await expect(api.revokeTotp()).resolves.toBeUndefined();
    await expect(
      api.requestEmailVerification({ email: "ada@example.test" }),
    ).resolves.toBeUndefined();
    await expect(api.revokePasskey(PASSKEY_ID)).resolves.toBeUndefined();

    expect(requests.slice(1).map(({ input }) => input)).toEqual([
      "/api/account/password",
      "/api/account/password/remove",
      "/api/account/totp/enrollment/verify",
      "/api/account/totp/revoke",
      "/api/account/email/verification",
      `/api/account/passkeys/${PASSKEY_ID}/revoke`,
    ]);
    for (const request of requests.slice(1)) {
      expect(request.init).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      // Cookie transport: CSRF, never a bearer/DPoP header.
      expect(headersOf(request.init).get("X-Ryco-CSRF")).toBe("csrf-canary");
      expect(headersOf(request.init).get("Authorization")).toBeNull();
      expect(headersOf(request.init).get("DPoP")).toBeNull();
    }
    expect(requests.slice(1).map((request) => JSON.parse(String(request.init?.body)))).toEqual([
      { password: "password-sensitive-canary" },
      {},
      { code: "123456" },
      {},
      { email: "ada@example.test" },
      {},
    ]);
    // A credential is never placed in a URL, only in a body over TLS.
    expect(requests.map(({ input }) => String(input)).join(" ")).not.toContain(
      "password-sensitive-canary",
    );
    expect(requests.map(({ input }) => String(input)).join(" ")).not.toContain("ada@example.test");
  });

  it("threads the fallback-session step-up code and omits it when there is none", async () => {
    const { api, requests } = await authenticated();

    await api.setPassword({ password: "pw", totpCode: "123456" });
    await api.removePassword({ totpCode: "234567" });
    await api.revokeTotp({ totpCode: "345678" });
    await api.requestEmailVerification({ email: "ada@example.test", totpCode: "456789" });

    expect(requests.slice(1, 5).map((request) => JSON.parse(String(request.init?.body)))).toEqual([
      { password: "pw", totpCode: "123456" },
      { totpCode: "234567" },
      { totpCode: "345678" },
      { email: "ada@example.test", totpCode: "456789" },
    ]);

    // Absent and empty are both "no code submitted": the member is omitted
    // rather than sent as "", so the Hub can answer "a code is required" instead
    // of "that code is wrong".
    const bodies: Array<Record<string, unknown>> = [];
    await api.removePassword();
    await api.removePassword({});
    await api.removePassword({ totpCode: "" });
    for (const request of requests.slice(-3)) bodies.push(JSON.parse(String(request.init?.body)));
    expect(bodies).toEqual([{}, {}, {}]);
    for (const body of bodies) expect("totpCode" in body).toBe(false);
  });

  it("sends the step-up code on a recovery-code rotation and on an add-passkey verify", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      if (requests.length === 1) return response(session);
      if (requests.length === 2) return response({ recoveryCodes: ["fresh"] });
      if (requests.length === 3) return response({ options: registrationOptions });
      return response({ passkey: { id: PASSKEY_ID } }, 201);
    });
    const api = createApi({ register: vi.fn(async () => ({ id: "added" }) as never) });
    await api.restoreSession();

    await api.regenerateRecoveryCodes({ totpCode: "123456" });
    await api.addPasskey({ passkeyLabel: "Phone", totpCode: "234567" });

    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ totpCode: "123456" });
    // The step-up rides the verify only. The options body is the Hub's strict
    // `{ label }` shape and an unexpected member would be rejected outright.
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({ passkeyLabel: "Phone" });
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      response: { id: "added" },
      totpCode: "234567",
    });
  });

  it("never adds a step-up member to the pre-session registration ceremonies", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1
        ? response({ options: registrationOptions })
        : response(session, 201);
    });
    const api = createApi({ register: vi.fn(async () => ({ id: "registered" }) as never) });

    await api.bootstrapOwner({ credential: "c", displayName: "Ada", passkeyLabel: null });

    // The Hub's bootstrap verify body is strict `{ response }`.
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ response: { id: "registered" } });
  });

  it("begins TOTP enrolment and bounds both secret members", async () => {
    const { api, requests, reply } = await authenticated();
    reply({
      secretBase32: "JBSWY3DPEHPK3PXP",
      provisioningUri: "otpauth://totp/Ryco%20Hub:ada?secret=JBSWY3DPEHPK3PXP&issuer=Ryco%20Hub",
      unexpectedSensitiveMetadata: "totp-extra-canary",
    });

    const enrollment = await api.beginTotpEnrollment();

    expect(requests[1]?.input).toBe("/api/account/totp/enrollment/options");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({});
    expect(enrollment).toEqual({
      secretBase32: "JBSWY3DPEHPK3PXP",
      provisioningUri: "otpauth://totp/Ryco%20Hub:ada?secret=JBSWY3DPEHPK3PXP&issuer=Ryco%20Hub",
    });
    // Only the two contract members are projected.
    expect(JSON.stringify(enrollment)).not.toContain("totp-extra-canary");
  });

  it("rejects a TOTP enrolment whose secret or provisioning URI is not bounded", async () => {
    const { api, reply } = await authenticated();
    const uri = "otpauth://totp/Ryco:ada?secret=JBSWY3DPEHPK3PXP";

    reply({ provisioningUri: uri });
    await expect(api.beginTotpEnrollment()).rejects.toMatchObject({ code: "invalid_response" });
    reply({ secretBase32: "", provisioningUri: uri });
    await expect(api.beginTotpEnrollment()).rejects.toMatchObject({ code: "invalid_response" });
    reply({ secretBase32: "x".repeat(257), provisioningUri: uri });
    await expect(api.beginTotpEnrollment()).rejects.toMatchObject({ code: "invalid_response" });
    reply({ secretBase32: "JBSWY3DPEHPK3PXP", provisioningUri: `otpauth://${"x".repeat(2049)}` });
    await expect(api.beginTotpEnrollment()).rejects.toMatchObject({ code: "invalid_response" });

    // A URI a surface would render as a link or a QR must carry the otpauth
    // scheme. Anything else is a malformed response, not a provisioning URI.
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "https://evil.example.test/otpauth://totp/x",
      "",
    ]) {
      reply({ secretBase32: "JBSWY3DPEHPK3PXP", provisioningUri: hostile });
      await expect(api.beginTotpEnrollment()).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("keeps the TOTP secret out of every request, error, and later call", async () => {
    const { api, requests, reply } = await authenticated();
    reply({
      secretBase32: "TOTPSECRETSENSITIVECANARY",
      provisioningUri: "otpauth://totp/Ryco:ada?secret=TOTPSECRETSENSITIVECANARY",
    });

    const enrollment = await api.beginTotpEnrollment();
    expect(enrollment.secretBase32).toBe("TOTPSECRETSENSITIVECANARY");

    // Confirming enrolment sends the user's 6-digit code, never the secret.
    reply({ ok: true });
    await api.confirmTotpEnrollment({ code: "123456" });
    expect(JSON.stringify(requests)).not.toContain("TOTPSECRETSENSITIVECANARY");

    // A malformed enrolment must not reflect the secret it did receive.
    reply({ secretBase32: "TOTPSECRETSENSITIVECANARY", provisioningUri: "javascript:alert(1)" });
    const error = await api.beginTotpEnrollment().catch((cause) => cause);
    expect(error).toBeInstanceOf(HostedHubApiError);
    expect(JSON.stringify({ message: (error as Error).message, error })).not.toContain(
      "TOTPSECRETSENSITIVECANARY",
    );
  });

  it("fails closed on a passkey id that is not the Hub's credential shape", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return response(session);
    });
    const api = createApi();
    await api.restoreSession();
    const before = requests.length;

    for (const hostile of [
      "",
      "pkey_short",
      `pkey_${"a".repeat(23)}`,
      "sess_aaaaaaaaaaaaaaaaaaaaaa",
      `${PASSKEY_ID}/../../admin/accounts`,
      `../../admin/sessions/${PASSKEY_ID}/revoke`,
      "pkey_aaaaaaaaaaaaaaaaaaaa%2F",
      `${PASSKEY_ID}?x=1`,
      `${PASSKEY_ID}#x`,
      "https://evil.example.test/api/account/passkeys/pkey_aaaaaaaaaaaaaaaaaaaaaa/revoke",
    ]) {
      await expect(api.revokePasskey(hostile)).rejects.toMatchObject({ code: "invalid_request" });
    }

    // Nothing reached the wire: an unvalidated id is never interpolated into a
    // path, not even one the endpoint guard would have rejected afterwards.
    expect(requests).toHaveLength(before);
  });

  it("rejects an acknowledgement that is not exactly { ok: true }", async () => {
    const { api, reply } = await authenticated();

    for (const body of [
      { ok: false },
      { ok: "true" },
      {},
      // A route whose whole contract is an acknowledgement has no business
      // handing over session material, and this client will not take it.
      { ok: true, token: "native-token-unvalidated-canary" },
      { ok: true, csrfToken: "csrf-unvalidated-canary" },
    ]) {
      reply(body);
      await expect(api.revokeTotp()).rejects.toMatchObject({ code: "invalid_response" });
    }

    // The live session is untouched by any of it.
    reply({ ok: true });
    await expect(api.removePassword()).resolves.toBeUndefined();
  });

  it("maps a Hub refusal to a bounded error without reflecting its detail", async () => {
    const { api, reply } = await authenticated();
    reply({ error: "invalid_request", detail: "totp-detail-sensitive-canary" }, 400);

    const error = await api.setPassword({ password: "pw" }).catch((cause) => cause);

    expect(error).toBeInstanceOf(HostedHubApiError);
    expect((error as HostedHubApiError).code).toBe("invalid_request");
    expect((error as Error).message).not.toContain("totp-detail-sensitive-canary");
  });

  it("projects the widened passkey record and tolerates members it does not know", async () => {
    const { api, reply } = await authenticated();
    reply({
      passkeys: [
        {
          id: PASSKEY_ID,
          label: "Studio laptop",
          createdAt: 10,
          lastUsedAt: 20,
          backupEligible: true,
          backupState: true,
          revokedAt: 30,
          revocationReasonCode: "owner_revoked",
        },
        // A record whose optional members are absent or malformed still lists:
        // one unfamiliar field must not blank a list the user needs to revoke
        // from.
        {
          id: "pkey_bbbbbbbbbbbbbbbbbbbbbb",
          backupEligible: "yes",
          backupState: 1,
          revokedAt: 1.5,
          revocationReasonCode: "x".repeat(257),
        },
      ],
    });

    await expect(api.listPasskeys()).resolves.toEqual([
      {
        id: PASSKEY_ID,
        label: "Studio laptop",
        createdAt: 10,
        lastUsedAt: 20,
        backupEligible: true,
        backupState: true,
        revokedAt: 30,
        revocationReasonCode: "owner_revoked",
      },
      {
        id: "pkey_bbbbbbbbbbbbbbbbbbbbbb",
        label: null,
        createdAt: null,
        lastUsedAt: null,
        backupEligible: null,
        backupState: null,
        revokedAt: null,
        revocationReasonCode: null,
      },
    ]);
  });
});

/** In-memory bearer credentials mirroring a native (DPoP) adapter. */
function inMemoryBearerCredentials(): SessionCredentialsService & {
  readonly current: () => string | null;
} {
  let bearerToken: string | null = null;
  return {
    mode: "bearer",
    readCsrfToken: () => null,
    writeCsrfToken: () => undefined,
    readBearerToken: () => bearerToken,
    writeBearerToken: (token) => {
      bearerToken = token;
    },
    current: () => bearerToken,
  };
}

/** A DPoP signer that records its inputs and returns a deterministic proof. */
function recordingDpopSigner(): {
  readonly calls: DpopProofInput[];
  readonly service: DpopSignerService;
} {
  const calls: DpopProofInput[] = [];
  return {
    calls,
    service: {
      sign: async (input) => {
        calls.push(input);
        return `proof:${input.method}:${input.url}:${input.token ? "ath" : "no-ath"}`;
      },
    },
  };
}

function createBearerApi(
  service: DpopSignerService,
  credentials: SessionCredentialsService,
  passkeyCeremony?: Partial<PasskeyCeremonyService>,
): HostedHubApi {
  return new HostedHubApi({
    endpoint: fakeEndpoint,
    httpClient: fakeHttpClient,
    sessionCredentials: credentials,
    dpopSigner: service,
    passkeyCeremony: {
      authenticate: vi.fn(async () => ({ id: "authenticate-not-used" }) as never),
      register: vi.fn(async () => ({ id: "register-not-used" }) as never),
      ...passkeyCeremony,
    },
  });
}

const accountAndSession = {
  account: session.account,
  session: session.session,
} as const;

describe("HostedHubApi bearer (native/DPoP) transport", () => {
  it("fails closed when bearer credentials lack a DPoP signer or token holder", () => {
    const { service } = recordingDpopSigner();
    // Missing signer.
    expect(
      () =>
        new HostedHubApi({
          endpoint: fakeEndpoint,
          httpClient: fakeHttpClient,
          sessionCredentials: inMemoryBearerCredentials(),
          passkeyCeremony: { authenticate: vi.fn(), register: vi.fn() },
        }),
    ).toThrow();
    // Missing bearer-token holder (only the cookie CSRF slots present).
    expect(
      () =>
        new HostedHubApi({
          endpoint: fakeEndpoint,
          httpClient: fakeHttpClient,
          sessionCredentials: {
            mode: "bearer",
            readCsrfToken: () => null,
            writeCsrfToken: () => undefined,
          },
          dpopSigner: service,
          passkeyCeremony: { authenticate: vi.fn(), register: vi.fn() },
        }),
    ).toThrow();
  });

  it("routes login through native passkey endpoints with a mint proof and no CSRF", async () => {
    const { calls, service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      return requests.length === 1
        ? response({ options: { challenge: encodeBase64Url(new Uint8Array([1, 2, 3])) } })
        : response({ ...accountAndSession, token: "native-token-canary" });
    });
    const authenticate = vi.fn(async () => ({ id: "assertion-canary" }) as never);
    const api = createBearerApi(service, credentials, { authenticate });

    const result = await api.signIn();

    // Native endpoints, presented as absolute Hub URLs.
    expect(requests.map((request) => request.input)).toEqual([
      "https://hub.example.test/api/auth/native/passkey/options",
      "https://hub.example.test/api/auth/native/passkey/verify",
    ]);
    for (const request of requests) {
      const headers = request.init?.headers as Headers;
      expect(headers.get("DPoP")).toMatch(/^proof:POST:/);
      // Mint ceremony: no bearer token presented, no cookie/CSRF.
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("X-Ryco-CSRF")).toBeNull();
      expect(request.init?.credentials).toBe("omit");
    }
    // The signer was invoked without a token on both ceremony calls (no ath).
    expect(calls.every((call) => call.token === undefined)).toBe(true);
    // The native token is persisted but never surfaced in the returned view.
    expect(credentials.current()).toBe("native-token-canary");
    expect(api.hasSessionMaterial).toBe(true);
    expect(JSON.stringify(result)).not.toContain("native-token-canary");
    expect(result).toMatchObject({ account: session.account, session: session.session });
    expect("csrfToken" in result).toBe(false);
  });

  it("attaches Authorization DPoP + an ath proof on authenticated requests, no CSRF", async () => {
    const { calls, service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      return response(
        {
          ticket: "ticket-sensitive-canary",
          expiresAt: Date.now() + 60_000,
          protocolMajor: 1,
          protocolMinor: 2,
        },
        201,
      );
    });
    const api = createBearerApi(service, credentials);

    const issued = await api.issueRelayTicket("node_aaaaaaaaaaaaaaaaaaaaaa");

    expect(issued.ticket).toBe("ticket-sensitive-canary");
    expect(requests[0]?.input).toBe("https://hub.example.test/api/relay/tickets");
    const headers = requests[0]?.init?.headers as Headers;
    expect(headers.get("Authorization")).toBe("DPoP native-token-canary");
    expect(headers.get("DPoP")).toBe("proof:POST:https://hub.example.test/api/relay/tickets:ath");
    // Bearer mode drops CSRF and never sends an ambient cookie.
    expect(headers.get("X-Ryco-CSRF")).toBeNull();
    expect(requests[0]?.init?.credentials).toBe("omit");
    // The signer bound the presented token (ath branch) to this request.
    expect(calls[0]).toEqual({
      method: "POST",
      url: "https://hub.example.test/api/relay/tickets",
      token: "native-token-canary",
    });
    // The directory refresh (a GET) works under bearer mode with no CSRF.
    globalThis.fetch = vi.fn(async () => response({ nodes: [] }));
    await expect(api.listNodes()).resolves.toEqual([]);
  });

  it("fails closed on an authenticated bearer request with no persisted token", async () => {
    const { service } = recordingDpopSigner();
    const api = createBearerApi(service, inMemoryBearerCredentials());
    const fetchSpy = vi.fn(async () => response({ nodes: [] }));
    globalThis.fetch = fetchSpy;
    await expect(api.listNodes()).rejects.toMatchObject({ code: "session_invalid" });
    // The request must never reach the wire without a bound token.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed before any I/O on browser-only routes in bearer mode", async () => {
    const { calls, service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    const fetchSpy = vi.fn(async () => response({}));
    globalThis.fetch = fetchSpy;
    const register = vi.fn(async () => ({ id: "never-registered" }) as never);
    const api = createBearerApi(service, credentials, { register });

    await expect(
      api.bootstrapOwner({
        credential: "bootstrap-sensitive-canary",
        displayName: "Ada",
        passkeyLabel: null,
      }),
    ).rejects.toMatchObject({
      code: "browser_only_transport",
      message: "This action is only available in a browser.",
    });
    await expect(
      api.redeemInvitation({
        secret: "invitation-sensitive-canary",
        displayName: "Ada",
        passkeyLabel: null,
      }),
    ).rejects.toMatchObject({ code: "browser_only_transport" });

    // Nothing reached the wire, no proof was minted, and the user was never
    // prompted for a passkey they could not have used.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(register).not.toHaveBeenCalled();
    // The refusal is inert: it consumed no session material.
    expect(credentials.current()).toBe("native-token-canary");

    // The guard is scoped — native passkey *login* is still issued. Asserted by
    // driving it, not inferred from the token being untouched.
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return call === 1
        ? response({ options: { challenge: encodeBase64Url(new Uint8Array([1, 2, 3])) } })
        : response({ ...accountAndSession, token: "native-token-relogin-canary" });
    });
    await expect(api.signIn()).resolves.toMatchObject({ account: session.account });
    expect(credentials.current()).toBe("native-token-relogin-canary");
  });

  it("adds a passkey over DPoP without minting or clearing the native session", async () => {
    const { calls, service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      return requests.length === 1
        ? response({ options: registrationOptions })
        : // No session material on an add-passkey verify.
          response({ passkey: { id: "credential-ccc", label: "Phone", createdAt: 5 } }, 201);
    });
    const register = vi.fn(async () => ({ id: "added-passkey-canary" }) as never);
    const api = createBearerApi(service, credentials, { register });

    const added = await api.addPasskey({ passkeyLabel: "Phone" });

    expect(requests.map((request) => request.input)).toEqual([
      "https://hub.example.test/api/account/passkeys/registration/options",
      "https://hub.example.test/api/account/passkeys/registration/verify",
    ]);
    for (const request of requests) {
      const headers = request.init?.headers as Headers;
      // Session-bound, not a mint: token presented, proof carries `ath`.
      expect(headers.get("Authorization")).toBe("DPoP native-token-canary");
      expect(headers.get("DPoP")).toMatch(/:ath$/);
      expect(headers.get("X-Ryco-CSRF")).toBeNull();
      expect(request.init?.credentials).toBe("omit");
    }
    expect(calls.every((call) => call.token === "native-token-canary")).toBe(true);
    expect(added).toEqual({
      passkey: {
        id: "credential-ccc",
        label: "Phone",
        createdAt: 5,
        lastUsedAt: null,
        backupEligible: null,
        backupState: null,
        revokedAt: null,
        revocationReasonCode: null,
      },
      confirmed: true,
    });
    // The enclave-bound token survives an add-passkey that returns none.
    expect(credentials.current()).toBe("native-token-canary");
    expect(api.hasSessionMaterial).toBe(true);
    expect(JSON.stringify(added)).not.toContain("native-token-canary");
  });

  it("never adopts an unvalidated native token from an add-passkey verify", async () => {
    const { service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return call === 1
        ? response({ options: registrationOptions })
        : // A 2xx body carrying a bare token and no account/session. Adopting it
          // would replace a valid enclave-bound token with an unverified one,
          // and the very next authenticated call would 401 — which
          // isSessionFailure matches, expiring a session that was valid.
          response({ token: "native-token-unvalidated-canary" }, 201);
    });
    const api = createBearerApi(service, credentials, {
      register: vi.fn(async () => ({ id: "added" }) as never),
    });

    await expect(api.addPasskey({ passkeyLabel: null })).resolves.toEqual({
      passkey: null,
      confirmed: false,
    });
    expect(credentials.current()).toBe("native-token-canary");

    // The live session still works: the next authenticated call presents the
    // original token, not the one the verify tried to hand over.
    globalThis.fetch = vi.fn(async () => response({ passkeys: [] }));
    await expect(api.listPasskeys()).resolves.toEqual([]);
  });

  it("lists passkeys and fetches recovery codes over DPoP with no CSRF", async () => {
    const { service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      return requests.length === 1
        ? response({ passkeys: [{ id: "credential-aaa" }] })
        : response({ recoveryCodes: ["recovery-sensitive-canary"] });
    });
    const api = createBearerApi(service, credentials);

    await expect(api.listPasskeys()).resolves.toEqual([
      {
        id: "credential-aaa",
        label: null,
        createdAt: null,
        lastUsedAt: null,
        backupEligible: null,
        backupState: null,
        revokedAt: null,
        revocationReasonCode: null,
      },
    ]);
    await expect(api.regenerateRecoveryCodes()).resolves.toEqual(["recovery-sensitive-canary"]);

    expect(requests.map((request) => request.input)).toEqual([
      "https://hub.example.test/api/account/passkeys",
      "https://hub.example.test/api/account/recovery-codes",
    ]);
    expect(requests.map((request) => request.init?.method)).toEqual(["GET", "POST"]);
    for (const request of requests) {
      const headers = request.init?.headers as Headers;
      expect(headers.get("Authorization")).toBe("DPoP native-token-canary");
      expect(headers.get("DPoP")).toMatch(/:ath$/);
      expect(headers.get("X-Ryco-CSRF")).toBeNull();
      expect(request.init?.credentials).toBe("omit");
    }
    // No recovery code and no session token is ever echoed onto the wire.
    expect(JSON.stringify(requests)).not.toContain("recovery-sensitive-canary");
  });

  it("fails closed on account requests with no persisted native token", async () => {
    const { service } = recordingDpopSigner();
    const api = createBearerApi(service, inMemoryBearerCredentials());
    const fetchSpy = vi.fn(async () => response({ passkeys: [] }));
    globalThis.fetch = fetchSpy;
    await expect(api.listPasskeys()).rejects.toMatchObject({ code: "session_invalid" });
    await expect(api.regenerateRecoveryCodes()).rejects.toMatchObject({
      code: "session_invalid",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs every account credential mutation natively over DPoP, never as browser-only", async () => {
    // The correction that motivates this surface: the Hub takes the DPoP branch
    // on the presence of an `Authorization` header and applies no same-origin
    // check there, so `/api/account/*` mutations are fully native. Only the
    // fallback *login* routes under `/api/auth/*` are browser-transport-only,
    // and those are what the fail-closed guard covers. If any of these were
    // added to that list, this case fails with `browser_only_transport`.
    const { calls, service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      return String(input).endsWith("/totp/enrollment/options")
        ? response({
            secretBase32: "TOTPSECRETSENSITIVECANARY",
            provisioningUri: "otpauth://totp/Ryco:ada?secret=TOTPSECRETSENSITIVECANARY",
          })
        : response({ ok: true });
    });
    const api = createBearerApi(service, credentials);

    await api.setPassword({ password: "password-sensitive-canary", totpCode: "123456" });
    await api.removePassword();
    await expect(api.beginTotpEnrollment()).resolves.toMatchObject({
      secretBase32: "TOTPSECRETSENSITIVECANARY",
    });
    await api.confirmTotpEnrollment({ code: "123456" });
    await api.revokeTotp();
    await api.requestEmailVerification({ email: "ada@example.test" });
    await api.revokePasskey(PASSKEY_ID);

    expect(requests.map((request) => request.input)).toEqual([
      "https://hub.example.test/api/account/password",
      "https://hub.example.test/api/account/password/remove",
      "https://hub.example.test/api/account/totp/enrollment/options",
      "https://hub.example.test/api/account/totp/enrollment/verify",
      "https://hub.example.test/api/account/totp/revoke",
      "https://hub.example.test/api/account/email/verification",
      `https://hub.example.test/api/account/passkeys/${PASSKEY_ID}/revoke`,
    ]);
    for (const request of requests) {
      const headers = request.init?.headers as Headers;
      // Bearer: `Authorization: DPoP` + an `ath`-bound single-use proof, no
      // CSRF header, and never an ambient cookie.
      expect(headers.get("Authorization")).toBe("DPoP native-token-canary");
      expect(headers.get("DPoP")).toMatch(/:ath$/);
      expect(headers.get("X-Ryco-CSRF")).toBeNull();
      expect(request.init).toMatchObject({ method: "POST", credentials: "omit" });
    }
    // Every proof was bound to the presented token, and each to its own URL —
    // the per-request `ath`/`htu` binding the Hub verifies as single-use.
    expect(calls.every((call) => call.token === "native-token-canary")).toBe(true);
    expect(new Set(calls.map((call) => call.url)).size).toBe(requests.length);
    // The enclave-bound token survives the whole sequence and is never echoed.
    expect(credentials.current()).toBe("native-token-canary");
    expect(JSON.stringify(requests)).not.toContain("TOTPSECRETSENSITIVECANARY");
  });

  it("fails closed on a malformed passkey id before minting a proof", async () => {
    const { calls, service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    const fetchSpy = vi.fn(async () => response({ ok: true }));
    globalThis.fetch = fetchSpy;
    const api = createBearerApi(service, credentials);

    await expect(api.revokePasskey("pkey_not-a-valid-id")).rejects.toMatchObject({
      code: "invalid_request",
    });

    // No request, and no single-use proof burned on a call that could not go.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(credentials.current()).toBe("native-token-canary");
  });

  it("fails closed on account credential mutations with no persisted native token", async () => {
    const { service } = recordingDpopSigner();
    const api = createBearerApi(service, inMemoryBearerCredentials());
    const fetchSpy = vi.fn(async () => response({ ok: true }));
    globalThis.fetch = fetchSpy;

    await expect(api.setPassword({ password: "pw" })).rejects.toMatchObject({
      code: "session_invalid",
    });
    await expect(api.removePassword()).rejects.toMatchObject({ code: "session_invalid" });
    await expect(api.beginTotpEnrollment()).rejects.toMatchObject({ code: "session_invalid" });
    await expect(api.confirmTotpEnrollment({ code: "1" })).rejects.toMatchObject({
      code: "session_invalid",
    });
    await expect(api.revokeTotp()).rejects.toMatchObject({ code: "session_invalid" });
    await expect(api.requestEmailVerification({ email: "a@b.test" })).rejects.toMatchObject({
      code: "session_invalid",
    });
    await expect(api.revokePasskey(PASSKEY_ID)).rejects.toMatchObject({ code: "session_invalid" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears the native token as its session material", () => {
    const { service } = recordingDpopSigner();
    const credentials = inMemoryBearerCredentials();
    credentials.writeBearerToken?.("native-token-canary");
    const api = createBearerApi(service, credentials);
    expect(api.hasSessionMaterial).toBe(true);
    api.clearSessionMaterial();
    expect(credentials.current()).toBeNull();
    expect(api.hasSessionMaterial).toBe(false);
  });
});
