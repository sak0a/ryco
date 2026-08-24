import { describe, expect, it, vi } from "vite-plus/test";

import { acquireBeforeNodeSecurity } from "./acquireBeforeNodeSecurity";

describe("acquireBeforeNodeSecurity", () => {
  it("acquires the exact node before opening its security route", async () => {
    const calls: string[] = [];
    const acquireNode = vi.fn(async (nodeId: string) => {
      calls.push(`acquire:${nodeId}`);
    });
    const openSecurity = vi.fn(() => calls.push("open"));

    await acquireBeforeNodeSecurity({ nodeId: "node-b", acquireNode, openSecurity });

    expect(calls).toEqual(["acquire:node-b", "open"]);
  });

  it("does not open a disconnected security surface when acquisition fails", async () => {
    const openSecurity = vi.fn();

    await expect(
      acquireBeforeNodeSecurity({
        nodeId: "node-b",
        acquireNode: async () => {
          throw new Error("connection failed");
        },
        openSecurity,
      }),
    ).rejects.toThrow("connection failed");

    expect(openSecurity).not.toHaveBeenCalled();
  });
});
