import { Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type {
  SourceControlChangeRequestDetail,
  SourceControlIssueDetail,
  WorkItemDetail,
} from "@ryco/contracts";

import { deriveIssueActions, derivePullRequestActions, deriveWorkItemActions } from "./itemActions";

const fakeDateTime = (iso: string) => ({ toJSON: () => iso, toString: () => iso }) as never;

function makePrDetail(
  overrides?: Partial<{
    state: string;
    mergeability: string;
    comments: unknown[];
    checkRollup: unknown[];
  }>,
): SourceControlChangeRequestDetail {
  return {
    provider: "github",
    number: 42,
    title: "Add token usage attribution",
    url: "https://github.com/owner/repo/pull/42",
    baseRefName: "main",
    headRefName: "feature/tokens",
    state: overrides?.state ?? "open",
    updatedAt: Option.none(),
    mergeability: overrides?.mergeability ?? "mergeable",
    checkRollup: overrides?.checkRollup ?? [],
    body: "body",
    comments: overrides?.comments ?? [],
    truncated: false,
  } as unknown as SourceControlChangeRequestDetail;
}

function reviewComment(author: string, state: string, iso: string) {
  return {
    author,
    body: "review",
    createdAt: fakeDateTime(iso),
    reviewState: state,
  };
}

function failedCheck(name: string) {
  return {
    kind: "check-run",
    name,
    status: Option.some("completed"),
    conclusion: Option.some("failure"),
    url: Option.none(),
    startedAt: Option.none(),
    completedAt: Option.none(),
  };
}

describe("derivePullRequestActions", () => {
  it("returns no actions for a clean open PR", () => {
    expect(derivePullRequestActions(makePrDetail())).toEqual([]);
  });

  it("returns no actions for merged or closed PRs even with conflicts", () => {
    expect(
      derivePullRequestActions(makePrDetail({ state: "merged", mergeability: "conflicting" })),
    ).toEqual([]);
  });

  it("derives the conflicts action", () => {
    const actions = derivePullRequestActions(makePrDetail({ mergeability: "conflicting" }));
    expect(actions.map((action) => action.kind)).toEqual(["pr-conflicts"]);
    expect(actions[0]?.summary).toContain("main");
  });

  it("derives the review action from the latest review per reviewer", () => {
    const actions = derivePullRequestActions(
      makePrDetail({
        comments: [
          reviewComment("alice", "changes_requested", "2026-07-01T10:00:00Z"),
          reviewComment("bob", "approved", "2026-07-01T11:00:00Z"),
        ],
      }),
    );
    expect(actions.map((action) => action.kind)).toEqual(["pr-review"]);
    expect(actions[0]?.summary).toContain("@alice");
  });

  it("clears the review action when the reviewer later approves or is dismissed", () => {
    for (const laterState of ["approved", "dismissed"]) {
      const actions = derivePullRequestActions(
        makePrDetail({
          comments: [
            reviewComment("alice", "changes_requested", "2026-07-01T10:00:00Z"),
            reviewComment("alice", laterState, "2026-07-02T10:00:00Z"),
          ],
        }),
      );
      expect(actions).toEqual([]);
    }
  });

  it("derives the failing-checks action with check names", () => {
    const actions = derivePullRequestActions(
      makePrDetail({ checkRollup: [failedCheck("build"), failedCheck("typecheck")] }),
    );
    expect(actions.map((action) => action.kind)).toEqual(["pr-checks"]);
    expect(actions[0]?.summary).toContain("build");
    expect(actions[0]?.severity).toBe("error");
  });

  it("stacks all applicable actions", () => {
    const actions = derivePullRequestActions(
      makePrDetail({
        mergeability: "conflicting",
        comments: [reviewComment("alice", "changes_requested", "2026-07-01T10:00:00Z")],
        checkRollup: [failedCheck("build")],
      }),
    );
    expect(actions.map((action) => action.kind)).toEqual([
      "pr-conflicts",
      "pr-review",
      "pr-checks",
    ]);
  });
});

describe("deriveIssueActions", () => {
  const issue = (state: string) =>
    ({
      provider: "github",
      number: 17,
      title: "Fix login",
      url: "https://github.com/owner/repo/issues/17",
      state,
      updatedAt: Option.none(),
      body: "body",
      comments: [],
      truncated: false,
    }) as unknown as SourceControlIssueDetail;

  it("offers implement for open issues only", () => {
    expect(deriveIssueActions(issue("open")).map((action) => action.kind)).toEqual([
      "implement-issue",
    ]);
    expect(deriveIssueActions(issue("closed"))).toEqual([]);
  });
});

describe("deriveWorkItemActions", () => {
  const workItem = (state: string, stateName?: string) =>
    ({
      provider: "jira",
      key: "RYC-231",
      title: "Attribute token spend",
      url: "https://acme.atlassian.net/browse/RYC-231",
      state,
      ...(stateName !== undefined ? { stateName } : {}),
      assignee: null,
      updatedAt: Option.none(),
      description: "desc",
      comments: [],
      transitions: [],
      linkedChangeRequests: [],
      editableFields: [],
      activity: [],
      truncated: false,
    }) as unknown as WorkItemDetail;

  it("offers implement for open and in-progress work items", () => {
    expect(deriveWorkItemActions(workItem("open")).map((a) => a.kind)).toEqual([
      "implement-work-item",
    ]);
    expect(deriveWorkItemActions(workItem("in_progress", "In Progress"))[0]?.badge).toBe(
      "In Progress",
    );
    expect(deriveWorkItemActions(workItem("done"))).toEqual([]);
    expect(deriveWorkItemActions(workItem("closed"))).toEqual([]);
  });
});
