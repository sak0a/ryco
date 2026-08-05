import type { ContextHandoffExportChunk, ContextHandoffRawPayloadChunk } from "@ryco/contracts";

type TextChunk = Pick<
  ContextHandoffRawPayloadChunk,
  "offset" | "chunk" | "nextOffset" | "totalBytes" | "digest"
>;

export class ContextHandoffChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextHandoffChunkError";
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readVerifiedContextHandoffText<TChunk extends TextChunk>(input: {
  readonly read: (offset: number) => Promise<TChunk>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (receivedBytes: number, totalBytes: number) => void;
}): Promise<{
  readonly text: string;
  readonly digest: string;
  readonly totalBytes: number;
}> {
  const chunks: string[] = [];
  let offset = 0;
  let digest: string | null = null;
  let totalBytes: number | null = null;
  for (;;) {
    if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const chunk = await input.read(offset);
    if (chunk.offset !== offset) {
      throw new ContextHandoffChunkError("The server returned a gap or overlapping chunk.");
    }
    if (digest !== null && chunk.digest !== digest) {
      throw new ContextHandoffChunkError("The artifact digest changed during transfer.");
    }
    if (totalBytes !== null && chunk.totalBytes !== totalBytes) {
      throw new ContextHandoffChunkError("The artifact size changed during transfer.");
    }
    digest = chunk.digest;
    totalBytes = chunk.totalBytes;
    const chunkBytes = new TextEncoder().encode(chunk.chunk).byteLength;
    const expectedNext = offset + chunkBytes;
    chunks.push(chunk.chunk);
    input.onProgress?.(expectedNext, chunk.totalBytes);
    if (chunk.nextOffset === null) {
      if (expectedNext !== chunk.totalBytes) {
        throw new ContextHandoffChunkError("The final chunk does not match the artifact size.");
      }
      break;
    }
    if (chunk.nextOffset !== expectedNext || chunk.nextOffset <= offset) {
      throw new ContextHandoffChunkError("The server returned a non-sequential chunk offset.");
    }
    offset = chunk.nextOffset;
  }
  const text = chunks.join("");
  if ((await sha256Hex(text)) !== digest) {
    throw new ContextHandoffChunkError("The downloaded artifact failed integrity verification.");
  }
  return { text, digest: digest!, totalBytes: totalBytes! };
}

export async function readVerifiedContextHandoffExport(input: {
  readonly read: (offset: number) => Promise<ContextHandoffExportChunk>;
  readonly expectedExtension: "md" | "json";
  readonly signal?: AbortSignal;
  readonly onProgress?: (receivedBytes: number, totalBytes: number) => void;
}): Promise<{ readonly blob: Blob; readonly filename: string }> {
  let filename: string | null = null;
  const result = await readVerifiedContextHandoffText({
    read: async (offset) => {
      const chunk = await input.read(offset);
      if (filename !== null && chunk.filename !== filename) {
        throw new ContextHandoffChunkError("The export filename changed during transfer.");
      }
      filename = chunk.filename;
      return chunk;
    },
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  });
  const safeFilename = filename ?? "";
  const expectedSuffix = `.${input.expectedExtension}`;
  if (
    !/^ryco-context-handoff-[a-zA-Z0-9_-]+-(sent|complete)\.(md|json)$/.test(safeFilename) ||
    !safeFilename.endsWith(expectedSuffix)
  ) {
    throw new ContextHandoffChunkError("The server returned an unsafe export filename.");
  }
  return {
    blob: new Blob([result.text], {
      type: input.expectedExtension === "md" ? "text/markdown;charset=utf-8" : "application/json",
    }),
    filename: safeFilename,
  };
}

export function startContextHandoffDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}
