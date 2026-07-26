import { describe, expect, it } from "vite-plus/test";

import { makeHubEnrollmentHttpTransport } from "./HubEnrollmentHttpTransport.ts";

const publicKey = {
  algorithm: "ed25519",
  publicKey: new Uint8Array(32).fill(0x21),
  fingerprint: new Uint8Array(32).fill(0x31),
} as const;

describe("Hub enrollment HTTP transport", () => {
  it("posts bounded public metadata without ambient credentials", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const transport = makeHubEnrollmentHttpTransport(async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        deviceCode: "ABCD-EFGH",
        pollingSecret: Buffer.from(new Uint8Array(32).fill(0x73)).toString("base64url"),
        expiresAt: 1_784_160_600_000,
        pollIntervalMs: 5_000,
      });
    });
    const result = await transport.start({
      hubOrigin: "https://hub.example.com",
      environmentId: "env_AAAAAAAAAAAAAAAAAAAAAA",
      label: "Build node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
      publicKey,
    });
    expect(result.deviceCode).toBe("ABCD-EFGH");
    expect(capturedUrl).toBe("https://hub.example.com/api/node/enrollments");
    expect(capturedInit?.credentials).toBe("omit");
    expect(capturedInit?.cache).toBe("no-store");
    expect(capturedInit?.headers).not.toHaveProperty("cookie");
    expect(capturedInit?.headers).not.toHaveProperty("authorization");
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("fingerprint");
    expect(body).not.toHaveProperty("privateKey");
    expect(body.publicKey).toBe(Buffer.from(publicKey.publicKey).toString("base64url"));
  });

  it("polls with the independent bearer and maps unavailable uniformly", async () => {
    let body: Record<string, unknown> = {};
    const transport = makeHubEnrollmentHttpTransport(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ error: "enrollment_unavailable" }, { status: 404 });
    });
    expect(
      await transport.poll({
        hubOrigin: "https://hub.example.com",
        pollingSecret: new Uint8Array(32).fill(0x44),
      }),
    ).toEqual({ status: "unavailable", reason: "rejected" });
    expect(body.pollingSecret).toBe(
      Buffer.from(new Uint8Array(32).fill(0x44)).toString("base64url"),
    );
  });

  it("requires the enrollment protocol marker on unavailable HTTP responses", async () => {
    for (const status of [404, 410]) {
      const transport = makeHubEnrollmentHttpTransport(async () =>
        Response.json({ error: "generic_not_found" }, { status }),
      );
      await expect(
        transport.poll({
          hubOrigin: "https://hub.example.com",
          pollingSecret: new Uint8Array(32),
        }),
      ).rejects.toMatchObject({ code: "enrollment_transport_failed" });
    }
  });

  it("aborts a stalled request at the configured deadline", async () => {
    const transport = makeHubEnrollmentHttpTransport(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
      { timeoutMs: 5 },
    );
    await expect(
      transport.poll({
        hubOrigin: "https://hub.example.com",
        pollingSecret: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "enrollment_transport_failed" });
  });

  it("rejects oversized, malformed, and noncanonical bearer responses", async () => {
    const oversized = makeHubEnrollmentHttpTransport(
      async () => new Response("x", { headers: { "content-length": String(16 * 1024 + 1) } }),
    );
    await expect(
      oversized.start({
        hubOrigin: "https://hub.example.com",
        environmentId: "env_AAAAAAAAAAAAAAAAAAAAAA",
        label: "Build node",
        platformOs: "linux",
        platformArch: "x64",
        clientVersion: "0.1.8",
        publicKey,
      }),
    ).rejects.toMatchObject({ code: "enrollment_transport_failed" });

    const malformed = makeHubEnrollmentHttpTransport(async () =>
      Response.json({ status: "approved" }),
    );
    await expect(
      malformed.poll({
        hubOrigin: "https://hub.example.com",
        pollingSecret: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "enrollment_transport_failed" });

    const noncanonicalBearer = makeHubEnrollmentHttpTransport(async () =>
      Response.json({
        deviceCode: "ABCD-EFGH",
        pollingSecret: `${Buffer.from(new Uint8Array(32)).toString("base64url")}=`,
        expiresAt: 1_784_160_600_000,
        pollIntervalMs: 5_000,
      }),
    );
    await expect(
      noncanonicalBearer.start({
        hubOrigin: "https://hub.example.com",
        environmentId: "env_AAAAAAAAAAAAAAAAAAAAAA",
        label: "Build node",
        platformOs: "linux",
        platformArch: "x64",
        clientVersion: "0.1.8",
        publicKey,
      }),
    ).rejects.toMatchObject({ code: "enrollment_transport_failed" });
  });
});
