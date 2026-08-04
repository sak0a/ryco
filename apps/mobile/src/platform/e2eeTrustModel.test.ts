import type { NodeE2eeCapabilityVerification } from "@ryco/shared/relayE2eeCapabilityVerify";
import type { NodeE2eeCapabilityStatement } from "@ryco/shared/relayE2eeTranscripts";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyE2eeTrustSnapshot,
  e2eeUnexpectedNodeResolutions,
  resolveE2eeTrustStatementOutcome,
  resolveE2eeUnexpectedNodeSituation,
  snapshotE2eeContinuityIdResolution,
  snapshotE2eeSelection,
  tightenE2eeTrustClassification,
  type E2eeLoadedTrustState,
  type E2eeTrustClassification,
  type E2eeTrustRecord,
  type E2eeTrustSelection,
  type E2eeUnverifiedPinRecord,
  type E2eeVerifiedPinRecord,
} from "./e2eeTrustModel";

const HUB = "https://hub.example.com";
const OTHER_HUB = "https://other.example.com";
const ACCOUNT = "acct_0123456789";
const OTHER_ACCOUNT = "acct_9876543210";
const HANDLE = "handle-a";

function verified(overrides: {
  readonly hubOrigin?: string;
  readonly accountId?: string;
  readonly localNodeHandle?: string;
  readonly latched?: "set" | "unset";
  readonly consented?: boolean;
  readonly continuityId?: string;
  readonly nodeIdHints?: readonly string[];
}): E2eeVerifiedPinRecord {
  return {
    index: {
      hubOrigin: overrides.hubOrigin ?? HUB,
      accountId: overrides.accountId ?? ACCOUNT,
      localNodeHandle: overrides.localNodeHandle ?? HANDLE,
    },
    nodeIdHints: overrides.nodeIdHints ?? [],
    legacyConsent:
      overrides.consented === true ? { kind: "recorded", recordedAt: 5 } : { kind: "absent" },
    environmentId: null,
    state: "verified",
    verifiedFingerprint: "SHA256:aaaa",
    verifiedIdentityPublicKey: new Uint8Array(32).fill(7),
    recordedContinuityId: overrides.continuityId ?? "continuity-1",
    acceptedPolicyGeneration: 3,
    latch: overrides.latched === "set" ? { kind: "set", setAt: 1 } : { kind: "unset" },
    approval: { clientIdentityFingerprint: "SHA256:cccc", approvedAt: 1 },
  };
}

function unverified(overrides: {
  readonly localNodeHandle?: string;
  readonly consented?: boolean;
  readonly nodeIdHints?: readonly string[];
}): E2eeUnverifiedPinRecord {
  return {
    index: {
      hubOrigin: HUB,
      accountId: ACCOUNT,
      localNodeHandle: overrides.localNodeHandle ?? HANDLE,
    },
    nodeIdHints: overrides.nodeIdHints ?? [],
    legacyConsent:
      overrides.consented === true ? { kind: "recorded", recordedAt: 7 } : { kind: "absent" },
    environmentId: null,
    state: "unverified",
  };
}

function state(
  records: readonly E2eeTrustRecord[],
  markerOrigins: readonly string[] = [],
): E2eeLoadedTrustState {
  return { records, verifiedMarkerOrigins: new Set(markerOrigins) };
}

function byHandle(handle = HANDLE, accountId = ACCOUNT): E2eeTrustSelection {
  return { kind: "handle", hubOrigin: HUB, accountId, localNodeHandle: handle };
}

function classify(
  loaded: E2eeLoadedTrustState | null,
  selection: E2eeTrustSelection,
): E2eeTrustClassification {
  return classifyE2eeTrustSnapshot(snapshotE2eeSelection(loaded, selection));
}

