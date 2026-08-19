import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  McpServerName,
  ProviderInstanceId,
  type McpSettingsError,
  type ServerSettingsError,
} from "@ryco/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import type { ProcessRunResult } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  decodeCopilotMcpServer,
  makeCopilotMcpAdapter,
  type CopilotMcpAdapterIo,
} from "./CopilotMcpAdapter.ts";

const success = (stdout = ""): ProcessRunResult => ({
  stdout,
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
});

function runAdapter<A>(
  effect: Effect.Effect<
    A,
    McpSettingsError | ServerSettingsError,
    ServerSettingsService | ServerConfig
  >,
) {
  const settingsLayer = ServerSettingsService.layerTest({
    providerInstances: {
      [ProviderInstanceId.make("copilot")]: {
        driver: "copilot",
        displayName: "Copilot",
        enabled: true,
        config: { binaryPath: "/test/copilot" },
      },
      [ProviderInstanceId.make("copilot_work")]: {
        driver: "copilot",
        displayName: "Copilot Work",
        enabled: true,
        config: { binaryPath: "/test/copilot" },
      },
    },
  });
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          settingsLayer,
          ServerConfig.layerTest("/tmp/project", "copilot-mcp-test"),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
      Effect.scoped,
    ),
  );
}

function makeIo(initial: Record<string, Record<string, unknown>> = {}) {
  const servers = structuredClone(initial);
  const calls: ReadonlyArray<string>[] = [];
  const io: CopilotMcpAdapterIo = {
    run: async (_command, args) => {
      calls.push(args);
      if (args[1] === "list") return success(JSON.stringify({ mcpServers: servers }));
      if (args[1] === "get") {
        const name = args[2]!;
        return success(JSON.stringify({ [name]: servers[name] }));
      }
      if (args[1] === "remove") {
        delete servers[args[2]!];
        return success();
      }
      if (args[1] === "add") {
        const separator = args.indexOf("--");
        if (separator >= 0) {
          const name = args[separator - 1]!;
          const env: Record<string, string> = {};
          for (let index = 2; index < separator - 1; index += 1) {
            if (args[index] === "--env") {
              const [key, ...value] = args[index + 1]!.split("=");
              env[key!] = value.join("=");
            }
          }
          servers[name] = {
            type: "local",
            command: args[separator + 1],
            args: args.slice(separator + 2),
            tools: ["*"],
            env,
            source: "user",
            enabled: true,
          };
        }
        return success();
      }
      return success();
    },
  };
  return { io, calls, servers };
}

describe("Copilot MCP config decoding", () => {
  it("normalizes local and HTTP server shapes", () => {
    expect(
      decodeCopilotMcpServer({
        type: "local",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "canary" },
        tools: ["search"],
      }),
    ).toMatchObject({
      transport: "stdio",
      command: "node",
      env: { TOKEN: "canary" },
      enabledTools: ["search"],
    });
    expect(
      decodeCopilotMcpServer({
        type: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer canary" },
      }),
    ).toMatchObject({ transport: "http", url: "https://example.test/mcp" });
  });
});

describe("CopilotMcpAdapter", () => {
  it("groups shared profiles and redacts native secret values", async () => {
    const { io } = makeIo({
      tools: {
        type: "local",
        command: "node",
        args: ["server.js"],
        env: { API_TOKEN: "copilot-secret-canary" },
        tools: ["*"],
        source: "user",
        enabled: true,
      },
    });
    const result = await runAdapter(
      Effect.gen(function* () {
        const adapter = yield* makeCopilotMcpAdapter(io);
        const discovery = yield* adapter.listWorkspaces;
        const listed = yield* adapter.listServers!({
          workspaceId: discovery.workspaces[0]!.id,
          detail: "full",
        });
        return { discovery, listed };
      }),
    );

    expect(result.discovery.workspaces).toHaveLength(1);
    expect(result.discovery.workspaces[0]?.providerInstances).toHaveLength(2);
    expect(result.discovery.workspaces[0]?.capabilities).toMatchObject({
      readConfiguration: "available",
      externalAgentControl: "available",
      automaticAgentControl: "available",
    });
    expect(result.listed.servers[0]?.config.env).toEqual({});
    expect(result.listed.servers[0]?.config.secretFields).toEqual({
      "env.API_TOKEN": "present",
    });
    expect(JSON.stringify(result)).not.toContain("copilot-secret-canary");
  });

  it("updates with rollback-safe native commands and supports external Agent Control", async () => {
    const { io, calls, servers } = makeIo();
    const result = await runAdapter(
      Effect.gen(function* () {
        const adapter = yield* makeCopilotMcpAdapter(io);
        const discovery = yield* adapter.listWorkspaces;
        const workspaceId = discovery.workspaces[0]!.id;
        const external = adapter.externalAgentControl!;
        const desired = {
          workspaceId,
          name: McpServerName.make("ryco"),
          command: "/runtime/node",
          args: ["/runtime/ryco", "mcp", "serve"],
        };
        const installed = yield* external.install({ ...desired, expectedFingerprint: null });
        const verified = yield* external.inspect(desired);
        const removed = yield* external.remove({
          workspaceId,
          name: desired.name,
          expectedFingerprint: installed.fingerprint,
        });
        return { verified, removed };
      }),
    );

    expect(result.verified.state).toBe("matching");
    expect(result.removed).toEqual({ removed: true, preservedUserChanges: false });
    expect(servers.ryco).toBeUndefined();
    expect(calls.some((args) => args[1] === "add" && args.includes("/runtime/node"))).toBe(true);
    expect(calls.some((args) => args.slice(0, 3).join(" ") === "mcp remove ryco")).toBe(true);
  });
});
