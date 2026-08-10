import {
  normalizeWorkspaceFileSearchQuery,
  WORKSPACE_FILE_SEARCH_LIMIT,
  WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH,
} from "@ryco/client-runtime/state/files";
import type { EnvironmentApi, EnvironmentId, ProjectListEntriesResult } from "@ryco/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Native modules are stubbed so the environmentApi -> bootstrap chain loads
// under the Node runner.
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => {} }),
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("expo-linking", () => ({ getInitialURL: async () => null }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../connection/environmentApi";
import {
  clearProjectFilesStateForEnvironment,
  invalidateProjectFilesState,
  PROJECT_LIST_ENTRIES_RETAINED_KEY_LIMIT,
  projectListEntriesQuery,
  projectReadFileQuery,
  projectSearchEntriesQuery,
  resetProjectFilesAtomsForTests,
} from "./projectFilesAtoms";

const ENV = "env-a" as EnvironmentId;
const OTHER_ENV = "env-b" as EnvironmentId;
const CWD = "/work/project";

function setProjectsApi(environmentId: EnvironmentId, projects: Record<string, unknown>): void {
  __setEnvironmentApiOverrideForTests(environmentId, { projects } as unknown as EnvironmentApi);
}

function listResult(path: string): ProjectListEntriesResult {
  return { entries: [{ path, kind: "file" }], truncated: false };
}

function listedPath(cacheKey: string | null): string | undefined {
  return projectListEntriesQuery.getSnapshot(cacheKey).data?.entries[0]?.path;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
}

/** Let every pending microtask (including runWithRetry's link) settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetProjectFilesAtomsForTests();
  __resetEnvironmentApiOverridesForTests();
});

describe("projectFilesAtoms cache keys", () => {
  it("scopes keys by environment, workspace root, path and query", () => {
    const list = projectListEntriesQuery.keyOf({ environmentId: ENV, cwd: CWD });
    const listOtherEnv = projectListEntriesQuery.keyOf({ environmentId: OTHER_ENV, cwd: CWD });
    const listOtherCwd = projectListEntriesQuery.keyOf({ environmentId: ENV, cwd: "/work/other" });
    expect(new Set([list, listOtherEnv, listOtherCwd]).size).toBe(3);

    const readA = projectReadFileQuery.keyOf({
      environmentId: ENV,
      cwd: CWD,
      relativePath: "src/a.ts",
    });
    const readB = projectReadFileQuery.keyOf({
      environmentId: ENV,
      cwd: CWD,
      relativePath: "src/b.ts",
    });
    expect(readA).not.toBe(readB);
    expect(readA).not.toBe(list);

    const searchA = projectSearchEntriesQuery.keyOf({ environmentId: ENV, cwd: CWD, query: "abc" });
    const searchB = projectSearchEntriesQuery.keyOf({ environmentId: ENV, cwd: CWD, query: "abd" });
    expect(searchA).not.toBe(searchB);
  });

  it("collapses queries that normalize to the same request onto one key", () => {
    expect(projectSearchEntriesQuery.keyOf({ environmentId: ENV, cwd: CWD, query: "  Btn " })).toBe(
      projectSearchEntriesQuery.keyOf({ environmentId: ENV, cwd: CWD, query: "Btn" }),
    );
  });

  it("has no key while a query is unusable", () => {
    expect(projectListEntriesQuery.keyOf({ environmentId: ENV, cwd: null })).toBeNull();
    expect(projectListEntriesQuery.keyOf({ environmentId: null, cwd: CWD })).toBeNull();
    expect(
      projectListEntriesQuery.keyOf({ environmentId: ENV, cwd: CWD, enabled: false }),
    ).toBeNull();
    expect(
      projectReadFileQuery.keyOf({ environmentId: ENV, cwd: CWD, relativePath: null }),
    ).toBeNull();
    expect(
      projectSearchEntriesQuery.keyOf({ environmentId: ENV, cwd: CWD, query: "   " }),
    ).toBeNull();
  });

  it("keys off the same normalization the screens type into", () => {
    expect(normalizeWorkspaceFileSearchQuery("  Button  ")).toBe("Button");
    expect(normalizeWorkspaceFileSearchQuery("   ")).toBe("");
    expect(normalizeWorkspaceFileSearchQuery("x".repeat(400))).toHaveLength(
      WORKSPACE_FILE_SEARCH_QUERY_MAX_LENGTH,
    );
  });
});

describe("projectFilesAtoms fetching", () => {
  it("caches each workspace root separately", async () => {
    const listEntries = vi.fn(async (request: { cwd: string }) =>
      listResult(`${request.cwd}/a.ts`),
    );
    setProjectsApi(ENV, { listEntries });

    const first = { environmentId: ENV, cwd: CWD };
    const second = { environmentId: ENV, cwd: "/work/other" };
    const releaseFirst = projectListEntriesQuery.watch(first);
    const releaseSecond = projectListEntriesQuery.watch(second);

    await vi.waitFor(() => {
      expect(listedPath(projectListEntriesQuery.keyOf(first))).toBe(`${CWD}/a.ts`);
      expect(listedPath(projectListEntriesQuery.keyOf(second))).toBe("/work/other/a.ts");
    });
    expect(listEntries).toHaveBeenCalledTimes(2);

    releaseFirst();
    releaseSecond();
  });

  it("only searches once the raw query normalizes to a real request", async () => {
    const searchEntries = vi.fn(async () => ({ entries: [], truncated: false }));
    setProjectsApi(ENV, { searchEntries });

    const releaseBlank = projectSearchEntriesQuery.watch({
      environmentId: ENV,
      cwd: CWD,
      query: "   ",
    });
    await flush();
    expect(searchEntries).not.toHaveBeenCalled();
    releaseBlank();

    const release = projectSearchEntriesQuery.watch({
      environmentId: ENV,
      cwd: CWD,
      query: "  Button  ",
    });
    await vi.waitFor(() => expect(searchEntries).toHaveBeenCalledTimes(1));
    expect(searchEntries).toHaveBeenCalledWith({
      cwd: CWD,
      query: "Button",
      limit: WORKSPACE_FILE_SEARCH_LIMIT,
    });
    release();
  });

  it("clamps a caller-supplied limit to the contract's 200 maximum", async () => {
    const searchEntries = vi.fn(async () => ({ entries: [], truncated: true }));
    setProjectsApi(ENV, { searchEntries });

    const release = projectSearchEntriesQuery.watch({
      environmentId: ENV,
      cwd: CWD,
      query: "Button",
      limit: 500,
    });
    await vi.waitFor(() => expect(searchEntries).toHaveBeenCalledTimes(1));
    expect(searchEntries).toHaveBeenCalledWith({ cwd: CWD, query: "Button", limit: 200 });
    release();
  });

  it("retries a failed request once before giving up", async () => {
    const listEntries = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValue(listResult("recovered.ts"));
    setProjectsApi(ENV, { listEntries });

    const input = { environmentId: ENV, cwd: CWD };
    const release = projectListEntriesQuery.watch(input);
    await vi.waitFor(() =>
      expect(listedPath(projectListEntriesQuery.keyOf(input))).toBe("recovered.ts"),
    );
    expect(listEntries).toHaveBeenCalledTimes(2);
    release();
  });

  it("surfaces the node's preview refusal verbatim so the screen can classify it", async () => {
    const messagesByPath: Record<string, string> = {
      "big.bin": "File is too large to preview (999999 bytes). Limit is 524288 bytes.",
      "image.psd": "Binary files cannot be previewed.",
      "latin.txt": "Only UTF-8 text files can be previewed.",
      "gone.ts": "ENOENT: no such file or directory, open 'gone.ts'",
    };
    const readFile = vi.fn(async (request: { relativePath: string }) => {
      throw new Error(messagesByPath[request.relativePath]);
    });
    setProjectsApi(ENV, { readFile });

    for (const [relativePath, message] of Object.entries(messagesByPath)) {
      const input = { environmentId: ENV, cwd: CWD, relativePath };
      const release = projectReadFileQuery.watch(input);
      const cacheKey = projectReadFileQuery.keyOf(input);
      await vi.waitFor(() =>
        expect(projectReadFileQuery.getSnapshot(cacheKey).error).toBeInstanceOf(Error),
      );
      expect(projectReadFileQuery.getSnapshot(cacheKey).error?.message).toBe(message);
      expect(projectReadFileQuery.getSnapshot(cacheKey).data).toBeNull();
      release();
    }
  });
});

describe("projectFilesAtoms invalidation", () => {
  it("refetches an observed query and drops the response it raced", async () => {
    const first = deferred<ProjectListEntriesResult>();
    const second = deferred<ProjectListEntriesResult>();
    const pending = [first, second];
    const listEntries = vi.fn(() => pending.shift()!.promise);
    setProjectsApi(ENV, { listEntries });

    const input = { environmentId: ENV, cwd: CWD };
    const cacheKey = projectListEntriesQuery.keyOf(input);
    const release = projectListEntriesQuery.watch(input);
    await vi.waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));

    invalidateProjectFilesState();
    await vi.waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));

    second.resolve(listResult("current.ts"));
    await vi.waitFor(() => expect(listedPath(cacheKey)).toBe("current.ts"));

    // The pre-invalidation fetch answers late; its fetchToken is stale.
    first.resolve(listResult("stale.ts"));
    await flush();
    expect(listedPath(cacheKey)).toBe("current.ts");

    release();
  });

  it("leaves an idle query stale so the next observer refetches", async () => {
    let call = 0;
    const listEntries = vi.fn(async () => listResult(`call-${++call}.ts`));
    setProjectsApi(ENV, { listEntries });

    const input = { environmentId: ENV, cwd: CWD };
    const cacheKey = projectListEntriesQuery.keyOf(input);
    const release = projectListEntriesQuery.watch(input);
    await vi.waitFor(() => expect(listedPath(cacheKey)).toBe("call-1.ts"));
    release();

    // Inside staleTime and with no invalidation, a fresh observer reuses the
    // cached listing.
    const releaseCached = projectListEntriesQuery.watch(input);
    await flush();
    expect(listEntries).toHaveBeenCalledTimes(1);
    releaseCached();

    invalidateProjectFilesState();
    expect(listEntries).toHaveBeenCalledTimes(1);

    const releaseAfterInvalidation = projectListEntriesQuery.watch(input);
    await vi.waitFor(() => expect(listedPath(cacheKey)).toBe("call-2.ts"));
    releaseAfterInvalidation();
  });
});

describe("projectFilesAtoms environment teardown", () => {
  it("drops one environment's cached workspace state and keeps the other's", async () => {
    setProjectsApi(ENV, { listEntries: vi.fn(async () => listResult("a.ts")) });
    setProjectsApi(OTHER_ENV, { listEntries: vi.fn(async () => listResult("b.ts")) });

    const removed = { environmentId: ENV, cwd: CWD };
    const kept = { environmentId: OTHER_ENV, cwd: CWD };
    const releaseRemoved = projectListEntriesQuery.watch(removed);
    const releaseKept = projectListEntriesQuery.watch(kept);
    await vi.waitFor(() => {
      expect(listedPath(projectListEntriesQuery.keyOf(removed))).toBe("a.ts");
      expect(listedPath(projectListEntriesQuery.keyOf(kept))).toBe("b.ts");
    });

    clearProjectFilesStateForEnvironment(ENV);

    expect(
      projectListEntriesQuery.getSnapshot(projectListEntriesQuery.keyOf(removed)).data,
    ).toBeNull();
    expect(listedPath(projectListEntriesQuery.keyOf(kept))).toBe("b.ts");

    releaseRemoved();
    releaseKept();
  });

  it("clears again after the same node is re-paired and re-cached", async () => {
    setProjectsApi(ENV, { listEntries: vi.fn(async () => listResult("a.ts")) });
    const input = { environmentId: ENV, cwd: CWD };
    const cacheKey = projectListEntriesQuery.keyOf(input);

    // The registry stops tracking a key it clears, and its state atom is
    // memoized per key — so a second teardown is the case that would quietly
    // leave the re-cached listing behind.
    for (const _pass of [0, 1]) {
      const release = projectListEntriesQuery.watch(input);
      await vi.waitFor(() => expect(listedPath(cacheKey)).toBe("a.ts"));
      clearProjectFilesStateForEnvironment(ENV);
      release();
      expect(projectListEntriesQuery.getSnapshot(cacheKey).data).toBeNull();
    }
  });

  it("never publishes a result owned by a torn-down connection", async () => {
    const inFlight = deferred<ProjectListEntriesResult>();
    setProjectsApi(ENV, { listEntries: vi.fn(() => inFlight.promise) });

    const input = { environmentId: ENV, cwd: CWD };
    const cacheKey = projectListEntriesQuery.keyOf(input);
    const release = projectListEntriesQuery.watch(input);
    await flush();

    // The node was forgotten and re-paired: a new client owns this environment
    // id before the old one answers.
    clearProjectFilesStateForEnvironment(ENV);
    setProjectsApi(ENV, { listEntries: vi.fn(async () => listResult("fresh.ts")) });

    inFlight.resolve(listResult("from-dead-client.ts"));
    await flush();
    expect(projectListEntriesQuery.getSnapshot(cacheKey).data).toBeNull();

    release();
  });
});

describe("projectFilesAtoms retained-key budget", () => {
  async function watchAndRelease(cwd: string): Promise<string | null> {
    const input = { environmentId: ENV, cwd };
    const cacheKey = projectListEntriesQuery.keyOf(input);
    const release = projectListEntriesQuery.watch(input);
    await vi.waitFor(() => expect(listedPath(cacheKey)).toBe(`${cwd}/a.ts`));
    release();
    return cacheKey;
  }

  beforeEach(() => {
    setProjectsApi(ENV, {
      listEntries: vi.fn(async (request: { cwd: string }) => listResult(`${request.cwd}/a.ts`)),
    });
  });

  it("evicts released keys past the cap in least-recently-released order", async () => {
    const cacheKeys: Array<string | null> = [];
    for (let index = 0; index <= PROJECT_LIST_ENTRIES_RETAINED_KEY_LIMIT; index += 1) {
      cacheKeys.push(await watchAndRelease(`/work/${index}`));
    }

    expect(projectListEntriesQuery.getSnapshot(cacheKeys[0] ?? null).data).toBeNull();
    for (const cacheKey of cacheKeys.slice(1)) {
      expect(projectListEntriesQuery.getSnapshot(cacheKey).data).not.toBeNull();
    }
  });

  it("never evicts a key that still has an observer", async () => {
    const held = { environmentId: ENV, cwd: "/work/held" };
    const heldKey = projectListEntriesQuery.keyOf(held);
    const releaseHeld = projectListEntriesQuery.watch(held);
    await vi.waitFor(() => expect(listedPath(heldKey)).toBe("/work/held/a.ts"));

    for (let index = 0; index <= PROJECT_LIST_ENTRIES_RETAINED_KEY_LIMIT + 1; index += 1) {
      await watchAndRelease(`/work/${index}`);
    }

    expect(listedPath(heldKey)).toBe("/work/held/a.ts");
    releaseHeld();
  });

  it("takes a re-watched key back out of the eviction queue", async () => {
    const revisited = { environmentId: ENV, cwd: "/work/revisited" };
    const revisitedKey = projectListEntriesQuery.keyOf(revisited);
    projectListEntriesQuery.watch(revisited)();
    await vi.waitFor(() => expect(listedPath(revisitedKey)).toBe("/work/revisited/a.ts"));

    const releaseRevisited = projectListEntriesQuery.watch(revisited);
    for (let index = 0; index <= PROJECT_LIST_ENTRIES_RETAINED_KEY_LIMIT; index += 1) {
      await watchAndRelease(`/work/${index}`);
    }

    expect(listedPath(revisitedKey)).toBe("/work/revisited/a.ts");
    releaseRevisited();
  });
});
