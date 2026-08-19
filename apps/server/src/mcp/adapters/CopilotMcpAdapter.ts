import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  CopilotSettings,
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
  type McpServerSource,
  type McpServerWritableConfig as McpServerWritableConfigType,
  type ProviderInstanceId,
} from "@ryco/contracts";
import { Effect, Exit, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import { runProcess, type ProcessRunResult } from "../../processRunner.ts";
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

const COPILOT_DRIVER = ProviderDriverKind.make("copilot");
const COPILOT_MCP_TIMEOUT_MS = 20_000;
const COPILOT_MCP_OUTPUT_LIMIT = 256 * 1024;

const capabilities = Schema.decodeSync(McpProviderCapabilities)({
  readConfiguration: "available",
  upsert: "available",
  remove: "available",
  externalAgentControl: "available",
  automaticAgentControl: "available",
  scopes: ["user"],
});

interface CopilotMcpRuntime {
  readonly workspace: McpWorkspace;
  readonly binaryPath: string;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly configPath: string;
}

export interface CopilotMcpAdapterIo {
  readonly run: (
    command: string,
    args: ReadonlyArray<string>,
    options: {
      readonly cwd: string;
      readonly env: NodeJS.ProcessEnv;
      readonly timeoutMs: number;
      readonly maxBufferBytes: number;
      readonly outputMode: "truncate";
    },
  ) => Promise<ProcessRunResult>;
}

const defaultIo: CopilotMcpAdapterIo = { run: runProcess };

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

export function decodeCopilotMcpServer(value: unknown): McpServerWritableConfigType | null {
  const entry = record(value);
  if (!entry) return null;
  const env = stringRecord(entry.env);
  const headers = stringRecord(entry.headers);
  const tools = stringArray(entry.tools);
  if (!env || !headers || !tools) return null;
  if ((entry.type === "http" || entry.type === "sse") && typeof entry.url === "string") {
    return Schema.decodeSync(McpServerWritableConfig)({
      transport: "http",
      url: entry.url,
      httpHeaders: headers,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
      enabledTools: tools.includes("*") ? [] : tools,
    });
  }
  const args = stringArray(entry.args);
  if (
    (entry.type === "local" || entry.type === "stdio") &&
    typeof entry.command === "string" &&
    args
  ) {
    return Schema.decodeSync(McpServerWritableConfig)({
      transport: "stdio",
      command: entry.command,
      args,
      env,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
      enabledTools: tools.includes("*") ? [] : tools,
    });
  }
  return null;
}

function sourceFor(value: unknown): McpServerSource {
  const source = record(value)?.source;
  if (source === "user") return "user";
  if (source === "workspace") return "project";
  if (source === "plugin" || source === "builtin") return "managed";
  return "unknown";
}

function publicServer(name: string, value: unknown, config: McpServerWritableConfigType) {
  return Schema.decodeSync(McpServer)({
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
    source: sourceFor(value),
    startupStatus: config.enabled ? "unknown" : "disabled",
    authStatus: "unknown",
    tools: [],
    resources: [],
    resourceTemplates: [],
  });
}

function workspaceIdFor(configPath: string): McpWorkspaceId {
  return McpWorkspaceId.make(
    `copilot:${createHash("sha256").update(configPath, "utf8").digest("base64url")}`,
  );
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    throw toMcpError("Copilot returned malformed MCP JSON.", cause);
  }
}

function nativeEntryFromConfig(
  input: Parameters<NonNullable<ProviderMcpAdapter["upsertServer"]>>[0],
  existing: McpServerWritableConfigType | null,
): McpServerWritableConfigType {
  const env = applyProviderMcpSecretMutations(
    existing?.env ?? {},
    input.config.env,
    "env",
    input.secretMutations,
  );
  const httpHeaders = applyProviderMcpSecretMutations(
    existing?.httpHeaders ?? {},
    input.config.httpHeaders,
    "header",
    input.secretMutations,
  );
  if (input.config.transport === "stdio" && !input.config.command?.trim()) {
    throw toMcpError("Copilot stdio MCP servers require a command.");
  }
  if (input.config.transport === "http" && !input.config.url?.trim()) {
    throw toMcpError("Copilot HTTP MCP servers require a URL.");
  }
  if (input.config.transport !== "stdio" && input.config.transport !== "http") {
    throw toMcpError("Copilot does not support this MCP transport.");
  }
  return Schema.decodeSync(McpServerWritableConfig)({
    ...input.config,
    ...(input.config.transport === "stdio"
      ? { command: input.config.command!.trim() }
      : { url: input.config.url!.trim() }),
    env,
    httpHeaders,
  });
}

