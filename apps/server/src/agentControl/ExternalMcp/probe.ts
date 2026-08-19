import { spawn } from "node:child_process";

import { AGENT_CONTROL_EXTERNAL_MCP_TOOLS } from "@ryco/contracts";

import { AGENT_CONTROL_MCP_PROTOCOL_VERSIONS } from "../Mcp/listener.ts";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_OUTPUT_BYTES = 512 * 1024;
const REQUIRED_TOOL_NAMES = [
  AGENT_CONTROL_EXTERNAL_MCP_TOOLS.overview,
  AGENT_CONTROL_EXTERNAL_MCP_TOOLS.capabilities,
  AGENT_CONTROL_EXTERNAL_MCP_TOOLS.listAllowedProjects,
  AGENT_CONTROL_EXTERNAL_MCP_TOOLS.createTask,
  AGENT_CONTROL_EXTERNAL_MCP_TOOLS.readTask,
  AGENT_CONTROL_EXTERNAL_MCP_TOOLS.waitForTask,
] as const;

export interface ExternalMcpProtocolProbeInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}

export interface ExternalMcpProtocolProbeResult {
  readonly protocolVersion: string;
  readonly toolNames: ReadonlyArray<string>;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requestLine = (value: Record<string, unknown>): string => `${JSON.stringify(value)}\n`;

/**
 * Launch the exact command written to the provider config and prove that it is
 * a usable Ryco MCP bridge. No subprocess output is included in errors because
 * provider launchers can echo paths or environment-derived diagnostics.
 */
export function probeExternalMcpCommand(
  input: ExternalMcpProtocolProbeInput,
): Promise<ExternalMcpProtocolProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let pending = "";
    let outputBytes = 0;
    let protocolVersion: string | null = null;

    const finish = (error: Error | null, result?: ExternalMcpProtocolProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve(result!);
    };

    const fail = () => finish(new Error("External MCP protocol verification failed."));
    const send = (value: Record<string, unknown>) => {
      if (!child.stdin.writable) return fail();
      child.stdin.write(requestLine(value), (error) => {
        if (error) fail();
      });
    };

    const handleLine = (line: string) => {
      if (line.trim().length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        return fail();
      }
      const response = record(parsed);
      if (!response || response.error !== undefined) return fail();
      const result = record(response.result);
      if (!result) return fail();
      if (response.id === 1) {
        const negotiated = result.protocolVersion;
        const serverInfo = record(result.serverInfo);
        if (
          typeof negotiated !== "string" ||
          !AGENT_CONTROL_MCP_PROTOCOL_VERSIONS.includes(
            negotiated as (typeof AGENT_CONTROL_MCP_PROTOCOL_VERSIONS)[number],
          ) ||
          serverInfo?.name !== "ryco-external-agent-control"
        ) {
          return fail();
        }
        protocolVersion = negotiated;
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      if (response.id !== 2 || protocolVersion === null || !Array.isArray(result.tools)) {
        return fail();
      }
      const toolNames = result.tools.flatMap((tool) => {
        const descriptor = record(tool);
        return typeof descriptor?.name === "string" ? [descriptor.name] : [];
      });
      if (!REQUIRED_TOOL_NAMES.every((name) => toolNames.includes(name))) return fail();
      finish(null, { protocolVersion, toolNames });
    };

    const timeout = setTimeout(fail, PROBE_TIMEOUT_MS);
    child.once("error", fail);
    child.once("exit", () => {
      if (!settled) fail();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > PROBE_MAX_OUTPUT_BYTES) fail();
    });
    child.stdout.on("data", (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > PROBE_MAX_OUTPUT_BYTES) return fail();
      pending += chunk.toString();
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        handleLine(line);
        if (settled) break;
        newline = pending.indexOf("\n");
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: AGENT_CONTROL_MCP_PROTOCOL_VERSIONS[0],
        capabilities: {},
        clientInfo: { name: "ryco-installer-verification", version: "1.0.0" },
      },
    });
  });
}
