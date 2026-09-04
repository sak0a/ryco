import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_CAPABILITY_CARRIER_MAX_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
  E2EE_CAPABILITY_STATEMENT_VALIDITY,
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PROTOCOL_VERSION,
  RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
} from "@ryco/shared/relayE2eeConstants";
import {
  deriveE2eeAgreementPublicKey,
  e2eeKeyFingerprint,
  e2eeSha256,
  verifyE2eeSignature,
} from "@ryco/shared/relayE2eeKeys";
import {
  decodeCanonicalE2eeCbor,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eePrekeyTranscript,
  verifyNodeE2eeCapabilityCrossSignature,
} from "@ryco/shared/relayE2eeTranscripts";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";

import {
  makeNodeE2eeCapabilityStatementClient,
  type NodeE2eeCapabilityContinuity,
  type NodeE2eeCapabilityIdentity,
} from "./NodeE2eeCapabilityStatement.ts";
import {
  effectiveNodeE2eePolicy,
  NODE_E2EE_FAIL_CLOSED_POLICY,
  type EffectiveNodeE2eePolicy,
} from "./NodeE2eePolicyStore.ts";
import type { NodeE2eePrekeyCertificate } from "./NodeE2eePrekeyClient.ts";

// Test-only key material, conspicuously so: every private key here is generated
// per run and never leaves the process.

const HUB_ORIGIN = "https://relay.example";
const NODE_ID = `node_${"N".repeat(22)}`;
const IDENTITY_KEY_ID = `nkey_${"K".repeat(22)}`;
const PREKEY_ID = `epk_${"P".repeat(22)}`;
const CONTINUITY_ID = `nct_${"C".repeat(22)}`;

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function identityKeyPair(): {
  readonly publicKey: Uint8Array;
  readonly sign: (message: Uint8Array) => Uint8Array;
} {
  const { privateKey } = generateKeyPairSync("ed25519");
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const der = Buffer.from(privateKey.export({ format: "der", type: "pkcs8" }));
  return {
    publicKey: Uint8Array.from(spki.subarray(SPKI_PREFIX.byteLength)),
    sign: (message) =>
      Uint8Array.from(
        sign(null, message, createPrivateKey({ key: der, format: "der", type: "pkcs8" })),
      ),
  };
}

const AGREEMENT_PUBLIC = deriveE2eeAgreementPublicKey(new Uint8Array(32).fill(0x31));

function prekeyCertificate(
  key: ReturnType<typeof identityKeyPair>,
  overrides: Partial<NodeE2eePrekeyCertificate> = {},
): NodeE2eePrekeyCertificate {
  const createdAt = overrides.createdAt ?? 1_000;
  const expiresAt = overrides.expiresAt ?? 9_000_000;
  const agreementPublicKey = overrides.agreementPublicKey ?? AGREEMENT_PUBLIC;
  const prekeyId = overrides.prekeyId ?? PREKEY_ID;
  return {
    hubOrigin: HUB_ORIGIN,
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    prekeyId,
    agreementPublicKey,
    createdAt,
    expiresAt,
    crossSignature: key.sign(
      encodeNodeE2eePrekeyTranscript({
        hubOrigin: HUB_ORIGIN,
        nodeId: NODE_ID,
        identityKeyId: IDENTITY_KEY_ID,
        prekeyId,
        identityPublicKey: key.publicKey,
        agreementPublicKey,
        createdAt,
        expiresAt,
      }),
    ),
    ...overrides,
  } as NodeE2eePrekeyCertificate;
}

interface Harness {
  client: ReturnType<typeof makeNodeE2eeCapabilityStatementClient>;
  readonly key: ReturnType<typeof identityKeyPair>;
  signCalls: number;
  policy: EffectiveNodeE2eePolicy;
  generation: number;
  prekey: NodeE2eePrekeyCertificate;
  continuity: NodeE2eeCapabilityContinuity | undefined;
  now: number;
  identityFailure: boolean;
  signFailure: boolean;
}

