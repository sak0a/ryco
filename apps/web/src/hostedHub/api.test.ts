import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { createPasskeyRegistration } = vi.hoisted(() => ({
  createPasskeyRegistration: vi.fn(),
}));
vi.mock("./webauthn", () => ({
  createPasskeyRegistration,
  getPasskeyAuthentication: vi.fn(),
}));

import { HostedHubApi, HostedHubApiError } from "./api";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
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
    const api = new HostedHubApi();
    globalThis.fetch = vi.fn(async () => response({ available: true }));
    await expect(api.getBootstrapAvailability()).resolves.toBe(true);

    globalThis.fetch = vi.fn(async () => response({ available: true, detail: "unexpected" }));
    await expect(api.getBootstrapAvailability()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("uses the existing same-origin first-owner WebAuthn registration endpoints", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    createPasskeyRegistration.mockResolvedValue({ id: "passkey-response-canary" });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return requests.length === 1
        ? response({ options: { challenge: "challenge-sensitive-canary" } })
        : response({ ...session, recoveryCodes: ["recovery-sensitive-canary"] }, 201);
    });

    const api = new HostedHubApi();
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
    expect(createPasskeyRegistration).toHaveBeenCalledWith(
      { challenge: "challenge-sensitive-canary" },
      undefined,
    );
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
    const api = new HostedHubApi();
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
    const api = new HostedHubApi();
    const error = await api.restoreSession().catch((cause) => cause);
    expect(error).toBeInstanceOf(HostedHubApiError);
    expect((error as Error).message).toBe("Your Hub session has expired.");
    expect((error as Error).message).not.toContain("sensitive-response-canary");
  });

  it("rejects disabled accounts and revoked sessions returned by a malformed Hub", async () => {
    const api = new HostedHubApi();
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
    const api = new HostedHubApi();
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
    const api = new HostedHubApi();
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
    const api = new HostedHubApi();
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

    const api = new HostedHubApi();
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
    const api = new HostedHubApi();
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
