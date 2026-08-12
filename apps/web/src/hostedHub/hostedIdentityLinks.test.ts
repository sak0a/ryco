import { describe, expect, it, vi } from "vitest";

import { consumeHostedIdentityLink, parseHostedIdentityLink } from "./hostedIdentityLinks";

const opaque = "A".repeat(43);

describe("hosted identity email links", () => {
  it("parses signup and reset bearer material only from URL fragments", () => {
    expect(
      parseHostedIdentityLink(
        new URL(
          `https://hub.example/public-signup/verify#attempt=signup_aaaaaaaaaaaaaaaaaaaaaa&attempt_secret=${opaque}&token=${opaque}`,
        ),
      ),
    ).toEqual({
      kind: "signup-verification",
      attemptId: "signup_aaaaaaaaaaaaaaaaaaaaaa",
      attemptSecret: opaque,
      token: opaque,
    });
    expect(
      parseHostedIdentityLink(new URL(`https://hub.example/password-reset#token=${opaque}`)),
    ).toEqual({ kind: "password-reset", token: opaque });
    expect(
      parseHostedIdentityLink(new URL(`https://hub.example/password-reset?token=${opaque}`)),
    ).toEqual({ kind: "invalid-password-reset" });
  });

  it("scrubs valid and malformed identity fragments immediately", () => {
    const replaceState = vi.fn();
    expect(
      consumeHostedIdentityLink({
        href: "https://hub.example/password-reset#token=malformed-secret",
        historyState: { route: "qa" },
        replaceState,
      }),
    ).toEqual({ kind: "invalid-password-reset" });
    expect(replaceState).toHaveBeenCalledWith({ route: "qa" }, "", "/password-reset");
  });

  it("leaves ordinary hosted routes untouched", () => {
    const replaceState = vi.fn();
    expect(
      consumeHostedIdentityLink({
        href: "https://hub.example/nodes/node_aaaaaaaaaaaaaaaaaaaaaa",
        historyState: null,
        replaceState,
      }),
    ).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
