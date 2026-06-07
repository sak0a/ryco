import { describe, expect, it } from "vite-plus/test";

import viteConfig from "../vite.config";

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
});
