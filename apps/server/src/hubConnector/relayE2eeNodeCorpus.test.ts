import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
  E2EE_HANDSHAKE_REJECT_BYTES,
} from "@ryco/shared/relayE2eeConstants";
import { E2EE_ERROR_CODE_POLICY, decodeE2eeErrorRecordBody } from "@ryco/shared/relayE2eeClose";
import {
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  classifyPostStripPayload,
  encodeE2eeHandshakeReject,
} from "@ryco/shared/relayE2eeWire";
import {
  E2EE_CORPUS_CASE_LIVENESS,
  E2EE_CORPUS_DELEGATED_LEAF_READS,
  E2eeCorpusLivenessRecorder,
} from "@ryco/shared/relayE2eeCorpusLiveness";
import type { E2eeNoisePattern } from "@ryco/shared/relayE2eeTranscripts";
import type { E2eeSuiteId } from "@ryco/shared/relayE2eeWire";

import {
  makeNodeE2eePolicyClient,
  type NodeE2eeChannelRegistration,
  type NodeE2eePolicyWithdrawalCounts,
} from "../hubIdentity/NodeE2eePolicyClient.ts";
import {
  e2eePolicyRefusesInFlightHandshake,
  e2eeWithdrawnChannelClass,
  effectiveNodeE2eePolicy,
  type E2eeChannelPolicyState,
  type EffectiveNodeE2eePolicy,
  type NodeE2eeAdmissionPolicy,
  type NodeE2eePolicyProposal,
} from "../hubIdentity/NodeE2eePolicyStore.ts";
import type { NodeE2eeAdvertisementResult } from "../hubIdentity/NodeE2eeCapabilityStatement.ts";
import {
  CHANNEL_ID,
  PERMISSIVE_POLICY,
  REQUIRE_E2EE_POLICY,
  authorizationFor,
  clientSend,
  establish,
  harness,
  limits,
  settle,
  stripPrelude,
  stubPolicyStore,
  utf8,
  type Harness,
} from "./testUtils/nodeE2eeChannelHarness.ts";

// The NODE-SIDE consumer of the §16.3 corpus.
//
// `packages/shared/src/relayE2eeCorpus.test.ts` re-derives every fixture value a
// shared module decides. It cannot reach the node runtime at all — nothing in
// `packages/shared` may depend on an application — so the two families whose
// subject IS the node runtime, §16.3 F10's transition rows and §16.3 F18's
// policy transitions, would otherwise be committed tables that no implementation
// is ever held to. This file is what holds it to them.
//
// WHAT IT PROVES. For every §4.4 node row the corpus carries, the real
// `NodeE2eeChannelSession` — driven through a real `RelayChannelRegistry`, a
// real `RelaySendQueue`, and a really signed §5.2 statement — takes the ACTION
// and reaches the NEXT STATE the fixture states, names the §11 row the fixture
// names, and produces the §11.5 observable the fixture carries byte for byte.
// For every §12.6 transition the corpus carries, the real `NodeE2eePolicyClient`
// runs the real ordered procedure over its real single snapshot and dispatches
// each channel exactly once into the class the fixture states, with the step (c)
// counts the fixture states.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not re-derive the fixture bytes: a
// fixture whose payload is key-dependent — a hello, an accept, an envelope —
// carries the GENERATOR's key material, which cannot verify against the identity
// this harness generates per run. Those rows are driven with a record this
// harness's own client produced, and the case asserts that the record it built
// classifies (§4.3 step 2) the same way the fixture's does, so the input class
// the row turns on is still the fixture's and not this file's opinion. Every
// key-INDEPENDENT payload — legacy JSON, an unknown first byte, the absent
// payload, a framed envelope — goes in as the fixture's own bytes.
//
// THE COVERAGE ASSERTION MATTERS AS MUCH AS THE ROWS. Every `row-n*` and
// `node-deadline-*` case in the corpus must have a driver here, and every driver
// must have a case: a row added to the corpus without a way to reach it on the
// real runtime fails, and so does a driver whose case was deleted.

const FIXTURE_ROOT = new URL("../../../../packages/shared/fixtures/e2ee/v1/", import.meta.url);

interface FixtureCase {
  readonly name: string;
  readonly sections: readonly string[];
  readonly note?: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>>;
}

interface FixtureFamily {
  readonly family: { readonly number: number; readonly title: string };
  readonly cases: readonly FixtureCase[];
}

/**
 * Every family is loaded THROUGH the read-liveness recorder, so the last test in
 * this file can prove that the cases the shared corpus ledger delegates to this
 * suite are actually read here. See `relayE2eeCorpusLiveness.ts`.
 */
const LIVENESS = new E2eeCorpusLivenessRecorder();

function readFamily(name: string): FixtureFamily {
  return LIVENESS.watch(
    name,
    JSON.parse(
      new TextDecoder().decode(readFileSync(new URL(name, FIXTURE_ROOT))),
    ) as FixtureFamily,
  );
}

const F10 = readFamily("f10-mode-machine.json");
const F18 = readFamily("f18-node-admission-policy.json");

/** §16.2: byte strings are `{"$bytes": "<lowercase hex>"}` and nothing else. */
function fixtureBytes(value: unknown): Uint8Array {
  const wrapper = value as { readonly $bytes: string };
  expect(Object.keys(wrapper)).toEqual(["$bytes"]);
  return Uint8Array.from(Buffer.from(wrapper.$bytes, "hex"));
}