describe("§12.1.1 classification", () => {
  it("classifies a resolved latched pin as latched, whatever else the device holds", () => {
    const loaded = state([verified({ latched: "set", consented: true })], [HUB]);

    expect(classify(loaded, byHandle())).toEqual({ class: "latched" });
  });

  it("takes legacy-eligible branch (a) only when the pair and the marker are both empty", () => {
    // §12.1.1 branch (a): no pin resolves, the pair holds no verified pin, AND
    // `anyNodeVerified(hubOrigin)` is unset.
    expect(classify(state([]), byHandle())).toEqual({ class: "legacy-eligible", branch: "a" });

    // Clause (ii): the pair holds a verified pin under another handle.
    expect(classify(state([verified({ localNodeHandle: "other" })]), byHandle())).toEqual({
      class: "unexpected",
      clause: "ii",
    });

    // Clause (iii): the account holds none, but the marker is set on the origin.
    expect(classify(state([], [HUB]), byHandle())).toEqual({
      class: "unexpected",
      clause: "iii",
    });
  });

  it("reads the marker under the Hub origin alone, never under the pair", () => {
    // The account-remint variant: a verified pin under one account scope, a
    // selection under another. §12.1.1 says this "lands in **unexpected** (rows
    // K23/K24)" precisely because the marker is not pair-keyed.
    const loaded = state([verified({ accountId: OTHER_ACCOUNT })], [HUB]);

    expect(classify(loaded, byHandle(HANDLE, ACCOUNT))).toEqual({
      class: "unexpected",
      clause: "iii",
    });
    // And a marker on a different origin cannot reach this one.
    expect(classify(state([], [OTHER_HUB]), byHandle())).toEqual({
      class: "legacy-eligible",
      branch: "a",
    });
  });

  it("classifies a selection resolving to an unverified record as unexpected", () => {
    // §13.1: "§12.1.1 classifies a selection that resolves to it as _unexpected_
    // unless that consent is present — §12.1.1's branch (a) cannot apply, because
    // a pin did resolve."
    expect(classify(state([unverified({})]), byHandle())).toEqual({
      class: "unexpected",
      clause: "i",
      record: "unverified",
      scope: { kind: "fresh" },
    });
    expect(classify(state([unverified({ consented: true })]), byHandle())).toEqual({
      class: "legacy-eligible",
      branch: "b",
    });
  });

  it("classifies a resolved but unlatched verified pin as unexpected without consent", () => {
    expect(classify(state([verified({ latched: "unset" })], [HUB]), byHandle())).toEqual({
      class: "unexpected",
      clause: "i",
      record: "verified",
      scope: { kind: "account-verified" },
    });
    expect(
      classify(state([verified({ latched: "unset", consented: true })], [HUB]), byHandle()),
    ).toEqual({ class: "legacy-eligible", branch: "b" });
  });

  it("carries what the pair and the origin hold onto a resolved selection", () => {
    // §5.2 and §13.2.1 situations 2 and 3 are decided by this scope, and a
    // resolution does not answer it: the pairing record §13.2 step 2 writes for a
    // SECOND node resolves, and the first node's verified pin is exactly what
    // §13.2.1 requires the surface to display beside the newly presented one.
    expect(
      classify(state([unverified({}), verified({ localNodeHandle: "first" })], [HUB]), byHandle()),
    ).toEqual({
      class: "unexpected",
      clause: "i",
      record: "unverified",
      scope: { kind: "account-verified" },
    });
    // And under a second account scope on a Hub origin the device has verified:
    // §12.1.1's account re-mint, with a record that resolves.
    expect(
      classify(
        state([unverified({}), verified({ accountId: OTHER_ACCOUNT })], [HUB]),
        byHandle(HANDLE, ACCOUNT),
      ),
    ).toEqual({
      class: "unexpected",
      clause: "i",
      record: "unverified",
      scope: { kind: "origin-verified" },
    });
  });

  it("never lets a node-id hint carry the owner's consent past the device's own state", () => {
    // §11.2: "No Hub-supplied value may move a selection _into_ the
    // legacy-eligible class: not the `nodeId`, which the Hub re-mints at will."
    // §12.1.1's safety argument for a hint covers a resolution to a PIN — a wrong
    // pin cannot authenticate — and a recorded consent needs no statement at all:
    // the Hub withholds the carrier and row K13 flushes the buffered plaintext.
    const byHint: E2eeTrustSelection = {
      kind: "node-id-hint",
      hubOrigin: HUB,
      accountId: ACCOUNT,
      nodeId: "node-2",
    };
    const latchedAndConsented = state(
      [
        verified({ latched: "set", localNodeHandle: "a", nodeIdHints: ["node-1"] }),
        unverified({ localNodeHandle: "b", consented: true, nodeIdHints: ["node-2"] }),
      ],
      [HUB],
    );

    expect(classify(latchedAndConsented, byHint)).toEqual({
      class: "unexpected",
      clause: "i",
      record: "unverified",
      scope: { kind: "account-verified" },
    });
    // The owner's own handle is client-anchored, so it carries the consent it was
    // recorded against.
    expect(classify(latchedAndConsented, byHandle("b"))).toEqual({
      class: "legacy-eligible",
      branch: "b",
    });
    // And where the device's own state reaches legacy-eligible without the hint,
    // the hint moves nothing: branch (b) is the honest answer, not a downgrade.
    expect(
      classify(state([unverified({ consented: true, nodeIdHints: ["node-2"] })]), byHint),
    ).toEqual({ class: "legacy-eligible", branch: "b" });
  });

  it("classifies a not-yet-completed load as unexpected, never as unset state", () => {
    // The cold-start trap: §4.4 forbids treating unobtainable evidence as an
    // unset latch or an unset marker, so a selection that WOULD be latched must
    // not fall to legacy on the first channel after a restart.
    expect(classify(null, byHandle())).toEqual({ class: "unexpected", clause: "unobtainable" });
  });

  it("resolves a hint only when exactly one record carries it", () => {
    const selection: E2eeTrustSelection = {
      kind: "node-id-hint",
      hubOrigin: HUB,
      accountId: ACCOUNT,
      nodeId: "node-1",
    };

    expect(
      classify(state([verified({ latched: "set", nodeIdHints: ["node-1"] })], [HUB]), selection),
    ).toEqual({ class: "latched" });

    // A Hub that withholds the hint produces no resolution, which is unexpected
    // and never legacy-eligible.
    expect(classify(state([verified({ latched: "set" })], [HUB]), selection)).toEqual({
      class: "unexpected",
      clause: "ii",
    });

    // Two records claiming one Hub-minted id is a state only the Hub can produce;
    // picking either would let it choose which strict guard applies.
    const ambiguous = state(
      [
        verified({ latched: "set", localNodeHandle: "a", nodeIdHints: ["node-1"] }),
        verified({ latched: "set", localNodeHandle: "b", nodeIdHints: ["node-1"] }),
      ],
      [HUB],
    );
    expect(classify(ambiguous, selection)).toEqual({ class: "unexpected", clause: "ii" });
  });

  it("never lets a Hub-supplied value move a selection into legacy-eligible", () => {
    // Every input a Hub controls — the node id, the account scope, and whether a
    // hint resolves at all — over a device that holds one latched pin.
    const loaded = state([verified({ latched: "set", nodeIdHints: ["node-1"] })], [HUB]);
    const hostile: readonly E2eeTrustSelection[] = [
      { kind: "node-id-hint", hubOrigin: HUB, accountId: ACCOUNT, nodeId: "node-2" },
      { kind: "node-id-hint", hubOrigin: HUB, accountId: OTHER_ACCOUNT, nodeId: "node-1" },
      { kind: "handle", hubOrigin: HUB, accountId: OTHER_ACCOUNT, localNodeHandle: HANDLE },
      { kind: "handle", hubOrigin: HUB, accountId: ACCOUNT, localNodeHandle: "invented" },
    ];

    for (const selection of hostile) {
      expect(classify(loaded, selection).class).toBe("unexpected");
    }
  });
});

