import type { AgentControlExternalTopology } from "@ryco/contracts";

const PROVABLE_LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export const evaluateExternalMcpTopology = (config: {
  readonly host: string | undefined;
  readonly tailscaleServeEnabled: boolean;
  readonly hubConnector?: { readonly enabled: boolean } | undefined;
}): AgentControlExternalTopology => {
  if (config.host === undefined || !PROVABLE_LOOPBACK_HOSTS.has(config.host.trim())) {
    return {
      available: false,
      reason: "External integrations require an explicit loopback-only Ryco listener.",
    };
  }
  if (config.tailscaleServeEnabled) {
    return {
      available: false,
      reason: "External integrations are disabled while Tailscale Serve is enabled.",
    };
  }
  if (config.hubConnector?.enabled === true) {
    return {
      available: false,
      reason: "External integrations are disabled while this Ryco is Hub-connected.",
    };
  }
  return { available: true, reason: null };
};
