import { describe, expect, it } from "vite-plus/test";

import { PHONE_SETTINGS_SECTION_IDS } from "../shell/phone/PhoneSettingsSurface";
import {
  hostedSettingsSectionAllowed,
  settingsSectionAvailable,
  SETTINGS_DIALOG_SECTION_IDS,
} from "./SettingsDialog";

describe("the phone surface mirrors the desktop dialog's section inventory", () => {
  it("navigates to exactly the same sections", () => {
    // `PhoneSettingsSurface` keeps its own registry so it can group and order
    // independently, and the desktop dialog is what decides which sections
    // exist. Missing one there makes it unreachable on every phone-tier
    // presentation — below 768px, on a coarse-pointer device under 500px tall,
    // and in the hosted PWA on a phone — and a programmatic
    // `openSettings(section)` falls back to the section list with no error,
    // because `ALL_ITEMS.find(...)` returns undefined. `security` shipped in
    // exactly that state.
    //
    // Set equality rather than "every label in this hardcoded array is present":
    // the latter is what let it through.
    expect([...PHONE_SETTINGS_SECTION_IDS].toSorted()).toEqual(
      [...SETTINGS_DIALOG_SECTION_IDS].toSorted(),
    );
  });

  it("has no duplicate entry on either surface", () => {
    for (const [where, ids] of [
      ["desktop", SETTINGS_DIALOG_SECTION_IDS],
      ["phone", PHONE_SETTINGS_SECTION_IDS],
    ] as const) {
      expect(new Set(ids).size, where).toBe(ids.length);
    }
  });
});

describe("hosted settings capabilities", () => {
  it("fails closed while role state is unavailable", () => {
    expect(hostedSettingsSectionAllowed("appearance", null)).toBe(true);
    expect(hostedSettingsSectionAllowed("archived", null)).toBe(false);
    expect(hostedSettingsSectionAllowed("providers", null)).toBe(false);
    expect(hostedSettingsSectionAllowed("statistics", null)).toBe(false);
    // The node's E2EE operator surface is node-scoped state, so it fails closed
    // with the rest of that set rather than on the strength of the hosted HTTP
    // boundary alone.
    expect(hostedSettingsSectionAllowed("security", null)).toBe(false);
  });

  it("keeps local connection setup hidden and restricts node mutations to owners", () => {
    expect(hostedSettingsSectionAllowed("connections", "owner")).toBe(false);
    expect(hostedSettingsSectionAllowed("providers", "viewer")).toBe(false);
    expect(hostedSettingsSectionAllowed("keybindings", "operator")).toBe(false);
    expect(hostedSettingsSectionAllowed("statistics", "owner")).toBe(true);
    expect(hostedSettingsSectionAllowed("providers", "owner")).toBe(true);
    expect(hostedSettingsSectionAllowed("security", "viewer")).toBe(false);
    expect(hostedSettingsSectionAllowed("security", "operator")).toBe(false);
    expect(hostedSettingsSectionAllowed("security", "owner")).toBe(true);
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
      "security",
      "diagnostics",
      "archived",
    ] as const) {
      expect(settingsSectionAvailable(section, false)).toBe(true);
      expect(settingsSectionAvailable(section, true)).toBe(true);
    }
  });
});
