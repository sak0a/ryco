import {
  McpListServersResult,
  McpProviderCapabilities,
  McpServerName,
  McpServerWritableConfig,
  McpWorkspace,
  McpWorkspaceId,
  ProviderDriverKind,
  type McpListWorkspacesResult,
  type McpWorkspace as McpWorkspaceType,
} from "@ryco/contracts";
import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderMcpAdapter } from "./ProviderMcpAdapter.ts";
import { makeProviderMcpRegistry } from "./ProviderMcpRegistry.ts";

const capabilities = Schema.decodeSync(McpProviderCapabilities)({
  readConfiguration: "available",
  upsert: "available",
  remove: "available",
  enableDisable: "available",
  reload: "available",
  health: "available",
  inventory: "available",
  oauth: "available",
  scopes: ["user"],
});

function workspace(driver: string, id: string, instanceId: string): McpWorkspaceType {
  return Schema.decodeSync(McpWorkspace)({
    id,
    driver,
    displayPath: `/tmp/${instanceId}`,
    nativeScope: "user",
    formatGeneration: `${driver}-test-v1`,
    capabilities,
    providerMetadata: {},
    sharedHomePath: `/tmp/${instanceId}`,
    mode: "direct",
    selectedInstanceId: instanceId,
    providerInstances: [{ instanceId }],
  });
}

function discovery(
  driver: string,
  workspaces: ReadonlyArray<McpWorkspaceType>,
): McpListWorkspacesResult {
  return {
    workspaces,
    providers: workspaces.map((entry) => ({
      instanceId: entry.selectedInstanceId,
      driver: ProviderDriverKind.make(driver),
      enabled: true,
      status: "managed",
      capabilities,
      workspaceId: entry.id,
      message: "Managed in test.",
    })),
    issues: [],
  };
}

function emptyListResult(entry: McpWorkspaceType): McpListServersResult {
  return Schema.decodeSync(McpListServersResult)({
    workspace: entry,
    servers: [],
    warnings: [],
  });
}

function adapter(input: {
  readonly driver: string;
  readonly workspaces: ReadonlyArray<McpWorkspaceType>;
  readonly mutate?: ProviderMcpAdapter["upsertServer"];
}): ProviderMcpAdapter {
  const listResult = discovery(input.driver, input.workspaces);
  const find = (workspaceId: string) => input.workspaces.find((entry) => entry.id === workspaceId)!;
  const read = (request: { readonly workspaceId: string }) =>
    Effect.succeed(emptyListResult(find(request.workspaceId)));
  return {
    driver: ProviderDriverKind.make(input.driver),
    capabilities,
    listWorkspaces: Effect.succeed(listResult),
    listServers: read,
    upsertServer: input.mutate ?? read,
    setServerEnabled: read,
    removeServer: read,
    reloadServers: read,
    startOauthLogin: () => Effect.succeed({ authorizationUrl: "https://example.test/oauth" }),
  };
}

describe("ProviderMcpRegistry", () => {
  it("merges provider workspaces and routes reads to the owning adapter", async () => {
    const codexWorkspace = workspace("codex", "codex:dGVzdA", "codex");
    const claudeWorkspace = workspace("claudeAgent", "claudeAgent:dGVzdA", "claude");
    const registry = await Effect.runPromise(
      makeProviderMcpRegistry([
        adapter({ driver: "codex", workspaces: [codexWorkspace] }),
        adapter({ driver: "claudeAgent", workspaces: [claudeWorkspace] }),
      ]),
    );

    const discovered = await Effect.runPromise(registry.listWorkspaces);
    expect(discovered.workspaces.map((entry) => entry.driver)).toEqual(["claudeAgent", "codex"]);

    const listed = await Effect.runPromise(
      registry.listServers({ workspaceId: claudeWorkspace.id, detail: "full" }),
    );
    expect(listed.workspace.id).toBe(claudeWorkspace.id);
  });

  it("rejects adapters whose methods contradict declared capabilities", async () => {
    const invalid: ProviderMcpAdapter = {
      driver: ProviderDriverKind.make("broken"),
      capabilities: Schema.decodeSync(McpProviderCapabilities)({
        readConfiguration: "available",
      }),
      listWorkspaces: Effect.succeed({ workspaces: [], providers: [], issues: [] }),
    };

    const result = await Effect.runPromiseExit(makeProviderMcpRegistry([invalid]));
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("serializes mutations for one workspace", async () => {
    const entry = workspace("codex", "codex:bG9jaw", "codex");
    let active = 0;
    let peak = 0;
    const mutate: NonNullable<ProviderMcpAdapter["upsertServer"]> = (input) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          active += 1;
          peak = Math.max(peak, active);
        }),
        () => Effect.sleep("20 millis").pipe(Effect.as(emptyListResult(entry))),
        () =>
          Effect.sync(() => {
            active -= 1;
          }),
      );
    const registry = await Effect.runPromise(
      makeProviderMcpRegistry([adapter({ driver: "codex", workspaces: [entry], mutate })]),
    );
    const config = Schema.decodeSync(McpServerWritableConfig)({
      transport: "stdio",
      command: "test",
    });

    await Effect.runPromise(
      Effect.all(
        [
          registry.upsertServer({
            workspaceId: entry.id,
            name: McpServerName.make("first"),
            config,
          }),
          registry.upsertServer({
            workspaceId: entry.id,
            name: McpServerName.make("second"),
            config,
          }),
        ],
        { concurrency: "unbounded" },
      ),
    );

    expect(peak).toBe(1);
  });

  it("allows independent workspaces to mutate concurrently", async () => {
    const first = workspace("codex", "codex:Zmlyc3Q", "codex_first");
    const second = workspace("codex", "codex:c2Vjb25k", "codex_second");
    let active = 0;
    let peak = 0;
    const mutate: NonNullable<ProviderMcpAdapter["upsertServer"]> = (input) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          active += 1;
          peak = Math.max(peak, active);
        }),
        () =>
          Effect.sleep("20 millis").pipe(
            Effect.as(emptyListResult(input.workspaceId === first.id ? first : second)),
          ),
        () =>
          Effect.sync(() => {
            active -= 1;
          }),
      );
    const registry = await Effect.runPromise(
      makeProviderMcpRegistry([adapter({ driver: "codex", workspaces: [first, second], mutate })]),
    );
    const config = Schema.decodeSync(McpServerWritableConfig)({
      transport: "stdio",
      command: "test",
    });

    await Effect.runPromise(
      Effect.all(
        [
          registry.upsertServer({
            workspaceId: McpWorkspaceId.make(first.id),
            name: McpServerName.make("first"),
            config,
          }),
          registry.upsertServer({
            workspaceId: McpWorkspaceId.make(second.id),
            name: McpServerName.make("second"),
            config,
          }),
        ],
        { concurrency: "unbounded" },
      ),
    );

    expect(peak).toBe(2);
  });

  it("fails closed for stale workspace ids", async () => {
    const entry = workspace("codex", "codex:dGVzdA", "codex");
    const registry = await Effect.runPromise(
      makeProviderMcpRegistry([adapter({ driver: "codex", workspaces: [entry] })]),
    );

    const result = await Effect.runPromiseExit(
      registry.listServers({ workspaceId: McpWorkspaceId.make("codex:c3RhbGU") }),
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});
