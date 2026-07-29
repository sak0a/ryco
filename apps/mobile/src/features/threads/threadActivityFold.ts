import { formatDuration } from "@ryco/client-runtime/state/session";
import type { TimelineEntry, WorkLogEntry } from "@ryco/client-runtime/state/session";

// Collapses consecutive activity into one foldable row.
//
// Before this, every work entry rendered as a single line of mono text showing
// only `entry.entry.label` — so a turn that ran a command and three tools read
// as "Command run / Tool call / Tool call / Tool call", four lines carrying no
// command, no file, no duration and no exit status, with nothing to expand.
// Everything below already existed on `WorkLogEntry` and was dropped on the
// floor.
//
// This is a mobile-shaped port rather than a hoist of web's `deriveTurnFolds`.
// That function returns a `Map<string, TurnFold>` keyed for web's
// `MessagesTimelineRow` pipeline, which mobile does not have — mobile feeds
// `TimelineEntry[]` straight to LegendList. The wording, the grouping key
// (`turnId`) and the running/settled split are kept identical so the two
// clients describe the same turn the same way.

export type ActivityTone = WorkLogEntry["tone"];

export interface ActivityRow {
  readonly id: string;
  readonly heading: string;
  readonly detail: string | null;
  /** Command preview, already trimmed to one line. */
  readonly command: string | null;
  readonly output: string | null;
  readonly exitCode: number | null;
  readonly changedFiles: ReadonlyArray<string>;
  readonly tone: ActivityTone;
  /** False while the activity is still running. */
  readonly completed: boolean;
}

export interface ActivityFold {
  readonly kind: "activity-fold";
  readonly id: string;
  readonly turnId: string | null;
  readonly status: "running" | "settled";
  /** "Working…" while live, "Worked for 12s" once settled. */
  readonly label: string;
  readonly rows: ReadonlyArray<ActivityRow>;
  readonly expanded: boolean;
}

export type ThreadTimelineRow =
  | { readonly kind: "entry"; readonly id: string; readonly entry: TimelineEntry }
  | ActivityFold;

function firstLine(value: string | undefined): string | null {
  if (!value) return null;
  const line = value.split("\n").find((candidate) => candidate.trim().length > 0);
  return line?.trim() || null;
}

function toRow(entry: WorkLogEntry): ActivityRow {
  return {
    id: entry.id,
    // `toolTitle` is the tool's own name; `label` is the generic fallback
    // ("Tool call") that used to be the ONLY thing rendered.
    heading: entry.toolTitle?.trim() || entry.label,
    detail: entry.detail?.trim() || null,
    command: firstLine(entry.command ?? entry.rawCommand),
    output: entry.output?.trim() || null,
    exitCode: entry.exitCode ?? null,
    changedFiles: entry.changedFiles ?? [],
    tone: entry.tone,
    completed: entry.completed !== false,
  };
}

function elapsedMs(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

/**
 * Groups CONSECUTIVE work entries. Consecutive matters: a turn whose activity
 * is interrupted by an assistant message produces two folds, which is what the
 * user saw happen.
 *
 * A fold is only emitted when it actually has rows. Work entries exist only for
 * the latest turn — `session-logic` drops activities whose `turnId` is not the
 * latest — so folds over scrollback would otherwise be empty shells.
 */
export function buildThreadTimelineRows(input: {
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly runningTurnId: string | null;
  readonly expandedFoldIds: ReadonlySet<string>;
  readonly now: string;
}): ReadonlyArray<ThreadTimelineRow> {
  const rows: ThreadTimelineRow[] = [];
  let pending: WorkLogEntry[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const group = pending;
    pending = [];

    const turnId = group.find((entry) => entry.turnId)?.turnId ?? null;
    const running = turnId !== null && turnId === input.runningTurnId;
    const foldId = `fold:${turnId ?? group[0]?.id ?? rows.length}`;
    const startedAt = group[0]?.createdAt ?? null;
    const endedAt = group.at(-1)?.createdAt ?? null;

    // A running fold measures to NOW so the timer advances; a settled one
    // measures to its own last entry.
    const duration =
      startedAt === null
        ? null
        : elapsedMs(startedAt, running ? input.now : (endedAt ?? input.now));

    rows.push({
      kind: "activity-fold",
      id: foldId,
      turnId,
      status: running ? "running" : "settled",
      label: running
        ? "Working…"
        : duration === null
          ? "Worked"
          : `Worked for ${formatDuration(duration)}`,
      rows: group.map(toRow),
      // Settled folds collapse to save space; the RUNNING one stays open,
      // because live progress is the main reason to have the phone open.
      // Once opened or closed by hand, the user's choice wins.
      expanded: input.expandedFoldIds.has(foldId)
        ? true
        : running && !input.expandedFoldIds.has(`collapsed:${foldId}`),
    });
  };

  for (const entry of input.entries) {
    if (entry.kind === "work") {
      pending.push(entry.entry);
      continue;
    }
    flush();
    rows.push({ kind: "entry", id: entry.id, entry });
  }
  flush();

  return rows;
}

/**
 * Toggling has to record BOTH directions explicitly: "expanded" cannot be a
 * plain set, because a running fold defaults to open and collapsing it must
 * stick. `collapsed:<id>` is the negative marker.
 */
export function toggleFold(
  expandedFoldIds: ReadonlySet<string>,
  fold: ActivityFold,
): ReadonlySet<string> {
  const next = new Set(expandedFoldIds);
  if (fold.expanded) {
    next.delete(fold.id);
    next.add(`collapsed:${fold.id}`);
  } else {
    next.delete(`collapsed:${fold.id}`);
    next.add(fold.id);
  }
  return next;
}
