import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { E2EE_SUITE_25519_CHACHAPOLY_SHA256, type E2eeSuiteId } from "@ryco/shared/relayE2eeWire";
import { describe, expect, it } from "vite-plus/test";

import { makeNodeContinuityAnchor } from "./NodeContinuityAnchor.ts";
import {
  makeNodeE2eePolicyClient,
  type NodeE2eeChannelRegistration,
  type NodeE2eePolicyClient,
} from "./NodeE2eePolicyClient.ts";
import {
  e2eePolicyNarrows,
  effectiveNodeE2eePolicy,
  initialNodeE2eePolicyRecord,
  makeNodeE2eePolicyStore,
  nodeE2eeAdmissionPolicyOf,
  type NodeE2eePolicyRecordFile,
  type NodeE2eePolicyStore,
} from "./NodeE2eePolicyStore.ts";

const SUITE = E2EE_SUITE_25519_CHACHAPOLY_SHA256;
/** A suite id this version does not define; only a stub store ever holds one. */
const FUTURE_SUITE = 0x02 as unknown as E2eeSuiteId;

async function open(directory?: string) {
  const root = directory ?? (await mkdtemp(join(tmpdir(), "ryco-e2ee-policy-client-")));
  const anchor = await makeNodeContinuityAnchor({ path: join(root, "anchor.json") });
  const store = await makeNodeE2eePolicyStore({ path: join(root, "e2ee-policy.json"), anchor });
  return { root, anchor, store, client: makeNodeE2eePolicyClient({ store }) };
}

/** An in-memory store with the same commit semantics and no durability. */
function stubStore(): NodeE2eePolicyStore {
  let record: NodeE2eePolicyRecordFile = initialNodeE2eePolicyRecord();
  const apply = (next: NodeE2eePolicyRecordFile) => {
    const previous = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(record));
    const policy = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(next));
    record = next;
    return {
      record: next,
      policy,
      previous,
      withdrawal: e2eePolicyNarrows(previous, policy),
      changed: true,
    };
  };
  return {
    read: async () => ({
      record,
      policy: effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyOf(record)),
    }),
    commit: async (proposal) =>
      apply({
        ...record,
        revision: record.revision + 1,
        generation: record.generation + 1,
        requireE2EE: proposal.requireE2EE ?? record.requireE2EE,
        requireApprovedClientE2EE:
          proposal.requireApprovedClientE2EE ?? record.requireApprovedClientE2EE,
        suiteRegistry: proposal.suiteRegistry ?? record.suiteRegistry,
      }),
    recoverGeneration: async () =>
      apply({ ...record, revision: record.revision + 1, generation: record.generation + 1 }),
  };
}

interface Channel {
  readonly registration: NodeE2eeChannelRegistration;
  readonly events: string[];
}

function legacyChannel(client: NodeE2eePolicyClient, name: string): Channel {
  const events: string[] = [];
  const registration = client.registerChannel();
  const admission = registration.lockLegacy({ close: () => void events.push(`${name}:close`) });
  expect(admission.kind).toBe("entered");
  return { registration, events };
}

function e2eeChannel(
  client: NodeE2eePolicyClient,
  name: string,
  pattern: "IK" | "NX",
  suite: E2eeSuiteId = SUITE,
): Channel {
  const events: string[] = [];
  const registration = client.registerChannel();
  const selected = registration.selectHandshake({
    pattern,
    suite,
    abort: () => void events.push(`${name}:abort`),
  });
  selected.establish({ close: () => void events.push(`${name}:close`) });
  return { registration, events };
}

function inFlight(
  client: NodeE2eePolicyClient,
  name: string,
  pattern: "IK" | "NX",
  suite: E2eeSuiteId = SUITE,
): Channel {
  const events: string[] = [];
  const registration = client.registerChannel();
  registration.selectHandshake({
    pattern,
    suite,
    abort: () => void events.push(`${name}:abort`),
  });
  return { registration, events };
}

