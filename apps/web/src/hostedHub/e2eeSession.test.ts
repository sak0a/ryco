import { EnvironmentId } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  beginWebE2eeChannelAttempt,
  lockWebE2eeChannelMode,
  publishWebE2eeVerificationCode,
  resetWebE2eeSession,
  subscribeWebE2eeSession,
  webE2eeSessionState,
} from "./e2eeSession";
import { clearWebHostedNodeScopedState } from "./environment";

// docs/relay-e2ee-protocol.md §13's per-channel projection, asserted on the
// module rather than through a channel.
//
// `e2eeAttempt.test.ts` drives this module end to end through the real §4.4
// machine, and that is where the reachable states are proven. What it cannot
// reach is the module's own refusals and its per-channel clearing: those are
// properties of a caller sequence, and each of them is the last line between a
// §13.5 code and a session that does not exist.

const CODE = "AAAA-BBBB";
const UNAVAILABLE = { status: "unavailable", verificationCode: null } as const;

beforeEach(() => {
  resetWebE2eeSession();
});

afterEach(() => {
  resetWebE2eeSession();
});

describe("§13 the projection is per channel", () => {
  it("drops the previous channel's §13.5 code when the next one begins", () => {
    // §13.5's code is bound to ONE session by construction — "it changes on every
    // channel" — so carrying it into the next negotiation is the one way an
    // owner can compare a dead session's string against the node CLI's live one
    // and see a match. `beginWebE2eeChannelAttempt` names both halves; only the
    // status half had an assertion.
    lockWebE2eeChannelMode("e2ee");
    publishWebE2eeVerificationCode(CODE);
    expect(webE2eeSessionState()).toEqual({ status: "web-unsigned", verificationCode: CODE });

    beginWebE2eeChannelAttempt();
    expect(webE2eeSessionState()).toEqual({ status: "negotiating", verificationCode: null });
  });

  it("drops the code again when the channel falls back to plaintext", () => {
    lockWebE2eeChannelMode("e2ee");
    publishWebE2eeVerificationCode(CODE);
    lockWebE2eeChannelMode("legacy");
    expect(webE2eeSessionState()).toEqual({ status: "legacy", verificationCode: null });
  });

  it("is dropped by the node-scoped clearing catalog", () => {
    // The sibling of §12.1's latch rule and its opposite: the §13 projection IS
    // node-scoped, so a teardown that left `web-unsigned` and the previous
    // node's `WebSAS` standing would describe a channel for a node the owner has
    // left.
    lockWebE2eeChannelMode("e2ee");
    publishWebE2eeVerificationCode(CODE);
    clearWebHostedNodeScopedState(EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa"));
    expect(webE2eeSessionState()).toEqual(UNAVAILABLE);
  });
});

describe("§13.5 the code is refused by any state that cannot have one", () => {
  it("refuses a code for a channel that does not exist", () => {
    publishWebE2eeVerificationCode(CODE);
    expect(webE2eeSessionState()).toEqual(UNAVAILABLE);
  });

  it("refuses a code for a channel that locked plaintext", () => {
    // §12.2's fallback channel has no session to bind a §13.5 string to, so a
    // value arriving here describes one that does not exist. It is defence in
    // depth today — the machine publishes only at its own `e2ee` lock — and the
    // guard is exactly what a later caller would remove without noticing.
    lockWebE2eeChannelMode("legacy");
    publishWebE2eeVerificationCode(CODE);
    expect(webE2eeSessionState()).toEqual({ status: "legacy", verificationCode: null });
  });

  it("accepts a code while negotiating, which is the ordering the machine uses", () => {
    // §4.4's mode lock is a state the machine holds rather than a callback: it
    // locks, derives, and publishes, and only then does the caller's wrapper
    // report the lock. The live state at publish time is therefore still
    // `negotiating`, and gating on `web-unsigned` silently threw the code away.
    beginWebE2eeChannelAttempt();
    publishWebE2eeVerificationCode(CODE);
    expect(webE2eeSessionState()).toEqual({ status: "negotiating", verificationCode: CODE });
    lockWebE2eeChannelMode("e2ee");
    expect(webE2eeSessionState()).toEqual({ status: "web-unsigned", verificationCode: CODE });
  });
});

describe("§13 the projection notifies its subscribers", () => {
  it("notifies on every change and on no no-op", () => {
    let notifications = 0;
    const unsubscribe = subscribeWebE2eeSession(() => void (notifications += 1));
    try {
      beginWebE2eeChannelAttempt();
      expect(notifications).toBe(1);
      beginWebE2eeChannelAttempt();
      expect(notifications).toBe(1);
      lockWebE2eeChannelMode("e2ee");
      expect(notifications).toBe(2);
      resetWebE2eeSession();
      expect(notifications).toBe(3);
    } finally {
      unsubscribe();
    }
    lockWebE2eeChannelMode("legacy");
    expect(notifications).toBe(3);
  });
});
