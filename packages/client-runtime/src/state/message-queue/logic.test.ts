import { describe, expect, it } from "vite-plus/test";

import { moveQueuedMessage } from "./logic.ts";

describe("message queue", () => {
  it("moves only the requested item by one position", () => {
    const queue = ["a", "b", "c"].map((id) => ({ id, composer: null, settings: null }));
    expect(moveQueuedMessage(queue, "b", "up").map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});
