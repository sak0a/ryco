import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_CLOSE_COMMITMENT_BYTES,
  E2EE_CLOSE_RECORDS_RESERVED,
  E2EE_COUNTER_MAX,
  E2EE_EPOCH_MAX,
  E2EE_ERROR_BODY_MAX_BYTES,
  E2EE_ERROR_RECORDS_RESERVED,
  E2EE_INNER_TYPE_BYTES,
  E2EE_REKEY_MAX_RECORDS,
  RPC_KEEPALIVE_INTERVAL,
  T_CLOSE,
  T_CLOSE_LINGER_MAX,
  T_KEEPALIVE_FLUSH_MARGIN,
} from "./relayE2eeConstants.ts";
import {
  E2EE_CLOSE_COMMITMENT_DOMAIN,
  E2EE_ERROR_CODE_INTERNAL,
  E2EE_ERROR_CODE_POLICY,
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  E2eeCloseMachine,
  advanceE2eeSequencePosition,
  compareE2eeSequencePositions,
  decodeE2eeCloseRecordBody,
  decodeE2eeErrorRecordBody,
  e2eeCloseCommitment,
  e2eeCloseVerdictPrecedence,
  encodeE2eeCloseCommitmentPreimage,
  encodeE2eeCloseRecordBody,
  encodeE2eeErrorRecordBody,
  isE2eeCloseRecordType,
  isE2eeErrorCode,
  nextE2eeSequencePosition,
  resolveE2eeCloseVerdict,
  validateE2eeCloseRecord,
  type E2eeCloseCommitmentInput,
  type E2eeCloseRecordToSend,
  type E2eeCloseVerdict,
  type E2eeErrorBodyDecodeError,
  type E2eeSequencePosition,
} from "./relayE2eeClose.ts";
import {
  E2EE_CLOSE_RECORD_PLAINTEXT_BYTES,
  E2eeRecordSession,
  e2eeSessionSecretsFromNoiseKeys,
  type E2eeDirectionState,
  type E2eeSyntheticDirectionState,
} from "./relayE2eeSession.ts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_CLOSE,
  E2EE_INNER_TYPE_CLOSE_ACK,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  e2eeAeadNonce,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "./relayE2eeWire.ts";

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

// ─── §16.1-style TEST-ONLY material ──────────────────────────────────────────
//
// The same fixed counting patterns `relayE2eeSession.test.ts` uses, so a close
// vector here and a record vector there are anchored to one session.

const EPOCH_SECRET_C2N = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const EPOCH_SECRET_N2C = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const EXPORTER_SECRET = "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f";
const SESSION_BINDING_HASH = "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f";

// ─── golden §10.1 vectors ────────────────────────────────────────────────────
//
// The §16.3 F11 shared state: epoch 0 throughout, initiator I's next-send
// `(0, 7)`, responder R's next-send `(0, 4)`. `I` is the client here, so its
// records travel `c2n` and R's travel `n2c`.

// [ "ryco.relay-e2ee.close.v1", 0x02, "c2n", bstr(sessionBindingHash),
//   bstr(0x00000000), bstr(0x0000000000000007),
//   bstr(0x00000000), bstr(0x0000000000000004) ]
const CLOSE_PREIMAGE =
  "8878187279636f2e72656c61792d653265652e636c6f73652e7631026363326e5820" +
  `${SESSION_BINDING_HASH}` +
  "44000000004800000000000000074400000000480000000000000004";
const CLOSE_COMMITMENT = "9c405e6314af6f49bfc532ce9276c2ec0e720daf6e80577d97bbcf756c98f68c";
const CLOSE_BODY =
  "854400000000480000000000000007440000000048000000000000000458209c405e6314af6f49bfc532" +
  "ce9276c2ec0e720daf6e80577d97bbcf756c98f68c";

// The responder's `E2EECloseAck` at `(0, 5)` declaring `expectedRecv` `(0, 8)`.
const ACK_PREIMAGE =
  "8878187279636f2e72656c61792d653265652e636c6f73652e763104636e32635820" +
  `${SESSION_BINDING_HASH}` +
  "44000000004800000000000000054400000000480000000000000008";
const ACK_COMMITMENT = "37b050a5d8a687655445ba9d8ccdc348d16551cc7a5c6dd60b0ee979fd99d6ca";
const ACK_BODY =
  "8544000000004800000000000000054400000000480000000000000008582037b050a5d8a687655445ba" +
  "9d8ccdc348d16551cc7a5c6dd60b0ee979fd99d6ca";

// One input mutated at a time, against `CLOSE_COMMITMENT` above.
const COMMITMENT_MUTATIONS = {
  innerType: "f5e61ae2b5b197ec3e1d7a6566ce7203ea3e61cad97b4ff5a024672e84684fc2",
  direction: "16f5bb7590f54457a7ee30e616e147c2ec4314118105a52410c3d3de42026ff8",
  sessionBindingHash: "0f0140fda34780e9514467be55cdd962f91ffd619d0e70f95972e33f5427183b",
  finalSend: "9595b864506ef59f2d44a65d47447f0af63971a024f97616b0719da4d0328f68",
  expectedRecv: "d266e24e901b6624369fc0cfd1aa992ad22ab0d827500b464c59ed776d5f83df",
} as const;

const CLOSE_INPUT: E2eeCloseCommitmentInput = {
  innerType: E2EE_INNER_TYPE_CLOSE,
  senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
  sessionBindingHash: bytes(SESSION_BINDING_HASH),
  finalSend: { epoch: 0n, counter: 7n },
  expectedRecv: { epoch: 0n, counter: 4n },
};

const ACK_INPUT: E2eeCloseCommitmentInput = {
  innerType: E2EE_INNER_TYPE_CLOSE_ACK,
  senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
  sessionBindingHash: bytes(SESSION_BINDING_HASH),
  finalSend: { epoch: 0n, counter: 5n },
  expectedRecv: { epoch: 0n, counter: 8n },
};

// ─── the two-endpoint harness ────────────────────────────────────────────────

const freshSecrets = (): ReturnType<typeof e2eeSessionSecretsFromNoiseKeys> =>
  e2eeSessionSecretsFromNoiseKeys({
    epochSecretC2N: bytes(EPOCH_SECRET_C2N),
    epochSecretN2C: bytes(EPOCH_SECRET_N2C),
    exporterSecret: bytes(EXPORTER_SECRET),
  });

interface Endpoint {
  readonly name: "client" | "node";
  readonly session: E2eeRecordSession;
  readonly machine: E2eeCloseMachine;
}

interface PairOptions {
  readonly c2n?: E2eeSyntheticDirectionState;
  readonly n2c?: E2eeSyntheticDirectionState;
}

const endpoint = (
  name: "client" | "node",
  sendDirection: E2eeDirection,
  send: E2eeSyntheticDirectionState | undefined,
  receive: E2eeSyntheticDirectionState | undefined,
): Endpoint => ({
  name,
  session: new E2eeRecordSession({
    secrets: freshSecrets(),
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash: bytes(SESSION_BINDING_HASH),
    sendDirection,
    plaintextCeiling: 1_024,
    testOnlySyntheticSendState: send,
    testOnlySyntheticReceiveState: receive,
  }),
  machine: new E2eeCloseMachine({
    sessionBindingHash: bytes(SESSION_BINDING_HASH),
    sendDirection,
  }),
});

const endpointPair = (options: PairOptions = {}): { client: Endpoint; node: Endpoint } => ({
  client: endpoint("client", E2EE_DIRECTION_CLIENT_TO_NODE, options.c2n, options.n2c),
  node: endpoint("node", E2EE_DIRECTION_NODE_TO_CLIENT, options.n2c, options.c2n),
});

const position = (state: E2eeDirectionState): E2eeSequencePosition => {
  if (state.epoch === undefined || state.counter === undefined) {
    throw new Error("direction is exhausted");
  }
  return { epoch: state.epoch, counter: state.counter };
};

const at = (value: E2eeSequencePosition): string => `${value.epoch}:${value.counter}`;

/** Protect a built close-machine record and report the transmission (§9.3, §10.2). */
const transmit = async (
  end: Endpoint,
  record: E2eeCloseRecordToSend,
  now: number,
): Promise<Uint8Array> => {
  let envelope: Uint8Array | undefined;
  const result = await end.session.protect({
    innerType: record.innerType,
    body: record.body,
    admit: () => true,
    transmit: (produced) => {
      envelope = produced;
      return { kind: "sent" };
    },
  });
  if (result.kind !== "protected") throw new Error(`protect failed: ${result.kind}`);
  end.machine.noteTransmitted({
    record,
    epoch: result.epoch,
    counter: result.counter,
    epochCompleted: result.epochCompleted,
    at: now,
  });
  if (envelope === undefined) throw new Error("no envelope");
  return envelope;
};

const buildInput = (
  end: Endpoint,
): { sendPosition: E2eeSequencePosition; expectedRecv: E2eeSequencePosition } => ({
  sendPosition: position(end.session.sendState),
  expectedRecv: position(end.session.receiveState),
});

const sendClose = async (end: Endpoint, now: number): Promise<Uint8Array> =>
  transmit(end, end.machine.buildClose(buildInput(end)), now);

