import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const acquireNode = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../connection/hostedConnectionCoordinator", () => ({
  getMobileHostedConnectionCoordinator: () => ({ acquireNode }),
}));

import { acquireMobileHostedNode } from "./acquireNode";

describe("mobile hosted node acquisition", () => {
  beforeEach(() => acquireNode.mockClear());

  it("routes every selection actuator through the bounded coordinator", async () => {
    await acquireMobileHostedNode("node-1");

    expect(acquireNode).toHaveBeenCalledExactlyOnceWith("node-1");
  });
});
