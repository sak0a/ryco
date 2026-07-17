import { describe, expect, it } from "vite-plus/test";

import { hostedSettingsSectionAllowed } from "./SettingsDialog";

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
});
