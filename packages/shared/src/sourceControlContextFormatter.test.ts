import { describe, expect, it } from "vitest";
import type { ComposerSourceControlContext } from "@ryco/contracts";
import { formatSourceControlContextsForAgent } from "./sourceControlContextFormatter.ts";

// Build minimal fake DateTime-like values that satisfy the type.
const fakeDateTime = (iso: string) =>
  ({
    toJSON: () => iso,
    toString: () => iso,
  }) as unknown as ComposerSourceControlContext["fetchedAt"];

type Detail = ComposerSourceControlContext["detail"];

const issueDetail: Detail = {
  provider: "github",
  number: 42,
  title: "Fix login bug",
  url: "https://github.com/owner/repo/issues/42",
  state: "open",
  author: "alice",
  updatedAt: null as unknown as Detail["updatedAt"],
  labels: ["bug", "ui"],
  body: "The login button does not work.",
  comments: [
    {
      author: "bob",
      body: "I can reproduce this.",
      createdAt: fakeDateTime(
        "2024-06-01T13:00:00Z",
      ) as unknown as Detail["comments"][number]["createdAt"],
    },
  ],
  truncated: false,
} as unknown as Detail;

const crDetail: Detail = {
  provider: "github",
  number: 99,
  title: "Add dark mode",
  url: "https://github.com/owner/repo/pull/99",
  baseRefName: "main",
  headRefName: "feature/dark-mode",
  state: "open",
  updatedAt: null as unknown as Detail["updatedAt"],
  body: "Implements dark mode support.",
  comments: [],
  truncated: false,
} as unknown as Detail;

const issueContext: ComposerSourceControlContext = {
  id: "ctx-1" as ComposerSourceControlContext["id"],
  kind: "issue",
  provider: "github",
  reference: "owner/repo#42" as ComposerSourceControlContext["reference"],
  detail: issueDetail,
  fetchedAt: fakeDateTime("2024-06-01T00:00:00Z"),
  staleAfter: fakeDateTime("2024-06-01T00:05:00Z"),
};

const changeRequestContext: ComposerSourceControlContext = {
  id: "ctx-2" as ComposerSourceControlContext["id"],
  kind: "change-request",
  provider: "github",
  reference: "owner/repo#99" as ComposerSourceControlContext["reference"],
  detail: crDetail,
  fetchedAt: fakeDateTime("2024-06-01T00:00:00Z"),
  staleAfter: fakeDateTime("2024-06-01T00:05:00Z"),
};

describe("formatSourceControlContextsForAgent", () => {
  it("returns empty string for empty array", () => {
    expect(formatSourceControlContextsForAgent([])).toBe("");
  });

  it("renders issue with title, number, URL, and body", () => {
    const result = formatSourceControlContextsForAgent([issueContext]);
    expect(result).toContain("## Attached source-control context");
    expect(result).toContain("### Issue #42: Fix login bug");
    expect(result).toContain("URL: https://github.com/owner/repo/issues/42");
    expect(result).toContain("The login button does not work.");
  });

  it("renders change-request with baseRef and headRef", () => {
    const result = formatSourceControlContextsForAgent([changeRequestContext]);
    expect(result).toContain("### Change Request #99: Add dark mode");
    expect(result).toContain("Base: main");
    expect(result).toContain("Head: feature/dark-mode");
    expect(result).toContain("Implements dark mode support.");
  });

  it("renders multiple contexts each in their own section", () => {
    const result = formatSourceControlContextsForAgent([issueContext, changeRequestContext]);
    expect(result).toContain("### Issue #42: Fix login bug");
    expect(result).toContain("### Change Request #99: Add dark mode");
  });

  it("includes truncation note when truncated is true", () => {
    const truncatedDetail: Detail = { ...issueDetail, truncated: true } as unknown as Detail;
    const truncatedContext: ComposerSourceControlContext = {
      ...issueContext,
      detail: truncatedDetail,
    };
    const result = formatSourceControlContextsForAgent([truncatedContext]);
    expect(result).toContain("> Note: this context was truncated by the server.");
  });
});