const sendCloseAck = async (end: Endpoint, now: number): Promise<Uint8Array> =>
  transmit(end, end.machine.buildCloseAck(buildInput(end)), now);

/** Protect a body the machine did not build — the forged and stray-record cases. */
const transmitRaw = async (
  end: Endpoint,
  innerType: E2eeInnerRecordType,
  body: Uint8Array,
): Promise<Uint8Array> => {
  let envelope: Uint8Array | undefined;
  const result = await end.session.protect({
    innerType,
    body,
    admit: () => true,
    transmit: (produced) => {
      envelope = produced;
      return { kind: "sent" };
    },
  });
  if (result.kind !== "protected") throw new Error(`protect failed: ${result.kind}`);
  if (envelope === undefined) throw new Error("no envelope");
  return envelope;
};

/**
 * An envelope a NON-CONFORMING peer protects: a second session on the same
 * direction and key schedule, placed at the position the receiver expects next.
 *
 * §10.2's prohibition is enforced by the sender's own send path — from an
 * endpoint's first close-machine record `relayE2eeSession` refuses every further
 * application RPC record — so a record beyond the machine's expectation cannot
 * be produced by a conforming endpoint at all. It is exactly the input §11.3 Q7
 * exists to classify at the RECEIVER, which is what these tests assert.
 */
const strayEnvelope = async (
  sendDirection: E2eeDirection,
  sequence: E2eeSequencePosition,
  innerType: E2eeInnerRecordType,
  body: Uint8Array,
): Promise<Uint8Array> => {
  const session = new E2eeRecordSession({
    secrets: freshSecrets(),
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash: bytes(SESSION_BINDING_HASH),
    sendDirection,
    plaintextCeiling: 1_024,
    testOnlySyntheticSendState: { epoch: sequence.epoch, counter: sequence.counter },
  });
  let envelope: Uint8Array | undefined;
  const result = await session.protect({
    innerType,
    body,
    admit: () => true,
    transmit: (produced) => {
      envelope = produced;
      return { kind: "sent" };
    },
  });
  if (result.kind !== "protected") throw new Error(`protect failed: ${result.kind}`);
  if (envelope === undefined) throw new Error("no envelope");
  return envelope;
};

const deliver = (
  end: Endpoint,
  envelope: Uint8Array,
  now: number,
): ReturnType<E2eeCloseMachine["receive"]> => {
  const authenticated = end.session.unprotect(envelope);
  if (authenticated.kind !== "authenticated") {
    throw new Error(`unprotect failed: ${authenticated.reason}`);
  }
  return end.machine.receive({
    innerType: authenticated.innerType,
    body: authenticated.body,
    envelope: { epoch: authenticated.epoch, counter: authenticated.counter },
    epochCompleted: authenticated.epochCompleted,
    currentNextSend: position(end.session.sendState),
    at: now,
  });
};

describe("relay E2EE close records and the close commitment (§10.1)", () => {
  it("pins the commitment domain and the preimage element order", () => {
    expect(E2EE_CLOSE_COMMITMENT_DOMAIN).toBe("ryco.relay-e2ee.close.v1");
    const preimage = encodeE2eeCloseCommitmentPreimage(CLOSE_INPUT);
    expect(hex(preimage)).toBe(CLOSE_PREIMAGE);
    expect(preimage.byteLength).toBe(94);
    // The head bytes, spelled out: array(8), then text(24) of the domain, then
    // the uint inner type, then text(3) of the SENDER's direction label.
    expect(preimage[0]).toBe(0x88);
    expect(preimage[1]).toBe(0x78);
    expect(preimage[2]).toBe(0x18);
    expect(preimage[27]).toBe(0x02);
    expect(hex(preimage.subarray(28, 32))).toBe("6363326e");
    expect(hex(encodeE2eeCloseCommitmentPreimage(ACK_INPUT))).toBe(ACK_PREIMAGE);
  });

  it("pins closeCommitment for both record types", () => {
    expect(hex(e2eeCloseCommitment(CLOSE_INPUT))).toBe(CLOSE_COMMITMENT);
    expect(hex(e2eeCloseCommitment(ACK_INPUT))).toBe(ACK_COMMITMENT);
    expect(e2eeCloseCommitment(CLOSE_INPUT).byteLength).toBe(E2EE_CLOSE_COMMITMENT_BYTES);
  });

  it("binds the commitment to the record role, the direction, the session, and both positions", () => {
    const mutated: Record<keyof typeof COMMITMENT_MUTATIONS, E2eeCloseCommitmentInput> = {
      innerType: { ...CLOSE_INPUT, innerType: E2EE_INNER_TYPE_CLOSE_ACK },
      direction: { ...CLOSE_INPUT, senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT },
      sessionBindingHash: {
        ...CLOSE_INPUT,
        sessionBindingHash: bytes(`61${SESSION_BINDING_HASH.slice(2)}`),
      },
      finalSend: { ...CLOSE_INPUT, finalSend: { epoch: 0n, counter: 8n } },
      expectedRecv: { ...CLOSE_INPUT, expectedRecv: { epoch: 0n, counter: 5n } },
    };
    for (const [field, input] of Object.entries(mutated)) {
      const commitment = hex(e2eeCloseCommitment(input));
      expect(commitment).toBe(COMMITMENT_MUTATIONS[field as keyof typeof COMMITMENT_MUTATIONS]);
      expect(commitment).not.toBe(CLOSE_COMMITMENT);
    }
  });

  it("pins the five-element body and its §9.6 plaintext cost", () => {
    const body = encodeE2eeCloseRecordBody(CLOSE_INPUT);
    expect(hex(body)).toBe(CLOSE_BODY);
    expect(body.byteLength).toBe(63);
    expect(hex(encodeE2eeCloseRecordBody(ACK_INPUT))).toBe(ACK_BODY);
    // §9.6's reserve accounting is computed from the same five fixed widths.
    expect(body.byteLength + E2EE_INNER_TYPE_BYTES).toBe(E2EE_CLOSE_RECORD_PLAINTEXT_BYTES);
    expect(E2EE_CLOSE_RECORD_PLAINTEXT_BYTES).toBe(64);
    // Both record types are the same size, so a close and an ack are
    // indistinguishable by envelope length.
    expect(encodeE2eeCloseRecordBody(ACK_INPUT).byteLength).toBe(body.byteLength);
  });

  it("encodes fields 0–3 with the encoder that writes the envelope header (§3.3)", () => {
    const decoded = decodeE2eeCloseRecordBody(bytes(CLOSE_BODY));
    if (decoded.kind !== "ok") throw new Error(decoded.reason);
    const nonce = e2eeAeadNonce(0n, 7n);
    expect(hex(decoded.value.finalSendEpochField)).toBe(hex(nonce.subarray(0, 4)));
    expect(hex(decoded.value.finalSendCounterField)).toBe(hex(nonce.subarray(4)));
    expect(hex(decoded.value.finalSendEpochField)).toBe("00000000");
    expect(hex(decoded.value.finalSendCounterField)).toBe("0000000000000007");
    expect(decoded.value.finalSend).toEqual({ epoch: 0n, counter: 7n });
    expect(decoded.value.expectedRecv).toEqual({ epoch: 0n, counter: 4n });
    expect(hex(decoded.value.closeCommitment)).toBe(CLOSE_COMMITMENT);
  });

  it("rejects a body that is not canonical, not five byte strings, or not the fixed widths", () => {
    // Indefinite-length array head for the same five elements.
    expect(decodeE2eeCloseRecordBody(bytes(`9f${CLOSE_BODY.slice(2)}ff`)).kind).toBe("error");
    const FOUR_FIELDS = "44000000004800000000000000074400000000480000000000000004";
    const shapes: readonly (readonly [string, string])[] = [
      // Four elements: the commitment is simply absent.
      [`84${FOUR_FIELDS}`, "shape"],
      // Five elements, but the last is a uint rather than a byte string.
      [`85${FOUR_FIELDS}0a`, "shape"],
      // A commitment one byte short of E2EE_CLOSE_COMMITMENT_BYTES.
      [`85${FOUR_FIELDS}581f${CLOSE_COMMITMENT.slice(0, 62)}`, "field_width"],
    ];
    for (const [encoded, reason] of shapes) {
      const result = decodeE2eeCloseRecordBody(bytes(encoded));
      expect(result.kind).toBe("error");
      if (result.kind === "error") expect(result.reason).toBe(reason);
    }
    expect(isE2eeCloseRecordType(E2EE_INNER_TYPE_CLOSE)).toBe(true);
    expect(isE2eeCloseRecordType(E2EE_INNER_TYPE_CLOSE_ACK)).toBe(true);
    expect(isE2eeCloseRecordType(E2EE_INNER_TYPE_RPC)).toBe(false);
    expect(isE2eeCloseRecordType(E2EE_INNER_TYPE_ERROR)).toBe(false);
  });
});

