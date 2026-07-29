import { describe, expect, it, vi } from "vite-plus/test";

import { createHubProfile, type HubProfile } from "../hostedHub/hubProfile";
import { openHostedSignInPreview, resolveHostedSignInPreviewUrl } from "./hostedSignInPreview";

function compatibleProfile(origin = "https://hub.ryco.dev"): HubProfile {
  return createHubProfile({
    origin,
    compatibility: {
      status: "compatible",
      checkedAt: 1_721_990_400_000,
      protocolVersion: 1,
      handoffVersion: 1,
      relyingPartyId: new URL(origin).hostname,
    },
  })!;
}

describe("hosted sign-in preview eligibility", () => {
  it("exposes one normalized Hub origin only for an unavailable development session", () => {
    const profile = compatibleProfile();
    expect(
      resolveHostedSignInPreviewUrl({
        developmentBuild: true,
        hostedModeAvailable: false,
        profile,
      }),
    ).toBe("https://hub.ryco.dev/");

    for (const input of [
      { developmentBuild: false, hostedModeAvailable: false, profile },
      { developmentBuild: true, hostedModeAvailable: true, profile },
      {
        developmentBuild: true,
        hostedModeAvailable: false,
        profile: createHubProfile({ origin: "https://hub.ryco.dev" }),
      },
      { developmentBuild: true, hostedModeAvailable: false, profile: null },
    ]) {
      expect(resolveHostedSignInPreviewUrl(input), JSON.stringify(input)).toBeNull();
    }
  });

  it("rejects an insecure or tainted profile even when a caller claims compatibility", () => {
    const compatibility = compatibleProfile().compatibility;
    for (const origin of [
      "http://hub.ryco.dev",
      "https://user:pass@hub.ryco.dev",
      "https://hub.ryco.dev/account",
      "https://hub.ryco.dev/?code=secret",
      "https://hub.ryco.dev/#secret",
    ]) {
      expect(
        resolveHostedSignInPreviewUrl({
          developmentBuild: true,
          hostedModeAvailable: false,
          profile: { origin, label: "Hub", compatibility },
        }),
        origin,
      ).toBeNull();
    }
  });
});

describe("hosted sign-in preview browser boundary", () => {
  it("opens an ephemeral auth session and discards every browser result", async () => {
    const openAuthSessionAsync = vi.fn(async () => ({
      type: "success" as const,
      url: "https://hub.ryco.dev/?code=must-not-return",
    }));

    await expect(
      openHostedSignInPreview("https://hub.ryco.dev/", {
        loadBrowser: async () => ({ openAuthSessionAsync }) as never,
      }),
    ).resolves.toBeUndefined();
    expect(openAuthSessionAsync).toHaveBeenCalledWith("https://hub.ryco.dev/", null, {
      preferEphemeralSession: true,
      preferUniversalLinks: false,
    });
  });

  it("rejects anything except the exact normalized HTTPS origin before opening a browser", async () => {
    const openAuthSessionAsync = vi.fn();
    const dependencies = {
      loadBrowser: async () => ({ openAuthSessionAsync }) as never,
    };

    for (const url of [
      "http://hub.ryco.dev/",
      "https://hub.ryco.dev",
      "https://hub.ryco.dev/account",
      "https://hub.ryco.dev/?code=secret",
      "https://hub.ryco.dev/#secret",
    ]) {
      await expect(openHostedSignInPreview(url, dependencies), url).rejects.toThrow(
        "Hub sign-in preview is unavailable.",
      );
    }
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
