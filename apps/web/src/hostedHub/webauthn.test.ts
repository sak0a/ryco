import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { encodeBase64Url } from "./base64url";
import { createPasskeyRegistration, getPasskeyAuthentication } from "./webauthn";

const originalNavigator = globalThis.navigator;
const originalCredential = globalThis.PublicKeyCredential;
const originalAssertion = globalThis.AuthenticatorAssertionResponse;
const originalAttestation = globalThis.AuthenticatorAttestationResponse;

class MockAssertion {
  clientDataJSON = new Uint8Array([1, 2]).buffer;
  authenticatorData = new Uint8Array([3, 4]).buffer;
  signature = new Uint8Array([5, 6]).buffer;
  userHandle = new Uint8Array([7]).buffer;
}

class MockCredential {
  id = "credential-id";
  rawId = new Uint8Array([8, 9]).buffer;
  response: MockAssertion | MockAttestation = new MockAssertion();
  authenticatorAttachment = "platform";
  getClientExtensionResults() {
    return {};
  }
}

class MockAttestation {
  clientDataJSON = new Uint8Array([1, 2]).buffer;
  attestationObject = new Uint8Array([3, 4]).buffer;
  getTransports() {
    return ["internal", "unsupported"];
  }
  getPublicKeyAlgorithm() {
    return -7;
  }
  getPublicKey() {
    return new Uint8Array([5, 6]).buffer;
  }
  getAuthenticatorData() {
    return new Uint8Array([7, 8]).buffer;
  }
}

class MockRegistrationCredential extends MockCredential {
  override response = new MockAttestation();
}

beforeEach(() => {
  globalThis.PublicKeyCredential = MockCredential as unknown as typeof PublicKeyCredential;
  globalThis.AuthenticatorAssertionResponse =
    MockAssertion as unknown as typeof AuthenticatorAssertionResponse;
  globalThis.AuthenticatorAttestationResponse =
    MockAttestation as unknown as typeof AuthenticatorAttestationResponse;
});

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  globalThis.PublicKeyCredential = originalCredential;
  globalThis.AuthenticatorAssertionResponse = originalAssertion;
  globalThis.AuthenticatorAttestationResponse = originalAttestation;
  vi.restoreAllMocks();
});

describe("hosted passkey authentication", () => {
  it("converts Hub JSON options and returns the existing WebAuthn transcript shape", async () => {
    const get = vi.fn(async (_options: CredentialRequestOptions) => new MockCredential());
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { credentials: { get } },
    });
    const challenge = encodeBase64Url(new Uint8Array([10, 11, 12]));
    const response = await getPasskeyAuthentication({
      challenge,
      rpId: "example.test",
      allowCredentials: [{ id: encodeBase64Url(new Uint8Array([13])), type: "public-key" }],
      userVerification: "required",
    });
    const request = get.mock.calls[0]![0];
    const requestChallenge = request.publicKey!.challenge;
    const challengeBytes =
      requestChallenge instanceof ArrayBuffer
        ? new Uint8Array(requestChallenge)
        : new Uint8Array(
            requestChallenge.buffer,
            requestChallenge.byteOffset,
            requestChallenge.byteLength,
          );
    expect([...challengeBytes]).toEqual([10, 11, 12]);
    expect(request.publicKey?.rpId).toBe("example.test");
    expect(response).toMatchObject({
      id: "credential-id",
      response: {
        clientDataJSON: encodeBase64Url(new Uint8Array([1, 2])),
        authenticatorData: encodeBase64Url(new Uint8Array([3, 4])),
        signature: encodeBase64Url(new Uint8Array([5, 6])),
      },
      type: "public-key",
      authenticatorAttachment: "platform",
    });
  });

  it("rejects malformed options before opening a ceremony", async () => {
    const get = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { credentials: { get } },
    });
    await expect(getPasskeyAuthentication({ challenge: "%%%" })).rejects.toThrow(
      "Invalid encoded material",
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("uses the Hub registration ceremony and returns its existing transcript shape", async () => {
    const create = vi.fn(
      async (_options: CredentialCreationOptions) => new MockRegistrationCredential(),
    );
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { credentials: { create } },
    });
    const response = await createPasskeyRegistration({
      challenge: encodeBase64Url(new Uint8Array([10, 11])),
      rp: { id: "example.test", name: "Ryco Hub" },
      user: {
        id: encodeBase64Url(new Uint8Array([12, 13])),
        name: "ada",
        displayName: "Ada",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    });
    const request = create.mock.calls[0]![0].publicKey!;
    expect(request.rp.id).toBe("example.test");
    const userId = request.user.id;
    const userIdBytes =
      userId instanceof ArrayBuffer
        ? new Uint8Array(userId)
        : new Uint8Array(userId.buffer, userId.byteOffset, userId.byteLength);
    expect([...userIdBytes]).toEqual([12, 13]);
    expect(response).toMatchObject({
      id: "credential-id",
      response: {
        clientDataJSON: encodeBase64Url(new Uint8Array([1, 2])),
        attestationObject: encodeBase64Url(new Uint8Array([3, 4])),
        transports: ["internal"],
        publicKeyAlgorithm: -7,
      },
      type: "public-key",
    });
  });

  it("passes cancellation signals to the browser ceremony", async () => {
    const get = vi.fn(async (options: CredentialRequestOptions) => {
      expect(options.signal?.aborted).toBe(true);
      throw new DOMException("cancelled", "AbortError");
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { credentials: { get } },
    });
    const operation = new AbortController();
    operation.abort();
    await expect(
      getPasskeyAuthentication(
        { challenge: encodeBase64Url(new Uint8Array([1])) },
        operation.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