function harness(overrides: Partial<Harness> = {}): Harness {
  const key = identityKeyPair();
  const state: Harness = {
    key,
    signCalls: 0,
    policy: effectiveNodeE2eePolicy({
      mode: "compatibility",
      requireE2EE: false,
      requireApprovedClientE2EE: false,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    }),
    generation: 7,
    prekey: prekeyCertificate(key),
    continuity: { continuityId: CONTINUITY_ID, chain: [] },
    now: 1_700_000_000_000,
    identityFailure: false,
    signFailure: false,
    client: undefined as never,
  };
  Object.assign(state, overrides);
  const identity: NodeE2eeCapabilityIdentity = {
    nodeId: NODE_ID,
    identityKeyId: IDENTITY_KEY_ID,
    identityPublicKey: key.publicKey,
    sign: async (envelope) => {
      state.signCalls += 1;
      if (state.signFailure) throw new Error("signing refused");
      return key.sign(envelope);
    },
  };
  state.client = makeNodeE2eeCapabilityStatementClient({
    identity: async () => {
      if (state.identityFailure) throw new Error("no identity");
      return identity;
    },
    prekey: async () => state.prekey,
    continuity: async () => state.continuity,
    policy: () => state.policy,
    generation: () => state.generation,
    now: () => state.now,
  });
  return state;
}

function available(result: Awaited<ReturnType<Harness["client"]["advertised"]>>) {
  if (result.kind !== "available") throw new Error(`unavailable: ${result.reason}`);
  return result.advertisement;
}

function transcriptElements(transcript: Uint8Array): readonly unknown[] {
  const decoded = decodeCanonicalE2eeCbor(transcript);
  if (decoded.kind !== "ok" || !Array.isArray(decoded.value)) {
    throw new Error("transcript is not a canonical CBOR array");
  }
  return decoded.value;
}

