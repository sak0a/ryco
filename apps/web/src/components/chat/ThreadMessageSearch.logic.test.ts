import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@ryco/contracts";
import type { TimelineEntry } from "../../session-logic";
import {
  buildThreadMessageSearchOccurrences,
  clampThreadMessageSearchIndex,
  moveThreadMessageSearchIndex,
} from "./ThreadMessageSearch.logic";

function messageEntry(input: {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}): TimelineEntry {
  return {
    id: `entry-${input.id}`,
    kind: "message",
    createdAt: "2026-04-01T12:00:00.000Z",
    message: {
      id: MessageId.make(input.id),
      role: input.role,
      text: input.text,
      createdAt: "2026-04-01T12:00:00.000Z",
      streaming: false,
    },
  };
}

describe("buildThreadMessageSearchOccurrences", () => {
  it("returns user and assistant occurrences in timeline order", () => {
    const occurrences = buildThreadMessageSearchOccurrences({
      query: "deploy",
      timelineEntries: [
        messageEntry({ id: "message-1", role: "assistant", text: "No match" }),
        messageEntry({ id: "message-2", role: "user", text: "Deploy the app" }),
        messageEntry({ id: "message-3", role: "assistant", text: "Deploy then deploy again" }),
      ],
    });

    expect(occurrences.map((occurrence) => occurrence.messageId)).toEqual([
      MessageId.make("message-2"),
      MessageId.make("message-3"),
      MessageId.make("message-3"),
    ]);
    expect(occurrences.map((occurrence) => occurrence.messageOccurrenceIndex)).toEqual([0, 0, 1]);
  });

  it("records matched text spans for exact occurrence highlighting", () => {
    const occurrences = buildThreadMessageSearchOccurrences({
      query: "fix",
      timelineEntries: [
        messageEntry({ id: "message-1", role: "assistant", text: "fix one then fix two" }),
      ],
    });

    expect(
      occurrences.map((occurrence) => ({
        start: occurrence.start,
        end: occurrence.end,
        text: occurrence.text,
      })),
    ).toEqual([
      { start: 0, end: 3, text: "fix" },
      { start: 13, end: 16, text: "fix" },
    ]);
  });

  it("normalizes case and query whitespace", () => {
    const occurrences = buildThreadMessageSearchOccurrences({
      query: "alpha beta",
      timelineEntries: [
        messageEntry({ id: "message-1", role: "assistant", text: "Alpha\n\nBeta shipped" }),
      ],
    });

    expect(occurrences.map((occurrence) => occurrence.messageId)).toEqual([
      MessageId.make("message-1"),
    ]);
    expect(occurrences[0]?.text).toBe("Alpha\n\nBeta");
  });

  it("skips system messages and non-message timeline entries", () => {
    const occurrences = buildThreadMessageSearchOccurrences({
      query: "secret",
      timelineEntries: [
        messageEntry({ id: "message-1", role: "system", text: "secret instructions" }),
        {
          id: "work-1",
          kind: "work",
          createdAt: "2026-04-01T12:00:00.000Z",
          entry: {
            id: "work-1",
            createdAt: "2026-04-01T12:00:00.000Z",
            label: "secret command",
            tone: "tool",
          },
        },
      ],
    });

    expect(occurrences).toEqual([]);
  });

  it("returns no matches for empty queries", () => {
    expect(
      buildThreadMessageSearchOccurrences({
        query: "   ",
        timelineEntries: [messageEntry({ id: "message-1", role: "user", text: "anything" })],
      }),
    ).toEqual([]);
  });
});

describe("thread message search selection", () => {
  it("clamps selected indexes to the available result range", () => {
    expect(clampThreadMessageSearchIndex(-2, 3)).toBe(0);
    expect(clampThreadMessageSearchIndex(5, 3)).toBe(2);
    expect(clampThreadMessageSearchIndex(1, 0)).toBe(0);
  });

  it("moves next and previous with wraparound", () => {
    expect(
      moveThreadMessageSearchIndex({
        currentIndex: 2,
        matchCount: 3,
        direction: "next",
      }),
    ).toBe(0);
    expect(
      moveThreadMessageSearchIndex({
        currentIndex: 0,
        matchCount: 3,
        direction: "previous",
      }),
    ).toBe(2);
  });
});
