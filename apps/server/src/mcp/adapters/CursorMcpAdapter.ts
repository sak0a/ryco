import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  CursorSettings,
  McpListServersResult,
  McpProviderCapabilities,
  McpProviderSupport,
  McpServer,
  McpServerName,
  McpServerWritableConfig,
  McpSettingsError,
  McpWorkspace,
  McpWorkspaceId,
  ProviderDriverKind,
  type McpListWorkspacesResult,
  type McpProviderSupport as McpProviderSupportType,
  type McpServerWritableConfig as McpServerWritableConfigType,
  type ProviderInstanceId,
} from "@ryco/contracts";
import { Effect, Exit, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "../../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import type { ProviderMcpAdapter } from "../ProviderMcpAdapter.ts";
import { makeProviderMcpExternalAgentControl } from "../ProviderMcpExternalAgentControl.ts";
import {
  applyProviderMcpSecretMutations,
  providerMcpConfigFingerprint,
  providerMcpSecretPresence,
} from "../ProviderMcpSecrets.ts";
import {
  readGuardedJsonDocument,
  writeGuardedJsonDocument,
  type GuardedJsonDocument,
} from "../nativeConfig/guardedJsonDocument.ts";

const CURSOR_DRIVER = ProviderDriverKind.make("cursor");

const globalCapabilities = Schema.decodeSync(McpProviderCapabilities)({
  readConfiguration: "available",
  upsert: "available",
  remove: "available",
  externalAgentControl: "available",
  automaticAgentControl: "available",
  scopes: ["user"],
});
const projectCapabilities = Schema.decodeSync(McpProviderCapabilities)({
  readConfiguration: "available",
  upsert: "available",
  remove: "available",
  externalAgentControl: "unavailable",
  automaticAgentControl: "available",
  scopes: ["project"],
});

interface CursorMcpRuntime {
  readonly workspace: McpWorkspace;
  readonly configPath: string;
  readonly source: "user" | "project";
}

export interface CursorMcpAdapterIo {
  readonly read: (filePath: string) => Promise<GuardedJsonDocument>;
  readonly write: (
    snapshot: GuardedJsonDocument,
    value: Record<string, unknown>,
  ) => Promise<GuardedJsonDocument>;
}

const defaultIo: CursorMcpAdapterIo = {
  read: readGuardedJsonDocument,
  write: writeGuardedJsonDocument,
};

function toMcpError(message: string, cause?: unknown): McpSettingsError {
  return new McpSettingsError({ message, ...(cause === undefined ? {} : { cause }) });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecord(value: unknown): Record<string, string> | null {
  const source = record(value);
  if (!source) return {};
  const result = Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] =>
      entry.every((part) => typeof part === "string"),
    ),
  );
  return Object.keys(result).length === Object.keys(source).length ? result : null;
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return null;
  return value;
}

export function decodeCursorMcpServer(value: unknown): McpServerWritableConfigType | null {
  const entry = record(value);
  if (!entry) return null;
  const env = stringRecord(entry.env);
  const headers = stringRecord(entry.headers);
  if (!env || !headers) return null;
  if (typeof entry.url === "string") {
    return Schema.decodeSync(McpServerWritableConfig)({
      transport: "http",
      url: entry.url,
      httpHeaders: headers,
    });
  }
  const args = stringArray(entry.args);
  if (typeof entry.command === "string" && args) {
    return Schema.decodeSync(McpServerWritableConfig)({
      transport: "stdio",
      command: entry.command,
      args,
      env,
    });
  }
  return null;
}

function workspaceIdFor(scope: "user" | "project", configPath: string): McpWorkspaceId {
  return McpWorkspaceId.make(
    `cursor:${createHash("sha256").update(`${scope}\0${configPath}`, "utf8").digest("base64url")}`,
  );
}

function readDocument(io: CursorMcpAdapterIo, runtime: CursorMcpRuntime) {
  return Effect.tryPromise({
    try: () => io.read(runtime.configPath),
    catch: (cause) => toMcpError("Failed to read Cursor MCP configuration.", cause),
  });
}

