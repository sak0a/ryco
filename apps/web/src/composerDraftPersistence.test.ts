import { describe, expect, it } from "vite-plus/test";

import {
  composerFileUploadEngine,
  seedComposerFileNeedsReattach,
  seedComposerFileUploadFromPersisted,
} from "./composerFileUpload";
import { hydrateImagesFromPersistedWithFailures } from "./composerDraftPersistence";

function releaseSeeded(ids: readonly string[]): void {
  for (const id of ids) {
    composerFileUploadEngine.release(id);
  }
}

describe("hydrateImagesFromPersistedWithFailures — streamed file attachments", () => {
  it("restores uploaded files from token metadata and seeds the engine", () => {
    const seeded = ["file-token-1"];
    try {
      const { images, unreadableImageNames } = hydrateImagesFromPersistedWithFailures([
        {
          type: "file",
          id: "file-token-1",
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          uploadToken: "upload-token-1",
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      ]);

      expect(unreadableImageNames).toEqual([]);
      expect(images).toHaveLength(1);
      expect(images[0]).toMatchObject({
        type: "file",
        id: "file-token-1",
        name: "report.pdf",
        file: null,
        previewUrl: "",
      });
      const status = composerFileUploadEngine.get("file-token-1")?.status;
      expect(status?.kind).toBe("uploaded");
    } finally {
      releaseSeeded(seeded);
    }
  });

  it("restores interrupted uploads as needsReattach rows", () => {
    const seeded = ["file-pending-1"];
    try {
      const { images } = hydrateImagesFromPersistedWithFailures([
        {
          type: "file",
          id: "file-pending-1",
          name: "video.mov",
          mimeType: "video/quicktime",
          sizeBytes: 4096,
          uploadState: "needsReattach",
        },
      ]);
      expect(images[0]).toMatchObject({
        type: "file",
        id: "file-pending-1",
        name: "video.mov",
        file: null,
      });
      expect(composerFileUploadEngine.get("file-pending-1")?.status.kind).toBe("needsReattach");
    } finally {
      releaseSeeded(seeded);
    }
  });

  it("still decodes dataUrl attachments and flags unreadable ones", () => {
    const { images, unreadableImageNames } = hydrateImagesFromPersistedWithFailures([
      {
        type: "image",
        id: "img-1",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 4,
        dataUrl: "data:image/png;base64,aGVsbG8=",
      },
      {
        type: "file",
        id: "img-2",
        name: "broken.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 4,
        dataUrl: "data:application/octet-stream;base64,!!!!",
      },
    ]);
    expect(unreadableImageNames).toEqual(["broken.bin"]);
    expect(images).toHaveLength(1);
    expect(images[0]?.file).toBeInstanceOf(File);
  });

  it("seed helpers demote expired tokens and skip uploaded records", () => {
    const seeded = ["seed-expired", "seed-live"];
    try {
      seedComposerFileUploadFromPersisted({
        attachmentId: "seed-expired",
        name: "old.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 1,
        uploadToken: "tok",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(composerFileUploadEngine.get("seed-expired")?.status.kind).toBe("needsReattach");

      seedComposerFileUploadFromPersisted({
        attachmentId: "seed-live",
        name: "new.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 1,
        uploadToken: "tok",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      seedComposerFileNeedsReattach("seed-live");
      expect(composerFileUploadEngine.get("seed-live")?.status.kind).toBe("uploaded");
    } finally {
      releaseSeeded(seeded);
    }
  });
});
