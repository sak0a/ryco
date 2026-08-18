import {
  type AgentControlChangeSettingsPlan,
  type AgentControlMcpSettingsChangeRequest,
  type AgentControlMcpSettingsSummaryResult,
  type ServerSettings,
} from "@ryco/contracts";

/**
 * The node currently has owner-role authorization, but no authoritative
 * fresh-reauthentication evidence that survives from approval to executor.
 * Settings mutations therefore remain unavailable until that boundary exists.
 */
export const AGENT_CONTROL_SETTINGS_CHANGE_UNSUPPORTED_REASON =
  "Settings changes are unavailable because Ryco cannot yet enforce fresh owner reauthentication at both approval and execution.";

/**
 * Deliberately narrow, non-secret allowlist. These are presentation/runtime
 * preferences only; workspace, provider, credential, endpoint, and Agent
 * Control policy fields are structurally absent.
 */
export const agentControlSettingsSummary = (
  settings: ServerSettings,
): AgentControlMcpSettingsSummaryResult => ({
  settings: [
    {
      kind: "legacyTokenStreaming",
      label: "Legacy token streaming",
      value: settings.enableLegacyTokenStreaming,
      changeSupported: false,
      unsupportedReason: AGENT_CONTROL_SETTINGS_CHANGE_UNSUPPORTED_REASON,
    },
    {
      kind: "providerUpdateChecks",
      label: "Provider update checks",
      value: settings.enableProviderUpdateChecks,
      changeSupported: false,
      unsupportedReason: AGENT_CONTROL_SETTINGS_CHANGE_UNSUPPORTED_REASON,
    },
  ],
  redacted: true,
  omittedCategories: [
    "secrets-and-credentials",
    "provider-runtime-configuration",
    "mcp-server-configuration",
    "remote-relay-hosted-authentication",
    "filesystem-and-network-exposure",
    "agent-control-policy",
    "other-non-allowlisted-settings",
  ],
});

export const agentControlSettingsPlan = (
  settings: ServerSettings,
  change: AgentControlMcpSettingsChangeRequest,
): AgentControlChangeSettingsPlan => {
  switch (change.kind) {
    case "legacyTokenStreaming":
      return {
        kind: "changeSettings",
        change: {
          kind: change.kind,
          before: settings.enableLegacyTokenStreaming,
          after: change.value,
        },
      };
    case "providerUpdateChecks":
      return {
        kind: "changeSettings",
        change: {
          kind: change.kind,
          before: settings.enableProviderUpdateChecks,
          after: change.value,
        },
      };
  }
};
