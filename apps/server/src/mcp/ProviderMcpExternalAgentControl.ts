import { McpSettingsError } from "@ryco/contracts";
import { Effect } from "effect";

import {
  externalAgentControlConfigFingerprint,
  externalAgentControlServerConfig,
} from "./externalAgentControlEntry.ts";
import type {
  ProviderMcpAdapter,
  ProviderMcpExternalAgentControlAdapter,
} from "./ProviderMcpAdapter.ts";

export function makeProviderMcpExternalAgentControl(input: {
  readonly listServers: NonNullable<ProviderMcpAdapter["listServers"]>;
  readonly upsertServer: NonNullable<ProviderMcpAdapter["upsertServer"]>;
  readonly removeServer: NonNullable<ProviderMcpAdapter["removeServer"]>;
}): ProviderMcpExternalAgentControlAdapter {
  const inspect: ProviderMcpExternalAgentControlAdapter["inspect"] = (desired) =>
    input.listServers({ workspaceId: desired.workspaceId, detail: "full" }).pipe(
      Effect.map((result) => {
        const server = result.servers.find((entry) => entry.name === desired.name);
        if (!server) return { state: "absent" as const, fingerprint: null };
        const fingerprint = externalAgentControlConfigFingerprint(server.config);
        const expected = externalAgentControlConfigFingerprint(
          externalAgentControlServerConfig(desired),
        );
        return {
          state: fingerprint === expected ? ("matching" as const) : ("different" as const),
          fingerprint,
        };
      }),
    );

  return {
    inspect,
    install: (desired) =>
      Effect.gen(function* () {
        const before = yield* inspect(desired);
        if (
          (desired.expectedFingerprint === null && before.state !== "absent") ||
          (desired.expectedFingerprint !== null &&
            before.fingerprint !== desired.expectedFingerprint)
        ) {
          return yield* Effect.fail(
            new McpSettingsError({ message: "MCP server changed before installation." }),
          );
        }
        yield* input.upsertServer({
          workspaceId: desired.workspaceId,
          name: desired.name,
          config: externalAgentControlServerConfig(desired),
        });
        const after = yield* inspect(desired);
        if (after.state !== "matching" || after.fingerprint === null) {
          return yield* Effect.fail(
            new McpSettingsError({ message: "Provider did not preserve the installed MCP entry." }),
          );
        }
        return { fingerprint: after.fingerprint };
      }),
    remove: (desired) =>
      Effect.gen(function* () {
        const current = yield* input.listServers({
          workspaceId: desired.workspaceId,
          detail: "full",
        });
        const server = current.servers.find((entry) => entry.name === desired.name);
        if (!server) return { removed: false, preservedUserChanges: false };
        if (externalAgentControlConfigFingerprint(server.config) !== desired.expectedFingerprint) {
          return { removed: false, preservedUserChanges: true };
        }
        yield* input.removeServer({ workspaceId: desired.workspaceId, name: desired.name });
        const after = yield* inspect({
          workspaceId: desired.workspaceId,
          name: desired.name,
          command: server.config.command ?? "missing",
          args: server.config.args,
        });
        if (after.state !== "absent") {
          return yield* Effect.fail(
            new McpSettingsError({ message: "Provider did not remove the MCP entry." }),
          );
        }
        return { removed: true, preservedUserChanges: false };
      }),
  };
}
