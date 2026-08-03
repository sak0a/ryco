/**
 * The on-device relay-E2EE vector runner (docs/relay-e2ee-protocol.md §16).
 *
 * The repository's conformance corpus runs under Node. Nothing in it proves the
 * pinned primitives behave on Hermes, which is the only engine the app ships:
 * §14.2's curve and AEAD implementations are BigInt- and typed-array-heavy,
 * §14.5's randomness is a polyfill, and §3.6's canonical CBOR needs a
 * `TextEncoder` React Native does not provide. This module is the Hermes-side
 * evidence for exactly those four things. See `apps/mobile/README.md` for the
 * physical-device procedure it belongs to.
 *
 * WHY A SUBSET, EMBEDDED. `packages/shared/fixtures/e2ee/v1` is 844 KB of JSON
 * and MUST NOT enter the bundle. The cases below are transcribed from it and
 * `e2eeVectorRunner.test.ts` proves, against the real corpus files, that every
 * transcribed byte still matches — so the subset cannot drift, and the corpus
 * stays out of the app.
 *
 * WHAT THE SUBSET COVERS, and why it is enough for a runtime check:
 *
 * - F15 `cacophony/Noise_IK_25519_ChaChaPoly_SHA256` — the published upstream
 *   Noise vector for the pattern the native tier runs (§8.1), and the only case
 *   in the corpus whose bytes this repository did not produce. Driving it at both
 *   roles exercises four X25519 DH operations, the whole HKDF-SHA256 chain, the
 *   ChaCha20-Poly1305 seal and open inside both handshake messages, and `Split()`.
 *   IK and not NX: the native tier is IK-only, and IK is the strictly larger of
 *   the two — four DH operations against NX's two, plus the encrypted-static step.
 * - F6 `ik-handshake-complete-trace`, §6.5 outputs onward — the §9.1 record path
 *   through `E2eeRecordSession`: real key schedule, real AAD, real nonces, a
 *   byte-exact envelope in each direction, an authenticated round trip back, and
 *   a rejected single-byte tamper. This also pins the §6.5 output ORDER, because
 *   the c2n envelope is produced under the first output and the n2c envelope
 *   under the second; swapping them fails here.
 * - F4 `valid-node-agreement-prekey-certificate` — the §7.3 transcript rebuilt
 *   here and checked by strict Ed25519 verification. A signature that verifies
 *   over a locally rebuilt transcript pins every byte of that canonical-CBOR
 *   encoding, which is why the 278-byte transcript itself is not transcribed.
 * - F13 `node-identity-key-fingerprint` — the §7.1 display form.
 *
 * NOT COVERED HERE, deliberately: P-256 (`../platform/ecdsa` and the device-key
 * module already carry on-device coverage); the NX pattern (web tier only); and
 * F15's transport messages, which would need a direct `@noble/ciphers` import —
 * not a dependency of this app — to reproduce, and whose evidence for the §6.5
 * outputs and their order the F6 case already supplies.
 */

import { E2EE_ENVELOPE_HEADER_BYTES } from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_NODE_IDENTITY_ALGORITHM,
  deriveE2eeAgreementPublicKey,
  e2eeKeyFingerprint,
  formatE2eeKeyFingerprint,
  generateE2eeAgreementKeyPair,
  verifyE2eeSignature,
} from "@ryco/shared/relayE2eeKeys";
import {
  E2eeNoiseHandshake,
  E2EE_NOISE_PROTOCOL_NAME_IK,
  e2eeNoiseProtocolName,
} from "@ryco/shared/relayE2eeNoise";
import {
  E2eeRecordSession,
  e2eeSessionSecretsFromNoiseKeys,
  eraseE2eeSessionSecrets,
  type E2eeSessionSecrets,
} from "@ryco/shared/relayE2eeSession";
import {
  E2EE_NOISE_PATTERN_IK,
  encodeNodeE2eePrekeyTranscript,
} from "@ryco/shared/relayE2eeTranscripts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  e2eeEnvelopeAad,
  type E2eeDirection,
} from "@ryco/shared/relayE2eeWire";

import { e2eeGlobalProvenance } from "../../polyfills";
import { readMobileAppVariant } from "../platform/config";
import { assertE2eeRuntimeGlobals, type E2eeRuntimeHost } from "../platform/e2eeRuntime";

const HEX_DIGITS = "0123456789abcdef";

