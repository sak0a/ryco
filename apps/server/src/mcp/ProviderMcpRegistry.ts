import {
  McpSettingsError,
  type McpListServersInput,
  type McpListServersResult,
  type McpListWorkspacesResult,
  type McpOauthLoginInput,
  type McpOauthLoginResult,
  type McpProviderSupport,
  type McpServerEnabledInput,
  type McpServerRemoveInput,
  type McpServerUpsertInput,
  type McpServersReloadInput,
  type McpWorkspace,
  type McpWorkspaceId,
} from "@ryco/contracts";
import { Effect, Option, SynchronizedRef } from "effect";
import * as Semaphore from "effect/Semaphore";

import { type ProviderMcpAdapter, validateProviderMcpAdapter } from "./ProviderMcpAdapter.ts";

export interface ProviderMcpRegistryShape {
  readonly listWorkspaces: Effect.Effect<McpListWorkspacesResult, McpSettingsError>;
  readonly listServers: (
    input: McpListServersInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly upsertServer: (
    input: McpServerUpsertInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly setServerEnabled: (
    input: McpServerEnabledInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly removeServer: (
    input: McpServerRemoveInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly reloadServers: (
    input: McpServersReloadInput,
  ) => Effect.Effect<McpListServersResult, McpSettingsError>;
  readonly startOauthLogin: (
    input: McpOauthLoginInput,
  ) => Effect.Effect<McpOauthLoginResult, McpSettingsError>;
}

function mcpError(message: string, cause?: unknown): McpSettingsError {
  return new McpSettingsError({ message, ...(cause === undefined ? {} : { cause }) });
}

function compareProviders(left: McpProviderSupport, right: McpProviderSupport): number {
  return (
    Number(right.enabled) - Number(left.enabled) ||
    left.driver.localeCompare(right.driver) ||
    left.instanceId.localeCompare(right.instanceId)
  );
}

function compareWorkspaces(left: McpWorkspace, right: McpWorkspace): number {
  return (
    left.driver.localeCompare(right.driver) || left.displayPath.localeCompare(right.displayPath)
  );
}

export const makeProviderMcpRegistry = (
  adapters: ReadonlyArray<ProviderMcpAdapter>,
): Effect.Effect<ProviderMcpRegistryShape, McpSettingsError> =>
  Effect.gen(function* () {
    const driverSet = new Set<string>();
    for (const adapter of adapters) {
      if (driverSet.has(adapter.driver)) {
        return yield* Effect.fail(
          mcpError(`Multiple MCP adapters are registered for provider driver ${adapter.driver}.`),
        );
      }
      driverSet.add(adapter.driver);
      const issues = validateProviderMcpAdapter(adapter);
      if (issues.length > 0) {
        return yield* Effect.fail(
          mcpError(`Invalid MCP adapter for ${adapter.driver}: ${issues.join("; ")}.`),
        );
      }
    }

    const locksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const getWorkspaceLock = (workspaceId: McpWorkspaceId) =>
      SynchronizedRef.modifyEffect(locksRef, (current) => {
        const existing = Option.fromNullishOr(current.get(workspaceId));
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(workspaceId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
        });
      });

    const readAdapters = Effect.forEach(adapters, (adapter) => adapter.listWorkspaces, {
      concurrency: "unbounded",
    });

    const listWorkspaces = readAdapters.pipe(
      Effect.flatMap((results) => {
        const workspaces = new Map<string, McpWorkspace>();
        const providers = new Map<string, McpProviderSupport>();
        const issues: McpListWorkspacesResult["issues"][number][] = [];
        for (const result of results) {
          for (const workspace of result.workspaces) {
            if (workspaces.has(workspace.id)) {
              return Effect.fail(mcpError(`MCP workspace id collision: ${workspace.id}.`));
            }
            workspaces.set(workspace.id, workspace);
          }
          for (const provider of result.providers) {
            const existing = providers.get(provider.instanceId);
            if (existing && existing.driver !== provider.driver) {
              return Effect.fail(
                mcpError(`MCP provider instance collision: ${provider.instanceId}.`),
              );
            }
            if (!existing || provider.workspaceId !== undefined) {
              providers.set(provider.instanceId, provider);
            }
          }
          issues.push(...result.issues);
        }
        return Effect.succeed({
          workspaces: [...workspaces.values()].toSorted(compareWorkspaces),
          providers: [...providers.values()].toSorted(compareProviders),
          issues,
        });
      }),
    );

    const findAdapter = (workspaceId: McpWorkspaceId) =>
      Effect.gen(function* () {
        const matches: ProviderMcpAdapter[] = [];
        for (const adapter of adapters) {
          const result = yield* adapter.listWorkspaces;
          if (result.workspaces.some((workspace) => workspace.id === workspaceId)) {
            matches.push(adapter);
          }
        }
        if (matches.length === 0) {
          return yield* Effect.fail(mcpError("MCP workspace not found."));
        }
        if (matches.length > 1) {
          return yield* Effect.fail(mcpError(`MCP workspace id collision: ${workspaceId}.`));
        }
        return matches[0]!;
      });

    const route = <A, I extends { readonly workspaceId: McpWorkspaceId }>(
      operation: keyof Pick<
        ProviderMcpAdapter,
        | "listServers"
        | "upsertServer"
        | "setServerEnabled"
        | "removeServer"
        | "reloadServers"
        | "startOauthLogin"
      >,
      input: I,
      invoke: (adapter: ProviderMcpAdapter) => Effect.Effect<A, McpSettingsError> | undefined,
    ): Effect.Effect<A, McpSettingsError> =>
      findAdapter(input.workspaceId).pipe(
        Effect.flatMap((adapter) => {
          const effect = invoke(adapter);
          return (
            effect ??
            Effect.fail(mcpError(`Provider ${adapter.driver} does not support MCP ${operation}.`))
          );
        }),
      );

    const mutate = <A, I extends { readonly workspaceId: McpWorkspaceId }>(
      operation: Parameters<typeof route<A, I>>[0],
      input: I,
      invoke: Parameters<typeof route<A, I>>[2],
    ) =>
      Effect.flatMap(getWorkspaceLock(input.workspaceId), (semaphore) =>
        semaphore.withPermit(route(operation, input, invoke)),
      );

    return {
      listWorkspaces,
      listServers: (input) =>
        route("listServers", input, (adapter) => adapter.listServers?.(input)),
      upsertServer: (input) =>
        mutate("upsertServer", input, (adapter) => adapter.upsertServer?.(input)),
      setServerEnabled: (input) =>
        mutate("setServerEnabled", input, (adapter) => adapter.setServerEnabled?.(input)),
      removeServer: (input) =>
        mutate("removeServer", input, (adapter) => adapter.removeServer?.(input)),
      reloadServers: (input) =>
        mutate("reloadServers", input, (adapter) => adapter.reloadServers?.(input)),
      startOauthLogin: (input) =>
        mutate("startOauthLogin", input, (adapter) => adapter.startOauthLogin?.(input)),
    };
  });
