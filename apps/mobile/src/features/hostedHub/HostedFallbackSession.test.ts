import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  openAuthSessionAsync: vi.fn(
    async (_url: string, _redirectUrl: string | null, _options?: unknown) => ({ type: "cancel" }),
  ),
  createURL: vi.fn((path: string) => `ryco://${path}`),
  readMobileHostedConfig: vi.fn<
    () => { hubOrigin: string; appUrl: string | null; relyingParty: string } | null
  >(() => null),
}));

vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: mocks.openAuthSessionAsync }));
vi.mock("expo-linking", () => ({ createURL: mocks.createURL }));
// Mocked, not merely injected: the real module reads `expo-constants` at import
// time, and nothing in this suite should need the native bridge.
vi.mock("../../platform/config", () => ({
  readMobileHostedConfig: mocks.readMobileHostedConfig,
}));

// Transport-separation tripwire: the fallback session must never reach the
// native session-credentials adapter, so loading it at all — directly or through
// any module it imports — fails the suite rather than passing quietly.
vi.mock("../../platform/sessionCredentials", () => {
  throw new Error("the hosted fallback session must not load the session-credentials adapter");
});

import {
  HOSTED_FALLBACK_REDIRECT_PATH,
  openHostedFallbackSession,
  resolveHostedFallbackUrl,
  type HostedFallbackConfig,
  type HostedFallbackResult,
  type OpenHostedFallbackBrowser,
} from "./HostedFallbackSession";

const HUB_ORIGIN = "https://hub.ryco.dev";
const APP_ORIGIN = "https://app.ryco.dev";

function config(overrides: Partial<HostedFallbackConfig> = {}): HostedFallbackConfig {
  return {
    hubOrigin: HUB_ORIGIN,
    appUrl: APP_ORIGIN,
    relyingParty: "app.ryco.dev",
    ...overrides,
  };
}

/** A browser seam that records what it was asked to open. */
function fakeBrowser(result: { type: string; url?: string } = { type: "cancel" }) {
  const calls: { url: string; redirectUrl: string | null }[] = [];
  const open: OpenHostedFallbackBrowser = async (url, redirectUrl) => {
    calls.push({ url, redirectUrl });
    return result as Awaited<ReturnType<OpenHostedFallbackBrowser>>;
  };
  return { calls, open };
}