/**
 * Local hex codecs. The pinned primitives ship their own, but they are not a
 * dependency of this app — and `Buffer` is not a Hermes global — so the vector
 * data is decoded here rather than pulling either in.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += HEX_DIGITS[byte >> 4]! + HEX_DIGITS[byte & 0x0f]!;
  return hex;
}

/**
 * TEST-ONLY MATERIAL (§16.1). Every secret below is published deterministic test
 * material transcribed from the checked-in corpus. It MUST NEVER reach a real
 * endpoint, and nothing outside this module may read it.
 */
const F15_IK = {
  prologue: "4a6f686e2047616c74",
  initiatorStaticSecretKey: "e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1",
  initiatorEphemeralSecretKey: "893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a",
  initiatorRemoteStaticPublicKey:
    "31e0303fd6418d2f8c0e78b91f22e8caed0fbe48656dcf4767e4834f701b8f62",
  responderStaticSecretKey: "4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893",
  responderEphemeralSecretKey: "bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b",
  handshakePayloads: ["4c756477696720766f6e204d69736573", "4d757272617920526f746862617264"],
  handshakeMessages: [
    "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944718da798efbcd91528520204f904b9bd6c7413dccdc214d951e15253e39987f18146e8cd0873654207148333479d4d16c289f0294b29960a72f48e0b7bba2e89083169825e59642148d492020664ccf7",
    "95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088435361e70b2ed446e6c9ec387d1d6b3b840f194e373979d241b203c4acafccf5",
  ],
  handshakeHash: "0b0f68fb0c27e03ce9b97565995ed4838cc0581b762ef72b062f6a546419fad7",
} as const;

const F6_IK = {
  sessionBindingHash: "5f0ca343c437b1aa35e1a1c6eff4d2be244dde8dd384ff023559a2cee8c38a67",
  epochSecretC2N: "b89ee30677c2855a7b9e88f6d4e9f85b1a317007734895653baac3463b19204d",
  epochSecretN2C: "b1acc4b4ce50246a35b4075217acda93c68e4201eee1b5c307f1b2fec5adf290",
  exporterSecret: "3df08be20cc319578a156b636a3ae5d017a6622899a48847ae8d99d3b084f722",
  serverConfirmationKey: "46d17787aa5f5ec03d51247fe85c3f6178bd40272d76b19ce0fef8bba1c6738a",
  clientToNode: {
    innerBody: "7b225f746167223a227279636f2e7270632e70696e67227d",
    envelope:
      "01010100000000000000000000000078fe898e903e04ca8b3290545503de837a216f91ddad4f6adcb8b6ae1f2c456e4edca85e0ad5e7458b",
    aad: "0101010000000000000000000000005f0ca343c437b1aa35e1a1c6eff4d2be244dde8dd384ff023559a2cee8c38a6763326e",
  },
  nodeToClient: {
    innerBody: "7b225f746167223a227279636f2e7270632e706f6e67227d",
    envelope:
      "010101000000000000000000000000deae6ba8ca34d2bae3071723cf2bfc31780cfe3e37acb8811c1a82f236a76629825f8ff5c878cd3429",
    aad: "0101010000000000000000000000005f0ca343c437b1aa35e1a1c6eff4d2be244dde8dd384ff023559a2cee8c38a676e3263",
  },
} as const;

const F4_NODE_PREKEY = {
  hubOrigin: "https://hub.example.com",
  nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
  identityKeyId: "nkey_BBBBBBBBBBBBBBBBBBBBBB",
  prekeyId: "epk_EEEEEEEEEEEEEEEEEEEEEE",
  identityPublicKey: "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
  agreementPublicKey: "7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
  createdAt: 1_784_160_000_000,
  expiresAt: 1_786_752_000_000,
  transcriptBytes: 278,
  identityFingerprint: "0156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b64",
  crossSignature:
    "58f2c7365b5f5cfe1193fcbf194dfc34ff77e173eb622ecd187b7c5e3c38134de93dee609798456a770fa8efba8a02dd72119fe68ebbb3f365b091be3c716207",
} as const;

const F13_NODE_IDENTITY = {
  fingerprintDisplay: "SHA256:AVbN7e5vhHl7KLe-gwSBlEg8wXFlsa56_nu8d-7fm2Q",
  agreementSecretKey: "1111111111111111111111111111111111111111111111111111111111111111",
} as const;

/**
 * The transcribed values, for the drift test only. It reads the real corpus
 * files with `node:fs` — which neither this module nor anything else the bundler
 * sees may do — and compares them against these, so the subset cannot silently
 * fall behind a regenerated corpus.
 */
