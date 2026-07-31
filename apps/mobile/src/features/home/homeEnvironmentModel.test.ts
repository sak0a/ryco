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
          threadSettlementSupported: true,
          shellCurrent: false,
          apiAvailable: true,
        },
      ],
      hosted: {
        environmentId: "hosted-a" as EnvironmentId,
        label: "Studio",
        transportStatus: "online",
        sessionStatus: "ready",
        role: "viewer",
        threadSettlementSupported: true,
        shellCurrent: true,
        apiAvailable: true,
      },
    });

    expect(environments).toEqual([
      {
        environmentId: "direct-a",
        label: "MacBook",
        connectionState: "reconnecting",
        threadSettlementSupported: true,
        mutationReady: false,
        shellCurrent: false,
      },
      {
        environmentId: "hosted-a",
        label: "Studio",
        connectionState: "read-only",
        threadSettlementSupported: true,
        mutationReady: false,
        shellCurrent: true,
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
          threadSettlementSupported: false,
          shellCurrent: true,
          apiAvailable: true,
        },
      ],
      hosted: {
        environmentId,
        label: "Studio",
        transportStatus: "reconnecting",
        sessionStatus: "stale",
        role: "owner",
        threadSettlementSupported: true,
        shellCurrent: false,
        apiAvailable: true,
      },
    });

    expect(environments).toEqual([
      {
        environmentId,
        label: "Studio",
        connectionState: "reconnecting",
        threadSettlementSupported: true,
        mutationReady: false,
        shellCurrent: false,
      },
    ]);
  });
});
