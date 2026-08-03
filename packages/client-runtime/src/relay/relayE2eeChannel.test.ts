import {
  RELAY_INITIAL_LIMITS,
  RelayLimits,
  type RelayLimits as RelayLimitsType,
} from "@ryco/contracts";
import {
  E2EE_CLOSE_RECORDS_RESERVED,
  E2EE_COUNTER_MAX,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_ERROR_RECORDS_RESERVED,
  E2EE_REKEY_MAX_BYTES,
  E2EE_REKEY_MAX_RECORDS,
  T_CLOSE,
  T_CLOSE_LINGER_MAX,
  e2eeChannelSizeBudget,
} from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_ERROR_CODE_PROTOCOL_VIOLATION,
  E2eeCloseMachine,
  encodeE2eeErrorRecordBody,
  type E2eeCloseRecordToSend,
  type E2eeSequencePosition,
} from "@ryco/shared/relayE2eeClose";
import {
  E2EE_CLOSE_RECORD_PLAINTEXT_BYTES,
  E2EE_POST_APPLICATION_RESERVE_PLAINTEXT_BYTES,
  E2eeRecordSession,
  e2eeSessionSecretsFromNoiseKeys,
  type E2eeSessionSecrets,
  type E2eeSyntheticDirectionState,
} from "@ryco/shared/relayE2eeSession";
import {
  E2EE_INNER_TYPE_CLOSE,
  E2EE_INNER_TYPE_CLOSE_ACK,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  decodeE2eeEnvelope,
  encodeE2eeEnvelope,
  type E2eeInnerRecordType,
} from "@ryco/shared/relayE2eeWire";
import { describe, expect, it } from "vite-plus/test";

import {
  CLIENT_E2EE_RECEIVE_FATAL_ROWS,
  makeRelayE2eeClientChannel,
  type RelayE2eeChannelDiagnostic,
} from "./relayE2eeChannel";
import {
  relayE2eeFailure,
  type HostedRelayFailure,
  type RelayE2eeFailureKind,
  type RelayE2eeHost,
  type RelayE2eeReservation,
} from "./relayEngine";

// §16.1-style TEST-ONLY material: fixed counting patterns, reproducible from
// the document alone. None of it may ever reach a real endpoint.
const EPOCH_SECRET_C2N = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const EPOCH_SECRET_N2C = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const EXPORTER_SECRET = "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f";
const SESSION_BINDING_HASH = "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f";

const hexBytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const bindingHash = (): Uint8Array => hexBytes(SESSION_BINDING_HASH);
const SUITE = E2EE_SUITE_25519_CHACHAPOLY_SHA256;

/** Two independent copies, because the record session takes ownership (§6.5). */
function secrets(): E2eeSessionSecrets {
  return e2eeSessionSecretsFromNoiseKeys({
    epochSecretC2N: hexBytes(EPOCH_SECRET_C2N),
    epochSecretN2C: hexBytes(EPOCH_SECRET_N2C),
    exporterSecret: hexBytes(EXPORTER_SECRET),
  });
}

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// ─── the engine seam, faked ──────────────────────────────────────────────────

interface Wire {
  /** Every envelope the channel handed to the reservation. */
  readonly sent: Uint8Array[];
  /** Reservations taken, spent, and released — the §9.3 accounting. */
  admitted: number;
  spent: number;
  released: number;
  /** Refuse admission entirely: ordinary backpressure (§11.4). */
  refuseAdmission: boolean;
  /** The reservation is granted but the send path takes nothing (§9.3 `none`). */
  refuseSend: boolean;
  /** The send path fails unreadably: §9.3's `ambiguous` delivery, not `none`. */
  throwOnSend: boolean;
  /** Run inside `admit`, after the reservation is granted (§9.3's race window). */
  onAdmit: (() => void) | undefined;
  readonly closes: (HostedRelayFailure | undefined)[];
  now: number;
  readonly timers: Map<number, { at: number; callback: () => void }>;
  /** Every timer duration armed, so a `T_CLOSE` wait is countable (§10.2, §15). */
  readonly armed: number[];
}

function makeHost(limits: RelayLimitsType = RELAY_INITIAL_LIMITS): {
  readonly host: RelayE2eeHost;
  readonly wire: Wire;
  readonly advance: (ms: number) => void;
} {
  let nextTimer = 1;
  const wire: Wire = {
    sent: [],
    admitted: 0,
    spent: 0,
    released: 0,
    refuseAdmission: false,
    refuseSend: false,
    throwOnSend: false,
    onAdmit: undefined,
    closes: [],
    now: 1_000,
    timers: new Map(),
    armed: [],
  };
  const host: RelayE2eeHost = {
    limits,
    admit: (messageBytes): RelayE2eeReservation | undefined => {
      if (wire.refuseAdmission || messageBytes <= 0) return undefined;
      wire.admitted += 1;
      wire.onAdmit?.();
      let settled = false;
      return {
        // Mirrors the engine's own reservation: capacity is spent on the
        // attempt, so a refusal settles too and only a record that never
        // reached the send path at all can be released.
        send: (message) => {
          if (settled) return false;
          settled = true;
          if (wire.throwOnSend) throw new Error("relay send failed unreadably");
          if (wire.refuseSend) return false;
          wire.spent += 1;
          wire.sent.push(Uint8Array.from(message));
          return true;
        },
        release: () => {
          if (settled) return;
          settled = true;
          wire.released += 1;
        },
      };
    },
    close: (failure) => wire.closes.push(failure),
    now: () => wire.now,
    setTimeout: (callback, ms) => {
      const id = nextTimer++;
      wire.armed.push(ms);
      wire.timers.set(id, { at: wire.now + ms, callback });
      return id;
    },
    clearTimeout: (id) => void wire.timers.delete(id as number),
  };
  const advance = (ms: number): void => {
    wire.now += ms;
    for (const [id, timer] of [...wire.timers]) {
      if (timer.at > wire.now) continue;
      wire.timers.delete(id);
      timer.callback();
    }
  };
  return { host, wire, advance };
}

// ─── the peer, which is the node half of the same session ────────────────────

interface Peer {
  readonly session: E2eeRecordSession;
  readonly machine: E2eeCloseMachine;
  readonly protect: (innerType: E2eeInnerRecordType, body: Uint8Array) => Promise<Uint8Array>;
  readonly authenticate: (envelope: Uint8Array) => {
    readonly innerType: E2eeInnerRecordType;
    readonly body: Uint8Array;
    readonly epoch: bigint;
    readonly counter: bigint;
    readonly epochCompleted: boolean;
  };
  readonly sendPosition: () => E2eeSequencePosition;
  readonly expectedRecv: () => E2eeSequencePosition;
  readonly transmit: (record: E2eeCloseRecordToSend) => Promise<Uint8Array>;
}

