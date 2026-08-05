import {
  E2EE_AAD_BYTES,
  E2EE_DIRECTION_LABEL_BYTES,
  E2EE_ENVELOPE_HEADER_BYTES,
} from "@ryco/shared/relayE2eeConstants";
import { deriveE2eeAeadKey } from "@ryco/shared/relayE2eeSession";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  e2eeAeadNonce,
  e2eeEnvelopeAad,
  encodeE2eeDirectionLabel,
  encodeE2eeEnvelopeHeader,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "@ryco/shared/relayE2eeWire";
import { describe, expect, it } from "vite-plus/test";

import {
  corpusRecordSession,
  directionStateJson,
  F06,
  F08,
  fixtureBytes,
  fixtureCase,
  fixtureCasesMatching,
  hexOf,
  oppositeDirection,
  protectOneRecord,
} from "../../../test/e2eeCorpus";

// §16.3 F8 RECORD PROTECTION (§9.1–§9.3), IN CHROMIUM.
//
// docs/relay-e2ee-protocol.md §16.4 requires this family to "also run in the
// web browser test suite", and calls a vector that produces different bytes on
// any supported runtime a release-blocking defect.
// `docs/relay-e2ee-web-browser-vectors.md` deferred F8 for exactly one reason —
// every case needs an ESTABLISHED session and no browser file built one.
// `apps/web/test/e2eeCorpus.ts` now does, from the F6 trace's own committed
// §6.5 outputs, and this file is the run that deferral named.
//
// WHAT THIS FILE PROVES, AND WHAT IT DOES NOT. It is RUNTIME PARITY: the same
// shared record layer, over the same committed bytes, under Chromium instead of
// Node. It adds no security property to the web tier. §2.2 and §2.3 deny that
// tier operator-proof protection outright — the Hub serves every byte of the
// JavaScript running these checks — and a green run here changes none of that.
//
// The session is derived ACROSS families on purpose: F8's envelopes are records
// of the F6 IK trace and F6 commits that trace's §6.5 outputs, so opening them
// here is a derivation rather than either family agreeing with itself.

/** The F6 trace whose §6.5 outputs every §16.3 F8 case is a record of. */
const TRACE = fixtureCase(F06, "ik-handshake-complete-trace").expected;

/**
 * One endpoint of that session, fresh.
 *
 * Every call decodes the secrets again because the session OWNS and erases what
 * it is handed (§6.5, §9.5) — a shared buffer would leave the second caller
 * holding zeroes and the failure would look like a divergence.
 */
function traceSession(
  sendDirection: E2eeDirection,
  overrides: { readonly sessionBindingHash?: Uint8Array } = {},
) {
  return corpusRecordSession({
    epochSecretC2N: fixtureBytes(TRACE.epochSecretC2N),
    epochSecretN2C: fixtureBytes(TRACE.epochSecretN2C),
    exporterSecret: fixtureBytes(TRACE.exporterSecret),
    serverConfirmationKey: fixtureBytes(TRACE.serverConfirmationKey),
    sessionBindingHash: overrides.sessionBindingHash ?? fixtureBytes(TRACE.sessionBindingHash),
    sendDirection,
  });
}

/** The node half: it sends `n2c`, so it is what receives the client's records. */
const receiverSession = (overrides?: { readonly sessionBindingHash?: Uint8Array }) =>
  traceSession(E2EE_DIRECTION_NODE_TO_CLIENT, overrides ?? {});

type JsonRecord = Readonly<Record<string, unknown>>;

