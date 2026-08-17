import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const THREAD_GOAL_OBJECTIVE_MAX_CHARS = 4_000;

export const ThreadGoalObjective = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_GOAL_OBJECTIVE_MAX_CHARS),
);
export type ThreadGoalObjective = typeof ThreadGoalObjective.Type;

export const ThreadGoalStatus = Schema.Literals([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);
export type ThreadGoalStatus = typeof ThreadGoalStatus.Type;

export const ThreadGoal = Schema.Struct({
  objective: ThreadGoalObjective,
  status: ThreadGoalStatus,
  tokenBudget: Schema.NullOr(PositiveInt),
  tokensUsed: NonNegativeInt,
  timeUsedSeconds: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadGoal = typeof ThreadGoal.Type;

export const ThreadGoalEventOrigin = Schema.Literals(["client", "provider"]);
export type ThreadGoalEventOrigin = typeof ThreadGoalEventOrigin.Type;
