import { describe, expect, it } from "vitest";

import {
  disableContextCompaction,
  initialContextCompactionPolicyState,
  markContextCompactionStarted,
  observeContextCompaction,
  settleContextCompaction,
} from "./contextCompactionPolicy.ts";

describe("context compaction policy", () => {
  it("triggers at the high watermark with a conservative window", () => {
    const state = initialContextCompactionPolicyState(7);

    expect(
      observeContextCompaction(state, {
        generation: 7,
        usage: { usedTokens: 159_999, maxTokens: 200_000 },
      }).trigger,
    ).toBe(false);
    expect(
      observeContextCompaction(state, {
        generation: 7,
        usage: { usedTokens: 160_000, maxTokens: 200_000 },
      }),
    ).toMatchObject({
      trigger: true,
      windowTokens: 160_000,
      state: { phase: "requested", armed: false },
    });
  });

  it("keeps one request in flight and rearms only below the low watermark", () => {
    const requested = observeContextCompaction(initialContextCompactionPolicyState(3), {
      generation: 3,
      usage: { usedTokens: 170_000, maxTokens: 200_000 },
    }).state;
    const compacting = markContextCompactionStarted(requested, 3);

    expect(
      observeContextCompaction(compacting, {
        generation: 3,
        usage: { usedTokens: 190_000, maxTokens: 200_000 },
      }).trigger,
    ).toBe(false);

    const settled = settleContextCompaction(compacting, 3);
    const stillHigh = observeContextCompaction(settled, {
      generation: 3,
      usage: { usedTokens: 150_000, maxTokens: 200_000 },
    });
    expect(stillHigh).toMatchObject({ trigger: false, state: { armed: false } });

    const rearmed = observeContextCompaction(stillHigh.state, {
      generation: 3,
      usage: { usedTokens: 130_000, maxTokens: 200_000 },
    });
    expect(rearmed).toMatchObject({ trigger: false, state: { armed: true, phase: "idle" } });
  });

  it("blocks policy requests while a provider-initiated compaction is active", () => {
    const compacting = markContextCompactionStarted(initialContextCompactionPolicyState(5), 5);

    expect(
      observeContextCompaction(compacting, {
        generation: 5,
        usage: { usedTokens: 190_000, maxTokens: 200_000 },
      }),
    ).toEqual({ state: compacting, trigger: false });
  });

  it("ignores stale generations and remains disabled after unsupported behavior", () => {
    const state = initialContextCompactionPolicyState(11);
    const stale = observeContextCompaction(state, {
      generation: 10,
      usage: { usedTokens: 190_000, maxTokens: 200_000 },
    });
    expect(stale).toEqual({ state, trigger: false });

    const disabled = disableContextCompaction(state, 11);
    expect(
      observeContextCompaction(disabled, {
        generation: 11,
        usage: { usedTokens: 190_000, maxTokens: 200_000 },
      }),
    ).toEqual({ state: disabled, trigger: false });
  });
});
