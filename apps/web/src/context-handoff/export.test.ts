import { describe, expect, it, vi } from "vite-plus/test";

import {
  ContextHandoffChunkError,
  readVerifiedContextHandoffExport,
  readVerifiedContextHandoffText,
} from "./export";

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("context handoff export assembly", () => {
  it("assembles sequential UTF-8 chunks and verifies the final digest", async () => {
    const text = "first 😀 second";
    const digest = await sha256(text);
    const chunks = ["first ", "😀 second"];
    const offsets = [0, 6];
    const read = vi.fn(async (offset: number) => {
      const index = offsets.indexOf(offset);
      const chunk = chunks[index]!;
      const nextOffset = index === chunks.length - 1 ? null : offsets[index + 1]!;
      return {
        offset,
        chunk,
        nextOffset,
        totalBytes: new TextEncoder().encode(text).byteLength,
        digest,
      };
    });

    await expect(readVerifiedContextHandoffText({ read })).resolves.toMatchObject({
      text,
      digest,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rejects gaps, digest changes, and unsafe export filenames", async () => {
    const digest = await sha256("a");
    await expect(
      readVerifiedContextHandoffText({
        read: async () => ({
          offset: 1,
          chunk: "a",
          nextOffset: null,
          totalBytes: 1,
          digest,
        }),
      }),
    ).rejects.toBeInstanceOf(ContextHandoffChunkError);

    await expect(
      readVerifiedContextHandoffExport({
        expectedExtension: "json",
        read: async () => ({
          scope: "sent",
          format: "json",
          offset: 0,
          chunk: "a",
          nextOffset: null,
          totalBytes: 1,
          digest,
          filename: "../../secret.json",
        }),
      }),
    ).rejects.toThrow("unsafe export filename");
  });
});
