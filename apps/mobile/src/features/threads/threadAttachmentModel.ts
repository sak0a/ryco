import type { ChatAttachment, ChatFileAttachment } from "@ryco/client-runtime/state/threads";

/**
 * Attachment dimensions are advisory: the server may omit them even for media,
 * so they are read structurally instead of through the runtime attachment
 * types. Missing or zero dimensions mean an unknown-size slot.
 */
interface SizedChatAttachment {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface AttachmentDimensions {
  readonly width: number;
  readonly height: number;
}

/** Pixel width of a fixed-size image slot; matches the previous w-36 slot. */
export const IMAGE_ATTACHMENT_SLOT_WIDTH = 144;

/** Fallback aspect ratio for media whose dimensions were not probed. */
export const DEFAULT_MEDIA_ASPECT_RATIO = 16 / 9;

export function readAttachmentDimensions(attachment: ChatAttachment): AttachmentDimensions | null {
  const sized = attachment as SizedChatAttachment;
  return sized.width !== undefined &&
    sized.height !== undefined &&
    sized.width > 0 &&
    sized.height > 0
    ? { width: sized.width, height: sized.height }
    : null;
}

export function isVideoFileAttachment(
  attachment: ChatAttachment,
): attachment is ChatFileAttachment {
  return (
    attachment.type === "file" &&
    typeof attachment.mimeType === "string" &&
    attachment.mimeType.toLowerCase().startsWith("video/")
  );
}