describe("relay E2EE close anchor (§10.1.1)", () => {
  it("advances the counter within an epoch and to (e + 1, 0) at a §9.4 boundary", () => {
    expect(advanceE2eeSequencePosition({ epoch: 0n, counter: 7n }, false)).toEqual({
      epoch: 0n,
      counter: 8n,
    });
    // The boundary case the negative fixture exists for: NOT counter + 1.
    expect(advanceE2eeSequencePosition({ epoch: 0n, counter: 65_535n }, true)).toEqual({
      epoch: 1n,
      counter: 0n,
    });
    expect(advanceE2eeSequencePosition({ epoch: 4n, counter: 0n }, true)).toEqual({
      epoch: 5n,
      counter: 0n,
    });
  });

  it("refuses to advance a spent sequence space (§9.6)", () => {
    expect(() => advanceE2eeSequencePosition({ epoch: E2EE_EPOCH_MAX, counter: 3n }, true)).toThrow(
      RangeError,
    );
    expect(() =>
      advanceE2eeSequencePosition({ epoch: 0n, counter: E2EE_COUNTER_MAX }, false),
    ).toThrow(RangeError);
    // The non-throwing form, for the one caller that cannot hold a §9.6 proof
    // that the advance exists: the anchor, fixed after transmission.
    expect(nextE2eeSequencePosition({ epoch: E2EE_EPOCH_MAX, counter: 3n }, true)).toBeUndefined();
    expect(
      nextE2eeSequencePosition({ epoch: 0n, counter: E2EE_COUNTER_MAX }, false),
    ).toBeUndefined();
    expect(nextE2eeSequencePosition({ epoch: E2EE_EPOCH_MAX, counter: 3n }, false)).toEqual({
      epoch: E2EE_EPOCH_MAX,
      counter: 4n,
    });
  });

  it("orders positions lexicographically over the full field range (§9.3)", () => {
    expect(
      compareE2eeSequencePositions({ epoch: 0n, counter: 8n }, { epoch: 0n, counter: 8n }),
    ).toBe(0);
    expect(
      compareE2eeSequencePositions({ epoch: 0n, counter: 7n }, { epoch: 0n, counter: 8n }),
    ).toBe(-1);
    expect(
      compareE2eeSequencePositions({ epoch: 1n, counter: 0n }, { epoch: 0n, counter: 65_535n }),
    ).toBe(1);
    expect(
      compareE2eeSequencePositions(
        { epoch: 0n, counter: E2EE_COUNTER_MAX },
        { epoch: 1n, counter: 0n },
      ),
    ).toBe(-1);
  });
});

describe("relay E2EE close-record validation (§10.1)", () => {
  const validate = (
    overrides: Partial<Parameters<typeof validateE2eeCloseRecord>[0]> = {},
  ): ReturnType<typeof validateE2eeCloseRecord> =>
    validateE2eeCloseRecord({
      innerType: E2EE_INNER_TYPE_CLOSE,
      body: bytes(CLOSE_BODY),
      envelope: { epoch: 0n, counter: 7n },
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
      currentNextSend: { epoch: 0n, counter: 4n },
      ...overrides,
    });

  it("accepts a conforming close under the passed-through rule", () => {
    expect(validate().kind).toBe("ok");
    // Records may still be in flight, so a declaration BELOW current next-send is
    // a state the peer's receive window could legitimately hold.
    expect(validate({ currentNextSend: { epoch: 0n, counter: 9n } }).kind).toBe("ok");
    expect(validate({ currentNextSend: { epoch: 1n, counter: 0n } }).kind).toBe("ok");
  });

  it("rejects a close declaring more than the receiver's current next-send", () => {
    const result = validate({ currentNextSend: { epoch: 0n, counter: 3n } });
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toBe("passed_through_rule");
  });

  it("rejects fields 0–1 that do not byte-equal the carrying envelope header", () => {
    const result = validate({ envelope: { epoch: 0n, counter: 8n } });
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toBe("header_mismatch");
  });

  it("rejects a commitment computed over another session, direction, or role", () => {
    for (const overrides of [
      { sessionBindingHash: bytes(`61${SESSION_BINDING_HASH.slice(2)}`) },
      { senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT },
    ] as const) {
      const result = validate(overrides);
      expect(result.kind).toBe("invalid");
      if (result.kind === "invalid") expect(result.reason).toBe("commitment_mismatch");
    }
    // The role binding: the same declared state, hashed as an ack, is not a valid
    // close — and the header check passes first, so this reaches the commitment.
    const roleSwapped = validateE2eeCloseRecord({
      innerType: E2EE_INNER_TYPE_CLOSE,
      body: encodeE2eeCloseRecordBody({ ...CLOSE_INPUT, innerType: E2EE_INNER_TYPE_CLOSE_ACK }),
      envelope: { epoch: 0n, counter: 7n },
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
      currentNextSend: { epoch: 0n, counter: 4n },
    });
    expect(roleSwapped.kind).toBe("invalid");
    if (roleSwapped.kind === "invalid") expect(roleSwapped.reason).toBe("commitment_mismatch");
  });

  it("reports a malformed body without reaching any later check", () => {
    const result = validate({ body: bytes("83440000000048000000000000000744000000") });
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.reason).toBe("malformed_body");
      expect(result.decodeError).toBe("malformed");
    }
  });

  it("applies the strict rule to an ack, against the anchor and never against current next-send", () => {
    const ackArguments = {
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      body: bytes(ACK_BODY),
      envelope: { epoch: 0n, counter: 5n },
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
    } as const;
    // The ack declares `(0, 8)`. The validator's anchor is `(0, 8)`; its current
    // next-send is `(0, 9)`, and the rule MUST NOT look at it.
    expect(
      validateE2eeCloseRecord({
        ...ackArguments,
        currentNextSend: { epoch: 0n, counter: 9n },
        closeAnchor: { epoch: 0n, counter: 8n },
      }).kind,
    ).toBe("ok");
    const wrong = validateE2eeCloseRecord({
      ...ackArguments,
      currentNextSend: { epoch: 0n, counter: 8n },
      closeAnchor: { epoch: 0n, counter: 9n },
    });
    expect(wrong.kind).toBe("invalid");
    if (wrong.kind === "invalid") expect(wrong.reason).toBe("strict_rule");
    // The strict rule has no fallback: without an anchor it refuses to run rather
    // than silently substituting the receiver's current next-send.
    expect(() =>
      validateE2eeCloseRecord({ ...ackArguments, currentNextSend: { epoch: 0n, counter: 8n } }),
    ).toThrow(TypeError);
  });
});

