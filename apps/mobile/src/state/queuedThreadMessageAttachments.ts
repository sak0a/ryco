import {
  buildSendTurnDispatchAttachment,
  buildSendTurnUploadTokenDispatchAttachment,
  isFileUploadTokenUsable,
} from "@ryco/client-runtime/state/composer";

import { mobileAttachmentCodec } from "../platform/attachmentCodec";
import { isDraftComposerFileAttachment } from "../lib/composerFiles";
import type { QueuedThreadMessage } from "./threadOutboxModel";

export async function buildQueuedThreadMessageAttachments(
  message: Pick<QueuedThreadMessage, "attachments">,
) {
  return Promise.all(
    message.attachments.map(async (attachment) => {
      // Uploaded streamed files dispatch by single-use token; an expired token
      // fails the send (the drain discards it) rather than shipping a dead
      // attachment.
      if (
        isDraftComposerFileAttachment(attachment) &&
        attachment.uploadToken !== undefined &&
        (attachment.expiresAt === undefined ||
          isFileUploadTokenUsable(attachment.expiresAt, Date.now()))
      ) {
        return buildSendTurnUploadTokenDispatchAttachment({
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          uploadToken: attachment.uploadToken,
        });
      }
      if (isDraftComposerFileAttachment(attachment)) {
        throw new Error(`Attach '${attachment.name}' again to send this message.`);
      }
      return buildSendTurnDispatchAttachment({
        attachment: await mobileAttachmentCodec.encode({
          id: attachment.id,
          mime: attachment.mimeType,
          size: attachment.sizeBytes,
          // Persisted data survives image-picker cache eviction while offline.
          uri: attachment.dataUrl ?? "",
        }),
        name: attachment.name,
      });
    }),
  );
}
