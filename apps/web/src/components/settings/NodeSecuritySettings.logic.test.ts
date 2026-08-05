import { E2EE_SAFETY_NUMBER_DIGITS } from "@ryco/shared/relayE2eeConstants";
import { describe, expect, it } from "vite-plus/test";

import {
  everyNodeSecurityString,
  formatNodeEpoch,
  nodeApproveConfirmation,
  nodeConnectionStatement,
  nodeContinuityRows,
  nodeE2eeActionConfirmation,
  nodeE2eePolicyGate,
  nodeE2eeStrictPolicyDisposition,
  nodeEnrollmentFingerprintView,
  nodeFallbackReport,
  nodePolicyPreviewWarnings,
  nodePolicyRows,
  nodePrekeyRemedy,
  nodePrekeyRows,
  nodeSafetyNumberGroups,
  nodeSafetyNumberView,
  nodeSecurityMode,
  nodeSessionRows,
  NODE_E2EE_ACTION_IDS,
  NODE_E2EE_APPROVABLE_ROLES,
  NODE_SAFETY_NUMBER_ADVISORY,
  NODE_SAFETY_NUMBER_CAPTION,
  type NodeSafetyNumberView,
} from "./NodeSecuritySettings.logic";

/** A well-formed §13.4 rendering, built from the constants rather than typed. */
const SAFETY_NUMBER = Array.from({ length: E2EE_SAFETY_NUMBER_DIGITS.groups }, (_unused, index) =>
  String(index + 10_000).padStart(E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup, "0"),
).join(E2EE_SAFETY_NUMBER_DIGITS.separator);

describe("mode discrimination", () => {
  it("reads the build mode, which is the fact that decides reachability", () => {
    expect(nodeSecurityMode(false)).toBe("local");
    expect(nodeSecurityMode(true)).toBe("hosted");
  });
});

describe("THE HARD BLOCK: requireApprovedClientE2EE from a browser", () => {
  it("is unavailable in hosted mode and available in local mode", () => {
    expect(nodeE2eeStrictPolicyDisposition("hosted").kind).toBe("blocked");
    expect(nodeE2eeStrictPolicyDisposition("local").kind).toBe("available");
  });

  it("refuses the field in hosted mode whichever way it is being set", () => {
    // Both directions, deliberately. Distinguishing them would make the guard
    // depend on reading a boolean correctly, and there is no reachable hosted
    // session against a node that already has the policy on — such a node would
    // not admit this browser at all.
    for (const value of [true, false]) {
      const gate = nodeE2eePolicyGate("hosted", { requireApprovedClientE2EE: value });
      expect(gate.allowed, `requireApprovedClientE2EE: ${value}`).toBe(false);
      if (gate.allowed) throw new Error("unreachable");
      expect(gate.refusal.length).toBeGreaterThan(0);
    }
  });

  it("refuses it even when it rides along with an otherwise legal proposal", () => {
    // The gate reads the FIELD, not the shape of the request around it: a
    // proposal that also flips `requireE2EE` must not smuggle the blocked one
    // through on the back of an allowed one.
    const gate = nodeE2eePolicyGate("hosted", {
      requireE2EE: true,
      requireApprovedClientE2EE: true,
      suiteRegistry: [1],
    });
    expect(gate.allowed).toBe(false);
  });

  it("still allows every other hosted policy change through the gate", () => {
    // The block is on one field. It is not a blanket refusal of policy edits,
    // and pretending otherwise would hide the fact that the hosted transport
    // refuses them all anyway.
    const gate = nodeE2eePolicyGate("hosted", { requireE2EE: true });
    expect(gate.allowed).toBe(true);
    if (!gate.allowed) throw new Error("unreachable");
    expect(gate.proposal).toEqual({ requireE2EE: true });
  });

  it("lets a local operator apply it, in both directions", () => {
    for (const value of [true, false]) {
      expect(nodeE2eePolicyGate("local", { requireApprovedClientE2EE: value }).allowed).toBe(true);
    }
  });

  it("names the node command rather than only refusing", () => {
    const disposition = nodeE2eeStrictPolicyDisposition("hosted");
    if (disposition.kind !== "blocked") throw new Error("unreachable");
    const lower = disposition.reason.toLowerCase();
    // A refusal with no route out is a dead end: §12.4's policy is a legitimate
    // thing to want, so the copy says where it can be done.
    expect(lower).toContain("ryco e2ee policy set --require-approved-client-e2ee");
    // …and says WHY, in the consequence's own terms.
    expect(lower).toContain("closes browser and legacy access");
    expect(lower).toContain("end this session");
  });
});

