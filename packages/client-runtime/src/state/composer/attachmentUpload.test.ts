import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type EnvironmentId,
  type ThreadId,
} from "@ryco/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createChatFileUploadEngine,
  deriveChatFileUploadSendBlock,
  isChatFileUploadBlocking,
  isFileUploadTokenUsable,
  resolveFileUploadMaxBytes,
  type ChatFileUploadRecord,
  type ChatFileUploadStatus,
  type ChatFileUploadTransport,
} from "./attachmentUpload.ts";

const THREAD_ID = "thread-1" as ThreadId;
const ENV_ID = "env-1" as EnvironmentId;
const FUTURE = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 10 * 60 * 1000).toISOString();

function makeTransport(overrides?: Partial<ChatFileUploadTransport>): ChatFileUploadTransport & {
  createFileUploadUrl: ReturnType<typeof vi.fn>;
  transferBytes: ReturnType<typeof vi.fn>;
} {
  return {
    createFileUploadUrl: vi.fn(async () => ({
      uploadToken: "token-1",
      expiresAt: FUTURE,
      maxUploadBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES,
    })),
    transferBytes: vi.fn(async ({ onProgress }) => {
      onProgress?.(0.5);
      return { name: "file.bin", mimeType: "application/octet-stream", sizeBytes: 10 };
    }),
    ...overrides,
  };
}

