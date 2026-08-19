import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  GrokSettings,
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

const GROK_DRIVER = ProviderDriverKind.make("grok");
const GROK_MCP_TIMEOUT_MS = 20_000;
const GROK_MCP_OUTPUT_LIMIT = 256 * 1024;

const capabilities = Schema.decodeSync(McpProviderCapabilities)({
  readConfiguration: "available",
  upsert: "available",
  remove: "available",
  enableDisable: "available",
  health: "available",
  externalAgentControl: "available",
  automaticAgentControl: "unavailable",
  scopes: ["user"],
});

interface GrokMcpRuntime {
  readonly workspace: McpWorkspace;
  readonly binaryPath: string;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly configPath: string;
}

export interface GrokMcpAdapterIo {
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

const defaultIo: GrokMcpAdapterIo = { run: runProcess };

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

export function decodeGrokMcpServer(value: unknown): McpServerWritableConfigType | null {
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
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    });
  }
  const args = stringArray(entry.args);
  if (typeof entry.command === "string" && args) {
    return Schema.decodeSync(McpServerWritableConfig)({
      transport: "stdio",
      command: entry.command,
      args,
      env,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    });
  }
  return null;
}

function sourceFor(value: unknown): McpServerSource {
  const scope = record(value)?.scope;
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "unknown";
}

function workspaceIdFor(configPath: string): McpWorkspaceId {
  return McpWorkspaceId.make(
    `grok:${createHash("sha256").update(configPath, "utf8").digest("base64url")}`,
  );
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (cause) {
    throw toMcpError("Grok returned malformed MCP JSON.", cause);
  }
}

