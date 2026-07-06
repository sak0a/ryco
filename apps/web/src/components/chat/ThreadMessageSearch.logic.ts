import type { MessageId } from "@ryco/contracts";
import type { TimelineEntry } from "../../session-logic";

export interface ThreadMessageSearchMatch {
  messageId: MessageId;
  text: string;
}

export type ThreadMessageSearchDirection = "next" | "previous";

function normalizeThreadSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function buildThreadMessageSearchMatches(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  query: string;
}): ThreadMessageSearchMatch[] {
  const normalizedQuery = normalizeThreadSearchText(input.query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  const matches: ThreadMessageSearchMatch[] = [];
  for (const entry of input.timelineEntries) {
    if (entry.kind !== "message") {
      continue;
    }
    if (entry.message.role !== "user" && entry.message.role !== "assistant") {
      continue;
    }
    if (!normalizeThreadSearchText(entry.message.text).includes(normalizedQuery)) {
      continue;
    }
    matches.push({
      messageId: entry.message.id,
      text: entry.message.text,
    });
  }
  return matches;
}

export function clampThreadMessageSearchIndex(index: number, matchCount: number): number {
  if (matchCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, index), matchCount - 1);
}

export function moveThreadMessageSearchIndex(input: {
  currentIndex: number;
  matchCount: number;
  direction: ThreadMessageSearchDirection;
}): number {
  if (input.matchCount <= 0) {
    return 0;
  }
  if (input.direction === "previous") {
    return (input.currentIndex - 1 + input.matchCount) % input.matchCount;
  }
  return (input.currentIndex + 1) % input.matchCount;
}
