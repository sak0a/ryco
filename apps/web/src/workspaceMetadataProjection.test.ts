import { EnvironmentId, ProjectId } from "@ryco/contracts";
import type { WorkspaceMetadataSnapshot } from "@ryco/client-runtime/state/workspace";
import { describe, expect, it } from "vite-plus/test";

import { remapWorkspaceMetadataSnapshotEnvironment } from "./workspaceMetadataProjection";

describe("workspace metadata projection", () => {
  it("publishes direct local metadata under the local Hub cache namespace", () => {
    const direct = EnvironmentId.make("direct-local");
    const hub = EnvironmentId.make("hub-local");
    const snapshot: WorkspaceMetadataSnapshot = {
      schemaVersion: 1,
      environmentId: direct,
      capturedAt: 1,
      projects: [
        {
          environmentId: direct,
          id: ProjectId.make("project-1"),
          name: "Ryco",
          cwd: "/code/ryco",
          repositoryIdentity: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      worktrees: [],
      threads: [],
    };

    expect(remapWorkspaceMetadataSnapshotEnvironment(snapshot, hub)).toMatchObject({
      environmentId: hub,
      projects: [{ environmentId: hub, id: ProjectId.make("project-1") }],
    });
  });
});
