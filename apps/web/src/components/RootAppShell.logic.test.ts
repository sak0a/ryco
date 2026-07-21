import { describe, expect, it } from "vite-plus/test";

import { shouldApplyBootstrapThreadRedirect } from "./RootAppShell.logic";

describe("shouldApplyBootstrapThreadRedirect", () => {
  it("keeps the desktop last-thread redirect at the logical root", () => {
    expect(shouldApplyBootstrapThreadRedirect({ pathname: "/", tier: "desktop" })).toBe(true);
  });

  it("never redirects away from a non-root route", () => {
    expect(shouldApplyBootstrapThreadRedirect({ pathname: "/env_a/t_1", tier: "desktop" })).toBe(
      false,
    );
    expect(shouldApplyBootstrapThreadRedirect({ pathname: "/env_a/t_1", tier: "phone" })).toBe(
      false,
    );
  });

  it("keeps the phone tier on Home instead of the last thread", () => {
    expect(shouldApplyBootstrapThreadRedirect({ pathname: "/", tier: "phone" })).toBe(false);
  });
});
