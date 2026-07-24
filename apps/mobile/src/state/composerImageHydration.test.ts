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
});
