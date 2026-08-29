import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vitest";

import { resolveSettingsTargetEnvironmentId } from "./settingsTarget";

describe("resolveSettingsTargetEnvironmentId", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-local");
  const activeEnvironmentId = EnvironmentId.make("environment-qa");
  const requestedEnvironmentId = EnvironmentId.make("environment-notification");

  it("targets the active remote task instead of the local primary node", () => {
    expect(
      resolveSettingsTargetEnvironmentId({
        requestedEnvironmentId: null,
        activeEnvironmentId,
        primaryEnvironmentId,
      }),
    ).toBe(activeEnvironmentId);
  });

  it("lets an origin-bearing notification override the current task", () => {
    expect(
      resolveSettingsTargetEnvironmentId({
        requestedEnvironmentId,
        activeEnvironmentId,
        primaryEnvironmentId,
      }),
    ).toBe(requestedEnvironmentId);
  });
});
