import { ContextHandoffId, MessageId, TurnId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ChatMessage, ProposedPlan } from "../threads/types.ts";
import type { ContextHandoffTimelineEntry } from "./contextHandoff.ts";
import { deriveTimelineEntries, type WorkLogEntry } from "./session-logic.ts";
import { createTimelineEntryIndex, type TimelineEntrySources } from "./timeline-index.ts";

function message(id: string, second: number, text = id): ChatMessage {
  return {
    id: MessageId.make(id),
    role: second % 2 === 0 ? "user" : "assistant",
    text,
    streaming: false,
    createdAt: `2026-08-12T00:00:${String(second).padStart(2, "0")}.000Z`,
  };
}

function plan(id: string, second: number): ProposedPlan {
  return {
    id,
    turnId: TurnId.make(`turn-${id}`),
    planMarkdown: id,
    implementedAt: null,
    implementationThreadId: null,
    createdAt: `2026-08-12T00:00:${String(second).padStart(2, "0")}.000Z`,
    updatedAt: `2026-08-12T00:00:${String(second).padStart(2, "0")}.000Z`,
  };
}

function handoff(id: string, targetMessageId: MessageId, second: number) {
  return {
    id,
    activityId: id,
    handoffId: ContextHandoffId.make(id),
    createdAt: `2026-08-12T00:00:${String(second).padStart(2, "0")}.000Z`,
    turnId: null,
    status: "consumed",
    targetMessageId,
    targetTurnId: null,
    sources: [],
    target: {},
  } as unknown as ContextHandoffTimelineEntry;
}

function emptySources(overrides: Partial<TimelineEntrySources> = {}): TimelineEntrySources {
  return {
    messages: [],
    proposedPlans: [],
    workEntries: [],
    contextCompactionEntries: [],
    contextHandoffEntries: [],
    ...overrides,
  };
}

function oracle(sources: TimelineEntrySources) {
  return deriveTimelineEntries(
    [...sources.messages],
    [...sources.proposedPlans],
    [...sources.workEntries],
    [...sources.contextCompactionEntries],
    [...sources.contextHandoffEntries],
  );
}

function expectMatchesOracle(
  indexed: ReturnType<typeof createTimelineEntryIndex>,
  sources: TimelineEntrySources,
) {
  const result = indexed.update(sources);
  const expected = oracle(sources);
  expect(result.map((entry) => `${entry.kind}:${entry.id}`)).toEqual(
    expected.map((entry) => `${entry.kind}:${entry.id}`),
  );
  return result;
}

describe("timeline entry index", () => {
  it("handles append, replacement, bounded prepend, deletion, and handoff re-anchoring", () => {
    const index = createTimelineEntryIndex();
    const second = message("message-2", 2);
    const third = message("message-3", 3);
    const work: WorkLogEntry = {
      id: "work-1",
      createdAt: "2026-08-12T00:00:02.500Z",
      label: "work",
      tone: "tool",
    };
    let sources = emptySources({
      messages: [second, third],
      proposedPlans: [plan("plan-1", 4)],
      workEntries: [work],
    });
    const initial = expectMatchesOracle(index, sources);
    expect(index.inspect().mode).toBe("full");

    sources = { ...sources, messages: [...sources.messages, message("message-5", 5)] };
    const appended = expectMatchesOracle(index, sources);
    expect(index.inspect().mode).toBe("incremental");
    expect(appended[0]).toBe(initial[0]);

    const replacement = message("message-3", 3, "streamed update");
    sources = { ...sources, messages: [second, replacement, sources.messages[2]!] };
    const replaced = expectMatchesOracle(index, sources);
    expect(replaced.find((entry) => entry.id === second.id)).toBe(
      appended.find((entry) => entry.id === second.id),
    );
    expect(replaced.find((entry) => entry.id === replacement.id)).not.toBe(
      appended.find((entry) => entry.id === replacement.id),
    );

    sources = { ...sources, messages: [message("message-1", 1), ...sources.messages] };
    expectMatchesOracle(index, sources);
    expect(index.inspect().mode).toBe("incremental");

    sources = { ...sources, messages: sources.messages.filter((entry) => entry.id !== second.id) };
    expectMatchesOracle(index, sources);
    expect(index.inspect().mode).toBe("incremental");

    const marker = handoff("handoff-1", replacement.id, 0);
    sources = { ...sources, contextHandoffEntries: [marker] };
    expectMatchesOracle(index, sources);
    sources = {
      ...sources,
      messages: sources.messages.filter((entry) => entry.id !== replacement.id),
    };
    expectMatchesOracle(index, sources);
  });

  it("reuses the result and unchanged entry references", () => {
    const index = createTimelineEntryIndex();
    const sources = emptySources({ messages: [message("message-1", 1)] });
    const first = index.update(sources);
    const second = index.update(sources);

    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(index.inspect().mode).toBe("reuse");
  });

  it("stays equivalent to full derivation across a deterministic mutation sequence", () => {
    const index = createTimelineEntryIndex();
    let messages: ChatMessage[] = [];
    for (let step = 0; step < 120; step++) {
      const id = `message-${step % 31}`;
      if (step % 7 === 0) {
        messages = messages.filter((entry) => entry.id !== id);
      } else {
        const next = message(id, step % 60, `text-${step}`);
        const existing = messages.findIndex((entry) => entry.id === next.id);
        if (existing >= 0) messages = messages.with(existing, next);
        else if (step % 5 === 0) messages = [next, ...messages];
        else messages = [...messages, next];
      }
      expectMatchesOracle(index, emptySources({ messages }));
    }
  });
});
