import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { expand } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { E2EE_SECRET_BYTES, NOISE_SPEC_REVISION } from "./relayE2eeConstants.ts";
import {
  E2EE_CORPUS_CASE_LIVENESS,
  E2EE_CORPUS_DELEGATED_LEAF_READS,
  E2eeCorpusLivenessRecorder,
} from "./relayE2eeCorpusLiveness.ts";
import {
  E2EE_NOISE_EXPORTER_LABEL,
  E2EE_NOISE_PROTOCOL_NAME_IK,
  E2EE_NOISE_PROTOCOL_NAME_NX,
  E2eeNoiseHandshake,
  E2eeNoiseHandshakeError,
  e2eeNoiseCipherNonce,
  e2eeNoiseExporterSecret,
  e2eeNoiseProtocolName,
  type E2eeNoiseHandshakeOptions,
} from "./relayE2eeNoise.ts";
import {
  E2EE_NOISE_PATTERN_IK,
  E2EE_NOISE_PATTERN_NX,
  encodeE2eeNoisePrologue,
} from "./relayE2eeTranscripts.ts";

const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

// Deterministic §16.1-style TEST-ONLY material. The two static keys are the
// RFC 7748 §6.1 X25519 test vector keys, so their public keys are independently
// published values and a wrong curve or a wrong encoding shows up immediately;
// the ephemerals are fixed counting patterns. None of it may ever reach a real
// endpoint.
const CLIENT_STATIC_SECRET = bytes(
  "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
);
const CLIENT_STATIC_PUBLIC = "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a";
const NODE_STATIC_SECRET = bytes(
  "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
);
const NODE_STATIC_PUBLIC = "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f";
const CLIENT_EPHEMERAL_SECRET = bytes(
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
);
const CLIENT_EPHEMERAL_PUBLIC = "07a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c";
const NODE_EPHEMERAL_SECRET = bytes(
  "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40",
);
const NODE_EPHEMERAL_PUBLIC = "5869aff450549732cbaaed5e5df9b30a6da31cb0e5742bad5ad4a1a768f1a67b";
const OTHER_NODE_EPHEMERAL_SECRET = bytes(
  "3122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40",
);

const PROLOGUE = bytes("a1b2c3d4e5f6");
const MESSAGE_1_PAYLOAD = bytes("f0f1f2f3f4");
const MESSAGE_2_PAYLOAD = bytes("e0e1e2");
const EMPTY_PAYLOAD = new Uint8Array(0);

// The all-zero X25519 public key: `u = 0` is a low-order point, so every shared
// secret computed against it is all zeros and the pinned primitive throws
// (§8.1, §14.3).
const LOW_ORDER_PUBLIC_KEY = new Uint8Array(32);

// ─── golden transcripts ──────────────────────────────────────────────────────
//
// Byte-exact expectations for the fixed material above, cross-checked against a
// straight-line transcription of the Noise revision-`NOISE_SPEC_REVISION`
// pseudocode written independently of the module under test. They are literals
// so that ANY change to a token order, a DH argument, the nonce encoding, the
// HKDF chain, the protocol name, or the exporter label fails a test.
//
// They do NOT discharge §14.1's official-vector obligation: the cacophony and
// snow vector sets for both protocol names are §16.3 family F15 and belong to
// the §16.1 fixture corpus.

const IK_MESSAGE_1 =
  CLIENT_EPHEMERAL_PUBLIC +
  "545550b09fb2678cb15e4c375e261898c1ef7174000266ed332ec04d20536f65ca4727d3286ec4c53aa69d398d147230" +
  "aa185b61ade318f71b09328551e4f21e3190976c23";
const IK_MESSAGE_2 = NODE_EPHEMERAL_PUBLIC + "29fc0fa30f7a092608cc058c8f74de88eb2808";
const IK_EPOCH_SECRET_C2N = "4baa406898c98ea1b8ee046dffc725a94e6507fb00ce8f5b3cb6740221f5c296";
const IK_EPOCH_SECRET_N2C = "66937266322565f6ce0f54a4b96f8662341a79048d6abf3d7750bb37a3d1f193";
const IK_EXPORTER_SECRET = "67ccffd18305fbdda59ee370c91b8957bc8ae19f244dc821ff3f1e8c874577f9";

const NX_MESSAGE_1 = CLIENT_EPHEMERAL_PUBLIC;
const NX_MESSAGE_2 =
  NODE_EPHEMERAL_PUBLIC +
  "70b92b5166e17e42bc69142426cfda03970d22c6dae45404b74dbab441d976dfe82c9ee462cecda79c8a8a2a2a85a7e6" +
  "80d17fa2bf1278b03e4c41a3cc522af83254ff";
const NX_EPOCH_SECRET_C2N = "bb7080f6888632a741e2c139c34f8ec95ef002b09a347bbc51f28f5b398aeee1";
const NX_EPOCH_SECRET_N2C = "2b0ae20109fb4dd97d73c35098e64e0879c832984407309d50053beae1a12ad4";
const NX_EXPORTER_SECRET = "a7161c6198f201cc9783c7c549c66d3d1f4f8ad850715d40218c5ce015a84252";

const ikClient = (overrides: Partial<E2eeNoiseHandshakeOptions> = {}): E2eeNoiseHandshake =>
  new E2eeNoiseHandshake({
    pattern: E2EE_NOISE_PATTERN_IK,
    role: "initiator",
    prologue: PROLOGUE,
    staticSecretKey: CLIENT_STATIC_SECRET,
    remoteStaticPublicKey: bytes(NODE_STATIC_PUBLIC),
    testOnlyEphemeralSecretKey: Uint8Array.from(CLIENT_EPHEMERAL_SECRET),
    ...overrides,
  });

const ikNode = (overrides: Partial<E2eeNoiseHandshakeOptions> = {}): E2eeNoiseHandshake =>
  new E2eeNoiseHandshake({
    pattern: E2EE_NOISE_PATTERN_IK,
    role: "responder",
    prologue: PROLOGUE,
    staticSecretKey: NODE_STATIC_SECRET,
    testOnlyEphemeralSecretKey: Uint8Array.from(NODE_EPHEMERAL_SECRET),
    ...overrides,
  });

const nxClient = (overrides: Partial<E2eeNoiseHandshakeOptions> = {}): E2eeNoiseHandshake =>
  new E2eeNoiseHandshake({
    pattern: E2EE_NOISE_PATTERN_NX,
    role: "initiator",
    prologue: PROLOGUE,
    testOnlyEphemeralSecretKey: Uint8Array.from(CLIENT_EPHEMERAL_SECRET),
    ...overrides,
  });

const nxNode = (overrides: Partial<E2eeNoiseHandshakeOptions> = {}): E2eeNoiseHandshake =>
  new E2eeNoiseHandshake({
    pattern: E2EE_NOISE_PATTERN_NX,
    role: "responder",
    prologue: PROLOGUE,
    staticSecretKey: NODE_STATIC_SECRET,
    testOnlyEphemeralSecretKey: Uint8Array.from(NODE_EPHEMERAL_SECRET),
    ...overrides,
  });

