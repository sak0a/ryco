import type { ProjectEntry } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildWorkspaceFileSearchRows,
  normalizeWorkspaceFileSearchQuery,
  WORKSPACE_FILE_SEARCH_DEBOUNCE_MS,
  WORKSPACE_FILE_SEARCH_LIMIT,
  WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH,
} from "./search.ts";

function entry(path: string, kind: ProjectEntry["kind"] = "file"): ProjectEntry {
  return { path, kind };
}

describe("workspace file search constants", () => {
  it("stays inside the contract's caps", () => {
    expect(WORKSPACE_FILE_SEARCH_LIMIT).toBe(80);
    expect(WORKSPACE_FILE_SEARCH_LIMIT).toBeLessThanOrEqual(200);
    expect(WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH).toBe(256);
    expect(WORKSPACE_FILE_SEARCH_DEBOUNCE_MS).toBe(250);
  });
});

describe("normalizeWorkspaceFileSearchQuery", () => {
  it("trims and treats whitespace-only input as no search", () => {
    expect(normalizeWorkspaceFileSearchQuery("  cn.ts  ")).toBe("cn.ts");
    expect(normalizeWorkspaceFileSearchQuery("")).toBe("");
    expect(normalizeWorkspaceFileSearchQuery("   ")).toBe("");
  });

  it("caps the query and keeps the result trimmed", () => {
    const overlong = "a".repeat(WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH + 20);
    expect(normalizeWorkspaceFileSearchQuery(overlong)).toHaveLength(
      WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH,
    );

    const cutAtWhitespace = `${"a".repeat(WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH - 1)} tail`;
    expect(normalizeWorkspaceFileSearchQuery(cutAtWhitespace)).toBe(
      "a".repeat(WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH - 1),
    );
  });
});

describe("buildWorkspaceFileSearchRows", () => {
  it("keeps the node's ranking and derives the display parts", () => {
    const rows = buildWorkspaceFileSearchRows([
      entry("src/lib/cn.ts"),
      entry("cn.ts"),
      entry("src/lib", "directory"),
    ]);

    expect(rows).toEqual([
      { path: "src/lib/cn.ts", name: "cn.ts", parentPath: "src/lib", kind: "file" },
      { path: "cn.ts", name: "cn.ts", parentPath: null, kind: "file" },
      { path: "src/lib", name: "lib", parentPath: "src", kind: "directory" },
    ]);
  });

  it("drops unnormalizable paths and duplicate keys", () => {
    const rows = buildWorkspaceFileSearchRows([
      entry("../outside.ts"),
      entry("./src/a.ts"),
      entry("src/a.ts"),
      entry("/etc/passwd"),
    ]);

    expect(rows.map((row) => row.path)).toEqual(["src/a.ts"]);
  });
});
