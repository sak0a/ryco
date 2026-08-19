import type { SourceControlChangeRequestStack } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assessPullRequestStack,
  pullRequestMergeBlocker,
  pullRequestMergeConfirmation,
  pullRequestMergeSuccessMessage,
  pullRequestStackEntriesTopDown,
  pullRequestStackTargetEntries,
} from "./pullRequestStack.logic.ts";

function stack(selectedPosition = 2): SourceControlChangeRequestStack {
  return {
    number: 7,
    size: 3,
    position: selectedPosition,
    baseRefName: "main",
    entries: [1, 2, 3].map((position) => ({
      position,
      number: 40 + position,
      title: `PR ${40 + position}`,
      url: `https://github.com/acme/ryco/pull/${40 + position}`,
      headRefName: `stack/${position}`,
      baseRefName: position === 1 ? "main" : `stack/${position - 1}`,
      state: "open" as const,
      isDraft: false,
      mergeability: "mergeable" as const,
      mergeStateStatus: "CLEAN",
    })),
  };
}

function patchBottom(
  value: SourceControlChangeRequestStack,
  patch: Partial<SourceControlChangeRequestStack["entries"][number]>,
): SourceControlChangeRequestStack {
  return {
    ...value,
    entries: value.entries.map((entry) => (entry.position === 1 ? { ...entry, ...patch } : entry)),
  };
}

describe("pull request stack targets", () => {
  it("counts bottom, middle, and top selections", () => {
    expect(pullRequestStackTargetEntries(stack(1))).toHaveLength(1);
    expect(pullRequestStackTargetEntries(stack(2))).toHaveLength(2);
    expect(pullRequestStackTargetEntries(stack(3))).toHaveLength(3);
  });

  it("excludes already merged lower entries", () => {
    const value = patchBottom(stack(3), { state: "merged" });
    expect(pullRequestStackTargetEntries(value).map((entry) => entry.number)).toEqual([42, 43]);
  });

  it("reverses only for top-down presentation", () => {
    expect(pullRequestStackEntriesTopDown(stack()).map((entry) => entry.number)).toEqual([
      43, 42, 41,
    ]);
  });
});

describe("stack readiness", () => {
  it.each([
    ["closed", { state: "closed" as const }],
    ["draft", { isDraft: true }],
    ["conflicting", { mergeability: "conflicting" as const }],
    ["blocked", { mergeStateStatus: "BLOCKED" }],
    ["dirty", { mergeStateStatus: "DIRTY" }],
    ["draft merge state", { mergeStateStatus: "DRAFT" }],
  ])("blocks a %s affected layer", (_label, patch) => {
    const value = patchBottom(stack(), patch);
    expect(assessPullRequestStack(value)).toMatchObject({
      tone: "blocked",
      canAttemptMerge: false,
    });
  });

  it("warns but permits UNSTABLE layers", () => {
    const value = patchBottom(stack(), { mergeStateStatus: "UNSTABLE" });
    expect(assessPullRequestStack(value)).toMatchObject({
      tone: "warning",
      canAttemptMerge: true,
    });
  });

  it.each([
    ["unknown mergeability", { mergeability: "unknown" as const }],
    ["missing state", { mergeStateStatus: null }],
    ["behind", { mergeStateStatus: "BEHIND" }],
  ])("permits a pending %s layer", (_label, patch) => {
    const value = patchBottom(stack(), patch);
    expect(assessPullRequestStack(value)).toMatchObject({
      tone: "pending",
      canAttemptMerge: true,
    });
  });

  it("blocks incomplete stack metadata and standalone conflicts", () => {
    expect(
      pullRequestMergeBlocker(
        {
          state: "open",
          mergeability: "mergeable",
          stackMetadataIncomplete: true,
          isDraft: false,
        },
        null,
      ),
    ).toContain("Refresh");
    expect(
      pullRequestMergeBlocker({ state: "open", mergeability: "conflicting", isDraft: false }, null),
    ).toContain("conflicts");
  });
});

describe("merge messaging", () => {
  it("explains a middle-stack atomic merge and retargeting", () => {
    const confirmation = pullRequestMergeConfirmation({
      selectedNumber: 42,
      mergeMethod: "squash",
      stack: stack(2),
    });
    expect(confirmation.title).toBe("Merge 2 pull requests?");
    expect(confirmation.description).toContain("atomically merge 2 open pull requests through #42");
    expect(confirmation.description).toContain("into main using squash");
    expect(confirmation.description).toContain("remain open and GitHub will retarget them");
  });

  it("distinguishes queued from completed success copy", () => {
    expect(pullRequestMergeSuccessMessage({ outcome: "enqueued", isStack: true }).title).toBe(
      "Stack added to merge queue",
    );
    expect(pullRequestMergeSuccessMessage({ outcome: "merged", isStack: true }).title).toBe(
      "Stack merged",
    );
  });
});