function caseByName(family: FixtureFamily, name: string): FixtureCase {
  const found = family.cases.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Fixture case ${name} is missing from the corpus.`);
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════
// §16.3 F10 — the §4.4 node transition rows
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What the runtime did, in the vocabulary §4.4's table uses.
 *
 * `recordsAfterTheTrigger` is measured from the send queue, so "the action
 * emitted one record" is a claim about bytes on the socket rather than about a
 * call this file made.
 */
interface Observed {
  readonly nextState: string;
  /** The node-local §11.4 diagnostic rows, in order. */
  readonly rows: readonly string[];
  readonly deliveredToTheRpcParser: boolean;
  readonly peerLegacyOccurrences: number;
  /** §12.5's other class, as the reason labels the advertiser recorded. */
  readonly advertisementUnavailableOccurrences: readonly string[];
  /** Both §12.5 classes over the CHANNEL's whole life, for row N17's claim. */
  readonly channelOccurrences: Readonly<Record<string, number>>;
  readonly recordsAfterTheTrigger: readonly Uint8Array[];
  readonly closeReasons: readonly (string | undefined)[];
  /** Whether ANY RPC output had reached the parser before this row's input. */
  readonly rpcOutputBeforeThisRow: boolean;
}

/**
 * A snapshot taken immediately before the row's own input, so every observation
 * below is a DELTA.
 *
 * Rows in `legacy` and `e2ee` need a setup that already locked the mode, and
 * that setup records its own occurrence and its own records. A row whose
 * expectation is "this input counts nothing" is a claim about the input, not
 * about the channel's whole history, and measuring absolutes would let a row
 * inherit its neighbour's evidence.
 */
interface Baseline {
  readonly records: number;
  readonly parser: number;
  readonly fallbacks: number;
  readonly advertisementFallbacks: number;
}

function baselineOf(node: Harness): Baseline {
  return {
    records: node.dataPayloads().length,
    parser: node.deliveredToParser.length,
    fallbacks: node.fallbacks(),
    advertisementFallbacks: node.advertisementFallbacks().length,
  };
}

function observe(node: Harness, baseline: Baseline): Observed {
  const before = baseline.records;
  const parserBefore = baseline.parser;
  return {
    nextState: node.session().mode(),
    rows: [...node.rows()],
    deliveredToTheRpcParser: node.deliveredToParser.length > parserBefore,
    peerLegacyOccurrences: node.fallbacks() - baseline.fallbacks,
    advertisementUnavailableOccurrences: node
      .advertisementFallbacks()
      .slice(baseline.advertisementFallbacks),
    channelOccurrences: {
      "peer-legacy": node.fallbacks(),
      "advertisement-unavailable": node.advertisementFallbacks().length,
    },
    recordsAfterTheTrigger: node
      .dataPayloads()
      .slice(before)
      .map((payload) => stripPrelude(payload)),
    closeReasons: node.closeReasons(),
    rpcOutputBeforeThisRow: parserBefore > 0,
  };
}

/** Open an advertising channel and feed it the fixture's own post-strip bytes. */
async function deliverFixturePayload(
  entry: FixtureCase,
  options: Parameters<typeof harness>[0] = {},
): Promise<Observed> {
  const node = await harness(options);
  await node.open();
  const baseline = baselineOf(node);
  await node.deliver(fixtureBytes(entry.inputs.postStripPayload));
  return observe(node, baseline);
}

/** Lock `legacy` first (row N2), then feed the fixture's bytes (rows N12–N14). */
async function deliverIntoLegacy(entry: FixtureCase): Promise<Observed> {
  const node = await harness();
  await node.open();
  await node.deliver(utf8('{"_tag":"Ping"}'));
  expect(node.session().mode()).toBe("legacy");
  const baseline = baselineOf(node);
  await node.deliver(fixtureBytes(entry.inputs.postStripPayload));
  return observe(node, baseline);
}

/** Establish `e2ee` first (row N3), then feed the fixture's bytes (row N11). */
async function deliverIntoE2ee(entry: FixtureCase): Promise<Observed> {
  const node = await harness();
  const advertisement = await node.open();
  await establish(node, "native", advertisement);
  const baseline = baselineOf(node);
  await node.deliver(fixtureBytes(entry.inputs.postStripPayload));
  return observe(node, baseline);
}

/** A node whose §5.5 advertisement is unavailable, for rows N15–N17. */
function unavailableAdvertisement(entry: FixtureCase): Parameters<typeof harness>[0] {
  const guards = entry.inputs.guards as { readonly advertisementUnavailableReason: string };
  return guards.advertisementUnavailableReason === "undersized-connection"
    ? // §5.5 U1: the connection cannot carry a carrier at all.
      { maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1 }
    : // §5.5 U2: this node holds no conforming signed statement.
      {
        readAdvertisement: async (): Promise<NodeE2eeAdvertisementResult> => ({
          kind: "unavailable",
          reason: "signing_failed",
        }),
      };
}

/** How one committed row is reached on the real runtime. */
type F10Driver = (entry: FixtureCase) => Promise<Observed>;

/**
 * The cases of `cases` that carry `field` under `expected`, PINNED to an exact
 * count.
 *
 * The assertions below used to be written `if (expected.someField !== undefined)`
 * or read the field with a `??` default. Both DELETE THEMSELVES when the
 * generator stops emitting the field: nothing fails, the branch simply stops
 * being taken, and the suite reports the same green over a corpus that no longer
 * carries the value. Pinning which cases carry each optional field turns that
 * into a failure, in both directions.
 *
 * `Object.hasOwn` does not read the value, so pinning presence here does not
 * make an unasserted field look live to the corpus liveness census.
 */
function carriers(
  cases: readonly FixtureCase[],
  field: string,
  count: number,
): ReadonlySet<string> {
  const found = cases.filter((entry) => Object.hasOwn(entry.expected, field));
  expect(
    found.length,
    `${String(found.length)} of ${String(cases.length)} cases carry expected.${field}, this suite requires exactly ${String(count)} — update the number in the same commit as the case`,
  ).toBe(count);
  return new Set(found.map((entry) => entry.name));
}

const F10_DRIVERS = new Map<string, F10Driver>([
  [
    "row-n1-legacy-json-under-effective-require-e2ee",
    (entry) => deliverFixturePayload(entry, { policy: () => REQUIRE_E2EE_POLICY }),
  ],
  [
    "row-n2-legacy-json-locks-legacy-and-counts-one-peer-legacy-occurrence",
    (entry) => deliverFixturePayload(entry),
  ],
  [
    "row-n3-client-hello-runs-the-responder-and-enters-e2ee",
    async (entry) => {
      // Key-dependent: the fixture's hello is the generator's, so this run uses
      // a hello built against THIS harness's advertised material. The class the
      // row turns on is still the fixture's.
      expect(classifyPostStripPayload(fixtureBytes(entry.inputs.postStripPayload)).kind).toBe(
        (entry.expected.step2Discrimination as { readonly class: string }).class,
      );
      const node = await harness();
      const advertisement = await node.open();
      const baseline = baselineOf(node);
      await establish(node, "native", advertisement);
      return observe(node, baseline);
    },
  ],
  [
    "row-n4-a-second-hello-on-the-channel",
    async (entry) => {
      // §4.4 admits exactly one handshake attempt per channel, and the guard is
      // reachable in exactly one window: a first hello whose §8.6 step-8 work
      // FAILED, whose failure is answered a turn later. Between the two, the
      // channel is still `negotiating` and its hello is already consumed. Every
      // other arrival order puts the channel in `e2ee`, where a second hello is
      // row N11 instead — which is why this driver reproduces the window rather
      // than delivering two hellos and hoping.
      const dataCapacity = limits.maxQueuedBytes - limits.maxControlFrameBytes;
      let node: Harness | undefined;
      let second: Observed | undefined;
      const secondHello = fixtureBytes(entry.inputs.postStripPayload);
      node = await harness({
        afterPrekeyBorrow: async () => {
          if (second !== undefined || node === undefined) return;
          // The reject the row owes needs room; holding the budget through it
          // would test §11.2's "no record when the node is not writable"
          // instead of the row this case is about.
          node.sendQueue.releaseReservation(CHANNEL_ID, dataCapacity);
          expect(node.session().mode(), "still negotiating").toBe("negotiating");
          const baseline = baselineOf(node);
          const disposition = await node.session().intercept(secondHello);
          expect(disposition.kind).toBe("rejected");
          node.flush();
          second = observe(node, baseline);
        },
      });
      const advertisement = await node.open();
      // Every byte of the connection's data budget, so the accept cannot be
      // enqueued at all and row N3 is left untaken (§11.4 `queue_full`).
      expect(node.sendQueue.reserveData(CHANNEL_ID, dataCapacity)).toBe(true);
      await establish(node, "native", advertisement).catch(() => undefined);
      if (second === undefined) throw new Error("the second hello never reached the machine");
      return second;
    },
  ],
  [
    "row-n4-a-hello-with-no-advertisement-emitted",
    async (entry) => {
      const node = await harness({
        readAdvertisement: async (): Promise<NodeE2eeAdvertisementResult> => ({
          kind: "unavailable",
          reason: "signing_failed",
        }),
      });
      await node.openRaw();
      await settle();
      const baseline = baselineOf(node);
      await node.deliver(fixtureBytes(entry.inputs.postStripPayload));
      return observe(node, baseline);
    },
  ],
  [
    "row-n5-a-misdirected-negotiation-record-in-negotiating",
    (entry) => deliverFixturePayload(entry),
  ],
  ["row-n6-an-envelope-before-establishment", (entry) => deliverFixturePayload(entry)],
  ["row-n7-an-unknown-first-byte-in-negotiating", (entry) => deliverFixturePayload(entry)],
  ["row-n7-an-absent-first-byte-in-negotiating", (entry) => deliverFixturePayload(entry)],
  [
    "row-n8-the-handshake-deadline-under-effective-require-e2ee",
    async () => {
      const node = await harness({ policy: () => REQUIRE_E2EE_POLICY });
      await node.open();
      const baseline = baselineOf(node);
      expect(await node.expireHandshakeDeadline()).toBe(true);
      return observe(node, baseline);
    },
  ],
  [
    "row-n9-an-authenticated-envelope-is-delivered-to-the-rpc-parser",
    async (entry) => {
      expect(classifyPostStripPayload(fixtureBytes(entry.inputs.postStripPayload)).kind).toBe(
        (entry.expected.step2Discrimination as { readonly class: string }).class,
      );
      const node = await harness();
      const advertisement = await node.open();
      const client = await establish(node, "native", advertisement);
      const baseline = baselineOf(node);
      await clientSend(node, client, E2EE_INNER_TYPE_RPC, utf8('{"_tag":"ryco.rpc.request"}'));
      return observe(node, baseline);
    },
  ],
  [
    "row-n10-an-envelope-failing-a-step-3-check",
    async () => {
      const node = await harness();
      const advertisement = await node.open();
      const client = await establish(node, "native", advertisement);
      // Protect a record, then flip one ciphertext bit before it is delivered —
      // the same corruption the fixture's payload carries, applied to a record
      // this session's own keys produced.
      let envelope: Uint8Array | undefined;
      await client.record.protect({
        innerType: E2EE_INNER_TYPE_RPC,
        body: utf8('{"_tag":"ryco.rpc.request"}'),
        admit: () => true,
        transmit: (bytes) => {
          envelope = Uint8Array.from(bytes);
          return { kind: "sent" };
        },
      });
      if (envelope === undefined) throw new Error("the client protected nothing");
      const last = envelope.byteLength - 1;
      envelope.set([envelope[last]! ^ 0x01], last);
      const baseline = baselineOf(node);
      await node.deliver(envelope);
      return observe(node, baseline);
    },
  ],
  ["row-n11-legacy-json-after-e2ee", (entry) => deliverIntoE2ee(entry)],
  ["row-n11-a-negotiation-record-after-e2ee", (entry) => deliverIntoE2ee(entry)],
  ["row-n11-an-absent-first-byte-after-e2ee", (entry) => deliverIntoE2ee(entry)],
  ["row-n12-legacy-json-in-legacy", (entry) => deliverIntoLegacy(entry)],
  ["row-n13-an-envelope-in-legacy", (entry) => deliverIntoLegacy(entry)],
  ["row-n13-a-negotiation-record-in-legacy", (entry) => deliverIntoLegacy(entry)],
  ["row-n14-an-unknown-first-byte-in-legacy", (entry) => deliverIntoLegacy(entry)],
  [
    "row-n15-an-undersized-connection-under-effective-require-e2ee",
    (entry) => openUnadvertised(entry, REQUIRE_E2EE_POLICY),
  ],
  [
    "row-n15-no-conforming-statement-under-effective-require-e2ee",
    (entry) => openUnadvertised(entry, REQUIRE_E2EE_POLICY),
  ],
  [
    "row-n16-an-undersized-connection-under-the-compatibility-default",
    (entry) => openUnadvertised(entry, PERMISSIVE_POLICY),
  ],
  [
    "row-n16-no-conforming-statement-under-the-compatibility-default",
    (entry) => openUnadvertised(entry, PERMISSIVE_POLICY),
  ],
  [
    "row-n17-legacy-json-on-a-channel-that-never-advertised",
    async (entry) => {
      // Row N16 ran first and recorded the channel's ONE occurrence, in the
      // advertisement-unavailable class. This row must not add a second.
      const node = await harness({
        maxDataChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES - 1,
      });
      await node.openRaw();
      await settle();
      expect(node.session().mode()).toBe("negotiating");
      // Row N16 has run by now, so its occurrence is already recorded. The
      // baseline is what makes the row-N17 claim — "adds nothing on top" — a
      // measurement of THIS input rather than of the channel's history.
      expect(node.advertisementFallbacks()).toEqual(["undersized-connection"]);
      const baseline = baselineOf(node);
      await node.deliver(fixtureBytes(entry.inputs.postStripPayload));
      return observe(node, baseline);
    },
  ],
  [
    "node-deadline-n8-does-not-fire-under-the-compatibility-default",
    async () => {
      const node = await harness();
      await node.open();
      const baseline = baselineOf(node);
      expect(await node.expireHandshakeDeadline()).toBe(true);
      return observe(node, baseline);
    },
  ],
  [
    "node-deadline-after-row-n3-is-q8-under-effective-require-e2ee",
    () => expireAfterRowN3(REQUIRE_E2EE_POLICY),
  ],
  [
    "node-deadline-after-row-n3-is-q8-under-the-compatibility-default",
    () => expireAfterRowN3(PERMISSIVE_POLICY),
  ],
]);

/** Rows N15 and N16: a channel whose §5.5 advertisement cannot be produced. */
async function openUnadvertised(
  entry: FixtureCase,
  policy: typeof PERMISSIVE_POLICY,
): Promise<Observed> {
  const node = await harness({ policy: () => policy, ...unavailableAdvertisement(entry) });
  const baseline: Baseline = {
    records: 0,
    parser: node.deliveredToParser.length,
    fallbacks: 0,
    advertisementFallbacks: 0,
  };
  await node.openRaw();
  await settle();
  node.flush();
  return observe(node, baseline);
}

/** §8.9: the same deadline expiring between row N3 and the authenticated finish. */
async function expireAfterRowN3(policy: typeof PERMISSIVE_POLICY): Promise<Observed> {
  const node = await harness({ policy: () => policy });
  const advertisement = await node.open();
  await establish(node, "native", advertisement);
  expect(node.session().mode()).toBe("e2ee");
  const baseline = baselineOf(node);
  expect(await node.expireHandshakeDeadline()).toBe(true);
  return observe(node, baseline);
}

/** The §4.4 states, as the fixture spells them versus as the session reports them. */
function expectedMode(nextState: string): string {
  return nextState === "negotiating (no advertisement)" ? "negotiating" : nextState;
}

const NODE_ROW_CASES = F10.cases.filter((entry) => /^(?:row-n\d|node-deadline-)/.test(entry.name));

/** The optional `expected` fields of the node rows, and exactly who carries them. */
const ROW_CARRIERS = {
  deliveredToTheRpcParser: carriers(NODE_ROW_CASES, "deliveredToTheRpcParser", 22),
  rpcOutputBeforeTheImplicitFinish: carriers(NODE_ROW_CASES, "rpcOutputBeforeTheImplicitFinish", 2),
  recordsOnTheWire: carriers(NODE_ROW_CASES, "recordsOnTheWire", 1),
  channelStaysOpen: carriers(NODE_ROW_CASES, "channelStaysOpen", 1),
  peerLegacyOccurrenceAddedOnTopOfN16: carriers(
    NODE_ROW_CASES,
    "peerLegacyOccurrenceAddedOnTopOfN16",
    1,
  ),
} as const;

// ─── the §4.4 ACTION column, against what the runtime actually did ───────────
//
// §16.3 F10 asks each row for "input payload bytes and state, expected action
// and next state". Three of those four were driven; `action` was checked for
// being a string, so a row could name a different disposition — `FATAL-POST` on
// a pre-key row, "deliver to the RPC parser" on a row that delivers nothing —
// and every suite stayed green. That is a column of the §4.4 table that no
// implementation was held to.
//
// It is held to it here as a CLOSED VOCABULARY of clauses, each with a
// predicate over the observed run, checked in BOTH directions: every clause a
// row states must hold, and every clause that holds must be stated. So a clause
// swapped for another fails, a clause deleted fails, a clause invented fails
// (it is in no vocabulary entry), and a row whose action omits something the
// runtime did fails too. The clause texts are §4.4's own words; the predicates
// are measurements of the send queue, the parser, the §12.5 counters and the
// session's mode, never of another fixture field.
interface ActionClause {
  readonly text: string;
  readonly holds: (observed: Observed, entry: FixtureCase) => boolean;
}

/** Whether the row's own input is the connection-level one rows N15–N17 take. */
function isConnectionLevelInput(entry: FixtureCase): boolean {
  const input = entry.inputs.input as { readonly class?: string } | undefined;
  return input?.class === "channel.accept";
}

function closedByTheRow(observed: Observed): boolean {
  return observed.closeReasons.length > 0;
}

function emittedTheGenericReject(observed: Observed): boolean {
  const first = observed.recordsAfterTheTrigger[0];
  return first !== undefined && Buffer.from(first).equals(encodeE2eeHandshakeReject());
}

function fatalPre(observed: Observed): boolean {
  return closedByTheRow(observed) && emittedTheGenericReject(observed);
}

function fatalPost(observed: Observed): boolean {
  return closedByTheRow(observed) && !emittedTheGenericReject(observed);
}

/**
 * Row N3's accept: a negotiation record the row put on the wire that is NOT the
 * generic reject — which is itself a negotiation record, and is what every
 * FATAL-PRE row emits.
 */
function emittedAnAccept(observed: Observed): boolean {
  return (
    observed.nextState === "e2ee" &&
    observed.recordsAfterTheTrigger.some(
      (record) =>
        classifyPostStripPayload(record).kind === "negotiation" &&
        !Buffer.from(record).equals(encodeE2eeHandshakeReject()),
    )
  );
}

function suppressedItsAdvertisement(observed: Observed): boolean {
  return (
    observed.advertisementUnavailableOccurrences.length === 1 &&
    observed.recordsAfterTheTrigger.length === 0
  );
}

const ACTION_CLAUSES: readonly ActionClause[] = [
  // The two dispositions, told apart by the record on the wire rather than by
  // the fixture's own `disposition`: FATAL-PRE is the generic fixed-size reject
  // (§11.5), FATAL-POST is the protected error record, and §11.2's anti-oracle
  // rule is what makes the two distinguishable here and nowhere else.
  { text: "FATAL-PRE", holds: (o, e) => fatalPre(o) && !isConnectionLevelInput(e) },
  {
    // Rows N15's own wording. The tail is not decoration: it says the row is
    // taken at `channel.accept`, before a carrier exists and before any peer
    // input, which is what makes it a property of the CONNECTION.
    text: "FATAL-PRE, before any carrier is built and before any peer input",
    holds: (o, e) => fatalPre(o) && isConnectionLevelInput(e),
  },
  { text: "FATAL-POST", holds: (o) => fatalPost(o) },
  // Row N2/N17: the lock is a transition INTO `legacy`, not a channel that was
  // already there — rows N12–N14 run in `legacy` and lock nothing.
  {
    text: "lock legacy",
    holds: (o, e) =>
      o.nextState === "legacy" && (e.inputs.state as string | undefined) !== "legacy",
  },
  {
    text: "count one peer-legacy fallback occurrence",
    holds: (o) => o.peerLegacyOccurrences === 1,
  },
  {
    text: "deliver to the RPC parser",
    holds: (o) => o.deliveredToTheRpcParser && o.nextState !== "e2ee",
  },
  { text: "run the §8.6 responder handshake", holds: (o) => emittedAnAccept(o) },
  { text: "on success emit `E2EEServerAccept`", holds: (o) => emittedAnAccept(o) },
  {
    text: "deliver the authenticated inner record",
    holds: (o) => o.deliveredToTheRpcParser && o.nextState === "e2ee",
  },
  {
    text: "complete the §8.9 implicit client finish",
    holds: (o) => o.deliveredToTheRpcParser && o.nextState === "e2ee",
  },
  { text: "suppress the advertisement", holds: (o) => suppressedItsAdvertisement(o) },
  {
    text: "record exactly one advertisement-unavailable occurrence",
    holds: (o) => suppressedItsAdvertisement(o),
  },
  { text: "emit no carrier", holds: (o) => suppressedItsAdvertisement(o) },
  {
    // The deadline that does not fire: nothing moved at all.
    text: "no transition",
    holds: (o, e) =>
      !closedByTheRow(o) &&
      o.nextState === expectedMode((e.inputs.state as string | undefined) ?? o.nextState) &&
      o.recordsAfterTheTrigger.length === 0 &&
      !o.deliveredToTheRpcParser &&
      o.peerLegacyOccurrences === 0 &&
      o.advertisementUnavailableOccurrences.length === 0,
  },
];

function expectActionMatchesTheRun(entry: FixtureCase, observed: Observed): void {
  const action = entry.expected.action;
  expect(typeof action, `${entry.name}: every §4.4 row states an action`).toBe("string");
  const stated = (action as string).split("; ");
  for (const clause of stated) {
    const known = ACTION_CLAUSES.find((candidate) => candidate.text === clause);
    expect(known, `${entry.name}: "${clause}" is not a §4.4 action clause`).toBeDefined();
  }
  const held = ACTION_CLAUSES.filter((clause) => clause.holds(observed, entry)).map(
    (clause) => clause.text,
  );
  // Both directions at once: the stated clauses are exactly the clauses the run
  // satisfied, in the order the vocabulary lists them.
  expect(
    stated.toSorted(),
    `${entry.name}: the action the corpus states is not the action the runtime took`,
  ).toEqual(held.toSorted());
}

describe("§16.3 F10 node transition rows against the real §4.4 mode machine", () => {
  it("has a driver for every committed node row, and a row for every driver", () => {
    // Without this, a row added to the corpus could sit there asserting an
    // outcome nothing ever produced — which is the exact failure the corpus
    // exists to prevent, reintroduced one level up.
    const committed = NODE_ROW_CASES.map((entry) => entry.name).toSorted();
    expect([...F10_DRIVERS.keys()].toSorted()).toEqual(committed);
  });

  it("carries one case for every §4.4 node row N1–N17", () => {
    const rows = new Set(
      NODE_ROW_CASES.map((entry) => (entry.inputs as { readonly row?: string }).row).filter(
        (row): row is string => row !== undefined,
      ),
    );
    for (let row = 1; row <= 17; row += 1) {
      expect(rows.has(`N${String(row)}`), `row N${String(row)}`).toBe(true);
    }
  });

  for (const entry of NODE_ROW_CASES) {
    it(`takes ${entry.name} exactly as the corpus states it`, async () => {
      const drive = F10_DRIVERS.get(entry.name);
      if (drive === undefined) throw new Error(`no driver for ${entry.name}`);
      const observed = await drive(entry);
      const expected = entry.expected;

      expect(observed.nextState, "next state").toBe(expectedMode(expected.nextState as string));
      // A row that states nothing here delivers nothing; WHICH rows state it is
      // pinned, so the `?? false` cannot silently become the whole assertion.
      expect(observed.deliveredToTheRpcParser, "delivered to the RPC parser").toBe(
        ROW_CARRIERS.deliveredToTheRpcParser.has(entry.name)
          ? expected.deliveredToTheRpcParser
          : false,
      );
      // The §4.4 ACTION column, clause by clause, against this run.
      expectActionMatchesTheRun(entry, observed);
      // §8.9's implicit finish: no RPC output may precede it, and "precede" is
      // measurable — it is the parser's own count at the moment this row's input
      // arrived. The field was carried on rows N3 and N9 and read by nothing.
      if (ROW_CARRIERS.rpcOutputBeforeTheImplicitFinish.has(entry.name)) {
        expect(expected.rpcOutputBeforeTheImplicitFinish, entry.name).toBe(
          observed.rpcOutputBeforeThisRow,
        );
      }
      // The deadline cases state the §11 row directly rather than in `fatal`,
      // and `null` there is the claim that the timer changed nothing.
      if (entry.name.startsWith("node-deadline-")) {
        expect(expected.row, `${entry.name}: the §11 row`).toBe(observed.rows[0] ?? null);
      }
      if (ROW_CARRIERS.recordsOnTheWire.has(entry.name)) {
        expect(expected.recordsOnTheWire, entry.name).toBe(observed.recordsAfterTheTrigger.length);
      }
      if (ROW_CARRIERS.channelStaysOpen.has(entry.name)) {
        expect(expected.channelStaysOpen, entry.name).toBe(observed.closeReasons.length === 0);
      }

      // The §11 row the node enumerated, from its own node-local diagnostic.
      // `expected.row` is the §4.4 ROW (N1–N17) on the transition cases and the
      // §11.3 row on the deadline cases, so the §11 row is `fatal` wherever the
      // case has one — including when it is explicitly null, which is the whole
      // claim of a non-fatal row.
      const fatal = ("fatal" in expected ? expected.fatal : expected.row) as string | null;
      if (fatal === null) {
        expect(observed.rows, "no §11 row").toEqual([]);
      } else {
        expect(observed.rows, "the §11 row").toEqual([fatal]);
      }

      switch (expected.disposition) {
        case "FATAL-PRE": {
          // §11.5, byte for byte: exactly one generic fixed-size reject, one
          // `channel_rejected`, and zero application payload.
          const observable = expected.observable as {
            readonly handshakeRejectRecords: number;
            readonly handshakeRejectBytes: number;
            readonly closeReason: string;
            readonly handshakeReject: unknown;
          };
          expect(observed.recordsAfterTheTrigger).toHaveLength(observable.handshakeRejectRecords);
          const reject = observed.recordsAfterTheTrigger[0]!;
          expect(reject).toHaveLength(observable.handshakeRejectBytes);
          expect(reject).toHaveLength(E2EE_HANDSHAKE_REJECT_BYTES);
          expect(reject).toEqual(fixtureBytes(observable.handshakeReject));
          expect(reject).toEqual(encodeE2eeHandshakeReject());
          expect(observed.closeReasons).toEqual([observable.closeReason]);
          break;
        }
        case "FATAL-POST": {
          // One encrypted record, and a close reason §11.1 does not extend.
          expect(observed.recordsAfterTheTrigger).toHaveLength(
            expected.errorRecordsOnTheWire as number,
          );
          expect(observed.closeReasons).toEqual([expected.closeReason]);
          // It is NOT a reject: a FATAL-POST row that emitted the pre-key record
          // would be indistinguishable from a channel that never established.
          expect(observed.recordsAfterTheTrigger[0]).not.toEqual(encodeE2eeHandshakeReject());
          break;
        }
        default: {
          // A non-fatal row emits no §11 record of either kind and leaves the
          // channel open.
          expect(observed.closeReasons).toEqual([]);
          break;
        }
      }

      // §12.5, in BOTH classes and never as one number. The two counters are
      // read separately because they are two facts about two different parties,
      // and a row that stated one class must be shown not to have moved the
      // other — which is the whole reason §12.5 splits them.
      const occurrence = expected.fallbackOccurrence as
        | { readonly class: string; readonly reason?: string; readonly count: number }
        | null
        | undefined;
      const peerLegacy =
        occurrence !== null && occurrence !== undefined && occurrence.class === "peer-legacy"
          ? occurrence.count
          : 0;
      const advertisementUnavailable =
        occurrence !== null &&
        occurrence !== undefined &&
        occurrence.class === "advertisement-unavailable"
          ? occurrence.count
          : 0;
      expect(observed.peerLegacyOccurrences, "§12.5 peer-legacy occurrences").toBe(peerLegacy);
      expect(
        observed.advertisementUnavailableOccurrences,
        "§12.5 advertisement-unavailable occurrences",
      ).toHaveLength(advertisementUnavailable);
      if (advertisementUnavailable > 0) {
        // §12.5 makes the reason label part of the occurrence: `undersized-connection`
        // for §5.5 U1 and `statement-unavailable` for U2. A row that recorded the
        // right count under the wrong label would misreport which condition fired.
        expect(observed.advertisementUnavailableOccurrences).toEqual([
          (entry.inputs.guards as { readonly advertisementUnavailableReason: string })
            .advertisementUnavailableReason,
        ]);
      }
      if (ROW_CARRIERS.peerLegacyOccurrenceAddedOnTopOfN16.has(entry.name)) {
        expect(observed.peerLegacyOccurrences).toBe(
          expected.peerLegacyOccurrenceAddedOnTopOfN16 as number,
        );
      }
      // Row N17's own claim, over the whole channel rather than over this input:
      // the channel's ONE occurrence is N16's, in the advertisement-unavailable
      // class, and nothing was added to either class on top of it.
      const forThisChannel = expected.fallbackOccurrencesForThisChannel as
        | Readonly<Record<string, number>>
        | undefined;
      if (forThisChannel !== undefined) {
        expect(observed.channelOccurrences, "§12.5 occurrences for this channel").toEqual(
          forThisChannel,
        );
      }
    });
  }

  it("keeps every FATAL-PRE row's observable identical across causes", () => {
    // §11.2's anti-oracle rule, read off the corpus rather than re-derived: every
    // pre-key row of this family carries the SAME observable object, so a future
    // edit that varied a record count or a close reason by cause fails here as
    // well as in the shared consuming test.
    const observables = NODE_ROW_CASES.filter(
      (entry) => entry.expected.disposition === "FATAL-PRE",
    ).map((entry) => JSON.stringify(entry.expected.observable));
    expect(observables.length).toBeGreaterThan(5);
    expect(new Set(observables).size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §16.3 F18 — the §12.6 policy transitions
// ═══════════════════════════════════════════════════════════════════════════

interface FixturePolicy {
  readonly requireE2EE: boolean;
  readonly requireApprovedClientE2EE: boolean;
  readonly suiteRegistry: readonly number[];
  readonly effectiveAdmittedPatterns: readonly string[];
}

interface FixtureChannel {
  readonly id: string;
  readonly mode: "legacy" | "e2ee" | "in_flight" | "negotiating";
  readonly pattern: string | null;
  readonly suite: number | null;
}

interface FixturePerChannel {
  readonly id: string;
  readonly withdrawn: boolean;
  readonly class: string | null;
}

function admissionOf(policy: FixturePolicy): NodeE2eeAdmissionPolicy {
  return {
    mode: policy.requireApprovedClientE2EE
      ? "require-locally-approved-native-e2ee"
      : policy.requireE2EE
        ? "require-e2ee"
        : "compatibility",
    requireE2EE: policy.requireE2EE,
    requireApprovedClientE2EE: policy.requireApprovedClientE2EE,
    suiteRegistry: policy.suiteRegistry as readonly E2eeSuiteId[],
  };
}

interface SweepOutcome {
  readonly counts: NodeE2eePolicyWithdrawalCounts;
  readonly withdrawal: boolean;
  readonly generationBefore: number;
  readonly generationAfter: number;
  /** Channel ids the sweep closed, in the order it closed them. */
  readonly closed: readonly string[];
  /** Channel ids the sweep aborted as in-flight handshakes. */
  readonly aborted: readonly string[];
  readonly admittedPatternsAfter: readonly string[];
  readonly effectiveRequireE2EEAfter: boolean;
  /** The advertised policy now in force, for the case's own `policyAfter`. */
  readonly advertisedAfter: NodeE2eeAdmissionPolicy;
}

/**
 * The advertised policy a case's command leaves behind, as the real store
 * merges it — the operand every `policyAfter` assertion below is checked
 * against, and the operand the reference walk runs its per-channel test under.
 */
function policyAfterCommand(
  before: FixturePolicy,
  command: NodeE2eePolicyProposal,
): EffectiveNodeE2eePolicy {
  const base = admissionOf(before);
  const requireE2EE = command.requireE2EE ?? base.requireE2EE;
  const requireApprovedClientE2EE =
    command.requireApprovedClientE2EE ?? base.requireApprovedClientE2EE;
  return effectiveNodeE2eePolicy({
    mode:
      command.mode ??
      (requireApprovedClientE2EE
        ? "require-locally-approved-native-e2ee"
        : requireE2EE
          ? "require-e2ee"
          : "compatibility"),
    requireE2EE,
    requireApprovedClientE2EE,
    suiteRegistry: command.suiteRegistry ?? base.suiteRegistry,
  });
}

/** The two enumerations §12.6(b) names, as a case's `enumerationOrderAttempted`. */
type Enumeration = "live-channels" | "in-flight-handshakes";

const COUNTED_IN: ReadonlyMap<string, keyof NodeE2eePolicyWithdrawalCounts> = new Map([
  ["legacy", "legacy"],
  ["nx_e2ee", "nxE2ee"],
  ["suite_withdrawn", "suiteWithdrawn"],
  ["handshake", "abortedHandshakes"],
]);

/**
 * §12.6(b) as its TWO enumerations, walked in a stated order over ONE frozen
 * snapshot.
 *
 * This is the shape §12.6 describes — "the live-channel set and the §15
 * in-flight handshake list" — rather than the shape the runtime happens to hold
 * it in, and it exists so a case's `enumerationOrderAttempted` DRIVES something
 * instead of labelling two runs that were identical. The snapshot is frozen
 * before the first pass, so an entry's phase cannot change between them; each
 * entry is claimed by the first enumeration whose test names it and skipped by
 * the second. A conforming procedure is therefore invariant under the order,
 * and that invariance is what the race pair asserts rather than assumes.
 */
function referenceSweep(
  snapshot: readonly { readonly id: string; readonly state: E2eeChannelPolicyState }[],
  policy: EffectiveNodeE2eePolicy,
  order: readonly Enumeration[],
): readonly { readonly id: string; readonly class: string; readonly by: Enumeration }[] {
  const dispatched = new Map<string, { id: string; class: string; by: Enumeration }>();
  for (const enumeration of order) {
    for (const entry of snapshot) {
      if (dispatched.has(entry.id)) continue;
      if (enumeration === "live-channels") {
        const withdrawn = e2eeWithdrawnChannelClass(entry.state, policy);
        if (withdrawn !== undefined) {
          dispatched.set(entry.id, { id: entry.id, class: withdrawn, by: enumeration });
        }
        continue;
      }
      if (e2eePolicyRefusesInFlightHandshake(entry.state, policy)) {
        dispatched.set(entry.id, { id: entry.id, class: "handshake", by: enumeration });
      }
    }
  }
  return [...dispatched.values()];
}

/**
 * Run one §16.3 F18 case through the real `NodeE2eePolicyClient`.
 *
 * The channels are real registrations taking the real phase transitions —
 * `lockLegacy` for row N2, `selectHandshake` for §8.6 step 2, and `established`
 * for the second half of row N3 — so the snapshot the sweep walks is the one the
 * production code builds, not a shape assembled for the test.
 */
async function runPolicyCase(entry: FixtureCase): Promise<SweepOutcome> {
  const client = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
  const before = entry.inputs.policyBefore as FixturePolicy;
  await client.start(admissionOf(before));
  expect(client.policy().suiteRegistry).toEqual(before.suiteRegistry);

  const closed: string[] = [];
  const aborted: string[] = [];
  const registrations: NodeE2eeChannelRegistration[] = [];
  const channels = (entry.inputs.channels ?? []) as readonly FixtureChannel[];
  for (const channel of channels) {
    const registration = client.registerChannel();
    registrations.push(registration);
    if (channel.mode === "legacy") {
      const admitted = registration.lockLegacy({
        close: () => {
          closed.push(channel.id);
        },
      });
      expect(admitted.kind, channel.id).toBe("entered");
      continue;
    }
    if (channel.mode === "negotiating") continue;
    const selected = registration.selectHandshake({
      pattern: channel.pattern as E2eeNoisePattern,
      suite: channel.suite as E2eeSuiteId,
      abort: () => {
        aborted.push(channel.id);
      },
    });
    if (channel.mode === "in_flight") continue;
    const admitted = selected.establish({
      close: () => {
        closed.push(channel.id);
      },
    });
    if (admitted.kind !== "entered") throw new Error(`${channel.id} was not admitted`);
    // The second half of row N3, in the same synchronous turn as the test that
    // returned it — which is the contract `established` states.
    admitted.established();
  }

  const generationBefore = client.generation();
  const result = await client.applyChange(entry.inputs.command as NodeE2eePolicyProposal);
  return {
    counts: result.counts,
    withdrawal: result.withdrawal,
    generationBefore,
    generationAfter: client.generation(),
    closed,
    aborted,
    admittedPatternsAfter: [...client.policy().admittedPatterns],
    effectiveRequireE2EEAfter: client.policy().requireE2EE,
    advertisedAfter: client.policy().advertised,
  };
}

const F18_TRANSITION_CASES = F18.cases.filter(
  (entry) => Array.isArray(entry.inputs.channels) && entry.inputs.command !== undefined,
);

/** The optional `expected` fields of the F18 transitions, and exactly who carries them. */
const F18_CARRIERS = {
  policyGenerationAfter: carriers(F18_TRANSITION_CASES, "policyGenerationAfter", 6),
  policyAfter: carriers(F18_TRANSITION_CASES, "policyAfter", 6),
  effectiveRequireE2EEAfter: carriers(F18_TRANSITION_CASES, "effectiveRequireE2EEAfter", 1),
  eachChannelDispatchedExactlyOnce: carriers(
    F18_TRANSITION_CASES,
    "eachChannelDispatchedExactlyOnce",
    1,
  ),
} as const;

describe("§16.3 F18 policy transitions against the real §12.6 procedure", () => {
  it("carries the transition cases the family is about", () => {
    expect(F18_TRANSITION_CASES.length).toBeGreaterThanOrEqual(8);
  });

  for (const entry of F18_TRANSITION_CASES) {
    it(`applies ${entry.name} exactly as the corpus states it`, async () => {
      const outcome = await runPolicyCase(entry);
      const expected = entry.expected;

      expect(outcome.withdrawal, "is a withdrawal").toBe(expected.isWithdrawal as boolean);
      expect(outcome.counts, "the §12.6 step (c) counts").toEqual(expected.counts);

      // §5.7: the generation advances on every committed change, withdrawal or
      // widening. The fixture's numbers are illustrative; the invariant is the
      // delta, and the fixture's own pair has to satisfy it too.
      expect(outcome.generationAfter - outcome.generationBefore).toBe(1);
      if (F18_CARRIERS.policyGenerationAfter.has(entry.name)) {
        expect(
          (expected.policyGenerationAfter as number) -
            (entry.inputs.policyGenerationBefore as number),
        ).toBe(1);
      }

      // §16.3 F18 asks each case to state the policy the command leaves behind,
      // and ALL FOUR of its fields are checked against the policy the real store
      // now holds. Only `effectiveAdmittedPatterns` used to be: the two booleans
      // and the suite registry were free, so a case could state a registry the
      // command never wrote — beside a per-channel suite verdict computed from
      // the registry that was actually in force.
      if (F18_CARRIERS.policyAfter.has(entry.name)) {
        const after = expected.policyAfter as FixturePolicy;
        expect(outcome.admittedPatternsAfter, "element 14 after").toEqual(
          after.effectiveAdmittedPatterns,
        );
        expect(outcome.advertisedAfter.requireE2EE, "advertised requireE2EE after").toBe(
          after.requireE2EE,
        );
        expect(
          outcome.advertisedAfter.requireApprovedClientE2EE,
          "advertised requireApprovedClientE2EE after",
        ).toBe(after.requireApprovedClientE2EE);
        expect(outcome.advertisedAfter.suiteRegistry, "suite registry after").toEqual(
          after.suiteRegistry,
        );
      }
      if (F18_CARRIERS.effectiveRequireE2EEAfter.has(entry.name)) {
        expect(outcome.effectiveRequireE2EEAfter).toBe(expected.effectiveRequireE2EEAfter);
      }

      // Every channel dispatched exactly once, into the class the fixture names.
      const perChannel = expected.perChannel as readonly FixturePerChannel[];
      const terminated = [...outcome.closed, ...outcome.aborted];
      expect(new Set(terminated).size, "each channel dispatched at most once").toBe(
        terminated.length,
      );
      if (F18_CARRIERS.eachChannelDispatchedExactlyOnce.has(entry.name)) {
        // The claim §12.6(b) exists to make, measured on the run that made it.
        expect(expected.eachChannelDispatchedExactlyOnce, entry.name).toBe(
          new Set(terminated).size === terminated.length,
        );
      }
      for (const channel of perChannel) {
        if (!channel.withdrawn) {
          expect(terminated, `${channel.id} survives`).not.toContain(channel.id);
          continue;
        }
        expect(
          channel.class === "handshake" ? outcome.aborted : outcome.closed,
          `${channel.id} is ${String(channel.class)}`,
        ).toContain(channel.id);
      }
      expect(terminated.length, "every termination is accounted for").toBe(
        perChannel.filter((channel) => channel.withdrawn).length,
      );
    });
  }

  it("runs the row-N3 race to the same outcome in both enumeration orders", async () => {
    // §12.6 step (b)'s single-snapshot rule. The registration IS the snapshot
    // entry, so the two "enumerations" cannot be attempted in an order at all —
    // which is the construction that makes the race unrepresentable. This asserts
    // the property the fixture states: exactly one outcome, from the disjunction
    // the corpus carries, and the same one whichever way the case is set up.
    const cases = F18.cases.filter((entry) => entry.name.startsWith("the-row-n3-race-"));
    expect(cases).toHaveLength(2);
    const outcomes: string[] = [];
    for (const entry of cases) {
      const permitted = entry.expected.outcomeIsOneOf as readonly {
        readonly reachedRowN3: boolean;
        readonly countedIn: string;
      }[];
      const client = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
      await client.start({
        requireE2EE: false,
        requireApprovedClientE2EE: false,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      });
      const registration = client.registerChannel();
      let aborts = 0;
      let closes = 0;
      const selected = registration.selectHandshake({
        pattern: "NX",
        suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        abort: () => {
          aborts += 1;
        },
      });
      // Row N3 lands concurrently with the sweep: the transition is taken while
      // the change is in flight, which is exactly the window §8.6 step 2's
      // atomicity rule and this rule exist to close.
      const change = client.applyChange({ requireApprovedClientE2EE: true });
      const admitted = selected.establish({
        close: () => {
          closes += 1;
        },
      });
      if (admitted.kind === "entered") admitted.established();
      const result = await change;
      expect(aborts + closes, "dispatched exactly once").toBe(1);
      const counted = result.counts.abortedHandshakes === 1 ? "abortedHandshakes" : "nxE2ee";
      expect(permitted.map((option) => option.countedIn)).toContain(counted);
      expect(result.counts.legacy + result.counts.suiteWithdrawn, "no other class claimed it").toBe(
        0,
      );
      outcomes.push(counted);
    }
    expect(new Set(outcomes).size, "the same outcome in both orders").toBe(1);
  });

  it("attempts the row-N3 race's two enumerations in the order each case states", async () => {
    // WHAT WAS WRONG. The pair above drives the race twice through the real
    // client, and the real client holds one registration per channel — so the
    // two "enumerations" have no order to attempt, and the two cases were the
    // same run performed twice. `enumerationOrderAttempted` drove nothing:
    // reversing a case's order, or setting both cases to the same order, changed
    // no assertion. The one input that distinguishes the pair was decoration.
    //
    // WHAT IS DONE HERE. §12.6(b) is walked as the two enumerations it names,
    // in the order the case states, over ONE snapshot frozen before the first
    // pass — with the real per-channel and in-flight tests, not restatements of
    // them. Each case runs in ITS OWN order; the pair's claim is then that the
    // two orders reach the same dispatch, which is `sameOutcomeInBothEnumeration-
    // Orders` measured rather than asserted. An implementation that ran two
    // independent passes over two lists would lose the channel in one order and
    // not the other, and that is exactly what this construction can now see.
    const cases = F18.cases.filter((entry) => entry.name.startsWith("the-row-n3-race-"));
    expect(cases).toHaveLength(2);
    const orders = cases.map((entry) => entry.inputs.enumerationOrderAttempted as Enumeration[]);
    // Both cases attempt the same two enumerations, and no two the same way.
    for (const order of orders) {
      expect(order.toSorted()).toEqual(["in-flight-handshakes", "live-channels"]);
    }
    expect(new Set(orders.map((order) => order.join(" then "))).size, "two orders").toBe(2);

    const perOrder = new Map<string, string>();
    for (const [index, entry] of cases.entries()) {
      const order = orders[index]!;
      const racing = entry.inputs.racingChannel as {
        readonly id: string;
        readonly pattern: string;
        readonly suite: number;
      };
      const policy = policyAfterCommand(
        entry.inputs.policyBefore as FixturePolicy,
        entry.inputs.command as NodeE2eePolicyProposal,
      );
      const permitted = entry.expected.outcomeIsOneOf as readonly {
        readonly reachedRowN3: boolean;
        readonly row: string;
        readonly disposition: string;
        readonly countedIn: string;
      }[];
      // The disjunction is over the phase the snapshot froze, and it is exactly
      // two: the transition had landed, or it had not. Nothing else is a phase
      // this channel can be frozen in.
      expect(permitted.map((option) => option.reachedRowN3)).toEqual([true, false]);
      for (const option of permitted) {
        const state: E2eeChannelPolicyState = {
          phase: option.reachedRowN3 ? "e2ee" : "in_flight",
          pattern: racing.pattern as E2eeNoisePattern,
          suite: racing.suite as E2eeSuiteId,
        };
        const dispatched = referenceSweep([{ id: racing.id, state }], policy, order);
        const where = `${entry.name} (${order.join(" then ")}, reachedRowN3=${String(option.reachedRowN3)})`;
        // Accounted for exactly once, and never left open.
        expect(dispatched, where).toHaveLength(1);
        expect(entry.expected.dispatchedExactlyOnce, where).toBe(dispatched.length === 1);
        expect(entry.expected.leftOpen, where).toBe(dispatched.length === 0);
        expect(entry.expected.totalChannelsAccountedFor, where).toBe(1);
        // …in the class the option names, counted where §12.6(c) counts it, and
        // by the enumeration whose test claims that phase.
        expect(COUNTED_IN.get(dispatched[0]!.class), where).toBe(option.countedIn);
        expect(dispatched[0]!.by, where).toBe(
          option.reachedRowN3 ? "live-channels" : "in-flight-handshakes",
        );
        // §11: an established channel closes post-key as `Q12`; a handshake that
        // never reached row N3 holds no keys and aborts pre-key as `P25`.
        expect(option.row, where).toBe(option.reachedRowN3 ? "Q12" : "P25");
        expect(option.disposition, where).toBe(option.reachedRowN3 ? "FATAL-POST" : "FATAL-PRE");
        const key = `reachedRowN3=${String(option.reachedRowN3)}`;
        const seen = perOrder.get(key);
        if (seen !== undefined) {
          expect(entry.expected.sameOutcomeInBothEnumerationOrders, key).toBe(
            seen === option.countedIn,
          );
          expect(entry.expected.oneConsistentSnapshot, key).toBe(seen === option.countedIn);
        }
        perOrder.set(key, option.countedIn);
      }
      expect(entry.expected.sameOutcomeInBothEnumerationOrders, entry.name).toBe(true);
      expect(entry.expected.oneConsistentSnapshot, entry.name).toBe(true);
    }
  });

  it("closes a swept legacy channel with no record of any kind", async () => {
    // §12.6(b) and the fixture's `handshakeRejectEmitted: false`. A `legacy`
    // channel holds no session keys, so there is nothing to encrypt — and in
    // particular the node MUST NOT send an `E2EEHandshakeReject`, which is a
    // negotiation record and would be row K21 at the peer.
    const expected = caseByName(
      F18,
      "require-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    ).expected;
    expect(expected.handshakeRejectOnTheLegacyChannel).toBe(false);

    const client = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
    await client.start({
      requireE2EE: false,
      requireApprovedClientE2EE: false,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    });
    const node = await harness({
      policy: () => client.policy(),
      registration: () => client.registerChannel(),
    });
    await node.open();
    await node.deliver(utf8('{"_tag":"Ping"}'));
    expect(node.session().mode()).toBe("legacy");

    const before = node.dataPayloads().length;
    const result = await client.applyChange({ requireE2EE: true });
    await settle();
    node.flush();

    expect(result.counts).toEqual({
      legacy: 1,
      nxE2ee: 0,
      suiteWithdrawn: 0,
      abortedHandshakes: 0,
    });
    expect(node.dataPayloads().slice(before), "no record at all").toEqual([]);
    expect(node.closeReasons()).toEqual(["channel_rejected"]);
    expect(node.session().mode()).toBe("closed");
    // §12.5: the sweep is an operator action, so it adds no fallback occurrence
    // on top of the one row N2 recorded when the channel locked.
    expect(node.fallbacks()).toBe(1);
  });

  it("closes a swept NX e2ee channel as Q12 with code policy and one error record", async () => {
    // The other half of the same command, on a channel that DOES hold keys.
    const expected = caseByName(
      F18,
      "require-approved-client-e2ee-false-to-true-over-a-legacy-an-nx-and-an-ik-channel",
    ).expected;
    const nx = (expected.perChannel as readonly Record<string, unknown>[]).find(
      (channel) => channel.id === "ch-nx",
    )!;
    expect(nx.row).toBe("Q12");
    expect(nx.errorCode).toBe(E2EE_ERROR_CODE_POLICY);

    const client = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
    await client.start({
      requireE2EE: false,
      requireApprovedClientE2EE: false,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    });
    const node = await harness({
      policy: () => client.policy(),
      registration: () => client.registerChannel(),
      // NX carries no Branch A record, so §12.4's node policy is what reaches it.
      authorization: authorizationFor(undefined),
    });
    const advertisement = await node.open();
    const client2 = await establish(node, "web", advertisement);

    const before = node.dataPayloads().length;
    const result = await client.applyChange({ requireApprovedClientE2EE: true });
    await settle();
    node.flush();

    expect(result.counts.nxE2ee).toBe(1);
    const emitted = node.dataPayloads().slice(before);
    expect(emitted, "exactly one encrypted record").toHaveLength(
      nx.errorRecordsOnTheWire as number,
    );
    const error = client2.record.unprotect(stripPrelude(emitted[0]!));
    if (error.kind !== "authenticated") throw new Error("expected an authenticated error record");
    expect(error.innerType).toBe(E2EE_INNER_TYPE_ERROR);
    const body = decodeE2eeErrorRecordBody(error.body);
    if (body.kind !== "ok") throw new Error("expected a conforming error body");
    expect(body.value.errorCode).toBe(E2EE_ERROR_CODE_POLICY);
    expect(node.rows()).toEqual(["Q12"]);
    expect(node.closeReasons()).toEqual([nx.closeReason]);
    expect(node.fallbacks(), "§12.5: a withdrawal records no fallback occurrence").toBe(0);
  });

  it("leaves an IK channel open under the same command and closes it when its suite goes", async () => {
    // The two halves §12.6 states by tier, on one runtime. The
    // `requireApprovedClientE2EE` narrowing reaches no IK channel; the suite
    // narrowing reaches it despite an unchanged `approved` record.
    const commands: readonly {
      readonly command: NodeE2eePolicyProposal;
      readonly suiteWithdrawn: number;
      readonly staysOpen: boolean;
    }[] = [
      { command: { requireApprovedClientE2EE: true }, suiteWithdrawn: 0, staysOpen: true },
      {
        command: {
          suiteRegistry: [(E2EE_SUITE_25519_CHACHAPOLY_SHA256 + 1) as E2eeSuiteId],
        },
        suiteWithdrawn: 1,
        staysOpen: false,
      },
    ];
    for (const { command, suiteWithdrawn, staysOpen } of commands) {
      const client = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
      await client.start({
        requireE2EE: false,
        requireApprovedClientE2EE: false,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      });
      const node = await harness({
        policy: () => client.policy(),
        registration: () => client.registerChannel(),
      });
      const advertisement = await node.open();
      await establish(node, "native", advertisement);
      expect(node.session().mode()).toBe("e2ee");

      const result = await client.applyChange(command);
      await settle();
      node.flush();

      expect(result.counts.suiteWithdrawn).toBe(suiteWithdrawn);
      expect(node.session().mode()).toBe(staysOpen ? "e2ee" : "closed");
    }
  });

  it("refuses a hello that reaches §8.6 step 2 after the durable commit", async () => {
    // §12.6's ordering, end to end: the commit lands first, so the hello reads
    // the narrowed policy at step 2 and is refused there — `P9`, not `P25`.
    const ordering = caseByName(
      F18,
      "a-hello-reaching-step-2-after-the-durable-commit-is-refused-there",
    );
    const expected = ordering.expected;
    expect(expected.row).toBe("P9");
    expect(expected.disposition, "a §11.2 row is pre-key").toBe("FATAL-PRE");

    const client = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
    await client.start(admissionOf(ordering.inputs.policyBefore as FixturePolicy));
    const node = await harness({
      policy: () => client.policy(),
      registration: () => client.registerChannel(),
      authorization: authorizationFor(undefined),
    });
    const advertisement = await node.open();
    const result = await client.applyChange(ordering.inputs.command as NodeE2eePolicyProposal);
    expect(result.counts.abortedHandshakes, "nothing was in flight yet").toBe(0);
    // §12.6's ordering IS this: the policy the hello meets at step 2 is the
    // committed one, in every field. The case states it, so the case is held to
    // the policy the store now holds rather than to a block nobody read.
    const atStepTwo = expected.policyReadAtStepTwo as FixturePolicy;
    expect(client.policy().advertised.requireE2EE).toBe(atStepTwo.requireE2EE);
    expect(client.policy().advertised.requireApprovedClientE2EE).toBe(
      atStepTwo.requireApprovedClientE2EE,
    );
    expect(client.policy().advertised.suiteRegistry).toEqual(atStepTwo.suiteRegistry);
    expect(client.policy().admittedPatterns).toEqual(atStepTwo.effectiveAdmittedPatterns);
    expect(client.policy().admittedPatterns).toEqual(expected.admittedPatternsAtStepTwo);

    const before = node.dataPayloads().length;
    await establish(node, ordering.inputs.helloTier as "web" | "native", advertisement).catch(
      () => undefined,
    );
    expect(node.rows()).toEqual([expected.row]);
    const emitted = node.dataPayloads().slice(before);
    expect(emitted).toHaveLength(1);
    expect(stripPrelude(emitted[0]!)).toEqual(encodeE2eeHandshakeReject());
    expect(node.session().mode()).toBe("closed");
    // The two claims the case makes about what did NOT happen, each measured:
    // the hello was not admitted, and no channel came up behind the sweep.
    expect(expected.helloAdmitted).toBe(node.session().mode() === "e2ee");
    expect(expected.channelEstablishedBehindTheSweep).toBe(node.deliveredToParser.length > 0);
    expect(node.deliveredToParser, "no channel established behind the sweep").toHaveLength(0);
    // The sweep itself closed nothing: it ran before this channel reached step 2.
    expect(result.counts, "the §12.6 step (c) counts of the command itself").toEqual(
      expected.counts,
    );
  });

  it("leaves a negotiating channel unswept and then fails it closed on its next input", async () => {
    // §12.6's `negotiating` bullet, BOTH halves. The generic per-case test above
    // covers only the first — the channel is in no `perChannel` termination — and
    // the second half is the one that makes the first safe: a channel §12.6
    // deliberately does not touch must be governed by the committed policy at its
    // NEXT input, or "not swept" would mean "left admitted under the old policy".
    //
    // Every field here is driven rather than read: the row comes from the node's
    // own §11.4 diagnostic, "fails closed" is the channel actually closing, and
    // "not swept" is the sweep's own counts plus the channel still being open
    // when the command returns. A fixture that stated the wrong row, or claimed
    // the channel was swept, or claimed it did not fail closed, fails here.
    const cases = F18.cases.filter((entry) =>
      entry.name.startsWith("a-negotiating-channel-is-not-swept-"),
    );
    expect(cases).toHaveLength(2);
    for (const entry of cases) {
      const before = entry.inputs.policyBefore as FixturePolicy;
      const next = entry.inputs.nextInputAfterTheCommand as {
        readonly class: string;
        readonly tier?: string;
      };
      const expected = entry.expected;

      const client = makeNodeE2eePolicyClient({ store: stubPolicyStore() });
      await client.start(admissionOf(before));
      const node = await harness({
        policy: () => client.policy(),
        registration: () => client.registerChannel(),
        // NX carries no Branch A record, so §12.4's node policy is what decides
        // the refused hello rather than an authorization lookup.
        authorization: authorizationFor(undefined),
      });
      const advertisement = await node.open();
      expect(node.session().mode(), entry.name).toBe("negotiating");

      const result = await client.applyChange(entry.inputs.command as NodeE2eePolicyProposal);
      await settle();
      node.flush();

      expect(result.withdrawal, entry.name).toBe(expected.isWithdrawal as boolean);
      // Not swept: no class claimed it, and it is still open afterwards.
      expect(expected.sweptByTheWithdrawal, entry.name).toBe(false);
      expect(result.counts, entry.name).toEqual(expected.counts);
      expect(node.session().mode(), `${entry.name}: survives the sweep`).toBe("negotiating");
      expect(node.closeReasons(), `${entry.name}: not closed by the sweep`).toEqual([]);

      const recordsBefore = node.dataPayloads().length;
      if (next.class === "LEGACY-JSON") {
        await node.deliver(utf8('{"_tag":"Ping"}'));
      } else {
        await establish(node, next.tier as "web" | "native", advertisement).catch(() => undefined);
      }
      node.flush();

      const observable = expected.observable as {
        readonly handshakeRejectRecords: number;
        readonly handshakeRejectBytes: number;
        readonly closeReason: string;
        readonly handshakeReject: unknown;
      };
      expect(node.rows(), `${entry.name}: the §11 row of the next input`).toEqual([
        expected.nextInputRow,
      ]);
      expect(expected.nextInputDisposition, entry.name).toBe("FATAL-PRE");
      expect(expected.failsClosed, entry.name).toBe(true);
      expect(node.session().mode(), `${entry.name}: fails closed`).toBe("closed");
      const emitted = node.dataPayloads().slice(recordsBefore).map(stripPrelude);
      expect(emitted, entry.name).toHaveLength(observable.handshakeRejectRecords);
      expect(emitted[0], entry.name).toEqual(fixtureBytes(observable.handshakeReject));
      expect(emitted[0], entry.name).toEqual(encodeE2eeHandshakeReject());
      expect(node.closeReasons(), entry.name).toEqual([observable.closeReason]);
      // §12.5: neither the sweep nor a fail-closed refusal is a legacy
      // acceptance, so no occurrence of either class was recorded.
      expect(node.fallbacks(), `${entry.name}: no peer-legacy occurrence`).toBe(0);
      expect(
        node.advertisementFallbacks(),
        `${entry.name}: no advertisement-unavailable occurrence`,
      ).toEqual([]);
      expect(expected.noFallbackOccurrenceRecorded, entry.name).toEqual({
        "peer-legacy": 0,
        "advertisement-unavailable": 0,
      });
    }
  });

  it("keeps the pre-key observable of a P25 abort identical to every other cause", () => {
    const abort = caseByName(F18, "in-flight-handshake-aborted-by-a-policy-withdrawal").expected;
    const observable = abort.observable as {
      readonly handshakeReject: unknown;
      readonly handshakeRejectBytes: number;
    };
    expect(fixtureBytes(observable.handshakeReject)).toEqual(encodeE2eeHandshakeReject());
    expect(observable.handshakeRejectBytes).toBe(E2EE_HANDSHAKE_REJECT_BYTES);
    expect(abort.row).toBe("P25");
    expect(abort.errorCodeEmitted).toBeNull();
    // …and it is the same record every FATAL-PRE row of F10 carries, which is
    // what makes the §12.6 abort indistinguishable from any other pre-key cause.
    const anyRow = NODE_ROW_CASES.find((entry) => entry.expected.disposition === "FATAL-PRE")!;
    expect(JSON.stringify((anyRow.expected.observable as object) ?? null)).toBe(
      JSON.stringify(abort.observable),
    );
  });
});