function makeRequest(
  overrides?: Partial<Parameters<ReturnType<typeof createChatFileUploadEngine>["enqueue"]>[0]>,
) {
  return {
    attachmentId: "att-1",
    threadId: THREAD_ID,
    environmentId: ENV_ID,
    name: "file.bin",
    mimeType: "application/octet-stream",
    sizeBytes: 10,
    readBytes: () => new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("upload pure helpers", () => {
  it("treats tokens near expiry as unusable", () => {
    const now = Date.now();
    expect(isFileUploadTokenUsable(new Date(now + 10 * 60_000).toISOString(), now)).toBe(true);
    expect(isFileUploadTokenUsable(new Date(now + 10_000).toISOString(), now)).toBe(false);
    expect(isFileUploadTokenUsable(new Date(now - 10_000).toISOString(), now)).toBe(false);
    expect(isFileUploadTokenUsable("not-a-date", now)).toBe(false);
  });

  it("resolves the streaming limit from the capability", () => {
    expect(
      resolveFileUploadMaxBytes({ fileAttachments: { maxUploadBytes: 25 * 1024 * 1024 } }),
    ).toBe(25 * 1024 * 1024);
    expect(
      resolveFileUploadMaxBytes({ fileAttachments: { maxUploadBytes: 500 * 1024 * 1024 } }),
    ).toBe(PROVIDER_SEND_TURN_MAX_FILE_BYTES);
    expect(resolveFileUploadMaxBytes(undefined)).toBeNull();
    expect(resolveFileUploadMaxBytes({})).toBeNull();
    expect(resolveFileUploadMaxBytes({ fileAttachments: { maxUploadBytes: 0 } })).toBeNull();
  });

  it("classifies blocking statuses", () => {
    expect(isChatFileUploadBlocking(undefined)).toBe(false);
    expect(isChatFileUploadBlocking({ kind: "pending" })).toBe(true);
    expect(isChatFileUploadBlocking({ kind: "uploading", progress: 0.2 })).toBe(true);
    expect(isChatFileUploadBlocking({ kind: "failed", retryable: true, message: "x" })).toBe(true);
    expect(
      isChatFileUploadBlocking({ kind: "uploaded", uploadToken: "t", expiresAt: FUTURE }),
    ).toBe(false);
    expect(isChatFileUploadBlocking({ kind: "needsReattach", message: "x" })).toBe(false);
  });
});

describe("upload engine", () => {
  it.each(["release", "releaseAll"] as const)("ignores completion after %s", async (release) => {
    const transfer = Promise.withResolvers<{}>();
    const transport = makeTransport({ transferBytes: vi.fn(() => transfer.promise) });
    const engine = createChatFileUploadEngine(transport);
    engine.enqueue(makeRequest());
    await flushMicrotasks();
    if (release === "release") engine.release("att-1");
    else engine.releaseAll();
    transfer.resolve({});
    await flushMicrotasks();
    expect(engine.snapshot().size).toBe(0);
  });

  it("does not transfer bytes or restore errors after release during token minting", async () => {
    const mint =
      Promise.withResolvers<Awaited<ReturnType<ChatFileUploadTransport["createFileUploadUrl"]>>>();
    const transport = makeTransport({ createFileUploadUrl: vi.fn(() => mint.promise) });
    const engine = createChatFileUploadEngine(transport);
    engine.enqueue(makeRequest());
    engine.release("att-1");
    mint.resolve({ uploadToken: "old", expiresAt: FUTURE, maxUploadBytes: 1024 });
    await flushMicrotasks();
    expect(transport.transferBytes).not.toHaveBeenCalled();
    expect(engine.get("att-1")).toBeNull();
  });

  it("does not overwrite a replacement with a stale upload failure", async () => {
    const transfer = Promise.withResolvers<{}>();
    const transport = makeTransport({
      transferBytes: vi.fn().mockReturnValueOnce(transfer.promise).mockResolvedValue({}),
    });
    const engine = createChatFileUploadEngine(transport);
    engine.enqueue(makeRequest());
    await flushMicrotasks();
    engine.release("att-1");
    engine.enqueue(makeRequest({ name: "replacement.txt" }));
    transfer.reject(new Error("old transfer failed"));
    await flushMicrotasks();
    expect(engine.get("att-1")?.name).toBe("replacement.txt");
    expect(engine.get("att-1")?.status.kind).toBe("uploaded");
  });

  it("ignores retry while an upload is active", async () => {
    const transfer = Promise.withResolvers<{}>();
    const transport = makeTransport({ transferBytes: vi.fn(() => transfer.promise) });
    const engine = createChatFileUploadEngine(transport);
    engine.enqueue(makeRequest());
    await flushMicrotasks();
    engine.retry("att-1");
    expect(engine.get("att-1")?.status.kind).toBe("uploading");
    transfer.resolve({});
    await flushMicrotasks();
    expect(transport.createFileUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("moves an attachment pending → uploading → uploaded and reports progress", async () => {
    const transport = makeTransport();
    const engine = createChatFileUploadEngine(transport);
    const seen: ChatFileUploadStatus[] = [];
    engine.subscribe(() => {
      const record = engine.get("att-1");
      if (record) seen.push(record.status);
    });

    engine.enqueue(makeRequest());
    await flushMicrotasks();

    expect(seen.some((status) => status.kind === "pending")).toBe(true);
    expect(seen.some((status) => status.kind === "uploading" && status.progress === 0)).toBe(true);
    expect(seen.some((status) => status.kind === "uploading" && status.progress === 0.5)).toBe(
      true,
    );
    const record = engine.get("att-1");
    expect(record?.status).toEqual({ kind: "uploaded", uploadToken: "token-1", expiresAt: FUTURE });
    expect(transport.createFileUploadUrl).toHaveBeenCalledWith({
      environmentId: ENV_ID,
      threadId: THREAD_ID,
      name: "file.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 10,
    });
  });

  it("marks a token-mint failure as retryable and retries it", async () => {
    const transport = makeTransport({
      createFileUploadUrl: vi
        .fn()
        .mockRejectedValueOnce(new Error("server busy"))
        .mockResolvedValue({ uploadToken: "token-2", expiresAt: FUTURE, maxUploadBytes: 1024 }),
    });
    const engine = createChatFileUploadEngine(transport);

    engine.enqueue(makeRequest());
    await flushMicrotasks();
    expect(engine.get("att-1")?.status).toEqual({
      kind: "failed",
      retryable: true,
      message: "server busy",
    });

    engine.retry("att-1");
    await flushMicrotasks();
    expect(engine.get("att-1")?.status).toEqual({
      kind: "uploaded",
      uploadToken: "token-2",
      expiresAt: FUTURE,
    });
  });

  it("marks a transfer failure as retryable", async () => {
    const transport = makeTransport({
      transferBytes: vi.fn(async ({ onProgress }) => {
        onProgress?.(0.1);
        throw new Error("disk full");
      }),
    });
    const engine = createChatFileUploadEngine(transport);

    engine.enqueue(makeRequest());
    await flushMicrotasks();
    expect(engine.get("att-1")?.status).toEqual({
      kind: "failed",
      retryable: true,
      message: "disk full",
    });
    expect(transport.createFileUploadUrl).toHaveBeenCalledTimes(1);

    engine.retry("att-1");
    await flushMicrotasks();
    expect(transport.createFileUploadUrl).toHaveBeenCalledTimes(2);
  });

  it("runs uploads one at a time from the queue", async () => {
    const pendingTransfers: Array<(value: { name: string }) => void> = [];
    const transport = makeTransport({
      transferBytes: vi.fn(
        ({ onProgress: _onProgress }) =>
          new Promise((resolve) => {
            pendingTransfers.push(resolve);
          }),
      ) as never,
    });
    const engine = createChatFileUploadEngine(transport);

    engine.enqueue(makeRequest({ attachmentId: "a" }));
    engine.enqueue(makeRequest({ attachmentId: "b" }));
    await flushMicrotasks();

    expect(transport.transferBytes).toHaveBeenCalledTimes(1);
    pendingTransfers[0]!({ name: "a" });
    await flushMicrotasks();
    expect(transport.transferBytes).toHaveBeenCalledTimes(2);
    pendingTransfers[1]!({ name: "b" });
    await flushMicrotasks();
    expect(engine.get("a")?.status.kind).toBe("uploaded");
    expect(engine.get("b")?.status.kind).toBe("uploaded");
  });

  it("seeds uploaded records and demotes expired tokens to needsReattach", () => {
    const engine = createChatFileUploadEngine(makeTransport(), { nowMs: () => Date.now() });
    engine.seedUploaded({
      attachmentId: "a",
      threadId: THREAD_ID,
      environmentId: ENV_ID,
      name: "a.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      uploadToken: "tok",
      expiresAt: FUTURE,
    });
    expect(engine.get("a")?.status.kind).toBe("uploaded");

    engine.seedUploaded({
      attachmentId: "b",
      threadId: THREAD_ID,
      environmentId: ENV_ID,
      name: "b.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      uploadToken: "tok",
      expiresAt: PAST,
    });
    expect(engine.get("b")?.status.kind).toBe("needsReattach");
  });

  it("seedNeedsReattach does not clobber an uploaded record", () => {
    const engine = createChatFileUploadEngine(makeTransport());
    engine.seedUploaded({
      attachmentId: "a",
      threadId: THREAD_ID,
      environmentId: ENV_ID,
      name: "a.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      uploadToken: "tok",
      expiresAt: FUTURE,
    });
    engine.seedNeedsReattach("a");
    expect(engine.get("a")?.status.kind).toBe("uploaded");

    engine.seedNeedsReattach("b");
    expect(engine.get("b")?.status.kind).toBe("needsReattach");
  });

  it("verifyUsable demotes expired uploads", () => {
    let now = Date.now();
    const engine = createChatFileUploadEngine(makeTransport(), { nowMs: () => now });
    engine.seedUploaded({
      attachmentId: "a",
      threadId: THREAD_ID,
      environmentId: ENV_ID,
      name: "a.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      uploadToken: "tok",
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    expect(engine.verifyUsable("a", now)).toBe(true);
    now += 10 * 60_000;
    expect(engine.verifyUsable("a", now)).toBe(false);
    expect(engine.get("a")?.status.kind).toBe("needsReattach");
  });

  it("release drops the record and its queued work; releaseAll clears everything", async () => {
    const pendingTransfers: Array<(value: { name: string }) => void> = [];
    const transport = makeTransport({
      transferBytes: vi.fn(
        () =>
          new Promise((resolve) => {
            pendingTransfers.push(resolve);
          }),
      ) as never,
    });
    const engine = createChatFileUploadEngine(transport);

    engine.enqueue(makeRequest({ attachmentId: "a" }));
    engine.enqueue(makeRequest({ attachmentId: "b" }));
    engine.release("b");
    await flushMicrotasks();
    pendingTransfers[0]!({ name: "a" });
    await flushMicrotasks();

    expect(engine.get("b")).toBeNull();
    expect(transport.transferBytes).toHaveBeenCalledTimes(1);
    expect(engine.get("a")?.status.kind).toBe("uploaded");

    engine.releaseAll();
    expect(engine.snapshot().size).toBe(0);
  });
});

describe("deriveChatFileUploadSendBlock", () => {
  function recordWith(status: ChatFileUploadStatus): ChatFileUploadRecord {
    const request = makeRequest();
    return { ...request, status };
  }

  it("blocks while an attachment is uploading", () => {
    const records = new Map([["att-1", recordWith({ kind: "uploading", progress: 0.3 })]]);
    const result = deriveChatFileUploadSendBlock({
      attachmentIds: ["att-1"],
      getRecord: (id) => records.get(id) ?? null,
      nowMs: Date.now(),
    });
    expect(result.blockReason).toContain("file.bin");
  });

  it("blocks with a retry hint on failure and reattach hint on needsReattach", () => {
    const records = new Map([
      ["att-1", recordWith({ kind: "failed", retryable: true, message: "x" })],
      ["att-2", recordWith({ kind: "needsReattach", message: "x" })],
    ]);
    expect(
      deriveChatFileUploadSendBlock({
        attachmentIds: ["att-1"],
        getRecord: (id) => records.get(id) ?? null,
        nowMs: Date.now(),
      }).blockReason,
    ).toContain("failed to upload");
    expect(
      deriveChatFileUploadSendBlock({
        attachmentIds: ["att-2"],
        getRecord: (id) => records.get(id) ?? null,
        nowMs: Date.now(),
      }).blockReason,
    ).toContain("Attach");
  });

  it("blocks an expired token and passes fresh ones", () => {
    const now = Date.now();
    const records = new Map([
      [
        "att-1",
        recordWith({
          kind: "uploaded",
          uploadToken: "tok",
          expiresAt: new Date(now - 1).toISOString(),
        }),
      ],
      [
        "att-2",
        recordWith({
          kind: "uploaded",
          uploadToken: "tok",
          expiresAt: new Date(now + 10 * 60_000).toISOString(),
        }),
      ],
    ]);
    expect(
      deriveChatFileUploadSendBlock({
        attachmentIds: ["att-1"],
        getRecord: (id) => records.get(id) ?? null,
        nowMs: now,
      }).blockReason,
    ).toContain("Attach");
    expect(
      deriveChatFileUploadSendBlock({
        attachmentIds: ["att-2"],
        getRecord: (id) => records.get(id) ?? null,
        nowMs: now,
      }).blockReason,
    ).toBeNull();
  });

  it("ignores attachments without records", () => {
    expect(
      deriveChatFileUploadSendBlock({
        attachmentIds: ["missing"],
        getRecord: () => null,
        nowMs: Date.now(),
      }).blockReason,
    ).toBeNull();
  });
});
