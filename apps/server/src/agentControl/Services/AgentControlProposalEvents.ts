/**
 * AgentControlProposalEvents - In-process change feed for Agent Control
 * proposals.
 *
 * The proposal store publishes here after every committed insert and state
 * transition, stamping each event with a per-process monotonic revision.
 * The WS approval surface subscribes and concatenates a database snapshot
 * with revision-filtered live events; because every event carries the full
 * proposal document, replayed or duplicated deliveries are harmless upserts.
 *
 * Revisions are not durable: they restart at zero with the process, and
 * every snapshot a client receives resets its dedupe baseline.
 *
 * @module AgentControlProposalEvents
 */
import type {
  AgentControlProposal,
  AgentControlProposalStreamProposalEvent,
} from "@ryco/contracts";
import { Context } from "effect";
import type { Effect, PubSub, Scope, Stream } from "effect";

/**
 * AgentControlProposalEventsShape - Service API for the proposal change feed.
 */
export interface AgentControlProposalEventsShape {
  /** Stamp the next revision onto `proposal` and publish the change event. */
  readonly publish: (
    proposal: AgentControlProposal,
  ) => Effect.Effect<AgentControlProposalStreamProposalEvent>;

  /** Revision of the most recently published event; `0` before any. */
  readonly currentRevision: Effect.Effect<number>;

  /**
   * Acquire a live subscription synchronously in the caller's fiber. Use
   * this (not `changes`) when a snapshot read follows: subscribing first
   * guarantees no event between snapshot and stream start is lost.
   */
  readonly subscribe: Effect.Effect<
    PubSub.Subscription<AgentControlProposalStreamProposalEvent>,
    never,
    Scope.Scope
  >;

  /** Change events from stream start; subscription is deferred to run time. */
  readonly changes: Stream.Stream<AgentControlProposalStreamProposalEvent>;
}

/**
 * AgentControlProposalEvents - Service tag for the proposal change feed.
 */
export class AgentControlProposalEvents extends Context.Service<
  AgentControlProposalEvents,
  AgentControlProposalEventsShape
>()("ryco/agentControl/Services/AgentControlProposalEvents") {}
