import {
  AtlassianConnectionId,
  EnvironmentId,
  ProjectId,
  type WorkItemDetail as WorkItemDetailModel,
  type WorkItemProject,
  type WorkItemSummary,
} from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { listSpy, searchSpy, getSpy, listProjectsSpy } = vi.hoisted(() => ({
  listSpy: vi.fn(),
  searchSpy: vi.fn(),
  getSpy: vi.fn(),
  listProjectsSpy: vi.fn(),
}));

vi.mock("~/environments/runtime", () => ({
  requireEnvironmentConnection: vi.fn(() => ({
    client: {
      workItems: {
        list: listSpy,
        search: searchSpy,
        get: getSpy,
        listProjects: listProjectsSpy,
      },
    },
  })),
}));

import { resetAppAtomRegistryForTests } from "@ryco/client-runtime/rpc";
import {
  invalidateWorkItems,
  resetWorkItemsAtomsForTests,
  setWorkItemDetailCache,
  workItemDetailQuery,
  workItemListQuery,
  workItemProjectsQuery,
  workItemSearchQuery,
} from "./workItemsAtoms";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-other");
const PROJECT_ID = ProjectId.make("project-a");
const OTHER_PROJECT_ID = ProjectId.make("project-b");
const CONNECTION_ID = AtlassianConnectionId.make("connection-1");

function summary(key: string): WorkItemSummary {
  return { provider: "jira", key, title: key } as unknown as WorkItemSummary;
}

function detail(key: string): WorkItemDetailModel {
  return { provider: "jira", key, title: key } as unknown as WorkItemDetailModel;
}

function project(key: string): WorkItemProject {
  return { key, name: key } as unknown as WorkItemProject;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetWorkItemsAtomsForTests();
  resetAppAtomRegistryForTests();
  listSpy.mockReset();
  searchSpy.mockReset();
  getSpy.mockReset();
  listProjectsSpy.mockReset();
});

describe("workItemListQuery", () => {
  it("does not produce a cache key when disabled or incomplete", () => {
    expect(
      workItemListQuery.keyOf({ environmentId: null, projectId: PROJECT_ID, state: "open" }),
    ).toBeNull();
    expect(
      workItemListQuery.keyOf({ environmentId: ENVIRONMENT_ID, projectId: null, state: "open" }),
    ).toBeNull();
    expect(
      workItemListQuery.keyOf({
        environmentId: ENVIRONMENT_ID,
        projectId: PROJECT_ID,
        state: "open",
        enabled: false,
      }),
    ).toBeNull();
  });

  it("loads the list when watched and exposes the resolved snapshot", async () => {
    const deferred = createDeferred<ReadonlyArray<WorkItemSummary>>();
    listSpy.mockReturnValueOnce(deferred.promise);

    const input = { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID, state: "open" as const };
    const key = workItemListQuery.keyOf(input);
    const release = workItemListQuery.watch(input);
    await flush();

    expect(listSpy).toHaveBeenCalledWith({ projectId: PROJECT_ID, state: "open" });
    expect(workItemListQuery.getSnapshot(key)).toMatchObject({ isLoading: true, isFetching: true });

    const items = [summary("PROJ-1")];
    deferred.resolve(items);
    await flush();

    expect(workItemListQuery.getSnapshot(key)).toEqual({
      data: items,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });

    release();
  });

  it("captures fetch errors while keeping prior data", async () => {
    const first = createDeferred<ReadonlyArray<WorkItemSummary>>();
    listSpy.mockReturnValueOnce(first.promise);
    const input = { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID, state: "open" as const };
    const key = workItemListQuery.keyOf(input);
    const release = workItemListQuery.watch(input);
    await flush();
    const items = [summary("PROJ-1")];
    first.resolve(items);
    await flush();

    const second = createDeferred<ReadonlyArray<WorkItemSummary>>();
    listSpy.mockReturnValueOnce(second.promise);
    workItemListQuery.refresh(key);
    await flush();
    second.reject(new Error("boom"));
    await flush();

    const snapshot = workItemListQuery.getSnapshot(key);
    expect(snapshot.data).toBe(items);
    expect(snapshot.isError).toBe(true);
    expect(snapshot.error?.message).toBe("boom");

    release();
  });

  it("refetches stale data when re-watched past the stale time", async () => {
    listSpy.mockResolvedValueOnce([summary("PROJ-1")]);
    const input = { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID, state: "open" as const };
    const release = workItemListQuery.watch(input);
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(1);
    release();

    vi.advanceTimersByTime(61_000);
    listSpy.mockResolvedValueOnce([summary("PROJ-2")]);
    const release2 = workItemListQuery.watch(input);
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(2);
    release2();
  });
});

