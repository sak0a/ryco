import { describe, expect, it } from "vite-plus/test";

import { makeHubKeyRotationHttpTransport } from "./HubKeyRotationHttpTransport.ts";

describe("Hub key rotation HTTP transport", () => {
  it("uses credential-free bounded JSON routes", async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
    const transport = makeHubKeyRotationHttpTransport(async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/key-rotations")) {
        return Response.json({
          rotationRequestId: "nrot_CCCCCCCCCCCCCCCCCCCCCC",
          newKeyId: "nkey_DDDDDDDDDDDDDDDDDDDDDD",
          protocolMajor: 1,
          protocolMinor: 1,
          challenge: Buffer.from(new Uint8Array(32).fill(0x55)).toString("base64url"),
          challengeExpiresAt: 1_784_160_030_000,
        });
      }
      return Response.json({ status: "awaiting_owner" });
    });
    const started = await transport.begin({
      hubOrigin: "https://hub.example.com",
      nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
      oldActiveKeyId: "nkey_BBBBBBBBBBBBBBBBBBBBBB",
      newKey: { algorithm: "ed25519", publicKey: new Uint8Array(32).fill(0x11) },
    });
    expect(started.challenge).toHaveLength(32);
    expect(
      await transport.prove({
        hubOrigin: "https://hub.example.com",
        rotationRequestId: started.rotationRequestId,
        challenge: started.challenge,
        signature: new Uint8Array(64).fill(0x22),
      }),
    ).toEqual({ status: "awaiting_owner" });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      challenge: Buffer.from(started.challenge).toString("base64url"),
    });
    for (const request of requests) {
      expect(request.init?.credentials).toBe("omit");
      expect(request.init?.cache).toBe("no-store");
      expect(request.init?.headers).not.toHaveProperty("cookie");
      expect(request.init?.headers).not.toHaveProperty("authorization");
    }
  });

  it("rejects malformed challenge and status bodies", async () => {
    const malformed = makeHubKeyRotationHttpTransport(async () =>
      Response.json({ status: "unknown" }),
    );
    await expect(
      malformed.status({
        hubOrigin: "https://hub.example.com",
        rotationRequestId: "nrot_CCCCCCCCCCCCCCCCCCCCCC",
      }),
    ).rejects.toMatchObject({ code: "rotation_transport_failed" });

    const invalidLength = makeHubKeyRotationHttpTransport(
      async () =>
        new Response('{"status":"awaiting_owner"}', {
          headers: { "content-length": "invalid" },
        }),
    );
    await expect(
      invalidLength.status({
        hubOrigin: "https://hub.example.com",
        rotationRequestId: "nrot_CCCCCCCCCCCCCCCCCCCCCC",
      }),
    ).rejects.toMatchObject({ code: "rotation_transport_failed" });
  });
});
