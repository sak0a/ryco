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
  decodeGrokMcpServer,
  makeGrokMcpAdapter,
  type GrokMcpAdapterIo,
} from "./GrokMcpAdapter.ts";

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
      [ProviderInstanceId.make("grok")]: {
        driver: "grok",
        displayName: "Grok",
        enabled: true,
        config: { binaryPath: "/test/grok" },
      },
    },
  });
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(settingsLayer, ServerConfig.layerTest("/tmp/project", "grok-mcp-test")).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
  );
}

function makeIo(initial: Record<string, Record<string, unknown>> = {}) {
  const servers = structuredClone(initial);
  const calls: ReadonlyArray<string>[] = [];
  const io: GrokMcpAdapterIo = {
    run: async (_command, args) => {
      calls.push(args);
      if (args[1] === "list") return success(JSON.stringify(Object.values(servers)));
      if (args[1] === "doctor") {
        return success(
          JSON.stringify({
            servers: Object.keys(servers).map((name) => ({ name, healthy: true, checks: [] })),
          }),
        );
      }
      if (args[1] === "remove") {
        delete servers[args[4]!];
        return success();
      }
      if (args[1] === "enable" || args[1] === "disable") {
        const server = servers[args[2]!];
        if (server) server.enabled = args[1] === "enable";
        return success();
      }
      if (args[1] === "add") {
        const separator = args.indexOf("--");
        if (separator >= 0) {
          const name = args[separator - 1]!;
          const env: Record<string, string> = {};
          for (let index = 4; index < separator - 1; index += 1) {
            if (args[index] === "--env") {
              const [key, ...value] = args[index + 1]!.split("=");
              env[key!] = value.join("=");
            }
          }
          servers[name] = {
            name,
            command: args[separator + 1],
            args: args.slice(separator + 2),
            env,
            enabled: true,
            scope: "user",
          };
        }
        return success();
      }
      return success();
    },
  };
  return { io, calls, servers };
}

describe("Grok MCP config decoding", () => {
  it("normalizes stdio and HTTP list entries", () => {
    expect(
      decodeGrokMcpServer({ command: "node", args: ["server.js"], env: { TOKEN: "canary" } }),
    ).toMatchObject({ transport: "stdio", command: "node", env: { TOKEN: "canary" } });
    expect(
      decodeGrokMcpServer({
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer canary" },
      }),
    ).toMatchObject({ transport: "http", url: "https://example.test/mcp" });
  });
});

describe("GrokMcpAdapter", () => {
  it("reports native health while redacting secrets and keeps internal injection unsupported", async () => {
    const { io } = makeIo({
      tools: {
        name: "tools",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "grok-secret-canary" },
        enabled: true,
        scope: "user",
      },
    });
    const result = await runAdapter(
      Effect.gen(function* () {
        const adapter = yield* makeGrokMcpAdapter(io);
        const discovery = yield* adapter.listWorkspaces;
        const listed = yield* adapter.listServers!({
          workspaceId: discovery.workspaces[0]!.id,
          detail: "full",
        });
        return { discovery, listed };
      }),
    );

    expect(result.discovery.workspaces[0]?.capabilities).toMatchObject({
      health: "available",
      externalAgentControl: "available",
      automaticAgentControl: "unavailable",
    });
    expect(result.listed.servers[0]?.startupStatus).toBe("ready");
    expect(result.listed.servers[0]?.config.secretFields).toEqual({ "env.TOKEN": "present" });
    expect(JSON.stringify(result)).not.toContain("grok-secret-canary");
  });

  it("installs and removes the external bridge through native commands", async () => {
    const { io, calls, servers } = makeIo();
    const result = await runAdapter(
      Effect.gen(function* () {
        const adapter = yield* makeGrokMcpAdapter(io);
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
        const removed = yield* external.remove({
          workspaceId,
          name: desired.name,
          expectedFingerprint: installed.fingerprint,
        });
        return removed;
      }),
    );

    expect(result).toEqual({ removed: true, preservedUserChanges: false });
    expect(servers.ryco).toBeUndefined();
    expect(calls.some((args) => args[1] === "add" && args.includes("/runtime/node"))).toBe(true);
    expect(calls.some((args) => args.join(" ").includes("mcp remove --scope user ryco"))).toBe(
      true,
    );
  });
});
