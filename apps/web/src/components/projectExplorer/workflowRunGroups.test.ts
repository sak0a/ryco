import type { SourceControlWorkflowRun } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { describe, expect, it } from "vitest";
import { groupWorkflowRunsBySource } from "./workflowRunGroups";

type TestChangeRequest = Parameters<typeof groupWorkflowRunsBySource>[0]["changeRequests"][number];

function utc(value: string) {
  return DateTime.fromDateUnsafe(new Date(value));
}

function workflowRun(input: {
  readonly runId: string;
  readonly branch?: string | null;
  readonly commitOid?: string;
  readonly updatedAt?: string;
}): SourceControlWorkflowRun {
  const updatedAt = utc(input.updatedAt ?? "2026-06-01T12:00:00.000Z");
  const commitOid = input.commitOid ?? `commit-${input.runId}`;

  return {
    provider: "github",
    runId: input.runId,
    workflowName: "CI",
    displayTitle: "CI",
    branch:
      input.branch === undefined || input.branch === null
        ? Option.none()
        : Option.some(input.branch),
    event: "push",
    commit: {
      oid: commitOid,
      shortOid: commitOid.slice(0, 12),
      messageHeadline: "Run CI",
    },
    actor: Option.some("octocat"),
    status: "completed",
    conclusion: Option.some("success"),
    startedAt: Option.some(updatedAt),
    updatedAt: Option.some(updatedAt),
    durationMs: Option.some(60_000),
    url: `https://github.com/acme/repo/actions/runs/${input.runId}`,
  };
}

function changeRequest(input: {
  readonly number: number;
  readonly headRefName: string;
  readonly headSha?: string;
}): TestChangeRequest {
  return {
    provider: "github",
    number: input.number,
    title: `PR ${input.number}`,
    url: `https://github.com/acme/repo/pull/${input.number}`,
    headRefName: input.headRefName,
    ...(input.headSha ? { headSha: input.headSha } : {}),
  };
}

describe("groupWorkflowRunsBySource", () => {
  it("groups workflow runs by matching pull request branch", () => {
    const groups = groupWorkflowRunsBySource({
      runs: [
        workflowRun({ runId: "1", branch: "feature/actions" }),
        workflowRun({ runId: "2", branch: "feature/actions" }),
      ],
      changeRequests: [changeRequest({ number: 42, headRefName: "feature/actions" })],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("pr:github:42");
    expect(groups[0]?.source.kind).toBe("pull-request");
    expect(groups[0]?.runs.map((run) => run.runId)).toEqual(["1", "2"]);
  });

  it("prefers a pull request head SHA match over branch metadata", () => {
    const groups = groupWorkflowRunsBySource({
      runs: [workflowRun({ runId: "1", branch: "stale-branch", commitOid: "head-sha" })],
      changeRequests: [
        changeRequest({ number: 7, headRefName: "feature/current", headSha: "head-sha" }),
      ],
    });

    expect(groups[0]?.id).toBe("pr:github:7");
  });

  it("falls back to branch and unknown groups without pull request matches", () => {
    const groups = groupWorkflowRunsBySource({
      runs: [
        workflowRun({
          runId: "old",
          branch: "main",
          updatedAt: "2026-06-01T08:00:00.000Z",
        }),
        workflowRun({
          runId: "new",
          branch: null,
          updatedAt: "2026-06-01T09:00:00.000Z",
        }),
      ],
      changeRequests: [],
    });

    expect(groups.map((group) => group.id)).toEqual(["unknown", "branch:main"]);
    expect(groups[0]?.latestRun.runId).toBe("new");
  });
});
