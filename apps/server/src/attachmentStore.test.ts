import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  attachmentRelativePath,
  createAttachmentId,
  parseThreadSegmentFromAttachmentId,
  readPersistedAttachment,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";

describe("attachmentStore", () => {
  it("sanitizes thread ids when creating attachment ids", () => {
    const attachmentId = createAttachmentId("thread.folder/unsafe space");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }

    const threadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    expect(threadSegment).toBeTruthy();
    expect(threadSegment).toMatch(/^[a-z0-9_-]+$/i);
    expect(threadSegment).not.toContain(".");
    expect(threadSegment).not.toContain("%");
    expect(threadSegment).not.toContain("/");
  });

  it("parses exact thread segments from attachment ids without prefix collisions", () => {
    const fooId = "foo-00000000-0000-4000-8000-000000000001";
    const fooBarId = "foo-bar-00000000-0000-4000-8000-000000000002";

    expect(parseThreadSegmentFromAttachmentId(fooId)).toBe("foo");
    expect(parseThreadSegmentFromAttachmentId(fooBarId)).toBe("foo-bar");
  });

  it("normalizes created thread segments to lowercase", () => {
    const attachmentId = createAttachmentId("Thread.Foo");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }
    expect(parseThreadSegmentFromAttachmentId(attachmentId)).toBe("thread-foo");
  });

  it("resolves attachment path by id using the extension that exists on disk", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-attachment-store-"));
    try {
      const attachmentId = "thread-1-attachment";
      const pngPath = path.join(attachmentsDir, `${attachmentId}.png`);
      fs.writeFileSync(pngPath, Buffer.from("hello"));

      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId,
      });
      expect(resolved).toBe(pngPath);

      const fileAttachmentId = "thread-1-file-attachment";
      const filePath = path.join(attachmentsDir, `${fileAttachmentId}.bin`);
      fs.writeFileSync(filePath, Buffer.from("notes"));
      expect(
        resolveAttachmentPathById({
          attachmentsDir,
          attachmentId: fileAttachmentId,
        }),
      ).toBe(filePath);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("returns null when no attachment file exists for the id", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-attachment-store-"));
    try {
      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId: "thread-1-missing",
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("stores general files under an opaque extension", () => {
    expect(
      attachmentRelativePath({
        type: "file",
        id: "thread-1-attachment",
        name: "archive.tar.gz",
        mimeType: "application/gzip",
        sizeBytes: 5,
      }),
    ).toBe("thread-1-attachment.bin");
  });

  it("rejects changed and symlinked persisted attachments", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-attachment-store-"));
    const attachment = {
      type: "file" as const,
      id: "thread-1-attachment",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
    };
    try {
      const attachmentPath = path.join(attachmentsDir, `${attachment.id}.bin`);
      fs.writeFileSync(attachmentPath, Buffer.from("changed"));

      expect(readPersistedAttachment({ attachmentsDir, attachment })).toEqual({
        ok: false,
        reason: "Attachment 'notes.txt' changed after upload; expected 3 bytes but found 7.",
      });

      fs.rmSync(attachmentPath);
      const targetPath = path.join(attachmentsDir, "target.bin");
      fs.writeFileSync(targetPath, Buffer.from("abc"));
      fs.symlinkSync(targetPath, attachmentPath);
      expect(readPersistedAttachment({ attachmentsDir, attachment })).toEqual({
        ok: false,
        reason: "Attachment 'notes.txt' is not a regular file.",
      });
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("reads validated bytes from the same safe descriptor", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-attachment-store-"));
    const attachment = {
      type: "file" as const,
      id: "thread-1-attachment",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
    };
    try {
      fs.writeFileSync(path.join(attachmentsDir, `${attachment.id}.bin`), Buffer.from("abc"));
      const result = readPersistedAttachment({ attachmentsDir, attachment });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sizeBytes).toBe(3);
        expect(result.bytes.toString("utf8")).toBe("abc");
      }
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });
});