/**
 * A secret key that counts every full read of itself. Both ways this module
 * consumes one — `Uint8Array.from`, which is the copy it takes ownership of,
 * and `x25519.getPublicKey` — read it through the array iterator, so overriding
 * that is how a test observes WHETHER the constructor has touched the caller's
 * key material at the point a later step fails.
 */
class WatchedSecret extends Uint8Array {
  reads = 0;

  override [Symbol.iterator]() {
    this.reads += 1;
    return super[Symbol.iterator]();
  }
}

const watchedSecret = (value: Uint8Array): WatchedSecret => {
  const watched = new WatchedSecret(value.byteLength);
  watched.set(value);
  watched.reads = 0;
  return watched;
};

const UNREADABLE_PROLOGUE_MESSAGE = "test-only unreadable prologue";

/**
 * A §8.4 prologue that passes the constructor's `instanceof` check and then
 * fails when Noise `MixHash` reads it. It stands in for every way the symmetric
 * steps of the constructor can throw on material the caller supplied.
 */
class UnreadablePrologue extends Uint8Array {
  override get length(): number {
    throw new Error(UNREADABLE_PROLOGUE_MESSAGE);
  }
}

/** Reason of an `E2eeNoiseHandshakeError`, asserting the class on the way. */
function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
    return (error as E2eeNoiseHandshakeError).reason;
  }
  throw new Error("expected the operation to throw");
}

describe("§3.4 protocol names", () => {
  it("pins both suite protocol names verbatim", () => {
    expect(E2EE_NOISE_PROTOCOL_NAME_IK).toBe("Noise_IK_25519_ChaChaPoly_SHA256");
    expect(E2EE_NOISE_PROTOCOL_NAME_NX).toBe("Noise_NX_25519_ChaChaPoly_SHA256");
    expect(e2eeNoiseProtocolName(E2EE_NOISE_PATTERN_IK)).toBe(E2EE_NOISE_PROTOCOL_NAME_IK);
    expect(e2eeNoiseProtocolName(E2EE_NOISE_PATTERN_NX)).toBe(E2EE_NOISE_PROTOCOL_NAME_NX);
  });

  it("keeps both names exactly HASHLEN, so Noise InitializeSymmetric pads rather than hashes", () => {
    // Noise §5.2: a protocol name of at most HASHLEN bytes becomes `h`
    // zero-padded; a longer one is hashed. Both names are exactly 32 bytes, so
    // `h` starts as their ASCII bytes and no padding is applied either.
    expect(utf8ToBytes(E2EE_NOISE_PROTOCOL_NAME_IK).byteLength).toBe(32);
    expect(utf8ToBytes(E2EE_NOISE_PROTOCOL_NAME_NX).byteLength).toBe(32);
    expect(hex(utf8ToBytes(E2EE_NOISE_PROTOCOL_NAME_IK))).toBe(
      "4e6f6973655f494b5f32353531395f436861436861506f6c795f534841323536",
    );
    expect(hex(utf8ToBytes(E2EE_NOISE_PROTOCOL_NAME_NX))).toBe(
      "4e6f6973655f4e585f32353531395f436861436861506f6c795f534841323536",
    );
  });

  it("pins the Noise specification revision the patterns are defined against", () => {
    expect(NOISE_SPEC_REVISION).toBe(34);
  });
});

describe("Noise §5.1 cipher nonce", () => {
  it("pins the 32-zero-bits ‖ little-endian-`n` encoding", () => {
    expect(hex(e2eeNoiseCipherNonce(0n))).toBe("000000000000000000000000");
    expect(hex(e2eeNoiseCipherNonce(1n))).toBe("000000000100000000000000");
    expect(hex(e2eeNoiseCipherNonce(2n))).toBe("000000000200000000000000");
    expect(hex(e2eeNoiseCipherNonce(255n))).toBe("00000000ff00000000000000");
    expect(hex(e2eeNoiseCipherNonce(256n))).toBe("000000000001000000000000");
    expect(hex(e2eeNoiseCipherNonce(0x0102030405060708n))).toBe("000000000807060504030201");
    expect(hex(e2eeNoiseCipherNonce(0xfffffffffffffffen))).toBe("00000000feffffffffffffff");
    expect(e2eeNoiseCipherNonce(0n).byteLength).toBe(12);
  });

  it("reserves 2^64 − 1 for Rekey() and rejects anything outside the field", () => {
    expect(reasonOf(() => e2eeNoiseCipherNonce(0xffff_ffff_ffff_ffffn))).toBe("nonce_exhausted");
    expect(reasonOf(() => e2eeNoiseCipherNonce(0x1_0000_0000_0000_0000n))).toBe("nonce_exhausted");
    expect(reasonOf(() => e2eeNoiseCipherNonce(-1n))).toBe("invalid_options");
    expect(reasonOf(() => e2eeNoiseCipherNonce(0 as unknown as bigint))).toBe("invalid_options");
  });
});

describe("§6.5 exporter", () => {
  it("pins the HKDF label and the derivation", () => {
    expect(E2EE_NOISE_EXPORTER_LABEL).toBe("ryco.relay-e2ee.exporter.v1");
    const chainingKey = bytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    const exporterSecret = e2eeNoiseExporterSecret(chainingKey);
    expect(hex(exporterSecret)).toBe(
      "435ff827db89d0e273a8778cfc1ca540bb9e2c0a64a8a3779327361e47b71278",
    );
    // The same value read the other way round: HKDF-Expand over HMAC-SHA-256
    // with the label bytes as `info` and no salt step of its own.
    expect(hex(exporterSecret)).toBe(
      hex(
        expand(sha256, chainingKey, utf8ToBytes("ryco.relay-e2ee.exporter.v1"), E2EE_SECRET_BYTES),
      ),
    );
    expect(exporterSecret.byteLength).toBe(E2EE_SECRET_BYTES);
    expect(E2EE_SECRET_BYTES).toBe(32);
  });

  it("rejects a chaining key that is not exactly HASHLEN", () => {
    expect(reasonOf(() => e2eeNoiseExporterSecret(new Uint8Array(31)))).toBe(
      "invalid_key_material",
    );
    expect(reasonOf(() => e2eeNoiseExporterSecret(new Uint8Array(33)))).toBe(
      "invalid_key_material",
    );
    expect(reasonOf(() => e2eeNoiseExporterSecret("not bytes" as unknown as Uint8Array))).toBe(
      "invalid_key_material",
    );
  });
});

