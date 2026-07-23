import { describe, expect, it } from "vite-plus/test";

import { computeBearerTokenExpiresAt, isBearerTokenUsable } from "./tokenLifetime.ts";

describe("saved-environment token lifetime", () => {
  it("expires a browser bearer token at the pinned seven-day boundary", () => {
    const nowMs = Date.parse("2026-07-23T00:00:00.000Z");
    const expiresAt = computeBearerTokenExpiresAt(nowMs);
    expect(isBearerTokenUsable({ token: "token", expiresAt, nowMs })).toBe(true);
    expect(isBearerTokenUsable({ token: "token", expiresAt, nowMs: Date.parse(expiresAt) })).toBe(
      false,
    );
  });
});
