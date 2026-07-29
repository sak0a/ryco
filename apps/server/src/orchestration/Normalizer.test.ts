import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, type ClientOrchestrationCommand } from "@ryco/contracts";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { expect } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { WorkspaceAccessPolicyLayer } from "../workspace/Layers/WorkspaceAccessPolicy.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";

const projectCreateCommand = (workspaceRoot: string): ClientOrchestrationCommand => ({
  type: "project.create",
  commandId: CommandId.make("restricted-project-create"),
  projectId: ProjectId.make("restricted-project"),
  title: "Restricted project",
  workspaceRoot,
  createWorkspaceRootIfMissing: true,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const makeNormalizerLayer = (workspaceAccessRoot: string) =>
  Layer.mergeAll(
    WorkspaceAccessPolicyLayer(workspaceAccessRoot),
    WorkspacePathsLive,
    ServerConfig.layerTest(workspaceAccessRoot, {
      prefix: "ryco-normalizer-test-",
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

it.effect("project creation rejects an outside root before creating it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceAccessRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-normalizer-restricted-",
      });
      const outsideParent = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-normalizer-outside-",
      });
      const requestedRoot = `${outsideParent}/new-project`;

      const error = yield* normalizeDispatchCommand(projectCreateCommand(requestedRoot)).pipe(
        Effect.provide(makeNormalizerLayer(workspaceAccessRoot)),
        Effect.flip,
      );

      expect(error._tag).toBe("OrchestrationDispatchCommandError");
      expect(error.message).toContain("access is restricted");
      expect(yield* fileSystem.exists(requestedRoot)).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("project creation accepts and canonicalizes a root inside the workspace", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceAccessRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-normalizer-restricted-",
      });
      const requestedRoot = `${workspaceAccessRoot}/new-project`;

      const normalized = yield* normalizeDispatchCommand(projectCreateCommand(requestedRoot)).pipe(
        Effect.provide(makeNormalizerLayer(workspaceAccessRoot)),
      );

      expect(normalized.type).toBe("project.create");
      if (normalized.type !== "project.create") {
        throw new Error(`Unexpected normalized command: ${normalized.type}`);
      }
      expect(normalized.workspaceRoot).toBe(yield* fileSystem.realPath(requestedRoot));
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);
