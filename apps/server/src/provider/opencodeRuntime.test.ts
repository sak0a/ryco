import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { resolveOpenCodeServerPassword, verifyOpenCodeServerVersion } from "./opencodeRuntime.ts";

describe("resolveOpenCodeServerPassword", () => {
  it("prefers an explicitly configured password", () => {
    expect(
      resolveOpenCodeServerPassword({
        external: false,
        configuredPassword: "configured",
        environment: { OPENCODE_SERVER_PASSWORD: "environment" },
      }),
    ).toBe("configured");
  });

  it("inherits the environment password for a locally managed server", () => {
    expect(
      resolveOpenCodeServerPassword({
        external: false,
        environment: { OPENCODE_SERVER_PASSWORD: "environment" },
      }),
    ).toBe("environment");
  });

  it("does not leak the process environment password to an external server", () => {
    expect(
      resolveOpenCodeServerPassword({
        external: true,
        environment: { OPENCODE_SERVER_PASSWORD: "environment" },
      }),
    ).toBeUndefined();
  });
});

describe("verifyOpenCodeServerVersion", () => {
  const clientWithVersion = (version: string) =>
    ({
      global: {
        health: async () => ({ data: { healthy: true, version } }),
      },
    }) as unknown as OpencodeClient;

  it("accepts a supported authenticated server", async () => {
    await expect(
      Effect.runPromise(verifyOpenCodeServerVersion(clientWithVersion("1.18.18"))),
    ).resolves.toBe("1.18.18");
  });

  it("rejects an outdated server before using its API", async () => {
    const error = await Effect.runPromise(
      Effect.flip(verifyOpenCodeServerVersion(clientWithVersion("1.14.18"))),
    );
    expect(error.detail).toContain("too old");
  });
});
