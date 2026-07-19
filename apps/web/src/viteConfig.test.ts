import { describe, expect, it } from "vite-plus/test";

import { createWebViteConfig, shouldEnableHostedPwaBuild } from "../vite.config";

type ViteConfigWithOptimizeDeps = {
  readonly optimizeDeps?: {
    readonly include?: readonly string[];
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
    const config = createWebViteConfig("serve") as ViteConfigWithOptimizeDeps;

    expect(config.optimizeDeps?.include).toContain("react-dom/client");
  });

  it("enables PWA artifacts only for production hosted builds", () => {
    expect(shouldEnableHostedPwaBuild({ clientMode: "hosted-hub", command: "build" })).toBe(true);
    expect(shouldEnableHostedPwaBuild({ clientMode: "hosted-hub", command: "serve" })).toBe(false);
    expect(shouldEnableHostedPwaBuild({ clientMode: "standard", command: "build" })).toBe(false);
    expect(shouldEnableHostedPwaBuild({ clientMode: "standard", command: "serve" })).toBe(false);

    const pluginNames = (command: string, clientMode: "hosted-hub" | "standard") =>
      collectPluginNames(createWebViteConfig(command, clientMode).plugins);
    expect(pluginNames("build", "hosted-hub")).toContain("ryco-hosted-pwa");
    expect(pluginNames("serve", "hosted-hub")).not.toContain("ryco-hosted-pwa");
    expect(pluginNames("build", "standard")).not.toContain("ryco-hosted-pwa");
  });
});
