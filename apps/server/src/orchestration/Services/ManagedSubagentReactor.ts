import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface ManagedSubagentReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class ManagedSubagentReactor extends Context.Service<
  ManagedSubagentReactor,
  ManagedSubagentReactorShape
>()("ryco/orchestration/Services/ManagedSubagentReactor") {}
