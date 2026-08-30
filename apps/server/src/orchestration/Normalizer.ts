import { Effect, FileSystem, Path, Schema } from "effect";
import {
  type ClientOrchestrationCommand,
  DEFAULT_PROJECT_METADATA_DIR,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  ProjectMetadataDir,
  PROVIDER_SEND_TURN_MAX_ATTACHMENT_TOTAL_BYTES,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@ryco/contracts";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import { WorkspaceAccessPolicy } from "../workspace/Services/WorkspaceAccessPolicy.ts";
import { WorkspacePaths } from "../workspace/Services/WorkspacePaths.ts";

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspaceAccessPolicy = yield* WorkspaceAccessPolicy;
    const workspacePaths = yield* WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspaceAccessPolicy
        .assertExistingPath({
          path: workspaceRoot,
          operation: "project workspace",
        })
        .pipe(
          Effect.flatMap((authorizedRoot) => workspacePaths.normalizeWorkspaceRoot(authorizedRoot)),
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspaceAccessPolicy
        .assertPath({
          path: workspaceRoot,
          operation: "project creation",
        })
        .pipe(
          Effect.flatMap((authorizedRoot) =>
            workspacePaths.normalizeWorkspaceRoot(authorizedRoot, {
              createIfMissing: createIfMissing === true,
            }),
          ),
          Effect.flatMap((normalizedRoot) =>
            workspaceAccessPolicy.assertExistingPath({
              path: normalizedRoot,
              operation: "project creation",
            }),
          ),
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    const normalizeProjectMetadataDir = (projectMetadataDir: string | undefined) =>
      Effect.try({
        try: () =>
          Schema.decodeUnknownSync(ProjectMetadataDir)(
            (projectMetadataDir ?? DEFAULT_PROJECT_METADATA_DIR).trim(),
          ),
        catch: () =>
          new OrchestrationDispatchCommandError({
            message: "Project metadata directory must be a relative path inside the project root.",
          }),
      });

    if (command.type === "project.create") {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          command.workspaceRoot,
          command.createWorkspaceRootIfMissing,
        ),
        projectMetadataDir: yield* normalizeProjectMetadataDir(command.projectMetadataDir),
        createWorkspaceRootIfMissing: command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (command.type === "project.meta.update") {
      return {
        ...command,
        ...(command.workspaceRoot !== undefined
          ? { workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot) }
          : {}),
        ...(command.projectMetadataDir !== undefined
          ? { projectMetadataDir: yield* normalizeProjectMetadataDir(command.projectMetadataDir) }
          : {}),
      } satisfies OrchestrationCommand;
    }

    if (command.type !== "thread.turn.start" && command.type !== "thread.turn.steer") {
      return command as OrchestrationCommand;
    }

    const preparedAttachments = yield* Effect.forEach(
      command.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' must use a valid base64 data URL.`,
            });
          }

          const normalizedMimeType = parsed.mimeType.toLowerCase();
          if (normalizedMimeType !== attachment.mimeType.toLowerCase()) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' declares '${attachment.mimeType}' but its payload is '${parsed.mimeType}'.`,
            });
          }
          if (attachment.type === "image" && !normalizedMimeType.startsWith("image/")) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Image attachment '${attachment.name}' must use an image MIME type.`,
            });
          }

          const normalizedBase64 = parsed.base64.replace(/\s+/g, "");
          const bytes = Buffer.from(normalizedBase64, "base64");
          if (
            bytes.byteLength === 0 ||
            bytes.toString("base64") !== normalizedBase64 ||
            bytes.byteLength !== attachment.sizeBytes
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' has invalid base64 data or mismatched size metadata.`,
            });
          }
          const attachmentLimit =
            attachment.type === "image"
              ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
              : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
          if (bytes.byteLength > attachmentLimit) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' is ${bytes.byteLength} bytes; limit is ${attachmentLimit} bytes.`,
            });
          }

          const attachmentId = createAttachmentId(command.threadId);
          if (!attachmentId) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: attachment.type,
            id: attachmentId,
            name: attachment.name,
            mimeType: normalizedMimeType,
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          return { attachment: persistedAttachment, attachmentPath, bytes };
        }),
      { concurrency: 1 },
    );

    const totalAttachmentBytes = preparedAttachments.reduce(
      (total, prepared) => total + prepared.bytes.byteLength,
      0,
    );
    if (totalAttachmentBytes > PROVIDER_SEND_TURN_MAX_ATTACHMENT_TOTAL_BYTES) {
      return yield* new OrchestrationDispatchCommandError({
        message: `Attachments total ${totalAttachmentBytes} bytes; limit is ${PROVIDER_SEND_TURN_MAX_ATTACHMENT_TOTAL_BYTES} bytes.`,
      });
    }

    yield* Effect.forEach(
      preparedAttachments,
      ({ attachment, attachmentPath, bytes }) =>
        fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
          Effect.mapError(
            () =>
              new OrchestrationDispatchCommandError({
                message: `Failed to create attachment directory for '${attachment.name}'.`,
              }),
          ),
          Effect.andThen(
            fileSystem.writeFile(attachmentPath, bytes).pipe(
              Effect.mapError(
                () =>
                  new OrchestrationDispatchCommandError({
                    message: `Failed to persist attachment '${attachment.name}'.`,
                  }),
              ),
            ),
          ),
        ),
      { concurrency: 1, discard: true },
    ).pipe(
      Effect.onError(() =>
        Effect.forEach(
          preparedAttachments,
          ({ attachmentPath }) => fileSystem.remove(attachmentPath).pipe(Effect.ignore),
          { concurrency: 1, discard: true },
        ),
      ),
    );

    const normalizedAttachments = preparedAttachments.map(({ attachment }) => attachment);

    return {
      ...command,
      message: {
        ...command.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });
