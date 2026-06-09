import type { WorkItemActivityEntry, WorkItemComment } from "@ryco/contracts";

export type WorkItemActivityFilter = "comments" | "history" | "transitions" | "all";

export interface WorkItemActivityCounts {
  readonly comments: number;
  readonly history: number;
  readonly transitions: number;
  readonly all: number;
}

const TRANSITION_FIELD_RE = /status|transition|resolution/u;

export function isWorkItemTransitionActivity(entry: WorkItemActivityEntry): boolean {
  return entry.items.some((item) => TRANSITION_FIELD_RE.test(item.field.trim().toLowerCase()));
}

export function workItemActivityCounts(input: {
  readonly comments: ReadonlyArray<WorkItemComment>;
  readonly activity: ReadonlyArray<WorkItemActivityEntry>;
}): WorkItemActivityCounts {
  let transitions = 0;
  let history = 0;
  for (const entry of input.activity) {
    if (isWorkItemTransitionActivity(entry)) transitions += 1;
    else history += 1;
  }
  return {
    comments: input.comments.length,
    history,
    transitions,
    all: input.comments.length + input.activity.length,
  };
}

export function filterWorkItemActivityEntries(input: {
  readonly activity: ReadonlyArray<WorkItemActivityEntry>;
  readonly filter: WorkItemActivityFilter;
}): ReadonlyArray<WorkItemActivityEntry> {
  switch (input.filter) {
    case "history":
      return input.activity.filter((entry) => !isWorkItemTransitionActivity(entry));
    case "transitions":
      return input.activity.filter(isWorkItemTransitionActivity);
    case "all":
      return input.activity;
    case "comments":
      return [];
  }
}
