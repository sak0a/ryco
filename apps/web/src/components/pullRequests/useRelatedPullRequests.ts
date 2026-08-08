import {
  selectPullRequestsForSubject,
  usePullRequestStore,
} from "@ryco/client-runtime/state/pullRequests";
import type { PullRequestInboxItem } from "@ryco/contracts";
import { Option } from "effect";
import { useShallow } from "zustand/react/shallow";

const relationshipPriority = {
  "current-branch": 0,
  created: 1,
  "opened-existing": 2,
  "explicitly-attached": 3,
  inspected: 4,
  mentioned: 5,
} as const;

function activeRelationshipPriority(
  item: PullRequestInboxItem,
  subjectKind: "thread" | "worktree",
  subjectId: string,
): number {
  return item.associations.reduce((priority, association) => {
    if (Option.isSome(association.endedAt) || association.subject.kind !== subjectKind) {
      return priority;
    }
    const matches =
      association.subject.kind === "thread"
        ? association.subject.threadId === subjectId
        : association.subject.worktreeId === subjectId;
    return matches ? Math.min(priority, relationshipPriority[association.relationship]) : priority;
  }, Number.POSITIVE_INFINITY);
}

export function hasActivePullRequestRelationship(
  item: PullRequestInboxItem,
  subjectKind: "thread" | "worktree",
  subjectId: string,
  relationship: PullRequestInboxItem["associations"][number]["relationship"],
): boolean {
  return item.associations.some((association) => {
    if (
      association.relationship !== relationship ||
      Option.isSome(association.endedAt) ||
      association.subject.kind !== subjectKind
    ) {
      return false;
    }
    return association.subject.kind === "thread"
      ? association.subject.threadId === subjectId
      : association.subject.worktreeId === subjectId;
  });
}

export function useRelatedPullRequests(
  subjectKind: "thread" | "worktree",
  subjectId: string | null | undefined,
): ReadonlyArray<PullRequestInboxItem> {
  return usePullRequestStore(
    useShallow((state) => {
      if (!subjectId) return [];
      return selectPullRequestsForSubject(state, subjectKind, subjectId).toSorted(
        (left, right) =>
          activeRelationshipPriority(left, subjectKind, subjectId) -
          activeRelationshipPriority(right, subjectKind, subjectId),
      );
    }),
  );
}
