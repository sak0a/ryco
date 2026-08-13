import { describe, expect, it, vi } from "vitest";

import {
  cancelVerifiedEmailAttempt,
  verifiedEmailCancellation,
} from "./nativeIdentityCancellation";

describe("verified native identity cancellation", () => {
  it("uses the post-verification activation secret", () => {
    expect(
      verifiedEmailCancellation({
        status: "new_account",
        attemptId: "nident_aaaaaaaaaaaaaaaaaaaaaa",
        activationSecret: "activation-secret",
        issuedAt: 1,
        expiresAt: 2,
      } as never),
    ).toEqual({
      attemptId: "nident_aaaaaaaaaaaaaaaaaaaaaa",
      attemptSecret: "activation-secret",
    });
  });

  it("does not let cleanup failure hide the verified outcome", async () => {
    const cancelNativeIdentityAttempt = vi.fn().mockRejectedValue(new Error("unavailable"));
    const response = {
      status: "new_account",
      attemptId: "nident_aaaaaaaaaaaaaaaaaaaaaa",
      activationSecret: "activation-secret",
      issuedAt: 1,
      expiresAt: 2,
    } as never;

    await expect(
      cancelVerifiedEmailAttempt({ cancelNativeIdentityAttempt }, response),
    ).resolves.toBeUndefined();
    expect(cancelNativeIdentityAttempt).toHaveBeenCalledWith({
      attemptId: "nident_aaaaaaaaaaaaaaaaaaaaaa",
      attemptSecret: "activation-secret",
    });
  });
});