describe("relay E2EE sequential close (§10.2)", () => {
  const roles = [
    { initiator: "client", responder: "node" },
    { initiator: "node", responder: "client" },
  ] as const;

  for (const role of roles) {
    it(`completes a clean close initiated by the ${role.initiator} (§10.2 steps 1–4)`, async () => {
      const pair = endpointPair({ c2n: { counter: 7n }, n2c: { counter: 4n } });
      const initiator = pair[role.initiator];
      const responder = pair[role.responder];
      const initiatorStart = at(position(initiator.session.sendState));
      const responderStart = at(position(responder.session.sendState));

      // Step 1: the initiator's `E2EEClose`, its final application-phase record.
      const closePosition = position(initiator.session.sendState);
      const close = await sendClose(initiator, 1_000);
      expect(initiator.machine.state).toBe("awaiting_ack");
      expect(initiator.machine.waitsArmed).toBe(1);
      expect(initiator.machine.waitDeadlineAt).toBe(1_000 + T_CLOSE);
      expect(initiator.machine.mayProtectApplicationRecord).toBe(false);
      // §10.1.1: the anchor is the advance of THAT record's position, fixed at
      // that instant — not the next-send state read at any later moment.
      expect(at(initiator.machine.closeAnchor!)).toBe(
        at(advanceE2eeSequencePosition(closePosition, false)),
      );
      expect(at(initiator.machine.closeAnchor!)).toBe(role.initiator === "client" ? "0:8" : "0:5");
      expect(initiator.machine.closeAnchorRecord).toBe(E2EE_INNER_TYPE_CLOSE);

      // Step 2: the responder authenticates it, validates the passed-through
      // rule, stops sending RPC, and sends its own `E2EECloseAck`.
      const received = deliver(responder, close, 1_010);
      expect(received.kind).toBe("close");
      if (received.kind === "close") expect(received.branch).toBe("sequential");
      expect(responder.machine.branch).toBe("sequential_responder");
      expect(responder.machine.pendingRecord).toBe("close_ack");
      expect(responder.machine.mayProtectApplicationRecord).toBe(false);
      expect(responder.machine.outerCloseAllowed(1_010)).toBe(false);
      const ackPosition = position(responder.session.sendState);
      const ack = await sendCloseAck(responder, 1_010);
      expect(responder.machine.state).toBe("awaiting_confirmation");
      expect(responder.machine.waitsArmed).toBe(1);
      expect(responder.machine.waitDeadlineAt).toBe(1_010 + T_CLOSE);
      // §10.1.1's per-role table: the responder's anchor names its own ack.
      expect(responder.machine.closeAnchorRecord).toBe(E2EE_INNER_TYPE_CLOSE_ACK);
      expect(at(responder.machine.closeAnchor!)).toBe(
        at(advanceE2eeSequencePosition(ackPosition, false)),
      );
      expect(at(responder.machine.closeAnchor!)).toBe(role.initiator === "client" ? "0:5" : "0:8");

      // Step 3: the initiator validates the ack against its anchor, then sends
      // the final confirmation; its exchange is complete.
      const ackResult = deliver(initiator, ack, 1_020);
      expect(ackResult.kind).toBe("close_ack");
      if (ackResult.kind === "close_ack") expect(ackResult.exchangeComplete).toBe(false);
      expect(initiator.machine.branch).toBe("sequential_initiator");
      expect(initiator.machine.pendingRecord).toBe("final_confirmation");
      expect(initiator.machine.outerCloseAllowed(1_020)).toBe(false);
      const confirmation = await sendCloseAck(initiator, 1_020);
      expect(initiator.machine.state).toBe("complete");
      expect(initiator.machine.verdict).toBe("clean");
      expect(initiator.machine.waitsArmed).toBe(1);
      expect(initiator.machine.isLastRecordSender).toBe(true);
      expect(initiator.machine.lingerDeadlineAt).toBe(1_020 + T_CLOSE_LINGER_MAX);
      expect(initiator.machine.outerCloseAllowed(1_020)).toBe(true);

      // Step 4: the responder validates the final confirmation against ITS anchor.
      const confirmationResult = deliver(responder, confirmation, 1_030);
      expect(confirmationResult.kind).toBe("close_ack");
      if (confirmationResult.kind === "close_ack") {
        expect(confirmationResult.exchangeComplete).toBe(true);
      }
      expect(responder.machine.state).toBe("complete");
      expect(responder.machine.verdict).toBe("clean");
      expect(responder.machine.waitsArmed).toBe(1);
      // §10.3: the responder is NOT a last-record sender; it closes immediately,
      // which is what ends the initiator's linger.
      expect(responder.machine.isLastRecordSender).toBe(false);
      expect(responder.machine.lingerDeadlineAt).toBeUndefined();
      expect(responder.machine.shouldLinger(1_030)).toBe(false);
      expect(responder.machine.outerCloseAllowed(1_030)).toBe(true);

      // Three records, and each side spent no more than its §9.6 reserve.
      expect(initiator.machine.closeRecordsSent).toBe(2);
      expect(responder.machine.closeRecordsSent).toBe(1);
      expect(initiator.machine.closeRecordsSent).toBeLessThanOrEqual(E2EE_CLOSE_RECORDS_RESERVED);
      // The positions the whole exchange ran over, pinned.
      expect(initiatorStart).toBe(role.initiator === "client" ? "0:7" : "0:4");
      expect(responderStart).toBe(role.initiator === "client" ? "0:4" : "0:7");
    });
  }

  it("discards a keepalive Ping submitted after the first close-machine record (§10.2)", async () => {
    const pair = endpointPair();
    const submitted: string[] = [];
    const submitPing = async (end: Endpoint, peer: Endpoint, now: number): Promise<void> => {
      // A driver consults the machine; §10.2 makes the keepalive `Ping` an
      // application RPC record, and one the close phase stalls is DISCARDED,
      // never buffered for a later flush.
      if (!end.machine.mayProtectApplicationRecord) return;
      submitted.push(end.name);
      deliver(peer, await transmitRaw(end, E2EE_INNER_TYPE_RPC, new Uint8Array([0x01])), now);
    };
    await submitPing(pair.client, pair.node, 0);
    expect(submitted).toEqual(["client"]);

    const close = await sendClose(pair.client, 0);
    await submitPing(pair.client, pair.node, 1);
    expect(submitted).toEqual(["client"]);

    deliver(pair.node, close, 1);
    await submitPing(pair.node, pair.client, 1);
    expect(submitted).toEqual(["client"]);
    const ack = await sendCloseAck(pair.node, 1);
    await submitPing(pair.node, pair.client, 1);
    expect(submitted).toEqual(["client"]);

    deliver(pair.client, ack, 2);
    await sendCloseAck(pair.client, 2);
    await submitPing(pair.client, pair.node, 2);
    expect(submitted).toEqual(["client"]);
    expect(pair.client.machine.verdict).toBe("clean");
  });

  it("delivers RPC until the peer's close, and treats a later RPC record as Q7", async () => {
    const pair = endpointPair();
    const close = await sendClose(pair.client, 0);
    // The node has not yet seen the close, so its RPC records are still
    // deliverable at the initiator (§10.2).
    const rpc = await transmitRaw(pair.node, E2EE_INNER_TYPE_RPC, new Uint8Array([0x02]));
    expect(deliver(pair.client, rpc, 1).kind).toBe("application");
    expect(pair.client.machine.verdict).toBeUndefined();

    deliver(pair.node, close, 2);
    const ack = await sendCloseAck(pair.node, 2);
    // The node protected its ack, so §10.2 latched its own send path: it cannot
    // produce this record, and nothing is consumed by the refusal.
    const refused = await pair.node.session.protect({
      innerType: E2EE_INNER_TYPE_RPC,
      body: new Uint8Array([0x03]),
      admit: () => true,
      transmit: () => ({ kind: "sent" }),
    });
    expect(refused).toEqual({ kind: "unavailable", reason: "application_phase_closed" });
    expect(at(position(pair.node.session.sendState))).toBe("0:2");
    // A peer that does not apply the prohibition still can, and at the receiver
    // that record is beyond the machine.
    const strayRpc = await strayEnvelope(
      E2EE_DIRECTION_NODE_TO_CLIENT,
      { epoch: 0n, counter: 2n },
      E2EE_INNER_TYPE_RPC,
      new Uint8Array([0x03]),
    );
    deliver(pair.client, ack, 3);
    await sendCloseAck(pair.client, 3);
    const stray = deliver(pair.client, strayRpc, 4);
    expect(stray.kind).toBe("fatal");
    if (stray.kind === "fatal") {
      expect(stray.row).toBe("Q7");
      expect(stray.reason).toBe("record_beyond_machine");
    }
    expect(pair.client.machine.verdict).toBe("failed");
  });

  it("treats an RPC record after the peer's ack as Q7, before the final confirmation", async () => {
    const pair = endpointPair();
    const close = await sendClose(pair.client, 0);
    deliver(pair.node, close, 1);
    const ack = await sendCloseAck(pair.node, 1);
    // The responder is under the same prohibition from its own first
    // close-machine record — its ack — so its own send path refuses this record
    // and only a non-conforming peer emits it. It is beyond the machine either
    // way, and the receiver says so before the final confirmation.
    const strayRpc = await strayEnvelope(
      E2EE_DIRECTION_NODE_TO_CLIENT,
      { epoch: 0n, counter: 1n },
      E2EE_INNER_TYPE_RPC,
      new Uint8Array([0x04]),
    );
    deliver(pair.client, ack, 2);
    expect(pair.client.machine.state).toBe("confirmation_due");
    const stray = deliver(pair.client, strayRpc, 2);
    expect(stray.kind).toBe("fatal");
    if (stray.kind === "fatal") expect(stray.reason).toBe("record_beyond_machine");
    expect(pair.client.machine.verdict).toBe("failed");
  });
});

