import {
  CONTEXT_HANDOFF_ACTIVITY_KIND,
  ContextHandoffActivityPayload,
  type OrchestrationThreadActivity,
} from "@ryco/contracts";
import { Schema } from "effect";

export const CONTEXT_COMPACTION_ACTIVITY_KIND = "context-compaction";

const decodeContextHandoffActivityPayload = Schema.decodeUnknownSync(ContextHandoffActivityPayload);

export function isContextCompactionActivity(
  activity: Pick<OrchestrationThreadActivity, "kind">,
): boolean {
  return activity.kind === CONTEXT_COMPACTION_ACTIVITY_KIND;
}

export function isTerminalContextHandoffActivity(
  activity: Pick<OrchestrationThreadActivity, "kind" | "payload">,
): boolean {
  if (activity.kind !== CONTEXT_HANDOFF_ACTIVITY_KIND) {
    return false;
  }

  try {
    const payload = decodeContextHandoffActivityPayload(activity.payload);
    return (
      payload.status === "consumed" ||
      payload.status === "failed" ||
      payload.status === "delivery-uncertain"
    );
  } catch {
    return false;
  }
}

export function isThreadActivityMilestone(
  activity: Pick<OrchestrationThreadActivity, "kind" | "payload">,
): boolean {
  return isContextCompactionActivity(activity) || isTerminalContextHandoffActivity(activity);
}

/**
 * Input must already be sorted in display order. Keeps the recent activity cap
 * predictable while preserving long-lived timeline milestones.
 */
export function capThreadActivitiesPreservingMilestones<
  T extends Pick<OrchestrationThreadActivity, "id" | "kind" | "payload">,
>(activities: ReadonlyArray<T>, limit: number): T[] {
  if (activities.length <= limit) {
    return [...activities];
  }

  const recent = activities.slice(-limit);
  const recentIds = new Set(recent.map((activity) => activity.id));
  const preserved = activities.filter(
    (activity) => isThreadActivityMilestone(activity) && !recentIds.has(activity.id),
  );

  return preserved.length === 0 ? [...recent] : [...preserved, ...recent];
}
