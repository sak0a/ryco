import { EnvironmentId } from "@ryco/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const {
  listChangeRequestsSpy,
  getChangeRequestDetailSpy,
  listWorkflowRunsSpy,
  getWorkflowRunJobsSpy,
} = vi.hoisted(() => ({
  listChangeRequestsSpy: vi.fn(),
  getChangeRequestDetailSpy: vi.fn(),
  listWorkflowRunsSpy: vi.fn(),
  getWorkflowRunJobsSpy: vi.fn(),
}));

vi.mock("../environments/runtime", () => ({
  requireEnvironmentConnection: () => ({
    client: {
      sourceControl: {
        listChangeRequests: listChangeRequestsSpy,
        getChangeRequestDetail: getChangeRequestDetailSpy,
        listWorkflowRuns: listWorkflowRunsSpy,
        getWorkflowRunJobs: getWorkflowRunJobsSpy,
      },
    },
  }),
}));

import { appAtomRegistry, resetAppAtomRegistryForTests } from "./atomRegistry";
import { invalidateScopes, resetGitAtomsForTests } from "./gitAtoms";
import {
  getOverviewChangeRequestDetailSnapshot,
  getOverviewChangeRequestListSnapshot,
  getOverviewWorkflowRunJobsAtom,
  getOverviewWorkflowRunJobsKey,
  getOverviewWorkflowRunsKey,
  getOverviewWorkflowRunsSnapshot,
  invalidateOverviewSourceControl,
  resetOverviewAtomsForTests,
  selectOverviewWorkflowRunJobs,
  sourceControlScopeKey,
  watchOverviewChangeRequestDetail,
  watchOverviewChangeRequestList,
  watchOverviewWorkflowRunJobs,
  watchOverviewWorkflowRuns,
  type WorkflowRunJobsEntry,
} from "./overviewAtoms";

const ENVIRONMENT = EnvironmentId.make("environment-a");

async function flush(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  resetOverviewAtomsForTests();
  resetGitAtomsForTests();
  resetAppAtomRegistryForTests();
  listChangeRequestsSpy.mockReset();
  getChangeRequestDetailSpy.mockReset();
  listWorkflowRunsSpy.mockReset();
  getWorkflowRunJobsSpy.mockReset();
});

describe("scope key", () => {
  it("namespaces source-control invalidation per cwd", () => {
    expect(sourceControlScopeKey("/repo")).toBe("sourcecontrol:/repo");
    expect(sourceControlScopeKey(null)).toBe("sourcecontrol:");
  });
});

