import { EnvironmentId, ProjectId, ThreadId } from "@ryco/contracts";
import {
  workspaceMetadataPayloadBytes,
  type WorkspaceMetadataCache,
} from "@ryco/client-runtime/state/workspace";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  MAX_HOSTED_WEB_CONNECTIONS,
  createHostedConnectionCoordinator,
  startHostedWorkspaceCoordinator,
} from "./hostedConnectionCoordinator";
import { createHostedWebScopeStore } from "./hostedConnectionScopes";
import { hostedHubController, hostedHubStore } from "./state";

const environment = (index: number) => EnvironmentId.make(`env_${String(index).padStart(22, "0")}`);
const thread = (index: number) => ThreadId.make(`thread_${String(index)}`);

function harness() {
  let now = 1;
  const connected = new Set<EnvironmentId>();
  const connects: Array<{ environmentId: EnvironmentId; delayMs: number }> = [];
  const releases: EnvironmentId[] = [];
  const scopes = createHostedWebScopeStore();
  const coordinator = createHostedConnectionCoordinator({
    scopes,
    now: () => now,
    connect: async (environmentId, delayMs) => {
      connects.push({ environmentId, delayMs });
      connected.add(environmentId);
    },
    release: async (environmentId) => {
      releases.push(environmentId);
      connected.delete(environmentId);
    },
    setInterval: () => 1,
    clearInterval: () => undefined,
  });
  return {
    coordinator,
    scopes,
    connected,
    connects,
    releases,
    tick: () => {
      now += 1;
    },
  };
}

describe("hosted Web connection coordinator", () => {
  it("holds the named one-connection ceiling under a five-node fixture", async () => {
    const test = harness();
    const releases = Array.from({ length: 5 }, (_, index) => {
      test.tick();
      return test.scopes.retain(environment(index), {
        type: "thread-detail",
        threadId: thread(index),
      });
    });

    await test.coordinator.reconcile();

    expect(MAX_HOSTED_WEB_CONNECTIONS).toBe(1);
    expect(test.connected.size).toBe(1);
    expect(test.coordinator.snapshot().activeConnectionCount).toBe(1);
    expect(test.coordinator.snapshot().queuedEnvironmentIds).toHaveLength(4);
    expect(test.connects).toHaveLength(1);
    releases.forEach((release) => release());
    test.coordinator.dispose();
  });

  it("keeps LRU state on route release, releases it in background, and restores retained demand once", async () => {
    const test = harness();
    const releaseA = test.scopes.retain(environment(1), {
      type: "thread-detail",
      threadId: thread(1),
    });
    await test.coordinator.reconcile();
    releaseA();
    await test.coordinator.reconcile();
    expect(test.connected.size).toBe(1);

    await test.coordinator.setBackgrounded(true);
    expect(test.connected.size).toBe(0);
    expect(test.releases).toEqual([environment(1)]);

    test.scopes.retain(environment(2), {
      type: "provider-status",
      instanceId: "codex",
    });
    await test.coordinator.setBackgrounded(false);
    expect(test.connected).toEqual(new Set([environment(2)]));
    expect(test.connects.filter((entry) => entry.environmentId === environment(2))).toHaveLength(1);
    test.coordinator.dispose();
  });

  it("releasing directory-route demand cannot disconnect an unrelated retained thread", async () => {
    const test = harness();
    const releaseRetained = test.scopes.retain(environment(1), {
      type: "thread-detail",
      threadId: thread(1),
    });
    await test.coordinator.reconcile();
    const releaseRoute = test.scopes.retain(environment(2), {
      type: "thread-detail",
      threadId: thread(2),
    });
    await test.coordinator.reconcile();
    expect(test.connected).toEqual(new Set([environment(1)]));
    expect(test.coordinator.snapshot().queuedEnvironmentIds).toEqual([environment(2)]);

    releaseRoute();
    await test.coordinator.reconcile();
    expect(test.connected).toEqual(new Set([environment(1)]));
    expect(test.releases).toEqual([]);
    releaseRetained();
    test.coordinator.dispose();
  });

  it("refcounts identical mounted scopes and releases demand only after the final unmount", () => {
    const scopes = createHostedWebScopeStore();
    const first = scopes.retain(environment(1), { type: "vcs-status", cwd: "/repo" });
    const second = scopes.retain(environment(1), { type: "vcs-status", cwd: "/repo" });
    expect(scopes.list()).toMatchObject([{ refCount: 2 }]);
    first();
    expect(scopes.list()).toMatchObject([{ refCount: 1 }]);
    second();
    expect(scopes.list()).toEqual([]);
  });

  it("purges native-only cache entries and the exact account namespace on sign-out", async () => {
    const environmentId = environment(9);
    const snapshot = {
      schemaVersion: 1 as const,
      environmentId,
      capturedAt: 1,
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
    const record = {
      namespace: { hubOrigin: "https://hub.example.test", accountId: "account-a", environmentId },
      snapshot,
      payloadBytes: workspaceMetadataPayloadBytes(snapshot),
      updatedAt: 1,
    };
    const purgeEnvironment = vi.fn(async () => undefined);
    const purgeAccount = vi.fn(async () => undefined);
    const cache: WorkspaceMetadataCache = {
      load: async () => null,
      list: async () => [record],
      replace: async () => undefined,
      purgeEnvironment,
      purgeAccount,
    };
    hostedHubController.resetForTests();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: {
        id: "account-a",
        displayName: "Ada",
        role: "owner",
        createdAt: 1,
        disabledAt: null,
      },
      directoryStatus: "ready",
      nodes: [
        {
          id: "node_aaaaaaaaaaaaaaaaaaaaaa",
          environmentId,
          label: "Native only",
          platformOs: "linux",
          platformArch: "x64",
          clientVersion: "1",
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1,
          revokedAt: null,
          revocationReasonCode: null,
          grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
          effectiveRole: "operator",
          presence: { online: true, lastHeartbeatAt: 1 },
          capabilities: { repositoryIdentity: true, nativeClientRequired: true },
        },
      ],
    });
    const stop = startHostedWorkspaceCoordinator({
      cache,
      hubOrigin: "https://hub.example.test",
      setInterval: () => 1,
      clearInterval: () => undefined,
    });
    await vi.waitFor(() => expect(purgeEnvironment).toHaveBeenCalledWith(record.namespace));

    hostedHubStore.setState({ accountStatus: "signed-out", account: null });
    await vi.waitFor(() =>
      expect(purgeAccount).toHaveBeenCalledWith({
        hubOrigin: "https://hub.example.test",
        accountId: "account-a",
      }),
    );
    stop();
    hostedHubController.resetForTests();
  });
});
