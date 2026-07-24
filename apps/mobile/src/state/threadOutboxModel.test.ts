import type { EnvironmentId, MessageId, ModelSelection, ThreadId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  flattenQueuedThreadMessages,
  groupQueuedThreadMessages,
  modelSelectionsEqual,
  resolveThreadOutboxDeliveryAction,
  resolveThreadOutboxFailureAction,
  threadOutboxRetryDelayMs,
  type QueuedThreadMessage,
} from "./threadOutboxModel";

function queued(overrides: Partial<QueuedThreadMessage> & Pick<QueuedThreadMessage, "messageId" | "threadId" | "createdAt">): QueuedThreadMessage {
  return {
    environmentId: "env-a" as EnvironmentId,
    commandId: "cmd" as never,
    text: "hi",
    attachments: [],
    ...overrides,
  } as QueuedThreadMessage;
}

describe("threadOutboxModel", () => {
  it("resolves the delivery action for existing threads", () => {
    expect(
      resolveThreadOutboxDeliveryAction({ threadExists: true, shellStatus: "live", environmentConnected: true, threadBusy: false }),
    ).toBe("send");
    // busy thread waits
    expect(
      resolveThreadOutboxDeliveryAction({ threadExists: true, shellStatus: "live", environmentConnected: true, threadBusy: true }),
    ).toBe("wait");
    // disconnected waits
    expect(
      resolveThreadOutboxDeliveryAction({ threadExists: true, shellStatus: "live", environmentConnected: false, threadBusy: false }),
    ).toBe("wait");
    // vanished thread on a live shell is dropped; on a non-live shell it waits
    expect(
      resolveThreadOutboxDeliveryAction({ threadExists: false, shellStatus: "live", environmentConnected: true, threadBusy: false }),
    ).toBe("remove");
    expect(
      resolveThreadOutboxDeliveryAction({ threadExists: false, shellStatus: "loading", environmentConnected: true, threadBusy: false }),
    ).toBe("wait");
  });

  it("backs off retries exponentially, capped", () => {
    expect(threadOutboxRetryDelayMs(1)).toBe(1000);
    expect(threadOutboxRetryDelayMs(2)).toBe(2000);
    expect(threadOutboxRetryDelayMs(3)).toBe(4000);
    expect(threadOutboxRetryDelayMs(99)).toBe(16000);
  });

  it("retries transient/settings-sync/interrupted failures and discards the rest", () => {
    expect(resolveThreadOutboxFailureAction({ stage: "settings-sync", error: new Error("x"), interrupted: false })).toBe("retry");
    expect(resolveThreadOutboxFailureAction({ stage: "start-turn", error: new Error("x"), interrupted: true })).toBe("retry");
    expect(resolveThreadOutboxFailureAction({ stage: "start-turn", error: { _tag: "ConnectionTransientError" }, interrupted: false })).toBe("retry");
    expect(resolveThreadOutboxFailureAction({ stage: "start-turn", error: new Error("bad request"), interrupted: false })).toBe("discard");
  });

  it("groups + dedupes messages by thread, sorted by createdAt", () => {
    const messages = [
      queued({ messageId: "m2" as MessageId, threadId: "t1" as ThreadId, createdAt: "2026-07-24T11:00:00.000Z" }),
      queued({ messageId: "m1" as MessageId, threadId: "t1" as ThreadId, createdAt: "2026-07-24T10:00:00.000Z" }),
      // duplicate messageId is de-duplicated (last wins)
      queued({ messageId: "m1" as MessageId, threadId: "t1" as ThreadId, createdAt: "2026-07-24T10:00:00.000Z" }),
      queued({ messageId: "m3" as MessageId, threadId: "t2" as ThreadId, createdAt: "2026-07-24T09:00:00.000Z" }),
    ];
    const grouped = groupQueuedThreadMessages(messages);
    const keys = Object.keys(grouped);
    expect(keys).toHaveLength(2);
    const t1 = grouped[keys.find((k) => k.endsWith("t1"))!]!;
    expect(t1.map((m) => m.messageId)).toEqual(["m1", "m2"]);
    expect(flattenQueuedThreadMessages(grouped)).toHaveLength(3);
  });

  it("compares model selections structurally", () => {
    const a = { instanceId: "i1", model: "m", options: [] } as unknown as ModelSelection;
    const b = { instanceId: "i1", model: "m", options: [] } as unknown as ModelSelection;
    const c = { instanceId: "i1", model: "other", options: [] } as unknown as ModelSelection;
    expect(modelSelectionsEqual(a, b)).toBe(true);
    expect(modelSelectionsEqual(a, c)).toBe(false);
  });
});