describe("§12.1.1 late continuity-id resolution", () => {
  const loaded = state([verified({ latched: "set", continuityId: "continuity-1" })], [HUB]);

  it("tightens an unresolved selection to the latched pin it names", () => {
    const initial = classify(state([], [HUB]), byHandle("unknown"));
    const late = classifyE2eeTrustSnapshot(
      snapshotE2eeContinuityIdResolution(loaded, {
        hubOrigin: HUB,
        accountId: ACCOUNT,
        continuityId: "continuity-1",
      }),
    );

    expect(tightenE2eeTrustClassification(initial, late)).toEqual({ class: "latched" });
  });

  it("never loosens, for any pair of classes", () => {
    const classes: readonly E2eeTrustClassification[] = [
      { class: "legacy-eligible", branch: "a" },
      { class: "legacy-eligible", branch: "b" },
      { class: "unexpected", clause: "ii" },
      { class: "unexpected", clause: "unobtainable" },
      { class: "latched" },
    ];
    const rank = { "legacy-eligible": 0, unexpected: 1, latched: 2 } as const;

    for (const initial of classes) {
      for (const late of classes) {
        const tightened = tightenE2eeTrustClassification(initial, late);
        expect(rank[tightened.class]).toBeGreaterThanOrEqual(rank[initial.class]);
      }
    }
  });

  it("resolves nothing when two pins under one pair recorded the same continuity id", () => {
    // The same rule the handle and hint resolver holds to: at most one record, or
    // nothing. Picking whichever sits first in the document would make the class a
    // statement tightens to depend on document order rather than on a unique
    // anchor — and §12.1.1 admits the late resolution only against "a pin under the
    // same pair", singular.
    const ambiguous = state(
      [
        verified({ latched: "set", localNodeHandle: "a", continuityId: "continuity-1" }),
        verified({ latched: "set", localNodeHandle: "b", continuityId: "continuity-1" }),
      ],
      [HUB],
    );

    expect(
      classifyE2eeTrustSnapshot(
        snapshotE2eeContinuityIdResolution(ambiguous, {
          hubOrigin: HUB,
          accountId: ACCOUNT,
          continuityId: "continuity-1",
        }),
      ),
    ).toEqual({ class: "unexpected", clause: "ii" });
  });

  it("cannot be reached by a continuity id an unverified record never recorded", () => {
    // §13.1: an `unverified` record holds no recorded continuity id, so a
    // first-contact statement's own id resolves nothing.
    const late = classifyE2eeTrustSnapshot(
      snapshotE2eeContinuityIdResolution(state([unverified({})], [HUB]), {
        hubOrigin: HUB,
        accountId: ACCOUNT,
        continuityId: "continuity-1",
      }),
    );

    expect(late).toEqual({ class: "unexpected", clause: "iii" });
  });
});