function makePeer(
  options: {
    readonly limits?: RelayLimitsType;
    readonly send?: E2eeSyntheticDirectionState;
    readonly receive?: E2eeSyntheticDirectionState;
  } = {},
): Peer {
  const limits = options.limits ?? RELAY_INITIAL_LIMITS;
  const sessionBindingHash = bindingHash();
  const session = new E2eeRecordSession({
    secrets: secrets(),
    suite: SUITE,
    sessionBindingHash,
    sendDirection: "n2c",
    plaintextCeiling: e2eeChannelSizeBudget(limits).plaintextCeiling,
    ...(options.send === undefined ? {} : { testOnlySyntheticSendState: options.send }),
    ...(options.receive === undefined ? {} : { testOnlySyntheticReceiveState: options.receive }),
  });
  const machine = new E2eeCloseMachine({ sessionBindingHash, sendDirection: "n2c" });
  const position = (state: { epoch: bigint | undefined; counter: bigint | undefined }) => {
    if (state.epoch === undefined || state.counter === undefined) {
      throw new Error("peer direction is exhausted");
    }
    return { epoch: state.epoch, counter: state.counter };
  };
  // A test stub is not a send path: `admit` here stands for a relay that always
  // has room, which is precisely the assumption production code may not make.
  const protect = async (innerType: E2eeInnerRecordType, body: Uint8Array) => {
    let envelope: Uint8Array | undefined;
    const result = await session.protect({
      innerType,
      body,
      admit: () => true,
      transmit: (bytes) => {
        envelope = Uint8Array.from(bytes);
        return { kind: "sent" };
      },
    });
    if (result.kind !== "protected" || envelope === undefined) {
      throw new Error(`peer could not protect a record: ${result.kind}`);
    }
    return envelope;
  };
  return {
    session,
    machine,
    protect,
    authenticate: (envelope) => {
      const result = session.unprotect(envelope);
      if (result.kind !== "authenticated") {
        throw new Error(`peer could not authenticate a record: ${result.reason}`);
      }
      return result;
    },
    sendPosition: () => position(session.sendState),
    expectedRecv: () => position(session.receiveState),
    transmit: async (record) => {
      const envelope = await protect(record.innerType, record.body);
      const header = decodeE2eeEnvelope(envelope);
      if (header.kind !== "ok") throw new Error("peer produced a malformed envelope");
      machine.noteTransmitted({
        record,
        epoch: header.value.epoch,
        counter: header.value.counter,
        epochCompleted: session.sendState.counter === 0n,
        at: 1_000,
      });
      return envelope;
    },
  };
}

// ─── the channel under test ──────────────────────────────────────────────────

function makeChannel(
  options: {
    readonly limits?: RelayLimitsType;
    readonly send?: E2eeSyntheticDirectionState;
    readonly receive?: E2eeSyntheticDirectionState;
  } = {},
) {
  const { host, wire, advance } = makeHost(options.limits);
  const diagnostics: RelayE2eeChannelDiagnostic[] = [];
  const channel = makeRelayE2eeClientChannel({
    host,
    secrets: secrets(),
    suite: SUITE,
    sessionBindingHash: bindingHash(),
    onDiagnostic: (value) => diagnostics.push(value),
    ...(options.send === undefined ? {} : { testOnlySyntheticSendState: options.send }),
    ...(options.receive === undefined ? {} : { testOnlySyntheticReceiveState: options.receive }),
  });
  return { channel, host, wire, advance, diagnostics };
}

function envelopeHeader(envelope: Uint8Array): { epoch: bigint; counter: bigint } {
  const decoded = decodeE2eeEnvelope(envelope);
  if (decoded.kind !== "ok") throw new Error("malformed envelope");
  return { epoch: decoded.value.epoch, counter: decoded.value.counter };
}

const RPC = new TextEncoder().encode('{"method":"noop"}');

// ─── §9.3 admission, the pair, and the AEAD ──────────────────────────────────

describe("relay E2EE client channel: §9.3 admission before assignment", () => {
  it("consumes no pair, encrypts nothing, and emits nothing when admission refuses", async () => {
    const { channel, wire } = makeChannel();
    wire.refuseAdmission = true;

    expect(await channel.emit(RPC)).toBe(false);

    expect(wire.sent).toEqual([]);
    expect(wire.admitted).toBe(0);
    // The pair the refused record would have taken is untouched, and the
    // channel is usable: §11.4's "channel unaffected".
    expect(channel.sendPosition()).toEqual({ epoch: 0n, counter: 0n });
    expect(channel.verdict()).toBeUndefined();
    expect(wire.closes).toEqual([]);

    wire.refuseAdmission = false;
    expect(await channel.emit(RPC)).toBe(true);
    // THE NEXT SUCCESSFUL RECORD TAKES THE SAME PAIR. A rollback that reused a
    // nonce with different plaintext is a total break of the AEAD, so the pair
    // must never have been assigned at all.
    expect(envelopeHeader(wire.sent[0]!)).toEqual({ epoch: 0n, counter: 0n });
    expect(channel.sendPosition()).toEqual({ epoch: 0n, counter: 1n });
  });

  it("releases an admitted reservation the record never spends", async () => {
    const { channel, wire } = makeChannel();
    wire.refuseSend = true;

    expect(await channel.emit(RPC)).toBe(false);

    // The reservation was taken and the record was built; the send path took no
    // byte of it. Nothing is left holding relay capacity.
    expect(wire.admitted).toBe(1);
    expect(wire.spent).toBe(0);
    expect(wire.sent).toEqual([]);
  });

  it("gives the reservation back when the session is erased between admission and transmit", async () => {
    // §9.3's own race window: `protect` re-checks erasure AFTER admission, so a
    // channel that ended while a send sat at that await answers `unavailable`
    // having never called `transmit`. Without the release the engine's
    // `#outboundReservedBytes` would be permanently inflated by the whole
    // multi-chunk reservation, and every later admission would see less capacity
    // — a channel that silently degrades to admitting nothing at all.
    const { channel, wire } = makeChannel();
    wire.onAdmit = () => channel.dispose({});

    expect(await channel.emit(RPC)).toBe(false);

    expect(wire.admitted).toBe(1);
    expect(wire.released).toBe(1);
    expect(wire.spent).toBe(0);
    expect(wire.sent).toEqual([]);
  });

  it("leaves the channel alone when the send path declines a record in this state", async () => {
    // §10.2's application-phase gate, reached from the RECORD SESSION rather
    // than from the close machine: this `emit` was admitted while the machine
    // was still open and ordered behind the `E2EEClose`, so by the time it is
    // protected the send path is closing and declines it. That is §11.4's "leave
    // the channel exactly as they found it" — the opposite of §11.3's erase,
    // record **Failed**, and tear the connection down non-retryably.
    const { channel, wire, diagnostics } = makeChannel();

    const closing = channel.beginClose();
    const sending = channel.emit(RPC);

    expect(await sending).toBe(false);
    expect(wire.sent).toHaveLength(1);
    expect(wire.closes).toEqual([]);
    expect(channel.verdict()).toBeUndefined();
    expect(diagnostics).toEqual([]);
    void closing;
  });

  it("leaves the channel usable when the send path declines a record it cannot attribute", async () => {
    // §9.3's `ambiguous` branch: the pair is spent and this endpoint can
    // establish nothing about delivery. §11.4 and §11.3 Q10 are BOTH wrong for
    // it — it is neither retryable backpressure nor a failure this sender may
    // resolve by tearing the channel down — so `emit` refuses the message and
    // changes nothing else.
    const { channel, wire, diagnostics } = makeChannel();
    wire.throwOnSend = true;

    expect(await channel.emit(RPC)).toBe(false);

    expect(wire.closes).toEqual([]);
    expect(channel.verdict()).toBeUndefined();
    expect(diagnostics).toEqual([]);
    // The pair IS consumed — §11.4's "channel unaffected" is false of it — which
    // is exactly why it is not reported as backpressure.
    expect(channel.sendPosition()).toEqual({ epoch: 0n, counter: 1n });
  });

  it("serializes concurrent sends so no two records observe the same pair", async () => {
    const { channel, wire } = makeChannel();

    const results = await Promise.all([channel.emit(RPC), channel.emit(RPC), channel.emit(RPC)]);

    expect(results).toEqual([true, true, true]);
    expect(wire.sent.map(envelopeHeader)).toEqual([
      { epoch: 0n, counter: 0n },
      { epoch: 0n, counter: 1n },
      { epoch: 0n, counter: 2n },
    ]);
    expect(channel.sendPosition()).toEqual({ epoch: 0n, counter: 3n });
  });

  it("protects nothing further and emits no E2EEError after a zero-byte send failure", async () => {
    const { channel, wire, diagnostics } = makeChannel();
    wire.refuseSend = true;

    expect(await channel.emit(RPC)).toBe(false);

    // §11.3 Q10: the peer's expected-next pair is still the consumed one, so an
    // `E2EEError` would itself create the gap being avoided.
    expect(wire.sent).toEqual([]);
    expect(diagnostics).toEqual([{ phase: "post_key", row: "Q10", verdict: "failed" }]);
    // The outer close IS emitted, and it is the non-retryable §11.1 one.
    expect(wire.closes).toEqual([relayE2eeFailure("send_path_unusable")]);
    expect(wire.closes[0]).toMatchObject({ kind: "protocol", retryable: false });

    wire.refuseSend = false;
    expect(await channel.emit(RPC)).toBe(false);
    expect(wire.sent).toEqual([]);
  });
});

