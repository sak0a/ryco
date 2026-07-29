import * as Option from "effect/Option";

// Pure derivation of the "3/9" CI summary for a pull request.
//
// HONESTY, and it is the whole point of this module: apps/web's equivalent goes
// green whenever `checksFailed === 0` and calls that "passing" — which is also
// true when six of nine checks are merely QUEUED. Copying that by reflex would
// ship exactly the fabricated readiness the project forbids. Here, "passed" and
// "not yet failed" are different answers, and so are "no checks" and "we could
// not find out".
//
// The other trap: the rollup's `status` / `conclusion` are `Schema.Option`, so
// they decode to Effect `Option` values, NOT nullable strings. Reading them with
// `?? null` yields a truthy `{_tag: "None"}` and every check looks present.
// `optionText` below is the only way these should be read.

export type CheckSummaryState =
  | "passed"
  | "failed"
  | "running"
  | "queued"
  | "none"
  /** We asked and could not get an answer. Never render this as neutral-good. */
  | "unknown";

export interface CheckRollupItemInput {
  readonly name: string;
  readonly status: Option.Option<string> | string | null | undefined;
  readonly conclusion: Option.Option<string> | string | null | undefined;
}

export interface CheckSummary {
  readonly state: CheckSummaryState;
  /** Completed checks. */
  readonly completed: number;
  readonly total: number;
  readonly failed: number;
  /** "3/9", or null when there is nothing to count. */
  readonly countLabel: string | null;
  readonly label: string;
  readonly accessibilityLabel: string;
}

/** Reads an Effect Option, a plain string, or nothing, without lying about None. */
export function optionText(
  value: Option.Option<string> | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  return Option.isSome(value) ? String(value.value).trim() || null : null;
}

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);
const PASSED_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/**
 * `unknown` is the honest answer whenever the rollup could not be read — the
 * provider is unauthenticated, the RPC was refused, or it was never fetched.
 * Pass `available: false` for those; do NOT pass an empty array, which means
 * "this PR genuinely has no checks".
 */
export function buildCheckSummary(input: {
  readonly available: boolean;
  readonly items?: ReadonlyArray<CheckRollupItemInput> | null;
}): CheckSummary {
  if (!input.available || !input.items) {
    return {
      state: "unknown",
      completed: 0,
      total: 0,
      failed: 0,
      countLabel: null,
      label: "Checks unknown",
      accessibilityLabel: "Check status unknown. Ryco could not read it from the node.",
    };
  }

  const items = input.items;
  if (items.length === 0) {
    return {
      state: "none",
      completed: 0,
      total: 0,
      failed: 0,
      countLabel: null,
      label: "No checks",
      accessibilityLabel: "This pull request has no checks.",
    };
  }

  let completed = 0;
  let failed = 0;
  let running = 0;
  for (const item of items) {
    const status = optionText(item.status)?.toLocaleLowerCase() ?? null;
    const conclusion = optionText(item.conclusion)?.toLocaleLowerCase() ?? null;

    if (conclusion !== null) {
      completed += 1;
      if (FAILED_CONCLUSIONS.has(conclusion)) failed += 1;
      // A conclusion outside both sets is genuinely unrecognised; it counts as
      // completed but not as a pass, which keeps it out of the green branch.
      continue;
    }
    if (status === "in_progress" || status === "pending") running += 1;
  }

  const total = items.length;
  const countLabel = `${completed}/${total}`;

  // Order matters. A failure outranks everything: one red check is the answer
  // even if the rest are still going.
  if (failed > 0) {
    return {
      state: "failed",
      completed,
      total,
      failed,
      countLabel,
      label: `${failed} failing`,
      accessibilityLabel: `${failed} of ${total} checks failing. ${completed} of ${total} complete.`,
    };
  }

  if (completed < total) {
    const state: CheckSummaryState = running > 0 ? "running" : "queued";
    return {
      state,
      completed,
      total,
      failed: 0,
      countLabel,
      // Deliberately NOT "passing". Nothing has failed yet, which is not the
      // same claim, and this is the case web gets wrong.
      label: state === "running" ? "Checks running" : "Checks queued",
      accessibilityLabel: `${completed} of ${total} checks complete, none failing so far.`,
    };
  }

  const allPassed = items.every((item) => {
    const conclusion = optionText(item.conclusion)?.toLocaleLowerCase();
    return conclusion !== undefined && conclusion !== null && PASSED_CONCLUSIONS.has(conclusion);
  });

  return {
    state: allPassed ? "passed" : "failed",
    completed,
    total,
    failed: allPassed
      ? 0
      : total -
        items.filter((i) =>
          PASSED_CONCLUSIONS.has(optionText(i.conclusion)?.toLocaleLowerCase() ?? ""),
        ).length,
    countLabel,
    label: allPassed ? "Checks passed" : "Checks need attention",
    accessibilityLabel: allPassed
      ? `All ${total} checks passed.`
      : `${total} checks complete, some did not pass.`,
  };
}
