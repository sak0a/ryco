import { ProviderDriverKind } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  claudeBrowserMcpToolName,
  isClaudeBrowserMcpToolName,
  listClaudeBrowserMcpToolNames,
  mapBrowserRuntimeToolResultToCallToolResult,
  parseClaudeBrowserMcpToolName,
} from "./ClaudeBrowserRuntimeTools.ts";
import {
  BROWSER_RUNTIME_TOOL_DEFINITIONS,
  resolveProviderBrowserToolSupport,
} from "./BrowserRuntimeTool.ts";

describe("ClaudeBrowserRuntimeTools", () => {
  it("reports Claude browser tools as supported with shared definitions", () => {
    const claude = resolveProviderBrowserToolSupport(ProviderDriverKind.make("claudeAgent"));

    expect(claude.supported).toBe(true);
    expect(claude.definitions.map((definition) => definition.name)).toEqual(
      BROWSER_RUNTIME_TOOL_DEFINITIONS.map((definition) => definition.name),
    );
  });

  it("builds MCP tool names for the Ryco browser server", () => {
    expect(claudeBrowserMcpToolName("browser_open")).toBe("mcp__ryco__browser_open");
    expect(listClaudeBrowserMcpToolNames()).toContain("mcp__ryco__browser_navigate");
  });

  it("recognizes and parses Claude MCP browser tool names", () => {
    expect(isClaudeBrowserMcpToolName("mcp__ryco__browser_open")).toBe(true);
    expect(parseClaudeBrowserMcpToolName("mcp__ryco__browser_open")).toBe("browser_open");
    expect(isClaudeBrowserMcpToolName("browser_open")).toBe(false);
    expect(parseClaudeBrowserMcpToolName("mcp__ryco__browser_not_a_tool")).toBeUndefined();
  });

  it("maps browser runtime results into Claude MCP CallToolResult payloads", () => {
    const snapshot = {
      sessionId: "browser-session:test",
      status: "ready",
    };

    expect(
      mapBrowserRuntimeToolResultToCallToolResult({
        success: true,
        result: snapshot,
      }),
    ).toEqual({
      content: [{ type: "text", text: JSON.stringify(snapshot) }],
      structuredContent: snapshot,
    });

    expect(
      mapBrowserRuntimeToolResultToCallToolResult({
        success: false,
        message: "browser_navigate requires a browser session id.",
      }),
    ).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "browser_navigate requires a browser session id." }),
        },
      ],
      isError: true,
    });
  });
});