describe("§16.3 corpus liveness, node half", () => {
  it("discharges the corpus liveness claims this suite is named in", () => {
    // The shared suite's `E2EE_CORPUS_CASE_LIVENESS` table says which committed
    // cases the SHARED consumer does not read and who reads them instead. The
    // entries naming this suite are unverifiable over there — a different
    // process, a different package — so they are verified here, against what
    // this run actually touched. A case delegated to the node suite and read by
    // nothing fails HERE, which is the only place it can.
    // (a) the recorder is wired at all — without this the checks below would be
    // satisfied by a suite that reads nothing. The consumed set is DERIVED from
    // the recorder rather than hardcoded, so a family this suite starts reading
    // is covered by (c) without anyone remembering to extend a list.
    const consumed = LIVENESS.census();
    expect(consumed.length, "the recorder was handed no family at all").toBeGreaterThan(0);
    for (const family of consumed) {
      expect(family.liveCases, `${family.file}: this suite read nothing at all`).toBeGreaterThan(0);
    }
    // (b) every case the shared table delegates HERE is read here. The table is
    // an exception list, so this set is usually empty — but an empty loop that
    // nobody notices is how a delegation quietly stops being discharged, and
    // the check costs nothing.
    for (const claim of E2EE_CORPUS_CASE_LIVENESS.filter((one) => one.reader === "node")) {
      expect(
        LIVENESS.liveLeafCount(claim.file, claim.case),
        `${claim.file}: ${claim.case} is delegated to the node suite and read by nothing in it`,
      ).toBeGreaterThan(0);
    }
    // (c) and no case declared DECORATIVE is actually read here. A decorative
    // entry says NOTHING asserts the case; this suite is one of the places that
    // claim could be wrong, and it is the only place that can tell.
    //
    // THIS USED TO BE SCOPED TO A HARDCODED TWO-FILE LIST, which meant a case
    // declared decorative in any other family was skipped here rather than
    // checked — vacuously true today because this suite reads only two families,
    // and silently wrong the moment it reads a third. Every decorative claim is
    // now checked, whatever family it names: the recorder answers 0 for a family
    // this suite never opened, so an unread family passes for the right reason.
    for (const claim of E2EE_CORPUS_CASE_LIVENESS.filter((one) => one.reader === "decorative")) {
      expect(
        LIVENESS.liveLeafCount(claim.file, claim.case),
        `${claim.file}: ${claim.case} is declared decorative and this suite reads it — reclassify it`,
      ).toBe(0);
    }
  });

  it("states which families it consumes, so a new one is a deliberate edit", () => {
    // Kept as its own test rather than folded into the checks above: those are
    // written against whatever the recorder was handed, and this is the one
    // place the SET is pinned. Reading a third family here is legitimate and
    // changes what the corpus census attributes to this suite, so it should
    // cost one line in the same commit.
    expect(LIVENESS.watchedFiles().toSorted()).toEqual([
      "f10-mode-machine.json",
      "f18-node-admission-policy.json",
    ]);
  });

  it("reads every leaf the census attributes to this suite", () => {
    // The shared suite computes the census's cross-suite UNION from
    // `E2EE_CORPUS_DELEGATED_LEAF_READS`, which claims — leaf path by leaf path
    // — that THIS suite reads things the shared one does not. Over there that
    // table is only checked for being real leaves and disjoint from what the
    // shared suite reads; nothing there can tell whether this suite reads them.
    // Without this check the union could be inflated with any path at all and
    // the published live count would rise to match.
    const mine = E2EE_CORPUS_DELEGATED_LEAF_READS.filter((entry) => entry.reader === "node");
    expect(mine.length, "the attribution delegates nothing to this suite").toBeGreaterThan(0);
    for (const entry of mine) {
      const read = new Set(LIVENESS.liveLeafPaths(entry.file, entry.case));
      for (const path of entry.paths) {
        expect(
          read.has(path),
          `${entry.file}: ${entry.case}.${path} is counted live because this suite is said to read it, and this suite does not`,
        ).toBe(true);
      }
    }
  });
});
