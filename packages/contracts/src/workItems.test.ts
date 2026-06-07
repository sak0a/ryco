import { DateTime, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { WorkItemDetail, WorkItemSummary } from "./workItems.ts";

const updatedAt = DateTime.fromDateUnsafe(new Date("2026-05-12T12:00:00.000Z"));
const commentCreatedAt = DateTime.fromDateUnsafe(new Date("2026-05-12T11:00:00.000Z"));

describe("work item contracts", () => {
  it("decodes a Jira issue summary", () => {
    const decoded = Schema.decodeUnknownSync(WorkItemSummary)({
      provider: "jira",
      key: "PROJ-123",
      id: "10001",
      title: "Wire Atlassian connection settings",
      url: "https://acme.atlassian.net/browse/PROJ-123",
      state: "in_progress",
      issueType: "Task",
      priority: "High",
      assignee: "Alice",
      reporter: "Bob",
      labels: ["atlassian"],
      updatedAt: Option.some(updatedAt),
    });

    expect(decoded.key).toBe("PROJ-123");
    expect(Option.isSome(decoded.updatedAt)).toBe(true);
  });

  it("decodes detail with comments and transitions", () => {
    const decoded = Schema.decodeUnknownSync(WorkItemDetail)({
      provider: "jira",
      key: "PROJ-123",
      title: "Wire Atlassian connection settings",
      url: "https://acme.atlassian.net/browse/PROJ-123",
      state: "open",
      assignee: null,
      updatedAt: Option.none(),
      description: "Add Jira-aware settings.",
      comments: [
        {
          author: "Alice",
          body: "Please keep tokens out of the browser.",
          createdAt: commentCreatedAt,
        },
      ],
      transitions: [
        {
          id: "31",
          name: "In Progress",
          toState: "in_progress",
        },
      ],
      linkedChangeRequests: [
        {
          provider: "bitbucket",
          number: 42,
          title: "PROJ-123 add connection settings",
          url: "https://bitbucket.org/acme/ryco/pull-requests/42",
          state: "open",
        },
      ],
      truncated: false,
    });

    expect(decoded.comments).toHaveLength(1);
    expect(decoded.transitions[0]?.toState).toBe("in_progress");
    expect(decoded.linkedChangeRequests[0]?.provider).toBe("bitbucket");
  });

  it("rejects an invalid provider", () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkItemSummary)({
        provider: "github",
        key: "PROJ-123",
        title: "Invalid provider",
        url: "https://example.com",
        state: "open",
        assignee: null,
        updatedAt: Option.none(),
      }),
    ).toThrow();
  });
});
