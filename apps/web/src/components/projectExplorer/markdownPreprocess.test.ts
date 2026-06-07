import { describe, expect, it } from "vitest";
import { stripHtmlComments } from "./markdownPreprocess";

describe("stripHtmlComments", () => {
  it("returns unchanged text when no comments", () => {
    expect(stripHtmlComments("Hello\n\nWorld")).toBe("Hello\n\nWorld");
  });

  it("removes a single-line HTML comment", () => {
    expect(stripHtmlComments("Before <!-- hide me --> after")).toBe("Before  after");
  });

  it("removes a multi-line HTML comment", () => {
    const input = "Top\n<!--\n  ⚠️ READ BEFORE OPENING ⚠️\n  Don't bother me.\n-->\nBottom";
    expect(stripHtmlComments(input)).toBe("Top\n\nBottom");
  });

  it("removes multiple comments in one pass", () => {
    expect(stripHtmlComments("a <!-- one --> b <!-- two --> c")).toBe("a  b  c");
  });

  it("does not remove the literal string '<!--' inside a fenced code block", () => {
    const input = "```html\n<!-- this is example code -->\n```";
    expect(stripHtmlComments(input)).toBe(input);
  });

  it("does not remove '<!--' inside an inline code span", () => {
    const input = "Use `<!-- example -->` to add comments";
    expect(stripHtmlComments(input)).toBe(input);
  });

  it("collapses leading/trailing blank lines created by the strip", () => {
    const input = "Hello\n<!-- gone -->\n\nWorld";
    expect(stripHtmlComments(input)).toBe("Hello\n\nWorld");
  });
});
