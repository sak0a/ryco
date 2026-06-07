import { describe, expect, it } from "vite-plus/test";
import { resolveHintRowPills, type HintRowFlags } from "./ComposerHintRow.logic";

const all: HintRowFlags = { hasSourceControlRemote: true, hasJiraProvider: true };

describe("resolveHintRowPills", () => {
  it("returns all four pills when every flag is true", () => {
    const pills = resolveHintRowPills(all);
    expect(pills.map((p) => p.id)).toEqual([
      "reference-issue",
      "reference-pr",
      "reference-jira",
      "browse-commands",
    ]);
  });

  it("hides issue/PR when source-control remote is missing", () => {
    const pills = resolveHintRowPills({ hasSourceControlRemote: false, hasJiraProvider: true });
    expect(pills.map((p) => p.id)).toEqual(["reference-jira", "browse-commands"]);
  });

  it("hides Jira when no Jira provider is configured", () => {
    const pills = resolveHintRowPills({ hasSourceControlRemote: true, hasJiraProvider: false });
    expect(pills.map((p) => p.id)).toEqual(["reference-issue", "reference-pr", "browse-commands"]);
  });

  it("returns only browse-commands when both providers are absent", () => {
    const pills = resolveHintRowPills({ hasSourceControlRemote: false, hasJiraProvider: false });
    expect(pills.map((p) => p.id)).toEqual(["browse-commands"]);
  });

  it("each pill exposes the trigger text it inserts", () => {
    const pills = resolveHintRowPills(all);
    expect(Object.fromEntries(pills.map((p) => [p.id, p.trigger]))).toEqual({
      "reference-issue": "#i",
      "reference-pr": "#pr",
      "reference-jira": "#jira",
      "browse-commands": "/",
    });
  });
});
