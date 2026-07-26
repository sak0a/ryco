import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId } from "@ryco/contracts";

import { buildNodeSections, canSelectHubNode } from "./nodesModel";

describe("Nodes model", () => {
  it("keeps Hub and direct rows in separate ordered sections", () => {
    const sections = buildNodeSections({
      rows: [
        {
          environmentId: "direct-a" as EnvironmentId,
          plane: "direct",
          label: "MacBook",
          readiness: "ready",
          selected: false,
          transportLabel: "Tailscale",
        },
        {
          environmentId: "hub-a" as EnvironmentId,
          plane: "hub",
          label: "Studio",
          role: "Owner",
          presence: "online",
          readiness: "ready",
          selected: true,
          transportLabel: "Hub relay",
        },
      ],
    });

    expect(sections.map((section) => section.key)).toEqual(["hub", "direct"]);
    expect(sections[0]?.rows[0]?.label).toBe("Studio");
    expect(sections[1]?.rows[0]?.transportLabel).toBe("Tailscale");
  });

  it("filters without merging credential planes", () => {
    const sections = buildNodeSections({
      rows: [
        {
          environmentId: "direct-a" as EnvironmentId,
          plane: "direct",
          label: "MacBook",
          readiness: "ready",
          selected: false,
          transportLabel: "Tailscale",
        },
        {
          environmentId: "hub-a" as EnvironmentId,
          plane: "hub",
          label: "Studio",
          readiness: "ready",
          selected: true,
          transportLabel: "Hub relay",
        },
      ],
      query: "tailscale",
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.key).toBe("direct");
  });

  it("fails closed when selecting a Hub node", () => {
    expect(
      canSelectHubNode({
        directoryStatus: "ready",
        browserStatus: "current",
        revokedAt: null,
        presence: "online",
      }),
    ).toBe(true);
    expect(
      canSelectHubNode({
        directoryStatus: "loading",
        browserStatus: "current",
        revokedAt: null,
        presence: "online",
      }),
    ).toBe(false);
    expect(
      canSelectHubNode({
        directoryStatus: "ready",
        browserStatus: "current",
        revokedAt: "2026-07-26T10:00:00.000Z",
        presence: "online",
      }),
    ).toBe(false);
  });
});
