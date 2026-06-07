import type { SourceControlCheckRollupItem, SourceControlWorkflowRun } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  getPrCheckStatusFromRollup,
  getPrCheckStatusFromWorkflowRuns,
  primaryFailedCheckUrl,
} from "./prCheckStatus";

function rollup(
  input: Partial<SourceControlCheckRollupItem> & Pick<SourceControlCheckRollupItem, "name">,
): SourceControlCheckRollupItem {
  return {
    kind: "check-run",
    status: Option.none(),
    conclusion: Option.none(),
    url: Option.none(),
    startedAt: Option.none(),
    completedAt: Option.none(),
    ...input,
  };
}

function workflowRun(
  input: Pick<SourceControlWorkflowRun, "conclusion" | "runId" | "status" | "workflowName">,
): SourceControlWorkflowRun {
  const now = DateTime.fromDateUnsafe(new Date("2026-05-31T12:00:00.000Z"));
  return {
    provider: "github",
    displayTitle: input.workflowName,
    branch: Option.some("feature/checks"),
    actor: Option.some("octocat"),
    startedAt: Option.some(now),
    updatedAt: Option.some(now),
    durationMs: Option.some(60_000),
    commit: {
      oid: "abc123def456",
      shortOid: "abc123def456",
      messageHeadline: "Update checks",
    },
    event: "pull_request",
    url: `https://github.com/acme/repo/actions/runs/${input.runId}`,
    ...input,
  };
}

describe("PR check status view model", () => {
  it("reports all passed when every rollup item succeeds", () => {
    const view = getPrCheckStatusFromRollup({
      headSha: "sha-1",
      rollup: [
        rollup({
          name: "lint",
          status: Option.some("COMPLETED"),
          conclusion: Option.some("SUCCESS"),
        }),
        rollup({ name: "test", status: Option.some("SUCCESS") }),
      ],
    });

    expect(view.kind).toBe("passed");
    expect(view.headSha).toBe("sha-1");
  });

  it("distinguishes queued and running checks", () => {
    expect(
      getPrCheckStatusFromRollup({
        rollup: [rollup({ name: "ci", status: Option.some("QUEUED") })],
      }).kind,
    ).toBe("pending");
    expect(
      getPrCheckStatusFromRollup({
        rollup: [rollup({ name: "ci", status: Option.some("IN_PROGRESS") })],
      }).kind,
    ).toBe("running");
  });

  it("keeps failed check details and links", () => {
    const view = getPrCheckStatusFromRollup({
      rollup: [
        rollup({
          name: "typecheck",
          workflowName: "CI",
          status: Option.some("COMPLETED"),
          conclusion: Option.some("FAILURE"),
          url: Option.some("https://github.com/acme/repo/actions/runs/1/job/2"),
        }),
      ],
    });

    expect(view.kind).toBe("failed");
    expect(view.failedChecks).toEqual([
      {
        name: "typecheck",
        workflowName: "CI",
        url: "https://github.com/acme/repo/actions/runs/1/job/2",
      },
    ]);
    expect(primaryFailedCheckUrl(view)).toBe("https://github.com/acme/repo/actions/runs/1/job/2");
  });

  it("treats skipped terminal results as successful for the aggregate", () => {
    const view = getPrCheckStatusFromRollup({
      rollup: [
        rollup({
          name: "lint",
          status: Option.some("COMPLETED"),
          conclusion: Option.some("SUCCESS"),
        }),
        rollup({
          name: "optional",
          status: Option.some("COMPLETED"),
          conclusion: Option.some("SKIPPED"),
        }),
      ],
    });

    expect(view.kind).toBe("passed");
  });

  it("reports unavailable when no checks exist", () => {
    expect(getPrCheckStatusFromRollup({ rollup: [] }).kind).toBe("unavailable");
  });

  it("summarizes workflow runs for the same status model", () => {
    const view = getPrCheckStatusFromWorkflowRuns({
      headSha: "abc123def456",
      runs: [
        workflowRun({
          runId: "1",
          workflowName: "CI",
          status: "completed",
          conclusion: Option.some("success"),
        }),
      ],
    });

    expect(view.kind).toBe("passed");
    expect(view.headSha).toBe("abc123def456");
  });
});
