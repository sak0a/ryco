import type { BrowserLoadState, ProviderDriverKind, ThreadId } from "@ryco/contracts";
import {
  BrowserInputAction,
  BrowserServiceError,
  BrowserSessionId,
  BrowserTabId,
  ProjectId,
} from "@ryco/contracts";
import { Effect, Schema } from "effect";

import type { BrowserServiceShape } from "../../browser/BrowserService.ts";

export type BrowserRuntimeToolName =
  | "browser_open"
  | "browser_navigate"
  | "browser_back"
  | "browser_forward"
  | "browser_reload"
  | "browser_stop"
  | "browser_input"
  | "browser_snapshot"
  | "browser_screenshot"
  | "browser_console"
  | "browser_network"
  | "browser_wait_for";

export type BrowserRuntimeToolCallResult = unknown;

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
  readonly timeoutMs?: number;
  readonly title?: string;
  readonly text?: string;
  readonly textGone?: string;
  readonly loadState?: BrowserLoadState;
  readonly source?: "ui" | "agent";
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
    description:
      "Send a bounded click (x/y or DOM ref from browser_snapshot), type, key, or scroll action to the Ryco browser tab.",
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
  {
    name: "browser_snapshot",
    description:
      "Capture a structured DOM snapshot with URL, title, viewport, visible text, and accessibility-like node refs.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a bounded PNG screenshot reference for the active Ryco browser tab.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_console",
    description: "Read recent console messages from the active Ryco browser tab.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_network",
    description: "Read recent network request summaries from the active Ryco browser tab.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: { sessionId: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_wait_for",
    description:
      "Wait until the browser tab matches URL, title, load state, or visible text conditions.",
    input: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "string" },
        timeoutMs: { type: "number" },
        url: { type: "string" },
        title: { type: "string" },
        text: { type: "string" },
        textGone: { type: "string" },
        loadState: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];

const UNSUPPORTED_PROVIDER_REASON =
  "Browser runtime tools are defined server-side, but this provider adapter does not yet have a tool-injection path wired to Ryco.";

const CODEX_BROWSER_UNSUPPORTED_REASON =
  "Codex app-server schema does not yet expose dynamicTools on thread/start, so Ryco cannot advertise browser tools to the model.";

const BROWSER_RUNTIME_TOOL_NAMES = new Set<BrowserRuntimeToolName>(
  BROWSER_RUNTIME_TOOL_DEFINITIONS.map((definition) => definition.name),
);

export function isBrowserRuntimeToolName(toolName: string): toolName is BrowserRuntimeToolName {
  return (
    toolName.startsWith("browser_") &&
    BROWSER_RUNTIME_TOOL_NAMES.has(toolName as BrowserRuntimeToolName)
  );
}

function readBrowserToolArgumentRecord(argumentsValue: unknown): Record<string, unknown> {
  if (argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue)) {
    return argumentsValue as Record<string, unknown>;
  }
  return {};
}

function readBrowserToolArgumentString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBrowserToolArgumentNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBrowserToolLoadState(value: unknown): BrowserLoadState | undefined {
  if (value === "idle" || value === "loading" || value === "loaded" || value === "failed") {
    return value;
  }
  return undefined;
}

