import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { CachedHubNodeRecord } from "../../hostedHub/nodeRoster";
import { buildMobileNativeWorkspaceCatalog } from "./nativeWorkspaceCatalogModel";

function node(
  environmentId: string,
  role: "viewer" | "operator" = "operator",
): CachedHubNodeRecord {
  return {
    nodeId: `node-${environmentId}`,
    environmentId: EnvironmentId.make(environmentId),
    label: environmentId,
    effectiveRole: role,
    revokedAt: null,
    presenceOnline: true,
    lastHeartbeatAt: 1,
    lastAuthenticatedAt: 1,
    observedAt: 2,
  };
}

describe("Mobile native workspace catalog adapter", () => {
  it("feeds durable trust into shared eligibility and locked-stale policy", () => {
    const catalog = buildMobileNativeWorkspaceCatalog({
      nodes: [node("verified"), node("pending"), node("conflict"), node("viewer", "viewer")],
      connections: [],
      trustByEnvironmentId: new Map([
        ["verified", "verified"],
        ["pending", "unverified"],
        ["conflict", "identity-conflict"],
        ["viewer", "verified"],
      ]),
    });
    const byId = new Map(catalog.map((entry) => [entry.environmentId, entry] as const));
    expect(byId.get(EnvironmentId.make("verified"))).toMatchObject({
      canReadMetadata: true,
      cacheDisposition: "available",
    });
    expect(byId.get(EnvironmentId.make("pending"))).toMatchObject({
      canReadMetadata: false,
      cacheDisposition: "purge",
    });
    expect(byId.get(EnvironmentId.make("conflict"))).toMatchObject({
      canReadMetadata: false,
      canMutate: false,
      cacheDisposition: "locked-stale",
    });
    expect(byId.get(EnvironmentId.make("viewer"))).toMatchObject({
      canReadMetadata: true,
      canMutate: false,
      accessReasons: expect.arrayContaining(["viewer"]),
    });
  });
});
