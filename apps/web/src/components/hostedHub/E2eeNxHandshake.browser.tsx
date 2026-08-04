import { makeRelayE2eeInitiator, type RelayE2eeHost } from "@ryco/client-runtime/relay";
import {
  E2EE_WEB_SAS_HKDF_BYTES,
  E2EE_WEB_SAS_MIN_DISPLAYED_BITS,
  T_ADV,
} from "@ryco/shared/relayE2eeConstants";
import { decodeNodeE2eeCapabilityStatement } from "@ryco/shared/relayE2eeTranscripts";
import { deriveE2eeWebSas } from "@ryco/shared/relayE2eeVerificationDisplay";
import {
  classifyPostStripPayload,
  decodeE2eeNegotiationRecord,
  encodeE2eeCapabilityCarrier,
  E2EE_NEGOTIATION_TYPE_CLIENT_HELLO,
} from "@ryco/shared/relayE2eeWire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  authenticateRelay,
  createRelayHarness,
  deliverRelayPayload,
  fixtureBytes,
  fixtureCase,
  fixtureStatement,
  FIXTURE_ACCOUNT_ID,
  FIXTURE_HUB_ORIGIN,
  FIXTURE_NODE_ID,
  FIXTURE_NOW,
  F03,
  F14,
  hexOf,
  outboundRelayPayloads,
  relayCloseReasons,
  respondAsNode,
  settleRelay,
  USABLE_STATEMENT_CASE,
  type MockWebSocket,
} from "../../../test/maliciousRelay";
import { webRelayE2eeAttempt } from "../../hostedHub/e2eeAttempt";
import {
  clearWebE2eeLatches,
  isWebE2eeSelectionLatched,
  latchWebE2eeSelection,
} from "../../hostedHub/e2eeLatch";
import {
  beginWebE2eeChannelAttempt,
  resetWebE2eeSession,
  webE2eeSessionState,
} from "../../hostedHub/e2eeSession";

// docs/relay-e2ee-protocol.md §16.4: the web-facing families "MUST also run in
// the web browser test suite". This file carries the WEB-TIER-SPECIFIC half of
// that obligation — F3's admitted-pattern cases, F7's NX rules as this tier
// reaches them, F10's web mapping, and the `WebSAS` half of F14 — driven through
// the real `BrowserHostedRelaySocket` against real Chromium WebCrypto.
//
// The runtime-parity families (F1, F2, F8, F17) are DEFERRED to Phase 6; see
// `docs/relay-e2ee-web-browser-vectors.md`.
//
// WHAT THIS FILE MAY NOT BE READ AS SAYING. Every case below passes on a client
// whose JavaScript a malicious Hub serves, because that Hub can complete a
// genuine handshake and then exfiltrate the plaintext it just decrypted (§2.2,
// §2.3, §2.4). None of these assertions is evidence of operator-proof
// protection, and the §12.1 latch they exercise "buys nothing against the Hub
// under any keying".

const SELECTION = {
  hubOrigin: FIXTURE_HUB_ORIGIN,
  accountId: FIXTURE_ACCOUNT_ID,
  nodeId: FIXTURE_NODE_ID,
} as const;

/** The §5.3 carrier for one committed F03 statement, framed here. */
function carrier(name: string): Uint8Array {
  return encodeE2eeCapabilityCarrier(fixtureStatement(name));
}

/** Every negotiation record type this client actually put on the relay (§3.4). */
function negotiationRecordTypes(socket: MockWebSocket): number[] {
  return outboundRelayPayloads(socket).flatMap((payload) => {
    if (classifyPostStripPayload(payload).kind !== "negotiation") return [];
    const decoded = decodeE2eeNegotiationRecord(payload);
    return decoded.kind === "error" ? [] : [decoded.value.recordType];
  });
}

/**
 * Statement validity is a §5.2 step 3 check against the CLIENT's clock, and the
 * committed corpus fixes both ends of that window. `Date` alone is frozen —
 * `setTimeout` stays real, because `T_ADV` is what decides half these rows and a
 * faked scheduler would decide them for the machine.
 */
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(FIXTURE_NOW);
  clearWebE2eeLatches();
  resetWebE2eeSession();
});

afterEach(() => {
  clearWebE2eeLatches();
  // §13's projection is module state and outlives a case that locked it.
  resetWebE2eeSession();
  vi.restoreAllMocks();
});