function nativeEntry(
  input: Parameters<NonNullable<ProviderMcpAdapter["upsertServer"]>>[0],
  current: unknown,
): Record<string, unknown> {
  const currentRecord = record(current) ?? {};
  const existing = decodeCursorMcpServer(current);
  const env = applyProviderMcpSecretMutations(
    existing?.env ?? {},
    input.config.env,
    "env",
    input.secretMutations,
  );
  const headers = applyProviderMcpSecretMutations(
    existing?.httpHeaders ?? {},
    input.config.httpHeaders,
    "header",
    input.secretMutations,
  );
  if (input.config.transport === "stdio") {
    const command = input.config.command?.trim();
    if (!command) throw toMcpError("Cursor stdio MCP servers require a command.");
    const next: Record<string, unknown> = {
      ...currentRecord,
      type: "stdio",
      command,
      args: input.config.args,
      env,
    };
    delete next.url;
    delete next.headers;
    return next;
  }
  if (input.config.transport === "http") {
    const url = input.config.url?.trim();
    if (!url) throw toMcpError("Cursor HTTP MCP servers require a URL.");
    const next: Record<string, unknown> = { ...currentRecord, type: "http", url, headers };
    delete next.command;
    delete next.args;
    delete next.env;
    delete next.envFile;
    return next;
  }
  throw toMcpError("Cursor does not support this MCP transport.");
}

