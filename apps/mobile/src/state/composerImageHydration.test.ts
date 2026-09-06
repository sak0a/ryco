import { describe, expect, it } from "vite-plus/test";

import type { PersistedComposerImageAttachment } from "@ryco/client-runtime/state/composer";

import { hydrateMobileComposerImages } from "./composerImageHydration";

describe("hydrateMobileComposerImages", () => {
  it("round-trips a persisted attachment into an in-memory composer image (data uri preview)", () => {
    const persisted: PersistedComposerImageAttachment[] = [
      {
        id: "att-1",
        name: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        dataUrl: "data:image/png;base64,AAAA",
      } as PersistedComposerImageAttachment,
    ];

    const images = hydrateMobileComposerImages(persisted);

    expect(images).toHaveLength(1);
    const image = images[0]!;
    expect(image.type).toBe("image");
    expect(image.id).toBe("att-1");
    expect(image.name).toBe("screenshot.png");
    expect(image.mimeType).toBe("image/png");
    expect(image.sizeBytes).toBe(2048);
    // RN preview is the persisted data uri directly — no File/atob decode.
    expect(image.previewUrl).toBe("data:image/png;base64,AAAA");
  });

  it("maps an empty list to no images", () => {
    expect(hydrateMobileComposerImages([])).toEqual([]);
  });

  it("hydrates a token-backed persisted file row with its token metadata", () => {
    const images = hydrateMobileComposerImages([
      {
        type: "file",
        id: "file-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        uploadToken: "tok-1",
        expiresAt: "2026-09-06T00:00:00.000Z",
      } as PersistedComposerImageAttachment,
    ]);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      type: "file",
      id: "file-1",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      uploadToken: "tok-1",
      expiresAt: "2026-09-06T00:00:00.000Z",
      previewUrl: "",
    });
  });

  it("hydrates a needsReattach persisted file row as an attach-again stub", () => {
    const images = hydrateMobileComposerImages([
      {
        type: "file",
        id: "file-2",
        name: "video.mp4",
        mimeType: "video/mp4",
        sizeBytes: 4096,
        uploadState: "needsReattach",
      } as PersistedComposerImageAttachment,
    ]);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      type: "file",
      id: "file-2",
      name: "video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4096,
      uploadState: "needsReattach",
    });
  });
});
