import { describe, expect, it } from "vite-plus/test";
import type { CommandId, MessageId, ModelSelection, ThreadId, TurnId } from "@ryco/contracts";

import {
  buildQueuedMessageSteerCommand,
  getQueuedThreadKeys,
  moveQueuedMessage,
  resolveQueuedMessageSteerEligibility,
} from "./logic.ts";

const activeSelection = {
  instanceId: "codex-main",
  model: "gpt-5.6-codex",
  options: [{ id: "reasoningEffort", value: "high" }],
} as unknown as ModelSelection;

const steerable = {
  mutationReady: true,
  turnRunning: true,
  activeTurnId: "turn-active" as TurnId,
  supportsTurnSteering: true,
  queuedModelSelection: {
    instanceId: "codex-main",
    model: "gpt-5.6-codex",
    options: [{ id: "reasoningEffort", value: "high" }],
  } as unknown as ModelSelection,
  activeModelSelection: activeSelection,
  queuedRuntimeMode: "full-access" as const,
  activeRuntimeMode: "full-access" as const,
  queuedInteractionMode: "default" as const,
  activeInteractionMode: "default" as const,
  queuedTokenMode: "balanced" as const,
  activeTokenMode: "balanced" as const,
};

describe("message queue", () => {
  it("moves only the requested item by one position", () => {
    const queue = ["a", "b", "c"].map((id) => ({ id, composer: null, settings: null }));
    expect(moveQueuedMessage(queue, "b", "up").map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("allows structurally matching queued settings on the exact active turn", () => {
    expect(resolveQueuedMessageSteerEligibility(steerable)).toEqual({
      allowed: true,
      expectedTurnId: "turn-active",
    });
  });

  it("builds the provider-neutral steer command without turn-start overrides", () => {
    expect(
      buildQueuedMessageSteerCommand({
        commandId: "command-steer" as CommandId,
        threadId: "thread-steer" as ThreadId,
        expectedTurnId: "turn-active" as TurnId,
        messageId: "message-steer" as MessageId,
        text: "Preserve the retry state.",
        attachments: [],
        createdAt: "2026-08-17T10:00:00.000Z",
        requestedAt: "2026-08-17T10:00:01.000Z",
      }),
    ).toEqual({
      type: "thread.turn.steer",
      commandId: "command-steer",
      threadId: "thread-steer",
      expectedTurnId: "turn-active",
      message: {
        messageId: "message-steer",
        role: "user",
        text: "Preserve the retry state.",
        attachments: [],
      },
      createdAt: "2026-08-17T10:00:00.000Z",
      requestedAt: "2026-08-17T10:00:01.000Z",
    });
  });

  it("explains unsupported, stale-setting, and disconnected steer attempts", () => {
    expect(
      resolveQueuedMessageSteerEligibility({ ...steerable, supportsTurnSteering: false }),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining("does not support") });
    expect(
      resolveQueuedMessageSteerEligibility({
        ...steerable,
        queuedTokenMode: "aggressive",
      }),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining("settings") });
    expect(
      resolveQueuedMessageSteerEligibility({ ...steerable, mutationReady: false }),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining("connection") });
  });

  it("returns only scoped keys with non-empty queues", () => {
    expect(
      getQueuedThreadKeys({
        "environment-a:thread-a": [{ id: "message", composer: null, settings: null }],
        "environment-a:thread-b": [],
      }),
    ).toEqual(new Set(["environment-a:thread-a"]));
  });
});
