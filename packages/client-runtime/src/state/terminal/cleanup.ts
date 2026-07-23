export interface TerminalRetentionThread {
  readonly key: string;
  readonly deletedAt: string | null;
  readonly archivedAt: string | null;
}

export interface CollectActiveTerminalThreadIdsInput {
  readonly snapshotThreads: readonly TerminalRetentionThread[];
  readonly draftThreadKeys: Iterable<string>;
}

export function collectActiveTerminalThreadIds(
  input: CollectActiveTerminalThreadIdsInput,
): Set<string> {
  const activeThreadIds = new Set<string>();
  const snapshotThreadById = new Map(input.snapshotThreads.map((thread) => [thread.key, thread]));
  for (const thread of input.snapshotThreads) {
    if (thread.deletedAt !== null || thread.archivedAt !== null) continue;
    activeThreadIds.add(thread.key);
  }
  for (const draftThreadKey of input.draftThreadKeys) {
    const snapshotThread = snapshotThreadById.get(draftThreadKey);
    if (
      snapshotThread &&
      (snapshotThread.deletedAt !== null || snapshotThread.archivedAt !== null)
    ) {
      continue;
    }
    activeThreadIds.add(draftThreadKey);
  }
  return activeThreadIds;
}
