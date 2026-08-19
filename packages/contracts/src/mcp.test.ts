import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  McpProviderCapabilities,
  McpProviderSupport,
  McpServerConfig,
  McpServerUpsertInput,
  McpWorkspace,
} from "./mcp.ts";

describe("provider-neutral MCP contracts", () => {
  it("decodes a non-Codex workspace with explicit native capabilities", () => {
    const workspace = Schema.decodeUnknownSync(McpWorkspace)({
      id: "claudeAgent:dXNlcg",
      driver: "claudeAgent",
      providerDisplayName: "Claude",
      displayPath: "~/.claude.json",
      nativeScope: "user",
      formatGeneration: "claude-cli-v1",
      capabilities: {
        readConfiguration: "available",
        upsert: "available",
        remove: "available",
        enableDisable: "unavailable",
        reload: "unavailable",
        health: "unknown",
        inventory: "unavailable",
        oauth: "unavailable",
        externalAgentControl: "available",
        automaticAgentControl: "available",
        scopes: ["user", "project", "directory"],
      },
      providerMetadata: { cliVersion: "2.1.0", configurationKind: "native-cli" },
      sharedHomePath: "~",
      mode: "direct",
      selectedInstanceId: "claude",
      providerInstances: [{ instanceId: "claude", displayName: "Claude" }],
    });

    expect(workspace.driver).toBe("claudeAgent");
    expect(workspace.nativeScope).toBe("user");
    expect(workspace.capabilities.health).toBe("unknown");
    expect(workspace.providerMetadata.cliVersion).toBe("2.1.0");
  });

  it("defaults omitted capability entries to unavailable", () => {
    const capabilities = Schema.decodeUnknownSync(McpProviderCapabilities)({
      readConfiguration: "available",
      scopes: ["user"],
    });

    expect(capabilities.readConfiguration).toBe("available");
    expect(capabilities.upsert).toBe("unavailable");
    expect(capabilities.health).toBe("unavailable");
    expect(capabilities.scopes).toEqual(["user"]);
  });

  it("keeps legacy support status while exposing capabilities", () => {
    const provider = Schema.decodeUnknownSync(McpProviderSupport)({
      instanceId: "claude",
      driver: "claudeAgent",
      enabled: true,
      status: "external",
      capabilities: {
        externalAgentControl: "available",
        automaticAgentControl: "available",
      },
      message: "General MCP management is not installed yet.",
    });

    expect(provider.status).toBe("external");
    expect(provider.capabilities.externalAgentControl).toBe("available");
    expect(provider.capabilities.readConfiguration).toBe("unavailable");
  });
});

describe("MCP secret contracts", () => {
  it("reports secret presence without returning the value", () => {
    const config = Schema.decodeUnknownSync(McpServerConfig)({
      transport: "http",
      url: "https://mcp.example.test",
      secretFields: { "httpHeaders.Authorization": "present" },
    });

    expect(config.secretFields).toEqual({ "httpHeaders.Authorization": "present" });
    expect(JSON.stringify(config)).not.toContain("Bearer secret");
  });

  it("accepts retain, replace, and clear mutations but strips read-only raw config", () => {
    const input = Schema.decodeUnknownSync(McpServerUpsertInput)({
      workspaceId: "codex:dGVzdA",
      name: "example",
      config: {
        transport: "stdio",
        command: "example-mcp",
        rawConfig: { injected: true },
      },
      secretMutations: {
        API_TOKEN: { action: "retain" },
        NEXT_TOKEN: { action: "replace", value: "replacement" },
        OLD_TOKEN: { action: "clear" },
      },
    });

    expect("rawConfig" in input.config).toBe(false);
    expect(input.secretMutations?.API_TOKEN).toEqual({ action: "retain" });
    expect(input.secretMutations?.NEXT_TOKEN).toEqual({
      action: "replace",
      value: "replacement",
    });
    expect(input.secretMutations?.OLD_TOKEN).toEqual({ action: "clear" });
  });
});
