import type {
  McpListServersInput,
  McpListServersResult,
  McpListWorkspacesResult,
  McpOauthLoginInput,
  McpOauthLoginResult,
  McpProviderCapabilities,
  McpServerEnabledInput,
  McpServerName,
  McpServerRemoveInput,
  McpServerUpsertInput,
  McpServersReloadInput,
  McpSettingsError,
  McpWorkspaceId,
  ProviderDriverKind,
} from "@ryco/contracts";
import type { Effect } from "effect";

export interface ProviderMcpExternalAgentControlDesiredEntry {
  readonly name: McpServerName;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export interface ProviderMcpExternalAgentControlInspection {
  readonly state: "absent" | "matching" | "different";
  readonly fingerprint: string | null;
}

export interface ProviderMcpExternalAgentControlInstallInput extends ProviderMcpExternalAgentControlDesiredEntry {
  readonly workspaceId: McpWorkspaceId;
  /** Null means the server name must still be absent. */
  readonly expectedFingerprint: string | null;
}

export interface ProviderMcpExternalAgentControlRemoveInput {
  readonly workspaceId: McpWorkspaceId;
  readonly name: McpServerName;
  readonly expectedFingerprint: string;
}

export interface ProviderMcpExternalAgentControlAdapter {
  readonly inspect: (
    input: ProviderMcpExternalAgentControlDesiredEntry & { readonly workspaceId: McpWorkspaceId },
  ) => Effect.Effect<ProviderMcpExternalAgentControlInspection, McpSettingsError>;
  readonly install: (
    input: ProviderMcpExternalAgentControlInstallInput,
  ) => Effect.Effect<{ readonly fingerprint: string }, McpSettingsError>;
  readonly remove: (
    input: ProviderMcpExternalAgentControlRemoveInput,
  ) => Effect.Effect<
    { readonly removed: boolean; readonly preservedUserChanges: boolean },
    McpSettingsError
  >;
}

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
  readonly externalAgentControl?: ProviderMcpExternalAgentControlAdapter;
}

const operationCapability = {
  listServers: "readConfiguration",
  upsertServer: "upsert",
  setServerEnabled: "enableDisable",
  removeServer: "remove",
  reloadServers: "reload",
  startOauthLogin: "oauth",
} as const satisfies Record<
  Exclude<
    keyof ProviderMcpAdapter,
    "driver" | "capabilities" | "listWorkspaces" | "externalAgentControl"
  >,
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
  const hasExternalInstaller = adapter.externalAgentControl !== undefined;
  if (adapter.capabilities.externalAgentControl === "available" && !hasExternalInstaller) {
    issues.push("externalAgentControl is missing while externalAgentControl is available");
  }
  if (adapter.capabilities.externalAgentControl === "unavailable" && hasExternalInstaller) {
    issues.push("externalAgentControl is implemented while externalAgentControl is unavailable");
  }
  return issues;
}
