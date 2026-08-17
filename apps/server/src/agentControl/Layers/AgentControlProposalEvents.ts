import type { AgentControlProposalStreamProposalEvent } from "@ryco/contracts";
import { Effect, Layer, PubSub, Ref, Semaphore, Stream } from "effect";

import {
  AgentControlProposalEvents,
  type AgentControlProposalEventsShape,
} from "../Services/AgentControlProposalEvents.ts";

const makeAgentControlProposalEvents = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<AgentControlProposalStreamProposalEvent>();
  const revisionRef = yield* Ref.make(0);
  // Revision assignment and PubSub emission must be one atomic step:
  // without the lock, a fiber could reserve revision N, get preempted at an
  // op-budget boundary, and let a concurrent publisher emit N+1 first —
  // subscribers would then observe revisions out of order.
  const publishLock = yield* Semaphore.make(1);

  const publish: AgentControlProposalEventsShape["publish"] = (proposal) =>
    publishLock.withPermits(1)(
      Ref.modify(revisionRef, (revision) => {
        const nextRevision = revision + 1;
        const event = {
          version: 1 as const,
          type: "proposal" as const,
          revision: nextRevision,
          proposal,
        } satisfies AgentControlProposalStreamProposalEvent;
        return [event, nextRevision] as const;
      }).pipe(Effect.tap((event) => PubSub.publish(pubsub, event))),
    );

  return {
    publish,
    currentRevision: Ref.get(revisionRef),
    subscribe: PubSub.subscribe(pubsub),
    get changes() {
      return Stream.fromPubSub(pubsub);
    },
  } satisfies AgentControlProposalEventsShape;
});

export const AgentControlProposalEventsLive = Layer.effect(
  AgentControlProposalEvents,
  makeAgentControlProposalEvents,
);
