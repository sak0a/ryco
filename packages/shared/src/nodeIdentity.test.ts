import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { decode } from "cborg";
import { describe, expect, it } from "vite-plus/test";

import {
  canonicalizeHubOrigin,
  encodeNativeNodeClaimTranscript,
  encodeNodeAuthenticationTranscript,
  encodeNodeKeyRotationTranscript,
  equalNodeIdentityBytes,
  fingerprintNodePublicKey,
  formatNodePublicKeyFingerprint,
  HUB_NODE_NAME_MAX_LENGTH,
  NodeIdentityValidationError,
  normalizeHubNodeName,
  validateNodePublicKey,
} from "./nodeIdentity.ts";

const FIXTURE_SEED = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);
const FIXTURE_PUBLIC_KEY = Buffer.from(
  "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
  "hex",
);
const FIXTURE_FINGERPRINT = "0156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b64";
const FIXTURE_AUTH_TRANSCRIPT =
  "88777279636f2e6e6f64652d617574682e70726f6f662e76317768747470733a2f2f6875622e6578616d706c652e636f6d0101781b6e6f64655f41414141414141414141414141414141414141414141781b6e6b65795f424242424242424242424242424242424242424242421b0000019f68398d305820" +
  "5a".repeat(32);
const FIXTURE_AUTH_SIGNATURE =
  "0790afefd8eefd51b8ed76b3f33e0bca013154432b84729c3afd6cff721414c33a223d9a921f7651a9ab88335b5a0b6cbac7f7f480e284f66e5bfd75dd764108";
const FIXTURE_ROTATION_TRANSCRIPT =
  "8d781f7279636f2e6e6f64652d6b65792d726f746174696f6e2e70726f6f662e76317768747470733a2f2f6875622e6578616d706c652e636f6d0101781b6e726f745f43434343434343434343434343434343434343434343781b6e6f64655f41414141414141414141414141414141414141414141781b6e6b65795f42424242424242424242424242424242424242424242781b6e6b65795f444444444444444444444444444444444444444444446765643235353139582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b858200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b641b0000019f68398d305820a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5";
const FIXTURE_ROTATION_SIGNATURE =
  "6fba20967db2bcacdb2c6af8797f55bd5cb70f9e8b58cea773c6dea20cbf9ca0139514086e43119e6cd93011b6f71d807c2923985841f2f5dcfe2abd16e5270f";
const FIXTURE_CLAIM_TRANSCRIPT =
  "90781f7279636f2e6e61746976652d6e6f64652d636c61696d2e70726f6f662e76317768747470733a2f2f6875622e6578616d706c652e636f6d0101781d6e636c61696d5f43434343434343434343434343434343434343434343781b616363745f44444444444444444444444444444444444444444444781c73706163655f45454545454545454545454545454545454545454545781b736573735f4646464646464646464646464646464646464646464658206b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b781e696e7374616c6c5f474747474747474747474747474747474747474747476c6465736b746f702d6d61696e6765643235353139582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b858200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b641b0000019f68398d3058207c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c";
const FIXTURE_CLAIM_SIGNATURE =
  "19afacad6f4aa9acb48e7aa46959131ebbadf24cc91ccfc36ede0b1f30b175dc69b2f40ab6ecd9a7378428ad25560434c1a0f93cd350f06c576a5df48480790a";

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), FIXTURE_SEED]),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(privateKey);

const authInput = {
  hubOrigin: "https://hub.example.com",
  protocolMajor: 1,
  protocolMinor: 1,
  nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
  activeKeyId: "nkey_BBBBBBBBBBBBBBBBBBBBBB",
  challengeExpiresAt: 1_784_160_030_000,
  challenge: new Uint8Array(32).fill(0x5a),
} as const;

const rotationInput = {
  hubOrigin: "https://hub.example.com",
  protocolMajor: 1,
  protocolMinor: 1,
  rotationRequestId: "nrot_CCCCCCCCCCCCCCCCCCCCCC",
  nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
  oldActiveKeyId: "nkey_BBBBBBBBBBBBBBBBBBBBBB",
  newKeyId: "nkey_DDDDDDDDDDDDDDDDDDDDDD",
  newKey: { algorithm: "ed25519", publicKey: FIXTURE_PUBLIC_KEY },
  challengeExpiresAt: 1_784_160_030_000,
  challenge: new Uint8Array(32).fill(0xa5),
} as const;

