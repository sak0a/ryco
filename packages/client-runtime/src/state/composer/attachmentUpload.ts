import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type EnvironmentId,
  type FileAttachmentCreateUploadUrlInput,
  type FileAttachmentCreateUploadUrlResult,
  type ExecutionEnvironmentCapabilities,
  type ThreadId,
} from "@ryco/contracts";

// ---------------------------------------------------------------------------
// Upload state machine
// ---------------------------------------------------------------------------

export type ChatFileUploadStatus =
  | { readonly kind: "pending" }
  | { readonly kind: "uploading"; readonly progress: number }
  | { readonly kind: "uploaded"; readonly uploadToken: string; readonly expiresAt: string }
  | { readonly kind: "failed"; readonly retryable: boolean; readonly message: string }
  | { readonly kind: "needsReattach"; readonly message: string };

export interface ChatFileUploadRequest {
  readonly attachmentId: string;
  readonly threadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Bytes are held transiently by the engine and never persisted. */
  readBytes: () => Uint8Array | Promise<Uint8Array>;
}

export interface ChatFileUploadRecord extends ChatFileUploadRequest {
  readonly status: ChatFileUploadStatus;
}

/** Port the platform adapter implements: token minting plus raw byte transfer. */
export interface ChatFileUploadTransport {
  createFileUploadUrl(
    input: FileAttachmentCreateUploadUrlInput & { readonly environmentId: EnvironmentId },
  ): Promise<FileAttachmentCreateUploadUrlResult>;
  transferBytes(input: {
    readonly environmentId: EnvironmentId;
    readonly uploadToken: string;
    readonly bytes: Uint8Array;
    readonly onProgress?: (progress: number) => void;
  }): Promise<{ name?: string; mimeType?: string; sizeBytes?: number }>;
}

/** Buffer between a token expiring and a send reading it, in milliseconds. */
const UPLOAD_TOKEN_EXPIRY_MARGIN_MS = 30_000;

export function isFileUploadTokenUsable(expiresAt: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return nowMs < expiresAtMs - UPLOAD_TOKEN_EXPIRY_MARGIN_MS;
}

/**
 * Streaming-upload byte limit for non-image attachments. The capability
 * ceiling wins when present; without one the upload flow is unavailable and
 * callers fall back to the inline dataUrl path.
 */
export function resolveFileUploadMaxBytes(
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
): number | null {
  const maxUploadBytes = capabilities?.fileAttachments?.maxUploadBytes;
  if (
    typeof maxUploadBytes !== "number" ||
    !Number.isFinite(maxUploadBytes) ||
    maxUploadBytes <= 0
  ) {
    return null;
  }
  return Math.min(maxUploadBytes, PROVIDER_SEND_TURN_MAX_FILE_BYTES);
}

/** True while a send must be held back: pending, uploading, or failed. */
export function isChatFileUploadBlocking(status: ChatFileUploadStatus | undefined): boolean {
  if (status === undefined) {
    return false;
  }
  return status.kind === "pending" || status.kind === "uploading" || status.kind === "failed";
}

export interface ChatFileUploadEngine {
  get: (attachmentId: string) => ChatFileUploadRecord | null;
  snapshot: () => ReadonlyMap<string, ChatFileUploadRecord>;
  subscribe: (listener: () => void) => () => void;
  enqueue: (request: ChatFileUploadRequest) => void;
  retry: (attachmentId: string) => void;
  seedUploaded: (input: {
    attachmentId: string;
    threadId: ThreadId;
    environmentId: EnvironmentId;
    name: string;
    mimeType: string;
    sizeBytes: number;
    uploadToken: string;
    expiresAt: string;
  }) => void;
  seedNeedsReattach: (attachmentId: string) => void;
  /** Confirms the token is still fresh, otherwise demotes to needsReattach. */
  verifyUsable: (attachmentId: string, nowMs: number) => boolean;
  release: (attachmentId: string) => void;
  releaseAll: () => void;
}

