import { ORCHESTRATION_WS_METHODS, WS_METHODS } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveHostedRpcCapability } from "./capabilities";

describe("hosted UI capabilities", () => {
  it("keeps standard direct and desktop behavior unchanged", () => {
    expect(
      resolveHostedRpcCapability({
        hosted: false,
        role: null,
        fresh: false,
        method: WS_METHODS.serverGetStatistics,
      }).allowed,
    ).toBe(true);
  });

  it("fails closed while role state is absent or stale", () => {
    expect(
      resolveHostedRpcCapability({
        hosted: true,
        role: "owner",
        fresh: false,
        method: WS_METHODS.projectsList,
      }),
    ).toMatchObject({ allowed: false, reason: expect.any(String) });
  });

  it("fails closed while the browser resume or Ryco session is stale", () => {
    expect(
      resolveHostedRpcCapability({
        hosted: true,
        role: "operator",
        fresh: true,
        browserCurrent: false,
        sessionReady: true,
        method: ORCHESTRATION_WS_METHODS.dispatchCommand,
      }).allowed,
    ).toBe(false);
    expect(
      resolveHostedRpcCapability({
        hosted: true,
        role: "operator",
        fresh: true,
        browserCurrent: true,
        sessionReady: false,
        method: ORCHESTRATION_WS_METHODS.dispatchCommand,
      }).allowed,
    ).toBe(false);
  });

  it("adapts viewer, operator, and owner actions from the server policy", () => {
    const allowed = (role: "viewer" | "operator" | "owner", method: string) =>
      resolveHostedRpcCapability({ hosted: true, role, fresh: true, method }).allowed;
    expect(allowed("viewer", WS_METHODS.projectsList)).toBe(true);
    expect(allowed("viewer", ORCHESTRATION_WS_METHODS.dispatchCommand)).toBe(false);
    expect(allowed("operator", ORCHESTRATION_WS_METHODS.dispatchCommand)).toBe(true);
    expect(allowed("operator", WS_METHODS.subscribeTerminalEvents)).toBe(true);
    expect(allowed("operator", WS_METHODS.serverGetStatistics)).toBe(false);
    expect(allowed("owner", WS_METHODS.serverGetStatistics)).toBe(true);
    expect(allowed("owner", WS_METHODS.subscribeAuthAccess)).toBe(false);
  });
});
