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
});