describe("relay E2EE simultaneous close (§10.2, §10.1.1)", () => {
  it("passes the §16.3 F11 fixture: I (0, 7) and R (0, 4), acks at (0, 8) and (0, 5)", async () => {
    const pair = endpointPair({ c2n: { counter: 7n }, n2c: { counter: 4n } });
    const initiator = pair.client;
    const responder = pair.node;
    expect(at(position(initiator.session.sendState))).toBe("0:7");
    expect(at(position(responder.session.sendState))).toBe("0:4");

    // Each side sends `E2EEClose` before seeing the peer's.
    const iClose = await sendClose(initiator, 0);
    const rClose = await sendClose(responder, 0);
    expect(at(initiator.machine.closeAnchor!)).toBe("0:8");
    expect(at(responder.machine.closeAnchor!)).toBe("0:5");
    expect(initiator.machine.closeAnchorRecord).toBe(E2EE_INNER_TYPE_CLOSE);
    expect(responder.machine.closeAnchorRecord).toBe(E2EE_INNER_TYPE_CLOSE);

    const iSaw = deliver(initiator, rClose, 10);
    const rSaw = deliver(responder, iClose, 10);
    expect(iSaw.kind).toBe("close");
    if (iSaw.kind === "close") {
      expect(iSaw.branch).toBe("simultaneous");
      expect(at(iSaw.value.finalSend)).toBe("0:4");
      expect(at(iSaw.value.expectedRecv)).toBe("0:7");
    }
    if (rSaw.kind === "close") {
      expect(rSaw.branch).toBe("simultaneous");
      expect(at(rSaw.value.finalSend)).toBe("0:7");
      expect(at(rSaw.value.expectedRecv)).toBe("0:4");
    }
    expect(initiator.machine.branch).toBe("simultaneous");
    expect(responder.machine.branch).toBe("simultaneous");
    // The transition into the branch does not end the first wait's obligation and
    // does not restart or extend it.
    expect(initiator.machine.waitsArmed).toBe(1);
    expect(initiator.machine.waitDeadlineAt).toBe(0 + T_CLOSE);

    // Each ack is computed after processing the peer's close.
    const iAck = await sendCloseAck(initiator, 10);
    const rAck = await sendCloseAck(responder, 10);
    expect(initiator.machine.waitsArmed).toBe(2);
    expect(initiator.machine.waitDeadlineAt).toBe(10 + T_CLOSE);
    expect(responder.machine.waitsArmed).toBe(2);
    // The exact declarations §16.3 F11 pins.
    const decodedIAck = decodeE2eeCloseRecordBody(
      encodeE2eeCloseRecordBody({
        innerType: E2EE_INNER_TYPE_CLOSE_ACK,
        senderDirection: E2EE_DIRECTION_CLIENT_TO_NODE,
        sessionBindingHash: bytes(SESSION_BINDING_HASH),
        finalSend: { epoch: 0n, counter: 8n },
        expectedRecv: { epoch: 0n, counter: 5n },
      }),
    );
    if (decodedIAck.kind !== "ok") throw new Error("body");
    expect(at(decodedIAck.value.finalSend)).toBe("0:8");
    expect(at(decodedIAck.value.expectedRecv)).toBe("0:5");

    const iResult = deliver(initiator, rAck, 20);
    const rResult = deliver(responder, iAck, 20);
    expect(iResult.kind).toBe("close_ack");
    if (iResult.kind === "close_ack") {
      expect(iResult.exchangeComplete).toBe(true);
      // R's ack declares I's anchor `(0, 8)` — NOT I's current next-send `(0, 9)`.
      expect(at(iResult.value.expectedRecv)).toBe("0:8");
      expect(at(iResult.value.finalSend)).toBe("0:5");
    }
    if (rResult.kind === "close_ack") {
      expect(at(rResult.value.expectedRecv)).toBe("0:5");
      expect(at(rResult.value.finalSend)).toBe("0:8");
    }
    expect(at(position(initiator.session.sendState))).toBe("0:9");
    expect(at(position(responder.session.sendState))).toBe("0:6");
    expect(initiator.machine.verdict).toBe("clean");
    expect(responder.machine.verdict).toBe("clean");
    // Four records total, no final-confirmation step; both sides are last-record
    // senders, so §10.3 forbids either making its close conditional on the other.
    expect(initiator.machine.closeRecordsSent).toBe(2);
    expect(responder.machine.closeRecordsSent).toBe(2);
    expect(initiator.machine.isLastRecordSender).toBe(true);
    expect(responder.machine.isLastRecordSender).toBe(true);
    expect(initiator.machine.waitsArmed).toBe(2);
    expect(responder.machine.waitsArmed).toBe(2);
  });

  it("rejects an ack that declares the validator's CURRENT next-send instead of its anchor", async () => {
    const pair = endpointPair({ c2n: { counter: 7n }, n2c: { counter: 4n } });
    const initiator = pair.client;
    const responder = pair.node;
    const iClose = await sendClose(initiator, 0);
    const rClose = await sendClose(responder, 0);
    deliver(initiator, rClose, 10);
    deliver(responder, iClose, 10);
    await sendCloseAck(initiator, 10);
    expect(at(initiator.machine.closeAnchor!)).toBe("0:8");
    expect(at(position(initiator.session.sendState))).toBe("0:9");

    // R's ack at `(0, 5)` declaring `(0, 9)` — I's current next-send AFTER
    // sending its own ack, rather than I's anchor `(0, 8)`. Accepting it is the
    // disallowed reading.
    const forged = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      finalSend: { epoch: 0n, counter: 5n },
      expectedRecv: { epoch: 0n, counter: 9n },
    });
    const envelope = await transmitRaw(responder, E2EE_INNER_TYPE_CLOSE_ACK, forged);
    const result = deliver(initiator, envelope, 20);
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.row).toBe("Q7");
      expect(result.reason).toBe("strict_rule");
    }
    expect(initiator.machine.verdict).toBe("failed");
    expect(initiator.machine.state).toBe("ended");
  });

  it("advances the anchor across an epoch boundary to (e + 1, 0), never to counter + 1", async () => {
    const boundary: E2eeSyntheticDirectionState = {
      counter: 65_535n,
      epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
    };
    const pair = endpointPair({ c2n: boundary });
    const close = await sendClose(pair.client, 0);
    // The close is the last record of epoch 0 under the §9.4 record threshold.
    expect(at(pair.client.machine.closeAnchor!)).toBe("1:0");
    expect(at(position(pair.client.session.sendState))).toBe("1:0");

    deliver(pair.node, close, 1);
    expect(at(position(pair.node.session.receiveState))).toBe("1:0");
    const ack = await sendCloseAck(pair.node, 1);
    // The responder's ack declares its expected-next receive, which is the same
    // `(1, 0)` the initiator's anchor names.
    const accepted = deliver(pair.client, ack, 2);
    expect(accepted.kind).toBe("close_ack");
    if (accepted.kind === "close_ack") expect(at(accepted.value.expectedRecv)).toBe("1:0");

    // The companion negative case: `(e, counter + 1)`.
    const second = endpointPair({ c2n: boundary });
    const secondClose = await sendClose(second.client, 0);
    deliver(second.node, secondClose, 1);
    const forged = encodeE2eeCloseRecordBody({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      senderDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
      sessionBindingHash: bytes(SESSION_BINDING_HASH),
      finalSend: position(second.node.session.sendState),
      expectedRecv: { epoch: 0n, counter: 65_536n },
    });
    const envelope = await transmitRaw(second.node, E2EE_INNER_TYPE_CLOSE_ACK, forged);
    const rejected = deliver(second.client, envelope, 2);
    expect(rejected.kind).toBe("fatal");
    if (rejected.kind === "fatal") {
      expect(rejected.row).toBe("Q7");
      expect(rejected.reason).toBe("strict_rule");
    }
    expect(second.client.machine.verdict).toBe("failed");
  });

  it("is unaffected by reading the peer's close and ack in one batch (§10.1.1)", async () => {
    const pair = endpointPair({ c2n: { counter: 7n }, n2c: { counter: 4n } });
    const iClose = await sendClose(pair.client, 0);
    const rClose = await sendClose(pair.node, 0);
    deliver(pair.node, iClose, 5);
    const rAck = await sendCloseAck(pair.node, 5);

    // The client reads BOTH of the node's records before sending its own ack —
    // the batch §10.1.1 says the outcome MUST NOT depend on.
    expect(deliver(pair.client, rClose, 10).kind).toBe("close");
    expect(at(pair.client.machine.ackExpectedRecv!)).toBe("0:5");
    const early = deliver(pair.client, rAck, 10);
    expect(early.kind).toBe("close_ack");
    if (early.kind === "close_ack") expect(early.exchangeComplete).toBe(false);
    expect(pair.client.machine.pendingRecord).toBe("close_ack");
    expect(pair.client.machine.verdict).toBeUndefined();
    // The client's expected-next has moved past the node's anchor, so the
    // declaring side takes the value as of the close it is answering. Supplying
    // the current one is the driver error the machine refuses to encode.
    expect(at(position(pair.client.session.receiveState))).toBe("0:6");
    expect(() => pair.client.machine.buildCloseAck(buildInput(pair.client))).toThrow(TypeError);

    const iAck = await transmit(
      pair.client,
      pair.client.machine.buildCloseAck({
        sendPosition: position(pair.client.session.sendState),
        expectedRecv: pair.client.machine.ackExpectedRecv!,
      }),
      10,
    );
    expect(pair.client.machine.verdict).toBe("clean");
    // Nothing was waited for a second time, and nothing was waited for a third.
    expect(pair.client.machine.waitsArmed).toBe(1);
    expect(pair.client.machine.waitsArmed).toBeLessThanOrEqual(2);
    const accepted = deliver(pair.node, iAck, 15);
    expect(accepted.kind).toBe("close_ack");
    if (accepted.kind === "close_ack") expect(at(accepted.value.expectedRecv)).toBe("0:5");
    expect(pair.node.machine.verdict).toBe("clean");
  });

  it("never arms a third wait, and no event restarts or extends one", async () => {
    const pair = endpointPair();
    await sendClose(pair.client, 100);
    expect(pair.client.machine.waitDeadlineAt).toBe(100 + T_CLOSE);
    // An inbound application record is not a close-machine event and must not
    // touch the deadline.
    const rpc = await transmitRaw(pair.node, E2EE_INNER_TYPE_RPC, new Uint8Array([0x07]));
    deliver(pair.client, rpc, 400);
    expect(pair.client.machine.waitDeadlineAt).toBe(100 + T_CLOSE);
    expect(pair.client.machine.waitsArmed).toBe(1);

    const nodeClose = await sendClose(pair.node, 400);
    deliver(pair.client, nodeClose, 500);
    // The simultaneous transition itself changes nothing about the first wait.
    expect(pair.client.machine.waitDeadlineAt).toBe(100 + T_CLOSE);
    expect(pair.client.machine.waitsArmed).toBe(1);
    await sendCloseAck(pair.client, 500);
    expect(pair.client.machine.waitsArmed).toBe(2);
    expect(pair.client.machine.waitDeadlineAt).toBe(500 + T_CLOSE);
    expect(pair.client.machine.waitsArmed).toBeLessThanOrEqual(2);
  });
});

