import { describe, expect, it } from "vite-plus/test";

import { resolveHubEnrollmentLabel } from "./HubEnrollmentLabel.ts";

describe("resolveHubEnrollmentLabel", () => {
  it("derives stable fixed-vector tags from the Hub environment identity", () => {
    expect(
      resolveHubEnrollmentLabel({
        configuredNodeName: undefined,
        machineLabel: "Studio",
        environmentId: "env_AAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).toBe("Studio · M80B");
    expect(
      resolveHubEnrollmentLabel({
        configuredNodeName: undefined,
        machineLabel: "Studio",
        environmentId: "env_BBBBBBBBBBBBBBBBBBBBBB",
      }),
    ).toBe("Studio · 4G1S");
  });

  it("uses an explicit normalized name without an automatic suffix", () => {
    expect(
      resolveHubEnrollmentLabel({
        configuredNodeName: "  Build node  ",
        machineLabel: "Studio",
        environmentId: "env_AAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).toBe("Build node");
  });

  it("bounds automatic labels without splitting a Unicode scalar", () => {
    const label = resolveHubEnrollmentLabel({
      configuredNodeName: undefined,
      machineLabel: `${"a".repeat(92)}🙂more`,
      environmentId: "env_AAAAAAAAAAAAAAAAAAAAAA",
    });

    expect(label).toBe(`${"a".repeat(92)} · M80B`);
    expect(label).toHaveLength(99);
    expect(label).not.toContain("\ud83d");
  });

  it("uses the generic machine fallback when the friendly label is blank", () => {
    expect(
      resolveHubEnrollmentLabel({
        configuredNodeName: undefined,
        machineLabel: " \n ",
        environmentId: "env_AAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).toBe("Ryco environment · M80B");
  });
});