// ─── §4.5 the plaintext ceiling ──────────────────────────────────────────────

describe("relay E2EE client channel: §4.5 plaintext ceiling", () => {
  it("derives the ceiling from the ready limits through e2eeChannelSizeBudget", async () => {
    const limits = RelayLimits.make({
      ...RELAY_INITIAL_LIMITS,
      maxControlFrameBytes: 1_024,
      maxDataChunkBytes: 1_024,
      maxQueuedBytes: 65_536,
    });
    const budget = e2eeChannelSizeBudget(limits);
    expect(budget.plaintextCeiling).toBe(65_536 - 1_024 - E2EE_ENVELOPE_OVERHEAD_BYTES);
    const { channel, wire } = makeChannel({ limits });

    // One byte over the ceiling is `e2ee_message_too_large` (§11.4): nothing
    // encrypted, nothing transmitted, no pair consumed, channel usable.
    expect(await channel.emit(new Uint8Array(budget.plaintextCeiling + 1))).toBe(false);
    expect(wire.sent).toEqual([]);
    expect(wire.admitted).toBe(0);
    expect(channel.sendPosition()).toEqual({ epoch: 0n, counter: 0n });

    expect(await channel.emit(new Uint8Array(budget.plaintextCeiling))).toBe(true);
    expect(wire.sent).toHaveLength(1);
  });

  it("fails the channel during establishment when the ceiling is not positive", () => {
    // The whole queue is one control frame, so `effectiveMessageCeiling` is 0
    // and the ceiling is negative — a combination the Hub asserts and both
    // endpoints must adopt verbatim (§4.5).
    const limits = RelayLimits.make({
      ...RELAY_INITIAL_LIMITS,
      maxControlFrameBytes: 2_048,
      maxDataChunkBytes: 1_024,
      maxQueuedBytes: 2_048,
    });
    expect(e2eeChannelSizeBudget(limits).establishable).toBe(false);
    const { host } = makeHost(limits);

    // §4.5 P14: the channel MUST fail before it is released to the application,
    // rather than carry a silently shrunk ceiling.
    expect(() =>
      makeRelayE2eeClientChannel({
        host,
        secrets: secrets(),
        suite: SUITE,
        sessionBindingHash: bindingHash(),
      }),
    ).toThrow("positive plaintext ceiling");
  });
});

// ─── §9.4 the epoch schedule ─────────────────────────────────────────────────

describe("relay E2EE client channel: §9.4 epoch schedule", () => {
  it("makes the record that reaches the record threshold the last of its epoch", async () => {
    const { channel, wire } = makeChannel({
      send: {
        epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
        counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
      },
    });

    expect(await channel.emit(RPC)).toBe(true);
    expect(envelopeHeader(wire.sent[0]!)).toEqual({
      epoch: 0n,
      counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
    });
    // Boundary ownership: the next record carries `(e + 1, 0)` and never
    // counter + 1, and the sender cannot enter the epoch early.
    expect(channel.sendPosition()).toEqual({ epoch: 1n, counter: 0n });

    expect(await channel.emit(RPC)).toBe(true);
    expect(envelopeHeader(wire.sent[1]!)).toEqual({ epoch: 1n, counter: 0n });
  });

  it("counts a control record toward the byte threshold like every other record", async () => {
    // One close record's authenticated inner plaintext short of the byte
    // threshold: the `E2EEClose` is a control record, it counts toward both §9.4
    // thresholds like every other record, and it therefore completes the epoch.
    const { channel, wire } = makeChannel({
      send: { epochBytes: E2EE_REKEY_MAX_BYTES - E2EE_CLOSE_RECORD_PLAINTEXT_BYTES },
    });

    void channel.beginClose();
    await tick();
    expect(envelopeHeader(wire.sent[0]!)).toEqual({ epoch: 0n, counter: 0n });
    expect(channel.sendPosition()).toEqual({ epoch: 1n, counter: 0n });
  });

  it("holds epochs and counters exactly at the uint32 and uint64 extremes", async () => {
    const { channel, wire } = makeChannel({
      send: { epoch: E2EE_EPOCH_MAX, counter: E2EE_COUNTER_MAX - 1n },
    });

    expect(await channel.emit(RPC)).toBe(true);
    const header = envelopeHeader(wire.sent[0]!);
    // Exact over the full field range: `2^32 − 1` and `2^64 − 2` survive as
    // bigints, which a JS `number` could not represent.
    expect(header.epoch).toBe(E2EE_EPOCH_MAX);
    expect(header.counter).toBe(E2EE_COUNTER_MAX - 1n);
    expect(channel.sendPosition()).toEqual({ epoch: E2EE_EPOCH_MAX, counter: E2EE_COUNTER_MAX });
  });
});

