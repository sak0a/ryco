import type { SourceControlWorkflowRun } from "@ryco/contracts";
import { EnvironmentId } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  ACTIVE_WORKFLOW_REFRESH_INTERVAL_MS,
  createPostPushWorkflowDiscoveryWatch,
  hasDiscoveredPostPushWorkflowRun,
  POST_PUSH_WORKFLOW_DISCOVERY_INTERVAL_MS,
  POST_PUSH_WORKFLOW_DISCOVERY_WINDOW_MS,
  resolveWorkflowRunsRefetchInterval,
  selectActivePostPushWorkflowDiscoveryWatch,
} from "./postPushWorkflowDiscovery.logic";

const environmentId = EnvironmentId.make("environment-test");
const now = DateTime.fromDateUnsafe(new Date("2026-06-10T12:00:00.000Z"));

function workflowRun(input: Partial<SourceControlWorkflowRun> = {}): SourceControlWorkflowRun {
  return {
    provider: "github",
    runId: "run-1",
    workflowName: "CI",
    displayTitle: "CI",
    branch: Option.some("feature/status"),
    event: "pull_request",
    commit: {
      oid: "abcdef1234567890",
      shortOid: "abcdef123456",
      messageHeadline: "Update status",
    },
    actor: Option.some("octocat"),
    status: "queued",
    conclusion: Option.none(),
    startedAt: Option.some(now),
    updatedAt: Option.some(now),
    durationMs: Option.none(),
    url: "https://github.com/acme/repo/actions/runs/1",
    ...input,
  };
}

describe("post-push workflow discovery", () => {
  it("creates a bounded watch window from a successful push", () => {
    const watch = createPostPushWorkflowDiscoveryWatch({
      environmentId,
      cwd: "/repo",
      pullRequestNumber: 42,
      commitSha: " abcdef1234567890 ",
      nowMs: 1_000,
    });

    expect(watch).toEqual({
      environmentId,
      threadKey: null,
      cwd: "/repo",
      pullRequestNumber: 42,
      commitSha: "abcdef1234567890",
      expiresAtMs: 1_000 + POST_PUSH_WORKFLOW_DISCOVERY_WINDOW_MS,
    });
  });

  it("matches only the active environment, cwd, PR, and time window", () => {
    const watch = createPostPushWorkflowDiscoveryWatch({
      environmentId,
      threadKey: "thread-1",
      cwd: "/repo",
      pullRequestNumber: 42,
      nowMs: 1_000,
    });

    expect(
      selectActivePostPushWorkflowDiscoveryWatch({
        watch,
        environmentId,
        threadKey: "thread-1",
        cwd: "/repo",
        pullRequestNumber: 42,
        nowMs: 2_000,
      }),
    ).toBe(watch);
    expect(
      selectActivePostPushWorkflowDiscoveryWatch({
        watch,
        environmentId,
        threadKey: "thread-2",
        cwd: "/repo",
        pullRequestNumber: 42,
        nowMs: 2_000,
      }),
    ).toBeNull();
    expect(
      selectActivePostPushWorkflowDiscoveryWatch({
        watch,
        environmentId,
        threadKey: "thread-1",
        cwd: "/other",
        pullRequestNumber: 42,
        nowMs: 2_000,
      }),
    ).toBeNull();
    expect(
      selectActivePostPushWorkflowDiscoveryWatch({
        watch,
        environmentId,
        threadKey: "thread-1",
        cwd: "/repo",
        pullRequestNumber: 7,
        nowMs: 2_000,
      }),
    ).toBeNull();
    expect(
      selectActivePostPushWorkflowDiscoveryWatch({
        watch,
        environmentId,
        threadKey: "thread-1",
        cwd: "/repo",
        pullRequestNumber: 42,
        nowMs: watch.expiresAtMs,
      }),
    ).toBeNull();
  });

  it("detects a discovered run by pushed commit SHA", () => {
    const watch = createPostPushWorkflowDiscoveryWatch({
      environmentId,
      cwd: "/repo",
      commitSha: "abcdef1234567890",
      nowMs: 1_000,
    });

    expect(hasDiscoveredPostPushWorkflowRun({ watch, runs: [workflowRun()] })).toBe(true);
    expect(
      hasDiscoveredPostPushWorkflowRun({
        watch,
        runs: [workflowRun({ commit: { oid: "deadbeef", shortOid: "deadbeef" } })],
      }),
    ).toBe(false);
  });

  it("does not treat cached runs as discovered when the pushed commit is unknown", () => {
    const watch = createPostPushWorkflowDiscoveryWatch({
      environmentId,
      cwd: "/repo",
      commitSha: null,
      nowMs: 1_000,
    });

    expect(hasDiscoveredPostPushWorkflowRun({ watch, runs: [workflowRun()] })).toBe(false);
  });

  it("uses 10s discovery polling before falling back to normal refresh rules", () => {
    const watch = createPostPushWorkflowDiscoveryWatch({
      environmentId,
      cwd: "/repo",
      nowMs: 1_000,
    });

    expect(
      resolveWorkflowRunsRefetchInterval({
        activeWatch: watch,
        nowMs: 2_000,
        discoveredPostPushRun: false,
        statusRefreshable: false,
      }),
    ).toBe(POST_PUSH_WORKFLOW_DISCOVERY_INTERVAL_MS);
    expect(
      resolveWorkflowRunsRefetchInterval({
        activeWatch: watch,
        nowMs: 2_000,
        discoveredPostPushRun: true,
        statusRefreshable: true,
      }),
    ).toBe(ACTIVE_WORKFLOW_REFRESH_INTERVAL_MS);
    expect(
      resolveWorkflowRunsRefetchInterval({
        activeWatch: watch,
        nowMs: watch.expiresAtMs,
        discoveredPostPushRun: false,
        statusRefreshable: false,
      }),
    ).toBe(false);
  });
});
