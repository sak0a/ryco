import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_AEAD_NONCE_BYTES,
  E2EE_CLOSE_RECORDS_RESERVED,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_ERROR_BODY_MAX_BYTES,
  E2EE_ERROR_RECORDS_RESERVED,
  E2EE_REKEY_MAX_BYTES,
  E2EE_REKEY_MAX_RECORDS,
  E2EE_SECRET_BYTES,
} from "./relayE2eeConstants.ts";
import { E2eeNoiseHandshake } from "./relayE2eeNoise.ts";
import {
  E2EE_AEAD_KEY_LABEL,
  E2EE_CLOSE_RECORD_PLAINTEXT_BYTES,
  E2EE_CONFIRMATION_KEY_LABEL,
  E2EE_ERROR_RECORD_PLAINTEXT_MAX_BYTES,
  E2EE_POST_APPLICATION_RESERVE_PLAINTEXT_BYTES,
  E2EE_POST_APPLICATION_RESERVE_RECORDS,
  E2EE_RATCHET_LABEL,
  E2eeRecordSession,
  deriveE2eeAeadKey,
  deriveE2eeEpochKeys,
  deriveE2eeNextEpochSecret,
  deriveE2eeServerConfirmationKey,
  deriveE2eeSessionSecrets,
  e2eeSessionSecretsFromNoiseKeys,
  eraseE2eeSessionSecrets,
  type E2eeProtectResult,
  type E2eeRecordAeadFactory,
  type E2eeSyntheticDirectionState,
  type E2eeTransmitOutcome,
} from "./relayE2eeSession.ts";
import { E2EE_NOISE_PATTERN_IK } from "./relayE2eeTranscripts.ts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_CLOSE,
  E2EE_INNER_TYPE_CLOSE_ACK,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
  e2eeAeadNonce,
  e2eeAeadNonceFromHeader,
  e2eeEnvelopeAad,
  encodeE2eeEnvelope,
  encodeE2eeEnvelopeHeader,
  encodeE2eeInnerRecord,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "./relayE2eeWire.ts";

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// ─── §16.1-style TEST-ONLY material ──────────────────────────────────────────
//
// Fixed counting patterns, so every derived value below is reproducible from
// the document alone. None of it may ever reach a real endpoint.

const EPOCH_SECRET_C2N = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const EPOCH_SECRET_N2C = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const EXPORTER_SECRET = "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f";
const SESSION_BINDING_HASH = "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f";

// ─── golden key schedule ─────────────────────────────────────────────────────
//
// Literal expectations for the material above. Every one of them is ALSO
// recomputed in the tests from `HMAC-SHA256(prk, info ‖ 0x01)` — RFC 5869's
// HKDF-Expand for an output of exactly one hash length — so the literals are
// pinned wire values and the construction is independently checked rather than
// asserted against itself.

const SERVER_CONFIRMATION_KEY = "3b4eaff2a2ca28ef38a7425acd7a4efdd30ff7d271a6843526f0e125bbdba670";

const C2N_AEAD_KEYS = [
  "7bd4602d7a0d21faf875a90cdc347feb70567c631f6238c54f6f81d8a930510d",
  "6d46fba88a88c103c90b293b5355b3c34a405840947100811df8646cb70c1c19",
  "9766a96d6667e55534cc00b7cef9cea1cd6681c1ddeeb35974203bbeebcebab3",
] as const;
const C2N_EPOCH_SECRETS = [
  EPOCH_SECRET_C2N,
  "a097f9803908b144d47f69454ff7dca3e7fb9f1470f619031db76656199178d3",
  "a7a65d2e5740f6450398549a76c6f84c700ebff2e4b7ce2bd5f8edd544b93636",
  "056ddb1cfb7ab3ce340a1b9ac57e5c43cb01f933a13a9ed9f90e63f5b235bd0f",
] as const;
const N2C_AEAD_KEYS = [
  "2ee668b7fb3a15b93fc2f5672905ba8c6300b28cbe631a751dd313fd6abf32e7",
  "f65eb3561cb28e8055ae1748a4e4c4f0038c0bc9fd6468d33fb50ece9dd0503f",
  "7bbd115f997d159eb77d982b2a34c5b9111b08f2814ab5849d501ec03054148c",
] as const;
const N2C_EPOCH_SECRETS = [
  EPOCH_SECRET_N2C,
  "8150e33da866e77bb26f72c80dc441a2b536890485cfdc2f965942fc5fff5315",
  "ef6fa6d77cbbb35c023b40302680719c78c53393eefcb2bcf96502cd9b3ecc5a",
  "6446cf65a1255290d65b5f4f1e20b2dd0262d17f17efe80347f71d1cd80c0ae0",
] as const;

// The §3.3 header and AAD of the first record in each direction, for the
// session binding hash above (§16.3 F8: exact AAD bytes for both directions).
const FIRST_HEADER = "010101000000000000000000000000";
const FIRST_AAD_C2N = `${FIRST_HEADER}${SESSION_BINDING_HASH}63326e`;
const FIRST_AAD_N2C = `${FIRST_HEADER}${SESSION_BINDING_HASH}6e3263`;
// The complete first two client-to-node envelopes carrying the body "ryco".
const RYCO_ENVELOPE_0 = "010101000000000000000000000000f49781deb9de9a8fd9a3b812f3a20a6cced2b51388";
const RYCO_ENVELOPE_1 = "01010100000000000000000000000125a27b4d21a656328c9aea10ac305c531fe533416e";

// The §8 IK handshake material of `relayE2eeNoise.test.ts`, reused so the
// end-to-end §6.5 vector is anchored to keys that file already pins.
const CLIENT_STATIC_SECRET = bytes(
  "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
);
const NODE_STATIC_SECRET = bytes(
  "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
);
const NODE_STATIC_PUBLIC = bytes(
  "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
);
const CLIENT_EPHEMERAL_SECRET = bytes(
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
);
const NODE_EPHEMERAL_SECRET = bytes(
  "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40",
);
const IK_PROLOGUE = bytes("a1b2c3d4e5f6");
const IK_EPOCH_SECRET_C2N = "4baa406898c98ea1b8ee046dffc725a94e6507fb00ce8f5b3cb6740221f5c296";
const IK_EPOCH_SECRET_N2C = "66937266322565f6ce0f54a4b96f8662341a79048d6abf3d7750bb37a3d1f193";
const IK_EXPORTER_SECRET = "67ccffd18305fbdda59ee370c91b8957bc8ae19f244dc821ff3f1e8c874577f9";
const IK_SERVER_CONFIRMATION_KEY =
  "05ce96a84def8dfdce12ae373171f0081bc9a781b027aabba1176344bee8931e";
const IK_AEAD_KEY_C2N = "691c19cbc25f42b54db513757258d1022c493196905431c569c91b5d75ce5eac";
const IK_AEAD_KEY_N2C = "176b8d854b0a7f730488d2ac78299c7b64a44db2cbc0777a28388bb5c656e70c";

/**
 * RFC 5869 HKDF-Expand for `L = HashLen`: `T(1) = HMAC(PRK, info ‖ 0x01)`.
 * Written out here so the §9.4 schedule is checked against the RFC rather than
 * against the module's own call into the HKDF primitive.
 */
const expandOneBlock = (prk: Uint8Array, info: Uint8Array): Uint8Array =>
  hmac(sha256, prk, concatBytes(info, Uint8Array.of(0x01)));

const directionalInfo = (label: string, direction: E2eeDirection): Uint8Array =>
  concatBytes(utf8ToBytes(label), utf8ToBytes(direction));

const freshSecrets = (): ReturnType<typeof e2eeSessionSecretsFromNoiseKeys> =>
  e2eeSessionSecretsFromNoiseKeys({
    epochSecretC2N: bytes(EPOCH_SECRET_C2N),
    epochSecretN2C: bytes(EPOCH_SECRET_N2C),
    exporterSecret: bytes(EXPORTER_SECRET),
  });

/**
 * An epoch secret that counts every read of `length`. HKDF-Expand reads that on
 * its PRK while `requireSecret` uses `byteLength` and erasure fills through the
 * internal slot, so a positive count answers one question: has an epoch key
 * been DERIVED from this secret? The primitive may validate or copy the PRK
 * more than once without changing that answer.
 */
