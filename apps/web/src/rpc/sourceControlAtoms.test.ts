import { EnvironmentId } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  listIssues,
  listChangeRequests,
  searchIssues,
  searchChangeRequests,
  listIssueLabels,
  listIssueAssignees,
  getIssue,
  getChangeRequestDetail,
} = vi.hoisted(() => ({
  listIssues: vi.fn(),
  listChangeRequests: vi.fn(),
  searchIssues: vi.fn(),
  searchChangeRequests: vi.fn(),
  listIssueLabels: vi.fn(),
  listIssueAssignees: vi.fn(),
  getIssue: vi.fn(),
  getChangeRequestDetail: vi.fn(),
}));

vi.mock("~/environments/runtime", () => ({
  requireEnvironmentConnection: vi.fn(() => ({
    client: {
      sourceControl: {
        listIssues,
        listChangeRequests,
        searchIssues,
        searchChangeRequests,
        listIssueLabels,
        listIssueAssignees,
        getIssue,
        getChangeRequestDetail,
      },
    },
  })),
}));

import {
  changeRequestListBinding,
  fetchSourceControlChangeRequestDetail,
  fetchSourceControlIssueDetail,
  invalidateSourceControl,
  issueListBinding,
  issueSearchBinding,
  resetSourceControlAtomsForTests,
} from "./sourceControlAtoms";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-other");
const CWD = "/tmp/workspace";
const OTHER_CWD = "/tmp/other";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function issue(number: number) {
  return {
    provider: "github",
    number,
    title: `Issue ${number}`,
    url: `https://example.test/issues/${number}`,
    state: "open",
  } as never;
}

function changeRequest(number: number) {
  return {
    provider: "github",
    number,
    title: `Pull request ${number}`,
    url: `https://example.test/pull/${number}`,
    state: "open",
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetSourceControlAtomsForTests();
});

afterEach(() => {
  vi.useRealTimers();
  resetSourceControlAtomsForTests();
});

describe("sourceControlAtoms — issue list", () => {
  it("does not fetch when the environment or cwd is missing or disabled", () => {
    issueListBinding.watch({ environmentId: null, cwd: CWD, state: "open" });
    issueListBinding.watch({ environmentId: ENVIRONMENT_ID, cwd: null, state: "open" });
    issueListBinding.watch({
      environmentId: ENVIRONMENT_ID,
      cwd: CWD,
      state: "open",
      enabled: false,
    });

    expect(listIssues).not.toHaveBeenCalled();
  });

  it("marks the first watch as loading and commits the resolved result", async () => {
    const deferred = createDeferred<unknown>();
    listIssues.mockReturnValueOnce(deferred.promise);

    const input = { environmentId: ENVIRONMENT_ID, cwd: CWD, state: "open" as const };
    const release = issueListBinding.watch(input);
    await flush();

    expect(listIssues).toHaveBeenCalledWith({ cwd: CWD, state: "open" });
    expect(issueListBinding.snapshotFor(input)).toEqual({
      data: null,
      isLoading: true,
      isFetching: true,
      error: null,
    });

    const data = [issue(1)];
    deferred.resolve(data);
    await flush();

    expect(issueListBinding.snapshotFor(input)).toEqual({
      data,
      isLoading: false,
      isFetching: false,
      error: null,
    });

    release();
  });

  it("dedupes concurrent watchers of the same scope", async () => {
    listIssues.mockReturnValue(createDeferred<unknown>().promise);

    const input = { environmentId: ENVIRONMENT_ID, cwd: CWD, state: "open" as const };
    const releaseA = issueListBinding.watch(input);
    const releaseB = issueListBinding.watch(input);
    await flush();

    expect(listIssues).toHaveBeenCalledTimes(1);
    releaseA();
    releaseB();
  });

  it("surfaces errors while keeping any previously committed data", async () => {
    const first = createDeferred<unknown>();
    listIssues.mockReturnValueOnce(first.promise);
    const input = { environmentId: ENVIRONMENT_ID, cwd: CWD, state: "open" as const };
    const release = issueListBinding.watch(input);
    await flush();
    const firstData = [issue(1)];
    first.resolve(firstData);
    await flush();

    vi.advanceTimersByTime(61_000);
    const second = createDeferred<unknown>();
    listIssues.mockReturnValueOnce(second.promise);
    invalidateSourceControl({ cwd: CWD });
    await flush();
    second.reject(new Error("boom"));
    await flush();

    const state = issueListBinding.snapshotFor(input);
    expect(state.data).toBe(firstData);
    expect(state.error).toEqual(new Error("boom"));
    expect(state.isFetching).toBe(false);

    release();
  });
});