export const testOnlyEmbeddedVectors = {
  f15Ik: F15_IK,
  f6Ik: F6_IK,
  f4NodePrekey: F4_NODE_PREKEY,
  f13NodeIdentity: F13_NODE_IDENTITY,
} as const;

/** The runner's own admission bound; not a vector value. Larger than any case. */
const RUNNER_PLAINTEXT_CEILING = 4_096;

/** One check's verdict. The name is a fixed label; no drawn or decrypted byte. */
export interface E2eeVectorCheck {
  readonly name: string;
  readonly ok: boolean;
}

export interface E2eeVectorSuiteResult {
  readonly ok: boolean;
  readonly checks: readonly E2eeVectorCheck[];
  /** Which implementation each §14.5 global resolved to on this runtime. */
  readonly globals: typeof e2eeGlobalProvenance;
}

function equalHex(actual: Uint8Array, expected: string): boolean {
  return bytesToHex(actual) === expected;
}

/** Drives one deterministic IK handshake at both roles, exactly as F15 pins it. */
function checkNoiseIkVector(): void {
  if (e2eeNoiseProtocolName(E2EE_NOISE_PATTERN_IK) !== E2EE_NOISE_PROTOCOL_NAME_IK) {
    throw new Error("protocol name");
  }
  const initiator = new E2eeNoiseHandshake({
    pattern: E2EE_NOISE_PATTERN_IK,
    role: "initiator",
    prologue: hexToBytes(F15_IK.prologue),
    staticSecretKey: hexToBytes(F15_IK.initiatorStaticSecretKey),
    remoteStaticPublicKey: hexToBytes(F15_IK.initiatorRemoteStaticPublicKey),
    testOnlyEphemeralSecretKey: hexToBytes(F15_IK.initiatorEphemeralSecretKey),
  });
  const responder = new E2eeNoiseHandshake({
    pattern: E2EE_NOISE_PATTERN_IK,
    role: "responder",
    prologue: hexToBytes(F15_IK.prologue),
    staticSecretKey: hexToBytes(F15_IK.responderStaticSecretKey),
    testOnlyEphemeralSecretKey: hexToBytes(F15_IK.responderEphemeralSecretKey),
  });

  // Each role reads the VECTOR's bytes rather than the ones just written, so a
  // writer defect cannot mask a reader defect.
  const message1 = initiator.writeMessage(hexToBytes(F15_IK.handshakePayloads[0]));
  if (!equalHex(message1, F15_IK.handshakeMessages[0])) throw new Error("message 1");
  const read1 = responder.readMessage(hexToBytes(F15_IK.handshakeMessages[0]));
  if (!equalHex(read1, F15_IK.handshakePayloads[0])) throw new Error("payload 1");

  const message2 = responder.writeMessage(hexToBytes(F15_IK.handshakePayloads[1]));
  if (!equalHex(message2, F15_IK.handshakeMessages[1])) throw new Error("message 2");
  const read2 = initiator.readMessage(hexToBytes(F15_IK.handshakeMessages[1]));
  if (!equalHex(read2, F15_IK.handshakePayloads[1])) throw new Error("payload 2");

  const handshakeHash = initiator.testOnlyHandshakeHash;
  if (handshakeHash === undefined || !equalHex(handshakeHash, F15_IK.handshakeHash)) {
    throw new Error("handshake hash");
  }

  // The two roles agreeing on all three §6.5 outputs is what makes the four DH
  // operations above meaningful; the upstream set publishes no split keys of its
  // own, and the F6 case below is what pins their order.
  const initiatorKeys = initiator.split();
  const responderKeys = responder.split();
  try {
    if (bytesToHex(initiatorKeys.epochSecretC2N) !== bytesToHex(responderKeys.epochSecretC2N)) {
      throw new Error("split c2n");
    }
    if (bytesToHex(initiatorKeys.epochSecretN2C) !== bytesToHex(responderKeys.epochSecretN2C)) {
      throw new Error("split n2c");
    }
    if (bytesToHex(initiatorKeys.exporterSecret) !== bytesToHex(responderKeys.exporterSecret)) {
      throw new Error("split exporter");
    }
  } finally {
    for (const keys of [initiatorKeys, responderKeys]) {
      keys.epochSecretC2N.fill(0);
      keys.epochSecretN2C.fill(0);
      keys.exporterSecret.fill(0);
    }
  }
}

/** A fresh §6.5 bundle each call: the consumer takes ownership of the buffers. */
function f6SessionSecrets(): E2eeSessionSecrets {
  return e2eeSessionSecretsFromNoiseKeys({
    epochSecretC2N: hexToBytes(F6_IK.epochSecretC2N),
    epochSecretN2C: hexToBytes(F6_IK.epochSecretN2C),
    exporterSecret: hexToBytes(F6_IK.exporterSecret),
  });
}