class WatchedEpochSecret extends Uint8Array {
  hkdfReads = 0;

  override get length(): number {
    this.hkdfReads += 1;
    return super.length;
  }
}

const watchedEpochSecret = (value: Uint8Array): WatchedEpochSecret => {
  const watched = new WatchedEpochSecret(value.byteLength);
  watched.set(value);
  watched.hkdfReads = 0;
  return watched;
};

interface CountingAead {
  readonly calls: { select: number; seal: number; open: number };
  readonly factory: E2eeRecordAeadFactory;
}

/**
 * A counting stand-in for the suite AEAD. §9.1 requires the version and suite
 * comparison, and §9.2 the sequence comparison, to happen BEFORE any AEAD
 * implementation is selected; `select` is what makes that observable.
 */
const countingAead = (): CountingAead => {
  const calls = { select: 0, seal: 0, open: 0 };
  const factory: E2eeRecordAeadFactory = ({ key }) => {
    calls.select += 1;
    return {
      seal: (nonce, plaintext, aad) => {
        calls.seal += 1;
        return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
      },
      open: (nonce, ciphertext, aad) => {
        calls.open += 1;
        return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
      },
    };
  };
  return { calls, factory };
};

interface PairOptions {
  readonly suite?: 1 | 2;
  /** Applied to the client's send state and the node's receive state (`c2n`). */
  readonly c2n?: E2eeSyntheticDirectionState;
  /** Applied to the node's send state and the client's receive state (`n2c`). */
  readonly n2c?: E2eeSyntheticDirectionState;
  readonly plaintextCeiling?: number;
  readonly clientAead?: E2eeRecordAeadFactory;
  readonly nodeAead?: E2eeRecordAeadFactory;
}

const sessionPair = (
  options: PairOptions = {},
): { client: E2eeRecordSession; node: E2eeRecordSession } => {
  const plaintextCeiling = options.plaintextCeiling ?? 1_024;
  const suite = options.suite ?? E2EE_SUITE_25519_CHACHAPOLY_SHA256;
  const client = new E2eeRecordSession({
    secrets: freshSecrets(),
    suite,
    sessionBindingHash: bytes(SESSION_BINDING_HASH),
    sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
    plaintextCeiling,
    testOnlySyntheticSendState: options.c2n,
    testOnlySyntheticReceiveState: options.n2c,
    testOnlyAeadFactory: options.clientAead,
  });
  const node = new E2eeRecordSession({
    secrets: freshSecrets(),
    suite,
    sessionBindingHash: bytes(SESSION_BINDING_HASH),
    sendDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
    plaintextCeiling,
    testOnlySyntheticSendState: options.n2c,
    testOnlySyntheticReceiveState: options.c2n,
    testOnlyAeadFactory: options.nodeAead,
  });
  return { client, node };
};

interface SendOptions {
  readonly admit?: (envelopeBytes: number) => boolean | Promise<boolean>;
  readonly outcome?: E2eeTransmitOutcome;
}

const send = async (
  session: E2eeRecordSession,
  innerType: E2eeInnerRecordType,
  body: Uint8Array,
  options: SendOptions = {},
): Promise<{ result: E2eeProtectResult; envelope: Uint8Array | undefined; admitted: number[] }> => {
  const admitted: number[] = [];
  let envelope: Uint8Array | undefined;
  const result = await session.protect({
    innerType,
    body,
    admit: (envelopeBytes) => {
      admitted.push(envelopeBytes);
      return options.admit?.(envelopeBytes) ?? true;
    },
    transmit: (bytesToSend) => {
      envelope = bytesToSend;
      return options.outcome ?? { kind: "sent" };
    },
  });
  return { result, envelope, admitted };
};

describe("relay E2EE key schedule (§6.5, §8.7, §9.4)", () => {
  it("pins the §3.5 HKDF labels", () => {
    expect(E2EE_CONFIRMATION_KEY_LABEL).toBe("ryco.relay-e2ee.confirmation-key.v1");
    expect(E2EE_AEAD_KEY_LABEL).toBe("ryco.relay-e2ee.aead-key.v1");
    expect(E2EE_RATCHET_LABEL).toBe("ryco.relay-e2ee.ratchet.v1");
  });

  it("derives serverConfirmationKey from exporterSecret (§8.7)", () => {
    const derived = deriveE2eeServerConfirmationKey(bytes(EXPORTER_SECRET));
    expect(hex(derived)).toBe(SERVER_CONFIRMATION_KEY);
    expect(derived.byteLength).toBe(E2EE_SECRET_BYTES);
    // The label is NOT directional (§3.5): the info is the label bytes alone.
    expect(hex(derived)).toBe(
      hex(expandOneBlock(bytes(EXPORTER_SECRET), utf8ToBytes(E2EE_CONFIRMATION_KEY_LABEL))),
    );
  });

  it("derives aeadKey_d[e] and epochSecret_d[e+1] for epochs zero through two (§9.4)", () => {
    for (const [direction, aeadKeys, epochSecrets] of [
      [E2EE_DIRECTION_CLIENT_TO_NODE, C2N_AEAD_KEYS, C2N_EPOCH_SECRETS],
      [E2EE_DIRECTION_NODE_TO_CLIENT, N2C_AEAD_KEYS, N2C_EPOCH_SECRETS],
    ] as const) {
      for (let epoch = 0; epoch < 3; epoch += 1) {
        const epochSecret = bytes(epochSecrets[epoch]!);
        const { aeadKey, nextEpochSecret } = deriveE2eeEpochKeys(epochSecret, direction);
        expect(hex(aeadKey)).toBe(aeadKeys[epoch]);
        expect(hex(nextEpochSecret)).toBe(epochSecrets[epoch + 1]);
        expect(aeadKey.byteLength).toBe(E2EE_SECRET_BYTES);
        expect(nextEpochSecret.byteLength).toBe(E2EE_SECRET_BYTES);
        // The `info` is the label bytes followed by the §3.4 direction label.
        expect(hex(aeadKey)).toBe(
          hex(expandOneBlock(epochSecret, directionalInfo(E2EE_AEAD_KEY_LABEL, direction))),
        );
        expect(hex(nextEpochSecret)).toBe(
          hex(expandOneBlock(epochSecret, directionalInfo(E2EE_RATCHET_LABEL, direction))),
        );
      }
    }
  });

  it("separates the two directions and the two labels for one epoch secret", () => {
    const secret = bytes(EPOCH_SECRET_C2N);
    const derived = [
      hex(deriveE2eeAeadKey(secret, E2EE_DIRECTION_CLIENT_TO_NODE)),
      hex(deriveE2eeAeadKey(secret, E2EE_DIRECTION_NODE_TO_CLIENT)),
      hex(deriveE2eeNextEpochSecret(secret, E2EE_DIRECTION_CLIENT_TO_NODE)),
      hex(deriveE2eeNextEpochSecret(secret, E2EE_DIRECTION_NODE_TO_CLIENT)),
    ];
    expect(new Set(derived).size).toBe(4);
    // The directional half is the label the SAME secret is expanded under, so a
    // schedule that dropped the direction label would collapse rows 1 and 2.
    expect(derived[0]).toBe(C2N_AEAD_KEYS[0]);
    expect(derived[2]).toBe(C2N_EPOCH_SECRETS[1]);
  });

  it("rejects secrets that are not E2EE_SECRET_BYTES long", () => {
    expect(() => deriveE2eeAeadKey(new Uint8Array(31), E2EE_DIRECTION_CLIENT_TO_NODE)).toThrow(
      TypeError,
    );
    expect(() =>
      deriveE2eeNextEpochSecret(new Uint8Array(33), E2EE_DIRECTION_NODE_TO_CLIENT),
    ).toThrow(TypeError);
    expect(() => deriveE2eeServerConfirmationKey(new Uint8Array(0))).toThrow(TypeError);
    expect(() =>
      deriveE2eeAeadKey(bytes(EPOCH_SECRET_C2N), "n2n" as unknown as E2eeDirection),
    ).toThrow(TypeError);
  });

  it("takes the §6.5 session secrets from a completed Noise handshake", () => {
    const client = new E2eeNoiseHandshake({
      pattern: E2EE_NOISE_PATTERN_IK,
      role: "initiator",
      prologue: IK_PROLOGUE,
      staticSecretKey: CLIENT_STATIC_SECRET,
      remoteStaticPublicKey: NODE_STATIC_PUBLIC,
      testOnlyEphemeralSecretKey: Uint8Array.from(CLIENT_EPHEMERAL_SECRET),
    });
    const node = new E2eeNoiseHandshake({
      pattern: E2EE_NOISE_PATTERN_IK,
      role: "responder",
      prologue: IK_PROLOGUE,
      staticSecretKey: NODE_STATIC_SECRET,
      testOnlyEphemeralSecretKey: Uint8Array.from(NODE_EPHEMERAL_SECRET),
    });
    const message1 = client.writeMessage(new Uint8Array(0));
    node.readMessage(message1);
    const message2 = node.writeMessage(new Uint8Array(0));
    client.readMessage(message2);

    const clientSecrets = deriveE2eeSessionSecrets(client);
    const nodeSecrets = deriveE2eeSessionSecrets(node);
    for (const secrets of [clientSecrets, nodeSecrets]) {
      expect(hex(secrets.epochSecretC2N)).toBe(IK_EPOCH_SECRET_C2N);
      expect(hex(secrets.epochSecretN2C)).toBe(IK_EPOCH_SECRET_N2C);
      expect(hex(secrets.exporterSecret)).toBe(IK_EXPORTER_SECRET);
      expect(hex(secrets.serverConfirmationKey)).toBe(IK_SERVER_CONFIRMATION_KEY);
      // §9.4: both direction schedules exist at both endpoints.
      expect(hex(deriveE2eeAeadKey(secrets.epochSecretC2N, E2EE_DIRECTION_CLIENT_TO_NODE))).toBe(
        IK_AEAD_KEY_C2N,
      );
      expect(hex(deriveE2eeAeadKey(secrets.epochSecretN2C, E2EE_DIRECTION_NODE_TO_CLIENT))).toBe(
        IK_AEAD_KEY_N2C,
      );
    }
    expect(client.status).toBe("complete");
    expect(node.status).toBe("complete");

    eraseE2eeSessionSecrets(clientSecrets);
    expect(hex(clientSecrets.epochSecretC2N)).toBe("00".repeat(E2EE_SECRET_BYTES));
    expect(hex(clientSecrets.epochSecretN2C)).toBe("00".repeat(E2EE_SECRET_BYTES));
    expect(hex(clientSecrets.exporterSecret)).toBe("00".repeat(E2EE_SECRET_BYTES));
    expect(hex(clientSecrets.serverConfirmationKey)).toBe("00".repeat(E2EE_SECRET_BYTES));
    eraseE2eeSessionSecrets(nodeSecrets);
  });

  it("pins the §9.6 post-application reserve sizes", () => {
    // The §10.1 close body is five fixed-width byte strings: 1 + 5 + 9 + 5 + 9 +
    // 34 = 63 bytes, plus the inner type byte.
    expect(E2EE_CLOSE_RECORD_PLAINTEXT_BYTES).toBe(64);
    expect(E2EE_ERROR_RECORD_PLAINTEXT_MAX_BYTES).toBe(1 + E2EE_ERROR_BODY_MAX_BYTES);
    expect(E2EE_ERROR_RECORD_PLAINTEXT_MAX_BYTES).toBe(17);
    expect(E2EE_POST_APPLICATION_RESERVE_RECORDS).toBe(
      E2EE_CLOSE_RECORDS_RESERVED + E2EE_ERROR_RECORDS_RESERVED,
    );
    expect(E2EE_POST_APPLICATION_RESERVE_RECORDS).toBe(3);
    expect([...E2EE_POST_APPLICATION_RESERVE_PLAINTEXT_BYTES]).toEqual([64, 64, 17]);
  });
});