export function parseBrowserRuntimeToolCallInput(input: {
  readonly toolName: string;
  readonly threadId: ThreadId;
  readonly arguments: unknown;
}): Effect.Effect<BrowserRuntimeToolCallInput, BrowserRuntimeToolError> {
  if (!input.toolName.startsWith("browser_")) {
    return Effect.fail(
      new BrowserRuntimeToolError({
        code: "unsupported_tool",
        message: `Unsupported tool '${input.toolName}'.`,
      }),
    );
  }
  if (!isBrowserRuntimeToolName(input.toolName)) {
    return Effect.fail(
      new BrowserRuntimeToolError({
        code: "unsupported_tool",
        message: `Unknown browser tool '${input.toolName}'.`,
      }),
    );
  }

  const args = readBrowserToolArgumentRecord(input.arguments);
  const sessionId = readBrowserToolArgumentString(args.sessionId);
  const tabId = readBrowserToolArgumentString(args.tabId);
  const url =
    readBrowserToolArgumentString(args.url) ?? readBrowserToolArgumentString(args.initialUrl);
  const projectId = readBrowserToolArgumentString(args.projectId);
  const timeoutMs = readBrowserToolArgumentNumber(args.timeoutMs);
  const title = readBrowserToolArgumentString(args.title);
  const text = readBrowserToolArgumentString(args.text);
  const textGone = readBrowserToolArgumentString(args.textGone);
  const loadState = readBrowserToolLoadState(args.loadState);

  const callInput = {
    name: input.toolName,
    threadId: input.threadId,
    source: "agent" as const,
    ...(projectId ? { projectId: ProjectId.make(projectId) } : {}),
    ...(sessionId ? { sessionId: BrowserSessionId.make(sessionId) } : {}),
    ...(tabId ? { tabId: BrowserTabId.make(tabId) } : {}),
    ...(url ? { url } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(title ? { title } : {}),
    ...(text ? { text } : {}),
    ...(textGone ? { textGone } : {}),
    ...(loadState ? { loadState } : {}),
  } satisfies BrowserRuntimeToolCallInput;

  if (input.toolName === "browser_input") {
    const action = args.action;
    if (!Schema.is(BrowserInputAction)(action)) {
      return Effect.fail(
        new BrowserRuntimeToolError({
          code: "unsupported_tool",
          message: "browser_input requires a valid input action.",
        }),
      );
    }
    return Effect.succeed({
      ...callInput,
      action,
    });
  }

  return Effect.succeed(callInput);
}

export function resolveProviderBrowserToolSupport(
  provider: ProviderDriverKind,
): ProviderBrowserToolSupport {
  if (String(provider) === "codex") {
    return {
      supported: false,
      reason: CODEX_BROWSER_UNSUPPORTED_REASON,
      definitions: [],
    };
  }

  if (String(provider) === "claudeAgent") {
    return {
      supported: true,
      definitions: BROWSER_RUNTIME_TOOL_DEFINITIONS,
    };
  }

  if (String(provider) === "copilot") {
    return {
      supported: true,
      definitions: BROWSER_RUNTIME_TOOL_DEFINITIONS,
    };
  }

  if (String(provider) === "opencode") {
    return {
      supported: true,
      definitions: BROWSER_RUNTIME_TOOL_DEFINITIONS,
    };
  }

  if (String(provider) === "cursor") {
    return {
      supported: true,
      definitions: BROWSER_RUNTIME_TOOL_DEFINITIONS,
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
): Effect.Effect<BrowserRuntimeToolCallResult, BrowserRuntimeToolCallError> {
  const requireSession = (toolName: BrowserRuntimeToolName) => {
    if (!input.sessionId) {
      return Effect.fail(
        new BrowserRuntimeToolError({
          code: "missing_session",
          message: `${toolName} requires a browser session id.`,
        }),
      );
    }
    return Effect.succeed(input.sessionId);
  };

  switch (input.name) {
    case "browser_open":
      return browser.openSession({
        threadId: input.threadId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        profileMode: "thread",
        ...(input.url ? { initialUrl: input.url } : {}),
        ...(input.source ? { source: input.source } : {}),
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
        ...(input.source ? { source: input.source } : {}),
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
    case "browser_snapshot":
      return Effect.gen(function* () {
        const sessionId = yield* requireSession("browser_snapshot");
        return yield* browser.snapshotDom({
          sessionId,
          ...(input.tabId ? { tabId: input.tabId } : {}),
        });
      });
    case "browser_screenshot":
      return Effect.gen(function* () {
        const sessionId = yield* requireSession("browser_screenshot");
        return yield* browser.screenshot({
          sessionId,
          ...(input.tabId ? { tabId: input.tabId } : {}),
        });
      });
    case "browser_console":
      return Effect.gen(function* () {
        const sessionId = yield* requireSession("browser_console");
        return yield* browser.readConsole({
          sessionId,
          ...(input.tabId ? { tabId: input.tabId } : {}),
        });
      });
    case "browser_network":
      return Effect.gen(function* () {
        const sessionId = yield* requireSession("browser_network");
        return yield* browser.readNetwork({
          sessionId,
          ...(input.tabId ? { tabId: input.tabId } : {}),
        });
      });
    case "browser_wait_for":
      return Effect.gen(function* () {
        const sessionId = yield* requireSession("browser_wait_for");
        return yield* browser.waitFor({
          sessionId,
          ...(input.tabId ? { tabId: input.tabId } : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          ...(input.url ? { url: input.url } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.text ? { text: input.text } : {}),
          ...(input.textGone ? { textGone: input.textGone } : {}),
          ...(input.loadState ? { loadState: input.loadState } : {}),
        });
      });
  }
}
