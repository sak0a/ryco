import type { AgentControlMcpInstallation } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyMcpInstallationList,
  applyMcpInstallationMutation,
  emptyMcpInstallationSettingsState,
} from "./mcpInstallations.ts";

const installation = (
  revision: number,
  state: AgentControlMcpInstallation["state"],
): AgentControlMcpInstallation => ({
  installationId: "installation-1" as AgentControlMcpInstallation["installationId"],
  integrationId: "integration-1" as AgentControlMcpInstallation["integrationId"],
  workspaceId: "codex:dGVzdA" as AgentControlMcpInstallation["workspaceId"],
  driver: "codex" as AgentControlMcpInstallation["driver"],
  serverName: "ryco" as AgentControlMcpInstallation["serverName"],
  state,
  revision,
  lastError: null,
  ownsNativeConfig: state === "connected",
  preservedUserChanges: false,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: `2026-08-19T00:00:0${revision}.000Z`,
  connectedAt: state === "connected" ? "2026-08-19T00:00:01.000Z" : null,
});

describe("MCP installation settings state", () => {
  it("hydrates a list and applies newer mutation revisions", () => {
    const hydrated = applyMcpInstallationList(emptyMcpInstallationSettingsState(), {
      installations: [installation(1, "verifying")],
    });
    const connected = applyMcpInstallationMutation(hydrated, {
      installation: installation(2, "connected"),
    });
    expect(connected.installations[0]?.state).toBe("connected");
  });

  it("does not regress state from a stale reconnect response", () => {
    const current = applyMcpInstallationList(emptyMcpInstallationSettingsState(), {
      installations: [installation(3, "connected")],
    });
    expect(
      applyMcpInstallationMutation(current, {
        installation: installation(2, "verifying"),
      }),
    ).toBe(current);
  });
});
