import type { WsConnectionUiState } from "@ryco/client-runtime/rpc";
import type { ProjectListEntriesResult, ProjectSearchEntriesResult } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadFilesScreenModel,
  type ThreadFilesScreenInput,
  type ThreadFilesScreenModel,
} from "./threadFilesModel";

const IDLE_ENTRIES = { data: null, error: null, isLoading: false } as const;
const IDLE_SEARCH = { data: null, error: null, isLoading: false, isDebouncing: false } as const;

function listing(
  paths: ReadonlyArray<readonly [string, "file" | "directory"]>,
  truncated = false,
): ProjectListEntriesResult {
  return { entries: paths.map(([path, kind]) => ({ path, kind })), truncated };
}

function searchResult(
  paths: ReadonlyArray<readonly [string, "file" | "directory"]>,
  truncated = false,
): ProjectSearchEntriesResult {
  return { entries: paths.map(([path, kind]) => ({ path, kind })), truncated };
}

function input(overrides: Partial<ThreadFilesScreenInput> = {}): ThreadFilesScreenInput {
  return {
    bootstrapComplete: true,
    thread: { worktreePath: null },
    project: { cwd: "/work/project" },
    worktree: null,
    entriesState: IDLE_ENTRIES,
    searchState: IDLE_SEARCH,
    normalizedQuery: "",
    expanded: new Set<string>(),
    connectionUiState: "connected",
    ...overrides,
  };
}

function treeRowPaths(model: ThreadFilesScreenModel): readonly string[] {
  if (model.state !== "tree") throw new Error(`expected a tree, got ${model.state}`);
  return model.rows.map((row) => row.node.path);
}

describe("buildThreadFilesScreenModel workspace root", () => {
  it("prefers the worktree, then the thread, then the project checkout", () => {
    const chain = [
      {
        worktree: { worktreePath: "/work/wt" },
        thread: { worktreePath: "/work/thread" },
        expected: "/work/wt",
      },
      { worktree: null, thread: { worktreePath: "/work/thread" }, expected: "/work/thread" },
      { worktree: null, thread: { worktreePath: null }, expected: "/work/project" },
    ] as const;

    for (const step of chain) {
      // The root is not on the model, so it is observed through the listing the
      // screen fetches with it: a resolvable root always renders content.
      const model = buildThreadFilesScreenModel(
        input({
          worktree: step.worktree,
          thread: step.thread,
          entriesState: { ...IDLE_ENTRIES, data: listing([["a.ts", "file"]]) },
        }),
      );
      expect(model.state, step.expected).toBe("tree");
    }
  });

  it("reports no workspace only once the shell snapshot has landed", () => {
    const rootless = { thread: { worktreePath: null }, project: null, worktree: null };
    expect(buildThreadFilesScreenModel(input({ ...rootless, bootstrapComplete: false }))).toEqual({
      state: "loading",
    });
    expect(buildThreadFilesScreenModel(input({ ...rootless, bootstrapComplete: true }))).toEqual({
      state: "no-workspace",
    });
  });

  it("treats a worktree the node manages without a path as no worktree", () => {
    const model = buildThreadFilesScreenModel(
      input({
        worktree: { worktreePath: null },
        thread: { worktreePath: null },
        project: null,
      }),
    );
    expect(model).toEqual({ state: "no-workspace" });
  });
});

describe("buildThreadFilesScreenModel tree view", () => {
  it("renders only the rows the expansion set opens", () => {
    const entriesState = {
      ...IDLE_ENTRIES,
      data: listing([
        ["src/app/main.ts", "file"],
        ["src/util.ts", "file"],
        ["README.md", "file"],
      ]),
    };

    expect(treeRowPaths(buildThreadFilesScreenModel(input({ entriesState })))).toEqual([
      "src",
      "README.md",
    ]);
    expect(
      treeRowPaths(
        buildThreadFilesScreenModel(input({ entriesState, expanded: new Set(["src"]) })),
      ),
    ).toEqual(["src", "src/app", "src/util.ts", "README.md"]);
  });

  it("hands the screen the top-level directories to seed expansion with", () => {
    const model = buildThreadFilesScreenModel(
      input({
        entriesState: {
          ...IDLE_ENTRIES,
          data: listing([
            ["src/a.ts", "file"],
            ["docs/b.md", "file"],
            ["root.ts", "file"],
          ]),
        },
      }),
    );
    if (model.state !== "tree") throw new Error("expected a tree");
    expect([...model.defaultExpanded].toSorted()).toEqual(["docs", "src"]);
    expect(model.fileCount).toBe(3);
  });

  it("passes the node's truncation flag through", () => {
    const model = buildThreadFilesScreenModel(
      input({ entriesState: { ...IDLE_ENTRIES, data: listing([["a.ts", "file"]], true) } }),
    );
    expect(model).toMatchObject({ state: "tree", truncated: true });
  });

  it("is empty when the workspace listing has nothing renderable", () => {
    expect(
      buildThreadFilesScreenModel(input({ entriesState: { ...IDLE_ENTRIES, data: listing([]) } })),
    ).toEqual({ state: "empty" });
  });

  it("loads while the first listing is in flight", () => {
    expect(
      buildThreadFilesScreenModel(input({ entriesState: { ...IDLE_ENTRIES, isLoading: true } })),
    ).toEqual({ state: "loading" });
  });

  it("surfaces a listing failure with a retry", () => {
    expect(
      buildThreadFilesScreenModel(
        input({ entriesState: { ...IDLE_ENTRIES, error: new Error("listEntries failed") } }),
      ),
    ).toEqual({ state: "error", message: "listEntries failed", canRetry: true });
  });
});