describe("Noise_IK_25519_ChaChaPoly_SHA256 (§8.1 native tier)", () => {
  it("produces the golden transcript and the §6.5 session keys", () => {
    const client = ikClient();
    const node = ikNode();

    expect(client.status).toBe("awaiting_write");
    expect(node.status).toBe("awaiting_read");

    const message1 = client.writeMessage(MESSAGE_1_PAYLOAD);
    expect(hex(message1)).toBe(IK_MESSAGE_1);
    // e (32) ‖ EncryptAndHash(s) (32 + 16) ‖ EncryptAndHash(payload) (5 + 16).
    expect(message1.byteLength).toBe(101);
    expect(hex(message1.subarray(0, 32))).toBe(CLIENT_EPHEMERAL_PUBLIC);
    expect(client.status).toBe("awaiting_read");

    expect(hex(node.readMessage(message1))).toBe(hex(MESSAGE_1_PAYLOAD));
    // §8.6 step 5 compares this against the client certificate's agreement key.
    expect(hex(node.remoteStaticPublicKey!)).toBe(CLIENT_STATIC_PUBLIC);
    expect(node.status).toBe("awaiting_write");

    const message2 = node.writeMessage(MESSAGE_2_PAYLOAD);
    expect(hex(message2)).toBe(IK_MESSAGE_2);
    // e (32) ‖ EncryptAndHash(payload) (3 + 16). The responder sends no `s`:
    // the initiator already had it as the IK pre-message.
    expect(message2.byteLength).toBe(51);
    expect(node.status).toBe("awaiting_split");

    expect(hex(client.readMessage(message2))).toBe(hex(MESSAGE_2_PAYLOAD));
    expect(client.status).toBe("awaiting_split");

    const clientKeys = client.split();
    const nodeKeys = node.split();
    expect(client.status).toBe("complete");
    expect(node.status).toBe("complete");

    expect(hex(clientKeys.epochSecretC2N)).toBe(IK_EPOCH_SECRET_C2N);
    expect(hex(clientKeys.epochSecretN2C)).toBe(IK_EPOCH_SECRET_N2C);
    expect(hex(clientKeys.exporterSecret)).toBe(IK_EXPORTER_SECRET);
    expect(hex(nodeKeys.epochSecretC2N)).toBe(IK_EPOCH_SECRET_C2N);
    expect(hex(nodeKeys.epochSecretN2C)).toBe(IK_EPOCH_SECRET_N2C);
    expect(hex(nodeKeys.exporterSecret)).toBe(IK_EXPORTER_SECRET);

    // §6.5: exactly three values, all distinct, all E2EE_SECRET_BYTES long.
    expect(Object.keys(clientKeys).toSorted()).toEqual([
      "epochSecretC2N",
      "epochSecretN2C",
      "exporterSecret",
    ]);
    expect(clientKeys.epochSecretC2N.byteLength).toBe(E2EE_SECRET_BYTES);
    expect(clientKeys.epochSecretN2C.byteLength).toBe(E2EE_SECRET_BYTES);
    expect(clientKeys.exporterSecret.byteLength).toBe(E2EE_SECRET_BYTES);
    expect(IK_EPOCH_SECRET_C2N).not.toBe(IK_EPOCH_SECRET_N2C);
    expect(IK_EXPORTER_SECRET).not.toBe(IK_EPOCH_SECRET_C2N);
    expect(IK_EXPORTER_SECRET).not.toBe(IK_EPOCH_SECRET_N2C);
  });

  it("completes over a real §8.4 prologue with CSPRNG ephemerals", () => {
    const prologue = encodeE2eeNoisePrologue({
      hubOrigin: "https://hub.example.com",
      channelId: "ch_GGGGGGGGGGGGGGGGGGGGGG",
      relayProtocolMajor: 1,
      relayProtocolMinor: 2,
      e2eeVersion: 1,
      suiteId: 1,
      nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
      contextCommitment: sha256(utf8ToBytes("context")),
    });
    const client = new E2eeNoiseHandshake({
      pattern: E2EE_NOISE_PATTERN_IK,
      role: "initiator",
      prologue,
      staticSecretKey: CLIENT_STATIC_SECRET,
      remoteStaticPublicKey: bytes(NODE_STATIC_PUBLIC),
    });
    const node = new E2eeNoiseHandshake({
      pattern: E2EE_NOISE_PATTERN_IK,
      role: "responder",
      prologue,
      staticSecretKey: NODE_STATIC_SECRET,
    });
    const message1 = client.writeMessage(EMPTY_PAYLOAD);
    expect(message1.byteLength).toBe(96);
    expect(node.readMessage(message1).byteLength).toBe(0);
    const message2 = node.writeMessage(EMPTY_PAYLOAD);
    expect(message2.byteLength).toBe(48);
    expect(client.readMessage(message2).byteLength).toBe(0);
    const clientKeys = client.split();
    const nodeKeys = node.split();
    expect(hex(clientKeys.epochSecretC2N)).toBe(hex(nodeKeys.epochSecretC2N));
    expect(hex(clientKeys.epochSecretN2C)).toBe(hex(nodeKeys.epochSecretN2C));
    expect(hex(clientKeys.exporterSecret)).toBe(hex(nodeKeys.exporterSecret));
    // Fresh ephemerals: nothing may equal the injected-ephemeral golden run.
    expect(hex(clientKeys.exporterSecret)).not.toBe(IK_EXPORTER_SECRET);
  });
});

describe("Noise_NX_25519_ChaChaPoly_SHA256 (§8.1 web tier)", () => {
  it("produces the golden transcript and the §6.5 session keys", () => {
    const client = nxClient();
    const node = nxNode();

    const message1 = client.writeMessage(EMPTY_PAYLOAD);
    expect(hex(message1)).toBe(NX_MESSAGE_1);
    expect(message1.byteLength).toBe(32);
    expect(node.readMessage(message1).byteLength).toBe(0);
    // The web tier's client has no static, so it never transmits one.
    expect(node.remoteStaticPublicKey).toBeUndefined();

    const message2 = node.writeMessage(MESSAGE_2_PAYLOAD);
    expect(hex(message2)).toBe(NX_MESSAGE_2);
    // e (32) ‖ EncryptAndHash(s) (32 + 16) ‖ EncryptAndHash(payload) (3 + 16).
    expect(message2.byteLength).toBe(99);

    expect(hex(client.readMessage(message2))).toBe(hex(MESSAGE_2_PAYLOAD));
    // §8.7: the NX client MUST require this to equal the advertised prekey.
    expect(hex(client.remoteStaticPublicKey!)).toBe(NODE_STATIC_PUBLIC);

    const clientKeys = client.split();
    const nodeKeys = node.split();
    expect(hex(clientKeys.epochSecretC2N)).toBe(NX_EPOCH_SECRET_C2N);
    expect(hex(clientKeys.epochSecretN2C)).toBe(NX_EPOCH_SECRET_N2C);
    expect(hex(clientKeys.exporterSecret)).toBe(NX_EXPORTER_SECRET);
    expect(hex(nodeKeys.epochSecretC2N)).toBe(NX_EPOCH_SECRET_C2N);
    expect(hex(nodeKeys.epochSecretN2C)).toBe(NX_EPOCH_SECRET_N2C);
    expect(hex(nodeKeys.exporterSecret)).toBe(NX_EXPORTER_SECRET);

    // The two patterns share the same keys and prologue here, and still derive
    // completely different session material: the protocol name and the token
    // sequence separate them.
    expect(NX_EPOCH_SECRET_C2N).not.toBe(IK_EPOCH_SECRET_C2N);
    expect(NX_EXPORTER_SECRET).not.toBe(IK_EXPORTER_SECRET);
  });

  it("carries the NX message-1 payload in the clear (§8.10: no keys exist yet)", () => {
    // §8.5 requires the payload to be EMPTY and the responder to reject a
    // nonempty one; that is the handshake driver's rule, not this module's,
    // because the §16.3 F15 vectors carry payloads here. What this module must
    // get right is that the payload is unencrypted and untagged.
    const message1 = nxClient().writeMessage(MESSAGE_1_PAYLOAD);
    expect(hex(message1)).toBe(CLIENT_EPHEMERAL_PUBLIC + "f0f1f2f3f4");
    expect(message1.byteLength).toBe(37);
    expect(hex(nxNode().readMessage(message1))).toBe(hex(MESSAGE_1_PAYLOAD));
  });
});