function recordSession(sendDirection: E2eeDirection): E2eeRecordSession {
  return new E2eeRecordSession({
    secrets: f6SessionSecrets(),
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash: hexToBytes(F6_IK.sessionBindingHash),
    sendDirection,
    plaintextCeiling: RUNNER_PLAINTEXT_CEILING,
  });
}

/** §9.1 protect and unprotect, in both directions, against the F6 envelopes. */
async function checkRecordProtection(): Promise<void> {
  const secrets = f6SessionSecrets();
  try {
    if (!equalHex(secrets.serverConfirmationKey, F6_IK.serverConfirmationKey)) {
      throw new Error("confirmation key");
    }
  } finally {
    eraseE2eeSessionSecrets(secrets);
  }

  for (const [sendDirection, vector] of [
    [E2EE_DIRECTION_CLIENT_TO_NODE, F6_IK.clientToNode],
    [E2EE_DIRECTION_NODE_TO_CLIENT, F6_IK.nodeToClient],
  ] as const) {
    const receiveDirection =
      sendDirection === E2EE_DIRECTION_CLIENT_TO_NODE
        ? E2EE_DIRECTION_NODE_TO_CLIENT
        : E2EE_DIRECTION_CLIENT_TO_NODE;
    const sender = recordSession(sendDirection);
    const receiver = recordSession(receiveDirection);
    // A fresh receiver for the tamper case: `receiver` has already consumed
    // counter 0, so it would refuse a replay as a sequence mismatch instead.
    const tamperReceiver = recordSession(receiveDirection);
    try {
      let envelope: Uint8Array | undefined;
      const protectResult = await sender.protect({
        innerType: E2EE_INNER_TYPE_RPC,
        body: hexToBytes(vector.innerBody),
        admit: () => true,
        transmit: (bytes) => {
          envelope = bytes;
          return { kind: "sent" };
        },
      });
      if (protectResult.kind !== "protected") throw new Error("protect");
      if (envelope === undefined || !equalHex(envelope, vector.envelope)) {
        throw new Error("envelope");
      }
      const aad = e2eeEnvelopeAad({
        header: envelope.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
        sessionBindingHash: hexToBytes(F6_IK.sessionBindingHash),
        direction: sendDirection,
      });
      if (!equalHex(aad, vector.aad)) throw new Error("aad");

      // §9.5: the decrypted plaintext belongs to the caller from here on.
      const received = receiver.unprotect(hexToBytes(vector.envelope));
      if (received.kind !== "authenticated") throw new Error("unprotect");
      const plaintextMatches = equalHex(received.body, vector.innerBody);
      received.body.fill(0);
      if (!plaintextMatches) throw new Error("plaintext");

      // §9.2 Q3: one flipped ciphertext byte is a fatal authentication failure,
      // not a silently accepted record.
      const tampered = hexToBytes(vector.envelope);
      tampered[E2EE_ENVELOPE_HEADER_BYTES] ^= 0x01;
      const tamperedResult = tamperReceiver.unprotect(tampered);
      if (tamperedResult.kind !== "fatal" || tamperedResult.reason !== "authentication_failed") {
        throw new Error("tamper");
      }
    } finally {
      sender.erase();
      receiver.erase();
      tamperReceiver.erase();
    }
  }
}

