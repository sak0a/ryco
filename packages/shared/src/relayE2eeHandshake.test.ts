import { p256 } from "@noble/curves/nist";
import { sha256 } from "@noble/hashes/sha2";
import { utf8ToBytes } from "@noble/hashes/utils";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_CONFIRMATION_BYTES,
  E2EE_CONTEXT_COMMITMENT_BYTES,
  E2EE_HANDSHAKE_NONCE_BYTES,
  E2EE_NEGOTIATION_DISCRIMINATOR,
  E2EE_SERVER_ACCEPT_MAX_BYTES,
  E2EE_SESSION_BINDING_HASH_BYTES,
  T_HANDSHAKE,
  T_HANDSHAKE_NODE,
} from "./relayE2eeConstants.ts";
import {
  E2EE_CONFIRMATION_DOMAIN,
  E2EE_NX_HELLO_PAYLOAD,
  E2EE_SESSION_BINDING_DOMAIN,
  E2eeClientHandshake,
  E2eeNodeHandshake,
  decodeE2eeClientHello,
  decodeE2eeIkHelloPayload,
  decodeE2eeServerAccept,
  decodeE2eeServerAcceptPayload,
  e2eeAuthorizationKeysEqual,
  e2eeAuthorizationWithdrawn,
  e2eeClientHandshakeDeadline,
  e2eeConfirmationTranscript,
  e2eeNodeHandshakeDeadline,
  e2eeRoleRank,
  e2eeRoleWithinCeiling,
  e2eeSecretBytesEqual,
  e2eeServerConfirmation,
  e2eeSessionBindingHash,
  e2eeSuiteNoiseUsage,
  encodeE2eeClientHello,
  encodeE2eeIkHelloPayload,
  encodeE2eeServerAccept,
  encodeE2eeServerAcceptPayload,
  encodeE2eeServerAcceptTbs,
  selectE2eeSuite,
  verifyE2eeClientPrekeyCertificate,
  type E2eeAdmittedAuthoritySnapshot,
  type E2eeAdvertisedChannelMaterial,
  type E2eeClientAuthorization,
  type E2eeClientAuthorizationKey,
  type E2eeClientHandshakeCredentials,
  type E2eeHandshakeChannel,
  type E2eeIkHelloPayload,
  type E2eeModeTransition,
  type E2eeNodeAdmissionPolicy,
} from "./relayE2eeHandshake.ts";
import { RelayE2eeValidationError, e2eeKeyFingerprint } from "./relayE2eeKeys.ts";
import { E2eeNoiseHandshake } from "./relayE2eeNoise.ts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_RPC,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
} from "./relayE2eeWire.ts";
import { E2eeRecordSession, deriveE2eeSessionSecrets } from "./relayE2eeSession.ts";
import {
  E2EE_NOISE_PATTERN_IK,
  E2EE_NOISE_PATTERN_NX,
  decodeCanonicalE2eeCbor,
  e2eeAuthorizationContextCommitment,
  encodeClientE2eePrekeyTranscript,
  encodeE2eeAuthorizationContext,
  encodeE2eeNoisePrologue,
  type E2eeAuthorizationContextInput,
  type E2eeTier,
} from "./relayE2eeTranscripts.ts";

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");
/** A copy with one bit of one byte flipped — the smallest possible tamper. */
const flipByte = (value: Uint8Array, index: number): Uint8Array => {
  const copy = Uint8Array.from(value);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
};

// ─── §16.1-style TEST-ONLY material ──────────────────────────────────────────
//
// The X25519 keys are the RFC 7748 §6.1 vector keys and the P-256 identity key
// is the RFC 6979 A.2.5 vector key, so their public halves are independently
// published values and a wrong curve or encoding shows up immediately. The
// ephemerals and the client nonce are fixed counting patterns. The node
// identifiers and timestamps are `relayE2eeTranscripts.test.ts`'s, so the two
// files pin the same §7 material. NONE OF IT MAY EVER REACH A REAL ENDPOINT.

const NODE_IDENTITY_PUBLIC = bytes(
  "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
);
const NODE_AGREEMENT_SECRET = bytes(
  "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
);
const NODE_AGREEMENT_PUBLIC = bytes(
  "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
);
const CLIENT_AGREEMENT_SECRET = bytes(
  "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
);
const CLIENT_AGREEMENT_PUBLIC = bytes(
  "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
);
const CLIENT_IDENTITY_SECRET = bytes(
  "c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721",
);
const CLIENT_IDENTITY_PUBLIC = bytes(
  "04" +
    "60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6" +
    "7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299",
);
const CLIENT_EPHEMERAL_SECRET = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const NODE_EPHEMERAL_SECRET = "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40";
const CLIENT_NONCE = "9f9e9d9c9b9a999897969594939291908f8e8d8c8b8a89888786858483828180";

const HUB_ORIGIN = "https://hub.example.com";
const OTHER_HUB_ORIGIN = "https://other.example.com";
const NODE_ID = "node_AAAAAAAAAAAAAAAAAAAAAA";
const PREKEY_ID = "epk_EEEEEEEEEEEEEEEEEEEEEE";
const CONTINUITY_ID = "nct_FFFFFFFFFFFFFFFFFFFFFF";
const OTHER_CONTINUITY_ID = "nct_HHHHHHHHHHHHHHHHHHHHHH";
const CHANNEL_ID = "ch_GGGGGGGGGGGGGGGGGGGGGG";
const OTHER_CHANNEL_ID = "ch_IIIIIIIIIIIIIIIIIIIIII";
const ACCOUNT_ID = "acct_0123456789";
const OTHER_ACCOUNT_ID = "acct_9876543210";
const CREATED_AT = 1_784_160_000_000;
const EXPIRES_AT = 1_786_752_000_000;
const NOW = 1_784_160_030_000;

const NODE_IDENTITY_FINGERPRINT = e2eeKeyFingerprint("node-identity", NODE_IDENTITY_PUBLIC);
const NODE_AGREEMENT_FINGERPRINT = e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC);
const CLIENT_IDENTITY_FINGERPRINT = e2eeKeyFingerprint("client-identity", CLIENT_IDENTITY_PUBLIC);
const CLIENT_AGREEMENT_FINGERPRINT = e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC);

const signClientPrekey = (transcript: Uint8Array, secret: Uint8Array = CLIENT_IDENTITY_SECRET) =>
  p256.sign(sha256(transcript), secret, { prehash: false }).toBytes("compact");

const clientPrekeyTranscript = (
  overrides: Partial<Parameters<typeof encodeClientE2eePrekeyTranscript>[0]> = {},
): Uint8Array =>
  encodeClientE2eePrekeyTranscript({
    hubOrigin: HUB_ORIGIN,
    accountId: ACCOUNT_ID,
    identityPublicKey: CLIENT_IDENTITY_PUBLIC,
    agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  });

const CLIENT_PREKEY_TRANSCRIPT = clientPrekeyTranscript();
const CLIENT_PREKEY_SIGNATURE = signClientPrekey(CLIENT_PREKEY_TRANSCRIPT);

// ─── golden §8 vectors ───────────────────────────────────────────────────────
//
// Byte-exact expectations for the material above, so that ANY change to an
// element order, a domain string, a field type, a transcript input, or the
// order in which the two ends hash the wire bytes fails a test. §16.3 F6 and F7
// require exactly this set of named intermediates.
//
// The four §6.5 secrets are the ones `relayE2eeNoise.test.ts` and
// `relayE2eeSession.test.ts` already pin for the same keys — Noise derives the
// chaining key from the DH outputs alone, so the prologue and payloads that
// differ between those files and this one cannot move them. That coincidence is
// asserted below rather than left implicit.

const CLIENT_PREKEY_TRANSCRIPT_HEX =
  "8b781a7279636f2e636c69656e742d653265652d7072656b65792e76317768747470733a2f2f6875622e6578616d706c652e636f6d6f616363745f30313233343536373839647032353658410460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d446229958209b10a82d710bb258c0f58e033d4e0576747bb69251f3f1f2a12abc4241c5588658208520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a653235353139665348413235361b0000019f683918001b000001a002b7e000";
const CLIENT_PREKEY_SIGNATURE_HEX =
  "a423d7f6e16c0672f9cecf237bd5c92b2673c5154fe31454a45f51b8f4fb41b8bffd0df3757dcd4002e479513bab6fbfe6a26e2ab5f3fb14f6337e7d5b0985d9";

const IK_CONTEXT =
  "92781a7279636f2e72656c61792d653265652e636f6e746578742e76317768747470733a2f2f6875622e6578616d706c652e636f6d781963685f4747474747474747474747474747474747474747474701020101781b6e6f64655f41414141414141414141414141414141414141414141676564323535313958200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b646f616363745f30313233343536373839687279636f2e727063686f70657261746f72687279636f2e727063686f70657261746f72815820462ba88f9261f271c5a2370f680820ce4094c908f24d80aeee852669fe8cb21c8258209b10a82d710bb258c0f58e033d4e0576747bb69251f3f1f2a12abc4241c55886582079780df34efdda6c150305041fa4cecbc7e95f541d8e8bc00b841cada23ad035781a6e63745f46464646464646464646464646464646464646464646";
const IK_CONTEXT_COMMITMENT = "57173abc5012f171265dfa5b73e5b959afa2dd1aa2593c6f524623cfddde26af";
const IK_PROLOGUE =
  "89781b7279636f2e72656c61792d653265652e70726f6c6f6775652e76317768747470733a2f2f6875622e6578616d706c652e636f6d781963685f4747474747474747474747474747474747474747474701020101781b6e6f64655f41414141414141414141414141414141414141414141582057173abc5012f171265dfa5b73e5b959afa2dd1aa2593c6f524623cfddde26af";
const IK_HELLO =
  "02018701666e617469766501810158209f9e9d9c9b9a999897969594939291908f8e8d8c8b8a89888786858483828180582057173abc5012f171265dfa5b73e5b959afa2dd1aa2593c6f524623cfddde26af5901b707a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c545550b09fb2678cb15e4c375e261898c1ef7174000266ed332ec04d20536f6566beb42c9fda60ffe32fc202ac2322c4dfb15919214268f55ee0e9599184a47f03bce359d5e9534bbdac1657fe0e07229a78da76c3334e89c7c85ae81d9baf9b6c2dc305aae0bd029b9a25b514dbda1c5fb7fa475fb2de70938d5337135194a8e2d1110e3b22b187d57de105262f984d2d3a0fddbdf7c43d270de01ee55e63174876973c9e52812507064ae0332d6392bccb9d5812d22d282ef47ab777fcf48d9c2492d6d377e010f1512b62c2d09b1957d7d8b32fab715da7cb38de7c0a388848610207a8c90b58497d59f8e8939befd02f37b1f1d177c9a9cfb6cb1d04e941301f13aced7fb07300ae6312fca939c6b988b7aa8c9a255b37d8155308afb816eb1001d6df40aba5844304df906ca458491be1fb026b7bdcc5b31573718b0b5a32f54ba1078fd2633ce14d3c3fae8196cb27c9c2a217435168b19458d69cce5ce8e1d790dc9d6e9f931411a7e7f4f0e170a087c0886b63f9f84949e039ff7277c8cc5a7ee05e7c39569195f8ef717a347ba6522b162b9a";
const IK_SERVER_ACCEPT_TBS =
  "02028401781a65706b5f45454545454545454545454545454545454545454545582057173abc5012f171265dfa5b73e5b959afa2dd1aa2593c6f524623cfddde26af58655869aff450549732cbaaed5e5df9b30a6da31cb0e5742bad5ad4a1a768f1a67b4a759f7d4814ac3be724a5387bdbca7e88b1bdfdc1cf2af2cf55426a67ff4157f531a740739e5e54a269d194281ee886b5a2351942b1389dc9a81755ad978fe77645a641ac";
