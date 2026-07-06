import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@ryco/contracts";
import type { TimelineEntry } from "../../session-logic";
import {
  buildThreadMessageSearchMatches,
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

describe("buildThreadMessageSearchMatches", () => {
  it("returns user and assistant message matches in timeline order", () => {
    const matches = buildThreadMessageSearchMatches({
      query: "deploy",
      timelineEntries: [
        messageEntry({ id: "message-1", role: "assistant", text: "No match" }),
        messageEntry({ id: "message-2", role: "user", text: "Deploy the app" }),
        messageEntry({ id: "message-3", role: "assistant", text: "Deployment is done" }),
      ],
    });

    expect(matches.map((match) => match.messageId)).toEqual([
      MessageId.make("message-2"),
      MessageId.make("message-3"),
    ]);
  });

  it("normalizes case and whitespace", () => {
    const matches = buildThreadMessageSearchMatches({
      query: "alpha beta",
      timelineEntries: [
        messageEntry({ id: "message-1", role: "assistant", text: "Alpha\n\nBeta shipped" }),
      ],
    });

    expect(matches.map((match) => match.messageId)).toEqual([MessageId.make("message-1")]);
  });

  it("skips system messages and non-message timeline entries", () => {
    const matches = buildThreadMessageSearchMatches({
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

    expect(matches).toEqual([]);
  });

  it("returns no matches for empty queries", () => {
    expect(
      buildThreadMessageSearchMatches({
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