describe("§16.3 F8 — the AAD and the nonce recomputed in Chromium", () => {
  it("reproduces the header, the direction label, the nonce, and the AAD for both directions", () => {
    for (const entry of fixtureCasesMatching(F08, /^aad-(client-to-node|node-to-client)$/, 2)) {
      const direction = entry.inputs.direction as E2eeDirection;
      const header = encodeE2eeEnvelopeHeader({
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        epoch: BigInt(entry.inputs.epoch as number),
        counter: BigInt(entry.inputs.counter as number),
      });
      expect(hexOf(header), entry.name).toBe(hexOf(fixtureBytes(entry.expected.header)));
      expect(hexOf(encodeE2eeDirectionLabel(direction)), entry.name).toBe(
        hexOf(fixtureBytes(entry.expected.directionLabel)),
      );
      expect(hexOf(e2eeAeadNonce(0n, 0n)), entry.name).toBe(
        hexOf(fixtureBytes(entry.expected.nonce)),
      );

      const aad = e2eeEnvelopeAad({
        header,
        sessionBindingHash: fixtureBytes(entry.inputs.sessionBindingHash),
        direction,
      });
      expect(hexOf(aad), entry.name).toBe(hexOf(fixtureBytes(entry.expected.aad)));
      expect(aad.byteLength, entry.name).toBe(E2EE_AAD_BYTES);
      expect(entry.expected.matchesAadBytesConstant, entry.name).toBe(true);
      expect(entry.expected.nonceEqualsHeaderSequenceFields, entry.name).toBe(true);
    }
  });
});

describe("§16.3 F8 — every committed envelope re-protected in Chromium", () => {
  it("reproduces both counter-zero-and-one traces byte for byte and lands both §9.2 states", async () => {
    for (const entry of fixtureCasesMatching(F08, /^envelopes-at-counters-zero-and-one-/, 2)) {
      const sendDirection = entry.inputs.sendDirection as E2eeDirection;
      const sender = traceSession(sendDirection);
      const peer = traceSession(oppositeDirection(sendDirection));

      for (const record of entry.expected.records as readonly JsonRecord[]) {
        const label = `${entry.name} ${JSON.stringify(record.position)}`;
        const sent = await protectOneRecord(sender, {
          innerType: E2EE_INNER_TYPE_RPC,
          body: fixtureBytes(record.innerBody),
        });
        if (sent.result.kind !== "protected") throw new Error(`${label}: the record was refused`);
        const envelope = sent.envelope;
        if (envelope === undefined) throw new Error(`${label}: nothing reached transmit`);

        // The whole point of the browser half: the SAME BYTES.
        expect(hexOf(envelope), label).toBe(hexOf(fixtureBytes(record.envelope)));
        expect(sent.result.envelopeBytes, label).toBe(record.envelopeBytes);
        expect(
          { epoch: Number(sent.result.epoch), counter: Number(sent.result.counter) },
          label,
        ).toEqual(record.position);
        expect(
          hexOf(
            e2eeEnvelopeAad({
              header: envelope.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
              sessionBindingHash: fixtureBytes(TRACE.sessionBindingHash),
              direction: sendDirection,
            }),
          ),
          label,
        ).toBe(hexOf(fixtureBytes(record.aad)));

        const received = peer.unprotect(envelope);
        const expectedReceive = record.received as JsonRecord;
        expect(received.kind, label).toBe(expectedReceive.kind);
        if (received.kind !== "authenticated") throw new Error(`${label}: it did not open`);
        expect(received.innerType, label).toBe(expectedReceive.innerType);
        expect(received.body.byteLength, label).toBe(expectedReceive.bodyBytes);
        expect(Number(received.epoch), label).toBe(expectedReceive.epoch);
        expect(Number(received.counter), label).toBe(expectedReceive.counter);
        expect(received.plaintextBytes, label).toBe(expectedReceive.plaintextBytes);
        expect(received.epochCompleted, label).toBe(expectedReceive.epochCompleted);
      }

      // Both endpoints' resulting §9.2 state, from the sessions themselves.
      expect(directionStateJson(sender.sendState), entry.name).toEqual(
        entry.expected.senderNextSend,
      );
      expect(directionStateJson(peer.receiveState), entry.name).toEqual(
        entry.expected.receiverExpectedNext,
      );
      sender.erase();
      peer.erase();
    }
  });

  it("gives a control record the next pair of the same directional sequence", async () => {
    // §4.1 defines no second nonce space: an `E2EEClose` takes the pair an RPC
    // record would have taken and counts toward both §9.4 thresholds. Running
    // it needs a session, so this is where the case's two ENVELOPES — not only
    // the positions beside them — get checked.
    const entry = fixtureCase(F08, "control-record-consumes-the-shared-sequence");
    const sender = traceSession(E2EE_DIRECTION_CLIENT_TO_NODE);
    const peer = receiverSession();

    const steps = [
      {
        input: "firstRecord",
        envelope: "firstEnvelope",
        position: "firstPosition",
        received: "firstReceived",
      },
      {
        input: "secondRecord",
        envelope: "secondEnvelope",
        position: "secondPosition",
        received: "secondReceived",
      },
    ] as const;

    for (const step of steps) {
      const record = entry.inputs[step.input] as JsonRecord;
      const sent = await protectOneRecord(sender, {
        innerType: record.innerType as E2eeInnerRecordType,
        body: fixtureBytes(record.body),
      });
      if (sent.result.kind !== "protected")
        throw new Error(`${step.input}: the record was refused`);
      const envelope = sent.envelope;
      if (envelope === undefined) throw new Error(`${step.input}: nothing reached transmit`);
      expect(hexOf(envelope), step.input).toBe(hexOf(fixtureBytes(entry.expected[step.envelope])));
      expect(
        { epoch: Number(sent.result.epoch), counter: Number(sent.result.counter) },
        step.input,
      ).toEqual(entry.expected[step.position]);

      const received = peer.unprotect(envelope);
      const expectedReceive = entry.expected[step.received] as JsonRecord;
      expect(received.kind, step.input).toBe(expectedReceive.kind);
      if (received.kind !== "authenticated") throw new Error(`${step.input}: it did not open`);
      expect(received.innerType, step.input).toBe(expectedReceive.innerType);
      expect(received.body.byteLength, step.input).toBe(expectedReceive.bodyBytes);
      expect(received.plaintextBytes, step.input).toBe(expectedReceive.plaintextBytes);
      expect(received.epochCompleted, step.input).toBe(expectedReceive.epochCompleted);
    }

    expect(directionStateJson(sender.sendState)).toEqual(entry.expected.senderNextSend);
    // The §9.4 half: two records counted in the epoch, not one plus an
    // unaccounted control frame.
    expect(entry.expected.controlRecordCountedTowardTheEpoch).toBe(true);
    expect((entry.expected.senderNextSend as JsonRecord).epochRecords).toBe(2);
    sender.erase();
    peer.erase();
  });
});

