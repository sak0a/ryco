import {
  CONTEXT_HANDOFF_ACTIVITY_KIND,
  ContextHandoffActivityPayload,
  type ContextHandoffEndpointSnapshot,
  type ContextHandoffId,
  type ContextHandoffInspectionSummaryMetadata,
  type MessageId,
  type OrchestrationThreadActivity,
  type TurnId,
} from "@ryco/contracts";
import { Schema } from "effect";

export type ContextHandoffTimelineStatus = "consumed" | "failed" | "delivery-uncertain";

export interface ContextHandoffTimelineEntry {
  id: string;
  activityId: string;
  handoffId: ContextHandoffId;
  createdAt: string;
  turnId: TurnId | null;
  status: ContextHandoffTimelineStatus;
  targetMessageId: MessageId;
  targetTurnId: TurnId | null;
  sources: ReadonlyArray<ContextHandoffEndpointSnapshot>;
  target: ContextHandoffEndpointSnapshot;
  error?: string;
  inspection?: ContextHandoffInspectionSummaryMetadata;
}

const decodeContextHandoffActivityPayload = Schema.decodeUnknownSync(ContextHandoffActivityPayload);

/**
 * Validates the otherwise opaque activity payload and projects only terminal
 * handoff states. Internal preparation states intentionally have no timeline
 * representation.
 */
export function toContextHandoffTimelineEntry(
  activity: OrchestrationThreadActivity,
): ContextHandoffTimelineEntry | null {
  if (activity.kind !== CONTEXT_HANDOFF_ACTIVITY_KIND) {
    return null;
  }

  let payload;
  try {
    payload = decodeContextHandoffActivityPayload(activity.payload);
  } catch {
    return null;
  }

  if (
    payload.status !== "consumed" &&
    payload.status !== "failed" &&
    payload.status !== "delivery-uncertain"
  ) {
    return null;
  }

  return {
    id: `context-handoff:${activity.id}`,
    activityId: activity.id,
    handoffId: payload.handoffId,
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    status: payload.status,
    targetMessageId: payload.targetMessageId,
    targetTurnId: payload.targetTurnId ?? activity.turnId,
    sources: payload.sources,
    target: payload.target,
    ...(payload.inspection ? { inspection: payload.inspection } : {}),
    ...(payload.status === "failed" || payload.status === "delivery-uncertain"
      ? { error: payload.error }
      : {}),
  };
}
