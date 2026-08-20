import { describe, expect, it } from "vite-plus/test";

import { HOSTED_CONNECTION_STATUS_INDICATORS } from "@ryco/client-runtime/authorization";

import { deriveNodeTrustByEnvironment, NODE_TRUST_UNVERIFIED_LABEL } from "./nodeTrustModel";

const ROSTER = [
  { environmentId: "env-a", nodeId: "node-a" },
  { environmentId: "env-b", nodeId: "node-b" },
] as const;

describe("Node trust provenance", () => {
  it("marks a node verified when exactly one verified pin hints at its id", () => {
    const trust = deriveNodeTrustByEnvironment({
      markerKind: "set",
      verifiedRecords: [{ nodeIdHints: ["node-a"] }],
      rosterNodes: ROSTER,
    });

    expect(trust?.get("env-a")).toBe("verified");
  });

  it("marks a node unverified when no verified pin hints at it", () => {
    const trust = deriveNodeTrustByEnvironment({
      markerKind: "set",
      verifiedRecords: [{ nodeIdHints: ["node-a"] }],
      rosterNodes: ROSTER,
    });

    expect(trust?.get("env-b")).toBe("unverified");
  });

  it("refuses an ambiguous hint rather than picking a record", () => {
    // Two records carrying the same Hub-minted id is a state only the Hub can
    // produce; resolveE2eeTrustRecord refuses it and so does the display.
    const trust = deriveNodeTrustByEnvironment({
      markerKind: "set",
      verifiedRecords: [{ nodeIdHints: ["node-a"] }, { nodeIdHints: ["node-a", "node-b"] }],
      rosterNodes: ROSTER,
    });

    expect(trust?.get("env-a")).toBe("unverified");
    expect(trust?.get("env-b")).toBe("verified");
  });

  it("makes no claim at all when the marker is unobtainable", () => {
    // §4.4: unobtainable evidence is never an unset marker. A direct-only build
    // never hydrates the trust store, and every row there must stay unmarked.
    const trust = deriveNodeTrustByEnvironment({
      markerKind: "unobtainable",
      verifiedRecords: [{ nodeIdHints: ["node-a"] }],
      rosterNodes: ROSTER,
    });

    expect(trust).toBeNull();
  });

  it("returns an empty map for an empty roster", () => {
    const trust = deriveNodeTrustByEnvironment({
      markerKind: "unset",
      verifiedRecords: [],
      rosterNodes: [],
    });

    expect(trust).not.toBeNull();
    expect(trust?.size).toBe(0);
  });

  it("reuses the client-runtime label rather than inventing a phrasing", () => {
    // §12.2 requires one vocabulary for the claim across every surface. If the
    // runtime renames the state, this fails instead of the two drifting apart.
    expect(NODE_TRUST_UNVERIFIED_LABEL in HOSTED_CONNECTION_STATUS_INDICATORS).toBe(true);
  });
});