describe("relay E2EE record protection (§9.1)", () => {
  it("protects one inner record per envelope with the §3.3 header, nonce, and AAD", async () => {
    const { client, node } = sessionPair();
    const first = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    expect(first.result).toEqual({
      kind: "protected",
      epoch: 0n,
      counter: 0n,
      plaintextBytes: 5,
      envelopeBytes: 36,
      epochCompleted: false,
    });
    expect(hex(first.envelope!)).toBe(RYCO_ENVELOPE_0);
    expect(hex(first.envelope!.subarray(0, E2EE_ENVELOPE_HEADER_BYTES))).toBe(FIRST_HEADER);
    // §9.3: admission covers the ENTIRE record — the envelope, not the body.
    expect(first.admitted).toEqual([E2EE_ENVELOPE_OVERHEAD_BYTES + 4]);
    expect(first.envelope!.byteLength).toBe(E2EE_ENVELOPE_OVERHEAD_BYTES + 4);

    const header = first.envelope!.subarray(0, E2EE_ENVELOPE_HEADER_BYTES);
    expect(hex(e2eeAeadNonceFromHeader(header))).toBe("000000000000000000000000");
    expect(hex(e2eeAeadNonce(0n, 0n))).toBe(hex(e2eeAeadNonceFromHeader(header)));
    expect(
      hex(
        e2eeEnvelopeAad({
          header,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          direction: E2EE_DIRECTION_CLIENT_TO_NODE,
        }),
      ),
    ).toBe(FIRST_AAD_C2N);

    const received = node.unprotect(first.envelope!);
    expect(received).toEqual({
      kind: "authenticated",
      innerType: E2EE_INNER_TYPE_RPC,
      body: utf8ToBytes("ryco"),
      epoch: 0n,
      counter: 0n,
      plaintextBytes: 5,
      epochCompleted: false,
    });

    const second = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    expect(hex(second.envelope!)).toBe(RYCO_ENVELOPE_1);
    expect(node.unprotect(second.envelope!).kind).toBe("authenticated");
    expect(node.receiveState).toEqual({
      epoch: 0n,
      counter: 2n,
      epochRecords: 2,
      epochBytes: 10,
      exhausted: false,
    });
  });

  it("uses the same record primitives under the registered account-grant suite id", async () => {
    const { client, node } = sessionPair({
      suite: E2EE_SUITE_ACCOUNT_GRANT_25519_CHACHAPOLY_SHA256,
    });
    const sent = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("account-enrolled"));
    expect(sent.envelope?.[2]).toBe(0x02);
    expect(node.unprotect(sent.envelope!)).toMatchObject({
      kind: "authenticated",
      body: utf8ToBytes("account-enrolled"),
    });
  });

  it("pins the node-to-client AAD and protects the reverse direction with no prior traffic", async () => {
    const { client, node } = sessionPair();
    const sent = await send(node, E2EE_INNER_TYPE_RPC, utf8ToBytes("hello"));
    expect((sent.result as { kind: string }).kind).toBe("protected");
    const header = sent.envelope!.subarray(0, E2EE_ENVELOPE_HEADER_BYTES);
    expect(hex(header)).toBe(FIRST_HEADER);
    expect(
      hex(
        e2eeEnvelopeAad({
          header,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          direction: E2EE_DIRECTION_NODE_TO_CLIENT,
        }),
      ),
    ).toBe(FIRST_AAD_N2C);
    // §9.4: both direction schedules are derived at both endpoints regardless of
    // traffic, so the client authenticates a node record before sending any.
    const received = client.unprotect(sent.envelope!);
    expect(received.kind).toBe("authenticated");
    expect(client.sendState.counter).toBe(0n);
  });

  it("carries control records on the same directional sequence (§4.1, §9.1)", async () => {
    const { client, node } = sessionPair();
    const rpc = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("a"));
    const closeAck = await send(client, E2EE_INNER_TYPE_CLOSE_ACK, new Uint8Array(63));
    const error = await send(client, E2EE_INNER_TYPE_ERROR, Uint8Array.of(0x81, 0x01));
    expect((rpc.result as { counter: bigint }).counter).toBe(0n);
    expect((closeAck.result as { counter: bigint }).counter).toBe(1n);
    expect((error.result as { counter: bigint }).counter).toBe(2n);

    expect(node.unprotect(rpc.envelope!)).toMatchObject({ innerType: E2EE_INNER_TYPE_RPC });
    expect(node.unprotect(closeAck.envelope!)).toMatchObject({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      plaintextBytes: 64,
    });
    expect(node.unprotect(error.envelope!)).toMatchObject({ innerType: E2EE_INNER_TYPE_ERROR });
    // Control records count toward both thresholds like every other record.
    expect(node.receiveState).toEqual({
      epoch: 0n,
      counter: 3n,
      epochRecords: 3,
      epochBytes: 2 + 64 + 3,
      exhausted: false,
    });
  });

  it("accepts a zero-length body and enforces the §4.5 plaintext ceiling", async () => {
    const { client, node } = sessionPair({ plaintextCeiling: 8 });
    const empty = await send(client, E2EE_INNER_TYPE_RPC, new Uint8Array(0));
    expect(empty.result).toMatchObject({ kind: "protected", plaintextBytes: 1, envelopeBytes: 32 });
    expect(node.unprotect(empty.envelope!)).toMatchObject({
      innerType: E2EE_INNER_TYPE_RPC,
      body: new Uint8Array(0),
    });

    const atCeiling = await send(client, E2EE_INNER_TYPE_RPC, new Uint8Array(8));
    expect(atCeiling.result).toMatchObject({ kind: "protected", counter: 1n });
    const overCeiling = await send(client, E2EE_INNER_TYPE_RPC, new Uint8Array(9));
    expect(overCeiling.result).toEqual({ kind: "refused", reason: "e2ee_message_too_large" });
    expect(overCeiling.envelope).toBeUndefined();
    // Nothing consumed, channel unaffected (§11.4).
    expect(client.sendState.counter).toBe(2n);
    expect(overCeiling.admitted).toEqual([]);
  });

  it("fails authentication on a wrong direction label, binding hash, or ciphertext (§3.3)", () => {
    const key = deriveE2eeAeadKey(bytes(EPOCH_SECRET_C2N), E2EE_DIRECTION_CLIENT_TO_NODE);
    const header = encodeE2eeEnvelopeHeader({
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      epoch: 0n,
      counter: 0n,
    });
    const plaintext = encodeE2eeInnerRecord(E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    const seal = (sessionBindingHash: Uint8Array, direction: E2eeDirection): Uint8Array =>
      encodeE2eeEnvelope({
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        epoch: 0n,
        counter: 0n,
        ciphertext: chacha20poly1305(
          key,
          e2eeAeadNonceFromHeader(header),
          e2eeEnvelopeAad({ header, sessionBindingHash, direction }),
        ).encrypt(plaintext),
      });

    const correct = seal(bytes(SESSION_BINDING_HASH), E2EE_DIRECTION_CLIENT_TO_NODE);
    expect(hex(correct)).toBe(RYCO_ENVELOPE_0);
    expect(sessionPair().node.unprotect(correct).kind).toBe("authenticated");

    const wrongDirection = seal(bytes(SESSION_BINDING_HASH), E2EE_DIRECTION_NODE_TO_CLIENT);
    expect(sessionPair().node.unprotect(wrongDirection)).toEqual({
      kind: "fatal",
      reason: "authentication_failed",
    });

    const wrongBinding = seal(new Uint8Array(32), E2EE_DIRECTION_CLIENT_TO_NODE);
    expect(sessionPair().node.unprotect(wrongBinding)).toEqual({
      kind: "fatal",
      reason: "authentication_failed",
    });

    const tampered = Uint8Array.from(correct);
    tampered[E2EE_ENVELOPE_HEADER_BYTES + 1] = correct[E2EE_ENVELOPE_HEADER_BYTES + 1]! ^ 0x01;
    expect(sessionPair().node.unprotect(tampered)).toEqual({
      kind: "fatal",
      reason: "authentication_failed",
    });
  });

  it("rejects a version or suite mismatch before any AEAD implementation is selected (§9.1)", async () => {
    const sample = await send(sessionPair().client, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    const envelope = sample.envelope!;

    const badVersion = Uint8Array.from(envelope);
    badVersion[1] = 0x02;
    const versionAead = countingAead();
    expect(sessionPair({ nodeAead: versionAead.factory }).node.unprotect(badVersion)).toEqual({
      kind: "fatal",
      reason: "version_mismatch",
    });
    expect(versionAead.calls).toEqual({ select: 0, seal: 0, open: 0 });

    const badSuite = Uint8Array.from(envelope);
    badSuite[2] = 0x03;
    const suiteAead = countingAead();
    expect(sessionPair({ nodeAead: suiteAead.factory }).node.unprotect(badSuite)).toEqual({
      kind: "fatal",
      reason: "suite_mismatch",
    });
    expect(suiteAead.calls).toEqual({ select: 0, seal: 0, open: 0 });

    // The same session, given the untouched envelope, does select the AEAD —
    // so the two counts above are the ordering rule and not a dead counter.
    const goodAead = countingAead();
    expect(sessionPair({ nodeAead: goodAead.factory }).node.unprotect(envelope).kind).toBe(
      "authenticated",
    );
    expect(goodAead.calls).toEqual({ select: 1, seal: 0, open: 1 });
  });

  it("rejects a truncated envelope before any AEAD implementation is selected (§3.3)", async () => {
    const sample = await send(sessionPair().client, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    const aead = countingAead();
    const short = sample.envelope!.subarray(0, E2EE_ENVELOPE_OVERHEAD_BYTES - 1);
    expect(sessionPair({ nodeAead: aead.factory }).node.unprotect(short)).toEqual({
      kind: "fatal",
      reason: "malformed_envelope",
    });
    expect(aead.calls.select).toBe(0);
  });

  it("emits the established version and suite in every header (§9.1)", async () => {
    const { client } = sessionPair();
    const sent = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("x"));
    expect(sent.envelope![0]).toBe(0x01);
    expect(sent.envelope![1]).toBe(client.version);
    expect(sent.envelope![2]).toBe(client.suite);
    expect(hex(sent.envelope!.subarray(0, 3))).toBe("010101");
  });
});