describe("relay E2EE close verdicts (§10.4)", () => {
  it("pins the precedence order and its resolution", () => {
    const order: readonly E2eeCloseVerdict[] = [
      "clean",
      "unclean_abrupt",
      "unclean_truncation",
      "failed",
    ];
    expect(order.map((verdict) => e2eeCloseVerdictPrecedence(verdict))).toEqual([0, 1, 2, 3]);
    expect(resolveE2eeCloseVerdict("clean", "unclean_abrupt")).toBe("unclean_abrupt");
    expect(resolveE2eeCloseVerdict("unclean_truncation", "unclean_abrupt")).toBe(
      "unclean_truncation",
    );
    expect(resolveE2eeCloseVerdict("failed", "unclean_truncation")).toBe("failed");
    expect(resolveE2eeCloseVerdict("clean", "clean")).toBe("clean");
  });

  it("records Unclean — abrupt, not Clean, when the ack never arrives", async () => {
    const pair = endpointPair();
    await sendClose(pair.client, 0);
    expect(pair.client.machine.waitDeadlineAt).toBe(T_CLOSE);
    expect(pair.client.machine.waitExpired(T_CLOSE)).toBe(false);
    expect(pair.client.machine.outerCloseAllowed(T_CLOSE)).toBe(false);
    expect(pair.client.machine.waitExpired(T_CLOSE + 1)).toBe(true);
    const verdict = pair.client.machine.noteWaitExpired(T_CLOSE + 1);
    expect(verdict).toBe("unclean_abrupt");
    expect(pair.client.machine.verdict).toBe("unclean_abrupt");
    expect(pair.client.machine.exchangeComplete).toBe(false);
    // A `T_CLOSE` expiry produces NO wire record: it is the event this protocol
    // declines to attribute, not a detected violation. The endpoint owes nothing
    // and has protected only its own `E2EEClose`.
    expect(pair.client.machine.pendingRecord).toBeUndefined();
    expect(pair.client.machine.closeRecordsSent).toBe(1);
    expect(pair.client.machine.outerCloseAllowed(T_CLOSE + 1)).toBe(true);
    expect(pair.client.machine.mayProtectApplicationRecord).toBe(false);
  });

  it("leaves one endpoint Clean and the other Unclean — abrupt when the last record is dropped", async () => {
    const pair = endpointPair();
    const close = await sendClose(pair.client, 0);
    deliver(pair.node, close, 1);
    const ack = await sendCloseAck(pair.node, 1);
    deliver(pair.client, ack, 2);
    await sendCloseAck(pair.client, 2); // the final confirmation, never delivered
    expect(pair.client.machine.verdict).toBe("clean");

    // The responder waits for a confirmation that the relay discarded.
    expect(pair.node.machine.exchangeComplete).toBe(false);
    expect(pair.node.machine.noteWaitExpired(1 + T_CLOSE + 1)).toBe("unclean_abrupt");
    expect(pair.node.machine.verdict).toBe("unclean_abrupt");
    // Per-endpoint verdicts: neither may report the peer's as its own.
    expect(pair.client.machine.verdict).not.toBe(pair.node.machine.verdict);
  });

  it("puts truncation above Clean at the channel end, and Failed above truncation", async () => {
    const pair = endpointPair();
    const close = await sendClose(pair.client, 0);
    deliver(pair.node, close, 1);
    const ack = await sendCloseAck(pair.node, 1);
    deliver(pair.client, ack, 2);
    await sendCloseAck(pair.client, 2);
    expect(pair.client.machine.verdict).toBe("clean");
    // Losing the socket during the §10.3 linger leaves Clean standing.
    expect(pair.client.machine.noteChannelEnded({ at: 3 })).toBe("clean");

    const second = endpointPair();
    const secondClose = await sendClose(second.client, 0);
    deliver(second.node, secondClose, 1);
    const secondAck = await sendCloseAck(second.node, 1);
    deliver(second.client, secondAck, 2);
    await sendCloseAck(second.client, 2);
    expect(second.client.machine.verdict).toBe("clean");
    // A partial reassembled message at close IS truncation, regardless of any
    // other state — including a completed exchange.
    expect(second.client.machine.noteChannelEnded({ at: 3, incompleteReassembly: true })).toBe(
      "unclean_truncation",
    );
    // A detected protocol violation is the more specific fact and supersedes it.
    expect(second.client.machine.noteFatal()).toBe("failed");
    expect(second.client.machine.verdict).toBe("failed");

    const third = endpointPair();
    expect(third.client.machine.noteChannelEnded({ at: 5 })).toBe("unclean_abrupt");
  });

  it("records §9.6's degenerate state at the exhaustion boundary instead of throwing", async () => {
    // One record of capacity left in the terminal epoch: the close is
    // protectable, it completes epoch `E2EE_EPOCH_MAX`, and there is therefore
    // no expected-next position for the §10.1.1 anchor to be. §9.6 makes that a
    // close outcome — protect what capacity allows, wrap nothing, record
    // **Unclean — abrupt** — and NOT an exception raised after the record has
    // already gone out.
    const pair = endpointPair({
      c2n: {
        epoch: E2EE_EPOCH_MAX,
        counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
        epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
      },
    });
    await sendClose(pair.client, 0);
    expect(pair.client.session.sendState.exhausted).toBe(true);
    expect(pair.client.machine.closeAnchor).toBeUndefined();
    expect(pair.client.machine.closeAnchorRecord).toBeUndefined();
    expect(pair.client.machine.closeAnchorUnavailable).toBe(true);
    expect(pair.client.machine.verdict).toBe("unclean_abrupt");
    // The machine is otherwise unchanged: the record was sent, so §10.2's wait
    // is armed and §10.3 still withholds the outer close until it expires.
    expect(pair.client.machine.state).toBe("awaiting_ack");
    expect(pair.client.machine.waitsArmed).toBe(1);
    expect(pair.client.machine.outerCloseAllowed(T_CLOSE)).toBe(false);
    expect(pair.client.machine.outerCloseAllowed(T_CLOSE + 1)).toBe(true);
    expect(pair.client.machine.noteWaitExpired(T_CLOSE + 1)).toBe("unclean_abrupt");

    // An endpoint one record short of the boundary keeps its anchor, so the
    // degenerate branch is the boundary and not the terminal epoch as such.
    const room = endpointPair({
      c2n: {
        epoch: E2EE_EPOCH_MAX,
        counter: BigInt(E2EE_REKEY_MAX_RECORDS - 2),
        epochRecords: E2EE_REKEY_MAX_RECORDS - 2,
      },
    });
    await sendClose(room.client, 0);
    expect(room.client.machine.closeAnchorUnavailable).toBe(false);
    expect(at(room.client.machine.closeAnchor!)).toBe(
      `${E2EE_EPOCH_MAX}:${BigInt(E2EE_REKEY_MAX_RECORDS - 1)}`,
    );
    expect(room.client.machine.verdict).toBeUndefined();
  });
});