describe("§13.2.1 unexpected-node surface", () => {
  const statement = { kind: "first-contact-statement" } as const;
  const none = { kind: "none" } as const;
  const substitution: E2eeTrustClassification = { class: "unexpected", clause: "ii" };
  const accountChange: E2eeTrustClassification = { class: "unexpected", clause: "iii" };

  it("distinguishes the three situations", () => {
    expect(resolveE2eeUnexpectedNodeSituation(substitution, statement)).toBe(2);
    expect(resolveE2eeUnexpectedNodeSituation(accountChange, statement)).toBe(3);
    // §13.2.1 situation 2 is §5.2's rule about a first-contact STATEMENT, so with
    // no evidence the same selection is situation 1 — "unexpected selection with
    // no evidence", rows K23/K24.
    expect(resolveE2eeUnexpectedNodeSituation(substitution, none)).toBe(1);
  });

  it("keeps the account-scope change its own case when the Hub sends nothing", () => {
    // THE ACCOUNT-REMINT ATTACK, which produces exactly this input: §12.1.1's
    // marker classifies the selection clause (iii) and the Hub withholds the
    // carrier, so the channel takes row K24 with no evidence at all. §13.2.1
    // defines situation 3 from local state alone and classifies it under
    // K23/K24 — the no-evidence rows — and requires "This device has verified
    // nodes on this Hub, but not for this account" rather than situation 1's
    // generic copy, because "conflating them re-creates exactly the
    // click-through training §13.3 opens by forbidding".
    expect(resolveE2eeUnexpectedNodeSituation(accountChange, none)).toBe(3);
    expect(
      resolveE2eeUnexpectedNodeSituation(
        {
          class: "unexpected",
          clause: "i",
          record: "unverified",
          scope: { kind: "origin-verified" },
        },
        none,
      ),
    ).toBe(3);
  });

  it("presents a resolved pairing record beside the pair's verified pin", () => {
    // §5.2: "A first-contact statement arriving under a `(hubOrigin, accountId)`
    // pair that already holds a verified pin MUST be presented as a possible node
    // substitution, per §13.2.1 situation 2 — never as routine new-node pairing."
    // The owner adding a SECOND node is a selection that resolves — to the pairing
    // record §13.2 step 2 just wrote — and §13.2.1 says that copy "will fire on
    // every genuine additional node".
    expect(
      resolveE2eeUnexpectedNodeSituation(
        {
          class: "unexpected",
          clause: "i",
          record: "unverified",
          scope: { kind: "account-verified" },
        },
        statement,
      ),
    ).toBe(2);
    // The first node on this pair and this origin is the one case that continues
    // the ceremony without a surface: there is nothing to compare it against.
    expect(
      resolveE2eeUnexpectedNodeSituation(
        { class: "unexpected", clause: "i", record: "unverified", scope: { kind: "fresh" } },
        statement,
      ),
    ).toBeNull();
    // With no statement it is situation 1 even then: rows K23/K24 close the
    // channel and §13.2.1 requires the surface with its two resolutions.
    expect(
      resolveE2eeUnexpectedNodeSituation(
        { class: "unexpected", clause: "i", record: "unverified", scope: { kind: "fresh" } },
        none,
      ),
    ).toBe(1);
  });

  it("raises a surface for every other unexpected selection, including the cold start", () => {
    // §4.4's `unobtainable`: the load has not completed, so the device knows
    // nothing about its own pins. Suppressing the surface here would leave the
    // owner with no warning on the exact channel §4.4 fails closed for.
    for (const evidence of [none, statement]) {
      expect(
        resolveE2eeUnexpectedNodeSituation(
          { class: "unexpected", clause: "unobtainable" },
          evidence,
        ),
      ).toBe(1);
      for (const record of ["verified", "unpinned"] as const) {
        expect(
          resolveE2eeUnexpectedNodeSituation(
            { class: "unexpected", clause: "i", record, scope: { kind: "fresh" } },
            evidence,
          ),
        ).toBe(1);
      }
    }
  });

  it("is never raised for a latched or legacy-eligible selection", () => {
    for (const classification of [
      { class: "latched" },
      { class: "legacy-eligible", branch: "a" },
      { class: "legacy-eligible", branch: "b" },
    ] satisfies readonly E2eeTrustClassification[]) {
      expect(resolveE2eeUnexpectedNodeSituation(classification, { kind: "none" })).toBeNull();
      expect(
        resolveE2eeUnexpectedNodeSituation(classification, { kind: "first-contact-statement" }),
      ).toBeNull();
    }
  });

  it("withholds the legacy-consent resolution unless the policy is known to permit it", () => {
    expect(e2eeUnexpectedNodeResolutions({ kind: "permitted" })).toEqual([
      "pair",
      "record-legacy-consent",
    ]);
    expect(e2eeUnexpectedNodeResolutions({ kind: "forbidden", recordedAt: 1 })).toEqual(["pair"]);
    expect(e2eeUnexpectedNodeResolutions({ kind: "unobtainable" })).toEqual(["pair"]);
  });
});