describe("relay E2EE receiver sequencing (§9.2)", () => {
  const arrivalOf = async (
    counterOffset: number,
  ): Promise<{ node: E2eeRecordSession; envelopes: Uint8Array[] }> => {
    const { client, node } = sessionPair();
    const envelopes: Uint8Array[] = [];
    for (let index = 0; index <= counterOffset; index += 1) {
      const sent = await send(client, E2EE_INNER_TYPE_RPC, Uint8Array.of(index));
      envelopes.push(sent.envelope!);
    }
    return { node, envelopes };
  };

  it("treats a gap as fatal and never decrypts the ciphertext", async () => {
    const { envelopes } = await arrivalOf(2);
    const aead = countingAead();
    const { node } = sessionPair({ nodeAead: aead.factory });
    // Counter 1 while counter 0 is expected.
    expect(node.unprotect(envelopes[1]!)).toEqual({ kind: "fatal", reason: "sequence_mismatch" });
    expect(aead.calls).toEqual({ select: 0, seal: 0, open: 0 });
  });

  it("treats a repeat as fatal", async () => {
    const { envelopes } = await arrivalOf(1);
    const aead = countingAead();
    const { node } = sessionPair({ nodeAead: aead.factory });
    expect(node.unprotect(envelopes[0]!).kind).toBe("authenticated");
    expect(node.unprotect(envelopes[0]!)).toEqual({ kind: "fatal", reason: "sequence_mismatch" });
    expect(aead.calls).toEqual({ select: 1, seal: 0, open: 1 });
  });

  it("treats a regression as fatal", async () => {
    const { envelopes } = await arrivalOf(2);
    const { node } = sessionPair();
    expect(node.unprotect(envelopes[0]!).kind).toBe("authenticated");
    expect(node.unprotect(envelopes[1]!).kind).toBe("authenticated");
    const replayed = sessionPair().node;
    expect(replayed.unprotect(envelopes[0]!).kind).toBe("authenticated");
    // The receiver expects counter 1; counter 0 arriving again is a regression.
    expect(replayed.unprotect(envelopes[0]!)).toEqual({
      kind: "fatal",
      reason: "sequence_mismatch",
    });
  });

  it("treats an early rekey as fatal", async () => {
    // A peer that entered epoch 1 while the receiver still expects (0, 0).
    const early = sessionPair({ c2n: { epoch: 1n, counter: 0n } }).client;
    const sent = await send(early, E2EE_INNER_TYPE_RPC, utf8ToBytes("early"));
    expect(sent.envelope![3]).toBe(0x00);
    expect(sent.envelope![6]).toBe(0x01);
    const aead = countingAead();
    expect(sessionPair({ nodeAead: aead.factory }).node.unprotect(sent.envelope!)).toEqual({
      kind: "fatal",
      reason: "sequence_mismatch",
    });
    expect(aead.calls.select).toBe(0);
  });

  it("treats a late rekey as fatal", async () => {
    const boundary: E2eeSyntheticDirectionState = {
      epoch: 0n,
      counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
      epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
    };
    const { client, node } = sessionPair({ c2n: boundary });
    const last = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("last"));
    expect(last.result).toMatchObject({ epoch: 0n, epochCompleted: true });
    expect(node.unprotect(last.envelope!)).toMatchObject({ epochCompleted: true });
    expect(node.receiveState).toMatchObject({ epoch: 1n, counter: 0n });

    // A peer that stayed in epoch 0 for one more record: counter 65536 in epoch
    // 0, where the receiver now expects (1, 0).
    const late = sessionPair({
      c2n: { epoch: 0n, counter: BigInt(E2EE_REKEY_MAX_RECORDS), epochRecords: 0 },
    }).client;
    const stale = await send(late, E2EE_INNER_TYPE_RPC, utf8ToBytes("late"));
    expect(node.unprotect(stale.envelope!)).toEqual({ kind: "fatal", reason: "sequence_mismatch" });
  });

  it("treats a skipped rekey as fatal", async () => {
    const skipped = sessionPair({ c2n: { epoch: 2n, counter: 0n } }).client;
    const sent = await send(skipped, E2EE_INNER_TYPE_RPC, utf8ToBytes("skip"));
    expect(sessionPair().node.unprotect(sent.envelope!)).toEqual({
      kind: "fatal",
      reason: "sequence_mismatch",
    });
  });

  it("processes nothing after a fatal condition", async () => {
    const { envelopes } = await arrivalOf(1);
    const { node } = sessionPair();
    expect(node.unprotect(envelopes[1]!)).toEqual({ kind: "fatal", reason: "sequence_mismatch" });
    // Even the record it was expecting is not processed afterwards.
    expect(node.unprotect(envelopes[0]!)).toEqual({ kind: "fatal", reason: "receive_terminated" });
  });
});

