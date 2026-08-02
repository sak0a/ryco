/**
 * The queue is deliberately independent of the UI send pipeline. The caller
 * owns the snapshot shape, while the runtime owns its ordering semantics.
 */
export interface QueuedMessage<Composer = unknown, Settings = unknown> {
  readonly id: string;
  readonly composer: Composer;
  readonly settings: Settings;
}

export function removeQueuedMessage<Composer, Settings>(
  queue: readonly QueuedMessage<Composer, Settings>[],
  id: string,
): QueuedMessage<Composer, Settings>[] {
  return queue.filter((message) => message.id !== id);
}

export function moveQueuedMessage<Composer, Settings>(
  queue: readonly QueuedMessage<Composer, Settings>[],
  id: string,
  direction: "up" | "down",
): QueuedMessage<Composer, Settings>[] {
  const index = queue.findIndex((message) => message.id === id);
  if (index === -1) return [...queue];

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= queue.length) return [...queue];

  const next = [...queue];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved!);
  return next;
}

export interface QueuedMessageSummaryInput {
  readonly trimmedPrompt: string;
  readonly imageCount: number;
  readonly terminalContextCount: number;
}

export function getQueuedThreadKeys<Composer, Settings>(
  queuesByThreadKey: Readonly<Record<string, readonly QueuedMessage<Composer, Settings>[]>>,
): Set<string> {
  return new Set(
    Object.entries(queuesByThreadKey).flatMap(([threadKey, queue]) =>
      queue.length > 0 ? [threadKey] : [],
    ),
  );
}

const QUEUED_MESSAGE_SUMMARY_MAX_CHARS = 120;

export function summarizeQueuedMessage(input: QueuedMessageSummaryInput): string {
  const text = input.trimmedPrompt.trim();
  if (text.length > 0) {
    return text.length > QUEUED_MESSAGE_SUMMARY_MAX_CHARS
      ? `${text.slice(0, QUEUED_MESSAGE_SUMMARY_MAX_CHARS - 1)}…`
      : text;
  }
  if (input.imageCount > 0)
    return input.imageCount === 1 ? "1 image" : `${input.imageCount} images`;
  if (input.terminalContextCount > 0) {
    return input.terminalContextCount === 1
      ? "1 terminal context"
      : `${input.terminalContextCount} terminal contexts`;
  }
  return "Queued message";
}
