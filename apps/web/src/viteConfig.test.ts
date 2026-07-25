import { describe, expect, it } from "vite-plus/test";

import { createWebViteConfig, shouldEnableHostedPwaBuild } from "../vite.config";

type ViteConfigWithOptimizeDeps = {
  readonly optimizeDeps?: {
    readonly include?: readonly string[];
  };
  readonly define?: Record<string, string>;
  readonly resolve?: {
    readonly dedupe?: readonly string[];
  };
};

function collectPluginNames(value: unknown): ReadonlyArray<string> {
  if (Array.isArray(value)) return value.flatMap(collectPluginNames);
  if (value && typeof value === "object" && "name" in value && typeof value.name === "string") {
    return [value.name];
  }
  return [];
}

describe("web Vite config", () => {
  it("prebundles react-dom/client before browser tests start", () => {
    const config = createWebViteConfig() as ViteConfigWithOptimizeDeps;

    expect(config.optimizeDeps?.include).toContain("react-dom/client");
  });

  it("deduplicates react and react-dom so workspace deps cannot embed a second runtime", () => {
    for (const clientMode of ["standard", "hosted-hub"] as const) {
      const dedupe = (createWebViteConfig(clientMode) as ViteConfigWithOptimizeDeps).resolve
        ?.dedupe;

      expect(dedupe).toContain("react");
      expect(dedupe).toContain("react-dom");
    }
  });

  it("enables PWA artifacts only for production hosted builds", () => {
    expect(shouldEnableHostedPwaBuild({ clientMode: "hosted-hub", command: "build" })).toBe(true);
    expect(shouldEnableHostedPwaBuild({ clientMode: "hosted-hub", command: "serve" })).toBe(false);
    expect(shouldEnableHostedPwaBuild({ clientMode: "standard", command: "build" })).toBe(false);
    expect(shouldEnableHostedPwaBuild({ clientMode: "standard", command: "serve" })).toBe(false);

    const pluginNames = (clientMode: "hosted-hub" | "standard") =>
      collectPluginNames(createWebViteConfig(clientMode).plugins);
    expect(pluginNames("hosted-hub")).toContain("ryco-hosted-pwa");
    expect(pluginNames("standard")).not.toContain("ryco-hosted-pwa");
  });

  it("normalizes empty phone app interstitial settings to disabled", () => {
    const config = createWebViteConfig("standard", "", "") as ViteConfigWithOptimizeDeps;

    expect(config.define?.["import.meta.env.VITE_RYCO_PHONE_APP_INTERSTITIAL"]).toBe('"disabled"');
    expect(config.define?.["import.meta.env.VITE_RYCO_MOBILE_APP_URL"]).toBe('""');
  });

  it("passes configured phone app interstitial settings into build defines", () => {
    const config = createWebViteConfig(
      "standard",
      "enabled",
      "https://example.com/ryco",
    ) as ViteConfigWithOptimizeDeps;

    expect(config.define?.["import.meta.env.VITE_RYCO_PHONE_APP_INTERSTITIAL"]).toBe('"enabled"');
    expect(config.define?.["import.meta.env.VITE_RYCO_MOBILE_APP_URL"]).toBe(
      '"https://example.com/ryco"',
    );
  });

  it("normalizes unexpected phone app interstitial flag values to disabled", () => {
    const config = createWebViteConfig("standard", "unexpected") as ViteConfigWithOptimizeDeps;

    expect(config.define?.["import.meta.env.VITE_RYCO_PHONE_APP_INTERSTITIAL"]).toBe('"disabled"');
  });
});