describe("relay E2EE terminal error carve-out (§10.2, §11.3)", () => {
  const completeSequential = async (): Promise<{ client: Endpoint; node: Endpoint }> => {
    const pair = endpointPair();
    const close = await sendClose(pair.client, 0);
    deliver(pair.node, close, 1);
    const ack = await sendCloseAck(pair.node, 1);
    deliver(pair.client, ack, 2);
    const confirmation = await sendCloseAck(pair.client, 2);
    deliver(pair.node, confirmation, 3);
    return pair;
  };

  it("treats an envelope beyond the machine as Q7 and permits exactly one E2EEError after it", async () => {
    const pair = await completeSequential();
    expect(pair.node.machine.verdict).toBe("clean");
    // An extra protected record after the exchange completed, carrying any inner
    // type other than `E2EEError`.
    const stray = await transmitRaw(pair.client, E2EE_INNER_TYPE_CLOSE_ACK, bytes(CLOSE_BODY));
    const result = deliver(pair.node, stray, 4);
    expect(result.kind).toBe("fatal");
    if (result.kind === "fatal") {
      expect(result.row).toBe("Q7");
      expect(result.reason).toBe("record_beyond_machine");
    }
    // §10.4 precedence over time: Failed supersedes the Clean recorded at
    // completion. It is NOT Unclean — abrupt.
    expect(pair.node.machine.verdict).toBe("failed");
    expect(pair.node.machine.verdict).not.toBe("unclean_abrupt");

    // §11.3's procedure still applies: one `E2EEError`, and nothing after it.
    expect(pair.node.machine.mayProtectTerminalError).toBe(true);
    expect(E2EE_ERROR_RECORDS_RESERVED).toBe(1);
    pair.node.machine.noteTerminalErrorTransmitted();
    expect(pair.node.machine.terminalErrorSent).toBe(true);
    expect(pair.node.machine.mayProtectTerminalError).toBe(false);
    expect(pair.node.machine.mayProtectApplicationRecord).toBe(false);
    expect(() => pair.node.machine.noteTerminalErrorTransmitted()).toThrow(TypeError);
    expect(() =>
      pair.node.machine.buildCloseAck({
        sendPosition: { epoch: 0n, counter: 9n },
        expectedRecv: { epoch: 0n, counter: 9n },
      }),
    ).toThrow(TypeError);
  });

  it("does not answer a received E2EEError, and records Failed rather than Q7", async () => {
    const pair = await completeSequential();
    expect(pair.client.machine.verdict).toBe("clean");
    const error = await transmitRaw(pair.node, E2EE_INNER_TYPE_ERROR, bytes("8101"));
    const result = deliver(pair.client, error, 5);
    // Not a Q7 envelope beyond the machine's expectation: it is the peer's
    // terminal record, and the receiver replies with nothing at all.
    expect(result.kind).toBe("terminal_error");
    expect(result).not.toHaveProperty("row");
    expect(pair.client.machine.verdict).toBe("failed");
    expect(pair.client.machine.mayProtectTerminalError).toBe(false);
    expect(pair.client.machine.pendingRecord).toBeUndefined();
    expect(() =>
      pair.client.machine.buildCloseAck({
        sendPosition: { epoch: 0n, counter: 4n },
        expectedRecv: { epoch: 0n, counter: 4n },
      }),
    ).toThrow(TypeError);
    // The caller erases on the terminal record (§9.5); the session is never
    // resumed afterwards.
    pair.client.session.erase();
    expect(pair.client.session.erased).toBe(true);
  });

  it("treats a received E2EEError as terminal in the application phase too", async () => {
    const pair = endpointPair();
    const error = await transmitRaw(pair.node, E2EE_INNER_TYPE_ERROR, bytes("8101"));
    const result = deliver(pair.client, error, 0);
    expect(result.kind).toBe("terminal_error");
    expect(pair.client.machine.verdict).toBe("failed");
    expect(pair.client.machine.state).toBe("ended");
  });

  it("pins the §11.3 body and its bounded error-code registry", () => {
    expect([
      E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
      E2EE_ERROR_CODE_INTERNAL,
      E2EE_ERROR_CODE_POLICY,
    ]).toEqual([0x01, 0x02, 0x03]);
    expect(hex(encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION))).toBe("8101");
    expect(hex(encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_INTERNAL))).toBe("8102");
    expect(hex(encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_POLICY))).toBe("8103");
    // §11.3: every defined code encodes to the same body length, so every
    // `E2EEError` envelope is length-identical.
    expect(encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_POLICY).byteLength).toBe(2);
    expect(2 + E2EE_INNER_TYPE_BYTES).toBeLessThanOrEqual(E2EE_ERROR_BODY_MAX_BYTES);
    expect(isE2eeErrorCode(0x04)).toBe(false);
    // A reserved code is not one an endpoint may EMIT: §11.3's procedure emits
    // "the applicable code", which is always one of the three.
    expect(() => encodeE2eeErrorRecordBody(0x04 as typeof E2EE_ERROR_CODE_POLICY)).toThrow(
      TypeError,
    );
    expect(decodeE2eeErrorRecordBody(bytes("8101"))).toEqual({
      kind: "ok",
      value: { errorCode: 0x01, defined: true },
    });
  });

  it("accepts a well-formed terminal error and reports its code", async () => {
    const pair = endpointPair();
    const error = await transmitRaw(
      pair.node,
      E2EE_INNER_TYPE_ERROR,
      encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_POLICY),
    );
    const result = deliver(pair.client, error, 0);
    expect(result).toEqual({
      kind: "terminal_error",
      value: { errorCode: E2EE_ERROR_CODE_POLICY, defined: true },
    });
    // Unchanged disposition: no reply, verdict **Failed** (§10.2, §10.4).
    expect(result).not.toHaveProperty("row");
    expect(pair.client.machine.verdict).toBe("failed");
    expect(pair.client.machine.state).toBe("ended");
    expect(pair.client.machine.mayProtectTerminalError).toBe(false);
  });

  it("treats a reserved error code as the peer's terminal record, not a violation", async () => {
    // §11.3: "all others reserved — the channel still closes; a reserved code is
    // not separately actionable". That is a disposition, not a rejection.
    const pair = endpointPair();
    const error = await transmitRaw(pair.node, E2EE_INNER_TYPE_ERROR, bytes("8104"));
    const result = deliver(pair.client, error, 0);
    expect(result).toEqual({ kind: "terminal_error", value: { errorCode: 0x04, defined: false } });
    expect(pair.client.machine.verdict).toBe("failed");
    expect(pair.client.machine.state).toBe("ended");
  });

  it("treats a malformed E2EEError body as §11.3 Q11 and never as a terminal record", async () => {
    const bodies: readonly (readonly [Uint8Array, E2eeErrorBodyDecodeError])[] = [
      // Over `E2EE_ERROR_BODY_MAX_BYTES`, checked before any decode.
      [new Uint8Array(E2EE_ERROR_BODY_MAX_BYTES + 1), "oversized"],
      // Not canonical CBOR at all.
      [bytes("ff"), "malformed"],
      // The same code written with a non-minimal uint head.
      [bytes("811801"), "malformed"],
      // An indefinite-length array of the same one element (§3.6).
      [bytes("9f01ff"), "malformed"],
      // A half-precision float where the uint belongs (§3.6).
      [bytes("81f97e00"), "malformed"],
      // Decodes, but is not the one-element array §11.3 fixes.
      [bytes("820102"), "shape"],
      [bytes("80"), "shape"],
      [bytes("01"), "shape"],
      // A negative integer is not a uint.
      [bytes("8120"), "shape"],
    ];
    for (const [body, reason] of bodies) {
      const decoded = decodeE2eeErrorRecordBody(body);
      expect(decoded.kind).toBe("error");
      if (decoded.kind === "error") expect(decoded.reason).toBe(reason);

      const pair = endpointPair();
      const envelope = await transmitRaw(pair.node, E2EE_INNER_TYPE_ERROR, body);
      const result = deliver(pair.client, envelope, 0);
      expect(result.kind).toBe("fatal");
      if (result.kind === "fatal") {
        expect(result.row).toBe("Q11");
        expect(result.reason).toBe("malformed_error_body");
        expect(result.decodeError).toBe(reason);
      }
      // §10.4: **Failed**, as every FATAL-POST condition is.
      expect(pair.client.machine.verdict).toBe("failed");
      expect(pair.client.machine.state).toBe("ended");
      // Not the peer's terminal record, so §11.3's ordinary procedure applies
      // and this endpoint still owes its own one `E2EEError`.
      expect(pair.client.machine.mayProtectTerminalError).toBe(true);
    }
  });
});

describe("relay E2EE outer close ordering (§10.3)", () => {
  it("holds the outer close until the encrypted peer proof, in every role", async () => {
    const pair = endpointPair();
    // Outside a close phase §10.3 has nothing to say.
    expect(pair.client.machine.outerCloseAllowed(0)).toBe(true);

    const close = await sendClose(pair.client, 0);
    // Enqueueing one's own final records is never sufficient.
    expect(pair.client.machine.outerCloseAllowed(0)).toBe(false);
    deliver(pair.node, close, 1);
    expect(pair.node.machine.outerCloseAllowed(1)).toBe(false);
    const ack = await sendCloseAck(pair.node, 1);
    expect(pair.node.machine.outerCloseAllowed(1)).toBe(false);

    deliver(pair.client, ack, 2);
    expect(pair.client.machine.outerCloseAllowed(2)).toBe(false);
    const confirmation = await sendCloseAck(pair.client, 2);
    expect(pair.client.machine.outerCloseAllowed(2)).toBe(true);
    expect(pair.client.machine.shouldLinger(2)).toBe(true);
    expect(pair.client.machine.shouldLinger(2 + T_CLOSE_LINGER_MAX)).toBe(false);

    deliver(pair.node, confirmation, 3);
    expect(pair.node.machine.outerCloseAllowed(3)).toBe(true);
    expect(pair.node.machine.shouldLinger(3)).toBe(false);
  });

  it("keeps the worst-case simultaneous phase inside the §3.2.2 L5 budget", async () => {
    const pair = endpointPair();
    const start = 0;
    const iClose = await sendClose(pair.client, start);
    const rClose = await sendClose(pair.node, start);
    expect(pair.client.machine.waitDeadlineAt).toBe(start + T_CLOSE);

    // The peer's `E2EEClose` is delivered just inside the FIRST deadline, so the
    // endpoint takes the simultaneous branch and waits a second time.
    const branchAt = start + T_CLOSE - 1;
    deliver(pair.client, rClose, branchAt);
    expect(pair.client.machine.waitDeadlineAt).toBe(start + T_CLOSE);
    const iAck = await sendCloseAck(pair.client, branchAt);
    expect(pair.client.machine.waitsArmed).toBe(2);
    expect(pair.client.machine.waitDeadlineAt).toBe(branchAt + T_CLOSE);
    expect(pair.client.machine.lingerDeadlineAt).toBe(branchAt + T_CLOSE_LINGER_MAX);

    // The peer's `E2EECloseAck` is delivered just inside the SECOND deadline.
    deliver(pair.node, iClose, branchAt);
    const rAck = await sendCloseAck(pair.node, branchAt);
    const ackAt = branchAt + T_CLOSE - 1;
    expect(pair.client.machine.waitExpired(ackAt)).toBe(false);
    expect(deliver(pair.client, rAck, ackAt).kind).toBe("close_ack");
    expect(pair.client.machine.verdict).toBe("clean");
    deliver(pair.node, iAck, ackAt);

    // The peer's outer `channel.close` is withheld, so the linger runs its bound.
    const phaseEnd = Math.max(ackAt, pair.client.machine.lingerDeadlineAt!);
    expect(pair.client.machine.lingerDeadlineAt! - branchAt).toBe(T_CLOSE_LINGER_MAX);
    expect(phaseEnd - start).toBeLessThanOrEqual(2 * T_CLOSE + T_CLOSE_LINGER_MAX);
    expect(2 * T_CLOSE + T_CLOSE_LINGER_MAX + T_KEEPALIVE_FLUSH_MARGIN).toBeLessThanOrEqual(
      RPC_KEEPALIVE_INTERVAL,
    );
    // The simultaneous transition neither restarted nor extended either wait.
    expect(pair.client.machine.waitsArmed).toBe(2);
    // And the verdict was fixed at completion, before any outer close.
    expect(pair.client.machine.noteChannelEnded({ at: phaseEnd })).toBe("clean");
  });
});