/**
 * One channel, opened to `channel.accept` against the CURRENT latch state.
 *
 * The attempt is the production one — `webRelayE2eeAttempt` — with only a §11.4
 * diagnostic sink added: §11.5 makes the wire observable uniform on purpose, so
 * the §11.2 row a case expects is not readable from the frames, and the
 * client-local diagnostic is the operator's side of the same event.
 */
function openChannel() {
  const attempt = webRelayE2eeAttempt(SELECTION);
  const diagnostics: string[] = [];
  const harness = createRelayHarness({
    e2ee: (host: RelayE2eeHost) =>
      makeRelayE2eeInitiator({
        host,
        attempt: { ...attempt, onDiagnostic: (entry) => void diagnostics.push(entry.row) },
      }),
  });
  authenticateRelay(harness.socket);
  return { ...harness, attempt, diagnostics };
}

const waitPastTAdv = (): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, T_ADV + 250));

describe("§16.3 F3 admitted patterns — NX tier confusion (§5.2 step 9, §7.6 element 14)", () => {
  it("takes P15 on an IK-only statement while latched, flushing no buffered send", async () => {
    // The REACHABLE version-1 configuration: §12.1 sets the web latch on the
    // statement's own validation and step 9 runs after it, so a web client
    // against a node running `requireApprovedClientE2EE` takes K2/P15.
    const entry = fixtureCase(F03, "admitted-pattern-set-ik-only-evaluated-as-web-latched");
    expect(entry.inputs.tier).toBe("web");
    expect(entry.inputs.advertisedAdmittedPatterns).toEqual(["IK"]);
    expect(entry.expected.row).toBe("K2");
    expect(entry.expected.fatal).toBe("P15");

    latchWebE2eeSelection(SELECTION);
    const channel = openChannel();
    expect(channel.attempt.selectionClass).toBe("latched");

    // §16.3 F3: this run "MUST be run with the channel's buffered sends
    // **non-empty**, asserting that none was flushed as plaintext".
    channel.facade.send(new TextEncoder().encode('{"buffered":1}'));
    channel.facade.send(new TextEncoder().encode('{"buffered":2}'));
    expect(outboundRelayPayloads(channel.socket)).toEqual([]);

    deliverRelayPayload(channel.socket, carrier(entry.name));
    await settleRelay();

    expect(channel.diagnostics).toEqual(["P15"]);
    // Nothing at all left this client: no hello, and — the whole point — not one
    // of the two buffered application sends.
    expect(outboundRelayPayloads(channel.socket)).toEqual([]);
    expect(negotiationRecordTypes(channel.socket)).toEqual([]);
    expect(relayCloseReasons(channel.socket)).toEqual(["channel_rejected"]);
    expect(entry.expected.ticketSpentOnAHello).toBe(false);
  });

  it("takes K3 on the identical bytes while NOT latched — a rule-level case, not a web one", async () => {
    // §16.3 F3 labels this explicitly: it "pins the K3 branch of the same guard
    // for the first future tier whose latch is unset", and asserting it does not
    // claim a conforming version-1 web client can occupy this state. On this
    // tier §12.1 latches from the same statement's validation, so a real session
    // reaches the case above instead.
    const entry = fixtureCase(F03, "admitted-pattern-set-ik-only-evaluated-as-web-unlatched");
    expect(entry.expected.row).toBe("K3");
    expect(entry.expected.evidenceTreatment).toBe("absent-evidence");
    expect(String(entry.note)).toMatch(/RULE-LEVEL case, not a reachable web one/i);

    const channel = openChannel();
    expect(channel.attempt.selectionClass).toBe("legacy-eligible");

    deliverRelayPayload(channel.socket, carrier(entry.name));
    await settleRelay();

    expect(channel.diagnostics).toEqual(["K3"]);
    // Unusable evidence: no hello may be built on it, and the `T_ADV` rows still
    // decide the channel.
    expect(negotiationRecordTypes(channel.socket)).toEqual([]);
    expect(entry.expected.ticketSpentOnAHello).toBe(false);
    expect(relayCloseReasons(channel.socket)).toEqual([]);
  });

  it("takes K1 when element 14 admits NX", async () => {
    const entry = fixtureCase(F03, "admitted-pattern-set-ik-and-nx-evaluated-as-web");
    expect(entry.inputs.advertisedAdmittedPatterns).toEqual(["IK", "NX"]);
    expect(entry.expected.row).toBe("K1");

    const channel = openChannel();
    deliverRelayPayload(channel.socket, carrier(entry.name));
    await settleRelay();

    // The membership test passed, so the ticket IS spent on a hello here — which
    // is what makes the two cases above a check on element 14 rather than on the
    // set's length or its first entry.
    expect(negotiationRecordTypes(channel.socket)).toEqual([E2EE_NEGOTIATION_TYPE_CLIENT_HELLO]);
    expect(channel.diagnostics).toEqual([]);
    // §12.1: the statement validated, so the selection is latched from here on.
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);
  });
});

