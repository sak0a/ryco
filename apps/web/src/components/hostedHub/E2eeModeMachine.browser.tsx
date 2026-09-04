import {
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_HANDSHAKE_REJECT_BYTES,
} from "@ryco/shared/relayE2eeConstants";
import { E2EE_ERROR_CODE_PROTOCOL_VIOLATION } from "@ryco/shared/relayE2eeClose";
import { E2eeRecordSession } from "@ryco/shared/relayE2eeSession";
import {
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
  E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT,
  E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  classifyPostStripPayload,
  decodeE2eeNegotiationRecord,
  e2eeNegotiationRecordBound,
  e2eeNegotiationRecordDirection,
  encodeE2eeHandshakeReject,
} from "@ryco/shared/relayE2eeWire";
import { describe, expect, it } from "vite-plus/test";

import {
  CORPUS_CHANNEL_PLAINTEXT_CEILING,
  F06,
  F08,
  F10,
  fixtureBytes,
  fixtureCase,
  fixtureCasesCarrying,
  fixtureCasesMatching,
  hexOf,
  type E2eeFixtureCase,
} from "../../../test/e2eeCorpus";

// The §16.4 F10 browser run.
//
// The real node transport rows are driven by
// `apps/server/src/hubConnector/relayE2eeNodeCorpus.test.ts`. That application
// runtime intentionally cannot be bundled into Web. This file runs the complete
// committed family in Chromium instead: every case is enumerated, every carried
// byte string is decoded under §16.2 and round-tripped, and every portable
// decision that selects a row (classification, direction, bounds, record
// authentication, anti-oracle bytes and the stated §11 disposition) is
// re-derived through the shared production modules. A rename, added case, added
// byte leaf, or changed behavior therefore makes this browser gate fail.

type JsonRecord = Readonly<Record<string, unknown>>;

const EXPECTED_CASE_NAMES = [
  "legacy-lock-injection-envelope-is-p5",
  "legacy-lock-injection-client-hello-at-the-node-is-p24",
  "legacy-lock-injection-server-accept-at-the-client-is-p24",
  "legacy-lock-injection-unknown-first-byte-is-p6",
  "legacy-lock-injection-absent-first-byte-is-p6",
  "misdirected-negotiation-record-is-p3",
  "over-bound-negotiation-record-is-p3",
  "row-n1-legacy-json-under-effective-require-e2ee",
  "row-n2-legacy-json-locks-legacy-and-counts-one-peer-legacy-occurrence",
  "row-n3-client-hello-runs-the-responder-and-enters-e2ee",
  "row-n4-a-second-hello-on-the-channel",
  "row-n4-a-hello-with-no-advertisement-emitted",
  "row-n5-a-misdirected-negotiation-record-in-negotiating",
  "row-n6-an-envelope-before-establishment",
  "row-n7-an-unknown-first-byte-in-negotiating",
  "row-n7-an-absent-first-byte-in-negotiating",
  "row-n8-the-handshake-deadline-under-effective-require-e2ee",
  "row-n9-an-authenticated-envelope-is-delivered-to-the-rpc-parser",
  "row-n10-an-envelope-failing-a-step-3-check",
  "row-n11-legacy-json-after-e2ee",
  "row-n11-a-negotiation-record-after-e2ee",
  "row-n11-an-absent-first-byte-after-e2ee",
  "row-n12-legacy-json-in-legacy",
  "row-n13-an-envelope-in-legacy",
  "row-n13-a-negotiation-record-in-legacy",
  "row-n14-an-unknown-first-byte-in-legacy",
  "row-n15-an-undersized-connection-under-effective-require-e2ee",
  "row-n15-no-conforming-statement-under-effective-require-e2ee",
  "row-n16-an-undersized-connection-under-the-compatibility-default",
  "row-n16-no-conforming-statement-under-the-compatibility-default",
  "row-n17-legacy-json-on-a-channel-that-never-advertised",
  "node-deadline-n8-does-not-fire-under-the-compatibility-default",
  "node-deadline-after-row-n3-is-q8-under-effective-require-e2ee",
  "node-deadline-after-row-n3-is-q8-under-the-compatibility-default",
] as const;

interface FixtureByteLeaf {
  readonly path: string;
  readonly value: unknown;
}

