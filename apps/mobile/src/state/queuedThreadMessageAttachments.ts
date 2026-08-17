import { buildSendTurnDispatchAttachment } from "@ryco/client-runtime/state/composer";

import { mobileAttachmentCodec } from "../platform/attachmentCodec";
import type { QueuedThreadMessage } from "./threadOutboxModel";

export async function buildQueuedThreadMessageAttachments(
  message: Pick<QueuedThreadMessage, "attachments">,
) {
  return Promise.all(
    message.attachments.map(async (attachment) =>
      buildSendTurnDispatchAttachment({
        attachment: await mobileAttachmentCodec.encode({
          id: attachment.id,
          mime: attachment.mimeType,
          size: attachment.sizeBytes,
          // Persisted data survives image-picker cache eviction while offline.
          uri: attachment.dataUrl,
        }),
        name: attachment.name,
      }),
    ),
  );
}
