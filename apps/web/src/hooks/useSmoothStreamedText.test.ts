import { describe, expect, it } from "vite-plus/test";

import { revealBoundary } from "./useSmoothStreamedText";

describe("revealBoundary", () => {
  it("never splits a surrogate pair", () => {
    // "a" + 😀 (U+1F600, two UTF-16 units) + "b"
    const text = "a\u{1F600}b";
    expect(text.length).toBe(4);
    // Cutting at 2 would land between the emoji's halves and render U+FFFD.
    expect(revealBoundary(text, 2)).toBe(1);
    expect(revealBoundary(text, 3)).toBe(3);
  });

  it("leaves positions on plain characters untouched", () => {
    const text = "hello";
    expect(revealBoundary(text, 0)).toBe(0);
    expect(revealBoundary(text, 3)).toBe(3);
    expect(revealBoundary(text, 5)).toBe(5);
  });

  it("passes through a position at or past the end", () => {
    const text = "a\u{1F600}";
    expect(revealBoundary(text, text.length)).toBe(text.length);
    expect(revealBoundary(text, 99)).toBe(99);
  });
});
