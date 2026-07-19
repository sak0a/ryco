import { describe, expect, it } from "vite-plus/test";

import viteConfig, { shouldEnableHostedPwaBuild } from "../vite.config";

type ViteConfigWithOptimizeDeps = {
  readonly optimizeDeps?: {
    readonly include?: readonly string[];
  };
};

describe("web Vite config", () => {
  it("prebundles react-dom/client before browser tests start", () => {
    const config = viteConfig as ViteConfigWithOptimizeDeps;

    expect(config.optimizeDeps?.include).toContain("react-dom/client");
  });

  it("enables PWA artifacts only for production hosted builds", () => {
    expect(shouldEnableHostedPwaBuild({ clientMode: "hosted-hub", command: "build" })).toBe(true);
    expect(shouldEnableHostedPwaBuild({ clientMode: "hosted-hub", command: "serve" })).toBe(false);
    expect(shouldEnableHostedPwaBuild({ clientMode: "standard", command: "build" })).toBe(false);
    expect(shouldEnableHostedPwaBuild({ clientMode: "standard", command: "serve" })).toBe(false);
  });
});
