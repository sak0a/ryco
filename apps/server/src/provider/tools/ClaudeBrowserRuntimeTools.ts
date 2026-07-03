import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadId } from "@ryco/contracts";
import { Effect } from "effect";
import { z } from "zod";

import {
  BROWSER_RUNTIME_TOOL_DEFINITIONS,
  type BrowserRuntimeToolDefinition,
  type BrowserRuntimeToolName,
  isBrowserRuntimeToolName,
} from "./BrowserRuntimeTool.ts";
import {
  CLAUDE_BROWSER_MCP_SERVER_NAME,
  makeBrowserRuntimeToolHandler,
} from "./BrowserRuntimeToolHelpers.ts";
import type { ProviderRuntimeToolRegistryShape } from "./ProviderRuntimeToolRegistry.ts";

export {
  CLAUDE_BROWSER_MCP_SERVER_NAME,
  RYCO_BROWSER_MCP_SERVER_NAME,
} from "./BrowserRuntimeToolHelpers.ts";

const sessionFields = {
  sessionId: z.string().describe("Browser session id returned by browser_open."),
  tabId: z.string().optional().describe("Optional browser tab id."),
};

export function claudeBrowserMcpToolName(toolName: BrowserRuntimeToolName): string {
  return `mcp__${CLAUDE_BROWSER_MCP_SERVER_NAME}__${toolName}`;
}

export function listClaudeBrowserMcpToolNames(): ReadonlyArray<string> {
  return BROWSER_RUNTIME_TOOL_DEFINITIONS.map((definition) =>
    claudeBrowserMcpToolName(definition.name),
  );
}

export function isClaudeBrowserMcpToolName(toolName: string): boolean {
  return parseClaudeBrowserMcpToolName(toolName) !== undefined;
}

export function parseClaudeBrowserMcpToolName(
  toolName: string,
): BrowserRuntimeToolName | undefined {
  const prefix = `mcp__${CLAUDE_BROWSER_MCP_SERVER_NAME}__`;
  if (!toolName.startsWith(prefix)) {
    return undefined;
  }
  const shortName = toolName.slice(prefix.length);
  return isBrowserRuntimeToolName(shortName) ? shortName : undefined;
}

export { mapBrowserRuntimeToolResultToCallToolResult } from "./BrowserRuntimeToolHelpers.ts";

function zodSchemaForBrowserTool(name: BrowserRuntimeToolName) {
  switch (name) {
    case "browser_open":
      return {
        initialUrl: z.string().optional(),
        projectId: z.string().optional(),
      };
    case "browser_navigate":
      return {
        ...sessionFields,
        url: z.string(),
      };
    case "browser_input":
      return {
        ...sessionFields,
        action: z.record(z.string(), z.unknown()),
      };
    case "browser_wait_for":
      return {
        ...sessionFields,
        timeoutMs: z.number().optional(),
        url: z.string().optional(),
        title: z.string().optional(),
        text: z.string().optional(),
        textGone: z.string().optional(),
        loadState: z.enum(["idle", "loading", "loaded", "failed"]).optional(),
      };
    default:
      return sessionFields;
  }
}

function makeBrowserToolDefinition(
  definition: BrowserRuntimeToolDefinition,
  options: {
    readonly threadId: ThreadId;
    readonly executeBrowserTool: ProviderRuntimeToolRegistryShape["executeBrowserTool"];
    readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
    readonly readArtifactData?: (
      artifactId: import("@ryco/contracts").BrowserArtifactId,
    ) => Promise<Uint8Array | null>;
  },
) {
  const handler = makeBrowserRuntimeToolHandler({
    toolName: definition.name,
    threadId: options.threadId,
    executeBrowserTool: options.executeBrowserTool,
    runPromise: options.runPromise,
    ...(options.readArtifactData ? { readArtifactData: options.readArtifactData } : {}),
  });
  return tool(
    definition.name,
    definition.description,
    zodSchemaForBrowserTool(definition.name),
    handler as never,
    { alwaysLoad: true },
  );
}

export function makeClaudeBrowserMcpServer(options: {
  readonly threadId: ThreadId;
  readonly executeBrowserTool: ProviderRuntimeToolRegistryShape["executeBrowserTool"];
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly readArtifactData?: (
    artifactId: import("@ryco/contracts").BrowserArtifactId,
  ) => Promise<Uint8Array | null>;
}) {
  return createSdkMcpServer({
    name: CLAUDE_BROWSER_MCP_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    instructions:
      "Use these tools to inspect and control the Ryco in-app browser session for the current thread. " +
      "Call browser_open first to create or focus the thread browser, then pass the returned sessionId to other browser tools.",
    tools: BROWSER_RUNTIME_TOOL_DEFINITIONS.map((definition) =>
      makeBrowserToolDefinition(definition, options),
    ),
  });
}
