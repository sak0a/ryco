import type {
  AgentControlExternalClientKind,
  AgentControlExternalSetup,
  AgentControlIntegrationId,
} from "@ryco/contracts";

export interface ExternalSetupRuntime {
  readonly command: string;
  readonly entryPoint: string | null;
  readonly stateDir: string;
}

const bridgeArgs = (
  runtime: ExternalSetupRuntime,
  action: "pair" | "serve",
  integrationId: AgentControlIntegrationId,
): ReadonlyArray<string> => [
  ...(runtime.entryPoint === null ? [] : [runtime.entryPoint]),
  "mcp",
  action,
  "--integration",
  integrationId,
  "--state-dir",
  runtime.stateDir,
];

export const currentExternalSetupRuntime = (stateDir: string): ExternalSetupRuntime => ({
  command: process.execPath,
  entryPoint: process.argv[1] ? process.argv[1] : null,
  stateDir,
});

export const makeExternalIntegrationSetup = (input: {
  readonly integrationId: AgentControlIntegrationId;
  readonly clientKind: AgentControlExternalClientKind;
  readonly runtime: ExternalSetupRuntime;
}): AgentControlExternalSetup => {
  const pairCommand = {
    command: input.runtime.command,
    args: [...bridgeArgs(input.runtime, "pair", input.integrationId)],
  };
  const serveCommand = {
    command: input.runtime.command,
    args: [...bridgeArgs(input.runtime, "serve", input.integrationId)],
  };
  const server = { command: serveCommand.command, args: serveCommand.args };
  const tomlString = (value: string) => JSON.stringify(value);
  const configuration =
    input.clientKind === "codex"
      ? [
          "[mcp_servers.ryco]",
          `command = ${tomlString(server.command)}`,
          `args = [${server.args.map(tomlString).join(", ")}]`,
        ].join("\n")
      : JSON.stringify({ mcpServers: { ryco: server } }, null, 2);
  return { pairCommand, serveCommand, configuration };
};
