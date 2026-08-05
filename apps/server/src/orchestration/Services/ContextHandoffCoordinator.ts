import type { OrchestrationEvent } from "@ryco/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export type ContextHandoffTurnStartEvent = Extract<
  OrchestrationEvent,
  { readonly type: "thread.turn-start-requested" }
>;

export interface ContextHandoffCoordinatorShape {
  /**
   * Prepare and dispatch the first turn for one durable handoff operation.
   * The implementation owns terminal failure projection and never throws an
   * operational failure back into the generic provider-turn path.
   */
  readonly processTurnStart: (event: ContextHandoffTurnStartEvent) => Effect.Effect<void>;

  /** Reconcile durable operations left in preparing/dispatching at startup. */
  readonly recover: () => Effect.Effect<void>;
}

export class ContextHandoffCoordinator extends Context.Service<
  ContextHandoffCoordinator,
  ContextHandoffCoordinatorShape
>()("ryco/orchestration/Services/ContextHandoffCoordinator") {}