describe("state-machine ordering (§8.1)", () => {
  it("rejects an operation neither party owes, without destroying the handshake", () => {
    const client = ikClient();
    expect(reasonOf(() => client.readMessage(bytes(IK_MESSAGE_2)))).toBe("out_of_sequence");
    expect(reasonOf(() => client.split())).toBe("out_of_sequence");
    // A precondition failure touched nothing, so the handshake still runs.
    expect(client.status).toBe("awaiting_write");
    expect(hex(client.writeMessage(MESSAGE_1_PAYLOAD))).toBe(IK_MESSAGE_1);

    const node = ikNode();
    expect(reasonOf(() => node.writeMessage(MESSAGE_2_PAYLOAD))).toBe("out_of_sequence");
    expect(reasonOf(() => node.split())).toBe("out_of_sequence");
    expect(node.status).toBe("awaiting_read");
  });

  it("rejects a second write, a second read, and a split before both messages", () => {
    const client = ikClient();
    const node = ikNode();
    const message1 = client.writeMessage(MESSAGE_1_PAYLOAD);
    expect(reasonOf(() => client.writeMessage(MESSAGE_1_PAYLOAD))).toBe("out_of_sequence");
    node.readMessage(message1);
    expect(reasonOf(() => node.readMessage(message1))).toBe("out_of_sequence");
    expect(reasonOf(() => node.split())).toBe("out_of_sequence");
  });

  it("is single-use: everything after split is consumed", () => {
    const client = ikClient();
    const node = ikNode();
    const message1 = client.writeMessage(MESSAGE_1_PAYLOAD);
    node.readMessage(message1);
    const message2 = node.writeMessage(MESSAGE_2_PAYLOAD);
    client.readMessage(message2);
    client.split();
    node.split();

    for (const handshake of [client, node]) {
      expect(handshake.status).toBe("complete");
      expect(reasonOf(() => handshake.split())).toBe("handshake_consumed");
      expect(reasonOf(() => handshake.writeMessage(EMPTY_PAYLOAD))).toBe("handshake_consumed");
      expect(reasonOf(() => handshake.readMessage(bytes(IK_MESSAGE_2)))).toBe("handshake_consumed");
      // destroy() after completion is a no-op: split() already erased.
      handshake.destroy();
      expect(handshake.status).toBe("complete");
    }
  });

  it("is single-use after destroy()", () => {
    const client = ikClient();
    client.destroy();
    expect(client.status).toBe("destroyed");
    client.destroy();
    expect(client.status).toBe("destroyed");
    expect(reasonOf(() => client.writeMessage(MESSAGE_1_PAYLOAD))).toBe("handshake_consumed");
    expect(reasonOf(() => client.readMessage(bytes(IK_MESSAGE_2)))).toBe("handshake_consumed");
    expect(reasonOf(() => client.split())).toBe("handshake_consumed");
  });
});

