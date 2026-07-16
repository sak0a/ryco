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
  it("retries transient failures and stops terminal security failures", () => {
    expect(classifyConnectorFailure("dns", 0)).toEqual({
      action: "retry",
      failure: "network_unavailable",
    });
    expect(classifyConnectorFailure("authentication_timeout", 0).action).toBe("retry");
    expect(classifyConnectorFailure("authentication_failed", 0).action).toBe("operator");
    expect(classifyConnectorFailure("connection_replaced", 0).action).toBe("operator");
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
