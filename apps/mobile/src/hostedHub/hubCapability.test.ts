import type { HttpClientService } from "@ryco/client-runtime/platform";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createHubCapabilityClient,
  decodeHubCapability,
  HUB_CAPABILITY_PATH,
} from "./hubCapability";

const ORIGIN = "https://hub.ryco.dev";

function document(overrides: Record<string, unknown> = {}) {
  return {
    service: "ryco-hub",
    protocolVersion: 1,
    nativeHandoff: { mode: "system-browser", version: 1 },
    relyingParty: { id: "hub.ryco.dev", displayName: "Studio Hub" },
    ...overrides,
  };
}

function clientResponse(body: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return {
    fetch,
    client: createHubCapabilityClient({ fetch } as HttpClientService, () => 1234),
  };
}

describe("Hub capability decoder", () => {
  it("accepts only the canonical bounded public compatibility document", () => {
    const decoded = decodeHubCapability(document(), ORIGIN);
    expect(decoded).toEqual({
      ok: true,
      capability: {
        protocolVersion: 1,
        nativeHandoff: { mode: "system-browser", version: 1 },
        relyingParty: { id: "hub.ryco.dev", displayName: "Studio Hub" },
      },
    });
    expect(decodeHubCapability(document({ token: "must-not-project" }), ORIGIN)).toEqual({
      ok: false,
      reason: "invalid-document",
    });
  });

  it("projects the exact optional native identity policy without weakening v1", () => {
    const nativeIdentity = {
      version: 2,
      email: { verification: "required", antiBot: { provider: "bypass" } },
      signup: { status: "enabled", primaryCredentials: ["passkey", "password"] },
      login: {
        methods: ["passkey", "password", "recovery_code"],
        passwordSecondFactor: {
          totp: "when_enrolled",
          fallback: "verified_email_code",
        },
      },
      recovery: { recoveryCode: true, passwordReset: true },
    } as const;
    expect(decodeHubCapability(document({ nativeIdentity }), ORIGIN)).toEqual({
      ok: true,
      capability: {
        protocolVersion: 1,
        nativeHandoff: { mode: "system-browser", version: 1 },
        relyingParty: { id: "hub.ryco.dev", displayName: "Studio Hub" },
        nativeIdentity,
      },
    });
  });

  it("rejects a relying party outside the Hub domain", () => {
    expect(
      decodeHubCapability(
        document({ relyingParty: { id: "attacker.example", displayName: "No" } }),
        ORIGIN,
      ),
    ).toEqual({ ok: false, reason: "invalid-relying-party" });
  });

  it("rejects malformed and overlong public metadata", () => {
    expect(decodeHubCapability(null, ORIGIN)).toEqual({
      ok: false,
      reason: "invalid-document",
    });
    expect(
      decodeHubCapability(
        document({ relyingParty: { id: "hub.ryco.dev", displayName: "x".repeat(65) } }),
        ORIGIN,
      ),
    ).toEqual({ ok: false, reason: "invalid-document" });
  });
});

describe("Hub capability client", () => {
  it("fetches the bounded unauthenticated well-known document", async () => {
    const { client, fetch } = clientResponse(document());
    await expect(client.check(ORIGIN)).resolves.toMatchObject({
      status: "compatible",
      checkedAt: 1234,
    });
    expect(fetch).toHaveBeenCalledWith(`${ORIGIN}${HUB_CAPABILITY_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
  });

  it("reports protocol and handoff incompatibility with stable reasons", async () => {
    const unsupportedProtocol = clientResponse(document({ protocolVersion: 2 })).client;
    await expect(unsupportedProtocol.check(ORIGIN)).resolves.toEqual({
      status: "incompatible",
      checkedAt: 1234,
      reason: "unsupported-protocol",
    });

    const unsupportedHandoff = clientResponse(
      document({ nativeHandoff: { mode: "embedded-webview", version: 1 } }),
    ).client;
    await expect(unsupportedHandoff.check(ORIGIN)).resolves.toEqual({
      status: "incompatible",
      checkedAt: 1234,
      reason: "unsupported-handoff",
    });
  });

  it("bounds network, status, parsing, and response-size failures", async () => {
    const unreachable = createHubCapabilityClient(
      {
        fetch: async () => {
          throw new Error("raw network details");
        },
      },
      () => 1234,
    );
    await expect(unreachable.check(ORIGIN)).resolves.toEqual({
      status: "incompatible",
      checkedAt: 1234,
      reason: "unreachable",
    });

    await expect(clientResponse({}, 404).client.check(ORIGIN)).resolves.toMatchObject({
      reason: "capability-not-found",
    });
    const invalidJson = createHubCapabilityClient(
      {
        fetch: async () => new Response("{", { status: 200 }),
      },
      () => 1234,
    );
    await expect(invalidJson.check(ORIGIN)).resolves.toMatchObject({
      reason: "invalid-document",
    });
    const oversized = createHubCapabilityClient(
      {
        fetch: async () => new Response("x".repeat(16_385), { status: 200 }),
      },
      () => 1234,
    );
    await expect(oversized.check(ORIGIN)).resolves.toMatchObject({
      reason: "invalid-document",
    });
  });
});
