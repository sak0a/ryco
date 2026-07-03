#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { BROWSER_RUNTIME_TOOL_DEFINITIONS } from "../provider/tools/BrowserRuntimeTool.ts";
import { browserMcpBridgeRequest } from "./BrowserMcpBridge.ts";

const socketPath = process.env.RYCO_BROWSER_MCP_SOCKET;
if (!socketPath) {
  console.error("RYCO_BROWSER_MCP_SOCKET is required.");
  process.exit(1);
}

const server = new McpServer({
  name: "ryco",
  version: "1.0.0",
});

for (const definition of BROWSER_RUNTIME_TOOL_DEFINITIONS) {
  server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.input as never,
    },
    // MCP SDK tool handler typing is overly strict for JSON-schema inputs.
    (async (args: Record<string, unknown>) => {
      const result = await browserMcpBridgeRequest({
        socketPath,
        toolName: definition.name,
        arguments: args,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent:
          result !== null && typeof result === "object"
            ? (result as Record<string, unknown>)
            : { result },
      };
    }) as never,
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
