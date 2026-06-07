import { describe, expect, it, vi } from "vitest";
import {
  EnvironmentId,
  type FilesystemBrowseEntry,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@ryco/contracts";
import type { Thread } from "../types";
import {
  buildBrowseGroups,
  buildBrowseItemValue,
  buildThreadActionItems,
  filterBrowseEntries,
  filterCommandPaletteGroups,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeBrowseEntry(overrides: Partial<FilesystemBrowseEntry>): FilesystemBrowseEntry {
  return {
    name: "entry",
    fullPath: "/entry",
    ...overrides,
  };
}

function makeBrowseInput(
  entries: FilesystemBrowseEntry[],
  handlers: {
    browseTo?: (name: string) => void;
    browseToPath?: (fullPath: string) => void;
  } = {},
) {
  return {
    browseEntries: entries,
    browseQuery: "~/",
    canBrowseUp: false,
    upIcon: "up-icon",
    directoryIcon: "dir-icon",
    symlinkIcon: "symlink-icon",
    browseUp: () => undefined,
    browseTo: handlers.browseTo ?? (() => undefined),
    browseToPath: handlers.browseToPath ?? (() => undefined),
  };
}

describe("buildThreadActionItems", () => {
  it("orders threads by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildThreadActionItems({
        threads: [
          makeThread({
            id: ThreadId.make("thread-older"),
            title: "Older thread",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.make("thread-newer"),
            title: "Newer thread",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runThread: async (_thread) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "thread:thread-older",
        "thread:thread-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks thread title matches ahead of contextual project-name matches", () => {
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("threads-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:thread-title-match",
      "thread:thread-context-match",
    ]);
  });

  it("preserves thread project-name matches when there is no stronger title match", () => {
    const group: CommandPaletteGroup = {
      value: "threads-search",
      label: "Threads",
      items: [
        {
          kind: "action",
          value: "thread:project-context-only",
          searchTerms: ["Fix navbar spacing", "Project"],
          title: "Fix navbar spacing",
          description: "Project",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["thread:project-context-only"]);
  });

  it("filters archived threads out of thread search items", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          title: "Active thread",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          title: "Archived thread",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-active"]);
  });
});

describe("buildBrowseGroups", () => {
  it("uses the symlink icon for symlinked and aliased entries", () => {
    const groups = buildBrowseGroups(
      makeBrowseInput([
        makeBrowseEntry({ name: "real", fullPath: "/p/real" }),
        makeBrowseEntry({ name: "linked", fullPath: "/p/linked", isSymlink: true }),
        makeBrowseEntry({ name: "aliased", fullPath: "/target", isSymlink: true, isAlias: true }),
      ]),
    );

    const icons = groups[0]?.items.map((item) => item.kind === "action" && item.icon);
    expect(icons).toEqual(["dir-icon", "symlink-icon", "symlink-icon"]);
  });

  it("produces unique values for aliases that share a resolved target", () => {
    const groups = buildBrowseGroups(
      makeBrowseInput([
        makeBrowseEntry({
          name: "alias-a",
          fullPath: "/shared/target",
          isSymlink: true,
          isAlias: true,
        }),
        makeBrowseEntry({
          name: "alias-b",
          fullPath: "/shared/target",
          isSymlink: true,
          isAlias: true,
        }),
      ]),
    );

    const values = groups[0]?.items.map((item) => item.value) ?? [];
    expect(new Set(values).size).toBe(values.length);
  });

  it("routes alias navigation to browseToPath with the resolved fullPath", async () => {
    const browseTo = vi.fn();
    const browseToPath = vi.fn();
    const groups = buildBrowseGroups(
      makeBrowseInput(
        [makeBrowseEntry({ name: "alias", fullPath: "/target", isSymlink: true, isAlias: true })],
        { browseTo, browseToPath },
      ),
    );

    const action = groups[0]?.items[0];
    if (action?.kind !== "action") throw new Error("expected action item");
    await action.run();

    expect(browseToPath).toHaveBeenCalledWith("/target");
    expect(browseTo).not.toHaveBeenCalled();
  });

  it("routes directory and symlink navigation to browseTo with the entry name", async () => {
    const browseTo = vi.fn();
    const browseToPath = vi.fn();
    const groups = buildBrowseGroups(
      makeBrowseInput(
        [
          makeBrowseEntry({ name: "dir", fullPath: "/p/dir" }),
          makeBrowseEntry({ name: "symlink", fullPath: "/p/symlink", isSymlink: true }),
        ],
        { browseTo, browseToPath },
      ),
    );

    const items = groups[0]?.items ?? [];
    for (const item of items) {
      if (item.kind !== "action") throw new Error("expected action item");
      await item.run();
    }

    expect(browseTo.mock.calls).toEqual([["dir"], ["symlink"]]);
    expect(browseToPath).not.toHaveBeenCalled();
  });
});

describe("filterBrowseEntries", () => {
  it("resolves highlightedEntry for non-alias entries", () => {
    const entry = makeBrowseEntry({ name: "dir", fullPath: "/p/dir" });
    const result = filterBrowseEntries({
      browseEntries: [entry],
      browseFilterQuery: "",
      highlightedItemValue: buildBrowseItemValue(entry),
    });
    expect(result.highlightedEntry).toBe(entry);
  });

  it("resolves highlightedEntry for alias entries sharing a resolved target", () => {
    // Two aliases in the same listing pointing at the same target; the
    // filename is what disambiguates them.
    const aliasA = makeBrowseEntry({
      name: "alias-a",
      fullPath: "/shared/target",
      isSymlink: true,
      isAlias: true,
    });
    const aliasB = makeBrowseEntry({
      name: "alias-b",
      fullPath: "/shared/target",
      isSymlink: true,
      isAlias: true,
    });

    const result = filterBrowseEntries({
      browseEntries: [aliasA, aliasB],
      browseFilterQuery: "",
      highlightedItemValue: buildBrowseItemValue(aliasB),
    });

    expect(result.highlightedEntry).toBe(aliasB);
  });

  it("resolves highlightedEntry when the alias name contains a colon", () => {
    // POSIX allows `:` in filenames. A stringy parser that splits on the
    // first `:` after `alias:` would misread the name/fullPath boundary
    // and fail to match. The consumer recomputes the value instead, so
    // the round-trip is robust.
    const alias = makeBrowseEntry({
      name: "weird:name",
      fullPath: "/real/target",
      isSymlink: true,
      isAlias: true,
    });

    const result = filterBrowseEntries({
      browseEntries: [alias],
      browseFilterQuery: "",
      highlightedItemValue: buildBrowseItemValue(alias),
    });

    expect(result.highlightedEntry).toBe(alias);
  });
});
