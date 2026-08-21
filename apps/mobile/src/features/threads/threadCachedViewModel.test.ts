import { describe, expect, it } from "vite-plus/test";

import type { ThreadConnectionDegradedReason } from "../../connection/threadConnectionRetarget";
import {
  deriveThreadCachedView,
  THREAD_CACHED_EMPTY_STATE_DETAIL,
  THREAD_CACHED_FALLBACK_STALE_DETAIL,
  type ThreadCachedViewInput,
} from "./threadCachedViewModel";

const DEGRADED_REASONS: ReadonlyArray<ThreadConnectionDegradedReason> = [
  "revoked",
  "node-missing",
  "directory-unavailable",
  "signed-out",
  "hosted-unavailable",
];

function view(overrides: Partial<ThreadCachedViewInput> = {}) {
  return deriveThreadCachedView({
    hydratedFromCacheAt: null,
    degradedReason: null,
    staleDetail: null,
    hasMessages: true,
    ...overrides,
  });
}

describe("deriveThreadCachedView", () => {
  it("leaves a live thread completely untouched", () => {
    // The cached treatment is additive and must cost nothing on the common
    // path. If a live thread ever picked up a banner or a disabled composer,
    // every thread in the app would look degraded.
    expect(view()).toEqual({
      banner: null,
      composerDisabled: false,
      actionsDisabled: false,
      promptsDisabled: false,
      emptyStateDetail: null,
      headerForcedOffline: false,
    });
  });

  it("keeps the composer usable while a retarget is still pending", () => {
    // Tapping a cached thread on a non-selected node is meant to end with the
    // node live. Disabling the composer during that window would make the
    // feature feel like a dead end, and the outbox already holds the message
    // until wave 1's per-environment drain gate lets it through.
    const result = view({ hydratedFromCacheAt: 1_000, staleDetail: "Online · cached" });

    expect(result).toEqual({
      banner: { text: "Online · cached", tone: "info" },
      composerDisabled: false,
      actionsDisabled: true,
      promptsDisabled: true,
      emptyStateDetail: null,
      headerForcedOffline: true,
    });
  });

  it("disables the prompt cards whenever the thread is not live", () => {
    // Approval / user-input / agent-control cards render from activities that
    // demotion preserves, but answering goes through ensureEnvironmentApi —
    // which throws without a connection — and an answer given against a cached
    // snapshot may target a prompt the node already resolved. Every non-live
    // view closes them; live threads keep them untouched.
    expect(view({ hydratedFromCacheAt: 1_000 }).promptsDisabled).toBe(true);
    expect(view({ degradedReason: "revoked" }).promptsDisabled).toBe(true);
    expect(view().promptsDisabled).toBe(false);
  });

  it("reuses the environment row's staleness phrase verbatim as the pending banner", () => {
    // Wave 2 owns the staleness vocabulary. A second phrasing invented here
    // would have the same node described two different ways on two screens.
    expect(
      view({ hydratedFromCacheAt: 1_000, staleDetail: "Offline · last seen 2h ago" }).banner,
    ).toEqual({ text: "Offline · last seen 2h ago", tone: "info" });
  });

  it("falls back to the cached phrase when the environment row lends none", () => {
    // A node the roster has not described yet (or a direct environment demoted
    // out of the cache) must still say something rather than render an empty
    // banner strip.
    expect(view({ hydratedFromCacheAt: 1_000, staleDetail: null }).banner).toEqual({
      text: THREAD_CACHED_FALLBACK_STALE_DETAIL,
      tone: "info",
    });
  });

  it("replaces the empty-state line only while a cached thread has no timeline", () => {
    // "No messages yet. Send one to get started." on a cache-hydrated shell
    // tells the user their conversation is gone. It is not — it is unsynced.
    expect(view({ hydratedFromCacheAt: 1_000, hasMessages: false }).emptyStateDetail).toBe(
      THREAD_CACHED_EMPTY_STATE_DETAIL,
    );
    expect(view({ hydratedFromCacheAt: 1_000, hasMessages: true }).emptyStateDetail).toBeNull();
    expect(view({ hasMessages: false }).emptyStateDetail).toBeNull();
  });

  it("forces the header offline for any non-live thread", () => {
    // buildThreadHeaderModel reads statusLabel off thread.latestTurn, so a
    // snapshot captured mid-turn renders "Running" with no connection behind
    // it — while the inbox has already forced that same node's rows offline.
    expect(view({ hydratedFromCacheAt: 1_000 }).headerForcedOffline).toBe(true);
    expect(view({ degradedReason: "revoked" }).headerForcedOffline).toBe(true);
    expect(view().headerForcedOffline).toBe(false);
  });

  it.each(DEGRADED_REASONS)(
    "states a bounded reason and closes the composer when the retarget is degraded by %s",
    (reason) => {
      // The wave's acceptance criterion: an unselectable node's thread opens
      // read-only from cache with a stated reason and does not hang. A null
      // banner here is a spinner that never resolves.
      const result = view({ hydratedFromCacheAt: 1_000, degradedReason: reason });

      expect(result.banner).not.toBeNull();
      expect(result.banner?.tone).toBe("warning");
      expect(result.banner?.text).toContain("Showing cached content.");
      expect(result.composerDisabled).toBe(true);
      expect(result.actionsDisabled).toBe(true);
      expect(result.headerForcedOffline).toBe(true);
    },
  );

  it.each(DEGRADED_REASONS)(
    "keeps the %s banner free of ids, errors and unbounded text",
    (reason) => {
      // Web's notice register is one sentence of cause plus one of
      // consequence. Interpolating a node id or a transport error string here
      // would leak internals to a user who can only act on the cause.
      const text = view({ hydratedFromCacheAt: 1_000, degradedReason: reason }).banner?.text ?? "";

      expect(text.length).toBeLessThanOrEqual(120);
      expect(text).not.toContain("Error");
      expect(text).not.toContain("undefined");
    },
  );

  it("appends the staleness phrase to the reason rather than replacing it", () => {
    // Both facts matter on a revoked node: why the app stopped trying, and how
    // old the content on screen is. Dropping either leaves the user guessing.
    const text =
      view({
        hydratedFromCacheAt: 1_000,
        degradedReason: "revoked",
        staleDetail: "Offline · last seen 2h ago",
      }).banner?.text ?? "";

    expect(text).toBe(
      "Access to this node was revoked. Showing cached content. Offline · last seen 2h ago",
    );
  });

  it("degrades a thread whose rows are still live when the node became unreachable", () => {
    // A node revoked while its thread is open has live store rows and no cache
    // stamp yet. Waiting for the demotion to land before saying anything would
    // leave an actionable-looking thread pointed at a node that is gone.
    const result = view({ hydratedFromCacheAt: null, degradedReason: "node-missing" });

    expect(result.banner?.tone).toBe("warning");
    expect(result.composerDisabled).toBe(true);
    expect(result.actionsDisabled).toBe(true);
  });

  it("never disables the composer without also disabling the mutating actions", () => {
    // A sendable-but-unconfigurable thread is coherent (the outbox absorbs the
    // send); the inverse is not — a composer that dispatches while the model
    // picker is frozen would be aimed at a node the app is not talking to.
    const combinations: ReadonlyArray<Partial<ThreadCachedViewInput>> = [
      {},
      { hydratedFromCacheAt: 1_000 },
      { degradedReason: "signed-out" },
      { hydratedFromCacheAt: 1_000, degradedReason: "directory-unavailable" },
    ];

    for (const overrides of combinations) {
      const result = view(overrides);
      if (result.composerDisabled) expect(result.actionsDisabled).toBe(true);
      // And nothing is ever gated without telling the user why.
      if (result.actionsDisabled) expect(result.banner).not.toBeNull();
    }
  });
});
