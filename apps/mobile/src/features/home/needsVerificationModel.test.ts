import type { HostedHubNode } from "@ryco/client-runtime/authorization";
import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildNeedsVerificationRows } from "./needsVerificationModel";

function node(id: string, online: boolean): HostedHubNode {
  return {
    id,
    environmentId: EnvironmentId.make(`env-${id}`),
    label: id,
    platformOs: "darwin",
    platformArch: "arm64",
    clientVersion: "1",
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: null,
    revokedAt: null,
    revocationReasonCode: null,
    grant: { id: `grant-${id}`, role: id === "viewer" ? "viewer" : "operator" },
    effectiveRole: id === "viewer" ? "viewer" : "operator",
    presence: { online, lastHeartbeatAt: null },
  };
}

describe("Needs verification group", () => {
  it("keeps unverified, unknown and conflicted nodes exact while excluding verified work", () => {
    const nodes = [
      node("verified", true),
      node("pending", true),
      node("account", true),
      node("unknown", false),
      node("viewer", true),
    ];
    const rows = buildNeedsVerificationRows({
      nodes,
      trustByEnvironmentId: new Map([
        ["env-verified", "verified"],
        ["env-pending", "unverified"],
        ["env-account", "account-trusted"],
        ["env-unknown", "unknown"],
        ["env-viewer", "identity-conflict"],
      ]),
    });
    expect(rows.map((row) => row.nodeId).toSorted()).toEqual([
      "account",
      "pending",
      "unknown",
      "viewer",
    ]);
    expect(rows.find((row) => row.nodeId === "account")?.detail).toContain("Account trusted");
    expect(rows.find((row) => row.nodeId === "unknown")?.detail).toContain("Offline");
    expect(rows.find((row) => row.nodeId === "viewer")?.detail).toContain("Viewer");
    expect(rows.find((row) => row.nodeId === "viewer")?.lockedHistory).toBe(true);
    expect(rows.find((row) => row.nodeId === "pending")?.route).toEqual({
      nodeId: "pending",
      environmentId: "env-pending",
    });
  });
});
