import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId } from "@ryco/contracts";

import { buildHomeEnvironments } from "./homeEnvironmentModel";

describe("Home environments", () => {
  it("maps direct and hosted readiness into bounded presentation state", () => {
    const environments = buildHomeEnvironments({
      direct: [
        {
          environmentId: "direct-a" as EnvironmentId,
          label: "MacBook",
          connectionState: "connecting",
          role: "owner",
        },
      ],
      hosted: {
        environmentId: "hosted-a" as EnvironmentId,
        label: "Studio",
        transportStatus: "online",
        sessionStatus: "ready",
        role: "viewer",
      },
    });

    expect(environments).toEqual([
      {
        environmentId: "direct-a",
        label: "MacBook",
        connectionState: "reconnecting",
      },
      {
        environmentId: "hosted-a",
        label: "Studio",
        connectionState: "read-only",
      },
    ]);
  });

  it("uses the selected Hub node as the current label for a shared environment id", () => {
    const environmentId = "node-a" as EnvironmentId;
    const environments = buildHomeEnvironments({
      direct: [
        {
          environmentId,
          label: "LAN address",
          connectionState: "connected",
          role: "owner",
        },
      ],
      hosted: {
        environmentId,
        label: "Studio",
        transportStatus: "reconnecting",
        sessionStatus: "stale",
        role: "owner",
      },
    });

    expect(environments).toEqual([
      {
        environmentId,
        label: "Studio",
        connectionState: "reconnecting",
      },
    ]);
  });

  it("renders every cached Hub roster node with presence-derived stale detail", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const environments = buildHomeEnvironments({
      direct: [],
      hosted: null,
      cachedHubNodes: [
        {
          environmentId: "node-a" as EnvironmentId,
          label: "Work Mac",
          role: "operator",
          revokedAt: null,
          presenceOnline: false,
          lastHeartbeatAt: now - 2 * 60 * 60 * 1000,
          lastAuthenticatedAt: now - 3 * 60 * 60 * 1000,
        },
        {
          environmentId: "node-b" as EnvironmentId,
          label: "Build node",
          role: "owner",
          revokedAt: null,
          presenceOnline: true,
          lastHeartbeatAt: now,
          lastAuthenticatedAt: now,
        },
        {
          environmentId: "node-c" as EnvironmentId,
          label: "Revoked node",
          role: "viewer",
          revokedAt: 1,
          presenceOnline: false,
          lastHeartbeatAt: null,
          lastAuthenticatedAt: null,
        },
      ],
      cacheProvenanceEnvironmentIds: ["node-a" as EnvironmentId, "node-b" as EnvironmentId],
      now,
    });

    expect(environments).toEqual([
      {
        environmentId: "node-a",
        label: "Work Mac",
        connectionState: "offline",
        stale: true,
        staleDetail: "Offline · last seen 2h ago",
      },
      {
        environmentId: "node-b",
        label: "Build node",
        connectionState: "offline",
        stale: true,
        staleDetail: "Online · cached",
      },
    ]);
  });

  it("marks an offline direct environment with cached rows as stale", () => {
    const environments = buildHomeEnvironments({
      direct: [
        {
          environmentId: "direct-a" as EnvironmentId,
          label: "LAN Mac",
          connectionState: "disconnected",
          role: "owner",
        },
      ],
      hosted: null,
      cacheProvenanceEnvironmentIds: ["direct-a" as EnvironmentId],
      now: 0,
    });
    expect(environments[0]).toMatchObject({
      connectionState: "offline",
      stale: true,
      staleDetail: "Offline · cached",
    });
  });

  it("never marks a connected environment stale even while its rows reconcile", () => {
    const environments = buildHomeEnvironments({
      direct: [
        {
          environmentId: "direct-a" as EnvironmentId,
          label: "LAN Mac",
          connectionState: "connected",
          role: "owner",
        },
      ],
      hosted: null,
      cacheProvenanceEnvironmentIds: ["direct-a" as EnvironmentId],
      now: 0,
    });
    expect(environments[0]?.stale).toBeUndefined();
  });
});