describe("NodeE2eeCapabilityStatement", () => {
  it("builds a statement the Phase 1 verifier accepts, end to end (§5.2, §7.2.1, §7.6)", async () => {
    const state = harness();
    const advertisement = available(await state.client.advertised(HUB_ORIGIN));

    // §5.2 step 1: the envelope is REBUILT LOCALLY from the exact transcript
    // bytes, and no digest is carried on the wire.
    expect(
      verifyE2eeSignature({
        algorithm: "ed25519",
        publicKey: state.key.publicKey,
        message: encodeNodeE2eeCapabilitySigningEnvelope(advertisement.transcript),
        signature: advertisement.signature,
      }),
    ).toBe(true);

    // §7.6: the wire form is `[ bstr(transcript), bstr(signature) ]` and nothing
    // else — in particular no digest a verifier might be tempted to accept.
    const decoded = decodeCanonicalE2eeCbor(advertisement.statement);
    expect(decoded.kind).toBe("ok");
    const wire = decoded.kind === "ok" ? (decoded.value as readonly Uint8Array[]) : [];
    expect(wire).toHaveLength(2);
    expect(Uint8Array.from(wire[0]!)).toEqual(advertisement.transcript);
    expect(Uint8Array.from(wire[1]!)).toEqual(advertisement.signature);
    expect(advertisement.statementDigest).toEqual(e2eeSha256(advertisement.statement));

    const elements = transcriptElements(advertisement.transcript);
    expect(elements).toHaveLength(19);
    expect(elements[0]).toBe("ryco.node-e2ee-capability.v1");
    expect(elements[1]).toBe(HUB_ORIGIN);
    expect(elements[2]).toBe(NODE_ID);
    // §7.6 elements 7–8: version 1 offers exactly the version it implements.
    expect(elements[7]).toBe(E2EE_PROTOCOL_VERSION);
    expect(elements[8]).toBe(E2EE_PROTOCOL_VERSION);
    // §7.6 element 14 is DERIVED from the raw policy, never configured.
    expect(elements[14]).toEqual(["IK", "NX"]);
    expect(elements[15]).toBe(7);
    expect(elements[18]).toBe(CONTINUITY_ID);

    // §7.6's cross-signature reconstruction — the same verifier a client runs —
    // over the statement's OWN carried fields.
    const prekey = elements[10] as readonly unknown[];
    expect(
      verifyNodeE2eeCapabilityCrossSignature({
        hubOrigin: elements[1] as string,
        nodeId: elements[2] as string,
        identityKeyId: elements[4] as string,
        identityPublicKey: Uint8Array.from(elements[5] as Uint8Array),
        identityFingerprint: Uint8Array.from(elements[6] as Uint8Array),
        prekeyCertificate: {
          prekeyId: prekey[0] as string,
          agreementPublicKey: Uint8Array.from(prekey[1] as Uint8Array),
          crossSignature: Uint8Array.from(prekey[2] as Uint8Array),
          agreementFingerprint: Uint8Array.from(prekey[3] as Uint8Array),
          createdAt: prekey[4] as number,
          expiresAt: prekey[5] as number,
        },
      }),
    ).toBe(true);

    // §5.7 validity interval, and §5.3's carrier.
    expect(advertisement.issuedAt).toBe(state.now);
    expect(advertisement.expiresAt).toBe(state.now + E2EE_CAPABILITY_STATEMENT_VALIDITY);
    const carrier = JSON.parse(new TextDecoder().decode(advertisement.carrier)) as Readonly<
      Record<string, string>
    >;
    expect(Object.keys(carrier)).toEqual(["_tag", "statement"]);
    expect(carrier._tag).toBe(E2EE_CAPABILITY_CARRIER_TAG);
    expect(advertisement.carrier.byteLength).toBeLessThanOrEqual(E2EE_CAPABILITY_CARRIER_MAX_BYTES);
    // §5.5's fit, with the full prelude headroom, at the advertisement floor.
    expect(
      advertisement.carrier.byteLength + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
    ).toBeLessThanOrEqual(E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES);

    // §8.3's per-channel snapshot agrees with the statement it was built from.
    expect(advertisement.material.nodeId).toBe(NODE_ID);
    expect(advertisement.material.prekeyId).toBe(PREKEY_ID);
    expect(advertisement.material.continuityId).toBe(CONTINUITY_ID);
    expect(advertisement.material.policyGeneration).toBe(7);
    expect(advertisement.material.capabilityStatementDigest).toEqual(advertisement.statementDigest);
    expect(advertisement.material.nodeIdentityFingerprint).toEqual(
      e2eeKeyFingerprint("node-identity", state.key.publicKey),
    );
  });

  it('advertises `["IK"]` under requireApprovedClientE2EE (§7.6 element 14, §12.4)', async () => {
    const state = harness({
      policy: effectiveNodeE2eePolicy({
        mode: "require-locally-approved-native-e2ee",
        requireE2EE: false,
        requireApprovedClientE2EE: true,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      }),
    });
    const advertisement = available(await state.client.advertised(HUB_ORIGIN));
    const elements = transcriptElements(advertisement.transcript);
    // The RAW pair is carried; the derived set is IK-only.
    expect(elements[12]).toBe(false);
    expect(elements[13]).toBe(true);
    expect(elements[14]).toEqual(["IK"]);
  });

  it("reuses one signature while §5.7 permits, and never past the skew margin", async () => {
    const state = harness();
    const first = available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(1);

    // Nothing moved: the same bytes, and no second signing call.
    state.now += 1_000;
    const second = available(await state.client.advertised(HUB_ORIGIN));
    expect(second.statement).toBe(first.statement);
    expect(state.signCalls).toBe(1);

    // Reuse stops a full `E2EE_MAX_CLOCK_SKEW` before expiry, so a statement
    // this node hands out is live at every conforming verifier that gets it.
    state.now = first.expiresAt - E2EE_MAX_CLOCK_SKEW;
    const third = available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(2);
    expect(third.issuedAt).toBe(state.now);

    // A clock that moved backwards past `issuedAt` also ends reuse: a statement
    // issued in a verifier's future fails §5.7 outright.
    state.now = third.issuedAt - 1;
    available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(3);
  });

  it("invalidates the cached statement on a policy, prekey, or rotation change (§5.7)", async () => {
    const state = harness();
    const first = available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(1);

    // A policy change: the generation moves, so the cached statement is not the
    // one to advertise, whatever its validity interval still says.
    state.generation = 8;
    const afterGeneration = available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(2);
    expect(afterGeneration.policyGeneration).toBe(8);
    expect(afterGeneration.statement).not.toEqual(first.statement);

    // The advertised policy values themselves, at the same generation: still a
    // different statement, because the transcript carries them.
    state.policy = effectiveNodeE2eePolicy({
      mode: "require-e2ee",
      requireE2EE: true,
      requireApprovedClientE2EE: false,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    });
    const afterPolicy = available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(3);
    expect(afterPolicy.statement).not.toEqual(afterGeneration.statement);

    // A prekey rotation.
    const rotatedId = `epk_${"Q".repeat(22)}`;
    state.prekey = prekeyCertificate(state.key, { prekeyId: rotatedId });
    const afterPrekey = available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(4);
    expect(afterPrekey.material.prekeyId).toBe(rotatedId);

    // A rotation appending to the §7.5 chain.
    state.continuity = {
      continuityId: CONTINUITY_ID,
      chain: [{ transcript: Uint8Array.of(1, 2, 3), signature: new Uint8Array(64).fill(9) }],
    };
    const afterChain = available(await state.client.advertised(HUB_ORIGIN));
    expect(state.signCalls).toBe(5);
    expect(afterChain.material.continuityChainTranscripts).toHaveLength(1);

    // And a widening back to the original values is still a NEW statement, not
    // the resurrected first one: the generation never goes backwards.
    expect(afterChain.statement).not.toEqual(first.statement);
  });

  it("signs once when several channels open at the same instant", async () => {
    const state = harness();
    const results = await Promise.all([
      state.client.advertised(HUB_ORIGIN),
      state.client.advertised(HUB_ORIGIN),
      state.client.advertised(HUB_ORIGIN),
    ]);
    expect(state.signCalls).toBe(1);
    const statements = results.map((result) => available(result).statement);
    expect(statements[1]).toBe(statements[0]);
    expect(statements[2]).toBe(statements[0]);
  });

  it("reports each §5.5 U2 condition as its own reason and advertises nothing", async () => {
    const identityless = harness({ identityFailure: true });
    await expect(identityless.client.advertised(HUB_ORIGIN)).resolves.toEqual({
      kind: "unavailable",
      reason: "identity_unavailable",
    });

    // §7.5's unresolvable state: a node that cannot prove which lineage it
    // belongs to declines to advertise rather than asserting a fresh one.
    const lineageless = harness({ continuity: undefined });
    await expect(lineageless.client.advertised(HUB_ORIGIN)).resolves.toEqual({
      kind: "unavailable",
      reason: "continuity_id_unresolved",
    });

    const unsignable = harness({ signFailure: true });
    await expect(unsignable.client.advertised(HUB_ORIGIN)).resolves.toEqual({
      kind: "unavailable",
      reason: "signing_failed",
    });

    // §12.4's fail-closed policy publishes generation 0 until a durable read
    // succeeds, and 0 is the generation this node has never advertised.
    const unread = harness({ policy: NODE_E2EE_FAIL_CLOSED_POLICY, generation: 0 });
    await expect(unread.client.advertised(HUB_ORIGIN)).resolves.toEqual({
      kind: "unavailable",
      reason: "policy_unavailable",
    });

    // An origin no conforming statement can carry (§7.1, §5.5 U2).
    const overlong = harness();
    await expect(overlong.client.advertised(`https://${"a".repeat(200)}.example`)).resolves.toEqual(
      { kind: "unavailable", reason: "hub_origin_max_bytes" },
    );
  });

  it("refuses to advertise a signature it cannot verify itself", async () => {
    // A custody backend that returns well-formed bytes over the wrong key, or
    // over nothing at all. Emitting this would put an unverifiable statement in
    // front of every client this node serves, and each would read it as an
    // identity event rather than as a node-local fault.
    const state = harness();
    const stranger = identityKeyPair();
    state.client = makeNodeE2eeCapabilityStatementClient({
      identity: async () => ({
        nodeId: NODE_ID,
        identityKeyId: IDENTITY_KEY_ID,
        identityPublicKey: state.key.publicKey,
        sign: async (envelope) => stranger.sign(envelope),
      }),
      prekey: async () => state.prekey,
      continuity: async () => state.continuity,
      policy: () => state.policy,
      generation: () => state.generation,
      now: () => state.now,
    });
    await expect(state.client.advertised(HUB_ORIGIN)).resolves.toEqual({
      kind: "unavailable",
      reason: "signing_failed",
    });
  });

  it("drops a superseded statement even when the rebuild fails", async () => {
    const state = harness();
    const first = available(await state.client.advertised(HUB_ORIGIN));

    // Something advertised changed AND the node can no longer sign. The stale
    // statement must not remain reachable just because its replacement failed.
    state.generation = 9;
    state.signFailure = true;
    await expect(state.client.advertised(HUB_ORIGIN)).resolves.toEqual({
      kind: "unavailable",
      reason: "signing_failed",
    });

    state.signFailure = false;
    const rebuilt = available(await state.client.advertised(HUB_ORIGIN));
    expect(rebuilt.policyGeneration).toBe(9);
    expect(rebuilt.statement).not.toEqual(first.statement);
  });
});