describe("the local mode raises no alarm about a relay that is not there", () => {
  it("states what the connection is and stays quiet about relay encryption", () => {
    const { headline, body } = nodeConnectionStatement("local", null);
    expect(headline.toLowerCase()).toContain("direct");
    expect(body.toLowerCase()).toContain("on this machine");
    // A red badge in local mode trains an owner to ignore the one that matters.
    // There is no relay here, so there is nothing to warn about — and nothing to
    // reassure about either.
    for (const phrase of ["warning", "insecure", "unencrypted", "not encrypted", "at risk"]) {
      expect(body.toLowerCase(), phrase).not.toContain(phrase);
    }
  });

  it("does not offer node operator data it cannot reach, and says where it lives", () => {
    // `resolvePrimaryEnvironmentHttpUrl` throws in hosted mode, so the sixteen
    // operator routes are unreachable from a hosted browser. The panel says so
    // rather than rendering an empty table that reads as "no clients".
    expect(nodeConnectionStatement("hosted", null).body.toLowerCase()).toContain("hub");
  });
});

describe("§13.4 the safety number and its ceiling are one value", () => {
  it("returns the digits, the caption and the advisory together, or nothing", () => {
    const view = nodeSafetyNumberView(SAFETY_NUMBER);
    expect(view).not.toBeNull();
    expect(view!.display).toBe(SAFETY_NUMBER);
    expect(view!.groups).toHaveLength(E2EE_SAFETY_NUMBER_DIGITS.groups);
    expect(view!.caption.length).toBeGreaterThan(0);
    expect(view!.advisory).toBe(NODE_SAFETY_NUMBER_ADVISORY);
  });

  it("cannot be constructed without its advisory", () => {
    // The whole mechanism: rendering the number without the sentence beside it
    // has to be a deliberate deletion of a field from a returned object, never
    // an omitted second call. The annotation below is the assertion — a
    // `NodeSafetyNumberView` missing `advisory` does not typecheck, so there is
    // no shape a surface can build that carries the digits alone.
    const withoutAdvisory = {
      groups: nodeSafetyNumberGroups(SAFETY_NUMBER),
      display: SAFETY_NUMBER,
      caption: NODE_SAFETY_NUMBER_CAPTION,
    };
    expect(Object.hasOwn(withoutAdvisory, "advisory")).toBe(false);
    const complete: NodeSafetyNumberView = {
      ...withoutAdvisory,
      advisory: NODE_SAFETY_NUMBER_ADVISORY,
    };
    expect(complete.advisory.length).toBeGreaterThan(0);
  });

  it("is the only export that hands back a §13.4 display string", () => {
    // `nodeSafetyNumberGroups` is the format validator and returns the groups,
    // never a joined display value — so a caller reaching for "just the digits"
    // has to join them itself, which is a visible act rather than an omission.
    expect(nodeSafetyNumberGroups(SAFETY_NUMBER).join(" ")).toBe(SAFETY_NUMBER);
    expect(Array.isArray(nodeSafetyNumberGroups(SAFETY_NUMBER))).toBe(true);
  });

  it("refuses anything that is not the exact §13.4 format", () => {
    for (const malformed of [
      "",
      "12345",
      SAFETY_NUMBER.replace(" ", "-"),
      `${SAFETY_NUMBER} 99999`,
      SAFETY_NUMBER.replace("1", "x"),
      SAFETY_NUMBER.slice(1),
    ]) {
      expect(nodeSafetyNumberView(malformed), JSON.stringify(malformed)).toBeNull();
      expect(nodeSafetyNumberGroups(malformed)).toEqual([]);
    }
  });

  it("quotes the format constants rather than writing the numbers", () => {
    const view = nodeSafetyNumberView(SAFETY_NUMBER)!;
    expect(view.caption).toContain(String(E2EE_SAFETY_NUMBER_DIGITS.digits));
    expect(view.caption).toContain(String(E2EE_SAFETY_NUMBER_DIGITS.groups));
    expect(view.caption).toContain(String(E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup));
  });

  it("tells the owner to read the other screen, not to trust this one", () => {
    // §13.2 step 5 is where this value is used: the owner compares it against
    // the device before approving the key.
    const lower = NODE_SAFETY_NUMBER_ADVISORY.toLowerCase();
    expect(lower).toContain("compare this with the number the device itself shows");
    expect(lower).toContain("approve nothing whose number you have not read");
  });
});