// ─── §9.6 the post-application reserve ───────────────────────────────────────

describe("relay E2EE client channel: §9.6 post-application reserve", () => {
  it("refuses an application record that would leave less than the reserve and closes", async () => {
    const reserved = E2EE_POST_APPLICATION_RESERVE_PLAINTEXT_BYTES.length;
    expect(reserved).toBe(E2EE_CLOSE_RECORDS_RESERVED + E2EE_ERROR_RECORDS_RESERVED);
    const { channel, wire } = makeChannel({
      send: {
        epoch: E2EE_EPOCH_MAX,
        epochRecords: E2EE_REKEY_MAX_RECORDS - reserved,
        counter: BigInt(E2EE_REKEY_MAX_RECORDS - reserved),
      },
    });

    // Exactly the reserve remains, so the endpoint MUST initiate §10's close at
    // this point rather than protect the record.
    expect(await channel.emit(RPC)).toBe(false);
    await tick();

    expect(wire.sent).toHaveLength(1);
    const close = decodeE2eeEnvelope(wire.sent[0]!);
    expect(close.kind).toBe("ok");
    expect(channel.verdict()).toBeUndefined();
  });
});

// ─── §9.2 receiver sequencing ────────────────────────────────────────────────

describe("relay E2EE client channel: §9.2 receiver sequencing", () => {
  it("delivers an in-order authenticated RPC record to the application", async () => {
    const { channel } = makeChannel();
    const peer = makePeer();
    const envelope = await peer.protect(E2EE_INNER_TYPE_RPC, RPC);

    const disposition = await channel.intercept(envelope);

    expect(disposition).toEqual({ kind: "rpc", message: RPC });
    expect(channel.expectedRecv()).toEqual({ epoch: 0n, counter: 1n });
  });

  it.each([
    ["a gap", 2n],
    ["a repeat", 0n],
    ["a regression", 0n],
  ] as const)(
    "treats %s as FATAL-POST without decrypting the ciphertext",
    async (_label, counter) => {
      const { channel, wire, diagnostics } = makeChannel();
      const peer = makePeer();
      const first = await peer.protect(E2EE_INNER_TYPE_RPC, RPC);
      expect((await channel.intercept(first)).kind).toBe("rpc");
      const next = await peer.protect(E2EE_INNER_TYPE_RPC, RPC);
      const decoded = decodeE2eeEnvelope(next);
      if (decoded.kind !== "ok") throw new Error("malformed envelope");
      // The pair is rewritten and nothing else is: the AAD no longer matches, so
      // a receiver that decrypted first would report an authentication failure
      // (Q3) instead of the sequence mismatch (Q2) §9.2 requires.
      const tampered = encodeE2eeEnvelope({
        suite: SUITE,
        epoch: 0n,
        counter,
        ciphertext: decoded.value.ciphertext,
      });

      const disposition = await channel.intercept(tampered);

      expect(disposition).toEqual({ kind: "rejected" });
      expect(diagnostics).toEqual([{ phase: "post_key", row: "Q2", verdict: "failed" }]);
      // §11.3: one `E2EEError` while the send path is usable, then the close.
      expect(wire.sent).toHaveLength(1);
      expect(wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
    },
  );

  it("accepts an epoch transition only as +1 with counter 0 at the threshold boundary", async () => {
    const boundary = {
      epochRecords: E2EE_REKEY_MAX_RECORDS - 1,
      counter: BigInt(E2EE_REKEY_MAX_RECORDS - 1),
    };
    const { channel } = makeChannel({ receive: boundary });
    const peer = makePeer({ send: boundary });

    const last = await peer.protect(E2EE_INNER_TYPE_RPC, RPC);
    expect((await channel.intercept(last)).kind).toBe("rpc");
    expect(channel.expectedRecv()).toEqual({ epoch: 1n, counter: 0n });

    const next = await peer.protect(E2EE_INNER_TYPE_RPC, RPC);
    expect(envelopeHeader(next)).toEqual({ epoch: 1n, counter: 0n });
    expect((await channel.intercept(next)).kind).toBe("rpc");
  });

  it("rejects plaintext delivered on an established channel", async () => {
    const { channel, diagnostics } = makeChannel();

    const disposition = await channel.intercept(new TextEncoder().encode('{"legacy":true}'));

    expect(disposition).toEqual({ kind: "rejected" });
    expect(diagnostics).toEqual([{ phase: "post_key", row: "Q6", verdict: "failed" }]);
  });

  it("rejects a zero-length post-strip payload", async () => {
    const { channel, diagnostics } = makeChannel();

    expect(await channel.intercept(new Uint8Array(0))).toEqual({ kind: "rejected" });
    expect(diagnostics).toEqual([{ phase: "post_key", row: "Q6", verdict: "failed" }]);
  });
});

// ─── §9.5 erasure ────────────────────────────────────────────────────────────

describe("relay E2EE client channel: §9.5 erasure", () => {
  it("zeroes every session secret on a clean close", async () => {
    const held = secrets();
    const { host, wire, advance } = makeHost();
    const channel = makeRelayE2eeClientChannel({
      host,
      secrets: held,
      suite: SUITE,
      sessionBindingHash: bindingHash(),
    });
    const peer = makePeer();

    const closing = channel.beginClose();
    await tick();
    expect(peerReceive(peer, wire.sent[0]!).outcome.kind).toBe("close");
    const ack = await peer.transmit(
      peer.machine.buildCloseAck({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.machine.ackExpectedRecv!,
      }),
    );
    await channel.intercept(ack);
    await closing;
    // The §10.3 linger keeps the session alive on purpose — the peer's terminal
    // `E2EEError` may still arrive inside it and has to be authenticated — so
    // erasure is at the outer close, not at exchange completion.
    expect([...held.exporterSecret].some((byte) => byte !== 0)).toBe(true);
    advance(T_CLOSE_LINGER_MAX);

    expect(wire.closes).toEqual([undefined]);
    for (const secret of [
      held.epochSecretC2N,
      held.epochSecretN2C,
      held.exporterSecret,
      held.serverConfirmationKey,
    ]) {
      expect([...secret].every((byte) => byte === 0)).toBe(true);
    }
  });

  it("zeroes every session secret on the FATAL-POST path, after the E2EEError", async () => {
    const held = secrets();
    const { host, wire } = makeHost();
    const channel = makeRelayE2eeClientChannel({
      host,
      secrets: held,
      suite: SUITE,
      sessionBindingHash: bindingHash(),
    });

    await channel.intercept(new TextEncoder().encode('{"legacy":true}'));

    // §11.3's order: the one `E2EEError` goes out while the send path is still
    // usable, and only then is every secret overwritten (§9.5).
    expect(wire.sent).toHaveLength(1);
    expect(channel.verdict()).toBe("failed");
    for (const secret of [
      held.epochSecretC2N,
      held.epochSecretN2C,
      held.exporterSecret,
      held.serverConfirmationKey,
    ]) {
      expect([...secret].every((byte) => byte === 0)).toBe(true);
    }
  });

  it("zeroes every session secret when the channel simply ends", () => {
    const held = secrets();
    const { host } = makeHost();
    const channel = makeRelayE2eeClientChannel({
      host,
      secrets: held,
      suite: SUITE,
      sessionBindingHash: bindingHash(),
    });

    channel.dispose({});

    expect([...held.epochSecretC2N].every((byte) => byte === 0)).toBe(true);
    expect([...held.exporterSecret].every((byte) => byte === 0)).toBe(true);
  });
});

// ─── §10 the authenticated close ─────────────────────────────────────────────

/** Drive the peer's close machine over one of the client's records. */
function peerReceive(peer: Peer, envelope: Uint8Array, at = 1_000) {
  const record = peer.authenticate(envelope);
  const outcome = peer.machine.receive({
    innerType: record.innerType,
    body: record.body,
    envelope: { epoch: record.epoch, counter: record.counter },
    epochCompleted: record.epochCompleted,
    currentNextSend: peer.sendPosition(),
    at,
  });
  return { record, outcome };
}

describe("relay E2EE client channel: §10 authenticated close", () => {
  it("completes a sequential close as initiator with exactly one T_CLOSE wait", async () => {
    const { channel, wire, advance } = makeChannel();
    const peer = makePeer();

    const closing = channel.beginClose();
    await tick();
    expect(wire.sent).toHaveLength(1);
    // §10.3 lower bound: nothing is torn down before the peer's proof arrives.
    expect(wire.closes).toEqual([]);
    expect(wire.timers.size).toBe(1);

    const opened = peerReceive(peer, wire.sent[0]!);
    expect(opened.record.innerType).toBe(E2EE_INNER_TYPE_CLOSE);
    expect(opened.outcome.kind).toBe("close");
    const ack = await peer.transmit(
      peer.machine.buildCloseAck({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.machine.ackExpectedRecv!,
      }),
    );
    await channel.intercept(ack);
    await closing;

    // §10.2 step 4 at the peer: the final confirmation validates against the
    // responder's own anchor and completes its exchange too.
    const confirmation = peerReceive(peer, wire.sent[1]!);
    expect(confirmation.record.innerType).toBe(E2EE_INNER_TYPE_CLOSE_ACK);
    expect(confirmation.outcome).toMatchObject({ kind: "close_ack", exchangeComplete: true });
    expect(peer.machine.verdict).toBe("clean");

    // Two records from this endpoint — its close and its final confirmation —
    // and its verdict is recorded at exchange completion, BEFORE and
    // independently of the outer close (§10.3, §10.4).
    expect(wire.sent).toHaveLength(2);
    expect(channel.verdict()).toBe("clean");
    expect(wire.closes).toEqual([]);
    // §10.2: exactly ONE `T_CLOSE`-bounded wait on the sequential path, never a
    // second; what remains is the §10.3 linger, which is not a wait.
    expect(wire.armed.filter((ms) => ms === T_CLOSE)).toHaveLength(1);
    advance(T_CLOSE_LINGER_MAX);
    expect(wire.closes).toEqual([undefined]);
  });

  it("neither restarts nor extends an armed wait when another record arrives", async () => {
    const { channel, wire } = makeChannel();
    const peer = makePeer();

    void channel.beginClose();
    await tick();
    const armed = [...wire.armed];
    const deadlines = [...wire.timers.values()].map((timer) => timer.at);

    // The peer has not closed, so an authentic RPC record MAY still be
    // delivered (§10.2) — and it is not an event that touches the wait.
    expect((await channel.intercept(await peer.protect(E2EE_INNER_TYPE_RPC, RPC))).kind).toBe(
      "rpc",
    );

    expect(wire.armed).toEqual(armed);
    expect([...wire.timers.values()].map((timer) => timer.at)).toEqual(deadlines);
  });

  it("completes a sequential close as responder with exactly one T_CLOSE wait", async () => {
    const { channel, wire, advance } = makeChannel();
    const peer = makePeer();

    const close = await peer.transmit(
      peer.machine.buildClose({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );
    expect(await channel.intercept(close)).toEqual({ kind: "claimed" });
    // The responder answered with its ack and is waiting for the confirmation.
    expect(wire.sent).toHaveLength(1);
    expect(wire.closes).toEqual([]);

    expect(peerReceive(peer, wire.sent[0]!).outcome.kind).toBe("close_ack");
    const confirmation = await peer.transmit(
      peer.machine.buildCloseAck({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );
    await channel.intercept(confirmation);

    expect(channel.verdict()).toBe("clean");
    // §10.2: exactly ONE wait on this path too.
    expect(wire.armed.filter((ms) => ms === T_CLOSE)).toHaveLength(1);
    // The responder is not a last-record sender: it closes immediately.
    expect(wire.closes).toEqual([undefined]);
    advance(T_CLOSE * 3);
    expect(wire.closes).toEqual([undefined]);
  });

  it("passes an honest simultaneous close under the strict rule with exactly two waits", async () => {
    const { channel, wire, advance } = makeChannel();
    const peer = makePeer();

    // Both sides send `E2EEClose` before either has seen the other's.
    const closing = channel.beginClose();
    await tick();
    const clientClose = wire.sent[0]!;
    const peerClose = await peer.transmit(
      peer.machine.buildClose({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );
    expect(peerReceive(peer, clientClose).outcome.kind).toBe("close");
    expect(await channel.intercept(peerClose)).toEqual({ kind: "claimed" });

    // Each side now owes an ack computed after processing the peer's close, and
    // validates the peer's against its OWN anchor — the advance of its own
    // `E2EEClose` position, never its current next-send, which is by
    // construction one advance further along.
    const clientAck = wire.sent[1]!;
    const peerAck = await peer.transmit(
      peer.machine.buildCloseAck({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.machine.ackExpectedRecv!,
      }),
    );
    expect(peerReceive(peer, clientAck).outcome).toMatchObject({
      kind: "close_ack",
      exchangeComplete: true,
    });
    await channel.intercept(peerAck);
    await closing;

    // An honest simultaneous close passes the strict rule at BOTH ends. An
    // earlier round of this program validated against current next-send and
    // failed this deterministically between two conforming endpoints.
    expect(channel.verdict()).toBe("clean");
    expect(peer.machine.verdict).toBe("clean");
    expect(wire.sent).toHaveLength(2);
    // §10.2: exactly TWO `T_CLOSE`-bounded waits on the simultaneous path,
    // because entering the branch does not end the first wait's obligation —
    // and never a third.
    expect(wire.armed.filter((ms) => ms === T_CLOSE)).toHaveLength(2);
    advance(T_CLOSE_LINGER_MAX);
    expect(wire.closes).toEqual([undefined]);
  });

  it("records Unclean — abrupt and closes when the T_CLOSE wait expires", async () => {
    const { channel, wire, advance } = makeChannel();

    const closing = channel.beginClose();
    await tick();
    expect(wire.closes).toEqual([]);

    advance(T_CLOSE + 1);
    await closing;

    expect(channel.verdict()).toBe("unclean_abrupt");
    expect(wire.closes).toEqual([undefined]);
    // No wire record of any kind is emitted for an expiry.
    expect(wire.sent).toHaveLength(1);
  });

  it("discards a keepalive Ping stalled by the close phase rather than buffering it", async () => {
    const { channel, wire } = makeChannel();

    void channel.beginClose();
    await tick();
    const afterClose = wire.sent.length;

    // §10.2: the keepalive `Ping` is an application RPC record. Protecting one
    // here would move the peer's expected-receive state past this endpoint's
    // §10.1.1 anchor and break the close it is participating in.
    expect(await channel.emit(RPC)).toBe(false);
    expect(wire.sent).toHaveLength(afterClose);
  });

  it("declares the pair the close record is actually protected at, under a same-turn send", async () => {
    // §10.1 fields 0–1 MUST byte-equal the carrying envelope's header. The
    // engine drives both of these fire-and-forget on one turn — `send()` is
    // `void emit(...)` and `close()` is `void beginClose()` — so a driver that
    // read its next-send position outside the record session's own send
    // serialization would build the close body against a pair the RPC record
    // takes first, and would seal that nonconforming record onto the relay
    // before anything could object. The peer rejects such a close as §11.3 Q7.
    const { channel, wire } = makeChannel();
    const peer = makePeer();

    const sending = channel.emit(RPC);
    const closing = channel.beginClose();
    expect(await sending).toBe(true);
    await tick();

    expect(wire.sent).toHaveLength(2);
    expect(wire.sent.map(envelopeHeader)).toEqual([
      { epoch: 0n, counter: 0n },
      { epoch: 0n, counter: 1n },
    ]);
    // The peer authenticates both in order and validates the close under §10.1
    // against its own state: the record is conforming, not merely accepted here.
    expect(peer.authenticate(wire.sent[0]!).innerType).toBe(E2EE_INNER_TYPE_RPC);
    const opened = peerReceive(peer, wire.sent[1]!);
    expect(opened.record.innerType).toBe(E2EE_INNER_TYPE_CLOSE);
    expect(opened.outcome.kind).toBe("close");

    await channel.intercept(
      await peer.transmit(
        peer.machine.buildCloseAck({
          sendPosition: peer.sendPosition(),
          expectedRecv: peer.machine.ackExpectedRecv!,
        }),
      ),
    );
    await closing;
    expect(channel.verdict()).toBe("clean");
  });

  it("answers as the §10.2 responder when the peer's close lands on the same turn as its own", async () => {
    // The network never guarantees the turn boundary a test can insert between
    // `beginClose()` and the peer's `E2EEClose`. With none, the peer's close is
    // authenticated before this endpoint has protected anything, so §10.2 makes
    // this endpoint the sequential RESPONDER — one record, the ack, at the pair
    // the aborted close would have taken. An `E2EEClose` protected anyway would
    // be a second close-machine record the peer answers as Q7, and an ack built
    // against a position read before the section would declare a pair it is not
    // carried at.
    const { channel, wire } = makeChannel();
    const peer = makePeer();
    const peerClose = await peer.transmit(
      peer.machine.buildClose({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );

    const closing = channel.beginClose();
    expect(await channel.intercept(peerClose)).toEqual({ kind: "claimed" });
    await tick();

    expect(wire.sent.map(envelopeHeader)).toEqual([{ epoch: 0n, counter: 0n }]);
    expect(peerReceive(peer, wire.sent[0]!).outcome).toMatchObject({ kind: "close_ack" });
    await channel.intercept(
      await peer.transmit(
        peer.machine.buildCloseAck({
          sendPosition: peer.sendPosition(),
          expectedRecv: peer.expectedRecv(),
        }),
      ),
    );
    await closing;
    expect(channel.verdict()).toBe("clean");
    expect(wire.sent).toHaveLength(1);
  });

  it("declares the ack anchor rather than an expected-next a later record advanced", async () => {
    // §10.1.1 on the DECLARING side: an ack answering the peer's `E2EEClose`
    // declares this endpoint's expected-next AS OF processing that close, which
    // is exactly the peer's close anchor. The two disagree in one case — the
    // peer's close and its ack were read in the same batch and the later one was
    // authenticated first — and a driver that declared its CURRENT expected-next
    // there would emit an ack one advance past the peer's anchor and be rejected
    // as §11.3 Q7 by a conforming peer.
    const { channel, wire } = makeChannel();
    const peer = makePeer();
    const closing = channel.beginClose();
    await tick();
    const peerClose = await peer.transmit(
      peer.machine.buildClose({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );
    expect(peerReceive(peer, wire.sent[0]!).outcome.kind).toBe("close");
    const peerAck = await peer.transmit(
      peer.machine.buildCloseAck({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.machine.ackExpectedRecv!,
      }),
    );

    // Both arrive in one batch, with no turn boundary between them.
    const first = channel.intercept(peerClose);
    const second = channel.intercept(peerAck);
    expect(await first).toEqual({ kind: "claimed" });
    expect(await second).toEqual({ kind: "claimed" });
    await closing;

    // This endpoint's expected-next is now past the peer's anchor, and its ack
    // still validates under the peer's strict rule.
    expect(channel.expectedRecv()).toEqual({ epoch: 0n, counter: 2n });
    expect(wire.sent).toHaveLength(2);
    expect(peerReceive(peer, wire.sent[1]!).outcome).toMatchObject({
      kind: "close_ack",
      exchangeComplete: true,
    });
    expect(channel.verdict()).toBe("clean");
  });

  it("records Unclean — abrupt with no wire record when a close record cannot be protected", async () => {
    // §9.6's degenerate outcome reached through `transmitCloseRecord`: the send
    // path took no byte of the `E2EEClose`, so no further close-machine record
    // follows, no wire record of any kind is emitted for the close, and §10.3's
    // lower bound still governs the outer one.
    const { channel, wire } = makeChannel();
    wire.refuseSend = true;

    await channel.beginClose();

    expect(channel.verdict()).toBe("unclean_abrupt");
    expect(wire.sent).toEqual([]);
    expect(wire.closes).toEqual([undefined]);
  });

  it("records Unclean — abrupt when the send direction spent its last position", async () => {
    // §9.6 on the RECEIVE path: this endpoint's `E2EEClose` took the last
    // position its direction had, so §10.1's passed-through rule has no current
    // next-send to evaluate the peer's ack against and no answer can be
    // protected. The outcome is fixed — Unclean — abrupt, no wire record — and
    // nothing beyond it is delivered to the application.
    const spent = { epoch: E2EE_EPOCH_MAX, counter: E2EE_COUNTER_MAX };
    const { channel, wire } = makeChannel({ send: spent });
    const peer = makePeer({ receive: spent });

    const closing = channel.beginClose();
    await tick();
    expect(wire.sent).toHaveLength(1);
    expect(channel.sendPosition()).toBeUndefined();

    // The peer's own send direction is untouched, so it can still deliver — and
    // an authentic RPC record is what §10.2 permits it to deliver here.
    const disposition = await channel.intercept(await peer.protect(E2EE_INNER_TYPE_RPC, RPC));
    await closing;

    expect(disposition).toEqual({ kind: "claimed" });
    expect(channel.verdict()).toBe("unclean_abrupt");
    expect(wire.sent).toHaveLength(1);
    expect(wire.closes).toEqual([undefined]);
  });

  it("records Unclean — abrupt when there is no expected-next left to declare", async () => {
    // The receive-side mirror, reached before any close record is built: §9.6
    // leaves this endpoint no §9.2 expected-next for the close body to declare,
    // so no conforming `E2EEClose` exists and none is emitted.
    const spent = { epoch: E2EE_EPOCH_MAX, counter: E2EE_COUNTER_MAX };
    const { channel, wire } = makeChannel({ receive: spent });
    const peer = makePeer({ send: spent });
    expect((await channel.intercept(await peer.protect(E2EE_INNER_TYPE_RPC, RPC))).kind).toBe(
      "rpc",
    );
    expect(channel.expectedRecv()).toBeUndefined();

    await channel.beginClose();

    expect(channel.verdict()).toBe("unclean_abrupt");
    expect(wire.sent).toEqual([]);
    expect(wire.closes).toEqual([undefined]);
  });

  it("leaves an E2EEClose the queue refuses owed, with the channel unaffected", async () => {
    const { channel, wire } = makeChannel();
    wire.refuseAdmission = true;

    await channel.beginClose();

    // §11.4: nothing reached the relay, no pair was consumed, and the close
    // phase never opened — a later attempt may still close cleanly.
    expect(wire.sent).toEqual([]);
    expect(wire.closes).toEqual([]);
    expect(channel.verdict()).toBeUndefined();
    expect(channel.sendPosition()).toEqual({ epoch: 0n, counter: 0n });

    wire.refuseAdmission = false;
    void channel.beginClose();
    await tick();
    expect(wire.sent).toHaveLength(1);
  });
});

// ─── §10.4 verdicts ──────────────────────────────────────────────────────────

describe("relay E2EE client channel: §10.4 verdicts", () => {
  it("records truncation from a partial reassembly held when the channel ends", () => {
    const { channel } = makeChannel();

    channel.dispose({ incompleteReassembly: true });

    expect(channel.verdict()).toBe("unclean_truncation");
  });

  it("lets a later truncation supersede a Clean recorded at exchange completion", async () => {
    const { channel, wire } = makeChannel();
    const peer = makePeer();

    const close = await peer.transmit(
      peer.machine.buildClose({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );
    await channel.intercept(close);
    expect(peerReceive(peer, wire.sent[0]!).outcome.kind).toBe("close_ack");
    const confirmation = await peer.transmit(
      peer.machine.buildCloseAck({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );
    await channel.intercept(confirmation);
    expect(channel.verdict()).toBe("clean");

    channel.dispose({ incompleteReassembly: true });

    expect(channel.verdict()).toBe("unclean_truncation");
  });

  it("keeps Failed over a truncation arriving afterwards", async () => {
    const { channel } = makeChannel();

    await channel.intercept(new TextEncoder().encode('{"legacy":true}'));
    expect(channel.verdict()).toBe("failed");

    channel.dispose({ incompleteReassembly: true });

    expect(channel.verdict()).toBe("failed");
  });

  it("keeps Clean when the channel merely ends after a completed exchange", async () => {
    const { channel, wire } = makeChannel();
    const peer = makePeer();

    const close = await peer.transmit(
      peer.machine.buildClose({
        sendPosition: peer.sendPosition(),
        expectedRecv: peer.expectedRecv(),
      }),
    );
    await channel.intercept(close);
    peerReceive(peer, wire.sent[0]!);
    await channel.intercept(
      await peer.transmit(
        peer.machine.buildCloseAck({
          sendPosition: peer.sendPosition(),
          expectedRecv: peer.expectedRecv(),
        }),
      ),
    );

    channel.dispose({ incompleteReassembly: false });

    expect(channel.verdict()).toBe("clean");
  });
});

// ─── §11.3 the terminal E2EEError ────────────────────────────────────────────

describe("relay E2EE client channel: §11.3 terminal E2EEError", () => {
  it("erases, closes, and replies with nothing when the peer's error arrives", async () => {
    const { channel, wire, diagnostics } = makeChannel();
    const peer = makePeer();
    const error = await peer.protect(
      E2EE_INNER_TYPE_ERROR,
      encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION),
    );

    expect(await channel.intercept(error)).toEqual({ kind: "rejected" });

    // A reply would be a second error record, which §11.3 forbids and §9.6 does
    // not reserve.
    expect(wire.sent).toEqual([]);
    expect(channel.verdict()).toBe("failed");
    // NOT Q7. §10.2 and §11.3 carve this exact case out in the same words, and
    // the row is pinned beside the wire surface it has to agree with: Q7's
    // obligation is one `E2EEError` with `protocol_violation`, which the empty
    // `wire.sent` above proves this path does not discharge. A row naming an
    // obligation the same test proves unmet is a record that contradicts itself.
    expect(diagnostics).toEqual([{ phase: "post_key", row: "local", verdict: "failed" }]);
    expect(wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
  });

  it("supersedes a Clean verdict already recorded at exchange completion", async () => {
    const { channel, wire } = makeChannel();
    const peer = makePeer();

    // As sequential initiator the endpoint holds the §10.3 linger open after
    // its final confirmation, which is exactly the window §10.2 leaves for a
    // terminal error and §10.4 resolves over time.
    const closing = channel.beginClose();
    await tick();
    peerReceive(peer, wire.sent[0]!);
    await channel.intercept(
      await peer.transmit(
        peer.machine.buildCloseAck({
          sendPosition: peer.sendPosition(),
          expectedRecv: peer.machine.ackExpectedRecv!,
        }),
      ),
    );
    await closing;
    expect(channel.verdict()).toBe("clean");
    expect(wire.closes).toEqual([]);

    await channel.intercept(
      await peer.protect(
        E2EE_INNER_TYPE_ERROR,
        encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION),
      ),
    );

    expect(channel.verdict()).toBe("failed");
    expect(wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
    // Still nothing replied: two records went out, both of them this
    // endpoint's own close-machine records.
    expect(wire.sent).toHaveLength(2);
  });
});

// ─── §11.3 the receive-failure row table ─────────────────────────────────────

describe("relay E2EE client channel: §11.3 receive rows", () => {
  it("maps every §9 receive failure onto the row §11.3's table gives it", () => {
    // §16.2 requires every expected failure to name a row of §11.3's table, and
    // an operator who cannot tell a suite downgrade attempt (Q1) from a framing
    // bug (Q4) in the field has the diagnostic and not the table.
    expect(CLIENT_E2EE_RECEIVE_FATAL_ROWS).toEqual({
      version_mismatch: "Q1",
      suite_mismatch: "Q1",
      sequence_mismatch: "Q2",
      authentication_failed: "Q3",
      malformed_envelope: "Q4",
      reserved_inner_type: "Q5",
      malformed_record: "Q5",
      // Not a condition of its own: the latch an earlier fatal condition left.
      receive_terminated: "Q2",
    });
  });

  it.each([
    ["Q1 an envelope version the session did not establish", 1, 0xfe],
    ["Q1 an envelope suite the session did not establish", 2, 0xfe],
    ["Q3 a flipped ciphertext byte", -1, undefined],
  ] as const)("reports %s on the wire", async (label, index, value) => {
    const { channel, wire, diagnostics } = makeChannel();
    const peer = makePeer();
    const envelope = await peer.protect(E2EE_INNER_TYPE_RPC, RPC);
    const at = index < 0 ? envelope.byteLength + index : index;
    envelope[at] = value ?? envelope[at]! ^ 0x01;

    expect(await channel.intercept(envelope)).toEqual({ kind: "rejected" });

    expect(diagnostics, label).toEqual([
      { phase: "post_key", row: label.slice(0, 2), verdict: "failed" },
    ]);
    // §11.3's procedure, unchanged for every row of it: one `E2EEError` while
    // the send path is usable, then `channel_rejected`.
    expect(wire.sent).toHaveLength(1);
    expect(wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
  });

  it("reports Q4 for an envelope shorter than the §3.3 overhead", async () => {
    const { channel, wire, diagnostics } = makeChannel();
    const peer = makePeer();
    const envelope = await peer.protect(E2EE_INNER_TYPE_RPC, RPC);

    expect(await channel.intercept(envelope.subarray(0, E2EE_ENVELOPE_OVERHEAD_BYTES - 1))).toEqual(
      {
        kind: "rejected",
      },
    );

    expect(diagnostics).toEqual([{ phase: "post_key", row: "Q4", verdict: "failed" }]);
    expect(wire.sent).toHaveLength(1);
    expect(wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
  });

  it("orders the one terminal E2EEError behind an application record admitted before it", async () => {
    // §11.5 counts the post-key observable at "at most one length-uniform
    // encrypted record". The condition is detected on the receive path while an
    // application record is already inside `protect`, so the terminal record's
    // §11.3 preconditions — a usable send path, and the close machine's single
    // terminal allowance — are read after that record has taken its pair, not
    // before.
    const { channel, wire, diagnostics } = makeChannel();

    const sending = channel.emit(RPC);
    const intercepted = channel.intercept(new TextEncoder().encode('{"legacy":true}'));
    expect(await sending).toBe(true);
    expect(await intercepted).toEqual({ kind: "rejected" });

    expect(wire.sent.map(envelopeHeader)).toEqual([
      { epoch: 0n, counter: 0n },
      { epoch: 0n, counter: 1n },
    ]);
    expect(diagnostics).toEqual([{ phase: "post_key", row: "Q6", verdict: "failed" }]);
    expect(wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
  });

  it("emits no second E2EEError once the close machine has spent its terminal allowance", async () => {
    // §10.2's carve-out is exactly one terminal record, and §11.3 makes a
    // received `E2EEError` terminal in both directions: the receiver "MUST NOT
    // reply". A condition detected after that point still takes §11.3's
    // procedure minus the record.
    const { channel, wire, diagnostics } = makeChannel();
    const peer = makePeer();

    await channel.intercept(
      await peer.protect(
        E2EE_INNER_TYPE_ERROR,
        encodeE2eeErrorRecordBody(E2EE_ERROR_CODE_PROTOCOL_VIOLATION),
      ),
    );

    expect(wire.sent).toEqual([]);
    // `local`, not Q7 — see the §11.3 terminal-`E2EEError` case above for why
    // naming Q7 beside an empty `wire.sent` is a record that contradicts itself.
    expect(diagnostics).toEqual([{ phase: "post_key", row: "local", verdict: "failed" }]);
    expect(wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
  });
});

// ─── §11.1 the failure taxonomy ──────────────────────────────────────────────

describe("relay E2EE failure taxonomy", () => {
  const kinds: readonly RelayE2eeFailureKind[] = [
    "fatal_pre_key",
    "fatal_post_key",
    "send_path_unusable",
  ];

  it.each(kinds)("maps %s onto a non-retryable relay failure", (kind) => {
    const failure = relayE2eeFailure(kind);

    // §11.1: no new close reason, and never the retryable `internal` default —
    // `transport.ts`'s reconnect gate must not retry into the same failure.
    expect(failure).toEqual({
      kind: "protocol",
      retryable: false,
      closeReason: "channel_rejected",
    });
    expect(failure.kind).not.toBe("internal");
  });
});

// ─── the §9.3 surface rule ───────────────────────────────────────────────────

describe("relay E2EE production admission surface", () => {
  it("routes every record class through the host reservation, never a constant true", async () => {
    // §9.3's admission is the REAL relay reservation covering every payload of
    // the record. A constant-true stub anywhere on a production path would let
    // ordinary backpressure consume an `(epoch, counter)` pair, which is a nonce
    // reuse and not a queue bug — so a host that refuses everything must leave
    // the send direction at exactly where it started, whatever record class the
    // channel was asked to protect.
    const application = makeChannel();
    application.wire.refuseAdmission = true;
    expect(await application.channel.emit(RPC)).toBe(false);
    expect(application.wire.sent).toEqual([]);
    expect(application.channel.sendPosition()).toEqual({ epoch: 0n, counter: 0n });

    const close = makeChannel();
    close.wire.refuseAdmission = true;
    await close.channel.beginClose();
    expect(close.wire.sent).toEqual([]);
    expect(close.channel.sendPosition()).toEqual({ epoch: 0n, counter: 0n });

    const terminal = makeChannel();
    terminal.wire.refuseAdmission = true;
    // A post-key fatal condition obliges one `E2EEError` while the send path is
    // usable; with no capacity it is §11.5's "none when the send path is
    // unusable" case, and still no pair is consumed.
    expect(await terminal.channel.intercept(new TextEncoder().encode('{"legacy":true}'))).toEqual({
      kind: "rejected",
    });
    expect(terminal.wire.sent).toEqual([]);
    expect(terminal.channel.sendPosition()).toEqual({ epoch: 0n, counter: 0n });
    expect(terminal.wire.closes).toEqual([relayE2eeFailure("fatal_post_key")]);
  });
});
