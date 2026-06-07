import { Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { SourceControlIssueSummary } from "@ryco/contracts";
import {
  scopeSourceControlQuery,
  searchSourceControlSummaries,
} from "./composerSourceControlContextSearch";

const summaries: SourceControlIssueSummary[] = [
  {
    provider: "github",
    number: 42 as any,
    title: "Remove stale todos_manager.html" as any,
    url: "u" as any,
    state: "open",
    updatedAt: Option.none(),
  },
  {
    provider: "github",
    number: 41 as any,
    title: "remote-install.sh shows wrong port" as any,
    url: "u" as any,
    state: "open",
    updatedAt: Option.none(),
  },
  {
    provider: "github",
    number: 40 as any,
    title: "AK-47 keychain canvas position not calibrated" as any,
    url: "u" as any,
    state: "open",
    updatedAt: Option.none(),
  },
];

describe("searchSourceControlSummaries", () => {
  it("returns all when query is empty", () => {
    expect(searchSourceControlSummaries(summaries, "")).toEqual(summaries);
  });
  it("matches by number", () => {
    const result = searchSourceControlSummaries(summaries, "42");
    expect(result[0]?.number).toBe(42);
  });
  it("matches title substring", () => {
    const result = searchSourceControlSummaries(summaries, "todos_manager");
    expect(result[0]?.number).toBe(42);
  });
  it("ranks prefix matches above substring matches", () => {
    const more = [
      ...summaries,
      {
        provider: "github" as const,
        number: 1 as any,
        title: "ak-47 followup" as any,
        url: "u" as any,
        state: "open" as const,
        updatedAt: Option.none(),
      },
    ];
    const result = searchSourceControlSummaries(more, "ak-47");
    expect(result[0]?.number).toBe(1);
  });
});

describe("scopeSourceControlQuery", () => {
  it.each([
    { input: "", scope: "mixed", search: "" },
    { input: "auth", scope: "mixed", search: "auth" },
    { input: "i", scope: "issues", search: "" },
    { input: "i ", scope: "issues", search: "" },
    { input: "i auth", scope: "issues", search: "auth" },
    { input: "i   bug fix", scope: "issues", search: "bug fix" },
    { input: "pr", scope: "prs", search: "" },
    { input: "pr ", scope: "prs", search: "" },
    { input: "pr 42", scope: "prs", search: "42" },
    { input: "jira", scope: "jira", search: "" },
    { input: "jira RYCO-123", scope: "jira", search: "RYCO-123" },
    { input: "ipad", scope: "mixed", search: "ipad" },
    { input: "price", scope: "mixed", search: "price" },
    { input: "jiraflow", scope: "mixed", search: "jiraflow" },
    { input: "issue", scope: "mixed", search: "issue" },
  ])('"$input" → scope=$scope search="$search"', ({ input, scope, search }) => {
    const result = scopeSourceControlQuery(input);
    expect(result.scope).toBe(scope);
    expect(result.search).toBe(search);
  });

  it("trims only the prefix separator, not the user's tail content", () => {
    // multi-space tail content is preserved verbatim after the prefix collapse
    const result = scopeSourceControlQuery("pr  foo  bar");
    expect(result).toEqual({ scope: "prs", search: "foo  bar" });
  });
});
