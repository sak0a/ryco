import { describe, expect, it } from "vitest";
import { splitUnifiedDiffByFile } from "./unifiedDiffSplit";

describe("splitUnifiedDiffByFile", () => {
  it("returns empty map for empty input", () => {
    expect(splitUnifiedDiffByFile("").size).toBe(0);
  });

  it("splits a two-file diff by new path", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index 1111111..2222222 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      "diff --git a/bar.ts b/bar.ts",
      "index 3333333..4444444 100644",
      "--- a/bar.ts",
      "+++ b/bar.ts",
      "@@ -10,2 +10,3 @@",
      " x",
      "+y",
      " z",
    ].join("\n");

    const map = splitUnifiedDiffByFile(diff);
    expect([...map.keys()]).toEqual(["foo.ts", "bar.ts"]);
    expect(map.get("foo.ts")).toContain("@@ -1,3 +1,3 @@");
    expect(map.get("foo.ts")).toContain("+B");
    expect(map.get("foo.ts")).not.toContain("@@ -10,2 +10,3 @@");
    expect(map.get("bar.ts")).toContain("+y");
  });

  it("uses the new file path for renames", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 95%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const map = splitUnifiedDiffByFile(diff);
    expect(map.has("new.ts")).toBe(true);
    expect(map.has("old.ts")).toBe(false);
  });

  it("handles deleted files (new path is /dev/null) by using the old path", () => {
    const diff = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "index 1234567..0000000",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-was here",
      "-also here",
    ].join("\n");

    const map = splitUnifiedDiffByFile(diff);
    expect(map.has("gone.ts")).toBe(true);
  });

  it("preserves the diff text for each file", () => {
    const diff = [
      "diff --git a/single.ts b/single.ts",
      "index 1111111..2222222 100644",
      "--- a/single.ts",
      "+++ b/single.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    const map = splitUnifiedDiffByFile(diff);
    expect(map.get("single.ts")).toBe(diff);
  });
});
