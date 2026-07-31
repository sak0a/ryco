import { describe, expect, it } from "vite-plus/test";

import { getQueuedThreadKeys, moveQueuedMessage } from "./logic.ts";

describe("message queue", () => {
  it("moves only the requested item by one position", () => {
    const queue = ["a", "b", "c"].map((id) => ({ id, composer: null, settings: null }));
    expect(moveQueuedMessage(queue, "b", "up").map((item) => item.id)).toEqual(["b", "a", "c"]);
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
