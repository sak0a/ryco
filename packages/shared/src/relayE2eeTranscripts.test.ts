import { describe, expect, it } from "vite-plus/test";

import { canonicalizeHubOrigin } from "./nodeIdentity.ts";
import {
  E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES,
  E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES,
  E2EE_CONTINUITY_CHAIN_MAX_LENGTH,
  E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES,
  E2EE_HUB_ORIGIN_MAX_BYTES,
  E2EE_SIGNING_INPUT_MAX_BYTES,
} from "./relayE2eeConstants.ts";
import {
  E2EE_NODE_IDENTITY_ALGORITHM,
  RelayE2eeValidationError,
  e2eeKeyFingerprint,
  verifyE2eeSignature,
} from "./relayE2eeKeys.ts";
import {
  E2EE_CLIENT_PREKEY_TRANSCRIPT_DOMAIN,
  E2EE_CONTEXT_DOMAIN,
  E2EE_NODE_CAPABILITY_DIGEST_DOMAIN,
  E2EE_NODE_CAPABILITY_TRANSCRIPT_DOMAIN,
  E2EE_NODE_IDENTITY_CONTINUITY_TRANSCRIPT_DOMAIN,
  E2EE_NODE_PREKEY_TRANSCRIPT_DOMAIN,
  E2EE_NOISE_DH,
  E2EE_NOISE_HASH,
  E2EE_PROLOGUE_DOMAIN,
  RelayE2eeCapabilityBoundError,
  canonicalizeE2eeHubOrigin,
  decodeCanonicalE2eeCbor,
  encodeCanonicalE2eeCbor,
  E2EE_FALLBACK_ORIGIN_DOMAIN,
  decodeNodeIdentityContinuityTranscript,
  e2eeAuthorizationContextCommitment,
  e2eeEffectiveAdmittedPatterns,
  e2eeTierNoisePattern,
  encodeClientE2eePrekeyTranscript,
  encodeE2eeAuthorizationContext,
  encodeE2eeNoisePrologue,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eeCapabilityTranscript,
  encodeNodeE2eePrekeyTranscript,
  encodeNodeIdentityContinuityTranscript,
  nodeE2eeCapabilitySelfCheck,
  validateNodeE2eeContinuityChain,
  verifyNodeE2eeCapabilityCrossSignature,
  type E2eeAuthorizationContextInput,
  type NodeE2eeCapabilityTranscriptInput,
  type NodeIdentityContinuityChainEntry,
} from "./relayE2eeTranscripts.ts";

const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

// Deterministic §16.1-style material. TEST ONLY: these keys derive from public
// fixed seeds and must never key a real endpoint.
const NODE_PUBLIC_KEY = bytes("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8");
const OLD_PUBLIC_KEY = bytes("884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b");
const NEW_PUBLIC_KEY = bytes("a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0");
const UNRELATED_PUBLIC_KEY = bytes(
  "74f85cda34d1c27c4621484731e91579c3d9c6cfc0d94b281aa11e9162058aa9",
);
const NODE_AGREEMENT_PUBLIC_KEY = bytes(
  "7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
);
const CLIENT_AGREEMENT_PUBLIC_KEY = bytes(
  "052a50773ac8d91773f2dc9662e12f0defe915e415b8a1c8e20a5a3d6ab2b843",
);
const CLIENT_PUBLIC_KEY = bytes(
  "047a593180860c4037c83c12749845c8ee1424dd297fadcb895e358255d2c7d2" +
    "b2a8ca25580f2626fe579062ff1b99ff91c24a0da06fb32b5be20148c9249f5650",
);

const HUB_ORIGIN = "https://hub.example.com";
const NODE_ID = "node_AAAAAAAAAAAAAAAAAAAAAA";
const IDENTITY_KEY_ID = "nkey_BBBBBBBBBBBBBBBBBBBBBB";
const OLD_KEY_ID = "nkey_CCCCCCCCCCCCCCCCCCCCCC";
const NEW_KEY_ID = "nkey_DDDDDDDDDDDDDDDDDDDDDD";
const PREKEY_ID = "epk_EEEEEEEEEEEEEEEEEEEEEE";
const CONTINUITY_ID = "nct_FFFFFFFFFFFFFFFFFFFFFF";
const CHANNEL_ID = "ch_GGGGGGGGGGGGGGGGGGGGGG";
const ACCOUNT_ID = "acct_0123456789";
const CREATED_AT = 1_784_160_000_000;
const EXPIRES_AT = 1_786_752_000_000;
const ISSUED_AT = 1_784_160_030_000;
const STATEMENT_EXPIRES_AT = 1_784_160_630_000;

const NODE_PREKEY_TRANSCRIPT =
  "8d78187279636f2e6e6f64652d653265652d7072656b65792e76317768747470733a2f2f6875622e6578616d706c652e636f6d781b6e6f64655f414141414141414141414141414141414141414141416765643235353139781b6e6b65795f42424242424242424242424242424242424242424242781a65706b5f45454545454545454545454545454545454545454545582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b858200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b6458207b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13653235353139665348413235361b0000019f683918001b000001a002b7e000";
const NODE_PREKEY_SIGNATURE =
  "58f2c7365b5f5cfe1193fcbf194dfc34ff77e173eb622ecd187b7c5e3c38134de93dee609798456a770fa8efba8a02dd72119fe68ebbb3f365b091be3c716207";
const CLIENT_PREKEY_TRANSCRIPT =
  "8b781a7279636f2e636c69656e742d653265652d7072656b65792e76317768747470733a2f2f6875622e6578616d706c652e636f6d6f616363745f3031323334353637383964703235365841047a593180860c4037c83c12749845c8ee1424dd297fadcb895e358255d2c7d2b2a8ca25580f2626fe579062ff1b99ff91c24a0da06fb32b5be20148c9249f56505820a9d61f1ad6753239898e6e6f262f2ec17f0498f2c33accc3b7448bfa5f0e89275820052a50773ac8d91773f2dc9662e12f0defe915e415b8a1c8e20a5a3d6ab2b843653235353139665348413235361b0000019f683918001b000001a002b7e000";
const CLIENT_PREKEY_SIGNATURE =
  "7fc435a5b1bf83437dd2599f05a73434b8e1d3165be4f85a6a4f9907274389bf118b014d5e96e23a5237b2899b166ea67112cc900ac4d794ebcbb4c7276e7f7e";
const CONTINUITY_1_TRANSCRIPT =
  "8d78207279636f2e6e6f64652d6964656e746974792d636f6e74696e756974792e76317768747470733a2f2f6875622e6578616d706c652e636f6d781a6e63745f46464646464646464646464646464646464646464646016765643235353139781b6e6b65795f434343434343434343434343434343434343434343435820884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b58207a0e704d9b065437dd99ad8633cb4ecf3ffc3d0352caaacbd689c6878e2f915b6765643235353139781b6e6b65795f444444444444444444444444444444444444444444445820a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f05820507a7b4affcad69229c2a23b2c7f80b98ea1e033f500eaddf6b46a514a6806861b0000019f68391800";
const CONTINUITY_1_SIGNATURE =
  "493f1402f38d7f83cd022dc3abd9b51b4d4401cdf061fe7276d22c4bf1274dd65d1c14d8f33b3976f80cb2e21337564b1cabd79666a8a146de6edacf86078b0c";
const CONTINUITY_2_TRANSCRIPT =
  "8d78207279636f2e6e6f64652d6964656e746974792d636f6e74696e756974792e76317768747470733a2f2f6875622e6578616d706c652e636f6d781a6e63745f46464646464646464646464646464646464646464646026765643235353139781b6e6b65795f444444444444444444444444444444444444444444445820a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f05820507a7b4affcad69229c2a23b2c7f80b98ea1e033f500eaddf6b46a514a6806866765643235353139781b6e6b65795f42424242424242424242424242424242424242424242582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b858200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b641b0000019f68391801";
