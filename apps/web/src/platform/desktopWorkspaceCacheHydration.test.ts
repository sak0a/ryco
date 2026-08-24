import { EnvironmentId, ProjectId } from "@ryco/contracts";
import type { WorkspaceMetadataSnapshot } from "@ryco/client-runtime/state/workspace";
import { describe, expect, it, vi } from "vite-plus/test";

import { reconcileDesktopWorkspaceCacheHydration } from "./desktopWorkspaceCacheHydration";

function snapshot(environmentId: EnvironmentId): WorkspaceMetadataSnapshot {
  return {
    schemaVersion: 1,
    environmentId,
    capturedAt: 42,
    projects: [
      {
        environmentId,
        id: ProjectId.make(`project-${environmentId}`),
        name: "Scoped project",
        cwd: "/private/tmp/scoped-project",
        repositoryIdentity: null,
        createdAt: null,
        updatedAt: null,
      },
    ],
    worktrees: [],
    threads: [],
  };
}

describe("Desktop workspace cache hydration", () => {
  it("hydrates valid main-owned snapshots and ignores malformed IPC input", () => {
    const remote = EnvironmentId.make("remote");
    const hydrate = vi.fn();

    const visible = reconcileDesktopWorkspaceCacheHydration({
      snapshots: [snapshot(remote), { environmentId: "malformed" }],
      previouslyHydratedEnvironmentIds: new Set(),
      port: {
        hydrate,
        isCacheHydrated: () => false,
        remove: vi.fn(),
      },
    });

    expect([...visible]).toEqual([remote]);
    expect(hydrate).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledWith(snapshot(remote));
  });

  it("removes only orphaned cache-hydrated state and preserves live state", () => {
    const retained = EnvironmentId.make("retained");
    const orphanedCache = EnvironmentId.make("orphaned-cache");
    const orphanedLive = EnvironmentId.make("orphaned-live");
    const remove = vi.fn();

    reconcileDesktopWorkspaceCacheHydration({
      snapshots: [snapshot(retained)],
      previouslyHydratedEnvironmentIds: new Set([retained, orphanedCache, orphanedLive]),
      port: {
        hydrate: vi.fn(),
        isCacheHydrated: (environmentId) => environmentId === orphanedCache,
        remove,
      },
    });

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(orphanedCache);
  });
});