function collectByteLeaves(value: unknown, path: string, out: FixtureByteLeaf[]): void {
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, "$bytes")) {
    out.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectByteLeaves(entry, `${path}[${String(index)}]`, out));
    return;
  }
  for (const [key, entry] of Object.entries(record))
    collectByteLeaves(entry, `${path}.${key}`, out);
}

function rowOf(entry: E2eeFixtureCase): string | null {
  return (Object.hasOwn(entry.expected, "fatal") ? entry.expected.fatal : entry.expected.row) as
    | string
    | null;
}

function receivingSession(): E2eeRecordSession {
  const trace = fixtureCase(F06, "ik-handshake-complete-trace").expected;
  return new E2eeRecordSession({
    secrets: {
      epochSecretC2N: fixtureBytes(trace.epochSecretC2N),
      epochSecretN2C: fixtureBytes(trace.epochSecretN2C),
      exporterSecret: fixtureBytes(trace.exporterSecret),
      serverConfirmationKey: fixtureBytes(trace.serverConfirmationKey),
    },
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash: fixtureBytes(trace.sessionBindingHash),
    sendDirection: E2EE_DIRECTION_NODE_TO_CLIENT,
    plaintextCeiling: CORPUS_CHANNEL_PLAINTEXT_CEILING,
  });
}