const CONTINUITY_2_SIGNATURE =
  "d81f2a6b2d734523d6baf283f465bdc3c880cfa4c2440034e910135a8d97af43d94c6f8633f1e212ef618e561c453532853c357c4ad5d316f41867313705a10a";
const CAPABILITY_TRANSCRIPT =
  "93781c7279636f2e6e6f64652d653265652d6361706162696c6974792e76317768747470733a2f2f6875622e6578616d706c652e636f6d781b6e6f64655f414141414141414141414141414141414141414141416765643235353139781b6e6b65795f42424242424242424242424242424242424242424242582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b858200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b640101810186781a65706b5f4545454545454545454545454545454545454545454558207b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13584058f2c7365b5f5cfe1193fcbf194dfc34ff77e173eb622ecd187b7c5e3c38134de93dee609798456a770fa8efba8a02dd72119fe68ebbb3f365b091be3c71620758200f4004c97fa0df91b3cb19547a4e0b16f1b37b440f7cb630faf81291b37df7791b0000019f683918001b000001a002b7e00082825901338d78207279636f2e6e6f64652d6964656e746974792d636f6e74696e756974792e76317768747470733a2f2f6875622e6578616d706c652e636f6d781a6e63745f46464646464646464646464646464646464646464646016765643235353139781b6e6b65795f434343434343434343434343434343434343434343435820884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b58207a0e704d9b065437dd99ad8633cb4ecf3ffc3d0352caaacbd689c6878e2f915b6765643235353139781b6e6b65795f444444444444444444444444444444444444444444445820a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f05820507a7b4affcad69229c2a23b2c7f80b98ea1e033f500eaddf6b46a514a6806861b0000019f683918005840493f1402f38d7f83cd022dc3abd9b51b4d4401cdf061fe7276d22c4bf1274dd65d1c14d8f33b3976f80cb2e21337564b1cabd79666a8a146de6edacf86078b0c825901338d78207279636f2e6e6f64652d6964656e746974792d636f6e74696e756974792e76317768747470733a2f2f6875622e6578616d706c652e636f6d781a6e63745f46464646464646464646464646464646464646464646026765643235353139781b6e6b65795f444444444444444444444444444444444444444444445820a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f05820507a7b4affcad69229c2a23b2c7f80b98ea1e033f500eaddf6b46a514a6806866765643235353139781b6e6b65795f42424242424242424242424242424242424242424242582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b858200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b641b0000019f683918015840d81f2a6b2d734523d6baf283f465bdc3c880cfa4c2440034e910135a8d97af43d94c6f8633f1e212ef618e561c453532853c357c4ad5d316f41867313705a10af4f48262494b624e58071b0000019f68398d301b0000019f6842b4f0781a6e63745f46464646464646464646464646464646464646464646";
const CAPABILITY_ENVELOPE =
  "8278237279636f2e6e6f64652d653265652d6361706162696c6974792d6469676573742e76315820928b5d37a8da6c41964a5d6e42f9e24391fcd52f5d57723f629a41617bb33bb1";
const CAPABILITY_SIGNATURE =
  "b9384d1c97a693abe11f8d1682c245c5104dbff8c3ca24d9748da5580c369b1781fecca930b6d87129acaab791677e3702f8027b648cc69a9c428f4fdbc27907";
const EMPTY_CHAIN_CAPABILITY_ENVELOPE =
  "8278237279636f2e6e6f64652d653265652d6361706162696c6974792d6469676573742e7631582079725ba0051fe8d01841de86899ba4cabe7ae0ba7d1adf54ec3d3a8d85e13001";
const NATIVE_CONTEXT =
  "92781a7279636f2e72656c61792d653265652e636f6e746578742e76317768747470733a2f2f6875622e6578616d706c652e636f6d781963685f4747474747474747474747474747474747474747474701020101781b6e6f64655f41414141414141414141414141414141414141414141676564323535313958200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b646f616363745f30313233343536373839687279636f2e727063686f70657261746f72687279636f2e727063686f70657261746f728358200f4004c97fa0df91b3cb19547a4e0b16f1b37b440f7cb630faf81291b37df77958209d379e59c1c9c0cc197ddebca8d6c1bf6385b240fe923184cfc9ab0b04dc122558201cb30a9f6b3c3ec9c28afb10271d4e3d347f44778859cc3aaceee65770a11ede825820a9d61f1ad6753239898e6e6f262f2ec17f0498f2c33accc3b7448bfa5f0e892758206bacda78725c700bb0babe642823041bd4eaff92373698131be8ae116d1388d2781a6e63745f46464646464646464646464646464646464646464646";
const NATIVE_CONTEXT_COMMITMENT =
  "06273aec14d751c0f7010de92e0cadbf2097aa24a68fcbed0e964c83623de7a7";
const WEB_CONTEXT =
  "92781a7279636f2e72656c61792d653265652e636f6e746578742e76317768747470733a2f2f6875622e6578616d706c652e636f6d781963685f4747474747474747474747474747474747474747474701020101781b6e6f64655f41414141414141414141414141414141414141414141676564323535313958200156cdedee6f84797b28b7be83048194483cc17165b1ae7afe7bbc77eedf9b6460687279636f2e72706366766965776572687279636f2e727063667669657765728158200f4004c97fa0df91b3cb19547a4e0b16f1b37b440f7cb630faf81291b37df77980781a6e63745f46464646464646464646464646464646464646464646";
const WEB_CONTEXT_COMMITMENT = "f7d1c0c72be78c40f66dece393a76e27f4104560fa2fa64b70e04f0826f1c03e";
const PROLOGUE =
  "89781b7279636f2e72656c61792d653265652e70726f6c6f6775652e76317768747470733a2f2f6875622e6578616d706c652e636f6d781963685f4747474747474747474747474747474747474747474701020101781b6e6f64655f41414141414141414141414141414141414141414141582006273aec14d751c0f7010de92e0cadbf2097aa24a68fcbed0e964c83623de7a7";
const CONTINUITY_1_DIGEST = "9d379e59c1c9c0cc197ddebca8d6c1bf6385b240fe923184cfc9ab0b04dc1225";
const CONTINUITY_2_DIGEST = "1cb30a9f6b3c3ec9c28afb10271d4e3d347f44778859cc3aaceee65770a11ede";

const nodePrekeyInput = {
  hubOrigin: HUB_ORIGIN,
  nodeId: NODE_ID,
  identityKeyId: IDENTITY_KEY_ID,
  prekeyId: PREKEY_ID,
  identityPublicKey: NODE_PUBLIC_KEY,
  agreementPublicKey: NODE_AGREEMENT_PUBLIC_KEY,
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
} as const;

const clientPrekeyInput = {
  hubOrigin: HUB_ORIGIN,
  accountId: ACCOUNT_ID,
  identityPublicKey: CLIENT_PUBLIC_KEY,
  agreementPublicKey: CLIENT_AGREEMENT_PUBLIC_KEY,
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
} as const;

const continuity1Input = {
  hubOrigin: HUB_ORIGIN,
  continuityId: CONTINUITY_ID,
  generation: 1,
  oldKeyId: OLD_KEY_ID,
  oldPublicKey: OLD_PUBLIC_KEY,
  newKeyId: NEW_KEY_ID,
  newPublicKey: NEW_PUBLIC_KEY,
  createdAt: CREATED_AT,
} as const;

const CHAIN: readonly NodeIdentityContinuityChainEntry[] = [
  { transcript: bytes(CONTINUITY_1_TRANSCRIPT), signature: bytes(CONTINUITY_1_SIGNATURE) },
  { transcript: bytes(CONTINUITY_2_TRANSCRIPT), signature: bytes(CONTINUITY_2_SIGNATURE) },
];

