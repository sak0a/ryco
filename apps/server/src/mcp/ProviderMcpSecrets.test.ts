import { describe, expect, it } from "vite-plus/test";

import {
  applyProviderMcpSecretMutations,
  providerMcpSecretPresence,
} from "./ProviderMcpSecrets.ts";

describe("ProviderMcpSecrets", () => {
  it("retains, replaces, and clears without exposing values in presence metadata", () => {
    const current = { KEEP: "secret-keep", REPLACE: "secret-old", CLEAR: "secret-clear" };
    const next = applyProviderMcpSecretMutations(current, {}, "env", {
      "env.KEEP": { action: "retain" },
      "env.REPLACE": { action: "replace", value: "secret-new" },
      "env.CLEAR": { action: "clear" },
    });

    expect(next).toEqual({ KEEP: "secret-keep", REPLACE: "secret-new" });
    const presence = providerMcpSecretPresence([{ prefix: "env", values: next }]);
    expect(presence).toEqual({ "env.KEEP": "present", "env.REPLACE": "present" });
    expect(JSON.stringify(presence)).not.toContain("secret-");
  });
});