describe("relay E2EE sender rules (§9.3)", () => {
  it("serializes concurrent sends so no two observe the same pair", async () => {
    const { client, node } = sessionPair();
    const events: string[] = [];
    const admissions: Array<(admitted: boolean) => void> = [];
    const envelopes: Uint8Array[] = [];
    const pending = [0, 1, 2].map((index) =>
      client.protect({
        innerType: E2EE_INNER_TYPE_RPC,
        body: Uint8Array.of(index),
        admit: () =>
          new Promise<boolean>((resolve) => {
            events.push(`admit${index}`);
            admissions.push(resolve);
          }),
        transmit: (envelope) => {
          events.push(`transmit${index}`);
          envelopes.push(envelope);
          return { kind: "sent" };
        },
      }),
    );

    await tick();
    // The second caller has not even reached admission: assignment, AEAD, and
    // the state advance are atomic with respect to every other send.
    expect(events).toEqual(["admit0"]);
    admissions[0]!(true);
    await tick();
    expect(events).toEqual(["admit0", "transmit0", "admit1"]);
    admissions[1]!(true);
    await tick();
    admissions[2]!(true);
    const results = await Promise.all(pending);
    expect(events).toEqual(["admit0", "transmit0", "admit1", "transmit1", "admit2", "transmit2"]);
    expect(results.map((result) => (result as { counter: bigint }).counter)).toEqual([0n, 1n, 2n]);
    for (const envelope of envelopes) {
      expect(node.unprotect(envelope).kind).toBe("authenticated");
    }
  });

  it("never consumes a pair for refused admission (§9.3, §11.4)", async () => {
    const aead = countingAead();
    const { client, node } = sessionPair({ clientAead: aead.factory });
    const refused = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("nope"), {
      admit: () => false,
    });
    expect(refused.result).toEqual({ kind: "refused", reason: "e2ee_send_unavailable" });
    expect(refused.envelope).toBeUndefined();
    expect(aead.calls).toEqual({ select: 0, seal: 0, open: 0 });
    expect(client.sendState).toEqual({
      epoch: 0n,
      counter: 0n,
      epochRecords: 0,
      epochBytes: 0,
      exhausted: false,
    });

    // The channel is unaffected and remains usable: the next record is still
    // the peer's expected (0, 0).
    const later = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    expect(hex(later.envelope!)).toBe(RYCO_ENVELOPE_0);
    expect(node.unprotect(later.envelope!).kind).toBe("authenticated");
  });

  it("stops the send path when a post-AEAD failure reached no byte of the relay", async () => {
    const { client } = sessionPair();
    const failed = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("gone"), {
      outcome: { kind: "failed", delivery: "none" },
    });
    expect(failed.result).toEqual({
      kind: "send_failed",
      epoch: 0n,
      counter: 0n,
      delivery: "none",
      sendPathUsable: false,
      mayEmitError: false,
    });
    // Consumed means consumed (§9.3): the pair advanced even though nothing
    // was delivered.
    expect(client.sendState).toMatchObject({ epoch: 0n, counter: 1n, epochRecords: 1 });
    expect(client.sendPathUsable).toBe(false);

    // §11.3 Q10: not even the `E2EEError` may follow, because it would create
    // exactly the gap being avoided.
    const afterError = await send(client, E2EE_INNER_TYPE_ERROR, Uint8Array.of(0x81, 0x01));
    expect(afterError.result).toEqual({ kind: "unavailable", reason: "send_path_unusable" });
    expect(afterError.envelope).toBeUndefined();
    const afterRpc = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("x"));
    expect(afterRpc.result).toEqual({ kind: "unavailable", reason: "send_path_unusable" });
    expect(client.sendState.counter).toBe(1n);
  });

  it("may continue after an ambiguous or partial post-AEAD failure", async () => {
    const { client, node } = sessionPair();
    const ambiguous = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("half"), {
      outcome: { kind: "failed", delivery: "ambiguous" },
    });
    expect(ambiguous.result).toEqual({
      kind: "send_failed",
      epoch: 0n,
      counter: 0n,
      delivery: "ambiguous",
      sendPathUsable: true,
      mayEmitError: true,
    });
    expect(client.sendPathUsable).toBe(true);

    const next = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    // The consumed pair is not reused: the next record is (0, 1).
    expect(hex(next.envelope!)).toBe(RYCO_ENVELOPE_1);
    expect(node.unprotect(ambiguous.envelope!).kind).toBe("authenticated");
    expect(node.unprotect(next.envelope!).kind).toBe("authenticated");
  });

  it("treats a transmit callback that throws as ambiguous delivery", async () => {
    const { client } = sessionPair();
    const result = await client.protect({
      innerType: E2EE_INNER_TYPE_RPC,
      body: utf8ToBytes("boom"),
      admit: () => true,
      transmit: () => {
        throw new Error("relay write failed");
      },
    });
    expect(result).toMatchObject({ kind: "send_failed", delivery: "ambiguous" });
    expect(client.sendPathUsable).toBe(true);
  });

  it("holds epochs and counters as bigint (§3.1, §9.3)", async () => {
    const { client } = sessionPair();
    const sent = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("x"));
    const result = sent.result as { epoch: bigint; counter: bigint };
    expect(typeof result.epoch).toBe("bigint");
    expect(typeof result.counter).toBe("bigint");
    expect(typeof client.sendState.epoch).toBe("bigint");
    expect(typeof client.sendState.counter).toBe("bigint");
    expect(typeof client.receiveState.counter).toBe("bigint");
  });

  it("refuses application records after an E2EEClose and everything after an E2EEError", async () => {
    const closing = sessionPair().client;
    expect((await send(closing, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63))).result).toMatchObject({
      kind: "protected",
      counter: 0n,
    });
    expect((await send(closing, E2EE_INNER_TYPE_RPC, utf8ToBytes("x"))).result).toEqual({
      kind: "unavailable",
      reason: "application_phase_closed",
    });
    // The close machine's own records still go through; which of them may
    // follow is §10's state machine, not §9's.
    expect(
      (await send(closing, E2EE_INNER_TYPE_CLOSE_ACK, new Uint8Array(63))).result,
    ).toMatchObject({ kind: "protected", counter: 1n });

    const spent = sessionPair().client;
    expect(
      (await send(spent, E2EE_INNER_TYPE_ERROR, Uint8Array.of(0x81, 0x01))).result,
    ).toMatchObject({ kind: "protected", counter: 0n });
    expect((await send(spent, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63))).result).toEqual({
      kind: "unavailable",
      reason: "terminal_record_protected",
    });
    expect(spent.sendState.counter).toBe(1n);
  });

  it("closes the application phase at the FIRST close-machine record, in both roles (§10.2)", async () => {
    // The sequential initiator's first close-machine record is its `E2EEClose`.
    const initiator = sessionPair().client;
    expect((await send(initiator, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63))).result).toMatchObject(
      { kind: "protected", counter: 0n },
    );
    const afterClose = await send(initiator, E2EE_INNER_TYPE_RPC, utf8ToBytes("x"));
    expect(afterClose.result).toEqual({
      kind: "unavailable",
      reason: "application_phase_closed",
    });
    expect(afterClose.envelope).toBeUndefined();

    // The sequential RESPONDER's only close-machine record is its
    // `E2EECloseAck` (§10.2 step 2), and from it the same prohibition applies:
    // an endpoint that latched on `E2EEClose` alone would leave the responder
    // free to protect an application record after acknowledging the close, which
    // is exactly the stray record that moves the peer's expected-receive state
    // past this endpoint's §10.1.1 anchor.
    const responder = sessionPair().node;
    expect(
      (await send(responder, E2EE_INNER_TYPE_CLOSE_ACK, new Uint8Array(63))).result,
    ).toMatchObject({ kind: "protected", counter: 0n });
    const afterAck = await send(responder, E2EE_INNER_TYPE_RPC, utf8ToBytes("x"));
    expect(afterAck.result).toEqual({
      kind: "unavailable",
      reason: "application_phase_closed",
    });
    expect(afterAck.envelope).toBeUndefined();
    // Nothing was consumed by either refusal: one close-machine record each.
    expect(initiator.sendState.counter).toBe(1n);
    expect(responder.sendState.counter).toBe(1n);
  });
});

