import { describe, expect, it } from "vite-plus/test";
import { buildItemActionPrompt } from "./itemActionPrompts";

describe("buildItemActionPrompt", () => {
  it("names the base branch for conflict resolution", () => {
    const prompt = buildItemActionPrompt({
      kind: "pr-conflicts",
      baseBranch: "main",
      reusesExistingCheckout: false,
    });
    expect(prompt).toContain("merge conflicts with main");
    expect(prompt).not.toContain("git status");
  });

  it("lists failing checks when known", () => {
    const prompt = buildItemActionPrompt({
      kind: "pr-checks",
      failingChecks: ["build", "typecheck"],
      reusesExistingCheckout: false,
    });
    expect(prompt).toContain("(build, typecheck)");
  });

  it("appends the dirty-checkout instruction when reusing a checkout", () => {
    for (const kind of [
      "pr-conflicts",
      "pr-review",
      "pr-checks",
      "implement-issue",
      "implement-work-item",
    ] as const) {
      const prompt = buildItemActionPrompt({ kind, reusesExistingCheckout: true });
      expect(prompt).toContain("git status");
    }
  });

  it("references the attached context for review feedback", () => {
    const prompt = buildItemActionPrompt({ kind: "pr-review", reusesExistingCheckout: false });
    expect(prompt).toContain("review comments in the attached context");
  });
});