describe("sourceControlAtoms — issue search gating", () => {
  it("only fetches when a non-empty query and enabled flag are present", async () => {
    issueSearchBinding.watch({ environmentId: ENVIRONMENT_ID, cwd: CWD, query: "" });
    issueSearchBinding.watch({
      environmentId: ENVIRONMENT_ID,
      cwd: CWD,
      query: "bug",
      enabled: false,
    });
    await flush();
    expect(searchIssues).not.toHaveBeenCalled();

    searchIssues.mockReturnValueOnce(Promise.resolve([issue(5)]));
    const release = issueSearchBinding.watch({
      environmentId: ENVIRONMENT_ID,
      cwd: CWD,
      query: "bug",
      enabled: true,
    });
    await flush();
    expect(searchIssues).toHaveBeenCalledWith({ cwd: CWD, query: "bug" });
    release();
  });
});

describe("sourceControlAtoms — change request list polling", () => {
  it("passes fetched data rather than query state into poll interval resolvers", async () => {
    const data = [changeRequest(1)];
    listChangeRequests.mockResolvedValue(data);
    const resolveIntervalMs = vi.fn((items: ReadonlyArray<unknown> | null) =>
      items?.some(() => false) ? 30_000 : false,
    );

    const input = { environmentId: ENVIRONMENT_ID, cwd: CWD, state: "open" as const };
    const release = changeRequestListBinding.watch(input, resolveIntervalMs);
    await flush();

    expect(listChangeRequests).toHaveBeenCalledWith({ cwd: CWD, state: "open" });
    expect(resolveIntervalMs).toHaveBeenCalledWith(data);
    expect(changeRequestListBinding.snapshotFor(input).data).toBe(data);

    release();
  });
});

describe("sourceControlAtoms — invalidation", () => {
  it("refetches mounted scopes for the matching cwd and leaves others untouched", async () => {
    listIssues.mockResolvedValue([issue(1)]);
    listChangeRequests.mockResolvedValue([]);

    const releaseTarget = issueListBinding.watch({
      environmentId: ENVIRONMENT_ID,
      cwd: CWD,
      state: "open",
    });
    const releaseOther = issueListBinding.watch({
      environmentId: ENVIRONMENT_ID,
      cwd: OTHER_CWD,
      state: "open",
    });
    await flush();
    expect(listIssues).toHaveBeenCalledTimes(2);
    listIssues.mockClear();

    invalidateSourceControl({ cwd: CWD });
    await flush();

    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(listIssues).toHaveBeenCalledWith({ cwd: CWD, state: "open" });

    releaseTarget();
    releaseOther();
  });
});

describe("sourceControlAtoms — detail fetches", () => {
  it("caches issue detail within the stale window and dedupes in-flight requests", async () => {
    const deferred = createDeferred<unknown>();
    getIssue.mockReturnValueOnce(deferred.promise);

    const params = { environmentId: ENVIRONMENT_ID, cwd: CWD, reference: "42" };
    const first = fetchSourceControlIssueDetail(params);
    const second = fetchSourceControlIssueDetail(params);
    expect(getIssue).toHaveBeenCalledTimes(1);

    const detail = { id: "42" } as never;
    deferred.resolve(detail);
    await expect(first).resolves.toBe(detail);
    await expect(second).resolves.toBe(detail);

    await expect(fetchSourceControlIssueDetail(params)).resolves.toBe(detail);
    expect(getIssue).toHaveBeenCalledTimes(1);
  });

  it("re-fetches issue detail after invalidation clears the cache", async () => {
    getIssue
      .mockResolvedValueOnce({ id: "a" } as never)
      .mockResolvedValueOnce({ id: "b" } as never);
    const params = { environmentId: ENVIRONMENT_ID, cwd: CWD, reference: "42" };

    await fetchSourceControlIssueDetail(params);
    expect(getIssue).toHaveBeenCalledTimes(1);

    invalidateSourceControl({ environmentId: ENVIRONMENT_ID, cwd: CWD });

    await fetchSourceControlIssueDetail(params);
    expect(getIssue).toHaveBeenCalledTimes(2);
  });

  it("rejects detail lookups for incomplete targets", async () => {
    await expect(
      fetchSourceControlChangeRequestDetail({ environmentId: null, cwd: CWD, reference: "1" }),
    ).rejects.toThrow("Change request detail is unavailable.");
    expect(getChangeRequestDetail).not.toHaveBeenCalled();
  });

  it("scopes detail invalidation by environment", async () => {
    getIssue.mockResolvedValue({ id: "x" } as never);
    const params = { environmentId: ENVIRONMENT_ID, cwd: CWD, reference: "7" };
    await fetchSourceControlIssueDetail(params);
    expect(getIssue).toHaveBeenCalledTimes(1);

    // Invalidating a different environment must not drop this entry.
    invalidateSourceControl({ environmentId: OTHER_ENVIRONMENT_ID });
    await fetchSourceControlIssueDetail(params);
    expect(getIssue).toHaveBeenCalledTimes(1);
  });
});
