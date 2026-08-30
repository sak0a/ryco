/**
 * ThreadDeletionReactor - Thread deletion cleanup reactor service interface.
 *
 * Owns background workers that react to thread deletion domain events and
 * perform best-effort runtime cleanup for provider sessions and terminals.
 *
 * @module ThreadDeletionReactor
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

/**
 * ThreadDeletionReactorShape - Service API for thread deletion cleanup.
 */
export interface ThreadDeletionReactorShape {
  /**
   * Start reacting to thread.deleted orchestration domain events.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves once every deletion at or before the supplied event sequence has
   * reached the worker and the worker is empty and idle. A successful create
   * event is the fence before a new incarnation may own runtime resources.
   */
  readonly drainThrough: (sequence: number) => Effect.Effect<void>;
}

/**
 * ThreadDeletionReactor - Service tag for thread deletion cleanup workers.
 */
export class ThreadDeletionReactor extends Context.Service<
  ThreadDeletionReactor,
  ThreadDeletionReactorShape
>()("ryco/orchestration/Services/ThreadDeletionReactor") {}
