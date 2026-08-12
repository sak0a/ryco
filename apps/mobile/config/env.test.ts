import { describe, expect, it } from "vite-plus/test";

import { resolveMobileRepoRoot } from "./env";

describe("mobile environment root", () => {
  it("resolves the monorepo root from apps/mobile/config", () => {
    expect(resolveMobileRepoRoot("file:///workspace/apps/mobile/config/env.ts")).toBe("/workspace");
  });
});
