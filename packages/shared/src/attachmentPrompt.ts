import type { ChatAttachment } from "@ryco/contracts";

export interface AttachmentPathLineEntry {
  readonly attachment: ChatAttachment;
  readonly resolvedPath?: string | undefined;
}

export function formatAttachmentPathLine(entry: AttachmentPathLineEntry): string {
  const attachment = entry.attachment;
  const name = attachment.name ?? "attachment";
  const mimeType = attachment.mimeType ?? "unknown";
  const sizeText = attachment.sizeBytes === undefined ? "size unknown" : `${attachment.sizeBytes}`;
  if (attachment.id === undefined || entry.resolvedPath === undefined) {
    return `[Attached file] ${name} (${mimeType}, ${sizeText} bytes)`;
  }
  return `[Attached file] ${name} (${mimeType}, ${sizeText} bytes) saved at: ${entry.resolvedPath}`;
}

export function formatAttachmentPathLines(
  entries: ReadonlyArray<AttachmentPathLineEntry>,
): string[] {
  return entries.map(formatAttachmentPathLine);
}

export function appendAttachmentPathLines(
  text: string | undefined,
  pathLines: ReadonlyArray<string>,
): string | undefined {
  if (pathLines.length === 0) {
    return text;
  }
  const lines = pathLines.join("\n");
  if (text === undefined || text.trim().length === 0) {
    return lines;
  }
  return `${text}\n\n${lines}`;
}