describe("relay E2EE close machine local guards", () => {
  it("refuses to initiate twice, to acknowledge nothing, or to exceed the §9.6 close reserve", async () => {
    const pair = endpointPair();
    expect(() =>
      pair.client.machine.buildCloseAck({
        sendPosition: { epoch: 0n, counter: 0n },
        expectedRecv: { epoch: 0n, counter: 0n },
      }),
    ).toThrow(TypeError);
    await sendClose(pair.client, 0);
    expect(() =>
      pair.client.machine.buildClose({
        sendPosition: { epoch: 0n, counter: 1n },
        expectedRecv: { epoch: 0n, counter: 0n },
      }),
    ).toThrow(TypeError);
    expect(E2EE_CLOSE_RECORDS_RESERVED).toBe(2);
  });

  it("refuses a transmission report that does not match the record it built", async () => {
    const pair = endpointPair();
    const record = pair.client.machine.buildClose(buildInput(pair.client));
    expect(() =>
      pair.client.machine.noteTransmitted({
        record,
        epoch: 0n,
        counter: 1n,
        epochCompleted: false,
        at: 0,
      }),
    ).toThrow(TypeError);
    expect(() =>
      pair.client.machine.noteTransmitted({
        record: { ...record },
        epoch: 0n,
        counter: 0n,
        epochCompleted: false,
        at: 0,
      }),
    ).toThrow(TypeError);
  });

  it("refuses a wait expiry it does not have", async () => {
    const pair = endpointPair();
    expect(() => pair.client.machine.noteWaitExpired(0)).toThrow(TypeError);
    await sendClose(pair.client, 0);
    expect(() => pair.client.machine.noteWaitExpired(T_CLOSE)).toThrow(TypeError);
  });

  it("validates a transmission report before it commits any part of it", async () => {
    // `noteTransmitted` runs after the record is already on the wire, so an
    // argument it rejects MUST be rejected before the anchor is fixed, the
    // record is counted, or a wait is armed — a throw in the middle of that
    // would leave the machine holding half a transition for a record the peer
    // has already seen, with no deadline and no anchor.
    const pair = endpointPair();
    const record = pair.client.machine.buildClose(buildInput(pair.client));
    expect(() =>
      pair.client.machine.noteTransmitted({
        record,
        epoch: 0n,
        counter: 0n,
        epochCompleted: false,
        at: Number.NaN,
      }),
    ).toThrow(TypeError);
    expect(pair.client.machine.state).toBe("open");
    expect(pair.client.machine.closeRecordsSent).toBe(0);
    expect(pair.client.machine.closeAnchor).toBeUndefined();
    expect(pair.client.machine.closeAnchorUnavailable).toBe(false);
    expect(pair.client.machine.waitsArmed).toBe(0);
    // The record is still the one the machine owes, so a correct report of the
    // same transmission still commits it.
    pair.client.machine.noteTransmitted({
      record,
      epoch: 0n,
      counter: 0n,
      epochCompleted: false,
      at: 0,
    });
    expect(pair.client.machine.state).toBe("awaiting_ack");
    expect(pair.client.machine.waitsArmed).toBe(1);
  });
});

describe("relay E2EE §9.6 degenerate state on the receive side", () => {
  /**
   * The mirror of the anchor case: the PEER's `E2EEClose` is carried at the last
   * position its direction has, so this endpoint has no §9.2 expected-next
   * receive for its ack to declare. §9.6 makes that a close outcome — **Unclean
   * — abrupt**, no wire record — and a peer sitting at that boundary MUST NOT be
   * able to raise an exception inside a conforming endpoint.
   */
  const boundaryPair = () =>
    endpointPair({
      c2n: {
        epoch: E2EE_EPOCH_MAX,
        counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
        epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
      },
    });

  it("produces the degenerate state instead of throwing when the peer's close exhausts its direction", async () => {
    const pair = boundaryPair();
    const close = await sendClose(pair.client, 0);
    // The sender's own half, already covered by the anchor case, restated here
    // as the precondition of the receiver's half.
    expect(pair.client.machine.closeAnchorUnavailable).toBe(true);

    const received = deliver(pair.node, close, 1_000);
    expect(received.kind).toBe("close");
    expect(pair.node.session.receiveState.exhausted).toBe(true);
    // Reading what the owed ack would declare is a PURE READ, and there is
    // nothing to declare.
    expect(pair.node.machine.ackExpectedRecv).toBeUndefined();
    expect(pair.node.machine.ackExpectedRecvUnavailable).toBe(true);
    // §9.6: the outcome is a verdict, not an exception, and no wire record is
    // owed for it — which is also the only disposition that leaves the peer at
    // **Unclean — abrupt**, since its anchor is unavailable too and it would
    // reject any ack as Q7.
    expect(pair.node.machine.verdict).toBe("unclean_abrupt");
    expect(pair.node.machine.pendingRecord).toBeUndefined();
    // The driver cannot even compute an `expectedRecv` — the direction has no
    // next position — and the machine owes no record it could put one in.
    expect(() => buildInput(pair.node)).toThrow();
    expect(() =>
      pair.node.machine.buildCloseAck({
        sendPosition: position(pair.node.session.sendState),
        expectedRecv: { epoch: E2EE_EPOCH_MAX, counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1) },
      }),
    ).toThrow(TypeError);
    // §10.3: the responder's single `T_CLOSE` wait is armed, so the outer close
    // is withheld until it expires rather than forever or immediately.
    expect(pair.node.machine.waitsArmed).toBe(1);
    expect(pair.node.machine.waitDeadlineAt).toBe(1_000 + T_CLOSE);
    expect(pair.node.machine.outerCloseAllowed(1_000 + T_CLOSE)).toBe(false);
    expect(pair.node.machine.outerCloseAllowed(1_000 + T_CLOSE + 1)).toBe(true);
    expect(pair.node.machine.noteWaitExpired(1_000 + T_CLOSE + 1)).toBe("unclean_abrupt");
  });

  it("arms no second wait when the boundary close lands in the simultaneous branch", async () => {
    const pair = boundaryPair();
    const close = await sendClose(pair.client, 0);
    // The node sends its own close first, so the peer's close makes the branch
    // simultaneous and the node's first wait is already running. §10.2 forbids
    // restarting or extending it, so the degenerate state arms nothing and the
    // wait that expires is the one the node's own close opened.
    await sendClose(pair.node, 500);
    expect(pair.node.machine.waitsArmed).toBe(1);
    expect(deliver(pair.node, close, 1_000).kind).toBe("close");
    expect(pair.node.machine.branch).toBe("simultaneous");
    expect(pair.node.machine.ackExpectedRecv).toBeUndefined();
    expect(pair.node.machine.ackExpectedRecvUnavailable).toBe(true);
    expect(pair.node.machine.pendingRecord).toBeUndefined();
    expect(pair.node.machine.verdict).toBe("unclean_abrupt");
    expect(pair.node.machine.waitsArmed).toBe(1);
    expect(pair.node.machine.waitDeadlineAt).toBe(500 + T_CLOSE);
  });

  it("keeps the ordinary ack declaration one position short of the boundary", async () => {
    const pair = endpointPair({
      c2n: {
        epoch: E2EE_EPOCH_MAX,
        counter: BigInt(E2EE_REKEY_MAX_RECORDS - 2),
        epochRecords: E2EE_REKEY_MAX_RECORDS - 2,
      },
    });
    const close = await sendClose(pair.client, 0);
    deliver(pair.node, close, 1_000);
    expect(pair.node.machine.ackExpectedRecvUnavailable).toBe(false);
    expect(at(pair.node.machine.ackExpectedRecv!)).toBe(
      `${E2EE_EPOCH_MAX}:${BigInt(E2EE_REKEY_MAX_RECORDS - 1)}`,
    );
    expect(pair.node.machine.pendingRecord).toBe("close_ack");
    expect(pair.node.machine.verdict).toBeUndefined();
  });
});
