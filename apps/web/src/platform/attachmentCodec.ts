import type { AttachmentCodecService, ComposerAttachment } from "@ryco/client-runtime/platform";

export interface WebAttachmentInput {
  readonly id: string;
  readonly file: File;
}

function asWebAttachmentInput(value: unknown): WebAttachmentInput {
  if (typeof value !== "object" || value === null || !("file" in value)) {
    throw new Error("Expected a composer image attachment.");
  }
  return value as WebAttachmentInput;
}

export const webAttachmentCodec: AttachmentCodecService = {
  encode: async (value) => {
    const attachment = asWebAttachmentInput(value);
    return {
      id: attachment.id,
      mime: attachment.file.type,
      size: attachment.file.size,
      bytes: new Uint8Array(await attachment.file.arrayBuffer()),
    };
  },
  decode: async (attachment: ComposerAttachment) => {
    if ("uri" in attachment) {
      return attachment.uri;
    }
    const bytes = new Uint8Array(attachment.bytes.byteLength);
    bytes.set(attachment.bytes);
    return new File([bytes], attachment.id, { type: attachment.mime });
  },
};