describe("§16.4 F10 complete mode-machine corpus in Chromium", () => {
  it("pins the complete case set and consumes every committed byte leaf", () => {
    expect(F10.cases.map((entry) => entry.name)).toEqual(EXPECTED_CASE_NAMES);
    const leaves: FixtureByteLeaf[] = [];
    collectByteLeaves(F10.testKeyMaterial, "F10.testKeyMaterial", leaves);
    for (const entry of F10.cases) {
      collectByteLeaves(entry.inputs, `${entry.name}.inputs`, leaves);
      collectByteLeaves(entry.expected, `${entry.name}.expected`, leaves);
    }
    expect(leaves, "F10's complete byte-leaf inventory").toHaveLength(57);
    for (const leaf of leaves) {
      const wrapper = leaf.value as Record<string, unknown>;
      expect(Object.keys(wrapper), leaf.path).toEqual(["$bytes"]);
      const bytes = fixtureBytes(wrapper);
      expect({ $bytes: hexOf(bytes) }, leaf.path).toEqual(wrapper);
    }
  });

  it("re-derives every carried §4.3 classification and reason", () => {
    let checked = 0;
    for (const entry of F10.cases) {
      if (entry.inputs.postStripPayload === undefined) continue;
      const step2 = entry.expected.step2Discrimination as JsonRecord | undefined;
      if (step2 === undefined) continue;
      const classified = classifyPostStripPayload(fixtureBytes(entry.inputs.postStripPayload));
      expect(classified.kind, entry.name).toBe(step2.class);
      if (step2.reason !== undefined) {
        expect(classified.kind === "other" ? classified.reason : undefined, entry.name).toBe(
          step2.reason,
        );
      }
      checked += 1;
    }
    expect(checked).toBe(24);
  });

  it("pins all seventeen node rows, their next state, and the one pre-key observable", () => {
    const rows = fixtureCasesMatching(F10, /^row-n\d/, 24);
    const numbered = new Set<string>();
    const observables = new Set<string>();
    for (const entry of rows) {
      const row = entry.inputs.row as string;
      expect(row, entry.name).toMatch(/^N(?:[1-9]|1[0-7])$/);
      expect(entry.expected.row, entry.name).toBe(row);
      expect(typeof entry.expected.action, entry.name).toBe("string");
      expect(typeof entry.expected.nextState, entry.name).toBe("string");
      numbered.add(row);
      if (entry.expected.disposition === "FATAL-PRE") {
        const observable = entry.expected.observable as JsonRecord;
        expect(hexOf(fixtureBytes(observable.handshakeReject)), entry.name).toBe(
          hexOf(encodeE2eeHandshakeReject()),
        );
        expect(observable.handshakeRejectBytes, entry.name).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
        observables.add(JSON.stringify(observable));
      }
    }
    expect([...numbered].toSorted()).toEqual(
      Array.from({ length: 17 }, (_, index) => `N${String(index + 1)}`).toSorted(),
    );
    expect(observables.size).toBe(1);
  });

  it("keeps legacy-lock and negotiation P3/P24 partitions disjoint", () => {
    const injections = fixtureCasesMatching(F10, /^legacy-lock-injection-/, 5);
    expect(injections.map((entry) => entry.expected.fatal)).toEqual([
      "P5",
      "P24",
      "P24",
      "P6",
      "P6",
    ]);
    for (const entry of [...injections, ...fixtureCasesMatching(F10, /-is-p3$/, 2)]) {
      expect(entry.expected.disposition, entry.name).toBe("FATAL-PRE");
    }

    const partition = fixtureCasesMatching(F10, /-is-p(?:24|3)$/, 4);
    for (const entry of partition) {
      const recordType = entry.inputs.recordType as
        | typeof E2EE_NEGOTIATION_TYPE_CLIENT_HELLO
        | typeof E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT
        | typeof E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT;
      const bound = e2eeNegotiationRecordBound(recordType);
      const direction = e2eeNegotiationRecordDirection(recordType);
      const receivedBy = entry.inputs.receivingEndpoint as string | undefined;
      const payload = entry.inputs.postStripPayload;
      const recordBytes =
        payload === undefined ? (entry.inputs.recordBytes as number) : fixtureBytes(payload).length;
      const addressedHere =
        receivedBy === undefined || direction === (receivedBy === "node" ? "c2n" : "n2c");
      const withinItsBound = recordBytes <= bound.maxBytes;
      expect(entry.expected.fatal, entry.name).toBe(addressedHere && withinItsBound ? "P24" : "P3");
    }
    const over = fixtureCase(F10, "over-bound-negotiation-record-is-p3");
    expect(over.inputs.recordBytes).toBe(E2EE_CLIENT_HELLO_MAX_BYTES + 1);
    expect(over.expected.reason).toBe("too_large");
  });

  it("authenticates N9 and rejects N10 through the production record session", () => {
    const n9 = fixtureCase(F10, "row-n9-an-authenticated-envelope-is-delivered-to-the-rpc-parser");
    const opened = receivingSession().unprotect(fixtureBytes(n9.inputs.postStripPayload));
    expect(opened.kind).toBe("authenticated");
    if (opened.kind !== "authenticated") throw new Error("N9 did not authenticate");
    expect({
      kind: opened.kind,
      innerType: opened.innerType,
      bodyBytes: opened.body.byteLength,
      epoch: Number(opened.epoch),
      counter: Number(opened.counter),
      plaintextBytes: opened.plaintextBytes,
      epochCompleted: opened.epochCompleted,
    }).toEqual(n9.expected.unprotect);

    const n10 = fixtureCase(F10, "row-n10-an-envelope-failing-a-step-3-check");
    const refused = receivingSession().unprotect(fixtureBytes(n10.inputs.postStripPayload));
    expect(refused.kind).toBe("fatal");
    if (refused.kind !== "fatal") throw new Error("N10's corrupted record opened");
    expect({ kind: refused.kind, reason: refused.reason }).toEqual(n10.expected.unprotect);
    expect(refused.reason).toBe(
      (fixtureCase(F08, "tampered-ciphertext-byte").expected.received as JsonRecord).reason,
    );
  });

  it("derives every negotiation direction, bound, and misdirection verdict", () => {
    for (const entry of fixtureCasesCarrying(F10.cases, "expected", "misdirected", 4)) {
      const input = entry.inputs.input as JsonRecord | undefined;
      const recordType = (entry.inputs.recordType ?? input?.type) as
        | typeof E2EE_NEGOTIATION_TYPE_CLIENT_HELLO
        | typeof E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT
        | typeof E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT;
      const receivingEndpoint = (entry.inputs.receivingEndpoint ?? entry.inputs.endpoint) as string;
      const direction = e2eeNegotiationRecordDirection(recordType);
      const addressedHere = direction === (receivingEndpoint === "node" ? "c2n" : "n2c");
      expect(entry.expected.misdirected, entry.name).toBe(!addressedHere);
    }

    const n3 = fixtureCase(F10, "row-n3-client-hello-runs-the-responder-and-enters-e2ee");
    const accept = fixtureBytes(n3.expected.serverAccept);
    expect(accept.byteLength).toBe(n3.expected.serverAcceptBytes);
    const decoded = decodeE2eeNegotiationRecord(accept);
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") throw new Error("N3 accept did not decode");
    expect(decoded.value.recordType).toBe(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT);
    expect(n3.expected.registryDirection).toBe("n2c");
    expect(accept.byteLength).toBeLessThanOrEqual(
      e2eeNegotiationRecordBound(E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT).maxBytes,
    );
    expect(hexOf(accept)).toBe(
      hexOf(
        fixtureBytes(
          fixtureCase(F10, "legacy-lock-injection-server-accept-at-the-client-is-p24").inputs
            .postStripPayload,
        ),
      ),
    );
  });

  it("derives §11 pre/post-key disposition and protected error behavior", () => {
    for (const entry of fixtureCasesCarrying(F10.cases, "expected", "sessionKeysExist", 8)) {
      const row = rowOf(entry);
      expect(entry.expected.sessionKeysExist, entry.name).toBe(
        typeof row === "string" && row.startsWith("Q"),
      );
    }
    for (const entry of fixtureCasesCarrying(F10.cases, "expected", "disposition", 26)) {
      const row = rowOf(entry);
      if (typeof row !== "string") continue;
      expect(entry.expected.disposition, entry.name).toBe(
        row.startsWith("Q") ? "FATAL-POST" : "FATAL-PRE",
      );
    }
    for (const entry of fixtureCasesCarrying(F10.cases, "expected", "errorCode", 6)) {
      expect(rowOf(entry)?.startsWith("Q"), entry.name).toBe(true);
      expect(entry.expected.errorCode, entry.name).toBe(E2EE_ERROR_CODE_PROTOCOL_VIOLATION);
      expect(entry.expected.errorRecordsOnTheWire, entry.name).toBe(1);
    }
  });

  it("drives the deadline, fallback-accounting, and suppressed-advertisement behavior", () => {
    const n8 = fixtureCase(F10, "row-n8-the-handshake-deadline-under-effective-require-e2ee");
    expect((n8.inputs.guards as JsonRecord).effectiveRequireE2EE).toBe(true);
    expect(n8.expected.fatal).toBe("P7");
    const unarmed = fixtureCase(
      F10,
      "node-deadline-n8-does-not-fire-under-the-compatibility-default",
    );
    expect(unarmed.expected.rowN8Fires).toBe(false);
    expect(unarmed.expected.nextState).toBe("negotiating");
    const afterN3 = fixtureCasesMatching(F10, /^node-deadline-after-row-n3-/, 2);
    expect(afterN3.map((entry) => entry.expected.row)).toEqual(["Q8", "Q8"]);
    expect(afterN3.every((entry) => entry.expected.armedUnderThisPolicy === true)).toBe(true);

    for (const entry of fixtureCasesMatching(F10, /^row-n1[56]-/, 4)) {
      const guards = entry.inputs.guards as JsonRecord;
      expect(typeof guards.assertedMaxDataChunkBytes, entry.name).toBe("number");
      expect(typeof guards.effectiveRequireE2EE, entry.name).toBe("boolean");
      expect(guards.selfCheck, entry.name).toBeDefined();
      expect(entry.expected.carrierEmitted, entry.name).toBe(false);
      const diagnostic = entry.expected.operatorDiagnostic as JsonRecord;
      expect(diagnostic.code, entry.name).toBe("e2ee_advertisement_unavailable");
      expect(diagnostic.reason, entry.name).toBe(guards.advertisementUnavailableReason);
    }
    for (const entry of fixtureCasesMatching(F10, /^row-n16-/, 2)) {
      expect(entry.expected.fallbackOccurrence).toMatchObject({
        class: "advertisement-unavailable",
        count: 1,
      });
      expect(entry.expected.peerLegacyOccurrence).toBe(0);
    }
    expect(
      fixtureCase(F10, "row-n17-legacy-json-on-a-channel-that-never-advertised").expected
        .fallbackOccurrencesForThisChannel,
    ).toEqual({ "peer-legacy": 0, "advertisement-unavailable": 1 });
  });
});
