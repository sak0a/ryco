import type {
  ComposerDraftImage,
  PersistedComposerImageAttachment,
} from "@ryco/client-runtime/state/composer";

// §4 composer image hydration, kept pure/node-testable (composerDraftStore.ts
// imports the native mobileKV). On RN the in-memory preview is the persisted
// `data:` uri directly — no DOM `File`/`atob` decode (the web path builds a File;
// skipped here, file-free and faithful). Streamed file rows restore from token
// metadata, or as "attach again" rows when the upload never finished.
export type MobileComposerImageAttachment = ComposerDraftImage;

export function hydrateMobileComposerImages(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): MobileComposerImageAttachment[] {
  return attachments.map((attachment) => {
    if (attachment.type === "file") {
      return {
        type: "file" as const,
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewUrl: "",
        ...(attachment.uploadToken !== undefined ? { uploadToken: attachment.uploadToken } : {}),
        ...(attachment.expiresAt !== undefined ? { expiresAt: attachment.expiresAt } : {}),
        ...(attachment.uploadState !== undefined ? { uploadState: attachment.uploadState } : {}),
      };
    }
    return {
      type: "image" as const,
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      previewUrl: attachment.dataUrl,
    };
  }) as MobileComposerImageAttachment[];
}
