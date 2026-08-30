import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@ryco/contracts";
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

const fileTurnCommand = (input?: {
  readonly mimeType?: string;
  readonly dataUrl?: string;
  readonly sizeBytes?: number;
}): ClientOrchestrationCommand => ({
  type: "thread.turn.start",
  commandId: CommandId.make("file-attachment-command"),
  threadId: ThreadId.make("file-attachment-thread"),
  message: {
    messageId: MessageId.make("file-attachment-message"),
    role: "user",
    text: "Review the attachment",
    attachments: [
      {
        type: "file",
        name: "notes.txt",
        mimeType: input?.mimeType ?? "text/plain",
        sizeBytes: input?.sizeBytes ?? 3,
        dataUrl: input?.dataUrl ?? "data:text/plain;base64,YWJj",
      },
    ],
  },
  runtimeMode: "full-access",
  interactionMode: "default",
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

it.effect("persists a validated general file under an opaque path", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceAccessRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-normalizer-file-",
      });
      const layer = makeNormalizerLayer(workspaceAccessRoot);
      const { normalized, persistedBytes, persistedNames } = yield* Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig;
        const normalized = yield* normalizeDispatchCommand(fileTurnCommand());
        if (normalized.type !== "thread.turn.start") {
          throw new Error(`Unexpected normalized command: ${normalized.type}`);
        }
        const attachment = normalized.message.attachments[0];
        if (!attachment) {
          throw new Error("Expected a normalized attachment");
        }
        const persistedPath = `${config.attachmentsDir}/${attachment.id}.bin`;
        return {
          normalized,
          persistedBytes: yield* fileSystem.readFile(persistedPath),
          persistedNames: yield* fileSystem.readDirectory(config.attachmentsDir),
        };
      }).pipe(Effect.provide(layer));

      expect(normalized.type).toBe("thread.turn.start");
      if (normalized.type !== "thread.turn.start") {
        throw new Error(`Unexpected normalized command: ${normalized.type}`);
      }
      const attachment = normalized.message.attachments[0];
      expect(attachment?.type).toBe("file");
      if (!attachment) {
        throw new Error("Expected a normalized attachment");
      }

      expect(persistedNames).toContain(`${attachment.id}.bin`);
      expect(Buffer.from(persistedBytes).toString("utf8")).toBe("abc");
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("rejects mismatched file MIME and size metadata before persistence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceAccessRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "ryco-normalizer-invalid-file-",
      });
      const layer = makeNormalizerLayer(workspaceAccessRoot);
      const { attachmentNames, mimeError, sizeError } = yield* Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig;
        const mimeError = yield* normalizeDispatchCommand(
          fileTurnCommand({ mimeType: "application/json" }),
        ).pipe(Effect.flip);
        const sizeError = yield* normalizeDispatchCommand(fileTurnCommand({ sizeBytes: 4 })).pipe(
          Effect.flip,
        );
        return {
          attachmentNames: yield* fileSystem.readDirectory(config.attachmentsDir),
          mimeError,
          sizeError,
        };
      }).pipe(Effect.provide(layer));
      expect(mimeError.message).toContain("declares 'application/json'");
      expect(sizeError.message).toContain("mismatched size metadata");
      expect(attachmentNames).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);
