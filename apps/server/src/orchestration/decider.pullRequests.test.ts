import { CommandId, PullRequestId, type OrchestrationCommand } from "@ryco/contracts";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel } from "./projector.ts";

describe("pull request orchestration decisions", () => {
  it("keeps viewer identity server-owned while producing a replayable event", async () => {
    const pullRequestId = PullRequestId.make("pr_canonical");
    const markedAt = DateTime.makeUnsafe("2026-08-08T12:00:00Z");
    const command: Extract<OrchestrationCommand, { type: "pull-request.mark-unread" }> = {
      type: "pull-request.mark-unread",
      commandId: CommandId.make("cmd-pr-unread"),
      pullRequestId,
      viewerKey: "session:viewer-a",
      markedAt,
      occurredAt: "2026-08-08T12:00:00.000Z",
    };

    const event = await Effect.runPromise(
      decideOrchestrationCommand({
        command,
        readModel: createEmptyReadModel(command.occurredAt),
      }),
    );

    expect(Array.isArray(event)).toBe(false);
    expect(event).toMatchObject({
      aggregateKind: "pull-request",
      aggregateId: pullRequestId,
      type: "pull-request.marked-unread",
      payload: { pullRequestId, viewerKey: "session:viewer-a", markedAt },
    });
  });
});
