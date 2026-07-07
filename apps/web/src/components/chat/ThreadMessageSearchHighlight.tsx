import type { ReactNode } from "react";
import { createThreadMessageSearchMatcher } from "./ThreadMessageSearch.logic";
import { cn } from "../../lib/utils";

export interface ThreadMessageSearchHighlightCursor {
  occurrenceIndex: number;
}

export function renderThreadMessageSearchHighlightedText(input: {
  text: string;
  query: string;
  activeOccurrenceIndex: number | null;
  cursor: ThreadMessageSearchHighlightCursor;
  keyPrefix: string;
}): ReactNode {
  const matcher = createThreadMessageSearchMatcher(input.query);
  if (!matcher) {
    return input.text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  matcher.lastIndex = 0;

  for (const match of input.text.matchAll(matcher)) {
    const start = match.index ?? 0;
    const value = match[0] ?? "";
    if (value.length === 0) {
      continue;
    }
    const end = start + value.length;
    if (start > cursor) {
      nodes.push(input.text.slice(cursor, start));
    }

    const occurrenceIndex = input.cursor.occurrenceIndex;
    input.cursor.occurrenceIndex += 1;
    nodes.push(
      <mark
        key={`${input.keyPrefix}:thread-search:${start}:${end}:${occurrenceIndex}`}
        className={cn(
          "thread-message-search-highlight",
          input.activeOccurrenceIndex === occurrenceIndex &&
            "thread-message-search-highlight-active",
        )}
        data-thread-message-search-hit="true"
        data-thread-message-search-active={
          input.activeOccurrenceIndex === occurrenceIndex ? "true" : undefined
        }
      >
        {value}
      </mark>,
    );
    cursor = end;
  }

  if (nodes.length === 0) {
    return input.text;
  }
  if (cursor < input.text.length) {
    nodes.push(input.text.slice(cursor));
  }
  return <>{nodes}</>;
}