describe("buildThreadFilesScreenModel offline behaviour", () => {
  it("keeps cached rows visible behind an inline notice", () => {
    const model = buildThreadFilesScreenModel(
      input({
        entriesState: { ...IDLE_ENTRIES, data: listing([["a.ts", "file"]]) },
        connectionUiState: "offline",
      }),
    );
    expect(model).toMatchObject({ state: "tree", offlineNotice: true });
  });

  it("dead-ends only when there is nothing cached to show", () => {
    expect(
      buildThreadFilesScreenModel(
        input({
          entriesState: { ...IDLE_ENTRIES, error: new Error("socket closed") },
          connectionUiState: "offline",
        }),
      ),
    ).toEqual({ state: "offline-empty" });
  });

  it("notices every non-connected state, not just a dropped socket", () => {
    for (const connectionUiState of [
      "connecting",
      "reconnecting",
      "error",
    ] as const satisfies readonly WsConnectionUiState[]) {
      const model = buildThreadFilesScreenModel(
        input({
          entriesState: { ...IDLE_ENTRIES, data: listing([["a.ts", "file"]]) },
          connectionUiState,
        }),
      );
      expect(model, connectionUiState).toMatchObject({ offlineNotice: true });
    }
  });

  it("keeps reconnecting out of the dead-end so the retry never fights the supervisor", () => {
    expect(buildThreadFilesScreenModel(input({ connectionUiState: "reconnecting" }))).toEqual({
      state: "loading",
    });
  });
});

describe("buildThreadFilesScreenModel search view", () => {
  const query = "butt";

  it("keeps the node's ranking and derives the parent label", () => {
    const model = buildThreadFilesScreenModel(
      input({
        normalizedQuery: query,
        searchState: {
          ...IDLE_SEARCH,
          data: searchResult([
            ["src/ui/Button.tsx", "file"],
            ["Button.md", "file"],
            ["src/buttons", "directory"],
          ]),
        },
      }),
    );
    expect(model).toMatchObject({ state: "search", searching: false, truncated: false });
    if (model.state !== "search") throw new Error("expected a search");
    expect(model.rows).toEqual([
      { path: "src/ui/Button.tsx", name: "Button.tsx", parentPath: "src/ui", kind: "file" },
      { path: "Button.md", name: "Button.md", parentPath: null, kind: "file" },
      { path: "src/buttons", name: "buttons", parentPath: "src", kind: "directory" },
    ]);
  });

  it("never falls back to the tree while a query is pending", () => {
    for (const searchState of [
      { ...IDLE_SEARCH, isDebouncing: true },
      { ...IDLE_SEARCH, isLoading: true },
    ]) {
      const model = buildThreadFilesScreenModel(
        input({
          normalizedQuery: query,
          searchState,
          entriesState: { ...IDLE_ENTRIES, data: listing([["a.ts", "file"]]) },
        }),
      );
      expect(model).toEqual({
        state: "search",
        rows: [],
        truncated: false,
        searching: true,
        offlineNotice: false,
      });
    }
  });

  it("reports a settled search with no matches rather than an error", () => {
    expect(
      buildThreadFilesScreenModel(
        input({ normalizedQuery: query, searchState: { ...IDLE_SEARCH, data: searchResult([]) } }),
      ),
    ).toMatchObject({ state: "search", rows: [], searching: false });
  });

  it("marks a capped result set so the screen can say so", () => {
    expect(
      buildThreadFilesScreenModel(
        input({
          normalizedQuery: query,
          searchState: {
            ...IDLE_SEARCH,
            data: searchResult([["src/ui/Button.tsx", "file"]], true),
          },
        }),
      ),
    ).toMatchObject({ state: "search", truncated: true });
  });

  it("surfaces a search failure and the offline dead-end the same way the tree does", () => {
    expect(
      buildThreadFilesScreenModel(
        input({
          normalizedQuery: query,
          searchState: { ...IDLE_SEARCH, error: new Error("searchEntries failed") },
        }),
      ),
    ).toEqual({ state: "error", message: "searchEntries failed", canRetry: true });

    expect(
      buildThreadFilesScreenModel(
        input({
          normalizedQuery: query,
          searchState: { ...IDLE_SEARCH, error: new Error("searchEntries failed") },
          connectionUiState: "offline",
        }),
      ),
    ).toEqual({ state: "offline-empty" });
  });

  it("returns to the tree the moment the query is cleared", () => {
    const model = buildThreadFilesScreenModel(
      input({
        normalizedQuery: "",
        searchState: { ...IDLE_SEARCH, data: searchResult([["src/ui/Button.tsx", "file"]]) },
        entriesState: { ...IDLE_ENTRIES, data: listing([["a.ts", "file"]]) },
      }),
    );
    expect(treeRowPaths(model)).toEqual(["a.ts"]);
  });
});
