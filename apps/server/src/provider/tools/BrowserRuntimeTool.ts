import type {
  BrowserInputAction,
  BrowserSessionId,
  BrowserSessionSnapshot,
  BrowserTabId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
} from "@ryco/contracts";
import { BrowserServiceError } from "@ryco/contracts";
import { Effect, Schema } from "effect";

import type { BrowserServiceShape } from "../../browser/BrowserService.ts";

export type BrowserRuntimeToolName =
  | "browser_open"
  | "browser_navigate"
  | "browser_back"
  | "browser_forward"
  | "browser_reload"
  | "browser_stop"
  | "browser_input";

export interface BrowserRuntimeToolDefinition {
  readonly name: BrowserRuntimeToolName;
  readonly description: string;
  readonly input: Record<string, unknown>;
}

export interface ProviderBrowserToolSupport {
  readonly supported: boolean;
  readonly reason?: string;
  readonly definitions: ReadonlyArray<BrowserRuntimeToolDefinition>;
}

export class BrowserRuntimeToolError extends Schema.TaggedErrorClass<BrowserRuntimeToolError>()(
  "BrowserRuntimeToolError",
  {
    code: Schema.Literals(["unsupported_tool", "missing_session", "missing_url"]),
    message: Schema.String,
  },
) {}

export interface BrowserRuntimeToolCallInput {
  readonly name: BrowserRuntimeToolName;
  readonly threadId: ThreadId;
  readonly projectId?: ProjectId;
  readonly sessionId?: BrowserSessionId;
  readonly tabId?: BrowserTabId;
  readonly url?: string;
  readonly action?: BrowserInputAction;
}

export type BrowserRuntimeToolCallError = BrowserRuntimeToolError | BrowserServiceError;

export const BROWSER_RUNTIME_TOOL_DEFINITIONS: ReadonlyArray<BrowserRuntimeToolDefinition> = [
  {
    name: "browser_open",
    description: "Open or focus the isolated Ryco browser session for the current thread.",
    input: {
      type: "object",
      properties: {
        initialUrl: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate the active Ryco browser tab to an HTTP(S), file, or about:blank URL.",
    input: {
      type: "object",
      required: ["sessionId", "url"],
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "string" },
        url: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_back",
    description: "Go back in the active Ryco browser tab.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_forward",
    description: "Go forward in the active Ryco browser tab.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_reload",
    description: "Reload the active Ryco browser tab.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_stop",
    description: "Stop the active Ryco browser tab from loading.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_input",
    description: "Send a bounded click, type, key, or scroll action to the Ryco browser tab.",
    input: {
      type: "object",
      required: ["sessionId", "action"],
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "string" },
        action: { type: "object" },
      },
      additionalProperties: false,
    },
  },
];

const UNSUPPORTED_PROVIDER_REASON =
  "Browser runtime tools are defined server-side, but this provider adapter does not yet have a tool-injection path wired to Ryco.";

export function resolveProviderBrowserToolSupport(
  provider: ProviderDriverKind,
): ProviderBrowserToolSupport {
  if (String(provider) === "cursor") {
    return {
      supported: false,
      reason: "Cursor/ACP browser tools are unsupported until Ryco can inject ACP tools or MCP.",
      definitions: [],
    };
  }

  return {
    supported: false,
    reason: UNSUPPORTED_PROVIDER_REASON,
    definitions: [],
  };
}

export function executeBrowserRuntimeToolCall(
  browser: BrowserServiceShape,
  input: BrowserRuntimeToolCallInput,
): Effect.Effect<BrowserSessionSnapshot, BrowserRuntimeToolCallError> {
  switch (input.name) {
    case "browser_open":
      return browser.openSession({
        threadId: input.threadId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        profileMode: "thread",
        ...(input.url ? { initialUrl: input.url } : {}),
      });
    case "browser_navigate":
      if (!input.sessionId) {
        return Effect.fail(
          new BrowserRuntimeToolError({
            code: "missing_session",
            message: "browser_navigate requires a browser session id.",
          }),
        );
      }
      if (!input.url) {
        return Effect.fail(
          new BrowserRuntimeToolError({
            code: "missing_url",
            message: "browser_navigate requires a URL.",
          }),
        );
      }
      return browser.navigate({
        sessionId: input.sessionId,
        ...(input.tabId ? { tabId: input.tabId } : {}),
        url: input.url,
      });
    case "browser_back":
    case "browser_forward":
    case "browser_reload":
    case "browser_stop": {
      if (!input.sessionId) {
        return Effect.fail(
          new BrowserRuntimeToolError({
            code: "missing_session",
            message: `${input.name} requires a browser session id.`,
          }),
        );
      }
      const command = input.name.replace("browser_", "") as "back" | "forward" | "reload" | "stop";
      return browser[command]({
        sessionId: input.sessionId,
        ...(input.tabId ? { tabId: input.tabId } : {}),
      });
    }
    case "browser_input":
      if (!input.sessionId) {
        return Effect.fail(
          new BrowserRuntimeToolError({
            code: "missing_session",
            message: "browser_input requires a browser session id.",
          }),
        );
      }
      if (!input.action) {
        return Effect.fail(
          new BrowserRuntimeToolError({
            code: "unsupported_tool",
            message: "browser_input requires an input action.",
          }),
        );
      }
      return browser.input({
        sessionId: input.sessionId,
        ...(input.tabId ? { tabId: input.tabId } : {}),
        action: input.action,
      });
  }
}
