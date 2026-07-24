import type { AttachmentCodecService, ComposerAttachment } from "@ryco/client-runtime/platform";

/**
 * A native composer attachment. Image-picker assets carry a `uri` (preferred —
 * no byte copy); assets read as bytes via expo-file-system carry `bytes`.
 */
export interface MobileAttachmentInput {
  readonly id: string;
  readonly mime: string;
  readonly size: number;
  readonly uri?: string;
  readonly bytes?: Uint8Array;
}

function asMobileAttachmentInput(value: unknown): MobileAttachmentInput {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("mime" in value) ||
    !("size" in value)
  ) {
    throw new Error("Expected a composer image attachment.");
  }
  return value as MobileAttachmentInput;
}

/**
 * Converts a native attachment to and from the runtime's neutral flat attachment
 * value. Unlike the web adapter (which round-trips a `File`), the RN adapter
 * carries a `uri` when the platform gives one and only falls back to `bytes`.
 */
export const mobileAttachmentCodec: AttachmentCodecService = {
  encode: async (value) => {
    const attachment = asMobileAttachmentInput(value);
    if (attachment.uri !== undefined) {
      return {
        id: attachment.id,
        mime: attachment.mime,
        size: attachment.size,
        uri: attachment.uri,
      };
    }
    if (attachment.bytes !== undefined) {
      const bytes = new Uint8Array(attachment.bytes.byteLength);
      bytes.set(attachment.bytes);
      return { id: attachment.id, mime: attachment.mime, size: attachment.size, bytes };
    }
    throw new Error("Composer image attachment has neither a uri nor bytes.");
  },
  decode: async (attachment: ComposerAttachment) => {
    if ("uri" in attachment) {
      return {
        id: attachment.id,
        mime: attachment.mime,
        size: attachment.size,
        uri: attachment.uri,
      };
    }
    const bytes = new Uint8Array(attachment.bytes.byteLength);
    bytes.set(attachment.bytes);
    return { id: attachment.id, mime: attachment.mime, size: attachment.size, bytes };
  },
};