export function createChatFileUploadEngine(
  transport: ChatFileUploadTransport,
  options?: { nowMs?: () => number },
): ChatFileUploadEngine {
  const nowMs = options?.nowMs ?? (() => Date.now());
  const records = new Map<string, ChatFileUploadRecord>();
  const queue: string[] = [];
  let inFlightCount = 0;
  const listeners = new Set<() => void>();
  let snapshotCache: ReadonlyMap<string, ChatFileUploadRecord> | null = null;

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function put(record: ChatFileUploadRecord): void {
    records.set(record.attachmentId, record);
    snapshotCache = null;
    notify();
  }

  function getSnapshot(): ReadonlyMap<string, ChatFileUploadRecord> {
    if (!snapshotCache) {
      snapshotCache = new Map(records);
    }
    return snapshotCache;
  }

  async function pump(): Promise<void> {
    if (inFlightCount > 0) {
      return;
    }
    const attachmentId = queue.shift();
    if (!attachmentId) {
      return;
    }
    const record = records.get(attachmentId);
    if (!record) {
      void pump();
      return;
    }
    let activeRecord = record;
    const isCurrent = () => records.get(attachmentId) === activeRecord;
    const update = (next: ChatFileUploadRecord) => {
      if (!isCurrent()) return;
      activeRecord = next;
      put(next);
    };
    inFlightCount += 1;
    try {
      if (record.status.kind === "needsReattach" || record.status.kind === "uploaded") {
        return;
      }
      update({ ...record, status: { kind: "uploading", progress: 0 } });
      let token: string;
      let expiresAt: string;
      try {
        const minted = await transport.createFileUploadUrl({
          environmentId: record.environmentId,
          threadId: record.threadId,
          name: record.name,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
        });
        token = minted.uploadToken;
        expiresAt = minted.expiresAt;
      } catch (error) {
        update({
          ...record,
          status: {
            kind: "failed",
            retryable: true,
            message: error instanceof Error ? error.message : "Could not start the upload.",
          },
        });
        return;
      }
      try {
        if (!isCurrent()) return;
        const bytes = await record.readBytes();
        if (!isCurrent()) return;
        const confirmed = await transport.transferBytes({
          environmentId: record.environmentId,
          uploadToken: token,
          bytes,
          onProgress: (progress) => {
            const current = records.get(record.attachmentId);
            if (!isCurrent() || !current || current.status.kind !== "uploading") {
              return;
            }
            update({ ...current, status: { kind: "uploading", progress } });
          },
        });
        const confirmedSizeBytes =
          confirmed.sizeBytes !== undefined &&
          Number.isFinite(confirmed.sizeBytes) &&
          confirmed.sizeBytes >= 0
            ? confirmed.sizeBytes
            : record.sizeBytes;
        update({
          ...record,
          sizeBytes: confirmedSizeBytes,
          status: {
            kind: "uploaded",
            uploadToken: token,
            expiresAt,
          },
        });
      } catch (error) {
        update({
          ...record,
          status: {
            kind: "failed",
            retryable: true,
            message: error instanceof Error ? error.message : "The upload failed.",
          },
        });
      }
    } finally {
      inFlightCount -= 1;
      void pump();
    }
  }

  return {
    get: (attachmentId) => records.get(attachmentId) ?? null,
    snapshot: () => getSnapshot(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enqueue: (request) => {
      put({ ...request, status: { kind: "pending" } });
      if (!queue.includes(request.attachmentId)) {
        queue.push(request.attachmentId);
      }
      void pump();
    },
    retry: (attachmentId) => {
      const record = records.get(attachmentId);
      if (!record || record.status.kind !== "failed" || !record.status.retryable) {
        return;
      }
      put({ ...record, status: { kind: "pending" } });
      if (!queue.includes(attachmentId)) {
        queue.push(attachmentId);
      }
      void pump();
    },
    seedUploaded: (input) => {
      const record: ChatFileUploadRecord = {
        attachmentId: input.attachmentId,
        threadId: input.threadId,
        environmentId: input.environmentId,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        readBytes: () => {
          throw new Error("Uploaded attachments do not keep local bytes.");
        },
        status: { kind: "uploaded", uploadToken: input.uploadToken, expiresAt: input.expiresAt },
      };
      if (!isFileUploadTokenUsable(input.expiresAt, nowMs())) {
        put({ ...record, status: { kind: "needsReattach", message: "The upload token expired." } });
        return;
      }
      put(record);
    },
    seedNeedsReattach: (attachmentId) => {
      const existing = records.get(attachmentId);
      if (existing?.status.kind === "uploaded") {
        return;
      }
      put({
        attachmentId,
        threadId: "" as ThreadId,
        environmentId: "" as EnvironmentId,
        name: existing?.name ?? "",
        mimeType: existing?.mimeType ?? "",
        sizeBytes: existing?.sizeBytes ?? 0,
        readBytes: () => {
          throw new Error("Unattached attachments do not keep local bytes.");
        },
        status: { kind: "needsReattach", message: "The upload did not finish." },
      });
    },
    verifyUsable: (attachmentId, checkMs) => {
      const record = records.get(attachmentId);
      if (!record || record.status.kind !== "uploaded") {
        return false;
      }
      if (isFileUploadTokenUsable(record.status.expiresAt, checkMs)) {
        return true;
      }
      put({
        ...record,
        status: { kind: "needsReattach", message: "The upload token expired." },
      });
      return false;
    },
    release: (attachmentId) => {
      if (!records.delete(attachmentId)) {
        return;
      }
      const queueIndex = queue.indexOf(attachmentId);
      if (queueIndex !== -1) {
        queue.splice(queueIndex, 1);
      }
      snapshotCache = null;
      notify();
    },
    releaseAll: () => {
      if (records.size === 0) {
        return;
      }
      records.clear();
      queue.length = 0;
      snapshotCache = null;
      notify();
    },
  };
}

// ---------------------------------------------------------------------------
// Send-time derivation
// ---------------------------------------------------------------------------

/**
 * Send-block derivation for a composer attachment list. `blockReason` is
 * non-null while any attachment is still uploading, failed, or attached with
 * a token that has since expired.
 */
export function deriveChatFileUploadSendBlock(input: {
  readonly attachmentIds: ReadonlyArray<string>;
  readonly getRecord: (attachmentId: string) => ChatFileUploadRecord | null;
  readonly nowMs: number;
}): { readonly blockReason: string | null } {
  for (const attachmentId of input.attachmentIds) {
    const record = input.getRecord(attachmentId);
    if (!record) {
      continue;
    }
    if (isChatFileUploadBlocking(record.status)) {
      return {
        blockReason:
          record.status.kind === "failed"
            ? `'${record.name}' failed to upload. Retry it or remove it.`
            : `Uploading '${record.name}'…`,
      };
    }
    if (
      record.status.kind === "needsReattach" ||
      (record.status.kind === "uploaded" &&
        !isFileUploadTokenUsable(record.status.expiresAt, input.nowMs))
    ) {
      return { blockReason: `Attach '${record.name}' again to send this message.` };
    }
  }
  return { blockReason: null };
}
