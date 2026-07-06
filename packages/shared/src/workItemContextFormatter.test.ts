import { describe, expect, it } from "vite-plus/test";
import type { ComposerWorkItemContext } from "@ryco/contracts";
import { formatWorkItemContextsForAgent } from "./workItemContextFormatter.ts";

// Build minimal fake DateTime-like values that satisfy the type.
const fakeDateTime = (iso: string) =>
  ({
    toJSON: () => iso,
    toString: () => iso,
  }) as unknown as ComposerWorkItemContext["fetchedAt"];

type Detail = ComposerWorkItemContext["detail"];

const fullDetail: Detail = {
  provider: "jira",
  key: "RYC-231",
  title: "Attribute token spend per turn",
  url: "https://acme.atlassian.net/browse/RYC-231",
  state: "in_progress",
  stateName: "In Progress",
  issueType: "Story",
  priority: "High",
  assignee: "alice",
  reporter: "bob",
  labels: ["tokens", "analytics"],
  dueDate: "2026-07-30",
  parentKey: "RYC-200",
  updatedAt: null as unknown as Detail["updatedAt"],
  description: "Track per-turn token deltas across providers.",
  comments: [
    {
      author: "carol",
      body: "Cached inputs need special handling.",
      createdAt: fakeDateTime(
        "2026-07-01T09:00:00Z",
      ) as unknown as Detail["comments"][number]["createdAt"],
    },
  ],
  transitions: [],
  linkedChangeRequests: [],
  editableFields: [],
  activity: [],
  truncated: false,
} as unknown as Detail;

const minimalDetail: Detail = {
  provider: "jira",
  key: "RYC-5",
  title: "Small task",
  url: "https://acme.atlassian.net/browse/RYC-5",
  state: "open",
  assignee: null,
  updatedAt: null as unknown as Detail["updatedAt"],
  description: "Just do it.",
  comments: [],
  transitions: [],
  linkedChangeRequests: [],
  editableFields: [],
  activity: [],
  truncated: true,
} as unknown as Detail;

function makeContext(detail: Detail, id = "ctx-1"): ComposerWorkItemContext {
  return {
    id,
    provider: "jira",
    key: detail.key,
    detail,
    fetchedAt: fakeDateTime("2026-07-05T10:00:00Z"),
    staleAfter: fakeDateTime("2026-07-05T10:05:00Z"),
  } as ComposerWorkItemContext;
}

describe("formatWorkItemContextsForAgent", () => {
  it("returns an empty string for no contexts", () => {
    expect(formatWorkItemContextsForAgent([])).toBe("");
  });

  it("renders every populated field for a full work item", () => {
    const output = formatWorkItemContextsForAgent([makeContext(fullDetail)]);
    expect(output).toContain("## Attached work-item context");
    expect(output).toContain("### Work Item RYC-231: Attribute token spend per turn");
    expect(output).toContain("URL: https://acme.atlassian.net/browse/RYC-231");
    expect(output).toContain("Status: In Progress");
    expect(output).toContain("Type: Story");
    expect(output).toContain("Priority: High");
    expect(output).toContain("Assignee: alice");
    expect(output).toContain("Reporter: bob");
    expect(output).toContain("Labels: tokens, analytics");
    expect(output).toContain("Due: 2026-07-30");
    expect(output).toContain("Parent: RYC-200");
    expect(output).toContain("Track per-turn token deltas across providers.");
    expect(output).toContain("Recent comments:");
    expect(output).toContain("- carol (2026-07-01T09:00:00Z): Cached inputs need special handling.");
    expect(output).not.toContain("truncated by the server");
  });

  it("omits optional fields, falls back to raw state, and notes truncation", () => {
    const output = formatWorkItemContextsForAgent([makeContext(minimalDetail)]);
    expect(output).toContain("### Work Item RYC-5: Small task");
    expect(output).toContain("Status: open");
    expect(output).not.toContain("Type:");
    expect(output).not.toContain("Priority:");
    expect(output).not.toContain("Assignee:");
    expect(output).not.toContain("Labels:");
    expect(output).not.toContain("Recent comments:");
    expect(output).toContain("> Note: this context was truncated by the server.");
  });

  it("joins multiple work items into one block", () => {
    const output = formatWorkItemContextsForAgent([
      makeContext(fullDetail, "ctx-1"),
      makeContext(minimalDetail, "ctx-2"),
    ]);
    expect(output.match(/### Work Item/g)).toHaveLength(2);
    expect(output.match(/## Attached work-item context/g)).toHaveLength(1);
  });
});
