import type { BrowserArtifactId, BrowserArtifactRef, ThreadId } from "@ryco/contracts";
import { Effect } from "effect";

import { BrowserArtifactStore } from "../../browser/BrowserArtifactStore.ts";
import {
  type BrowserRuntimeToolCallError,
  type BrowserRuntimeToolDefinition,
  type BrowserRuntimeToolName,
  parseBrowserRuntimeToolCallInput,
} from "./BrowserRuntimeTool.ts";
import type { ProviderRuntimeToolRegistryShape } from "./ProviderRuntimeToolRegistry.ts";

export const RYCO_BROWSER_MCP_SERVER_NAME = "ryco";
export const CLAUDE_BROWSER_MCP_SERVER_NAME = RYCO_BROWSER_MCP_SERVER_NAME;

export function formatBrowserRuntimeToolCallError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return "Browser runtime tool call failed.";
}

export type BrowserRuntimeToolCallToolResultContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export type BrowserRuntimeToolCallToolResult = {
  readonly content: ReadonlyArray<BrowserRuntimeToolCallToolResultContent>;
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
};

function readScreenshotArtifact(result: unknown): BrowserArtifactRef | undefined {
  if (!result || typeof result !== "object" || !("artifact" in result)) {
    return undefined;
  }
  const artifact = (result as { readonly artifact?: unknown }).artifact;
  if (
    !artifact ||
    typeof artifact !== "object" ||
    !("artifactId" in artifact) ||
    !("mimeType" in artifact) ||
    typeof artifact.artifactId !== "string" ||
    typeof artifact.mimeType !== "string"
  ) {
    return undefined;
  }
  return artifact as BrowserArtifactRef;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function readBrowserArtifactDataEffect(
  artifactId: BrowserArtifactId,
): Effect.Effect<Uint8Array | null, Error, BrowserArtifactStore> {
  return Effect.gen(function* () {
    const store = yield* BrowserArtifactStore;
    return yield* store.readData(artifactId);
  });
}

export async function enrichBrowserRuntimeToolCallToolResult(input: {
  readonly toolName: BrowserRuntimeToolName;
  readonly result: BrowserRuntimeToolCallToolResult;
  readonly readArtifactData?: (artifactId: BrowserArtifactId) => Promise<Uint8Array | null>;
}): Promise<BrowserRuntimeToolCallToolResult> {
  if (
    input.toolName !== "browser_screenshot" ||
    input.result.isError ||
    !input.readArtifactData ||
    input.result.content.length === 0
  ) {
    return input.result;
  }

  const structured = input.result.structuredContent;
  const artifact = readScreenshotArtifact(structured ?? null);
  if (!artifact) {
    return input.result;
  }

  const bytes = await input.readArtifactData(artifact.artifactId);
  if (!bytes || bytes.byteLength === 0) {
    return input.result;
  }

  return {
    ...input.result,
    content: [
      ...input.result.content,
      {
        type: "image",
        data: uint8ArrayToBase64(bytes),
        mimeType: artifact.mimeType,
      },
    ],
  };
}

export function mapBrowserRuntimeToolResultToCallToolResult(
  input:
    | {
        readonly success: true;
        readonly result: unknown;
      }
    | {
        readonly success: false;
        readonly message: string;
      },
): BrowserRuntimeToolCallToolResult {
  if (input.success) {
    return {
      content: [{ type: "text", text: JSON.stringify(input.result) }],
      structuredContent:
        input.result !== null && typeof input.result === "object"
          ? (input.result as Record<string, unknown>)
          : { result: input.result },
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ error: input.message }) }],
    isError: true,
  };
}

export function makeBrowserRuntimeToolHandler(options: {
  readonly toolName: BrowserRuntimeToolName;
  readonly threadId: ThreadId;
  readonly executeBrowserTool: ProviderRuntimeToolRegistryShape["executeBrowserTool"];
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly readArtifactData?: (artifactId: BrowserArtifactId) => Promise<Uint8Array | null>;
}): (args: Record<string, unknown>) => Promise<BrowserRuntimeToolCallToolResult> {
  return async (args) => {
    try {
      const toolInput = await options.runPromise(
        parseBrowserRuntimeToolCallInput({
          toolName: options.toolName,
          threadId: options.threadId,
          arguments: args,
        }),
      );
      const result = await options.runPromise(options.executeBrowserTool(toolInput));
      const mapped = mapBrowserRuntimeToolResultToCallToolResult({ success: true, result });
      return await enrichBrowserRuntimeToolCallToolResult({
        toolName: options.toolName,
        result: mapped,
        ...(options.readArtifactData ? { readArtifactData: options.readArtifactData } : {}),
      });
    } catch (cause) {
      return mapBrowserRuntimeToolResultToCallToolResult({
        success: false,
        message: formatBrowserRuntimeToolCallError(cause as BrowserRuntimeToolCallError),
      });
    }
  };
}

export function browserRuntimeToolJsonSchema(
  definition: BrowserRuntimeToolDefinition,
): Record<string, unknown> {
  return definition.input;
}