describe("invalidateWorkItems", () => {
  it("refetches a mounted list scoped to the matching project", async () => {
    listSpy.mockResolvedValue([summary("PROJ-1")]);
    const input = { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID, state: "open" as const };
    const release = workItemListQuery.watch(input);
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(1);

    invalidateWorkItems({ environmentId: ENVIRONMENT_ID, projectId: OTHER_PROJECT_ID });
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(1);

    invalidateWorkItems({ environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID });
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(2);

    release();
  });

  it("invalidates every project for the environment when projectId is omitted", async () => {
    listSpy.mockResolvedValue([summary("PROJ-1")]);
    const releaseA = workItemListQuery.watch({
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      state: "open",
    });
    const releaseB = workItemListQuery.watch({
      environmentId: ENVIRONMENT_ID,
      projectId: OTHER_PROJECT_ID,
      state: "open",
    });
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(2);

    invalidateWorkItems({ environmentId: ENVIRONMENT_ID });
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(4);

    releaseA();
    releaseB();
  });

  it("does not cross environments", async () => {
    listSpy.mockResolvedValue([summary("PROJ-1")]);
    const release = workItemListQuery.watch({
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      state: "open",
    });
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(1);

    invalidateWorkItems({ environmentId: OTHER_ENVIRONMENT_ID });
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(1);

    release();
  });
});

describe("workItemSearchQuery", () => {
  it("is disabled until a non-empty query is provided", () => {
    expect(
      workItemSearchQuery.keyOf({
        environmentId: ENVIRONMENT_ID,
        projectId: PROJECT_ID,
        query: "   ",
      }),
    ).toBeNull();
    expect(
      workItemSearchQuery.keyOf({
        environmentId: ENVIRONMENT_ID,
        projectId: PROJECT_ID,
        query: "bug",
      }),
    ).not.toBeNull();
  });

  it("trims the query before fetching", async () => {
    searchSpy.mockResolvedValueOnce([summary("PROJ-9")]);
    const input = {
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      query: "  login  ",
      limit: 50,
    };
    const release = workItemSearchQuery.watch(input);
    await flush();
    expect(searchSpy).toHaveBeenCalledWith({ projectId: PROJECT_ID, query: "login", limit: 50 });
    release();
  });
});

describe("workItemDetailQuery", () => {
  it("fetches the detail and supports imperative cache seeding", async () => {
    getSpy.mockResolvedValueOnce(detail("PROJ-1"));
    const input = {
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      key: "PROJ-1",
      fullContent: true,
    };
    const key = workItemDetailQuery.keyOf(input);
    const release = workItemDetailQuery.watch(input);
    await flush();
    expect(getSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      key: "PROJ-1",
      fullContent: true,
    });

    const seeded = detail("PROJ-1-edited");
    setWorkItemDetailCache(
      { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID },
      "PROJ-1",
      seeded,
    );
    expect(workItemDetailQuery.getSnapshot(key).data).toBe(seeded);

    release();
  });
});

describe("workItemProjectsQuery", () => {
  it("omits the site URL when blank and includes it when present", async () => {
    listProjectsSpy.mockResolvedValueOnce([project("WEB")]);
    const release = workItemProjectsQuery.watch({
      environmentId: ENVIRONMENT_ID,
      connectionId: CONNECTION_ID,
      siteUrl: "  ",
    });
    await flush();
    expect(listProjectsSpy).toHaveBeenLastCalledWith({ connectionId: CONNECTION_ID });
    release();

    listProjectsSpy.mockResolvedValueOnce([project("WEB")]);
    const release2 = workItemProjectsQuery.watch({
      environmentId: ENVIRONMENT_ID,
      connectionId: CONNECTION_ID,
      siteUrl: "https://example.atlassian.net",
    });
    await flush();
    expect(listProjectsSpy).toHaveBeenLastCalledWith({
      connectionId: CONNECTION_ID,
      siteUrl: "https://example.atlassian.net",
    });
    release2();
  });
});
