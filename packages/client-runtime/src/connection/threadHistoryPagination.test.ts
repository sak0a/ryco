import {
  EnvironmentId,
  MessageId,
  OrchestrationThreadHistoryCursor,
  ThreadId,
  type OrchestrationThreadHistoryPage,
} from "@ryco/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createThreadHistoryPaginationController } from "./threadHistoryPagination.ts";

const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const cursor = OrchestrationThreadHistoryCursor.make("v1.cursor");
const page: OrchestrationThreadHistoryPage = {
  collection: "messages",
  snapshotSequence: 2,
  items: [],
  page: { oldestCursor: cursor, newestCursor: cursor, hasMoreBefore: false },
};

describe("thread history pagination", () => {
  it("coalesces identical cursor requests and applies the page once", async () => {
    const request = vi.fn(async () => page);
    const apply = vi.fn();
    const controller = createThreadHistoryPaginationController({
      request,
      apply,
      setRequestState: vi.fn(),
    });
    controller.beginSnapshot(scope);
    const input = {
      scope,
      collection: "messages" as const,
      page: { oldestCursor: cursor, newestCursor: cursor, hasMoreBefore: true },
      limit: 50,
    };

    await Promise.all([controller.loadBefore(input), controller.loadBefore(input)]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("ignores a page that resolves after a newer snapshot generation", async () => {
    let resolveRequest: ((value: OrchestrationThreadHistoryPage) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<OrchestrationThreadHistoryPage>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const apply = vi.fn();
    const controller = createThreadHistoryPaginationController({
      request,
      apply,
      setRequestState: vi.fn(),
    });
    controller.beginSnapshot(scope);
    const pending = controller.loadAroundMessage({
      scope,
      anchorId: MessageId.make("message-1"),
      limit: 50,
    });
    controller.beginSnapshot(scope);
    resolveRequest?.(page);

    await expect(pending).resolves.toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("records request failures without clearing loaded state", async () => {
    const setRequestState = vi.fn();
    const controller = createThreadHistoryPaginationController({
      request: vi.fn(async () => {
        throw new Error("offline");
      }),
      apply: vi.fn(),
      setRequestState,
    });
    controller.beginSnapshot(scope);

    await expect(
      controller.loadAroundMessage({
        scope,
        anchorId: MessageId.make("message-1"),
        limit: 50,
      }),
    ).rejects.toThrow("offline");
    expect(setRequestState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", error: "offline" }),
    );
  });

  it("resnapshots instead of exposing a stale cursor gap", async () => {
    const recoverStale = vi.fn(async () => undefined);
    const setRequestState = vi.fn();
    const controller = createThreadHistoryPaginationController({
      request: vi.fn(async () => {
        throw { _tag: "OrchestrationThreadHistoryError", reason: "stale-cursor" };
      }),
      apply: vi.fn(),
      setRequestState,
      recoverStale,
    });
    controller.beginSnapshot(scope);

    await expect(
      controller.loadBefore({
        scope,
        collection: "messages",
        page: { oldestCursor: cursor, newestCursor: cursor, hasMoreBefore: true },
        limit: 50,
      }),
    ).resolves.toBeNull();
    expect(recoverStale).toHaveBeenCalledWith(scope);
    expect(setRequestState).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });
});