describe("hosted fallback URL resolution", () => {
  it("derives the browser URL from the configured hosted app origin", () => {
    expect(resolveHostedFallbackUrl(config())).toEqual({
      status: "ok",
      url: "https://app.ryco.dev/",
    });
  });

  it("accepts a hosted app URL served from the Hub origin itself", () => {
    expect(resolveHostedFallbackUrl(config({ appUrl: HUB_ORIGIN }))).toEqual({
      status: "ok",
      url: "https://hub.ryco.dev/",
    });
  });

  it("fails closed when hosted mode is not configured", () => {
    expect(resolveHostedFallbackUrl(null)).toEqual({
      status: "blocked",
      reason: "hosted-mode-unavailable",
    });
    expect(resolveHostedFallbackUrl(undefined)).toEqual({
      status: "blocked",
      reason: "hosted-mode-unavailable",
    });
  });

  it("rejects an unusable Hub origin even when the app URL looks fine", () => {
    for (const hubOrigin of [
      "http://hub.ryco.dev",
      "https://hub.ryco.dev/api",
      "hub.ryco.dev",
      "",
    ]) {
      expect(resolveHostedFallbackUrl(config({ hubOrigin }))).toEqual({
        status: "blocked",
        reason: "hosted-mode-unavailable",
      });
    }
  });

  it("reports a missing hosted app URL separately from a rejected one", () => {
    for (const appUrl of [null, "", "   "]) {
      expect(resolveHostedFallbackUrl(config({ appUrl }))).toEqual({
        status: "blocked",
        reason: "fallback-url-unconfigured",
      });
    }
  });

  it("rejects a non-https hosted app URL", () => {
    for (const appUrl of ["http://app.ryco.dev", "ftp://app.ryco.dev", "javascript:alert(1)"]) {
      expect(resolveHostedFallbackUrl(config({ appUrl }))).toEqual({
        status: "blocked",
        reason: "fallback-url-rejected",
      });
    }
  });

  it("rejects a host that is neither the Hub nor the relying party", () => {
    for (const appUrl of [
      "https://evil.example",
      "https://app.ryco.dev.evil.example",
      // Same host, different port: a different origin to the Hub.
      "https://hub.ryco.dev:8443",
    ]) {
      expect(resolveHostedFallbackUrl(config({ appUrl, relyingParty: "hub.ryco.dev" }))).toEqual({
        status: "blocked",
        reason: "fallback-url-rejected",
      });
    }
  });

  it("rejects a query-bearing or fragment-bearing app URL", () => {
    // Query and fragment are how state would smuggle into the fallback flow, so
    // they stay forbidden even though a path is allowed.
    for (const appUrl of [
      "https://app.ryco.dev/?next=%2Fnodes",
      "https://app.ryco.dev/#token=abc",
      "https://app.ryco.dev/?token=abc",
      "https://app.ryco.dev/sign-in?token=abc",
    ]) {
      expect(resolveHostedFallbackUrl(config({ appUrl }))).toEqual({
        status: "blocked",
        reason: "fallback-url-rejected",
      });
    }
  });

  it("keeps a configured path, matching what platform config admits", () => {
    // `platform/config.ts` validates `appUrl` allowing a path — the Hub's web
    // app need not sit at the root — so this layer must not silently drop it.
    expect(resolveHostedFallbackUrl(config({ appUrl: "https://app.ryco.dev/sign-in" }))).toEqual({
      status: "ok",
      url: "https://app.ryco.dev/sign-in",
    });
  });

  it("rejects an app URL carrying embedded credentials or no scheme at all", () => {
    for (const appUrl of ["https://user:secret@app.ryco.dev", "app.ryco.dev", "//app.ryco.dev"]) {
      expect(resolveHostedFallbackUrl(config({ appUrl }))).toEqual({
        status: "blocked",
        reason: "fallback-url-rejected",
      });
    }
  });

  it("ignores a relying party that is not a bare host", () => {
    for (const relyingParty of ["https://app.ryco.dev", "app.ryco.dev/x", "app.ryco.dev:443", ""]) {
      expect(resolveHostedFallbackUrl(config({ relyingParty }))).toEqual({
        status: "blocked",
        reason: "fallback-url-rejected",
      });
    }
  });

  it("produces a URL that carries no credential material", () => {
    const resolution = resolveHostedFallbackUrl(config());

    expect(resolution.status).toBe("ok");
    const url = resolution.status === "ok" ? resolution.url : "";
    expect(url).toBe("https://app.ryco.dev/");
    for (const fragment of ["?", "#", "token", "proof", "dpop", "ath", "ticket", "session"]) {
      expect(url.toLowerCase()).not.toContain(fragment);
    }
  });
});

