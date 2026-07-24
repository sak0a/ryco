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