const capabilityInput: NodeE2eeCapabilityTranscriptInput = {
  hubOrigin: HUB_ORIGIN,
  nodeId: NODE_ID,
  identityKeyId: IDENTITY_KEY_ID,
  identityPublicKey: NODE_PUBLIC_KEY,
  e2eeVersionMin: 1,
  e2eeVersionMax: 1,
  suiteRegistry: [1],
  prekeyCertificate: {
    prekeyId: PREKEY_ID,
    agreementPublicKey: NODE_AGREEMENT_PUBLIC_KEY,
    crossSignature: bytes(NODE_PREKEY_SIGNATURE),
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  },
  continuityChain: CHAIN,
  requireE2EE: false,
  requireApprovedClientE2EE: false,
  policyGeneration: 7,
  issuedAt: ISSUED_AT,
  expiresAt: STATEMENT_EXPIRES_AT,
  continuityId: CONTINUITY_ID,
};

const nativeContextInput: E2eeAuthorizationContextInput = {
  hubOrigin: HUB_ORIGIN,
  channelId: CHANNEL_ID,
  relayProtocolMajor: 1,
  relayProtocolMinor: 2,
  e2eeVersion: 1,
  suiteId: 1,
  nodeId: NODE_ID,
  nodeIdentityFingerprint: e2eeKeyFingerprint("node-identity", NODE_PUBLIC_KEY),
  clientIntendedCapability: "ryco.rpc",
  clientIntendedRole: "operator",
  channelOpenCapability: "ryco.rpc",
  channelOpenEffectiveRole: "operator",
  nodeAgreementFingerprint: e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC_KEY),
  nodeContinuityChainTranscripts: [bytes(CONTINUITY_1_TRANSCRIPT), bytes(CONTINUITY_2_TRANSCRIPT)],
  nodeContinuityId: CONTINUITY_ID,
  client: {
    tier: "native",
    accountId: ACCOUNT_ID,
    identityFingerprint: e2eeKeyFingerprint("client-identity", CLIENT_PUBLIC_KEY),
    agreementFingerprint: e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC_KEY),
  },
};

const webContextInput: E2eeAuthorizationContextInput = {
  ...nativeContextInput,
  clientIntendedRole: "viewer",
  channelOpenEffectiveRole: "viewer",
  nodeContinuityChainTranscripts: [],
  client: { tier: "web" },
};

describe("relay E2EE transcript domains and literals (§3.5, §7)", () => {
  it("pins every domain string this slice encodes", () => {
    expect(E2EE_NODE_PREKEY_TRANSCRIPT_DOMAIN).toBe("ryco.node-e2ee-prekey.v1");
    expect(E2EE_CLIENT_PREKEY_TRANSCRIPT_DOMAIN).toBe("ryco.client-e2ee-prekey.v1");
    expect(E2EE_NODE_IDENTITY_CONTINUITY_TRANSCRIPT_DOMAIN).toBe(
      "ryco.node-identity-continuity.v1",
    );
    expect(E2EE_NODE_CAPABILITY_TRANSCRIPT_DOMAIN).toBe("ryco.node-e2ee-capability.v1");
    expect(E2EE_NODE_CAPABILITY_DIGEST_DOMAIN).toBe("ryco.node-e2ee-capability-digest.v1");
    expect(E2EE_CONTEXT_DOMAIN).toBe("ryco.relay-e2ee.context.v1");
    expect(E2EE_PROLOGUE_DOMAIN).toBe("ryco.relay-e2ee.prologue.v1");
    expect(E2EE_FALLBACK_ORIGIN_DOMAIN).toBe("ryco.relay-e2ee.fallback-origin.v1");
    expect(E2EE_NOISE_DH).toBe("25519");
    expect(E2EE_NOISE_HASH).toBe("SHA256");
  });

  it("computes the effective admitted pattern set from the committed policy", () => {
    expect(e2eeEffectiveAdmittedPatterns(true)).toEqual(["IK"]);
    expect(e2eeEffectiveAdmittedPatterns(false)).toEqual(["IK", "NX"]);
    expect(e2eeTierNoisePattern("native")).toBe("IK");
    expect(e2eeTierNoisePattern("web")).toBe("NX");
  });

  it("canonicalizes Hub origins exactly as the node identity primitives do", () => {
    for (const accepted of ["https://hub.example.com", "http://localhost:3000"]) {
      expect(canonicalizeE2eeHubOrigin(accepted)).toBe(canonicalizeHubOrigin(accepted));
    }
    for (const rejected of [
      "https://hub.example.com/",
      "https://hub.example.com/path",
      "https://user@hub.example.com",
      "http://hub.example.com",
      "not-a-url",
    ]) {
      expect(() => canonicalizeE2eeHubOrigin(rejected)).toThrow(RelayE2eeValidationError);
      expect(() => canonicalizeHubOrigin(rejected)).toThrow();
    }
    // The E2EE bound is tighter than the primitives': accepted there, refused here.
    const longOrigin = `https://${"o".repeat(E2EE_HUB_ORIGIN_MAX_BYTES)}.example.com`;
    expect(canonicalizeHubOrigin(longOrigin)).toBe(longOrigin);
    expect(() => canonicalizeE2eeHubOrigin(longOrigin)).toThrow(RelayE2eeValidationError);
    const exactOrigin = `https://${"o".repeat(E2EE_HUB_ORIGIN_MAX_BYTES - "https://".length)}`;
    expect(canonicalizeE2eeHubOrigin(exactOrigin)).toHaveLength(E2EE_HUB_ORIGIN_MAX_BYTES);
  });
});

