import { describe, expect, it } from "vitest";
import { parseDiffLines } from "./diffLines";

describe("parseDiffLines", () => {
  it("returns empty list for an empty patch", () => {
    expect(parseDiffLines("")).toEqual([]);
  });

  it("strips file-level metadata (diff/index/+++/---)", () => {
    const patch = [
      "diff --git a/foo.ts b/foo.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/foo.ts",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n");
    const result = parseDiffLines(patch);
    expect(result).toEqual([
      { kind: "hunk", oldLineNumber: null, newLineNumber: null, text: "@@ -0,0 +1 @@" },
      { kind: "add", oldLineNumber: null, newLineNumber: 1, text: "+hello" },
    ]);
  });

  it("tracks old/new line numbers across context/add/remove lines", () => {
    const patch = ["@@ -5,4 +5,5 @@", " a", " b", "-c", "+C", "+D", " e"].join("\n");
    const result = parseDiffLines(patch);
    expect(result).toEqual([
      { kind: "hunk", oldLineNumber: null, newLineNumber: null, text: "@@ -5,4 +5,5 @@" },
      { kind: "context", oldLineNumber: 5, newLineNumber: 5, text: " a" },
      { kind: "context", oldLineNumber: 6, newLineNumber: 6, text: " b" },
      { kind: "remove", oldLineNumber: 7, newLineNumber: null, text: "-c" },
      { kind: "add", oldLineNumber: null, newLineNumber: 7, text: "+C" },
      { kind: "add", oldLineNumber: null, newLineNumber: 8, text: "+D" },
      { kind: "context", oldLineNumber: 8, newLineNumber: 9, text: " e" },
    ]);
  });

  it("handles multiple hunks", () => {
    const patch = ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -10,2 +10,3 @@", " x", "+y"].join("\n");
    const result = parseDiffLines(patch);
    expect(result.filter((l) => l.kind === "hunk")).toHaveLength(2);
    const xLine = result.find((l) => l.text === " x");
    expect(xLine?.oldLineNumber).toBe(10);
    expect(xLine?.newLineNumber).toBe(10);
    const yLine = result.find((l) => l.text === "+y");
    expect(yLine?.oldLineNumber).toBeNull();
    expect(yLine?.newLineNumber).toBe(11);
  });

  it("treats malformed hunk headers as a no-op (emits hunk line with null counters)", () => {
    const patch = ["@@ malformed @@", " context"].join("\n");
    const result = parseDiffLines(patch);
    expect(result[0]?.kind).toBe("hunk");
    // counters stay at 0/0 with malformed header; first context line becomes line 0/0
    expect(result[1]).toEqual({
      kind: "context",
      oldLineNumber: 0,
      newLineNumber: 0,
      text: " context",
    });
  });

  it("handles single-line hunks like @@ -0,0 +1 @@", () => {
    const patch = ["@@ -0,0 +1 @@", "+only line"].join("\n");
    const result = parseDiffLines(patch);
    expect(result[1]).toEqual({
      kind: "add",
      oldLineNumber: null,
      newLineNumber: 1,
      text: "+only line",
    });
  });
});
