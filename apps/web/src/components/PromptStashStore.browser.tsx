import { PROMPT_STASH_STORAGE_KEY } from "@ryco/client-runtime/state/composer";
import { describe, expect, it } from "vite-plus/test";

import { createPromptStashStore } from "../promptStashStore";

describe("hosted prompt stash storage boundary", () => {
  it("keeps prompt and image canaries out of browser localStorage", () => {
    const promptCanary = "HOSTED_PROMPT_CANARY_7f0944";
    const imageCanary = "HOSTED_IMAGE_CANARY_5a2901";
    localStorage.clear();
    localStorage.setItem("unrelated", "keep");

    const store = createPromptStashStore({ hosted: true });
    const result = store.getState().stashEntry({
      id: "hosted-canary",
      createdAt: "2026-07-31T12:00:00.000Z",
      prompt: promptCanary,
      attachments: [
        {
          id: "hosted-image",
          name: "hosted.png",
          mimeType: "image/png",
          sizeBytes: 3,
          dataUrl: `data:image/png;base64,${imageCanary}`,
        },
      ],
      droppedImageNames: [],
      unreadableImageNames: [],
      pendingImageCount: 0,
    });

    expect(result).toMatchObject({ written: true, durable: false });
    expect(store.getState().entries[0]?.prompt).toBe(promptCanary);
    expect(localStorage.getItem(PROMPT_STASH_STORAGE_KEY)).toBeNull();
    const allStoredValues = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.getItem(localStorage.key(index) ?? "") ?? "",
    ).join("\n");
    expect(allStoredValues).not.toContain(promptCanary);
    expect(allStoredValues).not.toContain(imageCanary);
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
