import { fileURLToPath } from "node:url";
import * as nodePath from "node:path";

import type * as EffectAcpSchema from "effect-acp/schema";

import { RYCO_BROWSER_MCP_SERVER_NAME } from "../provider/tools/BrowserRuntimeToolHelpers.ts";

const browserMcpStdioEntry = fileURLToPath(new URL("./browser-mcp-stdio.ts", import.meta.url));

export function resolveBrowserMcpStdioCommand(): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  const runtime = process.execPath;
  const usesBun = nodePath.basename(runtime).includes("bun");
  return usesBun
    ? { command: runtime, args: [browserMcpStdioEntry] }
    : { command: "bun", args: [browserMcpStdioEntry] };
}

export function makeAcpBrowserMcpServer(input: {
  readonly socketPath: string;
}): EffectAcpSchema.McpServer {
  const spawn = resolveBrowserMcpStdioCommand();
  return {
    name: RYCO_BROWSER_MCP_SERVER_NAME,
    command: spawn.command,
    args: [...spawn.args],
    env: [{ name: "RYCO_BROWSER_MCP_SOCKET", value: input.socketPath }],
  };
}

export function makeOpenCodeBrowserMcpConfig(input: { readonly socketPath: string }) {
  const spawn = resolveBrowserMcpStdioCommand();
  return {
    type: "local" as const,
    command: [spawn.command, ...spawn.args],
    enabled: true,
    environment: {
      RYCO_BROWSER_MCP_SOCKET: input.socketPath,
    },
  };
}

export function makeCopilotBrowserMcpServerConfig(input: { readonly socketPath: string }) {
  const spawn = resolveBrowserMcpStdioCommand();
  return {
    type: "stdio" as const,
    command: spawn.command,
    args: [...spawn.args],
    tools: ["*"] as const,
    env: {
      RYCO_BROWSER_MCP_SOCKET: input.socketPath,
    },
  };
}
