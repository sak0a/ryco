import { readFileSync } from "node:fs";

import { sha256 } from "@noble/hashes/sha2";
import { describe, expect, it } from "vite-plus/test";

import {
  IndependentRecordRejection,
  composeIndependentNoise,
  decodeIndependentCanonicalCbor,
  independentRecordAad,
  protectIndependentRecord,
  ratchetIndependentEpoch,
  unprotectIndependentRecord,
  validateIndependentP256PublicKey,
  validateIndependentP256Signature,
} from "./reference.ts";

interface FixtureBytes {
  readonly $bytes: string;
}

interface FixtureCase {
  readonly name: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>>;
}

interface FixtureFamily {
  readonly testKeyMaterial: Readonly<Record<string, unknown>>;
  readonly cases: readonly FixtureCase[];
}

const FIXTURE_ROOT = new URL("../../fixtures/e2ee/v1/", import.meta.url);

function family(file: string): FixtureFamily {
  return JSON.parse(readFileSync(new URL(file, FIXTURE_ROOT), "utf8")) as FixtureFamily;
}

function fixtureCase(value: FixtureFamily, name: string): FixtureCase {
  const found = value.cases.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing fixture case ${name}`);
  return found;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture record expected");
  }
  return value as Readonly<Record<string, unknown>>;
}

function bytes(value: unknown): Uint8Array {
  const wrapper = record(value) as unknown as FixtureBytes;
  if (!/^(?:[0-9a-f]{2})*$/u.test(wrapper.$bytes)) throw new Error("fixture bytes expected");
  return Uint8Array.from(Buffer.from(wrapper.$bytes, "hex"));
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function expectBytes(actual: Uint8Array, expected: unknown): void {
  expect(hex(actual)).toBe(hex(bytes(expected)));
}

function expectRecordRejection(
  run: () => Uint8Array,
  reason: IndependentRecordRejection["reason"],
): void {
  let released: Uint8Array | undefined;
  let failure: unknown;
  try {
    released = run();
  } catch (error) {
    failure = error;
  }
  expect(released).toBeUndefined();
  expect(failure).toBeInstanceOf(IndependentRecordRejection);
  expect(failure).toMatchObject({
    name: "IndependentRecordRejection",
    message: "Independent record rejected.",
    reason,
  });
}

describe("import-isolated straight-line E2EE reference", () => {
  it("replays the actual Ryco IK and NX Noise bindings without production E2EE imports", () => {
    for (const [file, pattern] of [
      ["f06-ik-handshake.json", "IK"],
      ["f07-nx-handshake.json", "NX"],
    ] as const) {
      const fixture = family(file);
      const entry = fixture.cases[0];
      if (entry === undefined) throw new Error("handshake fixture is empty");
      const material = fixture.testKeyMaterial;
      const result = composeIndependentNoise({
        pattern,
        prologue: bytes(entry.expected.prologue),
        initiatorStaticSecret:
          pattern === "IK" ? bytes(material.testOnlyClientAgreementSecretKey) : undefined,
        initiatorEphemeralSecret: bytes(material.testOnlyClientEphemeralSecretKey),
        responderStaticSecret: bytes(material.testOnlyNodeAgreementSecretKey),
        responderEphemeralSecret: bytes(material.testOnlyNodeEphemeralSecretKey),
        message1Payload: bytes(entry.expected.message1PayloadPlaintext),
        message2Payload: bytes(entry.expected.message2PayloadPlaintext),
      });

      expectBytes(result.message1, entry.expected.noiseMessage1);
      expectBytes(result.message2, entry.expected.noiseMessage2);
      expectBytes(result.handshakeHash, entry.expected.noiseHandshakeHash);
      expectBytes(result.chainingKeyFinal, entry.expected.noiseChainingKeyFinal);
      expectBytes(result.exporterSecret, entry.expected.exporterSecret);
      expectBytes(result.splitFirst, entry.expected.epochSecretC2N);
      expectBytes(result.splitSecond, entry.expected.epochSecretN2C);
    }
  });

  it("re-derives both F9 schedules and erases each owned predecessor", () => {
    const fixture = family("f09-rekey-boundaries.json");
    for (const name of ["epoch-key-schedule-client-to-node", "epoch-key-schedule-node-to-client"]) {
      const entry = fixtureCase(fixture, name);
      const directionLabel = bytes(entry.inputs.directionLabel);
      const epochs = entry.expected.epochs;
      if (!Array.isArray(epochs)) throw new Error("epoch list expected");
      let epochSecret = bytes(entry.inputs.epochSecretZero);
      for (const epochValue of epochs) {
        const epoch = record(epochValue);
        expectBytes(epochSecret, epoch.epochSecret);
        const owned = Uint8Array.from(epochSecret);
        const derived = ratchetIndependentEpoch(owned, directionLabel);
        expectBytes(derived.aeadKey, epoch.aeadKey);
        expectBytes(derived.nextEpochSecret, epoch.nextEpochSecret);
        expect([...owned]).toEqual(Array.from({ length: 32 }, () => 0));
        epochSecret = derived.nextEpochSecret;
      }
    }
  });

  it("rebuilds the production maximum from its bounded fill recipe", () => {
    const fixture = family("f01-payload-discrimination.json");
    const entry = fixtureCase(
      fixture,
      "production-inner-body-exactly-at-the-plaintext-ceiling-recipe",
    );
    const recipe = record(record(entry.inputs.body).$recipe);
    expect(recipe.kind).toBe("fill");
    const bodyBytes = recipe.bytes;
    const fillByte = recipe.byte;
    if (
      typeof bodyBytes !== "number" ||
      !Number.isSafeInteger(bodyBytes) ||
      bodyBytes < 0 ||
      bodyBytes > 4_194_304 ||
      typeof fillByte !== "number" ||
      !Number.isInteger(fillByte) ||
      fillByte < 0 ||
      fillByte > 255
    ) {
      throw new Error("invalid bounded fill recipe");
    }
    const schedule = ratchetIndependentEpoch(
      bytes(entry.inputs.epochSecret),
      new TextEncoder().encode(String(entry.inputs.direction)),
    );
    const envelope = protectIndependentRecord({
      aeadKey: schedule.aeadKey,
      sessionBindingHash: bytes(entry.inputs.sessionBindingHash),
      directionLabel: new TextEncoder().encode(String(entry.inputs.direction)),
      suite: Number(entry.inputs.suite),
      epoch: BigInt(Number(entry.inputs.epoch)),
      counter: BigInt(Number(entry.inputs.counter)),
      innerType: Number(entry.inputs.innerType),
      body: new Uint8Array(bodyBytes).fill(fillByte),
    });
    expect(envelope.byteLength).toBe(entry.expected.envelopeBytes);
    expect(hex(sha256(envelope))).toBe(entry.expected.envelopeSha256);
    expectBytes(envelope.subarray(0, 32), entry.expected.envelopePrefix);
    expectBytes(envelope.subarray(-32), entry.expected.envelopeSuffix);
  });

  it("reproduces F8 records and rejects every authenticated binding mutation", () => {
    const fixture = family("f08-record-protection.json");
    const handshake = family("f06-ik-handshake.json").cases[0];
    if (handshake === undefined) throw new Error("handshake fixture is empty");
    const sessionBindingHash = bytes(handshake.expected.sessionBindingHash);
    const c2nKey = bytes(handshake.expected.aeadKeyC2NEpoch0);

    for (const name of ["aad-client-to-node", "aad-node-to-client"]) {
      const entry = fixtureCase(fixture, name);
      const built = independentRecordAad({
        suite: Number(entry.inputs.suite),
        epoch: BigInt(Number(entry.inputs.epoch)),
        counter: BigInt(Number(entry.inputs.counter)),
        sessionBindingHash: bytes(entry.inputs.sessionBindingHash),
        directionLabel: new TextEncoder().encode(String(entry.inputs.direction)),
      });
      expectBytes(built.header, entry.expected.header);
      expectBytes(built.nonce, entry.expected.nonce);
      expectBytes(built.aad, entry.expected.aad);
    }

    for (const name of [
      "envelopes-at-counters-zero-and-one-client-to-node",
      "envelopes-at-counters-zero-and-one-node-to-client",
    ]) {
      const entry = fixtureCase(fixture, name);
      const records = entry.expected.records;
      if (!Array.isArray(records)) throw new Error("record list expected");
      const directionLabel = new TextEncoder().encode(String(entry.inputs.sendDirection));
      for (const recordValue of records) {
        const fixtureRecord = record(recordValue);
        const position = record(fixtureRecord.position);
        const envelope = protectIndependentRecord({
          aeadKey: bytes(entry.inputs.aeadKey),
          sessionBindingHash: bytes(entry.inputs.sessionBindingHash),
          directionLabel,
          suite: 1,
          epoch: BigInt(Number(position.epoch)),
          counter: BigInt(Number(position.counter)),
          innerType: 1,
          body: bytes(fixtureRecord.innerBody),
        });
        expectBytes(envelope, fixtureRecord.envelope);
        expectBytes(
          unprotectIndependentRecord({
            aeadKey: bytes(entry.inputs.aeadKey),
            sessionBindingHash: bytes(entry.inputs.sessionBindingHash),
            directionLabel,
            envelope,
            expectedEpoch: BigInt(Number(position.epoch)),
            expectedCounter: BigInt(Number(position.counter)),
          }).subarray(1),
          fixtureRecord.innerBody,
        );
      }
    }

    const control = fixtureCase(fixture, "control-record-consumes-the-shared-sequence");
    for (const [inputName, expectedName, counter] of [
      ["firstRecord", "firstEnvelope", 0],
      ["secondRecord", "secondEnvelope", 1],
    ] as const) {
      const inputRecord = record(control.inputs[inputName]);
      expectBytes(
        protectIndependentRecord({
          aeadKey: c2nKey,
          sessionBindingHash,
          directionLabel: new TextEncoder().encode("c2n"),
          suite: 1,
          epoch: 0n,
          counter: BigInt(counter),
          innerType: Number(inputRecord.innerType),
          body: bytes(inputRecord.body),
        }),
        control.expected[expectedName],
      );
    }

    for (const name of ["tampered-ciphertext-byte", "tampered-aead-tag-byte"]) {
      const entry = fixtureCase(fixture, name);
      expectRecordRejection(
        () =>
          unprotectIndependentRecord({
            aeadKey: c2nKey,
            sessionBindingHash,
            directionLabel: new TextEncoder().encode("c2n"),
            envelope: bytes(entry.inputs.tamperedEnvelope),
            expectedEpoch: 0n,
            expectedCounter: 0n,
          }),
        "authentication_failed",
      );
    }
    for (const [name, offset, reason] of [
      ["tampered-header-version-byte", 1, "version_mismatch"],
      ["tampered-header-suite-byte", 2, "suite_mismatch"],
      ["tampered-header-epoch-byte", 3, "sequence_mismatch"],
      ["tampered-header-counter-byte", 10, "sequence_mismatch"],
    ] as const) {
      const entry = fixtureCase(fixture, name);
      const original = bytes(entry.inputs.envelope);
      const tampered = bytes(entry.inputs.tamperedEnvelope);
      expect(tampered[offset], name).not.toBe(original[offset]);
      expectRecordRejection(
        () =>
          unprotectIndependentRecord({
            aeadKey: c2nKey,
            sessionBindingHash,
            directionLabel: new TextEncoder().encode("c2n"),
            envelope: tampered,
            expectedEpoch: 0n,
            expectedCounter: 0n,
          }),
        reason,
      );
      // The same expected position remains usable after refusal: the independent
      // reference has released no plaintext and advanced no receive counter.
      expect(
        unprotectIndependentRecord({
          aeadKey: c2nKey,
          sessionBindingHash,
          directionLabel: new TextEncoder().encode("c2n"),
          envelope: original,
          expectedEpoch: 0n,
          expectedCounter: 0n,
        }).byteLength,
      ).toBeGreaterThan(1);
    }

    const wrongDirection = fixtureCase(fixture, "wrong-direction-label-fails-authentication");
    expectRecordRejection(
      () =>
        unprotectIndependentRecord({
          aeadKey: bytes(wrongDirection.inputs.testOnlyPinnedAeadKey),
          sessionBindingHash,
          directionLabel: new TextEncoder().encode("n2c"),
          envelope: bytes(wrongDirection.inputs.envelope),
          expectedEpoch: 0n,
          expectedCounter: 0n,
        }),
      "authentication_failed",
    );
    const wrongBinding = fixtureCase(fixture, "wrong-session-binding-hash-fails-authentication");
    expectRecordRejection(
      () =>
        unprotectIndependentRecord({
          aeadKey: c2nKey,
          sessionBindingHash: bytes(wrongBinding.inputs.receiverSessionBindingHash),
          directionLabel: new TextEncoder().encode("c2n"),
          envelope: bytes(wrongBinding.inputs.envelope),
          expectedEpoch: 0n,
          expectedCounter: 0n,
        }),
      "authentication_failed",
    );
  });

  it("independently enforces canonical CBOR before certificate shape", () => {
    const fixture = family("f04-prekey-certificates.json");
    const valid = fixtureCase(fixture, "valid-client-agreement-prekey-certificate");
    const decoded = decodeIndependentCanonicalCbor(bytes(valid.inputs.transcript));
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") throw new Error("valid transcript rejected");
    expect(Array.isArray(decoded.value)).toBe(true);
    expect((decoded.value as readonly unknown[]).length).toBe(11);

    for (const name of [
      "client-certificate-non-canonical-array-header",
      "client-certificate-indefinite-length-array",
      "client-certificate-trailing-byte",
      "client-certificate-truncated",
      "client-certificate-float-element",
    ]) {
      const entry = fixtureCase(fixture, name);
      expect(decodeIndependentCanonicalCbor(bytes(entry.inputs.transcript)), name).toEqual(
        entry.inputs.canonicalDecode,
      );
    }

    const wrongShape = fixtureCase(fixture, "client-certificate-wrong-element-count");
    const wrongDecoded = decodeIndependentCanonicalCbor(bytes(wrongShape.inputs.transcript));
    expect(wrongDecoded.kind).toBe("ok");
    if (wrongDecoded.kind !== "ok") throw new Error("canonical wrong-shape transcript rejected");
    expect(Array.isArray(wrongDecoded.value)).toBe(true);
    expect((wrongDecoded.value as readonly unknown[]).length).toBe(10);
  });

  it("accepts the valid P-256 control and rejects every carried malformed point and signature", () => {
    const fixture = family("f17-key-material-validation.json");
    for (const entry of fixture.cases.filter(({ name }) => name.startsWith("p256-public-key-"))) {
      const accepted = validateIndependentP256PublicKey(bytes(entry.inputs.publicKey));
      expect(accepted, entry.name).toBe(entry.name === "p256-public-key-valid-control");
    }
    for (const entry of fixture.cases.filter(({ name }) => name.startsWith("p256-signature-"))) {
      expect(validateIndependentP256Signature(bytes(entry.inputs.signature)), entry.name).toBe(
        false,
      );
    }
  });
});
