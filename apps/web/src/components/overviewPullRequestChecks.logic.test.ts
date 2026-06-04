import type {
  SourceControlCheckRollupItem,
  SourceControlWorkflowJob,
  SourceControlWorkflowRun,
  SourceControlWorkflowStep,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildOverviewCheckRollupRows,
  buildOverviewWorkflowCheckRows,
  summarizeActiveWorkflowJob,
} from "./overviewPullRequestChecks.logic";

const now = DateTime.fromDateUnsafe(new Date("2026-06-04T12:00:00.000Z"));

function workflowRun(input: Partial<SourceControlWorkflowRun>): SourceControlWorkflowRun {
  return {
    provider: "github",
    runId: "run-1",
    workflowName: "Quality",
    displayTitle: "Quality checks",
    branch: Option.some("feature/check-tooltip"),
    event: "pull_request",
    commit: {
      oid: "abcdef123456",
      shortOid: "abcdef1",
      messageHeadline: "Update overview checks",
    },
    actor: Option.some("octocat"),
    status: "completed",
    conclusion: Option.some("success"),
    startedAt: Option.some(now),
    updatedAt: Option.some(now),
    durationMs: Option.some(60_000),
    url: "https://github.com/acme/repo/actions/runs/run-1",
    ...input,
  };
}

function workflowStep(input: Partial<SourceControlWorkflowStep>): SourceControlWorkflowStep {
  return {
    number: 1,
    name: "Run command",
    status: "completed",
    conclusion: Option.some("success"),
    startedAt: Option.some(now),
    completedAt: Option.some(now),
    durationMs: Option.some(1_000),
    ...input,
  };
}

function workflowJob(input: Partial<SourceControlWorkflowJob>): SourceControlWorkflowJob {
  return {
    jobId: "job-1",
    name: "Branch Preflight",
    status: "completed",
    conclusion: Option.some("success"),
    startedAt: Option.some(now),
    completedAt: Option.some(now),
    durationMs: Option.some(10_000),
    url: Option.some("https://github.com/acme/repo/actions/runs/run-1/job/1"),
    steps: [],
    ...input,
  };
}

function checkRollup(
  input: Partial<SourceControlCheckRollupItem> & Pick<SourceControlCheckRollupItem, "name">,
): SourceControlCheckRollupItem {
  return {
    kind: "check-run",
    status: Option.some("COMPLETED"),
    conclusion: Option.some("SUCCESS"),
    url: Option.none(),
    startedAt: Option.none(),
    completedAt: Option.none(),
    ...input,
  };
}

describe("overview pull request checks", () => {
  it("prefers workflow jobs over workflow run summaries for tooltip rows", () => {
    const run = workflowRun({ runId: "run-1", workflowName: "Release Smoke" });
    const rows = buildOverviewWorkflowCheckRows({
      runs: [run],
      jobsByRunId: new Map([
        [
          "run-1",
          [
            workflowJob({
              jobId: "job-skipped",
              name: "Branch",
              conclusion: Option.some("skipped"),
            }),
            workflowJob({
              jobId: "job-passed",
              name: "Label PR size",
              conclusion: Option.some("success"),
            }),
            workflowJob({
              jobId: "job-failed",
              name: "CodeRabbit",
              conclusion: Option.some("failure"),
            }),
          ],
        ],
      ]),
    });

    expect(rows.map((row) => [row.name, row.statusLabel])).toEqual([
      ["Branch", "Skipped"],
      ["Label PR size", "Succeeded"],
      ["CodeRabbit", "Failed"],
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "run:run-1:job:job-skipped",
      "run:run-1:job:job-passed",
      "run:run-1:job:job-failed",
    ]);
  });

  it("falls back to workflow run rows until job details are available", () => {
    const rows = buildOverviewWorkflowCheckRows({
      runs: [workflowRun({ runId: "run-1", workflowName: "Quality" })],
      jobsByRunId: new Map(),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Quality");
    expect(rows[0]?.statusLabel).toBe("Succeeded");
  });

  it("includes the notable job step in row detail and active summaries", () => {
    const job = workflowJob({
      name: "Test",
      status: "in_progress",
      conclusion: Option.none(),
      steps: [
        workflowStep({ number: 1, name: "Install", status: "completed" }),
        workflowStep({
          number: 2,
          name: "Run vitest",
          status: "in_progress",
          conclusion: Option.none(),
        }),
      ],
    });
    const rows = buildOverviewWorkflowCheckRows({
      runs: [workflowRun({ runId: "run-1", workflowName: "Quality" })],
      jobsByRunId: new Map([["run-1", [job]]]),
    });

    expect(rows[0]?.detail).toBe("Quality / Run vitest");
    expect(rows[0]?.statusLabel).toBe("Running");
    expect(summarizeActiveWorkflowJob([job])).toBe("Test / Run vitest");
  });

  it("builds tooltip rows from PR check rollup data when workflow details are absent", () => {
    const rows = buildOverviewCheckRollupRows({
      rollup: [
        checkRollup({
          name: "Branch",
          conclusion: Option.some("SKIPPED"),
        }),
        checkRollup({
          name: "Label PR size",
          workflowName: "Pull Request / Quality",
          conclusion: Option.some("SUCCESS"),
        }),
        checkRollup({
          name: "CodeRabbit",
          conclusion: Option.some("FAILURE"),
          url: Option.some("https://github.com/acme/repo/actions/runs/1/job/3"),
        }),
      ],
    });

    expect(rows.map((row) => [row.name, row.statusLabel, row.detail])).toEqual([
      ["Branch", "Skipped", undefined],
      ["Label PR size", "Succeeded", "Pull Request / Quality"],
      ["CodeRabbit", "Failed", undefined],
    ]);
    expect(rows[2]?.url).toBe("https://github.com/acme/repo/actions/runs/1/job/3");
  });
});