const IK_CONFIRMATION_TRANSCRIPT =
  "a6cc01c7f2fae0b863fe4ba0b63512d130ea18005025bc2fe50a9df54968a0a1";
const IK_SERVER_ACCEPT =
  "02028501781a65706b5f45454545454545454545454545454545454545454545582057173abc5012f171265dfa5b73e5b959afa2dd1aa2593c6f524623cfddde26af58655869aff450549732cbaaed5e5df9b30a6da31cb0e5742bad5ad4a1a768f1a67b4a759f7d4814ac3be724a5387bdbca7e88b1bdfdc1cf2af2cf55426a67ff4157f531a740739e5e54a269d194281ee886b5a2351942b1389dc9a81755ad978fe77645a641ac582021c22a481e52ed9622ec0712d09c1b8309499a6b7a58207b7b53b683b46797b3";
const IK_SESSION_BINDING_HASH = "dede8804c4e16d8f8511eb76753aaec9038a2e67e699ed1699e6fa4167ba5453";
const IK_EPOCH_SECRET_C2N = "4baa406898c98ea1b8ee046dffc725a94e6507fb00ce8f5b3cb6740221f5c296";
const IK_EPOCH_SECRET_N2C = "66937266322565f6ce0f54a4b96f8662341a79048d6abf3d7750bb37a3d1f193";
const IK_EXPORTER_SECRET = "67ccffd18305fbdda59ee370c91b8957bc8ae19f244dc821ff3f1e8c874577f9";
const IK_SERVER_CONFIRMATION_KEY =
  "05ce96a84def8dfdce12ae373171f0081bc9a781b027aabba1176344bee8931e";

const NX_CONTEXT =
  "92781a7279636f2e72656c61792d653265652e636f6e746578742e76317768747470733a2f2f6875622e6578616d706c652e636f6d781963685f4747474747474747474747474747474747474747474701020101781b6e6f64655f41414141414141414141414141414141414141414141676564323535313958200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b6460687279636f2e727063686f70657261746f72687279636f2e727063686f70657261746f72815820462ba88f9261f271c5a2370f680820ce4094c908f24d80aeee852669fe8cb21c80781a6e63745f46464646464646464646464646464646464646464646";
const NX_CONTEXT_COMMITMENT = "90df2c09b9e1113f849c14f9463e2db3fadb9b0264bd0f2605ccb130eb6cb0a8";
const NX_HELLO =
  "020187016377656201810158209f9e9d9c9b9a999897969594939291908f8e8d8c8b8a89888786858483828180582090df2c09b9e1113f849c14f9463e2db3fadb9b0264bd0f2605ccb130eb6cb0a8582007a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c";
const NX_SERVER_ACCEPT_TBS =
  "02028401781a65706b5f45454545454545454545454545454545454545454545582090df2c09b9e1113f849c14f9463e2db3fadb9b0264bd0f2605ccb130eb6cb0a858955869aff450549732cbaaed5e5df9b30a6da31cb0e5742bad5ad4a1a768f1a67b70b92b5166e17e42bc69142426cfda03970d22c6dae45404b74dbab441d976df3a18c3cdcd9727f49142d04835f7a977e358ef68b38ee826b13db1c7133f052b7ad396e6b0f893499288bbe669993af695b57d6a271278301d1a3652e7a6eca2d1135fc7bbf7f88e7d4c157c7ea3cac737834f40f8";
const NX_CONFIRMATION_TRANSCRIPT =
  "7b3e86bfc73b258a5d0606eb06c07db568f901eb2cf670eaa61a2cd08aa60875";
const NX_SERVER_ACCEPT =
  "02028501781a65706b5f45454545454545454545454545454545454545454545582090df2c09b9e1113f849c14f9463e2db3fadb9b0264bd0f2605ccb130eb6cb0a858955869aff450549732cbaaed5e5df9b30a6da31cb0e5742bad5ad4a1a768f1a67b70b92b5166e17e42bc69142426cfda03970d22c6dae45404b74dbab441d976df3a18c3cdcd9727f49142d04835f7a977e358ef68b38ee826b13db1c7133f052b7ad396e6b0f893499288bbe669993af695b57d6a271278301d1a3652e7a6eca2d1135fc7bbf7f88e7d4c157c7ea3cac737834f40f85820d5513ccfc4f33c525faf20177c66b7743a9459c036d60b664f7c6946ca214f8e";
const NX_SESSION_BINDING_HASH = "64dadbcc007cd6ea9e99b218beb7b13da9ff39417d3a2245262fc612c0c05152";
const NX_EPOCH_SECRET_C2N = "bb7080f6888632a741e2c139c34f8ec95ef002b09a347bbc51f28f5b398aeee1";
const NX_EPOCH_SECRET_N2C = "2b0ae20109fb4dd97d73c35098e64e0879c832984407309d50053beae1a12ad4";
const NX_EXPORTER_SECRET = "a7161c6198f201cc9783c7c549c66d3d1f4f8ad850715d40218c5ce015a84252";
const NX_SERVER_CONFIRMATION_KEY =
  "bce1a160b4f2ad5e6553d4f6a73bfabdc6d7aee4f2ad8bb5723887cb9a09489e";

// ─── fixtures ────────────────────────────────────────────────────────────────

const channel = (overrides: Partial<E2eeHandshakeChannel> = {}): E2eeHandshakeChannel => ({
  hubOrigin: HUB_ORIGIN,
  channelId: CHANNEL_ID,
  relayProtocolMajor: 1,
  relayProtocolMinor: 2,
  channelOpenCapability: "ryco.rpc",
  channelOpenEffectiveRole: "operator",
  ...overrides,
});

const advertised = (
  overrides: Partial<E2eeAdvertisedChannelMaterial> = {},
): E2eeAdvertisedChannelMaterial => ({
  nodeId: NODE_ID,
  nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
  prekeyId: PREKEY_ID,
  agreementPublicKey: NODE_AGREEMENT_PUBLIC,
  continuityChainTranscripts: [],
  continuityId: CONTINUITY_ID,
  ...overrides,
});

const nativeCredentials = (
  overrides: Record<string, unknown> = {},
): E2eeClientHandshakeCredentials => ({
  tier: "native",
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_IDENTITY_PUBLIC,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC,
  agreementSecretKey: CLIENT_AGREEMENT_SECRET,
  prekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
  prekeySignature: CLIENT_PREKEY_SIGNATURE,
  ...overrides,
});

const APPROVED: E2eeClientAuthorization = {
  status: "approved",
  maxRole: "owner",
  capabilitySet: ["ryco.rpc"],
};

interface ClientOverrides {
  readonly channel?: E2eeHandshakeChannel;
  readonly advertised?: E2eeAdvertisedChannelMaterial;
  readonly credentials?: E2eeClientHandshakeCredentials;
  readonly offeredSuites?: readonly number[];
  readonly intendedCapability?: string;
  readonly intendedRole?: string;
  /** Supplied by name where a test must observe the §9.5 erasure of it. */
  readonly testOnlyEphemeralSecretKey?: Uint8Array;
}

const makeClient = (tier: E2eeTier, overrides: ClientOverrides = {}): E2eeClientHandshake =>
  new E2eeClientHandshake({
    channel: overrides.channel ?? channel(),
    advertised: overrides.advertised ?? advertised(),
    selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    offeredSuites: overrides.offeredSuites ?? [1],
    credentials:
      overrides.credentials ?? (tier === "native" ? nativeCredentials() : { tier: "web" }),
    intendedCapability: overrides.intendedCapability ?? "ryco.rpc",
    intendedRole: overrides.intendedRole ?? "operator",
    testOnlyClientNonce: bytes(CLIENT_NONCE),
    testOnlyEphemeralSecretKey:
      overrides.testOnlyEphemeralSecretKey ?? bytes(CLIENT_EPHEMERAL_SECRET),
  });

interface NodeOverrides {
  readonly channel?: E2eeHandshakeChannel;
  readonly advertised?: E2eeAdvertisedChannelMaterial;
  readonly policy?: E2eeNodeAdmissionPolicy;
  readonly authorization?: E2eeClientAuthorization | undefined;
  readonly admitAttempt?: () => boolean;
  readonly readPolicy?: () => E2eeNodeAdmissionPolicy;
  readonly lookupClientAuthorization?: (
    key: E2eeClientAuthorizationKey,
  ) => E2eeClientAuthorization | undefined;
  readonly enterE2eeMode?: () => E2eeModeTransition;
  readonly advertisedVersionMin?: number;
  readonly advertisedVersionMax?: number;
  readonly advertisementEmittedAt?: number;
  /** Supplied by name where a test must observe the §9.5 erasure of it. */
  readonly testOnlyEphemeralSecretKey?: Uint8Array;
}

const makeNode = (overrides: NodeOverrides = {}): E2eeNodeHandshake =>
  new E2eeNodeHandshake({
    channel: overrides.channel ?? channel(),
    advertised: overrides.advertised ?? advertised(),
    advertisedVersionMin: overrides.advertisedVersionMin ?? 1,
    advertisedVersionMax: overrides.advertisedVersionMax ?? 1,
    agreementSecretKey: NODE_AGREEMENT_SECRET,
    advertisementEmittedAt: overrides.advertisementEmittedAt ?? NOW,
    readPolicy:
      overrides.readPolicy ??
      (() => overrides.policy ?? { requireApprovedClientE2EE: false, suiteRegistry: [1] }),
    admitAttempt: overrides.admitAttempt,
    lookupClientAuthorization:
      overrides.lookupClientAuthorization ??
      (() => ("authorization" in overrides ? overrides.authorization : APPROVED)),
    enterE2eeMode: overrides.enterE2eeMode,
    testOnlyEphemeralSecretKey:
      overrides.testOnlyEphemeralSecretKey ?? bytes(NODE_EPHEMERAL_SECRET),
  });

const expectHello = (client: E2eeClientHandshake, now = NOW) => {
  const result = client.createHello(now);
  if (result.kind !== "hello") throw new Error(`expected a hello, got ${JSON.stringify(result)}`);
  return result;
};

const expectAccept = (node: E2eeNodeHandshake, record: Uint8Array, now = NOW) => {
  const result = node.receiveHello(record, now);
  if (result.kind !== "accepted") {
    throw new Error(`expected an accept, got ${JSON.stringify(result)}`);
  }
  return result;
};

const expectEstablished = (client: E2eeClientHandshake, record: Uint8Array, now = NOW) => {
  const result = client.receiveServerAccept(record, now);
  if (result.kind !== "established") {
    throw new Error(`expected an established session, got ${JSON.stringify(result)}`);
  }
  return result;
};

/** A full in-process handshake between two endpoints, for one tier. */
const runHandshake = (tier: E2eeTier) => {
  const client = makeClient(tier);
  const hello = expectHello(client);
  const node = makeNode();
  const accept = expectAccept(node, hello.record);
  const established = expectEstablished(client, accept.record);
  return { client, hello, node, accept, established };
};

