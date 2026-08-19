import { describe, expect, it, vi } from "vitest";

import { retryAgentControlStartup } from "./agentControlStartupRetry";

describe("retryAgentControlStartup", () => {
  it("waits through the optimistic enable transition", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Agent Control is disabled."))
      .mockRejectedValueOnce(new Error("Agent Control is disabled."))
      .mockResolvedValue("ready");
    const sleep = vi.fn(async () => undefined);

    await expect(retryAgentControlStartup(operation, sleep)).resolves.toBe("ready");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 50);
    expect(sleep).toHaveBeenNthCalledWith(2, 100);
  });

  it("does not hide unrelated failures", async () => {
    const operation = vi.fn(async () => {
      throw new Error("Connection lost.");
    });
    const sleep = vi.fn(async () => undefined);

    await expect(retryAgentControlStartup(operation, sleep)).rejects.toThrow("Connection lost.");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