describe("§12.1.1 the degenerate web mapping, evaluated at channel.accept", () => {
  it("locks legacy at T_ADV before the first validated statement (K13) and closes after one (K14)", async () => {
    // §12.1: "Before the first validated statement of a session, and in every
    // fresh session, web has no downgrade resistance at all." The two halves of
    // that sentence are one session narrative, so they are one case.

    // (a) Fresh session, carrier withheld past `T_ADV`: row K13. The selection is
    // legacy-eligible, so the buffered send is flushed AS PLAINTEXT — the
    // explicitly retained downgrade exposure of §12.2, not a defect.
    const first = openChannel();
    expect(first.attempt.selectionClass).toBe("legacy-eligible");
    first.facade.send(new TextEncoder().encode('{"buffered":1}'));
    expect(outboundRelayPayloads(first.socket)).toEqual([]);
    await waitPastTAdv();
    const flushed = outboundRelayPayloads(first.socket);
    expect(flushed).toHaveLength(1);
    expect(new TextDecoder().decode(flushed[0]!)).toBe('{"buffered":1}');
    expect(relayCloseReasons(first.socket)).toEqual([]);

    // (b) The session's first validated statement, on its own channel.
    const second = openChannel();
    deliverRelayPayload(second.socket, carrier(USABLE_STATEMENT_CASE));
    await settleRelay();
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);

    // (c) The same withheld carrier, now against a latched selection: row K14 /
    // §11.2 P19. Nothing is flushed and the channel closes. The latch is the only
    // thing that changed between (a) and (c).
    const third = openChannel();
    expect(third.attempt.selectionClass).toBe("latched");
    third.facade.send(new TextEncoder().encode('{"buffered":2}'));
    await waitPastTAdv();
    expect(outboundRelayPayloads(third.socket)).toEqual([]);
    expect(third.diagnostics).toEqual(["P19"]);
    expect(relayCloseReasons(third.socket)).toEqual(["channel_rejected"]);
  });

  it("fixes the classification at channel.accept, so a later latch cannot change it", async () => {
    // §12.1.1: the guards "must be answerable at `channel.accept`, before any
    // payload arrives — otherwise a Hub that simply withholds or delays the
    // carrier past `T_ADV` makes every guard evaluate as 'not latched'". The
    // classification is therefore a VALUE on the attempt and not a callback the
    // machine could re-evaluate at row time.
    const channel = openChannel();
    expect(channel.attempt.selectionClass).toBe("legacy-eligible");

    // A latch set on the running session, after the accept, mid-negotiation.
    latchWebE2eeSelection(SELECTION);
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);
    expect(channel.attempt.selectionClass).toBe("legacy-eligible");

    channel.facade.send(new TextEncoder().encode('{"buffered":1}'));
    await waitPastTAdv();
    // Still row K13: this channel was classified before any payload, and the
    // late latch governs the NEXT one.
    expect(outboundRelayPayloads(channel.socket)).toHaveLength(1);
    expect(webRelayE2eeAttempt(SELECTION).selectionClass).toBe("latched");
  });

  it("writes no latch byte to localStorage, sessionStorage, or indexedDB", async () => {
    // §12.1's fourth MUST NOT and §6.3's storage prohibition, checked against the
    // real browser APIs across a whole session rather than against a comment.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clearStorage = vi.spyOn(Storage.prototype, "clear");
    const openDatabase = vi.spyOn(IDBFactory.prototype, "open");

    const channel = openChannel();
    deliverRelayPayload(channel.socket, carrier(USABLE_STATEMENT_CASE));
    await settleRelay();
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);

    const second = openChannel();
    expect(second.attempt.selectionClass).toBe("latched");
    await waitPastTAdv();

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clearStorage).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });
});

