import { describe, expect, it } from "vite-plus/test";

import { buildChangeRequestBadge } from "./changeRequestBadge";

type Source = NonNullable<Parameters<typeof buildChangeRequestBadge>[0]>;

const EMPTY: Source = {
  prNumber: null,
  prState: null,
  prIsDraft: null,
  issueNumber: null,
  issueState: null,
  workItemKey: null,
  workItemState: null,
  workItemStateName: null,
};

function badge(overrides: Partial<Source> = {}) {
  return buildChangeRequestBadge({ ...EMPTY, ...overrides });
}

describe("change request badge", () => {
  it("renders nothing when a worktree has no linked work", () => {
    expect(badge()).toBeNull();
    expect(buildChangeRequestBadge(null)).toBeNull();
    expect(buildChangeRequestBadge(undefined)).toBeNull();
  });

  it("tones a pull request by its state", () => {
    expect(badge({ prNumber: 42, prState: "open" })?.tone).toBe("open");
    expect(badge({ prNumber: 42, prState: "merged" })?.tone).toBe("merged");
    expect(badge({ prNumber: 42, prState: "closed" })?.tone).toBe("closed");
    expect(badge({ prNumber: 42, prState: null })?.tone).toBe("neutral");
  });

  it("labels a pull request by number", () => {
    expect(badge({ prNumber: 42, prState: "open" })?.label).toBe("#42");
  });

  it("treats draft as a modifier on open, not a state of its own", () => {
    expect(badge({ prNumber: 7, prState: "open", prIsDraft: true })?.tone).toBe("draft");
    // A merged or closed PR is not a draft, whatever the stale flag says.
    expect(badge({ prNumber: 7, prState: "merged", prIsDraft: true })?.tone).toBe("merged");
    expect(badge({ prNumber: 7, prState: "closed", prIsDraft: true })?.tone).toBe("closed");
  });

  it("says the state is last known, every time", () => {
    for (const input of [
      { prNumber: 1, prState: "open" as const },
      { workItemKey: "RYC-8" },
      { issueNumber: 3, issueState: "open" as const },
    ]) {
      expect(badge(input)?.accessibilityLabel).toContain("Last known state.");
    }
  });

  it("names an unknown state rather than implying a good one", () => {
    expect(badge({ prNumber: 9, prState: null })?.accessibilityLabel).toContain("state unknown");
    expect(badge({ issueNumber: 9, issueState: null })?.accessibilityLabel).toContain(
      "state unknown",
    );
  });

  it("prefers a pull request over a work item over an issue", () => {
    const all = badge({
      prNumber: 42,
      prState: "open",
      workItemKey: "RYC-8",
      issueNumber: 3,
      issueState: "open",
    });
    expect(all?.label).toBe("#42");

    const noPr = badge({ workItemKey: "RYC-8", issueNumber: 3, issueState: "open" });
    expect(noPr?.label).toBe("RYC-8");

    const issueOnly = badge({ issueNumber: 3, issueState: "open" });
    expect(issueOnly?.label).toBe("#3");
  });

  it("uses the human work-item state name when the tracker supplies one", () => {
    const withName = badge({
      workItemKey: "RYC-8",
      workItemState: "in_progress",
      workItemStateName: "In Review",
    });
    expect(withName?.accessibilityLabel).toContain("In Review");
    expect(withName?.tone).toBe("open");

    const withoutName = badge({ workItemKey: "RYC-8", workItemState: "in_progress" });
    expect(withoutName?.accessibilityLabel).toContain("in_progress");
  });

  it("maps work-item states onto the same tones as a pull request", () => {
    expect(badge({ workItemKey: "A-1", workItemState: "done" })?.tone).toBe("merged");
    expect(badge({ workItemKey: "A-1", workItemState: "closed" })?.tone).toBe("closed");
    expect(badge({ workItemKey: "A-1", workItemState: "unknown" })?.tone).toBe("neutral");
    expect(badge({ workItemKey: "A-1", workItemState: null })?.tone).toBe("neutral");
  });

  it("ignores a blank work-item state name", () => {
    const blank = badge({ workItemKey: "A-1", workItemState: "open", workItemStateName: "   " });
    expect(blank?.accessibilityLabel).toContain("open");
  });

  it("renders PR #0 rather than treating it as absent", () => {
    // `0` is falsy; the guard has to be an explicit null check.
    expect(badge({ prNumber: 0, prState: "open" })?.label).toBe("#0");
    expect(badge({ issueNumber: 0, issueState: "open" })?.label).toBe("#0");
  });
});