describe("§7.3 node agreement-prekey certificate", () => {
  it("matches the deterministic transcript and verifies its cross-signature", () => {
    const transcript = encodeNodeE2eePrekeyTranscript(nodePrekeyInput);
    expect(hex(transcript)).toBe(NODE_PREKEY_TRANSCRIPT);
    // 0x8d is a definite-length CBOR array of exactly 13 elements (§7.3).
    expect(transcript[0]).toBe(0x8d);
    expect(transcript.byteLength).toBeLessThanOrEqual(E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES);
    expect(
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_PUBLIC_KEY,
        message: transcript,
        signature: bytes(NODE_PREKEY_SIGNATURE),
      }),
    ).toBe(true);
  });

  it("binds every field it carries", () => {
    const baseline = hex(encodeNodeE2eePrekeyTranscript(nodePrekeyInput));
    const mutations = [
      { ...nodePrekeyInput, hubOrigin: "https://other.example.com" },
      { ...nodePrekeyInput, nodeId: "node_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...nodePrekeyInput, identityKeyId: "nkey_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...nodePrekeyInput, prekeyId: "epk_ZZZZZZZZZZZZZZZZZZZZZZ" },
      { ...nodePrekeyInput, identityPublicKey: NEW_PUBLIC_KEY },
      { ...nodePrekeyInput, agreementPublicKey: CLIENT_AGREEMENT_PUBLIC_KEY },
      { ...nodePrekeyInput, createdAt: CREATED_AT + 1 },
      { ...nodePrekeyInput, expiresAt: EXPIRES_AT + 1 },
    ];
    for (const mutation of mutations) {
      expect(hex(encodeNodeE2eePrekeyTranscript(mutation))).not.toBe(baseline);
    }
  });

  it("rejects malformed identifiers and key material", () => {
    expect(() =>
      encodeNodeE2eePrekeyTranscript({ ...nodePrekeyInput, prekeyId: IDENTITY_KEY_ID }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eePrekeyTranscript({ ...nodePrekeyInput, nodeId: "node_short" }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eePrekeyTranscript({ ...nodePrekeyInput, identityPublicKey: CLIENT_PUBLIC_KEY }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eePrekeyTranscript({
        ...nodePrekeyInput,
        agreementPublicKey: new Uint8Array(31),
      }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eePrekeyTranscript({ ...nodePrekeyInput, createdAt: Number.MAX_VALUE }),
    ).toThrow(RelayE2eeValidationError);
    expect(() => encodeNodeE2eePrekeyTranscript({ ...nodePrekeyInput, expiresAt: -1 })).toThrow(
      RelayE2eeValidationError,
    );
  });
});

describe("§7.4 client agreement-prekey certificate", () => {
  it("matches the deterministic transcript and verifies its device-key signature", () => {
    const transcript = encodeClientE2eePrekeyTranscript(clientPrekeyInput);
    expect(hex(transcript)).toBe(CLIENT_PREKEY_TRANSCRIPT);
    // 0x8b is a definite-length CBOR array of exactly 11 elements (§7.4).
    expect(transcript[0]).toBe(0x8b);
    expect(transcript.byteLength).toBeLessThanOrEqual(E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES);
    expect(
      verifyE2eeSignature({
        algorithm: "p256",
        publicKey: CLIENT_PUBLIC_KEY,
        message: transcript,
        signature: bytes(CLIENT_PREKEY_SIGNATURE),
      }),
    ).toBe(true);
  });

  it("binds the Hub/account namespace", () => {
    const baseline = hex(encodeClientE2eePrekeyTranscript(clientPrekeyInput));
    expect(
      hex(encodeClientE2eePrekeyTranscript({ ...clientPrekeyInput, accountId: "acct_other" })),
    ).not.toBe(baseline);
    expect(
      hex(
        encodeClientE2eePrekeyTranscript({
          ...clientPrekeyInput,
          hubOrigin: "https://other.example.com",
        }),
      ),
    ).not.toBe(baseline);
  });

  it("refuses the empty account id and an over-long one", () => {
    expect(() => encodeClientE2eePrekeyTranscript({ ...clientPrekeyInput, accountId: "" })).toThrow(
      RelayE2eeValidationError,
    );
    expect(() =>
      encodeClientE2eePrekeyTranscript({ ...clientPrekeyInput, accountId: "a".repeat(257) }),
    ).toThrow(RelayE2eeValidationError);
    expect(
      encodeClientE2eePrekeyTranscript({ ...clientPrekeyInput, accountId: "a".repeat(256) })
        .byteLength,
    ).toBeLessThanOrEqual(E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES);
  });
});

describe("§7.5 node identity-continuity certificate", () => {
  it("matches the deterministic transcript and verifies under the outgoing key", () => {
    const transcript = encodeNodeIdentityContinuityTranscript(continuity1Input);
    expect(hex(transcript)).toBe(CONTINUITY_1_TRANSCRIPT);
    // 0x8d is a definite-length CBOR array of exactly 13 elements (§7.5).
    expect(transcript[0]).toBe(0x8d);
    // §7.5 is signed directly, so it lives under the direct-signing bound (§7.2).
    expect(transcript.byteLength).toBe(307);
    expect(transcript.byteLength).toBeLessThanOrEqual(E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES);
    expect(
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: OLD_PUBLIC_KEY,
        message: transcript,
        signature: bytes(CONTINUITY_1_SIGNATURE),
      }),
    ).toBe(true);
    // The INCOMING key never signs the rotation away from the outgoing one.
    expect(
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NEW_PUBLIC_KEY,
        message: transcript,
        signature: bytes(CONTINUITY_1_SIGNATURE),
      }),
    ).toBe(false);
  });

  it("refuses generation 0 — the first rotation is generation 1", () => {
    expect(() =>
      encodeNodeIdentityContinuityTranscript({ ...continuity1Input, generation: 0 }),
    ).toThrow(RelayE2eeValidationError);
  });

  it("decodes with recomputed fingerprints and rejects a substituted one", () => {
    const decoded = decodeNodeIdentityContinuityTranscript(bytes(CONTINUITY_1_TRANSCRIPT));
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") return;
    expect(decoded.value.generation).toBe(1);
    expect(decoded.value.continuityId).toBe(CONTINUITY_ID);
    expect(decoded.value.hubOrigin).toBe(HUB_ORIGIN);
    expect(hex(decoded.value.oldPublicKey)).toBe(hex(OLD_PUBLIC_KEY));
    expect(hex(decoded.value.newFingerprint)).toBe(
      hex(e2eeKeyFingerprint("node-identity", NEW_PUBLIC_KEY)),
    );

    // Flip one byte of the carried `newFingerprint`; the recomputation catches it.
    const tampered = bytes(CONTINUITY_1_TRANSCRIPT);
    const offset = tampered.byteLength - 1 - 9 - 32;
    tampered[offset] = (tampered[offset]! ^ 0x01) & 0xff;
    expect(decodeNodeIdentityContinuityTranscript(tampered)).toEqual({
      kind: "error",
      reason: "malformed",
    });
  });
});

