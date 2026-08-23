import type { Thread } from "@ryco/client-runtime/state/threads";
import {
  deriveThreadActivityViewModel,
  deriveTimelineEntries,
  type ThreadActivityViewModel,
  type TimelineEntry,
} from "@ryco/client-runtime/state/session";

// §2.3 pt3 (pure): the thread timeline derived from runtime A's session logic.
// Kept free of react / the zustand store so it stays node-testable (the hook in
// threadTimeline.ts wires it to the store). Two pure runtime steps —
// deriveThreadActivityViewModel then deriveTimelineEntries. DO NOT port upstream
// threadActivity.ts.

export interface ThreadTimeline {
  readonly viewModel: ThreadActivityViewModel;
  readonly timeline: ReadonlyArray<TimelineEntry>;
}

export function buildThreadTimeline(thread: Thread | null | undefined): ThreadTimeline | null {
  if (!thread) return null;
  const viewModel = deriveThreadActivityViewModel(
    thread.activities,
    thread.latestTurn?.turnId ?? null,
  );
  const timeline = deriveTimelineEntries(
    thread.messages,
    thread.proposedPlans,
    viewModel.workLogEntries,
    viewModel.contextCompactionEntries,
    viewModel.contextHandoffEntries,
  );
  return { viewModel, timeline };
}