const claimInput = {
  hubOrigin: "https://hub.example.com",
  protocolVersion: 1,
  transcriptVersion: 1,
  claimId: "nclaim_CCCCCCCCCCCCCCCCCCCCCC",
  accountId: "acct_DDDDDDDDDDDDDDDDDDDDDD",
  spaceId: "space_EEEEEEEEEEEEEEEEEEEEEE",
  sessionId: "sess_FFFFFFFFFFFFFFFFFFFFFF",
  dpopKeyThumbprint: new Uint8Array(32).fill(0x6b),
  installationId: "install_GGGGGGGGGGGGGGGGGGGGGG",
  environmentId: "desktop-main",
  nodeKey: { algorithm: "ed25519", publicKey: FIXTURE_PUBLIC_KEY },
  claimExpiresAt: 1_784_160_030_000,
  challenge: new Uint8Array(32).fill(0x7c),
} as const;

describe("node identity canonical cryptography", () => {
  it("matches the deterministic Ed25519 fingerprint fixture", () => {
    const fingerprint = fingerprintNodePublicKey({
      algorithm: "ed25519",
      publicKey: FIXTURE_PUBLIC_KEY,
    });
    expect(Buffer.from(fingerprint).toString("hex")).toBe(FIXTURE_FINGERPRINT);
    expect(formatNodePublicKeyFingerprint(fingerprint)).toBe(
      "SHA256:AVbN7e5vhHl7KLe-gwSBlEg8wXFlsa56_nu8d-7fm2Q",
    );
  });

  it("matches and verifies the deterministic authentication fixture", () => {
    const transcript = encodeNodeAuthenticationTranscript(authInput);
    expect(Buffer.from(transcript).toString("hex")).toBe(FIXTURE_AUTH_TRANSCRIPT);
    const signature = sign(null, transcript, privateKey);
    expect(signature.toString("hex")).toBe(FIXTURE_AUTH_SIGNATURE);
    expect(verify(null, transcript, publicKey, signature)).toBe(true);
  });

  it("matches and verifies the deterministic rotation fixture", () => {
    const transcript = encodeNodeKeyRotationTranscript(rotationInput);
    expect(Buffer.from(transcript).toString("hex")).toBe(FIXTURE_ROTATION_TRANSCRIPT);
    const signature = sign(null, transcript, privateKey);
    expect(signature.toString("hex")).toBe(FIXTURE_ROTATION_SIGNATURE);
    expect(verify(null, transcript, publicKey, signature)).toBe(true);
  });

  it("matches and verifies the deterministic native node-claim fixture", () => {
    const transcript = encodeNativeNodeClaimTranscript(claimInput);
    expect(Buffer.from(transcript).toString("hex")).toBe(FIXTURE_CLAIM_TRANSCRIPT);
    const signature = sign(null, transcript, privateKey);
    expect(signature.toString("hex")).toBe(FIXTURE_CLAIM_SIGNATURE);
    expect(verify(null, transcript, publicKey, signature)).toBe(true);
  });

  it("binds every authentication field", () => {
    const baseline = encodeNodeAuthenticationTranscript(authInput);
    const mutations = [
      { ...authInput, hubOrigin: "https://other.example.com" },
      { ...authInput, protocolMajor: 2 },
      { ...authInput, protocolMinor: 2 },
      { ...authInput, nodeId: "node_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...authInput, activeKeyId: "nkey_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...authInput, challengeExpiresAt: authInput.challengeExpiresAt + 1 },
      { ...authInput, challenge: new Uint8Array(32).fill(0x5b) },
    ];
    for (const mutation of mutations) {
      expect(equalNodeIdentityBytes(baseline, encodeNodeAuthenticationTranscript(mutation))).toBe(
        false,
      );
    }
  });

  it("binds every authority-bearing native node-claim field", () => {
    const baseline = encodeNativeNodeClaimTranscript(claimInput);
    const mutations = [
      { ...claimInput, hubOrigin: "https://other.example.com" },
      { ...claimInput, protocolVersion: 2 },
      { ...claimInput, transcriptVersion: 2 },
      { ...claimInput, claimId: "nclaim_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...claimInput, accountId: "acct_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...claimInput, spaceId: "space_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...claimInput, sessionId: "sess_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...claimInput, dpopKeyThumbprint: new Uint8Array(32).fill(0x6c) },
      { ...claimInput, installationId: "install_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...claimInput, environmentId: "desktop-other" },
      {
        ...claimInput,
        nodeKey: { ...claimInput.nodeKey, publicKey: new Uint8Array(32).fill(0x42) },
      },
      { ...claimInput, claimExpiresAt: claimInput.claimExpiresAt + 1 },
      { ...claimInput, challenge: new Uint8Array(32).fill(0x7d) },
    ];
    for (const mutation of mutations) {
      expect(equalNodeIdentityBytes(baseline, encodeNativeNodeClaimTranscript(mutation))).toBe(
        false,
      );
    }
  });

  it("encodes native claim digests and key material as canonical CBOR byte strings", () => {
    const decoded = decode(encodeNativeNodeClaimTranscript(claimInput));
    expect(decoded).toHaveLength(16);
    for (const index of [8, 12, 13, 15]) expect(decoded[index]).toBeInstanceOf(Uint8Array);
  });

  it("encodes a canonical CBOR array with byte strings", () => {
    const transcript = encodeNodeAuthenticationTranscript(authInput);
    const decoded = decode(transcript);
    expect(Array.isArray(decoded)).toBe(true);
    expect(decoded).toHaveLength(8);
    expect(decoded[7]).toBeInstanceOf(Uint8Array);
  });

  it("accepts exact secure and loopback development origins only", () => {
    expect(canonicalizeHubOrigin("https://hub.example.com")).toBe("https://hub.example.com");
    expect(canonicalizeHubOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const value of [
      "https://hub.example.com/",
      "https://hub.example.com/path",
      "https://user@hub.example.com",
      "http://hub.example.com",
    ]) {
      expect(() => canonicalizeHubOrigin(value)).toThrow(NodeIdentityValidationError);
    }
  });

  it("normalizes bounded Hub node names without reflecting invalid input", () => {
    expect(normalizeHubNodeName("  Build node  ")).toBe("Build node");
    expect(normalizeHubNodeName("a".repeat(HUB_NODE_NAME_MAX_LENGTH))).toHaveLength(
      HUB_NODE_NAME_MAX_LENGTH,
    );
    expect(() => normalizeHubNodeName(" \n ")).toThrow(NodeIdentityValidationError);
    expect(() => normalizeHubNodeName("s".repeat(HUB_NODE_NAME_MAX_LENGTH + 1))).toThrow(
      NodeIdentityValidationError,
    );

    const canary = "private-machine-name";
    let error: unknown;
    try {
      normalizeHubNodeName(`${canary}${"x".repeat(HUB_NODE_NAME_MAX_LENGTH)}`);
    } catch (cause) {
      error = cause;
    }
    expect(String(error)).not.toContain(canary);
  });

  it("validates key encodings and copies accepted public bytes", () => {
    const input = Uint8Array.from(FIXTURE_PUBLIC_KEY);
    const result = validateNodePublicKey({ algorithm: "ed25519", publicKey: input });
    input.fill(0);
    expect(Buffer.from(result.publicKey).toString("hex")).toBe(FIXTURE_PUBLIC_KEY.toString("hex"));
    expect(() =>
      validateNodePublicKey({ algorithm: "ed25519", publicKey: new Uint8Array(31) }),
    ).toThrow(NodeIdentityValidationError);
    expect(() =>
      validateNodePublicKey({ algorithm: "p256", publicKey: new Uint8Array(33) }),
    ).toThrow(NodeIdentityValidationError);
  });

  it("returns stable non-sensitive validation errors for malformed inputs", () => {
    const canary = "do-not-reflect-sensitive-input";
    let error: unknown;
    try {
      encodeNodeAuthenticationTranscript({ ...authInput, nodeId: canary });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(NodeIdentityValidationError);
    expect(String(error)).not.toContain(canary);
  });

  it("rejects malformed sizes and unsafe numeric values", () => {
    expect(() =>
      encodeNodeAuthenticationTranscript({ ...authInput, challenge: new Uint8Array(31) }),
    ).toThrow(NodeIdentityValidationError);
    expect(() =>
      encodeNodeAuthenticationTranscript({ ...authInput, challengeExpiresAt: Number.MAX_VALUE }),
    ).toThrow(NodeIdentityValidationError);
    expect(() => encodeNodeAuthenticationTranscript({ ...authInput, protocolMinor: -1 })).toThrow(
      NodeIdentityValidationError,
    );
    expect(() =>
      encodeNativeNodeClaimTranscript({
        ...claimInput,
        dpopKeyThumbprint: new Uint8Array(31),
      }),
    ).toThrow(NodeIdentityValidationError);
    expect(() =>
      encodeNativeNodeClaimTranscript({ ...claimInput, environmentId: "x".repeat(129) }),
    ).toThrow(NodeIdentityValidationError);
    expect(() =>
      encodeNativeNodeClaimTranscript({ ...claimInput, claimExpiresAt: Number.MAX_VALUE }),
    ).toThrow(NodeIdentityValidationError);
  });
});
