import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { stripUnsupportedPersonalTeamEntitlements } =
  require("./withIosPersonalTeamCapabilities.cjs") as {
    readonly stripUnsupportedPersonalTeamEntitlements: (
      entitlements: Readonly<Record<string, unknown>>,
    ) => Record<string, unknown>;
    readonly stripUnsupportedPersonalTeamEntitlementsFile: (
      entitlementsPath: string,
    ) => Record<string, unknown>;
  };
const { stripUnsupportedPersonalTeamEntitlementsFile } =
  require("./withIosPersonalTeamCapabilities.cjs") as {
    readonly stripUnsupportedPersonalTeamEntitlementsFile: (
      entitlementsPath: string,
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

  it("removes APNs from the finalized generated entitlements file", () => {
    const directory = mkdtempSync(join(tmpdir(), "ryco-personal-team-entitlements-"));
    const entitlementsPath = join(directory, "RycoDev.entitlements");

    try {
      writeFileSync(
        entitlementsPath,
        `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>aps-environment</key>
    <string>development</string>
    <key>com.apple.developer.team-identifier</key>
    <string>LOCAL_TEAM</string>
  </dict>
</plist>`,
        "utf8",
      );

      expect(stripUnsupportedPersonalTeamEntitlementsFile(entitlementsPath)).toEqual({
        "com.apple.developer.team-identifier": "LOCAL_TEAM",
      });
      expect(readFileSync(entitlementsPath, "utf8")).not.toContain("aps-environment");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