describe("prohibited claims", () => {
  it.each([
    // §2.2/§2.4: this panel describes the node. It may never spell the native
    // row's claim about the reader's own session, qualified or not — the scan
    // cannot judge qualification, so the phrase is absent.
    "end-to-end encrypted",
    // §13.5/§13.4: no comparison here is proof of anything, and "operator-proof"
    // carries the same token.
    "proof",
    "no interposer",
    // §2.6/§2.4: nothing here may be presented as unconditional.
    "cannot be intercepted",
    "unforgeable",
    "guaranteed",
    // §2.2's `verified` row is native-only and is a CONNECTION claim. This panel
    // reuses §13.6's own record vocabulary — pending, approved, revoked — and
    // borrows no word from the connection ladder.
    "verified",
  ])("never says %j", (phrase) => {
    for (const { where, text } of everyNodeSecurityString()) {
      expect(text.toLowerCase(), `${where} says ${phrase}`).not.toContain(phrase);
    }
  });

  it("never claims that reading this panel says anything about the reader's session", () => {
    // The panel describes the NODE's operator state. §2.4 denies the web tier
    // operator-proof protection, so no sentence may let a hosted reader conclude
    // that a healthy-looking node makes their own channel safe.
    for (const { where, text } of everyNodeSecurityString()) {
      const lower = text.toLowerCase();
      for (const phrase of [
        "your connection is secure",
        "this session is protected",
        "you are protected",
        "nobody can read",
      ]) {
        expect(lower, `${where} says ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it("ships a non-empty string everywhere it ships one at all", () => {
    // A scan over strings is vacuous if the strings are empty, and an empty
    // confirmation body is a confirmation dialog with no consequence stated.
    const strings = everyNodeSecurityString();
    expect(strings.length).toBeGreaterThan(20);
    for (const { where, text } of strings) {
      expect(text.trim().length, where).toBeGreaterThan(0);
    }
  });
});

describe("owner actions carry a confirmation proportionate to the consequence", () => {
  it("has one for every action, and marks the irreversible ones", () => {
    for (const action of NODE_E2EE_ACTION_IDS) {
      const confirmation = nodeE2eeActionConfirmation(action);
      expect(confirmation.title.length, action).toBeGreaterThan(0);
      expect(confirmation.body.length, action).toBeGreaterThan(0);
      expect(confirmation.confirmLabel.length, action).toBeGreaterThan(0);
    }
    // §13.6's withdrawals close live channels before the node acknowledges them,
    // and §7.5's re-mint sends every paired client back through pairing. Those
    // are the ones that cannot be undone by pressing the button again.
    for (const action of [
      "narrow",
      "revoke",
      "purge",
      "remint-continuity",
      "break-continuity",
      "recover-policy",
    ] as const) {
      expect(nodeE2eeActionConfirmation(action).destructive, action).toBe(true);
    }
    for (const action of ["approve", "open-window", "rotate-prekey", "reset-fallback"] as const) {
      expect(nodeE2eeActionConfirmation(action).destructive, action).toBe(false);
    }
  });

  it("says that revoking closes the client's live channels immediately", () => {
    // §13.6: "no channel admitted under the withdrawn authority is still open"
    // by the time the command is acknowledged. An owner who thinks revocation
    // takes effect at the next reconnect would revoke and walk away.
    for (const action of ["revoke", "narrow", "purge"] as const) {
      const lower = nodeE2eeActionConfirmation(action).body.toLowerCase();
      expect(lower, action).toMatch(
        /closes? (immediately|before)|loses access now|immediate disconnection/u,
      );
    }
  });

  it("makes the owner name the role, and names it back in the confirmation", () => {
    // §13.6: "`approved` requires explicit owner action naming the maximum role
    // and capability set." A single Approve button with a default would be the
    // PANEL naming the role — and the value it picked would become the ceiling
    // every channel that key opens is admitted under (§8.6 step 6).
    expect([...NODE_E2EE_APPROVABLE_ROLES]).toEqual(["viewer", "operator", "owner"]);
    for (const role of NODE_E2EE_APPROVABLE_ROLES) {
      const confirmation = nodeApproveConfirmation(role);
      expect(confirmation.title, role).toContain(role);
      expect(confirmation.confirmLabel, role).toContain(role);
      // The capability set is granted empty and the sentence says so, rather
      // than inferring authority nobody asked for.
      expect(confirmation.body.toLowerCase(), role).toContain("no extra capabilities are granted");
    }
    // Least authority first, so the first thing under the cursor is the
    // smallest grant.
    expect(NODE_E2EE_APPROVABLE_ROLES[0]).toBe("viewer");
    // Three distinct confirmations, so no two roles read the same.
    const labels = NODE_E2EE_APPROVABLE_ROLES.map(
      (role) => nodeApproveConfirmation(role).confirmLabel,
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("says that approving takes effect only on a fresh connection", () => {
    // §13.6: authority-widening changes "take effect only on a fresh ticket,
    // channel, and handshake, and never retroactively on an open one".
    expect(nodeE2eeActionConfirmation("approve").body.toLowerCase()).toContain(
      "not on anything open now",
    );
  });

  it("has a distinct confirm label for every action", () => {
    // Two actions sharing a button label is how an owner confirms the wrong one.
    const labels = NODE_E2EE_ACTION_IDS.map(
      (action) => nodeE2eeActionConfirmation(action).confirmLabel,
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("§12.6 the preview is what the warning is computed from", () => {
  const preview = {
    policy: {
      requireE2EE: true,
      requireApprovedClientE2EE: false,
      effectiveRequireE2EE: true,
      admittedPatterns: ["IK", "NX"] as const,
      suiteRegistry: [1],
      generation: 4,
    },
    withdrawal: true,
    changed: true,
    counts: { legacy: 2, nxE2ee: 1, suiteWithdrawn: 0, abortedHandshakes: 3 },
  };

  it("states §12.4's three duties when the strict policy is being enabled", () => {
    const warnings = nodePolicyPreviewWarnings(preview, { requireApprovedClientE2EE: true });
    const joined = warnings.join(" ").toLowerCase();
    expect(joined).toContain("closes browser and legacy access entirely");
    expect(joined).toContain("strands remote access");
    expect(joined).toContain("closes live channels");
  });

  it("reports §12.6's approximate counts and says they are approximate", () => {
    const joined = nodePolicyPreviewWarnings(preview, { requireE2EE: true }).join(" ");
    expect(joined).toContain("2 legacy");
    expect(joined).toContain("1 browser");
    expect(joined).toContain("3 handshake(s) in flight");
    expect(joined.toLowerCase()).toContain("move while you read them");
  });

  it("says so when the change would do nothing", () => {
    const joined = nodePolicyPreviewWarnings(
      { ...preview, withdrawal: false, changed: false },
      { requireE2EE: true },
    ).join(" ");
    expect(joined.toLowerCase()).toContain("changes nothing");
  });

  it("warns about nothing when a widening changes something", () => {
    expect(
      nodePolicyPreviewWarnings(
        { ...preview, withdrawal: false, changed: true },
        { requireE2EE: false },
      ),
    ).toEqual([]);
  });
});

describe("§12.3/§12.4 the policy display shows raw and effective, always", () => {
  it("never shows one without the other", () => {
    const rows = nodePolicyRows({
      requireE2EE: false,
      requireApprovedClientE2EE: true,
      effectiveRequireE2EE: true,
      admittedPatterns: ["IK"],
      suiteRegistry: [1, 2],
      generation: 9,
    });
    const labels = rows.map((row) => row.label);
    expect(labels).toContain("requireE2EE");
    expect(labels).toContain("requireApprovedClientE2EE");
    expect(labels).toContain("Effective requireE2EE");
    // §12.4's implication makes them differ, and a display of only one would
    // either understate the guarantee or misreport the configuration.
    expect(rows.find((row) => row.label === "requireE2EE")!.value).toBe("false");
    expect(rows.find((row) => row.label === "Effective requireE2EE")!.value).toBe("true");
  });

  it("says the policy is unknown rather than inventing a default", () => {
    expect(nodePolicyRows(null)).toEqual([{ label: "Admission policy", value: "unknown" }]);
  });
});

describe("§6.4 and §7.5 carry their own remedies", () => {
  it("tells a node with no prekey apart from one that expired", () => {
    expect(nodePrekeyRows({ present: false })).toEqual([
      { label: "Agreement prekey", value: "none held" },
    ]);
    expect(nodePrekeyRemedy({ present: false })).toContain("re-signs one at startup");
    // An expired one carries §6.4's own sentence, from the module that raised
    // the diagnostic rather than restated here.
    expect(
      nodePrekeyRemedy({ present: true, validity: "expired", remedy: "§6.4's own words." }),
    ).toBe("§6.4's own words.");
    expect(nodePrekeyRemedy({ present: true, validity: "usable" })).toBeNull();
  });

  it("reports an unresolvable lineage as unresolvable, with its reason", () => {
    const rows = nodeContinuityRows({ status: "unavailable", reason: "anchor_disagrees" });
    expect(rows).toEqual([
      { label: "Continuity", value: "unresolvable" },
      { label: "Reason", value: "anchor_disagrees" },
    ]);
  });

  it("shows the generation for an advertisable lineage", () => {
    const rows = nodeContinuityRows({
      status: "advertisable",
      continuityId: "lineage",
      generation: 7,
      chainLength: 2,
    });
    expect(rows.find((row) => row.label === "Rotation generation")!.value).toBe("7");
  });
});

describe("§12.5 the fallback report is readable rather than a dump", () => {
  it("keeps the two classes separate and never sums them", () => {
    const report = nodeFallbackReport({
      windowStartedAt: 1_000,
      peerLegacy: { occurrences: 3, ringOverflows: 0, lastOccurrenceAt: 2_000 },
      advertisementUnavailable: { occurrences: 5, ringOverflows: 1 },
      ring: [
        { occurredAt: 2_000, reason: "peer-legacy" },
        { occurredAt: 1_500, reason: "statement-unavailable" },
      ],
    })!;
    expect(report.classes).toHaveLength(2);
    expect(report.classes[0]!.occurrences).toBe(3);
    expect(report.classes[1]!.occurrences).toBe(5);
    // Each class says what it MEANS, because "advertisement-unavailable: 5" is a
    // number an owner cannot act on.
    for (const entry of report.classes) expect(entry.meaning.length).toBeGreaterThan(0);
    expect(report.quiet).toBe(false);
  });

  it("puts the retained occurrences in time order with their reasons", () => {
    // §12.5 requires the SHAPE to be legible, and a count is not a shape.
    const report = nodeFallbackReport({
      peerLegacy: { occurrences: 1, ringOverflows: 0 },
      advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
      ring: [
        { occurredAt: 3_000, reason: "peer-legacy" },
        { occurredAt: 1_000, reason: "undersized-connection" },
      ],
    })!;
    expect(report.entries.map((entry) => entry.reason)).toEqual([
      "undersized-connection",
      "peer-legacy",
    ]);
  });

  it("says an overflowed ring is an incomplete account", () => {
    const report = nodeFallbackReport({
      peerLegacy: { occurrences: 9, ringOverflows: 2 },
      advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
      ring: [],
    })!;
    expect(report.overflowNotice).not.toBeNull();
    expect(report.overflowNotice!.toLowerCase()).toContain("not evidence in either direction");
  });

  it("shows both numbers for a live undersized connection, because it is the comparison", () => {
    const report = nodeFallbackReport({
      peerLegacy: { occurrences: 0, ringOverflows: 0 },
      advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
      ring: [],
      undersizedConnection: { assertedMaxDataChunkBytes: 100, advertisementMinChunkBytes: 512 },
    })!;
    expect(report.undersizedNotice).toContain("100");
    expect(report.undersizedNotice).toContain("512");
    // Absent when the condition is not live: §12.5 scopes the pair to the
    // current connection, so its absence is not "never was".
    expect(
      nodeFallbackReport({
        peerLegacy: { occurrences: 0, ringOverflows: 0 },
        advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
        ring: [],
      })!.undersizedNotice,
    ).toBeNull();
  });

  it("reports a quiet window as quiet", () => {
    expect(
      nodeFallbackReport({
        peerLegacy: { occurrences: 0, ringOverflows: 0 },
        advertisementUnavailable: { occurrences: 0, ringOverflows: 0 },
        ring: [],
      })!.quiet,
    ).toBe(true);
  });
});

describe("§13.5 a native session has no per-session code and says so", () => {
  it("labels the tier with the node's own words and claims nothing about them", () => {
    const native = nodeSessionRows({
      sessionIndex: 0,
      tier: "native",
      suite: 1,
      establishedAt: 1_000,
    });
    expect(native.find((row) => row.label === "Tier")!.value).toBe("native (IK)");
    const web = nodeSessionRows({ sessionIndex: 1, tier: "web", suite: 1, establishedAt: 1_000 });
    expect(web.find((row) => row.label === "Tier")!.value).toBe("browser (NX)");
  });
});

describe("this node's own enrollment fingerprint", () => {
  it("is shown while a ceremony is pending and stated absent otherwise", () => {
    // No route on this node exposes its long-term identity fingerprint once
    // enrollment completes: `GET /api/hub/enrollment` answers 404 and
    // `GET /api/hub/identity` carries no fingerprint by design. The panel says
    // where to get it rather than showing the §6.4 AGREEMENT prekey fingerprint
    // under an identity heading — different keys, and the wrong one would send
    // an owner into a pairing comparison with a value that will never match.
    const pending = nodeEnrollmentFingerprintView("SHA256:abc");
    expect(pending.available).toBe(true);
    expect(pending.fingerprint).toBe("SHA256:abc");

    const absent = nodeEnrollmentFingerprintView(null);
    expect(absent.available).toBe(false);
    expect(absent.fingerprint).toBeNull();
    expect(absent.caption).toContain("ryco hub status");
  });
});

describe("timestamps", () => {
  it("says never rather than rendering an epoch for an absent one", () => {
    expect(formatNodeEpoch(undefined)).toBe("never");
    expect(formatNodeEpoch(0)).not.toBe("never");
  });
});
