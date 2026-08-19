import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  McpServerName,
  ProviderInstanceId,
  type McpSettingsError,
  type ServerSettingsError,
} from "@ryco/contracts";
import { Effect, Layer, Path } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import type { ProcessRunResult } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  decodeClaudeMcpServer,
  makeClaudeMcpAdapter,
  readClaudeMcpEntry,
  type ClaudeMcpAdapterIo,
} from "./ClaudeMcpAdapter.ts";

const success: ProcessRunResult = {
  stdout: "",
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
};

function runAdapter<A>(
  effect: Effect.Effect<
    A,
    McpSettingsError | ServerSettingsError,
    ServerSettingsService | ServerConfig | Path.Path
  >,
  homePath = "/tmp/claude-test",
) {
  const settingsLayer = ServerSettingsService.layerTest({
    providerInstances: {
      [ProviderInstanceId.make("claudeAgent")]: {
        driver: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        config: { binaryPath: "/test/claude", homePath },
      },
      [ProviderInstanceId.make("claude_work")]: {
        driver: "claudeAgent",
        displayName: "Claude Work",
        enabled: true,
        config: { binaryPath: "/test/claude", homePath },
      },
    },
  });
  const testLayer = Layer.mergeAll(
    settingsLayer,
    ServerConfig.layerTest("/tmp/project", "claude-mcp-test"),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return Effect.runPromise(effect.pipe(Effect.provide(testLayer), Effect.scoped));
}

describe("Claude MCP config decoding", () => {
  it("normalizes a stdio entry and rejects mixed-type arguments", () => {
    expect(
      decodeClaudeMcpServer({
        type: "stdio",
        command: "node",
        args: ["bridge.js", "serve"],
        env: { MODE: "test" },
      }),
    ).toMatchObject({
      transport: "stdio",
      command: "node",
      args: ["bridge.js", "serve"],
      env: { MODE: "test" },
    });
    expect(decodeClaudeMcpServer({ command: "node", args: ["ok", 1] })).toBeNull();
  });

  it("reads only the named top-level MCP server", () => {
    const document = {
      unrelated: { keep: true },
      mcpServers: { ryco: { command: "node", args: ["bridge.js"] } },
    };
    expect(readClaudeMcpEntry(document, "ryco")?.command).toBe("node");
    expect(readClaudeMcpEntry(document, "other")).toBeNull();
  });
});

describe("ClaudeMcpAdapter external Agent Control", () => {
  it("groups provider instances sharing one Claude HOME", async () => {
    const io: ClaudeMcpAdapterIo = {
      run: async () => success,
      readText: async () => "{}",
    };
    const result = await runAdapter(
      Effect.gen(function* () {
        const adapter = yield* makeClaudeMcpAdapter(io);
        return yield* adapter.listWorkspaces;
      }),
    );

    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]?.driver).toBe("claudeAgent");
    expect(result.workspaces[0]?.providerInstances).toHaveLength(2);
    expect(result.workspaces[0]?.capabilities.externalAgentControl).toBe("available");
  });

  it("installs through the native CLI and preserves a user-modified entry on removal", async () => {
    let document: Record<string, unknown> = { unrelated: { keep: true }, mcpServers: {} };
    const calls: Array<{ command: string; args: ReadonlyArray<string>; home: string | undefined }> =
      [];
    const io: ClaudeMcpAdapterIo = {
      run: async (command, args, options) => {
        calls.push({ command, args, home: options.env.HOME });
        const root = document as { mcpServers: Record<string, unknown> };
        if (args[1] === "add") {
          const name = args[4]!;
          root.mcpServers[name] = { command: args[6], args: args.slice(7), env: {} };
        } else if (args[1] === "remove") {
          delete root.mcpServers[args[4]!];
        }
        return success;
      },
      readText: async () => JSON.stringify(document),
    };

    const result = await runAdapter(
      Effect.gen(function* () {
        const adapter = yield* makeClaudeMcpAdapter(io);
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
        (document as { mcpServers: Record<string, unknown> }).mcpServers.ryco = {
          command: "user-edited",
          args: [],
        };
        const preserved = yield* external.remove({
          workspaceId,
          name: desired.name,
          expectedFingerprint: installed.fingerprint,
        });
        return { installed, verified, preserved };
      }),
    );

    expect(result.verified.state).toBe("matching");
    expect(result.preserved).toEqual({ removed: false, preservedUserChanges: true });
    expect(calls[0]).toMatchObject({
      command: "/test/claude",
      home: "/tmp/claude-test",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "ryco",
        "--",
        "/runtime/node",
        "/runtime/ryco",
        "mcp",
        "serve",
      ],
    });
    expect(document.unrelated).toEqual({ keep: true });
  });
});
