import { BrowserServiceError } from "@ryco/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { BrowserPolicy, BrowserPolicyLive } from "./BrowserPolicy.ts";

const runPolicy = <A, E>(effect: Effect.Effect<A, E, BrowserPolicy>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BrowserPolicyLive)));

describe("BrowserPolicy", () => {
  it("allows loopback navigation without approval", async () => {
    const decision = await runPolicy(
      Effect.gen(function* () {
        const policy = yield* BrowserPolicy;
        return yield* policy.decideNavigation({ rawUrl: "localhost:5173" });
      }),
    );

    expect(decision.url).toBe("http://localhost:5173/");
    expect(decision.origin).toBe("http://localhost:5173");
    expect(decision.decision.decision).toBe("allow");
  });

  it("requires approval for public origins", async () => {
    const decision = await runPolicy(
      Effect.gen(function* () {
        const policy = yield* BrowserPolicy;
        return yield* policy.decideNavigation({ rawUrl: "https://example.com/docs" });
      }),
    );

    expect(decision.origin).toBe("https://example.com");
    expect(decision.decision.decision).toBe("ask");
  });

  it("rejects blocked schemes as navigation_blocked", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const policy = yield* BrowserPolicy;
        return yield* policy.decideNavigation({ rawUrl: "javascript:alert(1)" });
      }).pipe(Effect.provide(BrowserPolicyLive)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toBeInstanceOf(BrowserServiceError);
      expect(failure?.error).toMatchObject({ code: "navigation_blocked", retryable: false });
    }
  });
});
