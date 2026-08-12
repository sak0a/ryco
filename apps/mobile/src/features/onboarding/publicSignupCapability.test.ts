import type { HttpClientService } from "@ryco/client-runtime/platform";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createPublicSignupCapabilityClient,
  createPublicSignupCapabilityProbe,
} from "./publicSignupCapability";

const ORIGIN = "https://hub.ryco.dev";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("public signup capability client", () => {
  it("strictly decodes and projects the public enabled state", async () => {
    const fetch = vi.fn(async () =>
      response({
        status: "enabled",
        antiBot: { provider: "turnstile", siteKey: "public_site_key_123" },
      }),
    );
    const client = createPublicSignupCapabilityClient({ fetch } as HttpClientService, () => 123);

    await expect(client.check(ORIGIN)).resolves.toEqual({ status: "enabled", checkedAt: 123 });
    expect(fetch).toHaveBeenCalledWith("https://hub.ryco.dev/api/public-signup/config", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
  });

  it("projects disabled without retaining deployment configuration", async () => {
    const client = createPublicSignupCapabilityClient(
      { fetch: async () => response({ status: "disabled" }) },
      () => 456,
    );
    const result = await client.check(ORIGIN);
    expect(result).toEqual({ status: "disabled", checkedAt: 456 });
    expect(Object.keys(result)).toEqual(["status", "checkedAt"]);
  });

  it("bounds network, status, size, parse, and schema failures", async () => {
    const clients = [
      createPublicSignupCapabilityClient({
        fetch: async () => {
          throw new Error("private network details");
        },
      }),
      createPublicSignupCapabilityClient({ fetch: async () => response({}, 500) }),
      createPublicSignupCapabilityClient({
        fetch: async () => new Response("x".repeat(4_097), { status: 200 }),
      }),
      createPublicSignupCapabilityClient({
        fetch: async () => new Response("{", { status: 200 }),
      }),
      createPublicSignupCapabilityClient({
        fetch: async () => response({ status: "disabled", token: "must-not-project" }),
      }),
    ];

    for (const client of clients) {
      await expect(client.check(ORIGIN)).resolves.toMatchObject({ status: "unreachable" });
      const result = await client.check(ORIGIN);
      expect(JSON.stringify(result)).not.toContain("private network details");
      expect(JSON.stringify(result)).not.toContain("must-not-project");
    }
  });
});

describe("public signup capability generation fence", () => {
  it("aborts and discards a result for a superseded origin", async () => {
    const releases: Array<(result: { status: "enabled"; checkedAt: number }) => void> = [];
    const signals: AbortSignal[] = [];
    const probe = createPublicSignupCapabilityProbe({
      check: (_origin, signal) => {
        signals.push(signal!);
        return new Promise((resolve) => releases.push(resolve));
      },
    });

    const first = probe.check(ORIGIN);
    const second = probe.check("https://other.ryco.dev");
    expect(signals[0]?.aborted).toBe(true);

    releases[1]?.({ status: "enabled", checkedAt: 2 });
    await expect(second).resolves.toEqual({ status: "enabled", generation: 2, checkedAt: 2 });
    releases[0]?.({ status: "enabled", checkedAt: 1 });
    await expect(first).resolves.toEqual({ status: "stale", generation: 1 });
  });

  it("invalidates an in-flight result when the selected profile changes", async () => {
    let release: ((result: { status: "disabled"; checkedAt: number }) => void) | undefined;
    const probe = createPublicSignupCapabilityProbe({
      check: () => new Promise((resolve) => (release = resolve)),
    });
    const pending = probe.check(ORIGIN);
    probe.invalidate();
    release?.({ status: "disabled", checkedAt: 3 });
    await expect(pending).resolves.toEqual({ status: "stale", generation: 1 });
  });
});
