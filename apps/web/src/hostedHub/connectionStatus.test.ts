import { describe, expect, it } from "vite-plus/test";

import {
  deriveHostedConnectionStatusIndicator,
  deriveHostedConnectionStatusText,
  HOSTED_E2EE_CHANNEL_STATUSES,
  type HostedE2eeChannelStatus,
  type WebHostedConnectionStatusInput,
  type WebHostedE2eeChannelStatus,
} from "./connectionStatus";
import { everyHostedConnectionStatusInput } from "../../test/hostedConnectionVocabulary";

/**
 * The web tier's half of `docs/relay-e2ee-protocol.md` §2.2, asserted where the
 * tier is known.
 *
 * `packages/client-runtime` owns the derivation and proves its properties over
 * all five inputs; `apps/mobile` proves its store can never emit the web row.
 * This is the mirror of that mobile proof and the fence's own test: the native
 * rows — `Encrypted` and its `e2ee` guarantee, and §13.1's release-gated
 * `Not verified` — must be unreachable from this module, because a Hub that
 * serves the JavaScript can complete a genuine handshake and draw a genuine
 * §13.5 `WebSAS` while exfiltrating plaintext (§2.4). Rendering the native
 * verified row from here is the one outcome §2.2, §2.3, and §2.4 forbid.
 */
describe("the web tier's connection status boundary (§2.2, §2.4)", () => {
  /** Every input the shipped app builds, crossed with every state it may report. */
  function everyWebInput(): ReadonlyArray<WebHostedConnectionStatusInput> {
    const inputs: WebHostedConnectionStatusInput[] = [];
    for (const base of everyHostedConnectionStatusInput()) {
      inputs.push(base);
      for (const e2eeStatus of WEB_E2EE_CHANNEL_STATUSES) inputs.push({ ...base, e2eeStatus });
    }
    return inputs;
  }

  /**
   * This tier's admissible channel states, derived from the runtime's exhaustive
   * enumeration rather than written out: a member added to the shared union is a
   * compile error here until someone decides which tier it belongs to.
   */
  const WEB_E2EE_CHANNEL_STATUSES = HOSTED_E2EE_CHANNEL_STATUSES.filter(
    (status): status is WebHostedE2eeChannelStatus =>
      status !== "verified" && status !== "unverified",
  );

  it("admits every channel state this tier can be in, and only those", () => {
    expect([...WEB_E2EE_CHANNEL_STATUSES].toSorted()).toEqual([
      "legacy",
      "negotiating",
      "unavailable",
      "web-unsigned",
    ]);
    // The two the fence removes are the two that mean a durable pin, which web
    // holds none of (§6.3, §13.1).
    const native: ReadonlyArray<HostedE2eeChannelStatus> = ["verified", "unverified"];
    for (const status of native) {
      expect(WEB_E2EE_CHANNEL_STATUSES).not.toContain(status);
    }
  });

  it("never produces the native verified row, on any input this tier can build", () => {
    let webRows = 0;
    for (const input of everyWebInput()) {
      const text = deriveHostedConnectionStatusText(input);
      const { guarantee } = deriveHostedConnectionStatusIndicator(input);
      expect(text, `text for ${JSON.stringify(input)}`).not.toBe("Encrypted");
      expect(text, `text for ${JSON.stringify(input)}`).not.toBe("Not verified");
      expect(guarantee, `guarantee for ${JSON.stringify(input)}`).not.toBe("e2ee");
      if (guarantee === "web") webRows += 1;
    }
    // …and the sweep is not vacuous: the row this tier IS allowed is reachable.
    expect(webRows).toBeGreaterThan(0);
  });

  it("makes a native-only channel state a compile error rather than a review question", () => {
    // The fence itself. Without it these are ordinary string literals in an
    // optional field, and one wrong one renders §2.2's bottom row verbatim from
    // the tier that may never claim it.
    const ready = {
      browserStatus: "current",
      sessionStatus: "ready",
      selectionStatus: "online",
      transportStatus: "online",
    } as const;
    // @ts-expect-error §13.1's verified pin is native-only; web holds no pin.
    deriveHostedConnectionStatusText({ ...ready, e2eeStatus: "verified" });
    // @ts-expect-error §13.1's release-gated pairing channel is native-only too.
    deriveHostedConnectionStatusIndicator({ ...ready, e2eeStatus: "unverified" });
    // The web row itself compiles, so the two above fail for their member and
    // not for the shape of the call.
    expect(deriveHostedConnectionStatusText({ ...ready, e2eeStatus: "web-unsigned" })).toBe(
      "Browser encrypted",
    );
  });

  it("leaves the shipped app byte-identical while it reports no channel state", () => {
    // apps/web supplies no `e2eeStatus` today, and the fence changed nothing
    // about that: the documented `unavailable` default still applies.
    for (const input of everyHostedConnectionStatusInput()) {
      expect(deriveHostedConnectionStatusText({ ...input, e2eeStatus: "unavailable" })).toBe(
        deriveHostedConnectionStatusText(input),
      );
      expect(deriveHostedConnectionStatusIndicator(input).guarantee).toBe(
        deriveHostedConnectionStatusIndicator({ ...input, e2eeStatus: "unavailable" }).guarantee,
      );
    }
  });
});
