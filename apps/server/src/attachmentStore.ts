import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";

import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ChatAttachment,
} from "@ryco/contracts";

import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { inferImageExtension, SAFE_IMAGE_FILE_EXTENSIONS } from "./imageMime.ts";

const ATTACHMENT_FILENAME_EXTENSIONS = [...SAFE_IMAGE_FILE_EXTENSIONS, ".bin"];
const ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS = 80;
const ATTACHMENT_ID_THREAD_SEGMENT_PATTERN = "[a-z0-9_]+(?:-[a-z0-9_]+)*";
const ATTACHMENT_ID_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ATTACHMENT_ID_PATTERN = new RegExp(
  `^(${ATTACHMENT_ID_THREAD_SEGMENT_PATTERN})-(${ATTACHMENT_ID_UUID_PATTERN})$`,
  "i",
);

export function toSafeThreadAttachmentSegment(threadId: string): string | null {
  const segment = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  if (segment.length === 0) {
    return null;
  }
  return segment;
}

export function createAttachmentId(threadId: string): string | null {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return null;
  }
  return `${threadSegment}-${randomUUID()}`;
}

export function parseThreadSegmentFromAttachmentId(attachmentId: string): string | null {
  const normalizedId = normalizeAttachmentRelativePath(attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  const match = normalizedId.match(ATTACHMENT_ID_PATTERN);
  if (!match) {
    return null;
  }
  return match[1]?.toLowerCase() ?? null;
}

export function attachmentRelativePath(attachment: ChatAttachment): string {
  switch (attachment.type) {
    case "image": {
      const extension = inferImageExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
    case "file":
      // General files are deliberately stored under an opaque extension. The
      // display name and MIME type remain metadata and never influence a path.
      return `${attachment.id}.bin`;
  }
}

export function resolveAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): string | null {
  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: attachmentRelativePath(input.attachment),
  });
}

export type PersistedAttachmentRead =
  | { readonly ok: true; readonly bytes: Buffer; readonly sizeBytes: number }
  | { readonly ok: false; readonly reason: string };

function attachmentByteLimit(attachment: ChatAttachment): number {
  return attachment.type === "image"
    ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
    : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
}

/**
 * Opens and reads a persisted attachment through one descriptor. Comparing
 * the path's lstat identity with the opened descriptor prevents a path or
 * symlink swap between validation and read, including on platforms without a
 * useful O_NOFOLLOW flag.
 */
export function readPersistedAttachment(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): PersistedAttachmentRead {
  const attachmentPath = resolveAttachmentPath(input);
  if (!attachmentPath) {
    return { ok: false, reason: `Invalid attachment id '${input.attachment.id}'.` };
  }

  let descriptor: number | undefined;
  try {
    const pathInfo = lstatSync(attachmentPath);
    if (!pathInfo.isFile()) {
      return {
        ok: false,
        reason: `Attachment '${input.attachment.name}' is not a regular file.`,
      };
    }
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    descriptor = openSync(attachmentPath, constants.O_RDONLY | noFollow);
    const openedInfo = fstatSync(descriptor);
    if (
      !openedInfo.isFile() ||
      openedInfo.dev !== pathInfo.dev ||
      openedInfo.ino !== pathInfo.ino
    ) {
      return {
        ok: false,
        reason: `Attachment '${input.attachment.name}' changed while it was being opened. Attach it again and retry.`,
      };
    }

    const limit = attachmentByteLimit(input.attachment);
    if (openedInfo.size <= 0 || openedInfo.size > limit) {
      return {
        ok: false,
        reason: `Attachment '${input.attachment.name}' is ${openedInfo.size} bytes; limit is ${limit} bytes.`,
      };
    }
    if (openedInfo.size !== input.attachment.sizeBytes) {
      return {
        ok: false,
        reason: `Attachment '${input.attachment.name}' changed after upload; expected ${input.attachment.sizeBytes} bytes but found ${openedInfo.size}.`,
      };
    }

    const bytes = readFileSync(descriptor);
    const completedInfo = fstatSync(descriptor);
    if (
      completedInfo.dev !== openedInfo.dev ||
      completedInfo.ino !== openedInfo.ino ||
      completedInfo.size !== openedInfo.size ||
      bytes.byteLength !== openedInfo.size
    ) {
      return {
        ok: false,
        reason: `Attachment '${input.attachment.name}' changed while it was being read. Attach it again and retry.`,
      };
    }
    return { ok: true, bytes, sizeBytes: bytes.byteLength };
  } catch {
    return {
      ok: false,
      reason: `Attachment '${input.attachment.name}' is missing, unreadable, or not a safe regular file.`,
    };
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

export function resolveAttachmentPathById(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  for (const extension of ATTACHMENT_FILENAME_EXTENSIONS) {
    const maybePath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: `${normalizedId}${extension}`,
    });
    if (maybePath && existsSync(maybePath)) {
      return maybePath;
    }
  }
  return null;
}

export function parseAttachmentIdFromRelativePath(relativePath: string): string | null {
  const normalized = normalizeAttachmentRelativePath(relativePath);
  if (!normalized || normalized.includes("/")) {
    return null;
  }
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return null;
  }
  const id = normalized.slice(0, extensionIndex);
  return id.length > 0 && !id.includes(".") ? id : null;
}
