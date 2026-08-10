import { describe, expect, it } from "vite-plus/test";

import {
  buildWorkspaceFileTree,
  countWorkspaceFiles,
  defaultExpandedWorkspaceTreePaths,
  flattenWorkspaceFileTree,
  type WorkspaceFileTreeEntry,
  workspaceAncestorPaths,
} from "./fileTree.ts";

function file(path: string): WorkspaceFileTreeEntry {
  return { path, kind: "file" };
}

function directory(path: string): WorkspaceFileTreeEntry {
  return { path, kind: "directory" };
}

function outline(
  nodes: ReturnType<typeof buildWorkspaceFileTree>,
): ReadonlyArray<Record<string, unknown>> {
  return nodes.map((node) => ({
    path: node.path,
    kind: node.kind,
    children: outline(node.children),
  }));
}

describe("buildWorkspaceFileTree", () => {
  it("synthesizes intermediate directories the listing omits", () => {
    const tree = buildWorkspaceFileTree([file("src/lib/cn.ts")]);

    expect(outline(tree)).toEqual([
      {
        path: "src",
        kind: "directory",
        children: [
          {
            path: "src/lib",
            kind: "directory",
            children: [{ path: "src/lib/cn.ts", kind: "file", children: [] }],
          },
        ],
      },
    ]);
  });

  it("merges an explicit directory entry with the implicit node, in either order", () => {
    const explicitFirst = buildWorkspaceFileTree([directory("src"), file("src/a.ts")]);
    const explicitLast = buildWorkspaceFileTree([file("src/a.ts"), directory("src")]);

    expect(outline(explicitFirst)).toEqual(outline(explicitLast));
    expect(explicitFirst).toHaveLength(1);
    expect(explicitFirst[0]?.kind).toBe("directory");
    expect(explicitFirst[0]?.children.map((child) => child.path)).toEqual(["src/a.ts"]);
  });

  it("upgrades a node first seen as a file once children arrive", () => {
    const tree = buildWorkspaceFileTree([file("src"), file("src/a.ts")]);

    expect(outline(tree)).toEqual([
      {
        path: "src",
        kind: "directory",
        children: [{ path: "src/a.ts", kind: "file", children: [] }],
      },
    ]);
  });

  it("orders directories first, then names naturally and case-insensitively", () => {
    const tree = buildWorkspaceFileTree([
      file("readme.md"),
      file("item10.ts"),
      file("item2.ts"),
      file("Apple.ts"),
      directory("zeta"),
      directory("Alpha"),
    ]);

    expect(tree.map((node) => node.path)).toEqual([
      "Alpha",
      "zeta",
      "Apple.ts",
      "item2.ts",
      "item10.ts",
      "readme.md",
    ]);
  });

  it("skips entries whose path cannot be normalized", () => {
    const tree = buildWorkspaceFileTree([
      file("../outside.ts"),
      file("/etc/passwd"),
      file("~/.ssh/id_rsa"),
      file("src/a.ts"),
    ]);

    expect(countWorkspaceFiles(tree)).toBe(1);
    expect(tree[0]?.path).toBe("src");
  });
});

describe("flattenWorkspaceFileTree", () => {
  const tree = buildWorkspaceFileTree([
    file("src/lib/cn.ts"),
    file("src/index.ts"),
    file("readme.md"),
  ]);

  it("shows only the children of expanded directories", () => {
    expect(flattenWorkspaceFileTree({ nodes: tree, expanded: new Set() })).toEqual([
      { node: expect.objectContaining({ path: "src" }), depth: 0 },
      { node: expect.objectContaining({ path: "readme.md" }), depth: 0 },
    ]);

    const expanded = flattenWorkspaceFileTree({ nodes: tree, expanded: new Set(["src"]) });
    expect(expanded.map((row) => [row.node.path, row.depth])).toEqual([
      ["src", 0],
      ["src/lib", 1],
      ["src/index.ts", 1],
      ["readme.md", 0],
    ]);
  });

  it("descends every expanded level", () => {
    const rows = flattenWorkspaceFileTree({
      nodes: tree,
      expanded: new Set(["src", "src/lib"]),
    });

    expect(rows.map((row) => [row.node.path, row.depth])).toEqual([
      ["src", 0],
      ["src/lib", 1],
      ["src/lib/cn.ts", 2],
      ["src/index.ts", 1],
      ["readme.md", 0],
    ]);
  });
});

describe("expansion helpers", () => {
  it("defaults to top-level directories only", () => {
    const tree = buildWorkspaceFileTree([file("src/lib/cn.ts"), file("readme.md")]);
    expect([...defaultExpandedWorkspaceTreePaths(tree)]).toEqual(["src"]);
  });

  it("lists ancestors root-first without the path itself", () => {
    expect(workspaceAncestorPaths("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(workspaceAncestorPaths("a")).toEqual([]);
    expect(workspaceAncestorPaths("")).toEqual([]);
  });

  it("counts files across the whole tree", () => {
    const tree = buildWorkspaceFileTree([
      file("src/lib/cn.ts"),
      file("src/index.ts"),
      directory("empty"),
    ]);
    expect(countWorkspaceFiles(tree)).toBe(2);
  });
});