function addArgs(name: string, config: McpServerWritableConfigType): string[] {
  const tools = config.enabledTools.length > 0 ? config.enabledTools.join(",") : "*";
  const env = Object.entries(config.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  if (config.transport === "http") {
    const headers = Object.entries(config.httpHeaders).flatMap(([key, value]) => [
      "--header",
      `${key}: ${value}`,
    ]);
    return ["mcp", "add", "--transport", "http", "--tools", tools, ...headers, name, config.url!];
  }
  return ["mcp", "add", "--tools", tools, ...env, name, "--", config.command!, ...config.args];
}

export const makeCopilotMcpAdapter = (io: CopilotMcpAdapterIo = defaultIo) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const serverConfig = yield* ServerConfig;

    const discover = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const entries = Object.entries(deriveProviderInstanceConfigMap(settings)).filter(
        ([, instance]) => instance.driver === COPILOT_DRIVER,
      );
      const groups = new Map<string, CopilotMcpRuntime>();
      const providers: McpProviderSupportType[] = [];
      const issues: McpListWorkspacesResult["issues"][number][] = [];
      for (const [rawInstanceId, instance] of entries) {
        const instanceId = rawInstanceId as ProviderInstanceId;
        const enabled = instance.enabled ?? true;
        const decoded = Schema.decodeUnknownExit(CopilotSettings)(instance.config ?? {});
        if (Exit.isFailure(decoded)) {
          issues.push({ instanceId, message: "Copilot settings could not be decoded." });
          continue;
        }
        const processEnv = mergeProviderInstanceEnvironment(instance.environment);
        const homePath = processEnv.HOME?.trim() || os.homedir();
        const configPath = path.join(homePath, ".copilot", "mcp-config.json");
        const workspaceId = workspaceIdFor(configPath);
        providers.push(
          Schema.decodeSync(McpProviderSupport)({
            instanceId,
            driver: COPILOT_DRIVER,
            ...(instance.displayName ? { displayName: instance.displayName } : {}),
            ...(instance.accentColor ? { accentColor: instance.accentColor } : {}),
            enabled,
            status: "managed",
            capabilities,
            ...(enabled ? { workspaceId } : {}),
            message: enabled
              ? "Ryco manages this Copilot user MCP profile through the native CLI."
              : "This Copilot provider instance is disabled.",
          }),
        );
        if (!enabled) continue;
        const usage = {
          instanceId,
          ...(instance.displayName ? { displayName: instance.displayName } : {}),
          ...(instance.accentColor ? { accentColor: instance.accentColor } : {}),
        };
        const existing = groups.get(workspaceId);
        if (existing) {
          groups.set(workspaceId, {
            ...existing,
            workspace: {
              ...existing.workspace,
              providerInstances: [...existing.workspace.providerInstances, usage],
            },
          });
          continue;
        }
        groups.set(workspaceId, {
          workspace: Schema.decodeSync(McpWorkspace)({
            id: workspaceId,
            driver: COPILOT_DRIVER,
            providerDisplayName: "GitHub Copilot",
            displayPath: configPath,
            nativeScope: "user",
            formatGeneration: "copilot-cli-json-v1",
            capabilities,
            providerMetadata: { configPath },
            sharedHomePath: homePath,
            mode: "direct",
            selectedInstanceId: instanceId,
            providerInstances: [usage],
          }),
          binaryPath: decoded.value.binaryPath,
          processEnv,
          configPath,
        });
      }
      return { runtimes: [...groups.values()], providers, issues };
    }).pipe(
      Effect.mapError((cause) => toMcpError("Failed to discover Copilot MCP profiles.", cause)),
    );

    const findRuntime = (workspaceId: McpWorkspaceId) =>
      discover.pipe(
        Effect.flatMap(({ runtimes }) => {
          const runtime = runtimes.find((entry) => entry.workspace.id === workspaceId);
          return runtime
            ? Effect.succeed(runtime)
            : Effect.fail(toMcpError("Copilot MCP workspace not found."));
        }),
      );

    const run = (runtime: CopilotMcpRuntime, args: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: async () => {
          const result = await io.run(runtime.binaryPath, args, {
            cwd: serverConfig.cwd,
            env: runtime.processEnv,
            timeoutMs: COPILOT_MCP_TIMEOUT_MS,
            maxBufferBytes: COPILOT_MCP_OUTPUT_LIMIT,
            outputMode: "truncate",
          });
          if (result.timedOut || result.code !== 0) throw new Error("Copilot MCP command failed.");
          return result;
        },
        catch: (cause) => toMcpError("Copilot MCP command failed.", cause),
      });

    const readNative = (runtime: CopilotMcpRuntime) =>
      run(runtime, ["mcp", "list", "--json"]).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              const root = record(parseJson(result.stdout));
              const servers = record(root?.mcpServers);
              if (!servers) throw toMcpError("Copilot MCP JSON has no server map.");
              return servers;
            },
            catch: (cause) =>
              Schema.is(McpSettingsError)(cause)
                ? cause
                : toMcpError("Copilot returned malformed MCP JSON.", cause),
          }),
        ),
      );

    const readNativeServer = (runtime: CopilotMcpRuntime, name: string) =>
      run(runtime, ["mcp", "get", name, "--json", "--show-secrets"]).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => record(parseJson(result.stdout))?.[name] ?? null,
            catch: (cause) =>
              Schema.is(McpSettingsError)(cause)
                ? cause
                : toMcpError("Copilot returned malformed MCP JSON.", cause),
          }),
        ),
      );

    const listServers: NonNullable<ProviderMcpAdapter["listServers"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const native = yield* readNative(runtime);
        const servers: Array<typeof McpServer.Type> = [];
        const warnings: string[] = [];
        for (const [name, value] of Object.entries(native)) {
          if (!Schema.is(McpServerName)(name)) continue;
          const config = decodeCopilotMcpServer(value);
          if (!config) {
            warnings.push(`Copilot MCP server ${name} uses an unsupported or malformed format.`);
            continue;
          }
          servers.push(publicServer(name, value, config));
        }
        return Schema.decodeSync(McpListServersResult)({
          workspace: runtime.workspace,
          servers,
          configPath: runtime.configPath,
          warnings,
        });
      });

    const add = (runtime: CopilotMcpRuntime, name: string, config: McpServerWritableConfigType) =>
      run(runtime, addArgs(name, config));

    const remove = (runtime: CopilotMcpRuntime, name: string) =>
      run(runtime, ["mcp", "remove", name]);

    const upsertServer: NonNullable<ProviderMcpAdapter["upsertServer"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const listed = yield* readNative(runtime);
        const listedValue = listed[input.name];
        if (listedValue && sourceFor(listedValue) !== "user") {
          return yield* Effect.fail(
            toMcpError("Copilot workspace and plugin MCP servers are read-only in Ryco."),
          );
        }
        const fullValue = listedValue ? yield* readNativeServer(runtime, input.name) : null;
        const existing = decodeCopilotMcpServer(fullValue ?? listedValue);
        const desired = yield* Effect.try({
          try: () => nativeEntryFromConfig(input, existing),
          catch: (cause) =>
            Schema.is(McpSettingsError)(cause)
              ? cause
              : toMcpError("Invalid Copilot MCP configuration.", cause),
        });
        if (existing) yield* remove(runtime, input.name);
        yield* add(runtime, input.name, desired).pipe(
          Effect.catch((error) =>
            existing
              ? add(runtime, input.name, existing).pipe(
                  Effect.ignore,
                  Effect.andThen(Effect.fail(error)),
                )
              : Effect.fail(error),
          ),
        );
        const writtenValue = yield* readNativeServer(runtime, input.name);
        const written = decodeCopilotMcpServer(writtenValue);
        if (
          !written ||
          providerMcpConfigFingerprint(written) !== providerMcpConfigFingerprint(desired)
        ) {
          return yield* Effect.fail(toMcpError("Copilot did not preserve the MCP server update."));
        }
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    const removeServer: NonNullable<ProviderMcpAdapter["removeServer"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const listed = yield* readNative(runtime);
        const value = listed[input.name];
        if (!value) return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
        if (sourceFor(value) !== "user") {
          return yield* Effect.fail(
            toMcpError("Copilot workspace and plugin MCP servers cannot be removed here."),
          );
        }
        yield* remove(runtime, input.name);
        const after = yield* readNative(runtime);
        if (after[input.name]) {
          return yield* Effect.fail(toMcpError("Copilot did not remove the MCP server."));
        }
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    return {
      driver: COPILOT_DRIVER,
      capabilities,
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