export const makeCursorMcpAdapter = (io: CursorMcpAdapterIo = defaultIo) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const serverConfig = yield* ServerConfig;

    const discover = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const entries = Object.entries(deriveProviderInstanceConfigMap(settings)).filter(
        ([, instance]) => instance.driver === CURSOR_DRIVER,
      );
      const runtimes = new Map<string, CursorMcpRuntime>();
      const providers: McpProviderSupportType[] = [];
      const issues: McpListWorkspacesResult["issues"][number][] = [];
      for (const [rawInstanceId, instance] of entries) {
        const instanceId = rawInstanceId as ProviderInstanceId;
        const enabled = instance.enabled ?? false;
        const decoded = Schema.decodeUnknownExit(CursorSettings)(instance.config ?? {});
        if (Exit.isFailure(decoded)) {
          issues.push({ instanceId, message: "Cursor settings could not be decoded." });
          continue;
        }
        const processEnv = mergeProviderInstanceEnvironment(instance.environment);
        const homePath = processEnv.HOME?.trim() || os.homedir();
        const globalPath = path.join(homePath, ".cursor", "mcp.json");
        const globalId = workspaceIdFor("user", globalPath);
        providers.push(
          Schema.decodeSync(McpProviderSupport)({
            instanceId,
            driver: CURSOR_DRIVER,
            ...(instance.displayName ? { displayName: instance.displayName } : {}),
            ...(instance.accentColor ? { accentColor: instance.accentColor } : {}),
            enabled,
            status: "managed",
            capabilities: globalCapabilities,
            ...(enabled ? { workspaceId: globalId } : {}),
            message: enabled
              ? "Ryco manages Cursor MCP JSON with guarded atomic updates."
              : "This Cursor provider instance is disabled.",
          }),
        );
        if (!enabled) continue;
        const usage = {
          instanceId,
          ...(instance.displayName ? { displayName: instance.displayName } : {}),
          ...(instance.accentColor ? { accentColor: instance.accentColor } : {}),
        };
        for (const target of [
          {
            id: globalId,
            scope: "user" as const,
            configPath: globalPath,
            capabilities: globalCapabilities,
          },
          {
            id: workspaceIdFor("project", path.join(serverConfig.cwd, ".cursor", "mcp.json")),
            scope: "project" as const,
            configPath: path.join(serverConfig.cwd, ".cursor", "mcp.json"),
            capabilities: projectCapabilities,
          },
        ]) {
          const existing = runtimes.get(target.id);
          if (existing) {
            runtimes.set(target.id, {
              ...existing,
              workspace: {
                ...existing.workspace,
                providerInstances: [...existing.workspace.providerInstances, usage],
              },
            });
            continue;
          }
          runtimes.set(target.id, {
            configPath: target.configPath,
            source: target.scope,
            workspace: Schema.decodeSync(McpWorkspace)({
              id: target.id,
              driver: CURSOR_DRIVER,
              providerDisplayName: "Cursor",
              displayPath: target.configPath,
              nativeScope: target.scope,
              formatGeneration: "cursor-mcp-json-v1",
              capabilities: target.capabilities,
              providerMetadata: { configPath: target.configPath },
              sharedHomePath: homePath,
              mode: "direct",
              selectedInstanceId: instanceId,
              providerInstances: [usage],
            }),
          });
        }
      }
      return { runtimes: [...runtimes.values()], providers, issues };
    }).pipe(
      Effect.mapError((cause) => toMcpError("Failed to discover Cursor MCP profiles.", cause)),
    );

    const findRuntime = (workspaceId: McpWorkspaceId) =>
      discover.pipe(
        Effect.flatMap(({ runtimes }) => {
          const runtime = runtimes.find((entry) => entry.workspace.id === workspaceId);
          return runtime
            ? Effect.succeed(runtime)
            : Effect.fail(toMcpError("Cursor MCP workspace not found."));
        }),
      );

    const listServers: NonNullable<ProviderMcpAdapter["listServers"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const snapshot = yield* readDocument(io, runtime);
        const serverMap = record(snapshot.value.mcpServers) ?? {};
        const servers: Array<typeof McpServer.Type> = [];
        const warnings: string[] = [];
        for (const [name, value] of Object.entries(serverMap)) {
          if (!Schema.is(McpServerName)(name)) continue;
          const config = decodeCursorMcpServer(value);
          if (!config) {
            warnings.push(`Cursor MCP server ${name} uses an unsupported or malformed format.`);
            continue;
          }
          servers.push(
            Schema.decodeSync(McpServer)({
              name,
              config: {
                ...config,
                env: {},
                httpHeaders: {},
                secretFields: providerMcpSecretPresence([
                  { prefix: "env", values: config.env },
                  { prefix: "header", values: config.httpHeaders },
                ]),
              },
              source: runtime.source,
              startupStatus: "unknown",
              authStatus: "unknown",
              tools: [],
              resources: [],
              resourceTemplates: [],
            }),
          );
        }
        return Schema.decodeSync(McpListServersResult)({
          workspace: runtime.workspace,
          servers,
          configPath: runtime.configPath,
          warnings,
        });
      });

    const upsertServer: NonNullable<ProviderMcpAdapter["upsertServer"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const snapshot = yield* readDocument(io, runtime);
        const serverMap = record(snapshot.value.mcpServers) ?? {};
        const desiredEntry = yield* Effect.try({
          try: () => nativeEntry(input, serverMap[input.name]),
          catch: (cause) =>
            Schema.is(McpSettingsError)(cause)
              ? cause
              : toMcpError("Invalid Cursor MCP configuration.", cause),
        });
        yield* Effect.tryPromise({
          try: () =>
            io.write(snapshot, {
              ...snapshot.value,
              mcpServers: { ...serverMap, [input.name]: desiredEntry },
            }),
          catch: (cause) => toMcpError("Failed to update Cursor MCP configuration.", cause),
        });
        const written = yield* readDocument(io, runtime);
        const normalized = decodeCursorMcpServer(record(written.value.mcpServers)?.[input.name]);
        const desired = decodeCursorMcpServer(desiredEntry);
        if (
          !normalized ||
          !desired ||
          providerMcpConfigFingerprint(normalized) !== providerMcpConfigFingerprint(desired)
        ) {
          return yield* Effect.fail(toMcpError("Cursor MCP configuration could not be verified."));
        }
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    const removeServer: NonNullable<ProviderMcpAdapter["removeServer"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const snapshot = yield* readDocument(io, runtime);
        const serverMap = record(snapshot.value.mcpServers) ?? {};
        if (!Object.hasOwn(serverMap, input.name)) {
          return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
        }
        const next = { ...serverMap };
        delete next[input.name];
        yield* Effect.tryPromise({
          try: () => io.write(snapshot, { ...snapshot.value, mcpServers: next }),
          catch: (cause) => toMcpError("Failed to remove Cursor MCP server.", cause),
        });
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    return {
      driver: CURSOR_DRIVER,
      capabilities: globalCapabilities,
      listWorkspaces: discover.pipe(
        Effect.map(({ runtimes, providers, issues }) => ({
          workspaces: runtimes.map((runtime) => runtime.workspace),
          providers,
          issues,
        })),
      ),
      listServers,
      upsertServer,
      removeServer,
      externalAgentControl: makeProviderMcpExternalAgentControl({
        listServers,
        upsertServer,
        removeServer,
      }),
    } satisfies ProviderMcpAdapter;
  });
