/**
 * Picks the project the global "New thread" button starts in, as a project key
 * the caller resolves back to its own (branded) project record.
 *
 * "Last used" is derived from visit timestamps rather than tracked as its own
 * persisted field: the sidebar already records when each thread was last
 * opened, and the project of the most recently opened thread *is* the project
 * you last worked in. One source of truth, nothing extra to keep in sync.
 */

export interface NewThreadTargetThread {
  readonly archivedAt: string | null;
  readonly updatedAt?: string | undefined;
  readonly createdAt: string;
}

function lastTouchedAt(thread: NewThreadTargetThread, lastVisitedAt: number | null): number {
  const updated = thread.updatedAt ? Date.parse(thread.updatedAt) : Number.NaN;
  const created = Date.parse(thread.createdAt);
  return Math.max(
    lastVisitedAt ?? Number.NEGATIVE_INFINITY,
    Number.isNaN(updated) ? Number.NEGATIVE_INFINITY : updated,
    Number.isNaN(created) ? Number.NEGATIVE_INFINITY : created,
  );
}

export function resolveNewThreadProjectKey<TThread extends NewThreadTargetThread>(input: {
  /** Every project key currently shown in the sidebar, in display order. */
  readonly orderedProjectKeys: ReadonlyArray<string>;
  readonly threads: ReadonlyArray<TThread>;
  /** Scoped thread key -> last-visited epoch ms. */
  readonly lastVisitedAtByThreadKey: ReadonlyMap<string, number | null>;
  readonly threadKey: (thread: TThread) => string;
  /** The key of the project a thread belongs to, in the same key space. */
  readonly threadProjectKey: (thread: TThread) => string;
}): string | null {
  const { orderedProjectKeys, threads, lastVisitedAtByThreadKey, threadKey, threadProjectKey } =
    input;
  if (orderedProjectKeys.length === 0) {
    return null;
  }

  const knownProjectKeys = new Set(orderedProjectKeys);
  let best: { projectKey: string; at: number } | null = null;
  for (const thread of threads) {
    if (thread.archivedAt !== null) {
      continue;
    }
    const candidate = threadProjectKey(thread);
    // A thread can outlive its project (removed from the sidebar while its
    // history stays on disk); those must not win the vote.
    if (!knownProjectKeys.has(candidate)) {
      continue;
    }
    const at = lastTouchedAt(thread, lastVisitedAtByThreadKey.get(threadKey(thread)) ?? null);
    if (at === Number.NEGATIVE_INFINITY) {
      continue;
    }
    if (!best || at > best.at) {
      best = { projectKey: candidate, at };
    }
  }

  // No thread history yet: fall back to the first project in sidebar order so
  // the button is never a dead end on a fresh install.
  return best?.projectKey ?? orderedProjectKeys[0] ?? null;
}
