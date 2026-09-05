import { describe, expect, it } from "vite-plus/test";
import { MessageId, ThreadId, TurnId, type OrchestrationMessage } from "@ryco/contracts";
import { historyMessagesToRestore } from "./providerHistoryRecovery.ts";
import type { ProviderThreadHistory } from "../provider/Services/ProviderAdapter.ts";

const at = "2026-09-05T10:00:00.000Z";
const turnId = TurnId.make("turn-1");
const message = {
  id: MessageId.make("assistant:item-1"),
  turnId,
  role: "assistant" as const,
  text: "hello world",
  createdAt: at,
};
const history: ProviderThreadHistory = {
  messages: [message],
  items: [],
  completedTurnIds: [turnId],
  failedTurnIds: [],
};
const thread = (messages: readonly OrchestrationMessage[] = []) => ({
  id: ThreadId.make("thread-1"),
  createdAt: at,
  messages,
});

describe("provider history message recovery", () => {
  it("orders recovered replies after their user prompt despite coarse provider timestamps", () => {
    const user = {
      ...message,
      id: MessageId.make("local-user"),
      role: "user" as const,
      text: "question",
      createdAt: "2026-09-05T10:00:00.900Z",
      streaming: false,
      updatedAt: at,
    };
    const orderedHistory = {
      ...history,
      messages: [
        { ...user, id: MessageId.make("user:remote"), createdAt: at },
        message,
        { ...message, id: MessageId.make("assistant:second") },
      ],
    };
    const restored = historyMessagesToRestore(thread([user]), orderedHistory, at);
    expect(restored.map((entry) => entry.createdAt)).toEqual([
      "2026-09-05T10:00:00.901Z",
      "2026-09-05T10:00:00.902Z",
    ]);
    expect(historyMessagesToRestore(thread([user, ...restored]), orderedHistory, at)).toEqual([]);
  });
  it("restores missing history idempotently with thread-scoped IDs", () => {
    const first = historyMessagesToRestore(thread(), history, at);
    expect(first[0]?.id).toBe("history:thread-1:assistant:item-1");
    expect(historyMessagesToRestore(thread(first), history, at)).toEqual([]);
    const fork = historyMessagesToRestore({ ...thread(), id: ThreadId.make("fork") }, history, at);
    expect(fork[0]?.id).not.toBe(first[0]?.id);
  });
  it("repairs a partial message using its existing identity", () => {
    const partial = { ...message, text: "hello", streaming: true, updatedAt: at };
    expect(historyMessagesToRestore(thread([partial]), history, at)).toEqual([
      { ...partial, text: "hello world", streaming: false },
    ]);
  });
  it("preserves pause-for-user segments without repeating their text", () => {
    const segments = [
      { ...message, text: "hello ", streaming: false, updatedAt: at },
      {
        ...message,
        id: MessageId.make("assistant:item-1:segment:1"),
        text: "w",
        streaming: true,
        updatedAt: at,
      },
    ];
    const repaired = historyMessagesToRestore(thread(segments), history, at);
    expect(repaired).toEqual([{ ...segments[1], text: "world", streaming: false }]);
    expect(historyMessagesToRestore(thread([segments[0]!, repaired[0]!]), history, at)).toEqual([]);
  });
  it("does not overwrite divergent earlier segments or duplicate an uncorrelated user prompt", () => {
    const segments = [
      { ...message, text: "different ", streaming: false, updatedAt: at },
      {
        ...message,
        id: MessageId.make("assistant:item-1:segment:1"),
        text: "text",
        streaming: false,
        updatedAt: at,
      },
    ];
    expect(historyMessagesToRestore(thread(segments), history, at)).toEqual([]);
    const user = {
      ...message,
      id: MessageId.make("local-user"),
      role: "user" as const,
      text: "question",
      streaming: false,
      updatedAt: at,
    };
    expect(
      historyMessagesToRestore(
        thread([user]),
        { ...history, messages: [{ ...user, id: MessageId.make("user:remote") }] },
        at,
      ),
    ).toEqual([]);
  });
});
