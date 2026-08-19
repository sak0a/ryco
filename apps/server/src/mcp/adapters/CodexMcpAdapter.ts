import { ProviderDriverKind } from "@ryco/contracts";

import { mcpSupportForDriver, type CodexMcpServiceShape } from "../CodexMcpService.ts";
import type { ProviderMcpAdapter } from "../ProviderMcpAdapter.ts";

const CODEX_DRIVER = ProviderDriverKind.make("codex");

export function makeCodexMcpAdapter(service: CodexMcpServiceShape): ProviderMcpAdapter {
  return {
    driver: CODEX_DRIVER,
    capabilities: mcpSupportForDriver(CODEX_DRIVER).capabilities,
    listWorkspaces: service.listWorkspaces,
    listServers: service.listServers,
    upsertServer: service.upsertServer,
    setServerEnabled: service.setServerEnabled,
    removeServer: service.removeServer,
    reloadServers: service.reloadServers,
    startOauthLogin: service.startOauthLogin,
  };
}
