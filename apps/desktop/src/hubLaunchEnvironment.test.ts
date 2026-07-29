import { describe, expect, it } from "vite-plus/test";

import { removeDesktopOwnedHubEnvironment } from "./hubLaunchEnvironment.ts";

describe("removeDesktopOwnedHubEnvironment", () => {
  it("removes every Desktop-owned Hub value and preserves unrelated environment", () => {
    const env: NodeJS.ProcessEnv = {
      RYCO_HUB_CONNECTOR_ENABLED: "true",
      RYCO_HUB_ORIGIN: "https://hub.example",
      RYCO_HUB_NODE_NAME: "Private machine",
      RYCO_HUB_ALLOW_FILE_SECRET_STORE: "true",
      RYCO_LOG_LEVEL: "Debug",
    };

    removeDesktopOwnedHubEnvironment(env);

    expect(env).toEqual({ RYCO_LOG_LEVEL: "Debug" });
  });
});
