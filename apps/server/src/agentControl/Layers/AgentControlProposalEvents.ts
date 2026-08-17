import type { AgentControlProposalStreamProposalEvent } from "@ryco/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import {
  AgentControlProposalEvents,
  type AgentControlProposalEventsShape,
} from "../Services/AgentControlProposalEvents.ts";

const makeAgentControlProposalEvents = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<AgentControlProposalStreamProposalEvent>();
  const revisionRef = yield* Ref.make(0);

  const publish: AgentControlProposalEventsShape["publish"] = (proposal) =>
    Ref.modify(revisionRef, (revision) => {
      const nextRevision = revision + 1;
      const event = {
        version: 1 as const,
        type: "proposal" as const,
        revision: nextRevision,
        proposal,
      } satisfies AgentControlProposalStreamProposalEvent;
      return [event, nextRevision] as const;
    }).pipe(Effect.tap((event) => PubSub.publish(pubsub, event)));

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
