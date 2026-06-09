import { DateTime, Option, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AtlassianConnectionId } from "./baseSchemas.ts";
import {
  WorkItemDetail,
  WorkItemListProjectsInput,
  WorkItemProject,
  WorkItemSummary,
} from "./workItems.ts";

const updatedAt = DateTime.fromDateUnsafe(new Date("2026-05-12T12:00:00.000Z"));
const createdAt = DateTime.fromDateUnsafe(new Date("2026-05-01T12:00:00.000Z"));
const commentCreatedAt = DateTime.fromDateUnsafe(new Date("2026-05-12T11:00:00.000Z"));

describe("work item contracts", () => {
  it("decodes a Jira project summary and list input", () => {
    const project = Schema.decodeUnknownSync(WorkItemProject)({
      provider: "jira",
      key: "KAN",
      name: "Mein Software-Team",
      url: "https://ryco-app.atlassian.net/jira/software/projects/KAN",
      projectTypeKey: "software",
      simplified: true,
    });
    const input = Schema.decodeUnknownSync(WorkItemListProjectsInput)({
      connectionId: AtlassianConnectionId.make("atl-conn-1"),
      siteUrl: "https://ryco-app.atlassian.net",
    });

    expect(project.key).toBe("KAN");
    expect(input.connectionId).toBe("atl-conn-1");
  });

  it("decodes a Jira issue summary", () => {
    const decoded = Schema.decodeUnknownSync(WorkItemSummary)({
      provider: "jira",
      key: "PROJ-123",
      id: "10001",
      title: "Wire Atlassian connection settings",
      url: "https://acme.atlassian.net/browse/PROJ-123",
      state: "in_progress",
      stateName: "Next to come",
      issueType: "Task",
      priority: "High",
      priorityDetail: {
        id: "1",
        name: "High",
        iconUrl: "https://acme.atlassian.net/images/icons/priorities/high.svg",
        statusColor: "#f15c75",
      },
      assignee: "Alice",
      reporter: "Bob",
      labels: ["atlassian"],
      dueDate: "2026-05-30",
      startDate: "2026-05-12",
      createdAt: Option.some(createdAt),
      updatedAt: Option.some(updatedAt),
    });

    expect(decoded.key).toBe("PROJ-123");
    expect(decoded.stateName).toBe("Next to come");
    expect(decoded.priorityDetail?.iconUrl).toContain("high.svg");
    expect(decoded.createdAt && Option.isSome(decoded.createdAt)).toBe(true);
    expect(Option.isSome(decoded.updatedAt)).toBe(true);
  });

  it("decodes detail with comments and transitions", () => {
    const decoded = Schema.decodeUnknownSync(WorkItemDetail)({
      provider: "jira",
      key: "PROJ-123",
      title: "Wire Atlassian connection settings",
      url: "https://acme.atlassian.net/browse/PROJ-123",
      state: "open",
      stateName: "Backlog",
      assignee: null,
      createdAt: Option.some(createdAt),
      updatedAt: Option.none(),
      description: "Add Jira-aware settings.",
      comments: [
        {
          id: "10000",
          author: "Alice",
          body: "Please keep tokens out of the browser.",
          createdAt: commentCreatedAt,
          updatedAt: commentCreatedAt,
          editable: true,
        },
      ],
      transitions: [
        {
          id: "31",
          name: "In Progress",
          toState: "in_progress",
          toStateName: "In Umsetzung",
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
      editableFields: [
        {
          id: "priority",
          jiraFieldId: "priority",
          name: "Priority",
          required: false,
          operations: ["set"],
          options: [
            {
              id: "1",
              name: "High",
              iconUrl: "https://acme.atlassian.net/images/icons/priorities/high.svg",
            },
          ],
        },
      ],
      activity: [
        {
          id: "20000",
          author: "Alice",
          createdAt: commentCreatedAt,
          items: [{ field: "priority", from: "Medium", to: "High" }],
        },
      ],
      truncated: false,
    });

    expect(decoded.comments).toHaveLength(1);
    expect(decoded.stateName).toBe("Backlog");
    expect(decoded.transitions[0]?.toState).toBe("in_progress");
    expect(decoded.transitions[0]?.toStateName).toBe("In Umsetzung");
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