describe("node E2EE policy client", () => {
  it("fails closed before it has read the durable policy", async () => {
    const context = await open();
    // An un-started client admits the least, never the most (§12.4).
    expect(context.client.policy().requireE2EE).toBe(true);
    expect(context.client.policy().admittedPatterns).toEqual(["IK"]);
    expect(context.client.generation()).toBe(0);

    await context.client.start();
    expect(context.client.policy().requireE2EE).toBe(false);
  });

  it("applies a configured value at start and leaves an absent one alone", async () => {
    const context = await open();
    const enabled = await context.client.start({ requireE2EE: true });
    expect(enabled.changed).toBe(true);
    expect(enabled.withdrawal).toBe(true);
    // No channel survives a restart, so the startup sweep has nothing to close.
    expect(enabled.counts).toEqual({
      legacy: 0,
      nxE2ee: 0,
      suiteWithdrawn: 0,
      abortedHandshakes: 0,
    });

    // The restart §12.4 is about: a shell without the environment variable.
    const restarted = await open(context.root);
    const after = await restarted.client.start();
    expect(after.changed).toBe(false);
    expect(restarted.client.policy().requireE2EE).toBe(true);
    expect(restarted.client.generation()).toBe(1);

    // An explicit widening is still available — it just has to be explicit.
    const widened = await restarted.client.start({ requireE2EE: false });
    expect(widened.changed).toBe(true);
    expect(widened.withdrawal).toBe(false);
    expect(restarted.client.policy().requireE2EE).toBe(false);
  });

  it("closes exactly what the narrowed policy no longer admits, by class", async () => {
    const context = await open();
    await context.client.start();

    const legacy = legacyChannel(context.client, "legacy");
    const nx = e2eeChannel(context.client, "nx", "NX");
    const ik = e2eeChannel(context.client, "ik", "IK");
    const negotiating = context.client.registerChannel();
    const handshake = inFlight(context.client, "handshake", "NX");

    const preview = context.client.preview({ requireApprovedClientE2EE: true });
    expect(preview.withdrawal).toBe(true);
    expect(preview.counts).toEqual({
      legacy: 1,
      nxE2ee: 1,
      suiteWithdrawn: 0,
      abortedHandshakes: 1,
    });

    const result = await context.client.applyChange({ requireApprovedClientE2EE: true });
    expect(result.withdrawal).toBe(true);
    expect(result.counts).toEqual({
      legacy: 1,
      nxE2ee: 1,
      suiteWithdrawn: 0,
      abortedHandshakes: 1,
    });
    expect(legacy.events).toEqual(["legacy:close"]);
    expect(nx.events).toEqual(["nx:close"]);
    expect(handshake.events).toEqual(["handshake:abort"]);
    // The two §12.6 says survive: an established IK channel, and a channel that
    // has been admitted to nothing yet.
    expect(ik.events).toEqual([]);
    negotiating.release();
  });

  it("closes a withdrawn suite on either tier and counts them together", async () => {
    // Version 1 defines exactly one suite, so a suite-registry reduction cannot
    // be expressed durably — the record refuses an id this binary cannot run,
    // and refuses an empty registry. The sweep's third clause is therefore
    // exercised against a stub store, which is the only way to hand the client a
    // policy whose registry has actually shrunk.
    const client = makeNodeE2eePolicyClient({ store: stubStore() });
    await client.start();
    const ik = e2eeChannel(client, "ik", "IK");
    const nx = e2eeChannel(client, "nx", "NX");

    // Tier-independent by design: an IK channel running a suite the operator
    // will no longer run is running it as much as an NX channel is, and §15 arms
    // no idle deadline in established `e2ee` that would ever retire it.
    const narrowed = await client.applyChange({ suiteRegistry: [FUTURE_SUITE] });
    expect(narrowed.withdrawal).toBe(true);
    expect(narrowed.counts.suiteWithdrawn).toBe(2);
    expect(narrowed.counts.nxE2ee).toBe(0);
    expect(ik.events).toEqual(["ik:close"]);
    expect(nx.events).toEqual(["nx:close"]);
  });

  it("dispatches a channel crossing row N3 mid-sweep exactly once", async () => {
    const context = await open();
    await context.client.start();

    const events: string[] = [];
    // A channel that is on the in-flight list when the snapshot is taken and
    // would cross row N3 while the sweep runs. Two sequential passes would miss
    // it in both — not yet `e2ee` for the first, no longer pre-N3 for the
    // second — which is the failure §12.6 declares normative to prevent.
    const crossing = context.client.registerChannel();
    let admission: string | undefined;
    const selected = crossing.selectHandshake({
      pattern: "NX",
      suite: SUITE,
      abort: async () => {
        events.push("crossing:abort");
        // Row N3 arriving in the middle of the abort, which is exactly the
        // interleaving a two-pass sweep loses.
        const verdict = selected.establish({ close: () => void events.push("crossing:close") });
        admission = verdict.kind === "refused" ? verdict.reason : verdict.kind;
      },
    });
    // A second channel behind it, so the sweep still has work after the crossing.
    const trailing = legacyChannel(context.client, "trailing");

    const result = await context.client.applyChange({ requireApprovedClientE2EE: true });
    expect(events).toEqual(["crossing:abort"]);
    // The registration took the disposition its snapshot phase selected, once.
    expect(result.counts.abortedHandshakes).toBe(1);
    expect(result.counts.nxE2ee).toBe(0);
    // And row N3 re-applied the test against the already committed policy, so
    // the channel is refused rather than admitted and left open behind an
    // acknowledgement that says none is.
    expect(admission).toBe("policy_withdrawn");
    expect(trailing.events).toEqual(["trailing:close"]);
  });

  it("refuses to acknowledge when a close fails, and the retry still sweeps", async () => {
    const context = await open();
    await context.client.start();
    const events: string[] = [];
    const registration = context.client.registerChannel();
    let failNext = true;
    registration.lockLegacy({
      close: () => {
        events.push(failNext ? "first" : "second");
        if (failNext) {
          failNext = false;
          throw new Error("send path gone");
        }
      },
    });

    await expect(context.client.applyChange({ requireE2EE: true })).rejects.toMatchObject({
      code: "policy_sweep_failed",
    });
    // Still registered: §12.6's acknowledgement means no such channel is open,
    // so an operator's retry has to be able to find this one again.
    expect(context.client.preview({}).counts.legacy).toBe(1);

    // The retry. Step (a) has nothing left to commit — the narrowing is already
    // durable — and if that suppressed step (b) the operator would be told the
    // withdrawal took effect while the plaintext channel it exists to close was
    // still open.
    const retried = await context.client.applyChange({ requireE2EE: true });
    expect(retried.changed).toBe(false);
    expect(retried.counts.legacy).toBe(1);
    expect(events).toEqual(["first", "second"]);
    expect(context.client.preview({}).counts.legacy).toBe(0);
  });

  it("refuses a channel that locks legacy after the withdrawal committed", async () => {
    const context = await open();
    await context.client.start();
    // Still `negotiating` when the snapshot was taken, so §12.6 sweeps it —
    // correctly — in neither enumeration. The committed policy has to govern its
    // next input, or it latches into a mode nothing will ever close.
    const negotiating = context.client.registerChannel();
    await context.client.applyChange({ requireE2EE: true });

    const events: string[] = [];
    expect(negotiating.lockLegacy({ close: () => void events.push("close") })).toEqual({
      kind: "refused",
      reason: "policy_withdrawn",
    });
    // Not registered as legacy, so nothing counts it and nothing has to close it.
    expect(context.client.preview({}).counts.legacy).toBe(0);
    expect(events).toEqual([]);
    negotiating.release();
  });

  it("sweeps nothing on a pure widening", async () => {
    const context = await open();
    await context.client.start({ requireE2EE: true });
    const nx = e2eeChannel(context.client, "nx", "NX");
    const result = await context.client.applyChange({ requireE2EE: false });
    expect(result.changed).toBe(true);
    expect(result.withdrawal).toBe(false);
    expect(nx.events).toEqual([]);
  });

  it("offers no row-N3 transition until the handshake selection has completed", async () => {
    const context = await open();
    await context.client.start();
    const registration = context.client.registerChannel();

    // Structural, not defensive. §12.6's row-N3 test reads the channel's pattern
    // and suite, and a transition callable before the selection has fixed them
    // would evaluate it against unset values — an authorization verdict derived
    // from nothing, on a channel that then sits in `e2ee` carrying no pattern
    // for the sweep's NX clause and no suite for its registry clause to see.
    const exposed: Record<string, unknown> = { ...registration };
    expect(exposed.establish).toBeUndefined();

    const events: string[] = [];
    const selected = registration.selectHandshake({
      pattern: "NX",
      suite: SUITE,
      abort: () => void events.push("abort"),
    });
    expect(selected.establish({ close: () => void events.push("close") })).toEqual({
      kind: "entered",
    });
    // The state the sweep reads is the selection's own, so the NX clause names
    // this channel rather than passing over a pattern nothing ever set.
    const result = await context.client.applyChange({ requireApprovedClientE2EE: true });
    expect(result.counts.nxE2ee).toBe(1);
    expect(events).toEqual(["close"]);
  });

  it("does not terminate a registration that left the set after the snapshot", async () => {
    const context = await open();
    await context.client.start();
    const events: string[] = [];

    // The snapshot is a list of objects, not a claim that each is still live.
    // This one's close runs first and, while the sweep is mid-pass, the two
    // entries behind it leave the set: one takes row N3 and is refused there,
    // the other is released by the channel it belongs to.
    const first = context.client.registerChannel();
    first
      .selectHandshake({
        pattern: "NX",
        suite: SUITE,
        abort: () => void events.push("first:abort"),
      })
      .establish({
        close: () => {
          events.push("first:close");
          const verdict = leaving.establish({ close: () => void events.push("leaving:close") });
          events.push(`leaving:${verdict.kind === "refused" ? verdict.reason : verdict.kind}`);
          releasing.registration.release();
        },
      });
    const leaving = context.client.registerChannel().selectHandshake({
      pattern: "NX",
      suite: SUITE,
      abort: () => void events.push("leaving:abort"),
    });
    const releasing = e2eeChannel(context.client, "releasing", "NX");

    const result = await context.client.applyChange({ requireApprovedClientE2EE: true });
    expect(events).toEqual(["first:close", "leaving:policy_withdrawn"]);
    // One channel, one termination, and counts that do not over-report what the
    // §12.6(c) acknowledgement claims.
    expect(result.counts).toEqual({
      legacy: 0,
      nxE2ee: 1,
      suiteWithdrawn: 0,
      abortedHandshakes: 0,
    });
    expect(releasing.events).toEqual([]);
  });

  it("released registrations are not swept", async () => {
    const context = await open();
    await context.client.start();
    const legacy = legacyChannel(context.client, "legacy");
    legacy.registration.release();
    const result = await context.client.applyChange({ requireE2EE: true });
    expect(result.counts.legacy).toBe(0);
    expect(legacy.events).toEqual([]);
  });
});
