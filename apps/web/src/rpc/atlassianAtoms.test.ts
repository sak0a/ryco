import {
  type AtlassianConnectionSummary,
  type AtlassianProjectLink,
  EnvironmentId,
  ProjectId,
} from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { listConnectionsSpy, getProjectLinkSpy } = vi.hoisted(() => ({
  listConnectionsSpy: vi.fn(),
  getProjectLinkSpy: vi.fn(),
}));

vi.mock("~/environments/runtime", () => ({
  requireEnvironmentConnection: vi.fn(() => ({
    client: {
      atlassian: {
        listConnections: listConnectionsSpy,
        getProjectLink: getProjectLinkSpy,
      },
    },
  })),
}));

import {
  atlassianConnectionsQuery,
  atlassianProjectLinkQuery,
  invalidateAtlassian,
  resetAtlassianAtomsForTests,
} from "./atlassianAtoms";
import { resetAppAtomRegistryForTests } from "./atomRegistry";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-other");
const PROJECT_ID = ProjectId.make("project-a");

function connection(id: string): AtlassianConnectionSummary {
  return { connectionId: id, label: id } as unknown as AtlassianConnectionSummary;
}

function projectLink(): AtlassianProjectLink {
  return { jiraProjectKeys: [] } as unknown as AtlassianProjectLink;
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
  resetAtlassianAtomsForTests();
  resetAppAtomRegistryForTests();
  listConnectionsSpy.mockReset();
  getProjectLinkSpy.mockReset();
});

describe("atlassianConnectionsQuery", () => {
  it("does not produce a cache key when disabled or incomplete", () => {
    expect(atlassianConnectionsQuery.keyOf({ environmentId: null })).toBeNull();
    expect(
      atlassianConnectionsQuery.keyOf({ environmentId: ENVIRONMENT_ID, enabled: false }),
    ).toBeNull();
    expect(atlassianConnectionsQuery.keyOf({ environmentId: ENVIRONMENT_ID })).not.toBeNull();
  });

  it("loads connections when watched and exposes the resolved snapshot", async () => {
    const deferred = createDeferred<ReadonlyArray<AtlassianConnectionSummary>>();
    listConnectionsSpy.mockReturnValueOnce(deferred.promise);

    const input = { environmentId: ENVIRONMENT_ID };
    const key = atlassianConnectionsQuery.keyOf(input);
    const release = atlassianConnectionsQuery.watch(input);
    await flush();

    expect(listConnectionsSpy).toHaveBeenCalledTimes(1);
    expect(atlassianConnectionsQuery.getSnapshot(key)).toMatchObject({
      isLoading: true,
      isFetching: true,
    });

    const items = [connection("c-1")];
    deferred.resolve(items);
    await flush();

    expect(atlassianConnectionsQuery.getSnapshot(key)).toEqual({
      data: items,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });

    release();
  });

  it("captures fetch errors while keeping prior data", async () => {
    const first = createDeferred<ReadonlyArray<AtlassianConnectionSummary>>();
    listConnectionsSpy.mockReturnValueOnce(first.promise);
    const input = { environmentId: ENVIRONMENT_ID };
    const key = atlassianConnectionsQuery.keyOf(input);
    const release = atlassianConnectionsQuery.watch(input);
    await flush();
    const items = [connection("c-1")];
    first.resolve(items);
    await flush();

    const second = createDeferred<ReadonlyArray<AtlassianConnectionSummary>>();
    listConnectionsSpy.mockReturnValueOnce(second.promise);
    atlassianConnectionsQuery.refresh(key);
    await flush();
    second.reject(new Error("boom"));
    await flush();

    const snapshot = atlassianConnectionsQuery.getSnapshot(key);
    expect(snapshot.data).toBe(items);
    expect(snapshot.isError).toBe(true);
    expect(snapshot.error?.message).toBe("boom");

    release();
  });

  it("refetches on every re-watch because connections never go stale", async () => {
    listConnectionsSpy.mockResolvedValue([connection("c-1")]);
    const input = { environmentId: ENVIRONMENT_ID };
    const release = atlassianConnectionsQuery.watch(input);
    await flush();
    expect(listConnectionsSpy).toHaveBeenCalledTimes(1);
    release();

    const release2 = atlassianConnectionsQuery.watch(input);
    await flush();
    expect(listConnectionsSpy).toHaveBeenCalledTimes(2);
    release2();
  });
});

describe("atlassianProjectLinkQuery", () => {
  it("is disabled until both environment and project are provided", () => {
    expect(
      atlassianProjectLinkQuery.keyOf({ environmentId: ENVIRONMENT_ID, projectId: null }),
    ).toBeNull();
    expect(
      atlassianProjectLinkQuery.keyOf({ environmentId: null, projectId: PROJECT_ID }),
    ).toBeNull();
    expect(
      atlassianProjectLinkQuery.keyOf({ environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID }),
    ).not.toBeNull();
  });

  it("fetches the project link for the scoped project", async () => {
    getProjectLinkSpy.mockResolvedValueOnce(projectLink());
    const input = { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID };
    const release = atlassianProjectLinkQuery.watch(input);
    await flush();
    expect(getProjectLinkSpy).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    release();
  });
});

describe("invalidateAtlassian", () => {
  it("refetches mounted reads and is scoped by environment", async () => {
    listConnectionsSpy.mockResolvedValue([connection("c-1")]);
    const release = atlassianConnectionsQuery.watch({ environmentId: ENVIRONMENT_ID });
    await flush();
    expect(listConnectionsSpy).toHaveBeenCalledTimes(1);

    invalidateAtlassian({ environmentId: OTHER_ENVIRONMENT_ID });
    await flush();
    expect(listConnectionsSpy).toHaveBeenCalledTimes(1);

    invalidateAtlassian({ environmentId: ENVIRONMENT_ID });
    await flush();
    expect(listConnectionsSpy).toHaveBeenCalledTimes(2);

    invalidateAtlassian();
    await flush();
    expect(listConnectionsSpy).toHaveBeenCalledTimes(3);

    release();
  });
});
