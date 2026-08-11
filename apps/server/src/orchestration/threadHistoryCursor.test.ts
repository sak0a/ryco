import { OrchestrationThreadHistoryCursor, ThreadId } from "@ryco/contracts";
import { describe, expect, it } from "vitest";

import { decodeThreadHistoryCursor, encodeThreadHistoryCursor } from "./threadHistoryCursor.ts";

describe("thread history cursor", () => {
  it("round-trips a versioned cursor for its owning thread and collection", () => {
    const threadId = ThreadId.make("thread-1");
    const cursor = encodeThreadHistoryCursor({
      threadId,
      collection: "messages",
      order: { createdAt: "2026-08-12T00:00:00.000Z", id: "message-1" },
    });
    expect(decodeThreadHistoryCursor(cursor, { threadId, collection: "messages" })).toEqual({
      ok: true,
      order: { createdAt: "2026-08-12T00:00:00.000Z", id: "message-1" },
    });
  });

  it("rejects cross-thread, cross-collection, malformed, and future-version cursors", () => {
    const cursor = encodeThreadHistoryCursor({
      threadId: ThreadId.make("thread-1"),
      collection: "activities",
      order: {
        sequence: 2,
        createdAt: "2026-08-12T00:00:00.000Z",
        id: "activity-1",
      },
    });
    expect(
      decodeThreadHistoryCursor(cursor, {
        threadId: ThreadId.make("thread-2"),
        collection: "activities",
      }),
    ).toEqual({ ok: false, reason: "invalid-cursor" });
    expect(
      decodeThreadHistoryCursor(cursor, {
        threadId: ThreadId.make("thread-1"),
        collection: "messages",
      }),
    ).toEqual({ ok: false, reason: "invalid-cursor" });
    expect(
      decodeThreadHistoryCursor(OrchestrationThreadHistoryCursor.make("invalid"), {
        threadId: ThreadId.make("thread-1"),
        collection: "messages",
      }),
    ).toEqual({ ok: false, reason: "invalid-cursor" });
    expect(
      decodeThreadHistoryCursor(OrchestrationThreadHistoryCursor.make("v2.e30"), {
        threadId: ThreadId.make("thread-1"),
        collection: "messages",
      }),
    ).toEqual({ ok: false, reason: "unsupported-version" });
    const malformedOrder = encodeThreadHistoryCursor({
      threadId: ThreadId.make("thread-1"),
      collection: "messages",
      order: { createdAt: "not-a-date", id: "message-1" },
    });
    expect(
      decodeThreadHistoryCursor(malformedOrder, {
        threadId: ThreadId.make("thread-1"),
        collection: "messages",
      }),
    ).toEqual({ ok: false, reason: "invalid-cursor" });
  });
});