describe("relay E2EE rekey thresholds (§9.4)", () => {
  it("makes the record reaching E2EE_REKEY_MAX_RECORDS the last of its epoch", async () => {
    const boundary: E2eeSyntheticDirectionState = {
      epoch: 0n,
      counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
      epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
    };
    const { client, node } = sessionPair({ c2n: boundary });
    expect(client.sendState).toEqual({
      epoch: 0n,
      counter: 65_535n,
      epochRecords: 65_535,
      epochBytes: 0,
      exhausted: false,
    });

    const last = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("last"));
    expect(last.result).toMatchObject({ epoch: 0n, counter: 65_535n, epochCompleted: true });
    expect(client.sendState).toEqual({
      epoch: 1n,
      counter: 0n,
      epochRecords: 0,
      epochBytes: 0,
      exhausted: false,
    });
    expect(node.unprotect(last.envelope!)).toMatchObject({
      epoch: 0n,
      counter: 65_535n,
      epochCompleted: true,
    });
    expect(node.receiveState).toEqual({
      epoch: 1n,
      counter: 0n,
      epochRecords: 0,
      epochBytes: 0,
      exhausted: false,
    });

    // The successor carries epoch + 1 and counter 0, and both endpoints reached
    // that conclusion with no signaling at all.
    const successor = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("next"));
    expect(successor.result).toMatchObject({ epoch: 1n, counter: 0n, epochCompleted: false });
    expect(hex(successor.envelope!.subarray(0, 15))).toBe("010101000000010000000000000000");
    expect(node.unprotect(successor.envelope!)).toMatchObject({ epoch: 1n, counter: 0n });
  });

  it("makes the record reaching E2EE_REKEY_MAX_BYTES the last of its epoch", async () => {
    const body = utf8ToBytes("ryco");
    const plaintextBytes = body.byteLength + 1;

    const exact = sessionPair({
      c2n: { epochBytes: E2EE_REKEY_MAX_BYTES - plaintextBytes, epochRecords: 7, counter: 7n },
    });
    const crossing = await send(exact.client, E2EE_INNER_TYPE_RPC, body);
    expect(crossing.result).toMatchObject({ counter: 7n, epochCompleted: true });
    expect(exact.client.sendState).toMatchObject({ epoch: 1n, counter: 0n, epochBytes: 0 });
    expect(exact.node.unprotect(crossing.envelope!)).toMatchObject({ epochCompleted: true });
    expect(exact.node.receiveState).toMatchObject({ epoch: 1n, counter: 0n });

    const under = sessionPair({
      c2n: { epochBytes: E2EE_REKEY_MAX_BYTES - plaintextBytes - 1, epochRecords: 7, counter: 7n },
    });
    const short = await send(under.client, E2EE_INNER_TYPE_RPC, body);
    expect(short.result).toMatchObject({ counter: 7n, epochCompleted: false });
    expect(under.client.sendState).toMatchObject({
      epoch: 0n,
      counter: 8n,
      epochBytes: E2EE_REKEY_MAX_BYTES - 1,
    });
    expect(under.node.unprotect(short.envelope!)).toMatchObject({ epochCompleted: false });
  });

  it("counts control records toward both thresholds", async () => {
    const boundary: E2eeSyntheticDirectionState = {
      epoch: 3n,
      counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
      epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
    };
    const { client } = sessionPair({ c2n: boundary });
    const control = await send(client, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63));
    expect(control.result).toMatchObject({
      epoch: 3n,
      counter: 65_535n,
      plaintextBytes: 64,
      epochCompleted: true,
    });
    expect(client.sendState).toMatchObject({ epoch: 4n, counter: 0n, epochRecords: 0 });
  });

  it("keeps a real send/receive run in step across many records", async () => {
    const { client, node } = sessionPair();
    for (let index = 0; index < 300; index += 1) {
      const sent = await send(client, E2EE_INNER_TYPE_RPC, Uint8Array.of(index & 0xff));
      expect(sent.result).toMatchObject({ epoch: 0n, counter: BigInt(index) });
      expect(node.unprotect(sent.envelope!)).toMatchObject({ counter: BigInt(index) });
    }
    expect(client.sendState).toEqual({
      epoch: 0n,
      counter: 300n,
      epochRecords: 300,
      epochBytes: 600,
      exhausted: false,
    });
    expect(node.receiveState).toEqual(client.sendState);
  });
});

