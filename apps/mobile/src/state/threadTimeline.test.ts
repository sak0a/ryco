import type { Thread } from "@ryco/client-runtime/state/threads";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadTimeline } from "./threadTimelineModel";

function thread(overrides: Partial<Thread>): Thread {
  return {
    activities: [],
    messages: [],
    proposedPlans: [],
    latestTurn: null,
    session: null,
    ...overrides,
  } as unknown as Thread;
}

describe("buildThreadTimeline", () => {
  it("returns null for a missing thread", () => {
    expect(buildThreadTimeline(null)).toBeNull();
  });

  it("flows a proposed plan through the view model into a proposed-plan timeline entry", () => {
    const built = buildThreadTimeline(
      thread({
        proposedPlans: [
          {
            id: "plan-1",
            turnId: null,
            planMarkdown: "1. Do the thing",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-07-24T10:00:00.000Z",
            updatedAt: "2026-07-24T10:00:00.000Z",
          },
        ] as unknown as Thread["proposedPlans"],
      }),
    );

    expect(built).not.toBeNull();
    const planEntries = built!.timeline.filter((entry) => entry.kind === "proposed-plan");
    expect(planEntries).toHaveLength(1);
    expect(planEntries[0]!.id).toBe("plan-1");
  });

  it("orders a message and a proposed plan by createdAt", () => {
    const built = buildThreadTimeline(
      thread({
        messages: [
          {
            id: "msg-1",
            role: "user",
            createdAt: "2026-07-24T09:00:00.000Z",
          },
        ] as unknown as Thread["messages"],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: null,
            planMarkdown: "later",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-07-24T10:00:00.000Z",
            updatedAt: "2026-07-24T10:00:00.000Z",
          },
        ] as unknown as Thread["proposedPlans"],
      }),
    );

    const kinds = built!.timeline.map((entry) => entry.kind);
    expect(kinds).toEqual(["message", "proposed-plan"]);
  });
});
