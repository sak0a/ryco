import { describe, expect, it } from "vite-plus/test";

import {
  deriveHostedConnectionStatusIndicator,
  deriveHostedConnectionStatusText,
  type HostedE2eeChannelStatus,
} from "./connectionStatus";
import {
  everyHostedConnectionStatusInput,
  WEB_HOSTED_E2EE_CHANNEL_STATUSES,
} from "../../test/hostedConnectionVocabulary";

/**
 * The web tier's half of `docs/relay-e2ee-protocol.md` §2.2, asserted where the
 * tier is known.
 *
 * `packages/client-runtime` owns the derivation and proves its properties over
 * all five inputs; `apps/mobile` proves its store can never emit the web row.
 * This is the mirror of that mobile proof and the fence's own test: the native
 * rows — `Encrypted · Verified locally` and its `e2ee` guarantee, the
 * account-enrolled row, and §13.1's release-gated
 * `Not verified` — must be unreachable from this module, because a Hub that
 * serves the JavaScript can complete a genuine handshake and draw a genuine
 * §13.5 `WebSAS` while exfiltrating plaintext (§2.4). Rendering the native
 * verified row from here is the one outcome §2.2, §2.3, and §2.4 forbid.
 */
describe("the web tier's connection status boundary (§2.2, §2.4)", () => {
  it("admits every channel state this tier can be in, and only those", () => {
    expect([...WEB_HOSTED_E2EE_CHANNEL_STATUSES].toSorted()).toEqual([
      "legacy",
      "negotiating",
      "unavailable",
      "web-unsigned",
    ]);
    const native: ReadonlyArray<HostedE2eeChannelStatus> = [
      "verified",
      "account-trusted",
      "unverified",
    ];
    for (const status of native) {
      expect(WEB_HOSTED_E2EE_CHANNEL_STATUSES).not.toContain(status);
    }
  });

  it("never produces the native verified row, on any input this tier can build", () => {
    let webRows = 0;
    for (const input of everyHostedConnectionStatusInput()) {
      const text = deriveHostedConnectionStatusText(input);
      const { guarantee } = deriveHostedConnectionStatusIndicator(input);
      expect(text, `text for ${JSON.stringify(input)}`).not.toBe("Encrypted · Verified locally");
      expect(text, `text for ${JSON.stringify(input)}`).not.toBe("Encrypted · Account trusted");
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
      "Encrypted web",
    );
  });

  it("treats an omitted channel state exactly as the documented `unavailable` default", () => {
    // The shipped app now always supplies one — every relay socket runs a §4.4
    // machine and all three surfaces read what it locked — so this is no longer
    // a statement about apps/web. It is the contract for the OPTIONAL field: a
    // caller that omits it makes no claim either way, and never accidentally
    // asserts §12.2's `legacy`, which is a claim about a channel that could have
    // been encrypted.
    for (const input of everyHostedConnectionStatusInput()) {
      const { e2eeStatus, ...omitted } = input;
      if (e2eeStatus !== "unavailable") continue;
      expect(deriveHostedConnectionStatusText(omitted)).toBe(
        deriveHostedConnectionStatusText(input),
      );
      expect(deriveHostedConnectionStatusIndicator(omitted).guarantee).toBe(
        deriveHostedConnectionStatusIndicator(input).guarantee,
      );
    }
  });
});
