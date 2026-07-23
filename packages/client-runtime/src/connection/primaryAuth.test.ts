import { describe, expect, it, vi } from "vite-plus/test";

import { createPrimaryAuth } from "./primaryAuth.ts";

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const session = {
  authenticated: false,
  auth: {
    policy: "local-only",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie"],
    sessionCookieName: "ryco_session",
  },
};

describe("primary auth platform fakes", () => {
  it("uses one take-once pairing source and destroys it before the credential escapes", async () => {
    let pairingCredential: string | null = "pairing-token";
    const take = vi.fn(async () => {
      const value = pairingCredential;
      pairingCredential = null;
      return value;
    });
    const auth = createPrimaryAuth({
      endpoint: {
        origin: () => "https://app.test",
        readPrimaryTarget: () => null,
        resolveHttpUrl: (path) => `https://app.test${path}`,
        resolveWsUrl: (url) => url,
      },
      httpClient: { fetch: async () => response(session) },
      pairingCredentialSource: { take },
      readBootstrapCredential: () => null,
      sessionCredentials: {
        mode: "cookie",
        readCsrfToken: () => null,
        writeCsrfToken: () => undefined,
      },
    });

    expect(await auth.takePairingCredential()).toBe("pairing-token");
    expect(pairingCredential).toBeNull();
    expect(await auth.takePairingCredential()).toBeNull();
    expect(take).toHaveBeenCalledTimes(2);
  });

  it("single-flights silent desktop bootstrap and retries transient session reads with injected timing", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/api/auth/session")) {
        attempts += 1;
        if (attempts === 1) return response("temporarily unavailable", 503);
        if (attempts === 2) return response(session);
        return response({ ...session, authenticated: true });
      }
      return response({ authenticated: true });
    });
    const auth = createPrimaryAuth({
      endpoint: {
        origin: () => "https://app.test",
        readPrimaryTarget: () => null,
        resolveHttpUrl: (path) => `https://app.test${path}`,
        resolveWsUrl: (url) => url,
      },
      httpClient: { fetch },
      pairingCredentialSource: { take: async () => null },
      readBootstrapCredential: () => "desktop-bootstrap-token",
      sessionCredentials: {
        mode: "cookie",
        readCsrfToken: () => null,
        writeCsrfToken: () => undefined,
      },
      sleep,
    });

    const [left, right] = await Promise.all([
      auth.resolveInitialServerAuthGateState(),
      auth.resolveInitialServerAuthGateState(),
    ]);
    expect(left).toEqual({ status: "authenticated" });
    expect(right).toEqual({ status: "authenticated" });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://app.test/api/auth/bootstrap",
      expect.objectContaining({ body: JSON.stringify({ credential: "desktop-bootstrap-token" }) }),
    );
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("submits a manually entered pairing credential through the same fake HTTP boundary", async () => {
    const fetch = vi.fn(async () => response({ authenticated: true }));
    const auth = createPrimaryAuth({
      endpoint: {
        origin: () => "https://app.test",
        readPrimaryTarget: () => null,
        resolveHttpUrl: (path) => `https://app.test${path}`,
        resolveWsUrl: (url) => url,
      },
      httpClient: { fetch },
      pairingCredentialSource: { take: async () => null },
      readBootstrapCredential: () => null,
      sessionCredentials: {
        mode: "cookie",
        readCsrfToken: () => null,
        writeCsrfToken: () => undefined,
      },
    });

    await auth.submitServerAuthCredential("  manual-pairing-token  ");
    expect(fetch).toHaveBeenCalledWith(
      "https://app.test/api/auth/bootstrap",
      expect.objectContaining({ body: JSON.stringify({ credential: "manual-pairing-token" }) }),
    );
  });
});