/** One logged argument, flattened as far as it can be, for a string scan. */
function serializedForLeakScan(argument: unknown): string {
  if (typeof argument === "string") return argument;
  let serialized = "";
  try {
    serialized = JSON.stringify(argument) ?? "";
  } catch {
    // Cyclic or non-serializable; `String()` below is the whole scan for it.
  }
  return `${String(argument)} ${serialized}`;
}

/**
 * One complete NX session against the real §8.6 node half, to the `e2ee` lock.
 *
 * Shared by the two cases below because the second one — §13.5's storage and
 * logging prohibition — is only worth anything if the spies are installed while
 * the code is actually published, and that is the instant this function reaches.
 *
 * THE PRODUCTION SINK IS CALLED, NOT REPLACED. `webRelayE2eeAttempt` wires
 * `onWebVerificationCode` to `publishWebE2eeVerificationCode`, and a case that
 * substituted its own collector would run the handshake with the real publish
 * path switched off — so a write or a log added inside that function would be
 * unobserved by the very spies installed to catch it. The collector wraps the
 * production callback instead of standing in for it.
 *
 * `beginWebE2eeChannelAttempt` is what `resolveWebRelayE2eeProvider` does at
 * factory time, and it is done by hand here for the same reason
 * `webRelayE2eeAttempt` is exported: §12.1.1 reads `hubOrigin` off the document,
 * and the §16.3 fixture's origin is not the one this page is served from, so the
 * real provider cannot resolve a selection in this suite. Without it the §13.5
 * publish would hit the module's `unavailable` refusal and never land.
 */
async function completeNxSession() {
  const statement = fixtureStatement(USABLE_STATEMENT_CASE);
  const decoded = decodeNodeE2eeCapabilityStatement(statement);
  if (decoded.kind !== "ok") throw new Error("the committed statement no longer decodes");

  const codes: string[] = [];
  const attempt = webRelayE2eeAttempt(SELECTION);
  beginWebE2eeChannelAttempt();
  const harness = createRelayHarness({
    e2ee: (host: RelayE2eeHost) =>
      makeRelayE2eeInitiator({
        host,
        attempt: {
          ...attempt,
          onWebVerificationCode: (code) => {
            codes.push(code);
            attempt.onWebVerificationCode?.(code);
          },
        },
      }),
  });
  authenticateRelay(harness.socket);

  // A submission made while `negotiating` is buffered, never written in the
  // clear — and it is the byte that proves the flush went out ENCRYPTED.
  harness.facade.send(new TextEncoder().encode('{"buffered":1}'));
  expect(outboundRelayPayloads(harness.socket)).toEqual([]);

  deliverRelayPayload(harness.socket, encodeE2eeCapabilityCarrier(statement));
  await settleRelay();
  const hello = outboundRelayPayloads(harness.socket).at(-1);
  expect(hello).toBeDefined();

  const accept = respondAsNode(Uint8Array.from(hello!));
  if (accept.kind !== "accepted") throw new Error("the node half refused the hello");
  deliverRelayPayload(harness.socket, accept.record, 1);
  await settleRelay();

  return { harness, codes, accept, nodeIdentityPublicKey: decoded.value.identityPublicKey };
}

