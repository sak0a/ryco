import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { stripUnsupportedPersonalTeamEntitlements } = require(
  "./withIosPersonalTeamCapabilities.cjs",
) as {
  readonly stripUnsupportedPersonalTeamEntitlements: (
    entitlements: Readonly<Record<string, unknown>>,
  ) => Record<string, unknown>;
};

describe("withIosPersonalTeamCapabilities", () => {
  it("removes APNs without mutating or dropping supported entitlements", () => {
    const entitlements = {
      "aps-environment": "development",
      "com.apple.developer.team-identifier": "LOCAL_TEAM",
    };

    expect(stripUnsupportedPersonalTeamEntitlements(entitlements)).toEqual({
      "com.apple.developer.team-identifier": "LOCAL_TEAM",
    });
    expect(entitlements).toHaveProperty("aps-environment", "development");
  });
});