// A hand-built hello, for the mutations a conforming client cannot produce: the
// context block, the commitment, the wrapper tier, and the payload claims are
// all supplied independently, which is exactly what a hostile Hub or a
// non-conforming client would do.
const craftHello = (input: {
  readonly contextBlock: Uint8Array;
  readonly commitment?: Uint8Array;
  readonly wrapperTier?: E2eeTier;
  readonly noiseTier?: E2eeTier;
  readonly claims?: Partial<E2eeIkHelloPayload>;
  readonly offeredSuites?: readonly number[];
  readonly channelId?: string;
}): Uint8Array => {
  const commitment = input.commitment ?? e2eeAuthorizationContextCommitment(input.contextBlock);
  const noiseTier = input.noiseTier ?? input.wrapperTier ?? "native";
  const prologue = encodeE2eeNoisePrologue({
    hubOrigin: HUB_ORIGIN,
    channelId: input.channelId ?? CHANNEL_ID,
    relayProtocolMajor: 1,
    relayProtocolMinor: 2,
    e2eeVersion: 1,
    suiteId: 1,
    nodeId: NODE_ID,
    contextCommitment: commitment,
  });
  const noise = new E2eeNoiseHandshake({
    pattern: noiseTier === "native" ? E2EE_NOISE_PATTERN_IK : E2EE_NOISE_PATTERN_NX,
    role: "initiator",
    prologue,
    staticSecretKey: noiseTier === "native" ? CLIENT_AGREEMENT_SECRET : undefined,
    remoteStaticPublicKey: noiseTier === "native" ? NODE_AGREEMENT_PUBLIC : undefined,
    testOnlyEphemeralSecretKey: bytes(CLIENT_EPHEMERAL_SECRET),
  });
  const payload =
    noiseTier === "native"
      ? encodeE2eeIkHelloPayload({
          clientPrekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
          clientPrekeySignature: CLIENT_PREKEY_SIGNATURE,
          accountId: ACCOUNT_ID,
          intendedCapability: "ryco.rpc",
          intendedRole: "operator",
          ...input.claims,
        })
      : E2EE_NX_HELLO_PAYLOAD;
  return encodeE2eeClientHello({
    tier: input.wrapperTier ?? noiseTier,
    selectedSuite: 1,
    offeredSuites: input.offeredSuites ?? [1],
    clientNonce: bytes(CLIENT_NONCE),
    contextCommitment: commitment,
    noiseMessage1: noise.writeMessage(payload),
  });
};

const nativeContext = (
  overrides: Partial<E2eeAuthorizationContextInput> = {},
): E2eeAuthorizationContextInput => ({
  hubOrigin: HUB_ORIGIN,
  channelId: CHANNEL_ID,
  relayProtocolMajor: 1,
  relayProtocolMinor: 2,
  e2eeVersion: 1,
  suiteId: 1,
  nodeId: NODE_ID,
  nodeIdentityFingerprint: NODE_IDENTITY_FINGERPRINT,
  clientIntendedCapability: "ryco.rpc",
  clientIntendedRole: "operator",
  channelOpenCapability: "ryco.rpc",
  channelOpenEffectiveRole: "operator",
  nodeAgreementFingerprint: NODE_AGREEMENT_FINGERPRINT,
  nodeContinuityChainTranscripts: [],
  nodeContinuityId: CONTINUITY_ID,
  client: {
    tier: "native",
    accountId: ACCOUNT_ID,
    identityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
    agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
  },
  ...overrides,
});

// ─── §8.2 client-selected suite, with §5.2 steps 8–9 ─────────────────────────

describe("§8.2 client-selected suite and the §5.2 usability checks", () => {
  const usable = {
    tier: "native" as E2eeTier,
    localSuitePreference: [1],
    advertisedSuiteRegistry: [1],
    advertisedVersionMin: 1,
    advertisedVersionMax: 1,
    advertisedAdmittedPatterns: [E2EE_NOISE_PATTERN_IK, E2EE_NOISE_PATTERN_NX],
  };

  it("selects the client's own first preference present in the advertised registry", () => {
    expect(selectE2eeSuite(usable)).toEqual({ kind: "usable", selectedSuite: 1 });
    // The client's order governs, not the registry's: a registry listing an
    // unregistered id first still yields the client's selection.
    expect(
      selectE2eeSuite({ ...usable, advertisedSuiteRegistry: [7, 1], localSuitePreference: [1] }),
    ).toEqual({ kind: "usable", selectedSuite: 1 });
  });

  it("rejects a protocol range excluding this version (§5.2 step 8)", () => {
    expect(
      selectE2eeSuite({ ...usable, advertisedVersionMin: 2, advertisedVersionMax: 3 }),
    ).toEqual({ kind: "unusable", reason: "protocol_version_out_of_range" });
    expect(
      selectE2eeSuite({ ...usable, advertisedVersionMin: 3, advertisedVersionMax: 2 }),
    ).toEqual({ kind: "unusable", reason: "protocol_version_out_of_range" });
  });

  it("rejects an admitted pattern set omitting this tier's pattern (§5.2 step 9)", () => {
    expect(
      selectE2eeSuite({
        ...usable,
        tier: "web",
        advertisedAdmittedPatterns: [E2EE_NOISE_PATTERN_IK],
      }),
    ).toEqual({ kind: "unusable", reason: "pattern_not_admitted" });
    // The native tier's pattern is never absent under any version-1 policy.
    expect(
      selectE2eeSuite({ ...usable, advertisedAdmittedPatterns: [E2EE_NOISE_PATTERN_IK] }).kind,
    ).toBe("usable");
  });

  it("rejects an empty suite intersection, unregistered ids included (§8.2, §3.4)", () => {
    expect(selectE2eeSuite({ ...usable, advertisedSuiteRegistry: [2] })).toEqual({
      kind: "unusable",
      reason: "empty_suite_intersection",
    });
    // `2` is reserved by §3.4, so agreement on it is not a selection.
    expect(
      selectE2eeSuite({
        ...usable,
        localSuitePreference: [2],
        advertisedSuiteRegistry: [2],
      }),
    ).toEqual({ kind: "unusable", reason: "empty_suite_intersection" });
  });

  it("leaves no suite to build a hello from when the statement is unusable", () => {
    // §4.4's no-legacy-after-evidence rule turns on this: an unusable statement
    // yields no selection at all, so no hello can be built from it.
    const result = selectE2eeSuite({ ...usable, advertisedVersionMin: 2, advertisedVersionMax: 2 });
    expect(result.kind).toBe("unusable");
    expect("selectedSuite" in result).toBe(false);
  });

  it("refuses an over-long or empty registry as a local error, not an unusability verdict", () => {
    expect(() =>
      selectE2eeSuite({ ...usable, advertisedSuiteRegistry: [1, 1, 1, 1, 1, 1, 1, 1, 1] }),
    ).toThrow(RelayE2eeValidationError);
    expect(() => selectE2eeSuite({ ...usable, advertisedSuiteRegistry: [] })).toThrow(
      RelayE2eeValidationError,
    );
  });

  it("pins the suite's Noise usage fields (§3.4, §8.6 step 5)", () => {
    expect(e2eeSuiteNoiseUsage(E2EE_SUITE_25519_CHACHAPOLY_SHA256)).toEqual({
      dh: "25519",
      hash: "SHA256",
    });
  });
});

// ─── §8.5 `E2EEClientHello` ──────────────────────────────────────────────────

