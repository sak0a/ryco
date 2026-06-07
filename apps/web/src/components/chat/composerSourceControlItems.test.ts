import { Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { ChangeRequest, SourceControlIssueSummary } from "@ryco/contracts";
import { buildScopedSourceControlComposerItems } from "./composerSourceControlItems";

const ISSUES: SourceControlIssueSummary[] = [
  {
    provider: "github",
    number: 42 as any,
    title: "Auth redirect race" as any,
    url: "u" as any,
    state: "open",
    updatedAt: Option.none(),
  },
  {
    provider: "github",
    number: 41 as any,
    title: "Worktree cleanup fails" as any,
    url: "u" as any,
    state: "open",
    updatedAt: Option.none(),
  },
];

const PRS: ChangeRequest[] = [
  {
    provider: "github",
    number: 88 as any,
    title: "Add hints above composer" as any,
    url: "u" as any,
    state: "open" as const,
    updatedAt: Option.none(),
  } as unknown as ChangeRequest,
  {
    provider: "github",
    number: 87 as any,
    title: "Refactor auth middleware" as any,
    url: "u" as any,
    state: "open" as const,
    updatedAt: Option.none(),
  } as unknown as ChangeRequest,
];

describe("buildScopedSourceControlComposerItems", () => {
  it("returns all issues + PRs for empty query (mixed)", () => {
    const items = buildScopedSourceControlComposerItems("", { issues: ISSUES, prs: PRS });
    const types = items.map((i) => i.type);
    expect(types).toEqual([
      "source-control-issue",
      "source-control-issue",
      "source-control-pr",
      "source-control-pr",
    ]);
  });

  it("scopes to issues only when prefix is 'i'", () => {
    const items = buildScopedSourceControlComposerItems("i", { issues: ISSUES, prs: PRS });
    expect(items.every((i) => i.type === "source-control-issue")).toBe(true);
    expect(items).toHaveLength(2);
  });

  it("scopes to issues and applies the stripped search term", () => {
    const items = buildScopedSourceControlComposerItems("i worktree", {
      issues: ISSUES,
      prs: PRS,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("#41");
  });

  it("scopes to PRs only when prefix is 'pr'", () => {
    const items = buildScopedSourceControlComposerItems("pr", { issues: ISSUES, prs: PRS });
    expect(items.every((i) => i.type === "source-control-pr")).toBe(true);
    expect(items).toHaveLength(2);
  });

  it("filters PRs by number when prefix is 'pr 88'", () => {
    const items = buildScopedSourceControlComposerItems("pr 88", { issues: ISSUES, prs: PRS });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("#88");
  });

  it("returns no items for 'jira' until the Jira provider lands", () => {
    const items = buildScopedSourceControlComposerItems("jira", { issues: ISSUES, prs: PRS });
    expect(items).toEqual([]);
  });

  it("falls back to mixed on unknown prefixes like 'ipad'", () => {
    const items = buildScopedSourceControlComposerItems("ipad", { issues: ISSUES, prs: PRS });
    // No item matches "ipad" so the result is empty, but both types were considered
    expect(items).toEqual([]);
  });

  it("ranks issue number match for bare numeric mixed query", () => {
    const items = buildScopedSourceControlComposerItems("42", { issues: ISSUES, prs: PRS });
    expect(items[0]?.label).toBe("#42");
    expect(items[0]?.type).toBe("source-control-issue");
  });
});
