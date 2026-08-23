import type { HostedHubNode } from "@ryco/client-runtime/authorization";
import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { exactNodeRouteParams, resolveExactNodeRoute } from "./exactNodeRouteModel";

function node(id: string, environmentId: string): HostedHubNode {
  return {
    id,
    environmentId: EnvironmentId.make(environmentId),
    label: id,
    platformOs: "darwin",
    platformArch: "arm64",
    clientVersion: "1",
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: null,
    revokedAt: null,
    revocationReasonCode: null,
    grant: { id: `grant-${id}`, role: "owner" },
    effectiveRole: "owner",
    presence: { online: true, lastHeartbeatAt: null },
  };
}

describe("exact node trust routes", () => {
  const nodes = [node("node-a", "env-a"), node("node-b", "env-b")];

  it("keeps two approval targets independently addressable", () => {
    expect(resolveExactNodeRoute(exactNodeRouteParams(nodes[0]!), nodes)?.node.id).toBe("node-a");
    expect(resolveExactNodeRoute(exactNodeRouteParams(nodes[1]!), nodes)?.node.id).toBe("node-b");
  });

  it("fails closed when node and environment belong to different rows", () => {
    expect(resolveExactNodeRoute({ nodeId: "node-a", environmentId: "env-b" }, nodes)).toBeNull();
    expect(resolveExactNodeRoute({ nodeId: "node-a" }, nodes)).toBeNull();
  });
});
