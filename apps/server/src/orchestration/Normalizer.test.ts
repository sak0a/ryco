import * as NodeServices from "@effect/platform-node/NodeServices";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

import { attachmentRelativePath, resolveAttachmentPath } from "../attachmentStore.ts";
import {
  ChatAttachmentUploads,
  type ChatAttachmentUploadsShape,
  makeChatAttachmentUploads,
} from "../attachmentUpload.ts";
import { deriveServerPaths, ServerConfig } from "../config.ts";
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
  readonly uploadToken?: string;
  readonly threadId?: string;
  readonly name?: string;
}): ClientOrchestrationCommand => ({
  type: "thread.turn.start",
  commandId: CommandId.make("file-attachment-command"),
  threadId: ThreadId.make(input?.threadId ?? "file-attachment-thread"),
  message: {
    messageId: MessageId.make("file-attachment-message"),
    role: "user",
    text: "Review the attachment",
    attachments: [
      input?.uploadToken !== undefined
        ? {
            type: "file" as const,
            name: input?.name ?? "notes.txt",
            mimeType: input?.mimeType ?? "text/plain",
            sizeBytes: input?.sizeBytes ?? 3,
            uploadToken: input.uploadToken,
          }
        : {
            type: "file" as const,
            name: input?.name ?? "notes.txt",
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

const makeUploadNormalizerContext = (input?: { readonly ttlMs?: number }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "ryco-normalizer-upload-",
    });
    const workspaceAccessRoot = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "ryco-normalizer-upload-root-",
    });
    const derivedPaths = yield* deriveServerPaths(baseDir, undefined).pipe(
      Effect.provide(NodeServices.layer),
    );
    const uploads = yield* makeChatAttachmentUploads({
      attachmentsDir: derivedPaths.attachmentsDir,
      ...(input?.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    });
    const layer = Layer.mergeAll(
      WorkspaceAccessPolicyLayer(workspaceAccessRoot),
      WorkspacePathsLive,
      ServerConfig.layerTest(workspaceAccessRoot, baseDir),
      Layer.succeed(ChatAttachmentUploads, uploads),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    return { uploads, layer, attachmentsDir: derivedPaths.attachmentsDir };
  }).pipe(Effect.provide(NodeServices.layer));

const completeUploadFixture = Effect.fn("completeUploadFixture")(function* (
  uploads: ChatAttachmentUploadsShape,
  input: { readonly threadId: string; readonly name: string; readonly sizeBytes: number },
) {
  const created = yield* uploads.create({
    threadId: ThreadId.make(input.threadId),
    name: input.name,
    mimeType: "text/plain",
    sizeBytes: input.sizeBytes,
  });
  const lease = yield* uploads.beginUpload(created.uploadToken);
  yield* Effect.promise(async () => {
    await mkdir(path.dirname(lease.finalPath), { recursive: true });
    await writeFile(lease.finalPath, Buffer.from("abc"));
  });
  yield* uploads.completeUpload(created.uploadToken);
  return { created, lease };
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

it.effect("adopts a streamed upload through its token and extension-suffixed id", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { uploads, layer, attachmentsDir } = yield* makeUploadNormalizerContext();
      const threadId = "file-attachment-thread";
      const { lease } = yield* completeUploadFixture(uploads, {
        threadId,
        name: "notes.txt",
        sizeBytes: 3,
      });

      const normalized = yield* normalizeDispatchCommand(
        fileTurnCommand({ uploadToken: lease.uploadToken }),
      ).pipe(Effect.provide(layer));

      expect(normalized.type).toBe("thread.turn.start");
      if (normalized.type !== "thread.turn.start") {
        throw new Error(`Unexpected normalized command: ${normalized.type}`);
      }
      const attachment = normalized.message.attachments[0];
      expect(attachment?.type).toBe("file");
      if (!attachment || attachment.type !== "file") {
        throw new Error("Expected a normalized file attachment");
      }
      const attachmentId = attachment.id ?? "";
      expect(attachment.id).toBe(lease.attachmentId);
      expect(attachmentId.endsWith("-txt")).toBe(true);
      expect(attachment).not.toHaveProperty("dataUrl");
      expect(attachment).not.toHaveProperty("uploadToken");
      expect(attachmentRelativePath(attachment)).toBe(attachmentId);

      const persistedPath = resolveAttachmentPath({
        attachmentsDir,
        attachment,
      });
      expect(persistedPath).toBe(`${attachmentsDir}/${attachment.id}`);
      expect((yield* Effect.promise(() => readFile(persistedPath ?? ""))).toString()).toBe("abc");
    }),
  ),
);

it.effect("adopts a streamed upload exactly once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { uploads, layer } = yield* makeUploadNormalizerContext();
      const { lease } = yield* completeUploadFixture(uploads, {
        threadId: "file-attachment-thread",
        name: "notes.txt",
        sizeBytes: 3,
      });

      yield* normalizeDispatchCommand(fileTurnCommand({ uploadToken: lease.uploadToken })).pipe(
        Effect.provide(layer),
      );
      const reuseError = yield* normalizeDispatchCommand(
        fileTurnCommand({ uploadToken: lease.uploadToken }),
      ).pipe(Effect.provide(layer), Effect.flip);
      expect(reuseError._tag).toBe("OrchestrationDispatchCommandError");
    }),
  ),
);

it.live("rejects adoption on thread, size mismatches, and expired tokens", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { uploads, layer } = yield* makeUploadNormalizerContext({ ttlMs: 30 });
      const { created, lease } = yield* completeUploadFixture(uploads, {
        threadId: "file-attachment-thread",
        name: "notes.txt",
        sizeBytes: 3,
      });

      const threadMismatch = yield* normalizeDispatchCommand(
        fileTurnCommand({ uploadToken: lease.uploadToken, threadId: "other-thread" }),
      ).pipe(Effect.provide(layer), Effect.flip);
      expect(threadMismatch.message).toContain("does not match its file upload registration");

      const sizeMismatch = yield* normalizeDispatchCommand(
        fileTurnCommand({ uploadToken: lease.uploadToken, sizeBytes: 4 }),
      ).pipe(Effect.provide(layer), Effect.flip);
      expect(sizeMismatch.message).toContain("does not match its file upload registration");

      yield* Effect.sleep("40 millis");
      const expiredError = yield* normalizeDispatchCommand(
        fileTurnCommand({ uploadToken: created.uploadToken }),
      ).pipe(Effect.provide(layer), Effect.flip);
      expect(expiredError.message).toContain("unknown or already-used file upload");
    }),
  ),
);

it.effect("rejects upload references when the upload service is absent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const layerWithoutUploads = Layer.mergeAll(
        WorkspaceAccessPolicyLayer("/tmp"),
        WorkspacePathsLive,
        ServerConfig.layerTest("/tmp", { prefix: "ryco-normalizer-noupload-" }),
      ).pipe(Layer.provideMerge(NodeServices.layer));
      const uploads = yield* makeChatAttachmentUploads({ attachmentsDir: "/tmp" });
      const created = yield* uploads.create({
        threadId: ThreadId.make("file-attachment-thread"),
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 3,
      });

      const error = yield* normalizeDispatchCommand(
        fileTurnCommand({ uploadToken: created.uploadToken }),
      ).pipe(Effect.provide(layerWithoutUploads), Effect.flip);
      expect(error._tag).toBe("OrchestrationDispatchCommandError");
      expect(error.message).toContain("upload reference");
    }),
  ),
);