function nativeConfig(
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
    throw toMcpError("Grok stdio MCP servers require a command.");
  }
  if (input.config.transport === "http" && !input.config.url?.trim()) {
    throw toMcpError("Grok HTTP MCP servers require a URL.");
  }
  if (input.config.transport !== "stdio" && input.config.transport !== "http") {
    throw toMcpError("Grok does not support this MCP transport.");
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
  if (config.transport === "http") {
    const headers = Object.entries(config.httpHeaders).flatMap(([key, value]) => [
      "--header",
      `${key}: ${value}`,
    ]);
    return ["mcp", "add", "--scope", "user", "--transport", "http", ...headers, name, config.url!];
  }
  const env = Object.entries(config.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  return ["mcp", "add", "--scope", "user", ...env, name, "--", config.command!, ...config.args];
}

interface GrokDoctorStatus {
  readonly healthy: boolean;
  readonly error: string | null;
}

function doctorStatuses(value: unknown): Map<string, GrokDoctorStatus> {
  const root = record(value);
  if (!Array.isArray(root?.servers)) return new Map();
  return new Map(
    root.servers.flatMap((candidate): Array<[string, GrokDoctorStatus]> => {
      const server = record(candidate);
      if (!server || typeof server.name !== "string" || typeof server.healthy !== "boolean")
        return [];
      const failedLabels = Array.isArray(server.checks)
        ? server.checks
            .map(record)
            .filter((check) => check?.passed === false && typeof check.label === "string")
            .map((check) => String(check!.label))
        : [];
      return [[server.name, { healthy: server.healthy, error: failedLabels.join(", ") || null }]];
    }),
  );
}

export const makeGrokMcpAdapter = (io: GrokMcpAdapterIo = defaultIo) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const serverConfig = yield* ServerConfig;

    const discover = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const entries = Object.entries(deriveProviderInstanceConfigMap(settings)).filter(
        ([, instance]) => instance.driver === GROK_DRIVER,
      );
      const groups = new Map<string, GrokMcpRuntime>();
      const providers: McpProviderSupportType[] = [];
      const issues: McpListWorkspacesResult["issues"][number][] = [];
      for (const [rawInstanceId, instance] of entries) {
        const instanceId = rawInstanceId as ProviderInstanceId;
        const enabled = instance.enabled ?? true;
        const decoded = Schema.decodeUnknownExit(GrokSettings)(instance.config ?? {});
        if (Exit.isFailure(decoded)) {
          issues.push({ instanceId, message: "Grok settings could not be decoded." });
          continue;
        }
        const processEnv = mergeProviderInstanceEnvironment(instance.environment);
        const homePath = processEnv.HOME?.trim() || os.homedir();
        const grokHome = processEnv.GROK_HOME?.trim() || path.join(homePath, ".grok");
        const configPath = path.join(grokHome, "config.toml");
        const workspaceId = workspaceIdFor(configPath);
        providers.push(
          Schema.decodeSync(McpProviderSupport)({
            instanceId,
            driver: GROK_DRIVER,
            ...(instance.displayName ? { displayName: instance.displayName } : {}),
            ...(instance.accentColor ? { accentColor: instance.accentColor } : {}),
            enabled,
            status: "managed",
            capabilities,
            ...(enabled ? { workspaceId } : {}),
            message: enabled
              ? "Ryco manages this Grok user MCP profile through the native CLI."
              : "This Grok provider instance is disabled.",
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
            driver: GROK_DRIVER,
            providerDisplayName: "Grok",
            displayPath: configPath,
            nativeScope: "user",
            formatGeneration: "grok-cli-toml-v1",
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
    }).pipe(Effect.mapError((cause) => toMcpError("Failed to discover Grok MCP profiles.", cause)));

    const findRuntime = (workspaceId: McpWorkspaceId) =>
      discover.pipe(
        Effect.flatMap(({ runtimes }) => {
          const runtime = runtimes.find((entry) => entry.workspace.id === workspaceId);
          return runtime
            ? Effect.succeed(runtime)
            : Effect.fail(toMcpError("Grok MCP workspace not found."));
        }),
      );

    const run = (runtime: GrokMcpRuntime, args: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: async () => {
          const result = await io.run(runtime.binaryPath, args, {
            cwd: serverConfig.cwd,
            env: runtime.processEnv,
            timeoutMs: GROK_MCP_TIMEOUT_MS,
            maxBufferBytes: GROK_MCP_OUTPUT_LIMIT,
            outputMode: "truncate",
          });
          if (result.timedOut || result.code !== 0) throw new Error("Grok MCP command failed.");
          return result;
        },
        catch: (cause) => toMcpError("Grok MCP command failed.", cause),
      });

    const readNative = (runtime: GrokMcpRuntime) =>
      run(runtime, ["mcp", "list", "--json"]).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              const parsed = parseJson(result.stdout);
              if (!Array.isArray(parsed)) throw toMcpError("Grok MCP JSON is not a list.");
              return parsed;
            },
            catch: (cause) =>
              Schema.is(McpSettingsError)(cause)
                ? cause
                : toMcpError("Grok returned malformed MCP JSON.", cause),
          }),
        ),
      );

    const listServers: NonNullable<ProviderMcpAdapter["listServers"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const native = yield* readNative(runtime);
        const health =
          input.detail === "full"
            ? yield* run(runtime, ["mcp", "doctor", "--json"]).pipe(
                Effect.map((result) => doctorStatuses(parseJson(result.stdout))),
                Effect.catch(() => Effect.succeed(new Map<string, GrokDoctorStatus>())),
              )
            : new Map<string, GrokDoctorStatus>();
        const servers: Array<typeof McpServer.Type> = [];
        const warnings: string[] = [];
        for (const value of native) {
          const entry = record(value);
          if (!entry || typeof entry.name !== "string" || !Schema.is(McpServerName)(entry.name)) {
            continue;
          }
          const config = decodeGrokMcpServer(value);
          if (!config) {
            warnings.push(`Grok MCP server ${entry.name} uses an unsupported or malformed format.`);
            continue;
          }
          const status = health.get(entry.name);
          servers.push(
            Schema.decodeSync(McpServer)({
              name: entry.name,
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
              startupStatus: !config.enabled
                ? "disabled"
                : status
                  ? status.healthy
                    ? "ready"
                    : "failed"
                  : "unknown",
              authStatus: "unknown",
              ...(status?.error ? { error: status.error } : {}),
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
        const native = yield* readNative(runtime);
        const currentValue = native.find((value) => record(value)?.name === input.name);
        if (currentValue && sourceFor(currentValue) !== "user") {
          return yield* Effect.fail(toMcpError("Grok project MCP servers are read-only here."));
        }
        const existing = decodeGrokMcpServer(currentValue);
        const desired = yield* Effect.try({
          try: () => nativeConfig(input, existing),
          catch: (cause) =>
            Schema.is(McpSettingsError)(cause)
              ? cause
              : toMcpError("Invalid Grok MCP configuration.", cause),
        });
        yield* run(runtime, addArgs(input.name, desired));
        const writtenValue = (yield* readNative(runtime)).find(
          (value) => record(value)?.name === input.name,
        );
        const written = decodeGrokMcpServer(writtenValue);
        if (
          !written ||
          providerMcpConfigFingerprint(written) !== providerMcpConfigFingerprint(desired)
        ) {
          return yield* Effect.fail(toMcpError("Grok did not preserve the MCP server update."));
        }
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    const setServerEnabled: NonNullable<ProviderMcpAdapter["setServerEnabled"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        yield* run(runtime, ["mcp", input.enabled ? "enable" : "disable", input.name]);
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    const removeServer: NonNullable<ProviderMcpAdapter["removeServer"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const native = yield* readNative(runtime);
        const current = native.find((value) => record(value)?.name === input.name);
        if (!current) return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
        if (sourceFor(current) !== "user") {
          return yield* Effect.fail(toMcpError("Grok project MCP servers cannot be removed here."));
        }
        yield* run(runtime, ["mcp", "remove", "--scope", "user", input.name]);
        const after = yield* readNative(runtime);
        if (after.some((value) => record(value)?.name === input.name)) {
          return yield* Effect.fail(toMcpError("Grok did not remove the MCP server."));
        }
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    return {
      driver: GROK_DRIVER,
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
      setServerEnabled,
      removeServer,
      externalAgentControl: makeProviderMcpExternalAgentControl({
        listServers,
        upsertServer,
        removeServer,
      }),
    } satisfies ProviderMcpAdapter;
  });
