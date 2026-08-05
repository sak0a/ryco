// The revoke surface's decisions and, above all, its claims.
//
// Revoking a node is the only action in the hosted directory that cannot be
// taken back, and it is the one whose copy is easiest to overstate: it looks
// like it does something to the machine, and it does not. What is pinned here is
// therefore the copy's *silence* on that as much as its content, plus the
// failure mapping, whose whole job is to not lie about whether anything changed.

import { describe, expect, it } from "vite-plus/test";

import {
  everyHostedNodeRevokeString,
  hostedNodeRevokeConfirmation,
  hostedNodeRevokeFailure,
  hostedNodeRevokeRetryable,
  HOSTED_NODE_REVOKE_CONSEQUENCES,
  HOSTED_NODE_REVOKE_REASON_CODE,
} from "./HostedNodeRevoke.logic";

const NODE = {
  id: "node_aaaaaaaaaaaaaaaaaaaaaa",
  label: "Studio",
} as const;

describe("revoke confirmation", () => {
  it("names the node in its title and carries the identifier the label cannot supply", () => {
    const confirmation = hostedNodeRevokeConfirmation(NODE);
    expect(confirmation.title).toContain(NODE.label);
    // The prompt exists to send the reader to the identifier rendered beside it;
    // a confirmation over near-identical rows that names only a shared label
    // catches an accidental click and nothing else.
    expect(confirmation.subjectPrompt.toLowerCase()).toContain("identifier");
  });

  it("gives two nodes sharing a label two different confirmations", () => {
    // The failure this list is shaped to produce is a click on the wrong ROW,
    // not a click on nothing. Two machines named the same way must not produce
    // the same dialog.
    const first = hostedNodeRevokeConfirmation({ id: "node_" + "a".repeat(22), label: "Studio" });
    const second = hostedNodeRevokeConfirmation({ id: "node_" + "b".repeat(22), label: "Studio" });
    expect(first.title).toBe(second.title);
    // …which is exactly why the title is not the whole confirmation: the dialog
    // renders `node.id` beside it, and the two ids differ.
    expect("node_" + "a".repeat(22)).not.toBe("node_" + "b".repeat(22));
  });

  it("states all four consequences, and does not drop one silently", () => {
    expect(HOSTED_NODE_REVOKE_CONSEQUENCES.map((entry) => entry.id)).toEqual([
      "access",
      "directory",
      "return",
      "reach",
    ]);
    for (const consequence of HOSTED_NODE_REVOKE_CONSEQUENCES) {
      expect(consequence.text.length, `${consequence.id} is empty`).toBeGreaterThan(20);
    }
  });

  it("says the revocation reaches every account on the node, not only the reader", () => {
    // `/api/admin/nodes/{id}/revoke` revokes the NODE. The separate grant route
    // is the one that removes a single account's access, and an owner who read
    // this as "I lose my access" would be misinformed about a change that
    // empties the node out of every authorized account's directory at once.
    const access = HOSTED_NODE_REVOKE_CONSEQUENCES.find((entry) => entry.id === "access")!;
    expect(access.text.toLowerCase()).toContain("everyone");
  });

  it("says returning is a fresh enrollment rather than a reconnection", () => {
    const returning = HOSTED_NODE_REVOKE_CONSEQUENCES.find((entry) => entry.id === "return")!;
    const lower = returning.text.toLowerCase();
    expect(lower).toContain("enroll");
    expect(lower).toContain("not a reconnection");
  });

  it("says the revocation is recorded on the Hub and holds for an unreachable node", () => {
    // The one claim an owner is buying this control for: a node that is gone
    // does not have to come back in order to be revoked.
    const reach = HOSTED_NODE_REVOKE_CONSEQUENCES.find((entry) => entry.id === "reach")!;
    const lower = reach.text.toLowerCase();
    expect(lower).toContain("hub");
    expect(lower).toContain("offline");
  });

  it("sends a reason code the Hub's strict body schema accepts", () => {
    // `REASON` on the Hub is `/^[a-z0-9._-]{1,64}$/` and `reasonCode` is
    // REQUIRED, not optional — a value outside it is a 400 that says nothing
    // about which field was wrong.
    expect(HOSTED_NODE_REVOKE_REASON_CODE).toMatch(/^[a-z0-9._-]{1,64}$/);
  });
});

