import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ClaudeSettings,
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
import { Effect, Exit, Path, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import { runProcess, type ProcessRunResult } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeClaudeEnvironment, resolveClaudeHomePath } from "../../provider/Drivers/ClaudeHome.ts";
import { deriveProviderInstanceConfigMap } from "../../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import {
  externalAgentControlConfigFingerprint,
  externalAgentControlServerConfig,
} from "../externalAgentControlEntry.ts";
import type { ProviderMcpAdapter } from "../ProviderMcpAdapter.ts";
import {
  applyProviderMcpSecretMutations,
  providerMcpConfigFingerprint,
  providerMcpSecretPresence,
} from "../ProviderMcpSecrets.ts";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const CLAUDE_MCP_TIMEOUT_MS = 20_000;
const CLAUDE_MCP_OUTPUT_LIMIT = 256 * 1024;

const capabilities = Schema.decodeSync(McpProviderCapabilities)({
  readConfiguration: "available",
  upsert: "available",
  remove: "available",
  health: "unknown",
  inventory: "unavailable",
  oauth: "unknown",
  externalAgentControl: "available",
  automaticAgentControl: "available",
  scopes: ["user"],
});

interface ClaudeMcpRuntime {
  readonly workspace: McpWorkspace;
  readonly binaryPath: string;
  readonly homePath: string;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly configPath: string;
}

export interface ClaudeMcpAdapterIo {
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
  readonly readText: (file: string) => Promise<string>;
}

const defaultIo: ClaudeMcpAdapterIo = {
  run: runProcess,
  readText: (file) => readFile(file, "utf8"),
};

function toMcpError(message: string, cause?: unknown): McpSettingsError {
  return new McpSettingsError({ message, ...(cause === undefined ? {} : { cause }) });
}

