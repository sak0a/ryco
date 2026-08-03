// The app's `tsconfig` is the react-native one, which resolves no Node builtins;
// this test runs under Node, so it pulls the types in for itself.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// `extra` is per-test data here: the dev hook's gate reads `appVariant` off it.
const constantsHolder = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return { extra: constantsHolder.extra };
    },
  },
}));

import {
  E2EE_VECTOR_RUNNER_GLOBAL,
  E2EE_VECTOR_SUITE_CASES,
  installE2eeVectorRunnerDevHook,
  runE2eeVectorSuite,
  testOnlyEmbeddedVectors,
} from "./e2eeVectorRunner";

/**
 * The corpus is deliberately NOT bundled (844 KB), so the runner carries a
 * transcribed subset. Read the real fixture families here — this file runs under
 * Node, where `node:fs` is available and the Metro bundle is not involved — and
 * prove every transcribed value is still the corpus's.
 */
const FIXTURE_ROOT = new URL("../../../../packages/shared/fixtures/e2ee/v1/", import.meta.url);

interface CorpusBytes {
  readonly $bytes: string;
}

interface CorpusFamily {
  readonly cases: readonly {
    readonly name: string;
    readonly inputs: Record<string, unknown>;
    readonly expected: Record<string, unknown>;
  }[];
}

function readFamily(file: string): CorpusFamily {
  return JSON.parse(
    new TextDecoder().decode(readFileSync(new URL(file, FIXTURE_ROOT))),
  ) as CorpusFamily;
}

function findCase(family: CorpusFamily, name: string): CorpusFamily["cases"][number] {
  const entry = family.cases.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`missing corpus case ${name}`);
  return entry;
}

/** §16.2 byte strings are `{"$bytes": "<lowercase hex>"}` and nothing else. */
function corpusHex(value: unknown): string {
  const wrapper = value as CorpusBytes;
  expect(Object.keys(wrapper)).toEqual(["$bytes"]);
  expect(wrapper.$bytes).toMatch(/^(?:[\da-f]{2})*$/);
  return wrapper.$bytes;
}

describe("mobile on-device E2EE vector runner", () => {
  beforeEach(() => {
    constantsHolder.extra = {};
    Reflect.deleteProperty(globalThis, E2EE_VECTOR_RUNNER_GLOBAL);
  });

  it("passes every case it carries", async () => {
    const result = await runE2eeVectorSuite();
    expect(result.checks.map((check) => check.name)).toEqual([...E2EE_VECTOR_SUITE_CASES]);
    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports a bounded verdict rather than throwing when a case fails", async () => {
    const result = await runE2eeVectorSuite({ crypto: undefined, TextEncoder: undefined });
    expect(result.ok).toBe(false);
    // The failing case names itself and carries nothing else — no bytes, no cause.
    const failed = result.checks.find((check) => !check.ok);
    expect(failed).toEqual({ name: E2EE_VECTOR_SUITE_CASES[0], ok: false });
    expect(Object.keys(failed!)).toEqual(["name", "ok"]);
  });

  it("installs the dev hook only for the development variant", () => {
    const host: Record<string, unknown> = {};

    constantsHolder.extra = { appVariant: "production" };
    installE2eeVectorRunnerDevHook(host);
    expect(host[E2EE_VECTOR_RUNNER_GLOBAL]).toBeUndefined();

    constantsHolder.extra = { appVariant: "preview" };
    installE2eeVectorRunnerDevHook(host);
    expect(host[E2EE_VECTOR_RUNNER_GLOBAL]).toBeUndefined();

    constantsHolder.extra = {};
    installE2eeVectorRunnerDevHook(host);
    expect(host[E2EE_VECTOR_RUNNER_GLOBAL]).toBeUndefined();

    constantsHolder.extra = { appVariant: "development" };
    installE2eeVectorRunnerDevHook(host);
    expect(host[E2EE_VECTOR_RUNNER_GLOBAL]).toBe(runE2eeVectorSuite);
    expect(Object.keys(host)).toEqual([]);
  });
});