describe("§8.1 all-zero X25519 output aborts the handshake", () => {
  it("aborts the IK initiator on a low-order responder static, with the primitive's own throw", () => {
    const client = ikClient({ remoteStaticPublicKey: LOW_ORDER_PUBLIC_KEY });
    let thrown: unknown;
    try {
      client.writeMessage(MESSAGE_1_PAYLOAD);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    // §14.3: the pinned primitive's throw IS the mandated signal. This module
    // does not catch it, mask it, retry, or reclassify it as one of its own
    // errors — surfacing it unchanged is what "no alternative handling" means.
    expect(thrown).not.toBeInstanceOf(E2eeNoiseHandshakeError);
    expect(client.status).toBe("destroyed");
    expect(reasonOf(() => client.writeMessage(MESSAGE_1_PAYLOAD))).toBe("handshake_consumed");
  });

  it("aborts the NX initiator on a low-order responder ephemeral", () => {
    const client = nxClient();
    const node = nxNode();
    node.readMessage(client.writeMessage(EMPTY_PAYLOAD));
    const tampered = bytes(NX_MESSAGE_2);
    tampered.set(LOW_ORDER_PUBLIC_KEY, 0);
    expect(() => client.readMessage(tampered)).toThrow();
    expect(client.status).toBe("destroyed");
  });

  it("aborts the IK responder on a low-order initiator ephemeral", () => {
    const node = ikNode();
    const tampered = bytes(IK_MESSAGE_1);
    tampered.set(LOW_ORDER_PUBLIC_KEY, 0);
    expect(() => node.readMessage(tampered)).toThrow();
    expect(node.status).toBe("destroyed");
  });
});

describe("§8.6 step 4 Noise failures", () => {
  it("aborts on a mutated ciphertext byte", () => {
    const node = ikNode();
    const tampered = bytes(IK_MESSAGE_1);
    // The last byte of the message-1 payload tag.
    tampered[tampered.byteLength - 1] = tampered[tampered.byteLength - 1]! ^ 0x01;
    expect(() => node.readMessage(tampered)).toThrow();
    expect(node.status).toBe("destroyed");
  });

  it("aborts on a truncated message", () => {
    const node = ikNode();
    expect(reasonOf(() => node.readMessage(bytes(IK_MESSAGE_1).subarray(0, 40)))).toBe(
      "malformed_message",
    );
    expect(node.status).toBe("destroyed");
  });

  it("aborts on a message beyond the Noise message bound", () => {
    const node = ikNode();
    expect(reasonOf(() => node.readMessage(new Uint8Array(65_536)))).toBe("message_too_large");
    expect(node.status).toBe("destroyed");
  });

  it("aborts when the two ends disagree about the §8.4 prologue", () => {
    const client = ikClient();
    const node = ikNode({ prologue: bytes("a1b2c3d4e5f7") });
    expect(() => node.readMessage(client.writeMessage(MESSAGE_1_PAYLOAD))).toThrow();
    expect(node.status).toBe("destroyed");
  });

  it("aborts when the initiator used a different responder static", () => {
    const client = ikClient({
      remoteStaticPublicKey: x25519.getPublicKey(OTHER_NODE_EPHEMERAL_SECRET),
    });
    const node = ikNode();
    expect(() => node.readMessage(client.writeMessage(MESSAGE_1_PAYLOAD))).toThrow();
    expect(node.status).toBe("destroyed");
  });
});

describe("§8.1 role and key-material preconditions", () => {
  it("requires exactly the keys the pattern and role define", () => {
    expect(reasonOf(() => ikClient({ remoteStaticPublicKey: undefined }))).toBe("invalid_options");
    expect(reasonOf(() => ikClient({ staticSecretKey: undefined }))).toBe("invalid_options");
    expect(reasonOf(() => ikNode({ remoteStaticPublicKey: bytes(CLIENT_STATIC_PUBLIC) }))).toBe(
      "invalid_options",
    );
    expect(reasonOf(() => ikNode({ staticSecretKey: undefined }))).toBe("invalid_options");
    // The NX initiator is the web client: it has no static at all (§2.2, §8.10).
    expect(reasonOf(() => nxClient({ staticSecretKey: NODE_STATIC_SECRET }))).toBe(
      "invalid_options",
    );
    expect(reasonOf(() => nxClient({ remoteStaticPublicKey: bytes(NODE_STATIC_PUBLIC) }))).toBe(
      "invalid_options",
    );
    expect(reasonOf(() => nxNode({ staticSecretKey: undefined }))).toBe("invalid_options");
  });

  it("requires exact key lengths", () => {
    expect(reasonOf(() => ikClient({ staticSecretKey: new Uint8Array(31) }))).toBe(
      "invalid_key_material",
    );
    expect(reasonOf(() => ikClient({ remoteStaticPublicKey: new Uint8Array(33) }))).toBe(
      "invalid_key_material",
    );
    expect(reasonOf(() => ikClient({ testOnlyEphemeralSecretKey: new Uint8Array(16) }))).toBe(
      "invalid_key_material",
    );
  });

  it("rejects an unregistered pattern, role, or prologue", () => {
    expect(
      reasonOf(() =>
        ikClient({ pattern: "XX" as unknown as E2eeNoiseHandshakeOptions["pattern"] }),
      ),
    ).toBe("invalid_options");
    expect(
      reasonOf(() => ikClient({ role: "relay" as unknown as E2eeNoiseHandshakeOptions["role"] })),
    ).toBe("invalid_options");
    expect(reasonOf(() => ikClient({ prologue: "a1b2" as unknown as Uint8Array }))).toBe(
      "invalid_options",
    );
    expect(reasonOf(() => ikClient().writeMessage("payload" as unknown as Uint8Array))).toBe(
      "invalid_options",
    );
  });
});

describe("§6.5 and §9.5 erasure", () => {
  it("zeroes the ephemeral secret key at split", () => {
    const ephemeral = Uint8Array.from(CLIENT_EPHEMERAL_SECRET);
    const client = ikClient({ testOnlyEphemeralSecretKey: ephemeral });
    const node = ikNode();
    const message1 = client.writeMessage(MESSAGE_1_PAYLOAD);
    node.readMessage(message1);
    // Still live: the initiator's ephemeral is used again for `ee` and `se`.
    expect(hex(ephemeral)).toBe(hex(CLIENT_EPHEMERAL_SECRET));
    client.readMessage(node.writeMessage(MESSAGE_2_PAYLOAD));
    client.split();
    expect(hex(ephemeral)).toBe(hex(new Uint8Array(32)));
  });

  it("keeps the initiator's own ephemeral PUBLIC key past split, and zeroes the secret", () => {
    // §13.5's client half. The public component has to outlive the handshake —
    // the `WebSAS` is rendered at the `e2ee` lock, after `Split()` — while §6.2
    // requires the private half to be erased at exactly that moment.
    const ephemeral = Uint8Array.from(CLIENT_EPHEMERAL_SECRET);
    const client = nxClient({ testOnlyEphemeralSecretKey: ephemeral });
    // Before message 1 there is no `e` to publish, on either pattern.
    expect(client.localEphemeralPublicKey).toBeUndefined();
    expect(nxClient().localEphemeralPublicKey).toBeUndefined();
    expect(ikClient().localEphemeralPublicKey).toBeUndefined();

    const node = nxNode();
    node.readMessage(client.writeMessage(EMPTY_PAYLOAD));
    expect(hex(client.localEphemeralPublicKey!)).toBe(CLIENT_EPHEMERAL_PUBLIC);
    client.readMessage(node.writeMessage(MESSAGE_2_PAYLOAD));
    client.split();

    expect(hex(client.localEphemeralPublicKey!)).toBe(CLIENT_EPHEMERAL_PUBLIC);
    expect(hex(ephemeral)).toBe(hex(new Uint8Array(32)));
    // A copy per read, like the two remote accessors beside it.
    const first = client.localEphemeralPublicKey!;
    first.fill(0);
    expect(hex(client.localEphemeralPublicKey!)).toBe(CLIENT_EPHEMERAL_PUBLIC);
    // It is byte-identical to the `e` the responder observed, which is what
    // makes the two ends of §13.5 render the same string.
    expect(hex(node.remoteEphemeralPublicKey!)).toBe(CLIENT_EPHEMERAL_PUBLIC);
  });

  it("publishes no local ephemeral on the responder, which nothing displays", () => {
    // The accessor is the initiator's alone: §13.5 is defined over the WEB
    // client's ephemeral, and no surface in this protocol shows the node's. The
    // responder DOES generate one — its message 2 carries `e` on both patterns —
    // so this is a retention decision and not an absence of key material.
    const cases = [
      { responder: ikNode(), hello: ikClient().writeMessage(MESSAGE_1_PAYLOAD) },
      { responder: nxNode(), hello: nxClient().writeMessage(EMPTY_PAYLOAD) },
    ];
    for (const { responder, hello } of cases) {
      expect(responder.localEphemeralPublicKey).toBeUndefined();
      responder.readMessage(hello);
      const message2 = responder.writeMessage(MESSAGE_2_PAYLOAD);
      // The responder's own `e` is on the wire and still not readable here.
      expect(hex(message2).startsWith(NODE_EPHEMERAL_PUBLIC)).toBe(true);
      expect(responder.localEphemeralPublicKey).toBeUndefined();
      responder.split();
      expect(responder.localEphemeralPublicKey).toBeUndefined();
    }
  });

  it("zeroes the ephemeral secret key at destroy(), including before it is used", () => {
    const used = Uint8Array.from(CLIENT_EPHEMERAL_SECRET);
    const client = ikClient({ testOnlyEphemeralSecretKey: used });
    client.writeMessage(MESSAGE_1_PAYLOAD);
    client.destroy();
    expect(hex(used)).toBe(hex(new Uint8Array(32)));

    const unused = Uint8Array.from(CLIENT_EPHEMERAL_SECRET);
    ikClient({ testOnlyEphemeralSecretKey: unused }).destroy();
    expect(hex(unused)).toBe(hex(new Uint8Array(32)));
  });

  it("acquires no key material until the constructor's fallible steps are done", () => {
    // §9.5's failure mode, in the one place a constructor can produce it: key
    // material acquired, and then a statement that can throw before any funnel
    // could erase it. The constructor's answer is to acquire LAST — the
    // symmetric state, the §8.4 prologue mix, and the IK pre-message mix all
    // run before the caller's static is read at all — so a constructor that
    // fails owns nothing and both of the caller's buffers are untouched.
    //
    // `WATCHED` counts every full read of the buffer: `Uint8Array.from` (the
    // copy this object would own) and `x25519.getPublicKey` both take it
    // through the iterator, and neither has run when the prologue fails. The
    // control below is what keeps that from passing vacuously.
    const staticSecretKey = watchedSecret(CLIENT_STATIC_SECRET);
    const ephemeral = Uint8Array.from(CLIENT_EPHEMERAL_SECRET);
    expect(() =>
      ikClient({
        staticSecretKey,
        prologue: new UnreadablePrologue(6),
        testOnlyEphemeralSecretKey: ephemeral,
      }),
    ).toThrow(UNREADABLE_PROLOGUE_MESSAGE);
    expect(staticSecretKey.reads).toBe(0);
    // The injected ephemeral was never adopted either, so ownership never
    // transferred and it is still the caller's to reuse or erase.
    expect(hex(ephemeral)).toBe(hex(CLIENT_EPHEMERAL_SECRET));

    // Control: a construction that completes does read the static — once to
    // derive its public key and once to copy it — so the assertion above is
    // about the ordering and not about an unread buffer.
    const used = watchedSecret(CLIENT_STATIC_SECRET);
    ikClient({ staticSecretKey: used }).destroy();
    expect(used.reads).toBeGreaterThan(0);
  });

  it("leaves the caller's own static key untouched and hands back independent buffers", () => {
    const staticSecretKey = Uint8Array.from(CLIENT_STATIC_SECRET);
    const client = ikClient({ staticSecretKey });
    const node = ikNode();
    node.readMessage(client.writeMessage(MESSAGE_1_PAYLOAD));
    client.readMessage(node.writeMessage(MESSAGE_2_PAYLOAD));
    const clientKeys = client.split();
    const nodeKeys = node.split();
    // The module copies the static it is given and erases only its copy.
    expect(hex(staticSecretKey)).toBe(hex(CLIENT_STATIC_SECRET));
    clientKeys.epochSecretC2N.fill(0);
    expect(hex(nodeKeys.epochSecretC2N)).toBe(IK_EPOCH_SECRET_C2N);
    // The public accessor hands back a copy too.
    const remoteStatic = node.remoteStaticPublicKey!;
    remoteStatic.fill(0);
    expect(hex(node.remoteStaticPublicKey!)).toBe(CLIENT_STATIC_PUBLIC);
  });
});

// ─── §16.3 F15 — the official Noise vector sets ──────────────────────────────
//
// §14.1 makes this a MUST, in as many words: "Official Noise test vectors MUST
// pass: the published cacophony and snow vector sets for
// `Noise_IK_25519_ChaChaPoly_SHA256` and `Noise_NX_25519_ChaChaPoly_SHA256`,
// checked into the §16 corpus (family F15)." Those two sets are also the §14.1
// cross-implementation obligation's independent implementations — cacophony is
// Haskell, snow is Rust, and both are the reference implementations
// noiseprotocol.org lists — so reproducing their transcripts and `Split()`
// outputs from identical static keys, ephemerals, prologues, and payloads is the
// evidence that this first-party state machine is Noise and not merely
// self-consistent.
//
// The corpus file is TRANSCODED, NEVER EDITED. Its SHA-256 is pinned as a
// literal below and re-checked against `manifest.json`, so a fixture bent to
// match a broken implementation fails here rather than passing quietly.

const F15_FIXTURE_ROOT = new URL("../fixtures/e2ee/v1/", import.meta.url);

/** SHA-256 of the checked-in F15 family file, byte for byte. */
const F15_FIXTURE_SHA256 = "7b0469edfa11806d33fe59f2d628255f32833192db7e5281c25cef8275695f5b";
/** SHA-256 of each upstream vector file the corpus was transcoded from. */
const F15_UPSTREAM_SHA256: Readonly<Record<string, string>> = {
  cacophony: "3bde7c09a6f349ee11c825c50fcc02649f8f02a47c857a459206b357f9386cae",
  snow: "69da433305fd045f6c9f01b656662a389d022688986fd39fbe7af009cd402fd3",
};
/** Exactly the four applicable vectors: two protocol names × two vector sets. */
const F15_CASE_NAMES = [
  "cacophony/Noise_IK_25519_ChaChaPoly_SHA256",
  "cacophony/Noise_NX_25519_ChaChaPoly_SHA256",
  "snow/Noise_IK_25519_ChaChaPoly_SHA256",
  "snow/Noise_NX_25519_ChaChaPoly_SHA256",
];
// The cacophony vectors publish the final Noise §5.2 handshake hash; the snow
// vectors publish none. Pinned here as well as in the corpus so that neither can
// drift alone.
const CACOPHONY_IK_HANDSHAKE_HASH =
  "0b0f68fb0c27e03ce9b97565995ed4838cc0581b762ef72b062f6a546419fad7";
const CACOPHONY_NX_HANDSHAKE_HASH =
  "6959d38aed4b70824a50c722b47c07e00e88eb3eb14f351c11cbee4f56dac33b";

interface F15Bytes {
  readonly $bytes: string;
}

interface F15Case {
  readonly name: string;
  readonly inputs: {
    readonly source: string;
    readonly protocolName: string;
    readonly pattern: "IK" | "NX";
    readonly initiatorPrologue: F15Bytes;
    readonly responderPrologue: F15Bytes;
    readonly testOnlyInitiatorStaticSecretKey?: F15Bytes;
    readonly testOnlyInitiatorEphemeralSecretKey: F15Bytes;
    readonly testOnlyInitiatorRemoteStaticPublicKey?: F15Bytes;
    readonly testOnlyResponderStaticSecretKey: F15Bytes;
    readonly testOnlyResponderEphemeralSecretKey: F15Bytes;
    readonly handshakePayloads: readonly F15Bytes[];
    readonly transportPayloads: readonly F15Bytes[];
  };
  readonly expected: {
    readonly handshakeMessages: readonly F15Bytes[];
    readonly handshakeHash?: F15Bytes;
    readonly transportMessages: readonly F15Bytes[];
  };
}

const readFixture = (name: string): Uint8Array =>
  Uint8Array.from(readFileSync(new URL(name, F15_FIXTURE_ROOT)));

const F15_FIXTURE_BYTES = readFixture("f15-noise-core-vectors.json");
/**
 * F15 is loaded THROUGH the read-liveness recorder: the shared corpus suite
 * cannot see whether these four transcoded vectors are asserted anywhere, so its
 * ledger delegates them here and the last test in this file discharges that.
 */
const F15_LIVENESS = new E2eeCorpusLivenessRecorder();
const F15_FAMILY = F15_LIVENESS.watch(
  "f15-noise-core-vectors.json",
  JSON.parse(new TextDecoder().decode(F15_FIXTURE_BYTES)) as {
    readonly family: { readonly number: number; readonly title: string };
    readonly warning: string;
    readonly provenance: readonly {
      readonly source: string;
      readonly url: string;
      readonly sourceFileSha256: string;
      readonly transcodedVectors: readonly string[];
    }[];
    readonly cases: readonly F15Case[];
  },
);

/** §16.2 byte strings are `{"$bytes": "<lowercase hex>"}` and nothing else. */
const f15Bytes = (value: F15Bytes): Uint8Array => {
  expect(Object.keys(value)).toEqual(["$bytes"]);
  expect(value.$bytes).toMatch(/^(?:[0-9a-f]{2})*$/);
  return bytes(value.$bytes);
};

describe("§16.3 F15 official Noise vectors (§14.1)", () => {
  it("pins the checked-in corpus, its manifest digest, and its provenance", () => {
    const manifest = JSON.parse(new TextDecoder().decode(readFixture("manifest.json"))) as {
      readonly formatVersion: number;
      readonly warning: string;
      readonly encoding: string;
      readonly files: Record<string, { readonly sha256: string; readonly family: number }>;
    };
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.encoding).toBe("deterministic-cbor-rfc8949");
    // §16.1: the manifest carries a top-level test-only warning.
    expect(manifest.warning).toContain("TEST-ONLY MATERIAL");
    expect(manifest.warning).toContain("MUST NEVER be used for a real endpoint");
    expect(F15_FAMILY.warning).toContain("TEST-ONLY MATERIAL");

    // The corpus is transcoded upstream data, so the only defence against a
    // fixture edited to match a broken implementation is a pinned digest.
    const entry = manifest.files["f15-noise-core-vectors.json"]!;
    expect(entry.family).toBe(15);
    expect(entry.sha256).toBe(F15_FIXTURE_SHA256);
    expect(hex(sha256(F15_FIXTURE_BYTES))).toBe(F15_FIXTURE_SHA256);

    expect(F15_FAMILY.family.number).toBe(15);
    expect(F15_FAMILY.family.title).toBe("Noise core vectors");
    expect(F15_FAMILY.cases.map((entry) => entry.name)).toEqual(F15_CASE_NAMES);
    expect(F15_FAMILY.provenance.map((entry) => entry.source)).toEqual(["cacophony", "snow"]);
    expect(F15_FAMILY.provenance.map((entry) => entry.sourceFileSha256)).toEqual([
      F15_UPSTREAM_SHA256["cacophony"],
      F15_UPSTREAM_SHA256["snow"],
    ]);
    // Each URL names an immutable commit, so the transcode is re-derivable.
    expect(F15_FAMILY.provenance.map((entry) => entry.url)).toEqual([
      "https://raw.githubusercontent.com/haskell-cryptography/cacophony/18b7348c54fd61fcd0c220298883de0d09c8364d/vectors/cacophony.txt",
      "https://raw.githubusercontent.com/mcginty/snow/d00b360cc61a7fe519ce7539974dca4f36c4654a/tests/vectors/snow.txt",
    ]);
    for (const entry of F15_FAMILY.provenance) {
      expect(entry.transcodedVectors).toEqual([
        "Noise_IK_25519_ChaChaPoly_SHA256",
        "Noise_NX_25519_ChaChaPoly_SHA256",
      ]);
    }
  });

  it("carries the handshake hash the cacophony set publishes and none from snow", () => {
    const handshakeHashOf = (name: string): string | undefined =>
      F15_FAMILY.cases.find((entry) => entry.name === name)?.expected.handshakeHash?.$bytes;
    expect(handshakeHashOf("cacophony/Noise_IK_25519_ChaChaPoly_SHA256")).toBe(
      CACOPHONY_IK_HANDSHAKE_HASH,
    );
    expect(handshakeHashOf("cacophony/Noise_NX_25519_ChaChaPoly_SHA256")).toBe(
      CACOPHONY_NX_HANDSHAKE_HASH,
    );
    expect(handshakeHashOf("snow/Noise_IK_25519_ChaChaPoly_SHA256")).toBeUndefined();
    expect(handshakeHashOf("snow/Noise_NX_25519_ChaChaPoly_SHA256")).toBeUndefined();
  });

  for (const vectorCase of F15_FAMILY.cases) {
    const { inputs, expected } = vectorCase;
    const isIk = inputs.pattern === E2EE_NOISE_PATTERN_IK;

    describe(vectorCase.name, () => {
      it("reproduces the pattern's protocol name, message count, and pre-message static", () => {
        expect(inputs.protocolName).toBe(
          isIk ? E2EE_NOISE_PROTOCOL_NAME_IK : E2EE_NOISE_PROTOCOL_NAME_NX,
        );
        expect(e2eeNoiseProtocolName(inputs.pattern)).toBe(inputs.protocolName);
        // Both §3.4 patterns are exactly two handshake messages long.
        expect(expected.handshakeMessages).toHaveLength(2);
        expect(inputs.handshakePayloads).toHaveLength(2);
        // Both ends of a vector agree on the §8.4 prologue.
        expect(hex(f15Bytes(inputs.initiatorPrologue))).toBe(
          hex(f15Bytes(inputs.responderPrologue)),
        );
        if (isIk) {
          // IK's `<- s` pre-message: the initiator's remote static is exactly
          // the responder's static public key, so the vector is internally
          // consistent before this module touches it.
          expect(hex(f15Bytes(inputs.testOnlyInitiatorRemoteStaticPublicKey!))).toBe(
            hex(x25519.getPublicKey(f15Bytes(inputs.testOnlyResponderStaticSecretKey))),
          );
        } else {
          expect(inputs.testOnlyInitiatorStaticSecretKey).toBeUndefined();
          expect(inputs.testOnlyInitiatorRemoteStaticPublicKey).toBeUndefined();
        }
      });

      it("drives both roles through every message, the handshake hash, and Split()", () => {
        const initiator = new E2eeNoiseHandshake({
          pattern: inputs.pattern,
          role: "initiator",
          prologue: f15Bytes(inputs.initiatorPrologue),
          staticSecretKey: isIk ? f15Bytes(inputs.testOnlyInitiatorStaticSecretKey!) : undefined,
          remoteStaticPublicKey: isIk
            ? f15Bytes(inputs.testOnlyInitiatorRemoteStaticPublicKey!)
            : undefined,
          testOnlyEphemeralSecretKey: f15Bytes(inputs.testOnlyInitiatorEphemeralSecretKey),
        });
        const responder = new E2eeNoiseHandshake({
          pattern: inputs.pattern,
          role: "responder",
          prologue: f15Bytes(inputs.responderPrologue),
          staticSecretKey: f15Bytes(inputs.testOnlyResponderStaticSecretKey),
          testOnlyEphemeralSecretKey: f15Bytes(inputs.testOnlyResponderEphemeralSecretKey),
        });

        // Message 1, initiator → responder. The responder is fed the VECTOR's
        // bytes rather than the ones just written, so a writer defect cannot
        // mask a reader defect.
        const message1 = initiator.writeMessage(f15Bytes(inputs.handshakePayloads[0]!));
        expect(hex(message1)).toBe(expected.handshakeMessages[0]!.$bytes);
        expect(hex(responder.readMessage(f15Bytes(expected.handshakeMessages[0]!)))).toBe(
          inputs.handshakePayloads[0]!.$bytes,
        );

        // Message 2, responder → initiator.
        const message2 = responder.writeMessage(f15Bytes(inputs.handshakePayloads[1]!));
        expect(hex(message2)).toBe(expected.handshakeMessages[1]!.$bytes);
        expect(hex(initiator.readMessage(f15Bytes(expected.handshakeMessages[1]!)))).toBe(
          inputs.handshakePayloads[1]!.$bytes,
        );

        // The static the pattern transmits, at the end that learns it.
        if (isIk) {
          expect(hex(responder.remoteStaticPublicKey!)).toBe(
            hex(x25519.getPublicKey(f15Bytes(inputs.testOnlyInitiatorStaticSecretKey!))),
          );
        } else {
          // NX transmits the responder static in message 2 and no client static
          // at all (§8.7, §8.10).
          expect(hex(initiator.remoteStaticPublicKey!)).toBe(
            hex(x25519.getPublicKey(f15Bytes(inputs.testOnlyResponderStaticSecretKey))),
          );
          expect(responder.remoteStaticPublicKey).toBeUndefined();
        }

        // Noise §5.2 `h` after the last handshake message, at both ends.
        const initiatorHash = initiator.testOnlyHandshakeHash!;
        const responderHash = responder.testOnlyHandshakeHash!;
        expect(initiatorHash.byteLength).toBe(32);
        expect(hex(initiatorHash)).toBe(hex(responderHash));
        if (expected.handshakeHash !== undefined) {
          expect(hex(initiatorHash)).toBe(expected.handshakeHash.$bytes);
          expect(hex(responderHash)).toBe(expected.handshakeHash.$bytes);
        }

        const initiatorKeys = initiator.split();
        const responderKeys = responder.split();
        expect(hex(initiatorKeys.epochSecretC2N)).toBe(hex(responderKeys.epochSecretC2N));
        expect(hex(initiatorKeys.epochSecretN2C)).toBe(hex(responderKeys.epochSecretN2C));
        expect(hex(initiatorKeys.exporterSecret)).toBe(hex(responderKeys.exporterSecret));
        // §6.5 erases the handshake hash with the rest of the state.
        expect(initiator.testOnlyHandshakeHash).toBeUndefined();
        expect(responder.testOnlyHandshakeHash).toBeUndefined();

        // The transport messages are the vectors' evidence for `Split()`: the
        // sets publish no split keys, but every post-handshake ciphertext is
        // produced under one of them with an empty AD and its own counter from
        // zero, so reproducing them byte for byte pins both outputs AND their
        // §6.5 order — the first is initiator-to-responder, the second is
        // responder-to-initiator, and swapping them fails here.
        expect(expected.transportMessages).toHaveLength(inputs.transportPayloads.length);
        expect(expected.transportMessages.length).toBeGreaterThan(0);
        let initiatorCounter = 0n;
        let responderCounter = 0n;
        for (const [index, transportMessage] of expected.transportMessages.entries()) {
          // Transport messages alternate, starting with the initiator, because
          // both patterns end on a responder message.
          const fromInitiator = index % 2 === 0;
          const counter = fromInitiator ? initiatorCounter : responderCounter;
          const senderKey = fromInitiator
            ? initiatorKeys.epochSecretC2N
            : initiatorKeys.epochSecretN2C;
          const receiverKey = fromInitiator
            ? responderKeys.epochSecretC2N
            : responderKeys.epochSecretN2C;
          const payload = f15Bytes(inputs.transportPayloads[index]!);
          const nonce = e2eeNoiseCipherNonce(counter);
          expect(hex(chacha20poly1305(senderKey, nonce, EMPTY_PAYLOAD).encrypt(payload))).toBe(
            transportMessage.$bytes,
          );
          expect(
            hex(
              chacha20poly1305(receiverKey, nonce, EMPTY_PAYLOAD).decrypt(
                f15Bytes(transportMessage),
              ),
            ),
          ).toBe(inputs.transportPayloads[index]!.$bytes);
          if (fromInitiator) initiatorCounter += 1n;
          else responderCounter += 1n;
        }
      });
    });
  }
});

