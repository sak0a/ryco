import type {
  McpListServersInput,
  McpListServersResult,
  McpListWorkspacesResult,
  McpOauthLoginInput,
  McpOauthLoginResult,
  McpProviderCapabilities,
  McpServerEnabledInput,
  McpServerRemoveInput,
  McpServerUpsertInput,
  McpServersReloadInput,
  McpSettingsError,
  ProviderDriverKind,
} from "@ryco/contracts";
import type { Effect } from "effect";

export interface ProviderMcpAdapter {
  readonly driver: ProviderDriverKind;
  readonly capabilities: McpProviderCapabilities;
  readonly listWorkspaces: Effect.Effect<McpListWorkspacesResult, McpSettingsError>;
  readonly listServers?: (
    input: McpListServersInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly upsertServer?: (
    input: McpServerUpsertInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly setServerEnabled?: (
    input: McpServerEnabledInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly removeServer?: (
    input: McpServerRemoveInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly reloadServers?: (
    input: McpServersReloadInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly startOauthLogin?: (
    input: McpOauthLoginInput,
  ) => Effect.Effect<McpOauthLoginResult, McpSettingsError>;
}

const operationCapability = {
  listServers: "readConfiguration",
  upsertServer: "upsert",
  setServerEnabled: "enableDisable",
  removeServer: "remove",
  reloadServers: "reload",
  startOauthLogin: "oauth",
} as const satisfies Record<
  Exclude<keyof ProviderMcpAdapter, "driver" | "capabilities" | "listWorkspaces">,
  keyof McpProviderCapabilities
>;

export function validateProviderMcpAdapter(adapter: ProviderMcpAdapter): ReadonlyArray<string> {
  const issues: string[] = [];
  for (const [operation, capability] of Object.entries(operationCapability) as Array<
    [
      keyof typeof operationCapability,
      (typeof operationCapability)[keyof typeof operationCapability],
    ]
  >) {
    const implemented = typeof adapter[operation] === "function";
    const availability = adapter.capabilities[capability];
    if (availability === "available" && !implemented) {
      issues.push(`${operation} is missing while ${capability} is available`);
    }
    if (availability === "unavailable" && implemented) {
      issues.push(`${operation} is implemented while ${capability} is unavailable`);
    }
  }
  return issues;
}
