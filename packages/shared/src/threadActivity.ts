import type { OrchestrationThreadActivity } from "@ryco/contracts";

export const CONTEXT_COMPACTION_ACTIVITY_KIND = "context-compaction";

export function isContextCompactionActivity(
  activity: Pick<OrchestrationThreadActivity, "kind">,
): boolean {
  return activity.kind === CONTEXT_COMPACTION_ACTIVITY_KIND;
}

/**
 * Input must already be sorted in display order. Keeps the recent activity cap
 * predictable while preserving long-lived timeline milestones.
 */
export function capThreadActivitiesPreservingMilestones<
  T extends Pick<OrchestrationThreadActivity, "id" | "kind">,
>(activities: ReadonlyArray<T>, limit: number): T[] {
  if (activities.length <= limit) {
    return [...activities];
  }

  const recent = activities.slice(-limit);
  const recentIds = new Set(recent.map((activity) => activity.id));
  const preserved = activities.filter(
    (activity) => isContextCompactionActivity(activity) && !recentIds.has(activity.id),
  );

  return preserved.length === 0 ? [...recent] : [...preserved, ...recent];
}
