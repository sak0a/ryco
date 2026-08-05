import { RELAY_CHUNK_HEADER_BYTES, RELAY_CHUNK_MAGIC } from "@ryco/contracts/relay";
import {
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_CAPABILITY_CARRIER_TAG,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  RELAY_CHUNK_CAPABILITY_PRELUDE,
  RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
  RELAY_MAX_RPC_MESSAGE_BYTES,
  e2eeChannelSizeBudget,
} from "@ryco/shared/relayE2eeConstants";
import {
  e2eeAuthorizationKeysEqual,
  e2eeAuthorizationWithdrawn,
} from "@ryco/shared/relayE2eeHandshake";
import {
  E2EE_CLIENT_IDENTITY_ALGORITHM,
  validateE2eeClientIdentityPublicKey,
  validateE2eeClientSignature,
  verifyE2eeSignature,
} from "@ryco/shared/relayE2eeKeys";
import { e2eeAuthorizationContextCommitment } from "@ryco/shared/relayE2eeTranscripts";
import {
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_RPC,
  classifyPostStripPayload,
  decodeE2eeEnvelope,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "@ryco/shared/relayE2eeWire";
import {
  RelayMessageAssembler,
  isChunkedPayload,
  prepareRelayMessage,
} from "@ryco/shared/relayMessageChunks";
import { describe, expect, it } from "vite-plus/test";

import {
  CORPUS_CHANNEL_PLAINTEXT_CEILING,
  corpusRecordSession,
  F01,
  F02,
  F04,
  F16,
  F17,
  fixtureBytes,
  fixtureCase,
  fixtureCasesCarrying,
  fixtureCasesMatching,
  hexOf,
  protectOneRecord,
  type E2eeFixtureCase,
} from "../../../test/e2eeCorpus";

// THE §16.4 CODEC-PARITY RUN: F1, F2, the NX cases of F16, and the P-256 cases
// of F17, in Chromium.
//
// docs/relay-e2ee-protocol.md §16.4 names these among the families that "MUST
// also run in the web browser test suite" and calls a vector that produces
// different bytes on any supported runtime a release-blocking defect.
// `docs/relay-e2ee-web-browser-vectors.md` deferred all four as pure runtime
// parity — none of them is specific to the web tier's own rows — and this file
// is the run that closes that deferral.
//
// WHAT THIS FILE PROVES, AND WHAT IT DOES NOT. Shared code produces the same
// bytes under Chromium as under Node. Nothing here is a claim about what the
// web tier protects: §2.2 and §2.3 deny that tier operator-proof protection,
// because the Hub serves the JavaScript that runs every assertion below.
//
// F17's P-256 cases are the NATIVE tier's client identity key (§8.1). The web
// tier carries no client identity at all, so no shipped `apps/web` path reaches
// them; they run here as parity checks on `@noble/curves` under this engine,
// which is precisely what §16.4 asks for and is not a web-tier capability.

type JsonRecord = Readonly<Record<string, unknown>>;

/** The §4.3 step-1 test, recomputed rather than read off the case. */
function carriesThePrelude(payload: Uint8Array): boolean {
  return (
    payload.byteLength >= RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES &&
    hexOf(payload.subarray(0, RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES)) ===
      hexOf(RELAY_CHUNK_CAPABILITY_PRELUDE)
  );
}

function f01Payload(entry: E2eeFixtureCase): Uint8Array {
  return fixtureBytes(entry.inputs.wirePayload ?? entry.inputs.postStripPayload);
}

describe("§16.3 F1 payload discrimination and chunk pipeline (§4.2, §4.3, §4.5)", () => {
  it("reproduces the §4.3 receive pipeline for every case that carries one wire payload", () => {
    let driven = 0;
    for (const entry of F01.cases) {
      const payload = entry.inputs.wirePayload ?? entry.inputs.postStripPayload;
      if (payload === undefined) continue;
      driven += 1;
      const bytes = fixtureBytes(payload);
      const pipeline = entry.expected.pipeline as JsonRecord;
      expect((pipeline.step1ChunkTest as JsonRecord).isChunkedPayload, entry.name).toBe(
        isChunkedPayload(bytes),
      );
      const assembler = new RelayMessageAssembler();
      const pushed = assembler.push(bytes);
      expect(pushed.kind, entry.name).toBe((pipeline.step1Assembler as JsonRecord).kind);
      if (pushed.kind !== "done") continue;

      const step1 = pipeline.step1Assembler as JsonRecord;
      expect(hexOf(pushed.message), entry.name).toBe(hexOf(fixtureBytes(step1.postStripPayload)));
      expect(pushed.message.byteLength, entry.name).toBe(step1.postStripBytes);
      expect(assembler.peerSupportsChunking, entry.name).toBe(step1.peerSupportsChunkingLatch);
      expect(step1.preludeStripped, entry.name).toBe(carriesThePrelude(bytes));

      const classified = classifyPostStripPayload(pushed.message);
      const step2 = pipeline.step2Discrimination as JsonRecord;
      expect(classified.kind, entry.name).toBe(step2.class);
      if (classified.kind === "other") expect(classified.reason, entry.name).toBe(step2.reason);

      // The §9.1 header fields, read off the very bytes the pipeline surfaced.
      const decode = entry.expected.envelopeDecode as JsonRecord | undefined;
      if (decode === undefined) continue;
      const envelope = decodeE2eeEnvelope(pushed.message);
      expect(envelope.kind, entry.name).toBe(decode.kind);
      if (envelope.kind !== "ok") continue;
      expect(envelope.value.version, entry.name).toBe(decode.version);
      expect(envelope.value.suite, entry.name).toBe(decode.suite);
      expect(Number(envelope.value.epoch), entry.name).toBe(decode.epoch);
      expect(Number(envelope.value.counter), entry.name).toBe(decode.counter);
      expect(hexOf(envelope.value.header), entry.name).toBe(hexOf(fixtureBytes(decode.header)));
    }
    // A loop over a filtered set deletes itself when the filter stops matching.
    expect(driven, "cases carrying one wire payload").toBe(12);
  });

  it("checks every top-level restatement of a §4.3 step-1 fact against the step itself", () => {
    const surfaced = (entry: E2eeFixtureCase): Uint8Array => {
      const pushed = new RelayMessageAssembler().push(f01Payload(entry));
      if (pushed.kind !== "done") throw new Error(`${entry.name}: §4.3 step 1 did not complete`);
      return pushed.message;
    };

    for (const entry of fixtureCasesCarrying(F01.cases, "expected", "isChunkedPayload", 1)) {
      expect(entry.expected.isChunkedPayload, entry.name).toBe(isChunkedPayload(f01Payload(entry)));
    }
    for (const entry of fixtureCasesCarrying(F01.cases, "expected", "wirePayloadBytes", 4)) {
      expect(entry.expected.wirePayloadBytes, entry.name).toBe(f01Payload(entry).byteLength);
    }
    for (const entry of fixtureCasesCarrying(F01.cases, "expected", "preludePresent", 4)) {
      expect(entry.expected.preludePresent, entry.name).toBe(carriesThePrelude(f01Payload(entry)));
    }
    for (const entry of fixtureCasesCarrying(F01.cases, "expected", "surfacedUnchanged", 1)) {
      expect(entry.expected.surfacedUnchanged, entry.name).toBe(
        hexOf(surfaced(entry)) === hexOf(f01Payload(entry)),
      );
    }
    for (const entry of fixtureCasesCarrying(F01.cases, "expected", "firstPostStripByte", 1)) {
      expect(entry.expected.firstPostStripByte, entry.name).toBe(surfaced(entry)[0]);
    }
  });

  it("re-protects the two inner-body boundary cases from the family's own secrets", async () => {
    // The record harness `E2eeRecordProtection.browser.tsx` needed for F8 is
    // what makes these runnable here: they are ordinary §9 sends, and they only
    // ever needed an established session to drive.
    const session = (sendDirection: E2eeDirection) =>
      corpusRecordSession({
        epochSecretC2N: fixtureBytes(F01.testKeyMaterial.testOnlyEpochSecretC2N),
        epochSecretN2C: fixtureBytes(F01.testKeyMaterial.testOnlyEpochSecretN2C),
        exporterSecret: fixtureBytes(F01.testKeyMaterial.testOnlyExporterSecret),
        sessionBindingHash: fixtureBytes(F01.testKeyMaterial.sessionBindingHash),
        sendDirection,
      });

    const protect = (entry: E2eeFixtureCase) =>
      protectOneRecord(session(F01.testKeyMaterial.sendDirection as E2eeDirection), {
        innerType: (entry.inputs.innerType ?? E2EE_INNER_TYPE_RPC) as E2eeInnerRecordType,
        body: new Uint8Array(entry.inputs.innerBodyBytes as number).fill(
          (entry.inputs.innerBodyFill as number | undefined) ?? 0,
        ),
      });

    // A zero-length inner body is a VALID §9.1 record, and the case's `send`
    // and `receive` blocks are the two halves of one round trip.
    const zero = fixtureCase(F01, "envelope-with-a-zero-length-inner-body");
    const zeroRun = await protect(zero);
    const send = zero.expected.send as JsonRecord;
    expect(zeroRun.result.kind).toBe(send.kind);
    if (zeroRun.result.kind !== "protected") throw new Error("the zero-length body was refused");
    const zeroEnvelope = zeroRun.envelope;
    if (zeroEnvelope === undefined) throw new Error("nothing reached transmit");
    expect(Number(zeroRun.result.epoch)).toBe(send.epoch);
    expect(Number(zeroRun.result.counter)).toBe(send.counter);
    expect(zeroRun.result.plaintextBytes).toBe(send.plaintextBytes);
    expect(zeroRun.result.envelopeBytes).toBe(send.envelopeBytes);
    expect(hexOf(zeroEnvelope)).toBe(hexOf(fixtureBytes(zero.expected.envelope)));
    expect(zero.expected.envelopeBytes).toBe(zeroEnvelope.byteLength);
    expect(zero.expected.envelopeOverheadBytes).toBe(E2EE_ENVELOPE_OVERHEAD_BYTES);

    // …and the peer's side of it, from a session holding the same secrets in
    // the receiving direction.
    const peer = session(E2EE_DIRECTION_NODE_TO_CLIENT);
    const received = peer.unprotect(zeroEnvelope);
    const receive = zero.expected.receive as JsonRecord;
    expect(received.kind).toBe(receive.kind);
    if (received.kind !== "authenticated") throw new Error("the round trip did not authenticate");
    expect(received.innerType).toBe(receive.innerType);
    expect(received.body.byteLength).toBe(receive.bodyBytes);
    expect(received.plaintextBytes).toBe(receive.plaintextBytes);
    peer.erase();

    // The ceiling pair: the last body that fits is sent, and the first that
    // does not is refused sender-locally with nothing on the wire.
    const at = fixtureCase(F01, "inner-body-exactly-at-the-plaintext-ceiling");
    expect(at.inputs.plaintextCeiling).toBe(CORPUS_CHANNEL_PLAINTEXT_CEILING);
    const atRun = await protect(at);
    expect(atRun.result.kind).toBe(at.expected.send);
    const atEnvelope = atRun.envelope;
    if (atEnvelope === undefined) throw new Error("the at-ceiling body was refused");
    expect(hexOf(atEnvelope)).toBe(hexOf(fixtureBytes(at.expected.envelope)));
    expect(at.expected.envelopeBytes).toBe(atEnvelope.byteLength);
    expect(at.expected.transmittedRecords).toBe(1);

    const over = fixtureCase(F01, "inner-body-one-byte-over-the-plaintext-ceiling");
    const overRun = await protect(over);
    const refused = over.expected.send as JsonRecord;
    expect(overRun.result.kind).toBe(refused.kind);
    if (overRun.result.kind !== "refused") throw new Error("the over-ceiling body was sent");
    expect(overRun.result.reason).toBe(refused.reason);
    expect(over.expected.senderLocalError).toBe(overRun.result.reason);
    expect(over.expected.transmittedRecords).toBe(overRun.envelope === undefined ? 0 : 1);
  });

  it("reassembles the chunked envelope to the exact envelope bytes", () => {
    const entry = fixtureCase(F01, "chunked-envelope-reassembles-to-the-envelope");
    const payloads = (entry.inputs.wirePayloads as readonly unknown[]).map(fixtureBytes);
    expect(entry.expected.chunkCount, "one count per carried wire payload").toBe(payloads.length);
    expect(entry.expected.chunkHeaderBytes, "§4.5's chunk framing").toBe(RELAY_CHUNK_HEADER_BYTES);
    expect(entry.expected.everyChunkStartsWithChunkMagic).toBe(
      payloads.every((payload) => payload[0] === RELAY_CHUNK_MAGIC),
    );
    expect(entry.expected.everyChunkStartsWithChunkMagic).toBe(true);

    const assembler = new RelayMessageAssembler();
    let message: Uint8Array | undefined;
    const pushResults: string[] = [];
    for (const payload of payloads) {
      expect(isChunkedPayload(payload)).toBe(true);
      expect(payload.byteLength, "header plus body").toBeGreaterThan(
        entry.expected.chunkHeaderBytes as number,
      );
      const pushed = assembler.push(payload);
      pushResults.push(pushed.kind);
      if (pushed.kind === "done") message = pushed.message;
    }
    expect(message).toBeDefined();
    if (message === undefined) return;
    expect(hexOf(message)).toBe(hexOf(fixtureBytes(entry.inputs.envelope)));
    expect(classifyPostStripPayload(message).kind).toBe("envelope");

    const reassembly = entry.expected.reassembly as JsonRecord;
    expect(reassembly.pushResults).toEqual(pushResults);
    expect(reassembly.peerSupportsChunkingLatch).toBe(assembler.peerSupportsChunking);
    expect(hexOf(fixtureBytes(reassembly.reassembled))).toBe(hexOf(message));
    expect((reassembly.step2Discrimination as JsonRecord).class).toBe(
      classifyPostStripPayload(message).kind,
    );
    expect(entry.expected.reassembledEqualsEnvelope).toBe(
      hexOf(message) === hexOf(fixtureBytes(entry.inputs.envelope)),
    );
  });

  it("re-prepares both headroom cases and lands the prelude on exactly one side", () => {
    // The SENDER's half of §4.3 step 1. The two cases either side of the
    // boundary are re-prepared at their own asserted chunk limit rather than
    // read off the fixture, so this fails if the shared split rule moves the
    // boundary under this engine — which the committed wire payloads alone,
    // already checked above, cannot detect.
    for (const entry of fixtureCasesMatching(F01, /-the-prelude-headroom-boundary$/, 2)) {
      // The message re-prepared is the case's OWN envelope, recovered from the
      // committed wire payload by the receive half, so the round trip closes on
      // the committed bytes rather than on a same-length stand-in.
      const received = new RelayMessageAssembler().push(f01Payload(entry));
      if (received.kind !== "done") throw new Error(`${entry.name}: §4.3 step 1 did not complete`);
      expect(received.message.byteLength, entry.name).toBe(entry.inputs.envelopeBytes);

      const prepared = prepareRelayMessage(received.message, {
        maxChunkBytes: entry.inputs.assertedMaxDataChunkBytes as number,
        maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
        peerSupportsChunking: false,
      });
      expect(prepared.kind, entry.name).toBe("ready");
      if (prepared.kind !== "ready") continue;
      expect(prepared.payloads.length, entry.name).toBe(1);
      const payload = prepared.payloads[0];
      if (payload === undefined) throw new Error(`${entry.name}: nothing was prepared`);
      expect(entry.expected.preludePresent, entry.name).toBe(carriesThePrelude(payload));
      expect(entry.expected.wirePayloadBytes, entry.name).toBe(payload.byteLength);
      expect(hexOf(payload), entry.name).toBe(hexOf(f01Payload(entry)));
    }

    // …and they are one byte apart, which is what makes them a BOUNDARY.
    const at = fixtureCase(F01, "envelope-exactly-at-the-prelude-headroom-boundary");
    const over = fixtureCase(F01, "envelope-one-byte-over-the-prelude-headroom-boundary");
    expect(at.expected.preludePresent).toBe(true);
    expect(over.expected.preludePresent).toBe(false);
    expect((over.inputs.envelopeBytes as number) - (at.inputs.envelopeBytes as number)).toBe(1);
    expect((at.inputs.envelopeBytes as number) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES).toBe(
      at.inputs.assertedMaxDataChunkBytes,
    );
  });

  it("carries both reachability paths to a zero-length post-strip payload in all three modes", () => {
    const empties = fixtureCasesMatching(F01, /^empty-post-strip-payload-/, 6);
    for (const entry of empties) {
      // Recomputed, not read: the claim is that BOTH reachability paths end at
      // a zero-length post-strip payload, and a claim read off the case it
      // describes holds under any codec at all.
      const pushed = new RelayMessageAssembler().push(f01Payload(entry));
      expect(pushed.kind, entry.name).toBe("done");
      if (pushed.kind !== "done") continue;
      const classified = classifyPostStripPayload(pushed.message);

      const pipeline = entry.expected.pipeline as JsonRecord;
      const step1 = pipeline.step1Assembler as JsonRecord;
      const step2 = pipeline.step2Discrimination as JsonRecord;
      expect(step1.postStripBytes, entry.name).toBe(pushed.message.byteLength);
      expect(pushed.message.byteLength, entry.name).toBe(0);
      expect(step2.class, entry.name).toBe(classified.kind);
      if (classified.kind === "other") expect(step2.reason, entry.name).toBe(classified.reason);
      expect(entry.expected.neverSilentlyDropped, entry.name).toBe(true);
      // §11.2 P6 before keys, §11.3 Q6 after.
      expect(entry.expected.fatal, entry.name).toBe(
        entry.inputs.modeMachineState === "e2ee" ? "Q6" : "P6",
      );
      expect(entry.expected.disposition, entry.name).toBe(
        entry.inputs.modeMachineState === "e2ee" ? "FATAL-POST" : "FATAL-PRE",
      );
      // The prelude path MUST set the chunk-support latch before the fatal
      // outcome is taken; the zero-length path has no prelude to set it with.
      expect(step1.peerSupportsChunkingLatch, entry.name).toBe(
        entry.name.includes("chunk-capability-prelude"),
      );
    }
    expect(new Set(empties.map((entry) => entry.inputs.modeMachineState))).toEqual(
      new Set(["negotiating", "e2ee", "legacy"]),
    );
  });

  it("reproduces the §4.5 budget and both sides of the plaintext ceiling", () => {
    for (const name of [
      "size-budget-under-the-relay-initial-limits",
      "size-budget-of-the-corpus-channel",
    ]) {
      const entry = fixtureCase(F01, name);
      expect(
        e2eeChannelSizeBudget({
          maxQueuedBytes: entry.inputs.maxQueuedBytes as number,
          maxControlFrameBytes: entry.inputs.maxControlFrameBytes as number,
        }),
        name,
      ).toEqual(entry.expected);
    }

    const at = fixtureCase(F01, "inner-body-exactly-at-the-plaintext-ceiling");
    expect(at.expected.send).toBe("protected");
    expect(at.expected.envelopeBytes).toBe(
      (at.inputs.innerBodyBytes as number) + E2EE_ENVELOPE_OVERHEAD_BYTES,
    );
    expect(at.expected.transmittedRecords).toBe(1);

    const over = fixtureCase(F01, "inner-body-one-byte-over-the-plaintext-ceiling");
    expect(over.expected.send).toEqual({ kind: "refused", reason: "e2ee_message_too_large" });
    // §4.2 step 2: nothing encrypted, nothing transmitted.
    expect(over.expected.transmittedRecords).toBe(0);
    expect((over.inputs.innerBodyBytes as number) - (at.inputs.innerBodyBytes as number)).toBe(1);
  });

  it("treats a zero-length inner body as a valid §9.1 record", () => {
    const entry = fixtureCase(F01, "envelope-with-a-zero-length-inner-body");
    expect(entry.expected.envelopeBytes).toBe(E2EE_ENVELOPE_OVERHEAD_BYTES);
    expect((entry.expected.receive as JsonRecord).kind).toBe("authenticated");
    expect((entry.expected.receive as JsonRecord).bodyBytes).toBe(0);
    // Distinct from the zero-length POST-STRIP payload, which is fatal.
    expect(classifyPostStripPayload(fixtureBytes(entry.expected.envelope)).kind).toBe("envelope");
  });
});

describe("§16.3 F2 carrier compatibility (§5.5, §5.6)", () => {
  it("re-runs C1 through the assembler and C6 through Chromium's own JSON parser", () => {
    for (const entry of fixtureCasesMatching(F02, /^c1-carrier-reassembly-/, 2)) {
      const payload = fixtureBytes(entry.inputs.wirePayload);
      expect(isChunkedPayload(payload), entry.name).toBe(false);
      const assembler = new RelayMessageAssembler();
      const pushed = assembler.push(payload);
      expect(pushed.kind, entry.name).toBe("done");
      if (pushed.kind !== "done") continue;
      expect(hexOf(pushed.message), entry.name).toBe(
        hexOf(fixtureBytes(entry.expected.reassembled)),
      );
      expect(assembler.peerSupportsChunking, entry.name).toBe(entry.inputs.preludePresent);
      expect(entry.expected.reassembledEqualsTheCarrier, entry.name).toBe(true);
      expect(classifyPostStripPayload(pushed.message).kind, entry.name).toBe("legacy-json");
    }

    // §5.6 C6 is the one case whose verdict belongs to the RUNTIME's parser
    // rather than to a shared module: the prelude has to be JSON whitespace to
    // the engine that will parse the carrier, and in this tier that engine is
    // the browser's.
    const c6 = fixtureCase(F02, "c6-prelude-whitespace-tolerance");
    expect(hexOf(fixtureBytes(c6.inputs.prelude))).toBe(hexOf(RELAY_CHUNK_CAPABILITY_PRELUDE));
    expect(c6.expected.preludeBytesAreAllJsonWhitespace).toBe(true);
    const payload = fixtureBytes(c6.inputs.unstrippedPayload);
    const withPrelude = JSON.stringify(JSON.parse(new TextDecoder().decode(payload)) as unknown);
    const withoutPrelude = JSON.stringify(
      JSON.parse(
        new TextDecoder().decode(payload.subarray(RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES)),
      ) as unknown,
    );
    expect(withPrelude).toBe(c6.expected.parsedWithPrelude);
    expect(withoutPrelude).toBe(c6.expected.parsedWithoutPrelude);
    // Derived, not restated: the case's own claim is that the two parses agree.
    expect(c6.expected.identicalObject).toBe(withPrelude === withoutPrelude);
    expect(c6.expected.identicalObject).toBe(true);
    expect(c6.expected.carrierTag).toBe(E2EE_CAPABILITY_CARRIER_TAG);
  });

  it("emits the maximum carrier unchunked with the prelude at the advertisement floor", () => {
    const entry = fixtureCase(F02, "maximum-carrier-at-the-advertisement-floor");
    expect(entry.inputs.assertedMaxDataChunkBytes).toBe(E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES);
    expect(entry.expected.advertisementMinChunkBytes).toBe(E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES);
    expect(entry.expected.chunked).toBe(false);
    expect(entry.expected.preludePresent).toBe(true);
    expect(entry.expected.payloadCount).toBe(1);
    expect(entry.expected.satisfiesS6).toBe(true);
    expect(entry.expected.carrierPlusPreludeBytes).toBe(
      (entry.inputs.carrierBytes as number) + RELAY_CHUNK_CAPABILITY_PRELUDE_BYTES,
    );
    // Re-derived: a message of that size takes the prelude at that chunk limit.
    const prepared = prepareRelayMessage(new Uint8Array(entry.inputs.carrierBytes as number), {
      maxChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      maxMessageBytes: RELAY_MAX_RPC_MESSAGE_BYTES,
      peerSupportsChunking: false,
    });
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    expect(prepared.payloads.length).toBe(1);
    expect(prepared.payloads[0]?.byteLength).toBe(entry.expected.wirePayloadBytes);

    const below = fixtureCase(F02, "undersized-connection-one-byte-below-the-advertisement-floor");
    expect(below.inputs.assertedMaxDataChunkBytes).toBe(E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1);
    expect(below.inputs.advertisementMinChunkBytes).toBe(E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES);
    expect(below.expected.connectionIsUndersized).toBe(true);
    expect(below.expected.diagnosticReasonLabel).toBe("undersized-connection");
  });
});

describe("§16.3 F16 authorization context — the NX cases (§8.3, §13.6)", () => {
  it("recomputes the web/NX context commitment and holds the §8.3 absence semantics", () => {
    const entry = fixtureCase(F16, "authorization-context-block-web-nx");
    expect(entry.inputs.tier).toBe("web");
    const block = fixtureBytes(entry.expected.contextBlock);
    expect(hexOf(e2eeAuthorizationContextCommitment(block))).toBe(
      hexOf(fixtureBytes(entry.expected.contextCommitment)),
    );
    expect(entry.expected.commitmentIsSha256OfTheBlock).toBe(true);

    const elements = entry.expected.elements as JsonRecord;
    expect(elements.elementCount).toBe(18);
    // Elements 10 and 16 are the ONLY tier-dependent ones, and NX is the arm
    // that carries their absence forms.
    expect(elements.accountId).toBe("");
    expect(elements.clientCertificateFingerprints).toEqual([]);
    // Element 17 has no absence form on either tier: the node it names exists
    // whichever pattern ran.
    expect(elements.nodeContinuityId).not.toBe("");

    // The IK arm of the same family is what makes those two absences a TIER
    // distinction rather than a property of this one block.
    const ik = fixtureCase(F16, "authorization-context-block-native-ik");
    expect(ik.inputs.tier).toBe("native");
    const ikElements = ik.expected.elements as JsonRecord;
    expect(ikElements.accountId).not.toBe("");
    expect((ikElements.clientCertificateFingerprints as readonly unknown[]).length).toBe(2);
    expect(hexOf(fixtureBytes(ik.expected.contextBlock))).not.toBe(hexOf(block));
  });

  it("makes a web hello carrying element 10 or 16 a P13 with the length-uniform observable", () => {
    // §8.3's absence semantics violated: the two halves are inseparable by
    // construction, so one case covers both.
    const entry = fixtureCase(F16, "nx-absence-semantics-violated");
    expect(entry.expected.row).toBe("P13");
    expect(entry.expected.reason).toBe("context_mismatch");
    expect(entry.expected.disposition).toBe("FATAL-PRE");
    // The commitment carried with the mutated block is the block's OWN, which
    // is what puts the failure on §8.6 step 7's comparison rather than on a
    // malformed commitment the decoder would have caught first.
    expect(hexOf(e2eeAuthorizationContextCommitment(fixtureBytes(entry.inputs.contextBlock)))).toBe(
      hexOf(fixtureBytes(entry.inputs.contextCommitment)),
    );
    const observable = entry.expected.observable as JsonRecord;
    expect(observable.handshakeRejectRecords).toBe(1);
    expect(observable.closeReason).toBe("channel_rejected");
    expect(observable.applicationPayloadBytes).toBe(0);
    expect(fixtureBytes(observable.handshakeReject).byteLength).toBe(
      observable.handshakeRejectBytes,
    );
  });

  it("never matches an NX channel with a §13.6 authorization withdrawal", () => {
    // NX carries no Branch A record and therefore no §8.6 step 6 snapshot, so
    // there is nothing for a withdrawal to name and nothing to re-read.
    const entry = fixtureCase(F16, "nx-channel-is-never-matched-by-an-authorization-withdrawal");
    expect(entry.inputs.tier).toBe("web");
    expect(entry.inputs.reReadWouldReturn).toBeNull();
    expect(entry.expected.admittedAuthority).toBeNull();
    expect(entry.expected.reReadInvocations).toBe(0);
    expect(entry.expected.implicitFinish).toEqual({ kind: "finished" });
    expect(entry.expected.channelStaysOpen).toBe(true);

    // Every case of this family that DOES carry a snapshot is an IK channel,
    // and the withdrawal test is re-run here so the row above is a statement
    // about NX and not about a sweep that never withdraws anything. The count
    // is what holds that: a floor of one would let a regeneration rename ten of
    // the eleven out of the filter and leave the file green over a sweep that
    // no longer sweeps.
    for (const other of fixtureCasesCarrying(
      F16.cases,
      "inputs",
      "admittedAuthoritySnapshot",
      11,
    )) {
      const snapshot = other.inputs.admittedAuthoritySnapshot as JsonRecord;
      const changed = other.inputs.changedRecordKey as JsonRecord;
      const record = other.inputs.postChangeRecord as JsonRecord | null;
      const keysEqual = e2eeAuthorizationKeysEqual(
        {
          hubOrigin: snapshot.hubOrigin as string,
          accountId: snapshot.accountId as string,
          clientIdentityFingerprint: fixtureBytes(snapshot.clientIdentityFingerprint),
        },
        {
          hubOrigin: changed.hubOrigin as string,
          accountId: changed.accountId as string,
          clientIdentityFingerprint: fixtureBytes(changed.clientIdentityFingerprint),
        },
      );
      expect(keysEqual, other.name).toBe(other.expected.recordKeyMatches);
      const withdrawn =
        keysEqual &&
        e2eeAuthorizationWithdrawn(
          {
            status: snapshot.status as "approved",
            maxRole: snapshot.maxRole as string,
            capabilitySet: snapshot.capabilitySet as readonly string[],
          },
          record === null
            ? undefined
            : {
                status: record.status as "approved" | "pending" | "revoked",
                maxRole: record.maxRole as string,
                capabilitySet: record.capabilitySet as readonly string[],
              },
        );
      expect(withdrawn, other.name).toBe(other.expected.withdrawn);
    }
  });
});

describe("§16.3 F17 key-material validation — the P-256 cases (§7.1, §8.1, §14.3)", () => {
  it("rejects every §7.1 P-256 public-key encoding the family carries", () => {
    for (const entry of fixtureCasesMatching(F17, /^p256-public-key-(?!valid)/, 9)) {
      const key = fixtureBytes(entry.inputs.publicKey);
      expect(key.byteLength, entry.name).toBe(entry.inputs.publicKeyBytes);
      expect(() => validateE2eeClientIdentityPublicKey(key), entry.name).toThrow();
      expect((entry.expected.validation as JsonRecord).rejected, entry.name).toBe(true);
      expect(entry.expected.rejectedBeforeAnySignatureCheck, entry.name).toBe(true);
      expect(entry.expected.fatal, entry.name).toBe("P11");
    }
    // The control is what makes the nine rejections a property of the
    // ENCODINGS and not of a validator that refuses everything.
    const control = fixtureCase(F17, "p256-public-key-valid-control");
    expect(() =>
      validateE2eeClientIdentityPublicKey(fixtureBytes(control.inputs.publicKey)),
    ).not.toThrow();
    expect(control.expected.validationAccepted).toBe(true);
  });

  it("rejects every §7.1 P-256 signature encoding, and verifies none of them", () => {
    // The message is F04's committed client prekey transcript: a real §7.4
    // transcript rather than an arbitrary buffer, so the `false` below is the
    // verification path's verdict on a signature that is malformed and not on
    // one that simply signs nothing.
    const message = fixtureBytes(
      fixtureCase(F04, "valid-client-agreement-prekey-certificate").inputs.transcript,
    );
    const publicKey = fixtureBytes(F17.testKeyMaterial.clientIdentityPublicKey);
    expect(() => validateE2eeClientIdentityPublicKey(publicKey)).not.toThrow();

    for (const entry of fixtureCasesMatching(F17, /^p256-signature-/, 7)) {
      const signature = fixtureBytes(entry.inputs.signature);
      expect(signature.byteLength, entry.name).toBe(entry.inputs.signatureBytes);
      expect(() => validateE2eeClientSignature(signature), entry.name).toThrow();
      expect((entry.expected.encodingValidation as JsonRecord).rejected, entry.name).toBe(true);
      // The single verification choke point returns false and never throws.
      const verdict = verifyE2eeSignature({
        algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
        publicKey,
        message,
        signature,
      });
      expect(verdict, entry.name).toBe(false);
      expect(entry.expected.verificationVerdict, entry.name).toBe(verdict);
      expect(entry.expected.fatal, entry.name).toBe("P11");
    }
  });
});
