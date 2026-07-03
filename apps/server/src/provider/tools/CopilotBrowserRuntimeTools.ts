import { convertMcpCallToolResult, defineTool } from "@github/copilot-sdk";
import type { ThreadId } from "@ryco/contracts";
import { Effect } from "effect";
import { z } from "zod";

import {
  BROWSER_RUNTIME_TOOL_DEFINITIONS,
  type BrowserRuntimeToolName,
} from "./BrowserRuntimeTool.ts";
import {
  browserRuntimeToolJsonSchema,
  makeBrowserRuntimeToolHandler,
} from "./BrowserRuntimeToolHelpers.ts";
import type { ProviderRuntimeToolRegistryShape } from "./ProviderRuntimeToolRegistry.ts";

const sessionFields = {
  sessionId: z.string().describe("Browser session id returned by browser_open."),
  tabId: z.string().optional().describe("Optional browser tab id."),
};

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

export function makeCopilotBrowserTools(options: {
  readonly threadId: ThreadId;
  readonly executeBrowserTool: ProviderRuntimeToolRegistryShape["executeBrowserTool"];
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly readArtifactData?: (
    artifactId: import("@ryco/contracts").BrowserArtifactId,
  ) => Promise<Uint8Array | null>;
}) {
  return BROWSER_RUNTIME_TOOL_DEFINITIONS.map((definition) => {
    const handler = makeBrowserRuntimeToolHandler({
      toolName: definition.name,
      threadId: options.threadId,
      executeBrowserTool: options.executeBrowserTool,
      runPromise: options.runPromise,
      ...(options.readArtifactData ? { readArtifactData: options.readArtifactData } : {}),
    });
    return defineTool(definition.name, {
      description: definition.description,
      parameters: zodSchemaForBrowserTool(definition.name),
      skipPermission: true,
      handler: async (args) => {
        const result = await handler(args as Record<string, unknown>);
        return convertMcpCallToolResult({
          content: [...result.content],
          ...(result.isError === true ? { isError: true as const } : {}),
        });
      },
    });
  });
}

export function copilotBrowserToolParameters(
  name: BrowserRuntimeToolName,
): Record<string, unknown> {
  const definition = BROWSER_RUNTIME_TOOL_DEFINITIONS.find((entry) => entry.name === name);
  return definition ? browserRuntimeToolJsonSchema(definition) : { type: "object" };
}
