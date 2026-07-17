import { EnvironmentId } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../env")>()),
  isHostedHubMode: () => true,
}));

import { resolvePrimaryEnvironmentHttpUrl } from "../primary/target";
import { getEnvironmentHttpBaseUrl, resolveEnvironmentHttpUrl } from "./catalog";

describe("hosted node HTTP boundary", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { origin: "https://hub.example.test" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not resolve node HTTP routes against the Hub origin", () => {
    const environmentId = EnvironmentId.make("environment-hosted");

    expect(getEnvironmentHttpBaseUrl(environmentId)).toBeNull();
    expect(() =>
      resolveEnvironmentHttpUrl({
        environmentId,
        pathname: "/api/project-favicon",
        searchParams: { cwd: "/sensitive/project/path" },
      }),
    ).toThrow("Unable to resolve HTTP base URL");
    expect(() =>
      resolvePrimaryEnvironmentHttpUrl("/api/project-avatar/upload", {
        projectId: "project-sensitive",
      }),
    ).toThrow("Node HTTP routes are unavailable in hosted Hub mode.");
  });
});
