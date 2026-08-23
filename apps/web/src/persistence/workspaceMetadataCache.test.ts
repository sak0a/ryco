import { EnvironmentId, ProjectId } from "@ryco/contracts";
import { workspaceMetadataPayloadBytes } from "@ryco/client-runtime/state/workspace";
import { describe, expect, it } from "vite-plus/test";

import {
  createBrowserWorkspaceMetadataCache,
  HOSTED_WORKSPACE_METADATA_CACHE_KEY,
  type WorkspaceMetadataStorage,
} from "./workspaceMetadataCache";

function memoryStorage(): WorkspaceMetadataStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function record(origin: string, accountId: string, environment: string, capturedAt = 1) {
  const environmentId = EnvironmentId.make(environment);
  const snapshot = {
    schemaVersion: 1 as const,
    environmentId,
    capturedAt,
    projects: [
      {
        environmentId,
        id: ProjectId.make("project"),
        name: "Project",
        cwd: "/project",
        repositoryIdentity: null,
        createdAt: null,
        updatedAt: null,
      },
    ],
    worktrees: [],
    threads: [],
  };
  return {
    namespace: { hubOrigin: origin, accountId, environmentId },
    snapshot,
    payloadBytes: workspaceMetadataPayloadBytes(snapshot),
    updatedAt: capturedAt,
  };
}

describe("hosted browser workspace metadata cache", () => {
  it("namespaces colliding environments by normalized Hub origin and account", async () => {
    const storage = memoryStorage();
    const cache = createBrowserWorkspaceMetadataCache(storage);
    await cache.replace(record("HTTPS://HUB.EXAMPLE.TEST/", "account-a", "same", 1));
    await cache.replace(record("https://hub.example.test", "account-b", "same", 2));

    expect(
      await cache.list({ hubOrigin: "https://hub.example.test", accountId: "account-a" }),
    ).toHaveLength(1);
    expect(
      await cache.list({ hubOrigin: "https://hub.example.test/", accountId: "account-b" }),
    ).toHaveLength(1);
    await expect(
      cache.load({
        hubOrigin: "https://HUB.example.test/",
        accountId: "account-a",
        environmentId: EnvironmentId.make("same"),
      }),
    ).resolves.toMatchObject({ updatedAt: 1 });
  });

  it("purges only the requested environment or account namespace", async () => {
    const storage = memoryStorage();
    const cache = createBrowserWorkspaceMetadataCache(storage);
    const first = record("https://hub.example.test", "account-a", "one", 1);
    const second = record("https://hub.example.test", "account-a", "two", 2);
    const other = record("https://hub.example.test", "account-b", "one", 3);
    await cache.replace(first);
    await cache.replace(second);
    await cache.replace(other);

    await cache.purgeEnvironment(first.namespace);
    expect(
      await cache.list({ hubOrigin: first.namespace.hubOrigin, accountId: "account-a" }),
    ).toEqual([second]);
    await cache.purgeAccount({ hubOrigin: first.namespace.hubOrigin, accountId: "account-a" });
    expect(
      await cache.list({ hubOrigin: first.namespace.hubOrigin, accountId: "account-a" }),
    ).toEqual([]);
    expect(
      await cache.list({ hubOrigin: first.namespace.hubOrigin, accountId: "account-b" }),
    ).toEqual([other]);
  });

  it("drops malformed or non-metadata documents instead of exposing them", async () => {
    const storage = memoryStorage();
    storage.values.set(
      HOSTED_WORKSPACE_METADATA_CACHE_KEY,
      JSON.stringify({ version: 1, records: [{ namespace: { accountId: "a" }, secret: "no" }] }),
    );
    const cache = createBrowserWorkspaceMetadataCache(storage);
    expect(await cache.list({ hubOrigin: "https://hub.example.test", accountId: "a" })).toEqual([]);
  });
});