describe("hosted fallback session handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openAuthSessionAsync.mockResolvedValue({ type: "cancel" });
    mocks.createURL.mockImplementation((path: string) => `ryco://${path}`);
  });

  it("opens exactly the config-derived URL", async () => {
    const browser = fakeBrowser();

    await openHostedFallbackSession({
      config: config(),
      openBrowser: browser.open,
      resolveRedirectUrl: () => "ryco://hosted/complete",
      completeWithNativeSignIn: () => undefined,
    });

    expect(browser.calls).toEqual([
      { url: "https://app.ryco.dev/", redirectUrl: "ryco://hosted/complete" },
    ]);
  });

  it("takes no URL from its caller", async () => {
    const browser = fakeBrowser();
    // A caller cannot supply a URL: the input carries none, and a smuggled one
    // is not read. This is the "no URL that is not derived from config" rule.
    const smuggled = {
      config: config(),
      openBrowser: browser.open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: () => undefined,
      url: "https://evil.example/",
      appUrl: "https://evil.example/",
    } as Parameters<typeof openHostedFallbackSession>[0];

    await openHostedFallbackSession(smuggled);

    expect(browser.calls[0]?.url).toBe("https://app.ryco.dev/");
  });

  it("runs the native passkey sign-in after a redirect", async () => {
    const signIn = vi.fn(async () => undefined);
    const browser = fakeBrowser({ type: "success", url: "ryco://hosted/complete" });

    const result = await openHostedFallbackSession({
      config: config(),
      openBrowser: browser.open,
      resolveRedirectUrl: () => "ryco://hosted/complete",
      completeWithNativeSignIn: signIn,
    });

    expect(result).toEqual({ status: "native-sign-in-attempted", returnedVia: "redirect" });
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("runs the same native passkey sign-in after a dismissal", async () => {
    for (const type of ["cancel", "dismiss", "opened"]) {
      const signIn = vi.fn(async () => undefined);
      const browser = fakeBrowser({ type });

      const result = await openHostedFallbackSession({
        config: config(),
        openBrowser: browser.open,
        resolveRedirectUrl: () => null,
        completeWithNativeSignIn: signIn,
      });

      expect(result).toEqual({ status: "native-sign-in-attempted", returnedVia: "dismissed" });
      expect(signIn).toHaveBeenCalledTimes(1);
    }
  });

  it("reaches an identical next step from the redirect and dismissal paths", async () => {
    const results: HostedFallbackResult[] = [];
    const signIn = vi.fn(async () => undefined);

    for (const result of [{ type: "success", url: "ryco://hosted/complete" }, { type: "cancel" }]) {
      results.push(
        await openHostedFallbackSession({
          config: config(),
          openBrowser: fakeBrowser(result).open,
          resolveRedirectUrl: () => null,
          completeWithNativeSignIn: signIn,
        }),
      );
    }

    expect(results.map((entry) => entry.status)).toEqual([
      "native-sign-in-attempted",
      "native-sign-in-attempted",
    ]);
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("never adopts anything the browser hands back", async () => {
    const signIn = vi.fn(async () => undefined);
    const browser = fakeBrowser({
      type: "success",
      url: "ryco://hosted/complete?token=leaked-bearer-token&code=stolen-code#csrf=nope",
    });

    const result = await openHostedFallbackSession({
      config: config(),
      openBrowser: browser.open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: signIn,
    });

    const serialized = JSON.stringify(result);
    for (const secret of ["leaked-bearer-token", "stolen-code", "csrf", "token"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(result).toEqual({ status: "native-sign-in-attempted", returnedVia: "redirect" });
  });

  it("does not open a browser or sign in when hosted mode is unavailable", async () => {
    const signIn = vi.fn(async () => undefined);
    const browser = fakeBrowser();

    const result = await openHostedFallbackSession({
      config: null,
      openBrowser: browser.open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: signIn,
    });

    expect(result).toEqual({ status: "not-started", reason: "hosted-mode-unavailable" });
    expect(browser.calls).toEqual([]);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not sign in when the app URL fails validation", async () => {
    const signIn = vi.fn(async () => undefined);
    const browser = fakeBrowser();

    const result = await openHostedFallbackSession({
      config: config({ appUrl: "http://app.ryco.dev" }),
      openBrowser: browser.open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: signIn,
    });

    expect(result).toEqual({ status: "not-started", reason: "fallback-url-rejected" });
    expect(browser.calls).toEqual([]);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("fails closed with a bounded reason when the browser throws", async () => {
    const signIn = vi.fn(async () => undefined);

    const result = await openHostedFallbackSession({
      config: config(),
      openBrowser: async () => {
        throw new Error("WebBrowser is already open at https://app.ryco.dev/?state=secret");
      },
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: signIn,
    });

    expect(result).toEqual({ status: "not-started", reason: "browser-unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not sign in when another auth session already holds the browser", async () => {
    const signIn = vi.fn(async () => undefined);

    const result = await openHostedFallbackSession({
      config: config(),
      openBrowser: fakeBrowser({ type: "locked" }).open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: signIn,
    });

    expect(result).toEqual({ status: "not-started", reason: "browser-unavailable" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("refuses a redirect URL that is not an app-owned deep link", async () => {
    for (const redirectUrl of [
      "https://app.ryco.dev/callback",
      "http://app.ryco.dev/callback",
      "hosted/complete",
      "ryco://hosted /complete",
      "",
    ]) {
      const browser = fakeBrowser();

      await openHostedFallbackSession({
        config: config(),
        openBrowser: browser.open,
        resolveRedirectUrl: () => redirectUrl,
        completeWithNativeSignIn: () => undefined,
      });

      expect(browser.calls[0]?.redirectUrl).toBeNull();
    }
  });

  it("still opens the session when the redirect URL cannot be resolved", async () => {
    const browser = fakeBrowser();

    const result = await openHostedFallbackSession({
      config: config(),
      openBrowser: browser.open,
      resolveRedirectUrl: () => {
        throw new Error("no scheme");
      },
      completeWithNativeSignIn: () => undefined,
    });

    expect(browser.calls[0]).toEqual({ url: "https://app.ryco.dev/", redirectUrl: null });
    expect(result.status).toBe("native-sign-in-attempted");
  });
});

describe("hosted fallback platform wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openAuthSessionAsync.mockResolvedValue({ type: "cancel" });
    mocks.createURL.mockImplementation((path: string) => `ryco://${path}`);
  });

  it("opens an ephemeral system auth session at the build's own deep link", async () => {
    const result = await openHostedFallbackSession({
      config: config(),
      completeWithNativeSignIn: () => undefined,
    });

    expect(mocks.createURL).toHaveBeenCalledWith(HOSTED_FALLBACK_REDIRECT_PATH);
    expect(mocks.openAuthSessionAsync).toHaveBeenCalledWith(
      "https://app.ryco.dev/",
      "ryco://hosted/complete",
      { preferEphemeralSession: true },
    );
    expect(result).toEqual({ status: "native-sign-in-attempted", returnedVia: "dismissed" });
  });
});

describe("hosted fallback configuration source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openAuthSessionAsync.mockResolvedValue({ type: "cancel" });
    mocks.createURL.mockImplementation((path: string) => `ryco://${path}`);
    mocks.readMobileHostedConfig.mockReturnValue(null);
  });

  it("reads the build's hosted configuration when none is injected", async () => {
    mocks.readMobileHostedConfig.mockReturnValue(config());
    const browser = fakeBrowser();

    const result = await openHostedFallbackSession({
      openBrowser: browser.open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: () => undefined,
    });

    expect(browser.calls[0]?.url).toBe("https://app.ryco.dev/");
    expect(result.status).toBe("native-sign-in-attempted");
  });

  it("fails closed when the build has no hosted configuration", async () => {
    const browser = fakeBrowser();

    const result = await openHostedFallbackSession({
      openBrowser: browser.open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: () => undefined,
    });

    expect(result).toEqual({ status: "not-started", reason: "hosted-mode-unavailable" });
    expect(browser.calls).toEqual([]);
  });

  it("fails closed when the configuration cannot be read at all", async () => {
    mocks.readMobileHostedConfig.mockImplementation(() => {
      throw new Error("expo-constants unavailable");
    });
    const browser = fakeBrowser();

    const result = await openHostedFallbackSession({
      openBrowser: browser.open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: () => undefined,
    });

    expect(result).toEqual({ status: "not-started", reason: "hosted-mode-unavailable" });
    expect(browser.calls).toEqual([]);
  });
});

describe("hosted fallback transport separation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openAuthSessionAsync.mockResolvedValue({ type: "cancel" });
    mocks.createURL.mockImplementation((path: string) => `ryco://${path}`);
  });

  it("exposes only the fallback surface", async () => {
    // Nothing here can carry a cookie, a session, or a CSRF token anywhere: the
    // module's whole surface is a URL validator, the deep-link path, and the
    // browser handoff.
    const module = await import("./HostedFallbackSession");

    expect(Object.keys(module).toSorted()).toEqual([
      "HOSTED_FALLBACK_REDIRECT_PATH",
      "openHostedFallbackSession",
      "resolveHostedFallbackUrl",
    ]);
  });

  it("never loads the native session-credentials adapter", async () => {
    // The tripwire is the `vi.mock` at the top of this file: it throws if this
    // module's graph — including its lazy imports — ever pulls the adapter in.
    // Exercising the default platform wiring is what makes that reachable.
    const result = await openHostedFallbackSession({
      config: config(),
      completeWithNativeSignIn: () => undefined,
    });

    expect(result).toEqual({ status: "native-sign-in-attempted", returnedVia: "dismissed" });
  });

  it("cannot be handed a credential writer", async () => {
    const credentials = {
      readBearerToken: vi.fn(() => "native-session-token"),
      writeBearerToken: vi.fn(),
      readCsrfToken: vi.fn(() => "csrf"),
      writeCsrfToken: vi.fn(),
    };
    // Not part of the input contract; smuggled in to prove it is inert.
    const smuggled = {
      config: config(),
      openBrowser: fakeBrowser({
        type: "success",
        url: "ryco://hosted/complete?token=browser-token",
      }).open,
      resolveRedirectUrl: () => null,
      completeWithNativeSignIn: () => undefined,
      sessionCredentials: credentials,
    } as Parameters<typeof openHostedFallbackSession>[0];

    const result = await openHostedFallbackSession(smuggled);

    expect(result.status).toBe("native-sign-in-attempted");
    for (const accessor of Object.values(credentials)) {
      expect(accessor).not.toHaveBeenCalled();
    }
  });
});