describe("change request list", () => {
  it("fetches the open change requests for the watched target", async () => {
    const changeRequests = [{ number: 7, headRefName: "feature" }];
    listChangeRequestsSpy.mockResolvedValue(changeRequests);
    const target = { environmentId: ENVIRONMENT, cwd: "/repo", enabled: true };

    const release = watchOverviewChangeRequestList(target);
    await flush();

    expect(listChangeRequestsSpy).toHaveBeenCalledWith({
      cwd: "/repo",
      state: "open",
      limit: 50,
    });
    const snapshot = getOverviewChangeRequestListSnapshot(target);
    expect(snapshot.data).toEqual(changeRequests);
    expect(snapshot.isLoading).toBe(false);

    release();
  });

  it("does not fetch while disabled and exposes an empty snapshot", async () => {
    const target = { environmentId: ENVIRONMENT, cwd: "/repo", enabled: false };
    const release = watchOverviewChangeRequestList(target);
    await flush();

    expect(listChangeRequestsSpy).not.toHaveBeenCalled();
    expect(getOverviewChangeRequestListSnapshot(target).data).toBeNull();

    release();
  });

  it("refetches when the source-control scope is invalidated", async () => {
    listChangeRequestsSpy.mockResolvedValue([]);
    const target = { environmentId: ENVIRONMENT, cwd: "/repo", enabled: true };

    const release = watchOverviewChangeRequestList(target);
    await flush();
    listChangeRequestsSpy.mockClear();

    invalidateOverviewSourceControl("/repo");
    await flush();

    expect(listChangeRequestsSpy).toHaveBeenCalledTimes(1);
    release();
  });

  it("keeps invalidation scoped to a single cwd", async () => {
    listChangeRequestsSpy.mockResolvedValue([]);
    const releaseA = watchOverviewChangeRequestList({
      environmentId: ENVIRONMENT,
      cwd: "/repo/a",
      enabled: true,
    });
    const releaseB = watchOverviewChangeRequestList({
      environmentId: ENVIRONMENT,
      cwd: "/repo/b",
      enabled: true,
    });
    await flush();
    listChangeRequestsSpy.mockClear();

    invalidateScopes([sourceControlScopeKey("/repo/a")]);
    await flush();

    expect(listChangeRequestsSpy).toHaveBeenCalledTimes(1);
    expect(listChangeRequestsSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo/a" }));

    releaseA();
    releaseB();
  });
});

describe("change request detail", () => {
  it("resolves a reference detail", async () => {
    const detail = { state: "open", title: "Add feature", provider: "github" };
    getChangeRequestDetailSpy.mockResolvedValue(detail);
    const target = { environmentId: ENVIRONMENT, cwd: "/repo", reference: "7", enabled: true };

    const release = watchOverviewChangeRequestDetail(target);
    await flush();

    expect(getChangeRequestDetailSpy).toHaveBeenCalledWith({ cwd: "/repo", reference: "7" });
    expect(getOverviewChangeRequestDetailSnapshot(target).data).toEqual(detail);

    release();
  });

  it("captures fetch errors while keeping prior data null", async () => {
    getChangeRequestDetailSpy.mockRejectedValue(new Error("not found"));
    const target = { environmentId: ENVIRONMENT, cwd: "/repo", reference: "9", enabled: true };

    const release = watchOverviewChangeRequestDetail(target);
    await flush();

    const snapshot = getOverviewChangeRequestDetailSnapshot(target);
    expect(snapshot.data).toBeNull();
    expect(snapshot.error?.message).toBe("not found");
    expect(snapshot.isLoading).toBe(false);

    release();
  });
});

describe("workflow runs", () => {
  it("fetches runs with the post-push commit and pull request number", async () => {
    const result = { runs: [], headSha: { _tag: "Some", value: "abc" } };
    listWorkflowRunsSpy.mockResolvedValue(result);
    const target = {
      environmentId: ENVIRONMENT,
      cwd: "/repo",
      pullRequestNumber: 12,
      branch: null,
      commitSha: "deadbeef",
      enabled: true,
    };

    const release = watchOverviewWorkflowRuns(target, () => false);
    await flush();

    expect(listWorkflowRunsSpy).toHaveBeenCalledWith({
      cwd: "/repo",
      pullRequestNumber: 12,
      commitSha: "deadbeef",
      limit: 20,
    });
    expect(getOverviewWorkflowRunsSnapshot(target).data).toEqual(result);

    release();
  });

  it("fetches runs scoped to a branch when there is no pull request", async () => {
    const result = { runs: [], headSha: { _tag: "Some", value: "abc" } };
    listWorkflowRunsSpy.mockResolvedValue(result);
    const target = {
      environmentId: ENVIRONMENT,
      cwd: "/repo",
      pullRequestNumber: null,
      branch: "main",
      commitSha: null,
      enabled: true,
    };

    const release = watchOverviewWorkflowRuns(target, () => false);
    await flush();

    expect(listWorkflowRunsSpy).toHaveBeenCalledWith({
      cwd: "/repo",
      branch: "main",
      limit: 20,
    });
    expect(getOverviewWorkflowRunsSnapshot(target).data).toEqual(result);

    release();
  });

  it("does not fetch when neither a pull request nor a branch is set", () => {
    const target = {
      environmentId: ENVIRONMENT,
      cwd: "/repo",
      pullRequestNumber: null,
      branch: null,
      commitSha: null,
      enabled: true,
    };

    expect(getOverviewWorkflowRunsKey(target)).toBeNull();
    const release = watchOverviewWorkflowRuns(target, () => false);
    expect(listWorkflowRunsSpy).not.toHaveBeenCalled();
    release();
  });
});

describe("workflow run jobs", () => {
  it("fetches jobs per run id and exposes them through the selector", async () => {
    getWorkflowRunJobsSpy.mockImplementation(async (input: { runId: string }) => ({
      provider: "github",
      runId: input.runId,
      jobs: [{ jobId: `${input.runId}-job` }],
    }));
    const target = {
      environmentId: ENVIRONMENT,
      cwd: "/repo",
      runIds: ["run-1", "run-2"],
      activeRunId: "run-1",
      enabled: true,
    };

    const release = watchOverviewWorkflowRunJobs(target);
    await flush();

    expect(getWorkflowRunJobsSpy).toHaveBeenCalledTimes(2);
    const key = getOverviewWorkflowRunJobsKey(target);
    const map = appAtomRegistry.get(getOverviewWorkflowRunJobsAtom(key));
    const selected = selectOverviewWorkflowRunJobs(map, target.runIds, true);
    expect(selected.isLoading).toBe(false);
    expect(selected.jobsByRunId.get("run-1")).toEqual([{ jobId: "run-1-job" }]);
    expect(selected.jobsByRunId.get("run-2")).toEqual([{ jobId: "run-2-job" }]);

    release();
  });
});

describe("selectOverviewWorkflowRunJobs", () => {
  it("reports loading while a requested run id is missing", () => {
    const map = new Map<string, WorkflowRunJobsEntry>([
      ["run-1", { jobs: [], isLoading: false, error: null, fetchedAt: 1 }],
    ]);
    const result = selectOverviewWorkflowRunJobs(map, ["run-1", "run-2"], true);
    expect(result.isLoading).toBe(true);
    expect(result.jobsByRunId.has("run-2")).toBe(false);
  });

  it("returns empty result when disabled", () => {
    const map = new Map<string, WorkflowRunJobsEntry>();
    const result = selectOverviewWorkflowRunJobs(map, ["run-1"], false);
    expect(result.isLoading).toBe(false);
    expect(result.jobsByRunId.size).toBe(0);
  });
});