describe("§7.5 continuity chain rules", () => {
  const chainInput = {
    chain: CHAIN,
    hubOrigin: HUB_ORIGIN,
    continuityId: CONTINUITY_ID,
    identityPublicKey: NODE_PUBLIC_KEY,
  } as const;

  it("accepts a well-formed chain reaching the current identity key", () => {
    const result = validateNodeE2eeContinuityChain(chainInput);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.certificates.map((certificate) => certificate.generation)).toEqual([1, 2]);
  });

  it("accepts an empty chain from a node that has never rotated", () => {
    expect(validateNodeE2eeContinuityChain({ ...chainInput, chain: [] }).kind).toBe("ok");
  });

  it("rejects reordering, truncation, splices, and generation regressions", () => {
    // Reordering is caught by the generation rule, which runs first: a chain
    // whose second entry is generation 1 does not follow a generation 2.
    const reversed = [CHAIN[1]!, CHAIN[0]!];
    expect(validateNodeE2eeContinuityChain({ ...chainInput, chain: reversed })).toEqual({
      kind: "error",
      failure: "generation_not_consecutive",
    });
    // Truncating to the first entry leaves the final new key ≠ the identity key.
    expect(validateNodeE2eeContinuityChain({ ...chainInput, chain: [CHAIN[0]!] })).toEqual({
      kind: "error",
      failure: "identity_key_mismatch",
    });
    // A gap: entry 1 then entry 1 again is a generation that does not follow.
    expect(
      validateNodeE2eeContinuityChain({ ...chainInput, chain: [CHAIN[0]!, CHAIN[0]!] }),
    ).toEqual({ kind: "error", failure: "generation_not_consecutive" });
    // A spliced signature: the second entry's bytes under the first's signature.
    expect(
      validateNodeE2eeContinuityChain({
        ...chainInput,
        chain: [CHAIN[0]!, { transcript: CHAIN[1]!.transcript, signature: CHAIN[0]!.signature }],
      }),
    ).toEqual({ kind: "error", failure: "invalid_signature" });
  });

  it("rejects a chain longer than the retention bound", () => {
    const overLong = Array.from({ length: E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1 }, () => CHAIN[0]!);
    expect(validateNodeE2eeContinuityChain({ ...chainInput, chain: overLong })).toEqual({
      kind: "error",
      failure: "chain_too_long",
    });
  });

  it("rejects a statement-level disagreement about origin or continuity id", () => {
    expect(
      validateNodeE2eeContinuityChain({ ...chainInput, hubOrigin: "https://other.example.com" }),
    ).toEqual({ kind: "error", failure: "hub_origin_mismatch" });
    expect(
      validateNodeE2eeContinuityChain({
        ...chainInput,
        continuityId: "nct_ZZZZZZZZZZZZZZZZZZZZZZ",
      }),
    ).toEqual({ kind: "error", failure: "continuity_id_mismatch" });
  });

  it("rejects a chain that does not reach the pin and reports the silent update", () => {
    const pinAtOldKey = e2eeKeyFingerprint("node-identity", OLD_PUBLIC_KEY);
    const reached = validateNodeE2eeContinuityChain({
      ...chainInput,
      pinnedIdentityFingerprint: pinAtOldKey,
    });
    expect(reached.kind).toBe("ok");
    if (reached.kind === "ok") expect(reached.pinnedFingerprintUnchanged).toBe(false);

    const unchanged = validateNodeE2eeContinuityChain({
      ...chainInput,
      pinnedIdentityFingerprint: e2eeKeyFingerprint("node-identity", NODE_PUBLIC_KEY),
    });
    expect(unchanged.kind).toBe("ok");
    if (unchanged.kind === "ok") expect(unchanged.pinnedFingerprintUnchanged).toBe(true);

    expect(
      validateNodeE2eeContinuityChain({
        ...chainInput,
        pinnedIdentityFingerprint: e2eeKeyFingerprint("node-identity", UNRELATED_PUBLIC_KEY),
      }),
    ).toEqual({ kind: "error", failure: "pin_not_reached" });
  });

  it("returns a typed failure for peer input of the wrong shape", () => {
    // The chain arrives inside a peer statement relayed by an untrusted Hub, so
    // a shape the declared type forbids still reaches this validator, and it
    // MUST be a result rather than a thrown TypeError.
    for (const chain of [null, undefined, 7, "chain", {}]) {
      expect(validateNodeE2eeContinuityChain({ ...chainInput, chain: chain as never })).toEqual({
        kind: "error",
        failure: "malformed_entry",
      });
    }
    for (const entry of [null, undefined, 7, "entry", {}]) {
      expect(validateNodeE2eeContinuityChain({ ...chainInput, chain: [entry as never] })).toEqual({
        kind: "error",
        failure: "malformed_entry",
      });
    }
    // A well-formed entry alongside a malformed one is still the whole chain's
    // failure: entry 0 verifies, entry 1 is not an entry at all.
    expect(
      validateNodeE2eeContinuityChain({ ...chainInput, chain: [CHAIN[0]!, null as never] }),
    ).toEqual({ kind: "error", failure: "malformed_entry" });
    // Present fields of the wrong type are the same failure.
    expect(
      validateNodeE2eeContinuityChain({
        ...chainInput,
        chain: [{ transcript: CONTINUITY_1_TRANSCRIPT, signature: CHAIN[0]!.signature } as never],
      }),
    ).toEqual({ kind: "error", failure: "malformed_entry" });
    expect(
      validateNodeE2eeContinuityChain({
        ...chainInput,
        chain: [{ transcript: CHAIN[0]!.transcript, signature: new Uint8Array(63) }],
      }),
    ).toEqual({ kind: "error", failure: "malformed_entry" });
  });

  it("names an invalid statement identity key rather than blaming an entry", () => {
    // §7.6 element 5 is the statement's own field, not a chain entry, and it is
    // reachable with NO entries at all — a node that has never rotated carries
    // an empty chain — so `malformed_entry` would name a thing that does not
    // exist in the input.
    const wrongLength = new Uint8Array(31);
    // A `y` coordinate equal to the field prime: §7.1 decodes Ed25519 strictly,
    // so this is not a key this protocol represents (§14.3).
    const nonCanonicalPoint = bytes(
      "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    );
    for (const identityPublicKey of [wrongLength, nonCanonicalPoint]) {
      expect(
        validateNodeE2eeContinuityChain({ ...chainInput, chain: [], identityPublicKey }),
      ).toEqual({ kind: "error", failure: "invalid_identity_key" });
      expect(validateNodeE2eeContinuityChain({ ...chainInput, identityPublicKey })).toEqual({
        kind: "error",
        failure: "invalid_identity_key",
      });
    }
    // Peer material of the wrong type is the same failure and never a throw.
    expect(
      validateNodeE2eeContinuityChain({
        ...chainInput,
        chain: [],
        identityPublicKey: hex(NODE_PUBLIC_KEY) as never,
      }),
    ).toEqual({ kind: "error", failure: "invalid_identity_key" });
    // A valid key that the chain simply does not reach stays its own failure.
    expect(
      validateNodeE2eeContinuityChain({ ...chainInput, identityPublicKey: UNRELATED_PUBLIC_KEY }),
    ).toEqual({ kind: "error", failure: "identity_key_mismatch" });
  });

  it("rejects non-canonical carried transcript bytes", () => {
    // Append a trailing byte: it still decodes to a prefix under a lax reader,
    // and the §3.6 re-encode equality rule is what refuses it.
    const trailing = new Uint8Array(CHAIN[0]!.transcript.byteLength + 1);
    trailing.set(CHAIN[0]!.transcript);
    expect(
      validateNodeE2eeContinuityChain({
        ...chainInput,
        chain: [{ transcript: trailing, signature: CHAIN[0]!.signature }],
      }),
    ).toEqual({ kind: "error", failure: "malformed_entry" });
  });
});

