import type { OrchestrationThreadActivity } from "@ryco/contracts";

function hasValidContextWindowPayload(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "context-window.updated") return false;
  if (activity.payload === null || typeof activity.payload !== "object") return false;
  const usedTokens = (activity.payload as Record<string, unknown>).usedTokens;
  return typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0;
}

/**
 * Context-window updates are current-context gauges rather than timeline history.
 * Keep the newest usable value while preserving every non-context activity in
 * its original order. A malformed newer update must not shadow an older valid
 * value.
 */
export function pruneStaleContextWindowActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  let latestValidIndex = -1;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity !== undefined && hasValidContextWindowPayload(activity)) {
      latestValidIndex = index;
      break;
    }
  }

  return activities.filter(
    (activity, index) => activity.kind !== "context-window.updated" || index === latestValidIndex,
  );
}