describe("§8 the NX handshake completes in Chromium and yields §13.5's code", () => {
  it("locks e2ee, renders the WebSAS the node would show, and stops writing plaintext", async () => {
    // The one case that proves this tier is actually ON: a real NX handshake
    // against a real §8.6 node half, in the runtime that ships it.
    //
    // §13.5's claim is a COMPARISON — the browser shows the string, the node CLI
    // shows the string, the owner compares them out of band — so the assertion
    // is that the client's rendered code equals the one derived from the NODE's
    // view of the same ephemeral (`peerEphemeralPublicKey`, read off message 1).
    const { harness, codes, accept, nodeIdentityPublicKey } = await completeNxSession();

    // §13.5: once, and only at the `e2ee` lock.
    expect(codes).toHaveLength(1);
    expect(codes[0]).toBe(
      deriveE2eeWebSas({
        nodeIdentityPublicKey,
        webEphemeralPublicKey: accept.peerEphemeralPublicKey,
        sessionBindingHash: accept.sessionBindingHash,
      }).display,
    );
    // …and it reached the §13 projection, which is the only thing a surface can
    // read. The production `onWebVerificationCode` is the sink, so this is the
    // whole path from the Noise ephemeral to the value a UI would render.
    expect(webE2eeSessionState().verificationCode).toBe(codes[0]);

    // Everything after the hello is an envelope: the buffered submission was
    // flushed protected, and no plaintext RPC ever reached the relay.
    const afterHello = outboundRelayPayloads(harness.socket).slice(1);
    expect(afterHello.length).toBeGreaterThan(0);
    for (const payload of afterHello) {
      expect(classifyPostStripPayload(payload).kind).toBe("envelope");
    }
    expect(relayCloseReasons(harness.socket)).toEqual([]);
  });

  it("writes and logs nothing while §13.5's code is published", async () => {
    // §13.5: the `WebSAS` "is ephemeral display state: never logged, never
    // persisted, never sent to analytics". The latch case above installs the
    // same storage spies but never reaches the `e2ee` lock, so no code is ever
    // published while they are watching — a `sessionStorage.setItem` or a
    // `console.info` on the publish path was unobserved by every suite.
    //
    // The console sinks are spied ALONGSIDE storage because a display string
    // leaks through either, and §13.5 names both.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clearStorage = vi.spyOn(Storage.prototype, "clear");
    const openDatabase = vi.spyOn(IDBFactory.prototype, "open");
    const sinks = (["debug", "error", "info", "log", "trace", "warn"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );

    const { codes } = await completeNxSession();

    // The sweep is not vacuous: a code WAS published through the production sink
    // inside the spied window, and the projection is holding it.
    expect(codes).toHaveLength(1);
    const code = codes[0]!;
    expect(webE2eeSessionState().verificationCode).toBe(code);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clearStorage).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
    for (const sink of sinks) {
      for (const call of sink.mock.calls) {
        // Every argument, SERIALIZED and not merely `String()`-ed: the code
        // reaching a sink nested in an object is the same disclosure as passing
        // it bare, and `String({ code })` is `[object Object]`.
        expect(call.map(serializedForLeakScan).join(" ")).not.toContain(code);
      }
    }
  });
});

describe("§16.3 F14 — the WebSAS derived in Chromium matches the committed corpus", () => {
  it("reproduces every WebSAS intermediate and rendering byte for byte", () => {
    // §16.4: "A vector that produces different bytes on any supported runtime is
    // a release-blocking defect." The Node gate already runs these; this is the
    // browser half, and it is the runtime that actually draws the string.
    const cases = F14.cases.filter((entry) => entry.name.startsWith("web-sas-session-"));
    expect(cases.length).toBeGreaterThan(0);

    for (const entry of cases) {
      const derived = deriveE2eeWebSas({
        nodeIdentityPublicKey: fixtureBytes(entry.inputs.nodeIdentityPublicKey),
        webEphemeralPublicKey: fixtureBytes(entry.inputs.webEphemeralPublicKey),
        sessionBindingHash: fixtureBytes(entry.inputs.sessionBindingHash),
      });
      expect(hexOf(derived.input), entry.name).toBe(hexOf(fixtureBytes(entry.expected.inputArray)));
      expect(hexOf(derived.prk), entry.name).toBe(hexOf(fixtureBytes(entry.expected.prk)));
      expect(hexOf(derived.output), entry.name).toBe(
        hexOf(fixtureBytes(entry.expected.hkdfOutput)),
      );
      expect(derived.display, entry.name).toBe(entry.expected.display);

      // §3.2.1 S11: the displayed entropy is what the owner actually compares.
      expect(entry.expected.satisfiesS11, entry.name).toBe(true);
      expect(entry.expected.displayedEntropyBits as number, entry.name).toBeGreaterThanOrEqual(
        entry.expected.minimumDisplayedEntropyBits as number,
      );
      expect(E2EE_WEB_SAS_HKDF_BYTES * 8).toBeGreaterThanOrEqual(E2EE_WEB_SAS_MIN_DISPLAYED_BITS);
    }
  });

  it("changes with the session binding, which is why it is per session", () => {
    const displays = F14.cases
      .filter((entry) => entry.name.startsWith("web-sas-session-"))
      .map((entry) => entry.expected.display);
    expect(new Set(displays).size).toBe(displays.length);
    expect(fixtureCase(F14, "web-sas-changes-every-session").expected.differs).toBe(true);
  });
});