describe("determinism and separation", () => {
  it("is a pure function of the pattern, prologue, keys, and payloads", () => {
    const run = (): string[] => {
      const client = ikClient();
      const node = ikNode();
      const message1 = client.writeMessage(MESSAGE_1_PAYLOAD);
      node.readMessage(message1);
      const message2 = node.writeMessage(MESSAGE_2_PAYLOAD);
      client.readMessage(message2);
      const keys = client.split();
      return [hex(message1), hex(message2), hex(keys.exporterSecret)];
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual([IK_MESSAGE_1, IK_MESSAGE_2, IK_EXPORTER_SECRET]);
  });

  it("re-rolls every session value when one ephemeral changes", () => {
    const client = ikClient();
    const node = ikNode({
      testOnlyEphemeralSecretKey: Uint8Array.from(OTHER_NODE_EPHEMERAL_SECRET),
    });
    node.readMessage(client.writeMessage(MESSAGE_1_PAYLOAD));
    client.readMessage(node.writeMessage(MESSAGE_2_PAYLOAD));
    const keys = client.split();
    expect(hex(keys.exporterSecret)).toBe(
      "a683f972c924547a055bef643fd88884558f694d7d9937ae8a62783580c73246",
    );
    expect(hex(keys.exporterSecret)).not.toBe(IK_EXPORTER_SECRET);
    expect(hex(keys.epochSecretC2N)).not.toBe(IK_EPOCH_SECRET_C2N);
    expect(hex(keys.epochSecretN2C)).not.toBe(IK_EPOCH_SECRET_N2C);
  });
});

describe("§16.3 corpus liveness, F15 half", () => {
  it("reads a leaf of every F15 case the shared ledger delegates to this suite", () => {
    // F15 is transcoded rather than generated and is consumed HERE, not by the
    // shared corpus suite — which is exactly why its four cases read as carrying
    // no live leaf over there. The delegation is written down in the shared
    // ledger's liveness table; this is where it is discharged.
    const delegated = E2EE_CORPUS_CASE_LIVENESS.filter((claim) => claim.reader === "noise");
    expect(delegated.length, "the table delegates nothing to this suite").toBe(4);
    for (const claim of delegated) {
      expect(
        F15_LIVENESS.liveLeafCount(claim.file, claim.case),
        `${claim.file}: ${claim.case} is delegated to this suite and read by nothing in it`,
      ).toBeGreaterThan(0);
    }
  });

  it("reads every leaf the census attributes to this suite", () => {
    // The corpus manifest's per-family live count is a union across three
    // suites, and the shared corpus suite recomputes it EXACTLY using
    // `E2EE_CORPUS_DELEGATED_LEAF_READS` — a table of leaf paths that other
    // suites, this one among them, are the sole readers of. Over there the table
    // can only be checked for naming real leaves the shared suite does not read.
    // Whether F15's leaves are read at all is knowable only here, so an entry
    // that nothing reads must fail HERE or the union can be inflated at will.
    const mine = E2EE_CORPUS_DELEGATED_LEAF_READS.filter((entry) => entry.reader === "noise");
    expect(mine.length, "the attribution delegates nothing to this suite").toBeGreaterThan(0);
    for (const entry of mine) {
      const read = new Set(F15_LIVENESS.liveLeafPaths(entry.file, entry.case));
      for (const path of entry.paths) {
        expect(
          read.has(path),
          `${entry.file}: ${entry.case}.${path} is counted live because this suite is said to read it, and this suite does not`,
        ).toBe(true);
      }
    }
  });
});