describe("§8.5 E2EEClientHello", () => {
  it("pins the §7.4 certificate this suite's vectors are built on", () => {
    expect(hex(CLIENT_PREKEY_TRANSCRIPT)).toBe(CLIENT_PREKEY_TRANSCRIPT_HEX);
    expect(hex(CLIENT_PREKEY_SIGNATURE)).toBe(CLIENT_PREKEY_SIGNATURE_HEX);
  });

  it("pins the IK context, commitment, prologue, and hello wire bytes", () => {
    const hello = expectHello(makeClient("native"));
    expect(hex(hello.contextBlock)).toBe(IK_CONTEXT);
    expect(hex(hello.contextCommitment)).toBe(IK_CONTEXT_COMMITMENT);
    expect(hex(hello.prologue)).toBe(IK_PROLOGUE);
    expect(hex(hello.record)).toBe(IK_HELLO);
  });

  it("pins the NX context, commitment, and hello wire bytes", () => {
    const hello = expectHello(makeClient("web"));
    expect(hex(hello.contextBlock)).toBe(NX_CONTEXT);
    expect(hex(hello.contextCommitment)).toBe(NX_CONTEXT_COMMITMENT);
    expect(hex(hello.record)).toBe(NX_HELLO);
  });

  it("frames the wrapper as a 7-element array in the §8.5 order", () => {
    const decoded = decodeE2eeClientHello(bytes(IK_HELLO));
    // The two framing bytes plus the six fixed-width elements occupy exactly 85
    // bytes, so `noiseMessage1` is the 439-byte tail.
    const NOISE_MESSAGE_OFFSET = 85;
    expect(decoded).toEqual({
      kind: "ok",
      value: {
        e2eeVersion: 1,
        tier: "native",
        selectedSuite: 1,
        offeredSuites: [1],
        clientNonce: bytes(CLIENT_NONCE),
        contextCommitment: bytes(IK_CONTEXT_COMMITMENT),
        noiseMessage1: bytes(IK_HELLO.slice(NOISE_MESSAGE_OFFSET * 2)),
      },
    });
    expect(bytes(IK_HELLO).byteLength - NOISE_MESSAGE_OFFSET).toBe(439);
    // Negotiation discriminator, then record type `0x01`, then the 7-element
    // CBOR array head.
    expect(bytes(IK_HELLO)[0]).toBe(E2EE_NEGOTIATION_DISCRIMINATOR);
    expect(bytes(IK_HELLO)[1]).toBe(E2EE_NEGOTIATION_TYPE_CLIENT_HELLO);
    expect(bytes(IK_HELLO)[2]).toBe(0x87);
  });

  it("carries no client identifier in the clear wrapper", () => {
    // §8.5: no account id, no client key, no fingerprint, no certificate. The
    // account id and the certificate travel only inside the encrypted payload.
    const wrapper = IK_HELLO.slice(0, IK_HELLO.length - 439 * 2);
    expect(wrapper).not.toContain(hex(utf8ToBytes(ACCOUNT_ID)));
    expect(wrapper).not.toContain(hex(CLIENT_IDENTITY_FINGERPRINT));
    expect(wrapper).not.toContain(hex(CLIENT_AGREEMENT_PUBLIC));
    expect(IK_HELLO).not.toContain(hex(CLIENT_PREKEY_TRANSCRIPT));
  });

  it("carries the certificate, cross-signature, account claim, and authority on IK", () => {
    const payload = encodeE2eeIkHelloPayload({
      clientPrekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
      clientPrekeySignature: CLIENT_PREKEY_SIGNATURE,
      accountId: ACCOUNT_ID,
      intendedCapability: "ryco.rpc",
      intendedRole: "operator",
    });
    expect(decodeE2eeIkHelloPayload(payload)).toEqual({
      kind: "ok",
      value: {
        clientPrekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
        clientPrekeySignature: CLIENT_PREKEY_SIGNATURE,
        accountId: ACCOUNT_ID,
        intendedCapability: "ryco.rpc",
        intendedRole: "operator",
      },
    });
    expect(payload[0]).toBe(0x85);
  });

  it("keeps the NX message-1 payload zero-length", () => {
    expect(E2EE_NX_HELLO_PAYLOAD.byteLength).toBe(0);
    // The NX Noise message is exactly the 32-byte ephemeral: no key exists, so
    // an appended payload would travel in the clear (§8.10).
    const decoded = decodeE2eeClientHello(bytes(NX_HELLO));
    expect(decoded.kind === "ok" && decoded.value.noiseMessage1.byteLength).toBe(32);
  });

  it("enforces the exact field lengths and the offered-suite rules at encode", () => {
    const base = {
      tier: "native" as E2eeTier,
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: [1],
      clientNonce: bytes(CLIENT_NONCE),
      contextCommitment: bytes(IK_CONTEXT_COMMITMENT),
      noiseMessage1: bytes("aabbcc"),
    } as const;
    expect(() => encodeE2eeClientHello({ ...base, clientNonce: new Uint8Array(31) })).toThrow(
      RelayE2eeValidationError,
    );
    expect(() => encodeE2eeClientHello({ ...base, contextCommitment: new Uint8Array(33) })).toThrow(
      RelayE2eeValidationError,
    );
    // §8.5 element 3 MUST contain element 2.
    expect(() => encodeE2eeClientHello({ ...base, offeredSuites: [2] })).toThrow(
      RelayE2eeValidationError,
    );
    // …and MUST NOT exceed the registry cap.
    expect(() =>
      encodeE2eeClientHello({ ...base, offeredSuites: [1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    ).toThrow(RelayE2eeValidationError);
    expect(E2EE_HANDSHAKE_NONCE_BYTES).toBe(32);
    expect(E2EE_CONTEXT_COMMITMENT_BYTES).toBe(32);
  });

  it("enforces the §3.2 hello size cap at encode and at decode", () => {
    expect(() =>
      encodeE2eeClientHello({
        tier: "native",
        selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        offeredSuites: [1],
        clientNonce: bytes(CLIENT_NONCE),
        contextCommitment: bytes(IK_CONTEXT_COMMITMENT),
        noiseMessage1: new Uint8Array(E2EE_CLIENT_HELLO_MAX_BYTES),
      }),
    ).toThrow(RangeError);
    const oversized = new Uint8Array(E2EE_CLIENT_HELLO_MAX_BYTES + 1);
    oversized[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
    oversized[1] = E2EE_NEGOTIATION_TYPE_CLIENT_HELLO;
    expect(decodeE2eeClientHello(oversized)).toEqual({ kind: "error", reason: "bad_record" });
    expect(E2EE_CLIENT_HELLO_MAX_BYTES).toBe(4_096);
  });

  it("rejects a misdirected or malformed record before parsing its body", () => {
    expect(decodeE2eeClientHello(bytes(IK_SERVER_ACCEPT))).toEqual({
      kind: "error",
      reason: "bad_record",
    });
    expect(decodeE2eeClientHello(new Uint8Array(0))).toEqual({
      kind: "error",
      reason: "bad_record",
    });
    // A well-framed record whose body is not the 7-element array.
    const short = Uint8Array.from([
      E2EE_NEGOTIATION_DISCRIMINATOR,
      E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
      0x81,
      0x01,
    ]);
    expect(decodeE2eeClientHello(short)).toEqual({ kind: "error", reason: "malformed_body" });
  });
});

// ─── §8.7 accept, TBS, and confirmation ──────────────────────────────────────

describe("§8.7 E2EEServerAccept, ServerAcceptTBS, and confirmation", () => {
  it("pins the IK TBS, confirmation transcript, accept, and session binding", () => {
    const hello = expectHello(makeClient("native"));
    const accept = expectAccept(makeNode(), hello.record);
    expect(hex(accept.serverAcceptTbs)).toBe(IK_SERVER_ACCEPT_TBS);
    expect(hex(accept.confirmationTranscript)).toBe(IK_CONFIRMATION_TRANSCRIPT);
    expect(hex(accept.record)).toBe(IK_SERVER_ACCEPT);
    expect(hex(accept.sessionBindingHash)).toBe(IK_SESSION_BINDING_HASH);
  });

  it("pins the NX TBS, confirmation transcript, accept, and session binding", () => {
    const hello = expectHello(makeClient("web"));
    const accept = expectAccept(makeNode(), hello.record);
    expect(hex(accept.serverAcceptTbs)).toBe(NX_SERVER_ACCEPT_TBS);
    expect(hex(accept.confirmationTranscript)).toBe(NX_CONFIRMATION_TRANSCRIPT);
    expect(hex(accept.record)).toBe(NX_SERVER_ACCEPT);
    expect(hex(accept.sessionBindingHash)).toBe(NX_SESSION_BINDING_HASH);
  });

  it("builds the TBS with the confirmation field absent", () => {
    const accept = decodeE2eeServerAccept(bytes(IK_SERVER_ACCEPT));
    if (accept.kind !== "ok") throw new Error("expected a decodable accept");
    const tbs = encodeE2eeServerAcceptTbs({
      acceptedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      nodePrekeyId: accept.value.nodePrekeyId,
      contextCommitment: accept.value.contextCommitment,
      noiseMessage2: accept.value.noiseMessage2,
    });
    expect(hex(tbs)).toBe(IK_SERVER_ACCEPT_TBS);
    // Both are negotiation records of type `0x02`; the bodies are a 4-element
    // and a 5-element array, and the final record is the TBS body plus field 4.
    expect(tbs[1]).toBe(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT);
    expect(tbs[2]).toBe(0x84);
    expect(bytes(IK_SERVER_ACCEPT)[2]).toBe(0x85);
    expect(IK_SERVER_ACCEPT.slice(6)).toBe(
      IK_SERVER_ACCEPT_TBS.slice(6) + "5820" + hex(accept.value.serverConfirmation),
    );
  });

  it("never lets the confirmation MAC cover itself", () => {
    const accept = decodeE2eeServerAccept(bytes(IK_SERVER_ACCEPT));
    if (accept.kind !== "ok") throw new Error("expected a decodable accept");
    const overTbs = e2eeConfirmationTranscript({
      clientHelloWireBytes: bytes(IK_HELLO),
      serverAcceptTbsWireBytes: bytes(IK_SERVER_ACCEPT_TBS),
      contextBlock: bytes(IK_CONTEXT),
    });
    const overFinal = e2eeConfirmationTranscript({
      clientHelloWireBytes: bytes(IK_HELLO),
      serverAcceptTbsWireBytes: bytes(IK_SERVER_ACCEPT),
      contextBlock: bytes(IK_CONTEXT),
    });
    expect(hex(overTbs)).toBe(IK_CONFIRMATION_TRANSCRIPT);
    expect(hex(overFinal)).not.toBe(IK_CONFIRMATION_TRANSCRIPT);
    // The confirmation covers the TBS; the session binding covers the finished
    // record — no self-reference cycle, and the two are different transcripts.
    expect(hex(overTbs)).not.toBe(IK_SESSION_BINDING_HASH);
    expect(
      hex(
        e2eeServerConfirmation(
          bytes(IK_SERVER_CONFIRMATION_KEY),
          bytes(IK_CONFIRMATION_TRANSCRIPT),
        ),
      ),
    ).toBe(hex(accept.value.serverConfirmation));
  });

  it("hashes the exact wire bytes and the nested context array", () => {
    // §8.7: the context block is embedded as the nested canonical array itself,
    // not as a byte string, so the transcript preimage contains the block's own
    // head byte (`0x92`, an 18-element array) rather than a `bstr` head.
    const preimage = hex(bytes(IK_CONTEXT));
    expect(preimage.startsWith("92")).toBe(true);
    expect(hex(sha256(bytes(IK_CONTEXT)))).toBe(IK_CONTEXT_COMMITMENT);
    const domains = [E2EE_CONFIRMATION_DOMAIN, E2EE_SESSION_BINDING_DOMAIN];
    expect(domains).toEqual(["ryco.relay-e2ee.confirmation.v1", "ryco.relay-e2ee.session.v1"]);
    // A one-byte change anywhere in the hello wire bytes changes both.
    const tamperedHello = flipByte(bytes(IK_HELLO), 3);
    expect(
      hex(
        e2eeConfirmationTranscript({
          clientHelloWireBytes: tamperedHello,
          serverAcceptTbsWireBytes: bytes(IK_SERVER_ACCEPT_TBS),
          contextBlock: bytes(IK_CONTEXT),
        }),
      ),
    ).not.toBe(IK_CONFIRMATION_TRANSCRIPT);
    expect(
      hex(
        e2eeSessionBindingHash({
          clientHelloWireBytes: tamperedHello,
          serverAcceptWireBytes: bytes(IK_SERVER_ACCEPT),
          contextBlock: bytes(IK_CONTEXT),
        }),
      ),
    ).not.toBe(IK_SESSION_BINDING_HASH);
  });

  it("carries the node-received authority and the prekey binding in message 2", () => {
    const hello = expectHello(makeClient("native"));
    const node = makeNode();
    const accept = expectAccept(node, hello.record);
    const client = new E2eeNoiseHandshake({
      pattern: E2EE_NOISE_PATTERN_IK,
      role: "initiator",
      prologue: bytes(IK_PROLOGUE),
      staticSecretKey: CLIENT_AGREEMENT_SECRET,
      remoteStaticPublicKey: NODE_AGREEMENT_PUBLIC,
      testOnlyEphemeralSecretKey: bytes(CLIENT_EPHEMERAL_SECRET),
    });
    client.writeMessage(
      encodeE2eeIkHelloPayload({
        clientPrekeyTranscript: CLIENT_PREKEY_TRANSCRIPT,
        clientPrekeySignature: CLIENT_PREKEY_SIGNATURE,
        accountId: ACCOUNT_ID,
        intendedCapability: "ryco.rpc",
        intendedRole: "operator",
      }),
    );
    const decoded = decodeE2eeServerAccept(accept.record);
    if (decoded.kind !== "ok") throw new Error("expected a decodable accept");
    const payload = client.readMessage(decoded.value.noiseMessage2);
    expect(decodeE2eeServerAcceptPayload(payload)).toEqual({
      kind: "ok",
      value: {
        channelOpenCapability: "ryco.rpc",
        channelOpenEffectiveRole: "operator",
        nodeAgreementKeyFingerprint: NODE_AGREEMENT_FINGERPRINT,
      },
    });
    expect(payload[0]).toBe(0x83);
  });

  it("enforces the accept bound and shape at decode", () => {
    const oversized = new Uint8Array(E2EE_SERVER_ACCEPT_MAX_BYTES + 1);
    oversized[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
    oversized[1] = E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT;
    expect(decodeE2eeServerAccept(oversized)).toEqual({ kind: "error", reason: "bad_record" });
    expect(decodeE2eeServerAccept(bytes(IK_HELLO))).toEqual({
      kind: "error",
      reason: "bad_record",
    });
    expect(() =>
      encodeE2eeServerAccept({
        acceptedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        nodePrekeyId: PREKEY_ID,
        contextCommitment: bytes(IK_CONTEXT_COMMITMENT),
        noiseMessage2: bytes("aabb"),
        serverConfirmation: new Uint8Array(31),
      }),
    ).toThrow(RelayE2eeValidationError);
    expect(E2EE_SERVER_ACCEPT_MAX_BYTES).toBe(8_192);
    expect(E2EE_CONFIRMATION_BYTES).toBe(32);
  });
});

// ─── full handshakes ─────────────────────────────────────────────────────────

describe("§8 full handshakes between two in-process endpoints", () => {
  const expectAgreement = (
    accept: ReturnType<typeof expectAccept>,
    established: ReturnType<typeof expectEstablished>,
    golden: {
      readonly c2n: string;
      readonly n2c: string;
      readonly exporter: string;
      readonly confirmationKey: string;
      readonly binding: string;
    },
  ): void => {
    expect(hex(established.sessionBindingHash)).toBe(golden.binding);
    expect(hex(accept.sessionBindingHash)).toBe(golden.binding);
    expect(established.sessionBindingHash.byteLength).toBe(E2EE_SESSION_BINDING_HASH_BYTES);
    for (const secrets of [accept.secrets, established.secrets]) {
      expect(hex(secrets.epochSecretC2N)).toBe(golden.c2n);
      expect(hex(secrets.epochSecretN2C)).toBe(golden.n2c);
      expect(hex(secrets.exporterSecret)).toBe(golden.exporter);
      expect(hex(secrets.serverConfirmationKey)).toBe(golden.confirmationKey);
    }
  };

  it("completes the IK handshake with both ends on identical keys", async () => {
    const { accept, established, node } = runHandshake("native");
    expectAgreement(accept, established, {
      c2n: IK_EPOCH_SECRET_C2N,
      n2c: IK_EPOCH_SECRET_N2C,
      exporter: IK_EXPORTER_SECRET,
      confirmationKey: IK_SERVER_CONFIRMATION_KEY,
      binding: IK_SESSION_BINDING_HASH,
    });
    expect(accept.tier).toBe("native");
    expect(node.tier).toBe("native");

    // The keys agree in the only way that matters: a record protected by one
    // end authenticates at the other, under the §8.8 binding in the AAD.
    const clientSession = new E2eeRecordSession({
      secrets: established.secrets,
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      sessionBindingHash: established.sessionBindingHash,
      sendDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
      plaintextCeiling: 1_024,
    });
    const nodeSession = new E2eeRecordSession({
      secrets: accept.secrets,
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      sessionBindingHash: accept.sessionBindingHash,
      sendDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
      plaintextCeiling: 1_024,
    });
    let envelope: Uint8Array | undefined;
    const sent = await clientSession.protect({
      innerType: E2EE_INNER_TYPE_RPC,
      body: utf8ToBytes("ping"),
      admit: () => true,
      transmit: (record) => {
        envelope = record;
        return { kind: "sent" };
      },
    });
    expect(sent.kind).toBe("protected");
    const received = nodeSession.unprotect(envelope!);
    expect(received.kind === "authenticated" && Buffer.from(received.body).toString()).toBe("ping");
    const back = await nodeSession.protect({
      innerType: E2EE_INNER_TYPE_RPC,
      body: utf8ToBytes("pong"),
      admit: () => true,
      transmit: (record) => {
        envelope = record;
        return { kind: "sent" };
      },
    });
    expect(back.kind).toBe("protected");
    const returned = clientSession.unprotect(envelope!);
    expect(returned.kind === "authenticated" && Buffer.from(returned.body).toString()).toBe("pong");
    clientSession.erase();
    nodeSession.erase();
  });

  it("completes the NX handshake with both ends on identical keys", () => {
    const { accept, established, node } = runHandshake("web");
    expectAgreement(accept, established, {
      c2n: NX_EPOCH_SECRET_C2N,
      n2c: NX_EPOCH_SECRET_N2C,
      exporter: NX_EXPORTER_SECRET,
      confirmationKey: NX_SERVER_CONFIRMATION_KEY,
      binding: NX_SESSION_BINDING_HASH,
    });
    expect(accept.tier).toBe("web");
    expect(node.tier).toBe("web");
    // NX carries no Branch A record, so no admitted-authority snapshot exists.
    expect(accept.admittedAuthority).toBeUndefined();
    expect(node.admittedAuthority).toBeUndefined();
  });

  it("gives the two tiers different sessions over identical channel state", () => {
    expect(IK_SESSION_BINDING_HASH).not.toBe(NX_SESSION_BINDING_HASH);
    expect(IK_CONTEXT_COMMITMENT).not.toBe(NX_CONTEXT_COMMITMENT);
    // Elements 10 and 16 are the only tier-dependent context elements: the IK
    // block carries the account id and the two client fingerprints, the NX
    // block the empty string and the empty array.
    const ik = decodeCanonicalE2eeCbor(bytes(IK_CONTEXT));
    const nx = decodeCanonicalE2eeCbor(bytes(NX_CONTEXT));
    if (
      !Array.isArray(ik.kind === "ok" && ik.value) ||
      !Array.isArray(nx.kind === "ok" && nx.value)
    ) {
      throw new Error("expected two decodable context blocks");
    }
    const ikElements = (ik as { value: readonly unknown[] }).value;
    const nxElements = (nx as { value: readonly unknown[] }).value;
    expect(ikElements.length).toBe(18);
    expect(nxElements.length).toBe(18);
    expect(ikElements[10]).toBe(ACCOUNT_ID);
    expect(ikElements[16]).toEqual([CLIENT_IDENTITY_FINGERPRINT, CLIENT_AGREEMENT_FINGERPRINT]);
    expect(nxElements[10]).toBe("");
    expect(nxElements[16]).toEqual([]);
    // Element 17 is nonempty on BOTH tiers: it has no absence form.
    expect(ikElements[17]).toBe(CONTINUITY_ID);
    expect(nxElements[17]).toBe(CONTINUITY_ID);
  });

  it("records the IK admitted-authority snapshot and nothing else", () => {
    const { accept, node } = runHandshake("native");
    const expected: E2eeAdmittedAuthoritySnapshot = {
      hubOrigin: HUB_ORIGIN,
      accountId: ACCOUNT_ID,
      clientIdentityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
      status: "approved",
      maxRole: "owner",
      capabilitySet: ["ryco.rpc"],
    };
    expect(accept.admittedAuthority).toEqual(expected);
    expect(node.admittedAuthority).toEqual(expected);
    expect(Object.keys(accept.admittedAuthority!).toSorted()).toEqual([
      "accountId",
      "capabilitySet",
      "clientIdentityFingerprint",
      "hubOrigin",
      "maxRole",
      "status",
    ]);
  });
});

// ─── §8.6 responder processing ───────────────────────────────────────────────

describe("§8.6 responder processing", () => {
  it("applies the §15 pre-authentication bounds before any crypto", () => {
    const hello = expectHello(makeClient("native"));
    let policyRead = false;
    const node = new E2eeNodeHandshake({
      channel: channel(),
      advertised: advertised(),
      advertisedVersionMin: 1,
      advertisedVersionMax: 1,
      agreementSecretKey: NODE_AGREEMENT_SECRET,
      advertisementEmittedAt: NOW,
      readPolicy: () => {
        policyRead = true;
        return { requireApprovedClientE2EE: false, suiteRegistry: [1] };
      },
      admitAttempt: () => false,
      testOnlyEphemeralSecretKey: bytes(NODE_EPHEMERAL_SECRET),
    });
    expect(node.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P8",
      reason: "attempt_not_admitted",
    });
    expect(policyRead).toBe(false);
  });

  it("refuses a hello outside the advertised protocol range (step 2)", () => {
    const hello = expectHello(makeClient("native"));
    expect(
      makeNode({ advertisedVersionMin: 2, advertisedVersionMax: 3 }).receiveHello(
        hello.record,
        NOW,
      ),
    ).toEqual({ kind: "fatal", row: "P9", reason: "wrapper" });
  });

  it("refuses a suite outside the node's committed registry or the offered list (step 2)", () => {
    const hello = expectHello(makeClient("native"));
    expect(
      makeNode({ policy: { requireApprovedClientE2EE: false, suiteRegistry: [2] } }).receiveHello(
        hello.record,
        NOW,
      ),
    ).toEqual({ kind: "fatal", row: "P9", reason: "wrapper" });
    // The offered list is checked against the selection as well: a hello whose
    // `offeredSuites` omits its own `selectedSuite` cannot be built by this
    // module, so the check is made on the decoded wrapper.
    const decoded = decodeE2eeClientHello(hello.record);
    expect(decoded.kind === "ok" && decoded.value.offeredSuites).toEqual([1]);
  });

  it("reads the node's committed policy, never the advertised snapshot (step 2, §12.6)", () => {
    // Under `requireApprovedClientE2EE` the effective admitted pattern set is
    // exactly ["IK"], so an NX hello is refused at the tier check.
    const hello = expectHello(makeClient("web"));
    expect(
      makeNode({
        policy: { requireApprovedClientE2EE: true, suiteRegistry: [1] },
      }).receiveHello(hello.record, NOW),
    ).toEqual({ kind: "fatal", row: "P9", reason: "wrapper" });
    // The same node still admits the native tier.
    const native = expectHello(makeClient("native"));
    expect(
      makeNode({ policy: { requireApprovedClientE2EE: true, suiteRegistry: [1] } }).receiveHello(
        native.record,
        NOW,
      ).kind,
    ).toBe("accepted");
  });

  it("detects tier confusion in both directions (§8.4 note, §8.5)", () => {
    // An IK Noise message labelled `web`: the NX responder consumes 32 bytes as
    // the peer ephemeral and surfaces the rest as a nonempty message-1 payload.
    const ikLabelledWeb = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(nativeContext()),
      noiseTier: "native",
      wrapperTier: "web",
    });
    expect(makeNode().receiveHello(ikLabelledWeb, NOW)).toEqual({
      kind: "fatal",
      row: "P10",
      reason: "nx_payload_not_empty",
    });
    // An NX Noise message labelled `native`: the IK responder needs an
    // encrypted static the message does not carry.
    const nxLabelledNative = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(
        nativeContext({ client: { tier: "web" }, clientIntendedCapability: "ryco.rpc" }),
      ),
      noiseTier: "web",
      wrapperTier: "native",
    });
    expect(makeNode().receiveHello(nxLabelledNative, NOW)).toEqual({
      kind: "fatal",
      row: "P10",
      reason: "noise",
    });
  });

  it("rebuilds the context from its own channel.open and the authenticated claims (step 7)", () => {
    const mutations: readonly { readonly name: string; readonly context: Uint8Array }[] = [
      {
        name: "element 9 node-fingerprint substitution",
        context: encodeE2eeAuthorizationContext(
          nativeContext({ nodeIdentityFingerprint: new Uint8Array(32).fill(9) }),
        ),
      },
      {
        name: "element 10 cross-account splice",
        context: encodeE2eeAuthorizationContext(
          nativeContext({
            client: {
              tier: "native",
              accountId: OTHER_ACCOUNT_ID,
              identityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
              agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
            },
          }),
        ),
      },
      {
        name: "element 15 agreement-fingerprint substitution",
        context: encodeE2eeAuthorizationContext(
          nativeContext({ nodeAgreementFingerprint: new Uint8Array(32).fill(7) }),
        ),
      },
      {
        name: "element 16 client-fingerprint substitution",
        context: encodeE2eeAuthorizationContext(
          nativeContext({
            client: {
              tier: "native",
              accountId: ACCOUNT_ID,
              identityFingerprint: new Uint8Array(32).fill(5),
              agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
            },
          }),
        ),
      },
      {
        name: "element 17 continuity-id substitution (never-rotated node)",
        context: encodeE2eeAuthorizationContext(
          nativeContext({ nodeContinuityId: OTHER_CONTINUITY_ID }),
        ),
      },
    ];
    for (const mutation of mutations) {
      expect({
        name: mutation.name,
        result: makeNode().receiveHello(craftHello({ contextBlock: mutation.context }), NOW),
      }).toEqual({
        name: mutation.name,
        result: { kind: "fatal", row: "P13", reason: "context_mismatch" },
      });
    }
  });

  it("binds element 17 even for a node that never rotated", () => {
    // The base fixture's node carries an EMPTY continuity chain, so element 15
    // contributes no chain digest and element 17 is the only place the
    // continuity id is bound. Element 15 is the agreement fingerprint alone.
    expect(IK_CONTEXT).toContain(hex(NODE_AGREEMENT_FINGERPRINT));
    expect(IK_CONTEXT).toContain(hex(utf8ToBytes(CONTINUITY_ID)));
    const withOtherId = expectHello(
      makeClient("native", { advertised: advertised({ continuityId: OTHER_CONTINUITY_ID }) }),
    );
    expect(hex(withOtherId.contextCommitment)).not.toBe(IK_CONTEXT_COMMITMENT);
  });

  it("treats a role reduction and a role escalation alike as a context mismatch", () => {
    for (const role of ["viewer", "owner"]) {
      const record = craftHello({
        contextBlock: encodeE2eeAuthorizationContext(nativeContext({ clientIntendedRole: role })),
        claims: { intendedRole: role },
      });
      expect(makeNode().receiveHello(record, NOW)).toEqual({
        kind: "fatal",
        row: "P13",
        reason: "context_mismatch",
      });
    }
    // …and a capability the channel.open did not grant.
    const capability = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(
        nativeContext({ clientIntendedCapability: "ryco.rpc", channelOpenCapability: "ryco.rpc" }),
      ),
      claims: { intendedCapability: "ryco.rpc" },
    });
    expect(
      makeNode({ channel: channel({ channelOpenEffectiveRole: "viewer" }) }).receiveHello(
        capability,
        NOW,
      ),
    ).toEqual({ kind: "fatal", row: "P13", reason: "context_mismatch" });
  });

  it("refuses NX absence-semantics violations (§8.3)", () => {
    const nonEmptyElement10 = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(
        nativeContext({
          client: {
            tier: "native",
            accountId: ACCOUNT_ID,
            identityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
            agreementFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
          },
        }),
      ),
      noiseTier: "web",
    });
    expect(makeNode().receiveHello(nonEmptyElement10, NOW)).toEqual({
      kind: "fatal",
      row: "P13",
      reason: "context_mismatch",
    });
  });

  it("refuses a commitment computed over different bytes than the block (§11.2 P13)", () => {
    const record = craftHello({
      contextBlock: encodeE2eeAuthorizationContext(nativeContext()),
      commitment: bytes(NX_CONTEXT_COMMITMENT),
    });
    expect(makeNode().receiveHello(record, NOW)).toEqual({
      kind: "fatal",
      row: "P13",
      reason: "context_mismatch",
    });
  });

  it("enforces the §8.6 step 5 IK bindings", () => {
    const cases: readonly {
      readonly name: string;
      readonly claims: Partial<E2eeIkHelloPayload>;
    }[] = [
      {
        name: "a certificate for another Hub origin",
        claims: (() => {
          const transcript = clientPrekeyTranscript({ hubOrigin: OTHER_HUB_ORIGIN });
          return {
            clientPrekeyTranscript: transcript,
            clientPrekeySignature: signClientPrekey(transcript),
          };
        })(),
      },
      {
        name: "a certificate whose agreement key is not the Noise static",
        claims: (() => {
          const transcript = clientPrekeyTranscript({
            agreementPublicKey: NODE_AGREEMENT_PUBLIC,
          });
          return {
            clientPrekeyTranscript: transcript,
            clientPrekeySignature: signClientPrekey(transcript),
          };
        })(),
      },
      {
        name: "an account claim disagreeing with the certificate",
        claims: { accountId: OTHER_ACCOUNT_ID },
      },
      {
        name: "a signature over other bytes",
        claims: {
          clientPrekeySignature: signClientPrekey(clientPrekeyTranscript({ createdAt: 1 })),
        },
      },
    ];
    for (const testCase of cases) {
      const record = craftHello({
        contextBlock: encodeE2eeAuthorizationContext(nativeContext()),
        claims: testCase.claims,
      });
      expect({ name: testCase.name, result: makeNode().receiveHello(record, NOW) }).toEqual({
        name: testCase.name,
        result: { kind: "fatal", row: "P11", reason: "client_binding" },
      });
    }
  });

  it("evaluates certificate validity at handshake time with the clock skew (§6.4)", () => {
    const verification = {
      transcript: CLIENT_PREKEY_TRANSCRIPT,
      signature: CLIENT_PREKEY_SIGNATURE,
      hubOrigin: HUB_ORIGIN,
      suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    } as const;
    expect(verifyE2eeClientPrekeyCertificate({ ...verification, now: NOW }).kind).toBe("ok");
    // Exactly at the skew boundary on each side, then one millisecond past it.
    expect(
      verifyE2eeClientPrekeyCertificate({ ...verification, now: EXPIRES_AT + 300_000 }).kind,
    ).toBe("ok");
    expect(
      verifyE2eeClientPrekeyCertificate({ ...verification, now: EXPIRES_AT + 300_001 }),
    ).toEqual({ kind: "error", failure: "expired" });
    expect(
      verifyE2eeClientPrekeyCertificate({ ...verification, now: CREATED_AT - 300_000 }).kind,
    ).toBe("ok");
    expect(
      verifyE2eeClientPrekeyCertificate({ ...verification, now: CREATED_AT - 300_001 }),
    ).toEqual({ kind: "error", failure: "expired" });
    // A lifetime over `E2EE_PREKEY_LIFETIME` is refused whatever the clock says.
    const overLong = clientPrekeyTranscript({ expiresAt: EXPIRES_AT + 1 });
    expect(
      verifyE2eeClientPrekeyCertificate({
        ...verification,
        transcript: overLong,
        signature: signClientPrekey(overLong),
        now: NOW,
      }),
    ).toEqual({ kind: "error", failure: "expired" });
    expect(
      verifyE2eeClientPrekeyCertificate({ ...verification, hubOrigin: OTHER_HUB_ORIGIN, now: NOW }),
    ).toEqual({ kind: "error", failure: "hub_origin_mismatch" });
    expect(
      verifyE2eeClientPrekeyCertificate({
        ...verification,
        signature: new Uint8Array(64),
        now: NOW,
      }),
    ).toEqual({ kind: "error", failure: "malformed" });
  });

  it("refuses a certificate whose bytes are not what the §7.4 encoder produces", () => {
    // Flip a byte of the carried identity fingerprint: §7.1 recomputes it, so
    // the re-encode no longer equals the received bytes.
    const tampered = flipByte(CLIENT_PREKEY_TRANSCRIPT, CLIENT_PREKEY_TRANSCRIPT.length - 40);
    expect(
      verifyE2eeClientPrekeyCertificate({
        transcript: tampered,
        signature: CLIENT_PREKEY_SIGNATURE,
        hubOrigin: HUB_ORIGIN,
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        now: NOW,
      }).kind,
    ).toBe("error");
  });

  it("enforces the §8.6 step 6 authorization, indistinguishably across causes", () => {
    const records: readonly (E2eeClientAuthorization | undefined)[] = [
      undefined,
      { status: "pending", maxRole: "owner", capabilitySet: ["ryco.rpc"] },
      { status: "revoked", maxRole: "owner", capabilitySet: ["ryco.rpc"] },
      { status: "approved", maxRole: "owner", capabilitySet: [] },
      { status: "approved", maxRole: "viewer", capabilitySet: ["ryco.rpc"] },
    ];
    for (const authorization of records) {
      const hello = expectHello(makeClient("native"));
      expect(makeNode({ authorization }).receiveHello(hello.record, NOW)).toEqual({
        kind: "fatal",
        row: "P12",
        reason: "authorization",
      });
    }
    // The ceiling is inclusive: `operator` under an `operator` ceiling passes.
    const hello = expectHello(makeClient("native"));
    expect(
      makeNode({
        authorization: { status: "approved", maxRole: "operator", capabilitySet: ["ryco.rpc"] },
      }).receiveHello(hello.record, NOW).kind,
    ).toBe("accepted");
  });

  it("aborts in flight when a policy or authorization withdrawal lands at row N3", () => {
    const policyHello = expectHello(makeClient("native"));
    expect(
      makeNode({
        enterE2eeMode: () => ({ kind: "refused", reason: "policy_withdrawn" }),
      }).receiveHello(policyHello.record, NOW),
    ).toEqual({ kind: "fatal", row: "P25", reason: "policy_withdrawn" });
    const authorizationHello = expectHello(makeClient("native"));
    expect(
      makeNode({
        enterE2eeMode: () => ({ kind: "refused", reason: "authorization_withdrawn" }),
      }).receiveHello(authorizationHello.record, NOW),
    ).toEqual({ kind: "fatal", row: "P12", reason: "authorization_withdrawn" });
  });

  it("spends the handshake when the step-7 context build throws (§8.1)", () => {
    const hello = expectHello(makeClient("native"));
    // The node's OWN advertised material — §8.3 element 17 — rejected by the
    // context encoder. Nothing before step 7 reads it, so this is a throw out of
    // the step-7 build and not a peer-input failure with a §11.2 row.
    const ephemeral = bytes(NODE_EPHEMERAL_SECRET);
    const node = makeNode({
      advertised: advertised({ continuityId: "not-a-continuity-id" }),
      testOnlyEphemeralSecretKey: ephemeral,
    });
    expect(() => node.receiveHello(hello.record, NOW)).toThrow(RelayE2eeValidationError);
    expect(node.state).toBe("failed");
    // §11.2's procedure: the partial handshake state is erased. The injected
    // ephemeral IS the Noise object's own buffer, so its zeroing is `destroy()`
    // observed from outside.
    expect(hex(ephemeral)).toBe("00".repeat(32));
    // §8.1: exactly one attempt per channel, a local failure included — an
    // object left in `awaiting_hello` would admit a second.
    expect(node.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
  });

  it("spends the handshake when the record build after step 8 throws (§8.1)", () => {
    const hello = expectHello(makeClient("native"));
    // An advertised prekey id the §8.7 `ServerAcceptTBS` encoder refuses. It is
    // read for the first time AFTER `Split()`, so the throw lands in the stretch
    // that follows the step-8 Noise try block — with the §6.5 secrets already
    // derived, which is why that stretch erases them before propagating.
    const node = makeNode({ advertised: advertised({ prekeyId: "" }) });
    expect(() => node.receiveHello(hello.record, NOW)).toThrow(RelayE2eeValidationError);
    expect(node.state).toBe("failed");
    expect(node.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
    // The channel never reached `e2ee`, so §8.9's gates stay shut.
    expect(node.mayEmitApplicationRpc).toBe(false);
    expect(node.mayInvokeRpcHandler).toBe(false);
  });

  it("spends the handshake when a pre-Noise callback or encoder throws (§8.1)", () => {
    // §8.6 step 1 and step 2 read caller callbacks, and the step-3 prologue
    // encoder reads this node's own channel material. All three run before any
    // Noise state exists — and all three would otherwise leave the object in
    // `awaiting_hello`, which is a second attempt on one channel.
    const hello = expectHello(makeClient("native"));
    const throwing = new Error("policy store unavailable");
    for (const overrides of [
      {
        admitAttempt: () => {
          throw throwing;
        },
      },
      {
        readPolicy: (): E2eeNodeAdmissionPolicy => {
          throw throwing;
        },
      },
      { channel: channel({ hubOrigin: "not-an-origin" }) },
    ] as const) {
      const node = makeNode(overrides);
      expect(() => node.receiveHello(hello.record, NOW)).toThrow();
      expect(node.state).toBe("failed");
      expect(node.receiveHello(hello.record, NOW)).toEqual({
        kind: "fatal",
        row: "P4",
        reason: "handshake_spent",
      });
    }
  });

  it("spends the handshake when the step-6 authorization read throws (§8.1)", () => {
    // The §8.6 step-6 read is a caller callback and it runs with a LIVE Noise
    // handshake — message 1 has been read — so a throw out of it is the case the
    // funnel exists for: the object must not stay in `awaiting_hello` holding
    // that state.
    const hello = expectHello(makeClient("native"));
    const ephemeral = bytes(NODE_EPHEMERAL_SECRET);
    const node = makeNode({
      testOnlyEphemeralSecretKey: ephemeral,
      lookupClientAuthorization: () => {
        throw new Error("authorization store unavailable");
      },
    });
    expect(() => node.receiveHello(hello.record, NOW)).toThrow("authorization store unavailable");
    expect(node.state).toBe("failed");
    // §11.2: the partial handshake state is erased. The injected ephemeral is
    // the Noise object's own buffer, so its zeroing is `destroy()` observed
    // from outside.
    expect(hex(ephemeral)).toBe("00".repeat(32));
    expect(node.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
  });

  it("spends the handshake when a stored maxRole is outside the §8.3 ordering (§8.1)", () => {
    // Not a callback failure but a stored value: §8.6 step 6 ranks the record's
    // ceiling through the §8.3 ordering, which throws rather than silently
    // ranking a literal it does not cover — again with a live Noise handshake.
    const hello = expectHello(makeClient("native"));
    const ephemeral = bytes(NODE_EPHEMERAL_SECRET);
    const node = makeNode({
      testOnlyEphemeralSecretKey: ephemeral,
      authorization: { status: "approved", maxRole: "admin", capabilitySet: ["ryco.rpc"] },
    });
    expect(() => node.receiveHello(hello.record, NOW)).toThrow(RelayE2eeValidationError);
    expect(node.state).toBe("failed");
    expect(hex(ephemeral)).toBe("00".repeat(32));
    expect(node.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
  });

  it("spends the handshake when the row-N3 transition callback throws (§8.1)", () => {
    const hello = expectHello(makeClient("native"));
    // The step-8 transition is a caller hook, so its throw is neither a §11.2
    // row nor this module's own mistake — and it lands between the two encoder
    // stretches, which is why one funnel covers the whole of steps 7 and 8.
    const node = makeNode({
      enterE2eeMode: () => {
        throw new Error("policy store unavailable");
      },
    });
    expect(() => node.receiveHello(hello.record, NOW)).toThrow("policy store unavailable");
    expect(node.state).toBe("failed");
    expect(node.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
  });

  it("admits exactly one hello per channel and refuses a replay", () => {
    const hello = expectHello(makeClient("native"));
    const node = makeNode();
    expect(node.receiveHello(hello.record, NOW).kind).toBe("accepted");
    // The same hello again, on the same channel: one attempt per channel.
    expect(node.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
    // A second hello after a failure is equally refused.
    const failed = makeNode({ authorization: undefined });
    expect(failed.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P12",
      reason: "authorization",
    });
    expect(failed.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
  });

  it("fails a hello replayed onto another channel (§8.4 channel uniqueness)", () => {
    const hello = expectHello(makeClient("native"));
    const other = makeNode({ channel: channel({ channelId: OTHER_CHANNEL_ID }) });
    // The prologue is channel-unique, so the recorded hello fails Noise
    // processing outright rather than reaching any authorization check.
    expect(other.receiveHello(hello.record, NOW)).toEqual({
      kind: "fatal",
      row: "P10",
      reason: "noise",
    });
  });

  it("refuses out-of-order and oversized records", () => {
    // An accept where a hello belongs.
    expect(makeNode().receiveHello(bytes(IK_SERVER_ACCEPT), NOW)).toEqual({
      kind: "fatal",
      row: "P3",
      reason: "record_bounds",
    });
    // An envelope-shaped payload where a negotiation record belongs.
    expect(makeNode().receiveHello(Uint8Array.from([0x01, 0x01, 0x01]), NOW)).toEqual({
      kind: "fatal",
      row: "P3",
      reason: "record_bounds",
    });
    const oversized = new Uint8Array(E2EE_CLIENT_HELLO_MAX_BYTES + 1);
    oversized[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
    oversized[1] = E2EE_NEGOTIATION_TYPE_CLIENT_HELLO;
    expect(makeNode().receiveHello(oversized, NOW)).toEqual({
      kind: "fatal",
      row: "P3",
      reason: "record_bounds",
    });
    // A well-framed hello whose body is not the §8.5 array is a wrapper failure.
    const malformed = Uint8Array.from([
      E2EE_NEGOTIATION_DISCRIMINATOR,
      E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
      0x80,
    ]);
    expect(makeNode().receiveHello(malformed, NOW)).toEqual({
      kind: "fatal",
      row: "P9",
      reason: "wrapper",
    });
  });
});

// ─── §8.5 client hello construction ──────────────────────────────────────────

describe("§8.5 client hello construction and its failure funnel", () => {
  it("spends the client handshake when the hello encoder throws after the Noise write (§8.1)", () => {
    // An offered-suite list that does not carry the selection: the §8.5 encoder
    // refuses it, and it is read for the FIRST time after `writeMessage` has
    // produced a live Noise handshake and consumed the ephemeral. Dropping that
    // handshake on the floor with the object still in `created` would leave the
    // channel able to run a second attempt, which §8.1 does not admit.
    const ephemeral = bytes(CLIENT_EPHEMERAL_SECRET);
    const client = makeClient("native", {
      offeredSuites: [2],
      testOnlyEphemeralSecretKey: ephemeral,
    });
    expect(() => client.createHello(NOW)).toThrow(RelayE2eeValidationError);
    expect(client.state).toBe("failed");
    // §11.2: the partial handshake state is erased. The injected ephemeral is
    // the Noise object's own buffer once `writeMessage` has taken it.
    expect(hex(ephemeral)).toBe("00".repeat(32));
    expect(client.createHello(NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
    expect(client.deadlineAt).toBeUndefined();
  });

  it("spends the client handshake when a pre-Noise encoder or guard throws (§8.1)", () => {
    // The §8.3 context encoder, on this client's own advertised material, and
    // the local agreement-key self-check — both before any Noise state exists,
    // and both leaving `created` re-enterable without the funnel.
    const contextClient = makeClient("native", {
      advertised: advertised({ continuityId: "not-a-continuity-id" }),
    });
    expect(() => contextClient.createHello(NOW)).toThrow(RelayE2eeValidationError);
    expect(contextClient.state).toBe("failed");
    expect(contextClient.createHello(NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });

    const mismatched = makeClient("native", {
      credentials: nativeCredentials({ agreementSecretKey: NODE_AGREEMENT_SECRET }),
    });
    expect(() => mismatched.createHello(NOW)).toThrow(TypeError);
    expect(mismatched.state).toBe("failed");
    expect(mismatched.createHello(NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
  });
});

// ─── §8.8 client verification ────────────────────────────────────────────────

describe("§8.8 client verification and session binding", () => {
  const acceptFor = (tier: E2eeTier = "native") => {
    const client = makeClient(tier);
    const hello = expectHello(client);
    const accept = expectAccept(makeNode(), hello.record);
    return { client, hello, accept };
  };

  it("refuses an accept before a hello was sent", () => {
    expect(makeClient("native").receiveServerAccept(bytes(IK_SERVER_ACCEPT), NOW)).toEqual({
      kind: "fatal",
      row: "P16",
      reason: "handshake_spent",
    });
  });

  it("refuses a substituted suite or prekey id (step 2)", () => {
    const { client, accept } = acceptFor();
    const decoded = decodeE2eeServerAccept(accept.record);
    if (decoded.kind !== "ok") throw new Error("expected a decodable accept");
    const substituted = encodeE2eeServerAccept({
      acceptedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      nodePrekeyId: "epk_ZZZZZZZZZZZZZZZZZZZZZZ",
      contextCommitment: decoded.value.contextCommitment,
      noiseMessage2: decoded.value.noiseMessage2,
      serverConfirmation: decoded.value.serverConfirmation,
    });
    expect(client.receiveServerAccept(substituted, NOW)).toEqual({
      kind: "fatal",
      row: "P16",
      reason: "accept_mismatch",
    });
  });

  it("refuses a commitment echo that is not its own (step 2)", () => {
    const { client, accept } = acceptFor();
    const decoded = decodeE2eeServerAccept(accept.record);
    if (decoded.kind !== "ok") throw new Error("expected a decodable accept");
    const substituted = encodeE2eeServerAccept({
      acceptedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      nodePrekeyId: PREKEY_ID,
      contextCommitment: bytes(NX_CONTEXT_COMMITMENT),
      noiseMessage2: decoded.value.noiseMessage2,
      serverConfirmation: decoded.value.serverConfirmation,
    });
    expect(client.receiveServerAccept(substituted, NOW)).toEqual({
      kind: "fatal",
      row: "P13",
      reason: "context_mismatch",
    });
  });

  it("refuses a mutated confirmation tag (step 5)", () => {
    const { client, accept } = acceptFor();
    const mutated = flipByte(accept.record, accept.record.byteLength - 1);
    expect(client.receiveServerAccept(mutated, NOW)).toEqual({
      kind: "fatal",
      row: "P16",
      reason: "confirmation_mismatch",
    });
  });

  it("detects a suite-list strip through the confirmation, not the context", () => {
    // §16.3 F16: `offeredSuites` mutated after the hello wire bytes were hashed.
    // The node re-derives everything from the bytes it received, so it accepts;
    // the client hashes the bytes it sent, so its confirmation check fails.
    const client = makeClient("native", { offeredSuites: [1, 2] });
    const hello = expectHello(client);
    const decoded = decodeE2eeClientHello(hello.record);
    if (decoded.kind !== "ok") throw new Error("expected a decodable hello");
    const stripped = encodeE2eeClientHello({
      tier: "native",
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: [1],
      clientNonce: decoded.value.clientNonce,
      contextCommitment: decoded.value.contextCommitment,
      noiseMessage1: decoded.value.noiseMessage1,
    });
    expect(hex(stripped)).not.toBe(hex(hello.record));
    const accept = expectAccept(makeNode(), stripped);
    expect(client.receiveServerAccept(accept.record, NOW)).toEqual({
      kind: "fatal",
      row: "P16",
      reason: "confirmation_mismatch",
    });
  });

  it("refuses an authority echo or prekey binding that is not its own (step 4)", () => {
    // A NON-CONFORMING responder: it runs the Noise handshake correctly and
    // computes a VALID confirmation over its own transcript, and only the
    // message-2 payload disagrees. This is the case §8.7 puts the echo there
    // for — a Hub presenting different authority to the two ends — and the
    // confirmation alone would not catch it, because the responder computed the
    // MAC over the context the client committed to.
    const echoes = [
      {
        name: "an authority echo the client never received",
        payload: {
          channelOpenCapability: "ryco.rpc",
          channelOpenEffectiveRole: "viewer",
          nodeAgreementKeyFingerprint: NODE_AGREEMENT_FINGERPRINT,
        },
      },
      {
        name: "a prekey binding that is not the advertised certificate's",
        payload: {
          channelOpenCapability: "ryco.rpc",
          channelOpenEffectiveRole: "operator",
          nodeAgreementKeyFingerprint: CLIENT_AGREEMENT_FINGERPRINT,
        },
      },
    ] as const;
    for (const echo of echoes) {
      const client = makeClient("native");
      const hello = expectHello(client);
      const decoded = decodeE2eeClientHello(hello.record);
      if (decoded.kind !== "ok") throw new Error("expected a decodable hello");
      const noise = new E2eeNoiseHandshake({
        pattern: E2EE_NOISE_PATTERN_IK,
        role: "responder",
        prologue: bytes(IK_PROLOGUE),
        staticSecretKey: NODE_AGREEMENT_SECRET,
        testOnlyEphemeralSecretKey: bytes(NODE_EPHEMERAL_SECRET),
      });
      noise.readMessage(decoded.value.noiseMessage1);
      const noiseMessage2 = noise.writeMessage(encodeE2eeServerAcceptPayload(echo.payload));
      const secrets = deriveE2eeSessionSecrets(noise);
      const tbsInput = {
        acceptedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        nodePrekeyId: PREKEY_ID,
        contextCommitment: hello.contextCommitment,
        noiseMessage2,
      } as const;
      const record = encodeE2eeServerAccept({
        ...tbsInput,
        serverConfirmation: e2eeServerConfirmation(
          secrets.serverConfirmationKey,
          e2eeConfirmationTranscript({
            clientHelloWireBytes: hello.record,
            serverAcceptTbsWireBytes: encodeE2eeServerAcceptTbs(tbsInput),
            contextBlock: hello.contextBlock,
          }),
        ),
      });
      expect({ name: echo.name, result: client.receiveServerAccept(record, NOW) }).toEqual({
        name: echo.name,
        result: { kind: "fatal", row: "P13", reason: "context_mismatch" },
      });
    }
  });

  it("refuses a message-2 payload that is not the §8.7 3-element array", () => {
    expect(decodeE2eeServerAcceptPayload(Uint8Array.from([0x82, 0x01, 0x02]))).toEqual({
      kind: "error",
      reason: "malformed_body",
    });
  });

  it("refuses a responder static that is not the advertised prekey (NX, §8.7)", () => {
    // The node runs the NX handshake with a static the client did not advertise.
    const client = makeClient("web");
    const hello = expectHello(client);
    const node = new E2eeNodeHandshake({
      channel: channel(),
      advertised: advertised(),
      advertisedVersionMin: 1,
      advertisedVersionMax: 1,
      // The prekey the node actually uses is the CLIENT's agreement key, while
      // the advertisement — and therefore the client's expectation — names the
      // node's own.
      agreementSecretKey: CLIENT_AGREEMENT_SECRET,
      advertisementEmittedAt: NOW,
      readPolicy: () => ({ requireApprovedClientE2EE: false, suiteRegistry: [1] }),
      testOnlyEphemeralSecretKey: bytes(NODE_EPHEMERAL_SECRET),
    });
    const accept = node.receiveHello(hello.record, NOW);
    if (accept.kind !== "accepted") throw new Error("expected the node to accept");
    expect(client.receiveServerAccept(accept.record, NOW)).toEqual({
      kind: "fatal",
      row: "P16",
      reason: "accept_mismatch",
    });
  });

  it("refuses an out-of-order or oversized accept", () => {
    const { client } = acceptFor();
    const oversized = new Uint8Array(E2EE_SERVER_ACCEPT_MAX_BYTES + 1);
    oversized[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
    oversized[1] = E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT;
    expect(client.receiveServerAccept(oversized, NOW)).toEqual({
      kind: "fatal",
      row: "P3",
      reason: "record_bounds",
    });
    // The handshake is spent by that failure; a valid accept no longer lands.
    expect(client.receiveServerAccept(bytes(IK_SERVER_ACCEPT), NOW).kind).toBe("fatal");
  });

  it("refuses a second hello on the same client (one attempt per channel)", () => {
    const client = makeClient("native");
    expect(client.createHello(NOW).kind).toBe("hello");
    expect(client.createHello(NOW)).toEqual({
      kind: "fatal",
      row: "P4",
      reason: "handshake_spent",
    });
  });

  it("refuses to build a hello whose intent differs from its channel.open (§8.3)", () => {
    expect(makeClient("native", { intendedRole: "viewer" }).createHello(NOW)).toEqual({
      kind: "fatal",
      row: "P13",
      reason: "context_mismatch",
    });
  });
});

// ─── §8.9 implicit client finish ─────────────────────────────────────────────

describe("§8.9 implicit client finish", () => {
  it("emits no RPC and invokes no handler before the first envelope authenticates", () => {
    const { node } = runHandshake("native");
    expect(node.state).toBe("e2ee");
    expect(node.mayInvokeRpcHandler).toBe(false);
    expect(node.mayEmitApplicationRpc).toBe(false);
    expect(node.authenticateImplicitFinish({ now: NOW })).toEqual({ kind: "finished" });
    expect(node.mayInvokeRpcHandler).toBe(true);
    expect(node.mayEmitApplicationRpc).toBe(true);
    expect(node.state).toBe("finished");
  });

  it("arms the deadline unconditionally and expires as Q8", () => {
    const { node, accept } = runHandshake("native");
    expect(accept.implicitFinishDeadlineAt).toBe(NOW + T_HANDSHAKE_NODE);
    expect(node.deadlineExpired(NOW + T_HANDSHAKE_NODE)).toBe(false);
    expect(node.deadlineExpired(NOW + T_HANDSHAKE_NODE + 1)).toBe(true);
    expect(node.authenticateImplicitFinish({ now: NOW + T_HANDSHAKE_NODE + 1 })).toEqual({
      kind: "fatal",
      row: "Q8",
      errorCode: "protocol_violation",
      reason: "implicit_finish_deadline",
    });
    expect(node.mayInvokeRpcHandler).toBe(false);
    // The deadline stops running once the finish authenticates.
    const { node: finished } = runHandshake("native");
    expect(finished.authenticateImplicitFinish({ now: NOW }).kind).toBe("finished");
    expect(finished.deadlineExpired(NOW + T_HANDSHAKE_NODE + 1)).toBe(false);
  });

  it("re-checks the Branch A record against the snapshot before the first delivery", () => {
    const { node } = runHandshake("native");
    const snapshot = node.admittedAuthority!;
    let seen: unknown;
    expect(
      node.authenticateImplicitFinish({
        now: NOW,
        reReadAuthorization: (key) => {
          seen = key;
          // A demotion that leaves `status = approved`: a status-only re-check
          // would pass this channel the owner has just narrowed.
          return { status: "approved", maxRole: "viewer", capabilitySet: ["ryco.rpc"] };
        },
      }),
    ).toEqual({
      kind: "fatal",
      row: "Q9",
      errorCode: "policy",
      reason: "authorization_withdrawn",
    });
    // The re-read uses the FULL record key of the snapshot, never the
    // fingerprint alone.
    expect(seen).toEqual({
      hubOrigin: snapshot.hubOrigin,
      accountId: snapshot.accountId,
      clientIdentityFingerprint: snapshot.clientIdentityFingerprint,
    });
  });

  it("passes the re-check for an unchanged or widened record", () => {
    for (const record of [
      APPROVED,
      { status: "approved", maxRole: "owner", capabilitySet: ["ryco.rpc"] } as const,
    ]) {
      const { node } = runHandshake("native");
      expect(
        node.authenticateImplicitFinish({ now: NOW, reReadAuthorization: () => record }),
      ).toEqual({ kind: "finished" });
    }
  });

  it("has nothing to re-read on NX", () => {
    const { node } = runHandshake("web");
    let called = false;
    expect(
      node.authenticateImplicitFinish({
        now: NOW,
        reReadAuthorization: () => {
          called = true;
          return undefined;
        },
      }),
    ).toEqual({ kind: "finished" });
    expect(called).toBe(false);
  });

  it("refuses an implicit finish on a handshake that never established", () => {
    expect(() => makeNode().authenticateImplicitFinish({ now: NOW })).toThrow(TypeError);
  });

  it("spends the handshake when the §13.6 re-read throws or ranks an unknown role", () => {
    // This is the LAST re-check before a withdrawn authority could reach
    // application state, and it runs after the client's first envelope has
    // authenticated. A throw out of the caller's re-read — or out of the §8.3
    // ordering, on a stored `maxRole` the relay vocabulary does not admit — must
    // fail closed: leaving the object in `e2ee` would let the very next call
    // reach `finished` as though the check had passed.
    const cases = [
      (): E2eeClientAuthorization => {
        throw new Error("authorization store unavailable");
      },
      (): E2eeClientAuthorization => ({
        status: "approved",
        maxRole: "admin",
        capabilitySet: ["ryco.rpc"],
      }),
    ];
    for (const reReadAuthorization of cases) {
      const { node } = runHandshake("native");
      expect(() => node.authenticateImplicitFinish({ now: NOW, reReadAuthorization })).toThrow();
      expect(node.state).toBe("failed");
      expect(node.mayInvokeRpcHandler).toBe(false);
      expect(node.mayEmitApplicationRpc).toBe(false);
      // Spent: a retry cannot reach `finished` behind the failed re-check.
      expect(() => node.authenticateImplicitFinish({ now: NOW })).toThrow(TypeError);
    }
  });
});

// ─── §13.6 withdrawal test and §8.3 role ordering ────────────────────────────

describe("§13.6 withdrawal test and the §8.3 role ordering", () => {
  const snapshot: E2eeAdmittedAuthoritySnapshot = {
    hubOrigin: HUB_ORIGIN,
    accountId: ACCOUNT_ID,
    clientIdentityFingerprint: CLIENT_IDENTITY_FINGERPRINT,
    status: "approved",
    maxRole: "operator",
    capabilitySet: ["ryco.rpc"],
  };

  it("ranks the roles as viewer < operator < owner", () => {
    expect([e2eeRoleRank("viewer"), e2eeRoleRank("operator"), e2eeRoleRank("owner")]).toEqual([
      0, 1, 2,
    ]);
    expect(e2eeRoleWithinCeiling("viewer", "operator")).toBe(true);
    expect(e2eeRoleWithinCeiling("operator", "operator")).toBe(true);
    expect(e2eeRoleWithinCeiling("owner", "operator")).toBe(false);
    expect(() => e2eeRoleRank("admin")).toThrow(RelayE2eeValidationError);
  });

  it("classifies every withdrawal and every widening", () => {
    expect(e2eeAuthorizationWithdrawn(snapshot, undefined)).toBe(true);
    expect(e2eeAuthorizationWithdrawn(snapshot, { ...snapshot, status: "revoked" })).toBe(true);
    expect(e2eeAuthorizationWithdrawn(snapshot, { ...snapshot, maxRole: "viewer" })).toBe(true);
    expect(e2eeAuthorizationWithdrawn(snapshot, { ...snapshot, capabilitySet: [] })).toBe(true);
    // A widening is not a withdrawal.
    expect(e2eeAuthorizationWithdrawn(snapshot, { ...snapshot, maxRole: "owner" })).toBe(false);
    expect(e2eeAuthorizationWithdrawn(snapshot, { ...snapshot, capabilitySet: ["ryco.rpc"] })).toBe(
      false,
    );
    // A command that both narrows and widens IS a withdrawal: it contains a
    // reduction, and the reduction governs.
    expect(
      e2eeAuthorizationWithdrawn(
        { ...snapshot, maxRole: "owner" },
        { ...snapshot, maxRole: "operator", capabilitySet: ["ryco.rpc"] },
      ),
    ).toBe(true);
  });

  it("compares the full record key, never the fingerprint alone", () => {
    expect(e2eeAuthorizationKeysEqual(snapshot, snapshot)).toBe(true);
    expect(e2eeAuthorizationKeysEqual(snapshot, { ...snapshot, accountId: OTHER_ACCOUNT_ID })).toBe(
      false,
    );
    expect(e2eeAuthorizationKeysEqual(snapshot, { ...snapshot, hubOrigin: OTHER_HUB_ORIGIN })).toBe(
      false,
    );
    expect(
      e2eeAuthorizationKeysEqual(snapshot, {
        ...snapshot,
        clientIdentityFingerprint: new Uint8Array(32),
      }),
    ).toBe(false);
  });

  it("compares secret-dependent bytes in constant time", () => {
    expect(e2eeSecretBytesEqual(bytes("00ff"), bytes("00ff"))).toBe(true);
    expect(e2eeSecretBytesEqual(bytes("00ff"), bytes("00fe"))).toBe(false);
    expect(e2eeSecretBytesEqual(bytes("00ff"), bytes("00"))).toBe(false);
    expect(e2eeSecretBytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

// ─── §4.4 deadlines ──────────────────────────────────────────────────────────

describe("§4.4 handshake deadlines", () => {
  it("starts the client deadline at hello emit", () => {
    const client = makeClient("native");
    expect(client.deadlineAt).toBeUndefined();
    const hello = expectHello(client, 5_000);
    expect(hello.deadlineAt).toBe(5_000 + T_HANDSHAKE);
    expect(client.deadlineAt).toBe(5_000 + T_HANDSHAKE);
    expect(client.deadlineExpired(5_000 + T_HANDSHAKE)).toBe(false);
    expect(client.deadlineExpired(5_000 + T_HANDSHAKE + 1)).toBe(true);
    expect(e2eeClientHandshakeDeadline(5_000)).toBe(5_000 + T_HANDSHAKE);
    expect(T_HANDSHAKE).toBe(3_000);
  });

  it("refuses an accept that arrives past the client deadline", () => {
    const client = makeClient("native");
    const hello = expectHello(client);
    const accept = expectAccept(makeNode(), hello.record);
    expect(client.receiveServerAccept(accept.record, NOW + T_HANDSHAKE + 1)).toEqual({
      kind: "fatal",
      row: "P20",
      reason: "handshake_deadline",
    });
  });

  it("starts the node deadline at advertisement emit", () => {
    expect(e2eeNodeHandshakeDeadline(5_000)).toBe(5_000 + T_HANDSHAKE_NODE);
    expect(T_HANDSHAKE_NODE).toBe(10_000);
    const node = makeNode({ advertisementEmittedAt: 5_000 });
    expect(node.implicitFinishDeadlineAt).toBe(5_000 + T_HANDSHAKE_NODE);
  });
});