describe("relay E2EE erasure and exhaustion (§9.5, §9.6)", () => {
  const terminal = (epochRecords: number, epochBytes = 0): E2eeSyntheticDirectionState => ({
    epoch: E2EE_EPOCH_MAX,
    counter: BigInt(epochRecords),
    epochRecords,
    epochBytes,
  });

  it("protects an application record only while the post-application reserve survives it", async () => {
    const room = sessionPair({ c2n: terminal(E2EE_REKEY_MAX_RECORDS - 4) });
    expect(room.client.postApplicationReserveHeld).toBe(true);
    const admitted = await send(room.client, E2EE_INNER_TYPE_RPC, utf8ToBytes("last-app"));
    expect(admitted.result).toMatchObject({ kind: "protected", epoch: E2EE_EPOCH_MAX });
    expect(room.node.unprotect(admitted.envelope!).kind).toBe("authenticated");

    // Exactly the reserve remains: the endpoint MUST initiate the §10 close and
    // MUST NOT protect another application record.
    expect(room.client.postApplicationReserveHeld).toBe(true);
    const refused = await send(room.client, E2EE_INNER_TYPE_RPC, utf8ToBytes("one-too-many"));
    expect(refused.result).toEqual({ kind: "close_required" });
    expect(refused.envelope).toBeUndefined();
    expect(room.client.sendState.counter).toBe(BigInt(E2EE_REKEY_MAX_RECORDS - 3));

    // The close machine is protected out of the reserve, and the terminal error
    // record out of the half `E2EE_ERROR_RECORDS_RESERVED` holds for it.
    const close = await send(room.client, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63));
    expect(close.result).toMatchObject({ kind: "protected" });
    const ack = await send(room.client, E2EE_INNER_TYPE_CLOSE_ACK, new Uint8Array(63));
    expect(ack.result).toMatchObject({ kind: "protected" });
    const error = await send(room.client, E2EE_INNER_TYPE_ERROR, Uint8Array.of(0x81, 0x01));
    expect(error.result).toMatchObject({
      kind: "protected",
      epoch: E2EE_EPOCH_MAX,
      counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
      epochCompleted: true,
    });
    // No wrap and no reuse: the direction is spent, not restarted.
    expect(room.client.sendState).toEqual({
      epoch: undefined,
      counter: undefined,
      epochRecords: E2EE_REKEY_MAX_RECORDS,
      // "last-app" (9) plus the two close-machine records (64 each) plus the
      // terminal error record (3), all counted as authenticated inner plaintext.
      epochBytes: 9 + 64 + 64 + 3,
      exhausted: true,
    });
  });

  it("holds the byte half of the reserve as well as the record half", async () => {
    const body = utf8ToBytes("ryco");
    const fits = sessionPair({ c2n: terminal(0, E2EE_REKEY_MAX_BYTES - 150) });
    expect((await send(fits.client, E2EE_INNER_TYPE_RPC, body)).result).toMatchObject({
      kind: "protected",
    });

    const tooTight = sessionPair({ c2n: terminal(0, E2EE_REKEY_MAX_BYTES - 100) });
    expect((await send(tooTight.client, E2EE_INNER_TYPE_RPC, body)).result).toEqual({
      kind: "close_required",
    });
    expect(tooTight.client.sendState.counter).toBe(0n);
  });

  it("protects as many close-machine records as a degenerate state allows (§9.6)", async () => {
    const { client } = sessionPair({ c2n: terminal(E2EE_REKEY_MAX_RECORDS - 2) });
    // Less than the post-application reserve remains.
    expect(client.postApplicationReserveHeld).toBe(false);
    expect((await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("x"))).result).toEqual({
      kind: "close_required",
    });

    const close = await send(client, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63));
    expect(close.result).toMatchObject({ kind: "protected", epochCompleted: false });
    const ack = await send(client, E2EE_INNER_TYPE_CLOSE_ACK, new Uint8Array(63));
    expect(ack.result).toMatchObject({
      kind: "protected",
      counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
      epochCompleted: true,
    });

    // The terminal error record has no capacity left: no wrap, no reuse.
    const error = await send(client, E2EE_INNER_TYPE_ERROR, Uint8Array.of(0x81, 0x01));
    expect(error.result).toEqual({ kind: "exhausted" });
    expect(error.envelope).toBeUndefined();
    expect(client.sendState.exhausted).toBe(true);
    expect(client.sendState.epoch).toBeUndefined();
    expect(client.sendState.counter).toBeUndefined();
  });

  it("terminates the receive direction at exhaustion instead of wrapping", async () => {
    const state = terminal(E2EE_REKEY_MAX_RECORDS - 1);
    const { client, node } = sessionPair({ c2n: state });
    const last = await send(client, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63));
    expect(last.result).toMatchObject({ epoch: E2EE_EPOCH_MAX, epochCompleted: true });
    expect(client.sendState.exhausted).toBe(true);
    expect(node.unprotect(last.envelope!)).toMatchObject({ epochCompleted: true });
    expect(node.receiveState).toMatchObject({ exhausted: true, epoch: undefined });

    // Anything further in that direction can only be a §9.2 mismatch: there is
    // no expected pair left to equal.
    const stray = sessionPair({ c2n: { epoch: 0n, counter: 0n } }).client;
    const strayEnvelope = await send(stray, E2EE_INNER_TYPE_RPC, utf8ToBytes("after"));
    expect(node.unprotect(strayEnvelope.envelope!)).toEqual({
      kind: "fatal",
      reason: "sequence_mismatch",
    });
    // The exhausted sender protects nothing further either.
    expect((await send(client, E2EE_INNER_TYPE_CLOSE, new Uint8Array(63))).result).toEqual({
      kind: "exhausted",
    });
  });

  it("erases every session secret on close and is never resumed (§6.5, §9.5)", async () => {
    const secrets = freshSecrets();
    const session = new E2eeRecordSession({
      secrets,
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
      plaintextCeiling: 64,
    });
    const sent = await send(session, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    expect(sent.result).toMatchObject({ kind: "protected" });

    session.erase();
    expect(session.erased).toBe(true);
    const zeros = "00".repeat(E2EE_SECRET_BYTES);
    expect(hex(secrets.epochSecretC2N)).toBe(zeros);
    expect(hex(secrets.epochSecretN2C)).toBe(zeros);
    expect(hex(secrets.exporterSecret)).toBe(zeros);
    expect(hex(secrets.serverConfirmationKey)).toBe(zeros);

    session.erase();
    await expect(
      session.protect({
        innerType: E2EE_INNER_TYPE_RPC,
        body: new Uint8Array(0),
        admit: () => true,
        transmit: () => ({ kind: "sent" }),
      }),
    ).rejects.toThrow(TypeError);
    expect(() => session.unprotect(sent.envelope!)).toThrow(TypeError);
  });

  it("rejects a session the §4.5 budget forbids and unregistered inputs", () => {
    expect(
      () =>
        new E2eeRecordSession({
          secrets: freshSecrets(),
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 0,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new E2eeRecordSession({
          secrets: freshSecrets(),
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: new Uint8Array(31),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 64,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new E2eeRecordSession({
          secrets: freshSecrets(),
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 64,
          testOnlySyntheticSendState: { epochRecords: E2EE_REKEY_MAX_RECORDS },
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new E2eeRecordSession({
          secrets: freshSecrets(),
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 64,
          testOnlySyntheticSendState: { epoch: E2EE_EPOCH_MAX + 1n },
        }),
    ).toThrow(RangeError);
  });

  it("erases the secrets it took ownership of when construction fails (§6.5, §9.5)", () => {
    // The session TAKES OWNERSHIP of `secrets`. A constructor that threw and
    // left them alone would strand key material that is nobody's: the caller has
    // handed it over and there is no object to erase it. Construction therefore
    // has two outcomes only — a session that owns the secrets, or a throw that
    // has already zeroed them.
    const zeros = "00".repeat(E2EE_SECRET_BYTES);
    const ceilingSecrets = freshSecrets();
    expect(
      () =>
        new E2eeRecordSession({
          secrets: ceilingSecrets,
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 0,
        }),
    ).toThrow(RangeError);
    expect(hex(ceilingSecrets.epochSecretC2N)).toBe(zeros);
    expect(hex(ceilingSecrets.epochSecretN2C)).toBe(zeros);
    expect(hex(ceilingSecrets.exporterSecret)).toBe(zeros);
    expect(hex(ceilingSecrets.serverConfirmationKey)).toBe(zeros);

    // The second directional state fails AFTER the first has derived its epoch-0
    // AEAD key, so that key has to be erased too rather than stranded inside a
    // half-built session.
    const syntheticSecrets = freshSecrets();
    expect(
      () =>
        new E2eeRecordSession({
          secrets: syntheticSecrets,
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 64,
          testOnlySyntheticReceiveState: { epochRecords: E2EE_REKEY_MAX_RECORDS },
        }),
    ).toThrow(RangeError);
    expect(hex(syntheticSecrets.epochSecretC2N)).toBe(zeros);
    expect(hex(syntheticSecrets.epochSecretN2C)).toBe(zeros);
    expect(hex(syntheticSecrets.exporterSecret)).toBe(zeros);
    expect(hex(syntheticSecrets.serverConfirmationKey)).toBe(zeros);
  });

  it("erases the §6.5 outputs when the factory that takes them over fails (§9.5)", () => {
    // `Split()` hands over three buffers and keeps none of them, so ownership
    // transfers with the CALL: a failure inside the factory can strand them
    // nowhere else. Each of the three length checks and the §8.7 derivation
    // runs with the earlier buffers live, so any one of them failing has to
    // zero all of them.
    const zeros = "00".repeat(E2EE_SECRET_BYTES);
    const epochSecretC2N = bytes(EPOCH_SECRET_C2N);
    const epochSecretN2C = bytes(EPOCH_SECRET_N2C);
    expect(() =>
      e2eeSessionSecretsFromNoiseKeys({
        epochSecretC2N,
        epochSecretN2C,
        // The last property of the literal, and the one the §8.7 derivation
        // then consumes: both fail here, with the two epoch secrets held.
        exporterSecret: new Uint8Array(E2EE_SECRET_BYTES - 1),
      }),
    ).toThrow(TypeError);
    expect(hex(epochSecretC2N)).toBe(zeros);
    expect(hex(epochSecretN2C)).toBe(zeros);

    // The same one property earlier, where the exporter secret is valid and is
    // itself part of what has to be erased.
    const firstEpochSecret = bytes(EPOCH_SECRET_C2N);
    const exporterSecret = bytes(EXPORTER_SECRET);
    expect(() =>
      e2eeSessionSecretsFromNoiseKeys({
        epochSecretC2N: firstEpochSecret,
        epochSecretN2C: new Uint8Array(0),
        exporterSecret,
      }),
    ).toThrow(TypeError);
    expect(hex(firstEpochSecret)).toBe(zeros);
    expect(hex(exporterSecret)).toBe(zeros);
  });

  it("validates a synthetic direction state before deriving any epoch key (§9.5, §16.3 F9)", () => {
    // The directional state takes ownership of `epochSecret_d[0]` and derives
    // `aeadKey_d[0]` from it. A synthetic start position that the §16.3 F9 seam
    // rejects used to be checked AFTER that derivation, which left a derived
    // AEAD key inside a constructor that never returned — owned by no object,
    // reachable by no erasure. Validation therefore precedes the derivation,
    // and the derivation is the last fallible statement in the constructor.
    const zeros = "00".repeat(E2EE_SECRET_BYTES);
    const epochSecretC2N = watchedEpochSecret(bytes(EPOCH_SECRET_C2N));
    const secrets = e2eeSessionSecretsFromNoiseKeys({
      epochSecretC2N,
      epochSecretN2C: bytes(EPOCH_SECRET_N2C),
      exporterSecret: bytes(EXPORTER_SECRET),
    });
    expect(epochSecretC2N.hkdfReads).toBe(0);
    expect(
      () =>
        new E2eeRecordSession({
          secrets,
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 64,
          testOnlySyntheticSendState: { epoch: E2EE_EPOCH_MAX + 1n },
        }),
    ).toThrow(RangeError);
    expect(epochSecretC2N.hkdfReads).toBe(0);
    // The secrets themselves are still erased by the construction funnel.
    expect(hex(epochSecretC2N)).toBe(zeros);

    // Control: an accepted synthetic state derives a key from the send
    // direction's secret, so the assertion above is about the ordering.
    const liveSecret = watchedEpochSecret(bytes(EPOCH_SECRET_C2N));
    const control = new E2eeRecordSession({
      secrets: e2eeSessionSecretsFromNoiseKeys({
        epochSecretC2N: liveSecret,
        epochSecretN2C: bytes(EPOCH_SECRET_N2C),
        exporterSecret: bytes(EXPORTER_SECRET),
      }),
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
      plaintextCeiling: 64,
      testOnlySyntheticSendState: { epoch: E2EE_EPOCH_MAX },
    });
    expect(liveSecret.hkdfReads).toBeGreaterThan(0);
    control.erase();
    expect(hex(liveSecret)).toBe(zeros);
  });

  it("erases the secrets when a read the constructor itself makes fails (§9.5)", () => {
    // A statement AFTER the funnel's end is the same defect at one remove: the
    // session has taken ownership, the funnel has closed, and the object does
    // not exist yet. Every read of `options` therefore happens inside the
    // funnel, including the test-only AEAD factory.
    const zeros = "00".repeat(E2EE_SECRET_BYTES);
    const secrets = freshSecrets();
    expect(
      () =>
        new E2eeRecordSession({
          secrets,
          suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
          plaintextCeiling: 64,
          get testOnlyAeadFactory(): E2eeRecordAeadFactory | undefined {
            throw new TypeError("test-only option read failed");
          },
        }),
    ).toThrow(TypeError);
    expect(hex(secrets.epochSecretC2N)).toBe(zeros);
    expect(hex(secrets.epochSecretN2C)).toBe(zeros);
    expect(hex(secrets.exporterSecret)).toBe(zeros);
    expect(hex(secrets.serverConfirmationKey)).toBe(zeros);
  });

  it("treats a transmit report it cannot read as §9.3's ambiguous branch", async () => {
    // `transmit` is the caller's callback and it runs AFTER the pair is consumed
    // and the envelope is with the send path. A report this module cannot read
    // establishes nothing about delivery, which is exactly §9.3's ambiguous
    // branch — never an exception thrown out of `protect`, which would leave the
    // caller holding a session whose pair is spent and whose result it never
    // saw.
    const { client } = sessionPair();
    const result = await client.protect({
      innerType: E2EE_INNER_TYPE_RPC,
      body: utf8ToBytes("ryco"),
      admit: () => true,
      transmit: () => undefined as unknown as E2eeTransmitOutcome,
    });
    expect(result).toEqual({
      kind: "send_failed",
      epoch: 0n,
      counter: 0n,
      delivery: "ambiguous",
      sendPathUsable: true,
      mayEmitError: true,
    });
    // Consumed means consumed (§9.3): the pair is spent, nothing wrapped.
    expect(client.sendState.counter).toBe(1n);
  });

  it("terminates the receive direction when a local failure escapes unprotect (§11.3)", async () => {
    // The only throws `unprotect` admits past its preconditions are local
    // invariant violations, and §11.3 makes every one of them terminal for the
    // direction. Latching that is what stops the next payload from being
    // processed as though nothing had happened.
    const { client } = sessionPair();
    const sent = await send(client, E2EE_INNER_TYPE_RPC, utf8ToBytes("ryco"));
    let selections = 0;
    const node = new E2eeRecordSession({
      secrets: freshSecrets(),
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      sendDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
      plaintextCeiling: 1_024,
      testOnlyAeadFactory: () => {
        selections += 1;
        throw new TypeError("AEAD unavailable");
      },
    });
    expect(() => node.unprotect(sent.envelope!)).toThrow(TypeError);
    expect(selections).toBe(1);
    expect(node.unprotect(sent.envelope!)).toEqual({
      kind: "fatal",
      reason: "receive_terminated",
    });
    // The failing factory is never reached a second time.
    expect(selections).toBe(1);
  });

  it("rejects an unregistered inner-record type from the sender", async () => {
    const { client } = sessionPair();
    await expect(
      client.protect({
        innerType: 0x05 as E2eeInnerRecordType,
        body: new Uint8Array(0),
        admit: () => true,
        transmit: () => ({ kind: "sent" }),
      }),
    ).rejects.toThrow(TypeError);
    expect(client.sendState.counter).toBe(0n);
  });

  it("rejects a reserved inner-record type only after authentication (§4.3, §11.3 Q5)", () => {
    const key = deriveE2eeAeadKey(bytes(EPOCH_SECRET_C2N), E2EE_DIRECTION_CLIENT_TO_NODE);
    const header = encodeE2eeEnvelopeHeader({
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      epoch: 0n,
      counter: 0n,
    });
    const envelope = encodeE2eeEnvelope({
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      epoch: 0n,
      counter: 0n,
      ciphertext: chacha20poly1305(
        key,
        e2eeAeadNonceFromHeader(header),
        e2eeEnvelopeAad({
          header,
          sessionBindingHash: bytes(SESSION_BINDING_HASH),
          direction: E2EE_DIRECTION_CLIENT_TO_NODE,
        }),
      ).encrypt(Uint8Array.of(0x05, 0x00)),
    });
    const aead = countingAead();
    const { node } = sessionPair({ nodeAead: aead.factory });
    expect(node.unprotect(envelope)).toEqual({ kind: "fatal", reason: "reserved_inner_type" });
    expect(aead.calls).toEqual({ select: 1, seal: 0, open: 1 });
    expect(node.receiveState.counter).toBe(0n);
  });

  it("pins the AEAD nonce width the suite fixes", () => {
    expect(E2EE_AEAD_NONCE_BYTES).toBe(12);
    expect(hex(e2eeAeadNonce(1n, 2n))).toBe("000000010000000000000002");
  });
});
