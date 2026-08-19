import type {
  SourceControlChangeRequestDetail,
  SourceControlChangeRequestMergeMethod,
  SourceControlChangeRequestStack,
  SourceControlChangeRequestStackEntry,
} from "@ryco/contracts";

export type PullRequestStackAssessment = {
  readonly label:
    | "Ready to merge"
    | "Stack needs attention"
    | "Merge status pending"
    | "Mergeable with failing checks"
    | "Stack merged";
  readonly tone: "ready" | "blocked" | "pending" | "warning" | "complete";
  readonly mergeTargetCount: number;
  readonly canAttemptMerge: boolean;
  readonly blocker: string | null;
};

/** Entries affected by merging the selected PR, ordered from the base upwards. */
export function pullRequestStackTargetEntries(
  stack: SourceControlChangeRequestStack,
): ReadonlyArray<SourceControlChangeRequestStackEntry> {
  return stack.entries.filter(
    (entry) => entry.position <= stack.position && entry.state !== "merged",
  );
}

export function pullRequestStackEntriesTopDown(
  stack: SourceControlChangeRequestStack,
): ReadonlyArray<SourceControlChangeRequestStackEntry> {
  return stack.entries.toReversed();
}

export function assessPullRequestStack(
  stack: SourceControlChangeRequestStack,
): PullRequestStackAssessment {
  const targets = pullRequestStackTargetEntries(stack);
  if (targets.length === 0) {
    return {
      label: "Stack merged",
      tone: "complete",
      mergeTargetCount: 0,
      canAttemptMerge: false,
      blocker: null,
    };
  }

  const closed = targets.find((entry) => entry.state === "closed");
  if (closed) {
    return {
      label: "Stack needs attention",
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: `#${closed.number} is closed without being merged.`,
    };
  }

  const draft = targets.find((entry) => entry.isDraft);
  if (draft) {
    return {
      label: "Stack needs attention",
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: `#${draft.number} is still a draft.`,
    };
  }

  const conflicting = targets.find((entry) => {
    const mergeStateStatus = entry.mergeStateStatus?.trim().toUpperCase() ?? "";
    return (
      entry.mergeability === "conflicting" ||
      mergeStateStatus === "BLOCKED" ||
      mergeStateStatus === "DIRTY" ||
      mergeStateStatus === "DRAFT"
    );
  });
  if (conflicting) {
    return {
      label: "Stack needs attention",
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: `#${conflicting.number} is not ready to merge.`,
    };
  }

  if (targets.some((entry) => entry.mergeStateStatus?.trim().toUpperCase() === "UNSTABLE")) {
    return {
      label: "Mergeable with failing checks",
      tone: "warning",
      mergeTargetCount: targets.length,
      canAttemptMerge: true,
      blocker: null,
    };
  }

  const pending = targets.some((entry) => {
    const mergeStateStatus = entry.mergeStateStatus?.trim().toUpperCase() ?? "";
    return (
      entry.mergeability === "unknown" ||
      mergeStateStatus === "" ||
      mergeStateStatus === "BEHIND" ||
      mergeStateStatus === "UNKNOWN" ||
      mergeStateStatus === "PENDING" ||
      !["CLEAN", "HAS_HOOKS", "UNSTABLE", "BLOCKED", "DIRTY", "DRAFT"].includes(mergeStateStatus)
    );
  });
  if (pending) {
    return {
      label: "Merge status pending",
      tone: "pending",
      mergeTargetCount: targets.length,
      canAttemptMerge: true,
      blocker: null,
    };
  }

  return {
    label: "Ready to merge",
    tone: "ready",
    mergeTargetCount: targets.length,
    canAttemptMerge: true,
    blocker: null,
  };
}

export function pullRequestMergeBlocker(
  detail: Pick<
    SourceControlChangeRequestDetail,
    "isDraft" | "mergeability" | "stackMetadataIncomplete" | "state"
  >,
  stackAssessment: PullRequestStackAssessment | null,
): string | null {
  if (detail.stackMetadataIncomplete === true) {
    return "Stack details are temporarily unavailable. Refresh before merging.";
  }
  if (stackAssessment?.canAttemptMerge === false) {
    return stackAssessment.blocker ?? "This stack is not ready to merge.";
  }
  if (detail.state !== "open") return "Only open pull requests can be merged.";
  if (detail.isDraft) return "Mark this pull request ready for review before merging.";
  return detail.mergeability === "conflicting" ? "Resolve merge conflicts before merging." : null;
}

export function pullRequestMergeConfirmation(input: {
  readonly selectedNumber: number;
  readonly mergeMethod: SourceControlChangeRequestMergeMethod;
  readonly stack: SourceControlChangeRequestStack | null;
}): { readonly title: string; readonly description: string } {
  if (!input.stack) {
    return {
      title: "Merge pull request?",
      description: `This will merge #${input.selectedNumber} using ${input.mergeMethod}.`,
    };
  }
  const targetCount = pullRequestStackTargetEntries(input.stack).length;
  return {
    title: `Merge ${targetCount} ${targetCount === 1 ? "pull request" : "pull requests"}?`,
    description: `This will atomically merge ${targetCount} open ${targetCount === 1 ? "pull request" : "pull requests"} through #${input.selectedNumber} into ${input.stack.baseRefName} using ${input.mergeMethod}.${
      input.stack.position < input.stack.size
        ? " Higher pull requests will remain open and GitHub will retarget them."
        : ""
    }`,
  };
}

export function pullRequestMergeSuccessMessage(input: {
  readonly outcome: "merged" | "enqueued";
  readonly isStack: boolean;
}): { readonly title: string; readonly description: string } {
  if (input.outcome === "enqueued") {
    return {
      title: input.isStack ? "Stack added to merge queue" : "Pull request added to merge queue",
      description: "GitHub will update the pull request state when the queued merge completes.",
    };
  }
  return {
    title: input.isStack ? "Stack merged" : "Pull request merged",
    description: input.isStack
      ? "GitHub merged the selected portion of the stack."
      : "GitHub merged the pull request.",
  };
}
