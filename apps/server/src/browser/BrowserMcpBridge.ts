import { createConnection } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import * as nodePath from "node:path";

import type { ThreadId } from "@ryco/contracts";
import { Context, Effect, Layer, Ref } from "effect";

import {
  isBrowserRuntimeToolName,
  parseBrowserRuntimeToolCallInput,
} from "../provider/tools/BrowserRuntimeTool.ts";
import { formatBrowserRuntimeToolCallError } from "../provider/tools/BrowserRuntimeToolHelpers.ts";
import type { ProviderRuntimeToolRegistryShape } from "../provider/tools/ProviderRuntimeToolRegistry.ts";

const SOCKET_DIR = nodePath.join(process.env.TMPDIR ?? "/tmp", "ryco-browser-mcp");

interface BrowserMcpBridgeRequest {
  readonly id: string;
  readonly toolName: string;
  readonly arguments: unknown;
}

interface BrowserMcpBridgeResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly message?: string;
}

interface ActiveBridge {
  readonly threadId: ThreadId;
  readonly socketPath: string;
  readonly server: Server;
}

export interface BrowserMcpBridgeShape {
  readonly start: (input: {
    readonly threadId: ThreadId;
    readonly executeBrowserTool: ProviderRuntimeToolRegistryShape["executeBrowserTool"];
    readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  }) => Effect.Effect<{ readonly socketPath: string }, Error>;
  readonly stop: (threadId: ThreadId) => Effect.Effect<void>;
}

export class BrowserMcpBridge extends Context.Service<BrowserMcpBridge, BrowserMcpBridgeShape>()(
  "ryco/provider/tools/BrowserMcpBridge",
) {}

function readJsonLine(socket: Socket): Effect.Effect<BrowserMcpBridgeRequest | undefined> {
  return Effect.callback((resume) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      socket.off("data", onData);
      if (!line) {
        resume(Effect.succeed(undefined));
        return;
      }
      try {
        resume(Effect.succeed(JSON.parse(line) as BrowserMcpBridgeRequest));
      } catch {
        resume(Effect.succeed(undefined));
      }
    };
    socket.on("data", onData);
    socket.on("error", () => resume(Effect.succeed(undefined)));
    socket.on("close", () => resume(Effect.succeed(undefined)));
    return Effect.sync(() => {
      socket.off("data", onData);
    });
  });
}

function writeJsonLine(socket: Socket, payload: BrowserMcpBridgeResponse): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        socket.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    catch: () => new Error("Failed to write browser MCP bridge response."),
  }).pipe(
    Effect.asVoid,
    Effect.catch(() => Effect.void),
  );
}

export const BrowserMcpBridgeLive = Layer.effect(
  BrowserMcpBridge,
  Effect.gen(function* () {
    const bridgesRef = yield* Ref.make(new Map<ThreadId, ActiveBridge>());

    const stop = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const bridge = yield* Ref.modify(bridgesRef, (bridges) => {
          const existing = bridges.get(threadId);
          const next = new Map(bridges);
          next.delete(threadId);
          return [existing, next] as const;
        });
        if (!bridge) return;
        yield* Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve) => {
              bridge.server.close(() => resolve());
            }),
          catch: () => new Error("Failed to close browser MCP bridge server."),
        }).pipe(Effect.ignore);
        yield* Effect.tryPromise({
          try: () => rm(bridge.socketPath, { force: true }),
          catch: () => new Error("Failed to remove browser MCP bridge socket."),
        }).pipe(Effect.ignore);
      });

    const start: BrowserMcpBridgeShape["start"] = (input) =>
      Effect.gen(function* () {
        yield* stop(input.threadId);
        yield* Effect.tryPromise({
          try: () => mkdir(SOCKET_DIR, { recursive: true }),
          catch: () => new Error("Failed to create browser MCP bridge socket directory."),
        }).pipe(Effect.ignore);
        const socketId = crypto.randomUUID();
        const socketPath = nodePath.join(SOCKET_DIR, `${input.threadId}-${socketId}.sock`);
        yield* Effect.tryPromise({
          try: () => rm(socketPath, { force: true }),
          catch: () => new Error("Failed to remove stale browser MCP bridge socket."),
        }).pipe(Effect.ignore);

        const server = yield* Effect.tryPromise({
          try: () =>
            new Promise<Server>((resolve, reject) => {
              const nextServer = createServer((socket) => {
                void (async () => {
                  try {
                    const request = await input.runPromise(readJsonLine(socket));
                    if (!request || !isBrowserRuntimeToolName(request.toolName)) {
                      await input.runPromise(
                        writeJsonLine(socket, {
                          id: request?.id ?? "unknown",
                          ok: false,
                          message: "Unsupported browser MCP request.",
                        }),
                      );
                      socket.end();
                      return;
                    }
                    const parsed = await input.runPromise(
                      parseBrowserRuntimeToolCallInput({
                        toolName: request.toolName,
                        threadId: input.threadId,
                        arguments: request.arguments,
                      }).pipe(
                        Effect.catch((error) =>
                          Effect.succeed({
                            error: formatBrowserRuntimeToolCallError(error),
                          }),
                        ),
                      ),
                    );
                    if ("error" in parsed) {
                      await input.runPromise(
                        writeJsonLine(socket, {
                          id: request.id,
                          ok: false,
                          message: parsed.error,
                        }),
                      );
                      socket.end();
                      return;
                    }
                    try {
                      const value = await input.runPromise(input.executeBrowserTool(parsed));
                      await input.runPromise(
                        writeJsonLine(socket, {
                          id: request.id,
                          ok: true,
                          result: value,
                        }),
                      );
                    } catch (cause) {
                      await input.runPromise(
                        writeJsonLine(socket, {
                          id: request.id,
                          ok: false,
                          message: formatBrowserRuntimeToolCallError(cause),
                        }),
                      );
                    }
                    socket.end();
                  } catch {
                    socket.end();
                  }
                })();
              });
              nextServer.on("error", reject);
              nextServer.listen(socketPath, () => resolve(nextServer));
            }),
          catch: (cause) => cause as Error,
        });

        yield* Ref.update(bridgesRef, (bridges) => {
          const next = new Map(bridges);
          next.set(input.threadId, {
            threadId: input.threadId,
            socketPath,
            server,
          });
          return next;
        });

        return { socketPath };
      });

    return { start, stop } satisfies BrowserMcpBridgeShape;
  }),
);

export function browserMcpBridgeRequest(input: {
  readonly socketPath: string;
  readonly toolName: string;
  readonly arguments: unknown;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const socket = createConnection(input.socketPath);
    let buffer = "";
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          id,
          toolName: input.toolName,
          arguments: input.arguments,
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex).trim();
      socket.end();
      try {
        const response = JSON.parse(line) as BrowserMcpBridgeResponse;
        if (!response.ok) {
          reject(new Error(response.message ?? "Browser MCP bridge request failed."));
          return;
        }
        resolve(response.result);
      } catch (cause) {
        reject(cause);
      }
    });
    socket.on("error", reject);
  });
}