describe("§13.3 statement outcomes", () => {
  // The verdicts below are decided by their tag alone, so the statement only has
  // to be present; no field of it reaches `resolveE2eeTrustStatementOutcome`.
  const statement = {} as NodeE2eeCapabilityStatement;

  it("routes a chain failure to the re-verification path and a regression away from it", () => {
    const chainFailure: NodeE2eeCapabilityVerification = {
      kind: "identity-event",
      event: { reason: "continuity_chain", failure: "pin_not_reached" },
      statement,
    };
    const regression: NodeE2eeCapabilityVerification = {
      kind: "invalid",
      reason: "policy_generation_regressed",
    };

    expect(resolveE2eeTrustStatementOutcome(chainFailure)).toEqual({
      kind: "re-verification-required",
      event: { reason: "continuity_chain", failure: "pin_not_reached" },
    });
    // §13.3: "A **policy-generation** regression is deliberately _not_ on this
    // list … because a Hub can replay a genuine older statement on demand."
    expect(resolveE2eeTrustStatementOutcome(regression)).toEqual({
      kind: "diagnostic-only",
      diagnostic: "e2ee_policy_generation_regressed",
    });
  });

  it("separates a rotation, an unchanged pin, and first contact", () => {
    const verdict = (
      anchor: "none" | "pin-unchanged" | "pin-updated",
    ): NodeE2eeCapabilityVerification => ({
      kind: "verified",
      statement,
      selectedSuite: 1,
      anchor,
    });

    expect(resolveE2eeTrustStatementOutcome(verdict("pin-unchanged"))).toEqual({
      kind: "pin-authenticated",
    });
    expect(resolveE2eeTrustStatementOutcome(verdict("pin-updated"))).toEqual({
      kind: "pin-rotated",
    });
    expect(resolveE2eeTrustStatementOutcome(verdict("none"))).toEqual({ kind: "first-contact" });
  });

  it("changes nothing for any other refusal", () => {
    expect(
      resolveE2eeTrustStatementOutcome({ kind: "invalid", reason: "statement_expired" }),
    ).toEqual({ kind: "no-trust-change" });
    expect(
      resolveE2eeTrustStatementOutcome({
        kind: "unusable",
        reason: "protocol_version_out_of_range",
        statement,
      }),
    ).toEqual({ kind: "no-trust-change" });
  });
});