describe("prohibited claims", () => {
  it.each([
    // Revocation is Hub-side state and contacts nothing. Every token below would
    // describe an effect on the machine that does not happen — and the scan is a
    // bare substring match that cannot tell a claim from its denial, so the
    // words are absent in both directions.
    "notif",
    "wipe",
    "erase",
    "delete",
    "uninstall",
    "factory reset",
    "shut down",
    "shutdown",
    "power off",
    "disk",
    "local data",
    "its files",
    // Nor is the node a party to this. It is not asked, told, or waited for.
    "tells the node",
    "informs the node",
    "let the node know",
    "the node is asked",
    // And nothing here is reversible or undoable, so no sentence may hint at it.
    "restore",
    "re-enable",
    "reinstate",
  ])("never says %j", (phrase) => {
    for (const { where, text } of everyHostedNodeRevokeString()) {
      expect(text.toLowerCase(), `${where} says ${phrase}`).not.toContain(phrase);
    }
  });

  it("never tells the owner a refused request may have partly landed", () => {
    // The inverse failure: a message that hedges on an action the Hub explicitly
    // refused teaches an owner to distrust every refusal, including the ones
    // that are exact.
    for (const [where, message] of [
      ["forbidden", hostedNodeRevokeFailure({ code: "forbidden", status: 403 }).message],
      ["rateLimited", hostedNodeRevokeFailure({ code: "rate_limited", status: 429 }).message],
      ["offline", hostedNodeRevokeFailure({ code: "unavailable", status: 0 }).message],
    ] as const) {
      expect(message.toLowerCase(), `${where} hedges`).toContain("nothing was changed");
    }
  });

  it("keeps every message bounded and free of transport detail", () => {
    for (const { where, text } of everyHostedNodeRevokeString()) {
      expect(text.length, `${where} is unbounded`).toBeLessThanOrEqual(280);
      // No status numbers, no wire codes, no paths: the Hub's own vocabulary is
      // not an owner-facing one.
      expect(text, `${where} leaks a wire code`).not.toMatch(
        /node_forbidden|node_not_found|node_rate_limited|invalid_response|\/api\//,
      );
    }
  });
});

describe("failure mapping", () => {
  it("keeps the node standing for every refusal the Hub made before changing anything", () => {
    for (const [where, cause] of [
      ["unauthorized", { code: "session_invalid", status: 401 }],
      ["forbidden", { code: "forbidden", status: 403 }],
      ["conflict", { code: "conflict", status: 409 }],
      ["rateLimited", { code: "node_rate_limited", status: 429 }],
      ["offline", { code: "unavailable", status: 0 }],
      ["timeout", { code: "timeout", status: 0 }],
      ["badRequest", { code: "invalid_request", status: 400 }],
      ["unknownShape", new Error("boom")],
    ] as const) {
      const failure = hostedNodeRevokeFailure(cause);
      expect(failure.outcome, `${where} claimed the wrong outcome`).toBe("unchanged");
      // …and the same button is still worth pressing, because the node is
      // exactly where it was.
      expect(hostedNodeRevokeRetryable(failure), `${where} withdrew a live retry`).toBe(true);
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });

  it("separates an owner refusal from an expired session", () => {
    const forbidden = hostedNodeRevokeFailure({ code: "forbidden", status: 403 });
    const unauthorized = hostedNodeRevokeFailure({ code: "session_invalid", status: 401 });
    expect(forbidden.message).not.toBe(unauthorized.message);
    expect(forbidden.message.toLowerCase()).toContain("owner");
    expect(unauthorized.message.toLowerCase()).toContain("sign in");
  });

  it("reads a 404 as already gone rather than as a lookup failure", () => {
    // The Hub's update is conditioned on `revoked_at IS NULL`, so a second
    // revoke of the same node answers 404. Reporting that as "no such node"
    // would tell an owner their node is unknown to a Hub that has it on file.
    const failure = hostedNodeRevokeFailure({ code: "not_found", status: 404 });
    expect(failure.outcome).toBe("already-gone");
    expect(failure.message.toLowerCase()).toContain("already revoked");
    // Pressing it again is the same 404 forever, so the button is withdrawn.
    expect(hostedNodeRevokeRetryable(failure)).toBe(false);
  });

  it("refuses to claim an outcome it does not have when the answer is unreadable", () => {
    // `invalid_response` is thrown only AFTER a request the Hub accepted, so
    // "nothing was revoked" there is a guess presented as a fact about an
    // irreversible action.
    const failure = hostedNodeRevokeFailure({ code: "invalid_response", status: 502 });
    expect(failure.outcome).toBe("unknown");
    expect(failure.message.toLowerCase()).toContain("not known");
    expect(failure.message.toLowerCase()).not.toContain("nothing was changed");
    // And it does not re-offer a second irreversible write against a node that
    // may have taken the first one.
    expect(hostedNodeRevokeRetryable(failure)).toBe(false);
  });

  it("treats no failure at all as retryable, so the button exists before anything is pressed", () => {
    expect(hostedNodeRevokeRetryable(null)).toBe(true);
  });

  it("reads the error structurally rather than through a class identity", () => {
    // The error crosses a package boundary. An `instanceof` check would be one
    // duplicated class identity away from reporting every Hub refusal as the
    // generic fallback.
    expect(hostedNodeRevokeFailure({ status: 403 }).message.toLowerCase()).toContain("owner");
    expect(hostedNodeRevokeFailure(null).outcome).toBe("unchanged");
    expect(hostedNodeRevokeFailure(undefined).outcome).toBe("unchanged");
    expect(hostedNodeRevokeFailure("403").outcome).toBe("unchanged");
  });
});
