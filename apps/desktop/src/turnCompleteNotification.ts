import type { DesktopTurnCompleteNotification, EnvironmentId, ThreadId } from "@ryco/contracts";

// ---------------------------------------------------------------------------
// Turn-complete desktop notifications (pure helpers)
//
// The Electron main process wires these to `Notification`; keeping the payload
// validation and the "should we show it" decision here makes both unit-testable
// without an Electron runtime.
// ---------------------------------------------------------------------------

/** Guard against oversized notification bodies coming across the IPC boundary. */
const MAX_NOTIFICATION_BODY_CHARS = 240;

/**
 * Validate an untrusted IPC payload into a `DesktopTurnCompleteNotification`.
 * Returns `null` when the shape is unusable (missing thread id / title).
 */
export function parseTurnCompleteNotification(
  raw: unknown,
): DesktopTurnCompleteNotification | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const threadId = record.threadId;
  const title = record.title;
  if (typeof threadId !== "string" || threadId.trim().length === 0) {
    return null;
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    return null;
  }

  const environmentId =
    typeof record.environmentId === "string" && record.environmentId.length > 0
      ? (record.environmentId as EnvironmentId)
      : undefined;
  const body =
    typeof record.body === "string" && record.body.length > 0
      ? record.body.slice(0, MAX_NOTIFICATION_BODY_CHARS)
      : undefined;

  return {
    threadId: threadId as ThreadId,
    ...(environmentId ? { environmentId } : {}),
    title,
    ...(body ? { body } : {}),
  };
}

/**
 * Decide whether to surface a turn-complete notification. We only notify when
 * the window is unfocused and the platform supports native notifications.
 */
export function shouldShowTurnCompleteNotification(input: {
  readonly windowFocused: boolean;
  readonly notificationsSupported: boolean;
}): boolean {
  if (input.windowFocused) {
    return false;
  }
  if (!input.notificationsSupported) {
    return false;
  }
  return true;
}
