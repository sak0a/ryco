import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { renderThreadMessageSearchHighlightedText } from "./ThreadMessageSearchHighlight";

describe("renderThreadMessageSearchHighlightedText", () => {
  it("wraps each matching occurrence and marks the active one", () => {
    const markup = renderToStaticMarkup(
      <>
        {renderThreadMessageSearchHighlightedText({
          text: "fix one then fix two",
          query: "fix",
          activeOccurrenceIndex: 1,
          cursor: { occurrenceIndex: 0 },
          keyPrefix: "test",
        })}
      </>,
    );

    expect(markup.match(/data-thread-message-search-hit="true"/g)).toHaveLength(2);
    expect(markup.match(/data-thread-message-search-active="true"/g)).toHaveLength(1);
    expect(markup).toContain(">fix</mark> one then ");
  });
});
