import { describe, expect, it } from "vite-plus/test";

import { APP_DISPLAY_NAME } from "./branding";
import { HUB_DISPLAY_NAME, HUB_WORDMARK, hubPageTitle } from "./hubBranding";

describe("hub branding", () => {
  it("names the Hub as its own product", () => {
    expect(HUB_DISPLAY_NAME).toBe("Ryco Hub");
  });

  // The defect this module exists to fix. `branding.ts` resolves the DESKTOP
  // client's identity, suffixed with its release channel, so a Hub surface that
  // rendered `${APP_DISPLAY_NAME} Hub` showed "Ryco (Beta) Hub" — the website
  // wearing the desktop app's stage label. The Hub ships its own name.
  it("does not inherit the desktop app's stage suffix", () => {
    expect(HUB_DISPLAY_NAME).not.toContain("(");
    expect(HUB_DISPLAY_NAME).not.toContain(APP_DISPLAY_NAME);
  });

  it("titles the Hub home with the bare wordmark", () => {
    expect(hubPageTitle()).toBe(HUB_WORDMARK);
    expect(hubPageTitle("")).toBe(HUB_WORDMARK);
  });

  it("titles a Hub page with its own name first", () => {
    expect(hubPageTitle("Sign in")).toBe(`Sign in · ${HUB_WORDMARK}`);
  });
});