describe("embedded vectors match the checked-in corpus", () => {
  it("F15 cacophony Noise_IK_25519_ChaChaPoly_SHA256", () => {
    const vector = testOnlyEmbeddedVectors.f15Ik;
    const { inputs, expected } = findCase(
      readFamily("f15-noise-core-vectors.json"),
      "cacophony/Noise_IK_25519_ChaChaPoly_SHA256",
    );
    expect(inputs.pattern).toBe("IK");
    expect(corpusHex(inputs.initiatorPrologue)).toBe(vector.prologue);
    expect(corpusHex(inputs.responderPrologue)).toBe(vector.prologue);
    expect(corpusHex(inputs.testOnlyInitiatorStaticSecretKey)).toBe(
      vector.initiatorStaticSecretKey,
    );
    expect(corpusHex(inputs.testOnlyInitiatorEphemeralSecretKey)).toBe(
      vector.initiatorEphemeralSecretKey,
    );
    expect(corpusHex(inputs.testOnlyInitiatorRemoteStaticPublicKey)).toBe(
      vector.initiatorRemoteStaticPublicKey,
    );
    expect(corpusHex(inputs.testOnlyResponderStaticSecretKey)).toBe(
      vector.responderStaticSecretKey,
    );
    expect(corpusHex(inputs.testOnlyResponderEphemeralSecretKey)).toBe(
      vector.responderEphemeralSecretKey,
    );
    expect((inputs.handshakePayloads as unknown[]).map(corpusHex)).toEqual([
      ...vector.handshakePayloads,
    ]);
    expect((expected.handshakeMessages as unknown[]).map(corpusHex)).toEqual([
      ...vector.handshakeMessages,
    ]);
    expect(corpusHex(expected.handshakeHash)).toBe(vector.handshakeHash);
  });

  it("F6 ik-handshake-complete-trace", () => {
    const vector = testOnlyEmbeddedVectors.f6Ik;
    const { expected } = findCase(
      readFamily("f06-ik-handshake.json"),
      "ik-handshake-complete-trace",
    );
    expect(corpusHex(expected.sessionBindingHash)).toBe(vector.sessionBindingHash);
    expect(corpusHex(expected.epochSecretC2N)).toBe(vector.epochSecretC2N);
    expect(corpusHex(expected.epochSecretN2C)).toBe(vector.epochSecretN2C);
    expect(corpusHex(expected.exporterSecret)).toBe(vector.exporterSecret);
    expect(corpusHex(expected.serverConfirmationKey)).toBe(vector.serverConfirmationKey);

    const envelopes = expected.firstProtectedEnvelopes as Record<string, Record<string, unknown>>;
    for (const [key, embedded] of [
      ["clientToNode", vector.clientToNode],
      ["nodeToClient", vector.nodeToClient],
    ] as const) {
      expect(corpusHex(envelopes[key]!.innerBody)).toBe(embedded.innerBody);
      expect(corpusHex(envelopes[key]!.envelope)).toBe(embedded.envelope);
      expect(corpusHex(envelopes[key]!.aad)).toBe(embedded.aad);
    }
  });

  it("F4 valid-node-agreement-prekey-certificate", () => {
    const vector = testOnlyEmbeddedVectors.f4NodePrekey;
    const { inputs, expected } = findCase(
      readFamily("f04-prekey-certificates.json"),
      "valid-node-agreement-prekey-certificate",
    );
    expect(inputs.hubOrigin).toBe(vector.hubOrigin);
    expect(inputs.nodeId).toBe(vector.nodeId);
    expect(inputs.identityKeyId).toBe(vector.identityKeyId);
    expect(inputs.prekeyId).toBe(vector.prekeyId);
    expect(inputs.createdAt).toBe(vector.createdAt);
    expect(inputs.expiresAt).toBe(vector.expiresAt);
    expect(corpusHex(inputs.identityPublicKey)).toBe(vector.identityPublicKey);
    expect(corpusHex(inputs.agreementPublicKey)).toBe(vector.agreementPublicKey);
    expect(expected.transcriptBytes).toBe(vector.transcriptBytes);
    expect(corpusHex(expected.identityFingerprint)).toBe(vector.identityFingerprint);
    expect(corpusHex(expected.crossSignature)).toBe(vector.crossSignature);
  });

  it("F13 node-identity-key-fingerprint and the shared agreement secret", () => {
    const vector = testOnlyEmbeddedVectors.f13NodeIdentity;
    const family = readFamily("f13-fingerprints.json");
    expect(findCase(family, "node-identity-key-fingerprint").expected.display).toBe(
      vector.fingerprintDisplay,
    );
    const material = (
      JSON.parse(
        new TextDecoder().decode(readFileSync(new URL("f13-fingerprints.json", FIXTURE_ROOT))),
      ) as { readonly testKeyMaterial: Record<string, unknown> }
    ).testKeyMaterial;
    expect(corpusHex(material.testOnlyNodeAgreementSecretKey)).toBe(vector.agreementSecretKey);
    expect(corpusHex(material.nodeAgreementPublicKey)).toBe(
      testOnlyEmbeddedVectors.f4NodePrekey.agreementPublicKey,
    );
  });
});
