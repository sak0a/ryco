import type { SendTurnComposerSnapshot, SendTurnSettings } from "./hooks/executeChatSendTurn";

// ---------------------------------------------------------------------------
// Message queue (client-owned)
//
// While a provider turn is running the composer queues follow-up messages
// instead of sending them; each queued item captures the full composer + settings
// snapshot so it can be replayed verbatim once the turn reaches quiescence. The
// array operations below are pure so the reorder/remove rules stay unit-testable.
// ---------------------------------------------------------------------------

export interface QueuedMessage {
  readonly id: string;
  readonly composer: SendTurnComposerSnapshot;
  readonly settings: SendTurnSettings;
}

/** Remove the queued message with the given id (no-op if absent). */
export function removeQueuedMessage(queue: readonly QueuedMessage[], id: string): QueuedMessage[] {
  return queue.filter((message) => message.id !== id);
}

/** Move a queued message up or down one slot; clamped at the ends. */
export function moveQueuedMessage(
  queue: readonly QueuedMessage[],
  id: string,
  direction: "up" | "down",
): QueuedMessage[] {
  const index = queue.findIndex((message) => message.id === id);
  if (index === -1) {
    return [...queue];
  }
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= queue.length) {
    return [...queue];
  }
  const next = [...queue];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved!);
  return next;
}

const QUEUED_MESSAGE_SUMMARY_MAX_CHARS = 120;

/** Short, single-line label for a queued message chip. */
export function summarizeQueuedMessage(message: QueuedMessage): string {
  const text = message.composer.trimmedPrompt.trim();
  if (text.length > 0) {
    return text.length > QUEUED_MESSAGE_SUMMARY_MAX_CHARS
      ? `${text.slice(0, QUEUED_MESSAGE_SUMMARY_MAX_CHARS - 1)}…`
      : text;
  }
  const imageCount = message.composer.images.length;
  if (imageCount > 0) {
    return imageCount === 1 ? "1 image" : `${imageCount} images`;
  }
  const contextCount = message.composer.sendableTerminalContexts.length;
  if (contextCount > 0) {
    return contextCount === 1 ? "1 terminal context" : `${contextCount} terminal contexts`;
  }
  return "Queued message";
}