describe("§7.6 capability statement transcript and §7.2.1 envelope", () => {
  // The statement's identity fields and prekey members as a verifier holds them
  // after decoding one: both fingerprints are CARRIED values (§7.6 element 6 and
  // prekey member 3), never re-derivations of the keys beside them.
  const reconstruction = {
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    identityPublicKey: NODE_PUBLIC_KEY,
    identityFingerprint: e2eeKeyFingerprint("node-identity", NODE_PUBLIC_KEY),
    prekeyCertificate: {
      ...capabilityInput.prekeyCertificate,
      agreementFingerprint: e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC_KEY),
    },
  } as const;

  it("encodes exactly 19 elements and signs through the fixed-size envelope", () => {
    const transcript = encodeNodeE2eeCapabilityTranscript(capabilityInput);
    expect(hex(transcript)).toBe(CAPABILITY_TRANSCRIPT);
    // 0x93 is a definite-length CBOR array of exactly 19 elements (§7.6).
    expect(transcript[0]).toBe(0x93);
    expect(transcript.byteLength).toBe(1_185);
    expect(transcript.byteLength).toBeLessThanOrEqual(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES);

    const envelope = encodeNodeE2eeCapabilitySigningEnvelope(transcript);
    expect(hex(envelope)).toBe(CAPABILITY_ENVELOPE);
    expect(envelope.byteLength).toBe(E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES);
    expect(envelope.byteLength).toBeLessThanOrEqual(E2EE_SIGNING_INPUT_MAX_BYTES);
    expect(
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_PUBLIC_KEY,
        message: envelope,
        signature: bytes(CAPABILITY_SIGNATURE),
      }),
    ).toBe(true);
    // The signature covers the ENVELOPE, never the raw transcript (§7.2.1).
    expect(
      verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: NODE_PUBLIC_KEY,
        message: transcript,
        signature: bytes(CAPABILITY_SIGNATURE),
      }),
    ).toBe(false);
  });

  it("produces an envelope of one fixed length whatever the transcript's length", () => {
    const withChain = encodeNodeE2eeCapabilityTranscript(capabilityInput);
    const withoutChain = encodeNodeE2eeCapabilityTranscript({
      ...capabilityInput,
      continuityChain: [],
      requireE2EE: true,
      requireApprovedClientE2EE: true,
    });
    expect(withoutChain.byteLength).toBeLessThan(withChain.byteLength);
    const short = encodeNodeE2eeCapabilitySigningEnvelope(withoutChain);
    const long = encodeNodeE2eeCapabilitySigningEnvelope(withChain);
    expect(hex(short)).toBe(EMPTY_CHAIN_CAPABILITY_ENVELOPE);
    expect(short.byteLength).toBe(long.byteLength);
    expect(short.byteLength).toBe(E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES);
    expect(hex(short)).not.toBe(hex(long));
    // The envelope is a domain-carrying array, not a bare digest (§7.2.1).
    expect(short[0]).toBe(0x82);
  });

  it("derives element 14 from the committed policy and carries element 18 with an empty chain", () => {
    const permissive = decodeCanonicalE2eeCbor(encodeNodeE2eeCapabilityTranscript(capabilityInput));
    const restrictive = decodeCanonicalE2eeCbor(
      encodeNodeE2eeCapabilityTranscript({
        ...capabilityInput,
        continuityChain: [],
        requireE2EE: true,
        requireApprovedClientE2EE: true,
      }),
    );
    expect(permissive.kind).toBe("ok");
    expect(restrictive.kind).toBe("ok");
    if (permissive.kind !== "ok" || restrictive.kind !== "ok") return;
    const permissiveElements = permissive.value as readonly unknown[];
    const restrictiveElements = restrictive.value as readonly unknown[];
    expect(permissiveElements).toHaveLength(19);
    expect(permissiveElements[14]).toEqual(["IK", "NX"]);
    expect(restrictiveElements[14]).toEqual(["IK"]);
    expect(restrictiveElements[11]).toEqual([]);
    expect(restrictiveElements[18]).toBe(CONTINUITY_ID);
    expect(permissiveElements[9]).toEqual([1]);
  });

  it("rejects an inverted version range, an unregistered suite, and an over-long chain", () => {
    expect(() =>
      encodeNodeE2eeCapabilityTranscript({ ...capabilityInput, e2eeVersionMin: 2 }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eeCapabilityTranscript({ ...capabilityInput, suiteRegistry: [] }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eeCapabilityTranscript({ ...capabilityInput, suiteRegistry: [2] }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eeCapabilityTranscript({
        ...capabilityInput,
        suiteRegistry: Array.from({ length: 9 }, () => 1),
      }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeNodeE2eeCapabilityTranscript({
        ...capabilityInput,
        continuityChain: Array.from(
          { length: E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1 },
          () => CHAIN[0]!,
        ),
      }),
    ).toThrow(RelayE2eeValidationError);
  });

  it("refuses to emit a transcript over the §7.6 bound", () => {
    // Chain entries are bounded one by one at the direct-signing bound, and
    // enough of them still overrun the transcript bound. §7.6 makes the check
    // the ENCODER's, so the statement is never emitted and never signed, and
    // §7.6.1 forbids fitting it by pruning the chain instead.
    const padded = (length: number): NodeE2eeCapabilityTranscriptInput => ({
      ...capabilityInput,
      continuityChain: Array.from({ length }, () => ({
        transcript: new Uint8Array(E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES),
        signature: new Uint8Array(64),
      })),
    });
    expect(encodeNodeE2eeCapabilityTranscript(padded(4)).byteLength).toBe(4_807);
    expect(() => encodeNodeE2eeCapabilityTranscript(padded(5))).toThrow(
      RelayE2eeCapabilityBoundError,
    );
    expect(() =>
      encodeNodeE2eeCapabilityTranscript(padded(E2EE_CONTINUITY_CHAIN_MAX_LENGTH)),
    ).toThrow(RelayE2eeCapabilityBoundError);
    // The §7.6.1 self-check still names the bound for a transcript it is handed.
    expect(
      nodeE2eeCapabilitySelfCheck({
        hubOrigin: HUB_ORIGIN,
        transcript: new Uint8Array(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + 1),
        envelope: new Uint8Array(E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES),
        statement: new Uint8Array(1_260),
        carrier: new Uint8Array(1_730),
        e2eeVersionMin: 1,
        e2eeVersionMax: 1,
        continuityIdResolved: true,
      }),
    ).toEqual({ kind: "error", failure: "capability_transcript_max_bytes" });
  });

  it("names the failing bound when the encoder refuses, as §7.6.1 requires", () => {
    // §7.6.1 makes an over-long transcript an operator-actionable startup error
    // that NAMES the failing bound. It is the node's own configuration and
    // history — Hub origin length, chain depth — and not peer input, so the
    // detail-free rule that keeps peer material out of logs does not apply, and
    // the encoder must not report it under the same anonymous error as a bad
    // node id or a bad key.
    let error: unknown;
    try {
      encodeNodeE2eeCapabilityTranscript({
        ...capabilityInput,
        continuityChain: Array.from({ length: 5 }, () => ({
          transcript: new Uint8Array(E2EE_DIRECT_SIGNING_TRANSCRIPT_MAX_BYTES),
          signature: new Uint8Array(64),
        })),
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(RelayE2eeCapabilityBoundError);
    if (!(error instanceof RelayE2eeCapabilityBoundError)) return;
    // The name is the §7.6.1 self-check's own, so one vocabulary covers both
    // passes over the same bound.
    expect(error.bound).toBe("capability_transcript_max_bytes");
    expect(error.message).toContain("capability_transcript_max_bytes");
    // Still the module's encoder error, so a caller that does not care which
    // bound failed keeps catching it.
    expect(error).toBeInstanceOf(RelayE2eeValidationError);
    // A name is all it carries: no measured length and nothing out of the
    // failing artifact, which embeds the Hub origin.
    expect(error.message).not.toContain(String(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES));
    expect(String(error)).not.toContain(HUB_ORIGIN);
    // Peer-input validation is unchanged — it stays anonymous.
    let anonymous: unknown;
    try {
      encodeNodeE2eeCapabilityTranscript({ ...capabilityInput, nodeId: "node_bad" });
    } catch (cause) {
      anonymous = cause;
    }
    expect(anonymous).toBeInstanceOf(RelayE2eeValidationError);
    expect(anonymous).not.toBeInstanceOf(RelayE2eeCapabilityBoundError);
  });

  it("refuses to build an envelope over an over-long transcript", () => {
    expect(() =>
      encodeNodeE2eeCapabilitySigningEnvelope(
        new Uint8Array(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + 1),
      ),
    ).toThrow(RelayE2eeValidationError);
    expect(
      encodeNodeE2eeCapabilitySigningEnvelope(new Uint8Array(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES))
        .byteLength,
    ).toBe(E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES);
    expect(() => encodeNodeE2eeCapabilitySigningEnvelope(new Uint8Array(0))).toThrow(
      RelayE2eeValidationError,
    );
  });

  it("reconstructs the prekey cross-signature from the statement's own fields", () => {
    expect(verifyNodeE2eeCapabilityCrossSignature(reconstruction)).toBe(true);
    expect(
      verifyNodeE2eeCapabilityCrossSignature({
        ...reconstruction,
        nodeId: NODE_ID.replace("A", "B"),
      }),
    ).toBe(false);
    expect(
      verifyNodeE2eeCapabilityCrossSignature({
        ...reconstruction,
        prekeyCertificate: {
          ...reconstruction.prekeyCertificate,
          agreementPublicKey: CLIENT_AGREEMENT_PUBLIC_KEY,
          agreementFingerprint: e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC_KEY),
        },
      }),
    ).toBe(false);
    expect(
      verifyNodeE2eeCapabilityCrossSignature({ ...reconstruction, hubOrigin: "not-an-origin" }),
    ).toBe(false);
  });

  it("rejects a statement whose carried fingerprint disagrees with its key", () => {
    // §7.6 builds element 7 of the reconstruction from the statement's CARRIED
    // element 6, so a statement disagreeing with itself reconstructs to bytes
    // the cross-signature does not cover — and the §7.6 recomputation rule
    // refuses the same statement independently. Re-deriving element 6 from the
    // identity key instead would repair the disagreement and admit it.
    expect(
      verifyNodeE2eeCapabilityCrossSignature({
        ...reconstruction,
        identityFingerprint: e2eeKeyFingerprint("node-identity", UNRELATED_PUBLIC_KEY),
      }),
    ).toBe(false);
    // The same rule over the other advertised fingerprint: prekey member 3 is
    // recomputed from member 1 (§7.6).
    expect(
      verifyNodeE2eeCapabilityCrossSignature({
        ...reconstruction,
        prekeyCertificate: {
          ...reconstruction.prekeyCertificate,
          agreementFingerprint: e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC_KEY),
        },
      }),
    ).toBe(false);
    // Material this protocol will not represent at all is a verdict, not a throw.
    expect(
      verifyNodeE2eeCapabilityCrossSignature({
        ...reconstruction,
        identityFingerprint: new Uint8Array(31),
      }),
    ).toBe(false);
  });
});

describe("§7.6.1 statement self-check", () => {
  const passing = {
    hubOrigin: HUB_ORIGIN,
    transcript: new Uint8Array(1_185),
    envelope: new Uint8Array(E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES),
    statement: new Uint8Array(1_260),
    carrier: new Uint8Array(1_730),
    e2eeVersionMin: 1,
    e2eeVersionMax: 1,
    continuityIdResolved: true,
  } as const;

  it("passes a conforming configuration", () => {
    expect(nodeE2eeCapabilitySelfCheck(passing)).toEqual({ kind: "ok" });
  });

  it("names the failing bound instead of shrinking the advertisement", () => {
    const cases = [
      [
        { ...passing, hubOrigin: `https://${"o".repeat(E2EE_HUB_ORIGIN_MAX_BYTES)}.example.com` },
        "hub_origin_max_bytes",
      ],
      [
        { ...passing, transcript: new Uint8Array(E2EE_CAPABILITY_TRANSCRIPT_MAX_BYTES + 1) },
        "capability_transcript_max_bytes",
      ],
      [
        { ...passing, envelope: new Uint8Array(E2EE_CAPABILITY_SIGNING_ENVELOPE_BYTES - 1) },
        "capability_signing_envelope_bytes",
      ],
      [{ ...passing, statement: new Uint8Array(5_191) }, "capability_statement_max_bytes"],
      [{ ...passing, carrier: new Uint8Array(6_970) }, "capability_carrier_max_bytes"],
      [{ ...passing, e2eeVersionMin: 2, e2eeVersionMax: 3 }, "protocol_version_out_of_range"],
      [{ ...passing, e2eeVersionMin: 0, e2eeVersionMax: 0 }, "protocol_version_out_of_range"],
      [{ ...passing, continuityIdResolved: false }, "continuity_id_unresolved"],
    ] as const;
    for (const [input, failure] of cases) {
      expect(nodeE2eeCapabilitySelfCheck(input)).toEqual({ kind: "error", failure });
    }
  });

  it("accepts a range that merely contains the implemented version", () => {
    expect(
      nodeE2eeCapabilitySelfCheck({ ...passing, e2eeVersionMin: 1, e2eeVersionMax: 4 }),
    ).toEqual({ kind: "ok" });
  });
});

describe("§8.3 authorization context and §8.4 prologue", () => {
  it("matches the deterministic native context block and commitment", () => {
    const context = encodeE2eeAuthorizationContext(nativeContextInput);
    expect(hex(context)).toBe(NATIVE_CONTEXT);
    // 0x92 is a definite-length CBOR array of exactly 18 elements (§8.3).
    expect(context[0]).toBe(0x92);
    expect(hex(e2eeAuthorizationContextCommitment(context))).toBe(NATIVE_CONTEXT_COMMITMENT);
  });

  it("applies the NX absence semantics to elements 10 and 16 only", () => {
    const context = encodeE2eeAuthorizationContext(webContextInput);
    expect(hex(context)).toBe(WEB_CONTEXT);
    expect(hex(e2eeAuthorizationContextCommitment(context))).toBe(WEB_CONTEXT_COMMITMENT);
    const decoded = decodeCanonicalE2eeCbor(context);
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") return;
    const elements = decoded.value as readonly unknown[];
    expect(elements).toHaveLength(18);
    expect(elements[10]).toBe("");
    expect(elements[16]).toEqual([]);
    // Element 17 has no absence form: it is nonempty on both tiers (§8.3).
    expect(elements[17]).toBe(CONTINUITY_ID);
  });

  it("builds element 15 from the advertised agreement key and chain digests", () => {
    const decoded = decodeCanonicalE2eeCbor(encodeE2eeAuthorizationContext(nativeContextInput));
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") return;
    const elements = decoded.value as readonly unknown[];
    const fingerprints = elements[15] as readonly Uint8Array[];
    expect(fingerprints.map(hex)).toEqual([
      hex(e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC_KEY)),
      CONTINUITY_1_DIGEST,
      CONTINUITY_2_DIGEST,
    ]);
    // A never-rotated node contributes no chain digest at all.
    const empty = decodeCanonicalE2eeCbor(
      encodeE2eeAuthorizationContext({
        ...nativeContextInput,
        nodeContinuityChainTranscripts: [],
      }),
    );
    if (empty.kind !== "ok") return;
    expect((empty.value as readonly unknown[])[15]).toHaveLength(1);
  });

  it("changes with every element the handshake must agree on", () => {
    const baseline = hex(encodeE2eeAuthorizationContext(nativeContextInput));
    const mutations: readonly E2eeAuthorizationContextInput[] = [
      { ...nativeContextInput, channelId: "ch_HHHHHHHHHHHHHHHHHHHHHH" },
      { ...nativeContextInput, relayProtocolMinor: 3 },
      {
        ...nativeContextInput,
        nodeIdentityFingerprint: e2eeKeyFingerprint("node-identity", UNRELATED_PUBLIC_KEY),
      },
      { ...nativeContextInput, clientIntendedRole: "owner" },
      { ...nativeContextInput, channelOpenEffectiveRole: "viewer" },
      { ...nativeContextInput, nodeContinuityId: "nct_ZZZZZZZZZZZZZZZZZZZZZZ" },
      {
        ...nativeContextInput,
        client: {
          tier: "native",
          accountId: "acct_other",
          identityFingerprint: e2eeKeyFingerprint("client-identity", CLIENT_PUBLIC_KEY),
          agreementFingerprint: e2eeKeyFingerprint("agreement", CLIENT_AGREEMENT_PUBLIC_KEY),
        },
      },
      { ...nativeContextInput, nodeContinuityChainTranscripts: [bytes(CONTINUITY_1_TRANSCRIPT)] },
    ];
    for (const mutation of mutations) {
      expect(hex(encodeE2eeAuthorizationContext(mutation))).not.toBe(baseline);
    }
  });

  it("refuses vocabulary the relay contract does not define", () => {
    expect(() =>
      encodeE2eeAuthorizationContext({ ...nativeContextInput, clientIntendedCapability: "ryco.x" }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeE2eeAuthorizationContext({ ...nativeContextInput, clientIntendedRole: "admin" }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeE2eeAuthorizationContext({ ...nativeContextInput, channelId: "chan_bad" }),
    ).toThrow(RelayE2eeValidationError);
    expect(() => encodeE2eeAuthorizationContext({ ...nativeContextInput, suiteId: 2 })).toThrow(
      RelayE2eeValidationError,
    );
    expect(() => encodeE2eeAuthorizationContext({ ...nativeContextInput, e2eeVersion: 2 })).toThrow(
      RelayE2eeValidationError,
    );
  });

  it("matches the deterministic prologue and binds the commitment", () => {
    const prologueInput = {
      hubOrigin: HUB_ORIGIN,
      channelId: CHANNEL_ID,
      relayProtocolMajor: 1,
      relayProtocolMinor: 2,
      e2eeVersion: 1,
      suiteId: 1,
      nodeId: NODE_ID,
      contextCommitment: bytes(NATIVE_CONTEXT_COMMITMENT),
    } as const;
    const prologue = encodeE2eeNoisePrologue(prologueInput);
    expect(hex(prologue)).toBe(PROLOGUE);
    // 0x89 is a definite-length CBOR array of exactly 9 elements (§8.4).
    expect(prologue[0]).toBe(0x89);
    expect(
      hex(
        encodeE2eeNoisePrologue({
          ...prologueInput,
          contextCommitment: bytes(WEB_CONTEXT_COMMITMENT),
        }),
      ),
    ).not.toBe(PROLOGUE);
    expect(() =>
      encodeE2eeNoisePrologue({ ...prologueInput, contextCommitment: new Uint8Array(31) }),
    ).toThrow(RelayE2eeValidationError);
  });

  it("keeps the context block and the prologue apart over identical channel state", () => {
    // Both carry the same Hub origin, channel id, relay version, E2EE version,
    // suite id, and node id; only the domain and the remaining elements differ.
    const context = hex(encodeE2eeAuthorizationContext(nativeContextInput));
    expect(context).not.toBe(PROLOGUE);
    expect(context.startsWith(PROLOGUE.slice(0, 4))).toBe(false);
  });
});

describe("§7.2 domain separation and §3.6 canonical decoding", () => {
  it("refuses a signature replayed into another transcript domain", () => {
    // One valid signature per domain, replayed into every other domain's
    // verification path: all off-diagonal verifications MUST fail.
    const signed = [
      { message: bytes(NODE_PREKEY_TRANSCRIPT), signature: bytes(NODE_PREKEY_SIGNATURE) },
      { message: bytes(CONTINUITY_1_TRANSCRIPT), signature: bytes(CONTINUITY_1_SIGNATURE) },
      { message: bytes(CAPABILITY_ENVELOPE), signature: bytes(CAPABILITY_SIGNATURE) },
    ] as const;
    const keys = [NODE_PUBLIC_KEY, OLD_PUBLIC_KEY, NODE_PUBLIC_KEY] as const;
    for (let signer = 0; signer < signed.length; signer += 1) {
      for (let target = 0; target < signed.length; target += 1) {
        expect(
          verifyE2eeSignature({
            algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
            publicKey: keys[target]!,
            message: signed[target]!.message,
            signature: signed[signer]!.signature,
          }),
        ).toBe(signer === target);
      }
    }
  });

  it("gives two transcript families different bytes for the same logical inputs", () => {
    // The node prekey certificate and the capability statement carry the same
    // Hub origin, node id, identity key id, identity key, and agreement key.
    const prekey = hex(encodeNodeE2eePrekeyTranscript(nodePrekeyInput));
    const capability = hex(encodeNodeE2eeCapabilityTranscript(capabilityInput));
    expect(prekey).not.toBe(capability);
    // Neither transcript is a prefix of the other: the domain differs at byte 1.
    expect(prekey.slice(0, 8)).not.toBe(capability.slice(0, 8));
  });

  it("exports the canonical array encoder the §12.5 origin hash needs", () => {
    // Exported narrowly and only as an array encoder: §7.2's
    // no-ad-hoc-transcript rule rests on there being one encoder per domain, and
    // §12.5's `originHash` is the one local digest that has no encoder of its
    // own. What it MUST NOT do is become a second definition of "canonical".
    expect(hex(encodeCanonicalE2eeCbor([1]))).toBe("8101");
    expect(decodeCanonicalE2eeCbor(encodeCanonicalE2eeCbor([1]))).toEqual({
      kind: "ok",
      value: [1],
    });
    const originArray = encodeCanonicalE2eeCbor([
      E2EE_FALLBACK_ORIGIN_DOMAIN,
      "https://hub.example.com",
    ]);
    expect(decodeCanonicalE2eeCbor(originArray)).toEqual({
      kind: "ok",
      value: [E2EE_FALLBACK_ORIGIN_DOMAIN, "https://hub.example.com"],
    });
  });

  it("applies the re-encode equality rule", () => {
    expect(decodeCanonicalE2eeCbor(bytes("8101"))).toEqual({ kind: "ok", value: [1] });
    // Indefinite-length, non-shortest integers, and trailing bytes are all
    // refused: they decode, but not to bytes a signature could cover.
    expect(decodeCanonicalE2eeCbor(bytes("9f01ff")).kind).toBe("error");
    expect(decodeCanonicalE2eeCbor(bytes("811801")).kind).toBe("error");
    expect(decodeCanonicalE2eeCbor(bytes("810100")).kind).toBe("error");
    expect(decodeCanonicalE2eeCbor(bytes("")).kind).toBe("error");
    expect(decodeCanonicalE2eeCbor(bytes("f97e00")).kind).toBe("error");
  });

  it("rejects every floating-point value, finite ones included", () => {
    // §3.6 forbids floats outright, which the option list alone does not deliver:
    // it refuses NaN and the infinities only, and a shortest-form finite float
    // re-encodes to itself, so the re-encode rule does not catch one either.
    // `f9 3e00` is float16 1.5 and `fb 3ff8000000000000` is the same value as a
    // float64; the first survives both of those checks today.
    for (const float of [
      "f93e00",
      "fb3ff8000000000000",
      "fa3fc00000",
      // The largest finite float32 — integral, shortest-form, and byte-identical
      // after re-encoding, so only the structural rule sees it.
      "fa7f7fffff",
      // Nested in an array, in a map value, and in a map key.
      "81f93e00",
      "a163666f6ff93e00",
      "a1f93e0001",
    ]) {
      expect(decodeCanonicalE2eeCbor(bytes(float))).toEqual({
        kind: "error",
        reason: "float_forbidden",
      });
    }
    // NaN and the infinities never decode at all (§3.6 `allowNaN`,
    // `allowInfinity`), so they are refused one step earlier.
    for (const nonFinite of ["f97e00", "f97c00", "f9fc00"]) {
      expect(decodeCanonicalE2eeCbor(bytes(nonFinite))).toEqual({
        kind: "error",
        reason: "malformed",
      });
    }
    // A float that decodes to a safe integer is still a float, and the REASON
    // says so. `f9 3c00` is float16 1.0, `fa 3f800000` is the float32 of the
    // same value, `fb 3ff0000000000000` the float64, and `fb 4059000000000000`
    // is 100.0: each reaches JavaScript as a value nothing can tell from the
    // integer, and each re-encodes to the integer's bytes, so a value-level rule
    // leaves all four to the re-encode rule and mislabels them `non_canonical`.
    // Negative zero is the same story with no integer to be confused with.
    for (const integralFloat of [
      "f93c00",
      "fa3f800000",
      "fb3ff0000000000000",
      "fb4059000000000000",
      "f98000",
      // Nested, in a map key, and beside a genuine integer.
      "82f93c0001",
      "a1fb4059000000000000f93c00",
    ]) {
      expect(decodeCanonicalE2eeCbor(bytes(integralFloat))).toEqual({
        kind: "error",
        reason: "float_forbidden",
      });
    }
    // Content bytes that merely LOOK like a float head are not one: the walk
    // skips a byte or text string's payload by its length. `43 f93c00` is a
    // 3-byte string whose content is exactly the float16 1.0 encoding.
    expect(decodeCanonicalE2eeCbor(bytes("43f93c00"))).toEqual({
      kind: "ok",
      value: bytes("f93c00"),
    });
    // Integers at the edge of the safe range are integers, and stay accepted.
    expect(decodeCanonicalE2eeCbor(bytes("1b001fffffffffffff"))).toEqual({
      kind: "ok",
      value: 9_007_199_254_740_991,
    });
    expect(decodeCanonicalE2eeCbor(bytes("01"))).toEqual({ kind: "ok", value: 1 });
    expect(decodeCanonicalE2eeCbor(bytes("1864"))).toEqual({ kind: "ok", value: 100 });
  });

  it("returns a stable validation error that reflects nothing", () => {
    const canary = "private-hub-origin-canary";
    let error: unknown;
    try {
      encodeNodeE2eePrekeyTranscript({
        ...nodePrekeyInput,
        hubOrigin: `https://${canary}.example.com/internal`,
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(RelayE2eeValidationError);
    expect(String(error)).not.toContain(canary);
  });
});
