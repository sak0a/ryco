import type { EnvironmentId, FileAttachmentCreateUploadUrlInput } from "@ryco/contracts";
import type { ChatFileUploadTransport as ChatFileUploadTransportPort } from "@ryco/client-runtime/state/composer";

// ---------------------------------------------------------------------------
// Single upload endpoint construction (mirrors apps/web/src/platform/attachmentUpload.ts).
// ---------------------------------------------------------------------------

export function buildChatAttachmentUploadUrl(input: {
  readonly httpBaseUrl: string;
  readonly uploadToken: string;
}): string {
  const url = new URL("/attachments/upload", input.httpBaseUrl);
  url.searchParams.set("token", input.uploadToken);
  return url.toString();
}

interface ChatAttachmentUploadResponse {
  readonly name?: unknown;
  readonly mimeType?: unknown;
  readonly sizeBytes?: unknown;
}

/**
 * Streams raw bytes to the environment over XMLHttpRequest so upload progress
 * events are available (RN's XHR converts an ArrayBufferView body to native
 * bytes). The server answers 2xx with `{ name, mimeType, sizeBytes }`.
 */
function uploadBytesWithProgress(input: {
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly bearerToken: string | null;
  readonly onProgress?: (progress: number) => void;
}): Promise<ChatAttachmentUploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", input.url, true);
    request.responseType = "text";
    request.upload.addEventListener("progress", (event) => {
      if (!input.onProgress || !event.lengthComputable || event.total <= 0) {
        return;
      }
      input.onProgress(Math.min(1, event.loaded / event.total));
    });
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`The upload was rejected (${request.status}).`));
        return;
      }
      input.onProgress?.(1);
      try {
        const parsed = JSON.parse(request.responseText || "{}") as ChatAttachmentUploadResponse;
        resolve(parsed);
      } catch {
        resolve({});
      }
    });
    request.addEventListener("error", () => {
      reject(new Error("The upload could not reach the server."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The upload was cancelled."));
    });
    request.setRequestHeader("Content-Type", "application/octet-stream");
    if (input.bearerToken) {
      request.setRequestHeader("Authorization", `Bearer ${input.bearerToken}`);
    }
    request.send(new Uint8Array(input.bytes));
  });
}

/**
 * The mobile `ChatFileUploadTransport` port over the app's single-homed
 * connection registry: upload tokens are minted through the environment's WS
 * RPC client and bytes transfer against the saved environment's HTTP base with
 * its bearer credential. No forked auth or limit policy — the shared engine
 * owns the state machine.
 */
export const mobileChatFileUploadTransport: ChatFileUploadTransportPort = {
  createFileUploadUrl: async (
    input: FileAttachmentCreateUploadUrlInput & {
      readonly environmentId: EnvironmentId;
    },
  ) => {
    // Dynamic import: the connection registry lazily builds its supervisor and
    // imports state modules back; keeping the edge runtime-only avoids a
    // module-load cycle (same seam apps/web/src/platform/attachmentUpload.ts uses).
    const { readRpcClient } = await import("../connection/environmentApi");
    const client = readRpcClient(input.environmentId);
    if (!client) {
      throw new Error("The environment is not connected.");
    }
    const { environmentId: _environmentId, ...createInput } = input;
    return client.chatAttachments.createFileUpload(createInput);
  },
  transferBytes: async (input: {
    readonly environmentId: EnvironmentId;
    readonly uploadToken: string;
    readonly bytes: Uint8Array;
    readonly onProgress?: (progress: number) => void;
  }) => {
    const { createMobileConnectionRegistry } = await import("../runtime/bootstrap");
    const registry = createMobileConnectionRegistry();
    const record = registry.catalog.get(input.environmentId);
    if (!record) {
      throw new Error("The environment is not connected.");
    }
    const bearerToken = await registry.catalog.readBearerToken(input.environmentId);
    const url = buildChatAttachmentUploadUrl({
      httpBaseUrl: record.httpBaseUrl,
      uploadToken: input.uploadToken,
    });
    const confirmed = await uploadBytesWithProgress({
      url,
      bytes: input.bytes,
      bearerToken,
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
    return {
      ...(typeof confirmed.name === "string" ? { name: confirmed.name } : {}),
      ...(typeof confirmed.mimeType === "string" ? { mimeType: confirmed.mimeType } : {}),
      ...(typeof confirmed.sizeBytes === "number" ? { sizeBytes: confirmed.sizeBytes } : {}),
    };
  },
};
