import type { EnvironmentId } from "@ryco/contracts";

export interface SavedEnvironmentConnectionQueueItem {
  readonly environmentId: EnvironmentId;
  readonly lastConnectedAt?: string | null;
}

export function orderSavedEnvironmentConnectionQueue<T extends SavedEnvironmentConnectionQueueItem>(
  records: ReadonlyArray<T>,
  priorityEnvironmentIds: ReadonlySet<EnvironmentId> = new Set(),
): T[] {
  return [...records].toSorted((left, right) => {
    const leftPriority = priorityEnvironmentIds.has(left.environmentId);
    const rightPriority = priorityEnvironmentIds.has(right.environmentId);
    if (leftPriority !== rightPriority) {
      return leftPriority ? -1 : 1;
    }

    const leftConnectedAt = left.lastConnectedAt ?? "";
    const rightConnectedAt = right.lastConnectedAt ?? "";
    if (leftConnectedAt !== rightConnectedAt) {
      return rightConnectedAt.localeCompare(leftConnectedAt);
    }

    return String(left.environmentId).localeCompare(String(right.environmentId));
  });
}

export async function runSavedEnvironmentConnectionQueue<T>(
  records: ReadonlyArray<T>,
  options: {
    readonly concurrency: number;
    readonly connect: (record: T) => Promise<void>;
  },
): Promise<void> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const queue = [...records];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const record = queue.shift();
      if (!record) {
        return;
      }
      await options.connect(record);
    }
  });
  await Promise.all(workers);
}
