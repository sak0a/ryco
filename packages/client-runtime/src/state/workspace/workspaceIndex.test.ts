import { EnvironmentId, ProjectId, ThreadId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { reconcileWorkspaceMachine } from "./machineCatalog.js";
import {
  WORKSPACE_METADATA_SNAPSHOT_SCHEMA_VERSION,
  type WorkspaceMetadataSnapshot,
} from "./types.js";
import { buildUnifiedWorkspaceIndex } from "./workspaceIndex.js";

const repositoryIdentity = {
  canonicalKey: "github.com/example/ryco",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/example/ryco.git",
  },
  remotes: [],
};

function snapshot(environment: string, capturedAt = 1): WorkspaceMetadataSnapshot {
  const environmentId = EnvironmentId.make(environment);
  const projectId = ProjectId.make("same-project-id");
  return {
    schemaVersion: WORKSPACE_METADATA_SNAPSHOT_SCHEMA_VERSION,
    environmentId,
    capturedAt,
    projects: [
      {
        environmentId,
        id: projectId,
        name: `Ryco ${environment}`,
        cwd: "/ryco",
        repositoryIdentity,
        createdAt: null,
        updatedAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    worktrees: [],
    threads: [
      {
        environmentId,
        id: ThreadId.make("same-thread-id"),
        projectId,
        worktreeId: null,
        title: `Thread ${environment}`,
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: null,
        archivedAt: null,
        modelSelection: null,
        providerDriver: null,
        branch: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        deliveryUnknown: false,
      },
    ],
  };
}

function machine(environment: string, nativeTrust: "verified" | "identity-conflict" = "verified") {
  return reconcileWorkspaceMachine({
    environmentId: EnvironmentId.make(environment),
    label: `Machine ${environment}`,
    clientTier: "native",
    nativeTrust,
    requiresNativeVerification: true,
    effectiveRole: "operator",
    online: true,
    lastSeenAt: 100,
    observedAt: 101,
  });
}

describe("unified workspace index", () => {
  it("keeps colliding physical ids scoped while grouping repository copies", () => {
    const index = buildUnifiedWorkspaceIndex({
      machines: [machine("a"), machine("b")],
      snapshots: [snapshot("a"), snapshot("b")],
      localDesktopEnvironmentId: EnvironmentId.make("a"),
    });
    expect(index.projects).toHaveLength(2);
    expect(index.threads).toHaveLength(2);
    expect(new Set(index.threads.map((thread) => thread.id)).size).toBe(1);
    expect(new Set(index.threads.map((thread) => thread.environmentId))).toEqual(
      new Set([EnvironmentId.make("a"), EnvironmentId.make("b")]),
    );
    expect(index.logicalProjects).toHaveLength(1);
    expect(index.logicalProjects[0]?.variants).toHaveLength(2);
  });

  it("keeps identity-conflict history locked and out of normal workspace rows", () => {
    const index = buildUnifiedWorkspaceIndex({
      machines: [machine("a", "identity-conflict"), machine("b")],
      snapshots: [snapshot("a", 10), snapshot("b", 20)],
    });
    expect(index.snapshots).toContainEqual({
      status: "locked-stale",
      environmentId: EnvironmentId.make("a"),
      capturedAt: 10,
    });
    expect(index.projects.map((project) => project.environmentId)).toEqual([
      EnvironmentId.make("b"),
    ]);
    expect(index.threads.map((thread) => thread.environmentId)).toEqual([EnvironmentId.make("b")]);
  });

  it("takes only the newest complete snapshot per environment", () => {
    const old = snapshot("a", 1);
    const next = {
      ...snapshot("a", 2),
      projects: [{ ...snapshot("a", 2).projects[0]!, name: "Newest" }],
    };
    const index = buildUnifiedWorkspaceIndex({
      machines: [machine("a")],
      snapshots: [next, old],
    });
    expect(index.projects).toMatchObject([{ name: "Newest" }]);
  });
});