/** §7.3 transcript encoding and §7.1 strict Ed25519 verification. */
function checkNodePrekeyCertificate(): void {
  const identityPublicKey = hexToBytes(F4_NODE_PREKEY.identityPublicKey);
  const transcript = encodeNodeE2eePrekeyTranscript({
    hubOrigin: F4_NODE_PREKEY.hubOrigin,
    nodeId: F4_NODE_PREKEY.nodeId,
    identityKeyId: F4_NODE_PREKEY.identityKeyId,
    prekeyId: F4_NODE_PREKEY.prekeyId,
    identityPublicKey,
    agreementPublicKey: hexToBytes(F4_NODE_PREKEY.agreementPublicKey),
    createdAt: F4_NODE_PREKEY.createdAt,
    expiresAt: F4_NODE_PREKEY.expiresAt,
  });
  if (transcript.byteLength !== F4_NODE_PREKEY.transcriptBytes) throw new Error("transcript size");
  if (
    !equalHex(
      e2eeKeyFingerprint("node-identity", identityPublicKey),
      F4_NODE_PREKEY.identityFingerprint,
    )
  ) {
    throw new Error("fingerprint");
  }
  if (
    formatE2eeKeyFingerprint(e2eeKeyFingerprint("node-identity", identityPublicKey)) !==
    F13_NODE_IDENTITY.fingerprintDisplay
  ) {
    throw new Error("fingerprint display");
  }

  // The signature verifies over the transcript REBUILT above, so this pins every
  // byte of the §3.6 canonical encoding — including the UTF-8 `tstr` elements.
  const signature = hexToBytes(F4_NODE_PREKEY.crossSignature);
  if (
    !verifyE2eeSignature({
      algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
      publicKey: identityPublicKey,
      message: transcript,
      signature,
    })
  ) {
    throw new Error("verify");
  }
  const forged = hexToBytes(F4_NODE_PREKEY.crossSignature);
  forged[0] ^= 0x01;
  if (
    verifyE2eeSignature({
      algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
      publicKey: identityPublicKey,
      message: transcript,
      signature: forged,
    })
  ) {
    throw new Error("forgery accepted");
  }
}

/** §6.2 keygen off the live §14.5 CSPRNG, plus the pinned base-point derivation. */
function checkAgreementKeygen(): void {
  if (
    !equalHex(
      deriveE2eeAgreementPublicKey(hexToBytes(F13_NODE_IDENTITY.agreementSecretKey)),
      F4_NODE_PREKEY.agreementPublicKey,
    )
  ) {
    throw new Error("derivation");
  }

  const first = generateE2eeAgreementKeyPair();
  const second = generateE2eeAgreementKeyPair();
  try {
    if (bytesToHex(deriveE2eeAgreementPublicKey(first.secretKey)) !== bytesToHex(first.publicKey)) {
      throw new Error("keypair");
    }
    // Two draws from a working CSPRNG collide with negligible probability; two
    // draws from a stubbed-out one are identical.
    if (bytesToHex(first.secretKey) === bytesToHex(second.secretKey)) {
      throw new Error("repeated draw");
    }
  } finally {
    first.secretKey.fill(0);
    second.secretKey.fill(0);
  }
}

/** The cases, in the order the on-device report prints them. */
export const E2EE_VECTOR_SUITE_CASES = [
  "runtime globals (§14.5)",
  "F15 Noise IK vector (§14.1)",
  "F6 record protection (§9.1)",
  "F4 node prekey certificate (§7.3)",
  "X25519 agreement keygen (§6.2)",
] as const;

/**
 * Run the whole subset and report a bounded verdict per case.
 *
 * Never throws and never reports a byte: a failing case yields its fixed name
 * and `ok: false`, because the values that would explain it are key material.
 * `host` exists so a test can present a runtime without the §14.5 globals; on a
 * device it is always the real one.
 */
export async function runE2eeVectorSuite(
  host: E2eeRuntimeHost = globalThis,
): Promise<E2eeVectorSuiteResult> {
  const runners: readonly (() => void | Promise<void>)[] = [
    () => assertE2eeRuntimeGlobals(host),
    checkNoiseIkVector,
    checkRecordProtection,
    checkNodePrekeyCertificate,
    checkAgreementKeygen,
  ];
  const checks: E2eeVectorCheck[] = [];
  for (const [index, name] of E2EE_VECTOR_SUITE_CASES.entries()) {
    let ok = true;
    try {
      await runners[index]!();
    } catch {
      ok = false;
    }
    checks.push({ name, ok });
  }
  return { ok: checks.every((check) => check.ok), checks, globals: e2eeGlobalProvenance };
}

/** The dev-build global the README's device procedure invokes. */
export const E2EE_VECTOR_RUNNER_GLOBAL = "__rycoRunE2eeVectors";

/**
 * Expose the runner to the development client's JS console.
 *
 * Two gates, and both are load-bearing. `index.ts` requires this module only
 * inside `if (__DEV__)`, which Metro constant-folds away before it collects
 * dependencies, so a release bundle contains neither the hook nor this file.
 * The variant check is the same `APP_VARIANT` -> `extra.appVariant` chain
 * `app.config.ts` stamps, so a `preview` or `production` JS bundle that somehow
 * did reach here still installs nothing.
 */
export function installE2eeVectorRunnerDevHook(host: Record<string, unknown> = globalThis): void {
  if (readMobileAppVariant() !== "development") return;
  Object.defineProperty(host, E2EE_VECTOR_RUNNER_GLOBAL, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: runE2eeVectorSuite,
  });
}
