import {
  AgentControlIntegrationId,
  type AgentControlExternalIntegrationDetail,
} from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyExternalIntegrationList,
  applyExternalIntegrationPairing,
  emptyExternalIntegrationSettingsState,
} from "./externalIntegrations.ts";

const detail: AgentControlExternalIntegrationDetail = {
  integration: {
    integrationId: AgentControlIntegrationId.make("integration-ui-state"),
    displayName: "Local Claude",
    clientKind: "claude-code",
    projectScope: { kind: "all" },
    capabilities: [],
    rateLimitPerMinute: 60,
    activeTaskLimit: 1,
    activeTaskCount: 0,
    expiresAt: null,
    revokedAt: null,
    pairingState: "pending",
    pairingCodeExpiresAt: "2026-08-18T01:00:00.000Z",
    pairedAt: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    lastUsedAt: null,
  },
  setup: {
    pairCommand: { command: "/runtime/node", args: ["ryco", "mcp", "pair"] },
    serveCommand: { command: "/runtime/node", args: ["ryco", "mcp", "serve"] },
    configuration: '{"mcpServers":{}}',
  },
  topology: { available: true, reason: null },
};

describe("external integration settings state", () => {
  it("retains only public integration and ceremony data, never a credential", () => {
    const paired = applyExternalIntegrationPairing(emptyExternalIntegrationSettingsState(), {
      detail,
      pairingCode: "ABCD234567",
    });
    expect(paired.pairingCodes[detail.integration.integrationId]).toBe("ABCD234567");
    expect(JSON.stringify(paired)).not.toContain("rycoext_");
    expect(JSON.stringify(paired)).not.toContain("credential");

    const refreshed = applyExternalIntegrationList(paired, {
      integrations: [detail],
      topology: { available: true, reason: null },
    });
    expect(refreshed.pairingCodes).toEqual({});
    expect(JSON.stringify(refreshed)).not.toContain("credential");
  });
});
