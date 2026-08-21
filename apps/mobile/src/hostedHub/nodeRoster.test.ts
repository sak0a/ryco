import type { HostedHubNode } from "@ryco/client-runtime/authorization";
import type { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decodeStoredHubNodeRoster,
  encodeStoredHubNodeRoster,
  reconcileHubNodeRoster,
  HUB_NODE_ROSTER_SCHEMA_VERSION,
  type CachedHubNodeRecord,
} from "./nodeRoster";

function node(input: {
  readonly nodeId: string;
  readonly environmentId: string;
  readonly revokedAt?: number | null;
  readonly online?: boolean;
  readonly label?: string;
}): HostedHubNode {
  return {
    id: input.nodeId,
    environmentId: input.environmentId as EnvironmentId,
    label: input.label ?? `Node ${input.nodeId}`,
    effectiveRole: "operator",
    revokedAt: input.revokedAt ?? null,
    lastAuthenticatedAt: 500,
    presence: { online: input.online ?? true, lastHeartbeatAt: 900 },
  } as never;
}

function record(input: {
  readonly nodeId: string;
  readonly environmentId: string;
  readonly revokedAt?: number | null;
}): CachedHubNodeRecord {
  return {
    nodeId: input.nodeId,
    environmentId: input.environmentId as EnvironmentId,
    label: `Node ${input.nodeId}`,
    effectiveRole: "operator",
    revokedAt: input.revokedAt ?? null,
    presenceOnline: true,
    lastHeartbeatAt: 900,
    lastAuthenticatedAt: 500,
    observedAt: 100,
  };
}

describe("hub node roster", () => {
  it("round-trips through the versioned codec", () => {
    const nodes = [record({ nodeId: "n1", environmentId: "e1" })];
    expect(decodeStoredHubNodeRoster(encodeStoredHubNodeRoster(nodes))).toEqual(nodes);
  });

  it("discards a roster whose schemaVersion literal does not match", () => {
    const raw = JSON.stringify({
      schemaVersion: HUB_NODE_ROSTER_SCHEMA_VERSION + 1,
      nodes: [record({ nodeId: "n1", environmentId: "e1" })],
    });
    expect(decodeStoredHubNodeRoster(raw)).toBeNull();
    expect(decodeStoredHubNodeRoster("{corrupt")).toBeNull();
  });

  it("maps a fresh directory listing onto records with the observation stamp", () => {
    const { roster, purgeEnvironmentIds, changed } = reconcileHubNodeRoster(
      [],
      [node({ nodeId: "n1", environmentId: "e1", online: false })],
      1_234,
    );
    expect(roster).toEqual([
      expect.objectContaining({
        nodeId: "n1",
        environmentId: "e1",
        presenceOnline: false,
        lastHeartbeatAt: 900,
        observedAt: 1_234,
      }),
    ]);
    expect(purgeEnvironmentIds).toEqual([]);
    expect(changed).toBe(true);
  });

  it("flags a newly revoked node for purge but keeps its roster record", () => {
    const { roster, purgeEnvironmentIds } = reconcileHubNodeRoster(
      [record({ nodeId: "n1", environmentId: "e1" })],
      [node({ nodeId: "n1", environmentId: "e1", revokedAt: 42 })],
      200,
    );
    expect(purgeEnvironmentIds).toEqual(["e1"]);
    expect(roster[0]?.revokedAt).toBe(42);
  });

  it("flags a node that vanished from the directory (authorization removed)", () => {
    const { roster, purgeEnvironmentIds } = reconcileHubNodeRoster(
      [
        record({ nodeId: "n1", environmentId: "e1" }),
        record({ nodeId: "n2", environmentId: "e2" }),
      ],
      [node({ nodeId: "n2", environmentId: "e2" })],
      200,
    );
    expect(purgeEnvironmentIds).toEqual(["e1"]);
    expect(roster.map((entry) => entry.nodeId)).toEqual(["n2"]);
  });

  it("reports no change for a poll that only refreshes the observation time", () => {
    const current = reconcileHubNodeRoster([], [node({ nodeId: "n1", environmentId: "e1" })], 100);
    const again = reconcileHubNodeRoster(
      current.roster,
      [node({ nodeId: "n1", environmentId: "e1" })],
      200,
    );
    expect(again.changed).toBe(false);
    expect(again.purgeEnvironmentIds).toEqual([]);
  });
});
