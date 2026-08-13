import { describe, expect, it } from "vitest";

import { verifiedEmailCancellation } from "./nativeIdentityCancellation";

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
});