function workspaceIdFor(configPath: string): McpWorkspaceId {
  return McpWorkspaceId.make(
    `claudeAgent:${createHash("sha256").update(configPath, "utf8").digest("base64url")}`,
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function decodeClaudeMcpServer(value: unknown): McpServerWritableConfigType | null {
  const entry = record(value);
  if (!entry) return null;
  const type = entry.type;
  if ((type === "http" || type === "sse") && typeof entry.url === "string") {
    const headerRecord = record(entry.headers);
    const headers =
      headerRecord === null
        ? {}
        : Object.fromEntries(
            Object.entries(headerRecord).filter((item): item is [string, string] =>
              item.every((part) => typeof part === "string"),
            ),
          );
    if (headerRecord !== null && Object.keys(headers).length !== Object.keys(headerRecord).length) {
      return null;
    }
    return Schema.decodeSync(McpServerWritableConfig)({
      transport: "http",
      url: entry.url,
      httpHeaders: headers,
    });
  }
  if (typeof entry.command !== "string") return null;
  const args = Array.isArray(entry.args)
    ? entry.args.filter((item): item is string => typeof item === "string")
    : [];
  if (Array.isArray(entry.args) && args.length !== entry.args.length) return null;
  const envRecord = record(entry.env);
  const env =
    envRecord === null
      ? {}
      : Object.fromEntries(
          Object.entries(envRecord).filter((item): item is [string, string] =>
            item.every((part) => typeof part === "string"),
          ),
        );
  if (envRecord !== null && Object.keys(env).length !== Object.keys(envRecord).length) return null;
  return Schema.decodeSync(McpServerWritableConfig)({
    transport: "stdio",
    command: entry.command,
    args,
    env,
  });
}

function readClaudeMcpEntries(document: unknown): ReadonlyArray<readonly [string, unknown]> {
  const root = record(document);
  const servers = record(root?.mcpServers);
  return servers === null ? [] : Object.entries(servers);
}

function publicClaudeMcpServer(name: string, config: McpServerWritableConfigType) {
  const secretFields = providerMcpSecretPresence([
    { prefix: "env", values: config.env },
    { prefix: "header", values: config.httpHeaders },
  ]);
  return Schema.decodeSync(McpServer)({
    name,
    config: {
      ...config,
      env: {},
      httpHeaders: {},
      secretFields,
    },
    source: "user",
    startupStatus: "unknown",
    authStatus: "unknown",
    tools: [],
    resources: [],
    resourceTemplates: [],
  });
}

function nativeClaudeMcpEntry(
  input: Parameters<NonNullable<ProviderMcpAdapter["upsertServer"]>>[0],
  existing: McpServerWritableConfigType | null,
): Record<string, unknown> {
  const mutations = input.secretMutations ?? {};
  if (input.config.transport === "stdio") {
    const command = input.config.command?.trim();
    if (!command) throw toMcpError("Claude stdio MCP servers require a command.");
    return {
      type: "stdio",
      command,
      args: input.config.args,
      env: applyProviderMcpSecretMutations(existing?.env ?? {}, input.config.env, "env", mutations),
    };
  }
  if (input.config.transport === "http") {
    const url = input.config.url?.trim();
    if (!url) throw toMcpError("Claude HTTP MCP servers require a URL.");
    return {
      type: "http",
      url,
      headers: applyProviderMcpSecretMutations(
        existing?.httpHeaders ?? {},
        input.config.httpHeaders,
        "header",
        mutations,
      ),
    };
  }
  throw toMcpError("Claude does not support this MCP transport.");
}

export function readClaudeMcpEntry(
  document: unknown,
  name: string,
): McpServerWritableConfigType | null {
  const root = record(document);
  const servers = record(root?.mcpServers);
  return decodeClaudeMcpServer(servers?.[name]);
}

export const makeClaudeMcpAdapter = (io: ClaudeMcpAdapterIo = defaultIo) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const serverConfig = yield* ServerConfig;
    const pathService = yield* Path.Path;

    const discover = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const entries = Object.entries(deriveProviderInstanceConfigMap(settings)).filter(
        ([, instance]) => instance.driver === CLAUDE_DRIVER,
      );
      const groups = new Map<string, ClaudeMcpRuntime>();
      const providers: McpProviderSupportType[] = [];
      const issues: McpListWorkspacesResult["issues"][number][] = [];

      for (const [rawInstanceId, instance] of entries) {
        const instanceId = rawInstanceId as ProviderInstanceId;
        const enabled = instance.enabled ?? true;
        const decoded = Schema.decodeUnknownExit(ClaudeSettings)(instance.config ?? {});
        if (Exit.isFailure(decoded)) {
          issues.push({
            instanceId,
            message: "Claude settings for this provider instance could not be decoded.",
          });
          continue;
        }
        const claudeSettings = decoded.value;
        const homePath = yield* resolveClaudeHomePath(claudeSettings).pipe(
          Effect.provideService(Path.Path, pathService),
        );
        const processEnv = yield* makeClaudeEnvironment(
          claudeSettings,
          mergeProviderInstanceEnvironment(instance.environment),
        ).pipe(Effect.provideService(Path.Path, pathService));
        const configuredDirectory = processEnv.CLAUDE_CONFIG_DIR?.trim();
        const configPath = configuredDirectory
          ? path.join(pathService.resolve(configuredDirectory), ".claude.json")
          : path.join(homePath, ".claude.json");
        const workspaceId = workspaceIdFor(configPath);
        providers.push(
          Schema.decodeSync(McpProviderSupport)({
            instanceId,
            driver: CLAUDE_DRIVER,
            ...(instance.displayName ? { displayName: instance.displayName } : {}),
            ...(instance.accentColor ? { accentColor: instance.accentColor } : {}),
            enabled,
            status: "external",
            capabilities,
            ...(enabled ? { workspaceId } : {}),
            message: enabled
              ? "Ryco can connect this standalone Claude profile to Agent Control."
              : "This provider instance is disabled. Enable it before using MCP features.",
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
            driver: CLAUDE_DRIVER,
            providerDisplayName: "Claude",
            displayPath: configPath,
            nativeScope: "user",
            formatGeneration: "claude-cli-user-v1",
            capabilities,
            providerMetadata: { configPath, homePath },
            sharedHomePath: homePath,
            mode: "direct",
            selectedInstanceId: instanceId,
            providerInstances: [usage],
          }),
          binaryPath: claudeSettings.binaryPath,
          homePath,
          processEnv,
          configPath,
        });
      }
      return {
        runtimes: [...groups.values()],
        providers,
        issues,
      };
    }).pipe(
      Effect.mapError((cause) => toMcpError("Failed to discover Claude MCP profiles.", cause)),
    );

    const findRuntime = (workspaceId: McpWorkspaceId) =>
      discover.pipe(
        Effect.flatMap(({ runtimes }) => {
          const runtime = runtimes.find((entry) => entry.workspace.id === workspaceId);
          return runtime
            ? Effect.succeed(runtime)
            : Effect.fail(toMcpError("Claude MCP workspace not found."));
        }),
      );

    const readDocument = (runtime: ClaudeMcpRuntime) =>
      Effect.tryPromise({
        try: async () => {
          try {
            return JSON.parse(await io.readText(runtime.configPath)) as unknown;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
            throw error;
          }
        },
        catch: (cause) => toMcpError("Failed to read Claude MCP configuration.", cause),
      });

    const inspect: NonNullable<ProviderMcpAdapter["externalAgentControl"]>["inspect"] = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const document = yield* readDocument(runtime);
        const current = readClaudeMcpEntry(document, input.name);
        if (!current) return { state: "absent", fingerprint: null } as const;
        const fingerprint = externalAgentControlConfigFingerprint(current);
        const desired = externalAgentControlConfigFingerprint(
          externalAgentControlServerConfig(input),
        );
        return {
          state: fingerprint === desired ? ("matching" as const) : ("different" as const),
          fingerprint,
        };
      });

    const runClaudeMcp = (runtime: ClaudeMcpRuntime, args: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: async () => {
          const result = await io.run(runtime.binaryPath, args, {
            cwd: serverConfig.cwd,
            env: runtime.processEnv,
            timeoutMs: CLAUDE_MCP_TIMEOUT_MS,
            maxBufferBytes: CLAUDE_MCP_OUTPUT_LIMIT,
            outputMode: "truncate",
          });
          if (result.timedOut) throw new Error("Claude MCP command timed out.");
          if (result.code !== 0) throw new Error("Claude MCP command exited unsuccessfully.");
          return result;
        },
        catch: (cause) => toMcpError("Claude MCP command failed.", cause),
      });

    const listServers = (input: Parameters<NonNullable<ProviderMcpAdapter["listServers"]>>[0]) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const document = yield* readDocument(runtime);
        const servers: Array<typeof McpServer.Type> = [];
        const warnings: string[] = [];
        for (const [name, value] of readClaudeMcpEntries(document)) {
          if (!Schema.is(McpServerName)(name)) {
            warnings.push("Claude has an MCP entry with a name Ryco cannot manage.");
            continue;
          }
          const config = decodeClaudeMcpServer(value);
          if (!config) {
            warnings.push(`Claude MCP server ${name} uses an unsupported or malformed format.`);
            continue;
          }
          servers.push(publicClaudeMcpServer(name, config));
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
        const beforeDocument = yield* readDocument(runtime);
        const existing = readClaudeMcpEntry(beforeDocument, input.name);
        const nativeEntry = yield* Effect.try({
          try: () => nativeClaudeMcpEntry(input, existing),
          catch: (cause) =>
            Schema.is(McpSettingsError)(cause)
              ? cause
              : toMcpError("Invalid Claude MCP configuration.", cause),
        });
        const desired = decodeClaudeMcpServer(nativeEntry);
        if (!desired) {
          return yield* Effect.fail(toMcpError("Invalid Claude MCP configuration."));
        }
        yield* runClaudeMcp(runtime, [
          "mcp",
          "add-json",
          "--scope",
          "user",
          input.name,
          JSON.stringify(nativeEntry),
        ]);
        const written = readClaudeMcpEntry(yield* readDocument(runtime), input.name);
        if (
          !written ||
          providerMcpConfigFingerprint(written) !== providerMcpConfigFingerprint(desired)
        ) {
          return yield* Effect.fail(toMcpError("Claude did not preserve the MCP server update."));
        }
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    const removeServer: NonNullable<ProviderMcpAdapter["removeServer"]> = (input) =>
      Effect.gen(function* () {
        const runtime = yield* findRuntime(input.workspaceId);
        const existing = readClaudeMcpEntry(yield* readDocument(runtime), input.name);
        if (!existing)
          return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
        yield* runClaudeMcp(runtime, ["mcp", "remove", "--scope", "user", input.name]);
        const remaining = readClaudeMcpEntry(yield* readDocument(runtime), input.name);
        if (remaining)
          return yield* Effect.fail(toMcpError("Claude did not remove the MCP entry."));
        return yield* listServers({ workspaceId: input.workspaceId, detail: "full" });
      });

    return {
      driver: CLAUDE_DRIVER,
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
      externalAgentControl: {
        inspect,
        install: (input) =>
          Effect.gen(function* () {
            const before = yield* inspect(input);
            if (
              (input.expectedFingerprint === null && before.state !== "absent") ||
              (input.expectedFingerprint !== null &&
                before.fingerprint !== input.expectedFingerprint)
            ) {
              return yield* Effect.fail(
                toMcpError("Claude MCP server changed before installation."),
              );
            }
            const runtime = yield* findRuntime(input.workspaceId);
            yield* runClaudeMcp(runtime, [
              "mcp",
              "add",
              "--scope",
              "user",
              input.name,
              "--",
              input.command,
              ...input.args,
            ]);
            const after = yield* inspect(input);
            if (after.state !== "matching" || after.fingerprint === null) {
              return yield* Effect.fail(
                toMcpError("Claude did not preserve the installed MCP entry."),
              );
            }
            return { fingerprint: after.fingerprint };
          }),
        remove: (input) =>
          Effect.gen(function* () {
            const runtime = yield* findRuntime(input.workspaceId);
            const current = readClaudeMcpEntry(yield* readDocument(runtime), input.name);
            if (!current) return { removed: false, preservedUserChanges: false };
            if (externalAgentControlConfigFingerprint(current) !== input.expectedFingerprint) {
              return { removed: false, preservedUserChanges: true };
            }
            yield* runClaudeMcp(runtime, ["mcp", "remove", "--scope", "user", input.name]);
            const remaining = readClaudeMcpEntry(yield* readDocument(runtime), input.name);
            if (remaining) {
              return yield* Effect.fail(toMcpError("Claude did not remove the MCP entry."));
            }
            return { removed: true, preservedUserChanges: false };
          }),
      },
    } satisfies ProviderMcpAdapter;
  });
