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

interface PendingThreadRequestActivity {
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly id?: string | undefined;
  readonly activityId?: string | undefined;
  readonly sequence?: number | undefined;
}

export interface PendingThreadRequestState {
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}

function activityRequestId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("requestId" in payload)) {
    return null;
  }
  const requestId = (payload as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : null;
}

function activityFailureDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("detail" in payload)) {
    return null;
  }
  const detail = (payload as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail.toLowerCase() : null;
}

function isStaleRequestFailure(detail: string | null, requestKind: "approval" | "user-input") {
  if (detail === null) return false;
  if (requestKind === "approval") {
    return (
      detail.includes("stale pending approval request") ||
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  return (
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request")
  );
}

function comparePendingRequestActivities(
  left: PendingThreadRequestActivity,
  right: PendingThreadRequestActivity,
): number {
  const bySequence =
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
  if (bySequence !== 0) return bySequence;
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return (left.id ?? left.activityId ?? "").localeCompare(right.id ?? right.activityId ?? "");
}

export function derivePendingThreadRequestState(
  activities: ReadonlyArray<PendingThreadRequestActivity>,
): PendingThreadRequestState {
  const approvalIds = new Set<string>();
  const userInputIds = new Set<string>();

  for (const activity of activities.toSorted(comparePendingRequestActivities)) {
    const requestId = activityRequestId(activity.payload);
    if (requestId === null) continue;

    if (activity.kind === "approval.requested") {
      approvalIds.add(requestId);
    } else if (activity.kind === "approval.resolved") {
      approvalIds.delete(requestId);
    } else if (
      activity.kind === "provider.approval.respond.failed" &&
      isStaleRequestFailure(activityFailureDetail(activity.payload), "approval")
    ) {
      approvalIds.delete(requestId);
    } else if (activity.kind === "user-input.requested") {
      userInputIds.add(requestId);
    } else if (activity.kind === "user-input.resolved") {
      userInputIds.delete(requestId);
    } else if (
      activity.kind === "provider.user-input.respond.failed" &&
      isStaleRequestFailure(activityFailureDetail(activity.payload), "user-input")
    ) {
      userInputIds.delete(requestId);
    }
  }

  return {
    pendingApprovalCount: approvalIds.size,
    pendingUserInputCount: userInputIds.size,
    hasPendingApprovals: approvalIds.size > 0,
    hasPendingUserInput: userInputIds.size > 0,
  };
}