describe("§16.3 F8 — every tampered envelope through the real §4.3 receive path", () => {
  it("takes the §11.3 row each tamper belongs to, in Chromium's own AEAD", () => {
    for (const entry of fixtureCasesMatching(F08, /^tampered-/, 6)) {
      const clean = fixtureBytes(entry.inputs.envelope);
      const tampered = fixtureBytes(entry.inputs.tamperedEnvelope);

      // The untampered envelope opens first, so a failure below is attributable
      // to the tamper and not to a mis-built session or a stale trace.
      const control = receiverSession();
      expect(control.unprotect(clean).kind, entry.name).toBe("authenticated");
      control.erase();

      // The tamper is exactly what the case says it is: one byte, at the
      // declared index, and nothing else moved.
      expect(tampered.byteLength, entry.name).toBe(clean.byteLength);
      const differing = [...clean].flatMap((byte, index) =>
        byte === tampered[index] ? [] : [index],
      );
      expect(differing, entry.name).toEqual([entry.inputs.tamperedByteIndex]);

      const receiver = receiverSession();
      const received = receiver.unprotect(tampered);
      const expectedReceive = entry.expected.received as JsonRecord;
      expect(received.kind, entry.name).toBe(expectedReceive.kind);
      if (received.kind !== "fatal") {
        throw new Error(`${entry.name}: the tampered envelope authenticated`);
      }
      expect(received.reason, entry.name).toBe(expectedReceive.reason);
      // §4.3's ordering as an OBSERVATION: a header field's own comparison
      // fires before an AEAD is selected, so a header tamper can only surface
      // as that field's mismatch and never as an authentication failure.
      if (entry.name.startsWith("tampered-header-")) {
        expect(entry.expected.ciphertextDecrypted, entry.name).toBe(false);
        expect(received.reason === "authentication_failed", entry.name).toBe(false);
      } else {
        expect(received.reason, entry.name).toBe("authentication_failed");
      }
      expect(entry.expected.disposition, entry.name).toBe("FATAL-POST");
      receiver.erase();
    }
  });

  it("fails authentication when only the session binding hash differs", () => {
    // §8.8 step 6 binds every protected record to the exact handshake wire
    // bytes the two ends exchanged. The receiver differs from the sender in one
    // bit of `sessionBindingHash` and in nothing else.
    const entry = fixtureCase(F08, "wrong-session-binding-hash-fails-authentication");
    const senderHash = fixtureBytes(entry.inputs.senderSessionBindingHash);
    const receiverHash = fixtureBytes(entry.inputs.receiverSessionBindingHash);
    expect(hexOf(senderHash)).not.toBe(hexOf(receiverHash));
    expect(hexOf(senderHash)).toBe(hexOf(fixtureBytes(TRACE.sessionBindingHash)));

    const receiver = receiverSession({ sessionBindingHash: receiverHash });
    const received = receiver.unprotect(fixtureBytes(entry.inputs.envelope));
    const expectedReceive = entry.expected.received as JsonRecord;
    expect(received.kind).toBe(expectedReceive.kind);
    if (received.kind !== "fatal") throw new Error("the rebound envelope authenticated");
    expect(received.reason).toBe(expectedReceive.reason);
    expect(entry.expected.disposition).toBe("FATAL-POST");
    receiver.erase();

    // …and the same envelope DOES open against the sender's own binding hash,
    // so the failure above is attributable to the hash and not to the envelope.
    const control = receiverSession();
    expect(control.unprotect(fixtureBytes(entry.inputs.envelope)).kind).toBe("authenticated");
    control.erase();
  });

  it("isolates the direction label from the direction-keyed schedule", () => {
    // The label is bound TWICE — into the AAD (§9.1) and into the §9.4 key
    // derivation — so an ordinary cross-direction delivery differs in two
    // places at once and proves nothing about either. Both bindings are
    // re-derived here from the case's own inputs, in this runtime.
    const entry = fixtureCase(F08, "wrong-direction-label-fails-authentication");
    const senderAad = fixtureBytes(entry.expected.senderAad);
    const receiverAad = fixtureBytes(entry.expected.receiverAad);
    const header = fixtureBytes(entry.inputs.envelope).subarray(0, E2EE_ENVELOPE_HEADER_BYTES);
    const aadFor = (direction: E2eeDirection): string =>
      hexOf(
        e2eeEnvelopeAad({
          header,
          sessionBindingHash: fixtureBytes(TRACE.sessionBindingHash),
          direction,
        }),
      );
    expect(aadFor(entry.inputs.senderDirection as E2eeDirection)).toBe(hexOf(senderAad));
    expect(aadFor(entry.inputs.receiverDirectionLabelUsed as E2eeDirection)).toBe(
      hexOf(receiverAad),
    );

    // The two AADs differ ONLY in the trailing label…
    const withoutLabel = (aad: Uint8Array): string =>
      hexOf(aad.subarray(0, aad.byteLength - E2EE_DIRECTION_LABEL_BYTES));
    expect(entry.expected.aadsDifferOnlyInTheTrailingLabel).toBe(
      withoutLabel(senderAad) === withoutLabel(receiverAad),
    );
    expect(entry.expected.aadsDifferOnlyInTheTrailingLabel).toBe(true);
    expect(hexOf(senderAad)).not.toBe(hexOf(receiverAad));

    // …and the §9.4 key schedule keys on the label separately, which is why the
    // case pins the sender's AEAD key rather than deriving a second one. Both
    // halves are recomputed from the trace's own epoch secret here.
    const epochSecret = fixtureBytes(TRACE.epochSecretC2N);
    const clientKey = deriveE2eeAeadKey(epochSecret, E2EE_DIRECTION_CLIENT_TO_NODE);
    const nodeKey = deriveE2eeAeadKey(epochSecret, E2EE_DIRECTION_NODE_TO_CLIENT);
    expect(entry.expected.aeadKeysAlsoDifferByDirection).toBe(hexOf(clientKey) !== hexOf(nodeKey));
    expect(entry.expected.aeadKeysAlsoDifferByDirection).toBe(true);
    expect(hexOf(clientKey)).toBe(hexOf(fixtureBytes(entry.inputs.testOnlyPinnedAeadKey)));
    expect(hexOf(clientKey)).toBe(hexOf(fixtureBytes(TRACE.aeadKeyC2NEpoch0)));
    expect((entry.expected.received as JsonRecord).reason).toBe("authentication_failed");
  });
});
