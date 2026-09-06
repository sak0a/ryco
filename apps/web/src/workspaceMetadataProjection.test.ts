import { EnvironmentId, ProjectId, ThreadId } from "@ryco/contracts";
import type { WorkspaceMetadataSnapshot } from "@ryco/client-runtime/state/workspace";
import { describe, expect, it } from "vite-plus/test";

import {
  remapWorkspaceMetadataSnapshotEnvironment,
  workspaceMetadataToCachedShellSnapshot,
} from "./workspaceMetadataProjection";

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
      threads: [
        {
          environmentId: direct,
          id: ThreadId.make("snoozed"),
          projectId: ProjectId.make("project-1"),
          worktreeId: null,
          title: "Deferred task",
          createdAt: "2026-09-06T10:00:00.000Z",
          updatedAt: "2026-09-06T10:00:00.000Z",
          archivedAt: null,
          snoozedAt: "2026-09-06T10:00:00.000Z",
          snoozedUntil: "2026-09-07T09:00:00.000Z",
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

    const cached = workspaceMetadataToCachedShellSnapshot(
      remapWorkspaceMetadataSnapshotEnvironment(snapshot, hub),
    );
    expect(cached?.threads[0]?.shell).toMatchObject({
      environmentId: hub,
      snoozedAt: "2026-09-06T10:00:00.000Z",
      snoozedUntil: "2026-09-07T09:00:00.000Z",
    });
    expect(cached?.threads[0]?.summary).toMatchObject({ snoozedUntil: "2026-09-07T09:00:00.000Z" });
    expect(remapWorkspaceMetadataSnapshotEnvironment(snapshot, hub)).toMatchObject({
      environmentId: hub,
      projects: [{ environmentId: hub, id: ProjectId.make("project-1") }],
    });
  });
});
