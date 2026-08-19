import { describe, expect, it } from "vite-plus/test";

import { probeExternalMcpCommand } from "./probe.ts";

const fakeBridge = (toolNames: ReadonlyArray<string>) => `
let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let newline = pending.indexOf("\\n");
  while (newline >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    const request = JSON.parse(line);
    if (request.id === 1) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "ryco-external-agent-control", version: "1.0.0" }
        }
      }) + "\\n");
    }
    if (request.id === 2) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: ${JSON.stringify(toolNames)}.map((name) => ({ name, inputSchema: {} })) }
      }) + "\\n");
    }
    newline = pending.indexOf("\\n");
  }
});
`;

const expectedTools = [
  "ryco_overview",
  "ryco_capabilities",
  "ryco_list_allowed_projects",
  "ryco_create_task",
  "ryco_read_task",
  "ryco_wait_for_task",
];

describe("external MCP protocol probe", () => {
  it("initializes the installed command and verifies its tool catalog", async () => {
    const result = await probeExternalMcpCommand({
      command: process.execPath,
      args: ["-e", fakeBridge(expectedTools)],
      cwd: process.cwd(),
    });

    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.toolNames).toEqual(expectedTools);
  });

  it("fails when the bridge omits an expected Agent Control tool", async () => {
    await expect(
      probeExternalMcpCommand({
        command: process.execPath,
        args: ["-e", fakeBridge(expectedTools.slice(0, -1))],
        cwd: process.cwd(),
      }),
    ).rejects.toThrow("protocol verification failed");
  });
});
