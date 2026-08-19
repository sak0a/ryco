import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
import { ServerSettingsService } from "../../serverSettings.ts";
import { decodeCursorMcpServer, makeCursorMcpAdapter } from "./CursorMcpAdapter.ts";

async function runAdapter<A>(
  homePath: string,
  cwd: string,
  effect: Effect.Effect<
    A,
    McpSettingsError | ServerSettingsError,
    ServerSettingsService | ServerConfig
  >,
) {
  const settingsLayer = ServerSettingsService.layerTest({
    providerInstances: {
      [ProviderInstanceId.make("cursor")]: {
        driver: "cursor",
        displayName: "Cursor",
        enabled: true,
        environment: [{ name: "HOME", value: homePath, sensitive: false }],
        config: { binaryPath: "/test/cursor-agent" },
      },
    },
  });
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(settingsLayer, ServerConfig.layerTest(cwd, "cursor-mcp-test")).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
  );
}

describe("Cursor MCP config decoding", () => {
  it("normalizes the documented stdio and remote shapes", () => {
    expect(
      decodeCursorMcpServer({
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "canary" },
      }),
    ).toMatchObject({ transport: "stdio", command: "node", env: { TOKEN: "canary" } });
    expect(
      decodeCursorMcpServer({
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer canary" },
      }),
    ).toMatchObject({ transport: "http", url: "https://example.test/mcp" });
  });
});

describe("CursorMcpAdapter", () => {
  it("discovers global and project scopes and preserves unknown JSON fields and secrets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ryco-cursor-mcp-"));
    const homePath = path.join(root, "home");
    const cwd = path.join(root, "project");
    const configPath = path.join(homePath, ".cursor", "mcp.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          unknownRoot: { keep: true },
          mcpServers: {
            tools: {
              type: "stdio",
              command: "node",
              args: ["old.js"],
              env: { API_TOKEN: "cursor-secret-canary" },
              envFile: ".env.keep",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const result = await runAdapter(
      homePath,
      cwd,
      Effect.gen(function* () {
        const adapter = yield* makeCursorMcpAdapter();
        const discovery = yield* adapter.listWorkspaces;
        const global = discovery.workspaces.find((workspace) => workspace.nativeScope === "user")!;
        const project = discovery.workspaces.find(
          (workspace) => workspace.nativeScope === "project",
        )!;
        const listed = yield* adapter.listServers!({ workspaceId: global.id, detail: "full" });
        const tools = listed.servers[0]!;
        const updated = yield* adapter.upsertServer!({
          workspaceId: global.id,
          name: tools.name,
          config: { ...tools.config, args: ["new.js"] },
          secretMutations: { "env.API_TOKEN": { action: "retain" } },
        });
        return { discovery, global, project, listed, updated };
      }),
    );

    expect(result.discovery.workspaces).toHaveLength(2);
    expect(result.global.capabilities.externalAgentControl).toBe("available");
    expect(result.project.capabilities.externalAgentControl).toBe("unavailable");
    expect(result.listed.servers[0]?.config.env).toEqual({});
    expect(result.listed.servers[0]?.config.secretFields).toEqual({
      "env.API_TOKEN": "present",
    });
    expect(JSON.stringify(result)).not.toContain("cursor-secret-canary");
    const written = JSON.parse(await readFile(configPath, "utf8")) as Record<string, any>;
    expect(written.unknownRoot).toEqual({ keep: true });
    expect(written.mcpServers.tools.envFile).toBe(".env.keep");
    expect(written.mcpServers.tools.env.API_TOKEN).toBe("cursor-secret-canary");
    expect(written.mcpServers.tools.args).toEqual(["new.js"]);
  });

  it("installs and safely removes external Agent Control in the global profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ryco-cursor-mcp-"));
    const homePath = path.join(root, "home");
    const cwd = path.join(root, "project");

    const result = await runAdapter(
      homePath,
      cwd,
      Effect.gen(function* () {
        const adapter = yield* makeCursorMcpAdapter();
        const discovery = yield* adapter.listWorkspaces;
        const workspaceId = discovery.workspaces.find(
          (workspace) => workspace.nativeScope === "user",
        )!.id;
        const external = adapter.externalAgentControl!;
        const desired = {
          workspaceId,
          name: McpServerName.make("ryco"),
          command: "/runtime/node",
          args: ["/runtime/ryco", "mcp", "serve"],
        };
        const installed = yield* external.install({ ...desired, expectedFingerprint: null });
        return yield* external.remove({
          workspaceId,
          name: desired.name,
          expectedFingerprint: installed.fingerprint,
        });
      }),
    );

    expect(result).toEqual({ removed: true, preservedUserChanges: false });
  });
});
