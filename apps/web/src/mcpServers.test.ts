import { describe, expect, it } from "vite-plus/test";

import { formFromMcpServer, secretMutationsFromMcpServerForm } from "./mcpServers";

const server = {
  name: "tools",
  config: {
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    cwd: null,
    env: {},
    envVars: [],
    httpHeaders: {},
    envHttpHeaders: {},
    enabled: true,
    enabledTools: [],
    disabledTools: [],
    oauthScopes: [],
    secretFields: { "env.API_TOKEN": "present", "header.Authorization": "present" },
  },
  source: "user",
  startupStatus: "unknown",
  authStatus: "unknown",
  tools: [],
  resources: [],
  resourceTemplates: [],
} as const;

describe("MCP server form secrets", () => {
  it("hydrates presence only and expresses retain or clear explicitly", () => {
    const form = formFromMcpServer(server as never);
    expect(form.envText).toBe("");
    expect(form.httpHeadersText).toBe("");
    expect(form.secretFields).toEqual(["env.API_TOKEN", "header.Authorization"]);
    expect(secretMutationsFromMcpServerForm(form)).toEqual({
      "env.API_TOKEN": { action: "retain" },
      "header.Authorization": { action: "retain" },
    });
    expect(
      secretMutationsFromMcpServerForm({
        ...form,
        clearedSecretFields: ["env.API_TOKEN"],
      }),
    ).toEqual({
      "env.API_TOKEN": { action: "clear" },
      "header.Authorization": { action: "retain" },
    });
  });
});
