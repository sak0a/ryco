import { describe, expect, it } from "vite-plus/test";

import { hostedSettingsSectionAllowed, settingsSectionAvailable } from "./SettingsDialog";

describe("hosted settings capabilities", () => {
  it("fails closed while role state is unavailable", () => {
    expect(hostedSettingsSectionAllowed("appearance", null)).toBe(true);
    expect(hostedSettingsSectionAllowed("archived", null)).toBe(false);
    expect(hostedSettingsSectionAllowed("providers", null)).toBe(false);
    expect(hostedSettingsSectionAllowed("statistics", null)).toBe(false);
  });

  it("keeps local connection setup hidden and restricts node mutations to owners", () => {
    expect(hostedSettingsSectionAllowed("connections", "owner")).toBe(false);
    expect(hostedSettingsSectionAllowed("providers", "viewer")).toBe(false);
    expect(hostedSettingsSectionAllowed("keybindings", "operator")).toBe(false);
    expect(hostedSettingsSectionAllowed("statistics", "owner")).toBe(true);
    expect(hostedSettingsSectionAllowed("providers", "owner")).toBe(true);
  });

  it("offers account management to every signed-in role, and only in the hosted client", () => {
    // The account is the signed-in user's own, so unlike the node-scoped
    // sections the answer does not wait on a fresh role snapshot.
    expect(hostedSettingsSectionAllowed("account", null)).toBe(true);
    expect(hostedSettingsSectionAllowed("account", "viewer")).toBe(true);
    expect(hostedSettingsSectionAllowed("account", "owner")).toBe(true);

    expect(settingsSectionAvailable("account", true)).toBe(true);
    expect(settingsSectionAvailable("account", false)).toBe(false);
  });

  it("leaves every other section reachable in the standard client", () => {
    for (const section of [
      "general",
      "providers",
      "appearance",
      "connections",
      "diagnostics",
      "archived",
    ] as const) {
      expect(settingsSectionAvailable(section, false)).toBe(true);
      expect(settingsSectionAvailable(section, true)).toBe(true);
    }
  });
});
