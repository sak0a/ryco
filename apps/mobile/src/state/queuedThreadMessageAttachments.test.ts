import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-crypto", () => ({
  randomUUID: () => "generated-id",
  getRandomBytes: (length: number) => new Uint8Array(length),
}));

import { buildQueuedThreadMessageAttachments } from "./queuedThreadMessageAttachments";

const IMAGE = {
  type: "image" as const,
  id: "img-1",
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  dataUrl: "data:image/png;base64,AA",
  previewUri: "file:///tmp/shot.png",
};

describe("buildQueuedThreadMessageAttachments", () => {
  it("dispatches a token-backed file by upload token and keeps the image dataUrl path", async () => {
    const attachments = await buildQueuedThreadMessageAttachments({
      attachments: [
        IMAGE,
        {
          type: "file",
          id: "file-1",
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          readUri: "",
          uploadToken: "tok-1",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    });

    expect(attachments).toEqual([
      {
        type: "image",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 4,
        dataUrl: "data:image/png;base64,AA",
      },
      {
        type: "file",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        uploadToken: "tok-1",
      },
    ]);
  });

  it("dispatches a token file whose expiresAt is absent", async () => {
    const attachments = await buildQueuedThreadMessageAttachments({
      attachments: [
        {
          type: "file",
          id: "file-1",
          name: "clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 10,
          readUri: "",
          uploadToken: "tok-2",
        },
      ],
    });
    expect(attachments).toEqual([
      {
        type: "file",
        name: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 10,
        uploadToken: "tok-2",
      },
    ]);
  });

  it("throws for a needsReattach file so the drain discards the message", async () => {
    await expect(
      buildQueuedThreadMessageAttachments({
        attachments: [
          {
            type: "file",
            id: "file-1",
            name: "clip.mp4",
            mimeType: "video/mp4",
            sizeBytes: 10,
            readUri: "",
            uploadState: "needsReattach",
          },
        ],
      }),
    ).rejects.toThrow("Attach 'clip.mp4' again");
  });

  it("throws for a file whose token already expired", async () => {
    await expect(
      buildQueuedThreadMessageAttachments({
        attachments: [
          {
            type: "file",
            id: "file-1",
            name: "clip.mp4",
            mimeType: "video/mp4",
            sizeBytes: 10,
            readUri: "",
            uploadToken: "tok-3",
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      }),
    ).rejects.toThrow("Attach 'clip.mp4' again");
  });
});
