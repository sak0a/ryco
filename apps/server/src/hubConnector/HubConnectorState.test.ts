import { describe, expect, it } from "vite-plus/test";

import { classifyConnectorFailure, HubConnectorStateMachine } from "./HubConnectorState.ts";

describe("HubConnectorStateMachine", () => {
  it("serializes explicit states and rejects stale generations", () => {
    let now = Date.parse("2026-07-16T00:00:00.000Z");
    const state = new HubConnectorStateMachine(() => now);
    expect(state.snapshot().state).toBe("disabled");
    const first = state.beginGeneration();
    state.transition("connecting");
    now += 1_000;
    state.transition("authenticating");
    state.online();
    expect(state.snapshot()).toMatchObject({
      state: "online",
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const second = state.invalidateGeneration();
    expect(state.isCurrent(first)).toBe(false);
    expect(state.isCurrent(second)).toBe(true);
    state.transition("stopping");
    state.transition("disabled");
  });

  it("rejects impossible transitions", () => {
    const state = new HubConnectorStateMachine(() => 0);
    expect(() => state.transition("online")).toThrow("Hub connector state transition is invalid.");
  });
});

describe("classifyConnectorFailure", () => {
  it("classifies every transient failure for bounded automatic retry", () => {
    const cases = [
      ["dns", "network_unavailable"],
      ["network", "network_unavailable"],
      ["tls", "tls_unavailable"],
      ["authentication_timeout", "authentication_timeout"],
      ["server_draining", "server_draining"],
      ["rate_limited", "rate_limited"],
      ["heartbeat_timeout", "heartbeat_timeout"],
      ["slow_consumer", "slow_consumer"],
      ["internal_error", "internal_error"],
    ] as const;
    for (const [kind, failure] of cases) {
      expect(classifyConnectorFailure(kind, 0)).toEqual({ action: "retry", failure });
    }
  });

  it("stops every configuration, identity, authentication, and replacement failure", () => {
    for (const kind of [
      "configuration_invalid",
      "identity_unavailable",
      "identity_origin_mismatch",
      "enrollment_unavailable",
      "authentication_failed",
      "connection_replaced",
    ] as const) {
      expect(classifyConnectorFailure(kind, 0)).toMatchObject({ action: "operator" });
    }
    expect(classifyConnectorFailure("revoked", 0)).toMatchObject({
      action: "operator",
      terminalState: "revoked",
    });
    expect(classifyConnectorFailure("version_incompatible", 0)).toMatchObject({
      action: "operator",
      terminalState: "version_incompatible",
    });
  });

  it("allows one backed-off canonical violation and stops the second before stability", () => {
    expect(classifyConnectorFailure("protocol_invalid", 0).action).toBe("retry");
    expect(classifyConnectorFailure("protocol_invalid", 1).action).toBe("operator");
  });
});
